import { describe, it, expect } from 'vitest'
import { LABS, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'

const modulePath = '../src/data/labs/security-journey/index.js'
const loaded = await import(/* @vite-ignore */ modulePath).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}
  throw error
})
const labs = loaded.SECURITY_OBSERVABILITY_LABS ?? []
describe('Security and Observability catalog', () => {
  it('registers exactly twelve labs once and advances only within the journey', () => {
    expect(labs).toHaveLength(12)
    expect(new Set(labs.map(lab => lab.id)).size).toBe(12)
    expect(LABS.filter(lab => lab.journeyId === 'security-observability')).toEqual(labs)
    expect(labs.map(lab => lab.journeyOrder)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12])
    labs.forEach((lab, index) => {
      expect(nextLabFor(lab)).toBe(labs[index + 1] ?? null)
      expect(lab.skillAreaId).toBe('secure')
      expect(lab.labMode).toBe(index === 11 ? 'capstone' : 'guided')
    })
    expect(labs[11].id).toBe('security-observability-capstone')
  })
  it('exposes independently runnable unfinished tasks throughout the journey', () => {
    expect(labs).toHaveLength(12)
    for (const lab of labs) {
      const run = createBehavioralRun(lab, { attemptId: lab.id })
      expect(evaluateLab(lab, run).tasks.every(task => !task.done)).toBe(true)
      expect(run.runtime.messaging.executionReceipts).toEqual([])
      expect(lab.tasks.every(task => task.rationale && task.solution.steps.length)).toBe(true)
    }
  })
})
