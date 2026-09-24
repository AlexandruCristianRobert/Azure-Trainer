import { PROJECT_MANIFEST, SOLUTION_FILES } from '../../templates/containerapps-dotnet/starter.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { createDeploymentCriteria } from './deployment-criteria.js'

const group = 'rg-aca-incident'
const registry = 'acrincident'
const environment = 'env-incident'
const identity = 'id-incident'
const app = 'api-incident'
const image = `${registry}.azurecr.io/api:v1`
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
const identityId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const principalId = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] },
  { resourceGroup: group, name: identity }).resource.principalId
const command = (...lines) => ({ steps: lines.map((line) => ({ kind: 'command', line })) })
const grant = `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`
const imageRepair = `az containerapp update -g ${group} -n ${app} --image ${image}`
const portRepair = `az containerapp ingress enable -g ${group} -n ${app} --type external --target-port 8080`

function fixedResourceTimes(value) {
  if (Array.isArray(value)) value.forEach(fixedResourceTimes)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'createdAt') value[key] = '2026-09-22T00:00:00.000Z'
    else fixedResourceTimes(item)
  }
}

function initializeSimulation(run) {
  const commands = [
    `az group create -n ${group} -l eastus`,
    `az acr create -g ${group} -n ${registry} --sku Basic`,
    `az acr build --registry ${registry} --image api:v1 --file Dockerfile .`,
    `az identity create -g ${group} -n ${identity}`,
    `az containerapp env create -g ${group} -n ${environment} -l eastus`,
    `az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${registry}.azurecr.io/api:missing --user-assigned ${identityId} --registry-server ${registry}.azurecr.io --registry-identity ${identityId} --env-vars APP_ENV=training --ingress external --target-port 9090`,
  ]
  let seeded = run
  for (const line of commands) {
    const result = applyRunAction(seeded, { type: 'command', line }, deployTroubleshootingLab)
    if (result.lines.some((item) => item.kind === 'err') || (line !== commands.at(-1) && result.diagnostics.length)) {
      throw new Error(`The deployment incident seed failed at ${line}.`)
    }
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime,
    nextSequence: seeded.nextSequence }
}

const { deploymentEntry, deploymentReady } = createDeploymentCriteria({
  group, registry, environment, identity, app, service: 'contoso-api', port: 8080,
  environmentValue: 'training',
})

export const deployTroubleshootingLab = {
  id: 'aca-deploy-troubleshooting', title: 'Recover a Container App deployment', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 20,
  brief: 'A supplied .NET 10 API deployment has failed to start. Inspect the simulated deployment, registry, identity and logs; restore the API and verify its response.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 2,
  labMode: 'troubleshooting', manifestId: PROJECT_MANIFEST.id,
  capabilities: { acrBuild: true }, initialProjectFiles: SOLUTION_FILES, initializeSimulation,
  stages: [{ id: 'recover', title: 'Diagnose and recover', taskIds: ['recovery', 'response'] }],
  scenarios: Object.freeze({ info: Object.freeze({ version: 1, appId,
    request: Object.freeze({ method: 'GET', path: '/api/info' }),
    expected: Object.freeze({ status: 200, body: Object.freeze({ service: 'contoso-api', environment: 'training' }) }) }) }),
  tasks: [
    { id: 'recovery', stageId: 'recover',
      text: 'Restore `api-incident` from the supplied API image so the current deployment runs with external ingress on port 8080 and `APP_ENV=training`.',
      check: deploymentReady,
      hints: ['Inspect the deployment diagnostics and compare its image with the tags published in `acrincident`.',
        'After selecting a published tag, inspect the app identity and its registry access, then compare the ingress target with the API listener.'],
      solution: command(imageRepair, grant, imageRepair, portRepair),
      examNote: 'Image publication, exact registry pull authorization and ingress routing are separate requirements. A failed desired update may leave an earlier active version running.' },
    { id: 'response', stageId: 'recover',
      text: 'Send `GET /api/info` to the recovered app and observe HTTP 200 with service `contoso-api` and environment `training`.',
      check: deploymentReady,
      dependencies: { [`deployment:${appId}`]: (context) => ({ generation: deploymentEntry(context)?.active?.generation ?? null,
        artifactId: deploymentEntry(context)?.active?.artifactId ?? null,
        desired: deploymentEntry(context)?.desired ?? null,
        status: deploymentEntry(context)?.status ?? null }) },
      verification: { scenarioId: 'info', scenarioVersion: 1 },
      hints: ['Use Experiment Controls to call the current deployment.',
        'Select `api-incident`, GET and `/api/info`, then inspect the status, body and deployment version.'],
      solution: { steps: [{ kind: 'experiment', request: { appId, method: 'GET', path: '/api/info' },
        expected: { status: 200, body: { service: 'contoso-api', environment: 'training' } } }] },
      examNote: 'The response proves the active captured artifact and configuration serve the expected route; a successful command alone does not.' },
  ],
}
