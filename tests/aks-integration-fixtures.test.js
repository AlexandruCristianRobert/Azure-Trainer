import { describe, expect, it } from 'vitest'
import { INTEGRATION_FIXTURES } from '../src/data/fixtures/aks/integration.js'

describe('AKS integration fixture catalogue', () => {
  it('provides the versioned complete policy and decoy dataset without changing legacy fixtures', () => {
    expect(INTEGRATION_FIXTURES.version).toBe(1)
    expect(Object.keys(INTEGRATION_FIXTURES.documents)).toEqual([
      'training-backups', 'training-support', 'review-backups', 'review-support',
      '00-training-draft', '00-review-employee', '00-review-draft',
    ])
    expect(INTEGRATION_FIXTURES.documents['00-review-employee']).toMatchObject({ collection: 'review', audience: 'employee', published: true, embedding: [1, 0, 0] })
    expect(INTEGRATION_FIXTURES.questions['What is the travel allowance?'].embedding).toEqual([0, 0, 1])
    expect(INTEGRATION_FIXTURES.questions['How long are backups kept?'].answers['training-backups']).toBe('Training backups are kept for 30 days.')
    expect(Object.isFrozen(INTEGRATION_FIXTURES.documents['00-review-employee'].embedding)).toBe(true)
  })

  it('declares immutable request-local stage scripts for all dependency scenarios', () => {
    const scripts = INTEGRATION_FIXTURES.scenarioProfiles
    expect(Object.keys(scripts)).toEqual(['healthy', 'embedding-throttle-once', 'postgres-unavailable-once', 'answer-unavailable-always', 'answer-wait-150ms', 'embedding-timeout-always', 'retry-after-too-long'])
    expect(scripts['embedding-throttle-once'].stages.embedding).toEqual([
      { latencyMs: 40, code: 'THROTTLED', retryAfterMs: 150 }, { latencyMs: 40, result: 'success' },
    ])
    expect(scripts['answer-unavailable-always'].stages.answer).toEqual(Array(3).fill({ latencyMs: 50, code: 'UNAVAILABLE' }))
    expect(scripts['answer-wait-150ms'].stages.answer).toEqual([{ latencyMs: 150, result: 'success' }])
    expect(Object.isFrozen(scripts['healthy'].stages.embedding[0])).toBe(true)
  })
})
