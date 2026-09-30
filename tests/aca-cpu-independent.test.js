import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { cpuIndependentLab } from '../src/data/labs/containerapps-journey/cpu-independent.lab.js'
import { LABS, labById, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

const group = 'rg-aca-cpu-independent'
const app = 'api-cpu-independent'
const update = (flags) => `az containerapp update -g ${group} -n ${app} ${flags}`
const policy = (cpu, memory, target, max, ruleName = 'cpu') => update(`--cpu ${cpu} --memory ${memory} --min-replicas 1 --max-replicas ${max} --scale-rule-name ${ruleName} --scale-rule-type cpu --scale-rule-metadata type=Utilization value=${target}`)
const start = (scenarioId) => ({ type: 'scenario-start', scenarioId })
const advance = (seconds) => ({ type: 'simulation-advance', seconds })

function fresh(id = 'cpu-independent') { return createBehavioralRun(cpuIndependentLab, { attemptId: id }) }
function apply(run, action) { return applyRunAction(run, action, cpuIndependentLab) }
function act(run, action) {
  const result = apply(run, action)
  expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(action)).toEqual([])
  expect(result.diagnostics, JSON.stringify(action)).toEqual([])
  return result.run
}
function command(run, line) { return act(run, { type: 'command', line }) }
function scenario(run, id, seconds = 90) { return act(act(run, start(id)), advance(seconds)) }
function task(run, id) { return evaluateLab(cpuIndependentLab, run).tasks.find((item) => item.id === id) }
function records(run) { return Object.values(run.evidence.experimentsById) }

describe('independent CPU capacity Lab', () => {
  it('starts with a healthy published private API and three requirement Tasks', () => {
    const run = fresh()
    expect(cpuIndependentLab).toMatchObject({ engineVersion: 2, contentVersion: 1,
      journeyId: 'containerapps-end-to-end', journeyOrder: 6, labMode: 'independent', skillAreaId: 'containers' })
    expect(cpuIndependentLab.stages).toEqual([{ id: 'capacity', title: 'Capacity requirements', taskIds: ['steady', 'burst', 'quiet'] }])
    expect(cpuIndependentLab.tasks.map((item) => item.id)).toEqual(['steady', 'burst', 'quiet'])
    expect(cpuIndependentLab.tasks.every((item) => item.hints.length === 2 && item.solution.steps.length > 0 && item.examNote)).toBe(true)
    expect(cpuIndependentLab.initialProjectFiles).toHaveProperty('Dockerfile')
    expect(run.sandbox.containerApps[0]).toMatchObject({ name: app, resourceGroup: group, cpu: 0.5,
      memory: '1Gi', minReplicas: 1, maxReplicas: 1, scaleRules: [], ingress: 'external', targetPort: 8080 })
    expect(Object.values(run.runtime.deploymentsByApp)[0]).toMatchObject({ status: 'succeeded', active: {
      image: 'acrcpuindependent.azurecr.io/api:v1', ingress: 'external', targetPort: 8080, env: { APP_ENV: 'training' } } })
    expect(run.runtime.activeScenario).toBeNull()
    expect(run.runtime.simTimeMs).toBe(0)
    expect(run.runtime.cpuByApp[Object.keys(run.runtime.cpuByApp)[0]].readyReplicas).toBe(1)
    expect(run.evidence).toEqual({ experimentsById: {}, currentEvidenceByTask: {}, milestoneRecords: [] })
    expect(run.history).toEqual([])
    expect(run.scrollback).toEqual([])
    expect(run.hintsRevealed).toEqual({})
    expect(run.solutionsRevealed).toEqual({})
    expect(fresh('repeat').sandbox).toEqual(run.sandbox)
    expect(fresh('repeat').runtime).toEqual(run.runtime)
    expect(evaluateLab(cpuIndependentLab, run).doneCount).toBe(0)
    expect(cpuIndependentLab.scenarios.steady).toMatchObject({ kind: 'cpu', version: 1, durationSeconds: 90, demandCpuSecondsPerSecond: 0.9, requestCpuSeconds: 0.03 })
    expect(cpuIndependentLab.scenarios.burst).toMatchObject({ kind: 'cpu', version: 1, durationSeconds: 90, demandCpuSecondsPerSecond: 1.8, requestCpuSeconds: 0.03 })
    expect(cpuIndependentLab.scenarios.quiet).toMatchObject({ kind: 'cpu', version: 1, durationSeconds: 90, demandCpuSecondsPerSecond: 0 })
    expect(Object.isFrozen(cpuIndependentLab.scenarios)).toBe(true)
    expect(Object.values(cpuIndependentLab.scenarios).every(Object.isFrozen)).toBe(true)
    expect(LABS.filter((item) => item.skillAreaId === 'containers')).toHaveLength(17)
    expect(nextLabFor(labById('aca-cpu-troubleshooting'))).toBe(cpuIndependentLab)
    expect(nextLabFor(cpuIndependentLab)).toBe(labById('aca-probes-guided'))
  })

  it.each([
    [0.5, '1Gi', 60, 4],
    [1, '2Gi', 75, 3],
    [1, '2Gi', 90, 2],
  ])('accepts %s CPU, %s, target %s and max %s on measured outcomes', (cpu, memory, target, max) => {
    let run = command(fresh(`${cpu}-${target}`), policy(cpu, memory, target, max, target === 75 ? 'capacity' : 'cpu'))
    run = scenario(run, 'steady')
    expect(task(run, 'steady').done).toBe(true)
    const steady = records(run).at(-1)
    expect(steady.measurements.trace).toHaveLength(90)
    expect(steady.measurements.trace.slice(-15).every((sample) => Math.abs(sample.offeredThroughput - 30) < 1e-9 && sample.servedThroughput + 1e-9 >= 30)).toBe(true)
    run = scenario(run, 'burst')
    expect(task(run, 'burst').done).toBe(true)
    const burst = records(run).at(-1)
    expect(burst.measurements.endReadyReplicas).toBeGreaterThan(1)
    expect(burst.measurements.trace.slice(-15).every((sample) => Math.abs(sample.offeredThroughput - 60) < 1e-9 && sample.servedThroughput + 1e-9 >= 60)).toBe(true)
    expect(burst.dependencyValues[Object.keys(burst.dependencyValues).find((key) => key.startsWith('deployment:'))]).toMatchObject({
      active: { image: 'acrcpuindependent.azurecr.io/api:v1', targetPort: 8080 }, desired: expect.any(Object), status: 'succeeded' })
    expect(burst.dependencyGenerations[Object.keys(burst.dependencyGenerations).find((key) => key.startsWith('scaling:'))]).toEqual(expect.any(Number))
    run = scenario(run, 'quiet')
    expect(records(run).at(-1).measurements).toMatchObject({ endReadyReplicas: 1 })
    expect(records(run).at(-1).measurements.startReadyReplicas).toBeGreaterThan(1)
    expect(evaluateLab(cpuIndependentLab, run).isComplete).toBe(true)
  })

  it('accepts burst then steady then quiet', () => {
    let run = command(fresh('reverse'), policy(0.5, '1Gi', 60, 4))
    run = scenario(run, 'burst')
    run = scenario(run, 'steady')
    run = scenario(run, 'quiet')
    expect(evaluateLab(cpuIndependentLab, run).isComplete).toBe(true)
  })

  it('rejects insufficient capacity and bounds even when another workload succeeds', () => {
    let run = command(fresh('under-capacity'), policy(0.5, '1Gi', 60, 3))
    run = scenario(run, 'steady')
    expect(task(run, 'steady').done).toBe(true)
    run = scenario(run, 'burst')
    expect(records(run).at(-1).measurements.finalServedThroughput).toBeCloseTo(50)
    expect(task(run, 'burst').done).toBe(false)
    for (const [name, line] of [
      ['max-five', policy(1, '2Gi', 75, 5)],
      ['min-two', update('--cpu 1 --memory 2Gi --min-replicas 2 --max-replicas 4 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=75')],
      ['target-hundred', policy(1, '2Gi', 100, 4)],
    ]) {
      let candidate = command(fresh(name), line)
      candidate = scenario(candidate, 'steady')
      candidate = scenario(candidate, 'burst')
      expect(evaluateLab(cpuIndependentLab, candidate).isComplete, name).toBe(false)
      expect(task(candidate, 'burst').done, name).toBe(false)
    }
  })

  it('rejects mismatched resource pairs atomically and caller-supplied demand', () => {
    const run = fresh('invalid-input')
    for (const line of [update('--cpu 1 --memory 1Gi'), update('--cpu 0.5 --memory 2Gi')]) {
      const rejected = apply(run, { type: 'command', line })
      expect(rejected.lines.some((item) => item.kind === 'err')).toBe(true)
      expect(rejected.run.sandbox).toEqual(run.sandbox)
    }
    const injected = apply(run, { ...start('steady'), demandCpuSecondsPerSecond: 0 })
    expect(injected.diagnostics).toHaveLength(1)
    expect(injected.run).toEqual(run)
  })

  it('invalidates both load proofs after a configuration round trip but preserves them for no-ops and tags', () => {
    let run = command(fresh('drift'), policy(0.5, '1Gi', 60, 4))
    run = scenario(scenario(run, 'steady'), 'burst')
    expect(task(run, 'steady').done && task(run, 'burst').done).toBe(true)
    run = command(run, update('--tags owner=training'))
    run = command(run, policy(0.5, '1Gi', 60, 4))
    expect(task(run, 'steady').done && task(run, 'burst').done).toBe(true)
    run = command(run, update('--max-replicas 3'))
    run = command(run, update('--max-replicas 4'))
    expect(task(run, 'steady').done).toBe(false)
    expect(task(run, 'burst').done).toBe(false)
    run = scenario(run, 'burst')
    expect(task(run, 'burst').done).toBe(true)
    expect(task(run, 'steady').done).toBe(false)
    run = scenario(run, 'steady')
    expect(task(run, 'steady').done).toBe(true)
    const failed = apply(run, { type: 'command', line: update('--image acrcpuindependent.azurecr.io/api:missing') }).run
    expect(task(failed, 'steady').done).toBe(false)
    expect(task(failed, 'burst').done).toBe(false)
  })

  it('requires successful complete load proofs before quiet and a new quiet after later load', () => {
    let run = command(fresh('ordering'), policy(0.5, '1Gi', 60, 4))
    run = act(run, start('burst'))
    run = act(run, advance(45))
    expect(task(run, 'burst').done).toBe(false)
    run = act(run, { type: 'scenario-cancel' })
    run = scenario(run, 'quiet')
    expect(task(run, 'quiet').done).toBe(false)
    run = scenario(run, 'steady')
    run = scenario(run, 'quiet')
    expect(task(run, 'quiet').done).toBe(false)
    run = scenario(run, 'burst')
    expect(task(run, 'quiet').done).toBe(false)
    run = scenario(run, 'quiet')
    expect(evaluateLab(cpuIndependentLab, run).isComplete).toBe(true)
    run = scenario(run, 'steady')
    expect(task(run, 'quiet').done).toBe(false)
    run = scenario(run, 'quiet')
    expect(evaluateLab(cpuIndependentLab, run).isComplete).toBe(true)
  })

  it('cannot use a failed burst as a quiet prerequisite', () => {
    let run = command(fresh('failed-burst'), policy(0.5, '1Gi', 60, 3))
    run = scenario(run, 'steady')
    run = scenario(run, 'burst')
    expect(records(run).at(-1).outcome).toBe('failed')
    run = scenario(run, 'quiet')
    expect(task(run, 'quiet').done).toBe(false)
  })

  it.each(['different target', 'away and back'])('requires a current Steady proof after %s before Quiet', (kind) => {
    let run = command(fresh(`stale-steady-${kind}`), policy(0.5, '1Gi', 60, 4))
    run = scenario(run, 'steady')
    run = command(run, policy(0.5, '1Gi', 65, 4))
    if (kind === 'away and back') run = command(run, policy(0.5, '1Gi', 60, 4))
    expect(task(run, 'steady').done).toBe(false)
    run = scenario(run, 'burst')
    run = act(run, start('steady'))
    run = act(run, advance(45))
    run = act(run, { type: 'scenario-cancel' })
    expect(task(run, 'steady').done).toBe(false)
    run = scenario(run, 'quiet')
    expect(records(run).at(-1).outcome).toBe('passed')
    expect(task(run, 'quiet').done).toBe(false)
    run = scenario(run, 'steady')
    run = scenario(run, 'burst')
    run = scenario(run, 'quiet')
    expect(evaluateLab(cpuIndependentLab, run).isComplete).toBe(true)
  })

  it('runs optional worked Solutions through the reducer', () => {
    let run = fresh('worked')
    for (const item of cpuIndependentLab.tasks) for (const step of item.solution.steps) {
      run = step.kind === 'command' ? command(run, step.line) : act(run, step.action)
    }
    expect(evaluateLab(cpuIndependentLab, run).isComplete).toBe(true)
  })

  it('persists a partial run, produces one assisted Result, and restarts fresh', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(cpuIndependentLab.id, { repository })
    const attempt = store.behavioralRun.attemptId
    await store.revealHint('steady')
    await store.revealSolution('steady')
    await store.execute(policy(0.5, '1Gi', 60, 4))
    await store.dispatchBehavioral(start('steady'))
    await store.dispatchBehavioral(advance(45))
    expect(store.doneCount).toBe(0)
    expect(records(store.behavioralRun)).toHaveLength(0)
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.behavioralRun.runtime.activeScenario).toMatchObject({ scenarioId: 'steady', elapsedSeconds: 45 })
    await store.dispatchBehavioral(advance(45))
    expect(task(store.behavioralRun, 'steady').done).toBe(true)
    expect(records(store.behavioralRun)[0].measurements.trace).toHaveLength(90)
    for (const id of ['burst', 'quiet']) {
      await store.dispatchBehavioral(start(id))
      await store.dispatchBehavioral(advance(90))
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    expect(repository.results[0]).toMatchObject({ labId: cpuIndependentLab.id, hintsUsed: 1, solutionsUsed: 1 })
    const completed = JSON.parse(JSON.stringify(store.behavioralRun))
    await expect(store.dispatchBehavioral(start('steady'))).rejects.toMatchObject({ code: 'READ_ONLY' })
    expect(store.behavioralRun).toEqual(completed)
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.behavioralRun.runtime.activeScenario).toBeNull()
    expect(store.behavioralRun.sandbox.containerApps[0]).toMatchObject({ minReplicas: 1, maxReplicas: 1, scaleRules: [] })
    expect(store.doneCount).toBe(0)
    expect(repository.results).toHaveLength(1)
  })
})

