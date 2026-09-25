const locationAt = (text, offset, path) => {
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  return { path, line, column: offset - before.lastIndexOf('\n') }
}

function tokenize(text, path) {
  const tokens = []
  let index = 0
  const push = (type, value, start) => tokens.push({ type, value, ...locationAt(text, start, path) })
  while (index < text.length) {
    const start = index
    const char = text[index]
    if (/\s/.test(char)) { index++; continue }
    if (text.startsWith('--', index)) { index = text.indexOf('\n', index); if (index < 0) break; continue }
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2)
      if (end < 0) throw { token: { ...locationAt(text, start, path) }, message: 'Unterminated SQL comment.' }
      index = end + 2
      continue
    }
    if (char === "'") {
      index++
      let value = ''
      let closed = false
      while (index < text.length) {
        if (text[index] === "'" && text[index + 1] === "'") { value += "'"; index += 2; continue }
        if (text[index] === "'") { index++; closed = true; break }
        value += text[index++]
      }
      if (!closed) throw { token: { ...locationAt(text, start, path) }, message: 'Unterminated SQL string.' }
      push('string', value, start)
      continue
    }
    if (char === '"') {
      index++
      let value = ''
      let closed = false
      while (index < text.length) {
        if (text[index] === '"' && text[index + 1] === '"') { value += '"'; index += 2; continue }
        if (text[index] === '"') { index++; closed = true; break }
        value += text[index++]
      }
      if (!closed) throw { token: { ...locationAt(text, start, path) }, message: 'Unterminated quoted identifier.' }
      push('quotedIdentifier', value, start)
      continue
    }
    const placeholder = text.slice(index).match(/^%\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)s/)
    if (placeholder) { index += placeholder[0].length; push('parameter', placeholder[1], start); continue }
    if (/[A-Za-z_]/.test(char)) {
      const word = text.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/)[0]
      index += word.length
      push('word', word.toLowerCase(), start)
      continue
    }
    const operator = ['<=>', '<=', '>=', '<>', '!=', '::'].find(item => text.startsWith(item, index))
    if (operator) { index += operator.length; push('symbol', operator, start); continue }
    if ('=(),;.*'.includes(char)) { index++; push('symbol', char, start); continue }
    throw { token: { ...locationAt(text, start, path) }, message: `Unsupported SQL token '${char}'.` }
  }
  return tokens
}

class Parser {
  constructor(tokens, text, path) { this.tokens = tokens; this.text = text; this.path = path; this.index = 0 }
  peek(value) { return this.tokens[this.index]?.value === value }
  take(value) {
    const token = this.tokens[this.index]
    const keyword = typeof value === 'string' && /^[a-z]+$/.test(value)
    if (!token || (value !== undefined && (token.value !== value || (keyword && token.type !== 'word')))) this.fail(token, `Expected ${value ?? 'SQL token'}.`)
    this.index++
    return token
  }
  word(value) { return this.peek(value) && this.tokens[this.index].type === 'word' }
  identifier() {
    const token = this.take()
    if (!['word', 'quotedIdentifier'].includes(token.type)) this.fail(token, 'Expected a SQL identifier.')
    return token.type === 'word' ? token.value.toLowerCase() : token.value
  }
  parameter() {
    const token = this.take()
    if (token.type !== 'parameter') this.fail(token, 'Expected an unquoted named SQL parameter.')
    return token.value
  }
  fail(token = this.tokens[this.index], message = 'Unsupported SQL syntax.') {
    const location = token ?? { ...locationAt(this.text, this.text.length, this.path) }
    throw { token: location, message }
  }
  parse() {
    this.take('select')
    const columns = [this.identifier()]
    while (this.peek(',')) { this.take(','); columns.push(this.identifier()) }
    if (columns.length !== 2 || columns[0] !== 'id' || columns[1] !== 'content') this.fail(this.tokens[0], 'Query must select id and content.')
    this.take('from')
    if (this.identifier() !== 'documents') this.fail(this.tokens[this.index - 1], 'Query must select from documents.')
    const filters = []
    let distance = null
    if (this.word('where')) {
      this.take('where')
      do {
        if (this.peek('(')) {
          this.take('('); this.take('embedding'); this.take('<=>')
          const vectorParameter = this.parameter()
          this.take('::')
          if (this.identifier() !== 'vector') this.fail(this.tokens[this.index - 1], 'Cosine parameter must be cast to vector.')
          this.take(')'); this.take('<=')
          distance = { parameter: vectorParameter, cutoffParameter: this.parameter() }
        } else {
          const column = this.identifier()
          if (!['collection', 'audience', 'published'].includes(column)) this.fail(this.tokens[this.index - 1], `Unsupported WHERE column '${column}'.`)
          this.take('=')
          filters.push({ column, parameter: this.parameter() })
        }
        if (this.word('or')) this.fail(this.tokens[this.index], 'OR is outside the supported retrieval SQL subset.')
        if (this.word('and')) this.take('and')
        else break
      } while (true)
    }
    this.take('order'); this.take('by'); this.take('embedding'); this.take('<=>')
    const vectorParameter = this.parameter()
    if (this.peek('::')) { this.take('::'); if (this.identifier() !== 'vector') this.fail(this.tokens[this.index - 1], 'Cosine parameter must be cast to vector.') }
    const direction = this.word('asc') || this.word('desc') ? this.take().value.toUpperCase() : 'ASC'
    this.take(','); this.take('id')
    const idDirection = this.word('asc') || this.word('desc') ? this.take().value.toUpperCase() : 'ASC'
    this.take('limit')
    const limitParameter = this.parameter()
    if (this.peek(';')) this.take(';')
    if (this.index !== this.tokens.length) this.fail(this.tokens[this.index], 'Only one SELECT statement is supported.')
    return { version: 1, filters, distance, order: { vectorParameter, direction, idDirection }, limitParameter }
  }
}

export function parseRetrievalSql(text, path = 'retrieval.sql') {
  try {
    if (typeof text !== 'string') throw { token: { path, line: 1, column: 1 }, message: 'SQL source must be text.' }
    const tokens = tokenize(text, path)
    const querySpec = new Parser(tokens, text, path).parse()
    return { querySpec, diagnostics: [] }
  } catch (error) {
    const token = error.token ?? { path, line: 1, column: 1 }
    return { querySpec: null, diagnostics: [{ code: 'SQL_UNSUPPORTED', message: error.message ?? 'Unsupported SQL syntax.', path, line: token.line ?? 1, column: token.column ?? 1 }] }
  }
}
