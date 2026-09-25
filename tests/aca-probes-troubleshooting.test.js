import { describe, expect, it } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { PROBE_SOLUTION_FILES, probeConfiguration } from '../src/data/templates/containerapps-dotnet/probes.js'
import { probesTroubleshootingLab } from '../src/data/labs/containerapps-journey/probes-troubleshooting.lab.js'
import { LABS, nextLabFor, labById } from '../src/data/labs/index.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

const program = 'src/Trainer.Api/Program.cs'
const image = 'acrprobesincident.azurecr.io/api:v1'
const probes = ['Startup', 'Readiness', 'Liveness'].map((type) => ({
  type, httpGet: { path: `/health/${type === 'Startup' ? 'startup' : type === 'Readiness' ? 'ready' : 'live'}`, port: 8080, scheme: 'HTTP' },
  initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1, failureThreshold: type === 'Startup' ? 6 : 2, successThreshold: 1,
}))
const config = (items = probes) => probeConfiguration({ appName: 'api', image, probes: items })
const fresh = () => createBehavioralRun(probesTroubleshootingLab, { attemptId: 'incident-test' })
function action(run, value) {
  const result = applyRunAction(run, value, probesTroubleshootingLab)
  expect(result.diagnostics, JSON.stringify(value)).toEqual([])
  expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(value)).toEqual([])
  return result.run
}
const save = (run, path, text) => action(run, { type: 'save-file', path, text })
const command = (run, line) => action(run, { type: 'command', line })
const done = (run, id) => evaluateLab(probesTroubleshootingLab, run).tasks.find((task) => task.id === id).done
function scenario(run, id, seconds) {
  run = action(run, { type: 'scenario-start', scenarioId: id })
  return action(run, { type: 'simulation-advance', seconds })
}
const latest = (run) => Object.values(run.evidence.experimentsById).at(-1)
const deploy = (run) => command(run, 'az containerapp update -g rg-aca-probes-incident -n api-probes-incident --yaml containerapp.yaml')
const build = (run) => command(run, 'az acr build --registry acrprobesincident --image api:v1 --file Dockerfile .')
function repaired() {
  let run = fresh()
  run = save(run, 'containerapp.yaml', config())
  run = deploy(run)
  run = save(run, program, PROBE_SOLUTION_FILES[program])
  run = build(run)
  run = deploy(run)
  return run
}

describe('probe troubleshooting incident', () => {
  it('supplies a real running restart loop with no learner transcript or proof', () => {
    const run = fresh()
    const state = Object.values(run.runtime.probesByApp)[0]
    expect(run.runtime.activeScenario).toMatchObject({ kind: 'probes', scenarioId: 'startup', elapsedSeconds: 30 })
    expect(state.events.filter((event) => event.type === 'restart' && event.probeType === 'Startup').map((event) => event.second)).toEqual([10, 10, 20, 20, 30, 30])
    expect(run.history).toEqual([])
    expect(run.scrollback).toEqual([])
    expect(run.hintsRevealed).toEqual({})
    expect(run.solutionsRevealed).toEqual({})
    expect(run.evidence.experimentsById).toEqual({})
    expect(run.project.savedFiles[program]).toContain('HealthState.DependencyAvailable ? Results.Ok()')
    expect(JSON.parse(run.project.savedFiles['containerapp.yaml']).properties.template.containers[0].probes[0].failureThreshold).toBe(2)
    expect(run.sandbox.containerApps[0]).toMatchObject({ name: 'api-probes-incident', cpu: 0.5, memory: '1Gi', minReplicas: 2, maxReplicas: 2 })
    expect(run.sandbox.resourceGroups[0].createdAt).toBe('2026-09-22T00:00:00.000Z')
    expect(LABS.filter((lab) => lab.journeyId === 'containerapps-end-to-end')).toHaveLength(16)
    expect(nextLabFor(labById('aca-probes-guided'))).toBe(probesTroubleshootingLab)
  })

  it('allows measured startup repair while the dependency-coupled liveness still restarts', () => {
    let run = fresh()
    run = action(run, { type: 'scenario-cancel' })
    run = save(run, 'containerapp.yaml', config())
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.probeConfig.probes[0].failureThreshold).toBe(2)
    run = deploy(run)
    run = scenario(run, 'startup', 60)
    expect(done(run, 'startup')).toBe(true)
    expect(latest(run).measurements.events.some((event) => event.type === 'startup-complete' && event.second >= 20 && event.second <= 30)).toBe(true)
    run = scenario(run, 'dependency', 100)
    const m = latest(run).measurements
    expect(m.events.some((event) => event.type === 'restart' && event.probeType === 'Liveness' && event.second >= 35 && event.second <= 70)).toBe(true)
    expect(m.events.some((event) => event.type === 'fault' && event.faultType === 'dependency' && event.active === false && event.second === 70)).toBe(true)
    expect(done(run, 'dependency')).toBe(false)
  })

  it('accepts a different supported Startup allowance when the full observations pass', () => {
    let run = fresh()
    run = save(run, 'containerapp.yaml', config(probes.map((p) => p.type === 'Startup' ? { ...p, failureThreshold: 4 } : p)))
    run = deploy(run)
    run = scenario(run, 'startup', 60)
    expect(done(run, 'startup')).toBe(true)
  })

  it('requires a deployed source repair and full ordered measurements for all three tasks', () => {
    let run = fresh()
    run = save(run, 'containerapp.yaml', config())
    run = deploy(run)
    run = scenario(run, 'startup', 60)
    expect(done(run, 'startup')).toBe(true)
    run = save(run, program, PROBE_SOLUTION_FILES[program])
    run = build(run)
    expect(done(run, 'startup')).toBe(true)
    run = deploy(run)
    expect(done(run, 'startup')).toBe(false)
    run = scenario(run, 'startup', 60)
    run = scenario(run, 'dependency', 100)
    expect(done(run, 'dependency')).toBe(true)
    const m = latest(run).measurements
    expect(m.samples).toHaveLength(100)
    expect(m.requests).toHaveLength(200)
    expect(m.requests.filter((r) => r.second >= 45 && r.second <= 69).every((r) => r.status === 200)).toBe(true)
    expect(m.restarts).toBe(0)
    run = scenario(run, 'hang', 90)
    expect(done(run, 'hang')).toBe(true)
    expect(evaluateLab(probesTroubleshootingLab, run).isComplete).toBe(true)
  })

  it('rejects absent, disabled, wrong-target, and excessively slow probes', () => {
    for (const items of [
      probes.filter((p) => p.type !== 'Readiness'),
      probes.filter((p) => p.type !== 'Liveness'),
      probes.filter((p) => p.type !== 'Startup'),
      probes.map((p) => p.type === 'Startup' ? { ...p, httpGet: { ...p.httpGet, port: 8081 } } : p),
      probes.map((p) => p.type === 'Liveness' ? { ...p, httpGet: { ...p.httpGet, path: '/health/ready' } } : p),
      probes.map((p) => p.type === 'Startup' ? { ...p, initialDelaySeconds: 60 } : p),
    ]) {
      let run = repaired()
      run = save(run, 'containerapp.yaml', config(items))
      run = deploy(run)
      run = scenario(run, 'startup', 60)
      expect(done(run, 'startup'), JSON.stringify(items)).toBe(false)
      expect(done(run, 'dependency')).toBe(false)
      expect(done(run, 'hang')).toBe(false)
    }
    let slowLiveness = repaired()
    slowLiveness = save(slowLiveness, 'containerapp.yaml', config(probes.map((p) => p.type === 'Liveness' ? { ...p, failureThreshold: 10 } : p)))
    slowLiveness = deploy(slowLiveness)
    slowLiveness = scenario(slowLiveness, 'startup', 60)
    slowLiveness = scenario(slowLiveness, 'dependency', 100)
    slowLiveness = scenario(slowLiveness, 'hang', 90)
    expect(done(slowLiveness, 'hang')).toBe(false)
  })

  it('requires real conditional endpoint behavior and a rebuilt deployed source', () => {
    for (const replacement of ['true', 'HealthState.DependencyAvailable']) {
      let run = repaired()
      run = save(run, program, PROBE_SOLUTION_FILES[program].replace('HealthState.Responsive ? Results.Ok()', `${replacement} ? Results.Ok()`))
      run = build(run)
      run = deploy(run)
      run = scenario(run, 'startup', 60)
      run = scenario(run, 'dependency', 100)
      expect(done(run, 'dependency'), replacement).toBe(false)
    }
    let run = fresh()
    run = save(run, 'containerapp.yaml', config())
    run = deploy(run)
    run = scenario(run, 'startup', 60)
    run = save(run, program, PROBE_SOLUTION_FILES[program])
    run = build(run)
    expect(done(run, 'startup')).toBe(true)
    run = scenario(run, 'dependency', 100)
    expect(done(run, 'dependency')).toBe(false)
  })

  it('keeps proof on draft, build, and semantic no-ops but invalidates on policy and source round trips', () => {
    let run = scenario(repaired(), 'startup', 60)
    const original = Object.values(run.runtime.deploymentsByApp)[0].active.generation
    run = action(run, { type: 'draft', path: program, text: PROBE_SOLUTION_FILES[program].replace('HealthState.Responsive', 'HealthState.DependencyAvailable') })
    run = save(run, 'containerapp.yaml', probeConfiguration({ appName: 'api', image: 'ACRPROBESINCIDENT.azurecr.io/API:v1', probes: [...probes].reverse() }))
    run = deploy(run)
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.generation).toBe(original)
    expect(done(run, 'startup')).toBe(true)
    run = command(run, 'az containerapp update -g rg-aca-probes-incident -n api-probes-incident --tags owner=training')
    expect(done(run, 'startup')).toBe(true)
    run = build(run)
    expect(done(run, 'startup')).toBe(true)
    run = save(run, 'containerapp.yaml', config(probes.map((p) => p.type === 'Readiness' ? { ...p, failureThreshold: 3 } : p)))
    run = deploy(run)
    expect(done(run, 'startup')).toBe(false)
    run = save(run, 'containerapp.yaml', config())
    run = deploy(run)
    expect(done(run, 'startup')).toBe(false)
    run = scenario(run, 'startup', 60)
    expect(done(run, 'startup')).toBe(true)
  })

  it('records only completed scenarios and binds hang to the latest ordered proofs', () => {
    let run = repaired()
    run = action(run, { type: 'scenario-start', scenarioId: 'startup' })
    run = action(run, { type: 'simulation-advance', seconds: 30 })
    run = action(run, { type: 'scenario-pause' })
    run = JSON.parse(JSON.stringify(run))
    expect(run.runtime.activeScenario).toMatchObject({ paused: true, elapsedSeconds: 30 })
    expect(run.evidence.experimentsById).toEqual({})
    run = action(run, { type: 'scenario-resume' })
    run = action(run, { type: 'scenario-cancel' })
    expect(run.evidence.experimentsById).toEqual({})
    run = scenario(run, 'startup', 60)
    run = scenario(run, 'dependency', 100)
    run = scenario(run, 'hang', 90)
    expect(done(run, 'hang')).toBe(true)
    run = scenario(run, 'dependency', 100)
    expect(done(run, 'hang')).toBe(false)
  })

  it('rejects caller supplied faults and outcomes', () => {
    let run = repaired()
    for (const value of [
      { type: 'scenario-start', scenarioId: 'dependency', faults: [] },
      { type: 'simulation-advance', seconds: 1, outcome: 'passed' },
    ]) {
      const result = applyRunAction(run, value, probesTroubleshootingLab)
      expect(result.diagnostics[0].code).toBe('INVALID_ACTION')
      expect(result.run).toEqual(run)
    }
  })

  it('completes the displayed worked solutions through learner actions', () => {
    let run = fresh()
    run = action(run, { type: 'scenario-cancel' })
    for (const task of probesTroubleshootingLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') run = save(run, step.path, step.content)
      else if (step.kind === 'command') run = command(run, step.line)
      else run = action(run, step.action)
    }
    expect(evaluateLab(probesTroubleshootingLab, run).isComplete).toBe(true)
  })

  it('blocks old proof after a failed desired update and keeps its captured trace', () => {
    let run = scenario(repaired(), 'startup', 60)
    const earlier = latest(run).measurements
    const wrongImage = probeConfiguration({ appName: 'api', image: 'acrprobesincident.azurecr.io/api:missing', probes })
    run = save(run, 'containerapp.yaml', wrongImage)
    expect(done(run, 'startup')).toBe(true)
    const failed = applyRunAction(run, { type: 'command', line: 'az containerapp update -g rg-aca-probes-incident -n api-probes-incident --yaml containerapp.yaml' }, probesTroubleshootingLab)
    expect(failed.run.runtime.deploymentsByApp[probesTroubleshootingLab.scenarios.startup.appId].status).toBe('failed')
    expect(done(failed.run, 'startup')).toBe(false)
    expect(Object.values(failed.run.evidence.experimentsById).at(-1).measurements).toEqual(earlier)
  })

  it('invalidates source proof across a deployment round trip and rejects unconditional health routes', () => {
    let run = scenario(repaired(), 'startup', 60)
    run = scenario(run, 'dependency', 100)
    expect(done(run, 'dependency')).toBe(true)
    run = save(run, program, PROBE_SOLUTION_FILES[program].replace('HealthState.Responsive ? Results.Ok()', 'HealthState.DependencyAvailable ? Results.Ok()'))
    run = build(run)
    run = deploy(run)
    expect(done(run, 'startup')).toBe(false)
    run = save(run, program, PROBE_SOLUTION_FILES[program])
    run = build(run)
    run = deploy(run)
    expect(done(run, 'startup')).toBe(false)
    expect(done(run, 'dependency')).toBe(false)
    for (const condition of ['HealthState.StartupComplete', 'HealthState.Ready']) {
      let faulty = repaired()
      faulty = save(faulty, program, PROBE_SOLUTION_FILES[program].replace(`${condition} ? Results.Ok()`, 'true ? Results.Ok()'))
      faulty = build(faulty)
      faulty = deploy(faulty)
      faulty = scenario(faulty, 'startup', 60)
      expect(done(faulty, 'startup'), condition).toBe(false)
    }
  })

  it('persists a paused incident and writes one readonly Result with assistance counts', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(probesTroubleshootingLab.id, { repository })
    await store.revealHint('startup')
    await store.revealSolution('dependency')
    const attempt = store.behavioralRun.attemptId
    expect(store.behavioralRun.runtime.activeScenario).toMatchObject({ elapsedSeconds: 30 })
    await store.dispatchBehavioral({ type: 'scenario-pause' })
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.behavioralRun.runtime.activeScenario).toMatchObject({ elapsedSeconds: 30, paused: true })
    await store.dispatchBehavioral({ type: 'scenario-cancel' })
    for (const task of probesTroubleshootingLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') await store.dispatchBehavioral({ type: 'save-file', path: step.path, text: step.content })
      else if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(step.action)
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    expect(repository.results[0]).toMatchObject({ labId: probesTroubleshootingLab.id, hintsUsed: 1, solutionsUsed: 1 })
    await expect(store.dispatchBehavioral({ type: 'scenario-start', scenarioId: 'startup' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.behavioralRun.runtime.activeScenario).toMatchObject({ elapsedSeconds: 30 })
    expect(repository.results).toHaveLength(1)
  })
})
