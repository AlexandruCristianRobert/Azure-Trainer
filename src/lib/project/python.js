import { parser } from '@lezer/python'

const diag = (code, message, path = 'app.py', text = '', from = 0) => {
  const prefix = text.slice(0, from)
  return { code, message, path, line: prefix.split('\n').length, column: from - prefix.lastIndexOf('\n') }
}
const children = node => { const result = []; for (let child = node.firstChild; child; child = child.nextSibling) result.push(child); return result }
const named = node => children(node).filter(child => !['(', ')', '[', ']', '{', '}', ',', ':', '.', '='].includes(child.name))
function stringLiteral(text) {
  if (!/^(\"|').*\1$/s.test(text)) return null
  try {
    if (text[0] === '\"') return JSON.parse(text)
    let body = ''
    for (let i = 1; i < text.length - 1; i++) {
      const char = text[i]
      if (char === '\\') {
        const next = text[++i]
        if (next === "'") body += "'"
        else if (next === '\"') body += '\\\"'
        else body += '\\\\' + next
      } else if (char === '\"') body += '\\\"'
      else body += char
    }
    return JSON.parse('\"' + body + '\"')
  } catch { return null }
}
function syntax(text, limit) {
  const tree = parser.parse(text); let count = 0; let error = null
  tree.iterate({ enter(node) { count++; if (!error && node.name === '⚠') error = node } })
  if (count > limit) return { tree, diagnostics: [diag('TOKEN_LIMIT', `Python source may contain at most ${limit} syntax nodes.`)] }
  if (error) return { tree, diagnostics: [diag('PYTHON_SYNTAX', 'Python source contains a syntax error.', 'app.py', text, error.from)] }
  return { tree, diagnostics: [] }
}
function readExpr(node, text, constants) {
  const raw = text.slice(node.from, node.to)
  if (node.name === 'String') { const value = stringLiteral(raw); return value === null ? null : { kind: 'literal', value } }
  if (node.name === 'Number' && /^\d+$/.test(raw)) return { kind: 'literal', value: Number(raw) }
  if (node.name === 'VariableName' && Object.hasOwn(constants, raw)) return { kind: 'literal', value: constants[raw] }
  if (node.name === 'CallExpression') {
    const c = children(node); const member = c.find(item => item.name === 'MemberExpression'); const args = c.find(item => item.name === 'ArgList')
    if (member && args && text.slice(member.from, member.to).replace(/\s/g, '') === 'os.environ.get') {
      const values = children(args).filter(item => !['(', ')', ','].includes(item.name))
      if (values.length === 2 && values.every(item => item.name === 'String')) {
        const key = stringLiteral(text.slice(values[0].from, values[0].to)); const defaultValue = stringLiteral(text.slice(values[1].from, values[1].to))
        if (key !== null && defaultValue !== null) return { kind: 'config', key, defaultValue }
      }
    }
    return null
  }
  return null
}
export function parsePythonProject(files, manifest = {}) {
  const text = files?.['app.py']; if (typeof text !== 'string') return { appSpec: null, diagnostics: [diag('MISSING_FILE', 'A required Python source file is missing.')] }
  const { tree, diagnostics } = syntax(text, manifest.maxTokens ?? 20_000); if (diagnostics.length) return { appSpec: null, diagnostics }
  const constants = {}; const infos = []; const out = []; let hasOsImport = false
  for (const statement of children(tree.topNode)) {
    if (['\n', '⚠', 'Comment'].includes(statement.name)) continue
    if (statement.name === 'ImportStatement' && /^import\s+os\s*$/.test(text.slice(statement.from, statement.to))) { hasOsImport = true; continue }
    if (statement.name === 'AssignStatement') {
      const parts = named(statement); const lhs = parts[0]; const rhs = parts.at(-1); const value = rhs && readExpr(rhs, text, constants)
      if (!lhs || lhs.name !== 'VariableName' || !value || value.kind !== 'literal') out.push(diag('PYTHON_UNSUPPORTED', 'Only top-level literal constants are supported.', 'app.py', text, statement.from))
      else constants[text.slice(lhs.from, lhs.to)] = value.value
      continue
    }
    if (statement.name === 'FunctionDefinition') {
      const parts = children(statement); const nameNode = parts.find(item => item.name === 'VariableName'); const name = nameNode && text.slice(nameNode.from, nameNode.to)
      if (name === 'info') infos.push(statement)
      else out.push(diag('PYTHON_UNSUPPORTED', 'Only the info() function is supported.', 'app.py', text, statement.from))
      continue
    }
    out.push(diag('PYTHON_UNSUPPORTED', 'This top-level Python statement is outside the supported teaching subset.', 'app.py', text, statement.from))
  }
  if (infos.length !== 1) out.push(diag('PYTHON_UNSUPPORTED', 'Exactly one info() function is required.'))
  if (out.length) return { appSpec: null, diagnostics: out }
  const fn = infos[0]; const fnChildren = children(fn); const params = fnChildren.find(item => item.name === 'ParamList'); const body = fnChildren.find(item => item.name === 'Body')
  if (!params || text.slice(params.from, params.to).replace(/[\s(),]/g, '') || !body) out.push(diag('PYTHON_UNSUPPORTED', 'info() must be parameterless.', 'app.py', text, fn.from))
  const statements = body ? children(body).filter(item => ![':', '\n', 'Comment'].includes(item.name)) : []
  const returns = statements.filter(item => item.name === 'ReturnStatement')
  if (statements.length !== 1 || returns.length !== 1) out.push(diag('PYTHON_UNSUPPORTED', 'info() must contain exactly one return dictionary.', 'app.py', text, body?.from ?? fn.from))
  const dict = returns[0] && children(returns[0]).find(item => item.name === 'DictionaryExpression')
  if (!dict) out.push(diag('PYTHON_UNSUPPORTED', 'info() must return a dictionary literal.', 'app.py', text, returns[0]?.from ?? fn.from))
  if (out.length) return { appSpec: null, diagnostics: out }
  const items = children(dict); const response = {}; let i = 0
  while (i < items.length) {
    if (items[i].name === '{' || items[i].name === ',' || items[i].name === '}') { i++; continue }
    const keyNode = items[i++]; const colon = items[i++]; const valueNode = items[i++]
    const key = keyNode?.name === 'String' ? stringLiteral(text.slice(keyNode.from, keyNode.to)) : null
    const value = valueNode && readExpr(valueNode, text, constants)
    if (key === null || colon?.name !== ':' || !value || Object.hasOwn(response, key)) out.push(diag('PYTHON_UNSUPPORTED', 'Return dictionary entries must use unique string keys and supported expressions.', 'app.py', text, keyNode?.from ?? dict.from))
    else response[key] = value
    if (items[i]?.name === ',') i++
  }
  for (const key of ['service', 'version', 'environment']) if (!Object.hasOwn(response, key)) out.push(diag('PYTHON_UNSUPPORTED', `The return dictionary must include ${key}.`, 'app.py', text, dict.from))
  if (Object.values(response).some(value => value.kind === 'config') && !hasOsImport) out.push(diag('PYTHON_UNSUPPORTED', 'Import os before reading environment configuration.', 'app.py', text, fn.from))
  if (!Number.isInteger(constants.PORT) || constants.PORT < 1 || constants.PORT > 65535) out.push(diag('PYTHON_UNSUPPORTED', 'PORT must be a valid integer literal.'))
  if (out.length) return { appSpec: null, diagnostics: out }
  return { appSpec: { language: 'python', service: response.service.value, version: response.version.value, listeningPort: constants.PORT, routes: [{ method: 'GET', path: '/api/info', response }] }, diagnostics: [] }
}

