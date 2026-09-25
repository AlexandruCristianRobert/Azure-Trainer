import { describe, expect, it } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { probeConfiguration } from '../src/data/templates/containerapps-dotnet/probes.js'
import { INDEPENDENT_PROBE_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/probes-independent.js'
import { probesIndependentLab } from '../src/data/labs/containerapps-journey/probes-independent.lab.js'
import { LABS, labById, nextLabFor } from '../src/data/labs/index.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

const program = 'src/Trainer.Api/Program.cs'
const yaml = 'containerapp.yaml'
const image = 'acrprobesindependent.azurecr.io/api:v1'
const defaultProbes = ['Startup', 'Readiness', 'Liveness'].map((type) => ({
  type, httpGet: { path: `/health/${type === 'Startup' ? 'startup' : type === 'Readiness' ? 'ready' : 'live'}`, port: 8080, scheme: 'HTTP' },
  initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1, failureThreshold: type === 'Startup' ? 8 : 2, successThreshold: 1,
}))
const config = (probes = defaultProbes, usedImage = image) => probeConfiguration({ appName: 'api', image: usedImage, probes })
const fresh = () => createBehavioralRun(probesIndependentLab, { attemptId: 'independent-test' })
function apply(run, value) {
  const result = applyRunAction(run, value, probesIndependentLab)
  expect(result.diagnostics, JSON.stringify(value)).toEqual([])
  expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(value)).toEqual([])
  return result.run
}
const save = (run, path, text) => apply(run, { type: 'save-file', path, text })
const command = (run, line) => apply(run, { type: 'command', line })
const build = (run) => command(run, 'az acr build --registry acrprobesindependent --image api:v1 --file Dockerfile .')
const deploy = (run) => command(run, 'az containerapp update -g rg-aca-probes-independent -n api-probes-independent --yaml containerapp.yaml')
const task = (run, id) => evaluateLab(probesIndependentLab, run).tasks.find((item) => item.id === id)
const latest = (run) => Object.values(run.evidence.experimentsById).at(-1)
function prepared(probes = defaultProbes, source = INDEPENDENT_PROBE_SOLUTION_FILES[program]) {
  let run = fresh()
  run = save(run, program, source)
  run = build(run)
  run = save(run, yaml, config(probes))
  return deploy(run)
}
function scenario(run, id) {
  run = apply(run, { type: 'scenario-start', scenarioId: id })
  return apply(run, { type: 'simulation-advance', seconds: probesIndependentLab.scenarios[id].durationSeconds })
}

describe('independent health probes Lab', () => {
  it('seeds real resources and an incomplete project without learner proof', () => {
    const run = fresh()
    expect(probesIndependentLab).toMatchObject({ id: 'aca-probes-independent', engineVersion: 2, contentVersion: 1,
      journeyOrder: 9, labMode: 'independent', manifestId: 'containerapps-dotnet-probes-independent-v1' })
    expect(probesIndependentLab.tasks.map((item) => item.id)).toEqual(['startup', 'readiness', 'liveness'])
    expect(run.sandbox.resourceGroups[0]).toMatchObject({ name: 'rg-aca-probes-independent', createdAt: '2026-09-22T00:00:00.000Z' })
    expect(run.sandbox.containerRegistries[0].name).toBe('acrprobesindependent')
    expect(run.sandbox.containerAppEnvironments[0].name).toBe('env-probes-independent')
    expect(run.sandbox.managedIdentities[0].name).toBe('id-probes-independent')
    expect(run.sandbox.containerApps[0]).toMatchObject({ name: 'api-probes-independent', image, minReplicas: 2, maxReplicas: 2 })
    expect(run.sandbox.roleAssignments[0].roleName).toBe('AcrPull')
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.probeConfig.probes).toEqual([])
    expect(run.project.savedFiles[program]).toContain('false ? Results.Ok()')
    expect(JSON.parse(run.project.savedFiles[yaml]).properties.template.containers[0].probes).toEqual([])
    expect(run.history).toEqual([])
    expect(run.evidence.experimentsById).toEqual({})
    expect(evaluateLab(probesIndependentLab, run).doneCount).toBe(0)
    expect(LABS.filter((lab) => lab.journeyId === 'containerapps-end-to-end')).toHaveLength(16)
    expect(LABS.filter((item) => item.journeyId === 'containerapps-end-to-end')).toHaveLength(16)
    expect(nextLabFor(labById('aca-probes-troubleshooting'))).toBe(probesIndependentLab)
    expect(nextLabFor(probesIndependentLab)).toBe(labById('aca-foundry-guided'))
  })

  it.each([
    ['startup', 'readiness', 'liveness'],
    ['liveness', 'startup', 'readiness'],
    ['readiness', 'liveness', 'startup'],
  ])('accepts complete measured proofs in any order: %s, %s, %s', (...order) => {
    let run = prepared()
    for (const id of order) {
      run = scenario(run, id)
      expect(task(run, id).done, id).toBe(true)
      const record = latest(run), duration = probesIndependentLab.scenarios[id].durationSeconds
      expect(record).toMatchObject({ scenarioId: id, outcome: 'passed', completed: true })
      expect(record.measurements.samples.map((sample) => sample.second)).toEqual(Array.from({ length: duration }, (_, i) => i + 1))
      expect(record.measurements.requests).toHaveLength(duration * 2)
      expect(run.evidence.currentEvidenceByTask[id]).toBe(record.id)
      expect(Object.keys(record.dependencyGenerations)).toEqual(Object.keys(probesIndependentLab.tasks[0].dependencies))
      for (const [key, generation] of Object.entries(record.dependencyGenerations)) {
        expect(generation).toBe(run.dependencyGenerations[key] ?? 0)
      }
    }
    expect(evaluateLab(probesIndependentLab, run).isComplete).toBe(true)
  })

  it('accepts a second supported four-second policy on all measured outcomes', () => {
    const alternate = defaultProbes.map((probe) => ({ ...probe, initialDelaySeconds: 4, periodSeconds: 4 }))
    let run = prepared(alternate)
    for (const id of ['readiness', 'liveness', 'startup']) {
      run = scenario(run, id)
      expect(task(run, id).done, id).toBe(true)
    }
    expect(evaluateLab(probesIndependentLab, run).isComplete).toBe(true)
  })

  it('accepts a Startup first success at second 41 when the entire final 40-second window is healthy', () => {
    const delayed = defaultProbes.map((probe) => probe.type === 'Startup'
      ? { ...probe, initialDelaySeconds: 41 } : probe)
    const run = scenario(prepared(delayed), 'startup')
    const m = latest(run).measurements
    expect(m.events.filter((event) => event.type === 'startup-complete').map((event) => event.second)).toEqual([41, 41])
    expect(m.samples.filter((sample) => sample.second >= 41).every((sample) => sample.readyReplicas === 2)).toBe(true)
    expect(m.requests.filter((request) => request.second >= 41).every((request) => request.status === 200)).toBe(true)
    expect(task(run, 'startup').done).toBe(true)
  })

  it('shows distinct startup, readiness, and liveness events at the required bounds', () => {
    let run = prepared()
    const appId = probesIndependentLab.scenarios.startup.appId
    run = scenario(run, 'startup')
    let m = latest(run).measurements
    expect(m.restarts).toBe(0)
    expect(m.events.filter((event) => event.type === 'startup-complete').map((event) => event.second)).toEqual([30, 30])
    expect(m.requests.filter((request) => request.second < 30).every((request) => request.replicaId === null && request.status === 503)).toBe(true)
    expect(m.requests.filter((request) => request.second >= 41).every((request) => request.status === 200)).toBe(true)
    run = scenario(run, 'readiness')
    m = latest(run).measurements
    expect(m.events.some((event) => event.type === 'ready-change' && event.replicaId === `${appId}#0` && !event.ready && event.second <= 55)).toBe(true)
    expect(m.events.some((event) => event.type === 'ready-change' && event.replicaId === `${appId}#0` && event.ready && event.second >= 65 && event.second <= 75)).toBe(true)
    expect(m.requests.filter((request) => request.second >= 55 && request.second <= 64).every((request) => request.replicaId === `${appId}#1` && request.status === 200)).toBe(true)
    expect(m.restarts).toBe(0)
    run = scenario(run, 'liveness')
    m = latest(run).measurements
    const restart = m.events.find((event) => event.type === 'restart' && event.replicaId === `${appId}#0`)
    expect(restart.probeType).toBe('Liveness')
    expect(restart.second).toBeLessThanOrEqual(60)
    expect(m.events.some((event) => event.type === 'probe-timeout' && event.replicaId === `${appId}#0` && event.second <= restart.second)).toBe(true)
    expect(m.events.some((event) => event.type === 'startup-complete' && event.replicaId === `${appId}#0` && event.second >= restart.second + 30 && event.second <= 95)).toBe(true)
    expect(m.samples.filter((sample) => sample.second >= 96).every((sample) => sample.readyReplicas === 2)).toBe(true)
  })

  it.each([
    ['early startup restart', (items) => items.map((item) => item.type === 'Startup' ? { ...item, failureThreshold: 3 } : item), 'startup'],
    ['missing startup', (items) => items.filter((item) => item.type !== 'Startup'), 'startup'],
    ['slow startup check', (items) => items.map((item) => item.type === 'Startup' ? { ...item, initialDelaySeconds: 60 } : item), 'startup'],
    ['wrong startup port', (items) => items.map((item) => item.type === 'Startup' ? { ...item, httpGet: { ...item.httpGet, port: 8081 } } : item), 'startup'],
    ['wrong readiness path', (items) => items.map((item) => item.type === 'Readiness' ? { ...item, httpGet: { ...item.httpGet, path: '/health/live' } } : item), 'readiness'],
    ['slow readiness removal', (items) => items.map((item) => item.type === 'Readiness' ? { ...item, periodSeconds: 20 } : item), 'readiness'],
    ['slow readiness recovery', (items) => items.map((item) => item.type === 'Readiness' ? { ...item, successThreshold: 4 } : item), 'readiness'],
    ['missing liveness', (items) => items.filter((item) => item.type !== 'Liveness'), 'liveness'],
    ['slow liveness restart', (items) => items.map((item) => item.type === 'Liveness' ? { ...item, failureThreshold: 6 } : item), 'liveness'],
    ['long liveness timeout', (items) => items.map((item) => item.type === 'Liveness' ? { ...item, timeoutSeconds: 10 } : item), 'liveness'],
  ])('rejects %s after a complete %s run', (name, change, id) => {
    const run = scenario(prepared(change(defaultProbes)), id)
    expect(task(run, id).done, name).toBe(false)
    expect(latest(run).outcome, name).toBe('failed')
  })

  it.each([
    ['StartupComplete', 'startup'], ['Ready', 'readiness'], ['Responsive', 'liveness'],
  ])('rejects an unconditional %s endpoint', (condition, id) => {
    const source = INDEPENDENT_PROBE_SOLUTION_FILES[program].replace(`HealthState.${condition} ? Results.Ok()`, 'true ? Results.Ok()')
    const run = scenario(prepared(defaultProbes, source), id)
    expect(task(run, id).done).toBe(false)
  })

  it('requires Save, build and deploy before the active source and policy change', () => {
    let run = fresh()
    const appId = probesIndependentLab.scenarios.startup.appId
    const active = () => run.runtime.deploymentsByApp[appId].active
    run = apply(run, { type: 'draft', path: program, text: INDEPENDENT_PROBE_SOLUTION_FILES[program] })
    expect(active().appSpec.healthEndpoints.every((item) => item.condition === 'never')).toBe(true)
    run = save(run, program, INDEPENDENT_PROBE_SOLUTION_FILES[program])
    run = save(run, yaml, config())
    expect(active().probeConfig.probes).toEqual([])
    run = scenario(run, 'startup')
    expect(task(run, 'startup').done).toBe(false)
    run = build(run)
    expect(active().probeConfig.probes).toEqual([])
    run = deploy(run)
    expect(active().probeConfig.probes).toHaveLength(3)
    run = scenario(run, 'startup')
    expect(task(run, 'startup').done).toBe(true)
  })

  it('keeps deployed source when a corrected file is saved or built without redeployment', () => {
    let run = fresh()
    run = save(run, program, INDEPENDENT_PROBE_SOLUTION_FILES[program])
    run = save(run, yaml, config())
    run = deploy(run)
    run = scenario(run, 'startup')
    expect(task(run, 'startup').done).toBe(false)
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.appSpec.healthEndpoints.every((item) => item.condition === 'never')).toBe(true)
    run = build(run)
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.appSpec.healthEndpoints.every((item) => item.condition === 'never')).toBe(true)
    run = scenario(run, 'startup')
    expect(task(run, 'startup').done).toBe(false)
    run = deploy(run)
    run = scenario(run, 'startup')
    expect(task(run, 'startup').done).toBe(true)
  })

  it('keeps current proof for no-op edits and publication, then invalidates changed deployments even on return', () => {
    let run = scenario(prepared(), 'startup')
    const appId = probesIndependentLab.scenarios.startup.appId
    const generation = run.runtime.deploymentsByApp[appId].active.generation
    run = command(run, 'az containerapp update -g rg-aca-probes-independent -n api-probes-independent --tags owner=training')
    run = save(run, yaml, config([...defaultProbes].reverse(), 'ACRPROBESINDEPENDENT.azurecr.io/API:v1'))
    run = deploy(run)
    run = build(run)
    expect(run.runtime.deploymentsByApp[appId].active.generation).toBe(generation)
    expect(task(run, 'startup').done).toBe(true)
    const changed = defaultProbes.map((item) => item.type === 'Readiness' ? { ...item, failureThreshold: 3 } : item)
    run = save(run, yaml, config(changed))
    run = deploy(run)
    expect(task(run, 'startup').done).toBe(false)
    run = save(run, yaml, config())
    run = deploy(run)
    expect(task(run, 'startup').done).toBe(false)
  })

  it('invalidates source proof after an away-and-back deployment and failed desired update', () => {
    let run = scenario(prepared(), 'startup')
    const original = latest(run).measurements
    const wrong = INDEPENDENT_PROBE_SOLUTION_FILES[program].replace('HealthState.Responsive ? Results.Ok()', 'HealthState.DependencyAvailable ? Results.Ok()')
    run = save(run, program, wrong)
    expect(task(run, 'startup').done).toBe(true)
    run = build(run)
    expect(task(run, 'startup').done).toBe(true)
    run = deploy(run)
    expect(task(run, 'startup').done).toBe(false)
    run = save(run, program, INDEPENDENT_PROBE_SOLUTION_FILES[program])
    run = build(run)
    run = deploy(run)
    expect(task(run, 'startup').done).toBe(false)
    run = scenario(run, 'startup')
    expect(task(run, 'startup').done).toBe(true)
    run = save(run, yaml, config(defaultProbes, 'acrprobesindependent.azurecr.io/api:missing'))
    const result = applyRunAction(run, { type: 'command', line: 'az containerapp update -g rg-aca-probes-independent -n api-probes-independent --yaml containerapp.yaml' }, probesIndependentLab)
    expect(result.run.runtime.deploymentsByApp[probesIndependentLab.scenarios.startup.appId].status).toBe('failed')
    expect(task(result.run, 'startup').done).toBe(false)
    expect(latest(result.run).measurements).toEqual(latest(run).measurements)
    expect(original.samples).toHaveLength(80)
  })

  it('rejects unsupported transport and malformed JSON without replacing the active policy', () => {
    let run = prepared()
    const active = Object.values(run.runtime.deploymentsByApp)[0].active.probeConfig
    const unsupported = config(defaultProbes.map((item) => item.type === 'Liveness'
      ? { ...item, httpGet: { ...item.httpGet, scheme: 'HTTPS' } } : item))
    for (const text of [unsupported, 'properties:\n  template: broken']) {
      const saved = applyRunAction(run, { type: 'save-file', path: yaml, text }, probesIndependentLab)
      expect(saved.diagnostics).toEqual([])
      const attempted = applyRunAction(saved.run, { type: 'command', line: 'az containerapp update -g rg-aca-probes-independent -n api-probes-independent --yaml containerapp.yaml' }, probesIndependentLab)
      expect(attempted.lines.some((line) => line.kind === 'err')).toBe(true)
      expect(Object.values(attempted.run.runtime.deploymentsByApp)[0].active.probeConfig).toEqual(active)
    }
  })

  it('does not record or accept partial, paused, cancelled, or injected runs', () => {
    let run = prepared()
    for (const value of [
      { type: 'scenario-start', scenarioId: 'readiness', faults: [] },
      { type: 'simulation-advance', seconds: 100, outcome: 'passed' },
    ]) {
      const result = applyRunAction(run, value, probesIndependentLab)
      expect(result.diagnostics[0].code).toBe('INVALID_ACTION')
      expect(result.run).toEqual(run)
    }
    run = apply(run, { type: 'scenario-start', scenarioId: 'startup' })
    run = apply(run, { type: 'simulation-advance', seconds: 40 })
    run = apply(run, { type: 'scenario-pause' })
    const paused = applyRunAction(run, { type: 'simulation-advance', seconds: 40 }, probesIndependentLab)
    expect(paused.diagnostics[0].code).toBe('INVALID_ACTION')
    expect(paused.run).toEqual(run)
    expect(task(run, 'startup').done).toBe(false)
    expect(run.evidence.experimentsById).toEqual({})
    run = apply(run, { type: 'scenario-cancel' })
    expect(task(run, 'startup').done).toBe(false)
  })

  it('requires fresh proof when a later completed attempt of the same scenario fails', () => {
    let run = scenario(prepared(), 'startup')
    expect(task(run, 'startup').done).toBe(true)
    run = save(run, yaml, config(defaultProbes.map((item) => item.type === 'Startup' ? { ...item, failureThreshold: 3 } : item)))
    run = deploy(run)
    run = scenario(run, 'startup')
    expect(latest(run).outcome).toBe('failed')
    expect(task(run, 'startup').done).toBe(false)
    run = save(run, yaml, config())
    run = deploy(run)
    expect(task(run, 'startup').done).toBe(false)
  })

  it('runs displayed Solution actions and creates one readonly native Result across reload and Restart', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(probesIndependentLab.id, { repository })
    const attempt = store.behavioralRun.attemptId
    await store.revealHint('startup')
    await store.revealSolution('startup')
    await store.dispatchBehavioral({ type: 'scenario-start', scenarioId: 'readiness' })
    await store.dispatchBehavioral({ type: 'simulation-advance', seconds: 40 })
    await store.dispatchBehavioral({ type: 'scenario-pause' })
    await store.reload()
    expect(store.behavioralRun.runtime.activeScenario).toMatchObject({ scenarioId: 'readiness', elapsedSeconds: 40, paused: true })
    await store.dispatchBehavioral({ type: 'scenario-cancel' })
    for (const task of probesIndependentLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') await store.dispatchBehavioral({ type: 'save-file', path: step.path, text: step.content })
      else if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(step.action)
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    expect(repository.results[0]).toMatchObject({ labId: probesIndependentLab.id, hintsUsed: 1, solutionsUsed: 1 })
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    await expect(store.dispatchBehavioral({ type: 'scenario-start', scenarioId: 'startup' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(repository.results).toHaveLength(1)
  })
})
