import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { useProgressStore } from '../src/stores/progress.js'
import { usePortalStore } from '../src/stores/portal.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const lab = { id: 'behavioral-lab', title: 'Behavioral fixture', engineVersion: 2, contentVersion: 1,
  tasks: [{ id: 'ready', text: 'Be ready', hints: ['try it'],
    check: (context) => context.sandbox.resourceGroups.some((group) => group.name === 'done') }] }
const finish = { type: 'command', line: 'az group create -n done -l westeurope' }
const clone = (value) => structuredClone(value)
function repository() {
  let stored = null
  const results = []
  let failure = null
  const save = async (candidate, result, { expectedRevision }) => {
    if (failure) { const error = failure; failure = null; throw error }
    if ((stored?.revision ?? 0) !== expectedRevision) throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' })
    stored = { ...clone(candidate), revision: expectedRevision + 1 }
    if (result) results.push(clone(result))
    return clone(stored)
  }
  return {
    async loadRun(labId) { return stored?.labId === labId ? clone(stored) : null },
    async listRuns() { return stored ? [clone(stored)] : [] },
    async listResults() { return clone(results) },
    saveRun: (run, options) => save(run, null, options),
    completeRun: save,
    failNext(error) { failure = error },
    get stored() { return clone(stored) },
    set stored(value) { stored = clone(value) },
    get results() { return clone(results) },
  }
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage()
  setActivePinia(createPinia())
})

describe('behavioral store adapter', () => {
  it('keeps Cloud Shell available during elapsed ticks while commands still show as running', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    const originalSave = native.saveRun
    let release
    native.saveRun = async (candidate, options) => {
      await new Promise((resolve) => { release = resolve })
      return originalSave(candidate, options)
    }

    const tick = store.dispatchBehavioral({ type: 'elapsed', milliseconds: 1000 })
    expect(store.running).toBe(false)
    for (let turn = 0; turn < 8 && !release; turn++) await Promise.resolve()
    expect(store.running).toBe(false)

    const command = store.dispatchBehavioral({ type: 'command', line: 'az --help' })
    expect(store.running).toBe(true)
    release()
    release = null
    await tick
    expect(store.running).toBe(true)
    for (let turn = 0; turn < 8 && !release; turn++) await Promise.resolve()
    release()
    await command
    expect(store.running).toBe(false)
    expect(store.elapsedMs).toBe(1000)
  })

  it('keeps a rejected action diagnostic visible across elapsed ticks', async () => {
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: repository() })
    const rejected = await store.dispatchBehavioral({ type: 'request', appId: '/apps/one', method: 'GET', path: '/typo' })
    expect(rejected.effects.diagnostics).toMatchObject([{ code: 'INVALID_ACTION' }])
    expect(store.diagnostics).toMatchObject([{ code: 'INVALID_ACTION' }])
    await store.dispatchBehavioral({ type: 'elapsed', milliseconds: 1000 })
    expect(store.diagnostics).toMatchObject([{ code: 'INVALID_ACTION' }])
    await store.dispatchBehavioral({ type: 'hint', taskId: 'ready' })
    expect(store.diagnostics).toEqual([])
  })

  it('loads asynchronously, projects full task states, and resumes the same attempt', async () => {
    const native = repository()
    const store = useLabRunStore()
    const pending = store.load(lab.id, { lab, repository: native })
    expect(store.loading).toBe(true)
    await pending
    expect(store.loading).toBe(false)
    expect(store.behavioralRun).toMatchObject({ attemptId: expect.any(String), revision: 1 })
    expect(store.taskStates[0]).toMatchObject({ id: 'ready', done: false, status: 'pending' })
    expect(store.isComplete).toBe(false)
    const attemptId = store.behavioralRun.attemptId
    await store.load(lab.id, { lab, repository: native })
    expect(store.behavioralRun.attemptId).toBe(attemptId)
  })

  it('serializes actions, records help and elapsed time, then atomically completes', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    const first = store.dispatchBehavioral({ type: 'hint', taskId: 'ready' })
    const second = store.dispatchBehavioral({ type: 'elapsed', milliseconds: 5000 })
    await Promise.all([first, second])
    await store.dispatchBehavioral(finish)
    expect(store.hintsUsed).toBe(1)
    expect(store.elapsedMs).toBe(5000)
    expect(store.behavioralRun.runtime.simTimeMs).toBe(0)
    expect(store.isComplete).toBe(true)
    expect(native.results).toHaveLength(1)
    expect(native.results[0]).toMatchObject({ id: store.resultId, hintsUsed: 1, durationMs: 5000 })
    await expect(store.dispatchBehavioral({ type: 'solution', taskId: 'ready' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.isComplete).toBe(false)
    expect(store.behavioralRun.attemptId).not.toBe(native.results[0].attemptId)
    expect(native.results).toHaveLength(1)
  })

  it('retains an unsaved action for export and retry after storage failure', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    native.failNext(Object.assign(new Error('disk'), { code: 'STORAGE_FAILED' }))
    await expect(store.dispatchBehavioral({ type: 'hint', taskId: 'ready' })).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    expect(store.unsaved).toBe(true)
    expect(store.readOnly).toBe(true)
    expect(store.exportRun().run.hintsRevealed.ready).toBe(1)
    await store.retrySave()
    expect(store.unsaved).toBe(false)
    await store.dispatchBehavioral(finish)
    expect(store.isComplete).toBe(true)
    expect(native.results).toHaveLength(1)
  })

  it('reports Task satisfaction without committed completion after an atomic failure, then retries the same Result', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    native.failNext(Object.assign(new Error('disk'), { code: 'STORAGE_FAILED' }))
    // First failure is the command save; retry it, then fail the completion write.
    await expect(store.dispatchBehavioral(finish)).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    const originalComplete = native.completeRun
    native.completeRun = async (...args) => {
      native.completeRun = originalComplete
      throw Object.assign(new Error('disk'), { code: 'STORAGE_FAILED' })
    }
    await expect(store.retrySave()).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    expect(store.taskStates[0].done).toBe(true)
    expect(store.isComplete).toBe(false)
    expect(store.completedAt).toBeNull()
    const candidate = store.exportRun().run
    expect(candidate.resultId).toBeTruthy()
    await store.retrySave()
    expect(store.isComplete).toBe(true)
    expect(native.results).toHaveLength(1)
    expect(native.results[0]).toMatchObject({ id: candidate.resultId, finishedAt: candidate.completedAt })
    expect(useProgressStore().latestResult(lab.id)?.id).toBe(candidate.resultId)
    expect(usePortalStore().toast).toMatchObject({ title: 'Lab completed' })
  })

  it('keeps a conflicted candidate exportable and prevents retry overwrite', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    native.stored = { ...native.stored, revision: 2 }
    await expect(store.dispatchBehavioral({ type: 'hint', taskId: 'ready' })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(store.unsaved).toBe(true)
    expect(store.exportRun().run.hintsRevealed.ready).toBe(1)
    await expect(store.retrySave()).rejects.toMatchObject({ code: 'RETRY_UNAVAILABLE' })
  })

  it('exports incompatible raw data and recovers only through explicit restart', async () => {
    const native = repository()
    const raw = { labId: lab.id, schemaVersion: 99, revision: 7, payload: { keep: true } }
    native.stored = raw
    native.replaceRunForRecovery = async (labId, { expectedRaw, replacement }) => {
      expect(labId).toBe(lab.id)
      expect(expectedRaw).toEqual(raw)
      native.stored = { ...replacement, revision: 8 }
      return native.stored
    }
    const store = useLabRunStore()
    await expect(store.load(lab.id, { lab, repository: native })).rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEMA' })
    expect(store.exportRun()).toMatchObject({ raw, error: { code: 'UNSUPPORTED_SCHEMA' } })
    expect(native.stored).toEqual(raw)
    await store.recoverRestart()
    expect(store.behavioralRun).toMatchObject({ revision: 8, schemaVersion: 2 })
    expect(store.exportRun().raw).toBeNull()
  })

  it('cancels a command result after restart and keeps the new attempt clean', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    const previousAttempt = store.behavioralRun.attemptId
    const originalSave = native.saveRun
    let release
    native.saveRun = async (candidate, options) => {
      if (candidate.hintsRevealed.ready) await new Promise((resolve) => { release = resolve })
      return originalSave(candidate, options)
    }
    const old = store.dispatchBehavioral({ type: 'hint', taskId: 'ready' })
    for (let turn = 0; turn < 8 && !release; turn++) await Promise.resolve()
    const restart = store.restart()
    release()
    await Promise.all([old, restart])
    expect(store.hintsUsed).toBe(0)
    expect(store.behavioralRun.attemptId).not.toBe(previousAttempt)
  })

  it('ignores a late load after navigating back to a legacy Lab', async () => {
    const native = repository()
    const original = native.loadRun
    let release
    native.loadRun = () => new Promise((resolve) => { release = () => original().then(resolve) })
    const store = useLabRunStore()
    const oldLoad = store.load(lab.id, { lab, repository: native })
    for (let turn = 0; turn < 4 && !release; turn++) await Promise.resolve()
    const navigation = store.load('servicebus-order-backend')
    release()
    await Promise.all([oldLoad, navigation])
    expect(store.labId).toBe('servicebus-order-backend')
    expect(store.behavioralRun).toBeNull()
  })

  it('clears behavioral status when a completed or failed run navigates to a legacy Lab', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    await store.dispatchBehavioral(finish)
    expect(store.readOnly).toBe(true)
    expect(store.lab.id).toBe(lab.id)
    await store.load('servicebus-order-backend')
    expect(store.lab.id).toBe('servicebus-order-backend')
    expect(store.behavioralRun).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.readOnly).toBe(false)
    expect(store.storageError).toBeNull()
    expect(store.unsaved).toBe(false)
  })

  it('recomputes the Lab getter and Task evaluation across two behavioral definitions', async () => {
    const native = repository()
    const store = useLabRunStore()
    const other = { ...lab, id: 'second-behavioral-lab', tasks: [{ id: 'other-task', text: 'Other', check: () => false }] }
    await store.load(lab.id, { lab, repository: native })
    expect(store.lab.id).toBe(lab.id)
    await store.load(other.id, { lab: other, repository: repository() })
    expect(store.lab.id).toBe(other.id)
    expect(store.taskStates.map((task) => task.id)).toEqual(['other-task'])
  })

  it('same-Lab reload waits for the pending save and resumes its revision', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    const originalSave = native.saveRun
    let release
    native.saveRun = async (candidate, options) => {
      if (candidate.hintsRevealed.ready) await new Promise((resolve) => { release = resolve })
      return originalSave(candidate, options)
    }
    const prior = store.dispatchBehavioral({ type: 'hint', taskId: 'ready' })
    for (let turn = 0; turn < 8 && !release; turn++) await Promise.resolve()
    const reloaded = store.load(lab.id, { lab, repository: native })
    release()
    await Promise.all([prior, reloaded])
    expect(store.behavioralRun).toMatchObject({ revision: 2, hintsRevealed: { ready: 1 } })
  })

  for (const destination of ['same-v2', 'other-v2', 'legacy']) {
    it(`flushes a queued draft behind a slow save before navigating to ${destination}`, async () => {
      const native = repository()
      const store = useLabRunStore()
      await store.load(lab.id, { lab, repository: native })
      const originalSave = native.saveRun
      let release
      native.saveRun = async (candidate, options) => {
        if (candidate.hintsRevealed.ready && !candidate.project.draftFiles['src/Trainer.Api/Program.cs']) {
          await new Promise((resolve) => { release = resolve })
        }
        return originalSave(candidate, options)
      }
      const first = store.dispatchBehavioral({ type: 'hint', taskId: 'ready' })
      const second = store.dispatchBehavioral({ type: 'draft', path: 'src/Trainer.Api/Program.cs', text: 'queued draft' })
      for (let turn = 0; turn < 8 && !release; turn++) await Promise.resolve()
      const other = { ...lab, id: 'other-behavioral-lab' }
      const navigation = destination === 'legacy'
        ? store.load('servicebus-order-backend')
        : destination === 'other-v2'
          ? store.load(other.id, { lab: other, repository: repository() })
          : store.load(lab.id, { lab, repository: native })
      expect(store.busy).toBe(true)
      release()
      await Promise.all([first, second, navigation])
      expect(native.stored).toMatchObject({ revision: 3, hintsRevealed: { ready: 1 },
        project: { draftFiles: { 'src/Trainer.Api/Program.cs': 'queued draft' } } })
      if (destination === 'same-v2') expect(store.behavioralRun.revision).toBe(3)
      if (destination === 'legacy') expect(store.labId).toBe('servicebus-order-backend')
      if (destination === 'other-v2') expect(store.labId).toBe(other.id)
      expect(store.busy).toBe(false)
    })
  }

  it('reports busy during load, queued action, retry, and restart', async () => {
    const native = repository()
    const store = useLabRunStore()
    const loading = store.load(lab.id, { lab, repository: native })
    expect(store.busy).toBe(true)
    await loading
    expect(store.busy).toBe(false)

    const originalSave = native.saveRun
    let releaseSave
    native.saveRun = async (candidate, options) => {
      if (candidate.hintsRevealed.ready && !releaseSave) await new Promise((resolve) => { releaseSave = resolve })
      return originalSave(candidate, options)
    }
    const action = store.dispatchBehavioral({ type: 'hint', taskId: 'ready' })
    expect(store.busy).toBe(true)
    for (let turn = 0; turn < 8 && !releaseSave; turn++) await Promise.resolve()
    releaseSave()
    await action
    expect(store.busy).toBe(false)

    native.saveRun = originalSave
    native.failNext(Object.assign(new Error('disk'), { code: 'STORAGE_FAILED' }))
    await expect(store.dispatchBehavioral({ type: 'elapsed', milliseconds: 1 })).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    let releaseRetry
    native.saveRun = async (...args) => { await new Promise((resolve) => { releaseRetry = resolve }); return originalSave(...args) }
    const retry = store.retrySave()
    expect(store.busy).toBe(true)
    for (let turn = 0; turn < 8 && !releaseRetry; turn++) await Promise.resolve()
    releaseRetry()
    await retry
    expect(store.busy).toBe(false)

    native.saveRun = originalSave
    const originalLoad = native.loadRun
    let releaseLoad
    native.loadRun = async (...args) => { await new Promise((resolve) => { releaseLoad = resolve }); return originalLoad(...args) }
    const restart = store.restart()
    expect(store.busy).toBe(true)
    for (let turn = 0; turn < 8 && !releaseLoad; turn++) await Promise.resolve()
    releaseLoad()
    await restart
    expect(store.busy).toBe(false)
  })

  it('does not announce a completed old Lab after navigation during result hydration', async () => {
    const native = repository()
    const store = useLabRunStore()
    await store.load(lab.id, { lab, repository: native })
    const originalList = native.listResults
    let release
    native.listResults = () => new Promise((resolve) => { release = () => originalList().then(resolve) })
    const finishing = store.dispatchBehavioral(finish)
    for (let turn = 0; turn < 16 && !release; turn++) await Promise.resolve()
    const navigation = store.load('servicebus-order-backend')
    release()
    await Promise.all([finishing, navigation])
    expect(usePortalStore().toast).toBeNull()
    expect(store.labId).toBe('servicebus-order-backend')
  })
})

describe('native progress hydration', () => {
  it('loads summaries and result IDs from the native repository', async () => {
    const native = repository()
    const run = useLabRunStore()
    await run.load(lab.id, { lab, repository: native })
    await run.dispatchBehavioral(finish)
    const progress = useProgressStore()
    await progress.hydrateNative({ repository: native, labs: [lab] })
    expect(progress.runSummary(lab.id)).toEqual({ tasksDone: 1, total: 1, completedAt: run.completedAt })
    expect(progress.labStatus(lab.id)).toBe('completed')
    expect(progress.latestResult(lab.id)?.id).toBe(run.resultId)
    expect(localStorage.getItem('at_results')).toBeNull()
  })

  it('reports loading and storage errors, and picks the latest result by finish time', async () => {
    const native = repository()
    native.listResults = async () => [
      { id: 'a-new', labId: lab.id, finishedAt: '2026-09-22T00:00:00Z' },
      { id: 'z-old', labId: lab.id, finishedAt: '2026-09-20T00:00:00Z' },
    ]
    let release
    native.listRuns = () => new Promise((resolve) => { release = () => resolve([]) })
    const progress = useProgressStore()
    const pending = progress.hydrateNative({ repository: native, labs: [lab] })
    expect(progress.labStatus(lab.id)).toBe('loading')
    release()
    await pending
    expect(progress.latestResult(lab.id).id).toBe('a-new')
    expect(progress.labStatus(lab.id)).toBe('completed')
    native.listRuns = async () => { throw Object.assign(new Error('denied'), { code: 'STORAGE_UNAVAILABLE' }) }
    await expect(progress.hydrateNative({ repository: native, labs: [lab] })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(progress.labStatus(lab.id)).toBe('error')
    expect(progress.nativeError.code).toBe('STORAGE_UNAVAILABLE')
  })

  it('shows an initial hydration failure as error after loading ends', async () => {
    const progress = useProgressStore()
    const failing = { listRuns: async () => { throw Object.assign(new Error('denied'), { code: 'STORAGE_UNAVAILABLE' }) },
      listResults: async () => [] }
    await expect(progress.hydrateNative({ repository: failing, labs: [lab] })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(progress.nativeReady).toBe(false)
    expect(progress.labStatus(lab.id)).toBe('error')
  })
})
