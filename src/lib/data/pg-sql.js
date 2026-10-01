// Pure, bounded PostgreSQL subset. No SQL execution or network access.
const TYPES = new Set(['bigint', 'int', 'integer', 'text', 'jsonb', 'timestamptz', 'boolean', 'vector', 'halfvec'])
const OPCLASSES = new Set(['vector_cosine_ops', 'vector_l2_ops', 'vector_ip_ops', 'halfvec_cosine_ops', 'jsonb_path_ops', 'jsonb_ops'])
const DISTANCE = new Set(['<=>', '<->', '<#>'])
const COMPARISON = new Set(['=', '<>', '<', '<=', '>', '>=', '@>'])
const SETTINGS = new Set(['hnsw.ef_search', 'ivfflat.probes', 'hnsw.iterative_scan', 'maintenance_work_mem'])

function failure(message, offset = 0, code = 'DATA_UNSUPPORTED') {
  const error = new Error(message)
  return Object.assign(error, { offset, code })
}

function tokenize(text) {
  if (text.length > 1_000_000) throw failure('SQL exceeds the simulator size limit.')
  const tokens = []
  let i = 0
  const push = (type, value, offset) => {
    if (tokens.length >= 100_000) throw failure('SQL exceeds the simulator token limit.', offset)
    tokens.push({ type, value, offset })
  }
  while (i < text.length) {
    if (/\s/.test(text[i])) { i++; continue }
    if (text.startsWith('--', i)) {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (text.startsWith('/*', i)) {
      const start = i
      let depth = 1
      i += 2
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) { depth++; i += 2 }
        else if (text.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
      if (depth) throw failure('Unterminated block comment.', start, 'SyntaxError')
      continue
    }
    const start = i
    const quote = text[i]
    if (quote === "'" || quote === '"') {
      let value = ''; let closed = false
      i++
      while (i < text.length) {
        if (text[i] === quote) {
          i++
          if (text[i] === quote) { value += quote; i++; continue }
          closed = true; break
        }
        value += text[i++]
      }
      if (!closed) throw failure('Unterminated quoted value.', start, 'SyntaxError')
      push(quote === "'" ? 'literal' : 'identifier', value, start)
      continue
    }
    const parameter = text.slice(i).match(/^(%s|%\(([A-Za-z_][A-Za-z0-9_]*)\)s|\$(\d+))/)
    if (parameter) {
      const value = parameter[2] ? { kind: 'param', style: 'named', name: parameter[2] }
        : parameter[3] ? { kind: 'param', style: 'numbered', index: Number(parameter[3]) - 1 }
          : { kind: 'param', style: 'positional' }
      if (value.index !== undefined && (!Number.isSafeInteger(value.index) || value.index < 0)) throw failure('Parameter numbers start at $1.', start)
      push('parameter', value, start); i += parameter[0].length; continue
    }
    const number = text.slice(i).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)
    if (number) {
      const value = Number(number[0])
      if (!Number.isFinite(value)) throw failure('Numeric literal must be finite.', start)
      push('literal', value, start); i += number[0].length; continue
    }
    const word = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_$]*/)
    if (word) { push('word', word[0].toLowerCase(), start); i += word[0].length; continue }
    const symbol = ['<=>', '<->', '<#>', '->>', '::', '@>', '<>', '<=', '>='].find(op => text.startsWith(op, i))
      ?? ('(),;.*=<>'.includes(text[i]) ? text[i] : null)
    if (!symbol) throw failure(`Unsupported SQL token '${text[i]}'.`, i)
    push('symbol', symbol, start); i += symbol.length
  }
  tokens.push({ type: 'end', value: '', offset: text.length })
  return tokens
}

class Parser {
  constructor(tokens) { this.tokens = tokens; this.i = 0; this.paramIndex = 0; this.depth = 0 }
  current() { return this.tokens[this.i] }
  is(value) { const t = this.current(); return t.value === value && (t.type === 'word' || t.type === 'symbol') }
  take(value) { if (!this.is(value)) return false; this.i++; return true }
  expect(value) { if (!this.take(value)) this.fail(`Expected '${value}'.`) }
  fail(message) { throw failure(message, this.current().offset) }
  identifier() {
    const t = this.current()
    if (!['word', 'identifier'].includes(t.type)) this.fail('Expected an identifier.')
    this.i++; return t.value
  }
  name() { const name = this.identifier(); return this.take('.') ? `${name}.${this.identifier()}` : name }
  list(parseOne) {
    const entries = [parseOne.call(this)]
    while (this.take(',')) entries.push(parseOne.call(this))
    return entries
  }
  ifNotExists() { if (!this.take('if')) return false; this.expect('not'); this.expect('exists'); return true }
  integer(positive = false) {
    const t = this.current()
    if (t.type !== 'literal' || !Number.isSafeInteger(t.value) || t.value < (positive ? 1 : 0)) this.fail('Expected an integer in the supported range.')
    this.i++; return t.value
  }
  type(requireDimensions = true) {
    const type = this.identifier()
    if (!TYPES.has(type)) this.fail(`Type '${type}' is not supported.`)
    const result = { type }
    if (type === 'vector' || type === 'halfvec') {
      if (this.take('(')) { result.dimensions = this.integer(true); this.expect(')') }
      else if (requireDimensions) this.fail('Vector column types require dimensions.')
    }
    return result
  }
  cast(expression) { return this.take('::') ? { kind: 'cast', expression, ...this.type(false) } : expression }
  value() {
    const t = this.current()
    let value
    if (t.type === 'parameter') {
      value = { ...t.value }
      if (value.style === 'positional') value.index = this.paramIndex++
    } else if (t.type === 'literal') value = t.value
    else if (this.is('null')) value = null
    else if (this.is('true') || this.is('false')) value = this.is('true')
    else this.fail('Expected a literal or parameter.')
    this.i++
    return this.cast(value)
  }
  expression() {
    if (++this.depth > 32) this.fail('Expression nesting exceeds the simulator limit.')
    let expression
    if (this.take('(')) { expression = this.expression(); this.expect(')') }
    else {
      const name = this.identifier()
      expression = this.take('.') ? { kind: 'column', table: name, name: this.identifier() } : { kind: 'column', name }
      if (this.take('->>')) {
        const key = this.current()
        if (key.type !== 'literal' || typeof key.value !== 'string') this.fail('JSON extraction requires a quoted key.')
        this.i++; expression = { kind: 'json-extract', column: expression, key: key.value }
      }
    }
    expression = this.cast(expression)
    if (DISTANCE.has(this.current().value)) {
      const operator = this.current().value
      this.i++; expression = { kind: 'distance', column: expression, operator, value: this.value() }
    }
    this.depth--
    return expression
  }
  condition() {
    const expression = this.expression()
    const base = { expression }
    if (expression.kind === 'column') { base.column = expression.name; if (expression.table) base.table = expression.table }
    if (this.take('in')) {
      this.expect('('); const values = this.list(this.value); this.expect(')')
      return { ...base, operator: 'in', values }
    }
    const operator = this.current().value
    if (!COMPARISON.has(operator)) this.fail('Expected a supported comparison operator.')
    this.i++; return { ...base, operator, value: this.value() }
  }
  where() {
    if (!this.take('where')) return []
    const conditions = [this.condition()]
    while (this.take('and')) conditions.push(this.condition())
    return conditions
  }
  columnDefinition() {
    const column = { name: this.identifier(), ...this.type() }
    const seen = new Set()
    while (['primary', 'not', 'references', 'generated', 'default'].some(word => this.is(word))) {
      const option = this.current().value
      if (seen.has(option)) this.fail(`Repeated column option '${option}'.`)
      seen.add(option); this.i++
      if (option === 'primary') { this.expect('key'); column.primaryKey = true }
      else if (option === 'not') { this.expect('null'); column.notNull = true }
      else if (option === 'references') {
        const table = this.name(); this.expect('('); const name = this.identifier(); this.expect(')')
        column.references = { table, column: name }
      } else if (option === 'generated') {
        this.expect('always'); this.expect('as'); this.expect('identity'); column.identity = true
      } else {
        this.expect('now'); this.expect('('); this.expect(')'); column.default = { kind: 'now' }
      }
    }
    return column
  }
  createTable() {
    const ifNotExists = this.ifNotExists(); const name = this.name()
    this.expect('(')
    const columns = []; let primaryKey = []
    do {
      if (this.take('primary')) {
        if (primaryKey.length) this.fail('Only one table primary key is supported.')
        this.expect('key'); this.expect('('); primaryKey = [this.identifier()]; this.expect(')')
      } else columns.push(this.columnDefinition())
    } while (this.take(','))
    this.expect(')')
    if (!columns.length) this.fail('A table requires column definitions.')
    return { kind: 'create-table', name, ifNotExists, columns, primaryKey }
  }
  indexColumn() {
    let column
    if (this.take('(')) { column = { expression: this.expression() }; this.expect(')') }
    else column = { name: this.name() }
    if (this.current().type === 'word' || this.current().type === 'identifier') {
      const opclass = this.identifier()
      if (!OPCLASSES.has(opclass)) this.fail(`Operator class '${opclass}' is not supported.`)
      column.opclass = opclass
    }
    return column
  }
  createIndex() {
    const concurrently = this.take('concurrently'); const ifNotExists = this.ifNotExists(); const name = this.name()
    this.expect('on'); const table = this.name()
    const method = this.take('using') ? this.identifier() : 'btree'
    if (!['btree', 'gin', 'hnsw', 'ivfflat'].includes(method)) this.fail(`Index method '${method}' is not supported.`)
    this.expect('('); const columns = this.list(this.indexColumn); this.expect(')')
    const options = {}
    if (this.take('with')) {
      this.expect('(')
      do {
        const key = this.identifier(); this.expect('='); const value = this.value()
        Object.defineProperty(options, key, { value, enumerable: true, configurable: true, writable: true })
      } while (this.take(','))
      this.expect(')')
    }
    return { kind: 'create-index', name, table, method, columns, with: options, where: this.where(), concurrently, ifNotExists }
  }
  insert() {
    this.expect('into'); const table = this.name()
    this.expect('('); const columns = this.list(this.identifier); this.expect(')'); this.expect('values')
    const rows = this.list(function () {
      this.expect('('); const values = this.list(this.value); this.expect(')')
      if (values.length !== columns.length) this.fail('INSERT column and value counts must match.')
      return values
    })
    return { kind: 'insert', table, columns, rows }
  }
  relation() {
    const table = this.name()
    if (this.take('as')) return { table, alias: this.identifier() }
    const reserved = ['join', 'where', 'order', 'limit', 'on', 'full', 'left', 'right', 'inner', 'outer', 'cross', 'group', 'union', 'offset', 'having']
    return this.current().type === 'identifier' || (this.current().type === 'word' && !reserved.includes(this.current().value))
      ? { table, alias: this.identifier() } : { table }
  }
  select(explain) {
    this.expect('select')
    const columns = this.list(function () {
      const expression = this.take('*') ? { kind: 'star' } : this.expression()
      if (this.take('as')) expression.alias = this.identifier()
      return expression
    })
    this.expect('from'); const relation = this.relation(); const joins = []
    if (this.take('join')) {
      const joined = this.relation(); this.expect('on'); const left = this.expression(); this.expect('='); const right = this.expression()
      if (left.kind !== 'column' || right.kind !== 'column' || !left.table || !right.table) this.fail('JOIN requires qualified column equality.')
      joins.push({ ...joined, on: { left, right, operator: '=' } })
    }
    const where = this.where(); let orderBy = []
    if (this.take('order')) {
      this.expect('by')
      orderBy = this.list(function () {
        const expression = this.expression()
        const direction = this.take('desc') ? 'DESC' : (this.take('asc'), 'ASC')
        return { ...expression, direction }
      })
    }
    let limit = null
    if (this.take('limit')) limit = this.current().type === 'parameter' ? this.value() : this.integer()
    return { kind: 'select', ...relation, columns, joins, where, orderBy, limit, ...(explain ? { explain } : {}) }
  }
  statement() {
    this.paramIndex = 0
    if (this.take('create')) {
      if (this.take('extension')) return { kind: 'create-extension', ifNotExists: this.ifNotExists(), name: this.name() }
      if (this.take('table')) return this.createTable()
      if (this.take('index')) return this.createIndex()
    } else if (this.take('drop')) {
      this.expect('index'); let ifExists = false
      if (this.take('if')) { this.expect('exists'); ifExists = true }
      return { kind: 'drop-index', ifExists, name: this.name() }
    } else if (this.take('set')) {
      const name = this.name()
      if (!SETTINGS.has(name)) this.fail(`Setting '${name}' is not supported.`)
      if (!this.take('=')) this.expect('to')
      const value = this.current().type === 'word' && !['true', 'false', 'null'].includes(this.current().value) ? this.identifier() : this.value()
      return { kind: 'set', name, value }
    } else if (this.take('insert')) return this.insert()
    else if (this.take('explain')) {
      let analyze = false
      if (this.take('(')) { this.expect('analyze'); analyze = true; this.expect(')') }
      else analyze = this.take('analyze')
      return this.select({ analyze })
    } else if (this.is('select')) return this.select()
    this.fail('Unsupported SQL statement.')
  }
  parse() {
    const statements = []
    while (this.current().type !== 'end') {
      if (this.take(';')) continue
      if (statements.length >= 1000) this.fail('Statement count exceeds the simulator limit.')
      statements.push(this.statement())
      if (this.current().type !== 'end' && !this.take(';')) this.fail('Unexpected tokens after the statement.')
    }
    return { statements }
  }
}

export function parsePgSql(text) {
  try {
    if (typeof text !== 'string' || !text.trim()) throw failure('SQL text must be a non-empty string.')
    return new Parser(tokenize(text)).parse()
  } catch (error) {
    const prefix = typeof text === 'string' ? text.slice(0, error.offset ?? 0) : ''
    const code = error.code === 'SyntaxError' ? 'SyntaxError' : 'DATA_UNSUPPORTED'
    return { error: { code, message: `${code === 'DATA_UNSUPPORTED' ? 'Not supported by the simulator: ' : ''}${error.message}`,
      line: prefix.split('\n').length, column: prefix.length - prefix.lastIndexOf('\n') } }
  }
}

// Returns a cloned statement directly, never { statement }. Parameter values stay
// data: they are substituted into the AST without re-tokenizing SQL text.
export function bindParams(stmt, params) {
  const refs = []
  const visit = (node, resolve, depth = 0) => {
    if (depth > 100) throw new Error('Invalid statement nesting.')
    if (node === null || typeof node !== 'object') return node
    if (node.kind === 'param') { refs.push(node); return resolve ? resolve(node) : node }
    if (Array.isArray(node)) return node.map(value => visit(value, resolve, depth + 1))
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, visit(value, resolve, depth + 1)]))
  }
  try {
    if (!stmt || typeof stmt !== 'object' || !stmt.kind || stmt.error) throw new Error('A parsed statement is required.')
    visit(stmt)
    const styles = new Set(refs.map(ref => ref.style))
    if (styles.size > 1) throw new Error('Parameter placeholder styles cannot be mixed.')
    const style = refs[0]?.style
    if (style === 'named') {
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Named parameters require a dictionary.')
      for (const ref of refs) if (!Object.hasOwn(params, ref.name) || params[ref.name] === undefined) throw new Error(`Missing parameter '${ref.name}'.`)
    } else if (refs.length || Array.isArray(params)) {
      if (!Array.isArray(params)) throw new Error('Positional parameters require a list or tuple.')
      const count = refs.reduce((max, ref) => Math.max(max, ref.index + 1), 0)
      if (params.length !== count || refs.some(ref => params[ref.index] === undefined)) throw new Error(`Expected ${count} parameters, received ${params.length}.`)
    } else if (params !== undefined && params !== null && (typeof params !== 'object' || Object.keys(params).length)) {
      throw new Error('The statement has no parameter placeholders.')
    }
    return visit(stmt, ref => style === 'named' ? params[ref.name] : params[ref.index])
  } catch (error) {
    return { error: { code: 'ProgrammingError', message: error.message } }
  }
}
