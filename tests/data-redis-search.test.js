import { expect, it } from 'vitest'
import { createSandbox, isSandboxShape } from '../src/lib/sandbox/model.js'
import { createResourceGroup } from '../src/lib/sandbox/ops.js'
import { createRedisCluster, getRedisCluster } from '../src/lib/sandbox/redis.js'
import { executeRedis, redisMemory } from '../src/lib/data/redis-store.js'
import { executeRedisSearch, float32Blob } from '../src/lib/data/redis-search.js'
import { runLine } from '../src/lib/az/shell.js'

const target = { kind: 'redis', resourceGroup: 'rg-assistant', cluster: 'redis-assistant', database: 'default' }
const schema = ['idx:semantic', 'ON', 'HASH', 'PREFIX', 1, 'ka:sem:', 'SCHEMA',
  'product', 'TAG', 'version', 'TAG', 'language', 'TAG', 'embedding', 'VECTOR', 'HNSW', 6,
  'TYPE', 'FLOAT32', 'DIM', 8, 'DISTANCE_METRIC', 'COSINE']
const query = '(@product:{contoso-backup} @version:{v1} @language:{en})=>[KNN 1 @embedding $vec AS distance]'
const searchArgs = () => ['idx:semantic', query, 'PARAMS', 2, 'vec', float32Blob([1, 0, 0, 0, 0, 0, 0, 0]),
  'SORTBY', 'distance', 'ASC', 'RETURN', 2, 'payload', 'distance', 'DIALECT', 2]
const db = sb => getRedisCluster(sb, { resourceGroup: target.resourceGroup, name: target.cluster }).database
function fixture(modules = ['RediSearch']) {
  const sb = createResourceGroup(createSandbox(), { name: 'rg-assistant', location: 'westeurope' }).sandbox
  return createRedisCluster(sb, { name: target.cluster, resourceGroup: target.resourceGroup,
    location: 'westeurope', sku: 'Balanced_B0', modules, clusteringPolicy: 'EnterpriseCluster',
    evictionPolicy: 'NoEviction', memoryLimitBytes: 65536 }).sandbox
}
function put(sb, key, product, version, language, vector, payload) {
  return executeRedis(sb, target, 'HSET', [key, { product, version, language,
    embedding: float32Blob(vector), payload }], { nowMs: 0 }).sandbox
}

it('filters all answer scopes before cosine ranking', () => {
  const original = fixture()
  const created = executeRedisSearch(original, target, 'FT.CREATE', schema, { nowMs: 0 })
  expect(created.error).toBeUndefined()
  let sb = created.sandbox
  sb = put(sb, 'ka:sem:right', 'contoso-backup', 'v1', 'en', [0.9659, 0.2588, 0, 0, 0, 0, 0, 0], 'right')
  sb = put(sb, 'ka:sem:product', 'contoso-support', 'v1', 'en', [1, 0, 0, 0, 0, 0, 0, 0], 'wrong')
  sb = put(sb, 'ka:sem:version', 'contoso-backup', 'v2', 'en', [1, 0, 0, 0, 0, 0, 0, 0], 'wrong')
  sb = put(sb, 'ka:sem:language', 'contoso-backup', 'v1', 'de', [1, 0, 0, 0, 0, 0, 0, 0], 'wrong')
  const result = executeRedisSearch(sb, target, 'FT.SEARCH', searchArgs(), { nowMs: 0 })
  expect(result.error).toBeUndefined()
  expect(result.value[0]).toBe(1)
  expect(result.value[1]).toBe('ka:sem:right')
  expect(result.value[2]).toContain('right')
  expect(Number(result.value[2][result.value[2].indexOf('distance') + 1])).toBeCloseTo(0.0341, 3)
  expect(db(original).indexes).toEqual({})
  expect(float32Blob([1, 0])).toEqual({ redisKind: 'bytes', base64: 'AACAPwAAAAA=' })
  expect(() => float32Blob([Infinity])).toThrow()
  expect(() => float32Blob([1e40])).toThrow()
  expect(() => float32Blob(Array(8))).toThrow()
  sb = put(sb, 'ka:sem:aaa', 'contoso-backup', 'v1', 'en', [0.9659, 0.2588, 0, 0, 0, 0, 0, 0], 'tie')
  const tied = searchArgs(); tied[1] = query.replace('KNN 1', 'KNN 2')
  expect(executeRedisSearch(sb, target, 'FT.SEARCH', tied, { nowMs: 0 }).value.filter(v => typeof v === 'string')).toEqual(['ka:sem:aaa', 'ka:sem:right'])
  const binaryReturn = searchArgs(); binaryReturn[11] = 'embedding'
  expect(executeRedisSearch(sb, target, 'FT.SEARCH', binaryReturn, { nowMs: 0 }).error.code).toBe('DATA_UNSUPPORTED')
  expect(isSandboxShape(JSON.parse(JSON.stringify(sb)))).toBe(true)
})

it('requires module/index and rejects mismatched binary dimensions', () => {
  const noModule = fixture([])
  const missing = executeRedisSearch(noModule, target, 'FT.CREATE', schema, { nowMs: 0 })
  expect(missing.error.code).toBe('ResponseError')
  expect(missing.sandbox).toEqual(noModule)
  expect(executeRedisSearch(fixture(), target, 'FT.SEARCH', searchArgs(), { nowMs: 0 }).error.code).toBe('ResponseError')
  const sb = executeRedisSearch(fixture(), target, 'FT.CREATE', schema, { nowMs: 0 }).sandbox
  const before = JSON.stringify(sb)
  const bad = searchArgs(); bad[5] = float32Blob([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  const rejected = executeRedisSearch(sb, target, 'FT.SEARCH', bad, { nowMs: 0 })
  expect(rejected.error).toMatchObject({ code: 'ResponseError', message: expect.stringMatching(/dimension|size/i) })
  expect(JSON.stringify(rejected.sandbox)).toBe(before)
  const malformed = searchArgs(); malformed[5] = { redisKind: 'bytes', base64: '!!!!' }
  expect(executeRedisSearch(sb, target, 'FT.SEARCH', malformed, { nowMs: 0 }).error.code).toBe('ResponseError')
  const badStored = put(sb, 'ka:sem:bad', 'contoso-backup', 'v1', 'en', [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'bad')
  expect(executeRedisSearch(badStored, target, 'FT.SEARCH', searchArgs(), { nowMs: 0 }).value[0]).toBe(0)
  const info = executeRedisSearch(badStored, target, 'FT.INFO', ['idx:semantic'], { nowMs: 0 })
  expect(info.value).toContain('num_docs')
  expect(info.value[info.value.indexOf('hash_indexing_failures') + 1]).toBe(1)
  expect(info.measurements.indexInfo).toMatchObject({ num_docs: 0, hash_indexing_failures: 1 })
  expect(info.measurements.indexInfo.indexing_errors[0]).toMatchObject({ key: 'ka:sem:bad', message: expect.stringMatching(/dimension|size/i) })
  const schema12 = schema.slice(); schema12[20] = 12
  let twelve = executeRedisSearch(fixture(), target, 'FT.CREATE', schema12, { nowMs: 0 }).sandbox
  twelve = put(twelve, 'ka:sem:twelve', 'contoso-backup', 'v1', 'en', [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'twelve')
  expect(executeRedisSearch(twelve, target, 'FT.SEARCH', bad, { nowMs: 0 }).value[1]).toBe('ka:sem:twelve')
  const limited = fixture(); db(limited).memoryLimitBytes = 255
  const oom = executeRedisSearch(limited, target, 'FT.CREATE', schema, { nowMs: 0 })
  expect(oom.error.message).toContain('OOM')
  expect(db(oom.sandbox).indexes).toEqual({})
  const indexed = executeRedisSearch(fixture(), target, 'FT.CREATE', schema, { nowMs: 0 }).sandbox
  db(indexed).memoryLimitBytes = 530 // hash 249 + index 256 + document 32 = 537
  const write = executeRedis(indexed, target, 'HSET', ['ka:sem:right', { product: 'contoso-backup', version: 'v1', language: 'en', embedding: float32Blob([1, 0, 0, 0, 0, 0, 0, 0]), payload: 'right' }], { nowMs: 0 })
  expect(write.error).toBeDefined()
  expect(write.error.message).toContain('OOM')
  expect(db(write.sandbox).keys).toEqual({})
})

it('excludes expired hashes and diagnoses unsupported query shapes', () => {
  let sb = executeRedisSearch(fixture(), target, 'FT.CREATE', schema, { nowMs: 0 }).sandbox
  sb = put(sb, 'ka:sem:gone', 'contoso-backup', 'v1', 'en', [1, 0, 0, 0, 0, 0, 0, 0], 'expired')
  sb = executeRedis(sb, target, 'EXPIRE', ['ka:sem:gone', 1], { nowMs: 0 }).sandbox
  const expired = executeRedisSearch(sb, target, 'FT.SEARCH', searchArgs(), { nowMs: 1000 })
  expect(expired.error).toBeUndefined()
  expect(expired.value[0]).toBe(0)
  expect(expired.measurements).toMatchObject({ usedBytes: 256, expiredKeys: 1 })
  expect(redisMemory(expired.sandbox.redisClusters[0].database, 1000).usedBytes).toBe(256)
  const bad = searchArgs(); bad[bad.length - 1] = 1
  expect(executeRedisSearch(sb, target, 'FT.SEARCH', bad, { nowMs: 1000 }).error.code).toBe('DATA_UNSUPPORTED')
  expect(executeRedisSearch(sb, target, 'FT.AGGREGATE', ['idx:semantic', '*'], { nowMs: 1000 }).error.code).toBe('DATA_UNSUPPORTED')
  for (const replacement of ['*=>[KNN 1 @embedding $vec AS distance]', query.replace('KNN 1', 'KNN 11'), query.replace('$vec', '$missing'), query.replace('v1', 'v1|v2')]) {
    const args = searchArgs(); args[1] = replacement
    expect(executeRedisSearch(sb, target, 'FT.SEARCH', args, { nowMs: 1000 }).error).toBeDefined()
  }
  for (const changed of [schema.map(v => v === 'HNSW' ? 'FLAT' : v), schema.map(v => v === 'FLOAT32' ? 'FLOAT64' : v), schema.map(v => v === 'version' ? 'product' : v), schema.map(v => v === 'HASH' ? 'JSON' : v), schema.slice(0, -1)]) {
    expect(executeRedisSearch(fixture(), target, 'FT.CREATE', changed, { nowMs: 0 }).error).toBeDefined()
  }
  const params = searchArgs(); params[3] = 4
  expect(executeRedisSearch(sb, target, 'FT.SEARCH', params, { nowMs: 0 }).error).toBeDefined()
  const context = { lab: { capabilities: { dataRedis: true } }, run: { runtime: { simTimeMs: 1000 } } }
  const connection = 'redis-cli -h redis-assistant.westeurope.redis.training.invalid -p 10000 --tls -a Training-Only-Redis-Key '
  expect(runLine(fixture(), connection + 'FT.CREATE ' + schema.join(' '), context).results[0].value).toBe('OK')
  expect(runLine(sb, connection + 'TTL ka:sem:gone', context).lines[0]).toEqual({ kind: 'out', text: '-2' })
  expect(runLine(sb, connection + 'FT.INFO idx:semantic', context).results[0].measurements.indexInfo.num_docs).toBe(0)
  expect(runLine(sb, connection + 'SCAN 0 MATCH ka:sem:* COUNT 100', context).results[0].value).toEqual(['0', []])
  expect(runLine(sb, connection.replace('--tls ', '') + 'INFO memory', context).results[0].error.code).toBe('ConnectionError')
  expect(runLine(sb, connection + 'INFO memory', context).results[0].value.used_memory).toBe(256)
  expect(runLine(sb, connection + 'FT.SEARCH idx:semantic anything', context).results[0].error.code).toBe('DATA_UNSUPPORTED')
  expect(runLine(sb, connection + 'FT.DROPINDEX idx:semantic', context).results[0].value).toBe('OK')
  expect(runLine(sb, connection + 'INFO memory', {}).lines[0].text).toContain('command not found')
  const dropped = executeRedisSearch(sb, target, 'FT.DROPINDEX', ['idx:semantic'], { nowMs: 0 })
  expect(dropped.error).toBeUndefined()
  expect(db(dropped.sandbox).keys['ka:sem:gone']).toBeDefined()
  expect(db(dropped.sandbox).indexes).toEqual({})
  expect(executeRedisSearch(sb, target, 'FT.DROPINDEX', ['idx:semantic', 'DD'], { nowMs: 0 }).error.code).toBe('DATA_UNSUPPORTED')
})
