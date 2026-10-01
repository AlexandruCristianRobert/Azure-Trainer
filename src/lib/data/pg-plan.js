/* Deterministic teaching estimates, never a real PostgreSQL/Azure planner.
 * Heap scans: .004ms/logical row; exact vector ordering: .02ms/logical row.
 * B-tree equality leftmost prefix: .8 + .01*matches ms; JSONB GIN containment:
 * 1.5 + .02*matches ms. HNSW needs matching expression/opclass, ascending
 * distance ORDER BY and LIMIT: 2 + .05*ef_search ms; recall min(1,.80+.004*ef).
 * IVFFlat: 1.5+.6*probes*(logicalRows/lists)/1000 ms; recall
 * min(1,.70+.6*probes/lists). Filters use real joined sample fractions, scaled
 * to logical rows; ANN post-filter returns min(limit,round(candidates*fraction)).
 * Iterative HNSW scans fill LIMIT (bounded by matches), at 1.5x latency. Partial
 * indexes require provable predicate implication, never sample coincidence.
 * Build graph memory kB: rows*dims*bytes*1.6/1024 (bytes=4 vector,2 halfvec).
 * Below memory: 600*required/mem seconds, failing above1800; otherwise
 * .0008*rows/vCores. IVFFlat .0003*rows/vCores. Size MB rows*dims*bytes*1.3/1e6.
 * Server parameter validation belongs to sandbox/postgres.js. Helpers here
 * interpret the bound AST and are shared with the engine; no SQL regex parsing.
 */
export { simulatePoolLoad } from './pg-pool.js'

const DISTANCE = { '<=>': 'cosine', '<->': 'l2', '<#>': 'ip' }
const LABEL = 'Simulated estimate — not an Azure guarantee.'
const columnExpression = value => typeof value === 'string' ? { kind: 'column', name: value } : value
const conditionExpression = condition => condition.expression ?? { kind: 'column', name: condition.column, ...(condition.table ? { table: condition.table } : {}) }
const indexExpression = column => column.expression ?? columnExpression(column.name)
const tableFor = (db, name) => (db.tables ?? []).find(table => table.name === name)
const logicalSize = table => Math.max(0, Number(table?.logicalRows ?? table?.rows?.length ?? 0))
const valueEqual = (a, b) => canonical(a) === canonical(b)
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function dataError(message) { return Object.assign(new Error(message), { code: 'DataError' }) }
function decodeJson(value) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { throw dataError('invalid input syntax for type jsonb') }
}
export function decodePgVector(value, dimensions) {
  const vector = typeof value === 'string' ? decodeJson(value) : value
  if (!Array.isArray(vector) || !vector.length || vector.some(component => typeof component !== 'number' || !Number.isFinite(component))) throw dataError('invalid input syntax for type vector')
  if (dimensions !== undefined && vector.length !== dimensions) throw dataError(`expected ${dimensions} dimensions, not ${vector.length}`)
  return vector.slice()
}
export function jsonContains(actual, wanted) {
  if (Array.isArray(wanted)) return Array.isArray(actual) && wanted.every(entry => actual.some(candidate => jsonContains(candidate, entry)))
  if (wanted && typeof wanted === 'object') return actual !== null && typeof actual === 'object' && !Array.isArray(actual) && Object.entries(wanted).every(([key, value]) => Object.hasOwn(actual, key) && jsonContains(actual[key], value))
  if (Array.isArray(actual)) return actual.some(entry => valueEqual(entry, wanted))
  return valueEqual(actual, wanted)
}

// Context keeps each table/alias row distinct. Unqualified fields first resolve
// against the FROM row; qualified JOIN fields never overwrite base fields.
export function makePgRowContext(row, table, alias) {
  return { row, relations: { [table]: row, ...(alias ? { [alias]: row } : {}) } }
}
export function evaluatePgExpression(expression, context) {
  if (!expression || typeof expression !== 'object' || !expression.kind) return expression
  const expr = expression
  if (expr.kind === 'column') {
    if (expr.table) return context.relations[expr.table]?.[expr.name]
    if (Object.hasOwn(context.row, expr.name)) return context.row[expr.name]
    return Object.values(context.relations).find(row => Object.hasOwn(row, expr.name))?.[expr.name]
  }
  if (expr.kind === 'star') return { ...context.row }
  if (expr.kind === 'json-extract') {
    const value = decodeJson(evaluatePgExpression(expr.column, context))?.[expr.key]
    return value === undefined || value === null ? null : typeof value === 'object' ? JSON.stringify(value) : String(value)
  }
  if (expr.kind === 'cast') {
    const value = evaluatePgExpression(expr.expression, context)
    if (value === null || value === undefined) return value
    if (expr.type === 'vector' || expr.type === 'halfvec') return decodePgVector(value, expr.dimensions)
    if (expr.type === 'jsonb') return decodeJson(value)
    if (expr.type === 'text') return typeof value === 'object' ? JSON.stringify(value) : String(value)
    if (['bigint', 'int', 'integer'].includes(expr.type)) {
      const number = Number(value)
      if (!Number.isSafeInteger(number)) throw dataError(`invalid input syntax for type ${expr.type}`)
      return number
    }
    if (expr.type === 'boolean') {
      if ([true, 'true', 't', 1].includes(value)) return true
      if ([false, 'false', 'f', 0].includes(value)) return false
      throw dataError('invalid input syntax for type boolean')
    }
    return value
  }
  if (expr.kind === 'distance') {
    const left = evaluatePgExpression(columnExpression(expr.column), context)
    const right = evaluatePgExpression(expr.value, context)
    if (left == null || right == null) return null
    const a = decodePgVector(left); const b = decodePgVector(right, a.length)
    let dot = 0; let aa = 0; let bb = 0; let square = 0
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; square += (a[i] - b[i]) ** 2 }
    if (expr.operator === '<->') return Math.sqrt(square)
    if (expr.operator === '<#>') return -dot
    if (expr.operator === '<=>') return aa && bb ? 1 - dot / Math.sqrt(aa * bb) : 1
  }
  throw Object.assign(new Error('Not supported by the simulator: unbound or unsupported expression.'), { code: 'DATA_UNSUPPORTED' })
}
function comparePredicate(actual, operator, wanted, values) {
  if (actual == null) return false // SQL UNKNOWN is excluded by WHERE.
  if (operator === 'in') return values.some(value => value != null && valueEqual(actual, value))
  if (wanted == null) return false
  if (operator === '@>') return jsonContains(decodeJson(actual), decodeJson(wanted))
  if (operator === '=') return valueEqual(actual, wanted)
  if (operator === '<>') return !valueEqual(actual, wanted)
  if (operator === '<') return actual < wanted
  if (operator === '<=') return actual <= wanted
  if (operator === '>') return actual > wanted
  if (operator === '>=') return actual >= wanted
  throw Object.assign(new Error('Not supported by the simulator: unsupported predicate.'), { code: 'DATA_UNSUPPORTED' })
}
export function matchesPgWhere(context, conditions = []) {
  return conditions.every(condition => comparePredicate(evaluatePgExpression(conditionExpression(condition), context), condition.operator,
    evaluatePgExpression(condition.value, context), (condition.values ?? []).map(value => evaluatePgExpression(value, context))))
}
export function samplePgContexts(db, stmt) {
  let contexts = (tableFor(db, stmt.table)?.rows ?? []).map(row => makePgRowContext(row, stmt.table, stmt.alias))
  for (const join of stmt.joins ?? []) {
    contexts = contexts.flatMap(context => (tableFor(db, join.table)?.rows ?? []).flatMap(row => {
      const next = { row: context.row, relations: { ...context.relations, [join.table]: row, ...(join.alias ? { [join.alias]: row } : {}) } }
      const left = evaluatePgExpression(join.on.left, next); const right = evaluatePgExpression(join.on.right, next)
      return left != null && right != null && valueEqual(left, right) ? [next] : []
    }))
  }
  return contexts
}

function expressionKey(expression, stmt) {
  const expr = columnExpression(expression)
  if (!expr) return ''
  if (expr.kind === 'column') return `column:${expr.table === stmt.alias || !expr.table ? stmt.table : expr.table}:${expr.name}`
  if (expr.kind === 'cast') return `cast:${expr.type}:${expr.dimensions ?? ''}:${expressionKey(expr.expression, stmt)}`
  if (expr.kind === 'json-extract') return `json:${expressionKey(expr.column, stmt)}:${expr.key}`
  if (expr.kind === 'distance') return `distance:${expressionKey(expr.column, stmt)}:${expr.operator}:${canonical(expr.value)}`
  return canonical(expr)
}
const boundValue = value => evaluatePgExpression(value, { row: {}, relations: {} })
function predicateImplies(query, required, stmt) {
  if (expressionKey(conditionExpression(query), stmt) !== expressionKey(conditionExpression(required), stmt)) return false
  if (query.operator === required.operator && valueEqual(boundValue(query.value), boundValue(required.value)) && valueEqual(query.values?.map(boundValue), required.values?.map(boundValue))) return true
  if (query.operator === '=' || query.operator === 'in') {
    const values = query.operator === '=' ? [boundValue(query.value)] : query.values.map(boundValue)
    return values.length > 0 && values.every(value => comparePredicate(value, required.operator, boundValue(required.value), required.values?.map(boundValue) ?? []))
  }
  if (query.operator === '@>' && required.operator === '@>') return jsonContains(decodeJson(boundValue(query.value)), decodeJson(boundValue(required.value)))
  return false
}
export function pgPartialIndexUsable(index, stmt) {
  return (index.where ?? []).every(required => (stmt.where ?? []).some(query => predicateImplies(query, required, stmt)))
}
function positiveSetting(settings, server, name, fallback) {
  const value = Number(settings?.[name] ?? server?.parameters?.[name] ?? fallback)
  return Number.isFinite(value) && value > 0 ? value : fallback
}
function finishPlan(plan, stmt) {
  const limit = stmt.limit == null ? plan.rowsReturnedBeforeLimit : Math.max(0, Number(stmt.limit))
  const text = [`${plan.node}${plan.index && !plan.node.includes('using') ? ` using ${plan.index}` : ''} on ${stmt.table} (rows=${plan.estimatedRows})`,
    `  Simulated latency: ${plan.latencyMs.toFixed(2)} ms; recall: ${(plan.recall * 100).toFixed(1)}%`,
    `  Rows before LIMIT: ${plan.rowsReturnedBeforeLimit}; output estimate: ${Math.min(limit, plan.rowsReturnedBeforeLimit)}`, LABEL]
  return { ...plan, text }
}
export function planSelect(db, stmt, settings = {}, server = {}) {
  const table = tableFor(db, stmt.table)
  const logicalRows = logicalSize(table)
  const contexts = samplePgContexts(db, stmt)
  const matches = contexts.filter(context => matchesPgWhere(context, stmt.where)).length
  const selectivity = contexts.length ? matches / contexts.length : (stmt.where?.length ? 0 : 1)
  const estimatedRows = Math.round(logicalRows * selectivity)
  const order = stmt.orderBy?.[0]
  const distance = order && DISTANCE[order.operator] ? order : null
  const indexes = (db.indexes ?? []).filter(index => index.table === stmt.table && pgPartialIndexUsable(index, stmt))
  const base = { node: 'Seq Scan', estimatedRows, latencyMs: (distance ? 0.02 : 0.004) * logicalRows, recall: 1, rowsReturnedBeforeLimit: estimatedRows }
  if (distance) {
    if (stmt.limit == null || distance.direction === 'DESC' || (stmt.orderBy?.length ?? 0) !== 1) return finishPlan(base, stmt)
    const key = expressionKey(distance.column, stmt)
    const ann = indexes.find(index => ['hnsw', 'ivfflat'].includes(index.method) && index.columns?.length === 1 && expressionKey(indexExpression(index.columns[0]), stmt) === key && index.columns[0].opclass === `${indexExpression(index.columns[0])?.type === 'halfvec' ? 'halfvec' : table.columns?.find(column => expressionKey(column.name, stmt) === key)?.type ?? 'vector'}_${DISTANCE[distance.operator]}_ops`)
    if (!ann) return finishPlan(base, stmt)
    const partialContexts = ann.where?.length ? contexts.filter(context => matchesPgWhere(context, ann.where)) : contexts
    const conditionalSelectivity = partialContexts.length ? matches / partialContexts.length : 0
    let latencyMs; let recall; let candidates
    if (ann.method === 'hnsw') {
      candidates = positiveSetting(settings, server, 'hnsw.ef_search', 40)
      latencyMs = 2 + 0.05 * candidates; recall = Math.min(1, 0.80 + 0.004 * candidates)
    } else {
      const probes = positiveSetting(settings, server, 'ivfflat.probes', 1); const lists = Math.max(1, Number(ann.with?.lists ?? 100))
      candidates = probes * logicalRows / lists
      latencyMs = 1.5 + 0.6 * candidates / 1000; recall = Math.min(1, 0.70 + 0.6 * probes / lists)
    }
    let rowsReturnedBeforeLimit = Math.min(Number(stmt.limit), estimatedRows, Math.round(candidates * conditionalSelectivity))
    const iterative = settings['hnsw.iterative_scan'] ?? server.parameters?.['hnsw.iterative_scan']
    if (ann.method === 'hnsw' && ['relaxed_order', 'strict_order'].includes(iterative)) { rowsReturnedBeforeLimit = Math.min(Number(stmt.limit), estimatedRows); latencyMs *= 1.5 }
    return finishPlan({ node: `Index Scan using ${ann.name} (${ann.method})`, index: ann.name, estimatedRows, latencyMs, recall, rowsReturnedBeforeLimit }, stmt)
  }
  const btree = indexes.find(index => (index.method ?? 'btree') === 'btree' && index.columns?.length && (stmt.where ?? []).some(condition => condition.operator === '=' && expressionKey(conditionExpression(condition), stmt) === expressionKey(indexExpression(index.columns[0]), stmt)))
  const gin = indexes.find(index => index.method === 'gin' && index.columns?.some(column => (!column.opclass || ['jsonb_ops', 'jsonb_path_ops'].includes(column.opclass)) && (stmt.where ?? []).some(condition => condition.operator === '@>' && expressionKey(conditionExpression(condition), stmt) === expressionKey(indexExpression(column), stmt))))
  if (btree) return finishPlan({ ...base, node: 'Index Scan', index: btree.name, latencyMs: 0.8 + 0.01 * estimatedRows }, stmt)
  if (gin) return finishPlan({ ...base, node: 'Bitmap Heap Scan', index: gin.name, latencyMs: 1.5 + 0.02 * estimatedRows }, stmt)
  return finishPlan(base, stmt)
}
export function buildIndex(db, stmt, server = {}) {
  const table = tableFor(db, stmt.table)
  if (!table) return { ok: false, error: `ERROR: relation "${stmt.table}" does not exist` }
  const expression = indexExpression(stmt.columns?.[0] ?? {})
  let source = expression
  while (source?.kind === 'cast') source = source.expression
  const column = table.columns?.find(column => column.name === source?.name)
  const dims = expression?.dimensions ?? column?.dimensions ?? 1
  const halfvec = expression?.type === 'halfvec' || (!expression?.type && column?.type === 'halfvec')
  const bytes = halfvec ? 2 : 4
  const contexts = (table.rows ?? []).map(row => makePgRowContext(row, table.name))
  const fraction = stmt.where?.length ? (contexts.length ? contexts.filter(context => matchesPgWhere(context, stmt.where)).length / contexts.length : 0) : 1
  const rows = logicalSize(table) * fraction
  const cores = Math.max(1, Number(server.vCores ?? 1))
  let buildSeconds = 0.0003 * rows / cores
  if (stmt.method === 'hnsw') {
    const required = rows * dims * bytes * 1.6 / 1024
    const memory = positiveSetting({}, server, 'maintenance_work_mem', 65536)
    buildSeconds = memory < required ? 600 * required / memory : 0.0008 * rows / cores
    if (buildSeconds > 1800) return { ok: false, error: 'ERROR: could not build HNSW index within the simulated time budget; increase maintenance_work_mem or compute (NOTICE: hnsw graph no longer fits into maintenance_work_mem)' }
  }
  return { ok: true, buildSeconds, sizeMb: rows * dims * bytes * 1.3 / 1e6, label: LABEL }
}
