import { plainObject } from '../messaging/state.js'
import { HTTP_LIMITS, closedHttpObject, httpCounter, jsonBytes, normalizeOrder,
  normalizeHttpAppId, normalizeHttpTarget, normalizeHttpHeaders, normalizeHttpPath, validateHttpRoutes, validHttpInputClass } from './contracts.js'

export function emptyHttpFunctionsState() {
  return { version: 1, nextId: 1, localHosts: [], deployments: [], currentLocal: {}, currentPublished: {}, accepted: [], requests: [] }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const canonicalApp = value => { try { return normalizeHttpAppId(value) === value } catch { return false } }
const canonicalTarget = value => { try { return Object.entries(normalizeHttpTarget(value)).every(([key, entry]) => value[key] === entry) } catch { return false } }
const canonicalOrder = value => { try { normalizeOrder(value); return true } catch { return false } }
const positive = value => httpCounter(value) && value > 0
const reference = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}-[1-9]\\d*$`).test(value)
const references = (value, prefix) => Array.isArray(value) && value.length <= HTTP_LIMITS.accepted
  && new Set(value).size === value.length && value.every(item => reference(item, prefix))
const sourcePath = value => typeof value === 'string' && value.length <= 256
  && (value === 'local.settings.json' || /^(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*\.(?:py|json|txt)$/.test(value))

export function validateHttpResponse(value) {
  if (!closedHttpObject(value, ['statusCode', 'headers', 'body']) || !Number.isInteger(value.statusCode)
    || value.statusCode < 100 || value.statusCode > 599 || typeof value.body !== 'string'
    || jsonBytes(value.body) > HTTP_LIMITS.responseBytes) return false
  try {
    const headers = normalizeHttpHeaders(value.headers)
    return same(headers, value.headers) && !Object.keys(headers).some(key => ['x-functions-key', 'authorization'].includes(key))
  } catch { return false }
}
export function validateHttpAcceptedRecord(value) {
  return closedHttpObject(value, ['id', 'appId', 'target', 'order', 'generation', 'sendReceiptId', 'messageRecordId', 'sourceMessageId', 'acceptedAtMs'])
    && reference(value.id, 'http-accepted') && canonicalApp(value.appId) && canonicalTarget(value.target) && canonicalOrder(value.order)
    && positive(value.generation) && reference(value.sendReceiptId, 'trace') && reference(value.messageRecordId, 'message')
    && reference(value.sourceMessageId, 'message') && httpCounter(value.acceptedAtMs)
}
export function validateHttpCapture(value) {
  if (!closedHttpObject(value, ['id', 'appId', 'scope', 'generation', 'status', 'createdAtMs', 'entry', 'sources', 'sourceVersions', 'routes'])
    || !reference(value.id, 'http-capture') || !canonicalApp(value.appId) || !['local', 'published'].includes(value.scope)
    || !positive(value.generation) || !['captured', 'stopped'].includes(value.status) || !httpCounter(value.createdAtMs) || value.entry !== 'function_app.py'
    || !plainObject(value.sources) || !plainObject(value.sourceVersions) || !Object.hasOwn(value.sources, value.entry)
    || Object.keys(value.sources).length > HTTP_LIMITS.files || Object.keys(value.sources).length < 1
    || !same(Object.keys(value.sources).sort(), Object.keys(value.sourceVersions).sort())
    || Object.entries(value.sources).some(([key, text]) => !sourcePath(key) || typeof text !== 'string')
    || Object.values(value.sourceVersions).some(version => !httpCounter(version))
    || Object.values(value.sources).reduce((sum, text) => sum + jsonBytes(text), 0) > HTTP_LIMITS.sourceBytes
    || !validateHttpRoutes(value.routes)) return false
  return value.routes.every(route => ['authLevel', 'functionId', 'functionName', 'path'].every(key => Object.hasOwn(route, key))
    && Object.hasOwn(value.sources, route.path) && route.functionId.startsWith(route.path + ':'))
}
export function validateHttpRequestRecord(value) {
  if (!closedHttpObject(value, ['id', 'appId', 'scope', 'generation', 'method', 'path', 'authorization', 'operationIds', 'readIds',
    'response', 'sendReceiptIds', 'workerReceiptIds', 'executionId', 'beforeNextId', 'afterNextId', 'inputClass'])
    || !reference(value.id, 'http-request') || !canonicalApp(value.appId) || !['local', 'published'].includes(value.scope)
    || !positive(value.generation) || !['GET', 'POST'].includes(value.method)
    || !validHttpInputClass(value.inputClass) || (value.method === 'GET') !== (value.inputClass === 'none')
    || !['not-required', 'granted', 'denied'].includes(value.authorization)
    || !references(value.operationIds, 'http-operation') || !references(value.readIds, 'http-read')
    || !references(value.sendReceiptIds, 'trace') || !references(value.workerReceiptIds, 'trace')
    || !reference(value.executionId, 'execution') || !positive(value.beforeNextId) || !positive(value.afterNextId)
    || value.afterNextId <= value.beforeNextId || !validateHttpResponse(value.response)) return false
  try { return normalizeHttpPath(value.path) === value.path } catch { return false }
}

/** Structural admission only; runtime owners additionally verify authoritative journal links. */
export function validateHttpFunctionsState(value) {
  if (!closedHttpObject(value, ['version', 'nextId', 'localHosts', 'deployments', 'currentLocal', 'currentPublished', 'accepted', 'requests']) || value.version !== 1
    || !positive(value.nextId) || !Array.isArray(value.localHosts) || !Array.isArray(value.deployments)
    || !plainObject(value.currentLocal) || !plainObject(value.currentPublished)
    || !Array.isArray(value.accepted) || value.accepted.length > HTTP_LIMITS.accepted
    || !Array.isArray(value.requests) || value.requests.length > HTTP_LIMITS.requests
    || jsonBytes(value) > HTTP_LIMITS.stateBytes) return false
  const captures = [...value.localHosts, ...value.deployments]
  if (captures.length > HTTP_LIMITS.captures || captures.some(row => !validateHttpCapture(row))
    || value.localHosts.some(row => row.scope !== 'local') || value.deployments.some(row => row.scope !== 'published')) return false
  const captureIdentity = row => `${row.appId}|${row.scope}|${row.generation}`
  const captureIdentities = new Set(captures.map(captureIdentity))
  if (captureIdentities.size !== captures.length) return false
  const currentValid = (selection, history) => Object.entries(selection).every(([appId, id]) => canonicalApp(appId)
    && history.some(row => row.id === id && row.appId === appId && row.status === 'captured'))
  if (!currentValid(value.currentLocal, value.localHosts) || !currentValid(value.currentPublished, value.deployments)) return false
  const ids = new Set(), validIds = rows => {
    let previous = 0
    for (const row of rows) {
      const number = Number(row.id.split('-').at(-1))
      if (!positive(number) || number <= previous || number >= value.nextId || ids.has(number)) return false
      ids.add(number); previous = number
    }
    return true
  }
  if (value.accepted.some(row => !validateHttpAcceptedRecord(row)) || value.requests.some(row => !validateHttpRequestRecord(row))
    || !validIds(value.accepted) || !validIds(value.requests) || !validIds(value.localHosts) || !validIds(value.deployments)
    || value.requests.some(row => !captureIdentities.has(captureIdentity(row)))) return false
  const identities = value.accepted.map(row => `${row.appId}|${JSON.stringify(normalizeHttpTarget(row.target))}|${row.order.id}`)
  return new Set(identities).size === identities.length && new Set(value.accepted.map(row => row.sendReceiptId)).size === value.accepted.length
}
