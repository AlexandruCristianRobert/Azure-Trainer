// Data-app runtime (ADR-0002/0003): interprets the bounded Op/Expr lists that
// parseDataApp (python-sdk.js) lowers from a learner's edit-zone functions,
// executing recognized Cosmos SDK calls against a Sandbox. No Python ever
// runs; every SDK call is served by cosmos-store.js / cosmos-query.js /
// cosmos-cost.js, and anything the interpreter cannot express fails closed
// with a DATA_UNSUPPORTED diagnostic rather than a fabricated Azure/Python
// error. There is no try/except in the supported grammar, so any SDK error
// simply stops execution and becomes the function's result.
//
// `changeFeed` is an injectable hook (Task 7 supplies the real one):
//   changeFeed.read(container, { startTime, continuation }) -> { items, continuation }
//   changeFeed.recordChange(sandbox, containerRef, item) -> sandbox
// Without it, query_items_change_feed fails closed and upserts skip recording.

import { runCosmosQuery, parseCosmosQuery } from './cosmos-query.js'
import { CONSISTENCY_ORDER, pointReadCharge, writeCharge, queryCharge } from './cosmos-cost.js'
import { findContainer, upsertItem, readItem } from './cosmos-store.js'
import { embed } from '../../data/fixtures/data/knowledge.js'
import { CORPUS, corpusQuestions } from '../../data/fixtures/data/corpus.js'
import { SUPPORT_V3_CORPUS, SUPPORT_V3_ALL_QUESTIONS } from '../../data/fixtures/data/corpus-v3.js'
import { executePg } from './pg-engine.js'
import { evalRedisCall, evalRedisHelper, newRedisEvidence, redisText, redisSnapshot } from './redis-runtime.js'

const MAX_DEPTH = 8
const round2 = (n) => Math.round(n * 100) / 100
const stripInternal = (item) => Object.fromEntries(Object.entries(item ?? {}).filter(([key]) => !key.startsWith('_')))
const pythonStr = (value) => (value === null || value === undefined ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value))
const pythonPgRepr = value => typeof value === 'string' ? `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'` : pythonPgStr(value)
const pythonPgStr = value => Array.isArray(value) ? `[${value.map(pythonPgRepr).join(', ')}]` : value !== null && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${pythonPgRepr(key)}: ${pythonPgRepr(item)}`).join(', ')}}` : pythonStr(value)

const STATUS_BY_CODE = { BadRequest: 400, SDK_ARGUMENT: 400, NotFound: 404, CosmosResourceNotFoundError: 404, Conflict: 409, CosmosResourceExistsError: 409, TooManyRequests: 429 }
const statusFor = (code) => STATUS_BY_CODE[code] ?? 500

class StopExecution extends Error {
  constructor(errorPayload) { super(errorPayload.message); this.errorPayload = errorPayload }
}
function fail(code, message) { throw new StopExecution({ code, message }) }

// PG-only training evidence is separate from SDK calls/charges. Detach at
// input/output boundaries; reject non-JSON, cycles, nonfinite or oversized
// snapshots through the same fail-closed DATA_UNSUPPORTED contract.
function trainingSnapshot(value) {
  let remaining = 8192
  const ancestors = new Set()
  function copy(item, depth) {
    if (--remaining < 0 || depth > 32) throw new Error('snapshot bound')
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item
    if (typeof item !== 'object' || ancestors.has(item)) throw new Error('not finite JSON')
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('not plain JSON')
    ancestors.add(item)
    const result = Array.isArray(item) ? Array.from(item, child => copy(child, depth + 1))
      : Object.fromEntries(Object.entries(item).map(([key, child]) => [key, copy(child, depth + 1)]))
    ancestors.delete(item)
    return result
  }
  try {
    const snapshot = copy(value, 0)
    if (JSON.stringify(snapshot).length > 65536) throw new Error('snapshot size bound')
    return snapshot
  } catch { return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: PostgreSQL training evidence must be bounded finite JSON') }
}
function recordTrainingCall(ctx, functionName, args, result) {
  if (ctx.trainingCalls.length >= 64) { ctx.trainingTraceTruncated.value = true; return }
  ctx.trainingCalls.push({ functionName, args, result: trainingSnapshot(result) })
}

export function runDataFunction({ appSpec, sandbox, account, database, dataTarget, functionName, args = [], nowMs, scenarioState, changeFeed }) {
  const calls = []
  const acct = (sandbox.cosmosAccounts ?? []).find((a) => a.name === account)
  const accountDefault = acct?.defaultConsistencyLevel
  const clientLevel = appSpec.data.client.consistency
  if (clientLevel && accountDefault && CONSISTENCY_ORDER.indexOf(clientLevel) < CONSISTENCY_ORDER.indexOf(accountDefault)) {
    return {
      sandbox, status: 400, value: null,
      error: { code: 'BadRequest', message: `Consistency level '${clientLevel}' is stronger than the account default '${accountDefault}'.` },
      calls, totalCharge: 0,
    }
  }

  const ctx = {
    appSpec, account, database, dataTarget, nowMs, scenarioState, changeFeed,
    consistency: clientLevel ?? accountDefault,
    calls, lastContinuations: {}, sandboxBox: { value: sandbox }, globals: {},
    connections: { opened: 0, closed: 0, active: 0, events: [] }, jsonbValues: new WeakSet(), pgPoolIds: new Map(),
    trainingCalls: [], trainingTraceTruncated: { value: false },
    redisEvidence: newRedisEvidence(),
  }
  const totalCharge = () => round2(calls.reduce((sum, call) => sum + (call.charge ?? 0), 0))
  const runtimeEvidence = () => dataTarget?.kind === 'postgres' ? { connections: ctx.connections,
    trainingCalls: ctx.trainingCalls, trainingTraceTruncated: ctx.trainingTraceTruncated.value } : dataTarget?.kind === 'redis' && appSpec.data.redis ? { redis: ctx.redisEvidence } : {}
  try {
    if (dataTarget?.kind === 'postgres') {
      for (const [name, expr] of Object.entries(appSpec.data.postgres?.globals ?? {})) if (expr.kind === 'literal') ctx.globals[name] = expr.value
      execOps(appSpec.data.postgres?.clientOps ?? [], ctx.globals, { ...ctx, depth: 0 })
    }
    if (dataTarget?.kind === 'redis' && appSpec.data.redis) {
      for (const [name, expr] of Object.entries(appSpec.data.redis.globals)) if (expr.kind === 'literal') ctx.globals[name] = expr.value
      execOps(appSpec.data.redis.clientOps, ctx.globals, { ...ctx, depth: 0 })
    }
    const returned = callFunction(functionName, args, ctx, 0)
    const value = appSpec.data.redis ? redisSnapshot(returned, fail) : returned
    return { sandbox: ctx.sandboxBox.value, status: 200, value, calls, totalCharge: totalCharge(), ...runtimeEvidence() }
  } catch (error) {
    if (!(error instanceof StopExecution)) throw error
    return { sandbox: ctx.sandboxBox.value, status: statusFor(error.errorPayload.code), value: null, error: error.errorPayload, calls, totalCharge: totalCharge(), ...runtimeEvidence() }
  }
}

function callFunction(name, argValues, ctx, depth) {
  if (depth > MAX_DEPTH) fail('DATA_UNSUPPORTED', 'Not supported by the simulator: recursion depth exceeded')
  const fn = ctx.appSpec.data.functions[name]
  if (!fn) fail('DATA_UNSUPPORTED', `Not supported by the simulator: unknown function '${name}'`)
  const locals = {}
  fn.params.forEach((param, i) => { locals[param] = argValues[i] })
  const frame = { ...ctx, currentFunctionName: name, depth }
  const traceContext = ctx.dataTarget?.kind === 'postgres' && name === 'build_context'
  const trainingArgs = traceContext ? trainingSnapshot(argValues) : null
  const signal = execOps(fn.body, locals, frame)
  const result = signal ? signal.value : null
  if (traceContext) recordTrainingCall(ctx, name, trainingArgs, result)
  return result
}

function execOps(ops, locals, ctx) {
  for (const op of ops) {
    const signal = execStatement(op, locals, ctx)
    if (signal) return signal
  }
  return null
}

function execStatement(op, locals, ctx) {
  ctx.currentSource = op.source
  switch (op.op) {
    case 'assign': locals[op.name] = evalExpr(op.value, locals, ctx); return null
    case 'return': return { kind: 'return', value: evalExpr(op.value, locals, ctx) }
    case 'expr': evalExpr(op.value, locals, ctx); return null
    case 'with': {
      const resource = evalExpr(op.value, locals, ctx)
      locals[op.name] = resource
      try { return execOps(op.body, locals, ctx) }
      finally { closePgResource(resource, ctx) }
    }
    case 'raise-not-implemented': return fail('DATA_UNSUPPORTED', `Not supported by the simulator: ${op.functionName} is not completed yet.`)
    case 'for': {
      const iterable = evalExpr(op.iterable, locals, ctx)
      if (['postgres', 'redis'].includes(ctx.dataTarget?.kind) && (!Array.isArray(iterable) || iterable.length > 1024)) return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: this bounded iterable')
      for (const item of Array.isArray(iterable) ? iterable : []) {
        locals[op.name] = item
        const signal = execOps(op.body, locals, ctx)
        if (signal) return signal
      }
      return null
    }
    case 'if': {
      const branch = evalCompare(op.test, locals, ctx) ? op.then : op.else
      return execOps(branch, locals, ctx)
    }
    default:
      return fail('DATA_UNSUPPORTED', `Not supported by the simulator: op '${op.op}'`)
  }
}

function valuesEqual(a, b) {
  return a === b || (a != null && b != null && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b))
}

function evalCompare(test, locals, ctx) {
  const left = evalExpr(test.left, locals, ctx)
  const right = evalExpr(test.right, locals, ctx)
  const isNone = (v) => v === null || v === undefined
  switch (test.op) {
    case '==': return valuesEqual(left, right)
    case '!=': return !valuesEqual(left, right)
    case '<': return left < right
    case '>=': return left >= right
    case '<=': return left <= right
    case '>': return left > right
    case 'is': return isNone(right) ? isNone(left) : left === right
    case 'is not': return isNone(right) ? !isNone(left) : left !== right
    default: return fail('DATA_UNSUPPORTED', `Not supported by the simulator: comparison '${test.op}'`)
  }
}

function evalExpr(expr, locals, ctx) {
  switch (expr.kind) {
    case 'literal': return expr.value
    case 'name': return Object.hasOwn(locals, expr.name) ? locals[expr.name] : ctx.globals[expr.name]
    case 'dict': return Object.fromEntries(Object.entries(expr.entries).map(([key, value]) => [key, evalExpr(value, locals, ctx)]))
    case 'list': return expr.items.map((item) => evalExpr(item, locals, ctx))
    case 'tuple': return expr.items.map((item) => evalExpr(item, locals, ctx))
    case 'fstring': return expr.parts.map(part => pythonPgStr(evalExpr(part, locals, ctx))).join('')
    case 'redis-add': {
      const left = evalExpr(expr.left, locals, ctx); const right = evalExpr(expr.right, locals, ctx)
      if (typeof left === 'string' && typeof right === 'string' && left.length + right.length <= 65536) return left + right
      return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: Redis string concatenation requires bounded strings')
    }
    case 'redis-helper': return evalRedisHelper(expr.name, expr.args.map(arg => evalExpr(arg, locals, ctx)), ctx, fail)
    case 'sequence-method': {
      const target = evalExpr(expr.target, locals, ctx); const value = evalExpr(expr.value, locals, ctx)
      if (expr.method === 'append' && Array.isArray(target) && target.length < 1024) { target.push(value); return null }
      if (expr.method === 'join' && typeof target === 'string' && Array.isArray(value) && value.length <= 1024 && value.every(item => typeof item === 'string')) return value.join(target)
      return fail('DATA_UNSUPPORTED', `Not supported by the simulator: invalid bounded ${expr.method} operation`)
    }
    case 'subscript': {
      const target = evalExpr(expr.target, locals, ctx)
      if (typeof expr.key === 'number' && (!Array.isArray(target) || expr.key >= target.length)) return fail('IndexError', 'tuple or list index out of range')
      return target == null ? undefined : target[expr.key]
    }
    case 'get': {
      const target = evalExpr(expr.target, locals, ctx)
      if (target != null && Object.hasOwn(target, expr.key)) return target[expr.key]
      return expr.default ? evalExpr(expr.default, locals, ctx) : null
    }
    case 'attribute': { const target = evalExpr(expr.target, locals, ctx); return target == null ? undefined : target[expr.attr] }
    case 'sdk-attribute': return evalSdkAttribute(expr, ctx)
    case 'builtin': return evalBuiltin(expr, locals, ctx)
    case 'call-sdk': return evalCallSdk(expr, locals, ctx)
    case 'call-local': {
      const argValues = expr.args.map((argExpr) => evalExpr(argExpr, locals, ctx))
      return callFunction(expr.name, argValues, ctx, ctx.depth + 1)
    }
    default: return fail('DATA_UNSUPPORTED', `Not supported by the simulator: expression '${expr.kind}'`)
  }
}

function evalBuiltin(expr, locals, ctx) {
  const value = evalExpr(expr.args[0], locals, ctx)
  switch (expr.name) {
    case 'float': {
      const text = value?.redisKind === 'bytes' ? redisText(value, fail) : value
      if (typeof text !== 'number' && (typeof text !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim()))) return fail('ValueError', 'could not convert string to float')
      const number = Number(text)
      if (!Number.isFinite(number)) return fail('ValueError', 'Redis float must be finite')
      return number
    }
    case 'list': return Array.isArray(value) ? value.slice() : value == null ? [] : Array.from(value)
    case 'len': return Array.isArray(value) || typeof value === 'string' ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0
    case 'str': return ctx.dataTarget?.kind === 'postgres' ? pythonPgStr(value) : pythonStr(value)
    case 'embed': {
      const deployment = ctx.appSpec.data.embeddingsDeployment ?? 'embeddings-v1'
      if (ctx.dataTarget?.kind !== 'postgres') return embed(value, deployment)
      const questions = ctx.appSpec.data.postgres?.fixture === 'support-v3' ? SUPPORT_V3_ALL_QUESTIONS : corpusQuestions()
      const vector = questions.find(question => question.text === value)?.vector ?? Array(8).fill(0)
      return deployment === 'embeddings-v2' ? [...vector, 0, 0, 0, 0] : [...vector]
    }
    case 'training_answer': {
      if (ctx.dataTarget?.kind !== 'postgres') return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: PostgreSQL training helper requires a PostgreSQL target')
      const context = evalExpr(expr.args[1], locals, ctx)
      const trainingArgs = trainingSnapshot([value, context])
      const top = context?.sources?.[0]
      const v3 = ctx.appSpec.data.postgres?.fixture === 'support-v3'
      const passage = (v3 ? SUPPORT_V3_CORPUS : CORPUS).chunks.find(chunk => chunk.id === top)
      const result = top == null || typeof context?.passages !== 'string' || !context.passages
        || !passage || !context.passages.includes(passage.content)
        ? 'I could not find a relevant passage in the supplied sources.'
        : (v3 ? SUPPORT_V3_ALL_QUESTIONS : corpusQuestions()).find(question => question.expectedChunkIds.includes(top))?.answer ?? passage.content
      recordTrainingCall(ctx, 'training_answer', trainingArgs, result)
      return result
    }
    case 'next': return Array.isArray(value) && value.length ? value[0] : null
    default: return fail('DATA_UNSUPPORTED', `Not supported by the simulator: builtin '${expr.name}'`)
  }
}

function evalSdkAttribute(expr, ctx) {
  if (expr.call === 'cosmos.container.last_continuation') return ctx.lastContinuations[expr.receiver] ?? null
  return fail('DATA_UNSUPPORTED', `Not supported by the simulator: attribute '${expr.call}'`)
}

function evalCallSdk(expr, locals, ctx) {
  const { receiver, call } = expr
  const argValues = Object.fromEntries(Object.entries(expr.args ?? {}).map(([key, value]) => [key, evalExpr(value, locals, ctx)]))
  if (call.startsWith('postgres.')) return evalPgCall(expr, argValues, locals, ctx)
  if (call.startsWith('redis.')) return evalRedisCall(call, argValues, expr.target ? evalExpr(expr.target, locals, ctx) : null, ctx, fail)
  const ref = { account: ctx.account, database: ctx.database, container: receiver }
  const container = findContainer(ctx.sandboxBox.value, ref)
  if (!container) return fail('NotFound', `Resource Not Found (container '${receiver}')`)
  switch (call) {
    case 'cosmos.container.read_item': return execReadItem(container, ref, argValues, ctx, receiver)
    case 'cosmos.container.query_items': return execQueryItems(container, argValues, ctx, receiver)
    case 'cosmos.container.upsert_item':
    case 'cosmos.container.create_item': return execWrite(ref, argValues, ctx, receiver, call)
    case 'cosmos.container.query_items_change_feed': return execChangeFeed(container, argValues, ctx, receiver)
    default: return fail('DATA_UNSUPPORTED', `Not supported by the simulator: SDK call '${call}'`)
  }
}

function pgRef(conninfo, ctx) {
  if (typeof conninfo !== 'string') return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: conninfo must be a libpq field string')
  const fields = {}; const token = /\s*([a-z_]+)\s*=\s*(?:'((?:\\.|[^'])*)'|([^\s]+))/gy
  let position = 0
  while (position < conninfo.length && conninfo.slice(position).trim()) {
    token.lastIndex = position
    const match = token.exec(conninfo)
    if (!match) return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: this libpq connection string')
    fields[match[1]] = (match[2] ?? match[3]).replace(/\\(.)/g, '$1'); position = token.lastIndex
  }
  const target = ctx.dataTarget
  return { server: fields.host ?? target.server, resourceGroup: target.resourceGroup, database: fields.dbname ?? target.database, port: Number(fields.port ?? target.port ?? 5432) }
}

function openPgConnection(pool, values, ctx) {
  const ref = pgRef(values.conninfo, ctx)
  const checked = executePg(ctx.sandboxBox.value, { ...ref, sql: '' })
  const error = checked.results.find(result => result.kind === 'connection' && result.error)?.error
  if (error) throw new StopExecution(error)
  const mode = ref.port === 6432 ? 'bouncer' : pool?.lifetime === 'module' ? 'pooled' : 'new'
  const conn = { pgKind: 'connection', ref, mode, rowFactory: values.row_factory ?? values.kwargs?.row_factory, session: pool?.session ?? { settings: {} }, pool, closed: false, pendingLatency: mode === 'new' ? 25 : 0 }
  ctx.connections.opened++; ctx.connections.active++
  ctx.connections.events.push({ event: 'open', connection: mode, port: ref.port })
  return conn
}

function closePgResource(resource, ctx) {
  if (!resource || resource.closed) return
  resource.closed = true
  if (resource.pgKind !== 'connection') return
  if (resource.pool) resource.pool.session = resource.session
  ctx.connections.closed++; ctx.connections.active--
  ctx.connections.events.push({ event: 'close', connection: resource.mode, port: resource.ref.port })
}

function evalPgCall(expr, values, locals, ctx) {
  if (ctx.dataTarget?.kind !== 'postgres') return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: PostgreSQL SDK requires a PostgreSQL data target')
  const call = expr.call
  if (call === 'postgres.Jsonb') { const adapted = { pgKind: 'jsonb', value: values.obj }; ctx.jsonbValues.add(adapted); return adapted }
  if (call === 'postgres.register_vector') {
    if (values.conn?.pgKind !== 'connection' || values.conn.closed) return fail('ProgrammingError', 'connection is closed')
    values.conn.vectorRegistered = true; return null
  }
  if (call === 'postgres.module.connect') return openPgConnection(null, values, ctx)
  if (call === 'postgres.pool.ConnectionPool') {
    return { pgKind: 'pool', ...values, lifetime: expr.lifetime, session: { settings: {} } }
  }
  const target = expr.target ? evalExpr(expr.target, locals, ctx) : locals[expr.receiver] ?? ctx.globals[expr.receiver]
  if (call === 'postgres.pool.connection') {
    if (target?.pgKind !== 'pool') return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: invalid PostgreSQL pool receiver')
    return openPgConnection(target, target, ctx)
  }
  const conn = target?.pgKind === 'cursor' ? target.connection : target
  if (conn?.pgKind !== 'connection' || conn.closed || target.closed) return fail('ProgrammingError', 'connection or cursor is closed')
  if (call.endsWith('.close')) { closePgResource(target, ctx); return null }
  if (call === 'postgres.connection.cursor') return { pgKind: 'cursor', connection: conn, rowFactory: values.row_factory ?? conn.rowFactory, rows: [], position: 0, closed: false }
  if (call.endsWith('.fetchall')) { const rows = target.rows.slice(target.position); target.position = target.rows.length; return rows }
  if (call.endsWith('.fetchone')) return target.rows[target.position++] ?? null
  if (call.endsWith('.execute')) {
    const params = values.params ?? []
    const named = params !== null && typeof params === 'object' && !Array.isArray(params) && !ctx.jsonbValues.has(params)
    if (!Array.isArray(params) && !named) return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: PostgreSQL params must be a tuple, list or dictionary')
    const adapt = value => {
      if (value !== null && typeof value === 'object' && ctx.jsonbValues.has(value)) return value.value
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return fail('ProgrammingError', "cannot adapt type 'dict' using placeholder '%s'; wrap JSON data in Jsonb")
      return value
    }
    const adapted = named ? Object.fromEntries(Object.entries(params).map(([key, value]) => [key, adapt(value)])) : params.map(adapt)
    const executed = executePg(ctx.sandboxBox.value, { ...conn.ref, sql: values.query, params: adapted, session: conn.session, nowMs: ctx.nowMs })
    ctx.sandboxBox.value = executed.sandbox; conn.session = executed.session
    const cursor = target.pgKind === 'cursor' ? target : { pgKind: 'cursor', connection: conn, rowFactory: conn.rowFactory, closed: false }
    cursor.rows = []; cursor.position = 0
    for (const result of executed.results) {
      if (result.error?.code === 'SyntaxError') result.error = { ...result.error, message: `syntax error: ${result.error.message}` }
      const rowValues = result.kind === 'explain' ? (result.plan?.text ?? []).map(line => [line]) : result.rowValues ?? []
      const rows = cursor.rowFactory === 'dict_row'
        ? rowValues.map(row => Object.fromEntries((result.columns ?? []).map((column, index) => [column.name, row[index]])))
        : rowValues
      // Request-local identities distinguish actually used pools, including
      // pools with identical configuration; unused globals contribute nothing.
      if (conn.pool && !ctx.pgPoolIds.has(conn.pool)) ctx.pgPoolIds.set(conn.pool, ctx.pgPoolIds.size + 1)
      const record = { call, sql: values.query, plan: result.plan ?? null, latencyMs: (result.latencyMs ?? 0) + conn.pendingLatency, recall: result.plan?.recall ?? null, rows, connection: conn.mode,
        poolLifetime: conn.pool?.lifetime ?? null, poolMaxSize: conn.pool?.max_size ?? null,
        poolIdentity: conn.pool ? ctx.pgPoolIds.get(conn.pool) : null,
        charge: 0, source: ctx.currentSource, ...(result.error ? { error: result.error } : {}) }
      conn.pendingLatency = 0; ctx.calls.push(record)
      if (result.error) throw new StopExecution(result.error)
      cursor.rows = rows
    }
    return cursor
  }
  return fail('DATA_UNSUPPORTED', `Not supported by the simulator: SDK call '${call}'`)
}

function execReadItem(container, ref, argValues, ctx, receiver) {
  const id = argValues.item
  let item = readItem(ctx.sandboxBox.value, ref, id, argValues.partition_key)
  if (!item) {
    if (ctx.currentFunctionName === 'read_lease') return null
    return fail('CosmosResourceNotFoundError', 'Entity with the specified id does not exist in the system.')
  }
  const writtenThisRequest = (ctx.consistency === 'Eventual' || ctx.consistency === 'ConsistentPrefix') && ctx.scenarioState?.writesThisRequest?.has(`${receiver}:${id}`)
  // Teaching approximation: under a consistency level weaker than Session, a
  // just-CREATED item (no _previous) has not replicated yet, so this same
  // request's very next read of it still sees "not found" - an Eventual or
  // ConsistentPrefix read is never guaranteed read-your-writes. An UPDATED
  // item still has a _previous version to fall back to and is marked stale,
  // as before.
  if (writtenThisRequest && !item._previous) {
    return fail('CosmosResourceNotFoundError', 'Entity with the specified id does not exist in the system.')
  }
  let stale = false
  if (writtenThisRequest && item._previous) {
    item = item._previous
    stale = true
  }
  const charge = pointReadCharge(item, ctx.consistency)
  ctx.calls.push({ call: 'cosmos.container.read_item', receiver, container: receiver, charge, consistency: ctx.consistency, stale, source: ctx.currentSource })
  return stripInternal(item)
}

function execQueryItems(container, argValues, ctx, receiver) {
  const { query, parameters = [], partition_key: partitionKey, enable_cross_partition_query: crossPartition } = argValues
  if (partitionKey === undefined && crossPartition !== true) {
    const parsed = parseCosmosQuery(query)
    if (parsed.error) return fail(parsed.error.code, parsed.error.message)
    const hasPartitionFilter = parsed.ast.where.some((cond) => cond.type === 'compare' && cond.op === '=' && `/${cond.path.join('/')}` === container.partitionKeyPath)
    if (!hasPartitionFilter) return fail('BadRequest', 'Cross partition query is required but disabled.')
  }
  const result = runCosmosQuery(container, query, parameters, { partitionKey })
  if (result.error) return fail(result.error.code, result.error.message)
  const charge = queryCharge(result.stats, ctx.consistency, container.logicalScale)
  ctx.calls.push({ call: 'cosmos.container.query_items', receiver, container: receiver, charge, consistency: ctx.consistency, stale: false, stats: result.stats, source: ctx.currentSource })
  return result.rows
}

function execWrite(ref, argValues, ctx, receiver, call) {
  const { sandbox: nextSandbox, item, created } = upsertItem(ctx.sandboxBox.value, ref, argValues.body, { nowMs: ctx.nowMs })
  if (call === 'cosmos.container.create_item' && !created) {
    return fail('CosmosResourceExistsError', 'Entity with the specified id already exists in the system.')
  }
  ctx.sandboxBox.value = nextSandbox
  const updatedContainer = findContainer(nextSandbox, ref)
  const charge = writeCharge(item, updatedContainer.indexingPolicy)
  if (ctx.scenarioState?.writesThisRequest) ctx.scenarioState.writesThisRequest.add(`${receiver}:${item.id}`)
  if (ctx.changeFeed?.recordChange) ctx.sandboxBox.value = ctx.changeFeed.recordChange(ctx.sandboxBox.value, ref, item)
  ctx.calls.push({ call, receiver, container: receiver, charge, consistency: ctx.consistency, stale: false, source: ctx.currentSource })
  return stripInternal(item)
}

function execChangeFeed(container, argValues, ctx, receiver) {
  if (!ctx.changeFeed?.read) return fail('DATA_UNSUPPORTED', 'Not supported by the simulator: change feed not configured')
  const { items, continuation } = ctx.changeFeed.read(container, { startTime: argValues.start_time, continuation: argValues.continuation })
  ctx.lastContinuations[receiver] = continuation
  const charge = queryCharge({ scanned: items.length, partitionsTouched: 1, vector: false }, ctx.consistency, container.logicalScale)
  ctx.calls.push({ call: 'cosmos.container.query_items_change_feed', receiver, container: receiver, charge, consistency: ctx.consistency, stale: false, source: ctx.currentSource })
  return items
}
