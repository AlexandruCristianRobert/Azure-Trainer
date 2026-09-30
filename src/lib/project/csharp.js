function diagnostic(code, message, path, token = { line: 1, column: 1 }) {
  return { code, message, path, line: token.line, column: token.column }
}

export function lexCsharp(text, path, maxTokens = 5000) {
  const tokens = []
  let index = 0; let line = 1; let column = 1
  const advance = () => {
    const char = text[index++]
    if (char === '\n') { line++; column = 1 } else column++
    return char
  }
  while (index < text.length) {
    const char = text[index]
    if (/\s/.test(char)) { advance(); continue }
    if (text.startsWith('//', index)) { while (index < text.length && advance() !== '\n') {} continue }
    if (text.startsWith('/*', index)) {
      const start = { line, column }
      advance(); advance(); while (index < text.length && !text.startsWith('*/', index)) advance()
      if (index >= text.length) return { tokens, diagnostics: [diagnostic('UNTERMINATED_COMMENT', 'Unterminated block comment.', path, start)] }
      advance(); advance(); continue
    }
    const start = { line, column }
    if (char === '"') {
      advance(); let value = ''
      while (index < text.length && text[index] !== '"') {
        const next = advance()
        if (next === '\n' || next === '\r') return { tokens, diagnostics: [diagnostic('INVALID_STRING', 'Ordinary strings cannot contain a newline.', path, start)] }
        if (next === '\\') {
          if (index >= text.length) return { tokens, diagnostics: [diagnostic('INVALID_STRING', 'Unterminated string escape.', path, start)] }
          const escape = advance()
          const decoded = ({ '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' })[escape]
          if (decoded === undefined) return { tokens, diagnostics: [diagnostic('INVALID_STRING', `Unsupported string escape '\\${escape}'.`, path, start)] }
          value += decoded
        } else value += next
      }
      if (text[index] !== '"') return { tokens, diagnostics: [diagnostic('SYNTAX_ERROR', 'Unterminated string literal.', path, start)] }
      advance(); tokens.push({ type: 'string', value, ...start }); continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let value = ''
      while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) value += advance()
      tokens.push({ type: 'word', value, ...start }); continue
    }
    if (/[0-9]/.test(char)) {
      let value = ''
      while (index < text.length && /[0-9]/.test(text[index])) value += advance()
      tokens.push({ type: 'number', value, ...start }); continue
    }
    if (text.startsWith('=>', index)) { advance(); advance(); tokens.push({ type: 'symbol', value: '=>', ...start }); continue }
    if (';.=(){}[],+?:'.includes(char)) { advance(); tokens.push({ type: 'symbol', value: char, ...start }); continue }
    advance(); return { tokens, diagnostics: [diagnostic('UNSUPPORTED_SYNTAX', `Unsupported character '${char}'.`, path, start)] }
  }
  if (tokens.length > maxTokens) return { tokens, diagnostics: [diagnostic('TOKEN_LIMIT', `The editable region exceeds ${maxTokens} lexer tokens.`, path, tokens[maxTokens])] }
  return { tokens, diagnostics: [] }
}

const symbols = new Set([';', '.', '=', '(', ')', '{', '}', '[', ']', ',', '+', '?', ':', '=>'])
function tokenIs(token, value) {
  return token?.value === value && token.type === (symbols.has(value) ? 'symbol' : 'word')
}
function same(tokens, start, values) {
  return values.every((value, offset) => tokenIs(tokens[start + offset], value))
}

function expect(tokens, state, value, diagnostics, path, code = 'UNSUPPORTED_STATEMENT') {
  const token = tokens[state.index]
  if (tokenIs(token, value)) { state.index++; return true }
  diagnostics.push(diagnostic(code, `Expected '${value}'.`, path, token ?? tokens.at(-1)))
  return false
}

function parseMember(tokens, state) {
  const first = tokens[state.index]
  if (!first || first.type !== 'word') return null
  const names = [first.value]; state.index++
  while (tokenIs(tokens[state.index], '.') && tokens[state.index + 1]?.type === 'word') {
    state.index += 2; names.push(tokens[state.index - 1].value)
  }
  return names.join('.')
}

function parseExpression(tokens, state, locals) {
  const token = tokens[state.index]
  if (!token) return null
  if (token.type === 'string') { state.index++; return { kind: 'literal', value: token.value } }
  const before = state.index
  const member = parseMember(tokens, state)
  if (member === 'AppSettings.ServiceName') return { kind: 'member', source: member }
  if (member === 'builder.Configuration' && tokenIs(tokens[state.index], '[') && tokens[state.index + 1]?.type === 'string' && tokenIs(tokens[state.index + 2], ']')) {
    const key = tokens[state.index + 1].value; state.index += 3
    return { kind: 'config', key }
  }
  if (member && Object.hasOwn(locals, member)) return locals[member]
  state.index = before
  return null
}

function parseResponse(tokens, state, locals, diagnostics, path) {
  if (!same(tokens, state.index, ['Results', '.', 'Ok', '('])) return null
  state.index += 4
  if (!expect(tokens, state, 'new', diagnostics, path) || !expect(tokens, state, '{', diagnostics, path)) return null
  const properties = {}
  while (!tokenIs(tokens[state.index], '}')) {
    const key = tokens[state.index]
    if (!key || key.type !== 'word') return null
    state.index++
    let expression
    if (tokenIs(tokens[state.index], '=')) { state.index++; expression = parseExpression(tokens, state, locals) }
    else expression = Object.hasOwn(locals, key.value) ? locals[key.value] : null
    if (!expression || !['service', 'environment'].includes(key.value)) return null
    if (Object.hasOwn(properties, key.value)) {
      diagnostics.push(diagnostic('DUPLICATE_RESPONSE_FIELD', `Duplicate response field '${key.value}'.`, path, key))
      return null
    }
    properties[key.value] = expression
    if (tokenIs(tokens[state.index], ',')) state.index++
    else if (!tokenIs(tokens[state.index], '}')) return null
  }
  state.index++
  if (!expect(tokens, state, ')', diagnostics, path)) return null
  return properties.service && properties.environment ? properties : null
}

function parseRoute(tokens, state, diagnostics, path) {
  if (!same(tokens, state.index, ['app', '.', 'MapGet', '('])) return null
  state.index += 4
  const pathToken = tokens[state.index]
  if (pathToken?.type !== 'string') return null
  state.index++
  if (!expect(tokens, state, ',', diagnostics, path) || !expect(tokens, state, '(', diagnostics, path) || !expect(tokens, state, ')', diagnostics, path) || !expect(tokens, state, '=>', diagnostics, path)) return null
  const locals = {}
  let response
  if (tokenIs(tokens[state.index], '{')) {
    state.index++
    if (same(tokens, state.index, ['var']) && tokens[state.index + 1]?.type === 'word') {
      const name = tokens[state.index + 1].value; state.index += 2
      if (!expect(tokens, state, '=', diagnostics, path)) return null
      const expression = parseExpression(tokens, state, locals)
      if (!expression || expression.kind !== 'config' || expression.key !== 'APP_ENV' || name !== 'environment') {
        diagnostics.push(diagnostic('UNSUPPORTED_LOCAL', 'Only local environment = builder.Configuration["APP_ENV"] is supported.', path, tokens[state.index] ?? tokens[state.index - 1]))
        return null
      }
      if (!expect(tokens, state, ';', diagnostics, path)) return null
      locals[name] = expression
    }
    if (!expect(tokens, state, 'return', diagnostics, path)) return null
    response = parseResponse(tokens, state, locals, diagnostics, path)
    if (!response || !expect(tokens, state, ';', diagnostics, path) || !expect(tokens, state, '}', diagnostics, path)) return null
  } else response = parseResponse(tokens, state, locals, diagnostics, path)
  if (!response || !expect(tokens, state, ')', diagnostics, path) || !expect(tokens, state, ';', diagnostics, path)) return null
  return { method: 'GET', path: pathToken.value, response }
}

function parseListener(tokens, state, diagnostics, path) {
  if (!same(tokens, state.index, ['app', '.', 'Run', '('])) return null
  state.index += 4
  const address = tokens[state.index]
  if (address?.type !== 'string' || address.value !== 'http://0.0.0.0:') return null
  state.index++
  if (!expect(tokens, state, '+', diagnostics, path)) return null
  const expression = parseExpression(tokens, state, {})
  if (!expression || expression.kind !== 'config' || expression.key !== 'ListeningPort') return null
  if (!expect(tokens, state, ')', diagnostics, path) || !expect(tokens, state, ';', diagnostics, path)) return null
  return expression
}

const conditions = Object.freeze({
  'HealthState.StartupComplete': 'startup', 'HealthState.Ready': 'ready',
  'HealthState.Responsive': 'responsive', 'HealthState.DependencyAvailable': 'dependency',
  true: 'always', false: 'never',
})

function parseHealthCondition(tokens, state) {
  const member = parseMember(tokens, state)
  return Object.hasOwn(conditions, member) ? conditions[member] : null
}

function parseHealthStatus(tokens, state) {
  if (same(tokens, state.index, ['Results', '.', 'Ok', '(', ')'])) { state.index += 5; return 200 }
  if (!same(tokens, state.index, ['Results', '.', 'StatusCode', '('])) return null
  state.index += 4
  const value = tokens[state.index]
  if (value?.type !== 'number' || ![200, 503].includes(Number(value.value)) || !tokenIs(tokens[state.index + 1], ')')) return null
  state.index += 2
  return Number(value.value)
}

function parseHealthRoute(tokens, state) {
  if (!same(tokens, state.index, ['app', '.', 'MapGet', '('])) return null
  state.index += 4
  const path = tokens[state.index]
  if (path?.type !== 'string' || !/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(path.value)) return null
  state.index++
  if (!same(tokens, state.index, [',', '(', ')', '=>'])) return null
  state.index += 4
  let condition
  if (same(tokens, state.index, ['Results', '.', 'StatusCode', '('])) {
    state.index += 4
    condition = parseHealthCondition(tokens, state)
    if (!condition || !tokenIs(tokens[state.index], '?')) return null
    state.index++
    const success = tokens[state.index++]
    if (success?.type !== 'number' || Number(success.value) !== 200 || !tokenIs(tokens[state.index], ':')) return null
    state.index++
    const failure = tokens[state.index++]
    if (failure?.type !== 'number' || Number(failure.value) !== 503 || !tokenIs(tokens[state.index], ')')) return null
    state.index++
  } else {
    condition = parseHealthCondition(tokens, state)
    if (!condition || !tokenIs(tokens[state.index], '?')) return null
    state.index++
    if (parseHealthStatus(tokens, state) !== 200 || !tokenIs(tokens[state.index], ':')) return null
    state.index++
    if (parseHealthStatus(tokens, state) !== 503) return null
  }
  if (!same(tokens, state.index, [')', ';'])) return null
  state.index += 2
  return { path: path.value, condition }
}

function appSettings(text, path, maxTokens) {
  const scanned = lexCsharp(text, path, maxTokens)
  if (scanned.diagnostics.length) return { value: null, diagnostics: scanned.diagnostics }
  const { tokens } = scanned
  const prefix = ['namespace', 'Trainer', '.', 'Api', ';', 'public', 'static', 'class', 'AppSettings', '{', 'public', 'const', 'string', 'ServiceName', '=']
  if (!same(tokens, 0, prefix) || tokens[prefix.length]?.type !== 'string' || !tokenIs(tokens[prefix.length + 1], ';') || !tokenIs(tokens[prefix.length + 2], '}')) {
    return { value: null, diagnostics: [diagnostic('UNSUPPORTED_SETTINGS', 'AppSettings must contain the supported ServiceName string constant.', path, tokens[0])] }
  }
  if (tokens.length !== prefix.length + 3) {
    return { value: null, diagnostics: [diagnostic('UNSUPPORTED_STATEMENT', 'Unknown statement in AppSettings.cs.', path, tokens[prefix.length + 3])] }
  }
  return { value: tokens[prefix.length].value, diagnostics: [] }
}

export function parseCsharp(program, appSettingsText, { programPath, settingsPath, maxTokens, healthProbes = false }) {
  const scanned = lexCsharp(program, programPath, maxTokens)
  if (scanned.diagnostics.length) return { route: null, diagnostics: scanned.diagnostics }
  const { tokens } = scanned; const diagnostics = []; const state = { index: 0 }
  const fixed = ['using', 'Trainer', '.', 'Api', ';', 'var', 'builder', '=', 'WebApplication', '.', 'CreateBuilder', '(', 'args', ')', ';', 'var', 'app', '=', 'builder', '.', 'Build', '(', ')', ';']
  if (!same(tokens, 0, fixed)) {
    const mismatch = fixed.findIndex((value, index) => !tokenIs(tokens[index], value))
    return { route: null, diagnostics: [diagnostic('SCAFFOLD_MODIFIED', 'The Program.cs scaffold is fixed outside its route region.', programPath, tokens[Math.max(mismatch, 0)])] }
  }
  state.index = fixed.length
  const route = parseRoute(tokens, state, diagnostics, programPath)
  if (!route) diagnostics.push(diagnostic('UNSUPPORTED_STATEMENT', 'Only the supported GET /api/info route is allowed.', programPath, tokens[state.index]))
  const healthEndpoints = []
  if (route && healthProbes) {
    const paths = new Set([route.path])
    while (same(tokens, state.index, ['app', '.', 'MapGet', '('])) {
      const position = state.index
      const health = parseHealthRoute(tokens, state)
      if (!health) {
        diagnostics.push(diagnostic('UNSUPPORTED_HEALTH_ROUTE', 'Only a supported conditional HTTP health response is allowed.', programPath, tokens[position]))
        break
      }
      if (paths.has(health.path)) diagnostics.push(diagnostic('DUPLICATE_ROUTE', `Duplicate route '${health.path}'.`, programPath, tokens[position]))
      paths.add(health.path)
      healthEndpoints.push(health)
    }
  }
  const listener = route ? parseListener(tokens, state, diagnostics, programPath) : null
  if (route && !listener) diagnostics.push(diagnostic('UNSUPPORTED_STATEMENT', 'Program.cs must end with the supported app.Run listener expression.', programPath, tokens[state.index]))
  if (state.index < tokens.length) diagnostics.push(diagnostic('UNSUPPORTED_STATEMENT', 'Unknown executable statement.', programPath, tokens[state.index]))
  const setting = appSettings(appSettingsText, settingsPath, maxTokens)
  diagnostics.push(...setting.diagnostics)
  return { route, listener, serviceName: setting.value, healthEndpoints, diagnostics }
}
