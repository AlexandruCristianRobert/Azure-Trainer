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
})
