import { LabEngineError } from './errors.js'
import { canonicalize } from './evidence.js'
import { validateBehavioralRun } from './run.js'

const DATABASE_VERSION = 1
const RUNS_STORE = 'runs'
const RESULTS_STORE = 'results'

export function serializeRun(run, lab) {
  validateBehavioralRun(run, lab)
  return JSON.stringify(run)
}
export function deserializeRun(json, lab) {
  return validateBehavioralRun(JSON.parse(json), lab)
}

function causalDetails(cause) {
  if (!cause) return {}
  return {
    cause: {
      name: typeof cause.name === 'string' ? cause.name : 'Error',
      message: typeof cause.message === 'string' ? cause.message : String(cause),
    },
  }
}

function storageError(code, message, { dbName, operation, cause } = {}) {
  return new LabEngineError(code, message, {
    dbName,
    operation,
    ...causalDetails(cause),
  })
}

function abortTransaction(transaction, state, error) {
  state.error = error
  try {
    transaction.abort()
  } catch (cause) {
    if (cause?.name !== 'InvalidStateError') state.abortCause = cause
  }
}

function revisionConflict(expectedRevision, actualRevision) {
  return new LabEngineError('REVISION_CONFLICT', 'The stored run revision has changed.', {
    expectedRevision,
    actualRevision: Number.isInteger(actualRevision) ? actualRevision : null,
  })
}

function validateExpectedRevision(run, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new LabEngineError('INVALID_RUN', 'The expected revision must be a nonnegative integer.')
  }
  if (run.revision !== expectedRevision) throw revisionConflict(expectedRevision, run.revision)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function rawMatches(left, right, leftToRight = new WeakMap(), rightToLeft = new WeakMap()) {
  if (Object.is(left, right)) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (leftToRight.has(left) || rightToLeft.has(right)) {
    return leftToRight.get(left) === right && rightToLeft.get(right) === left
  }
  const tag = Object.prototype.toString.call(left)
  if (tag !== Object.prototype.toString.call(right)) return false
  leftToRight.set(left, right)
  rightToLeft.set(right, left)
  if (tag === '[object Date]') return Object.is(left.getTime(), right.getTime())
  if (tag === '[object RegExp]') return left.source === right.source && left.flags === right.flags
  if (tag === '[object ArrayBuffer]') {
    if (left.byteLength !== right.byteLength) return false
    const a = new Uint8Array(left)
    const b = new Uint8Array(right)
    return a.every((byte, index) => byte === b[index])
  }
  if (ArrayBuffer.isView(left)) {
    if (!ArrayBuffer.isView(right) || left.constructor !== right.constructor || left.byteLength !== right.byteLength) return false
    const a = new Uint8Array(left.buffer, left.byteOffset, left.byteLength)
    const b = new Uint8Array(right.buffer, right.byteOffset, right.byteLength)
    return a.every((byte, index) => byte === b[index])
  }
  if (tag === '[object Map]') {
    if (left.size !== right.size) return false
    const rightEntries = [...right.entries()]
    return [...left.entries()].every(([key, value], index) => rawMatches(key, rightEntries[index][0], leftToRight, rightToLeft)
      && rawMatches(value, rightEntries[index][1], leftToRight, rightToLeft))
  }
  if (tag === '[object Set]') {
    if (left.size !== right.size) return false
    const rightValues = [...right.values()]
    return [...left.values()].every((value, index) => rawMatches(value, rightValues[index], leftToRight, rightToLeft))
  }
  if (tag !== '[object Object]' && tag !== '[object Array]') return false
  if (tag === '[object Object]' && (!isPlainObject(left) || !isPlainObject(right))) return false
  if (tag === '[object Array]' && left.length !== right.length) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]
    && rawMatches(left[key], right[key], leftToRight, rightToLeft))
}

function nonemptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function finiteCount(value) {
  return Number.isInteger(value) && value >= 0
}

function validateCompletionResult(run, result) {
  if (!isPlainObject(result)
    || !nonemptyString(result.id)
    || result.id !== run.resultId
    || result.labId !== run.labId
    || result.attemptId !== run.attemptId
    || !finiteCount(result.tasksDone)
    || !finiteCount(result.total)
    || result.tasksDone > result.total
    || !finiteCount(result.hintsUsed)
    || !finiteCount(result.solutionsUsed)) {
    throw new LabEngineError('INVALID_RESULT', 'The completion result is malformed or does not match the run.')
  }
  try {
    canonicalize(result)
  } catch (cause) {
    throw new LabEngineError('INVALID_RESULT', 'The completion result must contain only finite JSON data.', causalDetails(cause))
  }
  return result
}

function validateStoredRun(stored) {
  try {
    validateBehavioralRun(stored)
  } catch (error) {
    if (error instanceof LabEngineError) {
      throw new LabEngineError(error.code, error.message, {
        ...error.details,
        raw: structuredClone(stored),
      })
    }
    throw error
  }
  return stored
}

function validateStoredContent(stored, candidate) {
  if (stored.contentVersion !== candidate.contentVersion) {
    throw new LabEngineError('INCOMPATIBLE_CONTENT', 'The stored run belongs to different Lab content.', {
      labId: stored.labId,
      contentVersion: stored.contentVersion,
      candidateContentVersion: candidate.contentVersion,
      raw: structuredClone(stored),
    })
  }
}

export function createBehavioralRepository({ indexedDB = globalThis.indexedDB, dbName = 'azure-trainer-behavioral' } = {}) {
  let database = null
  let databasePromise = null

  function openDatabase() {
    if (!indexedDB || typeof indexedDB.open !== 'function') {
      return Promise.reject(storageError(
        'STORAGE_UNAVAILABLE',
        'IndexedDB is unavailable in this environment.',
        { dbName, operation: 'open' },
      ))
    }
    if (database) return Promise.resolve(database)
    if (databasePromise) return databasePromise

    databasePromise = new Promise((resolve, reject) => {
      let request
      let settled = false
      try {
        request = indexedDB.open(dbName, DATABASE_VERSION)
      } catch (cause) {
        reject(storageError('STORAGE_UNAVAILABLE', 'IndexedDB could not be opened.', { dbName, operation: 'open', cause }))
        return
      }

      request.onupgradeneeded = () => {
        const opened = request.result
        if (!opened.objectStoreNames.contains(RUNS_STORE)) opened.createObjectStore(RUNS_STORE, { keyPath: 'labId' })
        if (!opened.objectStoreNames.contains(RESULTS_STORE)) opened.createObjectStore(RESULTS_STORE, { keyPath: 'id' })
      }
      request.onblocked = () => {
        if (settled) return
        settled = true
        reject(storageError('STORAGE_BLOCKED', 'IndexedDB upgrade is blocked by another connection.', { dbName, operation: 'open' }))
      }
      request.onerror = () => {
        if (settled) return
        settled = true
        reject(storageError('STORAGE_FAILED', 'IndexedDB failed to open.', {
          dbName,
          operation: 'open',
          cause: request.error,
        }))
      }
      request.onsuccess = () => {
        if (settled) {
          request.result.close()
          return
        }
        settled = true
        const connection = request.result
        database = connection
        connection.onversionchange = () => {
          connection.close()
          if (database === connection) {
            database = null
            databasePromise = null
          }
        }
        resolve(connection)
      }
    })
    databasePromise.catch(() => {
      databasePromise = null
    })
    return databasePromise
  }

  async function transact(storeNames, mode, operation, callback) {
    const opened = await openDatabase()
    return new Promise((resolve, reject) => {
      let transaction
      try {
        transaction = opened.transaction(storeNames, mode)
      } catch (cause) {
        reject(storageError('STORAGE_FAILED', 'IndexedDB could not start a transaction.', { dbName, operation, cause }))
        return
      }

      const state = { value: undefined, error: null, abortCause: null, transactionCause: null, settled: false }
      const finishReject = (error) => {
        if (state.settled) return
        state.settled = true
        reject(error)
      }
      transaction.oncomplete = () => {
        if (state.settled) return
        if (state.transactionCause) {
          finishReject(storageError('STORAGE_FAILED', 'IndexedDB transaction failed.', {
            dbName,
            operation,
            cause: state.transactionCause,
          }))
          return
        }
        state.settled = true
        resolve(state.value)
      }
      transaction.onerror = (event) => {
        if (state.error) return
        state.transactionCause ??= event?.target?.error ?? transaction.error
      }
      transaction.onabort = (event) => {
        if (state.error) {
          finishReject(state.error)
          return
        }
        finishReject(storageError('STORAGE_FAILED', 'IndexedDB transaction aborted.', {
          dbName,
          operation,
          cause: state.abortCause ?? state.transactionCause ?? event?.target?.error ?? transaction.error,
        }))
      }

      try {
        callback(transaction, state)
      } catch (error) {
        abortTransaction(transaction, state, error)
      }
    })
  }

  function loadRun(labId) {
    return transact(RUNS_STORE, 'readonly', 'loadRun', (transaction, state) => {
      const request = transaction.objectStore(RUNS_STORE).get(labId)
      request.onsuccess = () => { state.value = request.result ?? null }
    })
  }

  function listRuns() {
    return transact(RUNS_STORE, 'readonly', 'listRuns', (transaction, state) => {
      const request = transaction.objectStore(RUNS_STORE).getAll()
      request.onsuccess = () => { state.value = request.result }
    })
  }

  function listResults() {
    return transact(RESULTS_STORE, 'readonly', 'listResults', (transaction, state) => {
      const request = transaction.objectStore(RESULTS_STORE).getAll()
      request.onsuccess = () => { state.value = request.result }
    })
  }

  async function saveRun(run, { expectedRevision } = {}) {
    validateBehavioralRun(run)
    validateExpectedRevision(run, expectedRevision)
    if (run.completedAt !== null || run.resultId !== null) {
      throw new LabEngineError('INVALID_RUN', 'Completed runs must be stored with completeRun.')
    }
    const candidate = structuredClone(run)

    return transact(RUNS_STORE, 'readwrite', 'saveRun', (transaction, state) => {
      const store = transaction.objectStore(RUNS_STORE)
      const request = store.get(candidate.labId)
      request.onsuccess = () => {
        const stored = request.result
        if (stored !== undefined) {
          try {
            validateStoredRun(stored)
            validateStoredContent(stored, candidate)
          } catch (error) {
            abortTransaction(transaction, state, error)
            return
          }
        }
        if ((stored === undefined && expectedRevision !== 0)
          || (stored !== undefined && stored.revision !== expectedRevision)) {
          abortTransaction(transaction, state, revisionConflict(expectedRevision, stored?.revision))
          return
        }
        if (stored?.completedAt !== null && stored?.completedAt !== undefined && stored.attemptId === candidate.attemptId) {
          abortTransaction(transaction, state, new LabEngineError(
            'RUN_COMPLETED',
            'A completed attempt is immutable; start a new attempt to continue.',
            { attemptId: candidate.attemptId, resultId: stored.resultId },
          ))
          return
        }
        const saved = { ...candidate, revision: expectedRevision + 1 }
        store.put(saved)
        state.value = saved
      }
    })
  }

  async function completeRun(run, result, { expectedRevision } = {}) {
    validateBehavioralRun(run)
    validateExpectedRevision(run, expectedRevision)
    if (run.completedAt === null || run.resultId === null) {
      throw new LabEngineError('INVALID_RUN', 'Only a completed run can be stored with completeRun.')
    }
    validateCompletionResult(run, result)
    const candidate = structuredClone(run)
    const resultRecord = structuredClone(result)
    const canonicalResult = canonicalize(resultRecord)

    return transact([RUNS_STORE, RESULTS_STORE], 'readwrite', 'completeRun', (transaction, state) => {
      const runs = transaction.objectStore(RUNS_STORE)
      const results = transaction.objectStore(RESULTS_STORE)
      const runRequest = runs.get(candidate.labId)
      const resultRequest = results.get(resultRecord.id)
      let storedRun
      let storedResult
      let runReady = false
      let resultReady = false

      const continueCompletion = () => {
        if (!runReady || !resultReady) return
        if (storedRun !== undefined) {
          try {
            validateStoredRun(storedRun)
            validateStoredContent(storedRun, candidate)
          } catch (error) {
            abortTransaction(transaction, state, error)
            return
          }
        }
        if (storedRun?.attemptId !== undefined && storedRun.attemptId !== candidate.attemptId) {
          abortTransaction(transaction, state, revisionConflict(expectedRevision, storedRun.revision))
          return
        }
        let resultMatches = false
        if (storedResult !== undefined) {
          try {
            resultMatches = canonicalize(storedResult) === canonicalResult
          } catch {
            abortTransaction(transaction, state, new LabEngineError(
              'RESULT_CONFLICT',
              'A malformed immutable result already uses this result id.',
              { resultId: resultRecord.id },
            ))
            return
          }
        }
        if (storedResult !== undefined && !resultMatches) {
          abortTransaction(transaction, state, new LabEngineError(
            'RESULT_CONFLICT',
            'A different immutable result already uses this result id.',
            { resultId: resultRecord.id },
          ))
          return
        }
        if (storedRun?.attemptId === candidate.attemptId
          && storedRun.completedAt !== null
          && storedRun.resultId === candidate.resultId
          && resultMatches) {
          state.value = storedRun
          return
        }
        if ((storedRun === undefined && expectedRevision !== 0)
          || (storedRun !== undefined && storedRun.revision !== expectedRevision)) {
          abortTransaction(transaction, state, revisionConflict(expectedRevision, storedRun?.revision))
          return
        }
        if (storedRun?.completedAt !== null && storedRun?.completedAt !== undefined) {
          abortTransaction(transaction, state, new LabEngineError(
            'RESULT_CONFLICT',
            'The completed attempt already references an immutable result.',
            { resultId: storedRun.resultId },
          ))
          return
        }
        if (storedResult !== undefined) {
          abortTransaction(transaction, state, new LabEngineError(
            'RESULT_CONFLICT',
            'The result id already belongs to another completion.',
            { resultId: resultRecord.id },
          ))
          return
        }

        const saved = { ...candidate, revision: expectedRevision + 1 }
        runs.put(saved)
        results.add(resultRecord)
        state.value = saved
      }

      runRequest.onsuccess = () => {
        try {
          storedRun = runRequest.result
          runReady = true
          continueCompletion()
        } catch (error) {
          abortTransaction(transaction, state, error)
        }
      }
      resultRequest.onsuccess = () => {
        try {
          storedResult = resultRequest.result
          resultReady = true
          continueCompletion()
        } catch (error) {
          abortTransaction(transaction, state, error)
        }
      }
    })
  }

  async function replaceRunForRecovery(labId, { expectedRaw, replacement } = {}) {
    validateBehavioralRun(replacement)
    if (replacement.labId !== labId || replacement.revision !== 0 || replacement.completedAt !== null
      || replacement.resultId !== null || expectedRaw === undefined || expectedRaw === null) {
      throw new LabEngineError('INVALID_RUN', 'Recovery needs a fresh matching attempt and the failed raw record.')
    }
    const candidate = structuredClone(replacement)
    const comparedRaw = structuredClone(expectedRaw)
    return transact(RUNS_STORE, 'readwrite', 'replaceRunForRecovery', (transaction, state) => {
      const store = transaction.objectStore(RUNS_STORE)
      const request = store.get(labId)
      request.onsuccess = () => {
        const stored = request.result
        if (stored === undefined || !rawMatches(stored, comparedRaw) || stored.attemptId === candidate.attemptId) {
          abortTransaction(transaction, state, revisionConflict(comparedRaw?.revision, stored?.revision))
          return
        }
        const saved = { ...candidate, revision: Number.isInteger(stored.revision) && stored.revision >= 0
          ? stored.revision + 1 : 1 }
        store.put(saved)
        state.value = saved
      }
    })
  }

  function close() {
    database?.close()
    database = null
    databasePromise = null
  }

  return { loadRun, listRuns, listResults, saveRun, completeRun, replaceRunForRecovery, close }
}
