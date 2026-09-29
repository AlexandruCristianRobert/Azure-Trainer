import { parser } from '@lezer/python'
import { parseRetrievalSql } from './retrieval-sql.js'

const ignored = new Set(['(', ')', '[', ']', '{', '}', ',', ':', 'AssignOp', 'for', 'in', 'if', 'try', 'except', 'return', '\n', 'Comment'])
const kids = n => { const r = []; for (let c = n?.firstChild; c; c = c.nextSibling) r.push(c); return r }
const parts = n => kids(n).filter(n => !ignored.has(n.name))
const raw = (n, text) => text.slice(n.from, n.to)
const at = (text, n, path = 'app.py') => { const before = text.slice(0, n.from); return { path, line: before.split('\n').length, column: n.from - before.lastIndexOf('\n'), from: n.from, to: n.to } }
const error = (text, n, message) => ({ code: 'PYTHON_UNSUPPORTED', message, ...at(text, n) })
const digest = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return `sha256:${(h >>> 0).toString(16)}` }
const fn = (tree, text, name) => kids(tree.topNode).find(n => n.name === 'FunctionDefinition' && raw(kids(n).find(x => x.name === 'VariableName'), text) === name)
const body = n => kids(n).find(n => n.name === 'Body')
function scalar(n, text) { if (n?.name === 'String') return raw(n, text).slice(1, -1); if (n?.name === 'Number') return Number(raw(n, text)); if (n?.name === 'Boolean') return raw(n, text) === 'True'; return undefined }

export function parsePythonIntegration(files, manifest = {}) {
  const text = files?.['app.py']; if (typeof text !== 'string') return { appSpec: null, diagnostics: [{ code: 'MISSING_FILE', path: 'app.py', line: 1, column: 1 }] }
  const tree = parser.parse(text); let bad = null; tree.iterate({ enter(n) { if (n.name === '⚠') bad = n } }); if (bad) return { appSpec: null, diagnostics: [{ code: 'PYTHON_SYNTAX', message: 'Python source contains a syntax error.', ...at(text, bad) }] }
  const diagnostics = []; for (const path of ['server.py', 'training_clients.py', 'schema.sql']) if ((path !== 'schema.sql' || Object.hasOwn(files, path)) && files[path] !== manifest.fixedFiles?.[path]) diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: 'Fixed integration scaffold modified.', path, line: 1, column: 1 })
  const sql = parseRetrievalSql(files?.['retrieval.sql']); diagnostics.push(...sql.diagnostics); const answer = fn(tree, text, 'answer'); if (!answer) diagnostics.push({ code: 'PYTHON_UNSUPPORTED', message: 'Define answer(question).', path: 'app.py', line: 1, column: 1 }); if (diagnostics.length) return { appSpec: null, diagnostics }
  const assignments = kids(tree.topNode).filter(n => n.name === 'AssignStatement').map(n => parts(n)).filter(p => p[0]?.name === 'VariableName')
  const topConstants = Object.fromEntries(assignments.filter(p => scalar(p.at(-1), text) !== undefined).map(p => [raw(p[0], text), scalar(p.at(-1), text)]))
  if (manifest.releaseVersion) {
    const versions = assignments.filter(p => raw(p[0], text) === 'SERVICE_VERSION')
    if (versions.length !== 1 || typeof scalar(versions[0]?.at(-1), text) !== 'string') return { appSpec: null, diagnostics: [error(text, versions[0]?.[0] ?? tree.topNode, 'SERVICE_VERSION must be a unique string literal.')] }
  }
  const graph = { version: 1, nodes: [], roots: {}, bindings: {} }; const scope = new Map(); let unsupported = null
  const settingsFn = fn(tree, text, 'settings'); const settingsDictionary = settingsFn && kids(body(settingsFn)).find(n => n.name === 'ReturnStatement') && kids(kids(body(settingsFn)).find(n => n.name === 'ReturnStatement')).find(n => n.name === 'DictionaryExpression')
  const add = (op, n, fields = {}) => { const id = `n${graph.nodes.length + 1}`; graph.nodes.push({ id, op, source: at(text, n), ...fields }); return id }
  const bind = (name, id, n) => { const binding = add('binding', n, { name, value: id }); scope.set(name, binding); graph.bindings[name] = binding; return binding }
  const lookup = (n, name) => { const id = scope.get(name); if (!id && !unsupported) unsupported = error(text, n, `Unknown binding '${name}'.`); return id }
  const argumentsOf = node => { const values = kids(node).filter(x => !['(', ')', ','].includes(x.name)); const positional = []; const keywords = []; for (let i = 0; i < values.length; i++) { if (values[i + 1]?.name === 'AssignOp') { keywords.push([raw(values[i], text), values[i + 2]]); i += 2 } else positional.push(values[i]) } return { positional, keywords } }
  const dict = n => { const p = parts(n); const entries = {}; for (let i = 0; i < p.length; i += 2) { const key = scalar(p[i], text); if (typeof key !== 'string') { unsupported ??= error(text, p[i], 'Dictionary keys must be string literals.'); return null } entries[key] = lower(p[i + 1]) } return add('dictionary', n, { entries }) }
  const member = n => { const p = kids(n); const base = p.find(x => x.name === 'VariableName'); const property = p.find(x => x.name === 'PropertyName'); if (base && property) return { base: raw(base, text), property: raw(property, text) }; const key = p.find(x => x.name === 'String'); if (base && key) return { base: raw(base, text), key: scalar(key, text) }; return null }
  const lower = n => {
    if (!n || unsupported) return null; const fixed = scalar(n, text); if (fixed !== undefined) return add('literal', n, { value: fixed })
    if (n.name === 'VariableName') { const name = raw(n, text); return scope.has(name) ? lookup(n, name) : Object.hasOwn(topConstants, name) ? add('literal', n, { value: topConstants[name] }) : lookup(n, name) }
    if (n.name === 'DictionaryExpression') return dict(n)
    if (n.name === 'TupleExpression') return add('tuple', n, { values: parts(n).map(lower) })
    if (n.name === 'ArrayExpression') return add('literal', n, { value: parts(n).map(x => scalar(x, text)) })
    if (n.name === 'ArrayComprehensionExpression') { const p = kids(n); const iterable = p.filter(x => x.name === 'VariableName').at(-1); const local = p.filter(x => x.name === 'VariableName')[0]; const item = p.find(x => x.name === 'DictionaryExpression'); if (!iterable || !local) { unsupported = error(text, n, 'Comprehension must iterate a bound row collection.'); return null } if (item) { const entries = {}; const values = parts(item); for (let index = 0; index < values.length; index += 2) { const key = scalar(values[index], text); const selected = member(values[index + 1]); if (!key || selected?.base !== raw(local, text) || !selected.key) { unsupported = error(text, values[index + 1], 'Context rows must select a named field from each row.'); return null } entries[key] = selected.key } return add('context-rows', n, { rows: lookup(iterable, raw(iterable, text)), fields: entries }) } const selected = member(p.find(x => x.name === 'MemberExpression')); if (selected?.base !== raw(local, text) || !selected.key) { unsupported = error(text, n, 'Source IDs must select a named field from each row.'); return null } return add('source-ids', n, { rows: lookup(iterable, raw(iterable, text)), field: selected.key }) }
    if (n.name === 'MemberExpression') { const m = member(n); if (m?.key) return add('config', n, { object: lookup(n, m.base), key: m.key }); if (m) return add('invoke', n, { target: lookup(n, m.base), method: m.property, args: { positional: [], keywords: {} }, resultType: 'method' }); unsupported = error(text, n, 'Unsupported member expression.'); return null }
    if (n.name !== 'CallExpression') { unsupported = error(text, n, `Unsupported expression '${n.name}'.`); return null }
    const cs = kids(n); const callee = cs.find(x => x.name === 'MemberExpression') ?? cs.find(x => x.name === 'VariableName'); const args = argumentsOf(cs.find(x => x.name === 'ArgList')); const m = callee?.name === 'MemberExpression' ? member(callee) : null; const name = m ? m.property : raw(callee, text)
    if (!m && name === 'format_answer' && manifest.releaseVersion) {
      const helpers = kids(tree.topNode).filter(node => node.name === 'FunctionDefinition' && raw(kids(node).find(child => child.name === 'VariableName'), text) === 'format_answer')
      const helper = helpers[0]; const parameters = kids(helper).find(node => node.name === 'ParamList')
      const names = parts(parameters).map(node => raw(node, text))
      const statements = parts(body(helper)); const returned = statements[0] && parts(statements[0])[0]
      if (helpers.length !== 1 || names.join(',') !== 'answer_text,rows,environment' || statements.length !== 1 || statements[0].name !== 'ReturnStatement' || returned?.name !== 'DictionaryExpression'
        || args.positional.length !== 3 || args.keywords.length) {
        unsupported = error(text, helper ?? n, 'format_answer must accept (answer_text, rows, environment), return one dictionary, and receive three positional arguments.'); return null
      }
      const references = args.positional.map(lower)
      if (unsupported) return null
      const outer = new Map(scope)
      scope.clear(); names.forEach((name, index) => scope.set(name, references[index]))
      // The helper is a bounded dictionary projection, never a function executor.
      let invalid = null
      returned.cursor().iterate(node => { if (node.name === 'CallExpression') invalid ??= node.node })
      if (invalid) unsupported = error(text, invalid, 'Calls inside format_answer are outside the supported dictionary projection.')
      const result = lower(returned)
      scope.clear(); for (const [name, reference] of outer) scope.set(name, reference)
      return result
    }
    if (m?.property === 'strip') return add('strip', n, { input: lookup(callee, m.base) })
    if (name === 'settings') {
      if (!settingsDictionary) { unsupported = error(text, n, 'settings() must return supported environment bindings.'); return null }
      const entries = {}; const values = parts(settingsDictionary)
      for (let index = 0; index < values.length; index += 2) { const key = scalar(values[index], text); const item = values[index + 1]; const memberCall = item?.name === 'CallExpression' && raw(kids(item).find(x => x.name === 'MemberExpression'), text).replace(/\s/g, '') === 'os.environ.get'; const envArgs = memberCall && argumentsOf(kids(item).find(x => x.name === 'ArgList')); if (!key || !envArgs || envArgs.positional.length !== 2) { unsupported = error(text, item, 'settings() values must be os.environ.get(key, default).'); return null } entries[key] = add('config', item, { environment: scalar(envArgs.positional[0], text), defaultValue: scalar(envArgs.positional[1], text) }) }
      return add('constructor', n, { class: 'settings', args: entries })
    }
    if (['RetryPolicy', 'RequestBudget', 'EmbeddingClient', 'AnswerClient', 'PgClient'].includes(name)) return add('constructor', n, { class: name, args: Object.fromEntries(args.keywords.map(([k, v]) => [k, lower(v)])) })
    if (name === 'as_vector') return add('vector-format', n, { input: lower(args.positional[0]) })
    if (m?.property === 'invoke') { const target = lower(args.positional[0]); const keywords = Object.fromEntries(args.keywords.map(([k, v]) => [k, lower(v)])); return add('invoke', n, { target, policy: lower(args.positional[1]), method: graph.nodes.find(x => x.id === target)?.method, args: { positional: [], keywords }, resultType: graph.nodes.find(x => x.id === target)?.method }) }
    unsupported = error(text, n, `Unsupported call '${name}'.`); return null
  }
  for (const statement of kids(tree.topNode).filter(n => n.name === 'AssignStatement')) { const p = parts(statement); if (p[0]?.name === 'VariableName' && ['SQL', 'QUERY_SOURCE'].includes(raw(p[0], text))) bind(raw(p[0], text), add('literal', p.at(-1), { value: 'retrieval.sql' }), p[0]) }
  const params = kids(answer).find(n => n.name === 'ParamList'); const input = kids(params).find(n => n.name === 'VariableName'); const inputName = raw(input, text); bind(inputName, add('input', input, { name: inputName }), input)
  const lowerBlock = block => { const sequence = []; for (const statement of parts(block)) { if (unsupported) break
    if (statement.name === 'AssignStatement') { const p = parts(statement); const name = raw(p[0], text); sequence.push(bind(name, lower(p.at(-1)), p[0])); continue }
    if (statement.name === 'IfStatement') { const condition = kids(statement).find(n => !['if', 'Body'].includes(n.name)); if (condition?.name !== 'UnaryExpression' || kids(condition).find(n => n.name === 'not') === undefined) { unsupported = error(text, condition, 'Only not <bound value> guards are supported.'); break } const variable = kids(condition).find(n => n.name === 'VariableName'); if (!variable) { unsupported = error(text, condition, 'Guard must reference a bound value.'); break } const then = lowerBlock(body(statement)); sequence.push(add('guard', condition, { condition: { kind: 'not', input: lookup(variable, raw(variable, text)) }, then, otherwise: null })); continue }
    if (statement.name === 'TryStatement') { const blocks = kids(statement).filter(n => n.name === 'Body'); const attempt = lowerBlock(blocks[0]); const caughtName = kids(statement).filter(n => n.name === 'VariableName').at(-1); const errorValue = add('catch-error', caughtName, { class: 'DependencyError' }); if (caughtName) bind(raw(caughtName, text), errorValue, caughtName); const caught = lowerBlock(blocks[1]); sequence.push(add('catch', statement, { attempt, error: errorValue, body: caught })); continue }
    if (statement.name === 'ReturnStatement') { sequence.push(add('return', statement, { value: lower(kids(statement).find(n => n.name !== 'return')) })); continue }
    unsupported = error(text, statement, `Unsupported statement '${statement.name}'.`) }
    return sequence }
  graph.roots.answer = lowerBlock(body(answer)); if (unsupported) return { appSpec: null, diagnostics: [unsupported] }
  const constants = topConstants
  const responseBindings = {}
  if (manifest.releaseVersion) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]))
    const unbind = reference => { let node = nodes.get(reference); while (node?.op === 'binding') node = nodes.get(node.value); return node }
    const generatesAnswer = graph.nodes.some(node => node.op === 'invoke' && node.resultType === 'generate')
    for (const returned of graph.nodes.filter(node => node.op === 'return')) {
      const envelope = unbind(returned.value); const response = unbind(envelope?.entries?.body)
      if (response?.op !== 'dictionary' || !Object.hasOwn(response.entries, 'answer')) continue
      const answerValue = unbind(response.entries.answer); const sources = unbind(response.entries.sources)
      const emptyRetrieval = answerValue?.op === 'literal' && answerValue.value === 'No matching documents.' && sources?.op === 'literal' && Array.isArray(sources.value) && sources.value.length === 0
      const generated = answerValue?.op === 'config' && answerValue.key === 'answer' && unbind(answerValue.object)?.resultType === 'generate'
      const rowIds = sources?.op === 'source-ids' && sources.field === 'id' && unbind(sources.rows)?.resultType === 'execute'
      if (generatesAnswer && !emptyRetrieval && (!generated || !rowIds)) return { appSpec: null, diagnostics: [{ code: 'PYTHON_UNSUPPORTED', message: 'Successful release answers must retain the generated answer and retrieved row IDs.', ...response.source }] }
      const release = unbind(response.entries.release)
      if (release && (release.op !== 'literal' || typeof release.value !== 'string')) return { appSpec: null, diagnostics: [{ code: 'PYTHON_UNSUPPORTED', message: 'The release response must resolve to a captured string version binding.', ...release.source }] }
      if (release) responseBindings.release = release.value
    }
  }
  let infoResponse
  if (manifest.releaseVersion) {
    const info = fn(tree, text, 'info'); const statements = parts(body(info)); const returned = statements[0] && parts(statements[0])[0]
    if (statements.length !== 1 || statements[0]?.name !== 'ReturnStatement' || returned?.name !== 'DictionaryExpression') return { appSpec: null, diagnostics: [error(text, info ?? tree.topNode, 'info() must return the supported service, version, and environment dictionary.')] }
    infoResponse = {}; const entries = parts(returned)
    for (let index = 0; index < entries.length; index += 2) {
      const key = scalar(entries[index], text); const expression = entries[index + 1]; const name = expression?.name === 'VariableName' && raw(expression, text)
      if (['service', 'version'].includes(key) && name && typeof constants[name] === 'string') infoResponse[key] = { kind: 'literal', value: constants[name] }
      else if (key === 'environment' && expression?.name === 'CallExpression' && raw(kids(expression).find(node => node.name === 'MemberExpression'), text).replace(/\s/g, '') === 'os.environ.get') {
        const args = argumentsOf(kids(expression).find(node => node.name === 'ArgList'))
        const values = args.positional.map(node => scalar(node, text))
        if (args.keywords.length || values.length !== 2 || !values.every(value => typeof value === 'string')) return { appSpec: null, diagnostics: [error(text, expression, 'info() environment must use os.environ.get(key, default) with string arguments.')] }
        infoResponse[key] = { kind: 'config', key: values[0], defaultValue: values[1] }
      } else return { appSpec: null, diagnostics: [error(text, expression ?? returned, 'Unsupported info() response binding.')] }
    }
    if (Object.keys(infoResponse).sort().join(',') !== 'environment,service,version') return { appSpec: null, diagnostics: [error(text, returned, 'info() requires service, version, and environment.')] }
  }
  return { appSpec: { language: 'python', service: constants.SERVICE_NAME, version: constants.SERVICE_VERSION, listeningPort: constants.PORT, routes: [{ method: 'GET', path: '/api/info', ...(infoResponse ? { response: infoResponse } : {}) }, { method: 'POST', path: '/api/ask', response: { kind: 'integration' } }], integration: { adapter: 'integration-fixture-v1', adapterDigest: digest(files['training_clients.py']), querySpec: sql.querySpec, graph }, ...(manifest.releaseVersion ? { release: { version: manifest.releaseVersion, responseBindings } } : {}) }, diagnostics: [] }
}
