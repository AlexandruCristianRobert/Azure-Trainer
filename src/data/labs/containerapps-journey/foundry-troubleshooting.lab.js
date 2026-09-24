import { TROUBLESHOOTING_FOUNDRY_MANIFEST, TROUBLESHOOTING_FOUNDRY_STARTER_FILES } from '../../templates/containerapps-dotnet/foundry-troubleshooting.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { foundryEvidenceDependencies, foundryInferenceReady } from '../../../lib/simulation/inference.js'

const group = 'rg-aca-foundry-incident', registry = 'acrfoundryincident', environment = 'env-foundry-incident'
const identity = 'id-foundry-incident', app = 'api-foundry-incident', account = 'foundryincident'
const project = 'summarizer-project', deployment = 'summarizer-primary'
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
const identityId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const accountId = `${root}/providers/Microsoft.CognitiveServices/accounts/${account}`
const endpoint = `https://${account}.services.ai.azure.com/openai/v1/`
const image = `${registry}.azurecr.io/api:v1`
const settingsPath = 'src/Trainer.Api/appsettings.json'
const principalId = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] },
  { resourceGroup: group, name: identity }).resource.principalId
const clientId = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] },
  { resourceGroup: group, name: identity }).resource.clientId
const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()
const command = (line) => ({ kind: 'command', line })
const file = (path, content) => ({ kind: 'file', path, content })
const request = (scenarioId) => ({ kind: 'scenario', action: { type: 'request', scenarioId },
  instruction: `Send the named ${scenarioId} POST fixture in Foundry Request Controls.` })
const solution = (...steps) => ({ steps })
const build = command(`az acr build --registry ${registry} --image api:v1 --file Dockerfile .`)
const redeploy = command(`az containerapp update -g ${group} -n ${app} --image ${image}`)
const grant = command(`az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role "Cognitive Services User" --scope ${accountId}`)
const settings = JSON.parse(TROUBLESHOOTING_FOUNDRY_STARTER_FILES[settingsPath])
const settingsText = (changes) => `${JSON.stringify({ ...settings, ...changes }, null, 2)}\n`
const endpointSettings = settingsText({ FoundryEndpoint: endpoint })
const deploymentSettings = settingsText({ FoundryEndpoint: endpoint, FoundryDeployment: deployment })
const policySettings = settingsText({ FoundryEndpoint: endpoint, FoundryDeployment: deployment,
  TotalAttempts: 3, TotalBudgetSeconds: 10, AttemptTimeoutSeconds: 3, HonorRetryAfter: true })

function observed(context, taskId, diagnosticCode) {
  return Object.values(context.evidence.experimentsById).some((record) => record.taskId === taskId
    && record.outcome === 'passed' && record.completed === true
    && record.measurements?.observation === 'diagnostic'
    && record.measurements?.diagnosticCode === diagnosticCode
    && record.measurements?.upstream?.attempts?.length === 0)
}
const active = (context) => context.runtime.deploymentsByApp[appId]?.active
const activeConfig = (context) => active(context)?.foundry
const accountReady = (context) => context.sandbox.foundryAccounts.some((item) => same(item.id, accountId)
  && item.kind === 'AIServices' && item.projects.some((child) => child.name === project)
  && item.deployments.some((child) => child.name === deployment))
const endpointReady = (context) => observed(context, 'endpoint', 'FOUNDRY_ACCOUNT_NOT_FOUND')
  && accountReady(context) && same(activeConfig(context)?.endpoint, endpoint)
const deploymentReady = (context) => endpointReady(context)
  && observed(context, 'deployment', 'FOUNDRY_DEPLOYMENT_NOT_FOUND')
  && activeConfig(context)?.deployment === deployment
const accessReady = (context) => observed(context, 'access', 'FOUNDRY_ACCESS_DENIED')
  && same(activeConfig(context)?.endpoint, endpoint) && activeConfig(context)?.deployment === deployment
  && same(activeConfig(context)?.principalId, principalId)
  && foundryInferenceReady(context, appId)
const policyReady = (context) => accessReady(context) && activeConfig(context)?.maxAttempts === 3
  && activeConfig(context)?.timeoutSeconds === 10 && activeConfig(context)?.attemptTimeoutSeconds === 3
  && activeConfig(context)?.honorRetryAfter === true
const dependencies = foundryEvidenceDependencies(appId)
const proofDependencies = {
  transient: dependencies,
  persistent: { ...dependencies, 'proof:transient': (context) => currentProof(context, 'transient')?.id ?? null },
  timeout: { ...dependencies, 'proof:persistent': (context) => currentProof(context, 'persistent')?.id ?? null },
  healthy: { ...dependencies, 'proof:timeout': (context) => currentProof(context, 'timeout')?.id ?? null },
}
const predecessor = { persistent: 'transient', timeout: 'persistent', healthy: 'timeout' }
function currentProof(context, taskId) {
  const id = context.evidence.currentEvidenceByTask[taskId]
  const record = context.evidence.experimentsById[id]
  if (record?.taskId !== taskId || record.scenarioId !== taskId || record.scenarioVersion !== 1
    || record.outcome !== 'passed' || record.completed !== true) return null
  const prior = predecessor[taskId] ? currentProof(context, predecessor[taskId]) : null
  if (predecessor[taskId] && (!prior || record.sequence <= prior.sequence)) return null
  const selectors = proofDependencies[taskId]
  if (Object.keys(record.dependencyValues ?? {}).length !== Object.keys(selectors).length
    || Object.keys(record.dependencyGenerations ?? {}).length !== Object.keys(selectors).length) return null
  for (const [key, select] of Object.entries(selectors)) {
    try {
      if (canonicalize(record.dependencyValues[key]) !== canonicalize(select(context))
        || record.dependencyGenerations[key] !== (context.dependencyGenerations[key] ?? 0)) return null
    } catch { return null }
  }
  return record
}
const after = (taskId) => (context) => policyReady(context) && !!currentProof(context, taskId)

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
    `az containerapp env create -g ${group} -n ${environment} -l eastus`,
    `az cognitiveservices account create -g ${group} -n ${account} -l eastus --kind AIServices --sku S0 --custom-domain ${account} --assign-identity --allow-project-management true`,
    `az cognitiveservices account project create -g ${group} -n ${account} --project-name ${project} -l eastus`,
    `az cognitiveservices account deployment create -g ${group} -n ${account} --deployment-name ${deployment} --model-name gpt-5-mini --model-version 2025-08-07 --model-format OpenAI --sku-capacity 10 --sku-name GlobalStandard`,
    build.line,
    `az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${image} --user-assigned ${identityId} --registry-server ${registry}.azurecr.io --registry-identity ${identityId} --env-vars APP_ENV=training AZURE_CLIENT_ID=${clientId} --ingress external --target-port 8080`,
  ]
  let seeded = run
  for (const line of lines) {
    const result = applyRunAction(seeded, { type: 'command', line }, foundryTroubleshootingLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) {
      throw new Error(`Foundry incident seed failed at ${line}: ${JSON.stringify(result.diagnostics)}`)
    }
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}
const fixture = (title, attempts, status, diagnosticCode) => Object.freeze({ kind: 'foundry', version: 1, appId, title,
  request: { method: 'POST', path: '/api/summarize', body: { text: 'Summarize the Container Apps incident and its recovery.' } },
  faultProfile: { attempts }, expected: { status, ...(diagnosticCode ? { diagnosticCode } : {}) } })

export const foundryTroubleshootingLab = {
  id: 'aca-foundry-troubleshooting', title: 'Diagnose Foundry model failures', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 35,
  brief: 'A running .NET 10 Container App has a wrong Foundry resource endpoint, a missing deployment name, no inference grant for its caller, and an inadequate retry policy. Diagnose each stage from named POST requests, save and redeploy the repairs, then prove bounded 429 recovery, controlled 503/504 responses and a final healthy call. All requests, model outcomes and traces are local deterministic simulations; no Azure service or model is contacted.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 11, labMode: 'troubleshooting',
  manifestId: TROUBLESHOOTING_FOUNDRY_MANIFEST.id, capabilities: { acrBuild: true, foundryInference: true },
  initialProjectFiles: TROUBLESHOOTING_FOUNDRY_STARTER_FILES, initializeSimulation,
  stages: [
    { id: 'endpoint', title: 'Repair the resource endpoint', taskIds: ['endpoint', 'endpointRepair'] },
    { id: 'deployment', title: 'Repair the deployment', taskIds: ['deployment', 'deploymentRepair'] },
    { id: 'identity', title: 'Authorize the caller', taskIds: ['access', 'accessRepair'] },
    { id: 'resilience', title: 'Bound and verify retries', taskIds: ['policy', 'transient', 'persistent', 'timeout', 'healthy'] },
  ],
  scenarios: Object.freeze({
    endpoint: fixture('Diagnose wrong resource endpoint', [], 502, 'FOUNDRY_ACCOUNT_NOT_FOUND'),
    deployment: fixture('Diagnose missing deployment', [], 502, 'FOUNDRY_DEPLOYMENT_NOT_FOUND'),
    access: fixture('Diagnose caller access', [], 502, 'FOUNDRY_ACCESS_DENIED'),
    transient: fixture('Recover from one 429', [{ status: 429, durationMs: 100, retryAfterSeconds: 2 }, { status: 200, durationMs: 100 }], 200),
    persistent: fixture('Persistent 429', [{ status: 429, durationMs: 100 }, { status: 429, durationMs: 100 }, { status: 429, durationMs: 100 }], 503, 'UPSTREAM_UNAVAILABLE'),
    timeout: fixture('Deadline after slow attempts', [{ status: 504, durationMs: 5000 }, { status: 504, durationMs: 5000 }, { status: 504, durationMs: 5000 }], 504, 'UPSTREAM_DEADLINE'),
    healthy: fixture('Healthy model request', [], 200),
  }),
  tasks: [
    { id: 'endpoint', stageId: 'endpoint', text: 'Send the named Endpoint request. Identify FOUNDRY_ACCOUNT_NOT_FOUND with zero upstream attempts while the active app points to an unrecognized resource endpoint.',
      check: (context) => accountReady(context), verification: { scenarioId: 'endpoint', scenarioVersion: 1 },
      hints: ['Inspect the active endpoint and the account resource endpoint.', 'The wrong resource name prevents any upstream invocation. Send the Endpoint fixture before editing.'],
      solution: solution(request('endpoint')), examNote: 'An endpoint mismatch is a local configuration diagnosis; it is not a model 429 or a replica problem.' },
    { id: 'endpointRepair', stageId: 'endpoint', text: 'Save the account resource /openai/v1/ endpoint, build the project and redeploy. Keep the missing deployment name so the next diagnostic is visible.',
      check: endpointReady,
      hints: ['Read the AIServices account endpoint; the project endpoint is different.', 'Edit appsettings.json, save, build api:v1 and update the app. Draft or build alone cannot repair the running API.'],
      solution: solution(file(settingsPath, endpointSettings), build, redeploy),
      examNote: 'The active image captures the endpoint after redeployment; only the account resource endpoint serves Responses inference.' },
    { id: 'deployment', stageId: 'deployment', text: 'Send the named Deployment request. Identify FOUNDRY_DEPLOYMENT_NOT_FOUND with zero upstream attempts on the now correct account endpoint.',
      check: endpointReady, verification: { scenarioId: 'deployment', scenarioVersion: 1 },
      hints: ['Inspect the active deployment name and the account deployment list.', 'The Responses API model value is the account deployment name, not the base model name.'],
      solution: solution(request('deployment')), examNote: 'A missing deployment is distinct from a wrong account endpoint and is found before model invocation.' },
    { id: 'deploymentRepair', stageId: 'deployment', text: 'Save summarizer-primary as the deployment name, build and redeploy. Preserve the correct resource endpoint.',
      check: deploymentReady,
      hints: ['Use the account deployment name, summarizer-primary.', 'Save appsettings.json, build the new image and redeploy it before testing access.'],
      solution: solution(file(settingsPath, deploymentSettings), build, redeploy),
      examNote: 'The deployment name becomes the model argument of the Responses call in the running app.' },
    { id: 'access', stageId: 'identity', text: 'Send the named Access request. Identify FOUNDRY_ACCESS_DENIED with zero upstream attempts for the Container App caller.',
      check: deploymentReady, verification: { scenarioId: 'access', scenarioVersion: 1 },
      hints: ['Inspect the active caller principal and exact Foundry account role assignments.', 'The account management identity and AcrPull assignment are separate from inference authorization.'],
      solution: solution(request('access')), examNote: 'Authentication and authorization fail before a model call. Retrying or scaling replicas does not grant access.' },
    { id: 'accessRepair', stageId: 'identity', text: 'Grant the app caller principal Cognitive Services User at the exact AIServices account scope and inspect the role assignment.',
      check: accessReady,
      hints: ['Use the principal ID of the user-assigned identity attached to the Container App.', 'Assign Cognitive Services User on the Foundry account ARM ID, not on ACR, the project, or the account management identity.'],
      solution: solution(grant, command(`az role assignment list --scope ${accountId}`)),
      examNote: 'A resource-scoped inference role authorizes the actual Container App caller. An ACR pull role only retrieves images.' },
    { id: 'policy', stageId: 'resilience', text: 'Save TotalAttempts 3, TotalBudgetSeconds 10, AttemptTimeoutSeconds 3 and HonorRetryAfter true. Build and redeploy so the active API captures the bounded policy.',
      check: policyReady,
      hints: ['Inspect the active policy; the starter allows only one attempt and ignores Retry-After.', 'Save appsettings.json, build and redeploy. The running policy has one retry loop and SDK retries disabled.'],
      solution: solution(file(settingsPath, policySettings), build, redeploy),
      examNote: 'Retry attempts, per-attempt cap and delays all consume one overall deadline. The active deployment, not a draft, controls requests.' },
    { id: 'transient', stageId: 'resilience', text: 'Run Transient: upstream 429 with Retry-After 2 seconds, then success. Show public 200 with exactly two correlated attempts and a two-second delay.',
      check: policyReady, dependencies: proofDependencies.transient, verification: { scenarioId: 'transient', scenarioVersion: 1 },
      hints: ['Use the named Transient fixture after redeploying the retry policy.', 'Compare the public 200 with attempt 1 status 429, its 2-second delay and attempt 2 status 200.'],
      solution: solution(request('transient')), examNote: 'A single transient throttle may recover within the declared retry and deadline budget.' },
    { id: 'persistent', stageId: 'resilience', text: 'Run Persistent: three upstream 429 responses. Show exactly three attempts and a controlled public 503 after bounded exhaustion.',
      check: after('transient'), dependencies: proofDependencies.persistent, verification: { scenarioId: 'persistent', scenarioVersion: 1 },
      hints: ['Use the named Persistent fixture with the active three-attempt policy.', 'Inspect all upstream 429 attempts; the public response is 503 after exhaustion.'],
      solution: solution(request('persistent')), examNote: 'A persistent throttling failure ends at the total attempt limit; more replicas do not increase this model quota.' },
    { id: 'timeout', stageId: 'resilience', text: 'Run Timeout: slow upstream attempts consume the ten-second overall deadline. Show capped attempt durations and a public 504.',
      check: after('persistent'), dependencies: proofDependencies.timeout, verification: { scenarioId: 'timeout', scenarioVersion: 1 },
      hints: ['Use the named Timeout fixture and inspect each duration plus intervening delays.', 'The per-attempt cap is three seconds; the overall deadline ends the final attempt at ten seconds.'],
      solution: solution(request('timeout')), examNote: 'A deadline or per-attempt timeout is a 504 here after the bounded policy, separate from a local configuration failure.' },
    { id: 'healthy', stageId: 'resilience', text: 'Send the Healthy request unchanged. Prove public 200, the intended summarizer-primary deployment and one successful correlated upstream attempt.',
      check: after('timeout'), dependencies: proofDependencies.healthy, verification: { scenarioId: 'healthy', scenarioVersion: 1 },
      hints: ['Use the named Healthy fixture after the repairs and resilience observations.', 'Confirm the response deployment, caller principal, correlation ID and single upstream status 200.'],
      solution: solution(request('healthy')), examNote: 'A healthy request remains successful after the error handling is verified; dependency faults are fixed named fixtures.' },
  ],
}
