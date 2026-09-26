import { expect, it } from 'vitest'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { act, advanceHealth, seedHealthTest } from './helpers/aks.js'

it('rejects forged or unbounded active probe experiment state on reload', () => {
  const { lab, run, clusterId } = seedHealthTest()
  const started = act(run, lab, { type: 'aks-probe-start', scenarioId: 'temporaryAdmissionClosure' }).run
  const active = advanceHealth(started, lab, 5)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(active)), lab)).toBeTruthy()
  for (const corrupt of [
    experiment => { experiment.scenarioId = 'caller-invented' },
    experiment => { experiment.podUids = ['foreign-pod'] },
    experiment => { experiment.endsAtMs = experiment.startedAtMs - 1 },
    experiment => { experiment.samples = Array(101).fill({ atMs: 0 }) },
    experiment => { experiment.summary.facts.restartSchedules = Array(9).fill({ atMs: 0 }) },
    experiment => { experiment.summary.facts.readiness['foreign-pod'] = { withdrawnAt: 0, reenteredAt: 0 } },
    experiment => { experiment.summary.facts.livenessTimeoutAt = 999_999 },
  ]) {
    const candidate = structuredClone(active)
    corrupt(candidate.runtime.kubernetes.clusters[clusterId].health.experiment)
    expect(() => validateBehavioralRun(candidate, lab)).toThrow()
  }
  const oversized = structuredClone(active)
  oversized.runtime.kubernetes.clusters[clusterId].health.events = Array(1001).fill({ kind: 'probe', atMs: 0 })
  expect(() => validateBehavioralRun(oversized, lab)).toThrow()
})

it('retains a valid saved run when repeated experiments roll over the receipt history', () => {
  const seeded = seedHealthTest({ startupSeconds: 0 })
  let run = advanceHealth(act(seeded.run, seeded.lab, { type: 'aks-probe-start', scenarioId: 'temporaryAdmissionClosure' }).run, seeded.lab, 30)
  for (let index = 0; index < 40; index++) {
    run = act(run, seeded.lab, { type: 'aks-probe-start', scenarioId: 'temporaryAdmissionClosure' }).run
    run = act(run, seeded.lab, { type: 'aks-probe-cancel' }).run
  }
  run = advanceHealth(act(run, seeded.lab, { type: 'aks-probe-start', scenarioId: 'temporaryAdmissionClosure' }).run, seeded.lab, 30)
  const state = run.runtime.kubernetes.clusters[seeded.clusterId]
  expect(state.health.receipts).toHaveLength(40)
  expect(state.health.receipts.at(-1).outcome).toBe('passed')
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), seeded.lab)).toBeTruthy()
}, 30000)
