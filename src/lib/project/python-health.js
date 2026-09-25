import { parser } from '@lezer/python'

const kids = node => { const out = []; for (let child = node?.firstChild; child; child = child.nextSibling) out.push(child); return out }
const raw = (node, text) => text.slice(node.from, node.to)
const ignored = new Set(['(', ')', '[', ']', '{', '}', ',', ':', '\n', 'Comment', 'return', 'if', 'else', 'and', 'or', 'not'])
const parts = node => kids(node).filter(child => !ignored.has(child.name))
const at = (text, node) => { const before = text.slice(0, node?.from ?? 0); return { path: 'app.py', line: before.split('\n').length, column: (node?.from ?? 0) - before.lastIndexOf('\n') } }
const diagnostic = (text, node, message, code = 'PYTHON_UNSUPPORTED') => ({ code, message, ...at(text, node) })
const digest = source => { let hash = 2166136261; for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `sha256:${(hash >>> 0).toString(16)}` }
const signalNames = new Set(['initialized', 'accepting_requests', 'postgres_available', 'ai_available'])

function literal(node, text) {
  if (node?.name === 'String') {
    const value = raw(node, text)
    try { return JSON.parse(value[0] === "'" ? `"${value.slice(1, -1).replaceAll('"', '\\"')}"` : value) } catch { return value.slice(1, -1) }
  }
  if (node?.name === 'Number' && /^\d+(?:\.\d+)?$/.test(raw(node, text))) return Number(raw(node, text))
  if (node?.name === 'Boolean') return raw(node, text) === 'True'
  if (node?.name === 'None') return null
  return undefined
}

export function parsePythonHealth(files, manifest = {}) {
  const text = files?.['app.py']; const diagnostics = []
  if (typeof text !== 'string') return { healthSpec: null, diagnostics: [{ code: 'MISSING_FILE', message: 'A required Python source file is missing.', path: 'app.py', line: 1, column: 1 }] }
  const tree = parser.parse(text); let syntaxError = null; let count = 0
  tree.iterate({ enter(node) { count++; if (!syntaxError && node.name === '⚠') syntaxError = node } })
  if (count > (manifest.maxTokens ?? 20_000)) return { healthSpec: null, diagnostics: [diagnostic(text, null, 'Python source exceeds the supported syntax limit.', 'TOKEN_LIMIT')] }
  if (syntaxError) return { healthSpec: null, diagnostics: [diagnostic(text, syntaxError, 'Python source contains a syntax error.', 'PYTHON_SYNTAX')] }
  if (files['training_health.py'] !== manifest.fixedFiles?.['training_health.py']) diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: 'The supplied health fixture adapter is fixed.', path: 'training_health.py', line: 1, column: 1 })

  const functions = new Map()
  for (const statement of kids(tree.topNode)) {
    if (statement.name !== 'FunctionDefinition') continue
    const nameNode = kids(statement).find(child => child.name === 'VariableName')
    const name = nameNode && raw(nameNode, text)
    if (['startup', 'ready', 'live'].includes(name)) {
      if (functions.has(name)) diagnostics.push(diagnostic(text, statement, `Define ${name}() only once.`))
      else functions.set(name, statement)
    }
  }
  let unsupported = null
  const fail = (node, message) => { unsupported ??= diagnostic(text, node, message); return null }
  const expression = node => {
    if (!node || unsupported) return null
    if (node.name === 'ParenthesizedExpression') {
      const values = parts(node)
      return values.length === 1 ? expression(values[0]) : fail(node, 'Parentheses must contain one supported health expression.')
    }
    if (node.name === 'Boolean') return { kind: 'constant', value: raw(node, text) === 'True' }
    if (node.name === 'CallExpression') {
      const callee = kids(node).find(child => child.name === 'VariableName')
      const name = callee && raw(callee, text)
      const args = kids(node).find(child => child.name === 'ArgList')
      if (!signalNames.has(name) || parts(args).length) return fail(node, 'Health expressions may call only the four parameterless training health signals.')
      return { kind: 'signal', name }
    }
    if (node.name === 'UnaryExpression') {
      const operand = kids(node).find(child => child.name !== 'not')
      if (!kids(node).some(child => child.name === 'not')) return fail(node, 'Only not is supported in health Boolean expressions.')
      return { kind: 'not', operand: expression(operand) }
    }
    if (node.name === 'BinaryExpression') {
      const children = kids(node); const operator = children.find(child => ['and', 'or'].includes(child.name))
      if (!operator) return fail(node, 'Health Boolean expressions support and, or and not only.')
      const operands = children.filter(child => child !== operator && !ignored.has(child.name)).map(expression)
      if (operands.length < 2 || operands.some(item => !item)) return fail(node, 'A health Boolean combination needs supported operands.')
      return { kind: operator.name, operands }
    }
    if (node.name === 'ConditionalExpression') {
      const children = kids(node); const ifAt = children.findIndex(child => child.name === 'if'); const elseAt = children.findIndex(child => child.name === 'else')
      const thenNode = children[0]; const conditionNode = children.slice(ifAt + 1, elseAt).find(child => !ignored.has(child.name)); const elseNode = children.slice(elseAt + 1).find(child => !ignored.has(child.name))
      const thenValue = literal(thenNode, text); const elseValue = literal(elseNode, text)
      if (!Number.isInteger(thenValue) || thenValue < 100 || thenValue > 599 || !Number.isInteger(elseValue) || elseValue < 100 || elseValue > 599) return fail(node, 'Health status branches must be integer HTTP statuses from 100 through 599.')
      const condition = expression(conditionNode)
      return condition ? { kind: 'conditional', condition, then: thenValue, else: elseValue } : null
    }
    const value = literal(node, text)
    if (value !== undefined) return { kind: 'constant', value }
    return fail(node, `Unsupported health expression '${node.name}'.`)
  }
  const bodyValue = node => {
    if (node?.name === 'DictionaryExpression') {
      const nodes = parts(node); const body = {}
      for (let index = 0; index < nodes.length; index += 2) {
        const key = literal(nodes[index], text); const value = literal(nodes[index + 1], text)
        if (typeof key !== 'string' || value === undefined || Object.hasOwn(body, key)) return null
        body[key] = value
      }
      return body
    }
    return null
  }
  const endpoints = []
  for (const [name, path, routeName] of [['startup', '/health/startup', 'startup'], ['ready', '/health/ready', 'readiness'], ['live', '/health/live', 'liveness']]) {
    const fn = functions.get(name)
    if (!fn) { diagnostics.push(diagnostic(text, null, `Define ${name}() for the fixed health adapter.`)); continue }
    const fnParts = kids(fn); const parameters = fnParts.find(child => child.name === 'ParamList')
    if (parts(parameters).length) diagnostics.push(diagnostic(text, parameters, `${name}() must not accept parameters.`))
    const body = fnParts.find(child => child.name === 'Body')
    const statements = kids(body).filter(child => ![':', '\n', 'Comment'].includes(child.name))
    if (statements.length !== 1 || statements[0].name !== 'ReturnStatement') {
      diagnostics.push(diagnostic(text, statements[0] ?? body, `${name}() must contain only one direct return mapping.`)); continue
    }
    const dictionary = kids(statements[0]).find(child => child.name === 'DictionaryExpression'); const entries = parts(dictionary)
    const statusKey = entries.findIndex(child => literal(child, text) === 'status'); const bodyKey = entries.findIndex(child => literal(child, text) === 'body')
    if (entries.length !== 4 || statusKey < 0 || bodyKey < 0) { diagnostics.push(diagnostic(text, dictionary ?? statements[0], `${name}() must return exactly status and body.`)); continue }
    const statusExpression = expression(entries[statusKey + 1]); const responseBody = bodyValue(entries[bodyKey + 1])
    if (unsupported) { diagnostics.push(unsupported); unsupported = null; continue }
    if (statusExpression?.kind === 'constant' && (!Number.isInteger(statusExpression.value) || statusExpression.value < 100 || statusExpression.value > 599)) {
      diagnostics.push(diagnostic(text, entries[statusKey + 1], 'Health response status constants must be integers from 100 through 599.')); continue
    }
    if (!statusExpression || !responseBody || responseBody.check !== routeName) { diagnostics.push(diagnostic(text, dictionary, `${name}() must provide a supported literal body with check=${routeName}.`)); continue }
    endpoints.push({ path, statusExpression, body: responseBody })
  }
  if (diagnostics.length) return { healthSpec: null, diagnostics }
  return { healthSpec: { version: 1, endpoints, helperDigest: digest(manifest.fixedFiles['training_health.py']) }, diagnostics: [] }
}
