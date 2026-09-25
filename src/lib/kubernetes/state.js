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
    || !isPlainObject(runtime.contexts) || !isPlainObject(runtime.clusters) || !Array.isArray(runtime.requests) || runtime.requests.length > 100 || !isJsonValue(runtime)) return false
  const ids = new Set((run.sandbox.aksClusters ?? []).map(cluster => cluster.id.toLowerCase()))
  if (Object.values(runtime.contexts).some(context => !isPlainObject(context) || !ids.has(String(context.clusterId).toLowerCase()) || typeof context.namespace !== 'string')) return false
  if (runtime.currentContext !== null && !Object.hasOwn(runtime.contexts, runtime.currentContext)) return false
  return Object.keys(runtime.clusters).length === ids.size && Object.keys(runtime.clusters).every(id => ids.has(id.toLowerCase()))
}
