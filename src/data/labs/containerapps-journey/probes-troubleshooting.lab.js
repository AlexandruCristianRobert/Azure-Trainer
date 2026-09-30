import { PROBE_MANIFEST, PROBE_SOLUTION_FILES, probeConfiguration } from '../../templates/containerapps-dotnet/probes.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { createDeploymentCriteria } from './deployment-criteria.js'
import { probeDependencies, completeProbeMeasurements } from './probe-evidence.js'

const group = 'rg-aca-probes-incident', registry = 'acrprobesincident', environment = 'env-probes-incident', identity = 'id-probes-incident', app = 'api-probes-incident'
const image = `${registry}.azurecr.io/api:v1`
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
const identityId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity}`
const principalId = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] },
  { resourceGroup: group, name: identity }).resource.principalId
const { deploymentEntry, deploymentReady, appId } = createDeploymentCriteria({ group, registry, environment, identity, app,
  service: 'contoso-api', port: 8080, environmentValue: 'training', requiredImage: image, capturedArtifact: true })
const programPath = 'src/Trainer.Api/Program.cs', yamlPath = 'containerapp.yaml'
const intendedProbes = ['Startup', 'Readiness', 'Liveness'].map((type) => ({
  type, httpGet: { path: `/health/${type === 'Startup' ? 'startup' : type === 'Readiness' ? 'ready' : 'live'}`, port: 8080, scheme: 'HTTP' },
  initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1,
  failureThreshold: type === 'Startup' ? 6 : 2, successThreshold: 1,
}))
const intendedYaml = probeConfiguration({ appName: 'api', image, probes: intendedProbes })
const initialProbes = intendedProbes.map((probe) => probe.type === 'Startup' ? { ...probe, failureThreshold: 2 } : probe)
const source = PROBE_SOLUTION_FILES[programPath]
const sourceFault = 'HealthState.Responsive ? Results.Ok()'
if (source.split(sourceFault).length !== 2) throw new Error('Probe incident source fixture must match exactly once.')
const incidentFiles = { ...PROBE_SOLUTION_FILES,
  [programPath]: source.replace(sourceFault, 'HealthState.DependencyAvailable ? Results.Ok()'),
  [yamlPath]: probeConfiguration({ appName: 'api', image, probes: initialProbes }),
}
const expectedEndpoints = { '/health/startup': 'startup', '/health/ready': 'ready' }
const command = (line) => ({ kind: 'command', line })
const file = (path, content) => ({ kind: 'file', path, content })
const solution = (...steps) => ({ steps })
const scenarioSteps = (scenarioId, seconds) => [
  { kind: 'scenario', action: { type: 'scenario-start', scenarioId }, instruction: `Start ${scenarioId} in Probe Experiment Controls.` },
  { kind: 'scenario', action: { type: 'simulation-advance', seconds }, instruction: `Advance all ${seconds} simulated seconds and inspect the result.` },
]
const publish = command(`az acr build --registry ${registry} --image api:v1 --file Dockerfile .`)
const deploy = command(`az containerapp update -g ${group} -n ${app} --yaml ${yamlPath}`)
function endpointsCorrect(spec, allowDependency = false) {
  const endpoints = spec?.healthEndpoints
  return Array.isArray(endpoints) && endpoints.length === 3
    && Object.entries(expectedEndpoints).every(([path, condition]) =>
      endpoints.some((entry) => entry.path === path && entry.condition === condition))
    && endpoints.some((entry) => entry.path === '/health/live' && (entry.condition === 'responsive' || (allowDependency && entry.condition === 'dependency')))
}
function probesCorrect(config) {
  const items = config?.probes
  return config?.minReplicas === 2 && config?.maxReplicas === 2 && Array.isArray(items) && items.length === 3
    && intendedProbes.every((expected) => items.filter((actual) => actual.type === expected.type
      && actual.httpGet?.path === expected.httpGet.path && actual.httpGet?.port === 8080
      && actual.httpGet?.scheme === 'HTTP').length === 1)
}
function capturedReady(context, allowDependency = false) {
  const active = deploymentEntry(context)?.active
  const artifact = context.artifacts.buildsById[active?.artifactId]
  return deploymentReady(context) && !!artifact && endpointsCorrect(active?.appSpec, allowDependency)
    && endpointsCorrect(artifact.appSpec, allowDependency) && probesCorrect(active?.probeConfig)
    && probesCorrect(deploymentEntry(context)?.desired?.probeConfig)
}
const dependencies = probeDependencies(appId, deploymentEntry)
const replica0 = `${appId}#0`, replica1 = `${appId}#1`
const events = (m, type, replica) => m.events.filter((event) => event.type === type && (!replica || event.replicaId === replica))
const requests = (m, from, through) => m.requests.filter((request) => request.second >= from && request.second <= through)
const healthy = (items) => items.length > 0 && items.every((item) => item.status === 200)
const complete = completeProbeMeasurements
function startupObserved(m) {
  return complete(m, 60) && m.restarts === 0 && m.readyReplicas === 2
    && [replica0, replica1].every((id) => events(m, 'startup-complete', id).some((event) => event.second >= 20 && event.second <= 30))
    && requests(m, 1, 19).every((item) => item.status === 503 && item.replicaId === null)
    && healthy(requests(m, 30, 60)) && m.samples.filter((item) => item.second >= 30).every((item) => item.readyReplicas === 2)
}
function dependencyObserved(m) {
  if (!complete(m, 100) || m.restarts !== 0 || m.readyReplicas !== 2) return false
  const fault = events(m, 'fault', replica0)
  return fault.some((item) => item.faultType === 'dependency' && item.active === true && item.second === 35)
    && fault.some((item) => item.faultType === 'dependency' && item.active === false && item.second === 70)
    && m.samples.filter((item) => item.second >= 30).every((item) => item.readyReplicas === 2 && item.restarts === 0)
    && requests(m, 45, 69).some((item) => item.replicaId === replica0)
    && healthy(requests(m, 35, 70)) && healthy(requests(m, 80, 100))
}
function hangObserved(m) {
  if (!complete(m, 90) || m.restarts < 1 || m.readyReplicas !== 2) return false
  if (!events(m, 'fault', replica0).some((item) => item.faultType === 'hang' && item.active === true && item.second === 35)) return false
  const restart = events(m, 'restart', replica0).find((item) => item.probeType === 'Liveness' && item.second >= 35 && item.second <= 50)
  const newStartup = events(m, 'startup-complete', replica0).find((item) => restart && item.second >= restart.second + 20 && item.second <= 80)
  return !!(restart && newStartup)
    && events(m, 'probe-timeout', replica0).some((item) => item.probeType === 'Liveness' && item.second <= restart.second)
    && m.samples.some((item) => item.second >= restart.second && item.second < newStartup.second && item.readyReplicas === 1)
    && requests(m, restart.second, newStartup.second - 1).every((item) => item.replicaId === replica1 && item.status === 200)
    && healthy(requests(m, 80, 90)) && m.samples.filter((item) => item.second >= 80).every((item) => item.readyReplicas === 2)
}
function currentProof(context, taskId) {
  const id = context.evidence.currentEvidenceByTask[taskId]
  const record = context.evidence.experimentsById[id]
  if (record?.taskId !== taskId || record.scenarioId !== taskId || record.scenarioVersion !== 1
    || record.outcome !== 'passed' || record.completed !== true) return null
  for (const [key, select] of Object.entries(dependencies)) {
    try {
      if (!Object.hasOwn(record.dependencyValues ?? {}, key)
        || canonicalize(record.dependencyValues[key]) !== canonicalize(select(context))
        || record.dependencyGenerations[key] !== (context.dependencyGenerations[key] ?? 0)) return null
    } catch { return null }
  }
  return record
}
const dependencyProof = { ...dependencies, 'proof:startup': (context) => currentProof(context, 'startup')?.id ?? null }
const hangProof = { ...dependencyProof, 'proof:dependency': (context) => currentProof(context, 'dependency')?.id ?? null }
function dependencyReady(context) { return capturedReady(context) && !!currentProof(context, 'startup') }
function hangReady(context) {
  const startup = currentProof(context, 'startup'), dependency = currentProof(context, 'dependency')
  return capturedReady(context) && !!startup && !!dependency && startup.sequence < dependency.sequence
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
    `az group create -n ${group} -l eastus`, `az acr create -g ${group} -n ${registry} --sku Basic`, publish.line,
    `az identity create -g ${group} -n ${identity}`,
    `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`,
    `az containerapp env create -g ${group} -n ${environment} -l eastus`,
    `az containerapp create -g ${group} -n ${app} --environment ${environment} --image ${image} --user-assigned ${identityId} --registry-server ${registry}.azurecr.io --registry-identity ${identityId} --env-vars APP_ENV=training --ingress external --target-port 8080 --min-replicas 2 --max-replicas 2`,
    deploy.line,
  ]
  let seeded = run
  for (const line of lines) {
    const result = applyRunAction(seeded, { type: 'command', line }, probesTroubleshootingLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) throw new Error(`Probe Lab seed failed at ${line}: ${JSON.stringify({ lines: result.lines, diagnostics: result.diagnostics })}`)
    seeded = result.run
  }
  for (const action of [{ type: 'scenario-start', scenarioId: 'startup' }, { type: 'simulation-advance', seconds: 30 }]) {
    const result = applyRunAction(seeded, action, probesTroubleshootingLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) throw new Error(`Probe incident seed failed at ${action.type}.`)
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}
const fixture = (title, durationSeconds, faults, assess, allowDependency = false) => Object.freeze({ kind: 'probes', version: 1, appId, title,
  durationSeconds, startupSeconds: 20, requestsPerSecond: 2, faults, assess: (m, context) => capturedReady(context, allowDependency) && assess(m) })
export const probesTroubleshootingLab = {
  id: 'aca-probes-troubleshooting', title: 'Diagnose probe restarts', status: 'available', skillAreaId: 'containers', service: 'container-apps', minutes: 25,
  brief: 'A private two-replica API is already in a restart loop. Inspect the application events, requests, saved source, and containerapp.yaml. Repair startup so the slow service can become ready, then verify it remains available during an optional downstream outage and that a hung process still restarts. Save probe changes before deployment; source changes require a new image build and deployment. Named experiments advance only when you choose Advance. This one-second teaching model uses immediate restarts and does not predict Azure production timing. The editor supports the JSON form of containerapp.yaml.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 8, labMode: 'troubleshooting',
  manifestId: PROBE_MANIFEST.id, capabilities: { acrBuild: true, healthProbes: true },
  initialProjectFiles: incidentFiles, initializeSimulation,
  stages: [{ id: 'diagnose', title: 'Diagnose and verify', taskIds: ['startup', 'dependency', 'hang'] }],
  scenarios: Object.freeze({
    startup: fixture('Slow startup', 60, [], startupObserved, true),
    dependency: fixture('Optional dependency outage', 100, [
      { atSecond: 35, replica: 0, type: 'dependency', active: true },
      { atSecond: 70, replica: 0, type: 'dependency', active: false },
    ], dependencyObserved),
    hang: fixture('Hung process recovery', 90, [{ atSecond: 35, replica: 0, type: 'hang', active: true }], hangObserved),
  }),
  tasks: [
    { id: 'startup', stageId: 'diagnose', text: 'Stop the early restart loop while keeping all three HTTP probes. In a fresh 60-second Startup run, show first successful startup at 20–30 seconds, no restart, no premature traffic, and two ready replicas serving the final window.',
      check: (context) => capturedReady(context, true), dependencies, verification: { scenarioId: 'startup', scenarioVersion: 1 },
      hints: ['Inspect Startup failures and restart times against the application startup events.', 'The process needs 20 seconds. Raise the Startup failure allowance in containerapp.yaml, save, deploy, and rerun the full scenario.'],
      solution: solution(file(yamlPath, intendedYaml), deploy, ...scenarioSteps('startup', 60)),
      examNote: 'Startup failure allowance must accommodate the application startup time before liveness and readiness begin.' },
    { id: 'dependency', stageId: 'diagnose', text: 'Keep the primary API available through a 35–70 second optional dependency outage. Publish and deploy a liveness endpoint that tests this process, then prove both replicas stay ready with no restart and successful primary requests in a fresh 100-second run.',
      check: dependencyReady, dependencies: dependencyProof, verification: { scenarioId: 'dependency', scenarioVersion: 1 },
      hints: ['A dependency failure persists across a process restart; inspect which condition /health/live reports.', 'Use HealthState.Responsive for /health/live, save Program.cs, build api:v1, deploy the saved YAML, rerun Startup, then run Dependency.'],
      solution: solution(file(programPath, PROBE_SOLUTION_FILES[programPath]), publish, deploy, ...scenarioSteps('startup', 60), ...scenarioSteps('dependency', 100)),
      examNote: 'This primary /api/info route uses local data. Its optional downstream outage need not remove a ready replica or fail requests.' },
    { id: 'hang', stageId: 'diagnose', text: 'With current Startup and Dependency proof, run a fresh 90-second Hang experiment. Show liveness timeouts restarting replica 0 by second 50, new startup, and both replicas ready by second 80 while replica 1 carries traffic.',
      check: hangReady, dependencies: hangProof, verification: { scenarioId: 'hang', scenarioVersion: 1 },
      hints: ['Inspect replica 0 timeout, restart, startup-begin, startup-complete and request target events.', 'A real hang must trigger Liveness and clear on restart. Complete the full 90-second scenario after both earlier proofs.'],
      solution: solution(...scenarioSteps('hang', 90)),
      examNote: 'Liveness restarts a hung process; Startup gates its return to traffic. A later prerequisite rerun requires Hang verification again.' },
  ],
}

