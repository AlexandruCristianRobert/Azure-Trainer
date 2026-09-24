import { PROJECT_MANIFEST, SOLUTION_FILES } from '../../templates/containerapps-dotnet/starter.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { createDeploymentCriteria } from './deployment-criteria.js'

const group = 'rg-aca-cpu'
const registry = 'acrcpuguided'
const environment = 'env-cpu'
const identity = 'id-cpu'
const app = 'api-cpu'
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
const policyCommand = `az containerapp update -g ${group} -n ${app} --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 5 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60`
const command = (line) => ({ kind: 'command', line })
const scenarioStep = (scenarioId, durationSeconds) => [
  { kind: 'scenario', action: { type: 'scenario-start', scenarioId }, instruction: `Start ${scenarioId} in CPU Experiment Controls.` },
  { kind: 'scenario', action: { type: 'simulation-advance', seconds: durationSeconds }, instruction: `Advance the full ${durationSeconds} simulated seconds and inspect the result.` },
]
const solution = (...steps) => ({ steps })
const finalWindow = (measurements) => measurements.trace.slice(-15)
const fullService = (measurements) => finalWindow(measurements).length === 15
  && finalWindow(measurements).every((sample) => sample.servedThroughput >= sample.offeredThroughput)
const unserved = (measurements) => finalWindow(measurements).length === 15
  && finalWindow(measurements).every((sample) => sample.offeredThroughput > sample.servedThroughput)
const appFor = (context) => context.sandbox.containerApps.find((item) => item.id?.toLowerCase() === appId.toLowerCase()
  || (item.name.toLowerCase() === app && item.resourceGroup.toLowerCase() === group))
function policyReady(context) {
  const resource = appFor(context)
  const rule = resource?.scaleRules?.[0]
  return deploymentReady(context) && resource.cpu === 0.5 && resource.memory === '1Gi'
    && resource.minReplicas === 1 && resource.maxReplicas === 5 && resource.scaleRules.length === 1
    && rule?.custom?.type === 'cpu' && rule.custom.metadata?.type === 'Utilization'
    && Number(rule.custom.metadata.value) === 60
}
const dependencies = {
  [`scaling:${appId}`]: (context) => ({ cpu: appFor(context)?.cpu ?? null, memory: appFor(context)?.memory ?? null,
    min: appFor(context)?.minReplicas ?? null, max: appFor(context)?.maxReplicas ?? null,
    rules: appFor(context)?.scaleRules ?? [] }),
  [`deployment:${appId}`]: (context) => ({ generation: deploymentEntry(context)?.active?.generation ?? null,
    artifactId: deploymentEntry(context)?.active?.artifactId ?? null,
    desired: deploymentEntry(context)?.desired ?? null, status: deploymentEntry(context)?.status ?? null }),
}
const loadTasks = ['baseline', 'sustained', 'overload']
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
  ...Object.fromEntries(loadTasks.map((taskId) => [`proof:${taskId}`,
    (context) => successfulProof(context, taskId)?.id ?? null])),
}
function quietReady(context) {
  const quiet = context.evidence.experimentsById[context.evidence.currentEvidenceByTask.quiet]
  return policyReady(context) && !!quiet && loadTasks.every((taskId) => {
    const proof = successfulProof(context, taskId)
    return proof && proof.sequence < quiet.sequence
  })
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
    const result = applyRunAction(seeded, { type: 'command', line }, cpuGuidedLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) throw new Error(`CPU Lab seed failed at ${line}.`)
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}
const fixture = (title, durationSeconds, demandCpuSecondsPerSecond, assess) => Object.freeze({
  kind: 'cpu', version: 1, appId, title, durationSeconds, demandCpuSecondsPerSecond,
  requestCpuSeconds: 0.02, assess,
})

export const cpuGuidedLab = {
  id: 'aca-cpu-guided', title: 'Observe CPU scaling', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 20,
  brief: 'A healthy private .NET API is ready. Configure a CPU scale rule, then run named workloads to observe baseline service, scale-out, the replica ceiling and delayed scale-in. Demand is CPU-seconds of work offered per simulated second; each illustrative request costs 0.02 CPU-seconds. Utilization divides busy CPU by each ready replica’s requested 0.5 CPU. The clock advances only when you choose Advance. This teaching model makes scaling decisions every 15 seconds, uses 10% tolerance, needs 5 seconds for new replicas to become ready and waits 60 seconds of low demand before scale-in. Throughput is illustrative, not an Azure capacity prediction.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 4, labMode: 'guided',
  manifestId: PROJECT_MANIFEST.id, capabilities: { acrBuild: true, cpuScaling: true },
  cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }, { cpu: 1, memory: '2Gi' }] },
  initialProjectFiles: SOLUTION_FILES, initializeSimulation,
  stages: [{ id: 'observe', title: 'Configure and observe', taskIds: ['policy', 'baseline', 'sustained', 'overload', 'quiet'] }],
  scenarios: Object.freeze({
    baseline: fixture('Baseline demand', 30, 0.1, (m) => m.endReadyReplicas === 1 && fullService(m)),
    sustained: fixture('Sustained demand', 90, 0.8, (m) => m.endReadyReplicas > 1 && fullService(m)),
    overload: fixture('Overload ceiling', 90, 4, (m) => m.endReadyReplicas === 5 && unserved(m)),
    quiet: fixture('Quiet and scale-in', 90, 0, (m) => m.startReadyReplicas > 1 && m.endReadyReplicas === 1),
  }),
  tasks: [
    { id: 'policy', stageId: 'observe', text: 'Set `api-cpu` to 0.5 CPU and 1Gi memory, minimum 1 and maximum 5 replicas, with a CPU utilization target of 60%.',
      check: policyReady,
      hints: ['Requested CPU is the utilization denominator. The supported pairs in this Lab are 0.5 CPU/1Gi and 1 CPU/2Gi; CPU-only scaling keeps at least one replica.', 'Update api-cpu with --cpu 0.5 --memory 1Gi, replica bounds 1 and 5, and a cpu scale rule with metadata type=Utilization value=60.'],
      solution: solution(command(policyCommand)),
      examNote: 'A CPU rule targets utilization relative to requested CPU. These resource pairs and the nonzero minimum are exercise constraints.' },
    { id: 'baseline', stageId: 'observe', text: 'Run 0.1 CPU-seconds/second for 30 simulated seconds. Verify one ready replica serves the full final window.',
      check: policyReady, dependencies, verification: { scenarioId: 'baseline', scenarioVersion: 1 },
      hints: ['Select Baseline demand in CPU Experiment Controls. It offers about 5 illustrative requests per second.', 'Start and advance 30 simulated seconds. If you previously overloaded the app, run the Quiet scenario first to return to one ready replica.'],
      solution: solution(...scenarioStep('baseline', 30)),
      examNote: 'At 0.1 CPU-seconds per second, one ready 0.5 CPU replica has capacity above the offered work; use the final 15 seconds to judge stable service.' },
    { id: 'sustained', stageId: 'observe', text: 'Run sustained 0.8 CPU-seconds/second for 90 seconds. Observe more than one ready replica and full service in the final window.',
      check: policyReady, dependencies, verification: { scenarioId: 'sustained', scenarioVersion: 1 },
      hints: ['Select Sustained demand. Pending replicas cannot serve requests until they are ready.', 'Start and advance 90 seconds. Inspect ready replicas and the final 15 seconds of offered versus served throughput.'],
      solution: solution(...scenarioStep('sustained', 90)),
      examNote: 'Scaling responds at decision points; new replicas add capacity after their readiness delay.' },
    { id: 'overload', stageId: 'observe', text: 'Run 4.0 CPU-seconds/second for 90 seconds. Observe the maximum of five ready replicas and unserved demand in the final window.',
      check: policyReady, dependencies, verification: { scenarioId: 'overload', scenarioVersion: 1 },
      hints: ['Select Overload ceiling. Five 0.5 CPU replicas supply at most 2.5 CPU-seconds of work per second in this model.', 'Start and advance 90 seconds. Compare offered and served requests per second in the final 15 seconds.'],
      solution: solution(...scenarioStep('overload', 90)),
      examNote: 'The configured maximum caps ready replicas. Increasing utilization above the target cannot make five replicas serve work beyond their modeled CPU capacity.' },
    { id: 'quiet', stageId: 'observe', text: 'After completing Baseline, Sustained and Overload, run zero demand for 90 seconds. Verify the app returns to one ready replica after stabilization. Repeat Quiet if you rerun a load workload.',
      check: quietReady, dependencies: quietDependencies, verification: { scenarioId: 'quiet', scenarioVersion: 1 },
      hints: ['Quiet must follow successful Baseline, Sustained and Overload runs and start with more than one ready replica.', 'Start Quiet and advance 90 seconds. The model waits 60 seconds of lower demand before a scale-in decision.'],
      solution: solution(...scenarioStep('quiet', 90)),
      examNote: 'Scale-in follows a stabilization period rather than every brief drop in demand. CPU-only scaling in this Lab retains one replica.' },
  ],
}
