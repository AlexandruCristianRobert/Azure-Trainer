import { describe, expect, it } from 'vitest'
import { pointReadCharge, writeCharge, queryCharge, applyThroughput } from '../src/lib/data/cosmos-cost.js'

const policy = (excluded = []) => ({ indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: excluded })

describe('cosmos cost model', () => {
  it('charges ~1 RU for a small point read and doubles it for Strong', () => {
    expect(pointReadCharge({ id: 'a', text: 'x' }, 'Session')).toBe(1)
    expect(pointReadCharge({ id: 'a', text: 'x' }, 'Strong')).toBe(2)
  })
  it('makes writes cheaper when the embedding array is excluded from indexing', () => {
    const item = { id: 'a', q: 'x', embedding: [1, 2, 3, 4, 5, 6, 7, 8] }
    expect(writeCharge(item, policy([{ path: '/embedding/*' }]))).toBeLessThan(writeCharge(item, policy()))
  })
  it('adds fan-out cost for cross-partition queries', () => {
    const one = queryCharge({ scanned: 2, partitionsTouched: 1, vector: false }, 'Session')
    const four = queryCharge({ scanned: 2, partitionsTouched: 4, vector: false }, 'Session')
    expect(four - one).toBeCloseTo(7.5)
  })
  it('throttles requests beyond provisioned RU/s', () => {
    const r = applyThroughput([150, 150, 150], 400)
    expect(r.accepted).toEqual([true, true, false])
    expect(r.retryAfterMs).toBe(1000)
  })
})
