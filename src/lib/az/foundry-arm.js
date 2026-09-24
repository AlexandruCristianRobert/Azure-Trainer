import { FOUNDRY_API_VERSION } from '../sandbox/foundry.js'

export function presentFoundryAccount(account) {
  return {
    id: account.id, name: account.name, resourceGroup: account.resourceGroup, location: account.location,
    type: 'Microsoft.CognitiveServices/accounts', kind: account.kind, sku: { name: account.sku },
    identity: account.identity ? { type: account.identity.type, principalId: account.identity.principalId } : null,
    properties: { endpoint: account.endpoint, customSubDomainName: account.name, allowProjectManagement: account.allowProjectManagement, provisioningState: 'Succeeded' },
    apiVersion: FOUNDRY_API_VERSION,
  }
}

export function presentFoundryProject(project) {
  return {
    id: project.id, name: project.name, location: project.location, type: 'Microsoft.CognitiveServices/accounts/projects',
    properties: { provisioningState: 'Succeeded', endpoints: { 'AI Foundry API': project.endpoint } }, apiVersion: FOUNDRY_API_VERSION,
  }
}

export function presentFoundryDeployment(deployment) {
  return {
    id: deployment.id, name: deployment.name, type: 'Microsoft.CognitiveServices/accounts/deployments',
    sku: { name: deployment.sku, capacity: 10 },
    properties: { model: { name: deployment.modelName, version: deployment.modelVersion, format: 'OpenAI' }, provisioningState: 'Succeeded' },
    apiVersion: FOUNDRY_API_VERSION,
  }
}
