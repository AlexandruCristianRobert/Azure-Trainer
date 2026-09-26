import { describe, expect, it } from 'vitest'
import { act, advanceHealth, healthContainer, seedHealthTest } from './helpers/aks.js'

describe('AKS probe experiment runtime cleanup', () => {
  it('clears a cancelled experiment fault without changing container lifecycle state', () => {
    const seeded = seedHealthTest({ startupSeconds: 0 })
    const active = act(advanceHealth(seeded.run, seeded.lab, 1), seeded.lab,
      { type: 'aks-probe-start', scenarioId: 'temporaryAdmissionClosure' }).run
    const faulted = advanceHealth(active, seeded.lab, 9)
    const uid = faulted.runtime.kubernetes.clusters[seeded.clusterId].health.experiment.podUids[0]
    const before = healthContainer(faulted, seeded.clusterId, uid)
    expect(before.localFaults.admissionClosed).toBe(true)
    const cancelled = act(faulted, seeded.lab, { type: 'aks-probe-cancel' }).run
    const after = healthContainer(cancelled, seeded.clusterId, uid)
    expect(after.localFaults).toMatchObject({ admissionClosed: false, hung: false })
    expect(after).toMatchObject({ containerId: before.containerId, restartCount: before.restartCount })
    expect(advanceHealth(cancelled, seeded.lab, 10).runtime.kubernetes.clusters[seeded.clusterId].health.experiment).toBeNull()
  })

  it('uses the Lab warmup cap before starting a relative experiment window', () => {
    const seeded = seedHealthTest({ startupSeconds: 42, probeOverrides: { startupProbe: { failureThreshold: 10 } } })
    const scenario = { ...seeded.lab.scenarios.coldStartup, durationSeconds: 30 }
    const lab = { ...seeded.lab, healthFixture: { initializationSeconds: 42, maximumWarmupSeconds: 60 },
      scenarios: { ...seeded.lab.scenarios, coldStartup: scenario } }
    const active = act(seeded.run, lab, { type: 'aks-probe-start', scenarioId: 'coldStartup' }).run
    expect(active.runtime.kubernetes.clusters[seeded.clusterId].health.experiment.endsAtMs).toBe(60_000)
    const complete = advanceHealth(active, lab, 46)
    expect(complete.runtime.kubernetes.clusters[seeded.clusterId].health.receipts.at(-1)).toMatchObject({ outcome: 'passed', endedAtMs: 46_000 })
  })

  it('fails a hanging scenario at the warmup cap when no baseline becomes ready', () => {
    const seeded = seedHealthTest({ startupSeconds: 70, probeOverrides: { startupProbe: { failureThreshold: 30 } } })
    const lab = { ...seeded.lab, healthFixture: { initializationSeconds: 70, maximumWarmupSeconds: 60 },
      scenarios: { ...seeded.lab.scenarios, processHang: { ...seeded.lab.scenarios.processHang, durationSeconds: 150 } } }
    const active = act(seeded.run, lab, { type: 'aks-probe-start', scenarioId: 'processHang' }).run
    expect(advanceHealth(active, lab, 60).runtime.kubernetes.clusters[seeded.clusterId].health.receipts.at(-1)).toMatchObject({ outcome: 'failed', endedAtMs: 60_000 })
  })

  it('runs the full hang window after a baseline reached at the warmup boundary', () => {
    const seeded = seedHealthTest({ startupSeconds: 59, probeOverrides: { startupProbe: { initialDelaySeconds: 59, failureThreshold: 1 } } })
    const lab = { ...seeded.lab, healthFixture: { initializationSeconds: 59, maximumWarmupSeconds: 60 },
      scenarios: { ...seeded.lab.scenarios, processHang: { ...seeded.lab.scenarios.processHang, durationSeconds: 150 } } }
    const active = act(seeded.run, lab, { type: 'aks-probe-start', scenarioId: 'processHang' }).run
    const atBaseline = advanceHealth(active, lab, 59)
    expect(atBaseline.runtime.kubernetes.clusters[seeded.clusterId].health.experiment.endsAtMs).toBe(159_000)
  })
})
