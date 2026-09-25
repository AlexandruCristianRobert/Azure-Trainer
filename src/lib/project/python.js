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
function parseDictionary(dict, text, resolveValue) {
  const nodes = children(dict); const result = {}; let index = 0
  while (index < nodes.length) {
    if (['{', '}', ','].includes(nodes[index].name)) { index++; continue }
    const keyNode = nodes[index++]; const colon = nodes[index++]; const valueNode = nodes[index++]
    const key = keyNode?.name === 'String' ? stringLiteral(text.slice(keyNode.from, keyNode.to)) : null
    const value = valueNode && resolveValue(valueNode)
    if (key === null || colon?.name !== ':' || !value || Object.hasOwn(result, key)) return null
    result[key] = value
  }
  return result
}
function parseAssistantProject(files, manifest, text, tree) {
  const imports = new Set(); const functions = {}; const constants = {}; const assigned = new Set(); const diagnostics = []
  for (const statement of children(tree.topNode)) {
    if (['\n', 'Comment'].includes(statement.name)) continue
    if (statement.name === 'ImportStatement') {
      const source = text.slice(statement.from, statement.to).trim()
      if (['import os', 'import json', 'from pathlib import Path', 'import training_runtime'].includes(source)) imports.add(source)
      else diagnostics.push(diag('PYTHON_UNSUPPORTED', 'This import is outside the supported Python source.', 'app.py', text, statement.from))
      continue
    }
    if (statement.name === 'FunctionDefinition') {
      const parts = children(statement); const nameNode = parts.find(item => item.name === 'VariableName'); const name = nameNode && text.slice(nameNode.from, nameNode.to)
      if (!['settings', 'answer', 'info'].includes(name)) diagnostics.push(diag('PYTHON_UNSUPPORTED', 'Only settings(), answer(question), and info() functions are supported.', 'app.py', text, statement.from))
      else if (functions[name]) diagnostics.push(diag('PYTHON_UNSUPPORTED', `Define ${name}() only once.`, 'app.py', text, statement.from))
      else functions[name] = { node: statement, body: parts.find(item => item.name === 'Body'), params: parts.find(item => item.name === 'ParamList') }
      continue
    }
    if (statement.name === 'AssignStatement') {
      const parts = named(statement); const lhs = parts[0]; const rhs = parts.at(-1); const name = lhs?.name === 'VariableName' ? text.slice(lhs.from, lhs.to) : ''
      const value = rhs && readExpr(rhs, text, constants)
      if (!['SERVICE_NAME', 'SERVICE_VERSION', 'PORT'].includes(name) || assigned.has(name) || !value || value.kind !== 'literal') diagnostics.push(diag('PYTHON_UNSUPPORTED', 'Only unique literal service, version, and port constants are supported.', 'app.py', text, statement.from))
      else { assigned.add(name); constants[name] = value.value }
      continue
    }
    diagnostics.push(diag('PYTHON_UNSUPPORTED', 'This top-level Python statement is outside the supported teaching subset.', 'app.py', text, statement.from))
  }
  if (['import os', 'import json', 'from pathlib import Path', 'import training_runtime'].some(value => !imports.has(value))) diagnostics.push(diag('PYTHON_UNSUPPORTED', 'Import the supported settings and assistant helpers.', 'app.py', text))
  if (typeof constants.SERVICE_NAME !== 'string' || typeof constants.SERVICE_VERSION !== 'string')
    diagnostics.push(diag('PYTHON_UNSUPPORTED', 'Service name and version must be text literals.', 'app.py', text))
  if (!functions.settings || !functions.answer || !functions.info) diagnostics.push(diag('PYTHON_UNSUPPORTED', 'Define settings(), answer(question), and info().', 'app.py', text))
  if (functions.settings?.params && text.slice(functions.settings.params.from, functions.settings.params.to).replace(/[\s(),]/g, '') !== '') diagnostics.push(diag('PYTHON_UNSUPPORTED', 'settings() must be parameterless.', 'app.py', text, functions.settings.params.from))
  if (functions.answer?.params && text.slice(functions.answer.params.from, functions.answer.params.to).replace(/[\s(),]/g, '') !== 'question') diagnostics.push(diag('PYTHON_UNSUPPORTED', 'answer() must accept only question.', 'app.py', text, functions.answer.params.from))
  if (functions.info?.params && text.slice(functions.info.params.from, functions.info.params.to).replace(/[\s(),]/g, '') !== '') diagnostics.push(diag('PYTHON_UNSUPPORTED', 'info() must be parameterless.', 'app.py', text, functions.info.params.from))

  const expectedSettings = ['environment', 'ai_endpoint', 'answer_deployment', 'embedding_deployment', 'pg_host', 'pg_database', 'pg_user', 'pg_password', 'collection', 'display_name', 'response_prefix']
  const settingStatements = functions.settings?.body ? children(functions.settings.body).filter(item => ![':', '\n', 'Comment'].includes(item.name)) : []
  const assign = settingStatements[0]; const assignParts = assign ? named(assign) : []; const local = assignParts[0]?.name === 'VariableName' ? text.slice(assignParts[0].from, assignParts[0].to) : ''
  const assignmentExpr = assignParts.at(-1)
  const mountedPath = assignmentExpr && /^json\.loads\(Path\(["'](\/etc\/assistant\/settings\.json)["']\)\.read_text\(\)\)$/.exec(text.slice(assignmentExpr.from, assignmentExpr.to).replace(/\s/g, ''))?.[1]
  const returnNode = settingStatements[1]; const dict = returnNode && children(returnNode).find(item => item.name === 'DictionaryExpression')
  const settingValues = (dict && parseDictionary(dict, text, node => {
    const config = readExpr(node, text, constants)
    if (config?.kind === 'config') return config
    if (node.name === 'MemberExpression') {
      const expression = new RegExp(`^${local}\\s*\\[\\s*(["'])([a-z_]+)\\1\\s*\\]$`).exec(text.slice(node.from, node.to))
      if (local === 'display' && mountedPath && expression) return { kind: 'file-json', path: mountedPath, key: expression[2] }
    }
    return null
  })) ?? {}
  if (settingStatements.length !== 2 || settingStatements[0]?.name !== 'AssignStatement' || local !== 'display' || !mountedPath
    || Object.keys(settingValues).sort().join(',') !== [...expectedSettings].sort().join(',')
    || Object.values(settingValues).some(value => !value) || settingValues.display_name?.kind !== 'file-json' || settingValues.display_name.key !== 'display_name'
    || settingValues.response_prefix?.kind !== 'file-json' || settingValues.response_prefix.key !== 'response_prefix'
    || expectedSettings.slice(0, 9).some(key => settingValues[key]?.kind !== 'config')) {
    diagnostics.push(diag('PYTHON_UNSUPPORTED', 'settings() must project the supported environment lookups and mounted display settings.', 'app.py', text, functions.settings?.body?.from ?? 0))
  }
  const answerBody = functions.answer?.body ? children(functions.answer.body).filter(item => ![':', '\n', 'Comment'].includes(item.name)) : []
  const answerReturns = answerBody.filter(item => item.name === 'ReturnStatement')
  if (answerBody.length !== 1 || answerReturns.length !== 1 || !/^return\s+training_runtime\.answer\(question,\s*settings\(\)\)$/.test(text.slice(answerReturns[0]?.from ?? 0, answerReturns[0]?.to ?? 0))) diagnostics.push(diag('PYTHON_UNSUPPORTED', 'answer(question) must call the supplied training_runtime.answer helper.', 'app.py', text, functions.answer?.body?.from ?? 0))
  const infoBody = functions.info?.body ? children(functions.info.body).filter(item => ![':', '\n', 'Comment'].includes(item.name)) : []
  const infoReturns = infoBody.filter(item => item.name === 'ReturnStatement')
  const infoDict = infoReturns.length === 1 && children(infoReturns[0]).find(item => item.name === 'DictionaryExpression')
  const infoValues = infoDict && parseDictionary(infoDict, text, node => readExpr(node, text, constants))
  if (infoBody.length !== 1 || !infoValues || Object.keys(infoValues).sort().join(',') !== 'environment,service,version' || infoValues.service?.kind !== 'literal' || infoValues.version?.kind !== 'literal' || infoValues.environment?.kind !== 'config') diagnostics.push(diag('PYTHON_UNSUPPORTED', 'info() must return the supported service, version, and environment fields.', 'app.py', text, functions.info?.body?.from ?? 0))
  if (files['training_runtime.py'] !== manifest.fixedFiles?.['training_runtime.py']) diagnostics.push(diag('SCAFFOLD_MODIFIED', 'The supplied training assistant helper is fixed.', 'training_runtime.py'))
  if (constants.PORT !== 8080) diagnostics.push(diag('PYTHON_UNSUPPORTED', 'PORT must be the supported integer 8080.', 'app.py'))
  if (diagnostics.length) return { appSpec: null, diagnostics }
  return { appSpec: { language: 'python', service: constants.SERVICE_NAME, version: constants.SERVICE_VERSION, listeningPort: constants.PORT,
    routes: [{ method: 'GET', path: '/api/info', response: infoValues }, { method: 'POST', path: '/api/ask', response: { kind: 'assistant', settings: settingValues } }],
    assistant: { adapter: 'knowledge-fixture-v1', settingsFunction: 'settings', helperValid: true } }, diagnostics: [] }
}
export function parsePythonProject(files, manifest = {}) {
  const text = files?.['app.py']; if (typeof text !== 'string') return { appSpec: null, diagnostics: [diag('MISSING_FILE', 'A required Python source file is missing.')] }
  const { tree, diagnostics } = syntax(text, manifest.maxTokens ?? 20_000); if (diagnostics.length) return { appSpec: null, diagnostics }
  if (manifest.assistant) return parseAssistantProject(files, manifest, text, tree)
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
  for (const key of ['service', 'version']) if (response[key] && (response[key].kind !== 'literal' || typeof response[key].value !== 'string')) out.push(diag('PYTHON_UNSUPPORTED', `${key} must resolve to a string literal.`, 'app.py', text, dict.from))
  if (response.environment && (response.environment.kind === 'literal' ? typeof response.environment.value !== 'string' : typeof response.environment.key !== 'string' || typeof response.environment.defaultValue !== 'string')) out.push(diag('PYTHON_UNSUPPORTED', 'environment must be a string literal or a supported string configuration lookup.', 'app.py', text, dict.from))
  if (Object.values(response).some(value => value.kind === 'config') && !hasOsImport) out.push(diag('PYTHON_UNSUPPORTED', 'Import os before reading environment configuration.', 'app.py', text, fn.from))
  if (!Number.isInteger(constants.PORT) || constants.PORT < 1 || constants.PORT > 65535) out.push(diag('PYTHON_UNSUPPORTED', 'PORT must be a valid integer literal.'))
  if (out.length) return { appSpec: null, diagnostics: out }
  return { appSpec: { language: 'python', service: response.service.value, version: response.version.value, listeningPort: constants.PORT, routes: [{ method: 'GET', path: '/api/info', response }] }, diagnostics: [] }
}

