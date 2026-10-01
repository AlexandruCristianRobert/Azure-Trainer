import { describe, expect, it } from 'vitest'
import { planSelect, buildIndex, simulatePoolLoad, makePgRowContext, evaluatePgExpression, matchesPgWhere, pgPartialIndexUsable } from '../src/lib/data/pg-plan.js'
import { parsePgSql, bindParams } from '../src/lib/data/pg-sql.js'

const server = { tier: 'GeneralPurpose', vCores: 2, memoryGiB: 8, parameters: { maintenance_work_mem: '65536', max_connections: '859', 'pgbouncer.default_pool_size': '50' } }
const db = (indexes = []) => ({ tables: [{ name: 'chunks', logicalRows: 250000, columns: [{ name: 'embedding', type: 'vector', dimensions: 8 }, { name: 'product', type: 'text' }], rows: [{ product: 'a' }, { product: 'b' }, { product: 'b' }, { product: 'b' }] }], indexes })
const knn = (op = '<=>') => ({ kind: 'select', table: 'chunks', where: [], orderBy: [{ column: 'embedding', operator: op }], limit: 3 })
const hnsw = (opclass) => ({ name: 'h', table: 'chunks', method: 'hnsw', columns: [{ name: 'embedding', opclass }], with: {} })

describe('pg plan model', () => {
  it('uses HNSW only when the operator matches the opclass', () => {
    expect(planSelect(db([hnsw('vector_cosine_ops')]), knn('<=>'), {}, server).node).toMatch(/hnsw|Index Scan using h/)
    expect(planSelect(db([hnsw('vector_l2_ops')]), knn('<=>'), {}, server).node).toBe('Seq Scan')
  })
  it('trades recall for latency with hnsw.ef_search', () => {
    const low = planSelect(db([hnsw('vector_cosine_ops')]), knn(), { 'hnsw.ef_search': 10 }, server)
    const high = planSelect(db([hnsw('vector_cosine_ops')]), knn(), { 'hnsw.ef_search': 100 }, server)
    expect(high.recall).toBeGreaterThan(low.recall)
    expect(high.latencyMs).toBeGreaterThan(low.latencyMs)
  })
  it('fails an HNSW build when maintenance_work_mem is far too small', () => {
    const tiny = { ...server, parameters: { ...server.parameters, maintenance_work_mem: '1024' } }
    expect(buildIndex(db(), { ...hnsw('vector_cosine_ops') }, tiny).ok).toBe(false)
    expect(buildIndex(db(), { ...hnsw('vector_cosine_ops') }, { ...server, parameters: { ...server.parameters, maintenance_work_mem: '2097152' } }).ok).toBe(true)
  })
  it('exhausts max_connections without a pool and not with PgBouncer', () => {
    const s = { ...server, parameters: { ...server.parameters, max_connections: '50' } }
    const naive = simulatePoolLoad({ replicas: 6, requestsPerSecond: 600, seconds: 10, mode: 'per-request', poolMaxSize: 0, server: s })
    const bouncer = simulatePoolLoad({ replicas: 6, requestsPerSecond: 600, seconds: 10, mode: 'pgbouncer', poolMaxSize: 20, server: { ...s, parameters: { ...s.parameters, 'pgbouncer.enabled': 'true', 'pgbouncer.default_pool_size': '40' } } })
    expect(naive.errors.join(' ')).toMatch('too many clients already')
    expect(bouncer.failed).toBe(0)
    expect(bouncer.p95Ms).toBeLessThan(naive.p95Ms)
  })
  it('keeps bound JSON objects with kind fields as data through predicates, casts and partial implication', () => {
    const context = makePgRowContext({ metadata: { kind: 'article' } }, 'documents')
    for (const suffix of ['', '::jsonb']) {
      const [parsed] = parsePgSql(`SELECT metadata FROM documents WHERE metadata @> %s${suffix}`).statements
      const article = bindParams(parsed, [{ kind: 'article' }])
      const shaped = bindParams(parsed, [{ kind: 'column', name: 'metadata' }])
      expect(evaluatePgExpression(article.where[0].value, context)).toEqual({ kind: 'article' })
      expect(evaluatePgExpression(shaped.where[0].value, context)).toEqual({ kind: 'column', name: 'metadata' })
      expect(matchesPgWhere(context, article.where)).toBe(true)
      expect(matchesPgWhere(context, shaped.where)).toBe(false)
      const index = parsePgSql(`CREATE INDEX articles ON documents (metadata) WHERE metadata @> '{"kind":"article"}'::jsonb`).statements[0]
      expect(pgPartialIndexUsable(index, article)).toBe(true)
      expect(pgPartialIndexUsable(index, shaped)).toBe(false)
    }
  })
  it('reserves only one PgBouncer server slot for one actual pooled client', () => {
    const result = simulatePoolLoad({ replicas: 1, requestsPerSecond: 100, seconds: 10, mode: 'pgbouncer', poolMaxSize: 1,
      server: { ...server, parameters: { ...server.parameters, max_connections: '50', 'pgbouncer.enabled': 'true', 'pgbouncer.default_pool_size': '50' } } })
    expect(result.served).toBe(1000)
    expect(result.failed).toBe(0)
    expect(result.peakServerConnections).toBe(1)
    expect(result.errors).toEqual([])
  })
})
