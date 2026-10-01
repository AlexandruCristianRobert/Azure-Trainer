import { describe, expect, it } from 'vitest'
import { parseDataApp } from '../src/lib/data/python-sdk.js'
import { runDataFunction } from '../src/lib/data/runtime.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup } from '../src/lib/sandbox/ops.js'
import { createPostgresServer, createPostgresDatabase, setPostgresParameter } from '../src/lib/sandbox/postgres.js'
import { executePg, loadCorpus } from '../src/lib/data/pg-engine.js'
import { parsePgSql } from '../src/lib/data/pg-sql.js'
import { POSTGRES_MANIFEST, POSTGRES_STARTER_FILES } from '../src/data/templates/data-python/postgres.js'

const manifest = { editZones: ['get_session', 'recent'], receivers: { sessions: 'cosmos-container' } }
const files = (app, clients = 'from azure.cosmos import CosmosClient\nclient = CosmosClient(URL, credential=KEY, consistency_level="Session")\n') => ({ 'app.py': app, 'clients.py': clients })

describe('parseDataApp', () => {
  it('distinguishes actually used pools while preserving identity across checkouts', () => {
    const dataTarget = { kind: 'postgres', server: 'pg-assistant', resourceGroup: 'rg-assistant', database: 'knowledge' }
    let sandbox = createResourceGroup(createSandbox(), { name: 'rg-assistant', location: 'eastus' }).sandbox
    sandbox = createPostgresServer(sandbox, { ...dataTarget, name: dataTarget.server }).sandbox
    sandbox = createPostgresDatabase(sandbox, { ...dataTarget, name: 'knowledge' }).sandbox
    sandbox = executePg(sandbox, { ...dataTarget, sql: 'CREATE TABLE documents (id bigint PRIMARY KEY); INSERT INTO documents (id) VALUES (1)' }).sandbox
    const clients = 'from psycopg_pool import ConnectionPool\nDSN = "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge"\npool = ConnectionPool(DSN, max_size=5)\nsecond = ConnectionPool(DSN, max_size=5)\n'
    const app = `from clients import pool, second
def query():
    with pool.connection() as conn:
        conn.execute("SELECT id FROM documents").fetchall()
    with pool.connection() as conn:
        conn.execute("SELECT id FROM documents").fetchall()
    with second.connection() as conn:
        return conn.execute("SELECT id FROM documents").fetchall()
`
    const parsed = parseDataApp(files(app, clients), { editZones: ['query'], receivers: { pool: 'pg-pool', second: 'pg-pool' } })
    expect(parsed.diagnostics).toEqual([])
    const result = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget, functionName: 'query' })
    expect(result.status).toBe(200)
    expect(result.value).toEqual([[1]])
    expect(result.calls.map(call => call.poolIdentity)).toEqual([1, 1, 2])
  })
  it('selects PostgreSQL from trusted metadata or actual imports without diverting Cosmos for comments or strings', () => {
    const app = 'def get_session(session_id):\n    return sessions.read_item(item=session_id, partition_key=session_id)\n'
    for (const noise of ['# psycopg ConnectionPool\n', 'NOTE = "psycopg ConnectionPool"\n', 'import psycopg\n']) {
      const result = parseDataApp({ ...files(app), 'clients.py': files('')['clients.py'] + noise }, manifest)
      expect(result.diagnostics).toEqual([])
      expect(result.appSpec.data.functions.get_session.body[0].value.call).toBe('cosmos.container.read_item')
      expect(result.appSpec.data.postgres).toBeUndefined()
    }
    for (const noise of ['# import psycopg\n', 'NOTE = "from psycopg_pool import ConnectionPool"\n', '"""import psycopg"""\n', 'import other as psycopg\n', 'import other.psycopg\n']) {
      const result = parseDataApp(files('', noise), {})
      expect(result.diagnostics).toEqual([])
      expect(result.appSpec.data.postgres).toBeUndefined()
    }
    for (const imported of ['import psycopg\n', 'from psycopg import connect\n', 'import psycopg_pool\n', 'from psycopg_pool import ConnectionPool\n']) {
      expect(parseDataApp(files('', imported), {}).appSpec.data.postgres).toBeDefined()
    }
    const explicit = parseDataApp(POSTGRES_STARTER_FILES, { ...POSTGRES_MANIFEST, receivers: {}, dataBackend: 'postgres' })
    expect(explicit.diagnostics).toEqual([])
    expect(explicit.appSpec.data.functions.exact_baseline).toBeDefined()
  })
  it('binds named psycopg values individually and requires Jsonb only for dictionary-valued parameters', () => {
    const dataTarget = { kind: 'postgres', server: 'pg-assistant', resourceGroup: 'rg-assistant', database: 'knowledge' }
    let sandbox = createResourceGroup(createSandbox(), { name: 'rg-assistant', location: 'eastus' }).sandbox
    sandbox = createPostgresServer(sandbox, { ...dataTarget, name: dataTarget.server }).sandbox
    sandbox = createPostgresDatabase(sandbox, { ...dataTarget, name: 'knowledge' }).sandbox
    sandbox = executePg(sandbox, { ...dataTarget, sql: `CREATE TABLE documents (id bigint PRIMARY KEY, metadata jsonb);
      INSERT INTO documents (id, metadata) VALUES (1, '{"kind":"article"}'::jsonb)` }).sandbox
    const clients = 'import psycopg\nDSN = "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge"\n'
    const app = `from psycopg.types.json import Jsonb
def named(document_id):
    with psycopg.connect(DSN) as conn:
        return conn.execute("SELECT id FROM documents WHERE id = %(id)s", {"id": document_id}).fetchall()
def json_named():
    with psycopg.connect(DSN) as conn:
        return conn.execute("SELECT id FROM documents WHERE metadata @> %(metadata)s", {"metadata": Jsonb({"kind": "article"})}).fetchall()
def unadapted():
    with psycopg.connect(DSN) as conn:
        return conn.execute("SELECT id FROM documents WHERE metadata @> %(metadata)s", {"metadata": {"kind": "article"}}).fetchall()
`
    const parsed = parseDataApp(files(app, clients), { editZones: ['named', 'json_named', 'unadapted'] })
    expect(parsed.diagnostics).toEqual([])
    for (const functionName of ['named', 'json_named']) {
      const result = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget, functionName, args: [1] })
      expect(result.status).toBe(200)
      expect(result.value).toEqual([[1]])
    }
    const rejected = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget, functionName: 'unadapted' })
    expect(rejected.status).toBe(500)
    expect(rejected.error).toMatchObject({ code: 'ProgrammingError', message: expect.stringContaining('wrap JSON data in Jsonb') })
  })
  it('rejects learner functions that shadow a protected PostgreSQL runtime route', () => {
    const baseline = parseDataApp(POSTGRES_STARTER_FILES, POSTGRES_MANIFEST)
    expect(baseline.diagnostics).toEqual([])
    expect(baseline.appSpec.data.functions.exact_baseline.body[0].source.path).toBe('baseline.py')
    for (const path of ['app.py', 'clients.py', 'worker.py']) {
      const tampered = { ...POSTGRES_STARTER_FILES, [path]: (POSTGRES_STARTER_FILES[path] ?? '') + '\ndef exact_baseline(question):\n    return []\n' }
      const result = parseDataApp(tampered, POSTGRES_MANIFEST)
      expect(result.appSpec).toBeNull()
      expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SCAFFOLD_MODIFIED', path })])
    }
  })
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
