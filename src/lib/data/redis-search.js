import { getRedisCluster } from '../sandbox/redis.js'
import { executeRedis, redisMemory } from './redis-store.js'

const fail = message => { throw Object.assign(new Error(message), { code: 'ResponseError' }) }
const unsupported = message => { throw Object.assign(new Error(`Not supported by the simulator: ${message}`), { code: 'DATA_UNSUPPORTED' }) }
const upper = value => typeof value === 'string' ? value.toUpperCase() : ''
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined
const assign = (object, name, value) => Object.defineProperty(object, name, { value, writable: true, enumerable: true, configurable: true })
const estimate = 'Simulated estimate — not an Azure guarantee.'
const approximation = 'Teaching approximation: exact cosine ranking over the visible cache sample; no HNSW recall simulation.'
const tag = '[A-Za-z0-9_-]{1,128}'
const queryShape = new RegExp(`^\\(@product:\\{(${tag})\\} @version:\\{(${tag})\\} @language:\\{(${tag})\\}\\)=>\\[KNN ([0-9]+) @embedding \\$([A-Za-z_][A-Za-z0-9_]{0,63}) AS distance\\]$`)

function integer(value) {
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) || !Number.isSafeInteger(Number(value))) fail('ERR value is not an integer or out of range')
  return Number(value)
}

export function float32Blob(vector) {
  if (!Array.isArray(vector) || Array.from(vector).some(value => typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))) {
    fail('Vector components must be finite FLOAT32 numbers.')
  }
  const bytes = new Uint8Array(vector.length * 4)
  const view = new DataView(bytes.buffer)
  vector.forEach((value, index) => view.setFloat32(index * 4, value, true))
  return { redisKind: 'bytes', base64: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')) }
}

function decode(blob, dimensions) {
  if (!blob || Object.getPrototypeOf(blob) !== Object.prototype || blob.redisKind !== 'bytes' || typeof blob.base64 !== 'string'
    || Object.keys(blob).some(key => !['redisKind', 'base64'].includes(key))
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(blob.base64)) fail('Invalid FLOAT32 vector binary blob.')
  const binary = atob(blob.base64)
  if (btoa(binary) !== blob.base64) fail('Invalid FLOAT32 vector binary blob.')
  if (binary.length !== dimensions * 4) fail(`Vector blob size ${binary.length} does not match index dimension ${dimensions} (${dimensions * 4} bytes).`)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  const vector = Array.from({ length: dimensions }, (_, i) => view.getFloat32(i * 4, true))
  if (vector.some(value => !Number.isFinite(value)) || !vector.some(value => value !== 0)) fail('Invalid FLOAT32 vector: cosine requires finite components and a nonzero norm.')
  return vector
}

function create(database, args, nowMs) {
  if (args.length !== 23) unsupported('FT.CREATE requires the supplied HASH/TAG/HNSW FLOAT32 COSINE schema with complete option counts.')
  const [name, , , , , prefix] = args
  if (typeof name !== 'string' || !/^[A-Za-z0-9_:-]{1,256}$/.test(name) || typeof prefix !== 'string' || !/^[A-Za-z0-9_:-]{1,256}$/.test(prefix)) unsupported('FT.CREATE requires one literal index name and prefix.')
  if (new Set([args[7], args[9], args[11], args[13]]).size !== 4) unsupported('FT.CREATE duplicate schema fields.')
  const shape = ['ON', 'HASH', 'PREFIX', 'SCHEMA', 'TAG', 'TAG', 'TAG', 'VECTOR', 'HNSW', 'TYPE', 'FLOAT32', 'DIM', 'DISTANCE_METRIC', 'COSINE']
  const positions = [1, 2, 3, 6, 8, 10, 12, 14, 15, 17, 18, 19, 21, 22]
  if (positions.some((position, i) => upper(args[position]) !== shape[i]) || args[7] !== 'product' || args[9] !== 'version' || args[11] !== 'language' || args[13] !== 'embedding') unsupported('FT.CREATE supports only the supplied HASH/TAG/HNSW FLOAT32 COSINE schema.')
  if (integer(args[4]) !== 1 || integer(args[16]) !== 6) unsupported('FT.CREATE requires one PREFIX and six VECTOR attribute tokens.')
  const dimensions = integer(args[20])
  if (![8, 12].includes(dimensions)) unsupported('FT.CREATE supports DIM 8 or DIM 12.')
  if (own(database.indexes, name)) fail('Index already exists')
  const index = { name, prefix, fields: ['product', 'version', 'language'].map(name => ({ name, type: 'TAG' })), createdAtMs: nowMs }
  index.fields.push({ name: 'embedding', type: 'VECTOR', algorithm: 'HNSW', dataType: 'FLOAT32', dimensions, distanceMetric: 'COSINE' })
  assign(database.indexes, name, index)
  if (redisMemory(database, nowMs).usedBytes > database.memoryLimitBytes) {
    delete database.indexes[name]
    database.stats.rejectedWrites++
    fail("OOM command not allowed when used memory > 'maxmemory'")
  }
  return 'OK'
}

function indexed(database, index) {
  const dimensions = index.fields.find(field => field.type === 'VECTOR').dimensions
  const documents = [], errors = []
  for (const [key, entry] of Object.entries(database.keys)) {
    if (entry.type !== 'hash' || !key.startsWith(index.prefix)) continue
    try { documents.push({ key, hash: entry.value, vector: decode(own(entry.value, 'embedding'), dimensions) }) }
    catch (error) {
      if (error.code !== 'ResponseError') throw error
      errors.push({ key, message: error.message })
    }
  }
  return { documents, errors }
}

function info(index, sample) {
  const attributes = index.fields.map(field => field.type === 'TAG'
    ? ['identifier', field.name, 'attribute', field.name, 'type', 'TAG']
    : ['identifier', field.name, 'attribute', field.name, 'type', 'VECTOR', 'algorithm', 'HNSW', 'data_type', 'FLOAT32', 'dim', field.dimensions, 'distance_metric', 'COSINE'])
  const last = sample.errors.at(-1)
  return ['index_name', index.name, 'index_definition', ['key_type', 'HASH', 'prefixes', [index.prefix]],
    'attributes', attributes, 'num_docs', sample.documents.length, 'hash_indexing_failures', sample.errors.length,
    'Index Errors', ['indexing failures', sample.errors.length, 'last indexing error', last?.message ?? 'N/A', 'last indexing error key', last?.key ?? 'N/A']]
}

function search(index, sample, args) {
  const match = typeof args[1] === 'string' && queryShape.exec(args[1])
  if (!match) unsupported('FT.SEARCH requires the supplied product/version/language TAG filters and KNN query.')
  const k = integer(match[4])
  if (k < 1 || k > 10) unsupported('FT.SEARCH KNN K must be between 1 and 10.')
  if (args.length !== 15) unsupported('FT.SEARCH requires one PARAMS vector, SORTBY distance ASC, RETURN payload distance and DIALECT 2 with complete counts.')
  if (upper(args[2]) !== 'PARAMS' || upper(args[6]) !== 'SORTBY' || upper(args[9]) !== 'RETURN' || upper(args[13]) !== 'DIALECT') unsupported('FT.SEARCH option shape.')
  if (integer(args[3]) !== 2 || integer(args[10]) !== 2) fail('ERR invalid PARAMS or RETURN argument count')
  if (integer(args[14]) !== 2) unsupported('FT.SEARCH requires DIALECT 2.')
  if (args[4] !== match[5]) fail(`No such parameter '${match[5]}'`)
  if (args[7] !== 'distance' || upper(args[8]) !== 'ASC' || args[11] !== 'payload' || args[12] !== 'distance') unsupported('FT.SEARCH supports SORTBY distance ASC and RETURN payload distance only; binary embeddings cannot be returned.')
  const dimensions = index.fields.find(field => field.type === 'VECTOR').dimensions
  const vector = decode(args[5], dimensions)
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  const ranked = sample.documents.filter(doc => own(doc.hash, 'product') === match[1] && own(doc.hash, 'version') === match[2] && own(doc.hash, 'language') === match[3])
    .map(doc => {
      const dot = doc.vector.reduce((sum, value, i) => sum + value * vector[i], 0)
      const magnitude = Math.sqrt(doc.vector.reduce((sum, value) => sum + value * value, 0))
      return { ...doc, distance: 1 - Math.max(-1, Math.min(1, dot / (norm * magnitude))) }
    }).sort((a, b) => a.distance - b.distance || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, k)
  return [ranked.length, ...ranked.flatMap(doc => {
    const payload = own(doc.hash, 'payload')
    return [doc.key, [...(typeof payload === 'string' || typeof payload === 'number' ? ['payload', String(payload)] : []), 'distance', String(doc.distance)]]
  })]
}

export function executeRedisSearch(sandbox, target, command, args, { nowMs = 0 } = {}) {
  // Reuse the store's clone, connection, passive expiry and measurement contract.
  const base = executeRedis(sandbox, target, 'INFO', ['memory'], { nowMs })
  if (base.error) return base
  const database = getRedisCluster(base.sandbox, { resourceGroup: target.resourceGroup, name: target.cluster }).database
  let indexInfo
  const measurements = () => ({ ...database.stats, usedBytes: redisMemory(database, nowMs).usedBytes,
    estimate, approximation, ...(indexInfo ? { indexInfo } : {}) })
  try {
    if (typeof command !== 'string' || !Array.isArray(args)) unsupported('Redis search requires a command name and argument array.')
    command = command.toUpperCase()
    if (!database.modules.includes('RediSearch')) fail(`ERR unknown command '${command}'; RediSearch module is not enabled`)
    let value
    if (command === 'FT.CREATE') value = create(database, args, nowMs)
    else {
      if (!['FT.INFO', 'FT.SEARCH', 'FT.DROPINDEX'].includes(command)) unsupported(`Redis command '${command}'.`)
      if (!args.length || ['FT.INFO', 'FT.DROPINDEX'].includes(command) && args.length !== 1) {
        if (command === 'FT.DROPINDEX' && args.length > 1) unsupported('FT.DROPINDEX with DD; hashes must be retained.')
        fail(`ERR wrong number of arguments for '${command.toLowerCase()}' command`)
      }
      const index = typeof args[0] === 'string' && own(database.indexes, args[0])
      if (!index) fail('Unknown Index name')
      if (command === 'FT.DROPINDEX') { delete database.indexes[index.name]; value = 'OK' }
      else {
        const sample = indexed(database, index)
        indexInfo = { index_name: index.name, num_docs: sample.documents.length, hash_indexing_failures: sample.errors.length, indexing_errors: sample.errors }
        value = command === 'FT.INFO' ? info(index, sample) : search(index, sample, args)
      }
    }
    return { sandbox: base.sandbox, value, measurements: measurements() }
  } catch (error) {
    if (!['ResponseError', 'DATA_UNSUPPORTED'].includes(error.code)) throw error
    return { sandbox: base.sandbox, value: null, measurements: measurements(), error: { code: error.code, message: error.message } }
  }
}
