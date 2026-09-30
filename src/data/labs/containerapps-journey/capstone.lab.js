import { CAPSTONE_MANIFEST, CAPSTONE_STARTER_FILES, CAPSTONE_SOLUTION_FILES, CAPSTONE_BICEP_TARGETS } from '../../templates/containerapps-dotnet/capstone.js'
import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { compileBicepProject } from '../../../lib/bicep/compile.js'
import { bicepCommandSource } from '../../../lib/az/commands/deployment.js'
import { bicepTargetKey } from '../../../lib/bicep/provenance.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { parseProject } from '../../../lib/project/files.js'
import { foundryEvidenceDependencies, foundryInferenceReady } from '../../../lib/simulation/inference.js'
import { probeDependencies } from './probe-evidence.js'
import { sourceTextHash } from '../../../lib/labEngine/sourceJournal.js'

const [bootstrap, main] = CAPSTONE_BICEP_TARGETS
const group = main.resourceGroup
const appId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}/providers/Microsoft.App/containerApps/${main.appName}`
const image = `${main.registryName}.azurecr.io/api:v1`
const solution = (...steps) => ({ steps })
const shell = line => ({ kind: 'command', line })
const file = path => ({ kind: 'file', path, content: CAPSTONE_SOLUTION_FILES[path] })
const request = scenarioId => ({ kind: 'scenario', action: { type: 'request', scenarioId } })
const experiment = (scenarioId, seconds) => [
  { kind: 'scenario', action: { type: 'scenario-start', scenarioId } },
  { kind: 'scenario', action: { type: 'simulation-advance', seconds } },
]
const deploy = (verb, target) => `az deployment group ${verb} --name ${target.deploymentName} --resource-group ${group} --template-file ${target.templatePath} --parameters ${target.parameterPath}`
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const active = c => c.runtime.deploymentsByApp[appId]?.active
const targetState = (c, target) => c.runtime.bicep?.currentByTarget?.[bicepTargetKey(group, target.deploymentName)]
const source = (c, target) => bicepCommandSource({ project: c.project }, target.parameterPath)
function graph(c, target) {
  const rg = c.sandbox.resourceGroups.find(item => same(item.name, group))
    ?? { name: group, location: 'eastus' }
  const result = compileBicepProject(c.project.savedFiles, CAPSTONE_MANIFEST,
    { resourceGroup: rg, parameterPath: target.parameterPath })
  return result.diagnostics.length ? null : result.graph
}
function matches(c, target, item) {
  if (!item || item.target !== group || item.name !== target.deploymentName
    || item.parameterPath !== target.parameterPath || item.templatePath !== target.templatePath) return false
  const tuple = source(c, target)
  return item.sourceHash === tuple.sourceHash && item.parameterHash === tuple.parameterHash
    && canonicalize(item.fileVersions) === canonicalize(tuple.fileVersions)
}
const preview = (c, target) => {
  const item = targetState(c, target)?.preview
  return matches(c, target, item) ? item : null
}
const applied = (c, target) => {
  const state = targetState(c, target)
  return state?.latest?.status === 'succeeded' && state.successful?.id === state.latest.id
    && matches(c, target, state.latest) ? state.latest : null
}
const afterPreview = (c, target) => !!preview(c, target) && !!applied(c, target)
  && applied(c, target).sequence > preview(c, target).sequence
const app = c => c.sandbox.containerApps.find(item => same(item.name, main.appName) && same(item.resourceGroup, group))
const published = c => c.artifacts.publishedTags[image]
const build = c => Object.values(c.artifacts.buildsById).find(item => item.id === published(c))
const appInputs = files => Object.fromEntries(Object.entries(files ?? {})
  .filter(([path]) => !path.startsWith('infra/')).sort(([left], [right]) => left.localeCompare(right)))
const appSourceHash = files => sourceTextHash(canonicalize(appInputs(files)))
const builtFromSavedApp = c => {
  const artifact = build(c)
  const captured = artifact && c.artifacts.sourceSnapshotsByHash[artifact.sourceHash]
  return !!captured && appSourceHash(captured.files) === appSourceHash(c.project.savedFiles)
}
function activeReady(c) {
  const entry = active(c)
  return !!app(c) && !!entry && !!published(c) && entry.artifactId === published(c)
    && builtFromSavedApp(c)
    && same(entry.image, image) && entry.foundry?.deployment === 'summarizer-primary'
    && foundryInferenceReady(c, appId) && entry.probeConfig?.probes?.length === 3
    && entry.scalePolicy?.minReplicas === 1 && entry.scalePolicy?.maxReplicas === 5
}
const deploymentEntry = c => c.runtime.deploymentsByApp[appId]
const operational = {
  source: c => source(c, main),
  appSourceHash: c => appSourceHash(c.project.savedFiles),
  deployment: c => ({ generation: active(c)?.generation ?? null }),
  artifact: c => ({ id: published(c) ?? null, sourceHash: build(c)?.sourceHash ?? null }),
  incident: c => ({ id: c.runtime.incident?.id ?? null, status: c.runtime.incident?.status ?? null }),
  ...foundryEvidenceDependencies(appId), ...probeDependencies(appId, deploymentEntry),
}
const proof = (c, id) => c.evidence.experimentsById[c.evidence.currentEvidenceByTask[id]]
const passed = (c, id) => proof(c, id)?.outcome === 'passed' && proof(c, id)?.completed === true
const afterIncident = (c, id) => passed(c, id) && proof(c, id).sequence > (c.runtime.incident?.sequence ?? Infinity)
const recoveryProofSequence = c => Math.max(...['recovery-request', 'recovery-startup', 'recovery-readiness',
  'recovery-liveness', 'recovery-steady', 'recovery-overload', 'recovery-quiet', 'recovery-persistent']
  .map(id => proof(c, id)?.sequence ?? Infinity))
const requestScenario = (id, title, attempts, status, code) => Object.freeze({
  kind: 'foundry', version: 1, appId, title,
  request: { method: 'POST', path: '/api/summarize', body: { text: `Capstone ${id} evidence.` } },
  faultProfile: { attempts }, expected: { status, ...(code ? { diagnosticCode: code } : {}) },
})
const probeScenario = (id, title, seconds, faults, assess) => Object.freeze({
  kind: 'probes', version: 1, appId, title, durationSeconds: seconds, startupSeconds: 30,
  requestsPerSecond: 2, faults, assess,
})
const cpuScenario = (id, title, demand, assess) => Object.freeze({
  kind: 'cpu', version: 1, appId, title, durationSeconds: 90,
  demandCpuSecondsPerSecond: demand, requestCpuSeconds: 0.03, assess,
})
const final = m => m.trace?.slice(-15) ?? []
const served = (m, rate) => final(m).length === 15 && final(m).every(s =>
  Math.abs(s.offeredThroughput - rate) < 1e-9 && s.servedThroughput + 1e-9 >= rate)
const probesHealthy = m => m.restarts === 0 && m.readyReplicas === 1
  && m.requests?.slice(-40).length === 40 && m.requests.slice(-40).every(r => r.status === 200)
const startup = m => probesHealthy(m) && m.events?.some(e => e.type === 'startup-complete' && e.second >= 30)
const readiness = m => probesHealthy(m) && m.events?.some(e => e.type === 'ready-change' && e.ready === false)
  && m.events.some(e => e.type === 'ready-change' && e.ready === true && e.second >= 65)
const liveness = m => m.restarts === 1 && m.readyReplicas === 1
  && m.events?.some(e => e.type === 'restart' && e.probeType === 'Liveness')
  && m.requests?.slice(-30).every(r => r.status === 200)
const scenario = {
  'baseline-request': requestScenario('baseline-request', 'Healthy named Foundry request', [], 200),
  'baseline-startup': probeScenario('baseline-startup', 'Slow startup with one replica', 80, [], startup),
  'baseline-readiness': probeScenario('baseline-readiness', 'Readiness exclusion and recovery', 100,
    [{ atSecond: 45, replica: 0, type: 'readiness', active: true }, { atSecond: 65, replica: 0, type: 'readiness', active: false }], readiness),
  'baseline-liveness': probeScenario('baseline-liveness', 'Hung replica restart', 110,
    [{ atSecond: 45, replica: 0, type: 'hang', active: true }], liveness),
  'baseline-steady': cpuScenario('baseline-steady', 'Sustained load', 0.9, m => served(m, 30)),
  'baseline-overload': cpuScenario('baseline-overload', 'Replica ceiling', 4, m => m.endReadyReplicas === 5
    && final(m).length === 15 && final(m).every(s => s.offeredThroughput > s.servedThroughput)),
  'baseline-quiet': cpuScenario('baseline-quiet', 'Scale in after quiet demand', 0,
    m => m.startReadyReplicas > 1 && m.endReadyReplicas === 1),
  'incident-request': requestScenario('incident-request', 'Injected deployment drift', [], 502, 'FOUNDRY_DEPLOYMENT_NOT_FOUND'),
  'repair-transient': requestScenario('repair-transient', 'Recover from a transient 429',
    [{ status: 429, durationMs: 100, retryAfterSeconds: 1 }, { status: 200, durationMs: 100 }], 200),
  'recovery-request': requestScenario('recovery-request', 'Fresh healthy Foundry request', [], 200),
  'recovery-startup': probeScenario('recovery-startup', 'Fresh slow startup', 80, [], startup),
  'recovery-readiness': probeScenario('recovery-readiness', 'Fresh readiness recovery', 100,
    [{ atSecond: 45, replica: 0, type: 'readiness', active: true }, { atSecond: 65, replica: 0, type: 'readiness', active: false }], readiness),
  'recovery-liveness': probeScenario('recovery-liveness', 'Fresh liveness restart', 110,
    [{ atSecond: 45, replica: 0, type: 'hang', active: true }], liveness),
  'recovery-steady': cpuScenario('recovery-steady', 'Fresh sustained load', 0.9, m => served(m, 30)),
  'recovery-overload': cpuScenario('recovery-overload', 'Fresh replica ceiling', 4,
    m => m.endReadyReplicas === 5 && final(m).length === 15 && final(m).every(s => s.offeredThroughput > s.servedThroughput)),
  'recovery-quiet': cpuScenario('recovery-quiet', 'Fresh scale in', 0,
    m => m.startReadyReplicas > 1 && m.endReadyReplicas === 1),
  'recovery-persistent': requestScenario('recovery-persistent', 'Bound persistent throttling',
    [{ status: 429, durationMs: 100 }, { status: 429, durationMs: 100 }, { status: 429, durationMs: 100 }], 503, 'UPSTREAM_UNAVAILABLE'),
}
const evidenceTask = (id, stageId, text, check = activeReady, dependencies = operational) => ({
  id, stageId, text, check, dependencies, verification: { scenarioId: id, scenarioVersion: 1 },
  hints: [`Run the named ${id} scenario after the required saved deployment and inspect its measurements.`],
  solution: solution(scenario[id].kind === 'foundry' ? request(id) : experiment(id, scenario[id].durationSeconds)),
})
const groupReady = c => c.sandbox.resourceGroups.length === 1 && same(c.sandbox.resourceGroups[0].name, group)
  && c.stages.ownedGroups.length === 1 && c.stages.ownedGroups[0] === group
  && c.evidence.groupReceipts.some(item => item.name === group)
  && c.stages.groupCreations.length === 1
const inspected = c => groupReady(c) && c.history.some(line =>
  /^az group show (?:-n|--name) rg-aca-capstone$/i.test(line.trim()))
const noChange = items => Array.isArray(items) && items.length > 0
  && items.every(item => ['no-change', 'ignored-existing'].includes(item.changeType))
const observed = (c, target, kind, attemptId = null) => c.runtime.bicep.observations.some(item =>
  item.kind === kind && matches(c, target, item)
    && (attemptId === null || item.attemptId === attemptId))

export const capstoneLab = {
  id: 'aca-capstone', title: 'Operate and recover a Container Apps service', status: 'available',
  skillAreaId: 'containers', service: 'container-apps', minutes: 90,
  brief: 'Start from an empty local Sandbox. Save the complete API and Bicep project, deploy its foundation and application, prove healthy behavior, diagnose simulated drift, recover from throttling, reproduce the stack and clean up every resource group created in this attempt.',
  engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 16, labMode: 'capstone',
  manifestId: CAPSTONE_MANIFEST.id, capabilities: { acaCapstone: true, bicepDeployment: true,
    acrBuild: true, foundryInference: true, cpuScaling: true, healthProbes: true },
  bicepTargets: CAPSTONE_BICEP_TARGETS, cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] },
  initialProjectFiles: CAPSTONE_STARTER_FILES, scenarios: Object.freeze(scenario),
  stages: [
    { id: 'prepare', title: 'Prepare buildable source', taskIds: ['source'] },
    { id: 'publish', title: 'Bootstrap and publish', taskIds: ['group', 'bootstrap-preview', 'bootstrap-create', 'publish-image'] },
    { id: 'deploy', title: 'Deploy the complete application', taskIds: ['main-preview', 'main-create'] },
    { id: 'healthy', title: 'Prove healthy operation', taskIds: ['baseline-request', 'baseline-startup', 'baseline-readiness', 'baseline-liveness', 'baseline-steady', 'baseline-overload', 'baseline-quiet'] },
    { id: 'incident', title: 'Diagnose and repair simulated drift', taskIds: ['incident-request', 'drift-preview', 'repair-main', 'repair-transient'] },
    { id: 'recovery', title: 'Prove recovery and reproducibility', taskIds: ['recovery-request', 'recovery-startup', 'recovery-readiness', 'recovery-liveness', 'recovery-steady', 'recovery-overload', 'recovery-quiet', 'recovery-persistent', 'noop-preview', 'noop-reapply'] },
    { id: 'cleanup', title: 'Delete owned resources', taskIds: ['delete-groups'] },
  ],
  tasks: [
    { id: 'group', stageId: 'publish', text: 'Create and inspect the single rg-aca-capstone resource group.', check: inspected,
      hints: ['Create the group in East US, then show it before provisioning resources.'],
      solution: solution(shell(`az group create -n ${group} -l eastus`), shell(`az group show -n ${group}`)) },
    { id: 'source', stageId: 'prepare', text: 'Save the combined .NET source, settings and both Bicep roots.',
      check: c => graph(c, bootstrap) !== null && graph(c, main) !== null
        && parseProject(c.project.savedFiles, CAPSTONE_MANIFEST).diagnostics.length === 0,
      hints: ['Repair the bounded work route, readiness condition and Foundry retry settings in the saved project.'],
      solution: solution(file('src/Trainer.Api/Program.cs'), file('src/Trainer.Api/appsettings.json')) },
    { id: 'bootstrap-preview', stageId: 'publish', text: 'Validate and preview the saved bootstrap Bicep root.',
      check: c => !!graph(c, bootstrap) && observed(c, bootstrap, 'validate') && !!preview(c, bootstrap),
      hints: ['Use bootstrap.bicepparam with the bootstrap deployment target.'],
      solution: solution(shell(deploy('validate', bootstrap)), shell(deploy('what-if', bootstrap))) },
    { id: 'bootstrap-create', stageId: 'publish', text: 'Apply and inspect the bootstrap registry and identity.',
      check: c => afterPreview(c, bootstrap) && observed(c, bootstrap, 'show', applied(c, bootstrap)?.id)
        && c.sandbox.containerRegistries.some(r => same(r.name, bootstrap.registryName))
        && c.sandbox.managedIdentities.some(i => same(i.name, bootstrap.identityName)),
      hints: ['Apply the same bootstrap source that was previewed.'],
      solution: solution(shell(deploy('create', bootstrap)), shell(`az deployment group show --name ${bootstrap.deploymentName} --resource-group ${group}`)) },
    { id: 'publish-image', stageId: 'publish', text: 'Build api:v1 from the saved combined source into the bootstrap registry.',
      check: c => afterPreview(c, bootstrap) && !!build(c)
        && !!build(c).appSpec?.cpuRoute && build(c).appSpec?.healthEndpoints?.length === 3
        && !!build(c).appSpec?.foundry,
      hints: ['The ACR build captures saved source and settings.'],
      solution: solution(shell(`az acr build --registry ${main.registryName} --image api:v1 --file Dockerfile .`)) },
    { id: 'main-preview', stageId: 'deploy', text: 'Validate and preview the main root after publishing the image.',
      check: c => !!build(c) && !!graph(c, main) && observed(c, main, 'validate') && !!preview(c, main),
      hints: ['Use main.bicepparam, with the existing registry and identity from bootstrap.'],
      solution: solution(shell(deploy('validate', main)), shell(deploy('what-if', main))) },
    { id: 'main-create', stageId: 'deploy', text: 'Apply and inspect the application and exact role assignments.',
      check: c => afterPreview(c, main) && observed(c, main, 'show', applied(c, main)?.id) && activeReady(c),
      hints: ['Apply the previewed main graph and inspect the deployment output.'],
      solution: solution(shell(deploy('create', main)), shell(`az deployment group show --name ${main.deploymentName} --resource-group ${group}`)) },
    ...['baseline-request', 'baseline-startup', 'baseline-readiness', 'baseline-liveness', 'baseline-steady', 'baseline-overload', 'baseline-quiet']
      .map(id => evidenceTask(id, 'healthy', `Prove ${scenario[id].title.toLowerCase()} from the active application.`)),
    evidenceTask('incident-request', 'incident', 'Observe HTTP 502 with zero upstream attempts under the injected incident.',
      c => !!c.runtime.incident && passed(c, 'incident-request')
        && proof(c, 'incident-request').measurements?.status === 502
        && proof(c, 'incident-request').measurements?.upstream?.attempts?.length === 0
        && proof(c, 'incident-request').sequence > c.runtime.incident.sequence,
      { 'incident:identity': c => c.runtime.incident?.id ?? null }),
    { id: 'drift-preview', stageId: 'incident', text: 'Preview the app modification required to repair live drift.',
      check: c => !!c.runtime.incident && c.runtime.bicep.previews.some(item =>
        matches(c, main, item) && item.sequence > (proof(c, 'incident-request')?.sequence ?? Infinity)
          && item.sequence < (c.runtime.incident.repairAttempt?.sequence ?? Infinity)
          && item.operations.some(o => same(o.id, appId) && o.changeType === 'modify')),
      hints: ['Saved main source is correct. What-if shows the effective app configuration drift.'],
      solution: solution(shell(deploy('what-if', main))) },
    { id: 'repair-main', stageId: 'incident', text: 'Reapply saved main Bicep and restore the Foundry deployment.',
      check: c => c.runtime.incident?.status === 'repaired' && afterPreview(c, main) && activeReady(c)
        && applied(c, main).sequence > preview(c, main).sequence,
      hints: ['Use deployment group create, not a manual app environment update.'],
      solution: solution(shell(deploy('create', main))) },
    evidenceTask('repair-transient', 'incident', 'Prove 429 Retry-After followed by public HTTP 200.',
      c => activeReady(c) && afterIncident(c, 'repair-transient') && c.runtime.incident?.status === 'repaired'),
    ...['recovery-request', 'recovery-startup', 'recovery-readiness', 'recovery-liveness', 'recovery-steady',
      'recovery-overload', 'recovery-quiet', 'recovery-persistent'].map(id => evidenceTask(id, 'recovery',
      `Collect fresh ${scenario[id].title.toLowerCase()} evidence after repair.`,
      c => activeReady(c) && afterIncident(c, id) && proof(c, id).sequence > proof(c, 'repair-transient')?.sequence)),
    { id: 'noop-preview', stageId: 'recovery', text: 'Preview the current main source with no changes after fresh recovery proofs.',
      check: c => !!preview(c, main) && noChange(preview(c, main).operations)
        && preview(c, main).sequence > recoveryProofSequence(c),
      hints: ['After the operating proof, what-if should report no changes.'],
      solution: solution(shell(deploy('what-if', main))) },
    { id: 'noop-reapply', stageId: 'recovery', text: 'Reapply the same main source without changes.',
      check: c => afterPreview(c, main) && noChange(applied(c, main).operations)
        && preview(c, main).sequence > recoveryProofSequence(c)
        && applied(c, main).sequence > preview(c, main).sequence && noChange(preview(c, main).operations),
      hints: ['Apply the no-change preview and inspect the deployment.'],
      solution: solution(shell(deploy('create', main)), shell(`az deployment group show --name ${main.deploymentName} --resource-group ${group}`)) },
    { id: 'delete-groups', stageId: 'cleanup', text: 'Delete every attempt-created group after the recovery checkpoint.',
      check: c => !!c.stages.cleanupCheckpoint && c.sandbox.resourceGroups.length === 0
        && c.sandbox.containerApps.length === 0 && c.sandbox.containerRegistries.length === 0
        && c.sandbox.managedIdentities.length === 0 && c.sandbox.roleAssignments.length === 0
        && c.sandbox.foundryAccounts.length === 0 && Object.keys(c.artifacts.publishedTags).length === 0
        && Object.keys(c.runtime.deploymentsByApp).length === 0,
      hints: ['The recovery seal creates a checkpoint. Delete all groups owned by this attempt, including extras.'],
      solution: solution(shell(`az group delete -n ${group} --yes`)) },
  ],
}
