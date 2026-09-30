import { STARTER_FILES, SOLUTION_FILES, PROJECT_MANIFEST } from '../../templates/containerapps-dotnet/starter.js'
import { parseProject } from '../../../lib/project/files.js'
import { parseDockerfile } from '../../../lib/project/dockerfile.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { hasPublishedImage } from '../../../lib/simulation/runtime.js'
import { createDeploymentCriteria, matchesApiSpec } from './deployment-criteria.js'

const group = 'rg-aca-guided'
const registry = 'acrguided'
const environment = 'env-guided'
const identity = 'id-guided'
const app = 'api-guided'
const image = `${registry}.azurecr.io/api:v1`
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
const identityId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const principalId = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] }, { resourceGroup: group, name: identity }).resource.principalId
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const at = (items, name) => items?.find((item) => same(item.name, name) && same(item.resourceGroup, group))
const command = (...commands) => ({ steps: commands.map((line) => ({ kind: 'command', line })) })
const file = (path) => ({ steps: [{ kind: 'file', path, content: SOLUTION_FILES[path] }] })

function sourceSpec(context) {
  return parseProject(context.project.savedFiles).appSpec
}
function sourceReady(context) {
  return matchesApiSpec(sourceSpec(context), { service: 'contoso-api', port: 8080 })
}
function dockerReady(context) {
  return parseDockerfile(context.project.savedFiles.Dockerfile).dockerSpec?.listeningPort === 8080
}
const { registryFor, identityFor, grantReady, publishedBuild, deploymentEntry, deploymentReady } = createDeploymentCriteria({
  group, registry, environment, identity, app, service: 'contoso-api', port: 8080,
  environmentValue: 'training', requiredImage: image,
})

export const deployGuidedLab = {
  id: 'aca-deploy-guided', title: 'Build and deploy a Container App', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 25,
  brief: 'Prepare a .NET 10 API, publish it to a private registry, then deploy and verify its response in the simulated Sandbox.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 1, labMode: 'guided',
  manifestId: PROJECT_MANIFEST.id, capabilities: { acrBuild: true }, initialProjectFiles: STARTER_FILES,
  stages: [
    { id: 'prepare', title: 'Prepare', taskIds: ['group', 'source', 'docker'] },
    { id: 'publish', title: 'Publish', taskIds: ['registry', 'identity', 'image'] },
    { id: 'deploy', title: 'Deploy and verify', taskIds: ['environment', 'deployment', 'response'] },
  ],
  scenarios: Object.freeze({ info: Object.freeze({ version: 1, appId,
    request: Object.freeze({ method: 'GET', path: '/api/info' }),
    expected: Object.freeze({ status: 200, body: Object.freeze({ service: 'contoso-api', environment: 'training' }) }) }) }),
  tasks: [
    { id: 'group', stageId: 'prepare', text: 'Create `rg-aca-guided` in East US.',
      check: ({ sandbox }) => sandbox.resourceGroups.some((resource) => same(resource.name, group) && resource.location === 'eastus'),
      hints: ['A resource group holds the registry, identity, environment and app.', 'Use `az group create` with the exact group name and East US location.'],
      solution: command('az group create -n rg-aca-guided -l eastus'),
      examNote: 'A resource group is the management boundary for these Azure resources.' },
    { id: 'source', stageId: 'prepare', text: 'Save a `GET /api/info` route that returns the service name and reads `APP_ENV` from configuration.',
      check: sourceReady,
      hints: ['Edit the saved C# source in Files. Draft text does not change a build.', 'Set the service name in AppSettings and return it with `builder.Configuration["APP_ENV"]`.'],
      solution: file('src/Trainer.Api/Program.cs'),
      examNote: 'The response is derived from saved source; deployment configuration supplies APP_ENV at runtime.' },
    { id: 'docker', stageId: 'prepare', text: 'Save a valid .NET 10 `Dockerfile` that listens on port 8080.',
      check: dockerReady,
      hints: ['The project uses a build stage and an ASP.NET runtime stage.', 'Set `ASPNETCORE_HTTP_PORTS=8080` and launch `Trainer.Api.dll`.'],
      solution: file('Dockerfile'),
      examNote: 'The container listener and ingress target port must agree.' },
    { id: 'registry', stageId: 'publish', text: 'Create the private Basic registry `acrguided`.',
      check: (context) => !!registryFor(context) && registryFor(context).sku === 'Basic',
      hints: ['Publish to a registry in the same resource group.', 'Use `az acr create` with the Basic SKU.'],
      solution: command('az acr create -g rg-aca-guided -n acrguided --sku Basic'),
      examNote: 'Azure Container Registry holds the image tag that Container Apps later pulls.' },
    { id: 'identity', stageId: 'publish', text: 'Create `id-guided` and give its principal exact `AcrPull` access to `acrguided`.',
      check: (context) => !!identityFor(context) && grantReady(context),
      hints: ['A user-assigned managed identity lets the app pull without registry credentials.', 'Create the identity, then assign `AcrPull` to its principal at the exact registry ARM ID.'],
      solution: command('az identity create -g rg-aca-guided -n id-guided',
        `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`),
      examNote: 'The principal ID is the role assignee; the managed identity ARM ID is attached to the app.' },
    { id: 'image', stageId: 'publish', text: 'Build the saved project and publish `acrguided.azurecr.io/api:v1`.',
      check: (context) => !!registryFor(context) && !!publishedBuild(context) && hasPublishedImage(context, image),
      hints: ['Builds capture saved files, not the editor draft.', 'Use `az acr build --registry acrguided --image api:v1 --file Dockerfile .`.'],
      solution: command('az acr build --registry acrguided --image api:v1 --file Dockerfile .'),
      examNote: 'An image tag points to a captured source artifact. Later edits need another build.' },
    { id: 'environment', stageId: 'deploy', text: 'Create Container Apps environment `env-guided` in East US.',
      check: ({ sandbox }) => !!at(sandbox.containerAppEnvironments, environment) && at(sandbox.containerAppEnvironments, environment).location === 'eastus',
      hints: ['A Container Apps environment hosts the application.', 'Use `az containerapp env create` in the same group and location.'],
      solution: command('az containerapp env create -g rg-aca-guided -n env-guided -l eastus'),
      examNote: 'The environment provides the hosting boundary for Container Apps.' },
    { id: 'deployment', stageId: 'deploy', text: 'Deploy `api-guided` from the published image with the managed identity, external ingress on 8080 and `APP_ENV=training`.',
      check: deploymentReady,
      hints: ['The identity needs both attachment and registry pull selection.', 'Pass the image, environment, identity ARM ID, registry server and identity, ingress, target port and environment variable.'],
      solution: command(`az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${image} --user-assigned ${identityId} --registry-server ${registry}.azurecr.io --registry-identity ${identityId} --env-vars APP_ENV=training --ingress external --target-port 8080`),
      examNote: 'A successful deployment captures the image and environment values used by future requests.' },
    { id: 'response', stageId: 'deploy', text: 'Send `GET /api/info` and observe HTTP 200 with service `contoso-api` and environment `training`.',
      check: deploymentReady,
      dependencies: { [`deployment:${appId}`]: (context) => ({ generation: deploymentEntry(context)?.active?.generation ?? null,
        artifactId: deploymentEntry(context)?.active?.artifactId ?? null,
        desired: deploymentEntry(context)?.desired ?? null,
        status: deploymentEntry(context)?.status ?? null }) },
      verification: { scenarioId: 'info', scenarioVersion: 1 },
      hints: ['Use Experiments to call the running deployment.', 'Select `api-guided`, GET and `/api/info`, then send the request.'],
      solution: { steps: [{ kind: 'experiment', request: { appId, method: 'GET', path: '/api/info' }, expected: { status: 200, body: { service: 'contoso-api', environment: 'training' } } }] },
      examNote: 'A request verifies the captured running image and environment, not just the desired configuration.' },
  ],
}
