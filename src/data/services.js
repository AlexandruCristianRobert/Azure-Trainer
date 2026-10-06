// Azure services shown in the Portal. `icon` is a key of src/lib/icons.js AZURE_ICONS.
export const SERVICES = {
  'service-bus': { label: 'Service Bus', icon: 'service-bus', tint: 'var(--tint-blue)' },
  'container-apps': { label: 'Container Apps', icon: 'container-apps', tint: 'var(--tint-teal)' },
  aks: { label: 'Kubernetes Service', icon: 'aks', tint: 'var(--tint-blue)' },
  'cosmos-db': { label: 'Cosmos DB', icon: 'cosmos-db', tint: 'var(--tint-purple)' },
  'key-vault': { label: 'Key Vault', icon: 'key-vault', tint: 'var(--tint-amber)' },
  functions: { label: 'Functions', icon: 'functions', tint: 'var(--tint-violet)' },
  postgresql: { label: 'Azure Database for PostgreSQL', icon: 'postgresql', tint: 'var(--tint-steel)' },
  'managed-redis': { label: 'Managed Redis', icon: 'managed-redis', tint: 'var(--tint-red)' },
  'container-registry': { label: 'Container Registry', icon: 'container-registry', tint: 'var(--tint-slate)' },
  'event-grid': { label: 'Event Grid', icon: 'event-grid', tint: 'var(--tint-teal)' },
  'application-insights': { label: 'Application Insights', icon: 'dashboard', tint: 'var(--tint-violet)' },
}

export const HOME_SERVICES = ['service-bus', 'container-apps', 'aks', 'cosmos-db', 'key-vault', 'functions', 'postgresql', 'managed-redis', 'container-registry']
