import { PROJECT_MANIFEST, SOLUTION_FILES } from '../../templates/containerapps-dotnet/starter.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { createDeploymentCriteria } from './deployment-criteria.js'

const group = 'rg-aca-cpu-independent'
const registry = 'acrcpuindependent'
const environment = 'env-cpu-independent'
const identity = 'id-cpu-independent'
const app = 'api-cpu-independent'
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
const scenarioSteps = (scenarioId) => [
  { kind: 'scenario', action: { type: 'scenario-start', scenarioId }, instruction: `Start ${scenarioId} in CPU Experiment Controls.` },
  { kind: 'scenario', action: { type: 'simulation-advance', seconds: 90 }, instruction: 'Advance all 90 simulated seconds, then inspect the measurements.' },
]
const solution = (...steps) => ({ steps })
const appFor = (context) => context.sandbox.containerApps.find((item) => item.id?.toLowerCase() === appId.toLowerCase()
  || (item.name.toLowerCase() === app && item.resourceGroup.toLowerCase() === group))

function policyReady(context) {
  const resource = appFor(context)
  const rule = resource?.scaleRules?.[0]
  return deploymentReady(context)
    && ((resource.cpu === 0.5 && resource.memory === '1Gi') || (resource.cpu === 1 && resource.memory === '2Gi'))
    && resource.minReplicas === 1 && resource.maxReplicas >= 1 && resource.maxReplicas <= 4
    && resource.scaleRules.length === 1 && rule?.custom?.type === 'cpu'
    && rule.custom.metadata?.type === 'Utilization'
    && Number.isInteger(Number(rule.custom.metadata.value))
    && Number(rule.custom.metadata.value) >= 1 && Number(rule.custom.metadata.value) <= 100
}

const dependencies = {
  [`scaling:${appId}`]: (context) => ({ cpu: appFor(context)?.cpu ?? null, memory: appFor(context)?.memory ?? null,
    min: appFor(context)?.minReplicas ?? null, max: appFor(context)?.maxReplicas ?? null,
    rules: appFor(context)?.scaleRules ?? [] }),
  [`deployment:${appId}`]: (context) => ({ active: deploymentEntry(context)?.active ?? null,
    desired: deploymentEntry(context)?.desired ?? null, status: deploymentEntry(context)?.status ?? null }),
}

function successfulProof(context, taskId) {
  const id = context.evidence.currentEvidenceByTask[taskId]
  const record = context.evidence.experimentsById[id]
  if (record?.taskId !== taskId || record.completed !== true || record.outcome !== 'passed') return null
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
  'proof:steady': (context) => successfulProof(context, 'steady')?.id ?? null,
  'proof:burst': (context) => successfulProof(context, 'burst')?.id ?? null,
}

function quietReady(context) {
  const quiet = context.evidence.experimentsById[context.evidence.currentEvidenceByTask.quiet]
  const steady = successfulProof(context, 'steady')
  const burst = successfulProof(context, 'burst')
  return policyReady(context) && !!quiet && !!steady && !!burst
    && steady.sequence < quiet.sequence && burst.sequence < quiet.sequence
}

function finalWindowServed(measurements, target) {
  const finalWindow = measurements.trace.slice(-15)
  return finalWindow.length === 15 && finalWindow.every((sample) =>
    Math.abs(sample.offeredThroughput - target) < 1e-9
      && sample.servedThroughput + 1e-9 >= target
      && sample.servedThroughput + 1e-9 >= sample.offeredThroughput)
}

function fixedResourceTimes(value) {
  if (Array.isArray(value)) value.forEach(fixedResourceTimes)
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
    if (key === 'createdAt') value[key] = '2026-09-22T00:00:00.000Z'
    else fixedResourceTimes(item)
  }
}

function initializeSimulation(run) {
  const lines = [
    `az group create -n ${group} -l eastus`,
    `az acr create -g ${group} -n ${registry} --sku Basic`,
    `az acr build --registry ${registry} --image api:v1 --file Dockerfile .`,
    `az identity create -g ${group} -n ${identity}`,
    `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`,
    `az containerapp env create -g ${group} -n ${environment} -l eastus`,
    `az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${image} --user-assigned ${identityId} --registry-server ${registry}.azurecr.io --registry-identity ${identityId} --env-vars APP_ENV=training --ingress external --target-port 8080 --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1`,
  ]
  let seeded = run
  for (const line of lines) {
    const result = applyRunAction(seeded, { type: 'command', line }, cpuIndependentLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) throw new Error(`CPU Independent seed failed at ${line}.`)
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}

const fixture = (title, demandCpuSecondsPerSecond, assess) => Object.freeze({
  kind: 'cpu', version: 1, appId, title, durationSeconds: 90, demandCpuSecondsPerSecond,
  requestCpuSeconds: 0.03, assess,
})

export const cpuIndependentLab = {
  id: 'aca-cpu-independent', title: 'Size CPU capacity', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 20,
  brief: 'A healthy private .NET API is already deployed. Choose either 0.5 CPU/1Gi or 1 CPU/2Gi, keep a minimum of one and a maximum of at most four replicas, and configure exactly one CPU Utilization rule with a supported target from 1% to 100%. Meet measured throughput requirements under steady and burst workloads, then demonstrate scale-in under quiet demand. Multiple resource sizes and targets can succeed. Each illustrative request costs 0.03 CPU-seconds. Utilization uses requested CPU as its denominator; this teaching model advances only when you choose Advance, scales every 15 seconds with 10% tolerance, takes 5 seconds to make new replicas ready, and waits 60 seconds of low demand before scale-in. Throughput is illustrative, not a real Azure performance or latency prediction.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 6, labMode: 'independent',
  manifestId: PROJECT_MANIFEST.id, capabilities: { acrBuild: true, cpuScaling: true },
  cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }, { cpu: 1, memory: '2Gi' }] },
  initialProjectFiles: SOLUTION_FILES, initializeSimulation,
  stages: [{ id: 'capacity', title: 'Capacity requirements', taskIds: ['steady', 'burst', 'quiet'] }],
  scenarios: Object.freeze({
    steady: fixture('Steady demand', 0.9, (measurements) => finalWindowServed(measurements, 30)),
    burst: fixture('Burst demand', 1.8, (measurements) => measurements.maxReadyReplicas > 1
      && measurements.endReadyReplicas > 1 && finalWindowServed(measurements, 60)),
    quiet: fixture('Quiet and scale-in', 0, (measurements) => measurements.startReadyReplicas > 1
      && measurements.endReadyReplicas === 1),
  }),
  tasks: [
    { id: 'steady', stageId: 'capacity', text: 'Choose 0.5 CPU/1Gi or 1 CPU/2Gi, minimum one and maximum no higher than four replicas, and exactly one CPU Utilization rule with any supported target from 1% to 100%. Under 0.9 CPU-seconds/second for 90 simulated seconds, serve all 30 offered illustrative requests per second throughout the final 15 seconds. Either resource size and any target that meets the measured goal is valid. Configuration changes invalidate both load proofs and require fresh runs.',
      check: policyReady, dependencies, verification: { scenarioId: 'steady', scenarioVersion: 1 },
      hints: ['Compare the offered and served requests per second over the final 15 samples. Requested CPU sets each ready replica’s capacity.', 'Choose a supported CPU/memory pair, minimum one, maximum at most four, and one CPU Utilization rule. For example, 0.5 CPU/1Gi with target 60% and maximum four can meet both load goals.'],
      solution: solution(command(`az containerapp update -g ${group} -n ${app} --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 4 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60`), ...scenarioSteps('steady')),
      examNote: 'A utilization target uses requested CPU as the denominator. Capacity must be checked from observed throughput, not a chosen target alone.' },
    { id: 'burst', stageId: 'capacity', text: 'Under 1.8 CPU-seconds/second for 90 simulated seconds, serve all 60 offered illustrative requests per second throughout the final 15 seconds, with more than one ready replica at the end. Keep the same supported CPU/memory pair, minimum one, maximum at most four, and one supported CPU Utilization rule. Steady and Burst can be proved in either order; rerun both after a configuration change.',
      check: policyReady, dependencies, verification: { scenarioId: 'burst', scenarioVersion: 1 },
      hints: ['The burst offers twice as much work as Steady. Inspect ready replicas and all 15 final throughput samples.', 'Check whether the chosen CPU size and maximum replicas can serve 1.8 CPU-seconds/second. A 0.5 CPU app needs four ready replicas; a 1 CPU app can use two.'],
      solution: solution(...scenarioSteps('burst')),
      examNote: 'A replica ceiling bounds service capacity even when utilization calls for more replicas.' },
    { id: 'quiet', stageId: 'capacity', text: 'After the latest successful Steady and Burst proofs, run zero demand for 90 simulated seconds. Start above the minimum and finish at one ready replica after stabilization. Quiet must follow both load proofs; repeat Quiet after either load is rerun.',
      check: quietReady, dependencies: quietDependencies, verification: { scenarioId: 'quiet', scenarioVersion: 1 },
      hints: ['Finish both Steady and Burst successfully first. Start Quiet while more than one replica is ready.', 'Run Quiet for all 90 simulated seconds. The model waits 60 seconds of low demand before a scale-in decision; rerun Quiet after any later load proof.'],
      solution: solution(...scenarioSteps('quiet')),
      examNote: 'Scale-in follows a stability window. The CPU-only Lab retains its minimum of one replica.' },
  ],
}
