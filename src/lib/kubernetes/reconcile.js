import { kubeObjectKey } from './objects.js'
import { ACR_PULL_ROLE_ID } from '../sandbox/roleAssignments.js'

const clone = value => structuredClone(value)
const labelsMatch = (labels, selector) => Object.entries(selector ?? {}).every(([k, v]) => labels?.[k] === v)
const hash = value => { let n = 5381; for (const c of JSON.stringify(value)) n = ((n << 5) + n) ^ c.charCodeAt(0); return (n >>> 0).toString(16) }

function hasKubeletPull(sandbox, cluster, image) {
  const login = image.split('/')[0].toLowerCase(); const registry = sandbox.containerRegistries.find(r => r.loginServer.toLowerCase() === login)
  return !!registry && sandbox.roleAssignments.some(r => r.scope === registry.id && r.principalId === cluster.identityProfile.kubeletidentity.objectId && r.roleDefinitionId === ACR_PULL_ROLE_ID)
}
function addEvent(state, reason, message) { state.events = [...state.events, { apiVersion: 'v1', kind: 'Event', metadata: { name: `event-${state.events.length + 1}` }, reason, message, simulated: true }].slice(-300) }
function pod(run, cluster, deployment, replicaSet, ordinal) {
  const state = run.runtime.kubernetes.clusters[cluster.id]; const c = deployment.spec.template.spec.containers[0]; const artifactId = run.artifacts.publishedTags[c.image]; const grant = hasKubeletPull(run.sandbox, cluster, c.image); const reason = !grant ? 'RegistryAccessDenied' : !artifactId ? 'ImageNotFound' : null; const uid = `kube-${run.nextSequence++}`; const name = `${deployment.metadata.name}-${hash(deployment.spec.template)}-${ordinal}-${uid.slice(5)}`
  const value = { apiVersion: 'v1', kind: 'Pod', metadata: { name, namespace: deployment.metadata.namespace, uid, resourceVersion: '1', labels: clone(deployment.spec.template.metadata.labels), ownerReferences: [{ uid: replicaSet.metadata.uid, kind: 'ReplicaSet', name: replicaSet.metadata.name }] }, spec: clone(deployment.spec.template.spec), status: reason ? { phase: 'Pending', containerStatuses: [{ state: { waiting: { reason } } }] } : { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] } }
  state.resources[kubeObjectKey('Pod', value.metadata.namespace, name)] = value
  if (reason) addEvent(state, reason, `Simulated image pull for ${c.image} failed: ${reason}.`)
  else { const artifact = run.artifacts.buildsById[artifactId]; state.podSnapshots[uid] = { artifactId, templateHash: hash(deployment.spec.template), environment: Object.fromEntries((c.env ?? []).map(x => [x.name, x.value])), files: clone(run.artifacts.sourceSnapshotsByHash[artifact.sourceHash]?.files ?? {}), configRefs: [] } }
}
export function getDeploymentPods(run, clusterId, namespace, name) { const state = run.runtime.kubernetes.clusters[clusterId]; const d = state?.resources[kubeObjectKey('Deployment', namespace, name)]; return Object.values(state?.resources ?? {}).filter(p => p.kind === 'Pod' && p.metadata.namespace === namespace && p.metadata.ownerReferences?.[0]?.name.startsWith(`${name}-`) && labelsMatch(p.metadata.labels, d?.spec.selector.matchLabels)) }
export function reconcileKubernetes(input, lab) { const run = clone(input); for (const cluster of run.sandbox.aksClusters ?? []) { const state = run.runtime.kubernetes.clusters[cluster.id]; if (!state) continue; for (const deployment of Object.values(state.resources).filter(x => x.kind === 'Deployment')) { const rsName = `${deployment.metadata.name}-${hash(deployment.spec.template)}`; let rs = state.resources[kubeObjectKey('ReplicaSet', deployment.metadata.namespace, rsName)]; if (!rs) { rs = { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name: rsName, namespace: deployment.metadata.namespace, uid: `kube-${run.nextSequence++}`, resourceVersion: '1', ownerReferences: [{ uid: deployment.metadata.uid, kind: 'Deployment', name: deployment.metadata.name }] }, spec: { replicas: deployment.spec.replicas, selector: clone(deployment.spec.selector), template: clone(deployment.spec.template) }, status: {} }; state.resources[kubeObjectKey('ReplicaSet', deployment.metadata.namespace, rsName)] = rs }
      const pods = getDeploymentPods(run, cluster.id, deployment.metadata.namespace, deployment.metadata.name)
      const current = pods.filter(item => item.metadata.ownerReferences?.[0]?.uid === rs.metadata.uid)
      for (const stale of pods.filter(item => item.metadata.ownerReferences?.[0]?.uid !== rs.metadata.uid).concat(current.slice(deployment.spec.replicas))) { delete state.resources[kubeObjectKey('Pod', stale.metadata.namespace, stale.metadata.name)]; delete state.podSnapshots[stale.metadata.uid] }
      while (current.length < deployment.spec.replicas) { pod(run, cluster, deployment, rs, current.length); current.push(true) }
    } }
  return run }
