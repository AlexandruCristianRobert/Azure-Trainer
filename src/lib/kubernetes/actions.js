import { recordVerification } from '../labEngine/evidence.js'
import { simulateKubernetesRequest } from './requests.js'
import { refreshKubernetesDependencies } from './evidence.js'
import { isJsonValue } from '../labEngine/run.js'
import { advanceConfigurationProjection } from './configuration.js'
import { advanceKubernetesTimeResult } from './time.js'
import { recordConnectivityIncidentEvidence } from './connectivity-incidents.js'
import { advanceIntegrationIncident } from './integration-incidents.js'
import { AI_TROUBLESHOOTING_LAB_ID, INTEGRATION_SCENARIO_PHASES } from '../../data/labs/aks-journey/integration-incidents.js'
import { cancelProbeExperiment, startProbeExperiment } from './probe-experiments.js'
import { cancelResourceExperiment, startResourceExperiment } from './resource-experiments.js'
import { advanceResourceIncident } from './resource-incidents.js'
import { startReleaseExperiment, finishReleaseExperiment, cancelReleaseExperiment } from './release-experiments.js'
import { recordFinalReleaseVerification } from './release-evidence.js'
import { recordReleaseMilestone } from './release-milestones.js'
import { startDiagnosisIncident, advanceDiagnosisIncident, captureDiagnosisObservation, replayDiagnosisObservation, diagnosisIncidentActive } from './diagnosis-incidents.js'
import { verifyDiagnosis } from './diagnosis-evidence.js'

const integrationProfiles = new Set(['healthy', 'embedding-throttle-once', 'postgres-unavailable-once', 'answer-unavailable-always', 'embedding-timeout-always', 'retry-after-too-long'])

function validConnectivityExpected(expected) {
  if (!expected || Object.keys(expected).some(key => !['status', 'body', 'transport', 'route'].includes(key))
    || !Object.hasOwn(expected, 'status') || !Object.hasOwn(expected, 'body') || !isJsonValue(expected.body)
    || !(Number.isInteger(expected.status) || expected.status === null)) return false
  if (expected.status === null && (!expected.transport || expected.transport.ok !== false)) return false
  if (expected.transport && (!isJsonValue(expected.transport) || Object.keys(expected.transport).sort().join(',') !== 'ok,reason'
    || typeof expected.transport.ok !== 'boolean' || (expected.transport.reason !== null && typeof expected.transport.reason !== 'string'))) return false
  return !expected.route || isJsonValue(expected.route) && Object.keys(expected.route).every(key => key === 'selectedCount')
    && Number.isInteger(expected.route.selectedCount) && expected.route.selectedCount >= 0
}

/** Shared declaration gate for Verify and fixture staging. */
export function validAksRequestScenario(scenario, lab) {
  const keys = ['kind', 'version', 'target', 'request', 'expected', 'connectivity', 'requireReplacement', 'requireTwoReplicas', 'expectedCurrentConfig', 'expectedCapturedConfig', 'integrationProfile']
  if (!scenario || !isJsonValue(scenario) || Object.keys(scenario).some(key => !keys.includes(key)) || scenario.kind !== 'aks-request' || scenario.version !== 1
    || !scenario.target || Object.keys(scenario.target).sort().join(',') !== 'clusterId,deploymentName,namespace,serviceName'
    || Object.values(scenario.target).some(value => typeof value !== 'string' || !value)
    || !scenario.request || !['GET', 'POST'].includes(scenario.request.method)
    || scenario.request.method === 'GET' && (Object.keys(scenario.request).sort().join(',') !== 'method,path' || !['/api/info', '/api/work'].includes(scenario.request.path)
      || scenario.request.path === '/api/work' && lab?.capabilities?.kubernetesResources !== true)
    || scenario.request.method === 'POST' && (scenario.request.path !== '/api/ask' || !isJsonValue(scenario.request.body)
      || Object.keys(scenario.request).some(key => !['method', 'path', 'body'].includes(key)))
    || !scenario.expected || (scenario.connectivity !== undefined ? !validConnectivityExpected(scenario.expected)
      : Object.keys(scenario.expected).sort().join(',') !== 'body,status' || !Number.isInteger(scenario.expected.status) || !isJsonValue(scenario.expected.body))
    || ['requireReplacement', 'requireTwoReplicas'].some(key => scenario[key] !== undefined && typeof scenario[key] !== 'boolean')
    || ['expectedCurrentConfig', 'expectedCapturedConfig'].some(key => scenario[key] !== undefined && (!scenario[key] || typeof scenario[key] !== 'object'
      || Array.isArray(scenario[key]) || Object.values(scenario[key]).some(value => typeof value !== 'string')))
    || scenario.integrationProfile !== undefined && (lab?.capabilities?.kubernetesAiIntegration !== true || !integrationProfiles.has(scenario.integrationProfile))) return false
  const connectivity = scenario.connectivity
  if (connectivity === undefined) return true
  if (lab?.capabilities?.kubernetesConnectivity !== true || !connectivity || !Number.isInteger(connectivity.port) || connectivity.port < 1 || connectivity.port > 65535) return false
  return Object.keys(connectivity).sort().join(',') === 'hostname,origin,port' && typeof connectivity.hostname === 'string'
    && connectivity.origin && Object.keys(connectivity.origin).sort().join(',') === 'kind,name,namespace'
    && connectivity.origin.kind === 'diagnostic' && connectivity.origin.name === 'diagnostics' && connectivity.origin.namespace === 'diagnostics'
    || Object.keys(connectivity).sort().join(',') === 'origin,port,service' && connectivity.origin && Object.keys(connectivity.origin).join(',') === 'kind'
      && connectivity.origin.kind === 'external' && connectivity.service && Object.keys(connectivity.service).sort().join(',') === 'name,namespace'
      && typeof connectivity.service.name === 'string' && typeof connectivity.service.namespace === 'string'
}

export function applyAksAction(run, action, lab) {
  if (['aks-diagnosis-start', 'aks-diagnosis-next', 'aks-diagnosis-replay'].includes(action.type)) {
    const replay = action.type === 'aks-diagnosis-replay'
    if (lab?.capabilities?.kubernetesDiagnostics !== true || Object.keys(action).sort().join(',') !== (replay ? 'observationId,type' : 'scenarioId,type'))
      return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Diagnosis controls accept only a declared scenario ID or retained observation ID.' }] }
    const result = replay ? replayDiagnosisObservation(run, action.observationId, lab)
      : action.type === 'aks-diagnosis-start' ? startDiagnosisIncident(run, action.scenarioId, lab) : advanceDiagnosisIncident(run, action.scenarioId, lab)
    return { run, lines: [], ...result, portalEvents: [] }
  }
  if (diagnosisIncidentActive(run) && ['aks-release-start', 'aks-resource-start', 'aks-probe-start', 'aks-integration-next-incident', 'aks-resource-next-incident'].includes(action.type))
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Recover and finish the active diagnosis incident before starting another experiment.' }] }
  if (['aks-release-start', 'aks-release-finish', 'aks-release-cancel'].includes(action.type)) {
    if (lab?.capabilities?.kubernetesRollouts !== true || Object.keys(action).sort().join(',') !== (action.type === 'aks-release-cancel' ? 'type' : 'scenarioId,type'))
      return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Release controls accept only a declared scenario ID; cancellation accepts no values.' }] }
    const result = action.type === 'aks-release-start' ? startReleaseExperiment(run, action.scenarioId, lab)
      : action.type === 'aks-release-finish' ? finishReleaseExperiment(run, action.scenarioId, lab) : cancelReleaseExperiment(run)
    return { ...result, lines: [], portalEvents: [] }
  }
  if (action.type === 'aks-resource-next-incident') {
    if (Object.keys(action).length !== 1 || lab?.capabilities?.kubernetesResources !== true)
      return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Resource incident advancement accepts no caller-selected values.' }] }
    const result = advanceResourceIncident(run, lab)
    return { ...result, portalEvents: [] }
  }
  if (action.type === 'aks-resource-start') {
    if (Object.keys(action).sort().join(',') !== 'scenarioId,type' || lab?.capabilities?.kubernetesResources !== true)
      return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Resource experiment starts accept only a declared scenario ID.' }] }
    const result = startResourceExperiment(run, action.scenarioId, lab)
    return { run: result.run, lines: result.diagnostics.length ? [] : [{ kind: 'out', text: `Started resource experiment ${action.scenarioId}; waiting for its declared baseline.` }], portalEvents: [], diagnostics: result.diagnostics }
  }
  if (action.type === 'aks-resource-cancel') {
    if (Object.keys(action).join(',') !== 'type' || lab?.capabilities?.kubernetesResources !== true)
      return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Resource experiment cancellation accepts no caller-selected values.' }] }
    const active = Object.entries(run.runtime.kubernetes.clusters ?? {}).find(([, state]) => ['warming', 'running'].includes(state.resourcesRuntime?.experiment?.phase))
    const result = active ? cancelResourceExperiment(run, active[0]) : { run, diagnostics: [{ code: 'INVALID_RESOURCE_EXPERIMENT', message: 'There is no active resource experiment to cancel.' }] }
    return { run: result.run, lines: result.diagnostics.length ? [] : [{ kind: 'out', text: 'Cancelled resource experiment; injected arrivals have stopped.' }], portalEvents: [], diagnostics: result.diagnostics }
  }
  if (action.type === 'aks-probe-start') {
    if (Object.keys(action).sort().join(',') !== 'scenarioId,type' || lab?.capabilities?.kubernetesProbes !== true) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Probe experiment starts accept only a declared scenario ID.' }] }
    const result = startProbeExperiment(run, action.scenarioId, lab)
    return { run: result.run, lines: result.diagnostics.length ? [] : [{ kind: 'out', text: `Started probe experiment ${action.scenarioId}.` }], portalEvents: [], diagnostics: result.diagnostics }
  }
  if (action.type === 'aks-probe-cancel') {
    if (Object.keys(action).join(',') !== 'type' || lab?.capabilities?.kubernetesProbes !== true) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Probe experiment cancellation accepts no caller-selected values.' }] }
    const active = Object.values(run.runtime.kubernetes.clusters ?? {}).find(state => state.health?.experiment)
    const result = active ? cancelProbeExperiment(run, active.health.experiment.clusterId) : { run, diagnostics: [{ code: 'INVALID_PROBE_EXPERIMENT', message: 'There is no active probe experiment to cancel.' }] }
    return { run: result.run, lines: result.diagnostics.length ? [] : [{ kind: 'out', text: 'Cancelled probe experiment.' }], portalEvents: [], diagnostics: result.diagnostics }
  }
  if (action.type === 'aks-integration-next-incident') {
    if (Object.keys(action).length !== 1) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Incident advancement accepts no caller-selected values.' }] }
    const result = advanceIntegrationIncident(run, lab)
    return { ...result, portalEvents: [] }
  }
  if (action.type === 'aks-advance') {
    if (Object.keys(action).some(key => !['type', 'seconds'].includes(key)) || lab?.capabilities?.kubernetesConfiguration !== true || !Number.isInteger(action.seconds) || action.seconds < 1 || action.seconds > 300) {
      return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'AKS time advance requires an integer seconds value from 1 through 300.' }] }
    }
    const advanced = lab?.capabilities?.kubernetesProbes === true
      ? advanceKubernetesTimeResult(run, action.seconds, lab)
      : { run: advanceConfigurationProjection(run, action.seconds), diagnostics: [] }
    return { run: advanced.run, lines: advanced.diagnostics.length ? [] : [{ kind: 'out', text: `Advanced AKS simulation by ${action.seconds} seconds.` }], portalEvents: [], diagnostics: advanced.diagnostics }
  }
  if (action.type !== 'aks-request' || Object.keys(action).some(key => !['type', 'scenarioId'].includes(key))
    || lab?.capabilities?.kubernetes !== true || typeof action.scenarioId !== 'string')
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'AKS requests accept only a declared scenarioId; outcomes cannot be supplied by the caller.' }] }
  if (lab.capabilities?.kubernetesRollouts && lab.scenarios?.[action.scenarioId]?.kind === 'aks-release-final') return { ...recordFinalReleaseVerification(run, lab, action.scenarioId), portalEvents: [] }
  if (lab.capabilities?.kubernetesRollouts && lab.scenarios?.[action.scenarioId]?.kind === 'aks-release-milestone') return { ...recordReleaseMilestone(run, lab, action.scenarioId), portalEvents: [] }
  const scenario = lab.scenarios?.[action.scenarioId]
  if (!validAksRequestScenario(scenario, lab)) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'The declared AKS request scenario is invalid.' }] }
  if (lab.id === AI_TROUBLESHOOTING_LAB_ID && INTEGRATION_SCENARIO_PHASES[action.scenarioId] !== run.runtime.kubernetes?.integrationIncident?.phase) {
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'AKS_INCIDENT_NOT_READY', message: 'This assistant request belongs to a later incident phase.' }] }
  }
  const scenarioKeys = ['kind', 'version', 'target', 'request', 'expected', 'connectivity', 'requireReplacement', 'requireTwoReplicas', 'expectedCurrentConfig', 'expectedCapturedConfig', 'integrationProfile']
  const target = scenario?.target; const request = scenario?.request; const expected = scenario?.expected
  if (!scenario || Object.keys(scenario).some(key => !scenarioKeys.includes(key)) || scenario.kind !== 'aks-request' || scenario.version !== 1
    || !target || Object.keys(target).sort().join(',') !== 'clusterId,deploymentName,namespace,serviceName'
    || [target.clusterId, target.deploymentName, target.namespace, target.serviceName].some(value => typeof value !== 'string' || !value)
    || !request || !['GET', 'POST'].includes(request.method) || (request.method === 'GET' && (Object.keys(request).sort().join(',') !== 'method,path' || !['/api/info', '/api/work'].includes(request.path)
      || request.path === '/api/work' && lab?.capabilities?.kubernetesResources !== true))
    || (request.method === 'POST' && (request.path !== '/api/ask' || !isJsonValue(request.body) || Object.keys(request).some(key => !['method', 'path', 'body'].includes(key))))
    || !expected || (scenario.connectivity !== undefined ? !validConnectivityExpected(expected)
      : Object.keys(expected).sort().join(',') !== 'body,status' || !Number.isInteger(expected.status) || !isJsonValue(expected.body))
    || scenario.requireReplacement !== undefined && typeof scenario.requireReplacement !== 'boolean'
    || scenario.requireTwoReplicas !== undefined && typeof scenario.requireTwoReplicas !== 'boolean'
    || scenario.integrationProfile !== undefined && (lab?.capabilities?.kubernetesAiIntegration !== true || !integrationProfiles.has(scenario.integrationProfile)))
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'The declared AKS request scenario is invalid.' }] }
  if (lab?.capabilities?.kubernetesConnectivity === true && scenario.connectivity !== undefined) {
    const connectivity = scenario.connectivity
    const diagnosticOrigin = connectivity?.origin?.kind === 'diagnostic'
      && Object.keys(connectivity.origin).sort().join(',') === 'kind,name,namespace'
      && connectivity.origin.namespace === 'diagnostics' && connectivity.origin.name === 'diagnostics'
    const externalOrigin = connectivity?.origin?.kind === 'external' && Object.keys(connectivity.origin).join(',') === 'kind'
    const internalShape = diagnosticOrigin && typeof connectivity.hostname === 'string' && Number.isInteger(connectivity.port)
      && Object.keys(connectivity).sort().join(',') === 'hostname,origin,port'
    const externalShape = externalOrigin && connectivity.service && typeof connectivity.service.namespace === 'string' && typeof connectivity.service.name === 'string'
      && Object.keys(connectivity.service).sort().join(',') === 'name,namespace' && Number.isInteger(connectivity.port)
      && Object.keys(connectivity).sort().join(',') === 'origin,port,service'
    if (!internalShape && !externalShape) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Connectivity scenarios must declare a trusted diagnostic origin or an external Service reference.' }] }
  } else if (scenario.connectivity !== undefined) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Connectivity scenarios require the kubernetesConnectivity capability.' }] }
  const task = lab.tasks.find(item => item.verification?.scenarioId === action.scenarioId
    && item.verification?.scenarioVersion === scenario.version)
  if (!task) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'No Task verifies this AKS request scenario.' }] }
  const refreshed = refreshKubernetesDependencies(run, run, lab)
  if (lab.capabilities?.kubernetesDiagnostics === true) {
    const assessed = verifyDiagnosis(refreshed, lab, action.scenarioId)
    let next = recordVerification(assessed.run, lab, task.id, assessed.result)
    next = captureDiagnosisObservation(next, action.scenarioId, { requestId: assessed.result.measurements.requestId }, lab)
    const measurements = assessed.result.measurements
    return { run: next, lines: [{ kind: assessed.result.completed ? 'out' : 'err', text: `HTTP ${measurements.status} ${JSON.stringify(measurements.body)}`,
      status: measurements.status, body: measurements.body, measurements }], portalEvents: [], diagnostics: [] }
  }
  const response = simulateKubernetesRequest(refreshed, { ...scenario, id: action.scenarioId })
  if (lab.capabilities?.kubernetesDiagnostics === true || lab?.id === 'aks-connectivity-troubleshooting' || lab?.id === 'aks-ai-troubleshooting') {
    response.measurements.deploymentUid = response.run.runtime.kubernetes.clusters?.[target.clusterId]?.resources?.[`Deployment/${target.namespace}/${target.deploymentName}`]?.metadata?.uid ?? null
  }
  let next = recordVerification(response.run, lab, task.id, { scenarioId: action.scenarioId, scenarioVersion: scenario.version,
    outcome: response.outcome ? 'passed' : 'failed', completed: response.outcome,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs, measurements: response.measurements })
  next = recordConnectivityIncidentEvidence(next, lab, task, next.evidence.experimentsById[next.evidence.currentEvidenceByTask[task.id]])
  next = captureDiagnosisObservation(next, action.scenarioId, { requestId: `request-${response.measurements.requestSequence}` }, lab)
  const text = `HTTP ${response.status} ${JSON.stringify(response.body)}`
  return { run: next, lines: [{ kind: response.status === scenario.expected.status ? 'out' : 'err', text,
    status: response.status, body: response.body, measurements: response.measurements }], portalEvents: [], diagnostics: response.outcome || !response.diagnostic ? [] : [response.diagnostic] }
}
