import { describe, expect, it } from 'vitest'
import { parseDataApp } from '../src/lib/data/python-sdk.js'
import { runDataFunction } from '../src/lib/data/runtime.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup } from '../src/lib/sandbox/ops.js'
import { createPostgresServer, createPostgresDatabase, setPostgresParameter } from '../src/lib/sandbox/postgres.js'
import { executePg, loadCorpus } from '../src/lib/data/pg-engine.js'
import { parsePgSql } from '../src/lib/data/pg-sql.js'
import { POSTGRES_MANIFEST, POSTGRES_STARTER_FILES } from '../src/data/templates/data-python/postgres.js'
import { REDIS_HELPER_FILES, REDIS_RUNTIME_MANIFEST } from '../src/data/templates/data-python/redis-runtime.js'
import { createRedisCluster } from '../src/lib/sandbox/redis.js'
import { executeRedis } from '../src/lib/data/redis-store.js'
import { executeRedisSearch, float32Blob } from '../src/lib/data/redis-search.js'
import { REDIS_TARGET, redisEmbed, redisSourceAnswer } from '../src/data/fixtures/data/redis.js'

const manifest = { editZones: ['get_session', 'recent'], receivers: { sessions: 'cosmos-container' } }
const files = (app, clients = 'from azure.cosmos import CosmosClient\nclient = CosmosClient(URL, credential=KEY, consistency_level="Session")\n') => ({ 'app.py': app, 'clients.py': clients })

describe('parseDataApp', () => {
  it('executes a parameterized Redis semantic hit from real binary vectors and protected decoders', () => {
    const target = REDIS_TARGET
    const question = 'How many days are Contoso Backup snapshots retained?'
    let sandbox = createResourceGroup(createSandbox(), { name: target.resourceGroup, location: 'eastus' }).sandbox
    sandbox = createRedisCluster(sandbox, { ...target, name: target.cluster, modules: ['RediSearch'] }).sandbox
    const created = executeRedisSearch(sandbox, target, 'FT.CREATE', ['idx:semantic', 'ON', 'HASH', 'PREFIX', 1, 'ka:sem:', 'SCHEMA', 'product', 'TAG', 'version', 'TAG', 'language', 'TAG', 'embedding', 'VECTOR', 'HNSW', 6, 'TYPE', 'FLOAT32', 'DIM', 8, 'DISTANCE_METRIC', 'COSINE'])
    expect(created.error).toBeUndefined()
    const answer = redisSourceAnswer({ product: 'contoso-backup', version: 'v1', language: 'en' }, question)
    sandbox = executeRedis(created.sandbox, target, 'HSET', ['ka:sem:contoso-backup:v1:en:seed', { product: 'contoso-backup', version: 'v1', language: 'en', payload: JSON.stringify(answer), embedding: float32Blob(redisEmbed(question)) }]).sandbox
    const app = `from clients import cache
from training_runtime import embed, pack_embedding, decode_search, decode_answer
def semantic_lookup(question, product, version, language, threshold):
    query = "(@product:{" + product + "} @version:{" + version + "} @language:{" + language + "})=>[KNN 1 @embedding $vec AS distance]"
    raw = cache.execute_command("FT.SEARCH", "idx:semantic", query, "PARAMS", 2,
        "vec", pack_embedding(embed(question)), "SORTBY", "distance", "ASC",
        "RETURN", 2, "payload", "distance", "DIALECT", 2)
    rows = decode_search(raw)
    for row in rows:
        if float(row["distance"]) <= threshold:
            return decode_answer(row["payload"])
    return None
`
    const files = { ...REDIS_HELPER_FILES, 'app.py': app, 'clients.py': 'import redis as cache_sdk\ncache = cache_sdk.Redis("redis-assistant.eastus.redis.training.invalid", 10000, password="Training-Only-Redis-Key", ssl=True, decode_responses=False, protocol=2)\n' }
    const manifest = { ...REDIS_RUNTIME_MANIFEST, editZones: ['semantic_lookup'], routes: { 'GET /answer': 'semantic_lookup' } }
    const parsed = parseDataApp(files, manifest)
    expect(parsed.diagnostics).toEqual([])
    const result = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: target, functionName: 'semantic_lookup', args: [question, 'contoso-backup', 'v1', 'en', 0.05], nowMs: 0 })
    expect(result.status).toBe(200)
    expect(result.value).toEqual(answer)
    expect(result.redis.calls.some(call => call.command === 'FT.SEARCH')).toBe(true)
    expect(result.redis.originCalls).toBe(0)
    result.value.answer = 'detached'
    expect(sandbox.redisClusters[0].database.keys['ka:sem:contoso-backup:v1:en:seed'].value.payload).toBe(JSON.stringify(answer))
  })
  it('executes Redis miss, real SET EX and repeat hit with one protected scoped origin call', () => {
    const target = REDIS_TARGET
    const question = 'How many days are Contoso Backup snapshots retained?'
    let sandbox = createResourceGroup(createSandbox(), { name: target.resourceGroup, location: 'eastus' }).sandbox
    sandbox = createRedisCluster(sandbox, { ...target, name: target.cluster }).sandbox
    const app = `from clients import cache
from training_runtime import response_key, encode_answer, decode_answer, source_answer
def cached_answer(question, product, version, language, ttl):
    key = response_key(question, product, version, language)
    value = cache.get(key)
    if value is not None:
        return decode_answer(value)
    result = source_answer(question, product, version, language)
    cache.set(key, encode_answer(result), ex=ttl)
    return result
def key_check():
    return response_key(" ABC ", "p", "v1", "en")
def hash_check():
    cache.hset("temp", mapping={"payload": encode_answer({"answer": "learner value"})})
    cache.expire("temp", 60)
    rows = cache.hgetall("temp")
    return {"value": decode_answer(rows["payload"]), "ttl": cache.ttl("temp"), "exists": cache.exists("temp")}
def invalidate():
    for key in cache.scan_iter(match="ka:answer:contoso-backup:*", count=100):
        cache.delete(key)
    return cache.delete("absent-one", "absent-two")
def fail_after_write():
    cache.set("survives", "learner value", ex=60)
    return cache.hgetall("survives")
def bounded_trace(keys):
    for key in keys:
        cache.get(key)
    return None
`
    const files = { ...REDIS_HELPER_FILES, 'app.py': app, 'clients.py': 'from redis import Redis as CacheClient\ncache = CacheClient(host="redis-assistant.eastus.redis.training.invalid", port=10000, password="Training-Only-Redis-Key", ssl=True, decode_responses=False, protocol=2)\n' }
    const manifest = { ...REDIS_RUNTIME_MANIFEST, editZones: ['cached_answer', 'key_check', 'hash_check', 'invalidate', 'fail_after_write', 'bounded_trace'], routes: { 'GET /cached': 'cached_answer' } }
    const parsed = parseDataApp(files, manifest)
    expect(parsed.diagnostics).toEqual([])
    const one = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: target, functionName: 'cached_answer', args: [question, 'contoso-backup', 'v1', 'en', 60], nowMs: 0 })
    const two = runDataFunction({ appSpec: parsed.appSpec, sandbox: one.sandbox, dataTarget: target, functionName: 'cached_answer', args: [question, 'contoso-backup', 'v1', 'en', 60], nowMs: 1000 })
    expect(one.status).toBe(200)
    expect(two.value).toEqual(one.value)
    expect(one.redis.originCalls + two.redis.originCalls).toBe(1)
    expect(two.redis.calls.some(call => call.command === 'GET' && call.hit === true)).toBe(true)
    expect(one.redis.calls.find(call => call.command === 'SET')).toMatchObject({ args: [expect.any(String), expect.objectContaining({ redisKind: 'bytes' }), 'EX', 60] })
    expect(Object.values(one.sandbox.redisClusters[0].database.keys)[0].expiresAtMs).toBe(60000)
    expect(runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: target, functionName: 'key_check' }).value).toBe('ka:answer:p:v1:en:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    const revised = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: target, functionName: 'cached_answer', args: [question, 'contoso-backup', 'v1', 'en', 60], nowMs: 0, scenarioState: { sourceRevisions: { 'contoso-backup': 2 } } })
    expect(revised.value.answer).toContain('14 days')
    const unsupported = parseDataApp({ ...files, 'app.py': app.replace('cache.get(key)', 'cache.unknown(key)') }, manifest)
    expect(unsupported.diagnostics.some(d => d.code === 'DATA_UNSUPPORTED')).toBe(true)
    expect(parseDataApp({ ...files, 'clients.py': files['clients.py'].replace('host=', '').replace('port=10000,', '10000, "Training-Only-Redis-Key",') }, manifest).diagnostics.some(d => d.code === 'DATA_UNSUPPORTED')).toBe(true)
    expect(parseDataApp({ ...files, 'app.py': app.replace('mapping={"payload": encode_answer({"answer": "learner value"})}', '{"payload": encode_answer({"answer": "learner value"})}') }, manifest).diagnostics.some(d => d.code === 'DATA_UNSUPPORTED')).toBe(true)
    expect(parseDataApp({ ...files, 'training_runtime.py': files['training_runtime.py'] + '\n# changed\n' }, manifest).diagnostics[0].code).toBe('SCAFFOLD_MODIFIED')
    expect(parseDataApp({ ...files, 'app.py': app + '\nresponse_key = "shadow"\n' }, manifest).diagnostics.some(d => d.code === 'SCAFFOLD_MODIFIED')).toBe(true)
    const wrongConnection = parseDataApp({ ...files, 'clients.py': files['clients.py'].replace('ssl=True', 'ssl=False') }, manifest)
    const disconnected = runDataFunction({ appSpec: wrongConnection.appSpec, sandbox, dataTarget: target, functionName: 'cached_answer', args: [question, 'contoso-backup', 'v1', 'en', 60] })
    expect(disconnected.error.code).toBe('ConnectionError')
    expect(JSON.stringify(disconnected.redis)).not.toContain('Training-Only-Redis-Key')
    const hash = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: target, functionName: 'hash_check', nowMs: 0 })
    expect(hash.value).toEqual({ value: { answer: 'learner value' }, ttl: 60, exists: 1 })
    const invalidated = runDataFunction({ appSpec: parsed.appSpec, sandbox: one.sandbox, dataTarget: target, functionName: 'invalidate', nowMs: 0 })
    expect(invalidated.status).toBe(200)
    expect(Object.keys(invalidated.sandbox.redisClusters[0].database.keys)).toEqual([])
    expect(invalidated.redis.calls.at(-1)).toMatchObject({ command: 'DEL', args: ['absent-one', 'absent-two'] })
    const failed = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: target, functionName: 'fail_after_write', nowMs: 0 })
    expect(failed.error.code).toBe('ResponseError')
    expect(failed.sandbox.redisClusters[0].database.keys.survives.value).toBe('learner value')
    const truncated = runDataFunction({ appSpec: parsed.appSpec, sandbox: two.sandbox, dataTarget: target, functionName: 'bounded_trace', args: [Array(257).fill('missing')], nowMs: 1000 })
    expect(truncated.status).toBe(200)
    expect(truncated.redis.calls).toHaveLength(256)
    expect(truncated.redis.traceTruncated).toBe(true)
    expect(truncated.redis.calls[0].hit).toBe(false)
    expect(truncated.redis.measurements.misses).toBe(258)
  })
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
