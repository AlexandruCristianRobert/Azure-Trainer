import { FOUNDRY_MANIFEST, FOUNDRY_STARTER_FILES, FOUNDRY_SOLUTION_FILES } from '../../templates/containerapps-dotnet/foundry.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { parseProject } from '../../../lib/project/files.js'
import { foundryEvidenceDependencies, foundryInferenceReady } from '../../../lib/simulation/inference.js'

const group = 'rg-aca-foundry', registry = 'acrfoundryguided', environment = 'env-foundry'
const identity = 'id-foundry-caller', app = 'api-foundry', account = 'foundryguided'
const project = 'summarizer-project', deployment = 'summarizer-primary'
const image = `${registry}.azurecr.io/api:v1`
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
const identityId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const accountId = `${root}/providers/Microsoft.CognitiveServices/accounts/${account}`
const createdIdentity = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] },
  { resourceGroup: group, name: identity }).resource
const principalId = createdIdentity.principalId
const clientId = createdIdentity.clientId
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const command = (line) => ({ kind: 'command', line })
const file = (path, content) => ({ kind: 'file', path, content })
const request = (scenarioId) => ({ kind: 'scenario', action: { type: 'request', scenarioId }, instruction: `Send the ${scenarioId} named POST fixture in Foundry Request Controls.` })
const solution = (...steps) => ({ steps })
const accountCreate = `az cognitiveservices account create -g ${group} -n ${account} -l eastus --kind AIServices --sku S0 --custom-domain ${account} --assign-identity --allow-project-management true`
const projectCreate = `az cognitiveservices account project create -g ${group} -n ${account} --project-name ${project} -l eastus`
const deploymentCreate = `az cognitiveservices account deployment create -g ${group} -n ${account} --deployment-name ${deployment} --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-capacity 10 --sku-name GlobalStandard`
const grant = `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role "Cognitive Services User" --scope ${accountId}`
const build = `az acr build --registry ${registry} --image api:v1 --file Dockerfile .`
const redeploy = `az containerapp update -g ${group} -n ${app} --image ${image}`
const settingsPath = 'src/Trainer.Api/appsettings.json'

function foundryAccount(context) { return context.sandbox.foundryAccounts.find((item) => same(item.id, accountId)) }
function accountReady(context) {
  const item = foundryAccount(context)
  return !!item && item.kind === 'AIServices' && item.sku === 'S0' && item.location === 'eastus'
    && item.identity?.type === 'SystemAssigned' && item.allowProjectManagement === true
    && same(item.endpoint, `https://${account}.services.ai.azure.com/openai/v1/`)
}
function resourcesReady(context) {
  const item = foundryAccount(context)
  return accountReady(context) && item.projects.some((child) => child.name === project)
    && item.deployments.some((child) => child.name === deployment && child.modelName === 'gpt-5-mini'
      && child.modelVersion === '2025-08-07' && child.sku === 'GlobalStandard')
}
function roleReady(context) {
  return resourcesReady(context) && context.sandbox.roleAssignments.some((item) => same(item.scope, accountId)
    && same(item.principalId, principalId) && item.roleDefinitionId === 'a97b65f3-24c7-4388-baec-2e87135dc908')
}
function configured(context) {
  const parsed = parseProject(context.project.savedFiles, FOUNDRY_MANIFEST)
  return !parsed.diagnostics.length && parsed.appSpec?.foundry?.configured === true
    && same(parsed.appSpec.foundry.endpoint, `https://${account}.services.ai.azure.com/openai/v1/`)
    && parsed.appSpec.foundry.deployment === deployment
}
function activeReady(context) {
  const active = context.runtime.deploymentsByApp[appId]?.active
  return roleReady(context) && !!active && active.foundry?.configured === true
    && same(active.foundry.endpoint, `https://${account}.services.ai.azure.com/openai/v1/`)
    && active.foundry.deployment === deployment && same(active.foundry.principalId, principalId)
    && foundryInferenceReady(context, appId)
}
function deployed(context) {
  const active = context.runtime.deploymentsByApp[appId]?.active
  const published = context.artifacts.publishedTags[image.toLowerCase()]
  return configured(context) && activeReady(context) && !!published && active.artifactId === published
}
function fixedResourceTimes(value) {
  if (Array.isArray(value)) value.forEach(fixedResourceTimes)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'createdAt') value[key] = '2026-09-23T00:00:00.000Z'
    else fixedResourceTimes(item)
  }
}
function initializeSimulation(run) {
  const lines = [
    `az group create -n ${group} -l eastus`, `az acr create -g ${group} -n ${registry} --sku Basic`,
    `az identity create -g ${group} -n ${identity}`,
    `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`,
    `az containerapp env create -g ${group} -n ${environment} -l eastus`, build,
    `az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${image} --user-assigned ${identityId} --registry-server ${registry}.azurecr.io --registry-identity ${identityId} --env-vars APP_ENV=training AZURE_CLIENT_ID=${clientId} --ingress external --target-port 8080`,
  ]
  let seeded = run
  for (const line of lines) {
    const result = applyRunAction(seeded, { type: 'command', line }, foundryGuidedLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) throw new Error(`Foundry seed failed at ${line}: ${JSON.stringify(result.diagnostics)}`)
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}
const fixture = (title, text, status) => Object.freeze({ kind: 'foundry', version: 1, appId, title,
  request: { method: 'POST', path: '/api/summarize', body: { text } }, faultProfile: { attempts: [] }, expected: { status } })
const dependencies = foundryEvidenceDependencies(appId)

export const foundryGuidedLab = {
  id: 'aca-foundry-guided', title: 'Call a Foundry model from a Container App', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 30,
  brief: 'A private .NET 10 Container App is running with a user-assigned identity. Create simulated Foundry resources, grant that caller account-scoped inference access, configure and redeploy the saved summarizer, then inspect a successful response and a validation short circuit. The model profile, responses, and upstream trace are deterministic teaching simulations; no Azure service or model is contacted.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 10, labMode: 'guided',
  manifestId: FOUNDRY_MANIFEST.id, capabilities: { acrBuild: true, foundryInference: true },
  initialProjectFiles: FOUNDRY_STARTER_FILES, initializeSimulation,
  stages: [
    { id: 'provision', title: 'Provision Foundry', taskIds: ['account', 'resources'] },
    { id: 'connect', title: 'Connect the caller', taskIds: ['grant', 'configure'] },
    { id: 'verify', title: 'Verify requests', taskIds: ['valid', 'invalid'] },
  ],
  scenarios: Object.freeze({
    valid: fixture('Summarize valid input', 'Azure Container Apps runs the API. Foundry summarizes its input.', 200),
    invalid: fixture('Reject blank input', '   ', 400),
  }),
  tasks: [
    { id: 'account', stageId: 'provision', text: 'Create the simulated AIServices account `foundryguided` in East US with S0 SKU, its own project-management identity and project management enabled. Inspect its resource endpoint.', check: accountReady,
      hints: ['Use `az cognitiveservices account create`; the custom domain matches the account name.', 'Add `--assign-identity --allow-project-management true`. The account identity manages projects; the app caller identity is separate.'],
      solution: solution(command(accountCreate), command(`az cognitiveservices account show -g ${group} -n ${account}`)),
      examNote: 'The account resource endpoint ending in `/openai/v1/` is used for inference. Its management identity is not the Container App caller.' },
    { id: 'resources', stageId: 'provision', text: 'Create and inspect project `summarizer-project` and account deployment `summarizer-primary` using the simulated gpt-5-mini/2025-08-07/GlobalStandard profile.', check: resourcesReady,
      hints: ['Projects and deployments are children of the AIServices account.', 'The project endpoint is for project operations; inference uses the account resource endpoint and the deployment name.'],
      solution: solution(command(projectCreate), command(deploymentCreate),
        command(`az cognitiveservices account project show -g ${group} -n ${account} --project-name ${project}`),
        command(`az cognitiveservices account deployment show -g ${group} -n ${account} --deployment-name ${deployment}`)),
      examNote: 'The deployment name is the `model` value in a Responses API call. This model profile is a simulator fixture, not a live availability claim.' },
    { id: 'grant', stageId: 'connect', text: 'Grant the Container App caller identity Cognitive Services User at the exact Foundry account scope. Inspect the assignment.', check: roleReady,
      hints: ['Find the app identity principal ID with `az identity show` and use the Foundry account ARM ID as scope.', 'Use Cognitive Services User for this worked example. ACR `AcrPull` grants only image retrieval.'],
      solution: solution(command(grant), command(`az role assignment list --scope ${accountId}`)),
      examNote: 'The approved keyless guidance uses resource-scoped Cognitive Services User here. Separate v1 guidance names Cognitive Services OpenAI User; these are distinct roles, so check the service guidance for a real deployment.' },
    { id: 'configure', stageId: 'connect', text: 'Save the account resource endpoint and `summarizer-primary` in appsettings.json, build the saved C# project, and redeploy the image. Verify the active caller identity and captured configuration.', check: deployed,
      hints: ['The Program.cs teaching source already validates text, uses ManagedIdentityCredential, the ai.azure.com token scope, `/responses`, a ten-second deadline and no SDK retries.', 'Save appsettings.json, run `az acr build`, then `az containerapp update`. A draft or build alone does not change the running API.'],
      solution: solution(file(settingsPath, FOUNDRY_SOLUTION_FILES[settingsPath]), command(build), command(redeploy)),
      examNote: 'The active deployment captures source, endpoint, deployment name and caller identity. The project endpoint cannot replace the account resource endpoint.' },
    { id: 'valid', stageId: 'verify', text: 'Send the named valid POST /api/summarize fixture. Observe public HTTP 200 with the intended deployment and one correlated upstream invocation.', check: activeReady, dependencies, verification: { scenarioId: 'valid', scenarioVersion: 1 },
      hints: ['Choose Summarize valid input in Foundry Request Controls.', 'Inspect the public response and the upstream trace for account, deployment, principal and correlation ID.'],
      solution: solution(request('valid')),
      examNote: 'A successful public response is backed by an invocation at the intended deployment under the app caller identity.' },
    { id: 'invalid', stageId: 'verify', text: 'Send the named blank-input POST fixture. Observe public HTTP 400 and zero upstream invocations.', check: activeReady, dependencies, verification: { scenarioId: 'invalid', scenarioVersion: 1 },
      hints: ['Choose Reject blank input in Foundry Request Controls.', 'Inspect HTTP 400 and an empty upstream attempt trace. Validation happens before inference.'],
      solution: solution(request('invalid')),
      examNote: 'Input validation short-circuits before a model call, saving latency and avoiding unnecessary dependency traffic.' },
  ],
}
