import { PROBE_MANIFEST, PROBE_STARTER_FILES, PROBE_SOLUTION_FILES, probeConfiguration } from '../../templates/containerapps-dotnet/probes.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { parseProject } from '../../../lib/project/files.js'
import { createDeploymentCriteria } from './deployment-criteria.js'
import { probeDependencies, completeProbeMeasurements } from './probe-evidence.js'

const group = 'rg-aca-probes', registry = 'acrprobesguided', environment = 'env-probes', identity = 'id-probes', app = 'api-probes'
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
const expectedEndpoints = { '/health/startup': 'startup', '/health/ready': 'ready', '/health/live': 'responsive' }
const command = (line) => ({ kind: 'command', line })
const file = (path, content) => ({ kind: 'file', path, content })
const solution = (...steps) => ({ steps })
const scenarioSteps = (scenarioId, seconds) => [
  { kind: 'scenario', action: { type: 'scenario-start', scenarioId }, instruction: `Start ${scenarioId} in Probe Experiment Controls.` },
  { kind: 'scenario', action: { type: 'simulation-advance', seconds }, instruction: `Advance all ${seconds} simulated seconds and inspect the result.` },
]
const publish = command(`az acr build --registry ${registry} --image api:v1 --file Dockerfile .`)
const deploy = command(`az containerapp update -g ${group} -n ${app} --yaml ${yamlPath}`)
function endpointsCorrect(spec) {
  const endpoints = spec?.healthEndpoints
  return Array.isArray(endpoints) && endpoints.length === 3
    && Object.entries(expectedEndpoints).every(([path, condition]) =>
      endpoints.some((entry) => entry.path === path && entry.condition === condition))
}
function sourceReady(context) {
  const parsed = parseProject(context.project.savedFiles, PROBE_MANIFEST)
  return !parsed.diagnostics.length && endpointsCorrect(parsed.appSpec)
}
function probesCorrect(config) {
  const items = config?.probes
  return config?.minReplicas === 2 && config?.maxReplicas === 2 && Array.isArray(items) && items.length === 3
    && intendedProbes.every((expected) => items.some((actual) => JSON.stringify(actual) === JSON.stringify(expected)))
}
function capturedReady(context) {
  const active = deploymentEntry(context)?.active
  const artifact = context.artifacts.buildsById[active?.artifactId]
  return deploymentReady(context) && !!artifact && endpointsCorrect(active?.appSpec)
    && endpointsCorrect(artifact.appSpec) && probesCorrect(active?.probeConfig)
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
    && [replica0, replica1].every((id) => events(m, 'startup-complete', id).some((event) => event.second >= 20))
    && requests(m, 1, 19).every((item) => item.status === 503 && item.replicaId === null)
    && healthy(requests(m, 30, 60)) && m.samples.filter((item) => item.second >= 30).every((item) => item.readyReplicas === 2)
}
function readinessObserved(m) {
  if (!complete(m, 90) || m.restarts !== 0 || m.readyReplicas !== 2) return false
  const changes = events(m, 'ready-change', replica0)
  return changes.some((item) => item.ready === false && item.second >= 35 && item.second <= 45)
    && changes.some((item) => item.ready === true && item.second >= 55 && item.second <= 65)
    && m.samples.some((item) => item.second >= 40 && item.second <= 45 && item.readyReplicas === 1)
    && requests(m, 45, 54).length === 20
    && requests(m, 45, 54).every((item) => item.replicaId === replica1 && item.status === 200)
    && requests(m, 65, 90).some((item) => item.replicaId === replica0 && item.status === 200)
    && healthy(requests(m, 65, 90))
}
function livenessObserved(m) {
  if (!complete(m, 90) || m.restarts < 1 || m.readyReplicas !== 2) return false
  const restart = events(m, 'restart', replica0).find((item) => item.probeType === 'Liveness' && item.second >= 35 && item.second <= 50)
  const newStartup = events(m, 'startup-complete', replica0).find((item) => restart && item.second >= restart.second + 20 && item.second <= 80)
  return !!(restart && newStartup)
    && events(m, 'probe-timeout', replica0).some((item) => item.probeType === 'Liveness' && item.second <= restart.second)
    && m.samples.some((item) => item.second >= restart.second && item.second < newStartup.second && item.readyReplicas === 1)
    && requests(m, restart.second, newStartup.second - 1).every((item) => item.replicaId === replica1 && item.status === 200)
    && healthy(requests(m, 80, 90)) && m.samples.filter((item) => item.second >= 80).every((item) => item.readyReplicas === 2)
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
    const result = applyRunAction(seeded, { type: 'command', line }, probesGuidedLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) throw new Error(`Probe Lab seed failed at ${line}: ${JSON.stringify({ lines: result.lines, diagnostics: result.diagnostics })}`)
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}
const fixture = (title, durationSeconds, faults, assess) => Object.freeze({ kind: 'probes', version: 1, appId, title,
  durationSeconds, startupSeconds: 20, requestsPerSecond: 2, faults, assess: (m, context) => capturedReady(context) && assess(m) })
export const probesGuidedLab = {
  id: 'aca-probes-guided', title: 'Observe health probes', status: 'available', skillAreaId: 'containers', service: 'container-apps', minutes: 25,
  brief: 'A private .NET 10 API is deployed with two replicas, but its health routes report failure and no probes are configured. Make startup, readiness, and liveness answer separate questions; publish saved C# changes, then deploy three explicit HTTP probes from the JSON form of containerapp.yaml. Saving YAML only requires a deployment update; changing C# requires a new image build and deployment. Named experiments advance only when you choose Advance. This bounded teaching model uses one-second checks and immediate restart without backoff; it does not predict exact Azure timing. General block YAML is valid in Azure but outside this trainer’s supported editor format.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 7, labMode: 'guided',
  manifestId: PROBE_MANIFEST.id, capabilities: { acrBuild: true, healthProbes: true },
  initialProjectFiles: PROBE_STARTER_FILES, initializeSimulation,
  stages: [
    { id: 'prepare', title: 'Prepare health checks', taskIds: ['source', 'deploy'] },
    { id: 'observe', title: 'Observe and verify', taskIds: ['startup', 'readiness', 'liveness'] },
  ],
  scenarios: Object.freeze({
    startup: fixture('Startup gates traffic', 60, [], startupObserved),
    readiness: fixture('Readiness removes one replica', 90, [
      { atSecond: 35, replica: 0, type: 'readiness', active: true },
      { atSecond: 55, replica: 0, type: 'readiness', active: false },
    ], readinessObserved),
    liveness: fixture('Liveness restarts a hung process', 90, [{ atSecond: 35, replica: 0, type: 'hang', active: true }], livenessObserved),
  }),
  tasks: [
    { id: 'source', stageId: 'prepare', text: 'Save three separate HTTP health endpoints: startup waits 20 seconds, readiness reports whether this replica is ready, and liveness reports whether its process responds. The fixed helper shows the supported health conditions.', check: sourceReady,
      hints: ['Open Program.cs. The existing health routes return failure. Use the fixed HealthState helper in each matching route.', 'Use StartupComplete for /health/startup, Ready for /health/ready, and Responsive for /health/live. Save Program.cs before building.'],
      solution: solution(file(programPath, PROBE_SOLUTION_FILES[programPath])),
      examNote: 'Startup gates other probes, readiness controls traffic, and sustained liveness failure restarts a replica. An endpoint that always says healthy cannot demonstrate those distinctions.' },
    { id: 'deploy', stageId: 'prepare', text: 'Build the saved source and deploy containerapp.yaml with Startup, Readiness, and Liveness HTTP probes on port 8080. Use 5-second initial delay and period, 1-second timeout, startup failure threshold 6, and readiness/liveness failure threshold 2, with success threshold 1. Keep two replicas.', check: capturedReady,
      hints: ['A saved C# edit needs an ACR image build followed by deployment. A saved YAML probe edit needs only the deployment update.', 'Edit the JSON form of containerapp.yaml: three distinct probe types, /health/startup, /health/ready, /health/live, HTTP port 8080, and the stated thresholds. Then update the app with --yaml.'],
      solution: solution(publish, file(yamlPath, intendedYaml), deploy),
      examNote: 'Probe configuration belongs to the Container App deployment. A published image and saved YAML do not alter the active revision until deployed.' },
    { id: 'startup', stageId: 'observe', text: 'Run Startup gates traffic for 60 simulated seconds at two requests per second. Verify no traffic reaches a replica before startup succeeds at or after 20 seconds, and both replicas serve traffic by the end without restart.', check: capturedReady, dependencies, verification: { scenarioId: 'startup', scenarioVersion: 1 },
      hints: ['Choose Startup gates traffic in Probe Experiment Controls and advance the full 60 seconds.', 'Inspect startup-complete events, early 503 requests with no target, and two ready replicas serving HTTP 200 in the final window.'],
      solution: solution(...scenarioSteps('startup', 60)), examNote: 'A startup probe protects a slow-starting process from premature liveness restarts and traffic.' },
    { id: 'readiness', stageId: 'observe', text: 'Run Readiness removes one replica for 90 seconds. At second 35 replica 0 becomes unready, at 55 it recovers. Verify traffic routes around it after detection and returns after recovery, without restart.', check: capturedReady, dependencies, verification: { scenarioId: 'readiness', scenarioVersion: 1 },
      hints: ['The named fixture changes only replica 0. Inspect ready-change events and the request target column.', 'After two failed readiness checks, replica 1 should serve alone by second 45. Replica 0 should reenter by second 65 without a restart.'],
      solution: solution(...scenarioSteps('readiness', 90)), examNote: 'Readiness removes an unhealthy replica from routing; it does not restart the process.' },
    { id: 'liveness', stageId: 'observe', text: 'Run Liveness restarts a hung process for 90 seconds. At second 35 replica 0 hangs. Verify liveness timeouts restart it by second 50, then it passes a new startup and rejoins traffic by second 80.', check: capturedReady, dependencies, verification: { scenarioId: 'liveness', scenarioVersion: 1 },
      hints: ['Follow replica 0 through the timeout, restart, startup-begin, and startup-complete events.', 'After restart, replica 1 serves while replica 0 starts again. The final requests should be HTTP 200 with both replicas ready.'],
      solution: solution(...scenarioSteps('liveness', 90)), examNote: 'A liveness failure restarts the affected replica. Restart clears this simulated process hang, then startup gates readiness again.' },
  ],
}
