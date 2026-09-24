import { fail } from './errors.js'
import { canonicalize } from './evidence.js'
import { contextFor, cloneJson } from './run.js'
import { sourceVersionsAt, validateSourceJournal } from './sourceJournal.js'

const MAX_STAGES = 7
const MAX_TASKS = 64
const MAX_SEAL_BYTES = 16_384
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const bounded = (value, limit = 512) => typeof value === 'string' && value.length > 0 && value.length <= limit
const ordered = values => Array.isArray(values) && values.every(value => bounded(value)) && values.length === new Set(values).size
  && values.every((value, index) => index === 0 || values[index - 1] < value)
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|')

export function capstoneStages(lab) { return lab.capabilities?.acaCapstone === true }

export function validateStageLab(lab) {
  if (!capstoneStages(lab)) return
  const stages = lab.stages
  if (!Array.isArray(stages) || stages.length !== MAX_STAGES || stages.some(stage => !plain(stage)
    || !bounded(stage.id, 80) || !Array.isArray(stage.taskIds) || !stage.taskIds.length
    || stage.taskIds.length > MAX_TASKS || new Set(stage.taskIds).size !== stage.taskIds.length)) {
    fail('INVALID_LAB', 'Capstone stages must declare seven bounded ordered Task groups.')
  }
  const ids = stages.map(stage => stage.id)
  const taskIds = stages.flatMap(stage => stage.taskIds)
  if (new Set(ids).size !== ids.length || new Set(taskIds).size !== taskIds.length
    || taskIds.length !== lab.tasks.length || taskIds.some(id => !lab.tasks.some(task => task.id === id))) {
    fail('INVALID_LAB', 'Capstone stage Tasks must partition the Lab Tasks.')
  }
}

function latestEvidenceAt(run, taskId, sequence) {
  return Object.values(run.evidence.experimentsById)
    .filter(record => record.taskId === taskId && record.sequence < sequence)
    .sort((a, b) => b.sequence - a.sequence)[0] ?? null
}

function snapshotTuple(run, sequence) {
  const builds = Object.entries(run.artifacts.buildsById).filter(([id, build]) => build?.id === id
    && /^build-[1-9]\d*$/.test(id) && Number(id.slice(6)) < sequence
    && bounded(build.sourceHash) && bounded(build.digest)).map(([, build]) => build)
    .sort((a, b) => Number(b.id.split('-')[1]) - Number(a.id.split('-')[1]))
  const build = builds[0]
  const attempts = [...(run.runtime.bicep?.attempts ?? []), ...(run.runtime.incident?.baselineAttempts ?? []),
    ...(run.runtime.incident?.repairAttempt ? [run.runtime.incident.repairAttempt] : [])]
    .filter(attempt => attempt.sequence < sequence && attempt.status === 'succeeded')
    .sort((a, b) => b.sequence - a.sequence)
  const attempt = attempts[0]
  return {
    sourceVersions: { ...run.project.fileVersions },
    artifact: build ? { buildId: build.id, sourceHash: build.sourceHash, digest: build.digest } : null,
    deployment: attempt ? { attemptId: attempt.id, sourceHash: attempt.sourceHash,
      parameterHash: attempt.parameterHash, target: attempt.target, templatePath: attempt.templatePath ?? null } : null,
    incidentId: run.runtime.incident?.id ?? null,
  }
}

export function createStageSeal(run, lab, stage, evaluated) {
  const sequence = run.nextSequence
  const taskIds = [...stage.taskIds].sort()
  const evidenceIds = taskIds.flatMap(id => {
    const task = lab.tasks.find(item => item.id === id)
    return task.verification ? [latestEvidenceAt(run, id, sequence)?.id] : []
  }).sort()
  if (evidenceIds.some(id => !id) || stage.taskIds.some(id => !evaluated.tasks.find(task => task.id === id)?.done)) {
    fail('INVALID_STAGE', 'All current Tasks in the active stage must pass before advancing.')
  }
  const dependencyGenerations = {}
  const dependencyValues = {}
  for (const id of taskIds) {
    const task = lab.tasks.find(item => item.id === id)
    for (const [key, selector] of Object.entries(task.dependencies ?? {})) {
      const value = selector(contextFor(run))
      canonicalize(value)
      dependencyValues[key] = cloneJson(value)
      dependencyGenerations[key] = run.dependencyGenerations[key] ?? 0
    }
  }
  const seal = { stageId: stage.id, contentVersion: run.contentVersion, sequence, taskIds, evidenceIds,
    dependencyValues, dependencyGenerations, ...snapshotTuple(run, sequence),
    ...(stage.id === lab.stages[5].id ? { ownedGroups: [...run.stages.ownedGroups] } : {}) }
  if (canonicalize(seal).length > MAX_SEAL_BYTES) fail('INVALID_STAGE', 'The stage seal exceeds its storage bound.')
  return seal
}

export function stageMilestone(seal, attemptId) {
  return { kind: 'stage-seal', stageId: seal.stageId, sequence: seal.sequence,
    attemptId, snapshot: canonicalize(seal) }
}

export function cleanupReady(run) {
  if (!run.stages.cleanupCheckpoint || run.runtime.activeScenario) return false
  if (run.sandbox.resourceGroups.length || run.artifacts.publishedTags && Object.keys(run.artifacts.publishedTags).length) return false
  const live = ['namespaces', 'storageAccounts', 'functionApps', 'containerAppEnvironments', 'containerApps',
    'containerRegistries', 'managedIdentities', 'roleAssignments', 'foundryAccounts', 'cosmosAccounts',
    'keyVaults', 'eventGridTopics']
  return live.every(key => run.sandbox[key].length === 0)
    && Object.keys(run.runtime.deploymentsByApp).length === 0
    && Object.keys(run.runtime.replicasByApp).length === 0
    && Object.keys(run.runtime.cpuByApp ?? {}).length === 0
    && Object.keys(run.runtime.probesByApp ?? {}).length === 0
}

export function recoveryCheckpoint(seal, ownedGroups) {
  return { stageId: seal.stageId, sequence: seal.sequence, snapshot: canonicalize(seal), ownedGroups: [...ownedGroups] }
}

export function validateStageState(run, lab) {
  const state = run.stages
  if (!capstoneStages(lab)) return
  validateStageLab(lab)
  const journal = validateSourceJournal(run, lab)
  const stages = lab.stages
  const creations = state.groupCreations
  if (!Array.isArray(creations) || creations.length > 64 || creations.some((record, index) =>
    !exact(record, ['sequence', 'attemptId', 'name']) || record.attemptId !== run.attemptId
    || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || record.sequence >= run.nextSequence
    || index > 0 && record.sequence <= creations[index - 1].sequence
    || !bounded(record.name, 90) || record.name !== record.name.toLowerCase()))
    fail('INVALID_RUN', 'Capstone group creation history is malformed.')
  const receipts = run.evidence.groupReceipts
  if (!Array.isArray(receipts) || receipts.length > 64
    || receipts.some(receipt => !exact(receipt, ['sequence', 'attemptId', 'name', 'kind', 'command'])
      || receipt.kind !== 'group-created' || !bounded(receipt.command, 4096))
    || canonicalize(receipts.map(({ sequence, attemptId, name }) => ({ sequence, attemptId, name }))) !== canonicalize(creations))
    fail('INVALID_RUN', 'Capstone group creation receipts disagree with ownership history.')
  const derivedGroups = [...new Set(creations.map(record => record.name))].sort()
  const deletions = state.deletedApps
  if (!Array.isArray(deletions) || deletions.length > 64 || deletions.some((record, index) =>
    !exact(record, ['sequence', 'attemptId', 'appId']) || record.attemptId !== run.attemptId
    || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || record.sequence >= run.nextSequence
    || index > 0 && record.sequence <= deletions[index - 1].sequence
    || !bounded(record.appId) || !derivedGroups.some(name =>
      record.appId.toLowerCase().includes(`/resourcegroups/${name}/`))))
    fail('INVALID_RUN', 'Capstone app deletion history is malformed.')
  if (!Array.isArray(state.sealedStages) || state.sealedStages.length > MAX_STAGES
    || !Array.isArray(state.ownedGroups) || state.ownedGroups.length > 64
    || canonicalize(state.ownedGroups) !== canonicalize(derivedGroups)
    || run.sandbox.resourceGroups.some(group => !state.ownedGroups.includes(group.name.toLowerCase()))
    || state.activeStageId !== (stages[state.sealedStages.length]?.id ?? null)
    || !Array.isArray(run.evidence.milestoneRecords)
    || run.evidence.milestoneRecords.length !== state.sealedStages.length) {
    fail('INVALID_RUN', 'Capstone stages are missing, reordered, or unsupported.')
  }
  const checkpoint = state.sealedStages[5]
  if (deletions.some(record => !checkpoint || record.sequence <= checkpoint.sequence))
    fail('INVALID_RUN', 'Capstone app deletion preceded its cleanup checkpoint.')
  if (checkpoint ? !exact(state.cleanupCheckpoint, ['stageId', 'sequence', 'snapshot', 'ownedGroups'])
    || canonicalize(state.cleanupCheckpoint).length > MAX_SEAL_BYTES + 8192
    || state.cleanupCheckpoint.stageId !== checkpoint.stageId
    || state.cleanupCheckpoint.sequence !== checkpoint.sequence
    || state.cleanupCheckpoint.snapshot !== canonicalize(checkpoint)
    || canonicalize(state.cleanupCheckpoint.ownedGroups) !== canonicalize(checkpoint.ownedGroups)
    || !ordered(state.cleanupCheckpoint.ownedGroups)
    || canonicalize(state.cleanupCheckpoint.ownedGroups) !== canonicalize([...new Set(creations
      .filter(record => record.sequence < checkpoint.sequence).map(record => record.name))].sort())
    : state.cleanupCheckpoint !== null) fail('INVALID_RUN', 'Capstone cleanup checkpoint is missing or forged.')
  if (state.sealedStages.length === MAX_STAGES && !cleanupReady(run))
    fail('INVALID_RUN', 'The final Capstone seal requires verified cleanup.')
  if (run.completedAt !== null && (state.sealedStages.length !== MAX_STAGES || !cleanupReady(run)))
    fail('INVALID_RUN', 'A completed Capstone run requires the final cleanup seal.')
  const causalSequences = [
    ...journal.map(event => event.sequence),
    ...creations.map(event => event.sequence),
    ...deletions.map(event => event.sequence),
    ...state.sealedStages.map(seal => seal.sequence),
    ...Object.values(run.evidence.experimentsById).map(record => record.sequence),
    ...Object.keys(run.artifacts.buildsById).filter(id => /^build-[1-9]\d*$/.test(id)).map(id => Number(id.slice(6))),
    ...(run.runtime.bicep?.previews ?? []).map(record => record.sequence),
    ...(run.runtime.bicep?.attempts ?? []).map(record => record.sequence),
    ...(run.runtime.incident ? [run.runtime.incident.sequence] : []),
  ]
  if (causalSequences.some(sequence => !Number.isSafeInteger(sequence) || sequence < 1 || sequence >= run.nextSequence)
    || new Set(causalSequences).size !== causalSequences.length)
    fail('INVALID_RUN', 'Capstone source, evidence, build, deployment, and seal sequences must be unique.')
  let previousSequence = 0
  for (const [index, seal] of state.sealedStages.entries()) {
    const stage = stages[index]
    const milestone = run.evidence.milestoneRecords[index]
    if (!exact(milestone, ['kind', 'stageId', 'sequence', 'attemptId', 'snapshot'])
      || milestone.kind !== 'stage-seal' || milestone.stageId !== stage.id
      || milestone.sequence !== seal.sequence || milestone.attemptId !== run.attemptId
      || milestone.snapshot !== canonicalize(seal)) {
      fail('INVALID_RUN', 'Capstone stage seal disagrees with its persisted milestone.')
    }
    const dependencyKeys = [...new Set(stage.taskIds.flatMap(id =>
      Object.keys(lab.tasks.find(task => task.id === id).dependencies ?? {})))].sort()
    if (!exact(seal, ['stageId', 'contentVersion', 'sequence', 'taskIds', 'evidenceIds', 'dependencyValues',
      'dependencyGenerations', 'sourceVersions', 'artifact', 'deployment', 'incidentId',
      ...(index === 5 ? ['ownedGroups'] : [])])
      || canonicalize(seal).length > MAX_SEAL_BYTES || seal.stageId !== stage.id
      || seal.contentVersion !== run.contentVersion || !Number.isSafeInteger(seal.sequence)
      || seal.sequence <= previousSequence || seal.sequence >= run.nextSequence
      || !ordered(seal.taskIds) || canonicalize(seal.taskIds) !== canonicalize([...stage.taskIds].sort())
      || index === 5 && canonicalize(seal.ownedGroups) !== canonicalize([...new Set(creations
        .filter(record => record.sequence < seal.sequence).map(record => record.name))].sort())
      || !ordered(seal.evidenceIds) || !plain(seal.dependencyGenerations) || !plain(seal.dependencyValues)
      || Object.keys(seal.dependencyValues).length > MAX_TASKS
      || canonicalize(Object.keys(seal.dependencyValues).sort()) !== canonicalize(dependencyKeys)
      || canonicalize(Object.keys(seal.dependencyGenerations).sort()) !== canonicalize(dependencyKeys)
      || !plain(seal.sourceVersions) || Object.keys(seal.sourceVersions).length > 64
      || canonicalize(seal.sourceVersions) !== canonicalize(sourceVersionsAt(journal, seal.sequence))
      || Object.entries(seal.sourceVersions).some(([path, version]) => !bounded(path) || !Number.isSafeInteger(version)
        || version < 0 || version > (run.project.fileVersions[path] ?? -1))
      || Object.entries(seal.dependencyGenerations).some(([key, generation]) => !bounded(key)
        || !Number.isSafeInteger(generation) || generation < 0 || generation > (run.dependencyGenerations[key] ?? 0))) {
      fail('INVALID_RUN', 'Capstone stage seal has an invalid identity, order, or bound.')
    }
    const expectedIds = []
    for (const id of seal.taskIds) {
      const task = lab.tasks.find(item => item.id === id)
      if (!task.verification) continue
      const record = latestEvidenceAt(run, id, seal.sequence)
      if (!record || record.sequence <= previousSequence || record.outcome !== 'passed' || record.completed !== true
        || Object.keys(task.dependencies ?? {}).some(key => !own(seal.dependencyGenerations, key)
          || !own(seal.dependencyValues, key)
          || record.dependencyGenerations[key] !== seal.dependencyGenerations[key]
          || canonicalize(record.dependencyValues[key]) !== canonicalize(seal.dependencyValues[key]))) {
        fail('INVALID_RUN', 'Capstone stage evidence was not current when sealed.')
      }
      expectedIds.push(record.id)
    }
    if (canonicalize(seal.evidenceIds) !== canonicalize(expectedIds.sort()))
      fail('INVALID_RUN', 'Capstone stage evidence IDs do not match the seal sequence.')
    const tuple = snapshotTuple(run, seal.sequence)
    if (canonicalize(seal.artifact) !== canonicalize(tuple.artifact)
      || canonicalize(seal.deployment) !== canonicalize(tuple.deployment))
      fail('INVALID_RUN', 'Capstone stage artifact or deployment provenance is forged.')
    if (seal.incidentId !== null && (!bounded(seal.incidentId) || index < 4))
      fail('INVALID_RUN', 'Capstone stage incident identity is invalid.')
    if (index >= 4 && seal.incidentId !== (run.runtime.incident?.id ?? null))
      fail('INVALID_RUN', 'Capstone stage incident identity is unlinked.')
    previousSequence = seal.sequence
  }
}
