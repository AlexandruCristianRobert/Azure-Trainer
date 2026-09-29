import { kubeObjectKey } from './objects.js'
import { reconcileServicesResult } from './services.js'
import { resolvePodConfiguration } from './configuration.js'
import { ACR_PULL_ROLE_ID } from '../sandbox/roleAssignments.js'
import { reconcileHealth } from './probes.js'
import { schedulePendingPods } from './scheduling.js'
import { RESOURCE_FIXTURES } from '../../data/fixtures/aks/resources.js'
import { clearPodState } from './pod-cleanup.js'
import { registerRevision } from './rollout-history.js'
import { reconcileRollouts } from './rollouts.js'

const clone = value => structuredClone(value)
const hash = value => { let n = 5381; for (const char of JSON.stringify(value)) n = ((n << 5) + n) ^ char.charCodeAt(0); return (n >>> 0).toString(16).padStart(8, '0') }

function hasKubeletPull(sandbox, cluster, image) {
  const [registryHost] = image.split('/')
  const registry = sandbox.containerRegistries.find(item => item.loginServer.toLowerCase() === registryHost.toLowerCase())
  return !!registry && sandbox.roleAssignments.some(item => item.scope.toLowerCase() === registry.id.toLowerCase()
    && item.principalId.toLowerCase() === cluster.identityProfile.kubeletidentity.objectId.toLowerCase()
    && item.roleDefinitionId === ACR_PULL_ROLE_ID)
}

function addEvent(state, reason, message, namespace) {
  state.events = [...state.events, { apiVersion: 'v1', kind: 'Event', metadata: { name: `event-${state.events.length + 1}`, namespace }, reason, message, simulated: true }].slice(-300)
}

function capturePod(run, pod, artifactId) {
  if (!artifactId) return
  const artifact = run.artifacts.buildsById[artifactId]
  if (!artifact) return
  const source = run.artifacts.sourceSnapshotsByHash[artifact.sourceHash]
  if (!source) return
  run.runtime.kubernetes.clusters[pod.clusterId].podSnapshots[pod.metadata.uid] = {
    artifactId, templateHash: hash(pod.template), environment: { ...pod.configuration.environment }, files: { ...clone(source.files), ...pod.configuration.files }, configRefs: pod.configuration.configRefs,
  }
}

function waitingConfiguration(state, pod, diagnostics) {
  const issue = diagnostics[0]
  const reason = issue.mount ? 'FailedMount' : 'CreateContainerConfigError'
  pod.status = { phase: 'Pending', containerStatuses: [{ name: pod.spec.containers[0].name, state: { waiting: { reason } } }] }
  addEvent(state, reason, `${issue.message}`, pod.metadata.namespace)
}

export function createPod(run, cluster, deployment, replicaSet, ordinal) {
  const state = run.runtime.kubernetes.clusters[cluster.id]
  const template = replicaSet.spec.template
  const container = template.spec.containers[0]
  const artifactId = run.artifacts.publishedTags[container.image]
  const grant = hasKubeletPull(run.sandbox, cluster, container.image)
  const configuration = resolvePodConfiguration(state.resources, deployment.metadata.namespace, template.spec)
  const reason = !grant ? 'RegistryAccessDenied' : !artifactId ? 'ImageNotFound' : configuration.diagnostics.length ? (configuration.diagnostics[0].mount ? 'FailedMount' : 'CreateContainerConfigError') : null
  const uid = `kube-${run.nextSequence++}`
  const podName = `${deployment.metadata.name}-${hash(template)}-${ordinal}-${uid.slice(5)}`
  const resourceManaged = run.__resourceLab === true || !!state.resourcesRuntime
  const value = {
    apiVersion: 'v1', kind: 'Pod', metadata: { name: podName, namespace: deployment.metadata.namespace, uid, resourceVersion: '1', labels: clone(template.metadata.labels), ownerReferences: [{ uid: replicaSet.metadata.uid, kind: 'ReplicaSet', name: replicaSet.metadata.name }] },
    spec: clone(template.spec), status: reason || resourceManaged ? { phase: 'Pending', containerStatuses: [{ name: container.name, state: { waiting: { reason: reason ?? 'Pending' } } }] } : { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
  }
  state.resources[kubeObjectKey('Pod', value.metadata.namespace, podName)] = value
  if (reason) {
    if (configuration.diagnostics.length && grant && artifactId) waitingConfiguration(state, value, configuration.diagnostics)
    else addEvent(state, reason, `Simulated image pull for ${container.image} failed: ${reason}.`, deployment.metadata.namespace)
  } else if (!resourceManaged) capturePod(run, { ...value, clusterId: cluster.id, template, configuration }, artifactId)
  return value
}

export function retryPendingPod(run, cluster, deployment, pod) {
  if (pod.status?.phase !== 'Pending' || pod.metadata.deletionTimestamp !== undefined) return
  const container = pod.spec.containers[0]
  const artifactId = run.artifacts.publishedTags[container.image]
  const state = run.runtime.kubernetes.clusters[cluster.id]
  const owner = Object.values(state.resources).find(item => item.kind === 'ReplicaSet' && pod.metadata.ownerReferences?.some(ref => ref.uid === item.metadata.uid))
  const template = owner?.spec.template ?? { metadata: { labels: pod.metadata.labels }, spec: pod.spec }
  const configuration = resolvePodConfiguration(state.resources, pod.metadata.namespace, template.spec)
  const reason = !hasKubeletPull(run.sandbox, cluster, container.image) ? 'RegistryAccessDenied'
    : !artifactId ? 'ImageNotFound' : configuration.diagnostics.length ? (configuration.diagnostics[0].mount ? 'FailedMount' : 'CreateContainerConfigError') : null
  const previous = pod.status.containerStatuses?.[0]?.state?.waiting?.reason
  if ((run.__resourceLab === true || state.resourcesRuntime) && !pod.spec.nodeName) return
  if (reason === previous) return
  if (reason) {
    if (configuration.diagnostics.length && hasKubeletPull(run.sandbox, cluster, container.image) && artifactId) waitingConfiguration(run.runtime.kubernetes.clusters[cluster.id], pod, configuration.diagnostics)
    else {
      pod.status = { phase: 'Pending', containerStatuses: [{ name: container.name, state: { waiting: { reason } } }] }
      addEvent(run.runtime.kubernetes.clusters[cluster.id], reason,
        `Simulated image pull for ${container.image} failed: ${reason}.`, deployment.metadata.namespace)
    }
  } else {
    pod.status = { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] }
    capturePod(run, { ...pod, clusterId: cluster.id, template, configuration }, artifactId)
  }
}

export function getDeploymentPods(run, clusterId, namespace, name) {
  const resources = run.runtime.kubernetes.clusters[clusterId]?.resources ?? {}
  const deployment = resources[kubeObjectKey('Deployment', namespace, name)]
  if (!deployment) return []
  const ownedReplicaSets = new Set(Object.values(resources).filter(item => item.kind === 'ReplicaSet'
    && item.metadata.namespace === namespace && item.metadata.ownerReferences?.some(ref => ref.uid === deployment.metadata.uid)).map(item => item.metadata.uid))
  return Object.values(resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === namespace
    && item.metadata.ownerReferences?.some(ref => ownedReplicaSets.has(ref.uid)))
}

function recordReplacement(state, deleted, replacement, cause = 'template') {
  const pending = state.receipts.find(item => item.deletedPodUid === deleted.metadata.uid && item.replacementPodUid === null)
  const nextOwner = replacement.metadata.ownerReferences?.[0]
  const replacementTemplateHash = getPodTemplateHash(state, replacement)
  if (pending) { pending.replacementPodUid = replacement.metadata.uid; pending.replacementPodName = replacement.metadata.name; pending.replacementReplicaSetUid = nextOwner?.uid; pending.replacementTemplateHash = replacementTemplateHash; return }
  const sequence = Number(replacement.metadata.uid.slice(5))
  state.receipts.push({ cause, sequence, deletedPodUid: deleted.metadata.uid, deletedPodName: deleted.metadata.name,
    deletedReplicaSetUid: deleted.metadata.ownerReferences?.[0]?.uid, replacementPodUid: replacement.metadata.uid,
    replacementPodName: replacement.metadata.name, replacementReplicaSetUid: nextOwner?.uid,
    templateHash: replacementTemplateHash, replacementTemplateHash })
  if (state.receipts.length > 100) state.receipts.splice(0, state.receipts.length - 100)
}

export function reconcileKubernetesResult(input, lab) {
  const original = input
  let run = clone(input)
  run.__resourceLab = lab?.capabilities?.kubernetesResources === true
  for (const cluster of run.sandbox.aksClusters ?? []) {
    const state = run.runtime.kubernetes.clusters[cluster.id]
    if (!state) continue
    if (run.__resourceLab && !state.resourcesRuntime) state.resourcesRuntime = { version: 1, nodes: clone(RESOURCE_FIXTURES.nodes), assignments: {}, usage: {}, metrics: {}, hpa: {}, experiment: null, receipts: [], incident: null, terminationDue: {}, accountedUntilMs: null }
    if (lab?.capabilities?.kubernetesRollouts === true) state.rollouts ??= { version: 1, deployments: {}, experiment: null, receipts: [] }
    const deployments = Object.values(state.resources).filter(item => item.kind === 'Deployment')
    for (const deployment of deployments) {
      if (lab?.capabilities?.kubernetesRollouts === true) {
        const revision = registerRevision(run, { clusterId: cluster.id, namespace: deployment.metadata.namespace, deploymentName: deployment.metadata.name, deploymentUid: deployment.metadata.uid }, deployment.spec.template)
        if (revision.diagnostics.length) return { run: original, diagnostics: revision.diagnostics }
        run = revision.run
        continue
      }
      const templateHash = hash(deployment.spec.template)
      const rsName = `${deployment.metadata.name}-${templateHash}`
      const rsKey = kubeObjectKey('ReplicaSet', deployment.metadata.namespace, rsName)
      let replicaSet = state.resources[rsKey]
      if (!replicaSet) {
        replicaSet = { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name: rsName, namespace: deployment.metadata.namespace, uid: `kube-${run.nextSequence++}`, resourceVersion: '1', ownerReferences: [{ uid: deployment.metadata.uid, kind: 'Deployment', name: deployment.metadata.name }] }, spec: { replicas: deployment.spec.replicas, selector: clone(deployment.spec.selector), template: clone(deployment.spec.template) }, status: {} }
        state.resources[rsKey] = replicaSet
      }
      const ownedPods = getDeploymentPods(run, cluster.id, deployment.metadata.namespace, deployment.metadata.name)
      const previous = ownedPods.filter(item => item.metadata.ownerReferences?.some(ref => ref.uid !== replicaSet.metadata.uid))
      const current = ownedPods.filter(item => item.metadata.ownerReferences?.some(ref => ref.uid === replicaSet.metadata.uid) && item.metadata.deletionTimestamp === undefined)
      const removed = [...previous, ...current.slice(deployment.spec.replicas)]
      for (const stale of removed) {
        if (run.__resourceLab && stale.metadata.ownerReferences?.some(ref => ref.uid === replicaSet.metadata.uid)) {
          stale.metadata.deletionTimestamp ??= run.runtime.simTimeMs
          state.resourcesRuntime.terminationDue[stale.metadata.uid] ??= run.runtime.simTimeMs + 1000
        } else {
          delete state.resources[kubeObjectKey('Pod', stale.metadata.namespace, stale.metadata.name)]
          clearPodState(state, stale.metadata.uid)
        }
      }
      for (const old of Object.values(state.resources).filter(item => item.kind === 'ReplicaSet'
        && item.metadata.namespace === deployment.metadata.namespace && item.metadata.ownerReferences?.some(ref => ref.uid === deployment.metadata.uid)
        && item.metadata.uid !== replicaSet.metadata.uid)) {
        delete state.resources[kubeObjectKey('ReplicaSet', old.metadata.namespace, old.metadata.name)]
      }
      const created = []
      const remaining = current.length - current.slice(deployment.spec.replicas).length
      for (let index = Math.max(0, remaining); index < deployment.spec.replicas; index++) created.push(createPod(run, cluster, deployment, replicaSet, index))
      for (const pending of current.slice(0, deployment.spec.replicas)) retryPendingPod(run, cluster, deployment, pending)
      removed.forEach((old, index) => { if (created[index]) recordReplacement(state, old, created[index]) })
      const deletedReceipts = state.receipts.filter(item => item.replacementPodUid === null)
      for (const receipt of deletedReceipts) {
        const replacement = created.find(item => !state.receipts.some(other => other.replacementPodUid === item.metadata.uid))
        if (!replacement) break
        receipt.replacementPodUid = replacement.metadata.uid
        receipt.replacementPodName = replacement.metadata.name
        receipt.replacementReplicaSetUid = replacement.metadata.ownerReferences?.[0]?.uid ?? null
        receipt.replacementTemplateHash = getPodTemplateHash(state, replacement)
      }
      if (replicaSet.spec.replicas !== deployment.spec.replicas) {
        replicaSet.spec.replicas = deployment.spec.replicas
        replicaSet.metadata.resourceVersion = String(Number(replicaSet.metadata.resourceVersion) + 1)
      }
    }
  }
  if (lab?.capabilities?.kubernetesRollouts === true) {
    for (const cluster of run.sandbox.aksClusters ?? []) run = reconcileRollouts(run, cluster.id, run.runtime.simTimeMs, lab).run
  }
  if (run.__resourceLab) {
    for (const cluster of run.sandbox.aksClusters ?? []) {
      run = schedulePendingPods(run, cluster.id, lab)
      const state = run.runtime.kubernetes.clusters[cluster.id]
      for (const deployment of Object.values(state.resources).filter(item => item.kind === 'Deployment')) {
        for (const pod of getDeploymentPods(run, cluster.id, deployment.metadata.namespace, deployment.metadata.name)) retryPendingPod(run, cluster, deployment, pod)
      }
    }
  }
  run = reconcileHealth(run, lab)
  for (const cluster of run.sandbox.aksClusters ?? []) {
    const result = reconcileServicesResult(run, cluster.id)
    if (result.diagnostics.length) return { run: original, diagnostics: result.diagnostics }
    run = result.run
  }
  delete run.__resourceLab
  return { run, diagnostics: [] }
}

export function reconcileKubernetes(input, lab) { return reconcileKubernetesResult(input, lab).run }

export function restartDeployment(input, clusterId, namespace, name, lab) {
  return restartDeploymentResult(input, clusterId, namespace, name, lab).run
}

export function restartDeploymentResult(input, clusterId, namespace, name, lab) {
  const next = clone(input)
  const state = next.runtime.kubernetes.clusters[clusterId]
  const deployment = state?.resources[kubeObjectKey('Deployment', namespace, name)]
  if (!deployment) return { run: next, diagnostics: [] }
  deployment.spec.template.metadata.annotations = { ...(deployment.spec.template.metadata.annotations ?? {}),
    'kubectl.kubernetes.io/restarted-at': `sim-${next.runtime.simTimeMs}-${next.nextSequence}` }
  deployment.metadata.generation = (deployment.metadata.generation ?? 1) + 1
  deployment.metadata.resourceVersion = String(Number(deployment.metadata.resourceVersion) + 1)
  const result = reconcileKubernetesResult(next, lab)
  return result.diagnostics.length ? { run: input, diagnostics: result.diagnostics } : result
}

export function getPodTemplateHash(state, pod) {
  const snapshotHash = state.podSnapshots[pod.metadata.uid]?.templateHash
  if (snapshotHash) return snapshotHash
  const ownerUid = pod.metadata.ownerReferences?.[0]?.uid
  const replicaSet = Object.values(state.resources).find(item => item.kind === 'ReplicaSet' && item.metadata.uid === ownerUid)
  return replicaSet ? hash(replicaSet.spec.template) : null
}
