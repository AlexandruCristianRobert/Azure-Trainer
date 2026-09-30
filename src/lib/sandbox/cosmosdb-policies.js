import { AzError } from './errors.js'

const VECTOR_TYPES = ['float32', 'float16', 'int8', 'uint8']
const DISTANCE_FUNCTIONS = ['cosine', 'dotproduct', 'euclidean']
const VECTOR_INDEX_TYPES = ['flat', 'quantizedFlat', 'diskANN']
const COMPOSITE_ORDERS = ['ascending', 'descending']

export const DEFAULT_INDEXING_POLICY = {
  indexingMode: 'consistent',
  automatic: true,
  includedPaths: [{ path: '/*' }],
  excludedPaths: [{ path: '/_etag/?' }],
  vectorIndexes: [],
  compositeIndexes: [],
}

function bad(message) {
  throw new AzError('BadRequest', message, { kind: 'cli' })
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function jsonPath(path, label, { vector = false } = {}) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length < 2) bad(`${label} must be a JSON path starting with '/'.`)
  if (vector && /[\[\]*?]/.test(path)) bad(`${label} cannot contain wildcard characters.`)
}

function pathArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => !plainObject(entry) || Object.keys(entry).some((key) => key !== 'path'))) bad(`${label} must be an array of { path } objects.`)
  value.forEach((entry) => jsonPath(entry.path, `${label} path`))
  return value.map(({ path }) => ({ path }))
}

export function parseInlineJson(flag, value) {
  if (typeof value !== 'string' || value.startsWith('@')) {
    bad(`${flag} must be inline JSON in the Sandbox; @file input is not supported.`)
  }
  try {
    const parsed = JSON.parse(value)
    if (!plainObject(parsed)) bad(`${flag} must be a JSON object.`)
    return parsed
  } catch (error) {
    if (error instanceof AzError) throw error
    bad(`${flag} must be valid inline JSON.`)
  }
}

export function validateVectorEmbeddingPolicy(value) {
  if (!plainObject(value) || !Array.isArray(value.vectorEmbeddings) || Object.keys(value).some((key) => key !== 'vectorEmbeddings') || value.vectorEmbeddings.length === 0) {
    bad('--vector-embeddings must contain a non-empty vectorEmbeddings array.')
  }
  const paths = new Set()
  const vectorEmbeddings = value.vectorEmbeddings.map((embedding) => {
    if (!plainObject(embedding) || Object.keys(embedding).some((key) => !['path', 'dataType', 'dimensions', 'distanceFunction'].includes(key))) bad('Each vector embedding must define path, dataType, dimensions and distanceFunction.')
    const { path, dataType, dimensions, distanceFunction } = embedding
    jsonPath(path, 'Vector embedding path', { vector: true })
    if (paths.has(path)) bad(`Duplicate vector embedding path '${path}'.`)
    paths.add(path)
    if (!VECTOR_TYPES.includes(dataType)) bad(`Unsupported vector data type '${dataType}'.`)
    if (!Number.isInteger(dimensions) || dimensions <= 0 || dimensions > 4096) bad('Vector dimensions must be a positive integer no greater than 4096.')
    if (!DISTANCE_FUNCTIONS.includes(distanceFunction)) bad(`Unsupported vector distance function '${distanceFunction}'.`)
    return { path, dataType, dimensions, distanceFunction }
  })
  return { vectorEmbeddings }
}

function compositeIndexEntry(entry) {
  if (!plainObject(entry) || Object.keys(entry).some((key) => !['path', 'order'].includes(key))) bad('Each composite index entry must define path and order.')
  jsonPath(entry.path, 'Composite index path')
  if (!COMPOSITE_ORDERS.includes(entry.order)) bad(`Unsupported composite index order '${entry.order}'.`)
  return { path: entry.path, order: entry.order }
}

function compositeIndexArray(value) {
  if (!Array.isArray(value)) bad('--idx compositeIndexes must be an array of composite index definitions.')
  return value.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) bad('Each composite index must list at least two paths.')
    return entry.map(compositeIndexEntry)
  })
}

export function validateIndexingPolicy(value, vectorEmbeddingPolicy = null) {
  if (!plainObject(value)) bad('--idx must be a JSON object.')
  const allowed = ['indexingMode', 'automatic', 'includedPaths', 'excludedPaths', 'vectorIndexes', 'compositeIndexes']
  if (Object.keys(value).some((key) => !allowed.includes(key))) bad('--idx contains an unsupported indexing policy property.')
  const indexingMode = value.indexingMode ?? 'consistent'
  const automatic = value.automatic ?? true
  if (indexingMode !== 'consistent') bad("--idx indexingMode must be 'consistent' in the Sandbox.")
  if (typeof automatic !== 'boolean') bad('--idx automatic must be true or false.')
  const includedPaths = pathArray(value.includedPaths ?? DEFAULT_INDEXING_POLICY.includedPaths, '--idx includedPaths')
  const excludedPaths = pathArray(value.excludedPaths ?? DEFAULT_INDEXING_POLICY.excludedPaths, '--idx excludedPaths')
  if (![...includedPaths, ...excludedPaths].some(({ path }) => path === '/*')) bad('--idx must include or exclude the root path /*.')
  if (!Array.isArray(value.vectorIndexes ?? [])) bad('--idx vectorIndexes must be an array.')
  const embeddingByPath = new Map((vectorEmbeddingPolicy?.vectorEmbeddings ?? []).map((entry) => [entry.path, entry]))
  const indexPaths = new Set()
  const vectorIndexes = (value.vectorIndexes ?? []).map((index) => {
    if (!plainObject(index) || Object.keys(index).some((key) => !['path', 'type'].includes(key))) bad('Each vector index must define path and type.')
    jsonPath(index.path, 'Vector index path', { vector: true })
    if (indexPaths.has(index.path)) bad(`Duplicate vector index path '${index.path}'.`)
    indexPaths.add(index.path)
    if (!VECTOR_INDEX_TYPES.includes(index.type)) bad(`Unsupported vector index type '${index.type}'.`)
    const embedding = embeddingByPath.get(index.path)
    if (!embedding) bad(`Vector index path '${index.path}' must match a declared vector embedding path.`)
    if (index.type === 'flat' && embedding.dimensions > 505) bad('flat vector indexes support at most 505 dimensions.')
    return { path: index.path, type: index.type }
  })
  if (!vectorEmbeddingPolicy && vectorIndexes.length) bad('A vector index requires --vector-embeddings.')
  const compositeIndexes = compositeIndexArray(value.compositeIndexes ?? [])
  return { indexingMode, automatic, includedPaths, excludedPaths, vectorIndexes, compositeIndexes }
}

export function sameJson(left, right) {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  if (Array.isArray(left)) return left.length === right.length && left.every((item, index) => sameJson(item, right[index]))
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]))
}
