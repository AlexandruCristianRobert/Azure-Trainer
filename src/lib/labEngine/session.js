import { LabEngineError } from './errors.js'
import { canonicalize } from './evidence.js'
import { evaluateLab } from './evaluate.js'
import { migrateBehavioralRun } from './migrations.js'
import { cloneJson, isJsonValue, isPlainObject, createBehavioralRun, validateBehavioralLab, validateBehavioralRun } from './run.js'

function commandError(code, message, details = {}) {
  return new LabEngineError(code, message, details)
}

function errorSnapshot(error) {
  return error && {
    code: error.code ?? 'SESSION_FAILED',
    message: error.message ?? String(error),
    details: structuredClone(error.details ?? {}),
  }
}

function completionResult(metadata, run, evaluation) {
  if (!isPlainObject(metadata) || !isJsonValue(metadata)
    || typeof metadata.id !== 'string' || !metadata.id
    || typeof metadata.finishedAt !== 'string' || !metadata.finishedAt
    || (metadata.labId !== undefined && metadata.labId !== run.labId)
    || (metadata.attemptId !== undefined && metadata.attemptId !== run.attemptId)) {
    throw commandError('INVALID_RESULT', 'Completion metadata needs an id and finishedAt matching this attempt.')
  }
  return {
    ...cloneJson(metadata),
    id: metadata.id,
    labId: run.labId,
    attemptId: run.attemptId,
    tasksDone: evaluation.doneCount,
    total: evaluation.total,
    hintsUsed: Object.values(run.hintsRevealed).reduce((sum, count) => sum + count, 0),
    solutionsUsed: Object.keys(run.solutionsRevealed).length,
    durationMs: run.elapsedMs,
    finishedAt: metadata.finishedAt,
  }
}

export function createBehavioralSession({ lab, repository, reduce, createAttemptId }) {
  validateBehavioralLab(lab)
  if (!repository || typeof repository.loadRun !== 'function' || typeof repository.saveRun !== 'function'
    || typeof repository.completeRun !== 'function' || typeof reduce !== 'function'
    || typeof createAttemptId !== 'function') {
    throw commandError('INVALID_SESSION', 'The session needs a repository, reducer, and attempt id factory.')
  }

  let run = null
  let generation = 0
  let busy = false
  let replacing = false
  let readOnly = false
  let error = null
  let pendingWrite = null
  let unsavedCompletion = null
  let unsavedWrite = null
  let failedRaw = null
  let lifecycle = Promise.resolve()

  function snapshot() {
    return { run: run && cloneJson(run), generation, busy: busy || replacing, readOnly, error: errorSnapshot(error), unsaved: Boolean(unsavedWrite) }
  }

  function remember(errorValue, candidate = null, token = generation) {
    if (token === generation) {
      if (candidate) run = cloneJson(candidate)
      error = errorValue
      if (errorValue.code === 'REVISION_CONFLICT' || errorValue.code === 'STORAGE_FAILED'
        || errorValue.code === 'STORAGE_UNAVAILABLE' || errorValue.code === 'STORAGE_BLOCKED') readOnly = true
    }
    throw errorValue
  }

  async function write(candidate, result, token, { retainOnFailure = true, effects = null } = {}) {
    const expectedRevision = candidate.revision
    const request = result
      ? repository.completeRun(candidate, result, { expectedRevision })
      : repository.saveRun(candidate, { expectedRevision })
    pendingWrite = Promise.resolve(request)
    try {
      const saved = await pendingWrite
      if (token === generation) {
        run = migrateBehavioralRun(saved, lab)
        readOnly = run.completedAt !== null
        error = null
        unsavedCompletion = null
        unsavedWrite = null
      }
      return saved
    } catch (cause) {
      if (token === generation && retainOnFailure) {
        unsavedWrite = { candidate: cloneJson(candidate), result: result && cloneJson(result), effects: effects && cloneJson(effects) }
        if (result && cause.code !== 'REVISION_CONFLICT') unsavedCompletion = { candidate: cloneJson(candidate), result: cloneJson(result) }
      }
      return remember(cause, retainOnFailure ? candidate : null, token)
    } finally {
      pendingWrite = null
    }
  }

  function replace(kind) {
    const token = ++generation
    busy = false
    replacing = true
    unsavedCompletion = null
    unsavedWrite = null
    const operation = lifecycle.catch(() => {}).then(async () => {
      if (pendingWrite) {
        try { await pendingWrite } catch { /* load the transaction's actual outcome below */ }
      }
      if (token !== generation) return null
      let raw
      let saving = false
      try {
        raw = await repository.loadRun(lab.id)
        if (token !== generation) return null
        const current = kind === 'recover' || raw === null ? null : migrateBehavioralRun(raw, lab)
        if (kind === 'load' && current) {
          run = current
          readOnly = current.completedAt !== null
          error = null
          failedRaw = null
          return null
        }
        const fresh = createBehavioralRun(lab, { attemptId: createAttemptId() })
        fresh.revision = kind === 'recover' ? 0 : current?.revision ?? 0
        saving = true
        if (kind === 'recover') {
          if (!failedRaw || typeof repository.replaceRunForRecovery !== 'function') {
            throw commandError('RECOVERY_UNAVAILABLE', 'There is no failed raw run to recover.')
          }
          const saved = await repository.replaceRunForRecovery(lab.id, { expectedRaw: failedRaw, replacement: fresh })
          if (token === generation) {
            run = migrateBehavioralRun(saved, lab)
            readOnly = false
            error = null
            failedRaw = null
          }
        } else await write(fresh, null, token)
        return null
      } catch (cause) {
        if (token === generation) {
          if (!saving) run = null
          readOnly = true
          error = cause
          if (!saving && raw !== undefined && raw !== null) failedRaw = structuredClone(raw)
        }
        throw cause
      }
    }).then(() => {
      if (token !== generation) return null
      replacing = false
      return snapshot()
    }, (cause) => {
      if (token === generation) replacing = false
      throw cause
    })
    lifecycle = operation
    return operation
  }

  function load() { return replace('load') }
  function restart() { return replace('restart') }
  function recoverRestart() { return replace('recover') }
  function exportRaw() { return failedRaw && structuredClone(failedRaw) }
  function exportRun() { return run && cloneJson(run) }

  async function retrySave() {
    if (busy || replacing) throw commandError('BUSY', 'A session command is already running.')
    if (!unsavedWrite || !['STORAGE_FAILED', 'STORAGE_UNAVAILABLE', 'STORAGE_BLOCKED'].includes(error?.code)) {
      throw commandError('RETRY_UNAVAILABLE', 'There is no failed save to retry.')
    }
    const token = generation
    const { candidate, result, effects } = unsavedWrite
    busy = true
    try {
      await write(candidate, result, token, { effects })
      const settled = settledSnapshot(token)
      return settled && effects ? { ...settled, effects } : settled
    } finally {
      if (token === generation) busy = false
    }
  }

  function settledSnapshot(token) {
    if (token !== generation) return null
    busy = false
    return snapshot()
  }

  async function dispatch(action) {
    if (busy || replacing) throw commandError('BUSY', 'A session command is already running.')
    if (!run) throw commandError('NO_RUN', 'Load the Lab before dispatching a command.')
    if (readOnly) throw commandError('READ_ONLY', 'This attempt cannot be changed until reload or restart.')
    const token = generation
    busy = true
    try {
      const current = cloneJson(run)
      const reduced = await reduce(cloneJson(current), action)
      const envelope = isPlainObject(reduced) && Object.hasOwn(reduced, 'run') ? reduced : null
      const candidate = envelope ? envelope.run : reduced
      if (token !== generation) return null
      if (!isPlainObject(candidate) || candidate.schemaVersion !== current.schemaVersion
        || candidate.labId !== current.labId || candidate.contentVersion !== current.contentVersion
        || candidate.attemptId !== current.attemptId || candidate.revision !== current.revision
        || candidate.completedAt !== current.completedAt || candidate.resultId !== current.resultId) {
        throw commandError('INVALID_RUN', 'The reducer changed session identity, revision, or completion fields.')
      }
      validateBehavioralRun(candidate, lab)
      const effects = envelope && {
        lines: cloneJson(envelope.lines ?? []), portalEvents: cloneJson(envelope.portalEvents ?? []),
        diagnostics: cloneJson(envelope.diagnostics ?? []),
      }
      await write(candidate, null, token, { effects })
      const settled = settledSnapshot(token)
      return settled && effects ? { ...settled, effects } : settled
    } catch (cause) {
      return remember(cause, null, token)
    } finally {
      if (token === generation) busy = false
    }
  }

  async function complete(metadata) {
    if (busy || replacing) throw commandError('BUSY', 'A session command is already running.')
    if (!run) throw commandError('NO_RUN', 'Load the Lab before completing it.')
    const token = generation
    busy = true
    try {
      if (run.completedAt !== null) {
        if (error?.code === 'REVISION_CONFLICT') throw commandError('READ_ONLY', 'Reload the attempt after a revision conflict.')
        const result = completionResult(metadata, run, evaluateLab(lab, run))
        if (result.id !== run.resultId || result.finishedAt !== run.completedAt) {
          throw commandError('RUN_COMPLETED', 'A completed attempt is immutable; restart to practice again.')
        }
        if (unsavedCompletion && canonicalize(result) !== canonicalize(unsavedCompletion.result)) {
          throw commandError('RESULT_CONFLICT', 'The completion retry differs from its unsaved result.')
        }
        const candidate = unsavedCompletion?.candidate ?? { ...cloneJson(run), revision: run.revision - 1 }
        await write(candidate, result, token, { retainOnFailure: Boolean(unsavedCompletion) })
        return settledSnapshot(token)
      }
      if (readOnly) throw commandError('READ_ONLY', 'This attempt cannot be changed until reload or restart.')
      const evaluation = evaluateLab(lab, run)
      if (!evaluation.isComplete) throw commandError('LAB_INCOMPLETE', 'All Lab Tasks must be complete first.')
      const result = completionResult(metadata, run, evaluation)
      if (token !== generation) return null
      const candidate = { ...cloneJson(run), completedAt: result.finishedAt, resultId: result.id }
      await write(candidate, result, token)
      return settledSnapshot(token)
    } catch (cause) {
      return remember(cause, null, token)
    } finally {
      if (token === generation) busy = false
    }
  }

  return { snapshot, load, restart, recoverRestart, exportRaw, exportRun, retrySave, dispatch, complete }
}
