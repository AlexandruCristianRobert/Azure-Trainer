import { BICEP_MANIFEST, BICEP_STARTER_FILES } from './bicep-guided.js'
import { FOUNDRY_SOLUTION_FILES } from './foundry.js'

const setting = 'src/Trainer.Api/appsettings.json'
export const BICEP_GUIDED_MANIFEST = BICEP_MANIFEST
export const BICEP_GUIDED_INITIAL_FILES = Object.freeze({ ...BICEP_STARTER_FILES,
  [setting]: FOUNDRY_SOLUTION_FILES[setting].replaceAll('foundryguided', 'foundrybicepguided'),
})

export const BICEP_GUIDED_SOLUTION_FILES = Object.freeze({ ...BICEP_GUIDED_INITIAL_FILES,
  'infra/main.bicep': `targetScope = 'resourceGroup'
param registryName string
param identityName string
param environmentName string
param accountName string
param projectName string
param deploymentName string
param appName string
param imageTag string

module identity './modules/identity.bicep' = {
  name: 'identity'
  params: { identityName: identityName }
}
module environment './modules/environment.bicep' = {
  name: 'environment'
  params: { environmentName: environmentName }
}
module foundry './modules/foundry.bicep' = {
  name: 'foundry'
  params: { accountName: accountName, projectName: projectName, deploymentName: deploymentName, principalId: identity.outputs.principalId }
}
module roles './modules/roles.bicep' = {
  name: 'roles'
  params: { registryName: registryName, principalId: identity.outputs.principalId }
}
module app './modules/app.bicep' = {
  name: 'app'
  params: {
    appName: appName
    environmentId: environment.outputs.id
    identityId: identity.outputs.id
    clientId: identity.outputs.clientId
    registryServer: roles.outputs.registryServer
    imageTag: imageTag
    foundryEndpoint: foundry.outputs.endpoint
    foundryDeployment: foundry.outputs.modelName
  }
  dependsOn: [roles]
}
output appId string = app.outputs.id
output foundryEndpoint string = foundry.outputs.endpoint
output foundryDeployment string = foundry.outputs.modelName
`,
  'infra/modules/identity.bicep': `param identityName string
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: identityName
  location: resourceGroup().location
}
output id string = identity.id
output clientId string = identity.properties.clientId
output principalId string = identity.properties.principalId
`,
  'infra/modules/environment.bicep': `param environmentName string
resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: environmentName
  location: resourceGroup().location
  properties: { appLogsConfiguration: { destination: 'none' } }
}
output id string = environment.id
`,
  'infra/modules/foundry.bicep': `param accountName string
param projectName string
param deploymentName string
param principalId string
resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: accountName
  location: resourceGroup().location
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: { allowProjectManagement: true, customSubDomainName: accountName }
}
resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: account
  name: projectName
  location: resourceGroup().location
}
resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: deploymentName
  location: resourceGroup().location
  sku: { name: 'GlobalStandard', capacity: 10 }
  properties: { model: { format: 'OpenAI', name: 'gpt-5-mini', version: '2025-08-07' } }
}
resource inferenceRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, principalId, 'Cognitive Services User')
  scope: account
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: '/subscriptions/\${subscription().subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/a97b65f3-24c7-4388-baec-2e87135dc908'
  }
}
output accountId string = account.id
output endpoint string = account.properties.endpoint
output modelName string = deployment.name
`,
  'infra/modules/roles.bicep': `param registryName string
param principalId string
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: registryName
}
resource acrRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, principalId, 'AcrPull')
  scope: registry
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: '/subscriptions/\${subscription().subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/7f951dda-4ed3-4680-a7ca-43fe172d538d'
  }
}
output registryServer string = registry.properties.loginServer
`,
  'infra/modules/app.bicep': `param appName string
param environmentId string
param identityId string
param clientId string
param registryServer string
param imageTag string
param foundryEndpoint string
param foundryDeployment string
resource app 'Microsoft.App/containerApps@2025-07-01' = {
  name: appName
  location: resourceGroup().location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '\${identityId}': {} } }
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      ingress: { external: true, targetPort: 8080 }
      registries: [{ server: registryServer, identity: identityId }]
    }
    template: {
      containers: [{
        name: 'api'
        image: '\${registryServer}/api:\${imageTag}'
        resources: { cpu: 0.5, memory: '1Gi' }
        env: [
          { name: 'APP_ENV', value: 'training' }
          { name: 'AZURE_CLIENT_ID', value: clientId }
          { name: 'FOUNDRY_ENDPOINT', value: foundryEndpoint }
          { name: 'FOUNDRY_DEPLOYMENT', value: foundryDeployment }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 2, rules: [{ name: 'cpu', custom: { type: 'cpu', metadata: { type: 'Utilization', value: '60' } } }] }
    }
  }
}
output id string = app.id
`,
  'infra/first.bicepparam': `using './main.bicep'
param registryName = 'acrbicepguided'
param identityName = 'id-bicep'
param environmentName = 'env-bicep'
param accountName = 'foundrybicepguided'
param projectName = 'summarizer-project'
param deploymentName = 'summarizer-primary'
param appName = 'api-bicep'
param imageTag = 'v1'
`,
})

export const BICEP_GUIDED_UPDATED_APP = BICEP_GUIDED_SOLUTION_FILES['infra/modules/app.bicep'].replace('maxReplicas: 2', 'maxReplicas: 5')
