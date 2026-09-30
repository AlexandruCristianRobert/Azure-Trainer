import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { cpuGuidedLab } from '../src/data/labs/containerapps-journey/cpu-guided.lab.js'
import { LABS, nextLabFor, labById } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

function act(run, action) {
  const result = applyRunAction(run, action, cpuGuidedLab)
  expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(action)).toEqual([])
  expect(result.diagnostics, JSON.stringify(action)).toEqual([])
  return result.run
}

function steps(run, task) {
  return task.solution.steps.reduce((next, step) => step.kind === 'command'
    ? act(next, { type: 'command', line: step.line })
    : act(next, step.action), run)
}

function state(run, id) { return evaluateLab(cpuGuidedLab, run).tasks.find((task) => task.id === id) }

describe('guided CPU scaling Lab', () => {
  it('starts from a healthy private API with no pre-earned evidence and routes after deployment', () => {
    const run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-seed' })
    const app = run.sandbox.containerApps[0]
    expect(cpuGuidedLab).toMatchObject({ engineVersion: 2, contentVersion: 1, labMode: 'guided', journeyOrder: 4 })
    expect(app).toMatchObject({ name: 'api-cpu', resourceGroup: 'rg-aca-cpu', cpu: 0.5, memory: '1Gi', minReplicas: 1, maxReplicas: 1, scaleRules: [] })
    expect(Object.values(run.runtime.deploymentsByApp)[0]).toMatchObject({ status: 'succeeded', active: { ingress: 'external', targetPort: 8080 } })
    expect(Object.values(run.runtime.cpuByApp)[0].readyReplicas).toBe(1)
    expect(run.evidence.experimentsById).toEqual({})
    expect(run.hintsRevealed).toEqual({})
    expect(run.solutionsRevealed).toEqual({})
    expect(LABS.filter((lab) => lab.skillAreaId === 'containers')).toHaveLength(17)
    expect(nextLabFor(LABS.find((lab) => lab.id === 'aca-deploy-independent'))).toBe(cpuGuidedLab)
    expect(nextLabFor(cpuGuidedLab)).toBe(labById('aca-cpu-troubleshooting'))
  })

  it('completes each worked scenario with measured evidence and current policy', () => {
    let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-worked' })
    for (const task of cpuGuidedLab.tasks) {
      expect(task.hints).toHaveLength(2)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      expect(task.examNote).toBeTruthy()
      run = steps(run, task)
      expect(state(run, task.id).done, task.id).toBe(true)
    }
    expect(evaluateLab(cpuGuidedLab, run).isComplete).toBe(true)
    expect(Object.values(run.evidence.experimentsById)).toHaveLength(4)
    expect(Object.values(run.evidence.experimentsById).map((record) => record.outcome)).toEqual(['passed', 'passed', 'passed', 'passed'])
  })

  it('rejects wrong policy, partial scenarios and quiet without prior scale-out', () => {
    let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-negative' })
    run = act(run, { type: 'scenario-start', scenarioId: 'baseline' })
    run = act(run, { type: 'simulation-advance', seconds: 15 })
    expect(state(run, 'baseline').done).toBe(false)
    run = act(run, { type: 'scenario-cancel' })
    expect(state(run, 'baseline').done).toBe(false)
    run = steps(run, cpuGuidedLab.tasks.find((task) => task.id === 'quiet'))
    expect(state(run, 'quiet').done).toBe(false)
    run = steps(run, cpuGuidedLab.tasks.find((task) => task.id === 'baseline'))
    expect(state(run, 'baseline').done).toBe(false)
  })

  it('keeps earlier evidence across workload transitions and requires rerun after policy change', () => {
    let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-invalidate' })
    run = steps(run, cpuGuidedLab.tasks[0])
    run = steps(run, cpuGuidedLab.tasks[1])
    run = steps(run, cpuGuidedLab.tasks[2])
    expect(state(run, 'baseline').done).toBe(true)
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-cpu -n api-cpu --max-replicas 4' })
    expect(state(run, 'baseline').done).toBe(false)
    expect(state(run, 'sustained').done).toBe(false)
  })

  it('requires all successful load proofs before quiet and repeats quiet after later load runs', () => {
    let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-quiet-order' })
    run = steps(run, cpuGuidedLab.tasks[0])
    run = steps(run, cpuGuidedLab.tasks[2])
    run = steps(run, cpuGuidedLab.tasks[4])
    expect(Object.values(run.evidence.experimentsById).at(-1).outcome).toBe('passed')
    expect(state(run, 'quiet').done).toBe(false)
    run = steps(run, cpuGuidedLab.tasks[1])
    run = steps(run, cpuGuidedLab.tasks[3])
    expect(state(run, 'quiet').done).toBe(false)
    expect(evaluateLab(cpuGuidedLab, run).isComplete).toBe(false)
    run = steps(run, cpuGuidedLab.tasks[4])
    expect(evaluateLab(cpuGuidedLab, run).isComplete).toBe(true)
    run = steps(run, cpuGuidedLab.tasks[2])
    expect(state(run, 'quiet').done).toBe(false)
    run = steps(run, cpuGuidedLab.tasks[4])
    expect(evaluateLab(cpuGuidedLab, run).isComplete).toBe(true)
  })

  it('does not accept cancelled or partial load work as quiet prerequisites', () => {
    let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-quiet-partial' })
    run = steps(run, cpuGuidedLab.tasks[0])
    run = act(run, { type: 'scenario-start', scenarioId: 'sustained' })
    run = act(run, { type: 'simulation-advance', seconds: 45 })
    expect(state(run, 'sustained').done).toBe(false)
    run = act(run, { type: 'scenario-cancel' })
    run = steps(run, cpuGuidedLab.tasks[4])
    expect(state(run, 'quiet').done).toBe(false)
  })

  it('does not accept a failed latest baseline as a quiet prerequisite', () => {
    let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-quiet-failed' })
    run = steps(run, cpuGuidedLab.tasks[0])
    run = steps(run, cpuGuidedLab.tasks[2])
    run = steps(run, cpuGuidedLab.tasks[3])
    run = steps(run, cpuGuidedLab.tasks[1])
    expect(Object.values(run.evidence.experimentsById).at(-1).outcome).toBe('failed')
    run = steps(run, cpuGuidedLab.tasks[4])
    expect(Object.values(run.evidence.experimentsById).at(-1).outcome).toBe('passed')
    expect(state(run, 'quiet').done).toBe(false)
  })

  it('does not use passed load proofs from before an away-and-back policy change for Quiet', () => {
    let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-stale-quiet' })
    for (const task of cpuGuidedLab.tasks.slice(0, 4)) run = steps(run, task)
    expect(state(run, 'baseline').done && state(run, 'sustained').done && state(run, 'overload').done).toBe(true)
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-cpu -n api-cpu --max-replicas 4' })
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-cpu -n api-cpu --max-replicas 5' })
    expect(state(run, 'overload').done).toBe(false)
    run = act(run, { type: 'scenario-start', scenarioId: 'overload' })
    run = act(run, { type: 'simulation-advance', seconds: 45 })
    run = act(run, { type: 'scenario-cancel' })
    run = steps(run, cpuGuidedLab.tasks[4])
    expect(Object.values(run.evidence.experimentsById).at(-1).outcome).toBe('passed')
    expect(state(run, 'quiet').done).toBe(false)
    for (const task of cpuGuidedLab.tasks.slice(1, 4)) run = steps(run, task)
    run = steps(run, cpuGuidedLab.tasks[4])
    expect(evaluateLab(cpuGuidedLab, run).isComplete).toBe(true)
  })

  it('preserves baseline evidence for tags and invalidates it for a failed desired deployment', () => {
    let run = createBehavioralRun(cpuGuidedLab, { attemptId: 'cpu-deployment' })
    run = steps(run, cpuGuidedLab.tasks[0])
    run = steps(run, cpuGuidedLab.tasks[1])
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-cpu -n api-cpu --tags owner=training' })
    expect(state(run, 'baseline').done).toBe(true)
    run = applyRunAction(run, { type: 'command', line: 'az containerapp update -g rg-aca-cpu -n api-cpu --image acrcpuguided.azurecr.io/api:missing' }, cpuGuidedLab).run
    expect(state(run, 'baseline').done).toBe(false)
  })

  it('persists measured completion as one Result and restarts independently', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(cpuGuidedLab.id, { repository })
    await store.revealHint('baseline')
    const attempt = store.behavioralRun.attemptId
    await store.load(cpuGuidedLab.id, { repository })
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.hintsUsed).toBe(1)
    for (const task of cpuGuidedLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(step.action)
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(repository.results).toHaveLength(1)
  })
})

