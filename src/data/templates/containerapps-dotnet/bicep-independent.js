import { BICEP_MANIFEST } from './bicep-guided.js'
import { BICEP_GUIDED_SOLUTION_FILES } from './bicep-guided-solution.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'

export const BICEP_INDEPENDENT_MANIFEST = Object.freeze({ ...BICEP_MANIFEST,
  id: 'containerapps-dotnet-bicep-independent-v1',
  files: Object.freeze([...BICEP_MANIFEST.files, 'infra/second.bicepparam']),
  bicepFiles: Object.freeze([...BICEP_MANIFEST.bicepFiles, 'infra/second.bicepparam']),
})

const settingPath = 'src/Trainer.Api/appsettings.json'
const firstPath = 'infra/first.bicepparam'
const secondPath = 'infra/second.bicepparam'

export const BICEP_INDEPENDENT_CONFIGS = Object.freeze([
  Object.freeze({ parameterPath: firstPath, resourceGroup: 'rg-aca-bicep-primary', deploymentName: 'primary',
    registryName: 'acrbicepprimary', identityName: 'id-bicep-primary', environmentName: 'env-bicep-primary',
    accountName: 'foundrybicepprimary', projectName: 'summarizer-primary-project',
    modelDeploymentName: 'summarizer-primary', appName: 'api-bicep-primary', imageTag: 'v1',
    image: 'acrbicepprimary.azurecr.io/api:v1', endpoint: 'https://foundrybicepprimary.services.ai.azure.com/openai/v1/',
    appEnvironment: 'training', minReplicas: 1, maxReplicas: 2 }),
  Object.freeze({ parameterPath: secondPath, resourceGroup: 'rg-aca-bicep-staging', deploymentName: 'staging',
    registryName: 'acrbicepstaging', identityName: 'id-bicep-staging', environmentName: 'env-bicep-staging',
    accountName: 'foundrybicepstaging', projectName: 'summarizer-staging-project',
    modelDeploymentName: 'summarizer-staging', appName: 'api-bicep-staging', imageTag: 'v2',
    image: 'acrbicepstaging.azurecr.io/api:v2', endpoint: 'https://foundrybicepstaging.services.ai.azure.com/openai/v1/',
    appEnvironment: 'staging', minReplicas: 2, maxReplicas: 4 }),
])

export const BICEP_INDEPENDENT_TARGETS = Object.freeze(BICEP_INDEPENDENT_CONFIGS.map(config => Object.freeze({
  parameterPath: config.parameterPath, resourceGroup: config.resourceGroup,
  deploymentName: config.deploymentName, appName: config.appName,
})))

const parameterText = config => `using './main.bicep'
param registryName = '${config.registryName}'
param identityName = '${config.identityName}'
param environmentName = '${config.environmentName}'
param accountName = '${config.accountName}'
param projectName = '${config.projectName}'
param deploymentName = '${config.modelDeploymentName}'
param appName = '${config.appName}'
param imageTag = '${config.imageTag}'
param appEnvironment = '${config.appEnvironment}'
param minReplicas = ${config.minReplicas}
param maxReplicas = ${config.maxReplicas}
`

const firstConfig = BICEP_INDEPENDENT_CONFIGS[0]
const secondConfig = BICEP_INDEPENDENT_CONFIGS[1]
const firstSettings = JSON.stringify({ ListeningPort: 8080, FoundryEndpoint: firstConfig.endpoint,
  FoundryDeployment: firstConfig.modelDeploymentName }, null, 2) + '\n'

const sharedMain = BICEP_GUIDED_SOLUTION_FILES['infra/main.bicep']
  .replace('param imageTag string', 'param imageTag string\nparam appEnvironment string\nparam minReplicas int\nparam maxReplicas int')
  .replace('    imageTag: imageTag', '    imageTag: imageTag\n    appEnvironment: appEnvironment\n    minReplicas: minReplicas\n    maxReplicas: maxReplicas')
const sharedApp = BICEP_GUIDED_SOLUTION_FILES['infra/modules/app.bicep']
  .replace('param foundryDeployment string', 'param foundryDeployment string\nparam appEnvironment string\nparam minReplicas int\nparam maxReplicas int')
  .replace("{ name: 'APP_ENV', value: 'training' }", '{ name: \'APP_ENV\', value: appEnvironment }')
  .replace('minReplicas: 1, maxReplicas: 2', 'minReplicas: minReplicas, maxReplicas: maxReplicas')

export const BICEP_INDEPENDENT_SOLUTION_FILES = Object.freeze({ ...BICEP_GUIDED_SOLUTION_FILES,
  [settingPath]: firstSettings,
  'infra/main.bicep': sharedMain,
  'infra/modules/app.bicep': sharedApp,
  [firstPath]: parameterText(firstConfig),
  [secondPath]: parameterText(secondConfig),
})

export const BICEP_INDEPENDENT_INITIAL_FILES = Object.freeze({ ...BICEP_INDEPENDENT_SOLUTION_FILES,
  [secondPath]: `using './main.bicep'
// Complete the second environment with its own names, published image and scale policy.
`,
})

export const BICEP_INDEPENDENT_BASELINE = Object.freeze({
  target: firstConfig.resourceGroup, deploymentName: firstConfig.deploymentName,
  parameterPath: firstPath, appId: `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${firstConfig.resourceGroup}/providers/Microsoft.App/containerApps/${firstConfig.appName}`,
  image: firstConfig.image, artifactId: 'build-1', registryName: firstConfig.registryName, identityName: firstConfig.identityName,
  environmentName: firstConfig.environmentName, accountName: firstConfig.accountName,
  modelDeploymentName: firstConfig.modelDeploymentName, endpoint: firstConfig.endpoint,
  appEnvironment: firstConfig.appEnvironment, minReplicas: firstConfig.minReplicas,
  maxReplicas: firstConfig.maxReplicas,
  scalePolicy: Object.freeze({ cpu: 0.5, memory: '1Gi', minReplicas: firstConfig.minReplicas,
    maxReplicas: firstConfig.maxReplicas }),
  cpuRule: Object.freeze({ type: 'cpu', utilization: '60' }),
})
