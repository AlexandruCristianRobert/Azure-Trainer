import { isJsonValue, isPlainObject } from '../labEngine/run.js'
import { validateKubernetesObject } from './schema.js'
import { getProjectManifest } from '../project/manifests.js'
import { projectSourceHash } from '../project/build.js'
import { parsePythonProject } from '../project/python.js'
import { parsePythonDockerfile } from '../project/python-dockerfile.js'
import { CONFIG_INCIDENT_PHASES, CONFIG_TROUBLESHOOTING_IMAGE, CONFIG_TROUBLESHOOTING_CLUSTER_ID, CONFIG_TROUBLESHOOTING_LAB_ID } from '../../data/labs/aks-journey/config-incidents.js'

export function emptyKubernetesRuntime() {
  return { version: 1, currentContext: null, contexts: {}, clusters: {}, requests: [] }
}

export function emptyClusterState(clusterId) {
  const namespace = name => ({ apiVersion: 'v1', kind: 'Namespace', metadata: { name, uid: `${clusterId}/namespace/${name}`, resourceVersion: '1' } })
  return { resources: { 'Namespace//default': namespace('default'), 'Namespace//kube-system': namespace('kube-system'), 'Namespace//kube-public': namespace('kube-public') }, podSnapshots: {}, events: [], receipts: [], projectionDue: {} }
}

export function validateKubernetesRuntime(runtime, run) {
  if (!isPlainObject(runtime) || runtime.version !== 1 || (runtime.currentContext !== null && typeof runtime.currentContext !== 'string')
    || !isPlainObject(runtime.contexts) || !isPlainObject(runtime.clusters) || !Array.isArray(runtime.requests) || runtime.requests.length > 100
    || !runtime.requests.every(item => isPlainObject(item) && typeof item.id === 'string'
      && Number.isSafeInteger(item.sequence) && item.sequence >= 1 && item.sequence < run.nextSequence
      && item.id === `aks-request-${item.sequence}`
      && typeof item.scenarioId === 'string' && Number.isInteger(item.status) && typeof item.namespace === 'string'
      && ((item.request?.method === 'GET' && item.request?.path === '/api/info')
        || (item.request?.method === 'POST' && item.request?.path === '/api/ask' && typeof item.request?.body?.question === 'string'))
      && (item.dependencyTrace === undefined || Array.isArray(item.dependencyTrace)))
    || new Set(runtime.requests.map(item => item.id)).size !== runtime.requests.length
    || new Set(runtime.requests.map(item => item.sequence)).size !== runtime.requests.length || !isJsonValue(runtime)) return false
  if (!validConfigIncident(runtime, run)) return false
  const clusterIds = new Set((run.sandbox.aksClusters ?? []).map(cluster => cluster.id))
  if (Object.values(runtime.contexts).some(context => !isPlainObject(context) || !clusterIds.has(context.clusterId) || !validNamespace(context.namespace))) return false
  if (runtime.currentContext !== null && !Object.hasOwn(runtime.contexts, runtime.currentContext)) return false
  return Object.keys(runtime.clusters).length === clusterIds.size
    && Object.entries(runtime.clusters).every(([id, state]) => clusterIds.has(id) && validClusterState(state, run))
}

function validConfigIncident(runtime, run) {
  const incident = runtime.configIncident
  if (run.labId !== CONFIG_TROUBLESHOOTING_LAB_ID) return incident === undefined
  if (!isPlainObject(incident) || incident.version !== 1 || incident.labId !== CONFIG_TROUBLESHOOTING_LAB_ID
    || Object.keys(incident).sort().join(',') !== 'labId,phase,transitions,version'
    || !Array.isArray(incident.transitions) || incident.transitions.length > 2) return false
  const expectedPhase = ['reference', 'key', 'stale'][incident.transitions.length]
  if (incident.phase !== expectedPhase) return false
  let priorSequence = 0
  for (let index = 0; index < incident.transitions.length; index++) {
    const transition = incident.transitions[index]
    const previous = CONFIG_INCIDENT_PHASES[index]
    const next = CONFIG_INCIDENT_PHASES[index + 1]
    const evidence = run.evidence?.experimentsById?.[transition?.evidenceId]
    if (!isPlainObject(transition) || Object.keys(transition).sort().join(',') !== 'attemptId,evidenceId,from,sequence,to'
      || !Number.isSafeInteger(transition.sequence) || transition.sequence <= priorSequence || transition.sequence >= run.nextSequence
      || transition.from !== previous.phase || transition.to !== next.phase || transition.attemptId !== run.attemptId
      || typeof transition.evidenceId !== 'string' || !evidence || evidence.id !== transition.evidenceId
      || evidence.attemptId !== run.attemptId || evidence.labId !== CONFIG_TROUBLESHOOTING_LAB_ID
      || evidence.taskId !== previous.taskId || evidence.scenarioId !== previous.scenarioId
      || evidence.outcome !== 'passed' || evidence.completed !== true
      || evidence.sequence <= priorSequence || evidence.sequence >= transition.sequence
      || evidence.measurements?.clusterId !== CONFIG_TROUBLESHOOTING_CLUSTER_ID
      || evidence.measurements?.namespace !== 'assistant' || evidence.measurements?.deploymentName !== 'assistant'
      || evidence.measurements?.serviceName !== 'assistant'
      || evidence.measurements?.artifactId !== run.artifacts.publishedTags[CONFIG_TROUBLESHOOTING_IMAGE]) return false
    priorSequence = transition.sequence
  }
  return true
}

function validClusterState(state, run) {
  if (!isPlainObject(state) || !isPlainObject(state.resources) || !isPlainObject(state.podSnapshots)
    || !Array.isArray(state.events) || state.events.length > 300 || !Array.isArray(state.receipts)
    || state.receipts.length > 100 || !isPlainObject(state.projectionDue) || !isJsonValue(state)) return false
  const resources = Object.entries(state.resources)
  const uids = new Set()
  const supportedVersions = { Namespace: 'v1', Deployment: 'apps/v1', Service: 'v1', ConfigMap: 'v1', Secret: 'v1', Node: 'v1', ReplicaSet: 'apps/v1', Pod: 'v1', Event: 'v1', EndpointSlice: 'discovery.k8s.io/v1' }
  for (const [key, resource] of resources) {
    if (!isPlainObject(resource) || typeof resource.apiVersion !== 'string' || typeof resource.kind !== 'string'
      || !isPlainObject(resource.metadata) || typeof resource.metadata.name !== 'string' || !resource.metadata.name
      || resource.metadata.name.includes('/') || typeof resource.metadata.uid !== 'string' || !resource.metadata.uid
      || typeof resource.metadata.resourceVersion !== 'string' || !/^\d+$/.test(resource.metadata.resourceVersion)) return false
    if (!Object.hasOwn(supportedVersions, resource.kind) || resource.apiVersion !== supportedVersions[resource.kind]) return false
    const namespace = resource.metadata.namespace ?? ''
    if (namespace !== '' && (typeof namespace !== 'string' || !namespace || namespace.includes('/'))) return false
    if (['Namespace', 'Node', 'Event'].includes(resource.kind) ? namespace !== '' : !state.resources[`Namespace//${namespace}`]) return false
    if (key !== `${resource.kind}/${namespace}/${resource.metadata.name}` || uids.has(resource.metadata.uid)) return false
    uids.add(resource.metadata.uid)
  }
  const declaredObjects = resources.filter(([, resource]) => ['Namespace', 'Deployment', 'Service', 'ConfigMap', 'Secret'].includes(resource.kind))
  const deployments = declaredObjects.filter(([, resource]) => resource.kind === 'Deployment').map(([, resource]) => resource)
  for (const [, resource] of declaredObjects) {
    const desired = {
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      metadata: { name: resource.metadata.name, ...(resource.metadata.namespace === undefined ? {} : { namespace: resource.metadata.namespace }), ...(resource.metadata.labels === undefined ? {} : { labels: resource.metadata.labels }) },
      ...(resource.spec === undefined ? {} : { spec: resource.kind === 'Service' ? (() => { const { clusterIP, ...spec } = resource.spec; return spec })() : resource.spec }),
      ...(resource.type === undefined ? {} : { type: resource.type }),
      ...(resource.data === undefined ? {} : { data: resource.data }),
    }
    if (validateKubernetesObject(desired, { namespace: resource.metadata.namespace, capabilities: { deployments, kubernetesConfiguration: true } }).diagnostics.length) return false
  }
  const byUid = new Map(resources.map(([, resource]) => [resource.metadata.uid, resource]))
  if (!validConnectivity(state, resources, byUid)) return false
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
    const imageKeyMatches = artifact && `${artifact.image.loginServer}/${artifact.image.repository}:${artifact.image.tag}` === image
    if (!pod || pod.kind !== 'Pod' || pod.status?.phase !== 'Running' || !deployment || deployment.kind !== 'Deployment'
      || !isPlainObject(snapshot) || typeof snapshot.artifactId !== 'string' || typeof snapshot.templateHash !== 'string'
      || !isPlainObject(snapshot.environment) || !Object.values(snapshot.environment).every(value => typeof value === 'string')
      || !isPlainObject(snapshot.files) || !source || !Object.entries(source.files).every(([path, text]) => snapshot.files[path] === text)
      || !validCapturedArtifact(artifact, source, run)
      || !imageKeyMatches || !Array.isArray(snapshot.configRefs)
      || !snapshot.configRefs.every(item => isPlainObject(item) && ['ConfigMap', 'Secret'].includes(item.kind) && typeof item.namespace === 'string' && typeof item.name === 'string' && typeof item.key === 'string' && ['env', 'file'].includes(item.mode) && typeof item.target === 'string')) return false
  }
  for (const [, resource] of resources) {
    if (resource.kind === 'Pod' && resource.status?.phase === 'Running' && !Object.hasOwn(state.podSnapshots, resource.metadata.uid)) return false
    if (resource.kind === 'Pod' && resource.status?.phase !== 'Running' && Object.hasOwn(state.podSnapshots, resource.metadata.uid)) return false
  }
  return state.events.every(event => isPlainObject(event)) && state.receipts.every(receipt => validReceipt(receipt, run))
    && new Set(state.receipts.map(receipt => receipt.sequence)).size === state.receipts.length
    && Object.entries(state.projectionDue).every(([uid, value]) => Object.hasOwn(state.podSnapshots, uid) && Number.isFinite(value) && value >= 0)
}

function validConnectivity(state, resources, byUid) {
  if (state.connectivity === undefined) return !resources.some(([, resource]) => resource.kind === 'EndpointSlice')
  const value = state.connectivity
  if (!isPlainObject(value) || value.version !== 1 || !Number.isInteger(value.nextServiceAddress) || value.nextServiceAddress < 1 || value.nextServiceAddress > 4064
    || !Number.isInteger(value.nextPodAddress) || value.nextPodAddress < 1 || value.nextPodAddress > 4064
    || !Number.isInteger(value.nextExternalAddress) || value.nextExternalAddress < 10 || value.nextExternalAddress > 255
    || !Array.isArray(value.diagnosticPodUids) || new Set(value.diagnosticPodUids).size !== value.diagnosticPodUids.length
    || !value.diagnosticPodUids.every(uid => byUid.get(uid)?.kind === 'Pod') || !Array.isArray(value.applicationLogs) || value.applicationLogs.length > 200 || value.incident !== null) return false
  const addresses = new Set()
  for (const [, resource] of resources) {
    if (resource.kind === 'Service') {
      if (!/^10\.96\.(?:[0-9]|1[0-5])\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(resource.spec?.clusterIP ?? '') || addresses.has(resource.spec.clusterIP)) return false
      addresses.add(resource.spec.clusterIP)
      const external = resource.status?.loadBalancer?.ingress?.[0]?.ip
      if (resource.spec.type === 'LoadBalancer' ? !/^192\.0\.2\.(?:1[0-9]|[2-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(external ?? '') : external !== undefined) return false
      if (external) { if (addresses.has(external)) return false; addresses.add(external) }
    }
    if (resource.kind === 'Pod' && resource.status?.podIP !== undefined) {
      if (!/^10\.244\.(?:[0-9]|1[0-5])\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(resource.status.podIP) || addresses.has(resource.status.podIP)) return false
      addresses.add(resource.status.podIP)
    }
  }
  return resources.filter(([, resource]) => resource.kind === 'EndpointSlice').every(([, slice]) => {
    const owner = slice.metadata.ownerReferences?.[0]; const service = owner && byUid.get(owner.uid)
    if (!service || service.kind !== 'Service' || owner.kind !== 'Service' || owner.name !== service.metadata.name
      || slice.metadata.namespace !== service.metadata.namespace || slice.metadata.labels?.['kubernetes.io/service-name'] !== service.metadata.name
      || slice.addressType !== 'IPv4' || !Array.isArray(slice.ports) || !Array.isArray(slice.endpoints)) return false
    return slice.endpoints.every(endpoint => {
      const pod = byUid.get(endpoint.targetRef?.uid)
      return pod?.kind === 'Pod' && endpoint.targetRef.kind === 'Pod' && endpoint.targetRef.name === pod.metadata.name
        && endpoint.targetRef.namespace === pod.metadata.namespace && Array.isArray(endpoint.addresses) && endpoint.addresses.length === 1
        && endpoint.addresses[0] === pod.status?.podIP && typeof endpoint.conditions?.ready === 'boolean'
    })
  })
}

function validCapturedArtifact(artifact, source, run) {
  const manifest = getProjectManifest(run.project.manifestId)
  if (manifest.language !== 'python' || source.hash !== artifact.sourceHash || projectSourceHash(source.files) !== artifact.sourceHash
    || JSON.stringify(Object.keys(source.files).sort()) !== JSON.stringify([...manifest.buildFiles].sort())) return false
  const app = parsePythonProject(source.files, manifest)
  const docker = parsePythonDockerfile(source.files.Dockerfile, { buildFiles: manifest.buildFiles })
  const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
      : JSON.stringify(value)
  return app.diagnostics.length === 0 && docker.diagnostics.length === 0
    && stable(app.appSpec) === stable(artifact.appSpec) && stable(docker.dockerSpec) === stable(artifact.dockerSpec)
    && artifact.id && artifact.image && typeof artifact.image.registryId === 'string'
    && typeof artifact.image.loginServer === 'string' && typeof artifact.image.repository === 'string' && typeof artifact.image.tag === 'string'
}

function validReceipt(receipt, run) {
  if (!isPlainObject(receipt) || !['pod-delete', 'template'].includes(receipt.cause)
    || !Number.isSafeInteger(receipt.sequence) || receipt.sequence < 1 || receipt.sequence >= run.nextSequence
    || !/^kube-[1-9]\d*$/.test(receipt.deletedPodUid ?? '') || !/^kube-[1-9]\d*$/.test(receipt.deletedReplicaSetUid ?? '')
    || !/^kube-[1-9]\d*$/.test(receipt.replacementPodUid ?? '') || !/^kube-[1-9]\d*$/.test(receipt.replacementReplicaSetUid ?? '')
    || typeof receipt.deletedPodName !== 'string' || typeof receipt.replacementPodName !== 'string'
    || !/^[\da-f]{8}$/.test(receipt.templateHash ?? '') || receipt.replacementTemplateHash !== receipt.templateHash) return false
  const deletedId = Number(receipt.deletedPodUid.slice(5)); const replacementId = Number(receipt.replacementPodUid.slice(5))
  if (deletedId >= replacementId || receipt.sequence !== replacementId || !receipt.deletedPodName.endsWith(`-${deletedId}`)
    || !receipt.replacementPodName.endsWith(`-${replacementId}`)) return false
  return receipt.cause !== 'pod-delete' || receipt.deletedReplicaSetUid === receipt.replacementReplicaSetUid
}

function validNamespace(value) {
  return typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
}
