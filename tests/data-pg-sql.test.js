import { describe, expect, it } from 'vitest'
import { parsePgSql, bindParams } from '../src/lib/data/pg-sql.js'

describe('parsePgSql', () => {
  it('parses a pgvector table and an HNSW index with opclass and WITH options', () => {
    const r = parsePgSql('CREATE TABLE chunks (id bigint PRIMARY KEY, content text, embedding vector(8)); CREATE INDEX chunks_hnsw ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);')
    expect(r.statements.map(s => s.kind)).toEqual(['create-table', 'create-index'])
    expect(r.statements[0].columns[2]).toMatchObject({ name: 'embedding', type: 'vector', dimensions: 8 })
    expect(r.statements[1]).toMatchObject({ method: 'hnsw', columns: [{ name: 'embedding', opclass: 'vector_cosine_ops' }], with: { m: 16, ef_construction: 64 } })
  })
  it('parses a filtered nearest-neighbour SELECT with EXPLAIN ANALYZE', () => {
    const r = parsePgSql('EXPLAIN ANALYZE SELECT id, content FROM chunks WHERE product = %s ORDER BY embedding <=> %s::vector LIMIT 3')
    expect(r.statements[0]).toMatchObject({ kind: 'select', explain: { analyze: true }, limit: 3 })
    expect(r.statements[0].orderBy[0]).toMatchObject({ operator: '<=>' })
  })
  it('parses jsonb containment and GIN indexes', () => {
    const r = parsePgSql('CREATE INDEX docs_meta ON documents USING gin (metadata jsonb_path_ops); SELECT id FROM documents WHERE metadata @> %s')
    expect(r.statements[0]).toMatchObject({ method: 'gin', columns: [{ name: 'metadata', opclass: 'jsonb_path_ops' }] })
    expect(r.statements[1].where[0]).toMatchObject({ operator: '@>' })
  })
  it('binds psycopg parameters and rejects a count mismatch', () => {
    const [stmt] = parsePgSql('SELECT id FROM documents WHERE product = %s AND version = %s').statements
    expect(bindParams(stmt, ['contoso-backup']).error.code).toBe('ProgrammingError')
    expect(bindParams(stmt, ['contoso-backup', 'v2']).error).toBeUndefined()
  })
  it('flags unsupported SQL without pretending it is a PostgreSQL error', () => {
    const r = parsePgSql('SELECT * FROM chunks FULL OUTER JOIN documents USING (id)')
    expect(r.error.code).toBe('DATA_UNSUPPORTED')
    expect(r.error.message).toMatch(/^Not supported by the simulator:/)
  })
})
