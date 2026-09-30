import { defineStore } from 'pinia'
import { loadJSON, saveJSON } from '../lib/storage.js'
import { isSandboxShape } from '../lib/sandbox/model.js'
import { LABS, labById } from '../data/labs/index.js'
import { evaluateLab } from '../lib/labEngine/evaluate.js'
import { createBehavioralRepository } from '../lib/labEngine/persistence.js'
import { validateBehavioralRun } from '../lib/labEngine/run.js'

const mergeResults = (legacy, native) => {
  const byId = new Map()
  for (const result of [...legacy, ...native]) if (result && typeof result.id === 'string') byId.set(result.id, result)
  return [...byId.values()]
}

export const RESULTS_KEY = 'at_results'
export const runKey = (labId) => `at_run_${labId}`

export const useProgressStore = defineStore('progress', {
  state: () => ({ results: loadJSON(RESULTS_KEY, []), nativeResults: [], nativeRuns: {},
    nativeLabs: {}, nativeLoading: false, nativeReady: false, nativeError: null }),
  getters: {
    allResults: (s) => mergeResults(s.results, s.nativeResults),
    latestResult: (s) => (labId) => {
      const list = mergeResults(s.results, s.nativeResults).filter((r) => r.labId === labId)
      return list.reduce((latest, result) => {
        if (!latest) return result
        const previousTime = Date.parse(latest.finishedAt)
        const nextTime = Date.parse(result.finishedAt)
        return (Number.isFinite(nextTime) ? nextTime : -Infinity)
          >= (Number.isFinite(previousTime) ? previousTime : -Infinity) ? result : latest
      }, null)
    },
  },
  actions: {
    async hydrateNative({ repository = createBehavioralRepository(), labs = LABS.filter((lab) => lab.engineVersion === 2) } = {}) {
      this.nativeLoading = true
      this.nativeError = null
      for (const lab of labs) this.nativeLabs[lab.id] = lab
      try {
        const [runs, results] = await Promise.all([repository.listRuns(), repository.listResults()])
        const nextRuns = { ...this.nativeRuns }
        for (const lab of labs) {
          const raw = runs.find((run) => run?.labId === lab.id)
          if (raw) {
            validateBehavioralRun(raw, lab)
            const { doneCount, total } = evaluateLab(lab, raw)
            nextRuns[lab.id] = { tasksDone: doneCount, total,
              completedAt: raw.completedAt ?? null }
          } else delete nextRuns[lab.id]
        }
        this.nativeRuns = nextRuns
        this.nativeResults = mergeResults(this.nativeResults, results)
        this.nativeReady = true
      } catch (error) {
        this.nativeError = { code: error?.code ?? 'STORAGE_FAILED', message: error?.message ?? String(error) }
        throw error
      } finally {
        this.nativeLoading = false
      }
    },
    addResult(result) {
      this.results.push(result)
      saveJSON(RESULTS_KEY, this.results)
    },
    // Reads the persisted run (if any) and derives the Task count from the Lab definition.
    runSummary(labId) {
      if (this.nativeLabs[labId] || labById(labId)?.engineVersion === 2) return this.nativeRuns[labId] ?? null
      const run = loadJSON(runKey(labId), null)
      const lab = labById(labId)
      if (!run || run.labId !== labId || !isSandboxShape(run.sandbox) || !lab) return null
      const { doneCount, total } = evaluateLab(lab, { sandbox: run.sandbox })
      return { tasksDone: doneCount, total, completedAt: run.completedAt ?? null }
    },
    labStatus(labId) {
      if (this.nativeLabs[labId] || labById(labId)?.engineVersion === 2) {
        if (this.nativeLoading) return 'loading'
        if (this.nativeError) return 'error'
        if (!this.nativeReady) return 'loading'
      }
      const run = this.runSummary(labId)
      if (run && !run.completedAt) return 'in-progress'
      if (run?.completedAt || this.allResults.some((r) => r.labId === labId)) return 'completed'
      return 'not-started'
    },
    skillAreaProgress(skillAreaId) {
      const labs = LABS.filter((l) => l.skillAreaId === skillAreaId)
      const statuses = labs.map((l) => this.labStatus(l.id))
      return { total: labs.length, completed: statuses.filter((s) => s === 'completed').length, inProgress: statuses.filter((s) => s === 'in-progress').length }
    },
  },
})
