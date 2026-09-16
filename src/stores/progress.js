import { defineStore } from 'pinia'
import { loadJSON, saveJSON, removeJSON } from '../lib/storage.js'
import { LABS, labById } from '../data/labs/index.js'

export const RESULTS_KEY = 'at_results'
export const runKey = (labId) => `at_run_${labId}`

export const useProgressStore = defineStore('progress', {
  state: () => ({ results: loadJSON(RESULTS_KEY, []) }),
  getters: {
    resultsForLab: (s) => (labId) => s.results.filter((r) => r.labId === labId),
    latestResult: (s) => (labId) => {
      const list = s.results.filter((r) => r.labId === labId)
      return list.length ? list[list.length - 1] : null
    },
  },
  actions: {
    addResult(result) {
      this.results.push(result)
      saveJSON(RESULTS_KEY, this.results)
    },
    // Reads the persisted run (if any) and derives the Task count from the Lab definition.
    runSummary(labId) {
      const run = loadJSON(runKey(labId), null)
      const lab = labById(labId)
      if (!run || run.labId !== labId || !Array.isArray(run.sandbox?.resourceGroups) || !lab) return null
      const tasksDone = lab.tasks.filter((t) => t.check(run.sandbox)).length
      return { tasksDone, total: lab.tasks.length, completedAt: run.completedAt ?? null }
    },
    labStatus(labId) {
      const run = this.runSummary(labId)
      if (run && !run.completedAt) return 'in-progress'
      if (run?.completedAt || this.results.some((r) => r.labId === labId)) return 'completed'
      return 'not-started'
    },
    skillAreaProgress(skillAreaId) {
      const labs = LABS.filter((l) => l.skillAreaId === skillAreaId)
      const statuses = labs.map((l) => this.labStatus(l.id))
      return { total: labs.length, completed: statuses.filter((s) => s === 'completed').length, inProgress: statuses.filter((s) => s === 'in-progress').length }
    },
    resetAll() {
      this.results = []
      removeJSON(RESULTS_KEY)
      for (const l of LABS) removeJSON(runKey(l.id))
    },
  },
})
