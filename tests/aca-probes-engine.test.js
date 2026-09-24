import { describe, expect, it } from 'vitest'
import { deployGuidedLab } from '../src/data/labs/containerapps-journey/deploy-guided.lab.js'
import { PROBE_MANIFEST, PROBE_STARTER_FILES, PROBE_SOLUTION_FILES, probeConfiguration } from '../src/data/templates/containerapps-dotnet/probes.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { simulateRequest } from '../src/lib/simulation/requests.js'

const appId = deployGuidedLab.scenarios.info.appId
const image = 'acrguided.azurecr.io/api:v1'
const yamlPath = 'containerapp.yaml'
const probe = (type, path, changes = {}) => ({ type, httpGet: { path, port: 8080, scheme: 'HTTP' },
  initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1, failureThreshold: 2, successThreshold: 1, ...changes })
const probes = [probe('Startup', '/health/startup', { failureThreshold: 6 }),
  probe('Readiness', '/health/ready'), probe('Liveness', '/health/live')]
const config = (items = probes, reference = image) => probeConfiguration({ appName: 'api', image: reference, probes: items })
const fixture = (faults = [], assess = () => true, changes = {}) => ({ kind: 'probes', version: 1, appId,
  title: 'Measured probe behavior', durationSeconds: 90, startupSeconds: 20, requestsPerSecond: 2,
  faults, assess, ...changes })
const labFor = (scenario = fixture()) => ({ ...deployGuidedLab, id: 'probe-engine-test',
  capabilities: { acrBuild: true, healthProbes: true }, manifestId: PROBE_MANIFEST.id,
  initialProjectFiles: { ...PROBE_SOLUTION_FILES, [yamlPath]: config([]) },
  scenarios: { exercise: scenario }, tasks: [{ id: 'exercise', check: () => true,
    verification: { scenarioId: 'exercise', scenarioVersion: 1 },
    dependencies: { [`probes:${appId}`]: ({ runtime }) => runtime.deploymentsByApp[appId]?.active?.generation ?? null } }] })
const action = (run, value, lab) => applyRunAction(run, value, lab)
const done = (run, value, lab) => {
  const result = action(run, value, lab)
  expect(result.diagnostics, JSON.stringify(value)).toEqual([])
  expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(value)).toEqual([])
  return result.run
}
function setup(lab = labFor(), items = probes) {
  let run = createBehavioralRun(lab, { attemptId: 'probe-engine' })
  for (const task of [deployGuidedLab.tasks[0], deployGuidedLab.tasks[3], deployGuidedLab.tasks[4], deployGuidedLab.tasks[6]]) {
    for (const step of task.solution.steps) run = done(run, { type: 'command', line: step.line }, lab)
  }
  run = done(run, { type: 'command', line: 'az acr build --registry acrguided --image api:v1 --file Dockerfile .' }, lab)
  run = done(run, { type: 'command', line: deployGuidedLab.tasks[7].solution.steps[0].line }, lab)
  run = done(run, { type: 'save-file', path: yamlPath, text: config(items) }, lab)
  run = done(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml' }, lab)
  return run
}
const start = (run, lab) => done(run, { type: 'scenario-start', scenarioId: 'exercise' }, lab)
const advance = (run, seconds, lab) => done(run, { type: 'simulation-advance', seconds }, lab)
const evidence = (run) => Object.values(run.evidence.experimentsById).at(-1)

describe('probe simulation through saved build and deployment', () => {
  it('treats absent readiness as success only after configured startup succeeds', () => {
    const lab = labFor()
    const withoutReadiness = probes.filter((item) => item.type !== 'Readiness')
    let run = start(setup(lab, withoutReadiness), lab)
    run = advance(run, 19, lab)
    expect(run.runtime.probesByApp[appId].replicas.every((replica) => replica.ready === false)).toBe(true)
    expect(run.runtime.probesByApp[appId].requests.every((request) => request.status === 503)).toBe(true)
    run = advance(run, 1, lab)
    expect(run.runtime.probesByApp[appId].replicas.every((replica) => replica.startupComplete && replica.ready)).toBe(true)
    expect(run.runtime.probesByApp[appId].requests.filter((request) => request.second === 20).every((request) => request.status === 200)).toBe(true)
  })

  it('allows traffic with no configured probes but records no invented probe checks', () => {
    const lab = labFor()
    const run = advance(start(setup(lab, []), lab), 1, lab)
    const state = run.runtime.probesByApp[appId]
    expect(state.replicas.every((replica) => replica.ready)).toBe(true)
    expect(state.requests).toHaveLength(2)
    expect(state.requests.every((request) => request.status === 200)).toBe(true)
    expect(state.events).toEqual([])
  })
  it('gates readiness and liveness until startup succeeds at 20 seconds and records measured requests', () => {
    const lab = labFor()
    let run = start(setup(lab), lab)
    run = advance(run, 19, lab)
    const state = run.runtime.probesByApp[appId]
    expect(state.replicas).toHaveLength(2)
    expect(state.events.filter((event) => ['Readiness', 'Liveness'].includes(event.probeType))).toEqual([])
    expect(state.replicas.every((replica) => replica.restartCount === 0 && replica.ready === false)).toBe(true)
    run = advance(run, 1, lab)
    expect(run.runtime.probesByApp[appId].replicas.every((replica) => replica.startupComplete && replica.ready)).toBe(true)
    run = advance(run, 70, lab)
    expect(evidence(run).measurements).toMatchObject({ readyReplicas: 2, restarts: 0 })
    expect(evidence(run).measurements.requests).toHaveLength(180)
    expect(evidence(run).measurements.requests.filter((request) => request.second < 20).every((request) => request.status === 503)).toBe(true)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
  })

  it('routes around a readiness fault without restart and restores the replica after recovery checks', () => {
    const lab = labFor(fixture([{ atSecond: 35, replica: 0, type: 'readiness', active: true },
      { atSecond: 55, replica: 0, type: 'readiness', active: false }]))
    const run = advance(start(setup(lab), lab), 90, lab)
    const measurements = evidence(run).measurements
    const affected = `${appId}#0`
    expect(measurements.restarts).toBe(0)
    expect(measurements.samples.find((sample) => sample.second === 40).readyReplicas).toBe(1)
    expect(measurements.requests.some((request) => request.second >= 35 && request.second < 40
      && request.replicaId === affected && request.status === 503)).toBe(true)
    expect(measurements.requests.filter((request) => request.second >= 40 && request.second < 55).every((request) => request.replicaId !== affected && request.status === 200)).toBe(true)
    expect(measurements.requests.some((request) => request.second >= 55 && request.replicaId === affected && request.status === 200)).toBe(true)
  })

  it('times out a hung process, restarts it once, then requires fresh startup while preserving dependency faults', () => {
    const lab = labFor(fixture([{ atSecond: 35, replica: 0, type: 'hang', active: true },
      { atSecond: 35, replica: 0, type: 'dependency', active: true }]))
    const run = advance(start(setup(lab), lab), 90, lab)
    const measurements = evidence(run).measurements
    const restart = measurements.events.find((event) => event.type === 'restart' && event.replicaId === `${appId}#0`)
    expect(restart.probeType).toBe('Liveness')
    expect(restart.second).toBeLessThanOrEqual(50)
    expect(measurements.events.some((event) => event.type === 'startup-complete' && event.replicaId === `${appId}#0` && event.second >= restart.second + 20)).toBe(true)
    expect(run.runtime.probesByApp[appId].replicas[0].faults).toMatchObject({ hang: false, dependency: true })
  })

  it('rejects action injection and incomplete or paused experiments without evidence, and survives JSON reload', () => {
    const lab = labFor()
    let run = start(setup(lab), lab)
    for (const value of [{ type: 'scenario-start', scenarioId: 'exercise', faults: [] },
      { type: 'simulation-advance', seconds: 301 }, { type: 'simulation-advance', seconds: 1, outcome: 'passed' }]) {
      const result = action(run, value, lab)
      expect(result.diagnostics[0].code).toBe('INVALID_ACTION')
      expect(result.run).toBe(run)
    }
    run = advance(run, 30, lab)
    run = done(run, { type: 'scenario-pause' }, lab)
    run = JSON.parse(JSON.stringify(run))
    expect(action(run, { type: 'simulation-advance', seconds: 1 }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    expect(Object.keys(run.evidence.experimentsById)).toHaveLength(0)
    run = done(run, { type: 'scenario-resume' }, lab)
    const chunked = advance(run, 60, lab)
    const combined = advance(start(setup(lab), lab), 90, lab)
    expect(evidence(chunked).measurements).toEqual(evidence(combined).measurements)
    expect(done(start(setup(lab), lab), { type: 'scenario-cancel' }, lab).evidence.experimentsById).toEqual({})
  })

  it('invalidates completed evidence and active work on semantic deployment changes but preserves no-ops', () => {
    const lab = labFor(fixture([], () => true, { durationSeconds: 30 }))
    let run = advance(start(setup(lab), lab), 30, lab)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    const generation = run.dependencyGenerations[`probes:${appId}`]
    run = done(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --tags team=training' }, lab)
    run = done(run, { type: 'save-file', path: yamlPath, text: config([...probes].reverse(), 'ACRGUIDED.azurecr.io/API:v1') }, lab)
    run = done(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml' }, lab)
    expect(run.dependencyGenerations[`probes:${appId}`]).toBe(generation)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = start(run, lab)
    const altered = probes.map((item) => item.type === 'Readiness' ? { ...item, failureThreshold: 3 } : item)
    run = done(run, { type: 'save-file', path: yamlPath, text: config(altered) }, lab)
    expect(run.runtime.activeScenario).not.toBe(null)
    run = done(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml' }, lab)
    expect(run.runtime.activeScenario).toBe(null)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
  })

  it('routes manual requests through ready replicas without mutating the input run', () => {
    const lab = labFor()
    let run = setup(lab)
    const before = structuredClone(run)
    expect(simulateRequest(run, { appId, method: 'GET', path: '/api/info' }).status).toBe(503)
    expect(run).toEqual(before)
    run = advance(start(run, lab), 21, lab)
    const result = action(run, { type: 'request', appId, method: 'GET', path: '/api/info' }, lab)
    expect(result.lines[0].status).toBe(200)
    expect(result.run.runtime.probesByApp[appId].manualRoundRobinCursor).toBe(run.runtime.probesByApp[appId].manualRoundRobinCursor + 1)
    expect(run.runtime.probesByApp[appId].roundRobinCursor).toBe(4)
  })

  it('makes failure, timeout, and recovery thresholds change observed seconds', () => {
    const startupLoop = probes.map((item) => item.type === 'Startup' ? { ...item, failureThreshold: 2 } : item)
    let lab = labFor(fixture([], () => false, { durationSeconds: 30 }))
    let run = advance(start(setup(lab, startupLoop), lab), 30, lab)
    expect(evidence(run).measurements.events.some((event) => event.type === 'restart' && event.probeType === 'Startup' && event.second === 10)).toBe(true)
    expect(evidence(run).measurements.events.some((event) => event.type === 'startup-complete')).toBe(false)

    const delayedRecovery = probes.map((item) => item.type === 'Readiness'
      ? { ...item, successThreshold: 3 } : item)
    lab = labFor(fixture([{ atSecond: 35, replica: 0, type: 'readiness', active: true },
      { atSecond: 55, replica: 0, type: 'readiness', active: false }]))
    run = advance(start(setup(lab, delayedRecovery), lab), 90, lab)
    const changes = evidence(run).measurements.events.filter((event) => event.type === 'ready-change' && event.replicaId === `${appId}#0`)
    expect(changes.map((event) => [event.second, event.ready])).toEqual([[30, true], [40, false], [65, true]])

    const timeout = probes.map((item) => item.type === 'Liveness'
      ? { ...item, timeoutSeconds: 3, periodSeconds: 5 } : item)
    lab = labFor(fixture([{ atSecond: 35, replica: 0, type: 'hang', active: true }]))
    run = advance(start(setup(lab, timeout), lab), 90, lab)
    expect(evidence(run).measurements.events.find((event) => event.type === 'restart').second).toBe(43)
  })

  it('observes bad endpoints and absent probes rather than inventing successful health', () => {
    const mustObserve = (measurements) => measurements.events.some((event) => event.type === 'startup-complete')
      && measurements.events.some((event) => event.probeType === 'Readiness' && event.status === 200)
      && measurements.events.some((event) => event.probeType === 'Liveness' && event.status === 200)
      && measurements.samples.at(-1).readyReplicas === 2
    for (const items of [[], probes.filter((item) => item.type !== 'Readiness'),
      probes.map((item) => item.type === 'Startup' ? { ...item, httpGet: { ...item.httpGet, path: '/health/bad' } } : item),
      probes.map((item) => item.type === 'Readiness' ? { ...item, httpGet: { ...item.httpGet, port: 8081 } } : item),
      probes.map((item) => item.type === 'Startup' ? { ...item, initialDelaySeconds: 60 } : item)]) {
      const lab = labFor(fixture([], mustObserve, { durationSeconds: 45 }))
      const run = advance(start(setup(lab, items), lab), 45, lab)
      expect(evidence(run).outcome, JSON.stringify(items)).toBe('failed')
      expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
    }
  })

  it('aborts on failed desired deployment and deletion, while save and build alone preserve active work', () => {
    const lab = labFor(fixture([], () => true, { durationSeconds: 30 }))
    let run = advance(start(setup(lab), lab), 30, lab)
    const original = run.dependencyGenerations[`probes:${appId}`]
    run = done(run, { type: 'save-file', path: yamlPath, text: config(probes, 'acrguided.azurecr.io/api:missing') }, lab)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = start(run, lab)
    run = done(run, { type: 'command', line: 'az acr build --registry acrguided --image api:v2 --file Dockerfile .' }, lab)
    expect(run.runtime.activeScenario).not.toBe(null)
    const failed = action(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml' }, lab)
    expect(failed.run.runtime.deploymentsByApp[appId].status).toBe('failed')
    run = failed.run
    expect(run.runtime.activeScenario).toBe(null)
    expect(run.dependencyGenerations[`probes:${appId}`]).toBeGreaterThan(original)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
    expect(action(run, { type: 'scenario-start', scenarioId: 'exercise' }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = done(run, { type: 'command', line: 'az containerapp delete -g rg-aca-guided -n api-guided --yes' }, lab)
    expect(run.runtime.probesByApp[appId]).toBeUndefined()
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
  })

  it('rejects malformed fixtures and does not reuse evidence after a probe round trip', () => {
    for (const scenario of [fixture([{ atSecond: -1, replica: 0, type: 'hang', active: true }]),
      fixture([], () => true, { durationSeconds: 601 }),
      fixture([], () => true, { requestsPerSecond: 1 }),
      fixture([{ atSecond: 1, replica: 0, type: 'readiness', active: true, outcome: 'passed' }])]) {
      const lab = labFor(scenario)
      const run = setup(lab)
      expect(action(run, { type: 'scenario-start', scenarioId: 'exercise' }, lab).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'INVALID_ACTION' }))
    }
    const lab = labFor(fixture([], () => true, { durationSeconds: 30 }))
    let run = advance(start(setup(lab), lab), 30, lab)
    const firstGeneration = run.runtime.deploymentsByApp[appId].active.generation
    const altered = probes.map((item) => item.type === 'Liveness' ? { ...item, failureThreshold: 3 } : item)
    run = done(run, { type: 'save-file', path: yamlPath, text: config(altered) }, lab)
    run = done(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml' }, lab)
    run = done(run, { type: 'save-file', path: yamlPath, text: config(probes) }, lab)
    run = done(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml' }, lab)
    expect(run.runtime.deploymentsByApp[appId].active.generation).not.toBe(firstGeneration)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
  })

  it('does not reward always-successful endpoints during readiness and hang faults', () => {
    const programPath = 'src/Trainer.Api/Program.cs'
    const program = PROBE_SOLUTION_FILES[programPath]
      .replace('HealthState.StartupComplete', 'true')
      .replace('HealthState.Ready', 'true')
      .replace('HealthState.Responsive', 'true')
    const assess = (measurements) => measurements.events.some((event) => event.type === 'ready-change' && event.ready === false)
      && measurements.requests.filter((request) => request.second >= 40).every((request) => request.replicaId !== `${appId}#0`)
    const lab = { ...labFor(fixture([{ atSecond: 35, replica: 0, type: 'readiness', active: true }], assess)),
    initialProjectFiles: { ...PROBE_SOLUTION_FILES, [programPath]: program, [yamlPath]: config([]) } }
    const run = advance(start(setup(lab), lab), 90, lab)
    expect(evidence(run).measurements.restarts).toBe(0)
    expect(evidence(run).measurements.events.filter((event) => event.type === 'ready-change' && event.ready === false)).toEqual([])
    expect(evidence(run).outcome).toBe('failed')
  })

  it('keeps evidence through saved source and build, then invalidates it on source redeployment and recreation', () => {
    const lab = labFor(fixture([], () => true, { durationSeconds: 30 }))
    let run = advance(start(setup(lab), lab), 30, lab)
    const generation = run.runtime.deploymentsByApp[appId].active.generation
    const path = 'src/Trainer.Api/Program.cs'
    run = done(run, { type: 'save-file', path, text: PROBE_SOLUTION_FILES[path].replace('HealthState.Ready', 'HealthState.DependencyAvailable') }, lab)
    run = done(run, { type: 'command', line: 'az acr build --registry acrguided --image api:v2 --file Dockerfile .' }, lab)
    expect(run.runtime.deploymentsByApp[appId].active.generation).toBe(generation)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = done(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --image acrguided.azurecr.io/api:v2' }, lab)
    expect(run.runtime.deploymentsByApp[appId].active.appSpec.healthEndpoints[1].condition).toBe('dependency')
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
    run = done(run, { type: 'command', line: 'az containerapp delete -g rg-aca-guided -n api-guided --yes' }, lab)
    run = done(run, { type: 'command', line: deployGuidedLab.tasks[7].solution.steps[0].line }, lab)
    run = done(run, { type: 'save-file', path: yamlPath, text: config(probes) }, lab)
    run = done(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --yaml containerapp.yaml' }, lab)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
    expect(run.runtime.probesByApp[appId].replicas.every((replica) => replica.ready === false)).toBe(true)
  })

  it('keeps a downstream fault active after a liveness restart when readiness depends on it', () => {
    const path = 'src/Trainer.Api/Program.cs'
    const lab = { ...labFor(fixture([{ atSecond: 35, replica: 0, type: 'dependency', active: true },
      { atSecond: 35, replica: 0, type: 'hang', active: true }])),
    initialProjectFiles: { ...PROBE_SOLUTION_FILES,
      [path]: PROBE_SOLUTION_FILES[path].replace('HealthState.Ready', 'HealthState.DependencyAvailable'),
      [yamlPath]: config([]) } }
    const run = advance(start(setup(lab), lab), 90, lab)
    const measurements = evidence(run).measurements
    expect(measurements.restarts).toBe(1)
    expect(measurements.events.some((event) => event.type === 'startup-complete' && event.replicaId === `${appId}#0` && event.second > 50)).toBe(true)
    expect(measurements.samples.at(-1).readyReplicas).toBe(1)
    expect(measurements.requests.filter((request) => request.second >= 70).every((request) => request.replicaId === `${appId}#1` && request.status === 200)).toBe(true)
  })

  it('retains the full bounded event history for a 600-second repeated startup failure', () => {
    const items = probes.map((item) => item.type === 'Startup'
      ? { ...item, initialDelaySeconds: 1, periodSeconds: 1, failureThreshold: 1 } : item)
    const lab = { ...labFor(fixture([], () => false, { durationSeconds: 600 })),
      initialProjectFiles: { ...PROBE_STARTER_FILES, [yamlPath]: config([]) } }
    let run = start(setup(lab, items), lab)
    run = advance(advance(run, 300, lab), 300, lab)
    const measurements = evidence(run).measurements
    expect(measurements.samples).toHaveLength(600)
    expect(measurements.requests).toHaveLength(1200)
    expect(measurements.events[0].second).toBe(0)
    expect(measurements.events.at(-1).second).toBe(600)
    expect(measurements.events.length).toBeGreaterThan(3000)
  })

  it('keeps manual requests out of the fixed named scenario routing trace', () => {
    const lab = labFor(fixture([], () => true, { durationSeconds: 30 }))
    const partial = advance(start(setup(lab), lab), 21, lab)
    const withManual = action(partial, { type: 'request', appId, method: 'GET', path: '/api/info' }, lab)
    expect(withManual.lines[0].status).toBe(200)
    const afterManual = advance(withManual.run, 9, lab)
    const uninterrupted = advance(partial, 9, lab)
    expect(evidence(afterManual).measurements.requests).toEqual(evidence(uninterrupted).measurements.requests)
    expect(evidence(afterManual).measurements.requests).toHaveLength(60)
  })
})
