import { expect, it } from 'vitest'
import { aksConfigIndependentLab } from '../src/data/labs/aks-journey/config-independent.lab.js'
import { CONFIG_INDEPENDENT_MANIFEST, CONFIG_INDEPENDENT_SOLUTION_FILES } from '../src/data/templates/aks-python/configuration-independent.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { executeAksSolution } from './helpers/aks.js'
import { labById, nextLabFor } from '../src/data/labs/index.js'

const act = (run, action) => applyRunAction(run, action, aksConfigIndependentLab)

it('routes the configuration topic in order and ends at the current catalog boundary', () => {
  expect(nextLabFor(labById('aks-config-guided'))?.id).toBe('aks-config-troubleshooting')
  expect(nextLabFor(labById('aks-config-troubleshooting'))?.id).toBe('aks-config-independent')
  expect(nextLabFor(aksConfigIndependentLab)).toBeNull()
})

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

it('keeps immutable fixture metadata out of mutable Kubernetes runtime state', () => {
  const run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'immutable-fixture' })
  expect(run.runtime.kubernetes.configurationIndependent).toBeUndefined()
  const shared = Object.values(run.artifacts.buildsById).filter(build => build.image.tag === 'shared')
  expect(shared).toHaveLength(1)
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

it('accepts an equivalent base64 Secret after saving and applying it', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'secret-data' })
  run = executeAksSolution(run, aksConfigIndependentLab, aksConfigIndependentLab.tasks.find(task => task.id === 'review-config'))
  const secret = `apiVersion: v1\nkind: Secret\nmetadata:\n  namespace: review\n  name: review-credentials\ntype: Opaque\ndata:\n  PGPASSWORD: cmV2aWV3LW9ubHktcGFzc3dvcmQ=\n`
  run = act(run, { type: 'save-file', path: 'k8s/review-secret.yaml', text: secret }).run
  for (const path of ['k8s/review-namespace.yaml', 'k8s/review-configmap.yaml', 'k8s/review-secret.yaml']) run = act(run, { type: 'command', line: `kubectl apply -f ${path}` }).run
  expect(run.runtime.kubernetes.clusters[Object.keys(run.runtime.kubernetes.clusters)[0]].resources['Secret/review/review-credentials'].data.PGPASSWORD).toBe('cmV2aWV3LW9ubHktcGFzc3dvcmQ=')
  expect(evaluateLab(aksConfigIndependentLab, run).tasks.find(task => task.id === 'review-config').done).toBe(true)
})

it('does not complete when review credentials are missing or copied from primary settings', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'credentials' })
  run = executeAksSolution(run, aksConfigIndependentLab, aksConfigIndependentLab.tasks.find(task => task.id === 'review-config'))
  const withoutSecret = { ...run.project.savedFiles, 'k8s/review-secret.yaml': run.project.savedFiles['k8s/review-secret.yaml'].replace('PGPASSWORD: review-only-password', '') }
  run = act(run, { type: 'save-file', path: 'k8s/review-secret.yaml', text: withoutSecret['k8s/review-secret.yaml'] }).run
  expect(evaluateLab(aksConfigIndependentLab, run).tasks.find(task => task.id === 'review-config').done).toBe(false)
})

it('rejects primary credentials in the review Secret', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'wrong-credentials' })
  run = executeAksSolution(run, aksConfigIndependentLab, aksConfigIndependentLab.tasks.find(task => task.id === 'review-config'))
  const wrong = run.project.savedFiles['k8s/review-secret.yaml'].replace('review-only-password', 'training-only-password')
  run = act(run, { type: 'save-file', path: 'k8s/review-secret.yaml', text: wrong }).run
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

it('does not allow a copied primary response to prove the review instance', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'copied-proof' })
  run = act(run, { type: 'aks-request', scenarioId: 'independent-config-primary' }).run
  for (const task of aksConfigIndependentLab.tasks.slice(0, 3)) run = executeAksSolution(run, aksConfigIndependentLab, task)
  expect(evaluateLab(aksConfigIndependentLab, run).tasks.find(task => task.id === 'review-answer').done).toBe(false)
})

it('rejects a newly built shared tag because review Pods must reuse the seeded artifact', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'rebuilt-tag' })
  for (const task of aksConfigIndependentLab.tasks.slice(0, 2)) run = executeAksSolution(run, aksConfigIndependentLab, task)
  run = act(run, { type: 'command', line: 'az acr build -r acraksconfigindependent -t assistant:shared .' }).run
  run = executeAksSolution(run, aksConfigIndependentLab, aksConfigIndependentLab.tasks.find(task => task.id === 'shared-image'))
  expect(evaluateLab(aksConfigIndependentLab, run).tasks.find(task => task.id === 'shared-image').done).toBe(false)
})

it('does not complete if Python hardcodes a copied assistant answer', () => {
  let run = createBehavioralRun(aksConfigIndependentLab, { attemptId: 'hardcoded-answer' })
  const hardcoded = run.project.savedFiles['app.py'].replace('return training_runtime.answer(question, settings())', 'return {"answer": "Training backups are kept for 30 days."}')
  run = act(run, { type: 'save-file', path: 'app.py', text: hardcoded }).run
  expect(evaluateLab(aksConfigIndependentLab, run).isComplete).toBe(false)
})
