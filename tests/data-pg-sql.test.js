import { describe, expect, it } from 'vitest'
import { parsePgSql, bindParams } from '../src/lib/data/pg-sql.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup } from '../src/lib/sandbox/ops.js'
import { createPostgresServer, createPostgresDatabase, setPostgresParameter, getPostgresServer, getPostgresDatabase } from '../src/lib/sandbox/postgres.js'

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

function postgresSandbox() {
  let sandbox = createResourceGroup(createSandbox(), { name: 'rg-assistant', location: 'eastus' }).sandbox
  sandbox = createPostgresServer(sandbox, { name: 'pg-assistant', resourceGroup: 'rg-assistant' }).sandbox
  return createPostgresDatabase(sandbox, { server: 'pg-assistant', name: 'knowledge' }).sandbox
}
const connection = { server: 'pg-assistant', resourceGroup: 'rg-assistant', database: 'knowledge' }

describe('executePg', () => {
  it('requires the Azure allow list before creating the vector extension', async () => {
    const { executePg } = await import('../src/lib/data/pg-engine.js')
    const sandbox = postgresSandbox()
    const denied = executePg(sandbox, { ...connection, sql: 'CREATE EXTENSION vector' })
    expect(denied.results[0].error.message).toContain('not allow-listed')
    expect(denied.results[0].error.hint).toContain('linkid=2301063')
    const allowed = setPostgresParameter(sandbox, { ...connection, name: 'azure.extensions', value: 'VECTOR' }).sandbox
    const created = executePg(allowed, { ...connection, sql: 'CREATE EXTENSION vector' })
    expect(created.results[0].error).toBeUndefined()
    expect(getPostgresDatabase(getPostgresServer(created.sandbox, 'pg-assistant'), 'knowledge').extensions).toEqual(['vector'])
    expect(getPostgresDatabase(getPostgresServer(sandbox, 'pg-assistant'), 'knowledge').extensions).toEqual([])
  })
  it('persists vector rows and returns the nearest two ids from actual samples', async () => {
    const { executePg } = await import('../src/lib/data/pg-engine.js')
    let sandbox = setPostgresParameter(postgresSandbox(), { ...connection, name: 'azure.extensions', value: 'vector' }).sandbox
    sandbox = executePg(sandbox, { ...connection, sql: `CREATE EXTENSION vector;
      CREATE TABLE chunks (id bigint PRIMARY KEY, embedding vector(8));
      INSERT INTO chunks (id, embedding) VALUES (1, '[0,1,0,0,0,0,0,0]'), (2, '[1,0,0,0,0,0,0,0]'), (3, '[1,1,0,0,0,0,0,0]')` }).sandbox
    const selected = executePg(sandbox, { ...connection, sql: 'SELECT id FROM chunks ORDER BY embedding <=> %s LIMIT 2', params: [[1, 0, 0, 0, 0, 0, 0, 0]] })
    expect(selected.results[0].rows).toEqual([{ id: 2 }, { id: 3 }])
    expect(selected.results[0].columns).toMatchObject([{ name: 'id' }])
    expect(selected.results[0].plan.node).toBe('Seq Scan')
  })
  it('executes file-style multi-statement SQL in order and retains preceding writes on failure', async () => {
    const { executePg } = await import('../src/lib/data/pg-engine.js')
    const sandbox = postgresSandbox()
    const result = executePg(sandbox, { ...connection, sql: `CREATE TABLE documents (id bigint PRIMARY KEY, content text);
      INSERT INTO documents (id, content) VALUES (1, 'first; passage');
      SET hnsw.ef_search = 80;
      SELECT id, content FROM documents;
      INSERT INTO documents (id, content) VALUES (1, 'duplicate')` })
    expect(result.results.map(row => row.kind)).toEqual(['create-table', 'insert', 'set', 'select', 'insert'])
    expect(result.results[3].rows).toEqual([{ id: 1, content: 'first; passage' }])
    expect(result.results[4].error.code).toBe('IntegrityError')
    expect(result.session.settings['hnsw.ef_search']).toBe('80')
    expect(getPostgresDatabase(getPostgresServer(result.sandbox, 'pg-assistant'), 'knowledge').tables[0].rows).toEqual([{ id: 1, content: 'first; passage' }])
    expect(getPostgresDatabase(getPostgresServer(sandbox, 'pg-assistant'), 'knowledge').tables).toEqual([])
    expect(executePg(result.sandbox, { ...connection, sql: 'SELECT id FROM documents' }).session.settings).toEqual({})
  })
})
