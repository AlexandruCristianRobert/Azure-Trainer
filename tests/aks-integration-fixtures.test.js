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
})
