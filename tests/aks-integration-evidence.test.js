import { describe, expect, it } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { integrationDependencies } from '../src/lib/kubernetes/evidence.js'
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

  it('stales proof after a Secret change is applied and captured without exporting its value', () => {
    const { run, lab, clusterId } = seedIntegrationTest()
    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-healthy' }).run
    const selector = Object.values(integrationDependencies({ clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant-public' }))[0]
    const before = selector({ ...observed, run: observed })
    const secret = observed.project.savedFiles['k8s/secret.yaml'].replace('training-only-password', 'rotated-training-password')
    let changed = act(observed, lab, { type: 'save-file', path: 'k8s/secret.yaml', text: secret }).run
    changed = act(changed, lab, { type: 'command', line: 'kubectl apply -f k8s/secret.yaml' }).run
    changed = act(changed, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }).run
    const after = selector({ ...changed, run: changed })
    expect(after.pods[0].secretDigest).not.toBe(before.pods[0].secretDigest)
    expect(JSON.stringify(after)).not.toContain('rotated-training-password')
    expect(changed.dependencyGenerations).not.toEqual(observed.dependencyGenerations)
  })

  it('rejects persisted integration traces with unsafe bindings or impossible timing', () => {
    const { run, lab } = seedIntegrationTest()
    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-healthy' }).run
    const corrupted = structuredClone(observed)
    corrupted.runtime.kubernetes.requests[0].integrationTrace.queryBindings = { password: 'leaked' }
    expect(() => validateBehavioralRun(corrupted, lab)).toThrow()

    const malformed = structuredClone(observed)
    malformed.runtime.kubernetes.requests[0].integrationTrace.queryBindings = { collection: { leaked: true } }
    expect(() => validateBehavioralRun(malformed, lab)).toThrow()
  })

  it('accepts retrieval binding boundaries and rejects values outside the retrieval contract', () => {
    const { run, lab } = seedIntegrationTest()
    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-healthy' }).run
    const valid = structuredClone(observed)
    valid.runtime.kubernetes.requests[0].integrationTrace.queryBindings = {
      collection: 'training', audience: 'employee', published: true,
      vector: '[1e+308,0,0]', cutoff: 2, limit: 3,
    }
    expect(validateBehavioralRun(valid, lab)).toBe(valid)

    for (const bindings of [
      { collection: 'training', audience: 'employee', published: true, vector: '[1,0,0]', cutoff: 2.1, limit: 1 },
      { collection: 'training', audience: 'employee', published: true, vector: '[1,0,0]', cutoff: 2, limit: 0 },
      { collection: 'training', audience: 'employee', published: true, vector: '[1,0,0]', cutoff: 2, limit: 4 },
    ]) {
      const invalid = structuredClone(observed)
      invalid.runtime.kubernetes.requests[0].integrationTrace.queryBindings = bindings
      expect(() => validateBehavioralRun(invalid, lab)).toThrow()
    }
  })
})
