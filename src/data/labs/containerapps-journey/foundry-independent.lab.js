import { INDEPENDENT_FOUNDRY_MANIFEST, INDEPENDENT_FOUNDRY_STARTER_FILES, INDEPENDENT_FOUNDRY_SOLUTION_FILES } from '../../templates/containerapps-dotnet/foundry-independent.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { foundryEvidenceDependencies, foundryInferenceReady } from '../../../lib/simulation/inference.js'

const group = 'rg-aca-brief', registry = 'acrbriefindependent', environment = 'env-brief'
const app = 'api-brief', pullName = 'id-brief-pull', inferenceName = 'id-brief-inference'
const account = 'foundryindependent', project = 'brief-project', deployment = 'briefing-secondary'
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
const pullId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${pullName}`
const inferenceId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${inferenceName}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const accountId = `${root}/providers/Microsoft.CognitiveServices/accounts/${account}`
const endpoint = `https://${account}.services.ai.azure.com/openai/v1/`
const image = `${registry}.azurecr.io/api:v1`
const identityContext = { ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] }
const pull = createIdentity(identityContext, { resourceGroup: group, name: pullName }).resource
const inference = createIdentity(identityContext, { resourceGroup: group, name: inferenceName }).resource
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const command = (line) => ({ kind: 'command', line })
const file = (path, content) => ({ kind: 'file', path, content })
const request = (scenarioId) => ({ kind: 'scenario', action: { type: 'request', scenarioId },
  instruction: `Send the named ${scenarioId} POST /api/brief fixture in Foundry Request Controls.` })
const solution = (...steps) => ({ steps })
const accountCreate = `az cognitiveservices account create -g ${group} -n ${account} -l eastus --kind AIServices --sku S0 --custom-domain ${account} --assign-identity --allow-project-management true`
const projectCreate = `az cognitiveservices account project create -g ${group} -n ${account} --project-name ${project} -l eastus`
const deploymentCreate = `az cognitiveservices account deployment create -g ${group} -n ${account} --deployment-name ${deployment} --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-capacity 10 --sku-name GlobalStandard`
const attach = `az containerapp identity assign -g ${group} -n ${app} --user-assigned ${inferenceId}`
const grant = `az role assignment create --assignee-object-id ${inference.principalId} --assignee-principal-type ServicePrincipal --role "Cognitive Services User" --scope ${accountId}`
const client = `az containerapp update -g ${group} -n ${app} --set-env-vars AZURE_CLIENT_ID=${inference.clientId}`
const build = `az acr build --registry ${registry} --image api:v1 --file Dockerfile .`
const redeploy = `az containerapp update -g ${group} -n ${app} --image ${image}`
const programPath = 'src/Trainer.Api/Program.cs', settingsPath = 'src/Trainer.Api/appsettings.json'

function accountResource(context) { return context.sandbox.foundryAccounts.find((item) => same(item.id, accountId)) }
function accountReady(context) {
  const value = accountResource(context)
  return !!value && value.kind === 'AIServices' && value.sku === 'S0' && value.location === 'eastus'
    && value.identity?.type === 'SystemAssigned' && value.allowProjectManagement === true
    && same(value.endpoint, endpoint)
}
function resourcesReady(context) {
  const value = accountResource(context)
  return accountReady(context) && value.projects.some((item) => item.name === project)
    && value.deployments.some((item) => item.name === deployment && item.modelName === 'gpt-5-mini'
      && item.modelVersion === '2025-08-07' && item.sku === 'GlobalStandard')
}
function appResource(context) { return context.sandbox.containerApps.find((item) => item.resourceGroup === group && item.name === app) }
function attached(context) {
  const value = appResource(context)
  const ids = Array.isArray(value?.userAssigned) ? value.userAssigned : [value?.userAssigned]
  return !!value && same(value.registryIdentity, pullId) && ids.some((id) => same(id, pullId))
    && ids.some((id) => same(id, inferenceId)) && context.sandbox.managedIdentities.some((item) => same(item.id, inferenceId))
}
function accessReady(context) {
  return resourcesReady(context) && attached(context)
    && context.sandbox.roleAssignments.some((item) => same(item.scope, accountId)
      && same(item.principalId, inference.principalId)
      && item.roleDefinitionId === 'a97b65f3-24c7-4388-baec-2e87135dc908'
      && item.roleName === 'Cognitive Services User')
}
function activeReady(context) {
  const active = context.runtime.deploymentsByApp[appId]?.active
  return accessReady(context) && !!active && active.appSpec?.foundry?.contract === 'brief-v1'
    && same(active.foundry?.endpoint, endpoint) && active.foundry?.deployment === deployment
    && same(active.foundry?.identityId, inferenceId) && same(active.foundry?.clientId, inference.clientId)
    && same(active.foundry?.principalId, inference.principalId)
    && foundryInferenceReady(context, appId)
}
function deployed(context) {
  return activeReady(context)
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
    `az identity create -g ${group} -n ${pullName}`, `az identity create -g ${group} -n ${inferenceName}`,
    `az role assignment create --assignee-object-id ${pull.principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`,
    `az containerapp env create -g ${group} -n ${environment} -l eastus`, build,
    `az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${image} --user-assigned ${pullId} --registry-server ${registry}.azurecr.io --registry-identity ${pullId} --env-vars APP_ENV=training --ingress external --target-port 8080`,
  ]
  let seeded = run
  for (const line of lines) {
    const result = applyRunAction(seeded, { type: 'command', line }, foundryIndependentLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) {
      throw new Error(`Independent Foundry seed failed at ${line}: ${JSON.stringify(result.diagnostics)}`)
    }
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}
const fixture = (title, content, attempts, status, diagnosticCode) => Object.freeze({ kind: 'foundry', version: 1, appId, title,
  request: { method: 'POST', path: '/api/brief', body: { content } }, faultProfile: { attempts },
  expected: { status, ...(diagnosticCode ? { diagnosticCode } : {}) } })
const dependencies = foundryEvidenceDependencies(appId)

export const foundryIndependentLab = {
  id: 'aca-foundry-independent', title: 'Build an independent Foundry brief API', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 40,
  brief: 'A private .NET 10 API already pulls from ACR. Independently provision a simulated AIServices account, project and second deployment, attach a separate inference identity, authorize it, and build a POST /api/brief contract with bounded retries. Prove valid, invalid, transient and persistent outcomes through named deterministic requests. No Azure service or model is contacted.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 12, labMode: 'independent',
  manifestId: INDEPENDENT_FOUNDRY_MANIFEST.id, capabilities: { acrBuild: true, foundryInference: true },
  initialProjectFiles: INDEPENDENT_FOUNDRY_STARTER_FILES, initializeSimulation,
  stages: [{ id: 'requirements', title: 'Independent requirements',
    taskIds: ['account', 'resources', 'identity', 'access', 'deploy', 'valid', 'invalid', 'transient', 'persistent'] }],
  scenarios: Object.freeze({
    valid: fixture('Brief valid content', 'A private Container App calls its second Foundry deployment.', [], 200),
    invalid: fixture('Reject blank content', '   ', [], 400),
    transient: fixture('Recover from a transient 429', 'A brief that encounters one transient throttle.',
      [{ status: 429, durationMs: 100, retryAfterSeconds: 1 }, { status: 200, durationMs: 100 }], 200),
    persistent: fixture('Bound persistent 429 responses', 'A brief that encounters persistent throttling.',
      [{ status: 429, durationMs: 100 }, { status: 429, durationMs: 100 }, { status: 429, durationMs: 100 }], 503, 'UPSTREAM_UNAVAILABLE'),
  }),
  tasks: [
    { id: 'account', stageId: 'requirements', text: 'Create an AIServices account with its own project-management identity and inspect its resource endpoint.', check: accountReady,
      hints: ['Create an AIServices S0 account in East US with a custom domain.', 'Enable project management and the account management identity; it does not authorize the API caller.'],
      solution: solution(command(accountCreate), command(`az cognitiveservices account show -g ${group} -n ${account}`)),
      examNote: 'The account resource /openai/v1/ endpoint serves Responses inference; the account identity manages projects.' },
    { id: 'resources', stageId: 'requirements', text: 'Create a project and the briefing-secondary account deployment using the simulated gpt-5-mini profile.', check: resourcesReady,
      hints: ['Projects and deployments belong to the AIServices account.', 'Use briefing-secondary as the deployment name; it differs from the underlying model name.'],
      solution: solution(command(projectCreate), command(deploymentCreate)),
      examNote: 'The Responses model argument uses the account deployment name. The model profile is a simulator fixture.' },
    { id: 'identity', stageId: 'requirements', text: 'Attach the existing dedicated inference identity while keeping the pull identity attached and selected for ACR.', check: attached,
      hints: ['Inspect both user-assigned identities and the app registry identity.', 'Use az containerapp identity assign --user-assigned with the inference identity ARM ID.'],
      solution: solution(command(attach), command(`az containerapp identity show -g ${group} -n ${app}`)),
      examNote: 'Adding an identity does not create a revision; the running application must later capture AZURE_CLIENT_ID.' },
    { id: 'access', stageId: 'requirements', text: 'Grant the dedicated inference principal Cognitive Services User at the exact AIServices account scope.', check: accessReady,
      hints: ['The inference principal differs from the pull principal and account management identity.', 'Grant Cognitive Services User on the account ARM ID, then inspect its role assignments.'],
      solution: solution(command(grant), command(`az role assignment list --scope ${accountId}`)),
      examNote: 'AcrPull cannot authorize inference, and project or registry scope cannot replace the account-scoped grant.' },
    { id: 'deploy', stageId: 'requirements', text: 'Select the inference UAMI with AZURE_CLIENT_ID; save a supported POST /api/brief source and bounded 2 or 3 attempt policy, build, and redeploy the active image.', check: deployed,
      hints: ['Save supported C# brief code and appsettings with the account endpoint, briefing-secondary and a five to eight second budget.', 'Choose two or three total attempts, a one or two second attempt cap and HonorRetryAfter true; disable SDK retries. Build and redeploy.'],
      solution: solution(command(client), file(programPath, INDEPENDENT_FOUNDRY_SOLUTION_FILES[programPath]),
        file(settingsPath, INDEPENDENT_FOUNDRY_SOLUTION_FILES[settingsPath]), command(build), command(redeploy)),
      examNote: 'One explicit retry owner stays within the active deadline; saving or building alone does not change the running API.' },
    { id: 'valid', stageId: 'requirements', text: 'Send valid content to POST /api/brief; prove public 200 with {brief,deployment} and one correlated call to briefing-secondary.', check: activeReady,
      dependencies, verification: { scenarioId: 'valid', scenarioVersion: 1 },
      hints: ['Run the named valid fixture after deploying the brief source.', 'Inspect the public body and the upstream account, deployment, principal and correlation ID.'],
      solution: solution(request('valid')), examNote: 'A successful public brief must come from a real correlated model invocation.' },
    { id: 'invalid', stageId: 'requirements', text: 'Send blank content; prove public 400 and zero upstream attempts under the intended active configuration.', check: activeReady,
      dependencies, verification: { scenarioId: 'invalid', scenarioVersion: 1 },
      hints: ['Run the named invalid fixture.', 'Validation short-circuits before inference, but proof also requires the intended caller and deployment.'],
      solution: solution(request('invalid')), examNote: 'Invalid content consumes no model attempts.' },
    { id: 'transient', stageId: 'requirements', text: 'Recover from a transient upstream 429 using Retry-After; prove public 200 within the active budget of at most eight seconds.', check: activeReady,
      dependencies, verification: { scenarioId: 'transient', scenarioVersion: 1 },
      hints: ['Run the named transient fixture.', 'Inspect the 429, the honored one-second Retry-After and the second successful attempt.'],
      solution: solution(request('transient')), examNote: 'Retry-After is honored when it fits the one request budget.' },
    { id: 'persistent', stageId: 'requirements', text: 'Exhaust two or three attempts against persistent 429; prove controlled public 503 within the active budget of at most eight seconds.', check: activeReady,
      dependencies, verification: { scenarioId: 'persistent', scenarioVersion: 1 },
      hints: ['Run the named persistent fixture.', 'The trace must stop at the active attempt limit and return public 503 after bounded exhaustion.'],
      solution: solution(request('persistent')), examNote: 'A persistent upstream throttle is exposed as controlled public 503 after the bounded policy.' },
  ],
}
