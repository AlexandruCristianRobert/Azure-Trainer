import { beforeAll, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { executeAksCapstoneSolution, seedAksProductionAt } from './helpers/aks.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { aksCapstoneLab } from '../src/data/labs/aks-journey/capstone.lab.js'
import { labById, LABS } from '../src/data/labs/index.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { encodeRunExport } from '../src/lib/labEngine/export.js'
import { aksCleanupReady, inspectAksCleanup } from '../src/lib/kubernetes/capstone/cleanup.js'
import { useLabRunStore } from '../src/stores/labRun.js'

describe('AKS capstone delivery', () => {
  let completed, beforeFinalSeal, boundaries, experimentBoundaries
  beforeAll(() => {
    boundaries = []
    experimentBoundaries = []
    let run = createBehavioralRun(aksCapstoneLab, { attemptId: 'aks-capstone-complete' })
    run = applyRunAction(run, { type: 'hint', taskId: 'source-contract' }, aksCapstoneLab).run
    run = applyRunAction(run, { type: 'elapsed', milliseconds: 125000 }, aksCapstoneLab).run
    completed = executeAksCapstoneSolution(run, aksCapstoneLab, {
      onBeforeSeal(current) { beforeFinalSeal = structuredClone(current) },
      onSeal(current) { boundaries.push(validateBehavioralRun(JSON.parse(JSON.stringify(current)), aksCapstoneLab)) },
      onExperiment(current, action) {
        expect(validateBehavioralRun(JSON.parse(JSON.stringify(current)), aksCapstoneLab)).toEqual(current)
        experimentBoundaries.push(action.type)
      },
    })
  }, 600000)

  it('completes all 31 real Tasks and eight sealed checkpoints from empty ownership', () => {
    expect(aksCapstoneLab.status).toBe('available')
    expect(labById(aksCapstoneLab.id)).toBe(aksCapstoneLab)
    expect(LABS.at(-1)).toBe(aksCapstoneLab)
    expect(evaluateLab(aksCapstoneLab, completed)).toMatchObject({ total: 31, doneCount: 31, isComplete: true })
    expect(completed.stages.sealedStages).toHaveLength(8)
    expect(boundaries).toHaveLength(8)
    expect(boundaries.map(run => run.stages.sealedStages.length)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(experimentBoundaries).toEqual(expect.arrayContaining(['aks-probe-start', 'aks-resource-start', 'aks-release-start', 'aks-release-finish', 'aks-capstone-incident']))
    expect(aksCleanupReady(completed, aksCapstoneLab)).toBe(true)
    expect(inspectAksCleanup(completed, aksCapstoneLab)).toMatchObject({ protectedIntact: true, remaining: [] })
  })

  it('round-trips native export and rejects malformed or forged recovery payloads', () => {
    const exported = JSON.parse(encodeRunExport({ run: JSON.parse(JSON.stringify(completed)), raw: null, error: null })).run
    expect(validateBehavioralRun(exported, aksCapstoneLab)).toEqual(completed)
    expect(() => validateBehavioralRun({ ...exported, stages: null }, aksCapstoneLab)).toThrow()
    const forged = structuredClone(exported)
    forged.stages.sealedStages[0].stageId = 'forged'
    expect(() => validateBehavioralRun(forged, aksCapstoneLab)).toThrow()
    expect(completed.hintsRevealed['source-contract']).toBe(1)
    expect(completed.elapsedMs).toBe(125000)
  })

  it('auto-commits one Result, reloads completed read-only run and retains assistance', async () => {
    setActivePinia(createPinia())
    const repository = behavioralRepository()
    await repository.saveRun(beforeFinalSeal, { expectedRevision: 0 })
    const store = useLabRunStore()
    await store.load(aksCapstoneLab.id, { repository })
    expect(store.isComplete).toBe(false)
    await store.dispatchBehavioral({ type: 'aks-advance-stage' })
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    expect(repository.results[0]).toMatchObject({ labId: aksCapstoneLab.id, total: 31, hintsUsed: 1 })
    const exported = JSON.parse(encodeRunExport(store.exportRun()))
    expect(validateBehavioralRun(exported.run, aksCapstoneLab)).toEqual(store.behavioralRun)
    await store.reload()
    expect(store.isComplete).toBe(true)
    await expect(store.dispatchBehavioral({ type: 'aks-advance-stage' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    const transferred = behavioralRepository()
    await transferred.completeRun({ ...exported.run, revision: 0 }, repository.results[0], { expectedRevision: 0 })
    setActivePinia(createPinia())
    const restored = useLabRunStore()
    await restored.load(aksCapstoneLab.id, { repository: transferred })
    expect(restored.isComplete).toBe(true)
    expect(restored.behavioralRun.elapsedMs).toBe(125000)
    expect(transferred.results).toHaveLength(1)
  })
})

it('accepts alternative v1 tags, create-time ACR attachment and numeric Service targetPorts through deployment', () => {
  const { lab, run: provision } = seedAksProductionAt('provision')
  let run = provision
  const act = action => {
    if (action.type === 'command') action.line = action.line.replaceAll('capstone-v1', 'learner-v1')
    if (action.type === 'save-file') action.text = action.text.replaceAll('capstone-v1', 'learner-v1')
    const result = applyRunAction(run, action, lab)
    expect(result.diagnostics).toEqual([])
    expect(result.lines.filter(line => line.kind === 'err')).toEqual([])
    run = result.run
  }
  const stepAction = step => step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content }
    : step.kind === 'command' ? { type: 'command', line: step.line } : step.action
  for (const id of ['registry-created', 'image-v1'])
    for (const step of lab.tasks.find(task => task.id === id).solution.steps) act(stepAction(step))
  act({ type: 'command', line: 'az aks create -g rg-aks-capstone -n aks-capstone --node-count 2 --node-vm-size Standard_D2s_v5 --enable-managed-identity --generate-ssh-keys --attach-acr acrakscapstone' })
  act({ type: 'command', line: 'az aks get-credentials -g rg-aks-capstone -n aks-capstone' })
  for (const id of lab.stages[1].taskIds) act({ type: 'aks-request', scenarioId: `capstone-${id}` })
  act({ type: 'aks-advance-stage' })
  for (const id of lab.stages[2].taskIds)
    for (const step of lab.tasks.find(task => task.id === id).solution.steps) {
      const action = stepAction(step)
      if (action.type === 'save-file' && action.path.startsWith('k8s/service-'))
        action.text = action.text.replace('targetPort: http', 'targetPort: 8080')
      act(action)
    }
  for (const id of lab.stages[2].taskIds) act({ type: 'aks-request', scenarioId: `capstone-${id}` })
  act({ type: 'aks-advance-stage' })
  expect(run.stages.activeStageId).toBe('behavior')
  expect(run.stages.sealedStages).toHaveLength(3)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toEqual(run)
}, 60000)
