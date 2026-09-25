import { expect, it } from 'vitest'
import { aksConfigGuidedLab } from '../src/data/labs/aks-journey/config-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { executeAksSolution } from './helpers/aks.js'

it('declares nine guided configuration tasks with complete worked Solutions', () => {
  expect(aksConfigGuidedLab.tasks.map(task => task.id)).toEqual(['python-settings', 'image', 'objects', 'references', 'baseline', 'stale-env', 'env-refresh', 'mounted-before', 'mounted-after'])
  for (const task of aksConfigGuidedLab.tasks) {
    expect(task.hints).toHaveLength(2)
    expect(task.solution.steps.length).toBeGreaterThan(0)
    expect(task.examNote).toBeTruthy()
  }
})

it('executes the guided source, build, configuration object and baseline verification path', () => {
  let run = createBehavioralRun(aksConfigGuidedLab, { attemptId: 'config-guided' })
  for (const task of aksConfigGuidedLab.tasks.slice(0, 5)) run = executeAksSolution(run, aksConfigGuidedLab, task)
  expect(evaluateLab(aksConfigGuidedLab, run).tasks.slice(0, 5).every(task => task.done)).toBe(true)
})
