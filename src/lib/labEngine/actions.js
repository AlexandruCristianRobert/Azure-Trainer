import { runLine } from '../az/shell.js'
import { saveProjectFile } from '../project/files.js'
import { getProjectManifest } from '../project/manifests.js'
import { appArmId, deleteRegistryPublications, reconcileDeployment, removeDeletedDeployments } from '../simulation/runtime.js'
import { getRequestScenario, simulateRequest } from '../simulation/requests.js'
import { foundryEvidenceDependencies, simulateFoundryRequest } from '../simulation/inference.js'
import { advanceSimulation, reconcileCpuRuntime } from '../simulation/cpu.js'
import { advanceProbeSimulation, reconcileProbeRuntime, resetProbeExperiment } from '../simulation/probes.js'
import { canonicalize, recordVerification } from './evidence.js'
import { cloneJson, contextFor, isJsonValue, validateBehavioralLab, validateBehavioralRun } from './run.js'
import { fail } from './errors.js'
import { applyBicepDeployment } from '../bicep/deploy.js'
import { appendBicepObservation, appendBicepPreview, bicepTargetKey, latestBicepAttempt, validBicepProvenance } from '../bicep/provenance.js'
import { bicepCommandSource, bicepTargetFor } from '../az/commands/deployment.js'
import { compileBicepProject } from '../bicep/compile.js'
import { previewBicepDeployment } from '../bicep/preview.js'
import { getResourceGroup } from '../sandbox/ops.js'
import { getContainerApp } from '../sandbox/containerapps.js'
import { capstoneStages, cleanupReady, createStageSeal, recoveryCheckpoint, stageMilestone } from './stages.js'
import { injectCapstoneIncident } from './incident.js'
import { evaluateLab } from './evaluate.js'
import { MAX_SOURCE_SAVES, sourceTextHash } from './sourceJournal.js'
import { emptyClusterState, validateKubernetesRuntime } from '../kubernetes/state.js'
import { applyAksAction } from '../kubernetes/actions.js'
import { refreshKubernetesDependencies } from '../kubernetes/evidence.js'

const diagnostic = (code, message, path = '') => ({ code, message, path, line: 1, column: 1 })
const envelope = (run, lines = [], portalEvents = [], diagnostics = []) => ({ run, lines, portalEvents, diagnostics })
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const bicepDeploymentProvenance = bicep => ({ nextAttempt: bicep?.nextAttempt ?? null,
  attempts: bicep?.attempts ?? [],
  currentByTarget: Object.fromEntries(Object.entries(bicep?.currentByTarget ?? {}).map(([key, target]) => [key,
    Object.fromEntries(['latest', 'successful', 'failed'].filter(field => target[field] !== undefined)
      .map(field => [field, target[field]]))])) })

function actionError(run, message) { return envelope(run, [], [], [diagnostic('INVALID_ACTION', message)]) }
function validPath(path, run) { return typeof path === 'string' && getProjectManifest(run?.project?.manifestId).files.includes(path) }
function appendOutput(run, lines, commandLine = null, clear = false) {
  return { ...run, scrollback: [...(clear ? [] : run.scrollback), ...lines].slice(-600),
    history: commandLine === null ? run.history : [...run.history, commandLine].slice(-600) }
}

function validBicepEffect(effect, run, lab) {
  const options = effect?.options
  const graph = effect?.graph
  const versions = options?.fileVersions ?? run.project?.fileVersions
  return lab?.capabilities?.bicepDeployment === true && validBicepProvenance(run.runtime?.bicep)
    && isJsonValue(effect) && Object.keys(effect).every(key => ['type', 'graph', 'options'].includes(key))
    && effect.type === 'bicep-deployment' && graph && typeof graph === 'object' && !Array.isArray(graph)
    && typeof graph.target?.id === 'string' && graph.target.id.length > 0
    && typeof graph.target?.name === 'string' && graph.target.name.length > 0
    && typeof graph.target?.location === 'string' && graph.target.location.length > 0
    && Array.isArray(graph.order) && graph.order.length <= 32
    && graph.order.every(node => node?.kind === 'resource' || node?.kind === 'module')
    && JSON.stringify(graph).length <= 1_000_000
    && options && typeof options === 'object' && !Array.isArray(options)
    && Object.keys(options).every(key => ['name', 'sourceHash', 'parameterHash', 'fileVersions', 'parameterPath', 'templatePath'].includes(key))
    && ['name', 'sourceHash', 'parameterHash'].every(key => typeof options[key] === 'string'
      && options[key].length > 0 && options[key].length <= 512)
    && versions && typeof versions === 'object' && !Array.isArray(versions)
    && Object.keys(versions).length <= 12
    && Object.entries(versions).every(([path, value]) => typeof path === 'string' && path.length > 0
      && path.length <= 512 && Number.isInteger(value) && value >= 0)
    && (!Array.isArray(lab?.bicepTargets) || typeof options.parameterPath === 'string'
      && (() => { const target = bicepTargetFor(lab, graph.target.name, options.name, options.parameterPath)
        return !!target && (target.templatePath === undefined || options.templatePath === target.templatePath) })())
}

function compiledFromRun(run, resourceGroup, parameterPath) {
  const manifest = getProjectManifest(run.project?.manifestId)
  if (!manifest.bicepFiles) fail('INVALID_EFFECT', 'The run has no Bicep files.')
  const group = getResourceGroup(run.sandbox, resourceGroup)
  const result = compileBicepProject(run.project.savedFiles, manifest, { resourceGroup: group, parameterPath })
  if (result.diagnostics.length) fail('INVALID_EFFECT', 'The saved Bicep files do not compile.')
  return result.graph
}

export function applyCommandEffects(run, effects, lab) {
  let next = run
  const events = []
  const diagnostics = []
  for (const effect of effects) {
    if (effect.type === 'aks-context') {
      if (lab?.capabilities?.kubernetes !== true || !isJsonValue(effect) || Object.keys(effect).some(key => !['type', 'name', 'clusterId', 'overwrite'].includes(key)) || typeof effect.name !== 'string' || typeof effect.clusterId !== 'string' || typeof effect.overwrite !== 'boolean') fail('INVALID_EFFECT', 'AKS context effect is malformed or unavailable in this Lab.')
      const cluster = next.sandbox.aksClusters?.find(item => item.id.toLowerCase() === effect.clusterId.toLowerCase())
      if (!cluster) fail('INVALID_EFFECT', 'AKS context references an unavailable cluster.')
      const current = next.runtime.kubernetes?.contexts?.[effect.name]
      if (current && current.clusterId.toLowerCase() !== cluster.id.toLowerCase() && !effect.overwrite) { diagnostics.push(diagnostic('CONTEXT_CONFLICT', 'A context with this name points to a different cluster.')); continue }
      const sameCluster = current?.clusterId === cluster.id
      const contexts = { ...next.runtime.kubernetes.contexts, [effect.name]: { clusterId: cluster.id, namespace: sameCluster ? current.namespace : 'default' } }
      next = { ...next, runtime: { ...next.runtime, kubernetes: { ...next.runtime.kubernetes, contexts, currentContext: effect.name } } }
    } else if (effect.type === 'kubernetes-state') {
      if (lab?.capabilities?.kubernetes !== true || !isJsonValue(effect) || Object.keys(effect).some(key => !['type', 'kubernetes', 'nextSequence'].includes(key)) || !Number.isInteger(effect.nextSequence) || effect.nextSequence < next.nextSequence) fail('INVALID_EFFECT', 'Kubernetes state effect is malformed or unavailable in this Lab.')
      const candidate = { ...next, runtime: { ...next.runtime, kubernetes: cloneJson(effect.kubernetes) }, nextSequence: effect.nextSequence }
      if (!validateKubernetesRuntime(candidate.runtime.kubernetes, candidate)) fail('INVALID_EFFECT', 'Kubernetes state effect is malformed.')
      next = candidate
    } else if (effect.type === 'publish-build') {
      if (!effect.artifacts || !Number.isInteger(effect.nextSequence) || effect.nextSequence <= next.nextSequence
        || typeof effect.artifacts.buildsById !== 'object' || typeof effect.artifacts.publishedTags !== 'object'
        || typeof effect.artifacts.sourceSnapshotsByHash !== 'object') fail('INVALID_EFFECT', 'Build publication effect is malformed.')
      next = { ...next, artifacts: cloneJson(effect.artifacts), nextSequence: effect.nextSequence }
    } else if (effect.type === 'delete-registry-publications') {
      if (!Array.isArray(effect.registryIds) || !effect.registryIds.every((id) => typeof id === 'string')) fail('INVALID_EFFECT', 'Registry deletion effect is malformed.')
      next = deleteRegistryPublications(next, effect.registryIds)
    } else if (effect.type === 'bicep-preview') {
      if (lab?.capabilities?.bicepDeployment !== true || !validBicepProvenance(next.runtime?.bicep)
        || !isJsonValue(effect) || Object.keys(effect).some(key => !['type', 'name', 'resourceGroup', 'parameterPath', 'templatePath'].includes(key))
        || typeof effect.name !== 'string' || !effect.name || effect.name.length > 512
        || typeof effect.resourceGroup !== 'string' || !effect.resourceGroup || effect.resourceGroup.length > 90
        || !bicepTargetFor(lab, effect.resourceGroup, effect.name, effect.parameterPath ?? 'infra/first.bicepparam')
        || (bicepTargetFor(lab, effect.resourceGroup, effect.name, effect.parameterPath ?? 'infra/first.bicepparam').templatePath
          ? effect.templatePath !== bicepTargetFor(lab, effect.resourceGroup, effect.name, effect.parameterPath).templatePath
          : effect.templatePath !== undefined))
        fail('INVALID_EFFECT', 'Bicep preview effect is malformed or unavailable in this Lab.')
      const graph = compiledFromRun(next, effect.resourceGroup, effect.parameterPath)
      const preview = previewBicepDeployment(graph, next.sandbox, next.artifacts, lab, next)
      if (preview.diagnostics.length) fail('INVALID_EFFECT', 'The saved Bicep preview is invalid.')
      const source = bicepCommandSource(next, effect.parameterPath)
      const record = { key: bicepTargetKey(graph.target.name, effect.name), target: graph.target.name,
        name: effect.name, ...source,
        ...(Array.isArray(lab?.bicepTargets) ? { parameterPath: effect.parameterPath, sequence: next.nextSequence } : {}),
        operations: preview.operations.map(({ id, type, name, changeType }) => ({ id, type, name, changeType })) }
      const incident = lab?.bicepIncident
      const captureIncident = lab?.capabilities?.bicepIdentityFault === true && incident && !next.runtime.bicep.incidentPreview
        && record.target === incident.resourceGroup && record.name === incident.deploymentName
        && record.parameterHash === incident.parameterHash
        && record.fileVersions['infra/first.bicepparam'] === incident.parameterVersion
        && record.operations.some(item => item.type === 'Microsoft.App/managedEnvironments'
          && item.name === incident.wrongEnvironmentName && item.changeType === 'create'
          && item.id.toLowerCase() === `${graph.target.id}/providers/Microsoft.App/managedEnvironments/${incident.wrongEnvironmentName}`.toLowerCase())
      const bicep = appendBicepPreview(next.runtime.bicep, record, { captureIncident })
      next = { ...next, ...(Array.isArray(lab?.bicepTargets) ? { nextSequence: next.nextSequence + 1 } : {}),
        runtime: { ...next.runtime, bicep } }
    } else if (effect.type === 'bicep-observation') {
      if (lab?.capabilities?.bicepDeployment !== true || !validBicepProvenance(next.runtime?.bicep)
        || !isJsonValue(effect) || Object.keys(effect).some(key => !['type', 'kind', 'name', 'resourceGroup', 'parameterPath', 'templatePath'].includes(key))
        || !['validate', 'show', 'app-show'].includes(effect.kind)
        || typeof effect.name !== 'string' || !effect.name || effect.name.length > 512
        || typeof effect.resourceGroup !== 'string' || !effect.resourceGroup || effect.resourceGroup.length > 90)
        fail('INVALID_EFFECT', 'Bicep observation effect is malformed or unavailable in this Lab.')
      const group = getResourceGroup(next.sandbox, effect.resourceGroup)
      const mapped = Array.isArray(lab?.bicepTargets) && effect.kind === 'app-show'
        ? lab.bicepTargets.find(target => target.resourceGroup?.toLowerCase() === group.name.toLowerCase()
          && target.appName?.toLowerCase() === effect.name.toLowerCase()) : null
      if (mapped && effect.parameterPath !== undefined && effect.parameterPath !== mapped.parameterPath)
        fail('INVALID_EFFECT', 'The inspected app parameter path does not match its target.')
      const deploymentName = mapped?.deploymentName ?? (effect.kind === 'app-show' ? lab?.bicepInspect?.deploymentName : effect.name)
      if (effect.kind === 'app-show' && Array.isArray(lab?.bicepTargets) && !mapped)
        fail('INVALID_EFFECT', 'The inspected app does not match a Bicep target.')
      const path = mapped?.parameterPath ?? effect.parameterPath
      const expectedTarget = bicepTargetFor(lab, group.name, deploymentName, path ?? 'infra/first.bicepparam')
      if (expectedTarget?.templatePath && effect.templatePath !== undefined && effect.templatePath !== expectedTarget.templatePath)
        fail('INVALID_EFFECT', 'The observed template does not match its target.')
      if (expectedTarget?.templatePath && effect.kind !== 'app-show' && effect.templatePath !== expectedTarget.templatePath)
        fail('INVALID_EFFECT', 'The observed template is missing or mismatched.')
      if (effect.kind === 'validate' && !bicepTargetFor(lab, group.name, effect.name, path ?? 'infra/first.bicepparam'))
        fail('INVALID_EFFECT', 'The selected parameter file does not match this target.')
      if (effect.kind !== 'app-show' && Array.isArray(lab?.bicepTargets)
        && !bicepTargetFor(lab, group.name, effect.name, path))
        fail('INVALID_EFFECT', 'The observation does not match a Bicep target.')
      const source = bicepCommandSource(next, path)
      let observedAttempt = null
      if (effect.kind === 'validate') {
        const graph = compiledFromRun(next, group.name, path)
        if (previewBicepDeployment(graph, next.sandbox, next.artifacts, lab, next).diagnostics.length)
          fail('INVALID_EFFECT', 'The saved Bicep validation is invalid.')
      } else {
        if (effect.kind === 'app-show') {
          if (!mapped && (lab?.bicepInspect?.resourceGroup !== group.name || lab.bicepInspect.appName !== effect.name))
            fail('INVALID_EFFECT', 'The inspected app does not match this Bicep Lab target.')
          getContainerApp(next.sandbox, group.name, effect.name)
        }
        observedAttempt = latestBicepAttempt(next.runtime.bicep, group.name, deploymentName)
        if (!observedAttempt) fail('INVALID_EFFECT', 'The deployment to inspect does not exist.')
        if (Array.isArray(lab?.bicepTargets) && observedAttempt.parameterPath !== path)
          fail('INVALID_EFFECT', 'The observed deployment parameter path does not match its target.')
      }
      const recordName = observedAttempt?.name ?? effect.name
      const record = { kind: effect.kind, key: bicepTargetKey(group.name, recordName), target: group.name,
        name: recordName, ...(observedAttempt ? { sourceHash: observedAttempt.sourceHash,
          parameterHash: observedAttempt.parameterHash, fileVersions: observedAttempt.fileVersions,
          attemptId: observedAttempt.id, ...(observedAttempt.templatePath ? { templatePath: observedAttempt.templatePath } : {}) } : source),
        ...(Array.isArray(lab?.bicepTargets) ? { parameterPath: observedAttempt?.parameterPath ?? path } : {}) }
      next = { ...next, runtime: { ...next.runtime, bicep: appendBicepObservation(next.runtime.bicep, record) } }
    } else if (effect.type === 'bicep-deployment') {
      if (!validBicepEffect(effect, next, lab)) {
        fail('INVALID_EFFECT', 'Bicep deployment effect is malformed or unavailable in this Lab.')
      }
      if (getProjectManifest(next.project?.manifestId).bicepFiles) {
        if (Array.isArray(lab?.bicepTargets) && !bicepTargetFor(lab, effect.graph.target.name,
          effect.options.name, effect.options.parameterPath))
          fail('INVALID_EFFECT', 'The deployment target does not match its parameter file.')
        const compiled = compiledFromRun(next, effect.graph.target.name, effect.options.parameterPath)
        const source = bicepCommandSource(next, effect.options.parameterPath)
        if (JSON.stringify(compiled) !== JSON.stringify(effect.graph)
          || Object.entries(source).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(effect.options[key])))
          fail('INVALID_EFFECT', 'Bicep deployment effect does not match the saved files.')
      }
      const before = next.runtime.deploymentsByApp
      const deployed = applyBicepDeployment(next, effect.graph, effect.options, lab)
      if (!validBicepProvenance(deployed.run.runtime.bicep))
        fail('INVALID_EFFECT', 'Bicep deployment provenance exceeds its bounded schema.')
      next = deployed.run
      events.push(...deployed.events)
      diagnostics.push(...deployed.diagnostics)
      for (const event of deployed.events) {
        const id = event.appId
        if (before[id]?.active?.generation !== next.runtime.deploymentsByApp[id]?.active?.generation) {
          const key = `deployment:${id}`
          next = { ...next, dependencyGenerations: { ...next.dependencyGenerations,
            [key]: (next.dependencyGenerations[key] ?? 0) + 1 } }
        }
      }
    } else fail('INVALID_EFFECT', `Unknown command effect '${effect.type}'.`)
  }
  return { run: next, events, diagnostics }
}

function commandAction(run, action, lab) {
  if (typeof action.line !== 'string' || action.line.length > 4096) return actionError(run, 'A bounded command line is required.')
  const result = runLine(run.sandbox, action.line, { run, lab })
  if (!isJsonValue(result.sandbox) || !isJsonValue(result.lines) || !isJsonValue(result.events ?? [])) fail('INVALID_EFFECT', 'The command returned unsupported data.')
  if (capstoneStages(lab) && !run.stages.cleanupCheckpoint
    && (result.events ?? []).some(event => event.type === 'deleted' && event.resourceType === 'resourceGroup'))
    return actionError(run, 'Seal the recovery checkpoint before deleting a Capstone resource group.')
  let next = { ...run, sandbox: result.sandbox }
  const incident = run.runtime.incident
  if (incident?.status === 'active') {
    const previous = run.sandbox.containerApps.find(app => appArmId(app) === incident.appId)
    const current = next.sandbox.containerApps.find(app => appArmId(app) === incident.appId)
    if (!current) return actionError(run, 'The incident app must be repaired from saved main Bicep before deletion.')
    const base = { ...previous }; delete base.incidentDrift
    const candidate = { ...current }; delete candidate.incidentDrift
    if (canonicalize(base) !== canonicalize(candidate))
      return actionError(run, 'The incident app must be repaired from current saved main Bicep.')
    next = { ...next, sandbox: { ...next.sandbox, containerApps: next.sandbox.containerApps.map(app =>
      app === current ? { ...app, incidentDrift: cloneJson(previous.incidentDrift) } : app) } }
  }
  const appliedEffects = applyCommandEffects(next, result.effects ?? [], lab)
  next = appliedEffects.run
  if (lab.capabilities?.kubernetes === true && next.runtime.kubernetes) {
    const ids = new Set((next.sandbox.aksClusters ?? []).map(cluster => cluster.id.toLowerCase()))
    const contexts = Object.fromEntries(Object.entries(next.runtime.kubernetes.contexts).filter(([, context]) => ids.has(context.clusterId.toLowerCase())))
    const currentContext = contexts[next.runtime.kubernetes.currentContext] ? next.runtime.kubernetes.currentContext : null
    const clusters = Object.fromEntries((next.sandbox.aksClusters ?? []).map(cluster => [cluster.id,
      next.runtime.kubernetes.clusters[cluster.id] ?? emptyClusterState(cluster.id)]))
    next = { ...next, runtime: { ...next.runtime, kubernetes: { ...next.runtime.kubernetes, contexts, currentContext, clusters } } }
  }
  if (lab.capabilities?.foundryInference === true) {
    const generations = { ...next.dependencyGenerations }
    for (const [appId, deployment] of Object.entries(run.runtime.deploymentsByApp)) {
      if (!deployment?.active?.foundry) continue
      const key = `foundry:${appId}`
      const selectors = foundryEvidenceDependencies(appId)
      const changed = Object.entries(selectors).some(([name, selector]) => name !== key
        && canonicalize(selector(contextFor(run))) !== canonicalize(selector(contextFor(next))))
      if (changed) generations[key] = (generations[key] ?? 0) + 1
    }
    next = { ...next, dependencyGenerations: generations }
  }
  let diagnostics = [...(result.diagnostics ?? []), ...appliedEffects.diagnostics]
  if (lab.capabilities?.acrBuild === true) {
    next = removeDeletedDeployments(next)
    for (const event of result.events ?? []) {
      if (event.resourceType !== 'containerApp' || !['created', 'updated'].includes(event.type)) continue
      const app = next.sandbox.containerApps.find((candidate) => candidate.name.toLowerCase() === event.name.toLowerCase()
        && candidate.resourceGroup.toLowerCase() === event.resourceGroup.toLowerCase())
      if (!app) continue
      const before = next.runtime.deploymentsByApp[appArmId(app)]?.active?.generation
      const reconciled = reconcileDeployment(next, app)
      next = reconciled.run
      diagnostics = [...diagnostics, ...reconciled.diagnostics]
      if (before !== next.runtime.deploymentsByApp[appArmId(app)]?.active?.generation) {
        const key = `deployment:${appArmId(app)}`
        next.dependencyGenerations = { ...next.dependencyGenerations, [key]: (next.dependencyGenerations[key] ?? 0) + 1 }
      }
    }
  }
  if (lab.capabilities?.cpuScaling === true) next = reconcileCpuRuntime(next, lab)
  if (lab.capabilities?.healthProbes === true) next = reconcileProbeRuntime(next, lab)
  if (capstoneStages(lab)) {
    const created = (result.events ?? []).filter(event => event.type === 'created' && event.resourceType === 'resourceGroup')
      .map(event => event.name.toLowerCase())
    if (run.stages.groupCreations.length + created.length > 64) return actionError(run, 'The Capstone group creation limit has been reached.')
    const groupCreations = [...run.stages.groupCreations]
    const groupReceipts = [...run.evidence.groupReceipts]
    for (const name of created) {
      const record = { sequence: next.nextSequence++, attemptId: run.attemptId, name }
      groupCreations.push(record)
      groupReceipts.push({ ...record, kind: 'group-created', command: action.line })
    }
    const ownedGroups = [...new Set(groupCreations.map(record => record.name))].sort()
    const deletedApps = [...run.stages.deletedApps]
    if (run.stages.cleanupCheckpoint) {
      const present = new Set(next.sandbox.containerApps.map(appArmId))
      for (const app of run.sandbox.containerApps) {
        const appId = appArmId(app)
        if (!present.has(appId)) deletedApps.push({ sequence: next.nextSequence++, attemptId: run.attemptId, appId })
      }
    }
    if (deletedApps.length > 64) return actionError(run, 'The Capstone app deletion limit has been reached.')
    next = { ...next, evidence: { ...next.evidence, groupReceipts },
      stages: { ...next.stages, groupCreations, ownedGroups, deletedApps } }
  }
  next = appendOutput(next, result.clear ? [] : [{ kind: 'cmd', text: action.line }, ...result.lines], action.line, result.clear === true)
  return envelope(next, result.lines, [...(result.events ?? []), ...appliedEffects.events], diagnostics)
}

function cpuFixture(lab, scenarioId) {
  const fixture = lab.scenarios?.[scenarioId]
  if (!fixture || fixture.kind !== 'cpu' || !Number.isInteger(fixture.version) || fixture.version < 1
    || typeof fixture.appId !== 'string' || !fixture.appId || typeof fixture.title !== 'string'
    || !Number.isInteger(fixture.durationSeconds) || fixture.durationSeconds < 1 || fixture.durationSeconds > 600
    || !Number.isFinite(fixture.demandCpuSecondsPerSecond) || fixture.demandCpuSecondsPerSecond < 0
    || !Number.isFinite(fixture.requestCpuSeconds) || fixture.requestCpuSeconds <= 0
    || typeof fixture.assess !== 'function') return null
  return fixture
}

function legacyCpuScenario(run, lab) {
  const active = run.runtime.activeScenario
  const fixture = active?.kind === undefined && cpuFixture(lab, active?.scenarioId)
  return !!fixture && active.version === fixture.version && active.appId === fixture.appId
    && Array.isArray(active.trace)
}

function cpuAction(run, action, lab) {
  if (lab.capabilities?.cpuScaling !== true) return actionError(run, 'CPU simulation actions are available only in a CPU scaling Lab.')
  const allowed = {
    'scenario-start': ['type', 'scenarioId'], 'simulation-advance': ['type', 'seconds'],
    'scenario-pause': ['type'], 'scenario-resume': ['type'], 'scenario-cancel': ['type'],
  }[action.type]
  if (!allowed || Object.keys(action).some((key) => !allowed.includes(key))) {
    return actionError(run, 'CPU simulation actions accept only the declared fields; workload and outcomes come from the Lab scenario.')
  }
  if (action.type === 'scenario-start') {
    if (typeof action.scenarioId !== 'string') return actionError(run, 'A named CPU scenario is required.')
    const fixture = cpuFixture(lab, action.scenarioId)
    if (!fixture) return actionError(run, 'The CPU scenario is unknown or invalid.')
    if (!lab.tasks.some((task) => task.verification?.scenarioId === action.scenarioId && task.verification.scenarioVersion === fixture.version)) {
      return actionError(run, 'The CPU scenario does not match a Task verification.')
    }
    if (run.runtime.activeScenario) return actionError(run, 'Finish or cancel the active scenario first.')
    const reconciled = reconcileCpuRuntime(run, lab)
    const app = reconciled.sandbox.containerApps.find((candidate) => appArmId(candidate) === fixture.appId)
    const deployment = reconciled.runtime.deploymentsByApp[fixture.appId]
    if (!app || !deployment?.active || deployment.status !== 'succeeded') return actionError(run, 'A healthy captured API deployment is required for this CPU scenario.')
    if (deployment.active.ingress !== 'external' || deployment.active.targetPort !== deployment.active.listeningPort) {
      return actionError(run, 'The captured API must be reachable through external ingress.')
    }
    const runtime = cloneJson(reconciled.runtime)
    const state = runtime.cpuByApp[fixture.appId]
    state.demandCpuSecondsPerSecond = fixture.demandCpuSecondsPerSecond
    state.requestCpuSeconds = fixture.requestCpuSeconds
    runtime.activeScenario = { kind: 'cpu', scenarioId: action.scenarioId, version: fixture.version, appId: fixture.appId,
      startedAtMs: runtime.simTimeMs, elapsedSeconds: 0, paused: false,
      startReadyReplicas: state.readyReplicas, maxReadyReplicas: state.readyReplicas, trace: [] }
    return envelope({ ...reconciled, runtime })
  }
  if (!run.runtime.activeScenario || (run.runtime.activeScenario.kind !== 'cpu' && !legacyCpuScenario(run, lab))) {
    return actionError(run, 'There is no active CPU scenario.')
  }
  if (action.type === 'scenario-pause') {
    if (run.runtime.activeScenario.paused) return actionError(run, 'The scenario is already paused.')
    return envelope({ ...run, runtime: { ...run.runtime, activeScenario: { ...run.runtime.activeScenario, paused: true } } })
  }
  if (action.type === 'scenario-resume') {
    if (!run.runtime.activeScenario.paused) return actionError(run, 'The scenario is already running.')
    return envelope({ ...run, runtime: { ...run.runtime, activeScenario: { ...run.runtime.activeScenario, paused: false } } })
  }
  if (action.type === 'scenario-cancel') {
    const runtime = cloneJson(run.runtime)
    runtime.cpuByApp[runtime.activeScenario.appId].demandCpuSecondsPerSecond = 0
    runtime.activeScenario = null
    return envelope({ ...run, runtime })
  }
  if (!Number.isInteger(action.seconds) || action.seconds < 1 || action.seconds > 300) {
    return actionError(run, 'Simulation advance must be an integer from 1 to 300 seconds.')
  }
  if (run.runtime.activeScenario.paused) return actionError(run, 'Resume the paused scenario before advancing.')
  const { run: advanced, completed } = advanceSimulation(run, action.seconds, lab)
  if (!completed) return envelope(advanced)
  const fixture = cpuFixture(lab, completed.scenarioId)
  const task = lab.tasks.find((candidate) => candidate.verification?.scenarioId === completed.scenarioId
    && candidate.verification.scenarioVersion === completed.version)
  const passed = fixture.assess(cloneJson(completed.measurements), contextFor(advanced)) === true
  return envelope(recordVerification(advanced, lab, task.id, { scenarioId: completed.scenarioId,
    scenarioVersion: completed.version, outcome: passed ? 'passed' : 'failed', completed: true,
    startedAtMs: completed.startedAtMs, endedAtMs: completed.endedAtMs, measurements: completed.measurements }))
}

function probeFixture(lab, scenarioId) {
  const fixture = lab.scenarios?.[scenarioId]
  if (!fixture || fixture.kind !== 'probes' || !Number.isInteger(fixture.version) || fixture.version < 1
    || typeof fixture.appId !== 'string' || !fixture.appId || typeof fixture.title !== 'string' || !fixture.title
    || !Number.isInteger(fixture.durationSeconds) || fixture.durationSeconds < 1 || fixture.durationSeconds > 600
    || !Number.isInteger(fixture.startupSeconds) || fixture.startupSeconds < 0 || fixture.startupSeconds > 600
    || fixture.requestsPerSecond !== 2
    || !Array.isArray(fixture.faults) || typeof fixture.assess !== 'function'
    || fixture.faults.some((fault) => !fault || Object.keys(fault).some((key) => !['atSecond', 'replica', 'type', 'active'].includes(key))
      || !Number.isInteger(fault.atSecond) || fault.atSecond < 1 || fault.atSecond > fixture.durationSeconds
      || !Number.isInteger(fault.replica) || fault.replica < 0 || fault.replica > 1
      || !['readiness', 'hang', 'dependency'].includes(fault.type) || typeof fault.active !== 'boolean')) return null
  return fixture
}

function probeAction(run, action, lab) {
  if (lab.capabilities?.healthProbes !== true) return actionError(run, 'Probe simulation actions are available only in a health probes Lab.')
  const allowed = {
    'scenario-start': ['type', 'scenarioId'], 'simulation-advance': ['type', 'seconds'],
    'scenario-pause': ['type'], 'scenario-resume': ['type'], 'scenario-cancel': ['type'],
  }[action.type]
  if (!allowed || Object.keys(action).some((key) => !allowed.includes(key))) {
    return actionError(run, 'Probe actions accept only declared fields; faults and outcomes come from the Lab scenario.')
  }
  if (action.type === 'scenario-start') {
    if (typeof action.scenarioId !== 'string') return actionError(run, 'A named probe scenario is required.')
    const fixture = probeFixture(lab, action.scenarioId)
    if (!fixture) return actionError(run, 'The probe scenario is unknown or invalid.')
    if (!lab.tasks.some((task) => task.verification?.scenarioId === action.scenarioId && task.verification.scenarioVersion === fixture.version)) {
      return actionError(run, 'The probe scenario does not match a Task verification.')
    }
    if (run.runtime.activeScenario) return actionError(run, 'Finish or cancel the active scenario first.')
    const reconciled = reconcileProbeRuntime(run, lab)
    const deployment = reconciled.runtime.deploymentsByApp[fixture.appId]
    const active = deployment?.active
    if (!reconciled.sandbox.containerApps.some((app) => appArmId(app) === fixture.appId)
      || deployment?.status !== 'succeeded' || !active?.probeConfig || !reconciled.runtime.probesByApp?.[fixture.appId]
      || active.ingress !== 'external' || active.targetPort !== active.listeningPort
      || active.probeConfig.minReplicas !== (lab.capabilities?.acaCapstone === true ? 1 : 2))
      return actionError(run, 'A healthy captured API deployment with the Lab replica minimum is required for this probe scenario.')
    const runtime = cloneJson(reconciled.runtime)
    resetProbeExperiment(runtime, fixture.appId)
    runtime.activeScenario = { kind: 'probes', scenarioId: action.scenarioId, version: fixture.version,
      appId: fixture.appId, startedAtMs: runtime.simTimeMs, elapsedSeconds: 0, paused: false }
    return envelope({ ...reconciled, runtime })
  }
  if (!run.runtime.activeScenario || run.runtime.activeScenario.kind !== 'probes') return actionError(run, 'There is no active probe scenario.')
  if (action.type === 'scenario-pause') {
    if (run.runtime.activeScenario.paused) return actionError(run, 'The scenario is already paused.')
    return envelope({ ...run, runtime: { ...run.runtime, activeScenario: { ...run.runtime.activeScenario, paused: true } } })
  }
  if (action.type === 'scenario-resume') {
    if (!run.runtime.activeScenario.paused) return actionError(run, 'The scenario is already running.')
    return envelope({ ...run, runtime: { ...run.runtime, activeScenario: { ...run.runtime.activeScenario, paused: false } } })
  }
  if (action.type === 'scenario-cancel') return envelope({ ...run, runtime: { ...run.runtime, activeScenario: null } })
  if (!Number.isInteger(action.seconds) || action.seconds < 1 || action.seconds > 300) {
    return actionError(run, 'Simulation advance must be an integer from 1 to 300 seconds.')
  }
  if (run.runtime.activeScenario.paused) return actionError(run, 'Resume the paused scenario before advancing.')
  const { run: advanced, completed } = advanceProbeSimulation(run, action.seconds, lab)
  if (!completed) return envelope(advanced)
  const fixture = probeFixture(lab, completed.scenarioId)
  const task = lab.tasks.find((candidate) => candidate.verification?.scenarioId === completed.scenarioId
    && candidate.verification.scenarioVersion === completed.version)
  const passed = fixture.assess(cloneJson(completed.measurements), contextFor(advanced)) === true
  return envelope(recordVerification(advanced, lab, task.id, { scenarioId: completed.scenarioId,
    scenarioVersion: completed.version, outcome: passed ? 'passed' : 'failed', completed: true,
    startedAtMs: completed.startedAtMs, endedAtMs: completed.endedAtMs, measurements: completed.measurements }))
}

function requestAction(run, action, lab) {
  if (Object.hasOwn(action, 'scenarioId')) {
    if (lab.capabilities?.foundryInference !== true || typeof action.scenarioId !== 'string'
      || Object.keys(action).some((key) => !['type', 'scenarioId'].includes(key))) {
      return actionError(run, 'Foundry requests accept only a named Lab fixture; request outcomes cannot be supplied by the caller.')
    }
    const task = lab.tasks.find((candidate) => candidate.verification?.scenarioId === action.scenarioId)
    const scenario = task && getRequestScenario(lab, task.id)
    if (!scenario || scenario.kind !== 'foundry') return actionError(run, 'The named Foundry request fixture is unknown or invalid.')
    const response = simulateFoundryRequest(run, scenario)
    let bicepRequest = null
    if (lab.capabilities?.bicepIdentityFault === true && action.scenarioId === 'access-denied' && lab.bicepInspect) {
      const target = lab.bicepInspect.resourceGroup
      const deploymentName = lab.bicepInspect.deploymentName
      const attempt = latestBicepAttempt(run.runtime.bicep, target, deploymentName)
      const source = bicepCommandSource(run)
      let authoredDecoyRole = false
      try {
        const graph = compiledFromRun(run, target)
        const checked = previewBicepDeployment(graph, run.sandbox, run.artifacts, lab, run)
        const roles = graph.order.filter(item => item.kind === 'resource' && item.type === 'Microsoft.Authorization/roleAssignments'
          && item.body.scope?.id.toLowerCase() === response.upstream.accountId?.toLowerCase()
          && item.body.properties?.roleDefinitionId.toLowerCase().endsWith('/a97b65f3-24c7-4388-baec-2e87135dc908'))
        authoredDecoyRole = checked.diagnostics.length === 0 && roles.length === 1
          && roles[0].body.properties.principalId.toLowerCase() !== response.upstream.principalId?.toLowerCase()
      } catch { /* An invalid saved graph cannot earn authored denial evidence. */ }
      bicepRequest = { attemptId: attempt?.id ?? null, target, name: deploymentName, ...source, authoredDecoyRole }
    }
    const lines = [{ kind: response.status === 200 ? 'out' : 'err', appId: scenario.appId,
      method: scenario.request.method, path: scenario.request.path, status: response.status, body: response.body,
      upstream: response.upstream, text: `HTTP ${response.status} ${JSON.stringify(response.body)}` }]
    let next = appendOutput({ ...run, runtime: response.runtime }, lines)
    const passed = response.status === scenario.expected.status
      && (scenario.expected.diagnosticCode === undefined || response.diagnostic?.code === scenario.expected.diagnosticCode)
      && (response.status !== 200 || (response.upstream.attempts.some((attempt) => attempt.status === 200)
        && response.body.deployment === response.upstream.deployment))
      && (response.status !== 400 || (response.upstream.attempts.length === 0 && response.verificationEligible === true))
    next = recordVerification(next, lab, task.id, { scenarioId: task.verification.scenarioId,
      scenarioVersion: task.verification.scenarioVersion, outcome: passed ? 'passed' : 'failed', completed: passed,
      startedAtMs: run.runtime.simTimeMs, endedAtMs: response.runtime.simTimeMs,
      measurements: { appId: scenario.appId, method: scenario.request.method, path: scenario.request.path, status: response.status,
        body: response.body, upstream: response.upstream,
        observation: response.diagnostic ? 'diagnostic' : 'response',
        diagnosticCode: response.diagnostic?.code ?? null,
        ...(bicepRequest ? { bicep: bicepRequest } : {}) } })
    return envelope(next, lines, [], response.diagnostic ? [response.diagnostic] : [])
  }
  if (typeof action.appId !== 'string' || action.method !== 'GET' || action.path !== '/api/info'
    || Object.keys(action).some((key) => !['type', 'appId', 'method', 'path'].includes(key))) {
    return actionError(run, 'Only a named GET /api/info request is supported; request outcomes cannot be supplied by the caller.')
  }
  const response = simulateRequest(run, action)
  const lines = [{ kind: response.status === 200 ? 'out' : 'err', appId: action.appId, method: action.method, path: action.path,
    status: response.status, body: response.body,
    text: `HTTP ${response.status} ${JSON.stringify(response.body)}` }]
  let next = appendOutput(response.runtime ? { ...run, runtime: response.runtime } : run, lines)
  const diagnostics = response.diagnostic ? [response.diagnostic] : []
  const task = lab.tasks.find((candidate) => {
    const scenario = getRequestScenario(lab, candidate.id)
    return scenario && scenario.appId.toLowerCase() === action.appId.toLowerCase()
      && scenario.request?.method === action.method && scenario.request?.path === action.path
  })
  if (task) {
    const scenario = getRequestScenario(lab, task.id)
    const passed = response.status === scenario.expected?.status && canonicalize(response.body) === canonicalize(scenario.expected?.body)
    next = recordVerification(next, lab, task.id, { scenarioId: task.verification.scenarioId,
      scenarioVersion: task.verification.scenarioVersion, outcome: passed ? 'passed' : 'failed', completed: passed,
      startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs,
      measurements: { appId: action.appId, method: action.method, path: action.path, status: response.status, body: response.body } })
  }
  return envelope(next, lines, [], diagnostics)
}

export function applyRunAction(run, action, lab) {
  validateBehavioralLab(lab)
  validateBehavioralRun(run, lab)
  if (run.completedAt !== null) fail('RUN_COMPLETED', 'Completed attempts are read-only. Restart to create a new attempt.')
  if (!action || typeof action !== 'object' || Array.isArray(action) || !isJsonValue(action)) return actionError(run, 'The action must be finite JSON data.')
  if (action.type === 'aks-request') {
    const aks = applyAksAction(run, action, lab)
    const refreshed = refreshKubernetesDependencies(run, aks.run, lab)
    const result = { ...aks, run: refreshed }
    validateBehavioralRun(result.run, lab)
    return result
  }
  let result
  switch (action.type) {
    case 'inject-incident': {
      if (Object.keys(action).length !== 1) return actionError(run, 'Incident injection accepts no caller state.')
      const injected = injectCapstoneIncident(run, lab)
      result = injected ? envelope(injected, [], [], [diagnostic('CAPSTONE_INCIDENT_INJECTED',
        'Simulated live FOUNDRY_DEPLOYMENT drift was injected into the Capstone app.')])
        : actionError(run, 'Seal the healthy Capstone stage and retain its running app before injecting the one-shot incident.')
      break
    }
    case 'advance-stage': {
      if (!capstoneStages(lab) || Object.keys(action).length !== 1) return actionError(run, 'Only a Capstone stage can advance without caller-supplied state.')
      const index = run.stages.sealedStages.length
      if (index >= 7) return actionError(run, 'The final Capstone stage is already sealed.')
      if (index === 5 && run.runtime.activeScenario) return actionError(run, 'Finish the operating experiment before sealing recovery.')
      if (index === 5 && run.stages.ownedGroups.some(name => !run.sandbox.resourceGroups.some(group => group.name.toLowerCase() === name)))
        return actionError(run, 'Restore every attempt-owned group before sealing recovery.')
      if (index === 6 && !cleanupReady(run)) return actionError(run, 'Delete every attempt-owned resource group and runtime projection before advancing.')
      const stage = lab.stages[index]
      const evaluation = evaluateLab(lab, run)
      if (stage.taskIds.some(id => !evaluation.tasks.find(task => task.id === id)?.done))
        return actionError(run, 'Complete all current Tasks in the active stage before advancing.')
      const seal = createStageSeal(run, lab, stage, evaluation)
      result = envelope({ ...run, nextSequence: run.nextSequence + 1,
        evidence: { ...run.evidence, milestoneRecords: [...run.evidence.milestoneRecords, stageMilestone(seal, run.attemptId)] },
        stages: { ...run.stages, activeStageId: lab.stages[index + 1]?.id ?? null,
          sealedStages: [...run.stages.sealedStages, seal],
          cleanupCheckpoint: index === 5 ? recoveryCheckpoint(seal, run.stages.ownedGroups) : run.stages.cleanupCheckpoint } })
      break
    }
    case 'command': result = commandAction(run, action, lab); break
    case 'request': result = requestAction(run, action, lab); break
    case 'scenario-start':
    case 'simulation-advance':
    case 'scenario-pause':
    case 'scenario-resume':
    case 'scenario-cancel': {
      const kind = action.type === 'scenario-start'
        ? lab.scenarios?.[action.scenarioId]?.kind : run.runtime.activeScenario?.kind
      result = kind === 'probes' ? probeAction(run, action, lab)
        : kind === 'cpu' || (kind === undefined && action.type !== 'scenario-start'
          && lab.capabilities?.cpuScaling === true && legacyCpuScenario(run, lab))
          ? cpuAction(run, action, lab)
          : actionError(run, 'The scenario kind is unknown or unavailable.')
      break
    }
    case 'draft': {
      if (!validPath(action.path, run) || typeof action.text !== 'string'
        || new TextEncoder().encode(action.text).length > getProjectManifest(run.project.manifestId).maxFileBytes) return actionError(run, 'Draft path or file size is invalid.')
      const project = { ...run.project, draftFiles: { ...run.project.draftFiles, [action.path]: action.text } }
      result = envelope({ ...run, project }); break
    }
    case 'save-file': {
      if (!validPath(action.path, run) || (action.text !== undefined && typeof action.text !== 'string')) return actionError(run, 'Save path or text is invalid.')
      const text = action.text ?? run.project.draftFiles[action.path]
      const saved = saveProjectFile(run.project, action.path, text)
      if (saved.diagnostics.length) result = envelope(run, [], [], saved.diagnostics)
      else if (run.project.savedFiles[action.path] === text) result = envelope({ ...run, project: { ...run.project,
        draftFiles: { ...run.project.draftFiles, [action.path]: text }, diagnostics: [] } })
      else {
        const key = `file:${action.path}`
        if (capstoneStages(lab) && run.project.sourceJournal.length >= MAX_SOURCE_SAVES)
          return actionError(run, 'The Capstone source save limit has been reached.')
        const project = capstoneStages(lab)
          ? { ...saved.project, sourceJournal: [...run.project.sourceJournal, { sequence: run.nextSequence,
            path: action.path, version: saved.project.fileVersions[action.path], hash: sourceTextHash(text) }] }
          : saved.project
        result = envelope({ ...run, project, nextSequence: run.nextSequence + (capstoneStages(lab) ? 1 : 0),
          dependencyGenerations: { ...run.dependencyGenerations, [key]: (run.dependencyGenerations[key] ?? 0) + 1 } })
      }
      break
    }
    case 'hint':
    case 'solution': {
      const task = lab.tasks.find((candidate) => candidate.id === action.taskId)
      if (typeof action.taskId !== 'string' || !task) return actionError(run, 'Task id does not belong to this Lab.')
      result = action.type === 'hint'
        ? envelope({ ...run, hintsRevealed: { ...run.hintsRevealed, [action.taskId]: Math.min(task.hints?.length ?? 0, (run.hintsRevealed[action.taskId] ?? 0) + 1) } })
        : envelope({ ...run, solutionsRevealed: { ...run.solutionsRevealed, [action.taskId]: true } })
      break
    }
    case 'elapsed': {
      if (!Number.isFinite(action.milliseconds) || action.milliseconds < 0 || action.milliseconds > 86_400_000) return actionError(run, 'Elapsed time must be between 0 and one day.')
      result = envelope({ ...run, elapsedMs: run.elapsedMs + action.milliseconds })
      break
    }
    default: result = actionError(run, 'Unknown run action.')
  }
  if (capstoneStages(lab) && run.stages.cleanupCheckpoint && result.run.stages.cleanupCheckpoint
    && result.run.stages.sealedStages.length === 6) {
    const deletion = result.portalEvents.some(event => event.type === 'deleted')
    const changedSource = canonicalize(run.project.fileVersions) !== canonicalize(result.run.project.fileVersions)
    const changedGroups = canonicalize(run.stages.groupCreations) !== canonicalize(result.run.stages.groupCreations)
    const changedArtifacts = canonicalize(run.artifacts.buildsById) !== canonicalize(result.run.artifacts.buildsById)
      || !deletion && canonicalize(run.artifacts.publishedTags) !== canonicalize(result.run.artifacts.publishedTags)
    const changedResources = !deletion && canonicalize(run.sandbox) !== canonicalize(result.run.sandbox)
    const changedDeployment = !deletion && canonicalize(run.runtime.deploymentsByApp) !== canonicalize(result.run.runtime.deploymentsByApp)
      || !deletion && canonicalize(bicepDeploymentProvenance(run.runtime.bicep))
        !== canonicalize(bicepDeploymentProvenance(result.run.runtime.bicep))
    const changedGenerations = !deletion && canonicalize(run.dependencyGenerations) !== canonicalize(result.run.dependencyGenerations)
    const changedOperating = canonicalize(run.runtime.activeScenario) !== canonicalize(result.run.runtime.activeScenario)
      || ['cpuByApp', 'probesByApp'].some(key => !deletion
        && canonicalize(run.runtime[key] ?? {}) !== canonicalize(result.run.runtime[key] ?? {}))
    if (changedSource || changedGroups || changedArtifacts || changedResources || changedDeployment || changedGenerations || changedOperating) {
      result.run = { ...result.run, evidence: { ...result.run.evidence,
        milestoneRecords: result.run.evidence.milestoneRecords.slice(0, 5) },
      stages: { ...result.run.stages, activeStageId: lab.stages[5].id,
        sealedStages: result.run.stages.sealedStages.slice(0, 5), cleanupCheckpoint: null } }
    }
  }
  result.run = refreshKubernetesDependencies(run, result.run, lab)
  validateBehavioralRun(result.run, lab)
  return result
}
