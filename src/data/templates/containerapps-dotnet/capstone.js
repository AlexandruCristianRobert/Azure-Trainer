import { FOUNDRY_MANIFEST, FOUNDRY_SOLUTION_FILES } from './foundry.js'
import { TROUBLESHOOTING_FOUNDRY_PROGRAM } from './foundry-troubleshooting.js'
import { PROBE_MANIFEST } from './probes.js'

const api = 'src/Trainer.Api'
export const CAPSTONE_BICEP_TARGETS = Object.freeze([
  Object.freeze({ templatePath: 'infra/bootstrap.bicep', parameterPath: 'infra/bootstrap.bicepparam',
    resourceGroup: 'rg-aca-capstone', deploymentName: 'bootstrap', registryName: 'acrcapstone', identityName: 'id-capstone' }),
  Object.freeze({ templatePath: 'infra/main.bicep', parameterPath: 'infra/main.bicepparam',
    resourceGroup: 'rg-aca-capstone', deploymentName: 'application', appName: 'api-capstone',
    registryName: 'acrcapstone', identityName: 'id-capstone' }),
])
const cpuRoute = `app.MapGet("/api/work", (int units) => {
    if (units < 1 || units > 100) return Results.BadRequest();
    var checksum = 0;
    for (var i = 0; i < units; i++) { checksum += i; }
    return Results.Ok(new { units, checksum });
});`
const healthRoutes = `app.MapGet("/health/startup", () => HealthState.StartupComplete ? Results.Ok() : Results.StatusCode(503));
app.MapGet("/health/ready", () => HealthState.Ready ? Results.Ok() : Results.StatusCode(503));
app.MapGet("/health/live", () => HealthState.Responsive ? Results.Ok() : Results.StatusCode(503));`

export const CAPSTONE_PROGRAM = TROUBLESHOOTING_FOUNDRY_PROGRAM
  .replace('app.MapPost("/api/summarize"', `${cpuRoute}\napp.MapPost("/api/summarize"`)
  .replace('app.Run("http://0.0.0.0:"', `${healthRoutes}\napp.Run("http://0.0.0.0:"`)

export const CAPSTONE_MANIFEST = Object.freeze({ ...FOUNDRY_MANIFEST,
  id: 'containerapps-dotnet-capstone-v1', capstone: true, healthProbes: true,
  files: Object.freeze([...FOUNDRY_MANIFEST.files, `${api}/HealthState.cs`,
    'infra/bootstrap.bicep', 'infra/modules/foundation.bicep', 'infra/bootstrap.bicepparam',
    'infra/main.bicep', 'infra/modules/application.bicep', 'infra/main.bicepparam']),
  bicepFiles: Object.freeze(['infra/bootstrap.bicep', 'infra/modules/foundation.bicep', 'infra/bootstrap.bicepparam',
    'infra/main.bicep', 'infra/modules/application.bicep', 'infra/main.bicepparam']),
  bicepRoots: Object.freeze({ 'infra/bootstrap.bicepparam': 'infra/bootstrap.bicep',
    'infra/main.bicepparam': 'infra/main.bicep' }),
  maxFiles: 32,
  fixedFiles: Object.freeze({ ...FOUNDRY_MANIFEST.fixedFiles,
    [`${api}/HealthState.cs`]: PROBE_MANIFEST.fixedFiles[`${api}/HealthState.cs`] }),
})

export const CAPSTONE_SOLUTION_FILES = Object.freeze({ ...FOUNDRY_SOLUTION_FILES,
  'infra/bootstrap.bicep': `targetScope = 'resourceGroup'
param registryName string
param identityName string
module foundation './modules/foundation.bicep' = {
  name: 'foundation'
  params: { registryName: registryName, identityName: identityName }
}
output registryId string = foundation.outputs.registryId
output registryServer string = foundation.outputs.registryServer
output identityId string = foundation.outputs.identityId
output identityClientId string = foundation.outputs.identityClientId
output identityPrincipalId string = foundation.outputs.identityPrincipalId
`,
  'infra/modules/foundation.bicep': `param registryName string
param identityName string
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: registryName
  location: resourceGroup().location
  sku: { name: 'Basic' }
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: identityName
  location: resourceGroup().location
}
output registryId string = registry.id
output registryServer string = registry.properties.loginServer
output identityId string = identity.id
output identityClientId string = identity.properties.clientId
output identityPrincipalId string = identity.properties.principalId
`,
  'infra/bootstrap.bicepparam': "using './bootstrap.bicep'\nparam registryName = 'acrcapstone'\nparam identityName = 'id-capstone'\n",
  'infra/main.bicep': `targetScope = 'resourceGroup'
param registryName string
param identityName string
module application './modules/application.bicep' = {
  name: 'application'
  params: { registryName: registryName, identityName: identityName }
}
output appId string = application.outputs.appId
output registryId string = application.outputs.registryId
output identityId string = application.outputs.identityId
output accountId string = application.outputs.accountId
`,
  'infra/modules/application.bicep': `param registryName string
param identityName string
resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: registryName
  location: resourceGroup().location
}
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' existing = {
  name: identityName
  location: resourceGroup().location
}
resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: 'env-capstone'
  location: resourceGroup().location
  properties: { appLogsConfiguration: { destination: 'none' } }
}
resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: 'foundrycapstone'
  location: resourceGroup().location
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: { allowProjectManagement: true, customSubDomainName: 'foundrycapstone' }
}
resource project 'Microsoft.CognitiveServices/accounts/projects@2025-06-01' = {
  parent: account
  name: 'summarizer-project'
  location: resourceGroup().location
}
resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: 'summarizer-primary'
  location: resourceGroup().location
  sku: { name: 'GlobalStandard', capacity: 10 }
  properties: { model: { format: 'OpenAI', name: 'gpt-5-mini', version: '2025-08-07' } }
}
resource acrRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.properties.principalId, 'AcrPull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: '/subscriptions/\${subscription().subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/7f951dda-4ed3-4680-a7ca-43fe172d538d'
  }
}
resource aiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, identity.properties.principalId, 'Cognitive Services User')
  scope: account
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: '/subscriptions/\${subscription().subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/a97b65f3-24c7-4388-baec-2e87135dc908'
  }
}
resource app 'Microsoft.App/containerApps@2025-07-01' = {
  name: 'api-capstone'
  location: resourceGroup().location
  identity: { type: 'UserAssigned', userAssignedIdentities: { '\${identity.id}': {} } }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      ingress: { external: true, targetPort: 8080 }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
    }
    template: {
      containers: [{
        name: 'api'
        image: '\${registry.properties.loginServer}/api:v1'
        resources: { cpu: 0.5, memory: '1Gi' }
        env: [
          { name: 'APP_ENV', value: 'training' }
          { name: 'AZURE_CLIENT_ID', value: identity.properties.clientId }
          { name: 'FOUNDRY_ENDPOINT', value: account.properties.endpoint }
          { name: 'FOUNDRY_DEPLOYMENT', value: deployment.name }
        ]
        probes: [
          { type: 'Startup', httpGet: { path: '/health/startup', port: 8080, scheme: 'HTTP' }, initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1, failureThreshold: 6, successThreshold: 1 }
          { type: 'Readiness', httpGet: { path: '/health/ready', port: 8080, scheme: 'HTTP' }, initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1, failureThreshold: 2, successThreshold: 1 }
          { type: 'Liveness', httpGet: { path: '/health/live', port: 8080, scheme: 'HTTP' }, initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1, failureThreshold: 2, successThreshold: 1 }
        ]
      }]
      scale: { minReplicas: 1, maxReplicas: 5, rules: [{ name: 'cpu', custom: { type: 'cpu', metadata: { type: 'Utilization', value: '60' } } }] }
    }
  }
}
output appId string = app.id
output registryId string = registry.id
output identityId string = identity.id
output accountId string = account.id
`,
  'infra/main.bicepparam': "using './main.bicep'\nparam registryName = 'acrcapstone'\nparam identityName = 'id-capstone'\n",
  [`${api}/Program.cs`]: CAPSTONE_PROGRAM,
  [`${api}/HealthState.cs`]: PROBE_MANIFEST.fixedFiles[`${api}/HealthState.cs`],
  [`${api}/appsettings.json`]: `${JSON.stringify({ ListeningPort: 8080,
    FoundryEndpoint: 'https://foundrycapstone.services.ai.azure.com/openai/v1/',
    FoundryDeployment: 'summarizer-primary', TotalAttempts: 3, TotalBudgetSeconds: 10,
    AttemptTimeoutSeconds: 3, HonorRetryAfter: true }, null, 2)}\n`,
})

export const CAPSTONE_STARTER_FILES = Object.freeze({ ...CAPSTONE_SOLUTION_FILES,
  [`${api}/Program.cs`]: CAPSTONE_PROGRAM.replace('HealthState.Ready', 'false')
    .replace('units > 100', 'units > 0'),
  [`${api}/appsettings.json`]: `${JSON.stringify({ ListeningPort: 8080,
    FoundryEndpoint: '', FoundryDeployment: '', TotalAttempts: 1,
    TotalBudgetSeconds: 10, AttemptTimeoutSeconds: 3, HonorRetryAfter: false }, null, 2)}\n`,
})
