import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '../lib/storage.js'
import { createSandbox, isSandboxShape } from '../lib/sandbox/model.js'
import { runLine } from '../lib/az/shell.js'
import { labById } from '../data/labs/index.js'
import { useProgressStore, runKey } from './progress.js'
import { usePortalStore } from './portal.js'

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
  }),
  getters: {
    lab: (s) => (s.labId ? labById(s.labId) : null),
    taskStates() {
      if (!this.lab) return []
      return this.lab.tasks.map((t, index) => ({ ...t, index, done: t.check(this.sandbox) }))
    },
    total() { return this.lab ? this.lab.tasks.length : 0 },
    doneCount() { return this.taskStates.filter((t) => t.done).length },
    currentTaskId() { return this.taskStates.find((t) => !t.done)?.id ?? null },
    isComplete() { return this.total > 0 && this.doneCount === this.total },
    hintsUsed: (s) => Object.values(s.hintsRevealed).reduce((a, b) => a + b, 0),
    solutionsUsed: (s) => Object.keys(s.solutionsRevealed).length,
  },
  actions: {
    load(labId) {
      const saved = loadJSON(runKey(labId), null)
      const lab = labById(labId)
      if (!lab) throw new Error(`Unknown Lab '${labId}'`)
      const valid = saved && saved.labId === labId && isSandboxShape(saved.sandbox)
      const data = valid ? { ...freshRun(lab), ...saved, lastTickAt: null } : freshRun(lab)
      Object.assign(this, data, { running: false })
      usePortalStore().resetForLab()
      this.persist()
    },
    start(labId) {
      const lab = labById(labId)
      if (!lab) throw new Error(`Unknown Lab '${labId}'`)
      Object.assign(this, freshRun(lab), { running: false })
      usePortalStore().resetForLab()
      this.persist()
    },
    persist() {
      if (!this.labId) return
      const { labId, sandbox, scrollback, history, hintsRevealed, solutionsRevealed, elapsedMs, completedAt, resultId } = this
      saveJSON(runKey(labId), { labId, sandbox, scrollback, history, hintsRevealed, solutionsRevealed, elapsedMs, completedAt, resultId })
    },
    pushLine(line) {
      this.scrollback.push(line)
      if (this.scrollback.length > MAX_SCROLLBACK) this.scrollback.splice(0, this.scrollback.length - MAX_SCROLLBACK)
    },
    async execute(line, { sleep = defaultSleep } = {}) {
      if (this.running) return null
      this.pushLine({ kind: 'cmd', text: line })
      const trimmed = line.trim()
      const result = runLine(this.sandbox, line)
      // Ruling T: `clear` is a shell-level meta-command and never enters history.
      // Use the engine's `clear` flag (not a string match on the line) so stray
      // whitespace around `clear` is handled the same way the engine handles it.
      if (trimmed && !result.clear) {
        if (this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed)
        if (this.history.length > MAX_HISTORY) this.history.splice(0, this.history.length - MAX_HISTORY)
      }
      if (result.latencyMs > 0) {
        this.running = true
        try { await sleep(result.latencyMs) } finally { this.running = false }
      }
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
      const task = this.lab?.tasks.find((t) => t.id === taskId)
      if (!task) return
      const n = this.hintsRevealed[taskId] ?? 0
      if (n >= task.hints.length) return
      this.hintsRevealed = { ...this.hintsRevealed, [taskId]: n + 1 }
      this.persist()
    },
    revealSolution(taskId) {
      if (!this.lab?.tasks.some((t) => t.id === taskId)) return
      this.solutionsRevealed = { ...this.solutionsRevealed, [taskId]: true }
      this.persist()
    },
    tick(nowMs = Date.now()) {
      if (this.completedAt) return
      if (this.lastTickAt !== null) this.elapsedMs += Math.max(0, nowMs - this.lastTickAt)
      this.lastTickAt = nowMs
    },
    pauseTimer() {
      this.lastTickAt = null
      this.persist()
    },
    clearScrollback() {
      this.scrollback = []
      this.persist()
    },
    restart() {
      if (!this.lab) return
      Object.assign(this, freshRun(this.lab), { running: false })
      usePortalStore().resetForLab()
      this.persist()
    },
  },
})
