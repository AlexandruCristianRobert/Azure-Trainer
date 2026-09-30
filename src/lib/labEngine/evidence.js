import { fail } from './errors.js'
import { cloneJson, contextFor, isJsonValue, isPlainObject, validCounter, validString, validateBehavioralLab, validateBehavioralRun } from './run.js'

export function canonicalize(value) {
  if (!isJsonValue(value)) fail('INVALID_EVIDENCE', 'Dependency values must be finite JSON data.')
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function taskFor(lab, taskId) {
  const task = lab.tasks.find((candidate) => candidate.id === taskId)
  if (!task) fail('INVALID_EVIDENCE', 'The Task does not belong to this Lab.', { taskId })
  if (!task.verification) fail('INVALID_EVIDENCE', 'The Task does not declare a verification scenario.', { taskId })
  return task
}

function dependencySnapshot(run, task) {
  const values = {}
  const generations = {}
  const context = contextFor(run)
  for (const [key, selector] of Object.entries(task.dependencies ?? {})) {
    try {
      const selected = selector(context)
      canonicalize(selected)
      values[key] = cloneJson(selected)
    } catch {
      fail('INVALID_EVIDENCE', 'The Task dependency selector returned unsupported data.', { key })
    }
    generations[key] = run.dependencyGenerations[key] ?? 0
  }
  return { values, generations }
}

function validateResult(result, task) {
  if (!isPlainObject(result) || result.scenarioId !== task.verification.scenarioId
    || result.scenarioVersion !== task.verification.scenarioVersion
    || !['passed', 'failed', 'cancelled'].includes(result.outcome) || typeof result.completed !== 'boolean'
    || typeof result.startedAtMs !== 'number' || !Number.isFinite(result.startedAtMs) || result.startedAtMs < 0
    || typeof result.endedAtMs !== 'number' || !Number.isFinite(result.endedAtMs) || result.endedAtMs < result.startedAtMs
    || !isPlainObject(result.measurements) || !isJsonValue(result.measurements)
    || (result.outcome === 'passed' && result.completed !== true)
    || (result.outcome === 'cancelled' && result.completed !== false)) {
    fail('INVALID_EVIDENCE', 'The verification result is invalid.')
  }
}

export function recordVerification(run, lab, taskId, result) {
  validateBehavioralLab(lab)
  validateBehavioralRun(run, lab)
  if (!validString(taskId)) fail('INVALID_EVIDENCE', 'A Task id is required.')
  const task = taskFor(lab, taskId)
  validateResult(result, task)
  const { values, generations } = dependencySnapshot(run, task)
  const sequence = run.nextSequence
  const id = `evidence-${sequence}`
  if (run.evidence.experimentsById[id]) fail('INVALID_EVIDENCE', 'The evidence id already exists.', { id })
  const record = {
    id,
    sequence,
    labId: run.labId,
    attemptId: run.attemptId,
    contentVersion: run.contentVersion,
    taskId,
    scenarioId: task.verification.scenarioId,
    scenarioVersion: task.verification.scenarioVersion,
    dependencyValues: values,
    dependencyGenerations: generations,
    completed: result.completed,
    outcome: result.outcome,
    startedAtMs: result.startedAtMs,
    endedAtMs: result.endedAtMs,
    measurements: cloneJson(result.measurements),
  }
  const evidence = {
    ...run.evidence,
    experimentsById: { ...run.evidence.experimentsById, [id]: record },
    currentEvidenceByTask: { ...run.evidence.currentEvidenceByTask, [taskId]: id },
  }
  const next = { ...run, nextSequence: sequence + 1, evidence }
  return validateBehavioralRun(next, lab)
}

export function isCurrentEvidenceRecord(record) {
  return isPlainObject(record) && validString(record.id) && validCounter(record.sequence, { positive: true })
}
