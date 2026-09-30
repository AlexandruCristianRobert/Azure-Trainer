import { STARTER_FILES, SOLUTION_FILES, PROJECT_MANIFEST } from '../../templates/containerapps-dotnet/starter.js'
import { parseProject } from '../../../lib/project/files.js'
import { parseDockerfile } from '../../../lib/project/dockerfile.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { hasPublishedImage } from '../../../lib/simulation/runtime.js'
import { createDeploymentCriteria, matchesApiSpec } from './deployment-criteria.js'

const group = 'rg-aca-independent'
const registry = 'acrindependent'
const environment = 'env-independent'
const identity = 'id-independent'
const app = 'api-independent'
const image = `${registry}.azurecr.io/orders:v2`
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
const identityId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const principalId = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] }, { resourceGroup: group, name: identity }).resource.principalId
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const at = (items, name) => items?.find((item) => same(item.name, name) && same(item.resourceGroup, group))
const command = (...commands) => ({ steps: commands.map((line) => ({ kind: 'command', line })) })
const workedFiles = {
  ...SOLUTION_FILES,
  'src/Trainer.Api/AppSettings.cs': SOLUTION_FILES['src/Trainer.Api/AppSettings.cs'].replace('contoso-api', 'orders-api'),
  'src/Trainer.Api/appsettings.json': JSON.stringify({ ListeningPort: 9090 }, null, 2) + '\n',
  Dockerfile: SOLUTION_FILES.Dockerfile.replace('ASPNETCORE_HTTP_PORTS=8080', 'ASPNETCORE_HTTP_PORTS=9090'),
}
const file = (...paths) => ({ steps: paths.map((path) => ({ kind: 'file', path, content: workedFiles[path] })) })
const sourceReady = ({ project }) => matchesApiSpec(parseProject(project.savedFiles).appSpec, { service: 'orders-api', port: 9090 })
const dockerReady = ({ project }) => parseDockerfile(project.savedFiles.Dockerfile).dockerSpec?.listeningPort === 9090
const { registryFor, identityFor, grantReady, publishedBuild, deploymentEntry, deploymentReady } = createDeploymentCriteria({
  group, registry, environment, identity, app, service: 'orders-api', port: 9090,
  environmentValue: 'staging', requiredImage: image,
})

export const deployIndependentLab = {
  id: 'aca-deploy-independent', title: 'Deploy an API from requirements', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 30,
  brief: 'Deploy orders-api from the .NET 10 starter in an empty East US Sandbox. Use rg-aca-independent, Basic registry acrindependent, environment env-independent, identity id-independent and app api-independent. Publish acrindependent.azurecr.io/orders:v2. The API must listen on 9090, read APP_ENV from deployment configuration, and return HTTP 200 from GET /api/info with { service: "orders-api", environment: "staging" }. Choose any supported order for the work.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 3, labMode: 'independent',
  manifestId: PROJECT_MANIFEST.id, capabilities: { acrBuild: true }, initialProjectFiles: STARTER_FILES,
  stages: [{ id: 'requirements', title: 'Deployment requirements', taskIds: ['source', 'docker', 'resources', 'artifact', 'deployment', 'response'] }],
  scenarios: Object.freeze({ info: Object.freeze({ version: 1, appId,
    request: Object.freeze({ method: 'GET', path: '/api/info' }),
    expected: Object.freeze({ status: 200, body: Object.freeze({ service: 'orders-api', environment: 'staging' }) }) }) }),
  tasks: [
    { id: 'source', stageId: 'requirements', text: 'Save the .NET API so GET /api/info returns service `orders-api` and reads `APP_ENV` from configuration; set its listener to 9090.',
      check: sourceReady,
      hints: ['The running response comes from the saved C# route and its configuration.', 'Set the route service to orders-api, read builder.Configuration["APP_ENV"], and set ListeningPort to 9090.'],
      solution: file('src/Trainer.Api/Program.cs', 'src/Trainer.Api/AppSettings.cs', 'src/Trainer.Api/appsettings.json'),
      examNote: 'The API must use deployment configuration for its environment value; a literal staging value does not prove the wiring.' },
    { id: 'docker', stageId: 'requirements', text: 'Save a valid .NET 10 Dockerfile for this API with the container listener on 9090.',
      check: dockerReady,
      hints: ['Keep a build stage and an ASP.NET runtime stage.', 'Set ASPNETCORE_HTTP_PORTS=9090 and run Trainer.Api.dll.'],
      solution: file('Dockerfile'),
      examNote: 'The Docker listener and Container Apps ingress target must agree.' },
    { id: 'resources', stageId: 'requirements', text: 'Create rg-aca-independent in East US, Basic registry acrindependent, identity id-independent with AcrPull on that registry, and environment env-independent in East US.',
      check: (context) => context.sandbox.resourceGroups.some((item) => same(item.name, group) && item.location === 'eastus')
        && registryFor(context)?.sku === 'Basic' && !!identityFor(context)
        && grantReady(context) && at(context.sandbox.containerAppEnvironments, environment)?.location === 'eastus',
      hints: ['The registry, managed identity and Container Apps environment belong to the named resource group.', 'Grant the identity principal AcrPull at the registry ARM ID scope. The app later uses the identity ARM ID.'],
      solution: command(`az group create -n ${group} -l eastus`, `az acr create -g ${group} -n ${registry} --sku Basic`,
        `az identity create -g ${group} -n ${identity}`,
        `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`,
        `az containerapp env create -g ${group} -n ${environment} -l eastus`),
      examNote: 'The role assignee is the identity principal; its scope is the registry, while the app attachment uses the identity resource ID.' },
    { id: 'artifact', stageId: 'requirements', text: 'Build the saved source and Dockerfile and publish `acrindependent.azurecr.io/orders:v2` to the private registry.',
      check: (context) => !!registryFor(context) && !!publishedBuild(context) && hasPublishedImage(context, image),
      hints: ['An image build captures saved files; editor drafts do not alter it.', 'Build orders:v2 from Dockerfile with az acr build --registry acrindependent.'],
      solution: command(`az acr build --registry ${registry} --image orders:v2 --file Dockerfile .`),
      examNote: 'Publication records the built source snapshot; later file edits require a new build and deployment.' },
    { id: 'deployment', stageId: 'requirements', text: 'Run api-independent from the published orders:v2 image in env-independent. Attach id-independent for private pull, set APP_ENV=staging, and enable external ingress on target port 9090.',
      check: deploymentReady,
      hints: ['The app needs both the user-assigned identity attachment and registry pull identity selection.', 'Use the image, environment, identity ARM ID, registry server, APP_ENV=staging, external ingress and target port 9090.'],
      solution: command(`az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${image} --user-assigned ${identityId} --registry-server ${registry}.azurecr.io --registry-identity ${identityId} --env-vars APP_ENV=staging --ingress external --target-port 9090`),
      examNote: 'The active deployment captures its image and environment configuration when the deployment succeeds.' },
    { id: 'response', stageId: 'requirements', text: 'Send GET /api/info to api-independent and observe HTTP 200 with service orders-api and environment staging.',
      check: deploymentReady,
      dependencies: { [`deployment:${appId}`]: (context) => ({ generation: deploymentEntry(context)?.active?.generation ?? null,
        artifactId: deploymentEntry(context)?.active?.artifactId ?? null,
        desired: deploymentEntry(context)?.desired ?? null,
        status: deploymentEntry(context)?.status ?? null }) },
      verification: { scenarioId: 'info', scenarioVersion: 1 },
      hints: ['Use Experiments to send an actual request to the running app.', 'Choose api-independent, GET and /api/info, then inspect the captured status and body.'],
      solution: { steps: [{ kind: 'experiment', request: { appId, method: 'GET', path: '/api/info' }, expected: { status: 200, body: { service: 'orders-api', environment: 'staging' } } }] },
      examNote: 'The observed response proves the active artifact and runtime configuration together.' },
  ],
}
