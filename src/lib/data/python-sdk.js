// Python recognizer for the Data journey (ADR-0002/0003): lowers the learner's
// edit-zone functions in app.py/worker.py into a bounded op list, via the
// shared SDK_CALLS catalog. It never executes Python; a construct outside the
// supported subset below always yields a DATA_UNSUPPORTED diagnostic instead
// of a fake Azure/Python error. Node-walking style copied from (not imported
// from) src/lib/project/python-integration.js.

import { parser } from '@lezer/python'
import { lookupCall, SDK_CALLS } from './sdk-catalog.js'
import { CONSISTENCY_ORDER } from './cosmos-cost.js'

const ignored = new Set(['(', ')', '[', ']', '{', '}', ',', ':', 'AssignOp', 'for', 'in', 'if', 'elif', 'else', 'return', 'raise', '\n', 'Comment'])
const kids = (n) => { const r = []; for (let c = n?.firstChild; c; c = c.nextSibling) r.push(c); return r }
const parts = (n) => kids(n).filter((c) => !ignored.has(c.name))
const raw = (n, text) => text.slice(n.from, n.to)
const at = (text, n, path) => { const before = text.slice(0, n.from); return { path, line: before.split('\n').length, column: n.from - before.lastIndexOf('\n') } }
const scalar = (n, text) => { if (!n) return undefined; if (n.name === 'String') return raw(n, text).slice(1, -1); if (n.name === 'Number') return Number(raw(n, text)); if (n.name === 'Boolean') return raw(n, text) === 'True'; if (n.name === 'None') return null; return undefined }
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

  const filePaths = ['app.py', ...(typeof files['worker.py'] === 'string' ? ['worker.py'] : [])]
  const clientsTree = parser.parse(files['clients.py'])
  const trees = Object.fromEntries(filePaths.map((path) => [path, parser.parse(files[path])]))
  for (const [path, tree] of [['clients.py', clientsTree], ...filePaths.map((p) => [p, trees[p]])]) {
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
      const p = parts(n); if (p.length === 2 && p[0].name === 'VariableName') { const v = scalar(p[1], text); if (v !== undefined) topConstants[raw(p[0], text)] = v }
    }
    return [path, { text, tree, topConstants }]
  }))

  const locate = (name) => { for (const path of filePaths) { const node = funcNode(fileCtx[path].tree, fileCtx[path].text, name); if (node) return { path, node } } return null }

  const functions = {}
  const queued = new Set()
  const pending = []
  const enqueue = (name) => { if (!queued.has(name)) { queued.add(name); pending.push(name) } }
  for (const name of manifest.editZones ?? []) if (locate(name)) enqueue(name)

  while (pending.length && !diagnostics.length) {
    const name = pending.shift()
    const found = locate(name)
    if (!found) continue
    functions[name] = lowerFunction(found.node, { ...fileCtx[found.path], path: found.path, manifest, diagnostics, enqueue, functionName: name })
  }

  if (diagnostics.length) return { appSpec: null, diagnostics }
  return { appSpec: { data: { version: 1, client: { consistency }, functions } }, diagnostics: [] }
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
  const scope = new Set(params)
  const body = parts(bodyOf(node)).map((s) => lowerStatement(s, { ...ctx, scope })).filter(Boolean)
  return { params, body }
}

function lowerStatement(node, ctx) {
  const { text, path, scope, diagnostics } = ctx
  if (diagnostics.length) return null
  if (node.name === 'AssignStatement') {
    const p = parts(node)
    if (p.length !== 2 || p[0].name !== 'VariableName') return unsupported(ctx, node, 'this assignment')
    const name = raw(p[0], text); const value = lowerExpr(p[1], ctx)
    scope.add(name)
    return diagnostics.length ? null : { op: 'assign', name, value, source: at(text, node, path) }
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
    if (!['==', '!=', '<', '>='].includes(op)) return unsupported(ctx, node, `the '${op}' comparison`)
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
    if (Object.hasOwn(ctx.topConstants, name)) return { kind: 'literal', value: ctx.topConstants[name] }
    if (scope.has(name)) return { kind: 'name', name }
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
  if (node.name === 'ArrayExpression') { const items = parts(node).map((c) => lowerExpr(c, ctx)); return diagnostics.length ? null : { kind: 'list', items } }
  if (node.name === 'MemberExpression') return lowerMember(node, ctx)
  if (node.name === 'CallExpression') return lowerCall(node, ctx)
  return unsupported(ctx, node, describe(node))
}

function lowerMember(node, ctx) {
  const { text, manifest } = ctx
  const ps = kids(node)
  const hasBracket = ps.some((c) => c.name === '[')
  if (hasBracket) {
    const base = ps[0]; const key = ps.find((c) => c.name === 'String')
    const lastCont = lastContinuationReceiver(node, text, manifest)
    if (lastCont) return { kind: 'sdk-attribute', receiver: lastCont, call: 'cosmos.container.last_continuation' }
    if (!key) return unsupported(ctx, node, 'subscripts with a non-string key')
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

function lowerCall(node, ctx) {
  const { text, manifest, diagnostics } = ctx
  const callee = kids(node)[0]
  const args = argumentsOfWithText(kids(node).find((c) => c.name === 'ArgList'), text)
  if (callee.name === 'MemberExpression') {
    const mps = kids(callee); const propNode = mps.find((c) => c.name === 'PropertyName'); const base = mps[0]
    const property = raw(propNode, text)
    if (property === 'get') {
      if (args.keywords.length || args.positional.length < 1 || args.positional.length > 2) return unsupported(ctx, node, "this '.get()' call")
      const key = scalar(args.positional[0], text)
      if (typeof key !== 'string') return unsupported(ctx, args.positional[0], 'a .get() key that is not a string literal')
      const result = { kind: 'get', target: lowerExpr(base, ctx), key }
      if (args.positional[1]) result.default = lowerExpr(args.positional[1], ctx)
      return diagnostics.length ? null : result
    }
    if (base.name === 'VariableName') {
      const receiverType = manifest.receivers?.[raw(base, text)]
      if (receiverType) {
        const entry = lookupCall(receiverType, property)
        if (!entry) return unsupported(ctx, node, `'${property}' on '${raw(base, text)}'`)
        const boundArgs = bindArgs(entry, args, node, property, ctx)
        return diagnostics.length ? null : { kind: 'call-sdk', receiver: raw(base, text), call: entry.key, args: boundArgs }
      }
    }
    return unsupported(ctx, node, 'this method call')
  }
  if (callee.name === 'VariableName') {
    const name = raw(callee, text)
    if (BUILTINS.has(name) || name === 'embed') {
      if (args.keywords.length || args.positional.length !== 1) return unsupported(ctx, node, `'${name}(...)'`)
      return diagnostics.length ? null : { kind: 'builtin', name, args: [lowerExpr(args.positional[0], ctx)] }
    }
    if (name === 'next') {
      const [first, second] = args.positional
      const isIter = first?.name === 'CallExpression' && first.firstChild?.name === 'VariableName' && raw(first.firstChild, text) === 'iter'
      if (args.keywords.length || args.positional.length !== 2 || !isIter || second?.name !== 'None') return unsupported(ctx, node, "'next(...)' other than next(iter(x), None)")
      const iterArgs = argumentsOfWithText(kids(first).find((c) => c.name === 'ArgList'), text)
      if (iterArgs.keywords.length || iterArgs.positional.length !== 1) return unsupported(ctx, first, "'iter(...)'")
      return diagnostics.length ? null : { kind: 'builtin', name: 'next', args: [lowerExpr(iterArgs.positional[0], ctx)] }
    }
    const local = funcNode(ctx.tree, text, name)
    if (local) {
      if (args.keywords.length) return unsupported(ctx, node, `keyword arguments to '${name}(...)'`)
      ctx.enqueue(name)
      const callArgs = args.positional.map((a) => lowerExpr(a, ctx))
      return diagnostics.length ? null : { kind: 'call-local', name, args: callArgs }
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
    ctx.diagnostics.push({ code: 'SDK_ARGUMENT', message: `TypeError: ${label}() missing required argument '${missingParam}'`, ...at(ctx.text, node, ctx.path) })
    return null
  }
  return values
}

function unsupported(ctx, node, construct) {
  ctx.diagnostics.push({ code: 'DATA_UNSUPPORTED', message: `Not supported by the simulator: ${construct}`, ...at(ctx.text, node, ctx.path) })
  return null
}
