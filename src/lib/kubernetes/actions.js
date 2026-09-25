import { recordVerification } from '../labEngine/evidence.js'
import { simulateKubernetesRequest } from './requests.js'
import { refreshKubernetesDependencies } from './evidence.js'
import { isJsonValue } from '../labEngine/run.js'
import { advanceConfigurationProjection } from './configuration.js'
import { advanceKubernetesTime } from './time.js'
import { recordConnectivityIncidentEvidence } from './connectivity-incidents.js'
import { advanceIntegrationIncident } from './integration-incidents.js'
import { AI_TROUBLESHOOTING_LAB_ID, INTEGRATION_SCENARIO_PHASES } from '../../data/labs/aks-journey/integration-incidents.js'

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

export function applyAksAction(run, action, lab) {
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
      ? advanceKubernetesTime(run, action.seconds, lab)
      : advanceConfigurationProjection(run, action.seconds)
    return { run: advanced, lines: [{ kind: 'out', text: `Advanced AKS simulation by ${action.seconds} seconds.` }], portalEvents: [], diagnostics: [] }
  }
  if (action.type !== 'aks-request' || Object.keys(action).some(key => !['type', 'scenarioId'].includes(key))
    || lab?.capabilities?.kubernetes !== true || typeof action.scenarioId !== 'string')
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'AKS requests accept only a declared scenarioId; outcomes cannot be supplied by the caller.' }] }
  const scenario = lab.scenarios?.[action.scenarioId]
  if (lab.id === AI_TROUBLESHOOTING_LAB_ID && INTEGRATION_SCENARIO_PHASES[action.scenarioId] !== run.runtime.kubernetes?.integrationIncident?.phase) {
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'AKS_INCIDENT_NOT_READY', message: 'This assistant request belongs to a later incident phase.' }] }
  }
  const scenarioKeys = ['kind', 'version', 'target', 'request', 'expected', 'connectivity', 'requireReplacement', 'requireTwoReplicas', 'expectedCurrentConfig', 'expectedCapturedConfig', 'integrationProfile']
  const target = scenario?.target; const request = scenario?.request; const expected = scenario?.expected
  if (!scenario || Object.keys(scenario).some(key => !scenarioKeys.includes(key)) || scenario.kind !== 'aks-request' || scenario.version !== 1
    || !target || Object.keys(target).sort().join(',') !== 'clusterId,deploymentName,namespace,serviceName'
    || [target.clusterId, target.deploymentName, target.namespace, target.serviceName].some(value => typeof value !== 'string' || !value)
    || !request || !['GET', 'POST'].includes(request.method) || (request.method === 'GET' && (Object.keys(request).sort().join(',') !== 'method,path' || request.path !== '/api/info'))
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
  const response = simulateKubernetesRequest(refreshed, { ...scenario, id: action.scenarioId })
  if (lab?.id === 'aks-connectivity-troubleshooting' || lab?.id === 'aks-ai-troubleshooting') {
    response.measurements.deploymentUid = response.run.runtime.kubernetes.clusters?.[target.clusterId]?.resources?.[`Deployment/${target.namespace}/${target.deploymentName}`]?.metadata?.uid ?? null
  }
  let next = recordVerification(response.run, lab, task.id, { scenarioId: action.scenarioId, scenarioVersion: scenario.version,
    outcome: response.outcome ? 'passed' : 'failed', completed: response.outcome,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs, measurements: response.measurements })
  next = recordConnectivityIncidentEvidence(next, lab, task, next.evidence.experimentsById[next.evidence.currentEvidenceByTask[task.id]])
  const text = `HTTP ${response.status} ${JSON.stringify(response.body)}`
  return { run: next, lines: [{ kind: response.status === scenario.expected.status ? 'out' : 'err', text,
    status: response.status, body: response.body, measurements: response.measurements }], portalEvents: [], diagnostics: response.outcome || !response.diagnostic ? [] : [response.diagnostic] }
}
