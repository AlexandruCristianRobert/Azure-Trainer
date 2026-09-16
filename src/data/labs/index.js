import { servicebusOrderBackendLab } from './servicebus-order-backend.lab.js'

const comingSoon = (id, title, skillAreaId, service, minutes) => ({ id, title, skillAreaId, service, minutes, status: 'coming-soon', brief: '', seed: (sb) => sb, tasks: [] })

// Catalog order = Home card order (design artboard 1).
export const LABS = [
  servicebusOrderBackendLab,
  comingSoon('containerapps-keda', 'Deploy a Container App with KEDA scaling', 'containers', 'container-apps', 40),
  comingSoon('cosmos-vector-search', 'Cosmos DB container with vector search', 'data', 'cosmos-db', 45),
  comingSoon('keyvault-secrets', 'Store and rotate secrets in Key Vault', 'secure', 'key-vault', 30),
  comingSoon('functions-serverless-api', 'Serverless API with Azure Functions', 'connect', 'functions', 40),
  comingSoon('eventgrid-filtered-subscription', 'Event Grid custom topic with filtered subscription', 'connect', 'event-grid', 35),
]

export function labById(id) {
  return LABS.find((l) => l.id === id)
}
