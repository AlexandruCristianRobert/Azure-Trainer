import { parser } from '@lezer/python'
import { parseRetrievalSql } from './retrieval-sql.js'

const skip = new Set([':', ',', '(', ')', '[', ']', '{', '}', '\n', 'Comment'])
const kids = n => { const a = []; for (let c = n?.firstChild; c; c = c.nextSibling) a.push(c); return a }
const source = (n, t) => t.slice(n.from, n.to)
const loc = (t, n) => { const b = t.slice(0, n.from); return { path: 'app.py', line: b.split('\n').length, column: n.from - b.lastIndexOf('\n'), from: n.from, to: n.to } }
const parts = n => kids(n).filter(x => !skip.has(x.name))
const digest = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return `sha256:${(h >>> 0).toString(16).padStart(8, '0')}` }
function fn(tree, text, name) { return kids(tree.topNode).find(n => n.name === 'FunctionDefinition' && source(kids(n).find(x => x.name === 'VariableName'), text) === name) }
function body(n) { return kids(n).find(x => x.name === 'Body') }
function literal(n, text) { const s = source(n, text); if (n?.name === 'String') return s.slice(1, -1); if (n?.name === 'Number') return Number(s); if (n?.name === 'Boolean') return s === 'True'; return undefined }

export function parsePythonIntegration(files, manifest = {}) {
  const text = files?.['app.py']; if (typeof text !== 'string') return { appSpec: null, diagnostics: [{ code: 'MISSING_FILE', path: 'app.py', line: 1, column: 1 }] }
  const tree = parser.parse(text); let fault = null; tree.iterate({ enter: n => { if (n.name === '⚠') fault = n } })
  if (fault) return { appSpec: null, diagnostics: [{ code: 'PYTHON_SYNTAX', message: 'Python source contains a syntax error.', ...loc(text, fault) }] }
  const diagnostics = []; for (const path of ['server.py', 'training_clients.py', 'schema.sql']) if (files[path] !== manifest.fixedFiles?.[path]) diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: 'The supplied integration scaffold is fixed.', path, line: 1, column: 1 })
  const parsedSql = parseRetrievalSql(files?.['retrieval.sql']); diagnostics.push(...parsedSql.diagnostics)
  const answerFn = fn(tree, text, 'answer'); if (!answerFn) diagnostics.push({ code: 'PYTHON_UNSUPPORTED', message: 'Define answer(question).', path: 'app.py', line: 1, column: 1 })
  if (diagnostics.length) return { appSpec: null, diagnostics }
  const graph = { version: 1, nodes: [], roots: {}, bindings: {} }; const bound = new Map()
  const add = (op, node, more = {}) => { const id = `n${graph.nodes.length + 1}`; graph.nodes.push({ id, op, source: loc(text, node), ...more }); return id }
  const bind = (name, id) => { bound.set(name, id); graph.bindings[name] = id; return id }
  const expr = node => {
    if (!node) return null; const fixed = literal(node, text); if (fixed !== undefined) return add('literal', node, { value: fixed })
    if (node.name === 'VariableName') return bound.get(source(node, text)) ?? add('unbound', node, { name: source(node, text) })
    if (node.name === 'ArrayExpression') { try { return add('literal', node, { value: JSON.parse(source(node, text)) }) } catch { return add('expression', node, { expression: source(node, text) }) } }
    if (node.name === 'MemberExpression') { const method = source(node, text).replace(/\s/g, ''); if (method.endsWith('.embed')) return add('embed', node, { method }); if (method.endsWith('.execute')) return add('query', node, { method, querySpec: parsedSql.querySpec }); if (method.endsWith('.generate')) return add('answer', node, { method }); return add('expression', node, { expression: source(node, text) }) }
    if (node.name === 'Argument') return expr(parts(node).at(-1))
    if (node.name === 'DictionaryExpression') { parts(node).forEach((child, index) => { if (index % 2 === 1) expr(child) }); return add('dictionary', node, { sourceText: source(node, text) }) }
    if (node.name !== 'CallExpression') return add('expression', node, { expression: source(node, text) })
    const cs = kids(node); const callee = cs.find(x => x.name === 'MemberExpression') ?? cs.find(x => x.name === 'VariableName'); const args = parts(cs.find(x => x.name === 'ArgList')); const call = source(callee, text).replace(/\s/g, '')
    if (call === 'as_vector') return add('format-vector', node, { input: expr(args[0]) })
    if (call.endsWith('.embed')) return add('embed', node, { arguments: args.map(expr) })
    if (call.endsWith('.execute')) return add('query', node, { arguments: args.map(expr), querySpec: parsedSql.querySpec })
    if (call.endsWith('.generate')) return add('answer', node, { arguments: args.map(expr) })
    if (call.endsWith('.invoke')) { args.slice(1).forEach(expr); return expr(args[0]) }
    if (call === 'settings') return add('settings', node)
    return add('call', node, { call })
  }
  const params = kids(answerFn).find(x => x.name === 'ParamList'); const parameter = kids(params).find(x => x.name === 'VariableName'); const inputName = parameter && source(parameter, text); if (parameter) bind(inputName, add('input', parameter, { name: inputName }))
  const walk = block => parts(block).forEach(statement => {
    if (statement.name === 'AssignStatement') { const p = parts(statement); const id = expr(p.at(-1)); if (p[0]?.name === 'VariableName') bind(source(p[0], text), id); return }
    if (statement.name === 'IfStatement') { const condition = kids(statement).find(x => !['if', 'Body'].includes(x.name)); const raw = source(condition, text).replace(/\s/g, ''); if (raw === `not${inputName}`) graph.roots.validation = add('validate-question', condition, { input: bound.get(inputName) }); walk(body(statement)); return }
    if (statement.name === 'TryStatement') { walk(body(statement)); return }
    if (statement.name === 'ReturnStatement') graph.roots.response = add('response', statement, { value: expr(kids(statement).find(x => x.name !== 'return')) })
  })
  walk(body(answerFn)); graph.roots.answer = graph.roots.response
  const constants = Object.fromEntries(kids(tree.topNode).filter(n => n.name === 'AssignStatement').map(n => parts(n)).filter(p => p[0]?.name === 'VariableName').map(p => [source(p[0], text), literal(p.at(-1), text)]))
  return { appSpec: { language: 'python', service: constants.SERVICE_NAME, version: constants.SERVICE_VERSION, listeningPort: constants.PORT, routes: [{ method: 'GET', path: '/api/info' }, { method: 'POST', path: '/api/ask', response: { kind: 'integration' } }], integration: { adapter: 'integration-fixture-v1', adapterDigest: digest(files['training_clients.py']), querySpec: parsedSql.querySpec, graph } }, diagnostics: [] }
}
