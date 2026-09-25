import { describe, expect, it } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { act, seedIntegrationTest } from './helpers/aks.js'

describe('AKS assistant integration evidence', () => {
  it('uses the immutable scenario profile and rejects a caller-selected profile', () => {
    const { run, lab } = seedIntegrationTest()
    const rejected = applyRunAction(run, { type: 'aks-request', scenarioId: 'ai-transient', integrationProfile: 'healthy' }, lab)
    expect(rejected.diagnostics.length).toBeGreaterThan(0)
    expect(rejected.run.evidence).toEqual(run.evidence)

    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-transient' }).run
    const record = observed.evidence.experimentsById[observed.evidence.currentEvidenceByTask.transient]
    expect(record.measurements.integrationTrace.profileId).toBe('embedding-throttle-once')
    expect(record.measurements.integrationTrace.attempts.filter(item => item.operation === 'embedding')).toHaveLength(2)

    const healthy = act(run, lab, { type: 'aks-request', scenarioId: 'ai-healthy' }).run
    const afterTransient = act(healthy, lab, { type: 'aks-request', scenarioId: 'ai-transient' }).run
    expect(afterTransient.dependencyGenerations).toEqual(healthy.dependencyGenerations)
    expect(afterTransient.evidence.currentEvidenceByTask.healthy).toBe(healthy.evidence.currentEvidenceByTask.healthy)
  })

  it('stales an integration proof when saved retrieval SQL no longer matches its captured image', () => {
    const { run, lab } = seedIntegrationTest()
    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-healthy' }).run
    const changed = act(observed, lab, { type: 'save-file', path: 'retrieval.sql', text: `${observed.project.savedFiles['retrieval.sql']}\n-- changed` }).run
    expect(changed.evidence.currentEvidenceByTask.healthy).toBe(observed.evidence.currentEvidenceByTask.healthy)
    expect(changed.dependencyGenerations).not.toEqual(observed.dependencyGenerations)
  })

  it('rejects persisted integration traces with unsafe bindings or impossible timing', () => {
    const { run, lab } = seedIntegrationTest()
    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-healthy' }).run
    const corrupted = structuredClone(observed)
    corrupted.runtime.kubernetes.requests[0].integrationTrace.queryBindings = { password: 'leaked' }
    expect(() => validateBehavioralRun(corrupted, lab)).toThrow()
  })
})
