import { integrationDependencies } from '../../../lib/kubernetes/evidence.js'

export const AI_GUIDED_GROUP = 'rg-aks-ai-guided'
export const AI_GUIDED_REGISTRY = 'acraksaiguided'
export const AI_GUIDED_CLUSTER = 'aks-ai-guided'
export const AI_GUIDED_IMAGE = `${AI_GUIDED_REGISTRY}.azurecr.io/assistant:integration-v1`

export const integrationScenario = ({ id, clusterId, question, expected }) => ({
  kind: 'aks-request', version: 1,
  target: { clusterId, namespace: 'assistant', serviceName: 'assistant-public', deploymentName: 'assistant' },
  connectivity: { origin: { kind: 'external' }, service: { namespace: 'assistant', name: 'assistant-public' }, port: 80 },
  request: { method: 'POST', path: '/api/ask', body: { question } },
  expected, integrationProfile: 'healthy',
})

export const integrationTask = ({ id, stageId, text, explanation, hints, examNote, check, solution, verification, target }) => ({
  id, stageId, text, explanation, hints, examNote, check, solution,
  ...(verification ? { verification, dependencies: integrationDependencies(target) } : {}),
})
