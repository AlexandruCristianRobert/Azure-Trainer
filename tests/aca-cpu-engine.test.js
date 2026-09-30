import { describe, expect, it } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { appArmId } from '../src/lib/simulation/runtime.js'
import { reconcileCpuRuntime, advanceSimulation } from '../src/lib/simulation/cpu.js'

const group = 'rg-cpu'
const name = 'api-cpu'
const command = `az containerapp update -g ${group} -n ${name}`
const error = (result) => result.lines.filter((line) => line.kind === 'err').map((line) => line.text).join('\n')
const action = (run, value, lab) => applyRunAction(run, value, lab).run

function baseSandbox() {
  let sandbox = runLine(createSandbox(), `az group create -n ${group} -l eastus`).sandbox
  sandbox = runLine(sandbox, `az containerapp env create -g ${group} -n env-cpu`).sandbox
  return runLine(sandbox, `az containerapp create -g ${group} -n ${name} --environment env-cpu --image example.azurecr.io/api:v1 --min-replicas 1 --max-replicas 1`).sandbox
}

function cpuLab({ demand = 0.8, duration = 90, assess = () => true } = {}) {
  const sandbox = baseSandbox()
  const appId = appArmId(sandbox.containerApps[0])
  return {
    id: 'cpu-test', engineVersion: 2, contentVersion: 1,
    capabilities: { cpuScaling: true },
    cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }, { cpu: 1, memory: '2Gi' }] },
    seed: () => sandbox,
    initializeSimulation: (run) => ({ sandbox: run.sandbox, artifacts: run.artifacts,
      runtime: { ...run.runtime, deploymentsByApp: { [appId]: { status: 'succeeded', active: { generation: 'seeded-1', ingress: 'external', targetPort: 8080, listeningPort: 8080, appSpec: { routes: [] } } } } }, nextSequence: run.nextSequence }),
    scenarios: { load: { kind: 'cpu', version: 1, appId, title: 'Sustained load', durationSeconds: duration,
      demandCpuSecondsPerSecond: demand, requestCpuSeconds: 0.02, assess } },
    tasks: [{ id: 'load', check: () => true, verification: { scenarioId: 'load', scenarioVersion: 1 },
      dependencies: { [`scaling:${appId}`]: (context) => context.sandbox.containerApps[0].scaleRules } }],
  }
}

describe('CPU policy CLI', () => {
  it('gates CPU flags and CPU rules to capable Labs without mutating a rejected command', () => {
    const sandbox = baseSandbox()
    const result = runLine(sandbox, `${command} --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60`)
    expect(error(result)).toContain('CPU')
    expect(result.sandbox).toBe(sandbox)
  })

  it('parses CPU metadata and replaces prior rules in a capable Lab', () => {
    const lab = cpuLab()
    const sandbox = runLine(baseSandbox(), `${command} --scale-rule-name old`).sandbox
    const result = runLine(sandbox, `${command} --cpu 1 --memory 2Gi --max-replicas 5 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60`, { lab })
    expect(error(result)).toBe('')
    expect(result.sandbox.containerApps[0]).toMatchObject({ cpu: 1, memory: '2Gi', minReplicas: 1, maxReplicas: 5,
      scaleRules: [{ name: 'cpu', custom: { type: 'cpu', metadata: { type: 'Utilization', value: '60' } } }] })
  })

  it.each([
    ['type=Utilization value=0', 'utilization'],
    ['type=Utilization value=101', 'utilization'],
    ['type=Utilization value=60 value=70', 'duplicate'],
    ['type=AverageValue value=60', 'type'],
    ['type=Utilization value=60 mystery=yes', 'metadata'],
  ])('rejects invalid CPU metadata atomically: %s', (metadata, message) => {
    const sandbox = baseSandbox()
    const result = runLine(sandbox, `${command} --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata ${metadata}`, { lab: cpuLab() })
    expect(error(result).toLowerCase()).toContain(message)
    expect(result.sandbox).toBe(sandbox)
  })

  it('rejects unsupported resource pairs and minimum zero in a capable Lab', () => {
    const sandbox = baseSandbox()
    for (const flags of ['--cpu 1', '--min-replicas 0']) {
      const result = runLine(sandbox, `${command} ${flags}`, { lab: cpuLab() })
      expect(error(result)).not.toBe('')
      expect(result.sandbox).toBe(sandbox)
    }
  })
})

describe('CPU runtime and scenarios', () => {
  it('scales out after a 15-second decision and waits five seconds for new capacity', () => {
    const lab = cpuLab()
    let run = createBehavioralRun(lab, { attemptId: 'out' })
    run = action(run, { type: 'command', line: `${command} --max-replicas 5 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60` }, lab)
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    run = action(run, { type: 'simulation-advance', seconds: 15 }, lab)
    const state = run.runtime.cpuByApp[lab.scenarios.load.appId]
    expect(state.readyReplicas).toBe(1)
    expect(state.pendingReplicas.length).toBeGreaterThan(0)
    expect(state.samples.at(-1).servedThroughput).toBe(25)
    run = action(run, { type: 'simulation-advance', seconds: 5 }, lab)
    expect(run.runtime.cpuByApp[lab.scenarios.load.appId].readyReplicas).toBeGreaterThan(1)
  })

  it('keeps overload unsatisfied at maximum capacity and survives chunking/reload', () => {
    const lab = cpuLab({ demand: 4, duration: 90 })
    let run = createBehavioralRun(lab, { attemptId: 'overload' })
    run = action(run, { type: 'command', line: `${command} --max-replicas 5 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60` }, lab)
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    const chunked = action(action(run, { type: 'simulation-advance', seconds: 30 }, lab), { type: 'simulation-advance', seconds: 60 }, lab)
    const combined = action(JSON.parse(JSON.stringify(run)), { type: 'simulation-advance', seconds: 90 }, lab)
    expect(chunked).toEqual(combined)
    const sample = chunked.runtime.cpuByApp[lab.scenarios.load.appId].samples.at(-1)
    expect(chunked.runtime.cpuByApp[lab.scenarios.load.appId].readyReplicas).toBe(5)
    expect(sample.offeredThroughput).toBe(200)
    expect(sample.servedThroughput).toBe(125)
  })

  it('cannot pass partial, paused or cancelled scenarios or accept caller measurements', () => {
    const lab = cpuLab()
    let run = createBehavioralRun(lab, { attemptId: 'pause' })
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    const invalid = applyRunAction(run, { type: 'simulation-advance', seconds: 1, measurements: { passed: true } }, lab)
    expect(invalid.diagnostics[0].code).toBe('INVALID_ACTION')
    expect(invalid.run).toBe(run)
    expect(applyRunAction(run, { type: 'scenario-start', scenarioId: 'load', demandCpuSecondsPerSecond: 0 }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = action(run, { type: 'scenario-pause' }, lab)
    expect(applyRunAction(run, { type: 'simulation-advance', seconds: 90 }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = action(run, { type: 'scenario-cancel' }, lab)
    expect(Object.values(run.evidence.experimentsById).every((item) => item.outcome !== 'passed')).toBe(true)
  })

  it('waits for sustained quiet demand before scaling in to the minimum', () => {
    const lab = cpuLab({ demand: 0, duration: 90 })
    let run = createBehavioralRun(lab, { attemptId: 'quiet' })
    run = action(run, { type: 'command', line: `${command} --max-replicas 5 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60` }, lab)
    const id = lab.scenarios.load.appId
    run.runtime.cpuByApp[id].readyReplicas = 4
    run.runtime.cpuByApp[id].desiredReplicas = 4
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    run = action(run, { type: 'simulation-advance', seconds: 59 }, lab)
    expect(run.runtime.cpuByApp[id].readyReplicas).toBe(4)
    run = action(run, { type: 'simulation-advance', seconds: 1 }, lab)
    expect(run.runtime.cpuByApp[id].readyReplicas).toBe(1)
  })

  it('aborts active work and stales prior evidence on policy changes and deletion', () => {
    const lab = cpuLab({ duration: 15 })
    let run = createBehavioralRun(lab, { attemptId: 'stale' })
    run = action(run, { type: 'command', line: `${command} --max-replicas 5 --scale-rule-name cpu --scale-rule-type cpu --scale-rule-metadata type=Utilization value=60` }, lab)
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    run = action(run, { type: 'simulation-advance', seconds: 15 }, lab)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    const before = run.dependencyGenerations[`scaling:${lab.scenarios.load.appId}`]
    run = action(run, { type: 'command', line: `${command} --tags team=training` }, lab)
    run = action(run, { type: 'command', line: `${command} --max-replicas 5` }, lab)
    expect(run.dependencyGenerations[`scaling:${lab.scenarios.load.appId}`]).toBe(before)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    run = action(run, { type: 'command', line: `${command} --max-replicas 4` }, lab)
    expect(run.runtime.activeScenario).toBe(null)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
    run = action(run, { type: 'command', line: `az containerapp delete -g ${group} -n ${name} --yes` }, lab)
    expect(run.runtime.cpuByApp[lab.scenarios.load.appId]).toBeUndefined()
    expect(run.dependencyGenerations[`scaling:${lab.scenarios.load.appId}`]).toBeGreaterThan(before)
  })

  it('advances only to the fixture duration and records engine measurements once', () => {
    const lab = cpuLab({ demand: 0.1, duration: 30, assess: (measurements) => measurements.finalServedThroughput === 5 })
    let run = createBehavioralRun(lab, { attemptId: 'bounded' })
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    run = action(run, { type: 'simulation-advance', seconds: 300 }, lab)
    expect(run.runtime.simTimeMs).toBe(30_000)
    const record = Object.values(run.evidence.experimentsById)[0]
    expect(record).toMatchObject({ outcome: 'passed', startedAtMs: 0, endedAtMs: 30_000,
      measurements: { startReadyReplicas: 1, endReadyReplicas: 1, finalOfferedThroughput: 5, finalServedThroughput: 5 } })
    expect(record.measurements.trace).toHaveLength(30)
    expect(applyRunAction(run, { type: 'simulation-advance', seconds: 1 }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
  })

  it('rejects malformed bounds and keeps paused progress across JSON reload', () => {
    const lab = cpuLab()
    let run = createBehavioralRun(lab, { attemptId: 'reload' })
    expect(applyRunAction(run, { type: 'scenario-start', scenarioId: 'missing' }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    for (const seconds of [0, 301, 1.5]) {
      expect(applyRunAction(run, { type: 'simulation-advance', seconds }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    }
    run = action(run, { type: 'simulation-advance', seconds: 20 }, lab)
    run = action(run, { type: 'scenario-pause' }, lab)
    run = JSON.parse(JSON.stringify(run))
    expect(run.runtime.activeScenario.elapsedSeconds).toBe(20)
    expect(applyRunAction(run, { type: 'simulation-advance', seconds: 20 }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = action(run, { type: 'scenario-resume' }, lab)
    run = action(run, { type: 'simulation-advance', seconds: 70 }, lab)
    expect(run.runtime.activeScenario).toBe(null)
    expect(Object.values(run.evidence.experimentsById)).toHaveLength(1)
  })

  it('keeps another app runtime unchanged while a named app runs', () => {
    const lab = cpuLab()
    const second = runLine(lab.seed(), `az containerapp create -g ${group} -n api-other --environment env-cpu --image example.azurecr.io/api:v1 --min-replicas 1 --max-replicas 2`).sandbox
    lab.seed = () => second
    let run = createBehavioralRun(lab, { attemptId: 'two-apps' })
    run = reconcileCpuRuntime(run, lab)
    const otherId = appArmId(second.containerApps[1])
    const other = structuredClone(run.runtime.cpuByApp[otherId])
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    run = action(run, { type: 'simulation-advance', seconds: 30 }, lab)
    expect(run.runtime.cpuByApp[otherId]).toEqual(other)
  })

  it('does not reuse evidence after deletion and recreation with the same policy', () => {
    const lab = cpuLab({ demand: 0.1, duration: 15 })
    let run = createBehavioralRun(lab, { attemptId: 'recreated' })
    run = action(run, { type: 'scenario-start', scenarioId: 'load' }, lab)
    run = action(run, { type: 'simulation-advance', seconds: 15 }, lab)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    const id = lab.scenarios.load.appId
    const initialGeneration = run.dependencyGenerations[`scaling:${id}`]
    run = action(run, { type: 'command', line: `az containerapp delete -g ${group} -n ${name} --yes` }, lab)
    run = action(run, { type: 'command', line: `az containerapp create -g ${group} -n ${name} --environment env-cpu --image example.azurecr.io/api:v1 --min-replicas 1 --max-replicas 1` }, lab)
    expect(run.dependencyGenerations[`scaling:${id}`]).toBeGreaterThan(initialGeneration)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
  })

  it('blocks a new scenario after the desired deployment fails', () => {
    const lab = cpuLab()
    let run = createBehavioralRun(lab, { attemptId: 'failed-deploy' })
    run = reconcileCpuRuntime(run, lab)
    lab.capabilities.acrBuild = true
    run = action(run, { type: 'command', line: `${command} --image example.azurecr.io/api:missing` }, lab)
    expect(run.runtime.deploymentsByApp[lab.scenarios.load.appId].status).toBe('failed')
    expect(applyRunAction(run, { type: 'scenario-start', scenarioId: 'load' }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
  })
})
