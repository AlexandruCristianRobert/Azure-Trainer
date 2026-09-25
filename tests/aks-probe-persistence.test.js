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
  ]) {
    const candidate = structuredClone(active)
    corrupt(candidate.runtime.kubernetes.clusters[clusterId].health.experiment)
    expect(() => validateBehavioralRun(candidate, lab)).toThrow()
  }
  const oversized = structuredClone(active)
  oversized.runtime.kubernetes.clusters[clusterId].health.events = Array(1001).fill({ kind: 'probe', atMs: 0 })
  expect(() => validateBehavioralRun(oversized, lab)).toThrow()
})
