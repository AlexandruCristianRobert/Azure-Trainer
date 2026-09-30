import { describe, expect, it } from 'vitest'
import { runCosmosQuery } from '../src/lib/data/cosmos-query.js'

const container = (over = {}) => ({
  partitionKeyPath: '/sessionId', physicalPartitions: 4, logicalScale: 1,
  indexingPolicy: { indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: [] },
  items: [
    { id: 'm1', sessionId: 's1', userId: 'u1', createdAt: 1 },
    { id: 'm2', sessionId: 's1', userId: 'u1', createdAt: 2 },
    { id: 'm3', sessionId: 's2', userId: 'u2', createdAt: 3 },
  ], ...over,
})

describe('runCosmosQuery', () => {
  it('filters by parameter within one partition', () => {
    const r = runCosmosQuery(container(), 'SELECT * FROM c WHERE c.sessionId = @s', [{ name: '@s', value: 's1' }])
    expect(r.rows.map(x => x.id)).toEqual(['m1', 'm2'])
    expect(r.stats.partitionsTouched).toBe(1)
  })
  it('fans out across partitions without a partition key filter', () => {
    const r = runCosmosQuery(container(), 'SELECT * FROM c WHERE c.userId = @u', [{ name: '@u', value: 'u1' }])
    expect(r.stats.partitionsTouched).toBe(4)
  })
  it('rejects an undefined parameter', () => {
    expect(runCosmosQuery(container(), 'SELECT * FROM c WHERE c.userId = @u').error.message).toMatch("Parameter '@u' is not defined")
  })
  it('requires a composite index for multi-property ORDER BY', () => {
    const q = 'SELECT * FROM c ORDER BY c.userId ASC, c.createdAt DESC'
    expect(runCosmosQuery(container(), q).error.message).toMatch('corresponding composite index')
    const withIndex = container({ indexingPolicy: { ...container().indexingPolicy, compositeIndexes: [[{ path: '/userId', order: 'ascending' }, { path: '/createdAt', order: 'descending' }]] } })
    expect(runCosmosQuery(withIndex, q).rows.map(x => x.id)).toEqual(['m2', 'm1', 'm3'])
  })
  it('ranks by VectorDistance and rejects wrong dimensions', () => {
    const vc = container({ vectorEmbeddingPolicy: { vectorEmbeddings: [{ path: '/embedding', dataType: 'float32', dimensions: 2, distanceFunction: 'cosine' }] },
      items: [{ id: 'a', sessionId: 's', embedding: [1, 0] }, { id: 'b', sessionId: 's', embedding: [0, 1] }] })
    const q = 'SELECT TOP 1 c.id, VectorDistance(c.embedding, @v) AS score FROM c ORDER BY VectorDistance(c.embedding, @v)'
    expect(runCosmosQuery(vc, q, [{ name: '@v', value: [0.9, 0.1] }]).rows[0].id).toBe('a')
    expect(runCosmosQuery(vc, q, [{ name: '@v', value: [1, 0, 0] }]).error.message).toMatch('do not match')
  })
})
