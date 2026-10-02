import { canonicalize } from './evidence.js'
import { contextFor, isPlainObject, validCounter, validEvidenceRecord, validateBehavioralLab, validateBehavioralRun } from './run.js'
import { fail } from './errors.js'
import { capstoneStages } from './stages.js'
import { isAksCapstone, getAksSealedTaskIds, aksCleanupReady, isAksTaskSourceCurrent } from '../kubernetes/capstone/stages.js'
import { isDataCapstone, dataSealedTaskIds, dataEvidenceCurrent } from './data-capstone/stages.js'

function safelyCheck(task, argument) {
  try { return task.check(argument) === true } catch { return false }
}

function latestForTask(run, taskId) {
  const records = Object.entries(run?.evidence?.experimentsById ?? {})
    .filter(([, record]) => record?.taskId === taskId)
  if (!records.length) return { records, latest: null }
  const latest = records.reduce((candidate, entry) => {
    const [id, record] = entry
    const [candidateId, candidateRecord] = candidate
    const sequence = validEvidenceRecord(record, id) ? record.sequence : Number.POSITIVE_INFINITY
    const candidateSequence = validEvidenceRecord(candidateRecord, candidateId) ? candidateRecord.sequence : Number.POSITIVE_INFINITY
    return sequence >= candidateSequence ? entry : candidate
  })
  return { records, latest }
}

function dependencyMatches(run, task, record) {
  const selectors = task.dependencies ?? {}
  const recordValues = record.dependencyValues
  const recordGenerations = record.dependencyGenerations
  if (!isPlainObject(recordValues) || !isPlainObject(recordGenerations)
    || Object.keys(recordValues).length !== Object.keys(selectors).length
    || Object.keys(recordGenerations).length !== Object.keys(selectors).length) return false
  const context = contextFor(run)
  for (const [key, selector] of Object.entries(selectors)) {
    try {
      if (canonicalize(recordValues[key]) !== canonicalize(selector(context, task))) return false
    } catch { return false }
    if (recordGenerations[key] !== (run.dependencyGenerations?.[key] ?? 0)) return false
  }
  return true
}

function evidenceHasTaskIdentity(run, lab, task, id, record) {
  if (!validEvidenceRecord(record, id)) return false
  return record.labId === run.labId && record.attemptId === run.attemptId && record.contentVersion === run.contentVersion
    && record.labId === lab.id && record.contentVersion === lab.contentVersion
    && record.taskId === task.id && record.scenarioId === task.verification.scenarioId && record.scenarioVersion === task.verification.scenarioVersion
}

function evidenceIsCurrent(run, lab, task, id, record) {
  return evidenceHasTaskIdentity(run, lab, task, id, record)
    && record.completed === true && record.outcome === 'passed' && dependencyMatches(run, task, record)
}

function behavioralTaskState(lab, run, task, index) {
  const context = contextFor(run)
  const predicate = safelyCheck(task, context) && (!isAksCapstone(lab) || isAksTaskSourceCurrent(run, task))
  const base = { ...task, index, done: false, status: 'pending', reason: 'requirements-not-satisfied', evidenceIds: [] }
  if (isDataCapstone(lab) && run.stages.cleanupCheckpoint?.taskIds.includes(task.id))
    return { ...base, done: true, status: 'done', reason: 'cleanup-proof-frozen', evidenceIds: run.stages.cleanupCheckpoint.evidenceIds
      .filter(id => run.evidence.experimentsById[id]?.taskId === task.id) }
  if (isDataCapstone(lab) && !lab.stages.find(stage => stage.id === run.stages.activeStageId)?.taskIds.includes(task.id))
    return { ...base, reason: 'stage-inactive' }
  if (!task.verification) {
    return predicate
      ? { ...base, done: true, status: 'done', reason: 'requirements-satisfied' }
      : base
  }
  const { records, latest } = latestForTask(run, task.id)
  const evidenceIds = records.filter(([, record]) => typeof record?.id === 'string').map(([, record]) => record.id)
  if (predicate && latest && evidenceIsCurrent(run, lab, task, latest[0], latest[1])
    && (!isDataCapstone(lab) || dataEvidenceCurrent(run, lab, task, latest[1]))) {
    return { ...base, done: true, status: 'done', reason: 'verification-current', evidenceIds }
  }
  const hadValidPass = records.some(([id, record]) => evidenceHasTaskIdentity(run, lab, task, id, record)
    && record.completed === true && record.outcome === 'passed')
  if (hadValidPass) return { ...base, status: 'needs-verification', reason: predicate ? 'verification-stale-or-unsuccessful' : 'requirements-not-satisfied', evidenceIds }
  return { ...base, reason: predicate ? 'verification-required' : 'requirements-not-satisfied', evidenceIds }
}

function legacyTaskState(run, task, index) {
  const done = safelyCheck(task, run?.sandbox)
  return { ...task, index, done, status: done ? 'done' : 'pending', reason: done ? 'requirements-satisfied' : 'requirements-not-satisfied', evidenceIds: [] }
}

export function evaluateLab(lab, run) {
  if (!isPlainObject(lab) || !Array.isArray(lab.tasks)) fail('INVALID_LAB', 'The Lab definition is invalid.')
  const behavioral = Object.hasOwn(lab, 'engineVersion')
  if (behavioral) {
    validateBehavioralLab(lab)
    try {
      validateBehavioralRun(run, lab)
    } catch {
      const tasks = lab.tasks.map((task, index) => ({ ...task, index, done: false, status: 'pending', reason: 'invalid-run', evidenceIds: [] }))
      return { tasks, doneCount: 0, total: tasks.length, isComplete: false }
    }
  }
  const sealedIds = behavioral && isDataCapstone(lab) ? dataSealedTaskIds(run, lab) : behavioral && isAksCapstone(lab) ? getAksSealedTaskIds(run, lab) : behavioral && capstoneStages(lab)
    ? new Set(lab.stages.slice(0, run.stages.sealedStages.length).flatMap(stage => stage.taskIds)) : new Set()
  const tasks = lab.tasks.map((task, index) => {
    if (sealedIds.has(task.id)) return { ...task, index, done: true, status: 'done', reason: 'stage-sealed',
      evidenceIds: (run.stages.sealedStages.find(seal => seal.taskIds.includes(task.id))?.evidenceIds ?? [])
        .filter(id => run.evidence.experimentsById[id]?.taskId === task.id) }
    return behavioral ? behavioralTaskState(lab, run ?? {}, task, index) : legacyTaskState(run ?? {}, task, index)
  })
  const doneCount = tasks.filter((task) => task.done).length
  return { tasks, doneCount, total: tasks.length,
    isComplete: doneCount === tasks.length && (!behavioral || !capstoneStages(lab) || run.stages.sealedStages.length === lab.stages.length)
      && (!isAksCapstone(lab) || run.stages.sealedStages.length === 8 && aksCleanupReady(run, lab))
      && (!isDataCapstone(lab) || run.stages.sealedStages.length === lab.stages.length) }
}
