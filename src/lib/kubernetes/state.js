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
  if (Object.values(runtime.contexts).some(context => !isPlainObject(context) || !clusterIds.has(context.clusterId) || !validNamespace(context.namespace))) return false
  if (runtime.currentContext !== null && !Object.hasOwn(runtime.contexts, runtime.currentContext)) return false
  return Object.keys(runtime.clusters).length === clusterIds.size
    && Object.entries(runtime.clusters).every(([id, state]) => clusterIds.has(id) && validClusterState(state, run))
}

function validClusterState(state, run) {
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
  const byUid = new Map(resources.map(([, resource]) => [resource.metadata.uid, resource]))
  for (const [, resource] of resources) {
    if (resource.kind === 'Pod' || resource.kind === 'ReplicaSet') {
      if (!Array.isArray(resource.metadata.ownerReferences) || resource.metadata.ownerReferences.length !== 1) return false
      const owner = resource.metadata.ownerReferences[0]
      const parent = byUid.get(owner.uid)
      const expectedKind = resource.kind === 'Pod' ? 'ReplicaSet' : 'Deployment'
      if (!parent || parent.kind !== expectedKind || owner.kind !== expectedKind || owner.name !== parent.metadata.name
        || parent.metadata.namespace !== resource.metadata.namespace) return false
      if (resource.kind === 'ReplicaSet') {
        if (!isPlainObject(resource.spec) || !isPlainObject(parent.spec) || JSON.stringify(resource.spec.selector) !== JSON.stringify(parent.spec.selector)
          || JSON.stringify(resource.spec.template) !== JSON.stringify(parent.spec.template)) return false
      } else if (!isPlainObject(parent.spec?.template) || JSON.stringify(resource.spec) !== JSON.stringify(parent.spec.template.spec)
        || JSON.stringify(resource.metadata.labels) !== JSON.stringify(parent.spec.template.metadata.labels)) return false
    }
  }
  if (!['default', 'kube-system', 'kube-public'].every(name => {
    const resource = state.resources[`Namespace//${name}`]
    return resource?.apiVersion === 'v1' && resource.kind === 'Namespace' && resource.metadata?.name === name && resource.metadata.namespace === undefined
  })) return false
  for (const [uid, snapshot] of Object.entries(state.podSnapshots)) {
    const pod = byUid.get(uid)
    const owner = pod?.metadata?.ownerReferences?.[0]
    const replicaSet = owner && byUid.get(owner.uid)
    const deploymentRef = replicaSet?.metadata?.ownerReferences?.[0]
    const deployment = deploymentRef && byUid.get(deploymentRef.uid)
    const image = pod?.spec?.containers?.[0]?.image
    const artifact = run.artifacts.buildsById?.[snapshot?.artifactId]
    const source = artifact && run.artifacts.sourceSnapshotsByHash?.[artifact.sourceHash]
    const environment = Object.fromEntries((pod?.spec?.containers?.[0]?.env ?? []).map(item => [item.name, item.value]))
    const imageKeyMatches = artifact && `${artifact.image.loginServer}/${artifact.image.repository}:${artifact.image.tag}` === image
    if (!pod || pod.kind !== 'Pod' || pod.status?.phase !== 'Running' || !deployment || deployment.kind !== 'Deployment'
      || !isPlainObject(snapshot) || typeof snapshot.artifactId !== 'string' || typeof snapshot.templateHash !== 'string'
      || !isPlainObject(snapshot.environment) || JSON.stringify(snapshot.environment) !== JSON.stringify(environment)
      || !isPlainObject(snapshot.files) || !source || JSON.stringify(snapshot.files) !== JSON.stringify(source.files)
      || !imageKeyMatches || !Array.isArray(snapshot.configRefs)) return false
  }
  for (const [, resource] of resources) {
    if (resource.kind === 'Pod' && resource.status?.phase === 'Running' && !Object.hasOwn(state.podSnapshots, resource.metadata.uid)) return false
    if (resource.kind === 'Pod' && resource.status?.phase !== 'Running' && Object.hasOwn(state.podSnapshots, resource.metadata.uid)) return false
  }
  return state.events.every(event => isPlainObject(event)) && state.receipts.every(receipt => isPlainObject(receipt)
    && typeof receipt.deletedPodUid === 'string' && typeof receipt.deletedPodName === 'string'
    && (receipt.replacementPodUid === null || (typeof receipt.replacementPodUid === 'string' && typeof receipt.replacementPodName === 'string')))
    && Object.values(state.projectionDue).every(value => Number.isFinite(value) && value >= 0)
}

function validNamespace(value) {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
}
