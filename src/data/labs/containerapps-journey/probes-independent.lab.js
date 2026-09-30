import { probeConfiguration } from '../../templates/containerapps-dotnet/probes.js'
import { INDEPENDENT_PROBE_MANIFEST, INDEPENDENT_PROBE_STARTER_FILES, INDEPENDENT_PROBE_SOLUTION_FILES } from '../../templates/containerapps-dotnet/probes-independent.js'
import { SUBSCRIPTION_ID, createSandbox } from '../../../lib/sandbox/model.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { applyRunAction } from '../../../lib/labEngine/actions.js'
import { createDeploymentCriteria } from './deployment-criteria.js'
import { probeDependencies, completeProbeMeasurements } from './probe-evidence.js'

const group = 'rg-aca-probes-independent', registry = 'acrprobesindependent', environment = 'env-probes-independent', identity = 'id-probes-independent', app = 'api-probes-independent'
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
  failureThreshold: type === 'Startup' ? 8 : 2, successThreshold: 1,
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
function probesCorrect(config) {
  const items = config?.probes
  return config?.minReplicas === 2 && config?.maxReplicas === 2 && Array.isArray(items) && items.length === 3
    && intendedProbes.every((expected) => items.filter((actual) => actual.type === expected.type
      && actual.httpGet?.path === expected.httpGet.path && actual.httpGet?.port === 8080
      && actual.httpGet?.scheme === 'HTTP').length === 1)
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
  if (!complete(m, 80) || m.restarts !== 0 || m.readyReplicas !== 2) return false
  const startup = [replica0, replica1].map((id) => events(m, 'startup-complete', id)[0])
  const ready = [replica0, replica1].map((id) => events(m, 'ready-change', id).find((event) => event.ready))
  if (startup.some((event) => !event || event.second < 30)
    || ready.some((event, i) => !event || event.second < startup[i].second)) return false
  const firstReady = Math.min(...ready.map((event) => event.second))
  return requests(m, 1, firstReady - 1).every((item) => item.status === 503 && item.replicaId === null)
    && healthy(requests(m, 41, 80)) && m.samples.filter((item) => item.second >= 41).every((item) => item.readyReplicas === 2)
}
function readinessObserved(m) {
  if (!complete(m, 100) || m.restarts !== 0 || m.readyReplicas !== 2) return false
  const changes = events(m, 'ready-change', replica0)
  return events(m, 'fault', replica0).some((item) => item.faultType === 'readiness' && item.active && item.second === 45)
    && events(m, 'fault', replica0).some((item) => item.faultType === 'readiness' && !item.active && item.second === 65)
    && changes.some((item) => item.ready === false && item.second >= 45 && item.second <= 55)
    && changes.some((item) => item.ready === true && item.second >= 65 && item.second <= 75)
    && requests(m, 55, 64).every((item) => item.replicaId === replica1 && item.status === 200)
    && requests(m, 65, 75).some((item) => item.replicaId === replica0 && item.status === 200)
    && healthy(requests(m, 76, 100)) && m.samples.filter((item) => item.second >= 76).every((item) => item.readyReplicas === 2)
}
function livenessObserved(m) {
  if (!complete(m, 110) || m.restarts !== 1 || m.readyReplicas !== 2) return false
  if (!events(m, 'fault', replica0).some((item) => item.faultType === 'hang' && item.active && item.second === 45)) return false
  const restart = events(m, 'restart', replica0).find((item) => item.probeType === 'Liveness' && item.second >= 45 && item.second <= 60)
  const newStartup = events(m, 'startup-complete', replica0).find((item) => restart && item.second >= restart.second + 30 && item.second <= 95)
  return !!(restart && newStartup)
    && events(m, 'probe-timeout', replica0).some((item) => item.probeType === 'Liveness' && item.second <= restart.second)
    && m.samples.some((item) => item.second >= restart.second && item.second < newStartup.second && item.readyReplicas === 1)
    && requests(m, restart.second, newStartup.second - 1).every((item) => item.replicaId === replica1 && item.status === 200)
    && healthy(requests(m, 96, 110)) && m.samples.filter((item) => item.second >= 96).every((item) => item.readyReplicas === 2)
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
    const result = applyRunAction(seeded, { type: 'command', line }, probesIndependentLab)
    if (result.lines.some((item) => item.kind === 'err') || result.diagnostics.length) throw new Error(`Probe Lab seed failed at ${line}: ${JSON.stringify({ lines: result.lines, diagnostics: result.diagnostics })}`)
    seeded = result.run
  }
  fixedResourceTimes(seeded.sandbox)
  return { sandbox: seeded.sandbox, artifacts: seeded.artifacts, runtime: seeded.runtime, nextSequence: seeded.nextSequence }
}
const fixture = (title, durationSeconds, faults, assess) => Object.freeze({ kind: 'probes', version: 1, appId, title,
  durationSeconds, startupSeconds: 30, requestsPerSecond: 2, faults, assess: (m, context) => capturedReady(context) && assess(m) })
export const probesIndependentLab = {
  id: 'aca-probes-independent', title: 'Design reliable health probes', status: 'available', skillAreaId: 'containers', service: 'container-apps', minutes: 30,
  brief: 'A private two-replica API takes 30 seconds to start. Its /api/info response uses only local data. Choose separate endpoint conditions for Startup, Readiness and Liveness, then choose three explicit HTTP probe policies on port 8080 that satisfy the measured bounds below. The supplied routes currently fail and the app has no probes. Save C# changes, build api:v1, and deploy the saved JSON form of containerapp.yaml; a YAML-only edit needs Save and deploy. Tasks may be proved in any order, but all three proofs must be current under one active deployment. Named experiments advance only when you choose Advance. The teaching clock uses one-second checks and immediate restart without backoff; its timing is not an Azure production prediction. General block YAML is valid in Azure but outside this editor format.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 9, labMode: 'independent',
  manifestId: INDEPENDENT_PROBE_MANIFEST.id, capabilities: { acrBuild: true, healthProbes: true },
  initialProjectFiles: INDEPENDENT_PROBE_STARTER_FILES, initializeSimulation,
  stages: [{ id: 'verify', title: 'Design and verify', taskIds: ['startup', 'readiness', 'liveness'] }],
  scenarios: Object.freeze({
    startup: fixture('Safe cold startup', 80, [], startupObserved),
    readiness: fixture('Readiness exclusion and recovery', 100, [
      { atSecond: 45, replica: 0, type: 'readiness', active: true },
      { atSecond: 65, replica: 0, type: 'readiness', active: false },
    ], readinessObserved),
    liveness: fixture('Hang detection and recovery', 110, [{ atSecond: 45, replica: 0, type: 'hang', active: true }], livenessObserved),
  }),
  tasks: [
    { id: 'startup', stageId: 'verify', text: 'Choose endpoint logic and probe timing for the 30-second cold start. Run Safe cold startup for 80 seconds: no Startup or Liveness restart, no traffic before startup and readiness, then both replicas ready and HTTP 200 through the final 40 seconds.', check: capturedReady, dependencies, verification: { scenarioId: 'startup', scenarioVersion: 1 },
      hints: ['The three failing routes in Program.cs need distinct HealthState conditions. Save, build and deploy the source and explicit HTTP probes before measuring.', 'A worked policy uses Startup delay 5, period 5, threshold 8; Readiness and Liveness delay 5, period 5, timeout 1, threshold 2. Set success threshold 1 and keep two replicas.'],
      solution: solution(file(programPath, INDEPENDENT_PROBE_SOLUTION_FILES[programPath]), publish, file(yamlPath, intendedYaml), deploy, ...scenarioSteps('startup', 80)),
      examNote: 'Startup gates other checks during a cold start. The failure allowance must let the process reach 30 seconds without an early restart.' },
    { id: 'readiness', stageId: 'verify', text: 'Run Readiness exclusion and recovery for 100 seconds. Replica 0 becomes unready at second 45 and recovers at 65. Exclude it by second 55 while replica 1 serves HTTP 200, then route to replica 0 again by second 75 without restart.', check: capturedReady, dependencies, verification: { scenarioId: 'readiness', scenarioVersion: 1 },
      hints: ['Inspect replica 0 ready-change events and the request target column around seconds 45–75.', 'Readiness must use HealthState.Ready and detect both failure and recovery within ten seconds. It removes a replica from traffic without restarting it.'],
      solution: solution(...scenarioSteps('readiness', 100)), examNote: 'Readiness controls routing and must recover promptly after a temporary local fault.' },
    { id: 'liveness', stageId: 'verify', text: 'Run Hang detection and recovery for 110 seconds. Replica 0 hangs at second 45; a Liveness timeout must restart it by second 60. Replica 1 carries traffic while it restarts, and both replicas are ready by second 95 after a fresh 30-second startup.', check: capturedReady, dependencies, verification: { scenarioId: 'liveness', scenarioVersion: 1 },
      hints: ['Inspect replica 0 probe-timeout, restart, startup-complete, and request events.', 'Liveness should use HealthState.Responsive. Choose a period, timeout and failure threshold that restart a real hang within 15 seconds.'],
      solution: solution(...scenarioSteps('liveness', 110)), examNote: 'Liveness restarts a hung process; Startup then gates its return. A healthy response from an always-successful endpoint cannot prove the intended conditions.' },
  ],
}
