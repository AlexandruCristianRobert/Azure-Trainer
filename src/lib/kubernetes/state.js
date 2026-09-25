import { isJsonValue, isPlainObject } from '../labEngine/run.js'

export function emptyKubernetesRuntime() {
  return { version: 1, currentContext: null, contexts: {}, clusters: {}, requests: [] }
}

export function emptyClusterState(clusterId) {
  const namespace = name => ({ apiVersion: 'v1', kind: 'Namespace', metadata: { name, uid: `${clusterId}/namespace/${name}`, resourceVersion: '1' } })
  return { resources: { 'Namespace//default': namespace('default'), 'Namespace//kube-system': namespace('kube-system'), 'Namespace//kube-public': namespace('kube-public') }, podSnapshots: {}, events: [], receipts: [], projectionDue: {} }
}

export function validateKubernetesRuntime(runtime, run) {
  if (!isPlainObject(runtime) || runtime.version !== 1 || (runtime.currentContext !== null && typeof runtime.currentContext !== 'string')
    || !isPlainObject(runtime.contexts) || !isPlainObject(runtime.clusters) || !Array.isArray(runtime.requests) || runtime.requests.length > 100 || !runtime.requests.every(item => isPlainObject(item)) || !isJsonValue(runtime)) return false
  const clusterIds = new Set((run.sandbox.aksClusters ?? []).map(cluster => cluster.id))
  if (Object.values(runtime.contexts).some(context => !isPlainObject(context) || !clusterIds.has(context.clusterId) || typeof context.namespace !== 'string' || !context.namespace || context.namespace.includes('/'))) return false
  if (runtime.currentContext !== null && !Object.hasOwn(runtime.contexts, runtime.currentContext)) return false
  return Object.keys(runtime.clusters).length === clusterIds.size
    && Object.entries(runtime.clusters).every(([id, state]) => clusterIds.has(id) && validClusterState(state))
}

function validClusterState(state) {
  if (!isPlainObject(state) || !isPlainObject(state.resources) || !isPlainObject(state.podSnapshots)
    || !Array.isArray(state.events) || state.events.length > 300 || !Array.isArray(state.receipts)
    || state.receipts.length > 100 || !isPlainObject(state.projectionDue) || !isJsonValue(state)) return false
  const resources = Object.entries(state.resources)
  const uids = new Set()
  for (const [key, resource] of resources) {
    if (!isPlainObject(resource) || typeof resource.apiVersion !== 'string' || typeof resource.kind !== 'string'
      || !isPlainObject(resource.metadata) || typeof resource.metadata.name !== 'string' || !resource.metadata.name
      || resource.metadata.name.includes('/') || typeof resource.metadata.uid !== 'string' || !resource.metadata.uid
      || typeof resource.metadata.resourceVersion !== 'string' || !/^\d+$/.test(resource.metadata.resourceVersion)) return false
    const namespace = resource.metadata.namespace ?? ''
    if (namespace !== '' && (typeof namespace !== 'string' || !namespace || namespace.includes('/'))) return false
    if (key !== `${resource.kind}/${namespace}/${resource.metadata.name}` || uids.has(resource.metadata.uid)) return false
    uids.add(resource.metadata.uid)
  }
  if (Object.entries(state.podSnapshots).some(([uid, snapshot]) => !uids.has(uid) || !isPlainObject(snapshot)
    || typeof snapshot.artifactId !== 'string' || typeof snapshot.templateHash !== 'string'
    || !isPlainObject(snapshot.environment) || !isPlainObject(snapshot.files) || !Array.isArray(snapshot.configRefs))) return false
  return state.events.every(event => isPlainObject(event)) && state.receipts.every(receipt => isPlainObject(receipt))
    && Object.values(state.projectionDue).every(value => Number.isFinite(value) && value >= 0)
}
