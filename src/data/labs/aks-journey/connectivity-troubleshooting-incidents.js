export const CONNECTIVITY_TROUBLESHOOTING_LAB_ID = 'aks-connectivity-troubleshooting'
export const CONNECTIVITY_TROUBLESHOOTING_GROUP = 'rg-aks-connectivity-troubleshooting'
export const CONNECTIVITY_TROUBLESHOOTING_REGISTRY = 'acraksnetworktrouble'
export const CONNECTIVITY_TROUBLESHOOTING_CLUSTER = 'aks-connectivity-troubleshooting'
export const CONNECTIVITY_TROUBLESHOOTING_CLUSTER_ID = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${CONNECTIVITY_TROUBLESHOOTING_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CONNECTIVITY_TROUBLESHOOTING_CLUSTER}`
export const CONNECTIVITY_TROUBLESHOOTING_IMAGE = `${CONNECTIVITY_TROUBLESHOOTING_REGISTRY}.azurecr.io/assistant:configured`
export const CONNECTIVITY_TROUBLESHOOTING_FILES = Object.freeze(['k8s/service-internal.yaml', 'k8s/configmap.yaml'])
export const CONNECTIVITY_INCIDENT_PHASES = Object.freeze([
  Object.freeze({ phase: 'selector', sequence: 1, observation: 'observe-selector', observationScenario: 'trouble-selector-failure', recovery: 'repair-selector', recoveryScenario: 'trouble-selector-recovered', next: 'port' }),
  Object.freeze({ phase: 'port', sequence: 2, observation: 'observe-port', observationScenario: 'trouble-port-failure', recovery: 'repair-port', recoveryScenario: 'trouble-port-recovered', next: 'dependency' }),
  Object.freeze({ phase: 'dependency', sequence: 3, observation: 'observe-dependency', observationScenario: 'trouble-dependency-failure', recovery: 'final-internal', recoveryScenario: 'trouble-network-internal-final', next: null }),
])
