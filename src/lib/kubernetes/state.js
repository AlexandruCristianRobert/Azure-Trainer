import { isJsonValue, isPlainObject } from '../labEngine/run.js'
import { validateKubernetesObject } from './schema.js'
import { getProjectManifest } from '../project/manifests.js'
import { projectSourceHash } from '../project/build.js'
import { parsePythonProject } from '../project/python.js'
import { parsePythonDockerfile } from '../project/python-dockerfile.js'
import { CONFIG_INCIDENT_PHASES, CONFIG_TROUBLESHOOTING_IMAGE, CONFIG_TROUBLESHOOTING_CLUSTER_ID, CONFIG_TROUBLESHOOTING_LAB_ID } from '../../data/labs/aks-journey/config-incidents.js'
import { CONNECTIVITY_INCIDENT_PHASES, CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID, CONNECTIVITY_TROUBLESHOOTING_IMAGE, CONNECTIVITY_TROUBLESHOOTING_LAB_ID } from '../../data/labs/aks-journey/connectivity-troubleshooting-incidents.js'
import { AI_TROUBLESHOOTING_CLUSTER_ID, AI_TROUBLESHOOTING_LAB_ID, INTEGRATION_INCIDENT_PHASES } from '../../data/labs/aks-journey/integration-incidents.js'
import { RESOURCE_FIXTURES } from '../../data/fixtures/aks/resources.js'
import { normalizeContainerResources } from './resource-schema.js'

export function emptyKubernetesRuntime() {
  return { version: 1, currentContext: null, contexts: {}, clusters: {}, requests: [] }
}

export function emptyClusterState(clusterId) {
  const namespace = name => ({ apiVersion: 'v1', kind: 'Namespace', metadata: { name, uid: `${clusterId}/namespace/${name}`, resourceVersion: '1' } })
  return { resources: { 'Namespace//default': namespace('default'), 'Namespace//kube-system': namespace('kube-system'), 'Namespace//kube-public': namespace('kube-public') }, podSnapshots: {}, events: [], receipts: [], projectionDue: {} }
}

export function validateKubernetesRuntime(runtime, run, lab = null) {
  if (!isPlainObject(runtime) || runtime.version !== 1 || (runtime.currentContext !== null && typeof runtime.currentContext !== 'string')
    || !isPlainObject(runtime.contexts) || !isPlainObject(runtime.clusters) || !Array.isArray(runtime.requests) || runtime.requests.length > 100
    || !runtime.requests.every(item => isPlainObject(item) && typeof item.id === 'string'
      && Number.isSafeInteger(item.sequence) && item.sequence >= 1 && item.sequence < run.nextSequence
      && item.id === `aks-request-${item.sequence}` && typeof item.namespace === 'string'
      && (item.connectivity === true
        ? (item.scenarioId === null || typeof item.scenarioId === 'string') && (item.status === null || Number.isInteger(item.status) && item.status >= 100 && item.status <= 599)
          && isPlainObject(item.transport) && typeof item.transport.ok === 'boolean'
          && (item.transport.reason === null || typeof item.transport.reason === 'string') && isPlainObject(item.route)
          && (item.request?.method === 'GET' && ['/api/info', '/api/work'].includes(item.request?.path)
            || item.request?.method === 'POST' && item.request?.path === '/api/ask' && typeof item.request?.body?.question === 'string')
        : typeof item.scenarioId === 'string' && Number.isInteger(item.status)
          && ((item.request?.method === 'GET' && ['/api/info', '/api/work'].includes(item.request?.path))
            || (item.request?.method === 'POST' && item.request?.path === '/api/ask' && typeof item.request?.body?.question === 'string')))
      && (item.dependencyTrace === undefined || Array.isArray(item.dependencyTrace))
      && (item.integrationTrace === undefined || item.integrationTrace === null || validIntegrationTrace(item.integrationTrace))
      && (item.workload === undefined || validWorkloadRequest(item, run)))
    || new Set(runtime.requests.map(item => item.id)).size !== runtime.requests.length
    || new Set(runtime.requests.map(item => item.sequence)).size !== runtime.requests.length || !isJsonValue(runtime)) return false
  if (!validConfigIncident(runtime, run)) return false
  if (!validIntegrationIncident(runtime, run)) return false
  const clusterIds = new Set((run.sandbox.aksClusters ?? []).map(cluster => cluster.id))
  if (Object.values(runtime.contexts).some(context => !isPlainObject(context) || !clusterIds.has(context.clusterId) || !validNamespace(context.namespace))) return false
  if (runtime.currentContext !== null && !Object.hasOwn(runtime.contexts, runtime.currentContext)) return false
  return Object.keys(runtime.clusters).length === clusterIds.size
    && Object.entries(runtime.clusters).every(([id, state]) => clusterIds.has(id) && validClusterState(state, run, lab, id))
}

function validIntegrationIncident(runtime, run) {
  const incident = runtime.integrationIncident
  if (run.labId !== AI_TROUBLESHOOTING_LAB_ID) return incident === undefined
  if (incident === undefined && Object.keys(runtime.clusters).length === 0) return true
  if (!isPlainObject(incident) || Object.keys(incident).sort().join(',') !== 'labId,phase,transitions,version' || incident.version !== 1 || incident.labId !== AI_TROUBLESHOOTING_LAB_ID || !Array.isArray(incident.transitions) || incident.transitions.length > 2) return false
  const expected = INTEGRATION_INCIDENT_PHASES[incident.transitions.length]?.phase
  if (incident.phase !== expected) return false
  const deploymentUid = runtime.clusters?.[AI_TROUBLESHOOTING_CLUSTER_ID]?.resources?.['Deployment/assistant/assistant']?.metadata?.uid
  let prior = 0
  for (let index = 0; index < incident.transitions.length; index++) {
    const transition = incident.transitions[index]; const phase = INTEGRATION_INCIDENT_PHASES[index]; const evidence = run.evidence?.experimentsById?.[transition?.evidenceId]
    if (!isPlainObject(transition) || Object.keys(transition).sort().join(',') !== 'deploymentUid,evidenceId,from,sequence,to' || transition.from !== phase.phase || transition.to !== phase.next || !Number.isSafeInteger(transition.sequence) || transition.sequence <= prior || transition.sequence >= run.nextSequence || typeof transition.deploymentUid !== 'string' || transition.deploymentUid !== deploymentUid || typeof transition.evidenceId !== 'string' || !evidence || evidence.id !== transition.evidenceId || evidence.attemptId !== run.attemptId || evidence.labId !== AI_TROUBLESHOOTING_LAB_ID || evidence.taskId !== phase.recoveryTask || evidence.scenarioId !== phase.recoveryScenario || evidence.outcome !== 'passed' || evidence.completed !== true || evidence.sequence >= transition.sequence || evidence.measurements?.deploymentUid !== transition.deploymentUid || evidence.measurements?.clusterId !== AI_TROUBLESHOOTING_CLUSTER_ID) return false
    prior = transition.sequence
  }
  return true
}

function validIntegrationTrace(trace) {
  const safeBindingKeys = new Set(['collection', 'audience', 'published', 'vector', 'cutoff', 'limit'])
  const profileIds = new Set(['healthy', 'embedding-throttle-once', 'postgres-unavailable-once', 'answer-unavailable-always', 'answer-wait-150ms', 'embedding-timeout-always', 'retry-after-too-long'])
  const validAttempt = attempt => isPlainObject(attempt) && Object.keys(attempt).every(key => ['operation', 'attemptNumber', 'startMs', 'durationMs', 'timeoutMs', 'errorCode', 'delayBeforeNextMs'].includes(key))
    && typeof attempt.operation === 'string' && ['embedding', 'postgres-query', 'answer'].includes(attempt.operation)
    && Number.isInteger(attempt.attemptNumber) && attempt.attemptNumber >= 1 && attempt.attemptNumber <= 3
    && ['startMs', 'durationMs', 'timeoutMs', 'delayBeforeNextMs'].every(key => Number.isFinite(attempt[key]) && attempt[key] >= 0 && attempt[key] <= 5000)
    && (attempt.errorCode === null || typeof attempt.errorCode === 'string')
  const safeText = value => typeof value === 'string' && value.length <= 128
    && !/[a-z][a-z+.-]*:\/\/[^/\s]*?(?::[^@/\s]+)?@/i.test(value)
  const validVector = value => {
    if (typeof value !== 'string' || !/^\[\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)*\s*\]$/.test(value)) return false
    const components = value.slice(1, -1).split(',').map(item => Number(item.trim()))
    return components.length === 3 && components.every(Number.isFinite) && !components.every(component => component === 0)
  }
  const safeBindings = value => isPlainObject(value) && Object.entries(value).every(([key, item]) => {
    if (!safeBindingKeys.has(key)) return false
    if (item === '[redacted]') return true
    if (key === 'collection' || key === 'audience') return safeText(item)
    if (key === 'published') return typeof item === 'boolean'
    if (key === 'vector') return validVector(item)
    if (key === 'cutoff') return Number.isFinite(item) && item >= 0 && item <= 2
    return Number.isInteger(item) && item >= 1 && item <= 3
  })
  return isPlainObject(trace) && trace.version === 1 && Object.keys(trace).every(key => ['version', 'graphHash', 'queryHash', 'fixtureVersion', 'profileId', 'inputDisposition', 'vectorProvenance', 'queryBindings', 'selectedIds', 'rankedDistances', 'contextIds', 'sourceProvenance', 'elapsedMs', 'attempts'].includes(key))
    && typeof trace.graphHash === 'string' && typeof trace.queryHash === 'string' && Number.isInteger(trace.fixtureVersion)
    && profileIds.has(trace.profileId) && ['accepted', 'rejected'].includes(trace.inputDisposition)
    && (trace.vectorProvenance === null || typeof trace.vectorProvenance === 'string')
    && (trace.sourceProvenance === null || typeof trace.sourceProvenance === 'string')
    && (trace.queryBindings === null || safeBindings(trace.queryBindings))
    && Array.isArray(trace.selectedIds) && trace.selectedIds.every(value => typeof value === 'string')
    && Array.isArray(trace.rankedDistances) && trace.rankedDistances.length <= 3
    && trace.rankedDistances.every(item => isPlainObject(item) && Object.keys(item).every(key => ['id', 'distance'].includes(key))
      && typeof item.id === 'string' && item.id.length <= 96 && Number.isFinite(item.distance) && item.distance >= 0 && item.distance <= 2)
    && trace.rankedDistances.length === trace.selectedIds.length && trace.rankedDistances.every((item, index) => item.id === trace.selectedIds[index])
    && Array.isArray(trace.contextIds) && trace.contextIds.every(value => typeof value === 'string')
    && Number.isFinite(trace.elapsedMs) && trace.elapsedMs >= 0 && trace.elapsedMs <= 5000
    && Array.isArray(trace.attempts) && trace.attempts.length <= 9 && trace.attempts.every(validAttempt)
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

function validClusterState(state, run, lab, clusterId) {
  const connectivityEnabled = lab?.capabilities?.kubernetesConnectivity === true
  const probesEnabled = lab?.capabilities?.kubernetesProbes === true
  const resourcesEnabled = lab?.capabilities?.kubernetesResources === true
  if (!isPlainObject(state) || !isPlainObject(state.resources) || !isPlainObject(state.podSnapshots)
    || !Array.isArray(state.events) || state.events.length > 300 || !Array.isArray(state.receipts)
    || state.receipts.length > 100 || !isPlainObject(state.projectionDue) || !isJsonValue(state)) return false
  if (resourcesEnabled && !validResourceRuntime(state, run, lab, clusterId)) return false
  if (!resourcesEnabled && (state.resourcesRuntime !== undefined || state.applyOwnership !== undefined)) return false
  if (probesEnabled && (!isPlainObject(state.health) || state.health.version !== 1 || !isPlainObject(state.health.containers)
    || (state.health.experiment !== null && !isPlainObject(state.health.experiment)) || !Array.isArray(state.health.receipts) || state.health.receipts.length > 40
    || !Array.isArray(state.health.events) || state.health.events.length > 1000)) return false
  if (!probesEnabled && state.health !== undefined) return false
  const resources = Object.entries(state.resources)
  const uids = new Set()
  const supportedVersions = { Namespace: 'v1', Deployment: 'apps/v1', Service: 'v1', ConfigMap: 'v1', Secret: 'v1', HorizontalPodAutoscaler: 'autoscaling/v2', Node: 'v1', ReplicaSet: 'apps/v1', Pod: 'v1', Event: 'v1', EndpointSlice: 'discovery.k8s.io/v1' }
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
  const declaredObjects = resources.filter(([, resource]) => ['Namespace', 'Deployment', 'Service', 'ConfigMap', 'Secret', 'HorizontalPodAutoscaler'].includes(resource.kind))
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
    if (validateKubernetesObject(desired, { namespace: resource.metadata.namespace, capabilities: { deployments: [...deployments, ...declaredObjects.filter(([, item]) => item.kind === 'HorizontalPodAutoscaler').map(([, item]) => item)], kubernetesConfiguration: true, ...(probesEnabled ? { kubernetesProbes: true } : {}), ...(resourcesEnabled ? { kubernetesResources: true } : {}) } }).diagnostics.length) return false
  }
  const byUid = new Map(resources.map(([, resource]) => [resource.metadata.uid, resource]))
  if (resourcesEnabled && !validResourceAssignments(state.resourcesRuntime, byUid)) return false
  if (probesEnabled && !validHealthState(state.health, byUid, run.runtime.simTimeMs, lab, clusterId)) return false
  if (!validConnectivity(state, resources, byUid, run, connectivityEnabled, clusterId, lab)) return false
  for (const [, resource] of resources) {
    if (resource.kind === 'Pod' || resource.kind === 'ReplicaSet') {
      if (resource.kind === 'Pod' && state.connectivity?.diagnosticPodUids.includes(resource.metadata.uid)) continue
      if (!Array.isArray(resource.metadata.ownerReferences) || resource.metadata.ownerReferences.length !== 1) return false
      const owner = resource.metadata.ownerReferences[0]
      const parent = byUid.get(owner.uid)
      const expectedKind = resource.kind === 'Pod' ? 'ReplicaSet' : 'Deployment'
      if (!parent || parent.kind !== expectedKind || owner.kind !== expectedKind || owner.name !== parent.metadata.name
        || parent.metadata.namespace !== resource.metadata.namespace) return false
      if (resource.kind === 'ReplicaSet') {
        if (!isPlainObject(resource.spec) || !isPlainObject(parent.spec) || JSON.stringify(resource.spec.selector) !== JSON.stringify(parent.spec.selector)
          || JSON.stringify(resource.spec.template) !== JSON.stringify(parent.spec.template)) return false
      } else if (!isPlainObject(parent.spec?.template) || JSON.stringify((({ nodeName, ...spec }) => spec)(resource.spec)) !== JSON.stringify(parent.spec.template.spec)
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
    if (resource.kind === 'Pod' && resource.status?.phase === 'Running' && !Object.hasOwn(state.podSnapshots, resource.metadata.uid)
      && !state.connectivity?.diagnosticPodUids.includes(resource.metadata.uid)) return false
    if (resource.kind === 'Pod' && resource.status?.phase !== 'Running' && Object.hasOwn(state.podSnapshots, resource.metadata.uid)) return false
  }
  return state.events.every(event => isPlainObject(event)) && state.receipts.every(receipt => validReceipt(receipt, run))
    && new Set(state.receipts.map(receipt => receipt.sequence)).size === state.receipts.length
    && Object.entries(state.projectionDue).every(([uid, value]) => Object.hasOwn(state.podSnapshots, uid) && Number.isFinite(value) && value >= 0)
}

function validWorkloadRequest(item, run) {
  const workload = item.workload
  const artifact = run.artifacts.buildsById?.[item.route?.artifactId]
  const captured = artifact?.appSpec?.workload
  if (item.request?.method !== 'GET' || item.request?.path !== '/api/work' || item.status !== 200
    || !isPlainObject(workload) || Object.keys(workload).sort().join(',') !== 'checksum,cpuM,operation,scratchMiB,units'
    || workload.operation !== 'process_batch' || !Number.isInteger(workload.units) || !Number.isInteger(workload.scratchMiB)
    || !Number.isInteger(workload.checksum) || workload.cpuM !== workload.units
    || workload.units < 1 || workload.units > 100 || workload.scratchMiB < 1 || workload.scratchMiB > 512) return false
  let checksum = 0
  for (let index = 0; index < workload.units; index++) checksum = (checksum + index * 17) % 1_000_003
  return workload.checksum === checksum && captured?.operation === workload.operation
    && captured.units === workload.units && captured.scratchMiB === workload.scratchMiB
}

function validResourceRuntime(state, run, lab, clusterId) {
  const value = state.resourcesRuntime
  if (!isPlainObject(value) || value.version !== 1 || !isPlainObject(value.nodes) || !isPlainObject(value.assignments)
    || !isPlainObject(value.usage) || !isPlainObject(value.metrics) || !isPlainObject(value.hpa) || !isPlainObject(value.terminationDue)
    || !Array.isArray(value.receipts) || value.receipts.length > 40 || value.incident !== null
    || !(value.accountedUntilMs === null || Number.isSafeInteger(value.accountedUntilMs) && value.accountedUntilMs >= 0 && value.accountedUntilMs <= run.runtime.simTimeMs)
    || !value.receipts.every(item => isPlainObject(item) && (item.kind === 'container-termination' && typeof item.podUid === 'string'
      && /^container-\d+$/.test(item.containerId ?? '') && item.reason === 'OOMKilled' && item.exitCode === 137
      && Number.isFinite(item.atMs) && item.atMs >= 0 && item.atMs <= run.runtime.simTimeMs
      || item.kind === 'hpa-scale' && typeof item.controllerUid === 'string' && Number.isFinite(item.atMs) && item.atMs >= 0 && item.atMs <= run.runtime.simTimeMs && Number.isInteger(item.from) && Number.isInteger(item.to) && item.from >= 1 && item.from <= 6 && item.to >= 1 && item.to <= 6 && item.cause === 'hpa'
      || item.kind === 'resource-experiment' && typeof item.profileId === 'string' && ['complete', 'cancelled'].includes(item.phase)
        && (item.phase === 'complete' ? ['passed', 'failed'].includes(item.outcome) : item.outcome === 'cancelled')
        && Number.isSafeInteger(item.startedAtMs) && Number.isSafeInteger(item.endedAtMs)
        && item.endedAtMs >= item.startedAtMs && item.endedAtMs <= run.runtime.simTimeMs && typeof item.deploymentUid === 'string'
        && (item.hpaUid === null || typeof item.hpaUid === 'string') && Array.isArray(item.samples) && item.samples.length <= 8))) return false
  if (JSON.stringify(value.nodes) !== JSON.stringify(RESOURCE_FIXTURES.nodes)) return false
  if (value.experiment !== null && !validResourceExperiment(value.experiment, state, value, lab, clusterId, run.runtime.simTimeMs)) return false
  if (!Object.entries(value.usage).every(([uid, usage]) => validResourceUsage(uid, usage, state, run))) return false
  if (!Object.entries(value.metrics).every(([uid, samples]) => typeof uid === 'string' && Array.isArray(samples) && samples.length <= 40
    && samples.every(item => isPlainObject(item) && /^container-\d+$/.test(item.containerId ?? '') && Number.isSafeInteger(item.windowStartMs)
      && Number.isSafeInteger(item.windowEndMs) && item.windowEndMs - item.windowStartMs === 15_000 && item.windowEndMs % 15_000 === 0
      && Number.isFinite(item.cpuAverageM) && item.cpuAverageM >= 0 && item.cpuAverageM <= 4000 && item.windowEndMs <= run.runtime.simTimeMs
      && Number.isSafeInteger(item.memoryPeakBytes) && item.memoryPeakBytes >= 0 && item.memoryPeakBytes <= 16 * 1024 * 1024 * 1024
      && Number.isSafeInteger(item.readySinceMs) && item.readySinceMs >= 0 && item.readySinceMs <= item.windowStartMs))) return false
  if (!Object.entries(value.hpa).every(([uid, controller]) => {
    const hpa = Object.values(state.resources).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.uid === uid)
    return !!hpa && isPlainObject(controller) && Number.isInteger(controller.policyGeneration) && controller.policyGeneration >= 1
      && Number.isInteger(controller.nextSyncMs) && controller.nextSyncMs >= 0 && (controller.lastSyncMs === null || Number.isInteger(controller.lastSyncMs) && controller.lastSyncMs >= 0)
      && Array.isArray(controller.recommendations) && controller.recommendations.length <= 22
      && controller.recommendations.every(item => isPlainObject(item) && Number.isInteger(item.atMs) && Number.isInteger(item.replicas) && item.replicas >= 1 && item.replicas <= 6)
      && (controller.lastDecision === null || isPlainObject(controller.lastDecision) && typeof controller.lastDecision.reason === 'string'
        && [controller.lastDecision.rawDesired, controller.lastDecision.adjustedDesired, controller.lastDecision.stabilizedDesired, controller.lastDecision.observedUtilization, controller.lastDecision.beforeStabilization].every(item => item === null || Number.isFinite(item))
        && typeof controller.lastDecision.missingSamples === 'boolean' && typeof controller.lastDecision.unreadySamples === 'boolean' && Number.isInteger(controller.lastDecision.atMs))
  })) return false
  return Object.entries(value.terminationDue).every(([uid, atMs]) => {
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === uid)
    return typeof uid === 'string' && Number.isFinite(atMs) && atMs >= 0 && pod?.metadata.deletionTimestamp !== undefined
  })
    && (!state.applyOwnership || isPlainObject(state.applyOwnership) && Object.values(state.applyOwnership).every(item => isPlainObject(item) && typeof item.replicas === 'boolean'))
}

function validResourceExperiment(experiment, state, runtime, lab, clusterId, nowMs) {
  const target = experiment?.target
  const deployment = target && state.resources?.[`Deployment/${target.namespace}/${target.deploymentName}`]
  const scenario = lab?.scenarios?.[experiment?.scenarioId]
  const totals = experiment?.totals
  return isPlainObject(experiment) && experiment.version === 1 && typeof experiment.profileId === 'string'
    && experiment.clusterId === clusterId && experiment.scenarioId && scenario?.kind === 'aks-resource-profile' && scenario.version === 1
    && scenario.requiredReadyReplicas === experiment.requiredReadyReplicas
    && scenario.profileId === experiment.profileId
    && ['manual-work', 'guided-cycle', 'ai-wait', 'independent-cycle', 'test-local-work', 'test-ai-wait'].includes(experiment.profileId)
    && scenario.target?.clusterId === clusterId && scenario.target?.namespace === target?.namespace && scenario.target?.deploymentName === target?.deploymentName
    && target && Object.keys(target).sort().join(',') === 'deploymentName,namespace'
    && (deployment?.kind === 'Deployment' || ['complete', 'cancelled'].includes(experiment.phase)) && ['warming', 'running', 'complete', 'unsupported', 'cancelled'].includes(experiment.phase)
    && Number.isSafeInteger(experiment.startedAtMs) && experiment.startedAtMs >= 0 && experiment.startedAtMs <= nowMs
    && Number.isSafeInteger(experiment.warmupDeadlineMs) && experiment.warmupDeadlineMs === experiment.startedAtMs + 360_000
    && (experiment.phaseZeroAtMs === null || Number.isSafeInteger(experiment.phaseZeroAtMs) && experiment.phaseZeroAtMs >= experiment.startedAtMs && experiment.phaseZeroAtMs <= nowMs)
    && Number.isInteger(experiment.requiredReadyReplicas) && experiment.requiredReadyReplicas >= 1 && experiment.requiredReadyReplicas <= 6
    && Number.isSafeInteger(experiment.atMs) && experiment.atMs >= experiment.startedAtMs && experiment.atMs <= nowMs
    && isPlainObject(experiment.fingerprint) && isPlainObject(experiment.historicalFingerprint)
    && Array.isArray(experiment.routeSamples) && experiment.routeSamples.length <= 12
    && Array.isArray(experiment.observations) && experiment.observations.length <= 700
    && experiment.observations.every(item => isPlainObject(item) && Number.isSafeInteger(item.atMs) && Number.isInteger(item.second)
      && item.second >= 0 && Number.isFinite(item.arrivals) && item.arrivals >= 0 && Number.isFinite(item.completed) && item.completed >= 0
      && Number.isFinite(item.remaining) && item.remaining >= 0 && Number.isInteger(item.readyReplicas) && item.readyReplicas >= 0 && Array.isArray(item.pods))
    && Array.isArray(experiment.boundaryKeys) && experiment.boundaryKeys.length <= 20 && new Set(experiment.boundaryKeys).size === experiment.boundaryKeys.length
    && (experiment.baselineReplicas === null || Number.isInteger(experiment.baselineReplicas) && experiment.baselineReplicas >= 1 && experiment.baselineReplicas <= 6)
    && Number.isFinite(experiment.overflowBacklog) && experiment.overflowBacklog >= 0
    && isPlainObject(totals) && ['arrivals', 'completed', 'remaining', 'peakBacklog'].every(key => Number.isFinite(totals[key]) && totals[key] >= 0)
    && totals.completed <= totals.arrivals && totals.peakBacklog >= totals.remaining
    && (experiment.unsupported === null || ['UNSUPPORTED_NODE_MEMORY_PRESSURE', 'RESOURCE_WARMUP_TIMEOUT'].includes(experiment.unsupported)
      && ['unsupported', 'complete'].includes(experiment.phase))
    && (experiment.phase === 'warming' || experiment.phase === 'complete' && experiment.unsupported === 'RESOURCE_WARMUP_TIMEOUT'
      || experiment.phase === 'cancelled' && experiment.phaseZeroAtMs === null
      ? experiment.phaseZeroAtMs === null : Number.isSafeInteger(experiment.phaseZeroAtMs))
}

function validResourceUsage(uid, usage, state, run) {
  const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === uid)
  const container = state.health?.containers?.[uid]
  const artifact = run.artifacts.buildsById?.[state.podSnapshots?.[uid]?.artifactId]
  const window = usage?.window
  return !!pod && !!container && !!state.resourcesRuntime.assignments[uid] && isPlainObject(usage)
    && usage.containerId === container.containerId && usage.workloadDigest === artifact?.appSpec?.workload?.helperDigest
    && ['cpuDemandM', 'cpuDeliveredM', 'cpuThrottledM', 'memoryBytes', 'backlog'].every(key => Number.isFinite(usage[key]) && usage[key] >= 0 && usage[key] <= 1e9)
    && usage.memoryBytes <= 16 * 1024 * 1024 * 1024
    && ['cpuDemandTotalM', 'cpuDeliveredTotalM', 'cpuThrottledTotalM'].every(key => Number.isFinite(usage[key]) && usage[key] >= 0 && usage[key] <= 1e12)
    && Number.isSafeInteger(usage.lastAccountedAtMs) && usage.lastAccountedAtMs >= 0 && usage.lastAccountedAtMs <= run.runtime.simTimeMs
    && (usage.readySinceMs === null || Number.isSafeInteger(usage.readySinceMs) && usage.readySinceMs >= 0)
    && (window === null || isPlainObject(window) && window.containerId === container.containerId
      && Number.isSafeInteger(window.windowStartMs) && window.windowStartMs >= 0 && window.windowStartMs % 15_000 === 0
      && window.windowEndMs === window.windowStartMs + 15_000 && window.windowEndMs > run.runtime.simTimeMs && window.windowEndMs <= run.runtime.simTimeMs + 15_000
      && Number.isFinite(window.cpuTotalM) && window.cpuTotalM >= 0 && window.cpuTotalM <= 60_000
      && Number.isFinite(window.memoryPeakBytes) && window.memoryPeakBytes >= 0 && Number.isInteger(window.readySeconds)
      && window.readySeconds >= 0 && window.readySeconds <= 15
      && (window.readySinceMs === null || Number.isSafeInteger(window.readySinceMs) && window.readySinceMs >= 0))
    && (usage.routedWorkCpuM === undefined || Number.isFinite(usage.routedWorkCpuM) && usage.routedWorkCpuM >= 0)
}

function validResourceAssignments(runtime, byUid) {
  if (!Object.entries(runtime.assignments).every(([uid, assignment]) => {
    const pod = byUid.get(uid); const effective = normalizeContainerResources(pod?.spec?.containers?.[0]?.resources ?? {}).effective
    return pod?.kind === 'Pod' && (pod.metadata.deletionTimestamp === undefined || Number.isFinite(runtime.terminationDue?.[uid])) && pod.spec?.nodeName === assignment?.nodeName
      && Object.hasOwn(runtime.nodes, assignment.nodeName) && Number.isInteger(assignment.cpuRequestM) && Number.isInteger(assignment.memoryRequestBytes)
      && assignment.cpuRequestM === (effective.cpuRequestM ?? 0) && assignment.memoryRequestBytes === (effective.memoryRequestBytes ?? 0)
  })) return false
  if (![...byUid.values()].filter(pod => pod.kind === 'Pod' && !pod.metadata.uid.startsWith('diagnostic/') && (pod.spec?.nodeName || pod.status?.phase === 'Running')).every(pod => typeof pod.spec?.nodeName === 'string' && Object.hasOwn(runtime.assignments, pod.metadata.uid))) return false
  return Object.entries(runtime.nodes).every(([name, node]) => {
    const used = Object.values(runtime.assignments).filter(item => item.nodeName === name).reduce((sum, item) => ({ cpu: sum.cpu + item.cpuRequestM, memory: sum.memory + item.memoryRequestBytes }), { cpu: 0, memory: 0 })
    return used.cpu <= node.allocatableCpuM - node.fixedCpuM && used.memory <= node.allocatableMemoryBytes - node.fixedMemoryBytes
  })
}

function validProbeFacts(facts, experiment, nowMs) {
  if (facts === undefined) return true
  const observedAt = value => value === null || Number.isFinite(value) && value >= experiment.startedAtMs && value <= nowMs
  return isPlainObject(facts) && observedAt(facts.firstStartupSuccessAt) && typeof facts.earlyGatedCheck === 'boolean'
    && observedAt(facts.livenessTimeoutAt ?? null)
    && isPlainObject(facts.readiness) && Object.entries(facts.readiness).every(([uid, value]) => experiment.podUids.includes(uid)
      && isPlainObject(value) && observedAt(value.withdrawnAt) && observedAt(value.reenteredAt))
    && Array.isArray(facts.restartSchedules) && facts.restartSchedules.length <= 8
    && facts.restartSchedules.every(item => isPlainObject(item) && experiment.podUids.includes(item.podUid)
      && ['startup', 'liveness'].includes(item.probeType) && item.atMs !== null && observedAt(item.atMs)
      && Number.isFinite(item.terminatedAtMs) && item.terminatedAtMs >= item.atMs
      && Number.isFinite(item.restartAtMs) && item.restartAtMs > item.terminatedAtMs)
}

function validHealthState(health, byUid, nowMs, lab, clusterId) {
  if (!health.events.every(item => isPlainObject(item) && typeof item.type === 'string'
    && Number.isFinite(item.atMs) && item.atMs >= 0 && item.atMs <= nowMs)) return false
  const experiment = health.experiment
  if (experiment !== null) {
    const scenario = lab.scenarios?.[experiment.scenarioId]
    if (!scenario || scenario.kind !== 'aks-probe' || scenario.version !== experiment.scenarioVersion
      || experiment.version !== 1 || experiment.status !== 'active' || experiment.clusterId !== clusterId
      || JSON.stringify(experiment.target) !== JSON.stringify(scenario.target)
      || JSON.stringify(experiment.script) !== JSON.stringify({ ...scenario.script, kind: experiment.scenarioId })
      || !Number.isFinite(experiment.startedAtMs) || experiment.startedAtMs < 0 || experiment.startedAtMs > nowMs
      || !Number.isFinite(experiment.endsAtMs) || experiment.endsAtMs < experiment.startedAtMs
      || experiment.endsAtMs > experiment.startedAtMs + 390_000
      || (experiment.baselineReadyAtMs !== null && (!Number.isFinite(experiment.baselineReadyAtMs)
        || experiment.baselineReadyAtMs < experiment.startedAtMs || experiment.baselineReadyAtMs > nowMs))
      || !Array.isArray(experiment.podUids) || experiment.podUids.length !== 2
      || new Set(experiment.podUids).size !== 2
      || !experiment.podUids.every(uid => byUid.get(uid)?.kind === 'Pod' && Object.hasOwn(health.containers, uid))
      || !isPlainObject(experiment.containerIds) || Object.keys(experiment.containerIds).sort().join(',') !== [...experiment.podUids].sort().join(',')
      || !Array.isArray(experiment.samples) || experiment.samples.length > 100
      || !experiment.samples.every(item => isPlainObject(item) && Number.isFinite(item.atMs)
        && item.atMs >= experiment.startedAtMs && item.atMs <= nowMs)
      || !isPlainObject(experiment.summary) || experiment.summary.sampleCount !== experiment.samples.length
      || !Array.isArray(experiment.summary.restartReceipts) || experiment.summary.restartReceipts.length > 40
      || !validProbeFacts(experiment.summary.facts, experiment, nowMs)) return false
  }
  const ids = new Set()
  const managedRunning = [...byUid.values()].filter(pod => pod.kind === 'Pod' && pod.status?.phase === 'Running' && pod.metadata.ownerReferences?.[0])
  return managedRunning.every(pod => Object.hasOwn(health.containers, pod.metadata.uid)) && Object.entries(health.containers).every(([uid, value]) => {
    const pod = byUid.get(uid)
    if (!pod || pod.kind !== 'Pod' || pod.status?.phase !== 'Running' || !isPlainObject(value)
      || typeof value.containerId !== 'string' || !value.containerId || ids.has(value.containerId)
      || !Number.isFinite(value.startedAtMs) || value.startedAtMs < 0 || value.startedAtMs > nowMs
      || !Number.isFinite(value.initializedAtMs) || value.initializedAtMs < value.startedAtMs
      || typeof value.startupPassed !== 'boolean' || typeof value.ready !== 'boolean'
      || !Number.isInteger(value.restartCount) || value.restartCount < 0
      || !Number.isInteger(value.consecutiveRestarts) || value.consecutiveRestarts < 0 || value.consecutiveRestarts > value.restartCount
      || (value.restartAtMs !== null && (!Number.isFinite(value.restartAtMs) || value.restartAtMs < nowMs && !value.restartBlockReason))
      || (value.terminatedAtMs !== null && (!Number.isFinite(value.terminatedAtMs) || value.terminatedAtMs < nowMs))
      || (value.restartAtMs !== null && value.terminatedAtMs !== null && value.restartAtMs <= value.terminatedAtMs)
      || !isPlainObject(value.localFaults) || typeof value.localFaults.admissionClosed !== 'boolean' || typeof value.localFaults.hung !== 'boolean'
      || !isPlainObject(value.checks) || !Array.isArray(value.currentLogs) || value.currentLogs.length > 100
      || !value.currentLogs.every(line => typeof line === 'string' && line.length <= 4096)
      || (value.previous !== null && (!isPlainObject(value.previous) || typeof value.previous.containerId !== 'string'
        || !Array.isArray(value.previous.logs) || value.previous.logs.length > 100
        || !value.previous.logs.every(line => typeof line === 'string' && line.length <= 4096)
        || !['StartupProbeFailed', 'LivenessProbeFailed', 'OOMKilled'].includes(value.previous.reason)
        || value.previous.reason === 'OOMKilled' && value.previous.exitCode !== 137))) return false
    ids.add(value.containerId)
    return ['startup', 'readiness', 'liveness'].every(type => {
      const probe = pod.spec.containers[0]?.[`${type}Probe`]
      const check = value.checks[type]
      if (!!probe !== !!check) return false
      return check === null || isPlainObject(check)
      && Number.isInteger(value.checks[type].successes) && value.checks[type].successes >= 0
      && Number.isInteger(value.checks[type].failures) && value.checks[type].failures >= 0
      && (value.checks[type].nextAtMs === null || Number.isFinite(value.checks[type].nextAtMs))
      && (value.checks[type].pending === null || isPlainObject(value.checks[type].pending)
        && value.checks[type].pending.containerId === value.containerId && Number.isFinite(value.checks[type].pending.startedAtMs)
        && Number.isFinite(value.checks[type].pending.completeAtMs) && value.checks[type].pending.completeAtMs >= value.checks[type].pending.startedAtMs)
    })
  })
}

function validConnectivity(state, resources, byUid, run, connectivityEnabled, clusterId, lab) {
  if (!connectivityEnabled) return state.connectivity === undefined && !resources.some(([, resource]) => resource.kind === 'EndpointSlice')
  if (state.connectivity === undefined) return false
  const value = state.connectivity
  if (!isPlainObject(value) || value.version !== 1 || !Number.isInteger(value.nextServiceAddress) || value.nextServiceAddress < 1 || value.nextServiceAddress > 4064
    || !Number.isInteger(value.nextPodAddress) || value.nextPodAddress < 1 || value.nextPodAddress > 4064
    || !Number.isInteger(value.nextExternalAddress) || value.nextExternalAddress < 10 || value.nextExternalAddress > 255
    || !Array.isArray(value.diagnosticPodUids) || new Set(value.diagnosticPodUids).size !== value.diagnosticPodUids.length
    || !value.diagnosticPodUids.every(uid => validDiagnosticPod(byUid.get(uid), clusterId)) || !Array.isArray(value.applicationLogs) || value.applicationLogs.length > 200
    || !value.applicationLogs.every(log => validApplicationLog(log, byUid, state, run, lab, clusterId))
    || new Set(value.applicationLogs.map(log => log.requestId)).size !== value.applicationLogs.length
    || value.applicationLogs.some((log, index, logs) => index > 0 && logs[index - 1].sequence >= log.sequence)
    || !validConnectivityIncident(value.incident, run)) return false
  const addresses = new Set()
  let maxService = 0; let maxPod = 0; let maxExternal = 9
  for (const [, resource] of resources) {
    if (resource.kind === 'Service') {
      if (!/^10\.96\.(?:[0-9]|1[0-5])\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(resource.spec?.clusterIP ?? '') || addresses.has(resource.spec.clusterIP)) return false
      addresses.add(resource.spec.clusterIP)
      maxService = Math.max(maxService, addressIndex(resource.spec.clusterIP))
      const external = resource.status?.loadBalancer?.ingress?.[0]?.ip
      if (resource.spec.type === 'LoadBalancer' ? !/^192\.0\.2\.(?:1[0-9]|[2-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(external ?? '') : external !== undefined) return false
      if (external) { if (addresses.has(external)) return false; addresses.add(external); maxExternal = Math.max(maxExternal, Number(external.split('.')[3])) }
    }
    if (resource.kind === 'Pod' && resource.status?.podIP !== undefined) {
      if (!/^10\.244\.(?:[0-9]|1[0-5])\.(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-4])$/.test(resource.status.podIP) || addresses.has(resource.status.podIP)) return false
      addresses.add(resource.status.podIP)
      maxPod = Math.max(maxPod, addressIndex(resource.status.podIP))
    }
  }
  if (value.nextServiceAddress <= maxService || value.nextPodAddress <= maxPod || value.nextExternalAddress <= maxExternal) return false
  if (!resources.filter(([, resource]) => resource.kind === 'EndpointSlice').every(([, slice]) => {
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
  })) return false
  return resources.filter(([, service]) => service.kind === 'Service').every(([, service]) => validServiceSlices(state, service))
}

function validConnectivityIncident(incident, run) {
  if (run.labId !== CONNECTIVITY_TROUBLESHOOTING_LAB_ID) return incident === null
  if (!isPlainObject(incident) || Object.keys(incident).sort().join(',') !== 'id,observations,phase,recoveries,sequence'
    || incident.id !== 'network-hops-v1' || !isPlainObject(incident.observations) || !isPlainObject(incident.recoveries)) return false
  const phase = CONNECTIVITY_INCIDENT_PHASES.find(item => item.phase === incident.phase)
  if (!phase || incident.sequence !== phase.sequence
    || Object.keys(incident.observations).sort().join(',') !== 'dependency,port,selector'
    || Object.keys(incident.recoveries).sort().join(',') !== 'dependency,port,selector') return false
  const activeIndex = CONNECTIVITY_INCIDENT_PHASES.indexOf(phase)
  for (let itemIndex = 0; itemIndex < activeIndex; itemIndex++) {
    const priorPhase = CONNECTIVITY_INCIDENT_PHASES[itemIndex]
    if (typeof incident.observations[priorPhase.phase] !== 'string' || typeof incident.recoveries[priorPhase.phase] !== 'string') return false
  }
  for (const item of CONNECTIVITY_INCIDENT_PHASES) for (const field of ['observations', 'recoveries']) {
    const id = incident[field][item.phase]
    if (id === null) continue
    const itemIndex = CONNECTIVITY_INCIDENT_PHASES.indexOf(item)
    if (itemIndex > activeIndex || field === 'recoveries' && !item.recoveryScenario) return false
    const record = run.evidence?.experimentsById?.[id]
    const taskId = field === 'observations' ? item.observation : item.recovery
    const scenarioId = field === 'observations' ? item.observationScenario : item.recoveryScenario
    if (!scenarioId || typeof id !== 'string' || record?.id !== id || record.attemptId !== run.attemptId || record.labId !== run.labId
      || record.taskId !== taskId || record.scenarioId !== scenarioId || record.scenarioVersion !== 1
      || record.outcome !== 'passed' || record.completed !== true || record.measurements?.clusterId !== CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID
      || record.measurements?.namespace !== 'assistant' || record.measurements?.deploymentName !== 'assistant'
      || record.measurements?.deploymentUid !== run.runtime.kubernetes.clusters?.[CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]?.resources?.['Deployment/assistant/assistant']?.metadata?.uid
      || run.runtime.kubernetes.clusters?.[CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID]?.resources?.['Deployment/assistant/assistant']?.spec?.template?.spec?.containers?.[0]?.image !== CONNECTIVITY_TROUBLESHOOTING_IMAGE
      || record.measurements?.artifactId !== null && record.measurements?.artifactId !== run.artifacts.publishedTags?.[CONNECTIVITY_TROUBLESHOOTING_IMAGE]
      || record.measurements?.serviceName !== 'assistant-internal'
      || field === 'recoveries' && record.measurements?.artifactId !== run.artifacts.publishedTags?.[CONNECTIVITY_TROUBLESHOOTING_IMAGE]) return false
    if (itemIndex < activeIndex && (!incident.observations[item.phase] || !incident.recoveries[item.phase])) return false
    if (itemIndex > 0 && incident.observations[item.phase]) {
      const prior = run.evidence?.experimentsById?.[incident.recoveries[CONNECTIVITY_INCIDENT_PHASES[itemIndex - 1].phase]]
      if (!prior || record.sequence <= prior.sequence) return false
    }
    if (field === 'recoveries') {
      const observation = run.evidence?.experimentsById?.[incident.observations[item.phase]]
      if (observation && record.sequence <= observation.sequence) return false
    }
  }
  return true
}

function validApplicationLog(log, byUid, state, run, lab, clusterId) {
  const keys = ['requestId', 'sequence', 'podUid', 'podName', 'namespace', 'image', 'method', 'path', 'status', 'artifactId', 'dependencySummary']
  if (!isPlainObject(log) || Object.keys(log).sort().join(',') !== keys.sort().join(',')
    || !Number.isSafeInteger(log.sequence) || log.sequence < 1 || log.sequence >= run.nextSequence
    || log.requestId !== `aks-request-${log.sequence}` || !['GET', 'POST'].includes(log.method)
    || !['/api/info', '/api/ask', '/api/work'].includes(log.path) || !Number.isInteger(log.status) || log.status < 100 || log.status > 599
    || typeof log.podUid !== 'string' || typeof log.podName !== 'string' || typeof log.namespace !== 'string' || typeof log.image !== 'string'
    || typeof log.artifactId !== 'string' || !Array.isArray(log.dependencySummary) || log.dependencySummary.length > 3) return false
  const pod = byUid.get(log.podUid)
  const request = run.runtime?.kubernetes?.requests?.find(item => item.id === log.requestId && item.sequence === log.sequence)
  if (pod ? pod.kind !== 'Pod' || pod.metadata.name !== log.podName || pod.metadata.namespace !== log.namespace
    || pod.spec.containers[0]?.image !== log.image || state.podSnapshots[pod.metadata.uid]?.artifactId !== log.artifactId
    : !validHistoricalConnectivityLog(log, request, run, state, lab, clusterId)) return false
  if (!log.dependencySummary.every(item => isPlainObject(item) && Object.keys(item).every(key => ['operation', 'status', 'reason'].includes(key))
    && ['embedding', 'postgres-query', 'answer'].includes(item.operation) && ['succeeded', 'failed'].includes(item.status)
    && (item.reason === undefined || ['DNS_NOT_FOUND', 'AUTHENTICATION_FAILED', 'UNAVAILABLE'].includes(item.reason)))) return false
  return !!request && request.route?.podUid === log.podUid && request.route?.podName === log.podName
    && request.route?.namespace === log.namespace && request.route?.artifactId === log.artifactId && request.status === log.status
}

function validHistoricalConnectivityLog(log, request, run, state, lab, clusterId) {
  const supportsIntegrationConnectivity = lab?.capabilities?.kubernetesConnectivity === true && lab?.capabilities?.kubernetesAiIntegration === true
  const supportsLegacyConnectivity = ['aks-connectivity-guided', CONNECTIVITY_TROUBLESHOOTING_LAB_ID, 'aks-connectivity-independent'].includes(run.labId)
  if (!isPlainObject(request) || !isPlainObject(request.route) || !(supportsIntegrationConnectivity || supportsLegacyConnectivity)
    || request.route?.podUid !== log.podUid || request.route?.podName !== log.podName
    || request.route?.namespace !== log.namespace || request.route?.artifactId !== log.artifactId) return false
  if (request.scenarioId === null) {
    const origin = request.origin
    const diagnostic = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === origin?.podUid)
    if (origin?.kind === 'pod') return typeof origin.clusterId === 'string' && state.connectivity?.diagnosticPodUids.includes(origin.podUid)
      && validDiagnosticPod(diagnostic, origin.clusterId) && request.status === log.status
    const probeReceipt = lab?.capabilities?.kubernetesProbes === true && origin?.kind === 'external'
      && [...(state.health?.receipts ?? []), state.health?.experiment].filter(Boolean).some(receipt => receipt.clusterId === origin.clusterId
        && receipt.samples?.some(sample => sample.response?.requestId === request.id && sample.response.status === log.status
          && sample.response.route?.podUid === log.podUid && sample.response.route?.artifactId === log.artifactId))
    const matchesHistoricalResourceSample = sample => sample?.requestId === request.id && sample.status === log.status
      && sample.route?.podUid === log.podUid && sample.route?.podName === log.podName
      && sample.route?.namespace === log.namespace && sample.route?.artifactId === log.artifactId
    const resourceReceipt = lab?.capabilities?.kubernetesResources === true && origin?.kind === 'external' && origin.clusterId === clusterId
      && ((state.resourcesRuntime?.experiment?.phase && ['running', 'complete', 'cancelled'].includes(state.resourcesRuntime.experiment.phase)
        && state.resourcesRuntime.experiment.routeSamples?.some(matchesHistoricalResourceSample))
        || (state.resourcesRuntime?.receipts ?? []).some(receipt => receipt.kind === 'resource-experiment' && ['complete', 'cancelled'].includes(receipt.phase)
          && (receipt.phase === 'complete' ? ['passed', 'failed'].includes(receipt.outcome) : receipt.outcome === 'cancelled')
          && receipt.samples?.some(matchesHistoricalResourceSample))
        || Object.values(run.evidence?.experimentsById ?? {}).some(evidence => evidence.completed === true
          && ['passed', 'failed'].includes(evidence.outcome) && evidence.measurements?.clusterId === clusterId
          && evidence.measurements?.samples?.some(matchesHistoricalResourceSample)))
    return probeReceipt || resourceReceipt
  }
  return Object.values(run.evidence?.experimentsById ?? {}).some(evidence => evidence?.scenarioId === request.scenarioId
    && typeof evidence.completed === 'boolean' && evidence.measurements?.requestSequence === log.sequence
    && evidence.measurements?.route?.podUid === log.podUid && evidence.measurements?.artifactId === log.artifactId
    && evidence.measurements?.status === log.status && ['passed', 'failed'].includes(evidence.outcome))
}

function addressIndex(address) { const [, , third, fourth] = address.split('.').map(Number); return third * 254 + fourth - 1 }

function validServiceSlices(state, service) {
  const target = service.spec.ports[0].targetPort ?? service.spec.ports[0].port
  const groups = new Map()
  for (const pod of Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === service.metadata.namespace
    && Object.entries(service.spec.selector).every(([key, value]) => item.metadata.labels?.[key] === value))) {
    const port = typeof target === 'number' ? target : pod.spec.containers?.[0]?.ports?.find(item => item.name === target)?.containerPort
    if (!port || !pod.status?.podIP) continue
    const endpoints = groups.get(port) ?? []; endpoints.push(pod); groups.set(port, endpoints)
  }
  if (!groups.size) groups.set(null, [])
  const expected = new Set([...groups.keys()].map(port => kubeSliceKey(service, port)))
  const actual = Object.entries(state.resources).filter(([, item]) => item.kind === 'EndpointSlice' && item.metadata.ownerReferences?.[0]?.uid === service.metadata.uid)
  if (actual.length !== expected.size || actual.some(([key]) => !expected.has(key))) return false
  return [...groups.entries()].every(([port, pods]) => {
    const slice = state.resources[kubeSliceKey(service, port)]
    return JSON.stringify(slice.ports) === JSON.stringify(port === null ? [] : [{ protocol: 'TCP', port }])
      && JSON.stringify(slice.endpoints) === JSON.stringify(pods.sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid)).map(pod => ({ addresses: [pod.status.podIP], conditions: { ready: pod.metadata.deletionTimestamp === undefined && pod.status.phase === 'Running' && pod.status.conditions?.some(item => item.type === 'Ready' && item.status === 'True') }, targetRef: { kind: 'Pod', namespace: pod.metadata.namespace, name: pod.metadata.name, uid: pod.metadata.uid } })))
  })
}

function kubeSliceKey(service, port) {
  const suffix = port === null ? 'empty' : String(port)
  const name = `${service.metadata.name}-${service.metadata.uid.replace(/[^a-z0-9]/g, '').slice(-12)}-${suffix}`.slice(0, 63)
  return `EndpointSlice/${service.metadata.namespace}/${name}`
}

function validDiagnosticPod(pod, clusterId) {
  return pod?.kind === 'Pod' && pod.metadata?.uid === `diagnostic/${clusterId}` && pod.metadata?.name === 'diagnostics' && pod.metadata?.namespace === 'diagnostics'
    && JSON.stringify(pod.metadata.labels) === JSON.stringify({ app: 'diagnostics' }) && pod.spec?.containers?.length === 1
    && pod.spec.containers[0]?.name === 'diagnostics' && pod.spec.containers[0]?.image === 'mcr.microsoft.com/aks-trainer/diagnostics:1'
    && pod.metadata.deletionTimestamp === undefined && pod.status?.phase === 'Running' && pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
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
