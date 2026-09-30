import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { cpuTroubleshootingLab } from '../src/data/labs/containerapps-journey/cpu-troubleshooting.lab.js'
import { LABS, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

const group = 'rg-aca-cpu-incident'
const app = 'api-cpu-incident'
const update = (flags) => `az containerapp update -g ${group} -n ${app} ${flags}`
const repair = update('--max-replicas 3')
const start = (scenarioId) => ({ type: 'scenario-start', scenarioId })
const advance = (seconds) => ({ type: 'simulation-advance', seconds })

function act(run, action) {
  const result = applyRunAction(run, action, cpuTroubleshootingLab)
  expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(action)).toEqual([])
  expect(result.diagnostics, JSON.stringify(action)).toEqual([])
  return result.run
}
function command(run, line) { return act(run, { type: 'command', line }) }
function scenario(run, id, seconds = 90) { return act(act(run, start(id)), advance(seconds)) }
function state(run, id) { return evaluateLab(cpuTroubleshootingLab, run).tasks.find((task) => task.id === id) }
function evidence(run) { return Object.values(run.evidence.experimentsById) }
function fresh(id = 'cpu-incident') { return createBehavioralRun(cpuTroubleshootingLab, { attemptId: id }) }

describe('CPU troubleshooting Lab', () => {
  it('seeds a healthy private API and real active incident without learner credit', () => {
    const run = fresh()
    const seeded = fresh('repeat')
    expect(cpuTroubleshootingLab).toMatchObject({ engineVersion: 2, contentVersion: 1,
      journeyId: 'containerapps-end-to-end', journeyOrder: 5, labMode: 'troubleshooting', skillAreaId: 'containers' })
    expect(cpuTroubleshootingLab.tasks.map((task) => task.id)).toEqual(['recovery', 'quiet'])
    expect(cpuTroubleshootingLab.initialProjectFiles).toHaveProperty('Dockerfile')
    expect(run.sandbox.containerApps[0]).toMatchObject({ name: app, resourceGroup: group, cpu: 0.5,
      memory: '1Gi', minReplicas: 1, maxReplicas: 1 })
    expect(run.sandbox.containerApps[0].scaleRules[0].custom).toMatchObject({ type: 'cpu', metadata: { type: 'Utilization', value: '60' } })
    expect(Object.values(run.runtime.deploymentsByApp)[0]).toMatchObject({ status: 'succeeded', active: { ingress: 'external', targetPort: 8080 } })
    expect(run.runtime.simTimeMs).toBe(30_000)
    expect(run.runtime.activeScenario).toMatchObject({ scenarioId: 'incident', elapsedSeconds: 30, paused: false })
    expect(run.runtime.activeScenario.trace.at(-1)).toMatchObject({ readyReplicas: 1, utilization: 100,
      offeredThroughput: 40, servedThroughput: 25 })
    expect(run.runtime).toEqual(seeded.runtime)
    expect(run.sandbox).toEqual(seeded.sandbox)
    expect(run.evidence).toEqual({ experimentsById: {}, currentEvidenceByTask: {}, milestoneRecords: [] })
    expect(run.scrollback).toEqual([])
    expect(run.history).toEqual([])
    expect(run.hintsRevealed).toEqual({})
    expect(run.solutionsRevealed).toEqual({})
    expect(evaluateLab(cpuTroubleshootingLab, run).doneCount).toBe(0)
    expect(cpuTroubleshootingLab.tasks.every((task) => task.hints.length === 2 && task.solution.steps.length > 0 && task.examNote)).toBe(true)
    expect(run.hintsRevealed).toEqual({})
    expect(LABS.filter((lab) => lab.skillAreaId === 'containers')).toHaveLength(17)
    expect(nextLabFor(LABS.find((lab) => lab.id === 'aca-cpu-guided'))).toBe(cpuTroubleshootingLab)
    expect(nextLabFor(cpuTroubleshootingLab)).toBe(LABS.find((lab) => lab.id === 'aca-cpu-independent'))
  })

  it('fails the initial workload, then passes a fresh unchanged incident and quiet scale-in', () => {
    let run = fresh()
    run = act(run, advance(60))
    expect(evidence(run).map((record) => record.outcome)).toEqual(['failed'])
    expect(state(run, 'recovery').done).toBe(false)
    run = command(run, repair)
    run = scenario(run, 'incident')
    expect(state(run, 'recovery').done).toBe(true)
    const deploymentSnapshot = evidence(run).at(-1).dependencyValues[
      Object.keys(evidence(run).at(-1).dependencyValues).find((key) => key.startsWith('deployment:'))]
    expect(deploymentSnapshot.active).toMatchObject({ ingress: 'external', targetPort: 8080,
      image: 'acrcpuincident.azurecr.io/api:v1' })
    const measurement = evidence(run).at(-1).measurements
    expect(measurement.endReadyReplicas).toBeGreaterThan(1)
    expect(measurement.trace.slice(-15)).toHaveLength(15)
    expect(measurement.trace.slice(-15).every((sample) => sample.offeredThroughput === 40 && sample.servedThroughput >= sample.offeredThroughput)).toBe(true)
    run = scenario(run, 'quiet')
    expect(evidence(run).at(-1).measurements).toMatchObject({ startReadyReplicas: expect.any(Number), endReadyReplicas: 1 })
    expect(evidence(run).at(-1).measurements.startReadyReplicas).toBeGreaterThan(1)
    expect(evaluateLab(cpuTroubleshootingLab, run).isComplete).toBe(true)
  })

  it('accepts a sufficient maximum of two and rejects outside policy bounds', () => {
    let run = command(fresh('max-two'), update('--max-replicas 2'))
    run = scenario(run, 'incident')
    expect(state(run, 'recovery').done).toBe(true)
    for (const [name, flags] of [
      ['max-six', '--max-replicas 6'],
      ['cpu-one', '--cpu 1 --memory 2Gi --max-replicas 3'],
      ['target-changed', '--max-replicas 3 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=80'],
    ]) {
      let candidate = command(fresh(name), update(flags))
      candidate = scenario(candidate, 'incident')
      expect(state(candidate, 'recovery').done, name).toBe(false)
    }
  })

  it('rejects cancellation, quiet-only runs, demand injection, and partial reloads', () => {
    let run = fresh()
    const rejected = applyRunAction(run, { ...start('incident'), demandCpuSecondsPerSecond: 0 }, cpuTroubleshootingLab)
    expect(rejected.diagnostics).toHaveLength(1)
    expect(rejected.run).toEqual(run)
    run = act(run, { type: 'scenario-cancel' })
    run = command(run, repair)
    run = scenario(run, 'quiet')
    expect(state(run, 'recovery').done).toBe(false)
    run = act(run, start('incident'))
    run = act(run, advance(45))
    expect(state(run, 'recovery').done).toBe(false)
    const reloaded = structuredClone(run)
    expect(reloaded.runtime.activeScenario.elapsedSeconds).toBe(45)
    expect(evaluateLab(cpuTroubleshootingLab, reloaded).isComplete).toBe(false)
  })

  it('requires a completed recovery proof before quiet and a new quiet proof after later load runs', () => {
    let run = command(fresh('quiet-order'), repair)
    run = act(run, start('incident'))
    run = act(run, advance(30))
    run = act(run, { type: 'scenario-cancel' })
    run = scenario(run, 'quiet')
    expect(evidence(run).at(-1).outcome).toBe('passed')
    expect(state(run, 'quiet').done).toBe(false)
    run = scenario(run, 'incident')
    expect(state(run, 'recovery').done).toBe(true)
    expect(state(run, 'quiet').done).toBe(false)
    expect(evaluateLab(cpuTroubleshootingLab, run).isComplete).toBe(false)
    run = scenario(run, 'quiet')
    expect(evaluateLab(cpuTroubleshootingLab, run).isComplete).toBe(true)
    run = scenario(run, 'incident')
    expect(state(run, 'quiet').done).toBe(false)
    run = scenario(run, 'quiet')
    expect(evaluateLab(cpuTroubleshootingLab, run).isComplete).toBe(true)
  })

  it('does not count failed or incomplete incident work as the prerequisite for quiet', () => {
    let run = command(fresh('quiet-prerequisite'), repair)
    run = act(run, start('incident'))
    run = act(run, advance(45))
    expect(state(run, 'recovery').done).toBe(false)
    run = act(run, { type: 'scenario-cancel' })
    run = scenario(run, 'quiet')
    expect(state(run, 'quiet').done).toBe(false)
    run = command(run, update('--max-replicas 1'))
    run = scenario(run, 'incident')
    expect(evidence(run).at(-1).outcome).toBe('failed')
    run = command(run, repair)
    run = scenario(run, 'quiet')
    expect(state(run, 'quiet').done).toBe(false)
  })

  it.each(['different maximum', 'away and back'])('does not use a stale recovery proof for Quiet after %s', (kind) => {
    let run = scenario(command(fresh(`stale-recovery-${kind}`), repair), 'incident')
    run = command(run, update('--max-replicas 4'))
    if (kind === 'away and back') run = command(run, repair)
    expect(state(run, 'recovery').done).toBe(false)
    run = act(run, start('incident'))
    run = act(run, advance(45))
    run = act(run, { type: 'scenario-cancel' })
    run = scenario(run, 'quiet')
    expect(evidence(run).at(-1).outcome).toBe('passed')
    expect(state(run, 'quiet').done).toBe(false)
    run = scenario(run, 'incident')
    run = scenario(run, 'quiet')
    expect(evaluateLab(cpuTroubleshootingLab, run).isComplete).toBe(true)
  })

  it('invalidates prior proof after policy drift or failed deployment, while no-op tags preserve it', () => {
    let run = scenario(command(fresh(), repair), 'incident')
    expect(state(run, 'recovery').done).toBe(true)
    run = command(run, update('--tags owner=training'))
    expect(state(run, 'recovery').done).toBe(true)
    run = command(run, repair)
    expect(state(run, 'recovery').done).toBe(true)
    run = command(run, update('--max-replicas 4'))
    run = command(run, repair)
    expect(state(run, 'recovery').done).toBe(false)
    run = scenario(run, 'incident')
    expect(state(run, 'recovery').done).toBe(true)
    const failed = applyRunAction(run, { type: 'command', line: update('--image acrcpuincident.azurecr.io/api:missing') }, cpuTroubleshootingLab).run
    expect(state(failed, 'recovery').done).toBe(false)
  })

  it('resumes a repaired incident halfway through from the native store without premature recovery', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(cpuTroubleshootingLab.id, { repository })
    const attempt = store.behavioralRun.attemptId
    await store.execute(repair)
    await store.dispatchBehavioral(start('incident'))
    await store.dispatchBehavioral(advance(45))
    expect(store.behavioralRun.runtime.activeScenario).toMatchObject({ scenarioId: 'incident', elapsedSeconds: 45 })
    expect(state(store.behavioralRun, 'recovery').done).toBe(false)
    expect(evidence(store.behavioralRun)).toEqual([])
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.behavioralRun.runtime.activeScenario).toMatchObject({ scenarioId: 'incident', elapsedSeconds: 45 })
    expect(state(store.behavioralRun, 'recovery').done).toBe(false)
    expect(store.isComplete).toBe(false)
    await store.dispatchBehavioral(advance(45))
    expect(state(store.behavioralRun, 'recovery').done).toBe(true)
    expect(evidence(store.behavioralRun)).toHaveLength(1)
    expect(evidence(store.behavioralRun)[0].measurements.trace).toHaveLength(90)
  })

  it('executes worked Solutions in the reducer and persists one assisted Result through the store', async () => {
    let run = fresh('worked')
    run = act(run, advance(60))
    for (const task of cpuTroubleshootingLab.tasks) for (const step of task.solution.steps) {
      run = step.kind === 'command' ? command(run, step.line) : act(run, step.action)
    }
    expect(evaluateLab(cpuTroubleshootingLab, run).isComplete).toBe(true)

    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(cpuTroubleshootingLab.id, { repository })
    const attempt = store.behavioralRun.attemptId
    await store.revealHint('recovery')
    await store.revealSolution('recovery')
    expect(store.hintsUsed).toBe(1)
    expect(store.solutionsUsed).toBe(1)
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.behavioralRun.runtime.activeScenario.elapsedSeconds).toBe(30)
    await store.dispatchBehavioral(advance(15))
    await store.reload()
    expect(store.behavioralRun.runtime.activeScenario.elapsedSeconds).toBe(45)
    expect(store.doneCount).toBe(0)
    await store.dispatchBehavioral(advance(45))
    for (const task of cpuTroubleshootingLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(step.action)
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    expect(repository.results[0]).toMatchObject({ labId: cpuTroubleshootingLab.id, hintsUsed: 1, solutionsUsed: 1 })
    const completed = JSON.parse(JSON.stringify(store.behavioralRun))
    await expect(store.dispatchBehavioral(start('incident'))).rejects.toMatchObject({ code: 'READ_ONLY' })
    expect(store.behavioralRun).toEqual(completed)
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.behavioralRun.runtime.activeScenario.elapsedSeconds).toBe(30)
    expect(store.doneCount).toBe(0)
    expect(repository.results).toHaveLength(1)
  })
})

