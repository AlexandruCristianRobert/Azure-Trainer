import { recordVerification } from '../labEngine/evidence.js'
import { simulateKubernetesRequest } from './requests.js'
import { refreshKubernetesDependencies } from './evidence.js'
import { isJsonValue } from '../labEngine/run.js'
import { advanceConfigurationProjection } from './configuration.js'

export function applyAksAction(run, action, lab) {
  if (action.type === 'aks-advance') {
    if (Object.keys(action).some(key => !['type', 'seconds'].includes(key)) || lab?.capabilities?.kubernetesConfiguration !== true || !Number.isInteger(action.seconds) || action.seconds < 1 || action.seconds > 300) {
      return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'AKS time advance requires an integer seconds value from 1 through 300.' }] }
    }
    return { run: advanceConfigurationProjection(run, action.seconds), lines: [{ kind: 'out', text: `Advanced AKS simulation by ${action.seconds} seconds.` }], portalEvents: [], diagnostics: [] }
  }
  if (action.type !== 'aks-request' || Object.keys(action).some(key => !['type', 'scenarioId'].includes(key))
    || lab?.capabilities?.kubernetes !== true || typeof action.scenarioId !== 'string')
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'AKS requests accept only a declared scenarioId; outcomes cannot be supplied by the caller.' }] }
  const scenario = lab.scenarios?.[action.scenarioId]
  const scenarioKeys = ['kind', 'version', 'target', 'request', 'expected', 'requireReplacement', 'requireTwoReplicas', 'expectedCurrentConfig', 'expectedCapturedConfig']
  const target = scenario?.target; const request = scenario?.request; const expected = scenario?.expected
  if (!scenario || Object.keys(scenario).some(key => !scenarioKeys.includes(key)) || scenario.kind !== 'aks-request' || scenario.version !== 1
    || !target || Object.keys(target).sort().join(',') !== 'clusterId,deploymentName,namespace,serviceName'
    || [target.clusterId, target.deploymentName, target.namespace, target.serviceName].some(value => typeof value !== 'string' || !value)
    || !request || !['GET', 'POST'].includes(request.method) || (request.method === 'GET' && (Object.keys(request).sort().join(',') !== 'method,path' || request.path !== '/api/info'))
    || (request.method === 'POST' && (request.path !== '/api/ask' || !isJsonValue(request.body) || Object.keys(request).some(key => !['method', 'path', 'body'].includes(key))))
    || !expected || Object.keys(expected).sort().join(',') !== 'body,status' || !Number.isInteger(expected.status)
    || !isJsonValue(expected.body) || scenario.requireReplacement !== undefined && typeof scenario.requireReplacement !== 'boolean'
    || scenario.requireTwoReplicas !== undefined && typeof scenario.requireTwoReplicas !== 'boolean')
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'The declared AKS request scenario is invalid.' }] }
  const task = lab.tasks.find(item => item.verification?.scenarioId === action.scenarioId
    && item.verification?.scenarioVersion === scenario.version)
  if (!task) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'No Task verifies this AKS request scenario.' }] }
  const refreshed = refreshKubernetesDependencies(run, run, lab)
  const response = simulateKubernetesRequest(refreshed, { ...scenario, id: action.scenarioId })
  const next = recordVerification(response.run, lab, task.id, { scenarioId: action.scenarioId, scenarioVersion: scenario.version,
    outcome: response.outcome ? 'passed' : 'failed', completed: response.outcome,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs, measurements: response.measurements })
  const text = `HTTP ${response.status} ${JSON.stringify(response.body)}`
  return { run: next, lines: [{ kind: response.status === scenario.expected.status ? 'out' : 'err', text,
    status: response.status, body: response.body, measurements: response.measurements }], portalEvents: [], diagnostics: response.diagnostic ? [response.diagnostic] : [] }
}
