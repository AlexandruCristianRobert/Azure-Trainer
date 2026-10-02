import { createSandbox, isSandboxShape, normalizeSandbox, SUBSCRIPTION_ID } from '../sandbox/model.js'
import { emptyBicepProvenance, validBicepProvenance } from '../bicep/provenance.js'
import { emptyKubernetesRuntime, validateKubernetesRuntime, migrateMissingRolloutState } from '../kubernetes/state.js'
import { getProjectManifest } from '../project/manifests.js'
import { fail } from './errors.js'
import { capstoneStages, validateStageLab, validateStageState } from './stages.js'
import { validateCapstoneIncident } from './incident.js'
import { projectSourceHash } from '../project/build.js'
import { sourceTextHash } from './sourceJournal.js'
import { validDiagnosisEvidenceRecord } from '../kubernetes/diagnosis-incidents.js'
import { isAksCapstone, initializeAksStages, validateAksStageLab, validateAksCapstoneState, isAksPinnedDiagnosisEvidence } from '../kubernetes/capstone/stages.js'
import { createAksCapstoneSeed } from '../../data/labs/aks-journey/capstone-seed.js'
import { aksProtectedRefs, validateAksOwnership } from '../kubernetes/capstone/ownership.js'
import { isDataCapstone, initializeDataStages, validateDataStageLab, validateDataStageState } from './data-capstone/stages.js'
import { dataProtectedRefs } from './data-capstone/ownership.js'
import { emptyMessagingState, validateMessagingState } from '../messaging/state.js'
import { validateMessagingExercise } from '../messaging/shell.js'
import { validMessagingEvidence, validMessagingExecutionReceipts } from '../messaging/evidence.js'

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isDenseJsonArray(value, seen) {
  if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return false
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (descriptor?.enumerable !== true || !hasOwn(descriptor, 'value') || !isJsonValue(descriptor.value, seen)) return false
  }
  return true
}

export function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? isDenseJsonArray(value, seen)
    : isPlainObject(value) && Object.values(value).every((item) => isJsonValue(item, seen))
  seen.delete(value)
  return valid
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function validString(value) {
  return typeof value === 'string' && value.length > 0
}

function validCounter(value, { positive = false } = {}) {
  return Number.isInteger(value) && (positive ? value > 0 : value >= 0)
}

function validStringMap(value) {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === 'string')
}

function validCounterMap(value) {
  return isPlainObject(value) && Object.values(value).every((entry) => validCounter(entry))
}

function taskIdsAreUnique(tasks) {
  return new Set(tasks.map((task) => task?.id)).size === tasks.length
}

export function validateBehavioralLab(lab) {
  if (!isPlainObject(lab) || !validString(lab.id) || !Array.isArray(lab.tasks) || !taskIdsAreUnique(lab.tasks)) {
    fail('INVALID_LAB', 'The Lab definition is invalid.')
  }
  if (lab.engineVersion !== 2) {
    fail('UNSUPPORTED_ENGINE', 'The Lab engine version is not supported.', { engineVersion: lab.engineVersion })
  }
  if (!validCounter(lab.contentVersion, { positive: true })) {
    fail('INVALID_LAB', 'The Lab content version must be a positive integer.')
  }
  for (const task of lab.tasks) {
    if (!isPlainObject(task) || !validString(task.id) || typeof task.check !== 'function') {
      fail('INVALID_LAB', 'Each Lab Task must have an id and check function.')
    }
    if (task.dependencies !== undefined && (!isPlainObject(task.dependencies) || !Object.values(task.dependencies).every((selector) => typeof selector === 'function'))) {
      fail('INVALID_LAB', 'Task dependencies must be selector functions.')
    }
    if (task.verification !== undefined && (!isPlainObject(task.verification)
      || !validString(task.verification.scenarioId) || !validCounter(task.verification.scenarioVersion, { positive: true }))) {
      fail('INVALID_LAB', 'Task verification must name a versioned scenario.')
    }
  }
  validateStageLab(lab)
  if (!validateMessagingExercise(lab)) fail('INVALID_LAB', 'The messaging exercise must declare bounded commands and matching Task scenarios.')
  validateAksStageLab(lab)
  validateDataStageLab(lab)
  if (lab.initialProjectFiles !== undefined && !validStringMap(lab.initialProjectFiles)) {
    fail('INVALID_LAB', 'Initial project files must be a string map.')
  }
  if (lab.seed !== undefined && typeof lab.seed !== 'function') fail('INVALID_LAB', 'The Lab seed must be a function.')
  if (lab.resourceSeed !== undefined && typeof lab.resourceSeed !== 'function') fail('INVALID_LAB', 'The Lab resource seed must be a function.')
  if (lab.initializeSimulation !== undefined && typeof lab.initializeSimulation !== 'function') {
    fail('INVALID_LAB', 'The Lab simulation initializer must be a function.')
  }
  return lab
}

function contextFor(run) {
  return {
    sandbox: run.sandbox,
    project: run.project,
    artifacts: run.artifacts,
    runtime: run.runtime.bicep === undefined ? run.runtime : { ...run.runtime, bicep: cloneJson(run.runtime.bicep) },
    evidence: run.evidence,
    dependencyGenerations: run.dependencyGenerations,
      stages: run.stages,
      history: run.history,
  }
}

function validProject(project) {
  return isPlainObject(project) && (project.manifestId === null || typeof project.manifestId === 'string')
    && validStringMap(project.savedFiles) && validStringMap(project.draftFiles)
    && validCounterMap(project.fileVersions) && Array.isArray(project.diagnostics)
}

function validArtifacts(artifacts) {
  return isPlainObject(artifacts) && isPlainObject(artifacts.buildsById)
    && isPlainObject(artifacts.publishedTags) && isPlainObject(artifacts.sourceSnapshotsByHash)
}

function validateCapstoneArtifacts(run, lab) {
  if (isAksCapstone(lab) || isDataCapstone(lab)) return
  if (getProjectManifest(run.project.manifestId)?.capstone !== true) return
  const snapshots = run.artifacts.sourceSnapshotsByHash
  const expectedPaths = Object.keys(lab.initialProjectFiles ?? {}).sort()
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (!isPlainObject(snapshot) || snapshot.hash !== key || !validStringMap(snapshot.files)
      || JSON.stringify(Object.keys(snapshot.files).sort()) !== JSON.stringify(expectedPaths)
      || projectSourceHash(snapshot.files) !== key) {
      fail('INVALID_RUN', 'Capstone build source snapshot is malformed or has a mismatched content hash.')
    }
  }
  for (const [id, artifact] of Object.entries(run.artifacts.buildsById)) {
    const match = /^build-([1-9]\d*)$/.exec(id)
    const snapshot = snapshots[artifact?.sourceHash]
    if (!match || artifact?.id !== id || !snapshot || Number(match[1]) >= run.nextSequence) {
      fail('INVALID_RUN', 'Capstone build artifact has no valid causal source snapshot.')
    }
    const buildSequence = Number(match[1])
    for (const path of expectedPaths) {
      const lastSave = run.project.sourceJournal.filter(event => event.path === path && event.sequence < buildSequence).at(-1)
      const expectedHash = lastSave?.hash ?? sourceTextHash(lab.initialProjectFiles[path])
      if (sourceTextHash(snapshot.files[path]) !== expectedHash) {
        fail('INVALID_RUN', 'Capstone build source does not match the saved files at build time.')
      }
    }
  }
}

function validRuntime(runtime) {
  return isPlainObject(runtime) && typeof runtime.simTimeMs === 'number' && Number.isFinite(runtime.simTimeMs) && runtime.simTimeMs >= 0
    && isPlainObject(runtime.deploymentsByApp) && isPlainObject(runtime.replicasByApp)
    && (runtime.activeScenario === null || isPlainObject(runtime.activeScenario)) && Array.isArray(runtime.scheduledEvents)
    && (runtime.bicep === undefined || validBicepProvenance(runtime.bicep))
}

function validStages(stages) {
  return isPlainObject(stages) && (stages.activeStageId === null || typeof stages.activeStageId === 'string')
    && Array.isArray(stages.sealedStages) && (stages.cleanupCheckpoint === null || isPlainObject(stages.cleanupCheckpoint))
}

function validEvidenceRecord(record, id) {
  const outcome = record?.outcome
  const completedOutcome = (outcome === 'passed' && record.completed === true)
    || (outcome === 'failed' && typeof record.completed === 'boolean')
    || (outcome === 'cancelled' && record.completed === false)
  return isPlainObject(record) && record.id === id && validCounter(record.sequence, { positive: true })
    && id === `evidence-${record.sequence}`
    && validString(record.labId) && validString(record.attemptId) && validCounter(record.contentVersion, { positive: true })
    && validString(record.taskId) && validString(record.scenarioId) && validCounter(record.scenarioVersion, { positive: true })
    && completedOutcome && typeof record.startedAtMs === 'number' && Number.isFinite(record.startedAtMs) && record.startedAtMs >= 0
    && typeof record.endedAtMs === 'number' && Number.isFinite(record.endedAtMs) && record.endedAtMs >= record.startedAtMs
    && isPlainObject(record.dependencyValues) && isJsonValue(record.dependencyValues)
    && validCounterMap(record.dependencyGenerations) && isPlainObject(record.measurements) && isJsonValue(record.measurements)
}

function validEvidence(evidence) {
  if (!isPlainObject(evidence) || !isPlainObject(evidence.experimentsById)
    || !isPlainObject(evidence.currentEvidenceByTask) || !Array.isArray(evidence.milestoneRecords)) return false
  const records = Object.entries(evidence.experimentsById)
  if (!records.every(([id, record]) => validEvidenceRecord(record, id))) return false
  const sequences = records.map(([, record]) => record.sequence)
  if (new Set(sequences).size !== sequences.length) return false
  return Object.entries(evidence.currentEvidenceByTask).every(([taskId, id]) => validString(id)
    && evidence.experimentsById[id]?.taskId === taskId)
}

export function validateBehavioralRun(run, lab = null) {
  if (!isPlainObject(run)) fail('INVALID_RUN', 'The run must be a plain object.')
  if (run.schemaVersion !== 2) fail('UNSUPPORTED_SCHEMA', 'The run schema version is not supported.', { schemaVersion: run.schemaVersion })
  if (!isJsonValue(run)) fail('INVALID_RUN', 'The run must contain only finite JSON data.')
  if (!validString(run.labId) || !validCounter(run.contentVersion, { positive: true }) || !validString(run.attemptId)
    || !validCounter(run.revision) || !validCounter(run.nextSequence, { positive: true })) {
    fail('INVALID_RUN', 'The run identity or counters are invalid.')
  }
  if (!isSandboxShape(run.sandbox) || !validProject(run.project) || !validArtifacts(run.artifacts)
    || !validRuntime(run.runtime) || !validEvidence(run.evidence) || !validStages(run.stages)
    || !validCounterMap(run.dependencyGenerations) || !Array.isArray(run.scrollback) || !Array.isArray(run.history)
    || !validCounterMap(run.hintsRevealed) || !isPlainObject(run.solutionsRevealed)
    || typeof run.elapsedMs !== 'number' || !Number.isFinite(run.elapsedMs) || run.elapsedMs < 0
    || !((run.completedAt === null && run.resultId === null)
      || (validString(run.completedAt) && validString(run.resultId)))) {
    fail('INVALID_RUN', 'The run envelope is incomplete or malformed.')
  }
  const evidenceRecords = Object.values(run.evidence.experimentsById)
  if (evidenceRecords.some((record) => record.labId !== run.labId
    || record.attemptId !== run.attemptId || record.contentVersion !== run.contentVersion)
    || evidenceRecords.some((record) => record.sequence >= run.nextSequence)) {
    fail('INVALID_RUN', 'Evidence must belong to this run and precede its next sequence.')
  }
  if (lab !== null) {
    validateBehavioralLab(lab)
    if (run.labId !== lab.id || run.contentVersion !== lab.contentVersion) {
      fail('INCOMPATIBLE_CONTENT', 'The run does not match this Lab content.', { labId: run.labId, contentVersion: run.contentVersion })
    }
    if (!evidenceRecords.every(record => validDiagnosisEvidenceRecord(record, run, lab) || isAksPinnedDiagnosisEvidence(record, run, lab))) fail('INVALID_RUN', 'Kubernetes diagnosis evidence provenance is missing or malformed.')
    if (lab.capabilities?.kubernetes === true) {
      const candidate = migrateMissingRolloutState(run, lab)
      if (!validateKubernetesRuntime(candidate.runtime.kubernetes, candidate, lab)) fail('INVALID_RUN', 'Kubernetes runtime state is missing or malformed.')
      if (candidate !== run) { run.runtime = candidate.runtime; run.nextSequence = candidate.nextSequence }
    }
    if (lab.capabilities?.messaging === true && (!validateMessagingState(run.runtime.messaging)
      || !validMessagingExecutionReceipts(run.runtime.messaging))) {
      fail('INVALID_RUN', 'The messaging runtime state is missing or malformed.')
    }
    if (lab.capabilities?.messaging === true && !evidenceRecords.every(record => validMessagingEvidence(record, run, lab))) {
      fail('INVALID_RUN', 'Messaging evidence measurements or receipt provenance are malformed.')
    }
    if (Array.isArray(lab.bicepTargets)) {
      const state = run.runtime.bicep
      if (!state) fail('INVALID_RUN', 'The independent Bicep provenance is missing.')
      const manifest = getProjectManifest(run.project.manifestId)
      const targetFor = value => lab.bicepTargets.find(target => target.resourceGroup?.toLowerCase() === value.target?.toLowerCase()
        && target.deploymentName?.toLowerCase() === value.name?.toLowerCase()
        && target.parameterPath === value.parameterPath
        && (target.templatePath === undefined ? value.templatePath === undefined
          : target.templatePath === value.templatePath
            && value.fileVersions?.[target.templatePath] !== undefined
            && Object.keys(value.fileVersions).every(path => manifest.bicepFiles?.includes(path)
              && (path !== target.parameterPath
              && path !== target.templatePath ? path.endsWith('.bicep')
                && !lab.bicepTargets.some(other => other !== target && other.templatePath === path) : true))))
      const records = [...state.previews, ...state.attempts]
      const summaries = Object.values(state.currentByTarget).flatMap(current => Object.values(current))
      const observations = state.observations ?? []
      if ([...records, ...summaries, ...observations, ...(state.incidentPreview ? [state.incidentPreview] : [])]
        .some(value => !targetFor(value))) fail('INVALID_RUN', 'Bicep provenance must use its declared target and parameter file.')
      const byId = new Map([...records, ...summaries].map(value => [value.id, value]))
      const sequences = [...byId.values()].map(value => value.sequence)
      const evidenceSequences = evidenceRecords.map(value => value.sequence)
      if (sequences.some(value => !Number.isSafeInteger(value) || value < 1 || value >= run.nextSequence)
        || new Set([...sequences, ...evidenceSequences]).size !== sequences.length + evidenceSequences.length
        || [state.previews, state.attempts].some(items => items.some((value, index) => index > 0 && value.sequence <= items[index - 1].sequence))
        || summaries.some(value => !Number.isSafeInteger(value.sequence) || value.sequence >= run.nextSequence))
        fail('INVALID_RUN', 'Bicep causal sequences must be unique and precede the next sequence.')
    }
    const incident = run.runtime.bicep?.incidentPreview
    if (lab.capabilities?.bicepIdentityFault === true && !run.runtime.bicep?.previewChain)
      fail('INVALID_RUN', 'The Bicep incident preview chain is missing.')
    if (incident !== undefined) {
      const expected = lab.bicepIncident
      const environmentId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${expected?.resourceGroup}/providers/Microsoft.App/managedEnvironments/${expected?.wrongEnvironmentName}`
      if (lab.capabilities?.bicepIdentityFault !== true || !expected
        || incident.target !== expected.resourceGroup || incident.name !== expected.deploymentName
        || incident.parameterHash !== expected.parameterHash
        || incident.fileVersions['infra/first.bicepparam'] !== expected.parameterVersion
        || incident.operations.filter(item => item.type === 'Microsoft.App/managedEnvironments').length !== 1
        || !incident.operations.some(item => item.type === 'Microsoft.App/managedEnvironments'
          && item.name === expected.wrongEnvironmentName && item.changeType === 'create'
          && item.id.toLowerCase() === environmentId.toLowerCase())) {
        fail('INVALID_RUN', 'The Bicep incident preview is not tied to the seeded wrong environment.')
      }
    }
    if (evidenceRecords.some((record) => {
      const task = lab.tasks.find((candidate) => candidate.id === record.taskId)
      return !task?.verification || record.scenarioId !== task.verification.scenarioId
        || record.scenarioVersion !== task.verification.scenarioVersion
    })) {
      fail('INVALID_RUN', 'Evidence does not match a declared Task scenario.')
    }
    validateStageState(run, lab)
    validateAksCapstoneState(run, lab)
    validateDataStageState(run, lab)
    if (isAksCapstone(lab)) validateAksOwnership(run)
    validateCapstoneArtifacts(run, lab)
    validateCapstoneIncident(run, lab)
  }
  return run
}

export function createBehavioralRun(lab, { attemptId } = {}) {
  validateBehavioralLab(lab)
  if (!validString(attemptId)) fail('INVALID_RUN', 'An explicit nonempty attempt id is required.')
  const seed = lab.resourceSeed ?? lab.seed
  const seededSandbox = seed ? seed(cloneJson(createSandbox())) : createSandbox()
  if (!isJsonValue(seededSandbox) || !isSandboxShape(seededSandbox)) fail('INVALID_LAB', 'The Lab seed must return a valid Sandbox.')
  const sandbox = normalizeSandbox(seededSandbox)
  const files = cloneJson(lab.initialProjectFiles ?? {})
  const run = {
    schemaVersion: 2,
    labId: lab.id,
    contentVersion: lab.contentVersion,
    attemptId,
    revision: 0,
    nextSequence: 1,
    sandbox,
    project: { manifestId: lab.manifestId ?? null, savedFiles: files, draftFiles: cloneJson(files), fileVersions: {}, diagnostics: [],
      ...(capstoneStages(lab) || isAksCapstone(lab) || isDataCapstone(lab) ? { sourceJournal: [] } : {}) },
    artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} },
    runtime: { simTimeMs: 0, deploymentsByApp: {}, replicasByApp: {}, activeScenario: null, scheduledEvents: [],
      ...(isDataCapstone(lab) ? { dataCapstone: { version: 1, incident: null, worker: { lastBatch: [], artifactId: null } } } : {}),
      ...(lab.capabilities?.kubernetes === true ? { kubernetes: emptyKubernetesRuntime() } : {}),
      ...(lab.capabilities?.messaging === true ? { messaging: emptyMessagingState() } : {}),
      ...(lab.capabilities?.bicepDeployment === true ? { bicep: emptyBicepProvenance({
        trackIncident: lab.capabilities?.bicepIdentityFault === true }) } : {}) },
    evidence: { experimentsById: {}, currentEvidenceByTask: {}, milestoneRecords: [],
      ...(isAksCapstone(lab) ? { aksCapstoneReceipts: {} } : {}),
      ...(capstoneStages(lab) ? { groupReceipts: [] } : {}) },
    stages: isDataCapstone(lab) ? initializeDataStages(lab) : isAksCapstone(lab) ? initializeAksStages(lab) : { activeStageId: capstoneStages(lab) ? lab.stages[0].id : null, sealedStages: [], cleanupCheckpoint: null,
      ...(capstoneStages(lab) ? { ownedGroups: [], groupCreations: [], deletedApps: [] } : {}) },
    dependencyGenerations: {},
    scrollback: [],
    history: [],
    hintsRevealed: {},
    solutionsRevealed: {},
    elapsedMs: 0,
    completedAt: null,
    resultId: null,
  }
  if (lab.initializeSimulation || isAksCapstone(lab)) {
    const initialized = lab.initializeSimulation ? lab.initializeSimulation(cloneJson(run)) : createAksCapstoneSeed(lab)
    const allowed = ['sandbox', 'artifacts', 'runtime', 'nextSequence']
    if (!isPlainObject(initialized) || !isJsonValue(initialized)
      || Reflect.ownKeys(initialized).length !== allowed.length
      || !allowed.every((key) => hasOwn(initialized, key))) {
      fail('INVALID_LAB', 'The Lab simulation initializer must return only sandbox, artifacts, runtime and nextSequence.')
    }
    Object.assign(run, cloneJson(initialized))
  }
  if (isAksCapstone(lab)) run.stages.aks.protectedRefs = aksProtectedRefs()
  if (isDataCapstone(lab)) run.stages.data.protectedRefs = dataProtectedRefs(run)
  return validateBehavioralRun(run, lab)
}

export function bumpDependency(run, key) {
  validateBehavioralRun(run)
  if (!validString(key)) fail('INVALID_RUN', 'A dependency key is required.')
  return {
    ...run,
    dependencyGenerations: { ...run.dependencyGenerations, [key]: (run.dependencyGenerations[key] ?? 0) + 1 },
  }
}

export { contextFor, validEvidenceRecord, validCounter, validString, hasOwn }
