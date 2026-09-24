import { PROJECT_MANIFEST, SOLUTION_FILES } from '../../templates/containerapps-dotnet/starter.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { createDeploymentCriteria } from './deployment-criteria.js'

const group = 'rg-aca-cpu-incident'
const registry = 'acrcpuincident'
const environment = 'env-cpu-incident'
const identity = 'id-cpu-incident'
const app = 'api-cpu-incident'
const image = `${registry}.azurecr.io/api:v1`
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
const identityId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity}`
const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
const principalId = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] },
  { resourceGroup: group, name: identity }).resource.principalId
const { deploymentEntry, deploymentReady } = createDeploymentCriteria({
  group, registry, environment, identity, app, service: 'contoso-api', port: 8080,
  environmentValue: 'training', requiredImage: image,
})
const command = (line) => ({ kind: 'command', line })
const scenarioStep = (scenarioId) => [
  { kind: 'scenario', action: { type: 'scenario-start', scenarioId }, instruction: `Start ${scenarioId} in CPU Experiment Controls.` },
  { kind: 'scenario', action: { type: 'simulation-advance', seconds: 90 }, instruction: 'Advance all 90 simulated seconds, then inspect the result.' },
]
const solution = (...steps) => ({ steps })
const finalWindow = (measurements) => measurements.trace.slice(-15)
const fullService = (measurements) => finalWindow(measurements).length === 15
  && finalWindow(measurements).every((sample) => sample.servedThroughput >= sample.offeredThroughput)
const appFor = (context) => context.sandbox.containerApps.find((item) => item.id?.toLowerCase() === appId.toLowerCase()
  || (item.name.toLowerCase() === app && item.resourceGroup.toLowerCase() === group))

function policyReady(context) {
  const resource = appFor(context)
  const rule = resource?.scaleRules?.[0]
  return deploymentReady(context) && resource.cpu === 0.5 && resource.memory === '1Gi'
    && resource.minReplicas === 1 && resource.maxReplicas >= 2 && resource.maxReplicas <= 5
    && resource.scaleRules.length === 1 && rule?.custom?.type === 'cpu'
    && rule.custom.metadata?.type === 'Utilization' && Number(rule.custom.metadata.value) === 60
}

const dependencies = {
  [`scaling:${appId}`]: (context) => ({ cpu: appFor(context)?.cpu ?? null, memory: appFor(context)?.memory ?? null,
    min: appFor(context)?.minReplicas ?? null, max: appFor(context)?.maxReplicas ?? null,
    rules: appFor(context)?.scaleRules ?? [] }),
  [`deployment:${appId}`]: (context) => ({ active: deploymentEntry(context)?.active ?? null,
    desired: deploymentEntry(context)?.desired ?? null, status: deploymentEntry(context)?.status ?? null }),
}
function successfulRecovery(context) {
  const id = context.evidence.currentEvidenceByTask.recovery
  const record = context.evidence.experimentsById[id]
  if (record?.taskId !== 'recovery' || record.completed !== true || record.outcome !== 'passed') return null
  const current = Object.entries(dependencies).every(([key, select]) => {
    try {
      return Object.hasOwn(record.dependencyValues ?? {}, key)
        && Object.hasOwn(record.dependencyGenerations ?? {}, key)
        && canonicalize(record.dependencyValues[key]) === canonicalize(select(context))
        && record.dependencyGenerations[key] === (context.dependencyGenerations[key] ?? 0)
    } catch { return false }
  })
  return current ? record : null
}
const quietDependencies = {
  ...dependencies,
  'proof:recovery': (context) => successfulRecovery(context)?.id ?? null,
}
function quietReady(context) {
  const quiet = context.evidence.experimentsById[context.evidence.currentEvidenceByTask.quiet]
  const recovery = successfulRecovery(context)
  return policyReady(context) && !!quiet && !!recovery && recovery.sequence < quiet.sequence
}

function fixedResourceTimes(value) {
  if (Array.isArray(value)) value.forEach(fixedResourceTimes)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'createdAt') value[key] = '2026-09-22T00:00:00.000Z'
    else fixedResourceTimes(item)
  }
}

function initializeSimulation(run) {
  const actions = [
    { type: 'command', line: `az group create -n ${group} -l eastus` },
    { type: 'command', line: `az acr create -g ${group} -n ${registry} --sku Basic` },
    { type: 'command', line: `az acr build --registry ${registry} --image api:v1 --file Dockerfile .` },
    { type: 'command', line: `az identity create -g ${group} -n ${identity}` },
    { type: 'command', line: `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}` },
    { type: 'command', line: `az containerapp env create -g ${group} -n ${environment} -l eastus` },
    { type: 'command', line: `az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${image} --user-assigned ${identityId} --registry-server ${registry}.azurecr.io --registry-identity ${identityId} --env-vars APP_ENV=training --ingress external --target-port 8080 --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1` },
    { type: 'command', line: `az containerapp update -g ${group} -n ${app} --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60` },
    { type: 'scenario-start', scenarioId: 'incident' },
    { type: 'simulation-advance', seconds: 30 },
  ]
  let seeded = run
  for (const action of actions) {
    const result = applyRunAction(seeded, action, cpuTroubleshootingLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) {
      throw new Error(`CPU incident seed failed at ${action.line ?? action.type}.`)
    }
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

const fixture = (title, demandCpuSecondsPerSecond, assess) => Object.freeze({
  kind: 'cpu', version: 1, appId, title, durationSeconds: 90, demandCpuSecondsPerSecond,
  requestCpuSeconds: 0.02, assess,
})

export const cpuTroubleshootingLab = {
  id: 'aca-cpu-troubleshooting', title: 'Recover CPU scaling', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 20,
  brief: 'A private .NET API is deployed and an incident workload has been running for 30 simulated seconds. It offers 0.8 CPU-seconds of work per second, or 40 illustrative requests per second at 0.02 CPU-seconds each. The latest sample shows one ready replica at 100% CPU, serving 25 of 40 offered requests per second. Inspect the app and its CPU policy, then restore full service under the unchanged workload. Keep the API at 0.5 CPU/1Gi, minimum one replica, a 60% CPU utilization target, and a maximum no higher than five. Repeat the 90-second workload to verify the final 15 seconds, then show scale-in under zero demand. This teaching model uses explicit simulated time, 15-second scaling decisions with 10% tolerance, 5-second readiness and 60-second scale-in stability. Throughput is illustrative, not an Azure capacity prediction.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 5, labMode: 'troubleshooting',
  manifestId: PROJECT_MANIFEST.id, capabilities: { acrBuild: true, cpuScaling: true },
  cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }, { cpu: 1, memory: '2Gi' }] },
  initialProjectFiles: SOLUTION_FILES, initializeSimulation,
  stages: [{ id: 'recover', title: 'Diagnose and verify', taskIds: ['recovery', 'quiet'] }],
  scenarios: Object.freeze({
    incident: fixture('Sustained incident workload', 0.8, (m) => m.endReadyReplicas > 1 && fullService(m)),
    quiet: fixture('Quiet and scale-in', 0, (m) => m.startReadyReplicas > 1 && m.endReadyReplicas === 1),
  }),
  tasks: [
    { id: 'recovery', stageId: 'recover', text: 'Restore full service for the unchanged 0.8 CPU-seconds/second workload. Keep 0.5 CPU/1Gi, minimum one replica, a 60% CPU target and a maximum of at most five. In a fresh completed 90-second incident run, verify more than one ready replica and full offered throughput throughout the final 15 seconds.',
      check: policyReady, dependencies, verification: { scenarioId: 'incident', scenarioVersion: 1 },
      hints: ['Compare observed CPU, offered and served throughput, current ready replicas and the configured scaling policy on the Container App.', 'The current replica ceiling holds the app at one ready replica. Raise the maximum within the allowed limit, then rerun the same incident workload for all 90 seconds.'],
      solution: solution(command(`az containerapp update -g ${group} -n ${app} --max-replicas 3`), ...scenarioStep('incident')),
      examNote: 'A 60% CPU target asks the scaler when to add replicas; the maximum replica count still bounds capacity. A target is not a guarantee that offered work can be served.' },
    { id: 'quiet', stageId: 'recover', text: 'After the successful recovery run, run zero demand for 90 simulated seconds. Verify the scenario starts above one ready replica and returns to the minimum of one after stabilization. Repeat Quiet if you rerun the incident workload.',
      check: quietReady, dependencies: quietDependencies, verification: { scenarioId: 'quiet', scenarioVersion: 1 },
      hints: ['Begin Quiet while more than one replica is ready, following a successful sustained run.', 'Start Quiet and advance all 90 seconds. The model requires 60 seconds of low demand before a scale-in decision.'],
      solution: solution(...scenarioStep('quiet')),
      examNote: 'Scale-in waits for a sustained low-demand period. This CPU-only exercise retains the configured minimum of one replica.' },
  ],
}
