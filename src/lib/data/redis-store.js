import { cloneSandbox } from '../sandbox/model.js'
import { getRedisCluster } from '../sandbox/redis.js'

const fail = message => { throw Object.assign(new Error(message), { code: 'ResponseError' }) }
const unsupported = message => { throw Object.assign(new Error(`Not supported by the simulator: ${message}`), { code: 'DATA_UNSUPPORTED' }) }
const detach = value => value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value
const bytes = value => new TextEncoder().encode(String(value)).length
const ownEntry = (keys, key) => Object.hasOwn(keys, key) ? keys[key] : undefined
const assign = (object, name, value) => Object.defineProperty(object, name, { value, writable: true, enumerable: true, configurable: true })
const live = (entry, nowMs) => entry.expiresAtMs === null || entry.expiresAtMs > nowMs
const valueBytes = value => value?.redisKind === 'bytes' ? value.base64.length / 4 * 3
  - (value.base64.endsWith('==') ? 2 : value.base64.endsWith('=') ? 1 : 0) : bytes(value)

// Teaching fixture accounting, not Redis allocator or Azure SKU capacity.
export function redisMemory(database, nowMs) {
  const entries = Object.entries(database?.keys ?? {}).filter(([, entry]) => live(entry, nowMs))
  const usedBytes = entries.reduce((total, [key, entry]) => total + 64 + bytes(key)
    + (entry.type === 'hash' ? Object.entries(entry.value).reduce((sum, [field, value]) => sum + 16 + bytes(field) + valueBytes(value), 0) : valueBytes(entry.value)), 0)
    + Object.values(database?.indexes ?? {}).reduce((total, index) => total + 256
      + 32 * entries.filter(([key, entry]) => entry.type === 'hash' && key.startsWith(index.prefix)).length, 0)
  return { usedBytes, keyCount: entries.length, persistentKeys: entries.filter(([, entry]) => entry.expiresAtMs === null).length }
}

function scalar(value) {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return value
  if (value && Object.getPrototypeOf(value) === Object.prototype && value.redisKind === 'bytes'
    && typeof value.base64 === 'string' && Object.keys(value).every(key => ['redisKind', 'base64'].includes(key))
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64)
    && btoa(atob(value.base64)) === value.base64) return detach(value)
  unsupported('Redis values must be strings, finite numbers, or canonical JSON binary descriptors.')
}

function keyName(value) {
  if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) return String(value)
  unsupported('Redis key names must be strings or finite numbers.')
}

function integer(value) {
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value))) || !Number.isSafeInteger(Number(value))) {
    fail('ERR value is not an integer or out of range')
  }
  return Number(value)
}

function arity(command, args, count) {
  if (args.length !== count) fail(`ERR wrong number of arguments for '${command.toLowerCase()}' command`)
}

function purge(database, nowMs) {
  for (const [key, entry] of Object.entries(database.keys)) {
    if (!live(entry, nowMs)) { delete database.keys[key]; database.stats.expiredKeys++ }
  }
}

function write(database, key, entry, nowMs) {
  const old = ownEntry(database.keys, key)
  const before = redisMemory(database, nowMs).usedBytes
  assign(database.keys, key, entry)
  const after = redisMemory(database, nowMs).usedBytes
  if (after > database.memoryLimitBytes && after > before) {
    if (old) assign(database.keys, key, old)
    else delete database.keys[key]
    database.stats.rejectedWrites++
    fail("OOM command not allowed when used memory > 'maxmemory'")
  }
}

function scan(database, args) {
  if (!args.length) arity('SCAN', args, 1)
  if (integer(args[0]) !== 0) unsupported('Redis SCAN supports the bounded snapshot cursor 0 only.')
  let pattern = '*'
  const seen = new Set()
  for (let i = 1; i < args.length; i += 2) {
    const option = typeof args[i] === 'string' ? args[i].toUpperCase() : ''
    if (!['MATCH', 'COUNT'].includes(option)) unsupported(`Redis SCAN option '${args[i]}'.`)
    if (seen.has(option) || i + 1 === args.length) fail('ERR syntax error')
    seen.add(option)
    if (option === 'MATCH') {
      if (typeof args[i + 1] !== 'string') unsupported('Redis SCAN MATCH must be a prefix glob.')
      pattern = args[i + 1]
    } else if (integer(args[i + 1]) <= 0) fail('ERR syntax error')
  }
  if (/[?\[\]\\]/.test(pattern) || pattern.slice(0, -1).includes('*')) unsupported('Redis SCAN MATCH supports only literal keys or a trailing * prefix glob.')
  const keys = Object.keys(database.keys)
  if (keys.length > 4096) unsupported('Redis SCAN snapshots are bounded to 4096 live keys.')
  const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : null
  // COUNT is a hint. One complete snapshot avoids offset shifts during deletion.
  return ['0', keys.filter(key => prefix === null ? key === pattern : key.startsWith(prefix)).sort()]
}

function run(database, command, args, nowMs) {
  if (command === 'SCAN') return scan(database, args)
  if (command === 'INFO') {
    if (args.length !== 1 || String(args[0]).toLowerCase() !== 'memory') unsupported('Redis INFO supports the memory section only.')
    return { used_memory: redisMemory(database, nowMs).usedBytes, maxmemory: database.memoryLimitBytes,
      maxmemory_policy: 'noeviction', estimate: 'Simulated estimate — not an Azure guarantee.' }
  }
  if (command === 'DEL' || command === 'EXISTS') {
    if (!args.length) arity(command, args, 1)
    const names = args.map(keyName)
    let count = 0
    for (const key of names) {
      if (ownEntry(database.keys, key)) {
        count++
        if (command === 'DEL') delete database.keys[key]
      }
    }
    return count
  }
  if (!['GET', 'SET', 'TTL', 'EXPIRE', 'HSET', 'HGETALL'].includes(command)) unsupported(`Redis command '${command}'.`)
  if (command === 'SET') {
    if (args.length < 2) arity(command, args, 2)
    let expiresAtMs = null
    if (args.length > 2) {
      if (String(args[2]).toUpperCase() !== 'EX') unsupported('Redis SET supports only the EX option.')
      if (args.length !== 4) {
        if (args.length > 4) unsupported('Redis SET supports only one EX option.')
        fail('ERR syntax error')
      }
      const seconds = integer(args[3])
      expiresAtMs = nowMs + seconds * 1000
      if (seconds <= 0 || !Number.isSafeInteger(expiresAtMs)) fail("ERR invalid expire time in 'set' command")
    }
    const key = keyName(args[0])
    write(database, key, { type: 'string', value: scalar(args[1]), expiresAtMs, lastAccessMs: nowMs }, nowMs)
    return 'OK'
  }
  arity(command, args, ['EXPIRE', 'HSET'].includes(command) ? 2 : 1)
  const key = keyName(args[0])
  const entry = ownEntry(database.keys, key)
  if (command === 'TTL') return !entry ? -2 : entry.expiresAtMs === null ? -1 : Math.floor((entry.expiresAtMs - nowMs) / 1000)
  if (command === 'EXPIRE') {
    const seconds = integer(args[1])
    const expiresAtMs = nowMs + seconds * 1000
    if (seconds > 0 && !Number.isSafeInteger(expiresAtMs)) fail('ERR invalid expire time in expire')
    if (!entry) return 0
    if (seconds <= 0) delete database.keys[key]
    else entry.expiresAtMs = expiresAtMs
    return 1
  }
  const requiredType = command === 'GET' ? 'string' : 'hash'
  if (entry && entry.type !== requiredType) fail('WRONGTYPE Operation against a key holding the wrong kind of value')
  if (command === 'HSET') {
    const mapping = args[1]
    if (!mapping || Object.getPrototypeOf(mapping) !== Object.prototype) unsupported('Redis HSET requires a field mapping.')
    if (!Object.keys(mapping).length) fail("ERR wrong number of arguments for 'hset' command")
    const value = entry ? detach(entry.value) : {}
    let added = 0
    for (const [field, fieldValue] of Object.entries(mapping)) {
      if (!Object.hasOwn(value, field)) added++
      assign(value, field, scalar(fieldValue))
    }
    write(database, key, { type: 'hash', value, expiresAtMs: entry?.expiresAtMs ?? null, lastAccessMs: nowMs }, nowMs)
    return added
  }
  database.stats[entry ? 'hits' : 'misses']++
  if (!entry) return command === 'GET' ? null : {}
  entry.lastAccessMs = nowMs
  return detach(entry.value)
}

export function executeRedis(sandbox, target, command, args, { nowMs = 0 } = {}) {
  const next = cloneSandbox(sandbox)
  let database
  try {
    if (!Number.isFinite(nowMs) || nowMs < 0) unsupported('Redis simulation time must be finite and nonnegative.')
    if (target?.kind !== 'redis') unsupported('Redis commands require a Redis target.')
    const cluster = getRedisCluster(next, { resourceGroup: target.resourceGroup, name: target.cluster })
    if (!cluster || target.database !== cluster.database.name) {
      throw Object.assign(new Error('Redis training database was not found.'), { code: 'ConnectionError' })
    }
    database = cluster.database
    purge(database, nowMs)
    if (typeof command !== 'string' || !Array.isArray(args)) unsupported('Redis command requires a command name and argument array.')
    const value = run(database, command.toUpperCase(), args, nowMs)
    return { sandbox: next, value, measurements: { usedBytes: redisMemory(database, nowMs).usedBytes, ...database.stats } }
  } catch (error) {
    if (!['ResponseError', 'DATA_UNSUPPORTED', 'ConnectionError'].includes(error.code)) throw error
    return { sandbox: next, value: null, measurements: { usedBytes: database ? redisMemory(database, nowMs).usedBytes : 0,
      ...(database?.stats ?? { hits: 0, misses: 0, expiredKeys: 0, rejectedWrites: 0 }) }, error: { code: error.code, message: error.message } }
  }
}
