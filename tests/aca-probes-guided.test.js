import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { PROBE_SOLUTION_FILES, probeConfiguration } from '../src/data/templates/containerapps-dotnet/probes.js'
import { probesGuidedLab } from '../src/data/labs/containerapps-journey/probes-guided.lab.js'
import { LABS, nextLabFor, labById } from '../src/data/labs/index.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

const program = 'src/Trainer.Api/Program.cs'
const probes = ['Startup', 'Readiness', 'Liveness'].map((type) => ({
  type, httpGet: { path: `/health/${type === 'Readiness' ? 'ready' : type === 'Liveness' ? 'live' : 'startup'}`, port: 8080, scheme: 'HTTP' },
  initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1,
  failureThreshold: type === 'Startup' ? 6 : 2, successThreshold: 1,
}))
const config = (items = probes) => probeConfiguration({ appName: 'api', image: 'acrprobesguided.azurecr.io/api:v1', probes: items })
const fresh = () => createBehavioralRun(probesGuidedLab, { attemptId: 'probe-guided-test' })
function action(run, value) {
  const result = applyRunAction(run, value, probesGuidedLab)
  expect(result.diagnostics, JSON.stringify(value)).toEqual([])
  expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(value)).toEqual([])
  return result.run
}
const command = (run, line) => action(run, { type: 'command', line })
const save = (run, path, text) => action(run, { type: 'save-file', path, text })
const done = (run, id) => evaluateLab(probesGuidedLab, run).tasks.find((task) => task.id === id).done
function configured(run) {
  run = save(run, program, PROBE_SOLUTION_FILES[program])
  run = command(run, 'az acr build --registry acrprobesguided --image api:v1 --file Dockerfile .')
  run = save(run, 'containerapp.yaml', config())
  return command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
}
function scenario(run, id, duration) {
  run = action(run, { type: 'scenario-start', scenarioId: id })
  return action(run, { type: 'simulation-advance', seconds: duration })
}

describe('guided health probes Lab', () => {
  it('seeds an incomplete published API through normal actions and declares five tasks', () => {
    const run = fresh()
    expect(probesGuidedLab).toMatchObject({ id: 'aca-probes-guided', engineVersion: 2, contentVersion: 1,
      journeyId: 'containerapps-end-to-end', journeyOrder: 7, labMode: 'guided', manifestId: 'containerapps-dotnet-probes-v1' })
    expect(probesGuidedLab.tasks.map((task) => task.id)).toEqual(['source', 'deploy', 'startup', 'readiness', 'liveness'])
    expect(probesGuidedLab.tasks.every((task) => task.hints.length === 2 && task.solution.steps.length && task.examNote)).toBe(true)
    expect(run.sandbox.containerApps[0]).toMatchObject({ name: 'api-probes', minReplicas: 2, maxReplicas: 2, targetPort: 8080 })
    expect(run.runtime.deploymentsByApp[Object.keys(run.runtime.deploymentsByApp)[0]].active.probeConfig.probes).toEqual([])
    expect(run.history).toEqual([])
    expect(run.evidence.experimentsById).toEqual({})
    expect(evaluateLab(probesGuidedLab, run).doneCount).toBe(0)
    expect(LABS).toHaveLength(22)
    expect(LABS.filter((lab) => lab.skillAreaId === 'containers')).toHaveLength(17)
    expect(nextLabFor(labById('aca-cpu-independent'))).toBe(probesGuidedLab)
    expect(nextLabFor(probesGuidedLab)).toBe(labById('aca-probes-troubleshooting'))
  })

  it('requires saved source and captured build plus probe file, then accepts measured behavior', () => {
    let run = fresh()
    run = action(run, { type: 'draft', path: program, text: PROBE_SOLUTION_FILES[program] })
    expect(done(run, 'source')).toBe(false)
    run = save(run, program, PROBE_SOLUTION_FILES[program])
    expect(done(run, 'source')).toBe(true)
    run = save(run, 'containerapp.yaml', config())
    expect(done(run, 'deploy')).toBe(false)
    run = command(run, 'az acr build --registry acrprobesguided --image api:v1 --file Dockerfile .')
    expect(done(run, 'deploy')).toBe(false)
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    expect(done(run, 'deploy')).toBe(true)
    for (const [id, seconds] of [['startup', 60], ['readiness', 90], ['liveness', 90]]) {
      run = scenario(run, id, seconds)
      expect(done(run, id), id).toBe(true)
    }
    expect(evaluateLab(probesGuidedLab, run).isComplete).toBe(true)
  })

  it('keeps complete proof across build-only and semantic no-op updates, then requires fresh proof after a changed capture', () => {
    let run = scenario(configured(fresh()), 'startup', 60)
    const id = Object.keys(run.runtime.deploymentsByApp)[0]
    const generation = run.runtime.deploymentsByApp[id].active.generation
    run = save(run, 'containerapp.yaml', probeConfiguration({ appName: 'api', image: 'ACRPROBESGUIDED.azurecr.io/API:v1', probes: [...probes].reverse() }))
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    expect(run.runtime.deploymentsByApp[id].active.generation).toBe(generation)
    expect(done(run, 'startup')).toBe(true)
    run = command(run, 'az acr build --registry acrprobesguided --image api:v1 --file Dockerfile .')
    expect(done(run, 'startup')).toBe(true)
    run = save(run, 'containerapp.yaml', config(probes.map((probe) => probe.type === 'Readiness' ? { ...probe, failureThreshold: 3 } : probe)))
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    expect(done(run, 'startup')).toBe(false)
  })

  it('preserves an active named experiment across reordered and canonical probe-file no-ops', () => {
    let run = configured(fresh())
    run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
    run = action(run, { type: 'simulation-advance', seconds: 30 })
    const generation = Object.values(run.runtime.deploymentsByApp)[0].active.generation
    run = save(run, 'containerapp.yaml', probeConfiguration({ appName: 'api', image: 'ACRPROBESGUIDED.azurecr.io/API:v1', probes: [...probes].reverse() }))
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.generation).toBe(generation)
    expect(run.runtime.activeScenario).toMatchObject({ scenarioId: 'readiness', elapsedSeconds: 30 })
    run = action(run, { type: 'simulation-advance', seconds: 60 })
    expect(done(run, 'readiness')).toBe(true)
  })

  it('runs every displayed worked solution through real file, command, and scenario actions', () => {
    let run = fresh()
    for (const task of probesGuidedLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') {
        expect(step.content).toBeTruthy()
        run = save(run, step.path, step.content)
      } else if (step.kind === 'command') run = command(run, step.line)
      else run = action(run, step.action)
    }
    expect(evaluateLab(probesGuidedLab, run).isComplete).toBe(true)
  })

  it('rejects incomplete, always-successful, and wrong-port health behavior', () => {
    let run = configured(fresh())
    run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
    run = action(run, { type: 'simulation-advance', seconds: 30 })
    expect(done(run, 'readiness')).toBe(false)
    expect(Object.keys(run.evidence.experimentsById)).toHaveLength(0)
    run = action(run, { type: 'scenario-pause' })
    run = JSON.parse(JSON.stringify(run))
    expect(run.runtime.activeScenario).toMatchObject({ scenarioId: 'readiness', elapsedSeconds: 30, paused: true })
    run = action(run, { type: 'scenario-resume' })
    run = action(run, { type: 'simulation-advance', seconds: 60 })
    expect(done(run, 'readiness')).toBe(true)

    const wrongPort = probes.map((item) => item.type === 'Readiness' ? { ...item, httpGet: { ...item.httpGet, port: 8081 } } : item)
    run = save(run, 'containerapp.yaml', config(wrongPort))
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    expect(done(run, 'deploy')).toBe(false)
    expect(done(run, 'readiness')).toBe(false)
    run = save(run, 'containerapp.yaml', config())
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    expect(done(run, 'deploy')).toBe(true)
    expect(done(run, 'readiness')).toBe(false)
    run = scenario(run, 'readiness', 90)
    expect(done(run, 'readiness')).toBe(true)

    const always = PROBE_SOLUTION_FILES[program].replace('HealthState.Ready', 'true')
    run = save(run, program, always)
    expect(done(run, 'source')).toBe(false)
    expect(done(run, 'readiness')).toBe(true)
  })

  it('rejects a deployed unconditional readiness endpoint, then accepts a repaired build and fresh proof', () => {
    let run = configured(fresh())
    run = save(run, program, PROBE_SOLUTION_FILES[program].replace('HealthState.Ready', 'true'))
    run = command(run, 'az acr build --registry acrprobesguided --image api:v1 --file Dockerfile .')
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --image acrprobesguided.azurecr.io/api:v1')
    expect(done(run, 'deploy')).toBe(false)
    run = scenario(run, 'readiness', 90)
    expect(Object.values(run.evidence.experimentsById).at(-1).outcome).toBe('failed')
    expect(done(run, 'readiness')).toBe(false)
    run = save(run, program, PROBE_SOLUTION_FILES[program])
    run = command(run, 'az acr build --registry acrprobesguided --image api:v1 --file Dockerfile .')
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --image acrprobesguided.azurecr.io/api:v1')
    expect(done(run, 'deploy')).toBe(true)
    run = scenario(run, 'readiness', 90)
    expect(done(run, 'readiness')).toBe(true)
  })

  it('does not award behavior for absent probes, excessive thresholds, or a partial cancelled experiment', () => {
    let run = configured(fresh())
    run = action(run, { type: 'scenario-start', scenarioId: 'startup' })
    run = action(run, { type: 'simulation-advance', seconds: 30 })
    run = action(run, { type: 'scenario-cancel' })
    expect(Object.keys(run.evidence.experimentsById)).toHaveLength(0)
    run = save(run, 'containerapp.yaml', config([]))
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    run = scenario(run, 'startup', 60)
    expect(done(run, 'startup')).toBe(false)
    run = save(run, 'containerapp.yaml', config(probes.filter((item) => item.type !== 'Readiness')))
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    run = scenario(run, 'startup', 60)
    expect(Object.values(run.evidence.experimentsById).at(-1).measurements.requests.filter((item) => item.second >= 20).every((item) => item.status === 200)).toBe(true)
    expect(done(run, 'startup')).toBe(false)
    const delayed = probes.map((item) => item.type === 'Startup' ? { ...item, initialDelaySeconds: 60 } : item)
    run = save(run, 'containerapp.yaml', config(delayed))
    run = command(run, 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml')
    run = scenario(run, 'startup', 60)
    expect(done(run, 'startup')).toBe(false)
  })

  it('persists a paused attempt and one assisted Result, then restarts with retained history', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(probesGuidedLab.id, { repository })
    await store.revealHint('startup')
    await store.revealSolution('source')
    const attempt = store.behavioralRun.attemptId
    for (const task of probesGuidedLab.tasks.slice(0, 2)) for (const step of task.solution.steps) {
      if (step.kind === 'file') await store.dispatchBehavioral({ type: 'save-file', path: step.path, text: step.content })
      else await store.execute(step.line)
    }
    await store.dispatchBehavioral({ type: 'scenario-start', scenarioId: 'startup' })
    await store.dispatchBehavioral({ type: 'simulation-advance', seconds: 30 })
    await store.dispatchBehavioral({ type: 'scenario-pause' })
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.behavioralRun.runtime.activeScenario).toMatchObject({ elapsedSeconds: 30, paused: true })
    expect(Object.keys(store.behavioralRun.evidence.experimentsById)).toHaveLength(0)
    await store.dispatchBehavioral({ type: 'scenario-resume' })
    await store.dispatchBehavioral({ type: 'simulation-advance', seconds: 30 })
    for (const id of ['readiness', 'liveness']) {
      await store.dispatchBehavioral({ type: 'scenario-start', scenarioId: id })
      await store.dispatchBehavioral({ type: 'simulation-advance', seconds: 90 })
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    expect(repository.results[0]).toMatchObject({ labId: probesGuidedLab.id, hintsUsed: 1, solutionsUsed: 1 })
    await expect(store.dispatchBehavioral({ type: 'scenario-start', scenarioId: 'startup' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(repository.results).toHaveLength(1)
  })

  it('keeps the native store active capture through draft, save, and build until deployment', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const store = useLabRunStore()
    await store.load(probesGuidedLab.id, { repository: behavioralRepository() })
    for (const task of probesGuidedLab.tasks.slice(0, 2)) for (const step of task.solution.steps) {
      if (step.kind === 'file') await store.dispatchBehavioral({ type: 'save-file', path: step.path, text: step.content })
      else await store.execute(step.line)
    }
    await store.dispatchBehavioral({ type: 'scenario-start', scenarioId: 'startup' })
    await store.dispatchBehavioral({ type: 'simulation-advance', seconds: 60 })
    expect(done(store.behavioralRun, 'startup')).toBe(true)
    const id = Object.keys(store.behavioralRun.runtime.deploymentsByApp)[0]
    const generation = store.behavioralRun.runtime.deploymentsByApp[id].active.generation
    const altered = PROBE_SOLUTION_FILES[program].replace('HealthState.Ready', 'HealthState.DependencyAvailable')
    await store.dispatchBehavioral({ type: 'draft', path: program, text: altered })
    expect(store.behavioralRun.runtime.deploymentsByApp[id].active.generation).toBe(generation)
    expect(done(store.behavioralRun, 'startup')).toBe(true)
    await store.dispatchBehavioral({ type: 'save-file', path: program, text: altered })
    await store.execute('az acr build --registry acrprobesguided --image api:v1 --file Dockerfile .')
    expect(store.behavioralRun.runtime.deploymentsByApp[id].active.generation).toBe(generation)
    expect(done(store.behavioralRun, 'startup')).toBe(true)
    await store.execute('az containerapp update -g rg-aca-probes -n api-probes --image acrprobesguided.azurecr.io/api:v1')
    expect(store.behavioralRun.runtime.deploymentsByApp[id].active.generation).not.toBe(generation)
    expect(done(store.behavioralRun, 'startup')).toBe(false)
  })
})
