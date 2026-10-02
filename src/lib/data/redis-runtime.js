import { getRedisCluster } from '../sandbox/redis.js'
import { executeRedis } from './redis-store.js'
import { executeRedisSearch, float32Blob } from './redis-search.js'
import { redisEmbed, redisSourceAnswer } from '../../data/fixtures/data/redis.js'
import { capstoneEmbed } from '../../data/fixtures/data/capstone.js'
import { dataTargetFor } from './targets.js'

const MAX_TRACE = 256
const estimate = 'Simulated estimate — not an Azure guarantee.'
const normalize = text => text.trim().toLowerCase().replace(/\s+/g, ' ')
const binary = text => ({ redisKind: 'bytes', base64: btoa(Array.from(new TextEncoder().encode(text), byte => String.fromCharCode(byte)).join('')) })
const unsupported = (fail, message) => fail('DATA_UNSUPPORTED', `Not supported by the simulator: ${message}`)

// Browser-safe synchronous SHA-256 over UTF-8, independent of image-ID hashes.
// Standard SHA-256 round constants and 32-bit arithmetic (FIPS 180-4).
const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]
const rotate = (x, n) => (x >>> n) | (x << (32 - n))
function sha256(text) {
  const input = new TextEncoder().encode(text)
  const bytes = new Uint8Array(Math.ceil((input.length + 9) / 64) * 64)
  bytes.set(input); bytes[input.length] = 0x80
  const view = new DataView(bytes.buffer)
  view.setUint32(bytes.length - 8, Math.floor(input.length * 8 / 0x100000000), false)
  view.setUint32(bytes.length - 4, input.length * 8, false)
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const words = new Uint32Array(64)
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false)
    for (let i = 16; i < 64; i++) {
      const a = words[i - 15]; const b = words[i - 2]
      words[i] = words[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + words[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))
    }
    let [a, b, c, d, e, f, g, h] = hash
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + words[i]) | 0
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    ;[a, b, c, d, e, f, g, h].forEach((value, i) => { hash[i] = (hash[i] + value) >>> 0 })
  }
  return hash.map(value => value.toString(16).padStart(8, '0')).join('')
}

function snapshot(value, fail) {
  let remaining = 8192
  const ancestors = new Set()
  const copy = (item, depth) => {
    if (--remaining < 0 || depth > 32) throw new Error('snapshot bound')
    if (item === null || typeof item === 'boolean' || typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item))) return item
    if (!item || typeof item !== 'object' || ancestors.has(item) || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) throw new Error('finite JSON required')
    ancestors.add(item)
    const result = Array.isArray(item) ? Array.from(item, child => copy(child, depth + 1)) : Object.fromEntries(Object.entries(item).map(([key, child]) => [key, copy(child, depth + 1)]))
    ancestors.delete(item)
    return result
  }
  try {
    const result = copy(value, 0)
    if (JSON.stringify(result).length > 65536) throw new Error('snapshot size bound')
    return result
  } catch { return unsupported(fail, 'Redis helper values must be bounded finite JSON') }
}
export { snapshot as redisSnapshot }

export function redisText(value, fail) {
  if (typeof value === 'string') return value
  if (value?.redisKind !== 'bytes' || typeof value.base64 !== 'string') return unsupported(fail, 'Redis text requires a string or UTF-8 bytes')
  try {
    const raw = atob(value.base64)
    if (btoa(raw) !== value.base64) throw new Error('noncanonical bytes')
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw, char => char.charCodeAt(0)))
  } catch { return fail('UnicodeDecodeError', 'Redis value is not valid UTF-8 bytes.') }
}

export const newRedisEvidence = () => ({ calls: [], originCalls: 0, sourceCalls: [], returnProvenance: null, traceTruncated: false, measurements: { estimate } })
function record(ctx, collection, entry, fail) {
  if (ctx.redisEvidence[collection].length >= MAX_TRACE) { ctx.redisEvidence.traceTruncated = true; return }
  ctx.redisEvidence[collection].push(snapshot(entry, fail))
}
function responses(value, decode, fail) {
  if (value === null) return null
  if (Array.isArray(value)) return value.map(item => responses(item, decode, fail))
  if (value?.redisKind === 'bytes') return decode ? redisText(value, fail) : snapshot(value, fail)
  if (typeof value === 'string') return decode ? value : binary(value)
  return value
}

export function evalRedisCall(call, args, target, ctx, fail) {
  const dataTarget = dataTargetFor(ctx.dataTarget, 'redis')
  if (dataTarget?.kind !== 'redis' || !ctx.appSpec.data.redis) return unsupported(fail, 'Redis calls require a trusted Redis app and target')
  ctx.redisFlow.current = null
  if (call === 'redis.Redis') {
    const cluster = getRedisCluster(ctx.sandboxBox.value, { resourceGroup: dataTarget.resourceGroup, name: dataTarget.cluster })
    if (!cluster || args.host !== cluster.hostName || (args.port ?? 10000) !== cluster.database.port || args.ssl !== true
      || args.password !== 'Training-Only-Redis-Key' || cluster.database.clientProtocol !== 'Encrypted' || cluster.database.accessKeysAuthentication !== 'Enabled') {
      return fail('ConnectionError', 'Redis connection must use the supplied host, port, TLS and training-only key.')
    }
    if ((args.protocol ?? 2) !== 2 || (args.decode_responses !== undefined && typeof args.decode_responses !== 'boolean')) return unsupported(fail, 'Redis protocol/decode_responses configuration')
    return { runtimeKind: 'redis-client', decode: args.decode_responses ?? false }
  }
  if (target?.runtimeKind !== 'redis-client') return unsupported(fail, 'Redis method requires a constructed client')
  const name = args.name?.redisKind === 'bytes' ? redisText(args.name, fail) : args.name
  const method = call.slice('redis.client.'.length)
  let command; let values
  switch (method) {
    case 'get': command = 'GET'; values = [name]; break
    case 'set': command = 'SET'; values = [name, args.value, ...(args.ex == null ? [] : ['EX', args.ex])]; break
    case 'delete': command = 'DEL'; values = args.names.map(value => value?.redisKind === 'bytes' ? redisText(value, fail) : value); break
    case 'exists': command = 'EXISTS'; values = [name]; break
    case 'ttl': command = 'TTL'; values = [name]; break
    case 'expire': command = 'EXPIRE'; values = [name, args.time]; break
    case 'hset': command = 'HSET'; values = [name, args.mapping]; break
    case 'hgetall': command = 'HGETALL'; values = [name]; break
    case 'scan_iter': command = 'SCAN'; values = ['0', ...(args.match == null ? [] : ['MATCH', args.match]), ...(args.count == null ? [] : ['COUNT', args.count])]; break
    case 'execute_command': [command, ...values] = args.args; break
    default: return unsupported(fail, `Redis method '${method}'`)
  }
  command = redisText(command, fail).toUpperCase()
  if (method === 'execute_command' && command === 'HSET') {
    if (values.length < 3 || values.length % 2 !== 1) return fail('ResponseError', "ERR wrong number of arguments for 'hset' command")
    values = [values[0], Object.fromEntries(Array.from({ length: (values.length - 1) / 2 }, (_, i) => [redisText(values[1 + i * 2], fail), values[2 + i * 2]]))]
  }
  const before = { ...getRedisCluster(ctx.sandboxBox.value, { resourceGroup: dataTarget.resourceGroup, name: dataTarget.cluster })?.database.stats }
  const result = (command.startsWith('FT.') ? executeRedisSearch : executeRedis)(ctx.sandboxBox.value, dataTarget, command, values, { nowMs: ctx.nowMs ?? 0 })
  ctx.sandboxBox.value = result.sandbox
  ctx.redisEvidence.measurements = { ...snapshot(result.measurements, fail), estimate }
  const deltas = Object.fromEntries(['hits', 'misses', 'expiredKeys', 'rejectedWrites'].map(key => [key, (result.measurements[key] ?? 0) - (before[key] ?? 0)]))
  const callIndex = ctx.redisEvidence.calls.length
  record(ctx, 'calls', { command, args: values, value: result.value, deltas, ...(command === 'GET' || command === 'HGETALL' ? { hit: deltas.hits > 0 } : {}), ...(result.error ? { error: result.error } : {}) }, fail)
  if (result.error) return fail(result.error.code, result.error.message)
  if (command === 'GET' && result.value !== null) ctx.redisFlow.current = { origin: { kind: 'get', callIndex, key: String(values[0]) } }
  if (command === 'FT.SEARCH' && Array.isArray(result.value)) {
    const children = {}
    for (let position = 1; position < result.value.length; position += 2) {
      const fields = result.value[position + 1]
      const fieldFlow = {}
      for (let index = 0; index < fields.length; index += 2) if (fields[index] === 'payload') {
        fieldFlow[index + 1] = { origin: { kind: 'search', callIndex, key: String(result.value[position]) } }
      }
      children[position + 1] = { children: fieldFlow }
    }
    ctx.redisFlow.current = { children }
  }
  if (method === 'scan_iter') return responses(result.value[1], target.decode, fail)
  if (command === 'SET') return result.value === 'OK'
  if (command === 'EXPIRE') return Boolean(result.value)
  if (command === 'HGETALL') {
    // Python's bytes-key dict cannot be represented as an ordinary JS object.
    // Support the native decoded string-key subset explicitly; never silently
    // let rows['payload'] match a native b'payload' key.
    if (!target.decode) return unsupported(fail, 'HGETALL byte-key dictionaries; use decode_responses=True for string-key access')
    return Object.fromEntries(Object.entries(result.value).map(([key, value]) => [key, responses(typeof value === 'number' ? String(value) : value, true, fail)]))
  }
  if (command === 'GET' && typeof result.value === 'number') return responses(String(result.value), target.decode, fail)
  return responses(result.value, target.decode, fail)
}

export function evalRedisHelper(name, args, ctx, fail, argFlow = []) {
  if (!['redis', 'composite'].includes(ctx.dataTarget?.kind) || !ctx.appSpec.data.redis) return unsupported(fail, 'protected Redis helpers require a trusted Redis app and target')
  if (ctx.dataTarget.kind === 'composite' && name === 'source_answer') return unsupported(fail, 'source_answer is forbidden for composite targets')
  ctx.redisFlow.current = null
  switch (name) {
    case 'response_key':
    case 'semantic_key': {
      if (!args.every(value => typeof value === 'string') || args[0].length > 8192) return unsupported(fail, 'Redis key helper arguments')
      return `${name === 'response_key' ? 'ka:answer' : 'ka:sem'}:${args[1]}:${args[2]}:${args[3]}:${sha256(normalize(args[0]))}`
    }
    case 'encode_answer': {
      const result = binary(JSON.stringify(snapshot(args[0], fail)))
      ctx.redisFlow.current = argFlow[0] ?? null
      return result
    }
    case 'decode_answer': {
      const text = redisText(args[0], fail)
      try {
        const result = snapshot(JSON.parse(text), fail)
        ctx.redisFlow.current = argFlow[0] ?? null
        return result
      } catch (error) {
        if (error instanceof SyntaxError) return fail('JSONDecodeError', 'Cached payload is not valid JSON.')
        throw error
      }
    }
    case 'pack_embedding': {
      if (!Array.isArray(args[0]) || args[0].length !== 8) return fail('error', 'pack expected 8 items for packing')
      try { return float32Blob(args[0]) } catch (error) { return fail(error.code, error.message) }
    }
    case 'decode_search': {
      const raw = args[0]
      if (!Array.isArray(raw) || !Number.isInteger(raw[0]) || raw.length !== 1 + raw[0] * 2) return unsupported(fail, 'decode_search requires the actual bounded RESP2 rows')
      const rows = []
      const rowFlow = []
      for (let position = 1; position < raw.length; position += 2) {
        const fields = raw[position + 1]
        if (!Array.isArray(fields) || fields.length % 2) return unsupported(fail, 'decode_search RESP2 field pairs')
        rows.push(Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) => [redisText(fields[i * 2], fail), snapshot(fields[i * 2 + 1], fail)])))
        rowFlow.push({ children: Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) =>
          [redisText(fields[i * 2], fail), argFlow[0]?.children?.[position + 1]?.children?.[i * 2 + 1] ?? null])) })
      }
      ctx.redisFlow.current = { children: rowFlow }
      return rows
    }
    case 'embed': return snapshot((ctx.appSpec.data.composite?.helperProfile === 'capstone' ? capstoneEmbed : redisEmbed)(args[0], args[1] ?? ctx.appSpec.data.embeddingsDeployment ?? 'embeddings-v1'), fail)
    case 'source_answer': {
      if (!args.every(value => typeof value === 'string')) return unsupported(fail, 'source_answer string arguments')
      const [question, product, version, language] = args
      const database = getRedisCluster(ctx.sandboxBox.value, { resourceGroup: ctx.dataTarget.resourceGroup, name: ctx.dataTarget.cluster })?.database
      const revision = ctx.scenarioState?.sourceRevisions?.[product] ?? database?.sourceRevisions?.[product] ?? 1
      if (![1, 2].includes(revision)) return unsupported(fail, 'source_answer revision')
      const result = redisSourceAnswer({ product, version, language }, question, revision)
      ctx.redisEvidence.originCalls++
      const callIndex = ctx.redisEvidence.sourceCalls.length
      record(ctx, 'sourceCalls', { functionName: 'source_answer', args, sourceRevision: revision, result }, fail)
      if (result !== null) ctx.redisFlow.current = { origin: { kind: 'source', callIndex } }
      return snapshot(result, fail)
    }
    default: return unsupported(fail, `Redis helper '${name}'`)
  }
}
