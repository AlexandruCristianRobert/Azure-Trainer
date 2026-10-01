import { describe, expect, it } from 'vitest'
import { parseDataApp } from '../src/lib/data/python-sdk.js'
import { runDataFunction } from '../src/lib/data/runtime.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup } from '../src/lib/sandbox/ops.js'
import { createPostgresServer, createPostgresDatabase, setPostgresParameter } from '../src/lib/sandbox/postgres.js'
import { executePg, loadCorpus } from '../src/lib/data/pg-engine.js'
import { parsePgSql } from '../src/lib/data/pg-sql.js'

const manifest = { editZones: ['get_session', 'recent'], receivers: { sessions: 'cosmos-container' } }
const files = (app, clients = 'from azure.cosmos import CosmosClient\nclient = CosmosClient(URL, credential=KEY, consistency_level="Session")\n') => ({ 'app.py': app, 'clients.py': clients })

describe('parseDataApp', () => {
  it('recognizes read_item with keyword arguments', () => {
    const r = parseDataApp(files('def get_session(session_id):\n    return sessions.read_item(item=session_id, partition_key=session_id)\n'), manifest)
    expect(r.diagnostics).toEqual([])
    const ret = r.appSpec.data.functions.get_session.body[0]
    expect(ret.value.call).toBe('cosmos.container.read_item')
    expect(r.appSpec.data.client.consistency).toBe('Session')
  })
  it('reports a missing required partition_key', () => {
    const r = parseDataApp(files('def get_session(session_id):\n    return sessions.read_item(item=session_id)\n'), manifest)
    expect(r.diagnostics[0].code).toBe('SDK_ARGUMENT')
  })
  it('recognizes list(query_items(...)) with parameters', () => {
    const src = 'def recent(user_id):\n    query = "SELECT * FROM c WHERE c.userId = @u"\n    return list(sessions.query_items(query=query, parameters=[{"name": "@u", "value": user_id}], enable_cross_partition_query=True))\n'
    expect(parseDataApp(files(src), manifest).diagnostics).toEqual([])
  })
  it('flags unsupported constructs without pretending they are Azure errors', () => {
    const r = parseDataApp(files('def recent(user_id):\n    return [x for x in range(3)]\n'), manifest)
    expect(r.diagnostics[0].code).toBe('DATA_UNSUPPORTED')
    expect(r.diagnostics[0].message).toMatch(/^Not supported by the simulator:/)
  })
  it('runs a recognized read_item against the Sandbox and charges ~1 RU', () => {
    const r = parseDataApp(files('def get_session(session_id):\n    return sessions.read_item(item=session_id, partition_key=session_id)\n'), manifest)
    const sandbox = {
      cosmosAccounts: [{
        name: 'cosmos1',
        defaultConsistencyLevel: 'Session',
        databases: [{
          name: 'assistant',
          containers: [{
            name: 'sessions',
            partitionKeyPath: '/sessionId',
            indexingPolicy: { indexingMode: 'consistent', automatic: true, includedPaths: [{ path: '/*' }], excludedPaths: [] },
            items: [{ id: 's1', sessionId: 's1', text: 'hi' }],
          }],
        }],
      }],
    }
    const result = runDataFunction({
      appSpec: r.appSpec, sandbox, account: 'cosmos1', database: 'assistant', functionName: 'get_session',
      args: ['s1'], nowMs: 1000, scenarioState: { writesThisRequest: new Set() },
    })
    expect(result.status).toBe(200)
    expect(result.calls[0].charge).toBe(1)
  })
  it('runs pooled psycopg retrieval and consumes tuple or dict rows from the loaded corpus', () => {
    const dataTarget = { kind: 'postgres', server: 'pg-assistant', resourceGroup: 'rg-assistant', database: 'knowledge', port: 5432 }
    let sandbox = createResourceGroup(createSandbox(), { name: 'rg-assistant', location: 'eastus' }).sandbox
    sandbox = createPostgresServer(sandbox, { ...dataTarget, name: dataTarget.server }).sandbox
    sandbox = createPostgresDatabase(sandbox, { ...dataTarget, name: 'knowledge' }).sandbox
    sandbox = setPostgresParameter(sandbox, { ...dataTarget, name: 'azure.extensions', value: 'vector' }).sandbox
    sandbox = executePg(sandbox, { ...dataTarget, sql: `CREATE EXTENSION vector;
      CREATE TABLE documents (id bigint PRIMARY KEY, product text, version text, language text, metadata jsonb, body text, updated_at timestamptz);
      CREATE TABLE chunks (id bigint PRIMARY KEY, document_id bigint REFERENCES documents(id), chunk_index integer, content text, embedding vector(8))` }).sandbox
    sandbox = loadCorpus(sandbox, dataTarget).sandbox
    sandbox = executePg(sandbox, { ...dataTarget, sql: 'CREATE INDEX chunks_hnsw ON chunks USING hnsw (embedding vector_cosine_ops)' }).sandbox
    const clients = `import psycopg
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row
DSN = "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge user=assistant_admin"
pool = ConnectionPool(DSN, min_size=1, max_size=4, open=True)
def connect():
    return psycopg.connect(DSN, row_factory=dict_row)
`
    const app = `from clients import pool, connect
from psycopg.types.json import Jsonb
SQL = """SELECT c.id, c.content FROM chunks c JOIN documents d ON d.id = c.document_id
WHERE d.product = %s AND d.version = 'v2' AND d.language = 'en' ORDER BY c.embedding <=> %s LIMIT 2"""
def retrieve_passages(question, product):
    with pool.connection() as conn:
        conn.execute("SET hnsw.ef_search = 80")
        rows: list = conn.execute(SQL, (product, embed(question))).fetchall()
        return rows
def build_context(rows):
    sources = []
    passages = []
    for row in rows:
        sources.append(row[0])
        passages.append(row[1])
    return {"sources": sources, "passages": "\\n".join(passages)}
def answer(question, product):
    rows = retrieve_passages(question, product)
    context = build_context(rows)
    return {"answer": training_answer(question, context), "sources": context["sources"]}
def metadata(product):
    with connect() as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT id FROM documents WHERE metadata @> %s ORDER BY id LIMIT 1", (Jsonb({"product": product}),))
            row = cursor.fetchone()
            return row["id"]
`
    const parsed = parseDataApp(files(app, clients), { editZones: ['retrieve_passages', 'build_context'], routes: { '/ask': 'answer', '/metadata': 'metadata' }, receivers: { pool: 'pg-pool' } })
    expect(parsed.diagnostics).toEqual([])
    const question = 'What is the default snapshot retention window in Contoso Backup v2?'
    const result = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget, functionName: 'answer', args: [question, 'contoso-backup'] })
    expect(result.status).toBe(200)
    expect(result.value.sources).toEqual([9, 10])
    expect(result.value.answer).toContain('45 days')
    expect(result.calls.at(-1)).toMatchObject({ connection: 'pooled', rows: [[9, expect.any(String)], [10, expect.any(String)]], recall: 1 })
    expect(result.calls.at(-1).plan.latencyMs).toBe(6)
    expect(result.totalCharge).toBe(0)
    expect(result.connections).toMatchObject({ opened: 1, closed: 1, active: 0 })
    const dictResult = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget, functionName: 'metadata', args: ['contoso-backup'] })
    expect(dictResult.status).toBe(200)
    expect(dictResult.value).toBe(1)
    expect(dictResult.calls[0].connection).toBe('new')
    expect(dictResult.calls[0].latencyMs).toBe(dictResult.calls[0].plan.latencyMs + 25)
    expect(dictResult.connections.active).toBe(0)
  })
  it('returns a PostgreSQL syntax error when an f-string interpolates an apostrophe into SQL', () => {
    const dataTarget = { kind: 'postgres', server: 'pg-assistant', resourceGroup: 'rg-assistant', database: 'knowledge' }
    let sandbox = createResourceGroup(createSandbox(), { name: 'rg-assistant', location: 'eastus' }).sandbox
    sandbox = createPostgresServer(sandbox, { ...dataTarget, name: dataTarget.server }).sandbox
    sandbox = createPostgresDatabase(sandbox, { ...dataTarget, name: 'knowledge' }).sandbox
    sandbox = executePg(sandbox, { ...dataTarget, sql: 'CREATE TABLE documents (id bigint PRIMARY KEY, body text)' }).sandbox
    const parsed = parseDataApp(files(`import psycopg
def retrieve_passages(question, product):
    with psycopg.connect(DSN) as conn:
        return conn.execute(f"SELECT id FROM documents WHERE body = '{question}'").fetchall()
`, 'DSN = "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge"\n'), { editZones: ['retrieve_passages'] })
    expect(parsed.diagnostics).toEqual([])
    const result = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget, functionName: 'retrieve_passages', args: ["What's retained?", 'contoso-backup'] })
    expect(result.status).toBeGreaterThanOrEqual(400)
    expect(result.error.message.toLowerCase()).toContain('syntax error')
    expect(result.connections).toMatchObject({ opened: 1, closed: 1, active: 0 })
    const safe = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget, functionName: 'retrieve_passages', args: ['retained', 'contoso-backup'] })
    expect(safe.status).toBe(200)
    expect(safe.value).toEqual([])
    expect(parsePgSql("SELECT id FROM documents WHERE body ? 'key'").error.code).toBe('DATA_UNSUPPORTED')
  })
})
