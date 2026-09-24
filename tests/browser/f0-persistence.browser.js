import { createBehavioralRun } from '../../src/lib/labEngine/run.js'
import { createBehavioralSession } from '../../src/lib/labEngine/session.js'

const resultNode = () => document.querySelector('#result')

function publish(result) {
  const node = resultNode()
  if (node) node.textContent = JSON.stringify(result, null, 2)
  globalThis.__F0_PERSISTENCE_RESULT__ = result
  return result
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function expectCode(operation, code) {
  try {
    await operation()
  } catch (error) {
    assert(error?.code === code, `Expected ${code}, received ${error?.code ?? error?.name ?? 'unknown error'}`)
    return error
  }
  throw new Error(`Expected ${code}, but the operation succeeded`)
}

function lab(id) {
  return {
    id,
    engineVersion: 2,
    contentVersion: 1,
    tasks: [{ id: 'ready', check: () => true }],
  }
}

function makeRun(labId, attemptId) {
  return createBehavioralRun(lab(labId), { attemptId })
}

function resultFor(run, overrides = {}) {
  return {
    id: run.resultId,
    labId: run.labId,
    attemptId: run.attemptId,
    tasksDone: 1,
    total: 1,
    hintsUsed: 0,
    solutionsUsed: 0,
    durationMs: run.elapsedMs,
    finishedAt: run.completedAt,
    ...overrides,
  }
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })
}

async function putRawRun(dbName, record) {
  const database = await requestResult(indexedDB.open(dbName, 1))
  try {
    const transaction = database.transaction('runs', 'readwrite')
    transaction.objectStore('runs').put(structuredClone(record))
    await transactionDone(transaction)
  } finally {
    database.close()
  }
}

function deleteDatabase(dbName) {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(dbName)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

function faultingIndexedDB(realIndexedDB, fault) {
  const state = { errorSeen: false, outcome: null }
  const wrapDatabase = (database) => new Proxy(database, {
    get(target, property) {
      if (property !== 'transaction') {
        const value = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (...args) => {
        const transaction = target.transaction(...args)
        if (args[1] !== 'readwrite') return transaction
        return new Proxy(transaction, {
          get(txTarget, txProperty) {
            if (txProperty !== 'objectStore') {
              const value = Reflect.get(txTarget, txProperty, txTarget)
              return typeof value === 'function' ? value.bind(txTarget) : value
            }
            return (storeName) => {
              const store = txTarget.objectStore(storeName)
              if (storeName !== 'results') return store
              return new Proxy(store, {
                get(storeTarget, storeProperty) {
                  if (storeProperty !== 'add') {
                    const value = Reflect.get(storeTarget, storeProperty, storeTarget)
                    return typeof value === 'function' ? value.bind(storeTarget) : value
                  }
                  return (...storeArgs) => {
                    if (fault === 'request-error') {
                      storeTarget.add(...storeArgs)
                      return storeTarget.add(...storeArgs)
                    }
                    const request = storeTarget.add(...storeArgs)
                    queueMicrotask(() => txTarget.abort())
                    return request
                  }
                },
              })
            }
          },
          set(txTarget, txProperty, value) {
            if (txProperty === 'onerror' && typeof value === 'function') {
              return Reflect.set(txTarget, txProperty, (event) => {
                state.errorSeen = true
                value.call(txTarget, event)
              }, txTarget)
            }
            if ((txProperty === 'onabort' || txProperty === 'oncomplete') && typeof value === 'function') {
              return Reflect.set(txTarget, txProperty, (event) => {
                state.outcome = txProperty === 'onabort' ? 'abort' : 'complete'
                value.call(txTarget, event)
              }, txTarget)
            }
            return Reflect.set(txTarget, txProperty, value, txTarget)
          },
        })
      }
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target)
    },
  })

  const factory = {
    open(name, version) {
      const nativeRequest = realIndexedDB.open(name, version)
      let requestProxy
      requestProxy = new Proxy(nativeRequest, {
        get(target, property) {
          if (property === 'result') return wrapDatabase(Reflect.get(target, property, target))
          return Reflect.get(target, property, target)
        },
        set(target, property, value) {
          if (property.startsWith('on') && typeof value === 'function') {
            return Reflect.set(target, property, (event) => value.call(requestProxy, event), target)
          }
          return Reflect.set(target, property, value, target)
        },
      })
      return requestProxy
    },
  }
  return { factory, state }
}

export async function runPersistenceChecks() {
  const cases = []
  const unique = `${Date.now()}-${crypto.randomUUID()}`
  const dbName = `azure-trainer-f0-${unique}`
  const abortDbName = `azure-trainer-f0-abort-${unique}`
  const requestErrorDbName = `azure-trainer-f0-request-error-${unique}`
  const sessionDbName = `azure-trainer-f0-session-${unique}`
  const repositories = []
  const unhandled = []
  const onUnhandled = (event) => {
    unhandled.push(event.reason)
    event.preventDefault()
  }
  addEventListener('unhandledrejection', onUnhandled)

  const check = async (name, operation) => {
    try {
      await operation()
      cases.push({ name, passed: true })
    } catch (error) {
      cases.push({
        name,
        passed: false,
        error: {
          name: error?.name ?? 'Error',
          code: error?.code ?? null,
          message: error?.message ?? String(error),
        },
      })
    }
  }

  let createBehavioralRepository
  try {
    const repositoryUrl = new URL('../../src/lib/labEngine/persistence.js', import.meta.url).href
    ;({ createBehavioralRepository } = await import(/* @vite-ignore */ repositoryUrl))
  } catch (error) {
    cases.push({
      name: 'repository module loads',
      passed: false,
      error: { name: error?.name ?? 'Error', code: error?.code ?? null, message: error?.message ?? String(error) },
    })
    removeEventListener('unhandledrejection', onUnhandled)
    return publish({ passed: 0, failed: 1, cases })
  }

  let repository
  let firstSaved
  let current
  let completionCandidate
  let completionResult

  try {
    repository = createBehavioralRepository({ dbName })
    repositories.push(repository)

    await check('create/load', async () => {
      const original = makeRun('persistence-lab', 'attempt-1')
      firstSaved = await repository.saveRun(original, { expectedRevision: 0 })
      assert(firstSaved.revision === 1, 'The first save must increment revision to 1')
      assert(original.revision === 0, 'Saving must not mutate caller data')
      const loaded = await repository.loadRun(original.labId)
      assert(JSON.stringify(loaded) === JSON.stringify(firstSaved), 'The saved run must load intact')
    })

    await check('update', async () => {
      const candidate = { ...firstSaved, elapsedMs: 25 }
      current = await repository.saveRun(candidate, { expectedRevision: 1 })
      assert(current.revision === 2, 'An update must increment the stored revision')
      assert(current.elapsedMs === 25, 'An update must persist the candidate state')
      assert(candidate.revision === 1, 'An update must not mutate its candidate')
    })

    await check('two concurrent CAS writes', async () => {
      const otherRepository = createBehavioralRepository({ dbName })
      repositories.push(otherRepository)
      const left = { ...current, elapsedMs: 30 }
      const right = { ...current, elapsedMs: 40 }
      const outcomes = await Promise.allSettled([
        repository.saveRun(left, { expectedRevision: 2 }),
        otherRepository.saveRun(right, { expectedRevision: 2 }),
      ])
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected')
      assert(fulfilled.length === 1, `Exactly one CAS write must succeed; received ${fulfilled.length}`)
      assert(rejected.length === 1 && rejected[0].reason?.code === 'REVISION_CONFLICT', 'The losing CAS write must reject with REVISION_CONFLICT')
      current = fulfilled[0].value
      assert(current.revision === 3, 'The CAS winner must store revision 3')
    })

    await check('clone isolation', async () => {
      const loaded = await repository.loadRun(current.labId)
      loaded.project.savedFiles['mutated.txt'] = 'caller-only'
      const listed = await repository.listRuns()
      listed[0].history.push('caller-only')
      const untouched = await repository.loadRun(current.labId)
      assert(untouched.project.savedFiles['mutated.txt'] === undefined, 'Mutating a loaded clone must not affect storage')
      assert(untouched.history.length === 0, 'Mutating a listed clone must not affect storage')
    })

    await check('run/result atomicity', async () => {
      completionCandidate = {
        ...current,
        completedAt: '2026-09-22T12:00:00.000Z',
        resultId: 'result-attempt-1',
      }
      completionResult = resultFor(completionCandidate)
      const completed = await repository.completeRun(completionCandidate, completionResult, { expectedRevision: 3 })
      assert(completed.revision === 4, 'Completion must increment the run revision once')
      const [storedRun, results] = await Promise.all([repository.loadRun(current.labId), repository.listResults()])
      assert(storedRun.resultId === completionResult.id, 'The completed run must reference the stored result')
      assert(results.length === 1 && results[0].id === completionResult.id, 'Completion must store exactly one result')
      current = completed
    })

    await check('repeated completion', async () => {
      const repeated = await repository.completeRun(completionCandidate, completionResult, { expectedRevision: 3 })
      assert(repeated.revision === 4, 'An identical completion retry must return the existing revision')
      assert((await repository.listResults()).length === 1, 'An identical completion retry must not duplicate results')
    })

    await check('modified-result collision', async () => {
      await expectCode(
        () => repository.completeRun(completionCandidate, { ...completionResult, hintsUsed: 1 }, { expectedRevision: 3 }),
        'RESULT_CONFLICT',
      )
      const results = await repository.listResults()
      assert(results.length === 1 && results[0].hintsUsed === 0, 'A result collision must preserve the immutable result')
    })

    await check('ordinary save cannot uncomplete a completed attempt', async () => {
      const uncompleted = { ...current, completedAt: null, resultId: null }
      await expectCode(() => repository.saveRun(uncompleted, { expectedRevision: 4 }), 'RUN_COMPLETED')
      const stored = await repository.loadRun(current.labId)
      assert(stored.completedAt === current.completedAt && stored.resultId === current.resultId, 'Ordinary save must preserve completed run identity')
      assert(stored.revision === 4, 'Rejected uncompletion must not increment the run revision')
    })

    await check('stale completed attempt after restart', async () => {
      const restarted = { ...makeRun(current.labId, 'attempt-2'), revision: 4 }
      current = await repository.saveRun(restarted, { expectedRevision: 4 })
      assert(current.attemptId === 'attempt-2' && current.revision === 5, 'Restart must replace the active run at the current revision')
      const staleCompletion = { ...completionCandidate, revision: 4 }
      await expectCode(
        () => repository.completeRun(staleCompletion, { ...completionResult, hintsUsed: 1 }, { expectedRevision: 4 }),
        'REVISION_CONFLICT',
      )
      const active = await repository.loadRun(current.labId)
      assert(active.attemptId === 'attempt-2' && active.resultId === null, 'A stale completion must not resurrect the previous attempt')
    })

    await check('unsupported raw record preservation', async () => {
      const raw = { labId: 'unsupported-lab', schemaVersion: 99, revision: 7, payload: { preserve: true } }
      await putRawRun(dbName, raw)
      const loaded = await repository.loadRun(raw.labId)
      assert(JSON.stringify(loaded) === JSON.stringify(raw), 'Loading must expose the unsupported raw record unchanged')
      const validReplacement = { ...makeRun(raw.labId, 'replacement-attempt'), revision: 7 }
      const rejectedSave = repository.saveRun(validReplacement, { expectedRevision: 7 })
      assert(rejectedSave instanceof Promise, 'Repository operations except close must return promises on validation failure')
      const error = await expectCode(() => rejectedSave, 'UNSUPPORTED_SCHEMA')
      assert(JSON.stringify(error.details?.raw) === JSON.stringify(raw), 'The stored incompatible raw record must be attached for export')
      assert(JSON.stringify(await repository.loadRun(raw.labId)) === JSON.stringify(raw), 'A rejected save must not reset the unsupported record')
    })

    await check('recovery replaces only the matching raw run', async () => {
      const raw = await repository.loadRun('unsupported-lab')
      const replacement = makeRun(raw.labId, 'recovered-attempt')
      const resultCount = (await repository.listResults()).length
      const saved = await repository.replaceRunForRecovery(raw.labId, { expectedRaw: raw, replacement })
      assert(saved.attemptId === 'recovered-attempt' && saved.revision === 8, 'Recovery must advance the stored revision')
      assert((await repository.listResults()).length === resultCount, 'Recovery must preserve historical results')
    })

    await check('recovery rejects a changed raw run without overwriting it', async () => {
      const raw = { labId: 'recovery-conflict-lab', schemaVersion: 99, revision: 2, payload: { before: true } }
      await putRawRun(dbName, raw)
      const changed = { ...raw, payload: { after: true } }
      await putRawRun(dbName, changed)
      await expectCode(() => repository.replaceRunForRecovery(raw.labId, {
        expectedRaw: raw, replacement: makeRun(raw.labId, 'replacement'),
      }), 'REVISION_CONFLICT')
      assert(JSON.stringify(await repository.loadRun(raw.labId)) === JSON.stringify(changed), 'Conflict must preserve changed raw data')
    })

    await check('recovery compares unchanged malformed structured-clone graphs', async () => {
      const raw = { labId: 'recovery-graph-lab', schemaVersion: 99, revision: 6,
        when: new Date('2026-09-22T12:00:00Z'), values: new Map([['sample', { count: 2 }]]) }
      raw.self = raw
      await putRawRun(dbName, raw)
      const loaded = await repository.loadRun(raw.labId)
      const saved = await repository.replaceRunForRecovery(raw.labId, {
        expectedRaw: loaded, replacement: makeRun(raw.labId, 'graph-replacement'),
      })
      assert(saved.revision === 7 && saved.attemptId === 'graph-replacement', 'Unchanged graph must recover at next revision')
    })

    await check('session exports raw and explicitly recovers after incompatible load', async () => {
      const raw = { labId: 'recovery-session-lab', schemaVersion: 99, revision: 3 }
      await putRawRun(dbName, raw)
      const session = createBehavioralSession({ lab: lab(raw.labId), repository,
        reduce: (run) => run, createAttemptId: () => 'recovered-session-attempt' })
      await expectCode(() => session.load(), 'UNSUPPORTED_SCHEMA')
      assert(JSON.stringify(session.exportRaw()) === JSON.stringify(raw), 'Failed load must retain raw export')
      await session.recoverRestart()
      assert(session.snapshot().run.attemptId === 'recovered-session-attempt', 'Explicit recovery must create a new attempt')
      assert(session.snapshot().run.revision === 4, 'Explicit recovery must advance revision')
    })

    await check('corrupt raw record blocks completion', async () => {
      const raw = { labId: 'corrupt-completion-lab', schemaVersion: 2, revision: 9, payload: { preserve: 'completion' } }
      await putRawRun(dbName, raw)
      const base = { ...makeRun(raw.labId, 'completion-attempt'), revision: 9 }
      const completed = { ...base, completedAt: '2026-09-22T14:00:00.000Z', resultId: 'result-unsupported-completion' }
      const error = await expectCode(
        () => repository.completeRun(completed, resultFor(completed), { expectedRevision: 9 }),
        'INVALID_RUN',
      )
      assert(JSON.stringify(error.details?.raw) === JSON.stringify(raw), 'Completion rejection must attach the stored raw record for export')
      assert(JSON.stringify(await repository.loadRun(raw.labId)) === JSON.stringify(raw), 'Rejected completion must preserve the incompatible run')
      assert(!(await repository.listResults()).some((entry) => entry.id === completed.resultId), 'Rejected completion must not add a result')
    })

    await check('newer stored content blocks older save and completion', async () => {
      const contentLab = { ...lab('newer-content-lab'), contentVersion: 2 }
      const stored = { ...createBehavioralRun(contentLab, { attemptId: 'newer-attempt' }), revision: 7 }
      await putRawRun(dbName, stored)
      const older = { ...makeRun(stored.labId, 'older-attempt'), revision: 7 }
      const saveError = await expectCode(() => repository.saveRun(older, { expectedRevision: 7 }), 'INCOMPATIBLE_CONTENT')
      assert(JSON.stringify(saveError.details?.raw) === JSON.stringify(stored), 'Rejected save must expose the newer raw run for export')
      const completion = { ...older, completedAt: '2026-09-22T17:00:00Z', resultId: 'older-content-result' }
      const completeError = await expectCode(
        () => repository.completeRun(completion, resultFor(completion), { expectedRevision: 7 }),
        'INCOMPATIBLE_CONTENT',
      )
      assert(JSON.stringify(completeError.details?.raw) === JSON.stringify(stored), 'Rejected completion must expose the newer raw run for export')
      assert(JSON.stringify(await repository.loadRun(stored.labId)) === JSON.stringify(stored), 'Both rejected writes must preserve the newer run')
      assert(!(await repository.listResults()).some((entry) => entry.id === completion.resultId), 'Rejected completion must not add a Result')
      const matchingRestart = { ...createBehavioralRun(contentLab, { attemptId: 'matching-attempt' }), revision: 7 }
      const restarted = await repository.saveRun(matchingRestart, { expectedRevision: 7 })
      assert(restarted.attemptId === 'matching-attempt' && restarted.revision === 8, 'Matching-content restart must still save')
    })

    await check('unavailable storage', async () => {
      const unavailable = createBehavioralRepository({ indexedDB: null, dbName: `${dbName}-unavailable` })
      repositories.push(unavailable)
      await expectCode(() => unavailable.loadRun('any-lab'), 'STORAGE_UNAVAILABLE')
      await new Promise((resolve) => setTimeout(resolve, 0))
      assert(unhandled.length === 0, 'Denied storage must not create an unhandled rejection')
    })

    await check('injected transaction abort with no partial data', async () => {
      const injected = faultingIndexedDB(indexedDB, 'abort')
      const aborting = createBehavioralRepository({ indexedDB: injected.factory, dbName: abortDbName })
      repositories.push(aborting)
      const run = makeRun('abort-lab', 'attempt-abort')
      const completed = { ...run, completedAt: '2026-09-22T13:00:00.000Z', resultId: 'result-abort' }
      await expectCode(() => aborting.completeRun(completed, resultFor(completed), { expectedRevision: 0 }), 'STORAGE_FAILED')
      aborting.close()
      const inspector = createBehavioralRepository({ dbName: abortDbName })
      repositories.push(inspector)
      assert(await inspector.loadRun(run.labId) === null, 'An aborted completion must not partially store the run')
      assert((await inspector.listResults()).length === 0, 'An aborted completion must not partially store the result')
      await new Promise((resolve) => setTimeout(resolve, 0))
      assert(unhandled.length === 0, 'An aborted transaction must not create an unhandled rejection')
    })

    await check('injected request error rolls back after transaction outcome', async () => {
      const injected = faultingIndexedDB(indexedDB, 'request-error')
      const failing = createBehavioralRepository({ indexedDB: injected.factory, dbName: requestErrorDbName })
      repositories.push(failing)
      const run = makeRun('request-error-lab', 'attempt-request-error')
      const completed = { ...run, completedAt: '2026-09-22T15:00:00.000Z', resultId: 'result-request-error' }
      await expectCode(() => failing.completeRun(completed, resultFor(completed), { expectedRevision: 0 }), 'STORAGE_FAILED')
      assert(injected.state.errorSeen, 'The injected native request error must reach the transaction')
      assert(injected.state.outcome === 'abort', 'The repository promise must settle only after the transaction abort outcome')
      failing.close()
      const inspector = createBehavioralRepository({ dbName: requestErrorDbName })
      repositories.push(inspector)
      assert(await inspector.loadRun(run.labId) === null, 'A request-error abort must roll back the run')
      assert((await inspector.listResults()).length === 0, 'A request-error abort must roll back the result')
      await new Promise((resolve) => setTimeout(resolve, 0))
      assert(unhandled.length === 0, 'A request-error abort must not create an unhandled rejection')
    })

    await check('session reload, completion, and new-attempt result preservation', async () => {
      const sessionRepository = createBehavioralRepository({ dbName: sessionDbName })
      repositories.push(sessionRepository)
      const sessionLab = lab('session-smoke-lab')
      let attempt = 0
      const options = {
        lab: sessionLab,
        repository: sessionRepository,
        reduce: (run, action) => ({ ...run, elapsedMs: run.elapsedMs + action.ms }),
        createAttemptId: () => `session-attempt-${++attempt}`,
      }
      const first = createBehavioralSession(options)
      await first.load()
      await first.dispatch({ ms: 42 })
      const resumed = createBehavioralSession(options)
      await resumed.load()
      assert(resumed.snapshot().run.attemptId === 'session-attempt-1', 'Reload must resume the same attempt')
      assert(resumed.snapshot().run.elapsedMs === 42 && resumed.snapshot().run.revision === 2, 'Reload must resume the saved state and revision')
      await resumed.complete({ id: 'session-result-1', finishedAt: '2026-09-22T16:00:00Z' })
      const completed = createBehavioralSession(options)
      await completed.load()
      assert(completed.snapshot().readOnly === true, 'Completed reload must be read-only')
      await expectCode(() => completed.dispatch({ ms: 1 }), 'READ_ONLY')
      await completed.complete({ id: 'session-result-1', finishedAt: '2026-09-22T16:00:00Z' })
      await expectCode(() => completed.complete({ id: 'session-result-1', finishedAt: '2026-09-22T16:00:00Z', changed: true }), 'RESULT_CONFLICT')
      await completed.restart()
      assert(completed.snapshot().run.attemptId === 'session-attempt-2', 'Restart must create a new attempt')
      assert(completed.snapshot().run.revision === 4 && completed.snapshot().run.resultId === null, 'Restart must use the current stored revision')
      const results = await sessionRepository.listResults()
      assert(results.length === 1 && results[0].id === 'session-result-1', 'Restart must preserve the completed result')
      assert(results[0].durationMs === 42 && results[0].tasksDone === 1, 'Completion must store derived run values')
    })

    await check('native failed save and completion retry preserve exact candidate and result', async () => {
      const retryLab = lab('session-retry-lab')
      let failSave = false
      let failComplete = false
      const faulting = {
        loadRun: (id) => repository.loadRun(id),
        saveRun: (run, options) => {
          if (failSave) { failSave = false; return Promise.reject(Object.assign(new Error('injected save failure'), { code: 'STORAGE_FAILED' })) }
          return repository.saveRun(run, options)
        },
        completeRun: (run, result, options) => {
          if (failComplete) { failComplete = false; return Promise.reject(Object.assign(new Error('injected completion failure'), { code: 'STORAGE_FAILED' })) }
          return repository.completeRun(run, result, options)
        },
      }
      const session = createBehavioralSession({ lab: retryLab, repository: faulting,
        reduce: (run, action) => ({ ...run, elapsedMs: run.elapsedMs + action.ms }),
        createAttemptId: () => 'native-retry-attempt' })
      await session.load()
      failSave = true
      await expectCode(() => session.dispatch({ ms: 87 }), 'STORAGE_FAILED')
      assert(session.snapshot().unsaved && session.exportRun().elapsedMs === 87, 'Failed command must remain exportable')
      await session.retrySave()
      assert((await repository.loadRun(retryLab.id)).elapsedMs === 87, 'Retry must commit retained command data')
      failComplete = true
      const metadata = { id: 'native-retry-result', finishedAt: '2026-09-22T19:00:00Z' }
      await expectCode(() => session.complete(metadata), 'STORAGE_FAILED')
      const candidate = session.exportRun()
      assert(candidate.resultId === metadata.id && candidate.completedAt === metadata.finishedAt, 'Failed completion must keep original identity and timestamp')
      assert(!(await repository.listResults()).some((result) => result.id === metadata.id), 'Failed atomic completion must leave no result')
      await session.retrySave()
      const results = await repository.listResults()
      const result = results.find((entry) => entry.id === metadata.id)
      assert(result?.finishedAt === metadata.finishedAt && result?.durationMs === 87, 'Retry must store the exact original Result')
      assert((await repository.loadRun(retryLab.id)).resultId === metadata.id, 'Retry must atomically store the completed run')
    })
  } finally {
    removeEventListener('unhandledrejection', onUnhandled)
    for (const item of repositories) item.close()
    await deleteDatabase(dbName)
    await deleteDatabase(abortDbName)
    await deleteDatabase(requestErrorDbName)
    await deleteDatabase(sessionDbName)
  }

  return publish({
    passed: cases.filter((entry) => entry.passed).length,
    failed: cases.filter((entry) => !entry.passed).length,
    cases,
  })
}
