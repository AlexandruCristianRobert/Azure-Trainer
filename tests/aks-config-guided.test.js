import { expect, it } from 'vitest'
import { aksConfigGuidedLab } from '../src/data/labs/aks-journey/config-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { executeAksSolution } from './helpers/aks.js'
import { act } from './helpers/aks.js'

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
  expect(evaluateLab(aksConfigGuidedLab, run).tasks.slice(0, 5).map(task => [task.id, task.done])).toEqual([['python-settings', true], ['image', true], ['objects', true], ['references', true], ['baseline', true]])
})

it('requires the stale environment observation even when later configuration is correct', () => {
  let run = createBehavioralRun(aksConfigGuidedLab, { attemptId: 'skip-observation' })
  for (const task of aksConfigGuidedLab.tasks.filter(task => task.id !== 'stale-env')) run = executeAksSolution(run, aksConfigGuidedLab, task)
  expect(evaluateLab(aksConfigGuidedLab, run).isComplete).toBe(false)
})

it('executes every guided configuration Solution in sequence', () => {
  let run = createBehavioralRun(aksConfigGuidedLab, { attemptId: 'full-solution' })
  for (const task of aksConfigGuidedLab.tasks) run = executeAksSolution(run, aksConfigGuidedLab, task)
  expect(evaluateLab(aksConfigGuidedLab, run).tasks.map(task => [task.id, task.done])).toEqual(aksConfigGuidedLab.tasks.map(task => [task.id, true]))
})

it('does not accept a seeded artifact, saved objects without apply, or a hardcoded settings lookup', () => {
  let run = createBehavioralRun(aksConfigGuidedLab, { attemptId: 'negatives' })
  let state = evaluateLab(aksConfigGuidedLab, run)
  expect(state.tasks.find(task => task.id === 'image').done).toBe(false)
  expect(state.tasks.find(task => task.id === 'objects').done).toBe(false)
  const hardcoded = aksConfigGuidedLab.solutionFiles['app.py'].replace('os.environ.get("PGHOST", "")', '"pg-training.example"')
  run = act(run, aksConfigGuidedLab, { type: 'save-file', path: 'app.py', text: hardcoded }).run
  expect(evaluateLab(aksConfigGuidedLab, run).tasks.find(task => task.id === 'python-settings').done).toBe(false)
  run = act(run, aksConfigGuidedLab, { type: 'save-file', path: 'k8s/configmap.yaml', text: `${aksConfigGuidedLab.solutionFiles['k8s/configmap.yaml']}\n` }).run
  expect(evaluateLab(aksConfigGuidedLab, run).tasks.find(task => task.id === 'objects').done).toBe(false)
})
