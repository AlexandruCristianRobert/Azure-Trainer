export const AI_TROUBLESHOOTING_LAB_ID = 'aks-ai-troubleshooting'
export const AI_TROUBLESHOOTING_GROUP = 'rg-aks-ai-troubleshooting'
export const AI_TROUBLESHOOTING_REGISTRY = 'acraksaitrouble'
export const AI_TROUBLESHOOTING_CLUSTER = 'aks-ai-troubleshooting'
export const AI_TROUBLESHOOTING_IMAGE = `${AI_TROUBLESHOOTING_REGISTRY}.azurecr.io/assistant:resilient-v1`
export const AI_TROUBLESHOOTING_CLUSTER_ID = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${AI_TROUBLESHOOTING_GROUP}/providers/Microsoft.ContainerService/managedClusters/${AI_TROUBLESHOOTING_CLUSTER}`
export const INTEGRATION_INCIDENT_FILES = Object.freeze(['k8s/configmap.yaml', 'k8s/deployment.yaml'])
export const INTEGRATION_INCIDENT_PHASES = Object.freeze([
  Object.freeze({ phase: 'deployment', failureTask: 'observe-deployment', recoveryTask: 'repair-deployment', recoveryScenario: 'trouble-ai-deployment-recovered', next: 'filter' }),
  Object.freeze({ phase: 'filter', failureTask: 'observe-filter', recoveryTask: 'repair-filter', recoveryScenario: 'trouble-ai-filter-recovered', next: 'retry' }),
  Object.freeze({ phase: 'retry', failureTask: 'observe-no-retry', recoveryTask: 'repair-policy', recoveryScenario: null, next: null }),
])
