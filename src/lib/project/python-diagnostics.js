import { parser } from '@lezer/python'

const kids = node => { const out = []; for (let child = node?.firstChild; child; child = child.nextSibling) out.push(child); return out }
const raw = (node, text) => node ? text.slice(node.from, node.to) : ''
const parts = node => kids(node).filter(child => !['(', ')', '{', '}', ',', ':', '\n', 'Comment', 'return', 'AssignOp'].includes(child.name))
const body = node => kids(node).find(child => child.name === 'Body')
const functionName = (node, text) => raw(kids(node).find(child => child.name === 'VariableName'), text)
const location = (node, text) => { const prefix = text.slice(0, node?.from ?? 0); return { path: 'app.py', line: prefix.split('\n').length, column: (node?.from ?? 0) - prefix.lastIndexOf('\n') } }
const diagnostic = (node, text, message, code = 'PYTHON_UNSUPPORTED') => ({ code, message, ...location(node, text) })
const compact = (node, text) => raw(node, text).replace(/\s/g, '')

function literal(node, text) {
  if (node?.name === 'None') return { kind: 'literal', value: null }
  if (node?.name === 'Number' && /^\d+$/.test(raw(node, text))) return { kind: 'literal', value: Number(raw(node, text)) }
  if (node?.name !== 'String') return null
  const source = raw(node, text)
  // Decode only ordinary single/double quoted strings, without evaluating Python.
  if (!/^(["']).*\1$/s.test(source) || source.startsWith('"""') || source.startsWith("'''")) return null
  let value = ''
  for (let index = 1; index < source.length - 1; index++) {
    const char = source[index]
    if (char !== '\\') { value += char; continue }
    const escaped = source[++index]
    const escapes = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" }
    if (!Object.hasOwn(escapes, escaped)) return null
    value += escapes[escaped]
  }
  return { kind: 'literal', value }
}

function call(node, text) {
  if (node?.name !== 'CallExpression') return null
  const children = kids(node)
  return { name: compact(children[0], text), args: kids(children.find(child => child.name === 'ArgList')).filter(child => !['(', ')', ','].includes(child.name)) }
}

/** Compile only the declared logging wrapper, never execute authored Python. */
export function parsePythonDiagnostics(files, manifest = {}) {
  if (manifest.diagnosticsVersion !== 1) return { diagnosticsSpec: null, diagnostics: [] }
  const text = files?.['app.py']
  if (typeof text !== 'string') return { diagnosticsSpec: null, diagnostics: [diagnostic(null, '', 'A required Python source file is missing.', 'MISSING_FILE')] }
  const tree = parser.parse(text); const diagnostics = []; let count = 0; let syntaxError = null
  tree.iterate({ enter(node) { count++; if (node.type.isError) syntaxError ??= node } })
  if (count > (manifest.maxTokens ?? 20_000)) diagnostics.push(diagnostic(null, text, 'Python source exceeds the supported syntax node limit.', 'TOKEN_LIMIT'))
  if (syntaxError) diagnostics.push(diagnostic(syntaxError, text, 'Python source contains a syntax error.', 'PYTHON_SYNTAX'))
  if (manifest.fixedFiles?.['training_diagnostics.py'] !== undefined && files?.['training_diagnostics.py'] !== manifest.fixedFiles['training_diagnostics.py'])
    diagnostics.push({ code: 'SCAFFOLD_MODIFIED', message: 'The supplied request context helper is fixed.', path: 'training_diagnostics.py', line: 1, column: 1 })
  if (diagnostics.length) return { diagnosticsSpec: null, diagnostics }

  const top = parts(tree.topNode); const functions = top.filter(node => node.name === 'FunctionDefinition')
  const find = name => functions.filter(node => functionName(node, text) === name)
  const wrapper = find('answer'); const core = find('answer_core')
  if (wrapper.length !== 1 || core.length !== 1) diagnostics.push(diagnostic(wrapper[0], text, 'Define one answer(question) wrapper and one answer_core(question).'))
  const imports = new Set(top.filter(node => node.name === 'ImportStatement').map(node => raw(node, text).trim().replace(/\s+/g, ' ')))
  const loggerNames = new Set(); const helpers = new Map(); let configured = false
  const fail = (node, message) => { diagnostics.push(diagnostic(node, text, message)); return null }
  const reserved = new Set(['logging', 'json', 'current_request_id', 'answer_core', 'question'])
  const shadowsHelper = name => reserved.has(name) || loggerNames.has(name) || helpers.has(name)
  const parameters = node => parts(kids(node).find(child => child.name === 'ParamList'))
  const questionParameters = node => parameters(node).map(child => raw(child, text)).join(',') === 'question'
  if (wrapper[0] && !questionParameters(wrapper[0])) fail(wrapper[0], 'answer() must accept only question.')
  if (core[0] && !questionParameters(core[0])) fail(core[0], 'answer_core() must accept only question.')

  for (const statement of top) {
    if (statement.name === 'ImportStatement') {
      const imported = raw(statement, text).trim().replace(/\s+/g, ' ')
      if (!['import logging', 'import json', 'import os', 'from pathlib import Path', 'from training_diagnostics import current_request_id'].includes(imported)
        && !/^from training_clients import \(\s*EmbeddingClient, AnswerClient, PgClient, RetryPolicy, RequestBudget, DependencyError, as_vector,?\s*\)$/.test(imported)
        && imported !== 'from training_health import initialized, accepting_requests, postgres_available, ai_available')
        fail(statement, 'This import is outside the declared diagnosis teaching subset.')
    }
    if (statement.name === 'AssignStatement') {
      const values = parts(statement); const rhs = call(values.at(-1), text)
      if (rhs?.name === 'logging.getLogger') {
        const name = literal(rhs.args[0], text)
        if (values.length !== 2 || values[0].name !== 'VariableName' || rhs.args.length !== 1 || typeof name?.value !== 'string' || name.value.length > 64)
          fail(statement, 'getLogger() must bind a local logger using one bounded literal name.')
        else if (shadowsHelper(raw(values[0], text)) || functions.some(node => functionName(node, text) === raw(values[0], text))) fail(statement, 'Logger bindings must not shadow imports, functions, or another logger.')
        else loggerNames.add(raw(values[0], text))
      } else if (values.length !== 2 || values[0].name !== 'VariableName' || !['SERVICE_NAME', 'SERVICE_VERSION', 'PORT', 'SQL', 'QUERY_SOURCE'].includes(raw(values[0], text)))
        fail(statement, 'Only service constants, retrieval source, and declared loggers may be bound at module scope.')
    }
    if (statement.name === 'ExpressionStatement') {
      const expression = parts(statement)[0]; const configuredCall = call(expression, text)
      const args = configuredCall?.args ?? []; const options = {}
      let invalid = args.length !== 6
      for (let index = 0; index < args.length; index += 3) {
        const key = raw(args[index], text)
        if (args[index]?.name !== 'VariableName' || args[index + 1]?.name !== 'AssignOp' || !['level', 'format'].includes(key) || Object.hasOwn(options, key)) invalid = true
        options[key] = args[index + 2]
      }
      if (configuredCall?.name !== 'logging.basicConfig' || invalid || compact(options.level, text) !== 'logging.INFO' || literal(options.format, text)?.value !== '%(message)s')
        fail(statement, 'Only basicConfig(level=logging.INFO, format="%(message)s") is supported at module scope.')
      else configured = true
    }
    if (!['AssignStatement', 'ImportStatement', 'ExpressionStatement', 'FunctionDefinition'].includes(statement.name))
      fail(statement, 'This module statement is outside the declared diagnosis teaching subset.')
  }
  if (!imports.has('import logging') || !imports.has('import json')) fail(tree.topNode, 'Import logging and json for structured application events.')

  const value = (node, bindings, resultBindings) => {
    const fixed = literal(node, text)
    if (fixed) return fixed
    if (node?.name === 'VariableName' && bindings.has(raw(node, text))) return bindings.get(raw(node, text))
    const invoke = call(node, text)
    if (invoke?.name === 'current_request_id' && invoke.args.length === 0 && imports.has('from training_diagnostics import current_request_id')) return { kind: 'request-id' }
    if (node?.name === 'MemberExpression') {
      const members = kids(node); const base = members.find(child => child.name === 'VariableName'); const key = members.find(child => child.name === 'String')
      if (resultBindings.has(raw(base, text)) && literal(key, text)?.value === 'status') return { kind: 'result-status', binding: raw(base, text) }
    }
    return fail(node, 'Log fields must use declared literals, current_request_id(), or the actual returned status binding.')
  }
  const dictionary = (node, bindings, resultBindings) => {
    if (node?.name === 'VariableName' && bindings.has(raw(node, text)) && bindings.get(raw(node, text))?.kind === 'record') return bindings.get(raw(node, text)).fields
    if (node?.name !== 'DictionaryExpression') return fail(node, 'json.dumps() must receive a supported log dictionary.')
    const fields = {}; const entries = parts(node)
    for (let index = 0; index < entries.length; index += 2) {
      const key = literal(entries[index], text)?.value
      if (!['event', 'request_id', 'status'].includes(key) || Object.hasOwn(fields, key)) return fail(entries[index], 'Log dictionaries support unique event, request_id, and optional status fields only.')
      fields[key] = value(entries[index + 1], bindings, resultBindings)
    }
    if (!fields.event || !fields.request_id) return fail(node, 'Log dictionaries require event and request_id fields.')
    return fields
  }
  const log = (node, bindings, resultBindings) => {
    const outer = call(node, text)
    if (!outer || outer.args.length !== 1 || ![...loggerNames].some(name => outer.name === `${name}.info`)) return fail(node, 'Emit application events with the declared logger.info().')
    const serialized = call(outer.args[0], text)
    if (serialized?.name !== 'json.dumps' || serialized.args.length !== 1) return fail(node, 'logger.info() must contain one json.dumps() log dictionary.')
    return dictionary(serialized.args[0], bindings, resultBindings)
  }
  // A helper can bind the dictionary locally, then emit it once. Parameters
  // remain symbolic until a wrapper call supplies a literal event/status.
  for (const helper of functions.filter(node => !['answer', 'answer_core', 'settings', 'info', 'format_answer', 'startup', 'ready', 'live'].includes(functionName(node, text)))) {
    const name = functionName(helper, text)
    const params = kids(kids(helper).find(node => node.name === 'ParamList')).filter(node => !['(', ')', ','].includes(node.name))
    const names = []; let required = 0; let optional = false; let invalid = false
    for (let index = 0; index < params.length; index++) {
      if (params[index].name !== 'VariableName') { invalid = true; break }
      names.push(raw(params[index], text))
      if (params[index + 1]?.name === 'AssignOp' && params[index + 2]?.name === 'None') { optional = true; index += 2 }
      else if (optional) invalid = true
      else required++
    }
    if (invalid || shadowsHelper(name) || names.some(shadowsHelper) || new Set(names).size !== names.length || names.length < 1 || names.length > 3) {
      fail(helper, 'Log helpers accept up to three named fields with optional None defaults.'); continue
    }
    const bindings = new Map(names.map(name => [name, { kind: 'parameter', name }]))
    let fields = null
    for (const statement of parts(body(helper))) {
      const entries = parts(statement)
      if (statement.name === 'AssignStatement' && entries.length === 2 && entries[0].name === 'VariableName') {
        if (shadowsHelper(raw(entries[0], text))) { fail(statement, 'Helper locals must not shadow declared loggers or imports.'); continue }
        const projected = dictionary(entries[1], bindings, new Set())
        bindings.set(raw(entries[0], text), { kind: 'record', fields: projected })
      } else if (statement.name === 'ExpressionStatement' && !fields) fields = log(entries[0], bindings, new Set())
      else fail(statement, 'A log helper may bind one dictionary and emit one structured info event.')
    }
    if (!fields) fail(helper, 'Log helpers must emit one structured event.')
    helpers.set(name, { names, required, fields })
  }

  const statements = []; const resultBindings = new Set(); const locals = new Map(); let coreCalls = 0
  const boundedFields = (fields, node) => {
    if (!fields) return null
    if (fields.event?.kind !== 'literal' || typeof fields.event.value !== 'string' || fields.event.value.length > 64) return fail(node, 'Event names must be text literals up to 64 characters.')
    if (!fields.request_id || !['literal', 'request-id'].includes(fields.request_id.kind)
      || (fields.request_id.kind === 'literal' && fields.request_id.value !== null && (typeof fields.request_id.value !== 'string' || fields.request_id.value.length > 128))) return fail(node, 'Request IDs must be current_request_id(), None, or a bounded literal string.')
    if (fields.status && (fields.status.kind === 'literal' ? fields.status.value !== null && (!Number.isInteger(fields.status.value) || fields.status.value < 100 || fields.status.value > 599) : fields.status.kind !== 'result-status')) return fail(node, 'Log status must be None, a literal HTTP status, or the actual returned status.')
    return fields
  }
  for (const statement of parts(body(wrapper[0]))) {
    const entries = parts(statement)
    if (statement.name === 'AssignStatement' && entries.length === 2 && entries[0].name === 'VariableName') {
      const invoked = call(entries[1], text)
      const binding = raw(entries[0], text)
      if (shadowsHelper(binding) || resultBindings.has(binding)) {
        fail(statement, 'The result binding must not shadow a declared logging or integration helper.'); continue
      }
      if (invoked?.name !== 'answer_core') {
        const projected = entries[1].name === 'DictionaryExpression' ? { kind: 'record', fields: dictionary(entries[1], locals, resultBindings) }
          : value(entries[1], locals, resultBindings)
        locals.set(binding, projected); continue
      }
      if (invoked.args.length !== 1 || raw(invoked.args[0], text) !== 'question' || coreCalls++) { fail(statement, 'Bind one answer_core(question) result in the wrapper.'); continue }
      if (locals.has(binding)) { fail(statement, 'The core result requires its own unshadowed binding.'); continue }
      resultBindings.add(binding)
      statements.push({ op: 'core', binding, source: location(statement, text) }); continue
    }
    if (statement.name === 'ReturnStatement') {
      const returned = entries[0]; const invoked = call(returned, text)
      if (invoked?.name === 'answer_core' && invoked.args.length === 1 && raw(invoked.args[0], text) === 'question' && coreCalls++ === 0) {
        statements.push({ op: 'core', binding: null, source: location(statement, text) }, { op: 'return', binding: null, source: location(statement, text) })
      } else if (returned?.name === 'VariableName' && resultBindings.has(raw(returned, text))) statements.push({ op: 'return', binding: raw(returned, text), source: location(statement, text) })
      else fail(statement, 'Return the actual answer_core result from the wrapper.')
      continue
    }
    if (statement.name !== 'ExpressionStatement') { fail(statement, 'The logging wrapper supports log calls, one core result, and its return.'); continue }
    const invoked = call(entries[0], text); const helper = helpers.get(invoked?.name); let fields
    if (helper) {
      if (invoked.args.length < helper.required || invoked.args.length > helper.names.length) { fail(statement, 'Supply the required event fields and optional None fields to the log helper.'); continue }
      const bindings = new Map(helper.names.map((name, index) => [name, invoked.args[index] ? value(invoked.args[index], locals, resultBindings) : { kind: 'literal', value: null }]))
      fields = helper.fields && Object.fromEntries(Object.entries(helper.fields).map(([key, descriptor]) => [key, descriptor?.kind === 'parameter' ? bindings.get(descriptor.name) : descriptor]))
    } else fields = log(entries[0], locals, resultBindings)
    fields = boundedFields(fields, statement)
    if (fields) statements.push({ op: 'log', fields, enabled: configured, source: location(statement, text) })
  }
  if (!coreCalls || !statements.some(statement => statement.op === 'return')) fail(wrapper[0], 'The wrapper must call and return answer_core(question).')
  return { diagnosticsSpec: diagnostics.length ? null : { version: 1, statements }, diagnostics }
}

/** Preserve offsets while presenting the existing compiler with answer_core's
 * integration body. All log statements are validated separately above. */
export function diagnosticsCoreFiles(files) {
  const text = files['app.py']; const tree = parser.parse(text)
  let projected = text
  const functions = kids(tree.topNode).filter(node => node.name === 'FunctionDefinition')
  const wrapper = functions.find(node => functionName(node, text) === 'answer')
  const core = functions.find(node => functionName(node, text) === 'answer_core')
  const edits = []
  if (wrapper) edits.push({ from: wrapper.from, to: wrapper.to, value: raw(wrapper, text).replace(/[^\r\n]/g, ' ') })
  const name = kids(core).find(node => node.name === 'VariableName')
  if (name) edits.push({ from: name.from, to: name.to, value: 'answer     ' })
  for (const edit of edits.sort((a, b) => b.from - a.from)) projected = projected.slice(0, edit.from) + edit.value + projected.slice(edit.to)
  return { ...files, 'app.py': projected }
}
