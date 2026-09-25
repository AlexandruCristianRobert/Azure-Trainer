import { describe, expect, it } from 'vitest'
import { HEALTH_FIXTURES } from '../src/data/fixtures/aks/health.js'
import { probeDependencies } from '../src/lib/kubernetes/probe-experiments.js'
import { inspectProbes } from '../src/lib/kubernetes/probe-inspection.js'
import { getServiceBackends } from '../src/lib/kubernetes/services.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { act, advanceHealth, healthContainer, seedHealthTest } from './helpers/aks.js'

const stateFor = (run, clusterId) => run.runtime.kubernetes.clusters[clusterId]

function start(run, lab, scenarioId = 'coldStartup') {
  return act(run, lab, { type: 'aks-probe-start', scenarioId }).run
}

describe('AKS controlled probe experiments and evidence', () => {
  it('declares bounded scenarios from immutable health fixture scripts', () => {
    const { lab, target } = seedHealthTest()
    for (const [id, script] of Object.entries(HEALTH_FIXTURES.scenarios)) {
      expect(lab.scenarios[id]).toMatchObject({ kind: 'aks-probe', version: 1, target,
        script, durationSeconds: expect.any(Number) })
      expect(lab.scenarios[id].durationSeconds).toBeGreaterThan(0)
      expect(lab.scenarios[id].durationSeconds).toBeLessThanOrEqual(300)
      expect(lab.tasks.find(task => task.verification?.scenarioId === id)).toMatchObject({ verification: { scenarioVersion: 1 } })
    }
  })

  it('starts only a declared experiment and leaves its source run unchanged', () => {
    const { lab, run, clusterId } = seedHealthTest()
    const before = structuredClone(run)
    const active = start(run, lab)
    expect(active.runtime.simTimeMs).toBe(0)
    expect(stateFor(active, clusterId).health.experiment).toMatchObject({
      scenarioId: 'coldStartup', status: 'active', startedAtMs: 0, endsAtMs: 30_000,
    })
    expect(run).toEqual(before)
    expect(stateFor(run, clusterId).health.experiment).toBeNull()
  })

  it('rejects caller-authored faults, outcomes, and undeclared scenario IDs atomically', () => {
    const { lab, run } = seedHealthTest()
    for (const action of [
      { type: 'aks-probe-start', scenarioId: 'coldStartup', fault: 'hung' },
      { type: 'aks-probe-start', scenarioId: 'coldStartup', outcome: 'passed' },
      { type: 'aks-probe-start', scenarioId: 'caller-script' },
    ]) {
      const result = applyProbe(run, action, lab)
      expect(result.run).toBe(run)
      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(run.runtime.simTimeMs).toBe(0)
      expect(Object.values(run.runtime.kubernetes.clusters).every(item => item.health.experiment === null)).toBe(true)
    }
  })

  it('records the cold-start window at 20 seconds and readiness after initialization', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest()
    const active = start(run, lab)
    const at20 = advanceHealth(active, lab, 20)
    const inspection20 = inspectProbes(at20, { clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant-internal' })
    expect(inspection20.containers.find(item => item.podUid === podUids[0])).toMatchObject({ ready: false,
      checks: { startup: { failures: 5 }, readiness: null } })
    const at25 = advanceHealth(at20, lab, 5)
    expect(healthContainer(at25, clusterId, podUids[0])).toMatchObject({ startupPassed: true, ready: true,
      checks: { startup: { successes: 1 } } })
    expect(getServiceBackends(at25, lab.scenarios.coldStartup.target).readyEndpoints).toHaveLength(2)
  })

  it('runs the declared admission-closure interval and restores Service readiness', () => {
    const seeded = seedHealthTest({ startupSeconds: 0 })
    const warm = advanceHealth(seeded.run, seeded.lab, 1)
    const active = start(warm, seeded.lab, 'temporaryAdmissionClosure')
    const duringFault = advanceHealth(active, seeded.lab, 9)
    expect(healthContainer(duringFault, seeded.clusterId, seeded.podUids[0])).toMatchObject({ ready: false, restartCount: 0 })
    expect(getServiceBackends(duringFault, seeded.target).readyEndpoints).toHaveLength(1)
    const recovered = advanceHealth(duringFault, seeded.lab, 16)
    expect(healthContainer(recovered, seeded.clusterId, seeded.podUids[0])).toMatchObject({ ready: true, restartCount: 0 })
    expect(getServiceBackends(recovered, seeded.target).readyEndpoints).toHaveLength(2)
  })

  it('runs the process-hang window through liveness timeout and container restart', () => {
    const seeded = seedHealthTest({ startupSeconds: 0 })
    const warm = advanceHealth(seeded.run, seeded.lab, 1)
    const oldIds = Object.fromEntries(seeded.podUids.map(uid => [uid, healthContainer(warm, seeded.clusterId, uid).containerId]))
    const active = start(warm, seeded.lab, 'processHang')
    const restarted = advanceHealth(active, seeded.lab, 18)
    expect(seeded.podUids.some(uid => healthContainer(restarted, seeded.clusterId, uid).restartCount > 0)).toBe(true)
    expect(seeded.podUids.some(uid => healthContainer(restarted, seeded.clusterId, uid).containerId !== oldIds[uid])).toBe(true)
    expect(stateFor(restarted, seeded.clusterId).health.experiment.status).toBe('active')
  })

  it('completes a declared run, reloads its immutable receipt, and ties proof freshness to the Deployment', () => {
    const seeded = seedHealthTest()
    const active = start(seeded.run, seeded.lab)
    const complete = advanceHealth(active, seeded.lab, 30)
    expect(stateFor(complete, seeded.clusterId).health.experiment).toBeNull()
    expect(stateFor(complete, seeded.clusterId).health.receipts.at(-1)).toMatchObject({ scenarioId: 'coldStartup', status: 'completed', endedAtMs: 30_000 })
    const reloaded = JSON.parse(JSON.stringify(complete))
    expect(inspectProbes(reloaded, seeded.target).receipts.at(-1)).toMatchObject({ status: 'completed', scenarioId: 'coldStartup' })

    const dependencies = probeDependencies(seeded.target)
    const select = Object.values(dependencies)[0]
    const context = value => ({ runtime: value.runtime, sandbox: value.sandbox, artifacts: value.artifacts, project: value.project })
    const before = select(context(reloaded))
    const edited = structuredClone(reloaded)
    const deployment = edited.runtime.kubernetes.clusters[seeded.clusterId].resources['Deployment/assistant/assistant']
    deployment.spec.template.spec.containers[0].image = 'acraksprobesguided.azurecr.io/assistant:health-v2'
    expect(select(context(edited))).not.toEqual(before)
    expect(reloaded.runtime.kubernetes.clusters[seeded.clusterId].resources['Deployment/assistant/assistant'].spec.template.spec.containers[0].image)
      .toBe('acraksprobesguided.azurecr.io/assistant:health-v1')
  })

  it('cancels an active run without producing completion evidence and preserves cancellation on reload', () => {
    const seeded = seedHealthTest()
    const active = start(seeded.run, seeded.lab, 'optionalAiOutage')
    const cancelled = act(active, seeded.lab, { type: 'aks-probe-cancel' }).run
    expect(stateFor(cancelled, seeded.clusterId).health.experiment).toBeNull()
    expect(stateFor(cancelled, seeded.clusterId).health.receipts.at(-1)).toMatchObject({ scenarioId: 'optionalAiOutage', status: 'cancelled' })
    expect(Object.values(cancelled.evidence.experimentsById).some(item => item.scenarioId === 'optionalAiOutage')).toBe(false)
    const reloaded = JSON.parse(JSON.stringify(cancelled))
    expect(inspectProbes(reloaded, seeded.target).receipts.at(-1)).toMatchObject({ status: 'cancelled' })
  })

  it('keeps probe inspection read-only and returns a caller-isolated timeline', () => {
    const seeded = seedHealthTest({ startupSeconds: 0 })
    const active = start(advanceHealth(seeded.run, seeded.lab, 1), seeded.lab, 'temporaryAdmissionClosure')
    const during = advanceHealth(active, seeded.lab, 9)
    const before = JSON.stringify(during)
    const view = inspectProbes(during, seeded.target)
    expect(view.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'readiness', atMs: expect.any(Number) })]))
    view.containers[0].checks.readiness.failures = 999
    view.timeline[0].kind = 'forged'
    expect(JSON.stringify(during)).toBe(before)
    expect(inspectProbes(during, seeded.target).timeline[0].kind).not.toBe('forged')
  })
})

function applyProbe(run, action, lab) {
  return applyRunAction(run, action, lab)
}
