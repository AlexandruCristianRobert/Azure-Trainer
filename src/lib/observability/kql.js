// A deliberately bounded, browser-only KQL subset. Parsing never executes host
// code. Rows are detached typed telemetry records with an exact `table` name.
const TABLES = new Set(['AppRequests', 'AppDependencies', 'AppExceptions', 'AppTraces', 'AppMetrics'])
const CONVERSIONS = new Set(['tostring', 'toint', 'todouble'])
const AGGREGATES = new Set(['count', 'countif', 'sum', 'avg', 'min', 'max'])
const FORBIDDEN_NAMES = new Set(['__proto__', 'prototype', 'constructor'])
const HARD_LIMITS = Object.freeze({ maxSourceBytes: 16384, maxOperators: 16, maxInputRows: 500, maxOutputRows: 200 })
const MAX_TOKENS = 4096
const MAX_NODES = 1024
const MAX_DEPTH = 32
const MAX_COLUMNS = 64
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const fail = message => { throw new Error(`KQL: ${message}`) }
const digit = char => char >= '0' && char <= '9'
const letter = char => (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || char === '_'
const space = char => char === ' ' || char === '\t' || char === '\r' || char === '\n'
const numeric = value => typeof value === 'number' && Number.isFinite(value)

function tokenize(source) {
  const tokens = []
  let index = 0
  const add = (kind, value, start) => {
    if (tokens.length >= MAX_TOKENS) fail('token limit exceeded')
    tokens.push({ kind, value, start })
  }
  while (index < source.length) {
    const start = index
    const char = source[index]
    if (space(char)) { index++; continue }
    if (letter(char)) {
      index++
      while (letter(source[index]) || digit(source[index])) index++
      add('identifier', source.slice(start, index), start)
    } else if (digit(char) || (char === '.' && digit(source[index + 1]))) {
      while (digit(source[index])) index++
      if (source[index] === '.') { index++; while (digit(source[index])) index++ }
      if (source[index] === 'e' || source[index] === 'E') {
        index++
        if (source[index] === '+' || source[index] === '-') index++
        if (!digit(source[index])) fail(`invalid number at ${start}`)
        while (digit(source[index])) index++
      }
      const value = Number(source.slice(start, index))
      if (!Number.isFinite(value)) fail(`invalid number at ${start}`)
      add('number', value, start)
    } else if (char === '"' || char === "'") {
      const quote = char
      let value = ''
      let closed = false
      index++
      while (index < source.length) {
        const current = source[index++]
        if (current === quote) { closed = true; break }
        if (current !== '\\') { value += current; continue }
        if (index >= source.length) fail(`unterminated string at ${start}`)
        const escaped = source[index++]
        const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', '"': '"', "'": "'" }
        if (own(escapes, escaped)) value += escapes[escaped]
        else if (escaped === 'u') {
          const hex = source.slice(index, index + 4)
          if (hex.length !== 4 || [...hex].some(part => !digit(part) && !(part.toLowerCase() >= 'a' && part.toLowerCase() <= 'f'))) fail(`invalid string escape at ${index}`)
          value += String.fromCharCode(Number.parseInt(hex, 16))
          index += 4
        } else fail(`unsupported string escape at ${index - 1}`)
      }
      if (!closed) fail(`unterminated string at ${start}`)
      add('string', value, start)
    } else {
      const pair = source.slice(index, index + 2)
      if (['==', '!=', '<=', '>='].includes(pair)) { add('symbol', pair, start); index += 2 }
      else if ('|(),[]+-*/%=<>'.includes(char)) { add('symbol', char, start); index++ }
      else fail(`unsupported character at ${start}`)
    }
  }
  tokens.push({ kind: 'end', value: '', start: source.length })
  return tokens
}

class Parser {
  constructor(source) {
    this.tokens = tokenize(source)
    this.index = 0
    this.nodes = 0
  }

  current() { return this.tokens[this.index] }
  // Grammar consumes token kinds as well as values: quoted punctuation and
  // quoted keywords remain literal data even when their text matches syntax.
  is(value, kind = 'symbol', offset = 0) {
    const token = this.tokens[this.index + offset]
    return token?.kind === kind && token.value === value
  }
  match(value, kind = 'symbol') { if (!this.is(value, kind)) return false; this.index++; return true }
  take(value, kind = 'symbol') { if (!this.match(value, kind)) fail(`expected ${value} at ${this.current().start}`) }
  identifier() {
    const token = this.current()
    if (token.kind !== 'identifier' || FORBIDDEN_NAMES.has(token.value)) fail(`expected supported identifier at ${token.start}`)
    this.index++
    return token.value
  }
  node(value) {
    if (++this.nodes > MAX_NODES) fail('expression node limit exceeded')
    return value
  }

  expression(minimum = 0, depth = 0) {
    if (depth >= MAX_DEPTH) fail('expression depth limit exceeded')
    let left
    const token = this.current()
    if (this.match('(')) { left = this.expression(0, depth + 1); this.take(')') }
    else if (this.match('+') || this.match('-')) {
      left = this.node({ kind: 'unary', op: token.value, arg: this.expression(6, depth + 1) })
    } else if (token.kind === 'number' || token.kind === 'string') {
      this.index++
      left = this.node({ kind: 'literal', value: token.value })
    } else if (token.kind === 'identifier') {
      const name = this.identifier()
      if (name === 'true' || name === 'false' || name === 'null') {
        left = this.node({ kind: 'literal', value: name === 'null' ? null : name === 'true' })
      } else if (this.match('(')) {
        if (!CONVERSIONS.has(name)) fail(`unsupported expression function ${name}`)
        const arg = this.expression(0, depth + 1)
        this.take(')')
        left = this.node({ kind: 'call', name, arg })
      } else if (this.match('[')) {
        if (name !== 'Properties' || this.current().kind !== 'string') fail('only Properties["key"] is supported')
        const key = this.current().value
        this.index++
        this.take(']')
        left = this.node({ kind: 'property', key })
      } else left = this.node({ kind: 'field', name })
    } else fail(`expected expression at ${token.start}`)

    const precedence = { or: 1, and: 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '%': 5 }
    while (own(precedence, this.current().value)
      && this.is(this.current().value, ['and', 'or'].includes(this.current().value) ? 'identifier' : 'symbol')
      && precedence[this.current().value] >= minimum) {
      const op = this.current().value
      this.index++
      const right = this.expression(precedence[op] + 1, depth + 1)
      left = this.node({ kind: 'binary', op, left, right })
    }
    return left
  }

  namedExpression(requireAssignment = false) {
    if (this.current().kind === 'identifier' && this.is('=', 'symbol', 1)) {
      const name = this.identifier()
      this.take('=')
      return { name, expression: this.expression() }
    }
    if (requireAssignment) fail('extend requires named assignments')
    const expression = this.expression()
    if (expression.kind !== 'field') fail('computed expressions require an alias')
    return { name: expression.name, expression }
  }

  list(parse) {
    const result = []
    do {
      if (result.length >= MAX_COLUMNS) fail('column limit exceeded')
      result.push(parse())
    } while (this.match(','))
    return result
  }

  unique(items) {
    const names = new Set()
    for (const item of items) {
      if (names.has(item.name)) fail(`duplicate output name ${item.name}`)
      names.add(item.name)
    }
  }

  aggregate() {
    let name
    if (this.current().kind === 'identifier' && this.is('=', 'symbol', 1)) {
      name = this.identifier()
      this.take('=')
    }
    const fn = this.identifier()
    if (!AGGREGATES.has(fn)) fail(`unsupported aggregate ${fn}`)
    this.take('(')
    const expression = fn === 'count' ? null : this.expression()
    this.take(')')
    return { name: name ?? `${fn}_${expression?.kind === 'field' ? expression.name : ''}`, fn, expression }
  }

  operator() {
    const type = this.identifier()
    if (type === 'where') return { type, expression: this.expression() }
    if (type === 'project' || type === 'extend') {
      const columns = this.list(() => this.namedExpression(type === 'extend'))
      this.unique(columns)
      return { type, columns }
    }
    if (type === 'summarize') {
      const aggregates = this.list(() => this.aggregate())
      const groups = this.match('by', 'identifier') ? this.list(() => this.namedExpression()) : []
      this.unique([...groups, ...aggregates])
      return { type, aggregates, groups }
    }
    if (type === 'order') {
      this.take('by', 'identifier')
      const columns = this.list(() => {
        const expression = this.expression()
        const direction = this.match('asc', 'identifier') ? 'asc' : (this.match('desc', 'identifier'), 'desc')
        return { expression, direction }
      })
      return { type, columns }
    }
    if (type === 'take') {
      const token = this.current()
      if (token.kind !== 'number' || !Number.isSafeInteger(token.value) || token.value < 0) fail('take requires a nonnegative integer')
      this.index++
      return { type, count: token.value }
    }
    fail(`unsupported operator ${type}`)
  }

  parse() {
    const table = this.identifier()
    if (!TABLES.has(table)) fail(`unsupported table ${table}`)
    const operators = []
    while (this.match('|')) {
      if (operators.length >= HARD_LIMITS.maxOperators) fail('operator limit exceeded')
      operators.push(this.operator())
    }
    if (this.current().kind !== 'end') fail(`unexpected input at ${this.current().start}`)
    return { table, operators }
  }
}

function freezeAst(value, depth = 0) {
  if (!value || typeof value !== 'object') return value
  if (depth > MAX_DEPTH + 8) fail('expression depth limit exceeded')
  for (const child of Object.values(value)) freezeAst(child, depth + 1)
  return Object.freeze(value)
}

/** Parse supported KQL into an immutable, serializable AST with its exact source. */
export function parseQuery(text) {
  if (typeof text !== 'string') fail('query must be text')
  if (new TextEncoder().encode(text).length > HARD_LIMITS.maxSourceBytes) fail('source byte limit exceeded')
  const parsed = new Parser(text).parse()
  return freezeAst({ source: text, ...parsed })
}

function read(row, name) {
  return row && typeof row === 'object' && own(row, name) ? row[name] ?? null : null
}

// Missing fields and invalid/nonfinite numeric conversions are null. Empty
// strings are invalid numbers. Conversions accept finite decimal/exponent text
// (not JS hex/Infinity); toint truncates toward zero. tostring(null) is ''.
function convert(name, value) {
  if (name === 'tostring') {
    if (value === null) return ''
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }
  if (typeof value === 'string') {
    const source = value.trim()
    if (!source) return null
    try {
      const tokens = tokenize(source)
      let index = 0
      let sign = 1
      if (tokens[index].kind === 'symbol' && (tokens[index].value === '+' || tokens[index].value === '-')) sign = tokens[index++].value === '-' ? -1 : 1
      if (tokens[index].kind !== 'number' || tokens[index + 1].kind !== 'end') return null
      value = sign * tokens[index].value
    } catch { return null }
  }
  if (!numeric(value)) return null
  return name === 'toint' ? Math.trunc(value) : value
}

function evaluate(expression, row) {
  if (expression.kind === 'literal') return expression.value
  if (expression.kind === 'field') return read(row, expression.name)
  if (expression.kind === 'property') return read(read(row, 'Properties'), expression.key)
  if (expression.kind === 'call') return convert(expression.name, evaluate(expression.arg, row))
  if (expression.kind === 'unary') {
    const value = evaluate(expression.arg, row)
    return numeric(value) ? (expression.op === '-' ? -value : value) : null
  }
  const left = evaluate(expression.left, row)
  const right = evaluate(expression.right, row)
  const op = expression.op
  // Three-valued predicates: null comparisons stay null; where/countif accept
  // only true. false AND null is false; true OR null is true.
  if (op === 'and') return left === false || right === false ? false : (left === true && right === true ? true : null)
  if (op === 'or') return left === true || right === true ? true : (left === false && right === false ? false : null)
  if (left === null || right === null) return null
  if (op === '==') return left === right
  if (op === '!=') return left !== right
  if (['<', '<=', '>', '>='].includes(op)) {
    if (typeof left !== typeof right || !['number', 'string', 'boolean'].includes(typeof left)) return null
    if (op === '<') return left < right
    if (op === '<=') return left <= right
    if (op === '>') return left > right
    return left >= right
  }
  if (!numeric(left) || !numeric(right)) return null
  let value
  if (op === '+') value = left + right
  if (op === '-') value = left - right
  if (op === '*') value = left * right
  if (op === '/') value = right === 0 ? null : left / right
  if (op === '%') value = right === 0 ? null : left % right
  return numeric(value) ? value : null
}

function aggregateValue(aggregate, rows) {
  if (aggregate.fn === 'count') return rows.length
  if (aggregate.fn === 'countif') return rows.filter(row => evaluate(aggregate.expression, row) === true).length
  const values = rows.map(row => evaluate(aggregate.expression, row)).filter(numeric)
  if (aggregate.fn === 'sum' || aggregate.fn === 'avg') {
    const sum = values.reduce((total, value) => total + value, 0)
    if (!numeric(sum)) return null
    return aggregate.fn === 'sum' ? sum : (values.length ? sum / values.length : null)
  }
  return values.length ? (aggregate.fn === 'min' ? Math.min(...values) : Math.max(...values)) : null
}

function summarize(operator, rows) {
  const groups = new Map()
  if (!operator.groups.length) groups.set('[]', { values: [], rows })
  else for (const row of rows) {
    const values = operator.groups.map(group => evaluate(group.expression, row))
    // JSON typed tuples keep null/string/number/boolean distinct. Telemetry
    // property values are bounded JSON data; objects are grouped by JSON value.
    const key = JSON.stringify(values)
    if (!groups.has(key)) groups.set(key, { values, rows: [] })
    groups.get(key).rows.push(row)
  }
  return [...groups.values()].map(group => {
    const output = {}
    operator.groups.forEach((column, index) => { output[column.name] = group.values[index] })
    for (const aggregate of operator.aggregates) output[aggregate.name] = aggregateValue(aggregate, group.rows)
    return output
  })
}

function compare(left, right) {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  if (typeof left !== typeof right) return typeof left < typeof right ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

function boundedLimits(limits) {
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) fail('limits must be an object')
  const result = { ...HARD_LIMITS }
  for (const [key, value] of Object.entries(limits)) {
    if (!own(HARD_LIMITS, key) || !Number.isSafeInteger(value) || value < 0 || value > HARD_LIMITS[key]) fail(`invalid limit ${key}`)
    result[key] = value
  }
  return result
}

// Typed rows are bounded JSON, copied before evaluation and on output. This
// rejects cycles, accessors, inherited properties and nonfinite values, and
// keeps nested Properties detached. Internal lowercase metadata is available
// only when explicitly referenced; bare-table results expose PascalCase data.
function copyData(value, budget, depth = 0) {
  if (++budget.nodes > 50000 || depth > MAX_DEPTH) fail('dataset value limit exceeded')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    budget.bytes += value.length * 2
    if (budget.bytes > 1024 * 1024) fail('dataset byte limit exceeded')
    return value
  }
  if (numeric(value)) return value
  if (Array.isArray(value)) return value.map(item => copyData(item, budget, depth + 1))
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const output = {}
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue
      if (!own(descriptor, 'value') || FORBIDDEN_NAMES.has(key)) fail('dataset must contain plain typed values')
      budget.bytes += key.length * 2
      if (budget.bytes > 1024 * 1024) fail('dataset byte limit exceeded')
      output[key] = copyData(descriptor.value, budget, depth + 1)
    }
    return output
  }
  fail('dataset must contain plain typed values')
}

/** Execute a canonical AST over detached flat rows. Hard caps may only tighten.
 * Empty ungrouped count/countif/sum are 0; avg/min/max are null. Grouped empty
 * input produces no rows. Output overflow throws (use take to request a cap).
 * Lineage identifies all input rows in the selected table before filtering;
 * receipt/generation/destination ownership belongs to the runtime adapter.
 */
export function executeQuery(ast, dataset, limits = {}) {
  const bounded = boundedLimits(limits)
  if (!ast || typeof ast.source !== 'string') fail('invalid query AST')
  const canonical = parseQuery(ast.source)
  try {
    if (JSON.stringify(ast) !== JSON.stringify(canonical)) fail('query AST differs from parsed source')
  } catch (error) { fail(error.message?.startsWith('KQL:') ? 'query AST differs from parsed source' : 'invalid query AST') }
  if (new TextEncoder().encode(ast.source).length > bounded.maxSourceBytes || canonical.operators.length > bounded.maxOperators) fail('query limit exceeded')
  if (!Array.isArray(dataset)) fail('dataset must be a flat row array')
  if (dataset.length > bounded.maxInputRows) fail('input row limit exceeded')
  const input = copyData(dataset, { nodes: 0, bytes: 0 })
  if (input.some(row => !row || typeof row !== 'object' || Array.isArray(row) || typeof row.table !== 'string')) fail('dataset rows require a table discriminator')
  let rows = input.filter(row => row.table === canonical.table)
  const inputRowIds = rows.map(row => row.id ?? row.Id).filter(value => typeof value === 'string' || numeric(value))
  for (const operator of canonical.operators) {
    if (operator.type === 'where') rows = rows.filter(row => evaluate(operator.expression, row) === true)
    else if (operator.type === 'take') rows = rows.slice(0, operator.count)
    else if (operator.type === 'project' || operator.type === 'extend') rows = rows.map(row => {
      const output = operator.type === 'extend' ? { ...row } : {}
      for (const column of operator.columns) output[column.name] = evaluate(column.expression, operator.type === 'extend' ? output : row)
      return output
    })
    else if (operator.type === 'summarize') rows = summarize(operator, rows)
    else if (operator.type === 'order') {
      rows = rows.map((row, index) => ({ row, index, values: operator.columns.map(column => evaluate(column.expression, row)) }))
        .sort((left, right) => {
          for (let index = 0; index < operator.columns.length; index++) {
            const a = left.values[index]
            const b = right.values[index]
            const comparison = compare(a, b)
            if (comparison) return a === null || b === null ? comparison : comparison * (operator.columns[index].direction === 'asc' ? 1 : -1)
          }
          return left.index - right.index
        }).map(item => item.row)
    }
  }
  if (rows.length > bounded.maxOutputRows) fail('output row limit exceeded')
  // Explicit lowercase projections survive; raw-table/extend output strips
  // internal metadata. The last project/summarize defines visible columns.
  const shapingIndex = canonical.operators.findLastIndex(operator => operator.type === 'project' || operator.type === 'summarize')
  const explicit = new Set()
  for (let index = Math.max(0, shapingIndex); index < canonical.operators.length; index++) {
    const operator = canonical.operators[index]
    if (operator.type === 'project' || operator.type === 'extend') for (const column of operator.columns) explicit.add(column.name)
    if (operator.type === 'summarize') for (const column of [...operator.groups, ...operator.aggregates]) explicit.add(column.name)
  }
  const visible = rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => (key[0] >= 'A' && key[0] <= 'Z') || explicit.has(key))))
  return {
    rows: copyData(visible, { nodes: 0, bytes: 0 }),
    lineage: freezeAst({ table: canonical.table, operators: canonical.operators, inputRowIds }),
  }
}
