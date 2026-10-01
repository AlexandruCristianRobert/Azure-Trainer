// Python recognizer for the Data journey (ADR-0002/0003): lowers the learner's
// edit-zone functions in app.py/worker.py into a bounded op list, via the
// shared SDK_CALLS catalog. It never executes Python; a construct outside the
// supported subset below always yields a DATA_UNSUPPORTED diagnostic instead
// of a fake Azure/Python error. Node-walking style copied from (not imported
// from) src/lib/project/python-integration.js.

import { parser } from '@lezer/python'
import { lookupCall, SDK_CALLS } from './sdk-catalog.js'
import { CONSISTENCY_ORDER } from './cosmos-cost.js'
import { REDIS_HELPER_FILES, REDIS_HELPER_ARITIES } from '../../data/templates/data-python/redis-runtime.js'

const ignored = new Set(['(', ')', '[', ']', '{', '}', ',', ':', 'AssignOp', 'for', 'in', 'if', 'elif', 'else', 'return', 'raise', '\n', 'Comment'])
const kids = (n) => { const r = []; for (let c = n?.firstChild; c; c = c.nextSibling) r.push(c); return r }
const parts = (n) => kids(n).filter((c) => !ignored.has(c.name))
const raw = (n, text) => text.slice(n.from, n.to)
const at = (text, n, path) => { const before = text.slice(0, n.from); return { path, line: before.split('\n').length, column: n.from - before.lastIndexOf('\n') } }
const stringParts = value => { const match = /^([rRuU]*)("""|'''|"|')/.exec(value); return match ? { prefix: match[1], start: match[0].length, end: value.length - match[2].length } : null }
const decodeString = value => value.replace(/\\(\r?\n|[\\'"nrtbf]|x[\da-fA-F]{2}|u[\da-fA-F]{4})/g, (_, escape) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\n': '', '\r\n': '' }[escape] ?? (/^[xu]/.test(escape) ? String.fromCharCode(parseInt(escape.slice(1), 16)) : escape)))
const scalar = (n, text) => { if (!n) return undefined; if (n.name === 'String') { const value = raw(n, text); const bounds = stringParts(value); if (!bounds) return undefined; const content = value.slice(bounds.start, bounds.end); return /r/i.test(bounds.prefix) ? content : decodeString(content) } if (n.name === 'Number') return Number(raw(n, text)); if (n.name === 'Boolean') return raw(n, text) === 'True'; if (n.name === 'None') return null; return undefined }
const findNode = (n, test) => (test(n) ? n : kids(n).reduce((found, c) => found ?? findNode(c, test), null))
const funcNode = (tree, text, name) => kids(tree.topNode).find((n) => n.name === 'FunctionDefinition' && raw(kids(n).find((c) => c.name === 'VariableName'), text) === name)
const bodyOf = (n) => kids(n).find((c) => c.name === 'Body')
const DESCRIBE = { ArrayComprehensionExpression: 'list comprehensions', GeneratorExpression: 'generator expressions', LambdaExpression: 'lambda expressions', ConditionalExpression: 'conditional expressions', UnaryExpression: 'unary expressions', FormatString: 'f-strings', BooleanExpression: "'and'/'or'" }
const describe = (n) => DESCRIBE[n.name] ?? n.name

export function parseDataApp(files, manifest = {}) {
  const diagnostics = []
  const missing = (path) => diagnostics.push({ code: 'DATA_UNSUPPORTED', message: `Not supported by the simulator: missing ${path}`, path, line: 1, column: 1 })
  if (typeof files?.['clients.py'] !== 'string') { missing('clients.py'); return { appSpec: null, diagnostics } }
  if (typeof files?.['app.py'] !== 'string') { missing('app.py'); return { appSpec: null, diagnostics } }

  const receiverTypes = Object.values(manifest.receivers ?? {})
  const manifestBackend = manifest.dataBackend ?? (receiverTypes.some(type => type.startsWith('pg-')) ? 'postgres'
    : receiverTypes.some(type => type.startsWith('cosmos-')) ? 'cosmos' : null)
  const postgresManifest = manifestBackend === 'postgres'
  const redis = manifestBackend === 'redis'
  const runtimeFiles = postgresManifest || redis ? manifest.runtimeFiles ?? [] : []
  if (redis && (!runtimeFiles.includes('training_runtime.py') || manifest.fixedFiles?.['training_runtime.py'] !== REDIS_HELPER_FILES['training_runtime.py']
    || Object.keys(REDIS_HELPER_ARITIES).some(name => !manifest.runtimeFunctions?.includes(name)))) {
    diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: 'Redis helpers require their canonical protected runtime manifest.', path: 'training_runtime.py', line: 1, column: 1 })
  }
  for (const path of runtimeFiles) {
    if (typeof path !== 'string' || typeof manifest.fixedFiles?.[path] !== 'string' || files[path] !== manifest.fixedFiles[path]) {
      diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: `${redis ? 'Redis' : 'PostgreSQL'} runtime files must match their protected scaffold.`, path, line: 1, column: 1 })
    }
  }
  if (diagnostics.length) return { appSpec: null, diagnostics }
  const filePaths = [...new Set(['app.py', ...(typeof files['worker.py'] === 'string' ? ['worker.py'] : []), 'clients.py', ...runtimeFiles])]
  const clientsTree = parser.parse(files['clients.py'])
  const trees = Object.fromEntries(filePaths.map((path) => [path, parser.parse(files[path])]))
  for (const [path, tree] of filePaths.map((p) => [p, trees[p]])) {
    const bad = findNode(tree.topNode, (n) => n.name === '⚠')
    if (bad) diagnostics.push({ code: 'DATA_UNSUPPORTED', message: 'Not supported by the simulator: Python syntax error', ...at(files[path], bad, path) })
  }
  if (diagnostics.length) return { appSpec: null, diagnostics }

  const consistency = readClientConsistency(clientsTree, files['clients.py'], diagnostics)
  if (diagnostics.length) return { appSpec: null, diagnostics }

  const fileCtx = Object.fromEntries(filePaths.map((path) => {
    const text = files[path]; const tree = trees[path]
    const topConstants = {}
    for (const n of kids(tree.topNode).filter((x) => x.name === 'AssignStatement')) {
      const p = parts(n).filter(c => c.name !== 'TypeDef'); if (p.length === 2 && p[0].name === 'VariableName') { const v = scalar(p[1], text); if (v !== undefined) topConstants[raw(p[0], text)] = v }
    }
    return [path, { text, tree, topConstants, ...(redis ? redisImports(tree, text) : {}) }]
  }))

  // Captured client constants and pool constructors are immutable build data.
  // Cosmos wiring is deliberately left on its existing manifest path.
  const pg = manifestBackend ? postgresManifest : filePaths.some(path => kids(trees[path].topNode).some(node => {
    if (node.name !== 'ImportStatement') return false
    const imported = kids(node)
    const from = imported[0]?.name === 'from'
    const module = from ? imported.slice(1, imported.findIndex(part => part.name === 'import')).map(part => raw(part, files[path])).join('') : null
    return from ? /^(psycopg(?:\.[a-z_]+)*|psycopg_pool|pgvector\.psycopg)$/.test(module)
      : imported[0]?.name === 'import' && imported.some((part, index) => part.name === 'VariableName'
        && ['import', ','].includes(imported[index - 1]?.name) && ['psycopg', 'psycopg_pool'].includes(raw(part, files[path])))
  }))
  const globalConstants = pg || redis ? { ...fileCtx['clients.py'].topConstants } : {}
  const globalTypes = redis ? {} : { ...(manifest.receivers ?? {}) }
  const globals = {}
  const clientOps = []

  const protectedFunctions = new Map()
  if (runtimeFiles.length) {
    for (const name of manifest.runtimeFunctions ?? []) {
      const definitions = filePaths.flatMap(path => {
        const node = funcNode(fileCtx[path].tree, fileCtx[path].text, name)
        return node ? [{ path, node }] : []
      })
      const protectedDefinitions = definitions.filter(({ path }) => runtimeFiles.includes(path))
      if (protectedDefinitions.length !== 1) {
        diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: `Protected runtime function '${name}' must have one fixed module definition.`, path: runtimeFiles[0], line: 1, column: 1 })
      } else {
        const definition = protectedDefinitions[0]
        protectedFunctions.set(name, definition)
        for (const collision of definitions.filter(({ path }) => path !== definition.path)) {
          diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: `Protected runtime function '${name}' cannot be redefined.`, ...at(fileCtx[collision.path].text, collision.node, collision.path) })
        }
      }
    }
  }
  if (diagnostics.length) return { appSpec: null, diagnostics }
  if (redis) {
    for (const path of filePaths.filter(path => !runtimeFiles.includes(path))) {
      const ctx = fileCtx[path]
      const protectedNames = new Set([...Object.keys(REDIS_HELPER_ARITIES), ...Object.keys(ctx.redisHelpers)])
      const collision = findNode(ctx.tree.topNode, node => rebindsRedisName(node, protectedNames, ctx.text))
      if (collision) diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: 'Protected Redis helpers cannot be shadowed.', ...at(ctx.text, collision, path) })
      const constructorNames = new Set(Object.entries(ctx.importBindings).filter(([, binding]) => ['redis', 'redis.Redis'].includes(binding)).map(([name]) => name))
      const constructorCollision = findNode(ctx.tree.topNode, node => rebindsRedisName(node, constructorNames, ctx.text))
      if (constructorCollision) diagnostics.push({ code: 'DATA_UNSUPPORTED', message: 'Not supported by the simulator: rebinding an imported Redis constructor.', ...at(ctx.text, constructorCollision, path) })
      findNode(ctx.tree.topNode, node => {
        if (node.name !== 'ImportStatement') return false
        for (const [name, binding] of redisImportEntries(node, ctx.text)) {
          if (name === '*') diagnostics.push({ code: 'DATA_UNSUPPORTED', message: 'Not supported by the simulator: wildcard imports can rebind protected Redis identities.', ...at(ctx.text, node, path) })
          else if (protectedNames.has(name) && binding !== `training_runtime.${ctx.redisHelpers[name] ?? name}`) {
            diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: `Protected Redis helper '${name}' cannot be rebound.`, ...at(ctx.text, node, path) })
          } else if (constructorNames.has(name) && binding !== ctx.importBindings[name]) {
            diagnostics.push({ code: 'DATA_UNSUPPORTED', message: 'Not supported by the simulator: rebinding an imported Redis constructor.', ...at(ctx.text, node, path) })
          }
        }
        return false
      })
    }
  }
  if (diagnostics.length) return { appSpec: null, diagnostics }
  const locate = (name) => {
    if (protectedFunctions.has(name)) return protectedFunctions.get(name)
    for (const path of filePaths) { const node = funcNode(fileCtx[path].tree, fileCtx[path].text, name); if (node) return { path, node } }
    return null
  }

  const functions = {}
  const queued = new Set()
  const pending = []
  const enqueue = (name) => { if (!queued.has(name)) { queued.add(name); pending.push(name) } }
  if (pg || redis) {
    const clientCtx = { ...fileCtx['clients.py'], path: 'clients.py', manifest, diagnostics, enqueue, locate, types: globalTypes, scope: new Set(), globalConstants, pg, redis, moduleScope: true }
    for (const node of kids(clientsTree.topNode).filter(n => n.name === 'AssignStatement')) {
      const p = parts(node).filter(n => n.name !== 'TypeDef')
      if (p.length !== 2 || p[0].name !== 'VariableName') { unsupported(clientCtx, node, 'this client assignment'); break }
      const name = raw(p[0], clientCtx.text)
      if (Object.hasOwn(globalConstants, name)) { globals[name] = { kind: 'literal', value: globalConstants[name] }; continue }
      const op = lowerStatement(node, clientCtx)
      if (op) { globals[name] = op.value; clientOps.push(op) }
    }
  }
  for (const name of manifest.editZones ?? []) if (locate(name)) enqueue(name)
  if (pg || redis) {
    if (!redis) for (const name of manifest.runtimeFunctions ?? []) if (locate(name)) enqueue(name)
    for (const route of Object.values(manifest.routes ?? {})) {
      const name = typeof route === 'string' ? route : route?.functionName ?? route?.function
      if (name && locate(name)) enqueue(name)
    }
  }

  while (pending.length && !diagnostics.length) {
    const name = pending.shift()
    const found = locate(name)
    if (!found) continue
    if (redis && protectedFunctions.has(name) && Object.hasOwn(REDIS_HELPER_ARITIES, name)) continue
    functions[name] = lowerFunction(found.node, { ...fileCtx[found.path], files, path: found.path, manifest, diagnostics, enqueue, locate, globalConstants, globalTypes, functionName: name, pg, redis })
  }

  if (diagnostics.length) return { appSpec: null, diagnostics }
  return { appSpec: { data: { version: 1, client: { consistency }, functions, ...(pg ? { postgres: { globals, clientOps,
    ...(manifest.postgresFixture === 'support-v3' ? { fixture: 'support-v3' } : {}) } } : {}), ...(redis ? { redis: { globals, clientOps } } : {}) } }, diagnostics: [] }
}

// Inspect every assignment target, including comma-separated/chained targets
// and nested tuple/list patterns. Never inspect just the first target or the
// assignment's RHS: imports grant a fixed identity only while it is unbound.
function rebindsRedisName(node, names, text) {
  const children = kids(node)
  let targets = []
  if (['AssignStatement', 'NamedExpression'].includes(node.name)) {
    const lastAssign = children.map(child => child.name).lastIndexOf('AssignOp')
    targets = lastAssign >= 0 ? children.slice(0, lastAssign) : []
  } else if (node.name === 'UpdateStatement') targets = children.slice(0, 1)
  else if (node.name === 'ForStatement') targets = children.slice(1, children.findIndex(child => child.name === 'in'))
  else if (node.name === 'DeleteStatement') targets = children.slice(1)
  else if (node.name === 'ParamList') targets = children.filter(child => child.name === 'VariableName')
  else if (['FunctionDefinition', 'ClassDefinition'].includes(node.name)) targets = children.filter(child => child.name === 'VariableName').slice(0, 1)
  else if (['WithStatement', 'TryStatement'].includes(node.name)) targets = children.filter((child, index) => children[index - 1]?.name === 'as')
  return targets.some(target => findNode(target, child => child.name === 'VariableName' && names.has(raw(child, text))))
}

// Read only parsed ImportStatement nodes: comments and string literals cannot
// grant constructor/helper authority. Aliases bind to the imported identity.
function redisImports(tree, text) {
  const importBindings = {}
  for (const node of kids(tree.topNode).filter(node => node.name === 'ImportStatement')) {
    for (const [name, binding] of redisImportEntries(node, text)) importBindings[name] = binding
  }
  const redisConstructors = {}; const redisHelpers = {}
  for (const [name, binding] of Object.entries(importBindings)) {
    if (binding === 'redis') redisConstructors[`${name}.Redis`] = 'redis.Redis'
    if (binding === 'redis.Redis') redisConstructors[name] = 'redis.Redis'
    if (binding.startsWith('training_runtime.') && Object.hasOwn(REDIS_HELPER_ARITIES, binding.slice(17))) redisHelpers[name] = binding.slice(17)
  }
  return { importBindings, redisConstructors, redisHelpers }
}

function redisImportEntries(node, text) {
  const children = kids(node).filter(child => !['Comment', '(', ')'].includes(child.name))
  const importAt = children.findIndex(child => child.name === 'import')
  const module = children[0]?.name === 'from' ? children.slice(1, importAt).map(child => raw(child, text)).join('') : null
  const entries = []
  let group = []
  const append = () => {
    if (!group.length) return
    const asAt = group.findIndex(child => child.name === 'as')
    const imported = (asAt >= 0 ? group.slice(0, asAt) : group).map(child => raw(child, text)).join('')
    const name = asAt >= 0 ? raw(group[asAt + 1], text) : module ? imported : imported.split('.')[0]
    entries.push([name, module ? `${module}.${imported}` : imported]); group = []
  }
  for (const child of children.slice(importAt + 1)) { if (child.name === ',') append(); else group.push(child) }
  append()
  return entries
}

function readClientConsistency(tree, text, diagnostics) {
  const call = findNode(tree.topNode, (n) => n.name === 'CallExpression' && n.firstChild?.name === 'VariableName' && raw(n.firstChild, text) === 'CosmosClient')
  if (!call) return null
  const argList = kids(call).find((n) => n.name === 'ArgList')
  const { positional, keywords } = argumentsOfWithText(argList, text)
  const params = SDK_CALLS['cosmos.CosmosClient'].params
  const node = keywords.find(([kw]) => kw === 'consistency_level')?.[1] ?? positional[params.indexOf('consistency_level')]
  const value = scalar(node, text)
  if (typeof value !== 'string') return null
  if (!CONSISTENCY_ORDER.includes(value)) {
    diagnostics.push({ code: 'SDK_ARGUMENT', message: `ValueError: consistency_level must be one of ${CONSISTENCY_ORDER.join(', ')} (got '${value}')`, ...at(text, node, 'clients.py') })
  }
  return value
}

function lowerFunction(node, ctx) {
  const params = parts(kids(node).find((c) => c.name === 'ParamList')).filter((c) => c.name === 'VariableName').map((c) => raw(c, ctx.text))
  const scope = new Set([...params, ...Object.keys(ctx.globalTypes ?? {})])
  const types = { ...ctx.globalTypes }
  const body = parts(bodyOf(node)).map((s) => lowerStatement(s, { ...ctx, scope, types })).filter(Boolean)
  return { params, body }
}

function lowerStatement(node, ctx) {
  const { text, path, scope, diagnostics } = ctx
  if (diagnostics.length) return null
  if (node.name === 'AssignStatement') {
    const p = parts(node).filter(n => n.name !== 'TypeDef')
    if (p.length !== 2 || p[0].name !== 'VariableName') return unsupported(ctx, node, 'this assignment')
    const name = raw(p[0], text); const value = lowerExpr(p[1], ctx)
    scope.add(name)
    if (value?.receiverType) ctx.types[name] = value.receiverType
    else delete ctx.types[name]
    return diagnostics.length ? null : { op: 'assign', name, value, source: at(text, node, path) }
  }
  if (node.name === 'WithStatement') {
    const p = kids(node).filter(n => !['with', 'as', 'Comment'].includes(n.name))
    if (p.length !== 3 || p[0].name !== 'CallExpression' || p[1].name !== 'VariableName' || p[2].name !== 'Body') return unsupported(ctx, node, 'this with statement')
    const value = lowerExpr(p[0], ctx)
    if (!['pg-connection', 'pg-cursor'].includes(value?.receiverType)) return diagnostics.length ? null : unsupported(ctx, node, 'this context manager')
    const name = raw(p[1], text); scope.add(name); ctx.types[name] = value.receiverType
    const body = parts(p[2]).map(s => lowerStatement(s, ctx)).filter(Boolean)
    return diagnostics.length ? null : { op: 'with', name, value, body, source: at(text, node, path) }
  }
  if (node.name === 'ReturnStatement') {
    const expr = kids(node).find((c) => c.name !== 'return')
    const value = expr ? lowerExpr(expr, ctx) : { kind: 'literal', value: null }
    return diagnostics.length ? null : { op: 'return', value, source: at(text, node, path) }
  }
  if (node.name === 'ExpressionStatement') {
    const inner = kids(node)[0]
    if (inner?.name !== 'CallExpression') return unsupported(ctx, node, 'this statement')
    const value = lowerCall(inner, ctx)
    return diagnostics.length ? null : { op: 'expr', value, source: at(text, node, path) }
  }
  if (node.name === 'ForStatement') {
    const p = parts(node)
    if (p.length !== 3 || p[0].name !== 'VariableName') return unsupported(ctx, node, 'this for statement')
    const iterable = lowerExpr(p[1], ctx)
    scope.add(raw(p[0], text))
    const bodyOps = parts(p[2]).map((s) => lowerStatement(s, ctx)).filter(Boolean)
    return diagnostics.length ? null : { op: 'for', name: raw(p[0], text), iterable, body: bodyOps, source: at(text, node, path) }
  }
  if (node.name === 'IfStatement') {
    if (kids(node).some((c) => c.name === 'elif')) return unsupported(ctx, node, "'elif'")
    const p = parts(node)
    const test = lowerCompare(p[0], ctx)
    const thenOps = parts(p[1]).map((s) => lowerStatement(s, ctx)).filter(Boolean)
    const elseOps = p[2] ? parts(p[2]).map((s) => lowerStatement(s, ctx)).filter(Boolean) : []
    return diagnostics.length ? null : { op: 'if', test, then: thenOps, else: elseOps, source: at(text, node, path) }
  }
  if (node.name === 'RaiseStatement') {
    const call = kids(node).find((c) => c.name === 'CallExpression')
    if (call?.firstChild?.name === 'VariableName' && raw(call.firstChild, text) === 'NotImplementedError') {
      // Review ruling: an edit zone that still raises NotImplementedError is
      // not a build-blocking diagnostic (that would stop a learner from
      // building a partially-finished app). It lowers to an op that fails
      // only when this function is actually CALLED, with a DATA_UNSUPPORTED
      // diagnostic at call time instead.
      return { op: 'raise-not-implemented', functionName: ctx.functionName, source: at(text, node, path) }
    }
    return unsupported(ctx, node, 'raise statements')
  }
  return unsupported(ctx, node, describe(node))
}

function lowerCompare(node, ctx) {
  if (node?.name !== 'BinaryExpression') return unsupported(ctx, node ?? { from: 0, to: 0 }, node ? describe(node) : 'this condition')
  const cs = kids(node)
  const left = cs[0]
  if (cs[1]?.name === 'is') {
    const isNot = cs[2]?.name === 'not'
    const right = isNot ? cs[3] : cs[2]
    if (right?.name !== 'None') return unsupported(ctx, node, "'is' comparisons other than None")
    return { kind: 'compare', op: isNot ? 'is not' : 'is', left: lowerExpr(left, ctx), right: { kind: 'literal', value: null } }
  }
  if (cs[1]?.name === 'CompareOp') {
    const op = raw(cs[1], ctx.text)
    if (!['==', '!=', '<', '>=', ...(ctx.redis ? ['<=', '>'] : [])].includes(op)) return unsupported(ctx, node, `the '${op}' comparison`)
    return { kind: 'compare', op, left: lowerExpr(left, ctx), right: lowerExpr(cs[2], ctx) }
  }
  return unsupported(ctx, node, describe(node))
}

function lowerExpr(node, ctx) {
  const { text, scope, diagnostics } = ctx
  if (diagnostics.length) return null
  if (!node) return unsupported(ctx, { from: 0, to: 0 }, 'a missing expression')
  const value = scalar(node, text)
  if (value !== undefined) return { kind: 'literal', value }
  if (node.name === 'VariableName') {
    const name = raw(node, text)
    if (ctx.pg && name === 'dict_row') return { kind: 'literal', value: 'dict_row' }
    if (ctx.pg && scope.has(name)) return { kind: 'name', name, ...(ctx.types?.[name] ? { receiverType: ctx.types[name] } : {}) }
    if (Object.hasOwn(ctx.globalConstants ?? {}, name)) return { kind: 'literal', value: ctx.globalConstants[name] }
    if (Object.hasOwn(ctx.topConstants, name)) return { kind: 'literal', value: ctx.topConstants[name] }
    if (scope.has(name)) return { kind: 'name', name, ...(ctx.types?.[name] ? { receiverType: ctx.types[name] } : {}) }
    return unsupported(ctx, node, `the unknown name '${name}'`)
  }
  if (node.name === 'DictionaryExpression') {
    const p = parts(node); const entries = {}
    for (let i = 0; i < p.length; i += 2) {
      const key = scalar(p[i], text)
      if (typeof key !== 'string') return unsupported(ctx, p[i], 'dictionary keys other than string literals')
      entries[key] = lowerExpr(p[i + 1], ctx)
    }
    return diagnostics.length ? null : { kind: 'dict', entries }
  }
  if (node.name === 'ArrayExpression' || node.name === 'TupleExpression') { const items = parts(node).map((c) => lowerExpr(c, ctx)); return diagnostics.length ? null : { kind: node.name === 'TupleExpression' ? 'tuple' : 'list', items } }
  if (node.name === 'ParenthesizedExpression') return lowerExpr(parts(node)[0], ctx)
  if (ctx.redis && node.name === 'BinaryExpression') {
    const p = kids(node)
    if (p.length === 3 && raw(p[1], text) === '+') return { kind: 'redis-add', left: lowerExpr(p[0], ctx), right: lowerExpr(p[2], ctx) }
  }
  if (node.name === 'FormatString' && ctx.pg) {
    const source = raw(node, text); const bounds = stringParts(source.replace(/^[fF]/, ''))
    if (!bounds) return unsupported(ctx, node, 'this f-string')
    let position = node.from + bounds.start + 1; const end = node.from + bounds.end + 1; const result = []
    for (const replacement of kids(node)) {
      if (replacement.name !== 'FormatReplacement') return unsupported(ctx, replacement, 'this f-string component')
      result.push({ kind: 'literal', value: decodeString(text.slice(position, replacement.from)).replace(/\{\{/g, '{').replace(/\}\}/g, '}') })
      const expressions = kids(replacement).filter(n => !['{', '}'].includes(n.name))
      if (expressions.length !== 1) return unsupported(ctx, replacement, 'f-string formatting options')
      result.push(lowerExpr(expressions[0], ctx)); position = replacement.to
    }
    result.push({ kind: 'literal', value: decodeString(text.slice(position, end)).replace(/\{\{/g, '{').replace(/\}\}/g, '}') })
    return diagnostics.length ? null : { kind: 'fstring', parts: result }
  }
  if (node.name === 'MemberExpression') return lowerMember(node, ctx)
  if (node.name === 'CallExpression') return lowerCall(node, ctx)
  return unsupported(ctx, node, describe(node))
}

function lowerMember(node, ctx) {
  const { text, manifest } = ctx
  const ps = kids(node)
  const hasBracket = ps.some((c) => c.name === '[')
  if (hasBracket) {
    const base = ps[0]; const key = ps.find((c) => c.name === 'String' || (ctx.pg && c.name === 'Number'))
    const lastCont = lastContinuationReceiver(node, text, manifest)
    if (lastCont) return { kind: 'sdk-attribute', receiver: lastCont, call: 'cosmos.container.last_continuation' }
    if (!key || (key.name === 'Number' && (!Number.isInteger(scalar(key, text)) || scalar(key, text) < 0 || scalar(key, text) > 1024))) return unsupported(ctx, node, 'subscripts with an unsupported key')
    return { kind: 'subscript', target: lowerExpr(base, ctx), key: scalar(key, text) }
  }
  const propNode = ps.find((c) => c.name === 'PropertyName')
  return { kind: 'attribute', target: lowerExpr(ps[0], ctx), attr: raw(propNode, text) }
}

// Matches `<receiver>.client_connection.last_response_headers["etag"]` where
// <receiver> is one of manifest.receivers (see ADR-0003 / Context and rulings).
function lastContinuationReceiver(node, text, manifest) {
  const ps = kids(node)
  const key = ps.find((c) => c.name === 'String')
  if (!key || scalar(key, text) !== 'etag') return null
  const headers = ps[0]
  if (headers?.name !== 'MemberExpression') return null
  const hp = kids(headers); const headersProp = hp.find((c) => c.name === 'PropertyName')
  if (!headersProp || raw(headersProp, text) !== 'last_response_headers') return null
  const conn = hp[0]
  if (conn?.name !== 'MemberExpression') return null
  const cp = kids(conn); const connProp = cp.find((c) => c.name === 'PropertyName')
  if (!connProp || raw(connProp, text) !== 'client_connection') return null
  const receiver = cp[0]
  if (receiver?.name !== 'VariableName') return null
  const name = raw(receiver, text)
  return Object.hasOwn(manifest.receivers ?? {}, name) ? name : null
}

const BUILTINS = new Set(['list', 'len', 'str'])
const PG_CONSTRUCTORS = { 'psycopg.connect': 'postgres.module.connect', 'connect': 'postgres.module.connect', 'ConnectionPool': 'postgres.pool.ConnectionPool', 'psycopg_pool.ConnectionPool': 'postgres.pool.ConnectionPool', 'register_vector': 'postgres.register_vector', 'pgvector.psycopg.register_vector': 'postgres.register_vector', 'Jsonb': 'postgres.Jsonb', 'psycopg.types.json.Jsonb': 'postgres.Jsonb' }

function functionReceiverType(name, ctx) {
  const found = ctx.locate?.(name)
  if (!found) return undefined
  const source = found.path === ctx.path ? ctx.text : ctx.files?.[found.path]
  if (!source) return undefined
  const ret = findNode(bodyOf(found.node), n => n.name === 'ReturnStatement')
  const call = ret && kids(ret).find(n => n.name === 'CallExpression')
  const callee = call && kids(call)[0]
  const key = callee && PG_CONSTRUCTORS[raw(callee, source)]
  if (key) return SDK_CALLS[key]?.returns
  if (callee?.name === 'MemberExpression') {
    const member = kids(callee)
    const base = member[0]
    const property = member.find(n => n.name === 'PropertyName')
    const type = base?.name === 'VariableName' && ctx.globalTypes?.[raw(base, source)]
    if (type === 'pg-pool' && property && raw(property, source) === 'connection') return lookupCall(type, 'connection')?.returns
  }
  return undefined
}

function lowerCall(node, ctx) {
  const { text, manifest, diagnostics } = ctx
  const callee = kids(node)[0]
  const args = argumentsOfWithText(kids(node).find((c) => c.name === 'ArgList'), text)
  const constructorKey = ctx.redis ? ctx.redisConstructors[raw(callee, text)] : ctx.pg && PG_CONSTRUCTORS[raw(callee, text)]
  // Local connect helpers take priority over the imported psycopg constructor.
  if (constructorKey && !(callee.name === 'VariableName' && ctx.locate?.(raw(callee, text)))) {
    const entry = SDK_CALLS[constructorKey]
    const boundArgs = bindArgs(entry, args, node, raw(callee, text), ctx)
    if (ctx.redis && boundArgs?.protocol && (boundArgs.protocol.kind !== 'literal' || boundArgs.protocol.value !== 2)) return unsupported(ctx, node, 'Redis protocol other than literal 2')
    return diagnostics.length ? null : { kind: 'call-sdk', call: constructorKey, args: boundArgs, ...(entry.returns ? { receiverType: entry.returns } : {}), ...(entry.returns === 'pg-pool' ? { lifetime: ctx.moduleScope ? 'module' : 'request' } : {}) }
  }
  if (callee.name === 'MemberExpression') {
    const mps = kids(callee); const propNode = mps.find((c) => c.name === 'PropertyName'); const base = mps[0]
    const property = raw(propNode, text)
    if (ctx.pg && ['append', 'join'].includes(property)) {
      if (args.keywords.length || args.positional.length !== 1) return unsupported(ctx, node, `this '.${property}()' call`)
      return { kind: 'sequence-method', method: property, target: lowerExpr(base, ctx), value: lowerExpr(args.positional[0], ctx) }
    }
    if (property === 'get' && !(ctx.redis && ctx.types?.[raw(base, text)] === 'redis-client')) {
      if (args.keywords.length || args.positional.length < 1 || args.positional.length > 2) return unsupported(ctx, node, "this '.get()' call")
      const key = scalar(args.positional[0], text)
      if (typeof key !== 'string') return unsupported(ctx, args.positional[0], 'a .get() key that is not a string literal')
      const result = { kind: 'get', target: lowerExpr(base, ctx), key }
      if (args.positional[1]) result.default = lowerExpr(args.positional[1], ctx)
      return diagnostics.length ? null : result
    }
    if (base.name === 'VariableName' || ctx.pg) {
      const target = ctx.pg || ctx.redis ? lowerExpr(base, ctx) : null
      const receiverType = target?.receiverType ?? (!ctx.redis ? manifest.receivers?.[raw(base, text)] : undefined)
      if (receiverType) {
        const entry = lookupCall(receiverType, property)
        if (!entry) return unsupported(ctx, node, `'${property}' on '${raw(base, text)}'`)
        const boundArgs = bindArgs(entry, args, node, property, ctx)
        return diagnostics.length ? null : { kind: 'call-sdk', receiver: raw(base, text), ...(receiverType.startsWith('pg-') || receiverType === 'redis-client' ? { target } : {}), call: entry.key, args: boundArgs, ...(entry.returns ? { receiverType: entry.returns } : {}) }
      }
    }
    return unsupported(ctx, node, 'this method call')
  }
  if (callee.name === 'VariableName') {
    const name = raw(callee, text)
    if (ctx.redis && ctx.redisHelpers[name]) {
      const helper = ctx.redisHelpers[name]
      if (args.keywords.length || !REDIS_HELPER_ARITIES[helper].includes(args.positional.length)) return unsupported(ctx, node, `'${name}(...)' arguments`)
      return { kind: 'redis-helper', name: helper, args: args.positional.map(arg => lowerExpr(arg, ctx)) }
    }
    if (BUILTINS.has(name) || (name === 'embed' && !ctx.redis) || (ctx.redis && name === 'float') || (ctx.pg && name === 'training_answer')) {
      const arity = name === 'training_answer' ? 2 : 1
      if (args.keywords.length || args.positional.length !== arity) return unsupported(ctx, node, `'${name}(...)'`)
      const values = args.positional.map(arg => lowerExpr(arg, ctx))
      return diagnostics.length ? null : { kind: 'builtin', name, args: values }
    }
    if (name === 'next') {
      const [first, second] = args.positional
      const isIter = first?.name === 'CallExpression' && first.firstChild?.name === 'VariableName' && raw(first.firstChild, text) === 'iter'
      if (args.keywords.length || args.positional.length !== 2 || !isIter || second?.name !== 'None') return unsupported(ctx, node, "'next(...)' other than next(iter(x), None)")
      const iterArgs = argumentsOfWithText(kids(first).find((c) => c.name === 'ArgList'), text)
      if (iterArgs.keywords.length || iterArgs.positional.length !== 1) return unsupported(ctx, first, "'iter(...)'")
      return diagnostics.length ? null : { kind: 'builtin', name: 'next', args: [lowerExpr(iterArgs.positional[0], ctx)] }
    }
    const local = ctx.locate?.(name) ?? funcNode(ctx.tree, text, name)
    if (local) {
      if (args.keywords.length) return unsupported(ctx, node, `keyword arguments to '${name}(...)'`)
      ctx.enqueue(name)
      const callArgs = args.positional.map((a) => lowerExpr(a, ctx))
      const receiverType = functionReceiverType(name, ctx)
      return diagnostics.length ? null : { kind: 'call-local', name, args: callArgs, ...(receiverType ? { receiverType } : {}) }
    }
    return unsupported(ctx, node, `the call '${name}(...)'`)
  }
  return unsupported(ctx, node, 'this call expression')
}

function argumentsOfWithText(node, text) {
  if (!node) return { positional: [], keywords: [] }
  const values = kids(node).filter((x) => !['(', ')', ','].includes(x.name))
  const positional = []; const keywords = []
  for (let i = 0; i < values.length; i++) {
    if (values[i + 1]?.name === 'AssignOp') { keywords.push([raw(values[i], text), values[i + 2]]); i += 2 } else positional.push(values[i])
  }
  return { positional, keywords }
}

function bindArgs(entry, args, node, label, ctx) {
  const { params, required = [], keywordOnly = [] } = entry
  if (entry.variadic) {
    if (args.keywords.length || !args.positional.length) { unsupported(ctx, node, `'${label}(...)' arguments`); return null }
    return { [entry.variadic]: { kind: 'list', items: args.positional.map(arg => lowerExpr(arg, ctx)) } }
  }
  // keywordOnly params (e.g. query_items_change_feed's start_time, matching
  // the real SDK) are valid as `name=value` but never bind to a position.
  const positionalParams = params.filter((p) => !keywordOnly.includes(p))
  if (args.positional.length > positionalParams.length) { unsupported(ctx, node, `too many arguments to '${label}(...)'`); return null }
  const values = {}
  args.positional.forEach((argNode, i) => { values[positionalParams[i]] = lowerExpr(argNode, ctx) })
  for (const [kw, argNode] of args.keywords) {
    if (!params.includes(kw)) { unsupported(ctx, node, `the keyword argument '${kw}' to '${label}(...)'`); return null }
    if (Object.hasOwn(values, kw)) { unsupported(ctx, node, `the duplicate argument '${kw}' to '${label}(...)'`); return null }
    values[kw] = lowerExpr(argNode, ctx)
  }
  const missingParam = required.find((p) => !Object.hasOwn(values, p))
  if (missingParam) {
    if (ctx.redis) { unsupported(ctx, node, `missing '${missingParam}' argument to '${label}(...)'`); return null }
    ctx.diagnostics.push({ code: 'SDK_ARGUMENT', message: `TypeError: ${label}() missing required argument '${missingParam}'`, ...at(ctx.text, node, ctx.path) })
    return null
  }
  return values
}

function unsupported(ctx, node, construct) {
  ctx.diagnostics.push({ code: 'DATA_UNSUPPORTED', message: `Not supported by the simulator: ${construct}`, ...at(ctx.text, node, ctx.path) })
  return null
}
