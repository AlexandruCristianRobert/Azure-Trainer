import { describe, expect, it } from 'vitest'
import { behavioralLab } from './helpers/behavioralLab.js'
import { createBehavioralRun, cloneJson } from '../src/lib/labEngine/run.js'
import { createBehavioralSession } from '../src/lib/labEngine/session.js'
import { canonicalize } from '../src/lib/labEngine/evidence.js'

function lab() {
  const fixture = behavioralLab()
  return { ...fixture, tasks: fixture.tasks.filter((task) => task.id === 'configured') }
}

function memoryRepository(initial = null) {
  let stored = initial && cloneJson(initial)
  const results = []
  let nextError = null
  const write = async (run, result, { expectedRevision }) => {
    if (nextError) { const error = nextError; nextError = null; throw error }
    if (result && stored?.resultId === result.id && stored?.attemptId === run.attemptId) {
      if (canonicalize(results.find((entry) => entry.id === result.id)) === canonicalize(result)) return cloneJson(stored)
      throw Object.assign(new Error('Result changed'), { code: 'RESULT_CONFLICT' })
    }
    if ((stored?.revision ?? 0) !== expectedRevision || run.revision !== expectedRevision) {
      throw Object.assign(new Error('Revision changed'), { code: 'REVISION_CONFLICT' })
    }
    stored = { ...cloneJson(run), revision: expectedRevision + 1 }
    if (result) results.push(cloneJson(result))
    return cloneJson(stored)
  }
  return {
    async loadRun() { return stored && cloneJson(stored) },
    saveRun: (run, options) => write(run, null, options),
    completeRun: (run, result, options) => write(run, result, options),
    listResults: async () => cloneJson(results),
    get stored() { return stored && cloneJson(stored) },
    set stored(value) { stored = cloneJson(value) },
    failNext(error) { nextError = error },
  }
}

const reducer = (run, action) => ({ ...run, elapsedMs: run.elapsedMs + action.ms })
const make = (repository, options = {}) => createBehavioralSession({
  lab: lab(), repository, reduce: reducer, createAttemptId: () => 'attempt-' + Math.random(), ...options,
})
const code = (expected) => (error) => error?.code === expected

describe('behavioral session', () => {
  it('creates an absent run, resumes the saved revision, and isolates snapshots', async () => {
    const repository = memoryRepository()
    const first = make(repository, { createAttemptId: () => 'attempt-one' })
    await first.load()
    expect(first.snapshot()).toMatchObject({ busy: false, run: { attemptId: 'attempt-one', revision: 1 } })
    expect(await first.dispatch({ ms: 12 })).toMatchObject({ busy: false, run: { revision: 2 } })
    const exposed = first.snapshot()
    exposed.run.elapsedMs = 999
    expect(first.snapshot().run.elapsedMs).toBe(12)
    const second = make(repository)
    await second.load()
    expect(second.snapshot().run).toMatchObject({ attemptId: 'attempt-one', elapsedMs: 12, revision: 2 })
  })

  it('keeps incompatible raw data exportable and does not replace it', async () => {
    const raw = { labId: 'behavioral-lab', schemaVersion: 99, revision: 4 }
    const repository = memoryRepository(raw)
    const session = make(repository)
    await expect(session.load()).rejects.toSatisfy(code('UNSUPPORTED_SCHEMA'))
    expect(session.snapshot()).toMatchObject({ run: null, readOnly: true, error: { details: { raw } } })
    expect(repository.stored).toEqual(raw)
  })

  it('reports failed loads and never creates a replacement', async () => {
    const repository = memoryRepository()
    repository.loadRun = async () => { throw Object.assign(new Error('denied'), { code: 'STORAGE_UNAVAILABLE' }) }
    const session = make(repository)
    await expect(session.load()).rejects.toSatisfy(code('STORAGE_UNAVAILABLE'))
    expect(repository.stored).toBeNull()
    expect(session.snapshot().error.code).toBe('STORAGE_UNAVAILABLE')
  })

  it('loads completed runs as read-only and restarts with historical results intact', async () => {
    const repository = memoryRepository()
    const session = make(repository, { createAttemptId: (() => { let n = 0; return () => `attempt-${++n}` })() })
    await session.load()
    expect(await session.complete({ id: 'result-1', finishedAt: '2026-09-22T12:00:00Z' })).toMatchObject({ busy: false, run: { revision: 2 } })
    const completed = make(repository)
    await completed.load()
    expect(completed.snapshot()).toMatchObject({ readOnly: true, run: { resultId: 'result-1' } })
    await expect(completed.dispatch({ ms: 2 })).rejects.toSatisfy(code('READ_ONLY'))
    await session.restart()
    expect(session.snapshot().run).toMatchObject({ attemptId: 'attempt-2', revision: 3, completedAt: null })
    expect((await repository.listResults()).map((result) => result.id)).toEqual(['result-1'])
  })

  it('rejects concurrent dispatch and ignores a reducer resolved after restart', async () => {
    let release
    const delayed = () => new Promise((resolve) => { release = resolve })
    const repository = memoryRepository()
    const session = make(repository, {
      createAttemptId: (() => { let n = 0; return () => `attempt-${++n}` })(),
      reduce: delayed,
    })
    await session.load()
    const command = session.dispatch({})
    await expect(session.dispatch({})).rejects.toSatisfy(code('BUSY'))
    await session.restart()
    release({ ...createBehavioralRun(lab(), { attemptId: 'attempt-1' }), elapsedMs: 90, revision: 1 })
    expect(await command).toBeNull()
    expect(session.snapshot().run).toMatchObject({ attemptId: 'attempt-2', elapsedMs: 0, revision: 2 })
    expect(repository.stored.elapsedMs).toBe(0)
  })

  it('allows commands on the new attempt while an invalidated reducer is still pending', async () => {
    let release
    const repository = memoryRepository()
    const session = make(repository, {
      createAttemptId: (() => { let n = 0; return () => `attempt-${++n}` })(),
      reduce: (run, action) => action.delay
        ? new Promise((resolve) => { release = () => resolve({ ...run, elapsedMs: 99 }) })
        : { ...run, elapsedMs: action.ms },
    })
    await session.load()
    const stale = session.dispatch({ delay: true })
    await session.restart()
    expect(session.snapshot().busy).toBe(false)
    await session.dispatch({ ms: 5 })
    release()
    await stale
    expect(session.snapshot().run).toMatchObject({ attemptId: 'attempt-2', elapsedMs: 5, revision: 3 })
  })

  it('waits for an in-flight write before restarting at its persisted revision', async () => {
    const repository = memoryRepository()
    const originalSave = repository.saveRun
    let release
    repository.saveRun = async (...args) => {
      if (args[0].elapsedMs === 25) await new Promise((resolve) => { release = resolve })
      return originalSave(...args)
    }
    const session = make(repository, { createAttemptId: (() => { let n = 0; return () => `attempt-${++n}` })() })
    await session.load()
    const command = session.dispatch({ ms: 25 })
    await Promise.resolve()
    const restart = session.restart()
    release()
    const [staleResult] = await Promise.all([command, restart])
    expect(staleResult).toBeNull()
    expect(session.snapshot().run).toMatchObject({ attemptId: 'attempt-2', revision: 3, elapsedMs: 0 })
  })

  it('makes a conflicted session read-only until a reload', async () => {
    const repository = memoryRepository()
    const session = make(repository)
    await session.load()
    repository.stored = { ...repository.stored, revision: 2 }
    await expect(session.dispatch({ ms: 1 })).rejects.toSatisfy(code('REVISION_CONFLICT'))
    expect(session.snapshot()).toMatchObject({ readOnly: true, error: { code: 'REVISION_CONFLICT' } })
    await session.load()
    expect(session.snapshot()).toMatchObject({ readOnly: false, run: { revision: 2 } })
  })

  it('retains an unsaved candidate for export after storage failure', async () => {
    const repository = memoryRepository()
    const session = make(repository)
    await session.load()
    repository.failNext(Object.assign(new Error('disk failed'), { code: 'STORAGE_FAILED' }))
    await expect(session.dispatch({ ms: 31 })).rejects.toSatisfy(code('STORAGE_FAILED'))
    expect(session.snapshot()).toMatchObject({ run: { elapsedMs: 31, revision: 1 }, error: { code: 'STORAGE_FAILED' } })
    expect(repository.stored.elapsedMs).toBe(0)
  })

  it('retries the exact failed command candidate at its original revision', async () => {
    const repository = memoryRepository()
    const session = make(repository)
    await session.load()
    repository.failNext(Object.assign(new Error('disk failed'), { code: 'STORAGE_FAILED' }))
    await expect(session.dispatch({ ms: 31 })).rejects.toSatisfy(code('STORAGE_FAILED'))
    expect(session.snapshot()).toMatchObject({ unsaved: true, readOnly: true })
    expect(session.exportRun().elapsedMs).toBe(31)
    await session.retrySave()
    expect(session.snapshot()).toMatchObject({ unsaved: false, readOnly: false, run: { elapsedMs: 31, revision: 2 } })
  })

  it('keeps incompatible raw exportable and requires an explicit recovery restart', async () => {
    const raw = { labId: 'behavioral-lab', schemaVersion: 99, revision: 4 }
    const repository = memoryRepository(raw)
    repository.replaceRunForRecovery = async (labId, { expectedRaw, replacement }) => {
      expect(labId).toBe('behavioral-lab')
      expect(expectedRaw).toEqual(raw)
      expect(replacement.attemptId).toBe('replacement')
      repository.stored = { ...replacement, revision: 5 }
      return repository.stored
    }
    const session = make(repository, { createAttemptId: () => 'replacement' })
    await expect(session.load()).rejects.toSatisfy(code('UNSUPPORTED_SCHEMA'))
    expect(session.exportRaw()).toEqual(raw)
    await session.recoverRestart()
    expect(session.snapshot()).toMatchObject({ readOnly: false, run: { attemptId: 'replacement', revision: 5 } })
    expect(session.exportRaw()).toBeNull()
  })

  it('delivers reducer effects only after a saved matching attempt', async () => {
    const repository = memoryRepository()
    const session = make(repository, { reduce: (run) => ({ run: { ...run, elapsedMs: 7 },
      lines: [{ kind: 'out', text: 'saved' }], portalEvents: [{ type: 'created', resourceType: 'resourceGroup', name: 'x' }], diagnostics: [] }) })
    await session.load()
    repository.failNext(Object.assign(new Error('disk failed'), { code: 'STORAGE_FAILED' }))
    await expect(session.dispatch({})).rejects.toSatisfy(code('STORAGE_FAILED'))
    expect(session.snapshot().effects).toBeUndefined()
    const retried = await session.retrySave()
    expect(retried.effects).toMatchObject({ lines: [{ text: 'saved' }], portalEvents: [{ name: 'x' }] })
    expect(session.snapshot().run.elapsedMs).toBe(7)
  })

  it('keeps a conflicted candidate exportable but never retryable', async () => {
    const repository = memoryRepository()
    const session = make(repository)
    await session.load()
    repository.stored = { ...repository.stored, revision: 2 }
    await expect(session.dispatch({ ms: 8 })).rejects.toSatisfy(code('REVISION_CONFLICT'))
    expect(session.snapshot()).toMatchObject({ unsaved: true, readOnly: true, error: { code: 'REVISION_CONFLICT' } })
    expect(session.exportRun().elapsedMs).toBe(8)
    await expect(session.retrySave()).rejects.toSatisfy(code('RETRY_UNAVAILABLE'))
  })

  it('retains a new attempt candidate when its restart save fails', async () => {
    const repository = memoryRepository()
    const session = make(repository, { createAttemptId: (() => { let n = 0; return () => `attempt-${++n}` })() })
    await session.load()
    repository.failNext(Object.assign(new Error('disk failed'), { code: 'STORAGE_FAILED' }))
    await expect(session.restart()).rejects.toSatisfy(code('STORAGE_FAILED'))
    expect(session.snapshot()).toMatchObject({ run: { attemptId: 'attempt-2', revision: 1 }, error: { code: 'STORAGE_FAILED' } })
    expect(repository.stored.attemptId).toBe('attempt-1')
  })

  it('retries a failed completion atomically instead of treating its unsaved candidate as saved', async () => {
    const repository = memoryRepository()
    const session = make(repository)
    await session.load()
    const metadata = { id: 'result-retry', finishedAt: '2026-09-22T12:00:00Z' }
    repository.failNext(Object.assign(new Error('write aborted'), { code: 'STORAGE_FAILED' }))
    await expect(session.complete(metadata)).rejects.toSatisfy(code('STORAGE_FAILED'))
    expect(session.snapshot()).toMatchObject({ run: { resultId: 'result-retry', revision: 1 }, error: { code: 'STORAGE_FAILED' } })
    expect(repository.stored.resultId).toBeNull()
    expect(await repository.listResults()).toEqual([])
    expect(await session.complete(metadata)).toMatchObject({ busy: false, run: { resultId: 'result-retry', revision: 2 }, error: null })
    expect(await repository.listResults()).toHaveLength(1)
  })

  it('rejects reducer changes to identity, revision, and completion fields without saving', async () => {
    for (const patch of [{ attemptId: 'intruder' }, { revision: 9 }, { completedAt: 'fake', resultId: 'fake' }]) {
      const repository = memoryRepository()
      const session = make(repository, { reduce: (run) => ({ ...run, ...patch }) })
      await session.load()
      await expect(session.dispatch({})).rejects.toSatisfy(code('INVALID_RUN'))
      expect(repository.stored.revision).toBe(1)
      expect(session.snapshot().run.completedAt).toBeNull()
    }
  })

  it('refuses incomplete completion without writing evidence', async () => {
    const repository = memoryRepository()
    const incomplete = { ...lab(), tasks: [{ id: 'blocked', check: () => false }] }
    const session = make(repository, { lab: incomplete })
    await session.load()
    await expect(session.complete({ id: 'result-1', finishedAt: '2026-09-22T12:00:00Z' })).rejects.toSatisfy(code('LAB_INCOMPLETE'))
    expect(repository.stored.resultId).toBeNull()
    expect(await repository.listResults()).toEqual([])
  })

  it('derives completion totals, help, and duration while preserving serializable metadata', async () => {
    const repository = memoryRepository()
    const session = make(repository, { reduce: (run) => ({ ...run, elapsedMs: 70, hintsRevealed: { one: 2 }, solutionsRevealed: { two: true } }) })
    await session.load()
    await session.dispatch({})
    await session.complete({ id: 'result-1', finishedAt: '2026-09-22T12:00:00Z', tasksDone: 99, total: 99, hintsUsed: 99, durationMs: 999, note: { source: 'test' } })
    expect((await repository.listResults())[0]).toEqual({
      id: 'result-1', labId: 'behavioral-lab', attemptId: session.snapshot().run.attemptId,
      finishedAt: '2026-09-22T12:00:00Z', tasksDone: 1, total: 1,
      hintsUsed: 2, solutionsUsed: 1, durationMs: 70, note: { source: 'test' },
    })
    await session.complete({ id: 'result-1', finishedAt: '2026-09-22T12:00:00Z', note: { source: 'test' } })
    expect(await repository.listResults()).toHaveLength(1)
    await expect(session.complete({ id: 'result-1', finishedAt: '2026-09-22T12:00:00Z', note: { source: 'changed' } })).rejects.toSatisfy(code('RESULT_CONFLICT'))
    const reloaded = make(repository)
    await reloaded.load()
    await reloaded.complete({ id: 'result-1', finishedAt: '2026-09-22T12:00:00Z', note: { source: 'test' } })
    expect(await repository.listResults()).toHaveLength(1)
  })

  it('rejects malformed or conflicting completion metadata before saving', async () => {
    const repository = memoryRepository()
    const session = make(repository)
    await session.load()
    for (const result of [{ id: '', finishedAt: 'now' }, { id: 'r' }, { id: 'r', finishedAt: 'now', labId: 'other' }, { id: 'r', finishedAt: 'now', attemptId: 'other' }, { id: 'r', finishedAt: 'now', note: () => 1 }]) {
      await expect(session.complete(result)).rejects.toSatisfy(code('INVALID_RESULT'))
    }
    expect(repository.stored.resultId).toBeNull()
    expect(await repository.listResults()).toEqual([])
  })
})
