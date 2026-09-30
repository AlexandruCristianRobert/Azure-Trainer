import { BICEP_LIMITS, bicepDiagnostic, lexBicep } from './lexer.js'

class ParseFailure extends Error {
  constructor(diagnostic) { super(diagnostic.message); this.diagnostic = diagnostic }
}

function parseTokens(tokens, path, parameterFile = false, expectedUsing = './main.bicep') {
  let pos = 0
  const current = () => tokens[pos]
  const take = () => tokens[pos++]
  const fail = (code, message, token = current()) => { throw new ParseFailure(bicepDiagnostic(code, message, path, token.line, token.column)) }
  const is = (value) => current().value === value
  const accept = (value) => { if (is(value)) { take(); return true } return false }
  const expect = (value) => { if (!accept(value)) fail('BICEP_SYNTAX', `Expected ${value}.`) }
  const identifier = () => { if (current().type !== 'identifier') fail('BICEP_SYNTAX', 'Expected an identifier.'); return take() }
  const location = token => ({ path, line: token.line, column: token.column })
  const unsupported = (message, token = current()) => fail('UNSUPPORTED_BICEP', message, token)

  function expression(depth = 0, literalOnly = false) {
    if (depth > BICEP_LIMITS.expressionDepth) fail('BICEP_DEPTH_LIMIT', 'Bicep expression depth exceeds 32.')
    const token = take(); let node
    if (token.type === 'integer' || token.type === 'number') {
      if (literalOnly && token.type === 'number') unsupported('Decimal parameter values are outside this Bicep subset.', token)
      node = { kind: token.type, value: Number(token.value), ...location(token) }
    }
    else if (token.type === 'string') {
      const segments = token.segments.map(segment => segment.kind === 'text' ? segment : {
        ...segment, expression: parseInterpolation(segment, depth + 1, literalOnly),
      })
      if (literalOnly && segments.some(segment => segment.kind === 'expression')) unsupported('Parameter values must be literals.', token)
      node = { kind: segments.some(segment => segment.kind === 'expression') ? 'interpolatedString' : 'string',
        value: token.value, segments, ...location(token) }
    } else if (token.type === 'identifier' && ['true', 'false'].includes(token.value)) node = { kind: 'boolean', value: token.value === 'true', ...location(token) }
    else if (token.type === 'identifier' && token.value === 'null') node = { kind: 'null', value: null, ...location(token) }
    else if (token.type === 'identifier' && ['for', 'if'].includes(token.value)) unsupported('Loops and conditions are outside this Bicep subset.', token)
    else if (token.type === 'identifier') {
      if (literalOnly) unsupported('Parameter values must be literals.', token)
      node = { kind: 'identifier', name: token.value, ...location(token) }
    } else if (token.value === '-') {
      if (current().type !== 'integer') fail('BICEP_SYNTAX', 'Expected an integer after minus.')
      node = { kind: 'integer', value: -Number(take().value), ...location(token) }
    } else if (token.value === '[') {
      const items = []
      while (!is(']')) {
        if (current().type === 'eof') fail('BICEP_SYNTAX', 'Unclosed array.', token)
        if (is('for')) unsupported('Array comprehensions are outside this Bicep subset.')
        items.push(expression(depth + 1, literalOnly))
        const prior = tokens[pos - 1]
        if (!accept(',') && !is(']') && current().line <= prior.line) fail('BICEP_SYNTAX', 'Expected a comma or newline between array items.')
      }
      take(); node = { kind: 'array', items, ...location(token) }
    } else if (token.value === '{') {
      const properties = []; const seen = new Set()
      while (!is('}')) {
        if (current().type === 'eof') fail('BICEP_SYNTAX', 'Unclosed object.', token)
        const keyToken = take()
        if (!['identifier', 'string'].includes(keyToken.type)) fail('BICEP_SYNTAX', 'Expected an object key.', keyToken)
        const computed = keyToken.type === 'string' && keyToken.segments.some(segment => segment.kind === 'expression')
        if (computed && (literalOnly || keyToken.segments.length !== 1 || keyToken.segments[0].kind !== 'expression'))
          unsupported('Only a single interpolated expression is supported as an object key.', keyToken)
        if (!computed && seen.has(keyToken.value)) fail('DUPLICATE_BICEP_PROPERTY', `Duplicate property ${keyToken.value}.`, keyToken)
        if (!computed) seen.add(keyToken.value)
        const keyExpression = computed ? parseInterpolation(keyToken.segments[0], depth + 1, false) : null
        expect(':')
        properties.push({ key: keyToken.value, keyExpression, value: expression(depth + 1, literalOnly), ...location(keyToken) })
        const prior = tokens[pos - 1]
        if (!accept(',') && !is('}') && current().line <= prior.line) fail('BICEP_SYNTAX', 'Expected a comma or newline between object properties.')
      }
      take(); node = { kind: 'object', properties, ...location(token) }
    } else if (token.value === '(') { node = expression(depth + 1, literalOnly); expect(')') }
    else fail('BICEP_SYNTAX', 'Expected a Bicep expression.', token)
    while (!literalOnly) {
      if (accept('.')) { if (++depth > BICEP_LIMITS.expressionDepth) fail('BICEP_DEPTH_LIMIT', 'Bicep expression depth exceeds 32.'); const member = identifier(); node = { kind: 'member', object: node, property: member.value, ...location(member) }; continue }
      if (accept('(')) {
        if (++depth > BICEP_LIMITS.expressionDepth) fail('BICEP_DEPTH_LIMIT', 'Bicep expression depth exceeds 32.')
        if (node.kind !== 'identifier') unsupported('Only direct function calls are supported.', token)
        const args = []
        while (!is(')')) {
          if (current().type === 'eof') fail('BICEP_SYNTAX', 'Unclosed function call.', token)
          args.push(expression(depth + 1)); if (!accept(',')) break
        }
        expect(')'); node = { kind: 'call', name: node.name, args, ...location(token) }; continue
      }
      if (is('[')) unsupported('Array indexing is outside this Bicep subset.')
      if (current().type === 'operator') unsupported('Operators are outside this Bicep subset.')
      break
    }
    return node
  }

  function parseInterpolation(segment, depth, literalOnly) {
    if (literalOnly) unsupported('Parameter values must be literals.', segment)
    const lexed = lexBicep(segment.text, path, { maxTokens: BICEP_LIMITS.interpolationTokens, line: segment.line, column: segment.column + 2 })
    if (lexed.diagnostics.length) throw new ParseFailure(lexed.diagnostics[0])
    const inner = parseTokens([{ type: 'identifier', value: '__expression__', path, line: segment.line, column: segment.column }, ...lexed.tokens], path, false)
    // The expression-only entry below is selected by a sentinel added to the front.
    return inner.expression
  }

  if (is('__expression__')) { take(); const parsed = expression(0); if (current().type !== 'eof') fail('BICEP_SYNTAX', 'Unexpected token after interpolation.'); return { expression: parsed } }
  const declarations = []; const names = new Set(); let using = null; let targetScope = 'resourceGroup'
  while (current().type !== 'eof') {
    if (parameterFile) {
      const token = current()
      if (accept('using')) {
        if (using || declarations.length) fail('BICEP_SYNTAX', 'using must appear once before parameters.', token)
        if (current().type !== 'string') fail('BICEP_SYNTAX', 'Expected a local using path.')
        const pathToken = take(); using = pathToken.value
        if (using !== expectedUsing) unsupported(`Only ${expectedUsing} is supported.`, pathToken)
        continue
      }
      if (!accept('param')) fail('BICEP_SYNTAX', 'Only literal param assignments are supported in .bicepparam.')
      const name = identifier(); expect('='); const value = expression(0, true)
      if (names.has(name.value)) fail('DUPLICATE_BICEP_DECLARATION', `Duplicate parameter ${name.value}.`, token)
      names.add(name.value); declarations.push({ kind: 'paramAssignment', name: name.value, value, ...location(token) })
      continue
    }
    const decorators = []
    while (accept('@')) {
      const atToken = tokens[pos - 1]; const name = identifier()
      if (!['description', 'allowed', 'minValue', 'maxValue'].includes(name.value)) unsupported(`Decorator @${name.value} is outside this Bicep subset.`, atToken)
      expect('('); const value = expression(); expect(')')
      decorators.push({ name: name.value, value, ...location(atToken) })
    }
    const token = take()
    if (token.type !== 'identifier') fail('BICEP_SYNTAX', 'Expected a Bicep declaration.', token)
    if (token.value === 'targetScope') {
      if (declarations.length || decorators.length) fail('BICEP_SYNTAX', 'targetScope must precede declarations.', token)
      expect('='); if (current().type !== 'string') fail('BICEP_SYNTAX', 'Expected a target scope string.')
      const scope = take(); if (scope.value !== 'resourceGroup') unsupported('Only resource-group Bicep scope is supported.', token)
      targetScope = scope.value; continue
    }
    if (['metadata', 'import', 'type', 'func', 'assert', 'extension'].includes(token.value)) unsupported(`${token.value} is outside this Bicep subset.`, token)
    if (!['param', 'var', 'resource', 'module', 'output'].includes(token.value)) fail('BICEP_SYNTAX', `Unknown declaration ${token.value}.`, token)
    if (decorators.length && token.value !== 'param') fail('BICEP_SYNTAX', 'Decorators may only precede parameters.', token)
    const name = identifier()
    if (names.has(name.value)) fail('DUPLICATE_BICEP_DECLARATION', `Duplicate declaration ${name.value}.`, token)
    names.add(name.value)
    const declaration = { kind: token.value, name: name.value, ...location(token) }
    if (token.value === 'param' || token.value === 'output') {
      const type = identifier(); declaration.type = type.value
      if (!['string', 'int', 'bool', 'object', 'array'].includes(type.value)) unsupported(`Type ${type.value} is outside this Bicep subset.`, type)
      if (token.value === 'output') { expect('='); declaration.value = expression() }
      else if (accept('=')) declaration.default = expression()
      if (token.value === 'param') declaration.decorators = decorators
    } else if (token.value === 'var') { expect('='); declaration.value = expression() }
    else {
      if (current().type !== 'string') fail('BICEP_SYNTAX', 'Expected a resource type or module path.')
      const reference = take(); declaration.reference = reference.value
      if (reference.segments.some(segment => segment.kind === 'expression')) unsupported('Interpolated module/type paths are outside this Bicep subset.', reference)
      if (token.value === 'module' && !/^\.\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.bicep$/.test(reference.value)) unsupported('Only relative local Bicep modules are supported.', reference)
      if (token.value === 'resource') declaration.existing = accept('existing')
      if (is('if') || is('for')) unsupported('Conditional or iterative declarations are outside this Bicep subset.')
      expect('='); declaration.value = expression()
      if (declaration.value.kind !== 'object') fail('BICEP_SYNTAX', 'Resource and module bodies must be objects.', token)
      const scope = declaration.value.properties.find(property => property.key === 'scope')
      if (scope && (token.value !== 'resource' || scope.value.kind !== 'identifier'))
        unsupported('Only a local resource reference may be used as resource scope.', token)
    }
    declarations.push(declaration)
  }
  if (parameterFile && !using) fail('BICEP_SYNTAX', `A .bicepparam file requires using ${expectedUsing}.`, tokens[0])
  return { kind: parameterFile ? 'bicepparam' : 'bicep', path, using, targetScope, declarations }
}

function parse(text, path, parameterFile, options = {}) {
  const lexed = lexBicep(text, path, options)
  if (lexed.diagnostics.length) return { ast: null, diagnostics: lexed.diagnostics, tokenCount: lexed.tokenCount }
  try { return { ast: parseTokens(lexed.tokens, path, parameterFile, options.expectedUsing), diagnostics: [], tokenCount: lexed.tokenCount } }
  catch (error) { if (error instanceof ParseFailure) return { ast: null, diagnostics: [error.diagnostic], tokenCount: lexed.tokenCount }; throw error }
}

export const parseBicep = (text, path = '', options = {}) => parse(text, path, false, options)
export const parseBicepParams = (text, path = '', options = {}) => parse(text, path, true, options)

export function bicepRootPath(manifest, parameterPath) {
  if (!(manifest?.bicepFiles ?? manifest?.files)?.includes(parameterPath) || !parameterPath.endsWith('.bicepparam')) return null
  const root = manifest.bicepRoots ? manifest.bicepRoots[parameterPath] : 'infra/main.bicep'
  return (manifest.bicepFiles ?? manifest.files).includes(root) && root.endsWith('.bicep') ? root : null
}

// AST: {kind,path,declarations}; declarations have kind/name/location and expression nodes.
// Expressions: integer|boolean|null|string|interpolatedString|identifier|array(items)|object(properties)|member(object,property)|call(name,args).
export function parseBicepProject(savedFiles, manifest, parameterPath = undefined) {
  const diagnostics = []; const files = {}; let params = null; let totalBytes = 0; let totalTokens = 0
  const listed = (manifest?.bicepFiles ?? manifest?.files ?? []).filter(path => /\.bicep(param)?$/.test(path))
  const choices = listed.filter(path => path.endsWith('.bicepparam'))
  const selected = parameterPath ?? (choices.length === 1 ? choices[0] : undefined)
  if (!selected || !choices.includes(selected)) diagnostics.push(bicepDiagnostic('BICEP_PARAMETER_PATH',
    'Select a manifest-listed local .bicepparam file.', String(parameterPath ?? ''), 1, 1))
  const root = bicepRootPath(manifest, selected)
  const paths = manifest?.bicepRoots ? [selected, root].filter(Boolean)
    : listed.filter(path => !path.endsWith('.bicepparam') || path === selected)
  if (selected && !root) diagnostics.push(bicepDiagnostic('BICEP_PARAMETER_PATH',
    'The parameter file has no manifest-listed local root.', selected, 1, 1))
  const seen = new Set()
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index]
    if (seen.has(path)) continue
    seen.add(path)
    if (seen.size > BICEP_LIMITS.files) { diagnostics.push(bicepDiagnostic('BICEP_FILE_LIMIT', 'Too many reachable Bicep files.', path, 1, 1)); break }
    const text = savedFiles?.[path]
    if (typeof text !== 'string') { diagnostics.push(bicepDiagnostic('MISSING_FILE', 'A manifest-listed Bicep file is missing.', path, 1, 1)); continue }
    const size = new TextEncoder().encode(text).length; totalBytes += size
    if (size > BICEP_LIMITS.bytesPerFile) { diagnostics.push(bicepDiagnostic('BICEP_TEXT_LIMIT', 'Bicep file exceeds 32 KiB.', path, 1, 1)); continue }
    const result = path.endsWith('.bicepparam') ? parseBicepParams(text, path,
      { expectedUsing: root ? `./${root.slice(root.lastIndexOf('/') + 1)}` : './main.bicep' }) : parseBicep(text, path)
    totalTokens += result.tokenCount
    diagnostics.push(...result.diagnostics)
    if (result.ast) {
      files[path] = result.ast
      if (path.endsWith('.bicepparam')) params = result.ast
    }
    for (const declaration of result.ast?.declarations ?? []) {
      if (declaration.kind !== 'module') continue
      const directory = path.slice(0, path.lastIndexOf('/') + 1)
      const target = directory + declaration.reference.slice(2)
      const foreignRoot = manifest?.bicepRoots && target !== root
        && Object.values(manifest.bicepRoots).includes(target)
      if (!listed.includes(target) || target.endsWith('.bicepparam') || foreignRoot) diagnostics.push(bicepDiagnostic('UNSUPPORTED_BICEP',
        'Module path must name a manifest-listed local Bicep file.', path, declaration.line, declaration.column))
      else if (manifest?.bicepRoots && !seen.has(target) && !paths.includes(target)) paths.push(target)
    }
  }
  if (totalBytes > BICEP_LIMITS.bytesTotal) diagnostics.push(bicepDiagnostic('BICEP_TEXT_LIMIT', 'Aggregate Bicep text exceeds 128 KiB.', paths[0] ?? '', 1, 1))
  if (totalTokens > BICEP_LIMITS.tokensTotal) diagnostics.push(bicepDiagnostic('BICEP_TOKEN_LIMIT', 'Aggregate Bicep tokens exceed 30000.', paths[0] ?? '', 1, 1))
  return { files, params, rootPath: root, sourcePaths: [...seen], diagnostics, tokenCount: totalTokens }
}
