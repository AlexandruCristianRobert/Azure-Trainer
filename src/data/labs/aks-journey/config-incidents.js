export const CONFIG_TROUBLESHOOTING_LAB_ID = 'aks-config-troubleshooting'
export const CONFIG_TROUBLESHOOTING_GROUP = 'rg-aks-config-troubleshooting'
export const CONFIG_TROUBLESHOOTING_REGISTRY = 'acraksconfigtrouble'
export const CONFIG_TROUBLESHOOTING_CLUSTER = 'aks-config-troubleshooting'
export const CONFIG_TROUBLESHOOTING_IMAGE = `${CONFIG_TROUBLESHOOTING_REGISTRY}.azurecr.io/assistant:configured`
export const CONFIG_TROUBLESHOOTING_CLUSTER_ID = `/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/${CONFIG_TROUBLESHOOTING_GROUP}/providers/Microsoft.ContainerService/managedClusters/${CONFIG_TROUBLESHOOTING_CLUSTER}`
export const CONFIG_TROUBLESHOOTING_FILES = Object.freeze(['k8s/namespace.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/deployment.yaml'])

const phases = Object.freeze([
  Object.freeze({ phase: 'reference', taskId: 'repair-reference', scenarioId: 'config-reference-recovered', next: 'key', message: 'A same-named ConfigMap existed in decoy, not assistant. The recovered request confirmed the corrected namespace.' }),
  Object.freeze({ phase: 'key', taskId: 'repair-key', scenarioId: 'config-key-recovered', next: 'stale', message: 'The incident removed PGDATABASE from assistant-config. Restore the key and confirm the assistant recovers before continuing.' }),
  Object.freeze({ phase: 'stale', taskId: 'observe-stale', scenarioId: 'config-stale-observed', next: null, message: 'APP_ENV changed in the applied ConfigMap while existing Pods retained their captured training environment.' }),
])

export const CONFIG_INCIDENT_PHASES = phases
