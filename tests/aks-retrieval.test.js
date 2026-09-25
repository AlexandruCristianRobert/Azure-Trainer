import { describe, expect, it } from 'vitest'
import { INTEGRATION_FIXTURES } from '../src/data/fixtures/aks/integration.js'
import { parseRetrievalSql } from '../src/lib/project/retrieval-sql.js'
import { retrieveFixtureRows } from '../src/lib/kubernetes/retrieval.js'

const queryText = `SELECT id, content FROM documents WHERE collection = %(collection)s AND audience = %(audience)s AND published = %(published)s AND (embedding <=> %(embedding)s::vector) <= %(max_distance)s ORDER BY embedding <=> %(embedding)s ASC, id ASC LIMIT %(limit)s;`
const query = parseRetrievalSql(queryText).querySpec
const params = overrides => ({ collection: 'review', audience: 'partner', published: true, embedding: '[1,0,0]', max_distance: 0.2, limit: 1, ...overrides })

describe('fixture retrieval', () => {
  it('filters audience and unpublished rows before ranking and returns provenance', () => {
    const result = retrieveFixtureRows(query, params(), INTEGRATION_FIXTURES.documents)
    expect(result.selectedIds).toEqual(['review-backups'])
    expect(result.rows[0]).toMatchObject({ id: 'review-backups', content: 'Review backups are kept for 7 days.', provenance: { kind: 'document', id: 'review-backups' } })
  })

  it('retrieves a decoy if a supported query omits the audience filter', () => {
    const missingAudience = { ...query, filters: query.filters.filter(filter => filter.column !== 'audience') }
    expect(retrieveFixtureRows(missingAudience, params({ audience: 'partner' }), INTEGRATION_FIXTURES.documents).selectedIds).toEqual(['00-review-employee'])
  })

  it('retrieves the unpublished decoy if a supported query omits the published filter', () => {
    const missingPublished = { ...query, filters: query.filters.filter(filter => filter.column !== 'published') }
    expect(retrieveFixtureRows(missingPublished, params(), INTEGRATION_FIXTURES.documents).selectedIds).toEqual(['00-review-draft'])
  })

  it('returns empty successful retrieval for a valid vector with no close document', () => {
    const result = retrieveFixtureRows(query, params({ embedding: '[0,0,1]' }), INTEGRATION_FIXTURES.documents)
    expect(result).toMatchObject({ rows: [], selectedIds: [], diagnostic: null })
  })

  it('binds renamed SQL parameters by their parsed names', () => {
    const renamedText = queryText.replaceAll('%(collection)s', '%(scope)s').replaceAll('%(audience)s', '%(who)s')
      .replaceAll('%(published)s', '%(is_live)s').replaceAll('%(embedding)s', '%(query_vector)s')
      .replaceAll('%(max_distance)s', '%(radius)s').replaceAll('%(limit)s', '%(row_count)s')
    const renamedQuery = parseRetrievalSql(renamedText).querySpec
    const bound = { scope: 'review', who: 'partner', is_live: true, query_vector: '[1,0,0]', radius: 0.2, row_count: 1 }
    expect(retrieveFixtureRows(renamedQuery, bound, INTEGRATION_FIXTURES.documents).selectedIds).toEqual(['review-backups'])
  })

  it('uses id ascending as a stable tie breaker and enforces typed parameter bounds', () => {
    const duplicate = { 'training-backups-alt': { ...INTEGRATION_FIXTURES.documents['training-backups'], id: 'training-backups-alt' } }
    const data = { ...INTEGRATION_FIXTURES.documents, ...duplicate }
    const training = params({ collection: 'training', audience: 'employee' })
    expect(retrieveFixtureRows(query, training, data).selectedIds).toEqual(['training-backups'])
    expect(retrieveFixtureRows(query, params({ limit: '1' }), data).diagnostic).toMatchObject({ code: 'SQL_PARAMETER_TYPE' })
    expect(retrieveFixtureRows(query, params({ collection: "training' OR true --" }), data).rows).toEqual([])
    expect(retrieveFixtureRows(query, params({ max_distance: '0.2' }), data).diagnostic).toMatchObject({ code: 'SQL_PARAMETER_TYPE' })
    expect(retrieveFixtureRows(query, params({ limit: 0 }), data).diagnostic).toMatchObject({ code: 'SQL_PARAMETER_TYPE' })
    expect(retrieveFixtureRows(query, params({ limit: -1 }), data).diagnostic).toMatchObject({ code: 'SQL_PARAMETER_TYPE' })
    expect(retrieveFixtureRows(query, params({ limit: 4 }), data).diagnostic).toMatchObject({ code: 'SQL_PARAMETER_TYPE' })
    expect(retrieveFixtureRows(query, params({ max_distance: -0.0001 }), data).diagnostic).toMatchObject({ code: 'SQL_PARAMETER_TYPE' })
    expect(retrieveFixtureRows(query, params({ max_distance: 2.0001 }), data).diagnostic).toMatchObject({ code: 'SQL_PARAMETER_TYPE' })
  })

  it.each([
    ['zero vector', '[0,0,0]'], ['short vector', '[1,0]'], ['long vector', '[1,0,0,0]'], ['non-finite', '[1,NaN,0]'],
  ])('rejects %s before computing distance', (_label, embedding) => {
    expect(retrieveFixtureRows(query, params({ embedding }), INTEGRATION_FIXTURES.documents).diagnostic).toMatchObject({ code: 'SQL_VECTOR_INVALID' })
  })

  it('includes a row exactly at the cosine-distance cutoff', () => {
    const descending = { ...query, order: { ...query.order, direction: 'DESC' } }
    const result = retrieveFixtureRows(descending, params({ embedding: '[1,0,0]', max_distance: 1, limit: 3 }), INTEGRATION_FIXTURES.documents)
    expect(result.selectedIds).toContain('review-support')
    expect(result.distances.find(item => item.id === 'review-support').distance).toBe(1)
  })

  it('keeps cosine distance finite for very large finite vector components', () => {
    const result = retrieveFixtureRows(query, params({ embedding: '[1e308,0,0]' }), INTEGRATION_FIXTURES.documents)
    expect(result.diagnostic).toBeNull()
    expect(result.distances[0].distance).toBe(0)
  })

  it('clamps cosine roundoff to the valid distance interval', () => {
    const documents = {
      'negative-diagonal': { ...INTEGRATION_FIXTURES.documents['training-backups'], id: 'negative-diagonal', embedding: [-1, -1, -1] },
    }
    const result = retrieveFixtureRows(query, params({ collection: 'training', audience: 'employee', embedding: '[-1,-1,-1]', max_distance: 0 }), documents)
    expect(result.distances[0].distance).toBeGreaterThanOrEqual(0)
    expect(result.distances[0].distance).toBeLessThanOrEqual(2)
    expect(result.distances[0].distance).toBe(0)
  })
})
