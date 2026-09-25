function failure(code, message) {
  return { rows: [], selectedIds: [], distances: [], diagnostic: { code, message } }
}

function vectorValue(value, parameter) {
  if (typeof value !== 'string' || !/^\[\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)*\s*\]$/.test(value)) {
    return { error: `${parameter} must be a finite vector string.` }
  }
  const vector = value.slice(1, -1).split(',').map(item => Number(item.trim()))
  if (!vector.length || vector.some(number => !Number.isFinite(number))) return { error: `${parameter} must contain only finite numbers.` }
  if (vector.every(number => number === 0)) return { error: `${parameter} must not be a zero vector.` }
  return { vector }
}

function cosineDistance(left, right) {
  if (!Array.isArray(right) || left.length !== right.length) return null
  if (right.some(value => !Number.isFinite(value)) || right.every(value => value === 0)) return null
  const dot = left.reduce((sum, value, index) => sum + value * right[index], 0)
  const leftLength = Math.sqrt(left.reduce((sum, value) => sum + value * value, 0))
  const rightLength = Math.sqrt(right.reduce((sum, value) => sum + value * value, 0))
  return 1 - dot / (leftLength * rightLength)
}

function compareParameters(querySpec, parameters) {
  for (const filter of querySpec.filters ?? []) {
    if (!Object.hasOwn(parameters, filter.parameter)) return { code: 'SQL_PARAMETER_MISSING', message: `Missing bound parameter '${filter.parameter}'.` }
    const value = parameters[filter.parameter]
    const valid = filter.column === 'published' ? typeof value === 'boolean' : typeof value === 'string'
    if (!valid) return { code: 'SQL_PARAMETER_TYPE', message: `Parameter '${filter.parameter}' has the wrong type for ${filter.column}.` }
  }
  for (const name of [querySpec.order?.vectorParameter, querySpec.distance?.parameter].filter(Boolean)) {
    if (!Object.hasOwn(parameters, name)) return { code: 'SQL_PARAMETER_MISSING', message: `Missing bound parameter '${name}'.` }
  }
  if (!Object.hasOwn(parameters, querySpec.limitParameter)) return { code: 'SQL_PARAMETER_MISSING', message: `Missing bound parameter '${querySpec.limitParameter}'.` }
  const limit = parameters[querySpec.limitParameter]
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) return { code: 'SQL_PARAMETER_TYPE', message: `Parameter '${querySpec.limitParameter}' must be an integer from 0 to 100.` }
  if (querySpec.distance) {
    const name = querySpec.distance.cutoffParameter
    if (!Object.hasOwn(parameters, name)) return { code: 'SQL_PARAMETER_MISSING', message: `Missing bound parameter '${name}'.` }
    const cutoff = parameters[name]
    if (typeof cutoff !== 'number' || !Number.isFinite(cutoff)) return { code: 'SQL_PARAMETER_TYPE', message: `Parameter '${name}' must be a finite number.` }
  }
  return null
}

export function retrieveFixtureRows(querySpec, parameters, documents) {
  if (!querySpec || querySpec.version !== 1 || !Array.isArray(querySpec.filters) || !querySpec.order || !documents || typeof documents !== 'object') {
    return failure('SQL_QUERY_INVALID', 'Retrieval query specification is invalid.')
  }
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return failure('SQL_PARAMETERS_INVALID', 'Bound SQL parameters must be an object.')
  const parameterError = compareParameters(querySpec, parameters)
  if (parameterError) return failure(parameterError.code, parameterError.message)

  const orderingVector = vectorValue(parameters[querySpec.order.vectorParameter], querySpec.order.vectorParameter)
  if (orderingVector.error) return failure('SQL_VECTOR_INVALID', orderingVector.error)
  let cutoffVector = orderingVector.vector
  if (querySpec.distance) {
    const parsedCutoffVector = vectorValue(parameters[querySpec.distance.parameter], querySpec.distance.parameter)
    if (parsedCutoffVector.error) return failure('SQL_VECTOR_INVALID', parsedCutoffVector.error)
    cutoffVector = parsedCutoffVector.vector
  }
  const entries = Object.entries(documents)
  for (const [key, row] of entries) {
    if (!row || typeof row.id !== 'string' || typeof row.content !== 'string' || key !== row.id || typeof row.collection !== 'string' || typeof row.audience !== 'string' || typeof row.published !== 'boolean' || !Array.isArray(row.embedding)) {
      return failure('SQL_FIXTURE_INVALID', 'A document fixture does not match the supplied document schema.')
    }
    if (row.embedding.length !== orderingVector.vector.length || row.embedding.some(value => !Number.isFinite(value)) || row.embedding.every(value => value === 0)) {
      return failure('SQL_VECTOR_INVALID', `Document '${row.id}' has an invalid or incompatible embedding.`)
    }
  }
  const filters = querySpec.filters.map(filter => ({ ...filter, value: parameters[filter.parameter] }))
  const matches = []
  for (const [, row] of entries) {
    if (filters.some(filter => row[filter.column] !== filter.value)) continue
    const rankDistance = cosineDistance(orderingVector.vector, row.embedding)
    if (rankDistance === null) return failure('SQL_VECTOR_INVALID', `Document '${row.id}' has an invalid embedding.`)
    if (querySpec.distance) {
      const cutoffDistance = cosineDistance(cutoffVector, row.embedding)
      if (cutoffDistance === null) return failure('SQL_VECTOR_INVALID', `Document '${row.id}' has an invalid embedding.`)
      if (cutoffDistance > parameters[querySpec.distance.cutoffParameter]) continue
    }
    matches.push({ row, rankDistance, cutoffDistance: querySpec.distance ? cosineDistance(cutoffVector, row.embedding) : rankDistance })
  }
  const direction = querySpec.order.direction === 'DESC' ? -1 : 1
  const idDirection = querySpec.order.idDirection === 'DESC' ? -1 : 1
  matches.sort((left, right) => {
    const distanceOrder = (left.rankDistance - right.rankDistance) * direction
    if (distanceOrder !== 0) return distanceOrder
    const idOrder = left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0
    return idOrder * idDirection
  })
  const selected = matches.slice(0, parameters[querySpec.limitParameter])
  const rows = selected.map(({ row }) => ({ id: row.id, content: row.content, provenance: { kind: 'document', id: row.id } }))
  return { rows, selectedIds: rows.map(row => row.id), distances: selected.map(item => ({ id: item.row.id, distance: item.cutoffDistance })), diagnostic: null }
}
