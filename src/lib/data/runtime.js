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

const MAX_DEPTH = 8
const round2 = (n) => Math.round(n * 100) / 100
const stripInternal = (item) => Object.fromEntries(Object.entries(item ?? {}).filter(([key]) => !key.startsWith('_')))
const pythonStr = (value) => (value === null || value === undefined ? 'None' : value === true ? 'True' : value === false ? 'False' : String(value))

const STATUS_BY_CODE = { BadRequest: 400, SDK_ARGUMENT: 400, NotFound: 404, CosmosResourceNotFoundError: 404, Conflict: 409, CosmosResourceExistsError: 409, TooManyRequests: 429 }
const statusFor = (code) => STATUS_BY_CODE[code] ?? 500

class StopExecution extends Error {
  constructor(errorPayload) { super(errorPayload.message); this.errorPayload = errorPayload }
}
function fail(code, message) { throw new StopExecution({ code, message }) }

export function runDataFunction({ appSpec, sandbox, account, database, functionName, args = [], nowMs, scenarioState, changeFeed }) {
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
    appSpec, account, database, nowMs, scenarioState, changeFeed,
    consistency: clientLevel ?? accountDefault,
    calls, lastContinuations: {}, sandboxBox: { value: sandbox },
  }
  const totalCharge = () => round2(calls.reduce((sum, call) => sum + call.charge, 0))
  try {
    const value = callFunction(functionName, args, ctx, 0)
    return { sandbox: ctx.sandboxBox.value, status: 200, value, calls, totalCharge: totalCharge() }
  } catch (error) {
    if (!(error instanceof StopExecution)) throw error
    return { sandbox: ctx.sandboxBox.value, status: statusFor(error.errorPayload.code), value: null, error: error.errorPayload, calls, totalCharge: totalCharge() }
  }
}

function callFunction(name, argValues, ctx, depth) {
  if (depth > MAX_DEPTH) fail('DATA_UNSUPPORTED', 'Not supported by the simulator: recursion depth exceeded')
  const fn = ctx.appSpec.data.functions[name]
  if (!fn) fail('DATA_UNSUPPORTED', `Not supported by the simulator: unknown function '${name}'`)
  const locals = {}
  fn.params.forEach((param, i) => { locals[param] = argValues[i] })
  const frame = { ...ctx, currentFunctionName: name, depth }
  const signal = execOps(fn.body, locals, frame)
  return signal ? signal.value : null
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
    case 'raise-not-implemented': return fail('DATA_UNSUPPORTED', `Not supported by the simulator: ${op.functionName} is not completed yet.`)
    case 'for': {
      const iterable = evalExpr(op.iterable, locals, ctx)
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
    case 'is': return isNone(right) ? isNone(left) : left === right
    case 'is not': return isNone(right) ? !isNone(left) : left !== right
    default: return fail('DATA_UNSUPPORTED', `Not supported by the simulator: comparison '${test.op}'`)
  }
}

function evalExpr(expr, locals, ctx) {
  switch (expr.kind) {
    case 'literal': return expr.value
    case 'name': return locals[expr.name]
    case 'dict': return Object.fromEntries(Object.entries(expr.entries).map(([key, value]) => [key, evalExpr(value, locals, ctx)]))
    case 'list': return expr.items.map((item) => evalExpr(item, locals, ctx))
    case 'subscript': { const target = evalExpr(expr.target, locals, ctx); return target == null ? undefined : target[expr.key] }
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
    case 'list': return Array.isArray(value) ? value.slice() : value == null ? [] : Array.from(value)
    case 'len': return Array.isArray(value) || typeof value === 'string' ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0
    case 'str': return pythonStr(value)
    case 'embed': return embed(value, ctx.appSpec.data.embeddingsDeployment ?? 'embeddings-v1')
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
