export const BICEP_LIMITS = Object.freeze({ files: 12, bytesPerFile: 32 * 1024, bytesTotal: 128 * 1024,
  tokensPerFile: 10000, tokensTotal: 30000, expressionDepth: 32, interpolationSegments: 32, interpolationTokens: 1024 })

export function bicepDiagnostic(code, message, path, line, column) { return { code, message, path, line, column } }

export function lexBicep(text, path = '', options = {}) {
  const diagnostics = []; const tokens = []
  if (typeof text !== 'string') return { tokens, diagnostics: [bicepDiagnostic('INVALID_FILE', 'Bicep files must be text.', path, 1, 1)] }
  const maxTokens = options.maxTokens ?? BICEP_LIMITS.tokensPerFile
  let index = 0; let line = options.line ?? 1; let column = options.column ?? 1; let nestedTokens = 0
  const at = () => ({ path, line, column })
  const error = (code, message, location = at()) => diagnostics.push(bicepDiagnostic(code, message, location.path, location.line, location.column))
  const advance = () => { const char = text[index++]; if (char === '\n') { line++; column = 1 } else column++; return char }
  const add = (type, value, location, extra = {}) => {
    if (tokens.length + nestedTokens >= maxTokens) { if (!diagnostics.some(item => item.code === 'BICEP_TOKEN_LIMIT')) error('BICEP_TOKEN_LIMIT', `Bicep is limited to ${maxTokens} tokens per file.`, location); return }
    tokens.push({ type, value, ...location, ...extra })
  }
  const scanString = () => {
    const location = at(); advance(); let value = ''; let segment = ''; const segments = []; let closed = false
    const flush = () => { if (segment) { segments.push({ kind: 'text', value: segment }); segment = '' } }
    while (index < text.length) {
      const char = text[index]
      if (char === '\n' || char === '\r') break
      if (char === "'") { advance(); closed = true; break }
      if (char === '\\') {
        const start = at(); advance(); const escape = text[index]
        if (escape === '$' && text[index + 1] !== '{') { error('BICEP_SYNTAX', 'A dollar escape must precede {.', start); return }
        if (escape === 'u') {
          advance()
          if (text[index] !== '{') { error('BICEP_SYNTAX', 'Expected { after Unicode escape.', start); return }
          advance(); let hex = ''
          while (index < text.length && text[index] !== '}' && hex.length <= 6) hex += advance()
          if (text[index] !== '}' || !/^[0-9a-fA-F]{1,6}$/.test(hex)) { error('BICEP_SYNTAX', 'Invalid Unicode escape.', start); return }
          advance(); const point = Number.parseInt(hex, 16)
          if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) { error('BICEP_SYNTAX', 'Unicode escape is not a scalar value.', start); return }
          const decoded = String.fromCodePoint(point); segment += decoded; value += decoded; continue
        }
        const decoded = { n: '\n', r: '\r', t: '\t', "'": "'", '\\': '\\', '$': '$' }[escape]
        if (decoded === undefined) { error('BICEP_SYNTAX', 'Invalid Bicep string escape.', start); return }
        advance(); segment += decoded; value += decoded; continue
      }
      if (char === '$' && text[index + 1] === '{') {
        flush(); const start = at(); advance(); advance(); let depth = 1; let expression = ''; let quoted = false
        while (index < text.length && depth) {
          const current = text[index]
          if (quoted && current === '\\' && index + 1 < text.length) { expression += advance() + advance(); continue }
          if (current === "'") {
            quoted = !quoted; expression += advance(); continue
          }
          if (!quoted && current === '{') depth++
          if (!quoted && current === '}') { depth--; if (!depth) { advance(); break } }
          expression += advance()
        }
        if (depth || !expression.trim()) { error('BICEP_SYNTAX', 'Malformed string interpolation.', start); return }
        segments.push({ kind: 'expression', text: expression, ...start })
        if (segments.filter(item => item.kind === 'expression').length > BICEP_LIMITS.interpolationSegments) {
          error('BICEP_INTERPOLATION_LIMIT', 'Too many interpolation segments.', start); return
        }
        if ((options.interpolationDepth ?? 0) >= BICEP_LIMITS.expressionDepth) { error('BICEP_DEPTH_LIMIT', 'Nested interpolation depth exceeds 32.', start); return }
        const inner = lexBicep(expression, path, { maxTokens: BICEP_LIMITS.interpolationTokens, line: start.line, column: start.column + 2,
          interpolationDepth: (options.interpolationDepth ?? 0) + 1 })
        if (inner.diagnostics.length) { diagnostics.push(...inner.diagnostics.map(item => item.code === 'BICEP_TOKEN_LIMIT'
          ? { ...item, code: 'BICEP_INTERPOLATION_LIMIT', message: 'Interpolation exceeds its token limit.' } : item)); return }
        nestedTokens += inner.tokenCount
        value += '${' + expression + '}'
        continue
      }
      segment += advance(); value += char
    }
    if (!closed) { error('BICEP_SYNTAX', 'Unterminated Bicep string.', location); return }
    flush(); add('string', value, location, { segments })
  }
  while (index < text.length && !diagnostics.length) {
    const char = text[index]
    if (/\s/.test(char)) { advance(); continue }
    if (char === '/' && text[index + 1] === '/') { while (index < text.length && text[index] !== '\n') advance(); continue }
    if (char === '/' && text[index + 1] === '*') {
      const start = at(); advance(); advance(); let closed = false
      while (index < text.length) { if (text[index] === '*' && text[index + 1] === '/') { advance(); advance(); closed = true; break } advance() }
      if (!closed) error('BICEP_SYNTAX', 'Unterminated block comment.', start)
      continue
    }
    if (char === "'") { scanString(); continue }
    const location = at()
    if (/[A-Za-z_]/.test(char)) { let value = ''; while (index < text.length && /[A-Za-z0-9_]/.test(text[index])) value += advance(); add('identifier', value, location); continue }
    if (/[0-9]/.test(char)) { let value = ''; while (index < text.length && /[0-9]/.test(text[index])) value += advance();
      if (text[index] === '.' && /[0-9]/.test(text[index + 1] ?? '')) { value += advance(); while (index < text.length && /[0-9]/.test(text[index])) value += advance(); add('number', value, location) }
      else add('integer', value, location)
      continue }
    if ('{}[]():,.=@'.includes(char)) { advance(); add(char, char, location); continue }
    if ('+-*/!?<>|'.includes(char)) { advance(); add('operator', char, location); continue }
    error('BICEP_SYNTAX', `Unexpected character ${JSON.stringify(char)}.`, location)
  }
  tokens.push({ type: 'eof', value: '', path, line, column })
  if (!diagnostics.length && tokens.length - 1 + nestedTokens > maxTokens) error('BICEP_TOKEN_LIMIT', `Bicep is limited to ${maxTokens} tokens per file.`, tokens.at(-1))
  return { tokens, diagnostics, tokenCount: tokens.length - 1 + nestedTokens }
}
