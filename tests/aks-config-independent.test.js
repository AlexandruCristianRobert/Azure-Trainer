import { expect, it } from 'vitest'
import { aksConfigIndependentLab } from '../src/data/labs/aks-journey/config-independent.lab.js'
import { CONFIG_INDEPENDENT_MANIFEST, CONFIG_INDEPENDENT_SOLUTION_FILES } from '../src/data/templates/aks-python/configuration-independent.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { executeAksSolution } from './helpers/aks.js'

const act = (run, action) => applyRunAction(run, action, aksConfigIndependentLab)

it('declares five independent configuration tasks with worked Solutions', () => {
  expect(aksConfigIndependentLab.tasks.map(task => task.id)).toEqual([
    'review-config', 'review-manifests', 'shared-image', 'review-answer', 'primary-intact',
  ])
  expect(aksConfigIndependentLab.manifestId).toBe(CONFIG_INDEPENDENT_MANIFEST.id)
  for (const task of aksConfigIndependentLab.tasks) {
    expect(task.hints).toHaveLength(2)
    expect(task.solution.steps.length).toBeGreaterThan(0)
    expect(task.examNote).toBeTruthy()
  }
})

it('executes every independent configuration Solution in order', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'full-solution' })
  for (const task of aksConfigIndependentLab.tasks) run = executeAksSolution(run, aksConfigIndependentLab, task)
  expect(evaluateLab(aksConfigIndependentLab, run).isComplete).toBe(true)
})

it('keeps primary evidence current after a review-only configuration change', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'two-instances' })
  run = act(run, { type: 'aks-request', scenarioId: 'independent-config-primary' }).run
  const before = run.evidence.currentEvidenceByTask['primary-intact']
  const firstTask = aksConfigIndependentLab.tasks.find(task => task.id === 'review-config')
  run = executeAksSolution(run, aksConfigIndependentLab, firstTask)
  expect(run.evidence.currentEvidenceByTask['primary-intact']).toBe(before)
  expect(evaluateLab(aksConfigIndependentLab, run).tasks.find(task => task.id === 'primary-intact').done).toBe(true)
})

it('accepts equivalent Secret data syntax and key ordering', () => {
  const files = { ...CONFIG_INDEPENDENT_SOLUTION_FILES,
    'k8s/review-secret.yaml': `apiVersion: v1\nkind: Secret\nmetadata:\n  namespace: review\n  name: review-credentials\ntype: Opaque\ndata:\n  PGPASSWORD: cmV2aWV3LW9ubHktcGFzc3dvcmQ=\n`,
  }
  expect(CONFIG_INDEPENDENT_MANIFEST.kubernetesFiles).toContain('k8s/review-secret.yaml')
  expect(files['k8s/review-configmap.yaml']).toContain('Review assistant')
})

it('does not complete when review credentials are missing or copied from primary settings', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'credentials' })
  run = executeAksSolution(run, aksConfigIndependentLab, aksConfigIndependentLab.tasks.find(task => task.id === 'review-config'))
  const withoutSecret = { ...run.project.savedFiles, 'k8s/review-secret.yaml': run.project.savedFiles['k8s/review-secret.yaml'].replace('PGPASSWORD: review-only-password', '') }
  run = act(run, { type: 'save-file', path: 'k8s/review-secret.yaml', text: withoutSecret['k8s/review-secret.yaml'] }).run
  expect(evaluateLab(aksConfigIndependentLab, run).tasks.find(task => task.id === 'review-config').done).toBe(false)
})

it('rejects a review Service that leaks to the primary workload label', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'service-leak' })
  run = executeAksSolution(run, aksConfigIndependentLab, aksConfigIndependentLab.tasks.find(task => task.id === 'review-config'))
  const bad = run.project.savedFiles['k8s/review-service.yaml'].replace('app: review-assistant', 'app: assistant')
  run = act(run, { type: 'save-file', path: 'k8s/review-service.yaml', text: bad }).run
  expect(evaluateLab(aksConfigIndependentLab, run).tasks.find(task => task.id === 'review-manifests').done).toBe(false)
})

it('requires a fresh primary verification after its configuration is changed and restored', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'restore-primary' })
  run = act(run, { type: 'aks-request', scenarioId: 'independent-config-primary' }).run
  const primary = run.project.savedFiles['k8s/primary-configmap.yaml']
  run = act(run, { type: 'save-file', path: 'k8s/primary-configmap.yaml', text: `${primary}\n# changed` }).run
  run = act(run, { type: 'save-file', path: 'k8s/primary-configmap.yaml', text: primary }).run
  expect(evaluateLab(aksConfigIndependentLab, run).tasks.find(task => task.id === 'primary-intact').done).toBe(false)
})
