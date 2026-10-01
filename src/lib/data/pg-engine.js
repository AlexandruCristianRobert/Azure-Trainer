import { cloneSandbox } from '../sandbox/model.js'
import { getPostgresServer, getPostgresDatabase } from '../sandbox/postgres.js'
import { CORPUS } from '../../data/fixtures/data/corpus.js'
import { parsePgSql, bindParams } from './pg-sql.js'
import { buildIndex, planSelect, evaluatePgExpression, matchesPgWhere, samplePgContexts, makePgRowContext, decodePgVector } from './pg-plan.js'

const fail = (message, code = 'ProgrammingError', hint) => { throw Object.assign(new Error(message), { code, ...(hint ? { hint } : {}) }) }
const unsupported = message => fail(`Not supported by the simulator: ${message}`, 'DATA_UNSUPPORTED')
const emptyContext = { row: {}, relations: {} }
const tableFor = (db, name) => db.tables.find(table => table.name === name) ?? fail(`relation "${name}" does not exist`)
const nameInPublic = name => {
  if (!name.includes('.')) return name
  if (name.startsWith('public.') && name.split('.').length === 2) return name.slice(7)
  unsupported(`schema in "${name}".`)
}
function normalizeNames(stmt) {
  for (const key of ['table', 'name']) if (stmt[key] && stmt.kind !== 'set') stmt[key] = nameInPublic(stmt[key])
  for (const join of stmt.joins ?? []) join.table = nameInPublic(join.table)
  for (const column of stmt.kind === 'create-table' ? stmt.columns : []) if (column.references) column.references.table = nameInPublic(column.references.table)
  return stmt
}
function connection(sandbox, ref) {
  const found = sandbox.postgresServers?.find(server => server.fullyQualifiedDomainName === ref.server)
  let server
  try { server = getPostgresServer(sandbox, found?.name ?? ref.server, ref.resourceGroup) }
  catch { fail(`psql: error: could not translate host name "${ref.server}" to address`, 'OperationalError') }
  const port = Number(ref.port ?? 5432)
  if (port !== 5432 && !(port === 6432 && server.parameters['pgbouncer.enabled'] === 'true')) fail('connection refused', 'OperationalError')
  let db
  try { db = getPostgresDatabase(server, ref.database) }
  catch { fail(`FATAL: database "${ref.database}" does not exist`, 'OperationalError') }
  return { server, db }
}
function vectorType(db, column) {
  if (['vector', 'halfvec'].includes(column.type) && !db.extensions.includes('vector')) fail(`type "${column.type}" does not exist`)
}
function relationsFor(db, stmt) {
  const relations = [{ table: tableFor(db, stmt.table), alias: stmt.alias }]
  for (const join of stmt.joins ?? []) relations.push({ table: tableFor(db, join.table), alias: join.alias })
  const names = new Set()
  for (const relation of relations) {
    const name = relation.alias ?? relation.table.name
    if (names.has(name)) fail(`table name "${name}" specified more than once`)
    names.add(name)
  }
  return relations
}
function expressionType(expr, relations, db) {
  if (expr == null || typeof expr !== 'object' || Array.isArray(expr)) return {}
  // A bound JSON payload is data, even when its fields look like AST nodes.
  if (expr.kind === 'literal') return {}
  if (expr.kind === 'column') {
    const candidates = relations.filter(relation => expr.table
      ? (relation.alias ?? relation.table.name) === expr.table
      : relation.table.columns.some(column => column.name === expr.name))
    if (candidates.length > 1) fail(`column reference "${expr.name}" is ambiguous`)
    const column = candidates[0]?.table.columns.find(column => column.name === expr.name)
    if (!column) fail(`column "${expr.table ? `${expr.table}.` : ''}${expr.name}" does not exist`)
    return column
  }
  if (expr.kind === 'cast') {
    expressionType(expr.expression, relations, db)
    vectorType(db, expr)
    if (['vector', 'halfvec'].includes(expr.type) && expr.dimensions !== undefined && (!Number.isInteger(expr.dimensions) || expr.dimensions < 1)) fail('invalid vector dimensions', 'DataError')
    return { type: expr.type, dimensions: expr.dimensions }
  }
  if (expr.kind === 'json-extract') {
    if (expressionType(expr.column, relations, db).type !== 'jsonb') fail('JSON extraction requires a jsonb column')
    return { type: 'text' }
  }
  if (expr.kind === 'distance') {
    const source = expressionType(expr.column, relations, db)
    if (!['vector', 'halfvec'].includes(source.type)) fail('vector distance requires a vector column')
    expressionType(expr.value, relations, db)
    const query = evaluatePgExpression(expr.value, emptyContext)
    if (query != null) decodePgVector(query, source.dimensions)
    return { type: 'float' }
  }
  if (expr.kind === 'star') return {}
  unsupported('unbound or unsupported expression.')
}
function validateConditions(conditions, relations, db) {
  for (const condition of conditions ?? []) {
    const type = expressionType(condition.expression, relations, db)
    expressionType(condition.value, relations, db)
    for (const value of condition.values ?? []) expressionType(value, relations, db)
    if (condition.operator === '@>' && type.type !== 'jsonb') fail('JSON containment requires a jsonb column')
    if (['vector', 'halfvec'].includes(type.type)) {
      for (const expression of condition.operator === 'in' ? condition.values : [condition.value]) {
        const value = evaluatePgExpression(expression, emptyContext)
        if (value != null) decodePgVector(value, type.dimensions)
      }
    }
  }
}
function coerceValue(value, column, context = emptyContext) {
  const data = evaluatePgExpression(value, context)
  if (data == null) return null
  // Evaluate casts through the same evaluator used by SELECT and the planner.
  const coerced = evaluatePgExpression({ kind: 'cast', expression: { kind: 'literal', value: data }, type: column.type, dimensions: column.dimensions }, context)
  if (column.type === 'timestamptz') {
    if (typeof coerced !== 'string' || Number.isNaN(Date.parse(coerced))) fail('invalid input syntax for type timestamptz', 'DataError')
    return new Date(coerced).toISOString()
  }
  return coerced
}
function appendRows(db, table, columns, rows, nowMs) {
  if (new Set(columns).size !== columns.length) fail('column specified more than once')
  for (const name of columns) if (!table.columns.some(column => column.name === name)) fail(`column "${name}" of relation "${table.name}" does not exist`)
  const added = []
  for (const values of rows) {
    const row = {}
    for (const column of table.columns) {
      const index = columns.indexOf(column.name)
      const existing = [...table.rows, ...added]
      const value = index >= 0 ? values[index] : column.identity
        ? Math.max(0, ...existing.map(row => Number(row[column.name]) || 0)) + 1
        : column.default?.kind === 'now' ? new Date(nowMs).toISOString() : null
      row[column.name] = coerceValue(value, column)
      if ((column.notNull || column.primaryKey || table.primaryKey?.includes(column.name)) && row[column.name] === null) fail(`null value in column "${column.name}" violates not-null constraint`, 'IntegrityError')
      if (column.references && row[column.name] !== null) {
        const target = column.references.table === table.name ? { rows: existing } : tableFor(db, column.references.table)
        if (!target.rows.some(parent => parent[column.references.column] === row[column.name])) fail(`insert or update on table "${table.name}" violates foreign key constraint`, 'IntegrityError')
      }
    }
    const keys = [...new Set([...(table.primaryKey ?? []), ...table.columns.filter(column => column.primaryKey).map(column => column.name)])]
    if (keys.length && [...table.rows, ...added].some(candidate => keys.every(key => candidate[key] === row[key]))) fail(`duplicate key value violates unique constraint "${table.name}_pkey"`, 'IntegrityError')
    added.push(row)
  }
  table.rows.push(...added)
  table.logicalRows = Number(table.logicalRows ?? table.rows.length - added.length) + added.length
  return added.length
}
function createTable(db, stmt) {
  if (db.tables.some(table => table.name === stmt.name)) {
    if (stmt.ifNotExists) return { notice: `relation "${stmt.name}" already exists, skipping` }
    fail(`relation "${stmt.name}" already exists`)
  }
  if (new Set(stmt.columns.map(column => column.name)).size !== stmt.columns.length) fail('column specified more than once')
  const keys = [...stmt.primaryKey, ...stmt.columns.filter(column => column.primaryKey).map(column => column.name)]
  if (keys.length > 1) fail('multiple primary keys for table are not allowed')
  for (const key of keys) if (!stmt.columns.some(column => column.name === key)) fail(`column "${key}" does not exist`)
  for (const column of stmt.columns) {
    vectorType(db, column)
    if (!column.references) continue
    const target = column.references.table === stmt.name ? { columns: stmt.columns, primaryKey: stmt.primaryKey } : tableFor(db, column.references.table)
    const parent = target.columns.find(candidate => candidate.name === column.references.column)
    if (!parent) fail(`column "${column.references.column}" referenced in foreign key constraint does not exist`)
    if (!parent.primaryKey && !target.primaryKey?.includes(parent.name)) fail('there is no unique constraint matching given keys for referenced table')
    const integer = type => ['int', 'integer', 'bigint'].includes(type)
    if (parent.type !== column.type && !(integer(parent.type) && integer(column.type))) fail('foreign key constraint cannot be implemented')
  }
  db.tables.push({ name: stmt.name, columns: stmt.columns, primaryKey: stmt.primaryKey, rows: [], logicalRows: 0 })
  return {}
}
function createIndex(db, stmt, server, settings) {
  if (db.indexes.some(index => index.name === stmt.name) || db.tables.some(table => table.name === stmt.name)) {
    if (stmt.ifNotExists) return { notice: `relation "${stmt.name}" already exists, skipping` }
    fail(`relation "${stmt.name}" already exists`)
  }
  const relations = relationsFor(db, stmt)
  validateConditions(stmt.where, relations, db)
  for (const column of stmt.columns) {
    const expression = column.expression ?? (column.name.includes('.') ? { kind: 'column', table: column.name.split('.')[0], name: column.name.split('.')[1] } : { kind: 'column', name: column.name })
    const type = expressionType(expression, relations, db)
    if (['hnsw', 'ivfflat'].includes(stmt.method)) {
      if (stmt.columns.length !== 1 || !['vector', 'halfvec'].includes(type.type)) fail(`access method "${stmt.method}" requires one vector column`)
      const allowed = type.type === 'halfvec' ? ['halfvec_cosine_ops'] : ['vector_cosine_ops', 'vector_l2_ops', 'vector_ip_ops']
      if (!allowed.includes(column.opclass)) fail(`operator class "${column.opclass ?? ''}" does not accept data type ${type.type}`)
    } else if (stmt.method === 'gin') {
      if (type.type !== 'jsonb' || column.opclass && !['jsonb_ops', 'jsonb_path_ops'].includes(column.opclass)) fail('GIN index requires a jsonb column and matching operator class')
    } else if (column.opclass) fail(`operator class "${column.opclass}" does not exist for access method "btree"`)
    for (const row of relations[0].table.rows) evaluatePgExpression(expression, makePgRowContext(row, stmt.table))
  }
  const options = stmt.method === 'hnsw' ? ['m', 'ef_construction'] : stmt.method === 'ivfflat' ? ['lists'] : []
  for (const [key, value] of Object.entries(stmt.with)) if (!options.includes(key) || !Number.isSafeInteger(value) || value < 1) fail(`invalid index option "${key}"`)
  const built = buildIndex(db, stmt, { ...server, parameters: { ...server.parameters, ...settings } })
  if (!built.ok) fail(built.error)
  db.indexes.push({ ...stmt, sizeMb: built.sizeMb, buildSeconds: built.buildSeconds })
  return { buildSeconds: built.buildSeconds, notice: built.label }
}
function projectionName(expression) {
  return expression.alias ?? (expression.kind === 'column' ? expression.name : expression.kind === 'json-extract' ? '?column?' : expression.kind === 'cast' ? projectionName(expression.expression) : '?column?')
}
function selectRows(db, stmt, server, settings) {
  const relations = relationsFor(db, stmt)
  for (const join of stmt.joins ?? []) { expressionType(join.on.left, relations, db); expressionType(join.on.right, relations, db) }
  validateConditions(stmt.where, relations, db)
  const projections = stmt.columns.flatMap(expression => expression.kind === 'star'
    ? relations.flatMap(relation => relation.table.columns.map(column => ({ kind: 'column', table: relation.alias ?? relation.table.name, name: column.name }))) : [expression])
  const columns = projections.map(expression => {
    const type = expressionType(expression, relations, db)
    return { name: projectionName(expression), type: type.type, ...(type.dimensions !== undefined ? { dimensions: type.dimensions } : {}) }
  })
  for (const expression of stmt.orderBy) expressionType(expression, relations, db)
  if (stmt.limit !== null && (!Number.isSafeInteger(stmt.limit) || stmt.limit < 0)) fail('LIMIT must be a non-negative integer', 'DataError')
  const plan = planSelect(db, stmt, settings, server)
  const contexts = samplePgContexts(db, stmt).filter(context => matchesPgWhere(context, stmt.where))
  contexts.sort((a, b) => {
    for (const expression of stmt.orderBy) {
      const left = evaluatePgExpression(expression, a), right = evaluatePgExpression(expression, b)
      const result = left == null ? (right == null ? 0 : 1) : right == null ? -1 : left < right ? -1 : left > right ? 1 : 0
      if (result) return expression.direction === 'DESC' ? -result : result
    }
    return 0
  })
  const selected = contexts.slice(0, Math.min(stmt.limit ?? Infinity, plan.rowsReturnedBeforeLimit))
  const rowValues = selected.map(context => projections.map(expression => evaluatePgExpression(expression, context)))
  const rows = rowValues.map(values => Object.fromEntries(values.map((value, index) => [columns[index].name, value])))
  if (stmt.explain) return { kind: 'explain', rows: [], rowValues: [], columns: [{ name: 'QUERY PLAN', type: 'text' }], rowCount: rows.length,
    plan: { ...plan, text: [...plan.text, ...(stmt.explain.analyze ? [`Actual time: ${plan.latencyMs.toFixed(2)} ms; rows: ${rows.length} (simulated)`] : [])] }, latencyMs: plan.latencyMs }
  return { rows, rowValues, columns, rowCount: rows.length, plan, latencyMs: plan.latencyMs }
}
function applyStatement(db, stmt, server, session, nowMs) {
  if (stmt.kind === 'create-extension') {
    if (stmt.name !== 'vector') unsupported(`extension "${stmt.name}".`)
    if (db.extensions.includes('vector')) {
      if (stmt.ifNotExists) return { notice: 'extension "vector" already exists, skipping' }
      fail('extension "vector" already exists')
    }
    if (!server.parameters['azure.extensions'].split(',').includes('vector')) fail('extension "vector" is not allow-listed for "azure_pg_admin" users in Azure Database for PostgreSQL', 'ProgrammingError',
      'to learn how to allow an extension or see the list of allowed extensions, please refer to https://go.microsoft.com/fwlink/?linkid=2301063')
    db.extensions.push('vector'); return {}
  }
  if (stmt.kind === 'create-table') return createTable(db, stmt)
  if (stmt.kind === 'create-index') return createIndex(db, stmt, server, session.settings)
  if (stmt.kind === 'drop-index') {
    const index = db.indexes.findIndex(index => index.name === stmt.name)
    if (index < 0) {
      if (stmt.ifExists) return { notice: `index "${stmt.name}" does not exist, skipping` }
      fail(`index "${stmt.name}" does not exist`)
    }
    db.indexes.splice(index, 1); return {}
  }
  if (stmt.kind === 'insert') return { rowCount: appendRows(db, tableFor(db, stmt.table), stmt.columns, stmt.rows, nowMs) }
  if (stmt.kind === 'select') return selectRows(db, stmt, server, session.settings)
  if (stmt.kind === 'set') {
    const value = evaluatePgExpression(stmt.value, emptyContext)
    if (stmt.name === 'hnsw.iterative_scan') {
      if (!['off', 'strict_order', 'relaxed_order'].includes(value)) fail('invalid value for parameter "hnsw.iterative_scan"')
    } else if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) fail(`invalid value for parameter "${stmt.name}"`)
    if (stmt.name === 'maintenance_work_mem' && Number(value) > server.memoryGiB * 1024 * 1024 / 4) fail('maintenance_work_mem cannot exceed 25% of server memory (kB).')
    session.settings[stmt.name] = String(value); return {}
  }
  unsupported(`statement "${stmt.kind}".`)
}
function structuredError(error) {
  const code = error.code ?? 'ProgrammingError'
  return { code, message: code === 'DATA_UNSUPPORTED' || /^(ERROR:|FATAL:|psql:)/.test(error.message) ? error.message : `ERROR: ${error.message}`,
    ...(error.hint ? { hint: error.hint } : {}), ...(error.line ? { line: error.line, column: error.column } : {}) }
}

export function executePg(sandbox, ref) {
  const session = { settings: { ...(ref.session?.settings ?? {}) } }
  const results = []
  let current = sandbox
  try { connection(current, ref) }
  catch (error) { return { sandbox: current, results: [{ kind: 'connection', error: structuredError(error) }], session } }
  const parsed = parsePgSql(ref.sql)
  if (parsed.error) return { sandbox: current, results: [{ kind: 'parse', error: structuredError(parsed.error) }], session }
  for (const parsedStatement of parsed.statements) {
    const bound = bindParams(parsedStatement, ref.params)
    if (bound.error) { results.push({ kind: parsedStatement.kind, error: structuredError(bound.error) }); break }
    try {
      const stmt = normalizeNames(bound)
      const mutates = !['select', 'set'].includes(stmt.kind)
      const next = mutates ? cloneSandbox(current) : current
      const { server, db } = connection(next, ref)
      const result = applyStatement(db, stmt, server, session, ref.nowMs ?? 0)
      current = next
      results.push({ kind: stmt.kind, ...result })
    } catch (error) { results.push({ kind: parsedStatement.kind, error: structuredError(error) }); break }
  }
  return { sandbox: current, results, session }
}

// Fixed bulk COPY stand-in; requires the learner/seed's existing schema. Optional
// fixture injection lets a later authored corpus extend the dataset atomically.
export function loadCorpus(sandbox, ref) {
  const next = cloneSandbox(sandbox)
  const { db } = connection(next, ref)
  const corpus = ref.corpus ?? CORPUS
  for (const name of ['documents', 'chunks']) {
    const table = tableFor(db, name)
    const rows = JSON.parse(JSON.stringify(corpus[name]))
    const columns = table.columns.map(column => column.name)
    for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) fail(`column "${key}" of relation "${name}" does not exist`)
    table.rows = []
    table.logicalRows = 0
    appendRows(db, table, columns, rows.map(row => columns.map(name => ({ kind: 'literal', value: row[name] ?? null }))), ref.nowMs ?? 0)
    table.logicalRows = corpus.logicalRows[name]
  }
  return { sandbox: next, rowCount: corpus.documents.length + corpus.chunks.length, logicalRows: { ...corpus.logicalRows } }
}
