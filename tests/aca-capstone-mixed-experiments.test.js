import { describe, expect, it } from 'vitest'
import { probesGuidedLab } from '../src/data/labs/containerapps-journey/probes-guided.lab.js'
import { PROBE_SOLUTION_FILES, probeConfiguration } from '../src/data/templates/containerapps-dotnet/probes.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

const appId = probesGuidedLab.scenarios.startup.appId
const cpuFixture = { kind: 'cpu', version: 1, appId, title: 'CPU demand', durationSeconds: 12,
  demandCpuSecondsPerSecond: 0.2, requestCpuSeconds: 0.02,
  assess: (m) => m.finalOfferedThroughput === 10 && m.trace.length === 12 }
const lab = { ...probesGuidedLab, capabilities: { ...probesGuidedLab.capabilities, cpuScaling: true },
  scenarios: { ...probesGuidedLab.scenarios, cpu: cpuFixture },
  tasks: [...probesGuidedLab.tasks, { id: 'cpu', check: () => true,
    verification: { scenarioId: 'cpu', scenarioVersion: 1 } }] }
const probes = ['Startup', 'Readiness', 'Liveness'].map((type) => ({ type,
  httpGet: { path: `/health/${type === 'Startup' ? 'startup' : type === 'Readiness' ? 'ready' : 'live'}`, port: 8080, scheme: 'HTTP' },
  initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1,
  failureThreshold: type === 'Startup' ? 6 : 2, successThreshold: 1 }))

function apply(run, action) {
  const result = applyRunAction(run, action, lab)
  expect(result.diagnostics).toEqual([])
  return result.run
}

function setup() {
  let run = createBehavioralRun(lab, { attemptId: 'mixed-experiments' })
  run = apply(run, { type: 'save-file', path: 'src/Trainer.Api/Program.cs', text: PROBE_SOLUTION_FILES['src/Trainer.Api/Program.cs'] })
  run = apply(run, { type: 'command', line: 'az acr build --registry acrprobesguided --image api:v1 --file Dockerfile .' })
  run = apply(run, { type: 'save-file', path: 'containerapp.yaml',
    text: probeConfiguration({ appName: 'api', image: 'acrprobesguided.azurecr.io/api:v1', probes }) })
  return apply(run, { type: 'command', line: 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml' })
}

describe('mixed CPU and probe experiments', () => {
  it('runs CPU before and after a probe and records each trusted fixture result', () => {
    let run = setup()
    run = apply(run, { type: 'scenario-start', scenarioId: 'cpu' })
    expect(run.runtime.activeScenario).toMatchObject({ kind: 'cpu', scenarioId: 'cpu' })
    run = apply(run, { type: 'simulation-advance', seconds: 12 })
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask.cpu]).toMatchObject({ outcome: 'passed',
      measurements: { finalOfferedThroughput: 10 } })
    run = apply(run, { type: 'scenario-start', scenarioId: 'startup' })
    expect(run.runtime.activeScenario).toMatchObject({ kind: 'probes', scenarioId: 'startup' })
    run = apply(run, { type: 'simulation-advance', seconds: 60 })
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask.startup]).toMatchObject({ outcome: 'passed',
      measurements: { readyReplicas: 2 } })
    run = apply(run, { type: 'scenario-start', scenarioId: 'cpu' })
    run = apply(run, { type: 'simulation-advance', seconds: 12 })
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask.cpu].outcome).toBe('passed')
  })

  it.each(['cpu', 'startup'])('routes pause, resume, advance and cancel for active %s work across reload', (scenarioId) => {
    let run = setup()
    run = apply(run, { type: 'scenario-start', scenarioId })
    run = apply(run, { type: 'simulation-advance', seconds: 3 })
    run = apply(run, { type: 'scenario-pause' })
    run = JSON.parse(JSON.stringify(run))
    expect(validateBehavioralRun(run, lab).runtime.activeScenario).toMatchObject({ scenarioId, elapsedSeconds: 3, paused: true })
    expect(applyRunAction(run, { type: 'simulation-advance', seconds: 2 }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = apply(run, { type: 'scenario-resume' })
    run = apply(run, { type: 'simulation-advance', seconds: 2 })
    expect(run.runtime.activeScenario.elapsedSeconds).toBe(5)
    run = apply(run, { type: 'scenario-cancel' })
    expect(run.runtime.activeScenario).toBeNull()
    expect(run.evidence.currentEvidenceByTask[scenarioId]).toBeUndefined()
    if (scenarioId === 'cpu') expect(run.runtime.cpuByApp[appId].demandCpuSecondsPerSecond).toBe(0)
  })

  it('rejects unknown kinds and caller-supplied outcomes without changing the run', () => {
    const run = setup()
    for (const action of [
      { type: 'scenario-start', scenarioId: 'missing' },
      { type: 'scenario-start', scenarioId: 'cpu', outcome: 'passed' },
      { type: 'scenario-start', scenarioId: 'startup', faults: [] },
    ]) {
      const result = applyRunAction(run, action, lab)
      expect(result.diagnostics[0].code).toBe('INVALID_ACTION')
      expect(result.run).toBe(run)
    }
    const unknown = { ...lab, scenarios: { ...lab.scenarios, strange: { ...cpuFixture, kind: 'strange' } },
      tasks: [...lab.tasks, { id: 'strange', check: () => true, verification: { scenarioId: 'strange', scenarioVersion: 1 } }] }
    const result = applyRunAction(run, { type: 'scenario-start', scenarioId: 'strange' }, unknown)
    expect(result.diagnostics[0].code).toBe('INVALID_ACTION')
    expect(result.run).toBe(run)

    let active = apply(run, { type: 'scenario-start', scenarioId: 'cpu' })
    expect(applyRunAction(active, { type: 'simulation-advance', seconds: 12, outcome: 'passed' }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    active = { ...active, runtime: { ...active.runtime,
      activeScenario: { ...active.runtime.activeScenario, kind: 'strange' } } }
    for (const control of [
      { type: 'simulation-advance', seconds: 1 }, { type: 'scenario-pause' },
      { type: 'scenario-resume' }, { type: 'scenario-cancel' },
    ]) {
      const rejected = applyRunAction(active, control, lab)
      expect(rejected.diagnostics[0].code).toBe('INVALID_ACTION')
      expect(rejected.run).toBe(active)
    }
  })

  it('resumes old CPU state without a kind on a dual-capability lab', () => {
    let run = setup()
    run = apply(run, { type: 'scenario-start', scenarioId: 'cpu' })
    run = apply(run, { type: 'simulation-advance', seconds: 3 })
    delete run.runtime.activeScenario.kind
    run = JSON.parse(JSON.stringify(run))
    run = apply(run, { type: 'scenario-pause' })
    run = apply(run, { type: 'scenario-resume' })
    run = apply(run, { type: 'simulation-advance', seconds: 9 })
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask.cpu].outcome).toBe('passed')
  })

  it('does not treat a probe scenario with its kind removed as legacy CPU work', () => {
    let run = setup()
    run = apply(run, { type: 'scenario-start', scenarioId: 'startup' })
    run = apply(run, { type: 'simulation-advance', seconds: 3 })
    delete run.runtime.activeScenario.kind
    run = JSON.parse(JSON.stringify(run))
    for (const control of [
      { type: 'simulation-advance', seconds: 1 }, { type: 'scenario-pause' },
      { type: 'scenario-resume' }, { type: 'scenario-cancel' },
    ]) {
      const rejected = applyRunAction(run, control, lab)
      expect(rejected.diagnostics[0].code).toBe('INVALID_ACTION')
      expect(rejected.run).toBe(run)
    }
  })
})
