import { kubeObjectKey } from './objects.js'
import { ACR_PULL_ROLE_ID } from '../sandbox/roleAssignments.js'

const clone = value => structuredClone(value)
const hash = value => { let n = 5381; for (const char of JSON.stringify(value)) n = ((n << 5) + n) ^ char.charCodeAt(0); return (n >>> 0).toString(16) }

function hasKubeletPull(sandbox, cluster, image) {
  const [registryHost] = image.split('/')
  const registry = sandbox.containerRegistries.find(item => item.loginServer.toLowerCase() === registryHost.toLowerCase())
  return !!registry && sandbox.roleAssignments.some(item => item.scope.toLowerCase() === registry.id.toLowerCase()
    && item.principalId.toLowerCase() === cluster.identityProfile.kubeletidentity.objectId.toLowerCase()
    && item.roleDefinitionId === ACR_PULL_ROLE_ID)
}

function addEvent(state, reason, message) {
  state.events = [...state.events, { apiVersion: 'v1', kind: 'Event', metadata: { name: `event-${state.events.length + 1}` }, reason, message, simulated: true }].slice(-300)
}

function capturePod(run, pod, artifactId) {
  if (!artifactId) return
  const artifact = run.artifacts.buildsById[artifactId]
  if (!artifact) return
  const c = pod.spec.containers[0]
  const source = run.artifacts.sourceSnapshotsByHash[artifact.sourceHash]
  if (!source) return
  run.runtime.kubernetes.clusters[pod.clusterId].podSnapshots[pod.metadata.uid] = {
    artifactId, templateHash: hash(pod.template), environment: Object.fromEntries((c.env ?? []).map(x => [x.name, x.value])), files: clone(source.files), configRefs: [],
  }
}

function createPod(run, cluster, deployment, replicaSet, ordinal) {
  const state = run.runtime.kubernetes.clusters[cluster.id]
  const template = deployment.spec.template
  const container = template.spec.containers[0]
  const artifactId = run.artifacts.publishedTags[container.image]
  const grant = hasKubeletPull(run.sandbox, cluster, container.image)
  const reason = !grant ? 'RegistryAccessDenied' : !artifactId ? 'ImageNotFound' : null
  const uid = `kube-${run.nextSequence++}`
  const podName = `${deployment.metadata.name}-${hash(template)}-${ordinal}-${uid.slice(5)}`
  const value = {
    apiVersion: 'v1', kind: 'Pod', metadata: { name: podName, namespace: deployment.metadata.namespace, uid, resourceVersion: '1', labels: clone(template.metadata.labels), ownerReferences: [{ uid: replicaSet.metadata.uid, kind: 'ReplicaSet', name: replicaSet.metadata.name }] },
    spec: clone(template.spec), status: reason ? { phase: 'Pending', containerStatuses: [{ name: container.name, state: { waiting: { reason } } }] } : { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
  }
  state.resources[kubeObjectKey('Pod', value.metadata.namespace, podName)] = value
  if (reason) addEvent(state, reason, `Simulated image pull for ${container.image} failed: ${reason}.`)
  else capturePod(run, { ...value, clusterId: cluster.id, template }, artifactId)
  return value
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
  if (pending) { pending.replacementPodUid = replacement.metadata.uid; pending.replacementPodName = replacement.metadata.name; pending.replacementReplicaSetUid = nextOwner?.uid; return }
  state.receipts.push({ cause, deletedPodUid: deleted.metadata.uid, deletedPodName: deleted.metadata.name, deletedReplicaSetUid: deleted.metadata.ownerReferences?.[0]?.uid, replacementPodUid: replacement.metadata.uid, replacementPodName: replacement.metadata.name, replacementReplicaSetUid: nextOwner?.uid })
  if (state.receipts.length > 100) state.receipts.splice(0, state.receipts.length - 100)
}

export function reconcileKubernetes(input, lab) {
  const run = clone(input)
  for (const cluster of run.sandbox.aksClusters ?? []) {
    const state = run.runtime.kubernetes.clusters[cluster.id]
    if (!state) continue
    const deployments = Object.values(state.resources).filter(item => item.kind === 'Deployment')
    for (const deployment of deployments) {
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
      const current = ownedPods.filter(item => item.metadata.ownerReferences?.some(ref => ref.uid === replicaSet.metadata.uid))
      const removed = [...previous, ...current.slice(deployment.spec.replicas)]
      for (const stale of removed) {
        delete state.resources[kubeObjectKey('Pod', stale.metadata.namespace, stale.metadata.name)]
        delete state.podSnapshots[stale.metadata.uid]
      }
      for (const old of Object.values(state.resources).filter(item => item.kind === 'ReplicaSet'
        && item.metadata.namespace === deployment.metadata.namespace && item.metadata.ownerReferences?.some(ref => ref.uid === deployment.metadata.uid)
        && item.metadata.uid !== replicaSet.metadata.uid)) {
        delete state.resources[kubeObjectKey('ReplicaSet', old.metadata.namespace, old.metadata.name)]
      }
      const created = []
      const remaining = current.length - current.slice(deployment.spec.replicas).length
      for (let index = Math.max(0, remaining); index < deployment.spec.replicas; index++) created.push(createPod(run, cluster, deployment, replicaSet, index))
      removed.forEach((old, index) => { if (created[index]) recordReplacement(state, old, created[index]) })
      const deletedReceipts = state.receipts.filter(item => item.replacementPodUid === null)
      for (const receipt of deletedReceipts) {
        const replacement = created.find(item => !state.receipts.some(other => other.replacementPodUid === item.metadata.uid))
        if (!replacement) break
        receipt.replacementPodUid = replacement.metadata.uid
        receipt.replacementPodName = replacement.metadata.name
      }
      if (replicaSet.spec.replicas !== deployment.spec.replicas) {
        replicaSet.spec.replicas = deployment.spec.replicas
        replicaSet.metadata.resourceVersion = String(Number(replicaSet.metadata.resourceVersion) + 1)
      }
    }
  }
  return run
}
