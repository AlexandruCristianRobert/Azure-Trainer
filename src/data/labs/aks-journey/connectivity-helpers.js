import { connectivityDependencies } from '../../../lib/kubernetes/evidence.js'

export const connectivityScenario = ({ clusterId, namespace = 'assistant', serviceName, deploymentName = 'assistant', origin, hostname, port = 80, method = 'GET', path = '/api/info', body = null, expected }) => ({
  kind: 'aks-request', version: 1, target: { clusterId, namespace, serviceName, deploymentName },
  connectivity: { origin, ...(origin.kind === 'external' ? { service: { namespace, name: serviceName } } : { hostname }), port },
  request: method === 'POST' ? { method, path, body } : { method, path }, expected,
})

export const connectivityTask = ({ id, stageId, text, explanation, hints, examNote, check, solution, verification, target }) => ({
  id, stageId, text, explanation, hints, examNote, check, solution,
  ...(verification ? { verification, dependencies: connectivityDependencies(target, { sourceRequired: id === 'listener' }) } : {}),
})
