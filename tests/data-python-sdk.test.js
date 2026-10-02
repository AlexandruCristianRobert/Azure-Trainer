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
import { createCosmosAccount, createCosmosDatabase, createCosmosContainer } from '../src/lib/sandbox/cosmosdb.js'
import { CHANGE_FEED_HOOK } from '../src/lib/data/change-feed.js'

const mixedTarget = { kind: 'composite', postgres: { kind: 'postgres', resourceGroup: 'rg-data-capstone', server: 'pg-assistant', database: 'knowledge', port: 5432 }, cosmos: { account: 'cosmos-assistant', database: 'knowledge' }, redis: { kind: 'redis', resourceGroup: 'rg-data-capstone', cluster: 'redis-assistant' } }
const mixedManifest = { ...REDIS_RUNTIME_MANIFEST, dataApp: true, dataBackend: 'composite', id: 'data-python-capstone-v1', dataTarget: mixedTarget, helperProfile: 'redis-codecs', runtimeFunctions: REDIS_RUNTIME_MANIFEST.runtimeFunctions.filter(name => name !== 'source_answer'), receivers: { sessions: 'cosmos-container' }, editZones: ['round_trip', 'literal_return', 'relay'], routes: { 'GET /answer': 'round_trip' } }
const mixedFiles = { ...REDIS_HELPER_FILES, 'clients.py': `import psycopg
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row
from azure.cosmos import CosmosClient
import redis
DSN = "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge"
pool = ConnectionPool(DSN, max_size=4)
cache = redis.Redis("redis-assistant.eastus.redis.training.invalid", 10000, password="Training-Only-Redis-Key", ssl=True, decode_responses=False, protocol=2)
client = CosmosClient("https://cosmos-assistant.documents.azure.com:443/", credential="training-only-key", consistency_level="Session")
db = client.get_database_client("knowledge")
sessions = db.get_container_client("sessions")
def connect():
    return psycopg.connect(DSN, row_factory=dict_row)
`, 'app.py': `from clients import connect, cache, sessions
from training_runtime import encode_answer, decode_answer
def round_trip():
    with connect() as conn:
        conn.execute("SET LOCAL hnsw.iterative_scan = strict_order")
        row = conn.execute("SELECT id, body FROM documents WHERE id = %s", (1,)).fetchone()
    cache.set("round-trip", encode_answer(row), ex=60)
    answer = relay(cache.get("round-trip"))
    sessions.upsert_item({"id": "m1", "sessionId": "s1", "answer": answer})
    return answer
def relay(payload):
    return decode_answer(payload)
def literal_return():
    answer = relay(cache.get("round-trip"))
    return {"id": 1, "body": "one source row"}
` }
function mixedSandbox() {
  let sandbox = createResourceGroup(createSandbox(), { name: 'rg-data-capstone', location: 'eastus' }).sandbox
  sandbox = createPostgresServer(sandbox, { ...mixedTarget.postgres, name: mixedTarget.postgres.server }).sandbox
  sandbox = createPostgresDatabase(sandbox, { ...mixedTarget.postgres, name: 'knowledge' }).sandbox
  sandbox = executePg(sandbox, { ...mixedTarget.postgres, sql: "CREATE TABLE documents (id bigint PRIMARY KEY, body text); INSERT INTO documents (id, body) VALUES (1, 'one source row')" }).sandbox
  sandbox = createRedisCluster(sandbox, { ...mixedTarget.redis, name: mixedTarget.redis.cluster }).sandbox
  const cosmos = { resourceGroup: 'rg-data-capstone', ...mixedTarget.cosmos }
  sandbox = createCosmosAccount(sandbox, { ...cosmos, name: cosmos.account, locations: { regionName: 'eastus' } }).sandbox
  sandbox = createCosmosDatabase(sandbox, { ...cosmos, name: cosmos.database }).sandbox
  return createCosmosContainer(sandbox, { ...cosmos, name: 'sessions', partitionKeyPath: '/sessionId', throughput: 400 }).sandbox
}

const manifest = { editZones: ['get_session', 'recent'], receivers: { sessions: 'cosmos-container' } }
const files = (app, clients = 'from azure.cosmos import CosmosClient\nclient = CosmosClient(URL, credential=KEY, consistency_level="Session")\n') => ({ 'app.py': app, 'clients.py': clients })

describe('parseDataApp', () => {
  it('executes a manifest-gated PostgreSQL to Redis to Cosmos round trip with returned cache provenance', () => {
    const parsed = parseDataApp(mixedFiles, mixedManifest)
    expect(parsed.diagnostics).toEqual([])
    const sandbox = mixedSandbox()
    const result = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: mixedTarget, functionName: 'round_trip', args: [], nowMs: 0, changeFeed: CHANGE_FEED_HOOK })
    expect(result.status, JSON.stringify(result.error)).toBe(200)
    expect(result.value).toEqual({ id: 1, body: 'one source row' })
    expect(result.calls.some(call => typeof call.sql === 'string')).toBe(true)
    expect(result.calls.some(call => call.call === 'cosmos.container.upsert_item')).toBe(true)
    expect(result.redis.calls.map(call => call.command)).toEqual(['SET', 'GET'])
    expect(result.redis.returnProvenance).toMatchObject({ kind: 'get', callIndex: 1, key: 'round-trip' })
    expect(result.connections).toMatchObject({ opened: 1, closed: 1, active: 0 })
    expect(result.sandbox.postgresServers[0].databases[0].tables.find(table => table.name === 'documents').rows).toEqual([{ id: 1, body: 'one source row' }])
    expect(result.sandbox.redisClusters[0].database.keys['round-trip'].value).toMatchObject({ redisKind: 'bytes' })
    const container = result.sandbox.cosmosAccounts[0].databases[0].containers[0]
    expect(container.items[0]).toMatchObject({ id: 'm1', sessionId: 's1', answer: { id: 1, body: 'one source row' } })
    expect(container.changeLog).toHaveLength(1)
    const originSource = mixedFiles['app.py'].replace('    return answer\n', '    return relay(encode_answer(row))\n')
    const originParsed = parseDataApp({ ...mixedFiles, 'app.py': originSource }, mixedManifest)
    expect(originParsed.diagnostics).toEqual([])
    const origin = runDataFunction({ appSpec: originParsed.appSpec, sandbox, dataTarget: mixedTarget, functionName: 'round_trip', nowMs: 0 })
    expect(origin.status, JSON.stringify(origin.error)).toBe(200)
    expect(origin.redis.returnProvenance).toEqual({ kind: 'postgres', callIndex: 1 })
    expect(origin.value).toEqual({ id: 1, body: 'one source row' })
  })
  it('does not certify an equal literal as a cache return or grant composite authority to a single-service manifest', () => {
    const parsed = parseDataApp(mixedFiles, mixedManifest)
    expect(parsed.diagnostics).toEqual([])
    const cached = executeRedis(mixedSandbox(), { ...mixedTarget.redis, database: 'default' }, 'SET', ['round-trip', '{"id":1,"body":"one source row"}']).sandbox
    const literal = runDataFunction({ appSpec: parsed.appSpec, sandbox: cached, dataTarget: mixedTarget, functionName: 'literal_return', nowMs: 0 })
    expect(literal.status, JSON.stringify(literal.error)).toBe(200)
    expect(literal.value).toEqual({ id: 1, body: 'one source row' })
    expect(literal.redis.calls[0]).toMatchObject({ command: 'GET', hit: true })
    expect(literal.redis.returnProvenance).toBeNull()
    const legacy = parseDataApp(files('def recent():\n    return []\n'), { editZones: ['recent'] })
    expect(runDataFunction({ appSpec: legacy.appSpec, sandbox: cached, dataTarget: mixedTarget, functionName: 'recent' }).error.code).toBe('DATA_UNSUPPORTED')
    expect(runDataFunction({ appSpec: parsed.appSpec, sandbox: cached, dataTarget: { ...mixedTarget, cosmos: { ...mixedTarget.cosmos, database: 'foreign' } }, functionName: 'literal_return' }).error.code).toBe('DATA_UNSUPPORTED')
    expect(parseDataApp({ ...mixedFiles, 'app.py': mixedFiles['app.py'] + '\ndef forbidden():\n    return source_answer("q", "p", "v1", "en")\n', }, { ...mixedManifest, editZones: ['forbidden'] }).diagnostics.some(d => d.code === 'DATA_UNSUPPORTED')).toBe(true)
    expect(parseDataApp({ ...mixedFiles, 'clients.py': mixedFiles['clients.py'].replace('get_database_client("knowledge")', 'get_database_client(DSN)') }, mixedManifest).diagnostics.some(d => d.code === 'DATA_UNSUPPORTED')).toBe(true)
    const aliasedCosmos = mixedFiles['clients.py'].replace('import CosmosClient', 'import CosmosClient as HistoryClient').replace('= CosmosClient(', '= HistoryClient(').replace('consistency_level="Session"', 'consistency_level="Eventual"')
    const aliased = parseDataApp({ ...mixedFiles, 'clients.py': aliasedCosmos }, mixedManifest)
    expect(aliased.diagnostics).toEqual([])
    expect(aliased.appSpec.data.client.consistency).toBe('Eventual')
  })
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
from training_runtime import embed, pack_embedding, decode_search, decode_answer, encode_answer, semantic_key
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
def semantic_store(question, product, version, language, answer):
    cache.hset(semantic_key(question, product, version, language), mapping={"product": product, "version": version, "language": language, "payload": encode_answer(answer), "embedding": pack_embedding(embed(question))})
    return answer
`
    const files = { ...REDIS_HELPER_FILES, 'app.py': app, 'clients.py': 'import redis as cache_sdk\ncache = cache_sdk.Redis("redis-assistant.eastus.redis.training.invalid", 10000, password="Training-Only-Redis-Key", ssl=True, decode_responses=False, protocol=2)\n' }
    const manifest = { ...REDIS_RUNTIME_MANIFEST, editZones: ['semantic_lookup', 'semantic_store'], routes: { 'GET /answer': 'semantic_lookup' } }
    const parsed = parseDataApp(files, manifest)
    expect(parsed.diagnostics).toEqual([])
    const result = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: target, functionName: 'semantic_lookup', args: [question, 'contoso-backup', 'v1', 'en', 0.05], nowMs: 0 })
    expect(result.status).toBe(200)
    expect(result.value).toEqual(answer)
    expect(result.redis.calls.some(call => call.command === 'FT.SEARCH')).toBe(true)
    expect(result.redis.originCalls).toBe(0)
    result.value.answer = 'detached'
    expect(sandbox.redisClusters[0].database.keys['ka:sem:contoso-backup:v1:en:seed'].value.payload).toBe(JSON.stringify(answer))
    const cleared = executeRedis(result.sandbox, target, 'DEL', ['ka:sem:contoso-backup:v1:en:seed']).sandbox
    const stored = runDataFunction({ appSpec: parsed.appSpec, sandbox: cleared, dataTarget: target, functionName: 'semantic_store', args: [question, 'contoso-backup', 'v1', 'en', answer], nowMs: 0 })
    expect(stored.status).toBe(200)
    expect(Object.values(stored.sandbox.redisClusters[0].database.keys)[0].value.payload).toMatchObject({ redisKind: 'bytes' })
    const sdkHit = runDataFunction({ appSpec: parsed.appSpec, sandbox: stored.sandbox, dataTarget: target, functionName: 'semantic_lookup', args: [question, 'contoso-backup', 'v1', 'en', 0.05], nowMs: 0 })
    expect(sdkHit.status).toBe(200)
    expect(sdkHit.value).toEqual(answer)
    expect(sdkHit.redis.originCalls).toBe(0)
    expect(sdkHit.redis.calls[0].value[2]).toContainEqual(expect.objectContaining({ redisKind: 'bytes' }))
    expect(sdkHit.redis.returnProvenance).toMatchObject({ kind: 'search', callIndex: 0 })
    const canned = parseDataApp({ ...files, 'app.py': app.replace('return decode_answer(row["payload"])', `return ${JSON.stringify(answer)}`) }, manifest)
    expect(canned.diagnostics).toEqual([])
    const fabricated = runDataFunction({ appSpec: canned.appSpec, sandbox: stored.sandbox, dataTarget: target, functionName: 'semantic_lookup', args: [question, 'contoso-backup', 'v1', 'en', 0.05], nowMs: 0 })
    expect(fabricated.value).toEqual(answer)
    expect(fabricated.redis.returnProvenance).toBeNull()
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
    expect(one.redis.returnProvenance).toMatchObject({ kind: 'source', callIndex: 0 })
    expect(two.redis.returnProvenance).toMatchObject({ kind: 'get', callIndex: 0 })
    for (const source of [app.replace('return decode_answer(value)', `return ${JSON.stringify(one.value)}`), app.replace('    return result\n', `    return ${JSON.stringify(one.value)}\n`)]) {
      const canned = parseDataApp({ ...files, 'app.py': source }, manifest)
      expect(canned.diagnostics).toEqual([])
      const fabricated = runDataFunction({ appSpec: canned.appSpec, sandbox: source.includes('return decode_answer(value)') ? sandbox : one.sandbox, dataTarget: target, functionName: 'cached_answer', args: [question, 'contoso-backup', 'v1', 'en', 60], nowMs: 1000 })
      expect(fabricated.value).toEqual(one.value)
      expect(fabricated.redis.returnProvenance).toBeNull()
    }
    const nestedSource = app.replace('return decode_answer(value)', 'return relay(value)').replace('    return result\n', '    return relay(encode_answer(result))\n') + '\ndef relay(payload):\n    items = [{"payload": payload, "unrelated": "literal"}]\n    for item in items:\n        return decode_answer(encode_answer(decode_answer(item["payload"])))\n'
    const nested = parseDataApp({ ...files, 'app.py': nestedSource, 'clients.py': files['clients.py'].replace('decode_responses=False', 'decode_responses=True') }, { ...manifest, editZones: [...manifest.editZones, 'relay'] })
    expect(nested.diagnostics).toEqual([])
    for (const [state, kind] of [[sandbox, 'source'], [one.sandbox, 'get']]) {
      const flow = runDataFunction({ appSpec: nested.appSpec, sandbox: state, dataTarget: target, functionName: 'cached_answer', args: [question, 'contoso-backup', 'v1', 'en', 60], nowMs: 1000 })
      expect(flow.value).toEqual(one.value)
      expect(flow.redis.returnProvenance).toMatchObject({ kind, callIndex: 0 })
    }
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
    for (const binding of ['unused, response_key = (None, None)', '(unused, [response_key]) = (None, [None])', 'unused = response_key = None', 'response_key += "shadow"', 'for unused, response_key in []:\n    pass', 'del response_key', 'if (response_key := None):\n    pass', 'try:\n    pass\nexcept ValueError as response_key:\n    pass', 'from other import (\n    unused,\n    response_key\n)', 'def unused():\n    from other import response_key']) {
      const shadowed = parseDataApp({ ...files, 'app.py': app + `\n${binding}\n` }, manifest)
      expect.soft(shadowed.diagnostics.some(d => d.code === 'SCAFFOLD_MODIFIED'), binding).toBe(true)
    }
    const constructorShadow = parseDataApp({ ...files, 'app.py': 'from redis import Redis as ImportedClient\n' + app + '\nunused, ImportedClient = (None, None)\n' }, manifest)
    expect.soft(constructorShadow.diagnostics.some(d => d.code === 'DATA_UNSUPPORTED')).toBe(true)
    const wrongConnection = parseDataApp({ ...files, 'clients.py': files['clients.py'].replace('ssl=True', 'ssl=False') }, manifest)
    const disconnected = runDataFunction({ appSpec: wrongConnection.appSpec, sandbox, dataTarget: target, functionName: 'cached_answer', args: [question, 'contoso-backup', 'v1', 'en', 60] })
    expect(disconnected.error.code).toBe('ConnectionError')
    expect(JSON.stringify(disconnected.redis)).not.toContain('Training-Only-Redis-Key')
    const hash = runDataFunction({ appSpec: parsed.appSpec, sandbox, dataTarget: target, functionName: 'hash_check', nowMs: 0 })
    expect.soft(hash.error?.code).toBe('DATA_UNSUPPORTED')
    expect(hash.error.message).toMatch(/^Not supported by the simulator:/)
    const decoded = parseDataApp({ ...files, 'clients.py': files['clients.py'].replace('decode_responses=False', 'decode_responses=True') }, manifest)
    expect(decoded.diagnostics).toEqual([])
    const decodedHash = runDataFunction({ appSpec: decoded.appSpec, sandbox, dataTarget: target, functionName: 'hash_check', nowMs: 0 })
    expect(decodedHash.value).toEqual({ value: { answer: 'learner value' }, ttl: 60, exists: 1 })
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
