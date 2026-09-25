import { LineCounter, isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml'

const MAX_DOCUMENTS = 8
const MAX_DEPTH = 32
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype'])

function diagnostic(code, message, path, line = 1, column = 1) {
  return { code, message, path, line, column }
}

function position(counter, offset) {
  const point = counter.linePos(Math.max(0, offset ?? 0))
  return { line: point.line, column: point.col }
}

function unsupported(path, counter, node, message) {
  const point = position(counter, node?.range?.[0])
  return diagnostic('YAML_UNSUPPORTED', message, path, point.line, point.column)
}

function inspect(node, path, counter, depth = 0) {
  if (depth > MAX_DEPTH) return unsupported(path, counter, node, `YAML nesting may not exceed ${MAX_DEPTH} levels.`)
  if (!node) return null
  if (isAlias(node) || node.anchor) return unsupported(path, counter, node, 'YAML aliases and anchors are not supported.')
  if (node.tag && node.tag.startsWith('!')) return unsupported(path, counter, node, 'Custom YAML tags are not supported.')
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== 'string' || unsafeKeys.has(pair.key.value) || pair.key.value === '<<') {
        return unsupported(path, counter, pair.key ?? pair, 'YAML map keys must be safe strings and merge keys are not supported.')
      }
      const keyIssue = inspect(pair.key, path, counter, depth + 1)
      const valueIssue = inspect(pair.value, path, counter, depth + 1)
      if (keyIssue || valueIssue) return keyIssue ?? valueIssue
    }
  } else if (isSeq(node)) {
    for (const item of node.items) {
      const issue = inspect(item, path, counter, depth + 1)
      if (issue) return issue
    }
  }
  return null
}

function convert(node) {
  if (node == null) return null
  if (isScalar(node)) {
    if (typeof node.value === 'number' && !Number.isFinite(node.value)) throw new Error('Non-finite YAML scalars are not supported.')
    return node.value
  }
  if (isSeq(node)) return node.items.map(convert)
  if (isMap(node)) {
    const value = {}
    for (const pair of node.items) value[pair.key.value] = convert(pair.value)
    return value
  }
  throw new Error('Unsupported YAML node.')
}

export function parseKubernetesYaml(text, path) {
  if (typeof text !== 'string') return { documents: [], diagnostics: [diagnostic('YAML_PARSE', 'Kubernetes YAML must be text.', path)], locations: [] }
  const counter = new LineCounter()
  let parsed
  try {
    parsed = parseAllDocuments(text, { lineCounter: counter, uniqueKeys: true, version: '1.2' })
  } catch (error) {
    return { documents: [], diagnostics: [diagnostic('YAML_PARSE', error.message, path)], locations: [] }
  }
  if (parsed.length > MAX_DOCUMENTS) return { documents: [], diagnostics: [diagnostic('YAML_DOCUMENT_LIMIT', `A YAML file may contain at most ${MAX_DOCUMENTS} documents.`, path)], locations: [] }
  const documents = []
  const locations = []
  for (const document of parsed) {
    if (document.errors.length) {
      const error = document.errors[0]
      const point = position(counter, error.pos?.[0])
      return { documents: [], diagnostics: [diagnostic('YAML_PARSE', error.message, path, point.line, point.column)], locations: [] }
    }
    if (document.contents == null) continue
    const issue = inspect(document.contents, path, counter)
    if (issue) return { documents: [], diagnostics: [issue], locations: [] }
    try {
      const value = convert(document.contents)
      if (value === null) continue
      documents.push(value)
      const point = position(counter, document.contents.range?.[0])
      locations.push({ path, line: point.line, column: point.column })
    } catch (error) {
      const point = position(counter, document.contents.range?.[0])
      return { documents: [], diagnostics: [diagnostic('YAML_UNSUPPORTED', error.message, path, point.line, point.column)], locations: [] }
    }
  }
  if (!documents.length) return { documents: [], diagnostics: [diagnostic('NO_MANIFESTS', 'The YAML input contains no Kubernetes manifests.', path)], locations }
  return { documents, diagnostics: [], locations }
}
