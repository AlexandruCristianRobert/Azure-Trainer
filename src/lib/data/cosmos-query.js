// Cosmos DB for NoSQL query parser + evaluator: a bounded grammar covering
// SELECT projections / VALUE COUNT(1), WHERE with = != < <= > >= and ARRAY_CONTAINS,
// ORDER BY (composite paths, or a single VectorDistance expression), and TOP.
// Pure functions over a Sandbox container's `items` array; no Azure calls.

function tokenize(text) {
  const tokens = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === "'") {
      let j = i + 1; let value = ''
      while (j < text.length && text[j] !== "'") value += text[j++]
      if (j >= text.length) throw new Error('Unterminated string literal.')
      tokens.push({ type: 'string', value }); i = j + 1; continue
    }
    if (ch === '@') {
      const match = text.slice(i).match(/^@[A-Za-z_][A-Za-z0-9_]*/)
      if (!match) throw new Error("Expected a parameter name after '@'.")
      tokens.push({ type: 'parameter', value: match[0] }); i += match[0].length; continue
    }
    if (/[0-9]/.test(ch)) {
      const match = text.slice(i).match(/^\d+(\.\d+)?/)
      tokens.push({ type: 'number', value: Number(match[0]) }); i += match[0].length; continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)
      tokens.push({ type: 'word', value: match[0], lower: match[0].toLowerCase() }); i += match[0].length; continue
    }
    const twoChar = ['<=', '>=', '!='].find((op) => text.startsWith(op, i))
    if (twoChar) { tokens.push({ type: 'symbol', value: twoChar }); i += 2; continue }
    if ('(),.*=<>'.includes(ch)) { tokens.push({ type: 'symbol', value: ch }); i++; continue }
    throw new Error(`Unsupported query token '${ch}'.`)
  }
  return tokens
}

const COMPARATORS = { '=': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b }

class Parser {
  constructor(tokens) { this.tokens = tokens; this.i = 0 }
  current() { return this.tokens[this.i] }
  isWord(word) { const t = this.current(); return !!t && t.type === 'word' && t.lower === word }
  isSymbol(sym) { const t = this.current(); return !!t && t.type === 'symbol' && t.value === sym }
  next() { return this.tokens[this.i++] }
  expectWord(word) { if (!this.isWord(word)) this.fail(`Expected ${word.toUpperCase()}.`); return this.next() }
  expectSymbol(sym) { if (!this.isSymbol(sym)) this.fail(`Expected '${sym}'.`); return this.next() }
  fail(message) { throw new Error(message) }

  parsePath() {
    this.expectWord('c')
    const segments = []
    while (this.isSymbol('.')) {
      this.next()
      const token = this.current()
      if (!token || token.type !== 'word') this.fail("Expected a property name after '.'.")
      segments.push(token.value); this.i++
    }
    if (segments.length === 0) this.fail("Expected 'c.<path>'.")
    return segments
  }

  parseParameterRef() {
    const token = this.current()
    if (!token || token.type !== 'parameter') this.fail('Expected a query parameter.')
    this.i++; return token.value
  }

  parseLiteral() {
    const token = this.current()
    if (!token) this.fail('Expected a literal value.')
    if (token.type === 'string' || token.type === 'number') { this.i++; return token.value }
    if (token.type === 'word' && (token.lower === 'true' || token.lower === 'false')) { this.i++; return token.lower === 'true' }
    this.fail('Expected a string, number, true or false literal.')
  }

  parseValueOrParam() {
    const token = this.current()
    return token && token.type === 'parameter' ? { kind: 'param', name: this.parseParameterRef() } : { kind: 'literal', value: this.parseLiteral() }
  }

  parseVectorCall() {
    this.next(); this.expectSymbol('(')
    const path = this.parsePath(); this.expectSymbol(',')
    const param = this.parseParameterRef(); this.expectSymbol(')')
    return { path, param }
  }

  parseCondition() {
    if (this.isWord('array_contains')) {
      this.next(); this.expectSymbol('(')
      const path = this.parsePath(); this.expectSymbol(',')
      const param = this.parseParameterRef(); this.expectSymbol(')')
      return { type: 'arrayContains', path, param }
    }
    if (this.isWord('vectordistance')) {
      // VectorDistance(c.path, @p) (>|>=|<|<=) (@p|number) as a WHERE
      // condition (real Cosmos supports this; for cosine, higher is more
      // similar) - review ruling: the similarity floor and any other
      // restriction must come from the query text, not a post-check filter.
      const call = this.parseVectorCall()
      const token = this.current()
      if (!token || token.type !== 'symbol' || !['>', '>=', '<', '<='].includes(token.value)) this.fail('Expected a comparison operator after VectorDistance(...).')
      this.i++
      return { type: 'vectorCompare', ...call, op: token.value, value: this.parseValueOrParam() }
    }
    const path = this.parsePath()
    const token = this.current()
    if (!token || token.type !== 'symbol' || !(token.value in COMPARATORS)) this.fail('Expected a comparison operator.')
    this.i++
    return { type: 'compare', path, op: token.value, value: this.parseValueOrParam() }
  }

  identifierName() {
    const token = this.current()
    if (!token || token.type !== 'word') this.fail('Expected an alias name.')
    this.i++; return token.value
  }

  parseAlias() { return this.isWord('as') ? (this.next(), this.identifierName()) : null }

  parseProjection() {
    if (this.isWord('vectordistance')) { const call = this.parseVectorCall(); return { type: 'vector', ...call, alias: this.parseAlias() } }
    return { type: 'path', path: this.parsePath(), alias: this.parseAlias() }
  }

  parseOrderItem() {
    const path = this.parsePath()
    let dir = 'ASC'
    if (this.isWord('asc')) { this.next() } else if (this.isWord('desc')) { this.next(); dir = 'DESC' }
    return { path, dir }
  }

  parseCommaList(parseOne) {
    const items = [parseOne.call(this)]
    while (this.isSymbol(',')) { this.next(); items.push(parseOne.call(this)) }
    return items
  }

  parseWhere() {
    if (!this.isWord('where')) return []
    this.next()
    const conditions = [this.parseCondition()]
    while (this.isWord('and')) { this.next(); conditions.push(this.parseCondition()) }
    return conditions
  }

  parse() {
    this.expectWord('select')
    let top = null
    if (this.isWord('top')) {
      this.next()
      const token = this.current()
      if (token && token.type === 'parameter') { top = { param: token.value }; this.i++ } else if (token && token.type === 'number') { top = { n: token.value }; this.i++ } else this.fail('Expected a TOP value.')
    }
    let selectKind = 'projections'
    let projections = []
    if (this.isSymbol('*')) { this.next(); selectKind = 'all' } else if (this.isWord('value')) {
      this.next(); this.expectWord('count'); this.expectSymbol('(')
      const token = this.current()
      if (!token || token.type !== 'number' || token.value !== 1) this.fail('Only COUNT(1) is supported.')
      this.i++; this.expectSymbol(')')
      selectKind = 'valueCount'
    } else {
      projections = this.parseCommaList(this.parseProjection)
    }
    this.expectWord('from'); this.expectWord('c')
    const where = this.parseWhere()
    let orderBy = null
    if (this.isWord('order')) {
      this.next(); this.expectWord('by')
      orderBy = this.isWord('vectordistance') ? { type: 'vector', ...this.parseVectorCall() } : { type: 'paths', items: this.parseCommaList(this.parseOrderItem) }
    }
    if (this.i !== this.tokens.length) this.fail('Unexpected tokens after the query.')
    return { top, selectKind, projections, where, orderBy }
  }
}

export function parseCosmosQuery(text) {
  try {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Query text must be a non-empty string.')
    return { ast: new Parser(tokenize(text)).parse() }
  } catch (error) {
    return { error: { code: 'DATA_UNSUPPORTED', message: `Not supported by the simulator: ${error.message}` } }
  }
}

// ---- Indexing helpers (also used by the RU cost model, Task 4) ----

const pathSegments = (path) => path.split('/').filter(Boolean)
const toSlashPath = (segments) => '/' + segments.join('/')

function patternMatches(pattern, path) {
  if (pattern === '/*') return true
  if (pattern.endsWith('/*')) {
    const prefix = pathSegments(pattern.slice(0, -2))
    const segments = pathSegments(path)
    return segments.length >= prefix.length && prefix.every((segment, index) => segment === segments[index])
  }
  if (pattern.endsWith('/?')) return pattern.slice(0, -2) === path
  return pattern === path
}

const specificity = (pattern) => (pattern === '/*' ? 0 : pathSegments(pattern.replace(/\/[*?]$/, '')).length + 1)

export function isPathIndexed(policy, path) {
  const matchingExcluded = (policy?.excludedPaths ?? []).filter((entry) => patternMatches(entry.path, path))
  if (matchingExcluded.length === 0) return true
  const bestExcluded = Math.max(...matchingExcluded.map((entry) => specificity(entry.path)))
  const matchingIncluded = (policy?.includedPaths ?? []).filter((entry) => patternMatches(entry.path, path))
  const bestIncluded = matchingIncluded.length ? Math.max(...matchingIncluded.map((entry) => specificity(entry.path))) : -1
  return bestIncluded > bestExcluded
}

// ---- Evaluation helpers ----

const getPath = (item, segments) => segments.reduce((value, key) => (value == null ? undefined : value[key]), item)
const sameValue = (a, b) => a === b || (a != null && b != null && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b))
const compareValues = (a, b) => (a === b ? 0 : a === undefined ? 1 : b === undefined ? -1 : a < b ? -1 : 1)

function badRequest(message) { const error = new Error(message); error.code = 'BadRequest'; return error }

function resolveParam(parameters, name) {
  const found = (parameters ?? []).find((p) => p.name === name)
  if (!found) throw badRequest(`Parameter '${name}' is not defined.`)
  return found.value
}

function resolveCondition(cond, parameters, container) {
  if (cond.type === 'arrayContains') return { ...cond, resolvedValue: resolveParam(parameters, cond.param) }
  if (cond.type === 'vectorCompare') {
    return {
      ...cond,
      resolvedScore: vectorScorer(container, parameters, cond.path, cond.param),
      resolvedValue: cond.value.kind === 'param' ? resolveParam(parameters, cond.value.name) : cond.value.value,
    }
  }
  return { ...cond, resolvedValue: cond.value.kind === 'param' ? resolveParam(parameters, cond.value.name) : cond.value.value }
}

function evalCondition(item, cond) {
  if (cond.type === 'vectorCompare') return COMPARATORS[cond.op](cond.resolvedScore(item), cond.resolvedValue)
  const actual = getPath(item, cond.path)
  if (cond.type === 'arrayContains') return Array.isArray(actual) && actual.some((entry) => sameValue(entry, cond.resolvedValue))
  return COMPARATORS[cond.op](actual, cond.resolvedValue)
}

const partitionValue = (container, item) => getPath(item, pathSegments(container.partitionKeyPath))

const stripInternal = (item) => Object.fromEntries(Object.entries(item).filter(([key]) => !key.startsWith('_')))

function sortByPaths(items, orderItems) {
  return items.slice().sort((x, y) => {
    for (const { path, dir } of orderItems) {
      const cmp = compareValues(getPath(x, path), getPath(y, path))
      if (cmp !== 0) return dir === 'DESC' ? -cmp : cmp
    }
    return 0
  })
}

function compositeIndexMatches(entry, items) {
  if (entry.length !== items.length || !entry.every((e, index) => e.path === toSlashPath(items[index].path))) return false
  const wanted = items.map((item) => (item.dir === 'DESC' ? 'descending' : 'ascending'))
  const direct = entry.every((e, index) => e.order === wanted[index])
  const reversed = entry.every((e, index) => e.order === (wanted[index] === 'ascending' ? 'descending' : 'ascending'))
  return direct || reversed
}

function findVectorEntry(container, path) {
  const slashPath = toSlashPath(path)
  const entry = (container.vectorEmbeddingPolicy?.vectorEmbeddings ?? []).find((candidate) => candidate.path === slashPath)
  if (!entry) throw badRequest(`No vector embedding policy is defined for path '${slashPath}'.`)
  return entry
}

// Only cosine is scored: it is the only VectorDistance behavior the Sandbox specifies
// (higher = more similar; ORDER BY VectorDistance always sorts descending, as Cosmos
// does for cosine). dotproduct/euclidean policies are validated but not queried here.
function cosineSimilarity(a, b) {
  let dot = 0; let normA = 0; let normB = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i] }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

function vectorScorer(container, parameters, path, param) {
  const entry = findVectorEntry(container, path)
  const queryVector = resolveParam(parameters, param)
  if (!Array.isArray(queryVector) || queryVector.length !== entry.dimensions) {
    throw badRequest(`The vector dimensions (${queryVector?.length ?? 0}) do not match the vector embedding policy dimensions (${entry.dimensions}).`)
  }
  return (item) => cosineSimilarity(getPath(item, path) ?? [], queryVector)
}

function orderByStat(orderBy) {
  if (!orderBy) return []
  if (orderBy.type === 'vector') return [`VectorDistance(c.${orderBy.path.join('.')})`]
  return orderBy.items.map((item) => `c.${item.path.join('.')} ${item.dir}`)
}

export function runCosmosQuery(container, text, parameters = [], { partitionKey } = {}) {
  const parsed = parseCosmosQuery(text)
  if (parsed.error) return { error: parsed.error }
  const ast = parsed.ast
  try {
    const where = ast.where.map((cond) => resolveCondition(cond, parameters, container))

    let partitionKeyValue = partitionKey
    if (partitionKeyValue === undefined) {
      const equality = where.find((cond) => cond.type === 'compare' && cond.op === '=' && toSlashPath(cond.path) === container.partitionKeyPath)
      if (equality) partitionKeyValue = equality.resolvedValue
    }

    const allItems = container.items ?? []
    const itemsInScope = partitionKeyValue === undefined ? allItems.slice() : allItems.filter((item) => partitionValue(container, item) === partitionKeyValue)
    const matched = itemsInScope.filter((item) => where.every((cond) => evalCondition(item, cond)))

    // Ordinary WHERE/ORDER BY property paths are served by includedPaths/excludedPaths.
    // A VectorDistance condition (in WHERE or ORDER BY) is served by a vectorIndexes
    // entry instead (real Cosmos configurations commonly exclude the vector path from
    // ordinary indexing), so those paths are checked separately rather than against
    // isPathIndexed.
    const orderPaths = ast.orderBy?.type === 'paths' ? ast.orderBy.items.map((item) => item.path) : []
    const ordinaryWherePaths = where.filter((cond) => cond.type !== 'vectorCompare').map((cond) => cond.path)
    const propertyPathsIndexed = [...ordinaryWherePaths, ...orderPaths].every((path) => isPathIndexed(container.indexingPolicy, toSlashPath(path)))
    const vectorPaths = [...where.filter((cond) => cond.type === 'vectorCompare').map((cond) => cond.path), ...(ast.orderBy?.type === 'vector' ? [ast.orderBy.path] : [])]
    const vectorIndexed = vectorPaths.every((path) => (container.indexingPolicy?.vectorIndexes ?? []).some((entry) => entry.path === toSlashPath(path)))
    const usedIndex = propertyPathsIndexed && vectorIndexed

    if (ast.orderBy?.type === 'paths' && ast.orderBy.items.length >= 2) {
      const compositeIndexes = container.indexingPolicy?.compositeIndexes ?? []
      if (!compositeIndexes.some((entry) => compositeIndexMatches(entry, ast.orderBy.items))) {
        throw badRequest('The order by query does not have a corresponding composite index that it can be served from.')
      }
    }

    let vector = where.some((cond) => cond.type === 'vectorCompare')
    let ordered = matched
    if (ast.orderBy?.type === 'paths') {
      ordered = sortByPaths(matched, ast.orderBy.items)
    } else if (ast.orderBy?.type === 'vector') {
      vector = true
      const score = vectorScorer(container, parameters, ast.orderBy.path, ast.orderBy.param)
      ordered = matched.slice().sort((a, b) => -compareValues(score(a), score(b)))
    }

    let limited = ordered
    if (ast.top) {
      const n = ast.top.param !== undefined ? resolveParam(parameters, ast.top.param) : ast.top.n
      if (!Number.isInteger(n) || n < 0) throw badRequest('TOP requires a non-negative integer.')
      limited = ordered.slice(0, n)
    }

    let rows
    if (ast.selectKind === 'all') {
      rows = limited.map(stripInternal)
    } else if (ast.selectKind === 'valueCount') {
      rows = [matched.length]
    } else {
      const scorers = new Map()
      const scorerFor = (path, param) => {
        const key = `${toSlashPath(path)}::${param}`
        if (!scorers.has(key)) { scorers.set(key, vectorScorer(container, parameters, path, param)); vector = true }
        return scorers.get(key)
      }
      rows = limited.map((item) => {
        const row = {}
        for (const projection of ast.projections) {
          if (projection.type === 'vector') row[projection.alias ?? 'vectorDistance'] = scorerFor(projection.path, projection.param)(item)
          else row[projection.alias ?? projection.path[projection.path.length - 1]] = getPath(item, projection.path)
        }
        return row
      })
    }

    return {
      rows,
      stats: {
        scanned: usedIndex ? matched.length : itemsInScope.length,
        returned: rows.length,
        partitionsTouched: partitionKeyValue !== undefined ? 1 : (container.physicalPartitions ?? 1),
        usedIndex,
        vector,
        orderBy: orderByStat(ast.orderBy),
      },
    }
  } catch (error) {
    if (error.code) return { error: { code: error.code, message: error.message } }
    throw error
  }
}
