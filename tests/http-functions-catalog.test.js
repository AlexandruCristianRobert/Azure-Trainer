import { describe, it, expect } from 'vitest'
import { LABS, labById, nextLabFor } from '../src/data/labs/index.js'

describe('HTTP Functions journey catalog', () => {
  it('registers exactly nine independently startable ordered records with journey-only navigation', async () => {
    const { HTTP_FUNCTIONS_LABS } = await import('../src/data/labs/http-functions-journey/index.js')
    expect(HTTP_FUNCTIONS_LABS).toHaveLength(9)
    expect(HTTP_FUNCTIONS_LABS.map(lab => lab.id)).toEqual([
      'http-functions-start', 'http-functions-status', 'http-functions-validation', 'http-functions-enqueue',
      'http-functions-retries', 'http-functions-publish', 'http-functions-keys', 'http-functions-binding', 'http-functions-capstone',
    ])
    expect(HTTP_FUNCTIONS_LABS.map(lab => lab.journeyOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(HTTP_FUNCTIONS_LABS.map(lab => lab.labMode)).toEqual(['guided', 'guided', 'guided', 'guided', 'guided', 'guided', 'guided', 'guided', 'capstone'])
    expect(LABS.filter(lab => lab.journeyId === 'http-functions-orders')).toEqual(HTTP_FUNCTIONS_LABS)
    HTTP_FUNCTIONS_LABS.forEach((lab, index) => {
      expect(LABS.filter(row => row.id === lab.id)).toHaveLength(1)
      expect(labById(lab.id)).toBe(lab)
      expect(nextLabFor(lab)).toBe(HTTP_FUNCTIONS_LABS[index + 1] ?? null)
      expect(lab.skillAreaId).toBe('connect')
      expect(lab.engineVersion).toBe(2)
      expect(lab.contentVersion).toBe(1)
      expect(lab.manifestId).toBe('http-functions-python-v1')
    })
  })
})
