import { defineStore } from 'pinia'
import { toRaw } from 'vue'
import { loadJSON, saveJSON } from '../lib/storage.js'
import { createSandbox, isSandboxShape, normalizeSandbox } from '../lib/sandbox/model.js'
import { runLine } from '../lib/az/shell.js'
import { labById } from '../data/labs/index.js'
import { useProgressStore, runKey } from './progress.js'
import { usePortalStore } from './portal.js'
import { evaluateLab } from '../lib/labEngine/evaluate.js'
import { createBehavioralRepository } from '../lib/labEngine/persistence.js'
import { createBehavioralSession } from '../lib/labEngine/session.js'
import { applyRunAction } from '../lib/labEngine/actions.js'
import { LabEngineError } from '../lib/labEngine/errors.js'

const behavioralContexts = new WeakMap()
const navigationTickets = new WeakMap()
let attemptSequence = 0
const attemptId = () => `attempt-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++attemptSequence}`}`
const resultId = () => `res-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++attemptSequence}`}`
// Pinia may invoke actions with either its raw store or a reactive/devtools proxy.
// Both must address the same non-serializable session context.
const storeKey = (store) => toRaw(store)
const behavioralContext = (store) => behavioralContexts.get(storeKey(store))
const isBehavioral = (store) => Boolean(behavioralContext(store))

function projectBehavioral(store, snapshot) {
  if (!snapshot) return
  const run = snapshot.run
  store.behavioralRun = run
  store.sandbox = run?.sandbox ?? createSandbox()
  store.scrollback = run?.scrollback ?? []
  store.history = run?.history ?? []
  store.hintsRevealed = run?.hintsRevealed ?? {}
  store.solutionsRevealed = run?.solutionsRevealed ?? {}
  store.elapsedMs = run?.elapsedMs ?? 0
  const committed = run?.completedAt && !snapshot.error && !snapshot.unsaved
  store.completedAt = committed ? run.completedAt : null
  store.resultId = committed ? run.resultId : null
  store.readOnly = snapshot.readOnly
  store.storageError = snapshot.error
  store.unsaved = snapshot.unsaved
}

function deliverBehavioralEffects(store, context, settled, { preserveDiagnostics = false } = {}) {
  if (!settled?.effects || context.suppressEffects || context.generation !== store.generation
    || settled.run?.attemptId !== context.session.snapshot().run?.attemptId) return
  if (!preserveDiagnostics) store.diagnostics = settled.effects.diagnostics ?? []
  const portal = usePortalStore()
  for (const event of settled.effects.portalEvents ?? []) portal.applyEvent(event)
}

const MAX_SCROLLBACK = 600
const MAX_HISTORY = 100
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function freshRun(lab) {
  return {
    labId: lab.id,
    sandbox: lab.seed(createSandbox()),
    scrollback: [],
    history: [],
    hintsRevealed: {},
    solutionsRevealed: {},
    elapsedMs: 0,
    lastTickAt: null,
    completedAt: null,
    resultId: null,
  }
}

export const useLabRunStore = defineStore('labRun', {
  state: () => ({
    labId: null,
    sandbox: createSandbox(),
    scrollback: [],
    history: [],
    hintsRevealed: {},
    solutionsRevealed: {},
    elapsedMs: 0,
    lastTickAt: null,
    completedAt: null,
    resultId: null,
    running: false,
    generation: 0,
    behavioralRun: null,
    loading: false,
    readOnly: false,
    storageError: null,
    unsaved: false,
    diagnostics: [],
    retrying: false,
    completing: false,
  }),
  getters: {
    busy: (s) => s.loading || s.running || s.retrying || s.completing,
    lab(s) {
      const labId = s.labId
      const generation = s.generation
      const context = behavioralContext(this)
      return context?.generation === generation && context.lab.id === labId
        ? context.lab : labId ? labById(labId) : null
    },
    taskStates() {
      if (!this.lab) return []
      if (isBehavioral(this)) return evaluateLab(this.lab, toRaw(this.behavioralRun)).tasks
      const evaluation = evaluateLab(this.lab, { sandbox: this.sandbox })
      return this.lab.tasks.map((t, index) => ({ ...t, index, done: evaluation.tasks[index].done }))
    },
    total() { return this.lab ? this.lab.tasks.length : 0 },
    doneCount() { return this.taskStates.filter((t) => t.done).length },
    currentTaskId() { return this.taskStates.find((t) => !t.done)?.id ?? null },
    isComplete() { return isBehavioral(this) ? Boolean(this.completedAt) : this.total > 0 && this.doneCount === this.total },
    hintsUsed: (s) => Object.values(s.hintsRevealed).reduce((a, b) => a + b, 0),
    solutionsUsed: (s) => Object.keys(s.solutionsRevealed).length,
  },
  actions: {
    load(labId, options = {}) {
      const lab = options.lab ?? labById(labId)
      if (!lab || lab.id !== labId) throw new Error(`Unknown Lab '${labId}'`)
      const previous = behavioralContext(this)
      if (previous) {
        previous.navigating = true
        previous.suppressEffects = true
        this.loading = true
        const ticket = (navigationTickets.get(storeKey(this)) ?? 0) + 1
        navigationTickets.set(storeKey(this), ticket)
        return previous.queue.catch(() => {}).then(() => {
          if (navigationTickets.get(storeKey(this)) !== ticket) return null
          return this._loadNow(labId, options)
        })
      }
      return this._loadNow(labId, options)
    },
    _loadNow(labId, { lab: suppliedLab, repository } = {}) {
      const lab = suppliedLab ?? labById(labId)
      if (!lab || lab.id !== labId) throw new Error(`Unknown Lab '${labId}'`)
      if (lab.engineVersion === 2) {
        const nativeRepository = repository ?? createBehavioralRepository()
        const generation = this.generation + 1
        const session = createBehavioralSession({ lab, repository: nativeRepository,
          reduce: (run, action) => applyRunAction(run, action, lab), createAttemptId: attemptId })
        const context = { lab, repository: nativeRepository, session, generation, queue: Promise.resolve(), pending: 0, foregroundPending: 0,
          queuedDraft: null,
          navigating: false, suppressEffects: false }
        behavioralContexts.set(storeKey(this), context)
        Object.assign(this, { labId, generation, behavioralRun: null, loading: true, running: false,
          readOnly: false, storageError: null, unsaved: false, diagnostics: [], lastTickAt: null,
          completedAt: null, resultId: null, retrying: false, completing: false })
        usePortalStore().resetForLab()
        return session.load().then(async (snapshot) => {
          if (generation !== this.generation) return null
          projectBehavioral(this, snapshot)
          try { await useProgressStore().hydrateNative({ repository: nativeRepository, labs: [lab] }) }
          catch (error) { this.storageError = { code: error?.code ?? 'STORAGE_FAILED', message: error?.message ?? String(error) } }
          return snapshot
        }).catch((error) => {
          if (generation === this.generation) projectBehavioral(this, session.snapshot())
          throw error
        }).finally(() => { if (generation === this.generation) this.loading = false })
      }
      behavioralContexts.delete(storeKey(this))
      Object.assign(this, { behavioralRun: null, loading: false, readOnly: false,
        storageError: null, unsaved: false, diagnostics: [], retrying: false, completing: false })
      const saved = loadJSON(runKey(labId), null)
      const valid = saved && saved.labId === labId && isSandboxShape(saved.sandbox)
      if (valid) {
        Object.assign(this, { ...freshRun(lab), ...saved, sandbox: normalizeSandbox(saved.sandbox), lastTickAt: null }, { running: false, generation: this.generation + 1 })
        usePortalStore().resetForLab()
        this.persist()
      } else {
        this._resetTo(lab)
      }
    },
    // Shared by `load()` (when there is no valid saved run) and `restart()`.
    _resetTo(lab) {
      Object.assign(this, freshRun(lab), { running: false, generation: this.generation + 1 })
      usePortalStore().resetForLab()
      this.persist()
    },
    persist() {
      if (isBehavioral(this)) return behavioralContext(this).queue
      if (!this.labId) return
      const { labId, sandbox, scrollback, history, hintsRevealed, solutionsRevealed, elapsedMs, completedAt, resultId } = this
      saveJSON(runKey(labId), { labId, sandbox, scrollback, history, hintsRevealed, solutionsRevealed, elapsedMs, completedAt, resultId })
    },
    pushLine(line) {
      if (isBehavioral(this)) return
      this.scrollback.push(line)
      if (this.scrollback.length > MAX_SCROLLBACK) this.scrollback.splice(0, this.scrollback.length - MAX_SCROLLBACK)
    },
    async execute(line, { sleep = defaultSleep } = {}) {
      if (isBehavioral(this)) return this.dispatchBehavioral({ type: 'command', line })
      if (this.running) return null
      const generation = this.generation
      this.pushLine({ kind: 'cmd', text: line })
      const trimmed = line.trim()
      let result
      try {
        result = runLine(this.sandbox, line)
      } catch (e) {
        // Defensive: `runLine`/`runAz` already turn `AzError`s into `err` lines and
        // rethrow anything else. This should never fire, but if a command's `run()`
        // throws a plain bug, the shell must not sit silently stuck.
        this.pushLine({ kind: 'err', text: 'ERROR: ' + (e && e.message ? e.message : String(e)) })
        this.running = false
        this.persist()
        return null
      }
      // Ruling T: `clear` is a shell-level meta-command and never enters history.
      // Use the engine's `clear` flag (not a string match on the line) so stray
      // whitespace around `clear` is handled the same way the engine handles it.
      if (trimmed && !result.clear) {
        if (this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed)
        if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY)
      }
      if (result.latencyMs > 0) {
        this.running = true
        try { await sleep(result.latencyMs) } finally {
          if (generation === this.generation) this.running = false
        }
      }
      // Loading or restarting a Lab invalidates commands awaiting simulated latency.
      if (generation !== this.generation) return null
      if (result.clear) {
        this.scrollback = []
      } else {
        // Ruling U: the `ERROR: ` prefix belongs to az-originated errors only.
        // Shell-level errors (unknown command, tokenizer failure) already read
        // as `bash: ...` straight from the engine — leave those verbatim.
        for (const l of result.lines) this.pushLine(l.kind === 'err' && !l.text.startsWith('bash: ') ? { kind: 'err', text: `ERROR: ${l.text}` } : l)
      }
      this.sandbox = result.sandbox
      const portal = usePortalStore()
      for (const e of result.events) portal.applyEvent(e)
      this.checkCompletion()
      this.persist()
      return result
    },
    checkCompletion() {
      if (isBehavioral(this)) return this.completeBehavioral()
      if (this.completedAt || !this.isComplete) return
      this.completedAt = new Date().toISOString()
      const result = {
        id: `res_${Date.now()}`,
        labId: this.labId,
        tasksDone: this.doneCount,
        total: this.total,
        hintsUsed: this.hintsUsed,
        solutionsUsed: this.solutionsUsed,
        durationMs: this.elapsedMs,
        finishedAt: this.completedAt,
      }
      this.resultId = result.id
      useProgressStore().addResult(result)
      const portal = usePortalStore()
      portal.notify('Lab completed', this.lab.title)
      portal.showToast('Lab completed', this.lab.title)
    },
    revealHint(taskId) {
      if (isBehavioral(this)) return this.dispatchBehavioral({ type: 'hint', taskId })
      const task = this.lab?.tasks.find((t) => t.id === taskId)
      if (!task) return
      const n = this.hintsRevealed[taskId] ?? 0
      if (n >= task.hints.length) return
      this.hintsRevealed = { ...this.hintsRevealed, [taskId]: n + 1 }
      this.persist()
    },
    revealSolution(taskId) {
      if (isBehavioral(this)) return this.dispatchBehavioral({ type: 'solution', taskId })
      if (!this.lab?.tasks.some((t) => t.id === taskId)) return
      this.solutionsRevealed = { ...this.solutionsRevealed, [taskId]: true }
      this.persist()
    },
    tick(nowMs = Date.now()) {
      if (isBehavioral(this)) {
        if (this.completedAt || this.readOnly) return
        if (this.lastTickAt !== null) {
          const milliseconds = Math.min(86_400_000, Math.max(0, nowMs - this.lastTickAt))
          if (milliseconds > 0) void this.dispatchBehavioral({ type: 'elapsed', milliseconds }).catch(() => {})
        }
        this.lastTickAt = nowMs
        return
      }
      if (this.completedAt) return
      if (this.lastTickAt !== null) this.elapsedMs += Math.max(0, nowMs - this.lastTickAt)
      this.lastTickAt = nowMs
    },
    pauseTimer() {
      if (isBehavioral(this)) { this.lastTickAt = null; return behavioralContext(this).queue }
      this.lastTickAt = null
      this.persist()
    },
    clearScrollback() {
      if (isBehavioral(this)) return this.dispatchBehavioral({ type: 'command', line: 'clear' })
      this.scrollback = []
      this.persist()
    },
    restart() {
      if (isBehavioral(this)) return this._replaceBehavioral('restart')
      if (!this.lab) return
      this._resetTo(this.lab)
    },
    async _replaceBehavioral(kind) {
      const context = behavioralContext(this)
      if (!context) return null
      context.navigating = true
      context.suppressEffects = true
      this.loading = true
      this.lastTickAt = null
      await context.queue.catch(() => {})
      if (behavioralContext(this) !== context) return null
      const generation = ++this.generation
      context.generation = generation
      try {
        const snapshot = await context.session[kind]()
        if (generation !== this.generation) return null
        projectBehavioral(this, snapshot)
        usePortalStore().resetForLab()
        await useProgressStore().hydrateNative({ repository: context.repository, labs: [context.lab] })
        return snapshot
      } catch (error) {
        if (generation === this.generation) projectBehavioral(this, context.session.snapshot())
        throw error
      } finally {
        if (generation === this.generation) {
          this.loading = false
          context.navigating = false
          context.suppressEffects = false
        }
      }
    },
    reload() { return this._replaceBehavioral('load') },
    recoverRestart() { return this._replaceBehavioral('recoverRestart') },
    exportRun() {
      const session = behavioralContext(this)?.session
      return session ? { run: session.exportRun(), raw: session.exportRaw(), error: this.storageError } : null
    },
    async retrySave() {
      const context = behavioralContext(this)
      if (!context) return null
      if (context.navigating) throw new LabEngineError('NAVIGATING', 'The Lab is changing.')
      const generation = this.generation
      const wasCompleted = Boolean(this.completedAt)
      this.retrying = true
      const operation = context.queue.catch(() => {}).then(async () => {
      try {
        const settled = await context.session.retrySave()
        if (generation !== this.generation) return null
        projectBehavioral(this, settled)
        deliverBehavioralEffects(this, context, settled)
        if (this.completedAt && !wasCompleted) {
          await useProgressStore().hydrateNative({ repository: context.repository, labs: [context.lab] })
          if (generation !== this.generation) return null
          if (!context.suppressEffects) {
            usePortalStore().notify('Lab completed', context.lab.title)
            usePortalStore().showToast('Lab completed', context.lab.title)
          }
        } else if (!this.completedAt && evaluateLab(context.lab, toRaw(this.behavioralRun)).isComplete) {
          await this.completeBehavioral()
        }
        return settled
      } catch (error) {
        if (generation === this.generation) projectBehavioral(this, context.session.snapshot())
        throw error
      }
      })
      context.queue = operation
      try { return await operation } finally { if (generation === this.generation) this.retrying = false }
    },
    async completeBehavioral() {
      const context = behavioralContext(this)
      if (!context || this.completedAt) return null
      const generation = this.generation
      this.completing = true
      try {
        const settled = await context.session.complete({ id: resultId(), finishedAt: new Date().toISOString() })
        if (generation !== this.generation) return null
        projectBehavioral(this, settled)
        await useProgressStore().hydrateNative({ repository: context.repository, labs: [context.lab] })
        if (generation !== this.generation) return null
        if (!context.suppressEffects) {
          usePortalStore().notify('Lab completed', context.lab.title)
          usePortalStore().showToast('Lab completed', context.lab.title)
        }
        return settled
      } catch (error) {
        if (generation === this.generation) projectBehavioral(this, context.session.snapshot())
        throw error
      } finally { if (generation === this.generation) this.completing = false }
    },
    dispatchBehavioral(action) {
      const context = behavioralContext(this)
      if (!context) return Promise.reject(new Error('No behavioral Lab is loaded.'))
      if (context.navigating) return Promise.reject(new LabEngineError('NAVIGATING', 'The Lab is changing.'))
      const generation = this.generation
      const attempt = context.session.snapshot().run?.attemptId
      const foreground = action.type !== 'elapsed' && action.type !== 'draft'
      if (action.type === 'draft' && context.queuedDraft && !context.queuedDraft.started
        && context.queuedDraft.action.path === action.path) {
        const queued = context.queuedDraft
        queued.action = action
        this.unsaved = true
        return new Promise((resolve, reject) => queued.waiters.push({ resolve, reject }))
      }
      const job = { action, started: false, waiters: action.type === 'draft' ? [] : null }
      if (action.type === 'draft') context.queuedDraft = job
      else context.queuedDraft = null
      context.pending++
      if (foreground) { context.foregroundPending++; this.running = true }
      this.unsaved = true
      const operation = context.queue.catch(() => {}).then(async () => {
        job.started = true
        if (context.queuedDraft === job) context.queuedDraft = null
        if (generation !== this.generation || attempt !== context.session.snapshot().run?.attemptId) return null
        try {
          const settled = await context.session.dispatch(job.action)
          if (generation !== this.generation || !settled) return null
          projectBehavioral(this, settled)
          deliverBehavioralEffects(this, context, settled, { preserveDiagnostics: job.action.type === 'elapsed' })
          if (!this.completedAt && evaluateLab(context.lab, toRaw(this.behavioralRun)).isComplete) await this.completeBehavioral()
          return settled
        } catch (error) {
          if (generation === this.generation) projectBehavioral(this, context.session.snapshot())
          throw error
        }
      }).finally(() => {
        context.pending--
        if (foreground) context.foregroundPending--
        if (generation === this.generation) {
          this.running = context.foregroundPending > 0
          this.unsaved = context.pending > 0 || context.session.snapshot().unsaved
        }
      })
      context.queue = operation
      if (job.waiters) {
        const promise = new Promise((resolve, reject) => job.waiters.push({ resolve, reject }))
        operation.then((value) => job.waiters.forEach(({ resolve }) => resolve(value)),
          (error) => job.waiters.forEach(({ reject }) => reject(error)))
        return promise
      }
      return operation
    },
  },
})
