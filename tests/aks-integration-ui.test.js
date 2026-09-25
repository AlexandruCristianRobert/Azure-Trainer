import { describe, expect, it } from 'vitest'
import { inspectIntegration } from '../src/lib/kubernetes/integration-inspection.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { act, seedIntegrationTest } from './helpers/aks.js'

describe('AKS integration inspection', () => {
  it('projects only the selected declared scenario and redacted request-local trace', () => {
    const { run, lab } = seedIntegrationTest()
    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-transient' }).run
    const view = inspectIntegration(observed, lab, 'ai-transient')

    expect(view.scenarioId).toBe('ai-transient')
    expect(view.question).toBe('How long are backups kept?')
    expect(view.profile.label).toBe('Throttled once')
    expect(view.validation).toEqual({ disposition: 'accepted', status: 200 })
    expect(view.vector).toMatchObject({ dimension: 3, provenance: 'embedding' })
    expect(view.bindings).toEqual({ collection: 'training', audience: 'employee', published: true, vector: '[1,0,0]', cutoff: 0.2, limit: 1 })
    expect(view.rankedDocuments).toEqual([{ id: 'training-backups', distance: expect.any(Number) }])
    expect(view.contextIds).toEqual(['training-backups'])
    expect(view.sourceIds).toEqual(['training-backups'])
    expect(view.operations.find(item => item.name === 'embedding').attempts).toHaveLength(2)
    expect(view.elapsedMs).toEqual(expect.any(Number))
    expect(JSON.stringify(view)).not.toMatch(/training-only-password|PGPASSWORD|postgres(?:ql)?:\/\//i)
  })

  it('returns an empty, read-only projection for undeclared scenarios', () => {
    const { run, lab } = seedIntegrationTest()
    expect(inspectIntegration(run, lab, 'caller-chosen')).toEqual({ scenarioId: null, available: false })
  })

  it('does not expose secret-like or unapproved binding fields from a corrupted trace', () => {
    const { run, lab } = seedIntegrationTest()
    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-healthy' }).run
    const request = observed.runtime.kubernetes.requests.at(-1)
    request.integrationTrace.queryBindings.password = 'training-only-password'
    request.integrationTrace.queryBindings.collection = 'postgres://user:password@host/database'
    request.integrationTrace.queryBindings.audience = 'training-only-password'
    const view = inspectIntegration(observed, lab, 'ai-healthy')
    expect(view.bindings.password).toBeUndefined()
    expect(view.bindings.collection).toBe('[REDACTED]')
    expect(view.bindings.audience).toBe('[REDACTED]')
    expect(JSON.stringify(view)).not.toContain('training-only-password')
    expect(JSON.stringify(view)).not.toContain('postgres://')
  })

  it('persists only bounded ranked distances from the captured retrieval result', () => {
    const { run, lab } = seedIntegrationTest()
    const observed = act(run, lab, { type: 'aks-request', scenarioId: 'ai-healthy' }).run
    expect(validateBehavioralRun(observed, lab)).toBe(observed)
    const invalid = structuredClone(observed)
    invalid.runtime.kubernetes.requests.at(-1).integrationTrace.rankedDistances[0].distance = 2.01
    expect(() => validateBehavioralRun(invalid, lab)).toThrow()
    const mismatched = structuredClone(observed)
    mismatched.runtime.kubernetes.requests.at(-1).integrationTrace.rankedDistances[0].id = 'foreign-document'
    expect(() => validateBehavioralRun(mismatched, lab)).toThrow()
  })
})
