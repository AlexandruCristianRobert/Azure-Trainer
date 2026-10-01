import { expect, it } from 'vitest'
import { createSandbox, isSandboxShape } from '../src/lib/sandbox/model.js'
import { createResourceGroup } from '../src/lib/sandbox/ops.js'
import { createRedisCluster, getRedisCluster } from '../src/lib/sandbox/redis.js'
import { executeRedis } from '../src/lib/data/redis-store.js'

const target = { kind: 'redis', resourceGroup: 'rg-assistant', cluster: 'redis-assistant', database: 'default' }
function fixture(memoryLimitBytes = 65536) {
  const sb = createResourceGroup(createSandbox(), { name: 'rg-assistant', location: 'westeurope' }).sandbox
  const result = createRedisCluster(sb, { name: target.cluster, resourceGroup: target.resourceGroup,
    location: 'westeurope', sku: 'Balanced_B0', modules: ['RediSearch'],
    clusteringPolicy: 'EnterpriseCluster', evictionPolicy: 'NoEviction', memoryLimitBytes })
  if (result.error) throw new Error(result.error.message)
  return result.sandbox
}

it('expires at the boundary and SET without EX clears an old TTL', () => {
  const original = fixture()
  let sb = executeRedis(original, target, 'SET', ['a', 'old', 'EX', 2], { nowMs: 0 }).sandbox
  expect(executeRedis(sb, target, 'GET', ['a'], { nowMs: 1999 }).value).not.toBeNull()
  const expired = executeRedis(sb, target, 'GET', ['a'], { nowMs: 2000 })
  expect(expired.value).toBeNull()
  expect(expired.measurements).toMatchObject({ usedBytes: 0, expiredKeys: 1, misses: 1 })
  expect(getRedisCluster(original, { resourceGroup: target.resourceGroup, name: target.cluster }).database.keys).toEqual({})
  sb = executeRedis(sb, target, 'SET', ['a', 'fresh', 'EX', 2], { nowMs: 3000 }).sandbox
  sb = executeRedis(sb, target, 'SET', ['a', 'persistent'], { nowMs: 3100 }).sandbox
  expect(executeRedis(sb, target, 'TTL', ['a'], { nowMs: 3100 }).value).toBe(-1)
  expect(executeRedis(sb, target, 'SET', ['a', 'bad', 'EX', 0], { nowMs: 3100 }).error.code).toBe('ResponseError')
  expect(executeRedis(sb, target, 'SET', ['a', 'bad', 'NX'], { nowMs: 3100 }).error).toMatchObject({
    code: 'DATA_UNSUPPORTED', message: expect.stringMatching(/^Not supported by the simulator:/),
  })
  expect(isSandboxShape(JSON.parse(JSON.stringify(sb)))).toBe(true)
  const key = state => getRedisCluster(state, { resourceGroup: target.resourceGroup, name: target.cluster }).database.keys.a
  expect(key(sb).writtenAtMs).toBe(3100)
  sb = executeRedis(sb, target, 'GET', ['a'], { nowMs: 3200 }).sandbox
  sb = executeRedis(sb, target, 'EXPIRE', ['a', 3], { nowMs: 3300 }).sandbox
  expect(key(sb)).toMatchObject({ writtenAtMs: 3100, lastAccessMs: 3200 })
  delete key(sb).writtenAtMs
  expect(isSandboxShape(sb)).toBe(true)
  key(sb).writtenAtMs = -1
  expect(isSandboxShape(sb)).toBe(false)
})

it('preserves hash TTL and rejects wrong-type reads', () => {
  let sb = executeRedis(fixture(), target, 'HSET', ['h', { payload: 'answer' }], { nowMs: 0 }).sandbox
  sb = executeRedis(sb, target, 'EXPIRE', ['h', 3], { nowMs: 0 }).sandbox
  const added = executeRedis(sb, target, 'HSET', ['h', { product: 'contoso-backup' }], { nowMs: 1000 })
  expect(added.value).toBe(1)
  sb = added.sandbox
  expect(getRedisCluster(sb, { resourceGroup: target.resourceGroup, name: target.cluster }).database.keys.h.writtenAtMs).toBe(1000)
  expect(executeRedis(sb, target, 'TTL', ['h'], { nowMs: 1500 }).value).toBe(1)
  expect(executeRedis(sb, target, 'GET', ['h'], { nowMs: 1500 }).error.message).toContain('WRONGTYPE')
  expect(executeRedis(sb, target, 'TTL', ['absent'], { nowMs: 1500 }).value).toBe(-2)
  const read = executeRedis(sb, target, 'HGETALL', ['h'], { nowMs: 1500 })
  expect(read.value).toEqual({ payload: 'answer', product: 'contoso-backup' })
  read.value.payload = 'caller mutation'
  expect(executeRedis(read.sandbox, target, 'HGETALL', ['h'], { nowMs: 1500 }).value.payload).toBe('answer')
  sb = executeRedis(sb, target, 'SET', ['h', 7], { nowMs: 1500 }).sandbox
  expect(executeRedis(sb, target, 'HGETALL', ['h'], { nowMs: 1500 }).error.code).toBe('ResponseError')
  expect(executeRedis(sb, target, 'TTL', ['h'], { nowMs: 1500 }).value).toBe(-1)
  const deleted = executeRedis(sb, target, 'EXPIRE', ['h', 0], { nowMs: 1500 })
  expect(deleted.value).toBe(1)
  expect(executeRedis(deleted.sandbox, target, 'EXISTS', ['h'], { nowMs: 1500 }).value).toBe(0)
})

it('invalidates both product namespaces without deleting another product', () => {
  let sb = fixture()
  for (const key of ['ka:answer:contoso-backup:v1:en:a', 'ka:sem:contoso-backup:v1:en:b', 'ka:answer:contoso-support:v1:en:c']) {
    sb = executeRedis(sb, target, 'SET', [key, 'x', 'EX', 60], { nowMs: 0 }).sandbox
  }
  for (const prefix of ['ka:answer:contoso-backup:*', 'ka:sem:contoso-backup:*']) {
    const scan = executeRedis(sb, target, 'SCAN', ['0', 'MATCH', prefix, 'COUNT', 100], { nowMs: 0 })
    expect(scan.error).toBeUndefined()
    sb = executeRedis(scan.sandbox, target, 'DEL', scan.value[1], { nowMs: 0 }).sandbox
  }
  expect(executeRedis(sb, target, 'EXISTS', ['ka:answer:contoso-backup:v1:en:a'], { nowMs: 0 }).value).toBe(0)
  expect(executeRedis(sb, target, 'EXISTS', ['ka:sem:contoso-backup:v1:en:b'], { nowMs: 0 }).value).toBe(0)
  expect(executeRedis(sb, target, 'EXISTS', ['ka:answer:contoso-support:v1:en:c'], { nowMs: 0 }).value).toBe(1)
  for (const key of ['page:a', 'page:b', 'page:c', '__proto__']) {
    sb = executeRedis(sb, target, 'SET', [key, 'x'], { nowMs: 0 }).sandbox
  }
  let cursor = '0'
  const found = []
  do {
    const scan = executeRedis(sb, target, 'SCAN', [cursor, 'MATCH', 'page:*', 'COUNT', 1], { nowMs: 0 })
    cursor = scan.value[0]
    found.push(...scan.value[1])
    sb = executeRedis(scan.sandbox, target, 'DEL', scan.value[1], { nowMs: 0 }).sandbox
  } while (cursor !== '0')
  expect(found.sort()).toEqual(['page:a', 'page:b', 'page:c'])
  expect(executeRedis(sb, target, 'GET', ['__proto__'], { nowMs: 0 }).value).toBe('x')
  expect(executeRedis(sb, target, 'SCAN', ['0', 'MATCH', 'page:?', 'COUNT', 1], { nowMs: 0 }).error.code).toBe('DATA_UNSUPPORTED')
  expect(executeRedis(sb, target, 'SCAN', ['0', 'MATCH', '*'], { nowMs: 60000 }).value[1]).toEqual(['__proto__'])
})

it('rejects over-budget writes atomically and reuses expired capacity', () => {
  let sb = executeRedis(fixture(100), target, 'SET', ['a', 'old', 'EX', 1], { nowMs: 0 }).sandbox
  const rejected = executeRedis(sb, target, 'SET', ['a', 'x'.repeat(100)], { nowMs: 500 })
  expect(rejected.error.message).toContain('OOM')
  expect(rejected.error.code).toBe('ResponseError')
  expect(rejected.measurements).toMatchObject({ usedBytes: 68, rejectedWrites: 1 })
  expect(getRedisCluster(rejected.sandbox, { resourceGroup: target.resourceGroup, name: target.cluster }).database.keys.a.writtenAtMs).toBe(0)
  expect(executeRedis(rejected.sandbox, target, 'GET', ['a'], { nowMs: 500 }).value).toBe('old')
  const accepted = executeRedis(rejected.sandbox, target, 'SET', ['b', 'new'], { nowMs: 1000 })
  expect(accepted.error).toBeUndefined()
  expect(executeRedis(accepted.sandbox, target, 'GET', ['a'], { nowMs: 1000 }).value).toBeNull()
  expect(accepted.measurements).toMatchObject({ usedBytes: 68, expiredKeys: 1, rejectedWrites: 1 })
  const binary = { redisKind: 'bytes', base64: 'AAEC' }
  const saved = executeRedis(fixture(), target, 'HSET', ['é', { f: binary }], { nowMs: 0 })
  binary.base64 = 'AAAAAA=='
  expect(saved.measurements.usedBytes).toBe(86)
  const info = executeRedis(saved.sandbox, target, 'INFO', ['memory'], { nowMs: 0 })
  expect(info.value).toMatchObject({ used_memory: 86, maxmemory: 65536, maxmemory_policy: 'noeviction' })
  expect(executeRedis(info.sandbox, target, 'HGETALL', ['é'], { nowMs: 0 }).value.f).toEqual({ redisKind: 'bytes', base64: 'AAEC' })
  expect(isSandboxShape(JSON.parse(JSON.stringify(info.sandbox)))).toBe(true)
})
