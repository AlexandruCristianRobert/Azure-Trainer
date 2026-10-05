import { finiteJson, plainObject } from '../messaging/state.js'

export const HTTP_PROFILE = 'http-functions-v1'
export const HTTP_LIMITS = Object.freeze({ captures: 16, accepted: 50, requests: 100, stateBytes: 256 * 1024,
  sourceBytes: 64 * 1024, urlChars: 2048, bodyBytes: 16 * 1024, responseBytes: 16 * 1024,
  entries: 32, routes: 32, files: 16, fileBytes: 128 * 1024, projectBytes: 512 * 1024 })
const unsafe = new Set(['__proto__', 'prototype', 'constructor'])
export const jsonBytes = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length
export const httpCounter = value => Number.isSafeInteger(value) && value >= 0
export const httpText = (value, max = 256) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)
export const closedHttpObject = (value, required, optional = []) => plainObject(value) && finiteJson(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key))
export function httpError(message, code = 'HTTP_CONFIG') { throw Object.assign(new Error(message), { httpCode: code }) }
export function normalizeHttpAppId(value) {
  if (!httpText(value, 1024) || !/^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.web\/sites\/[a-z0-9][a-z0-9-]*$/i.test(value)) httpError('Select a valid Function App identity.')
  return value.toLowerCase()
}
export function normalizeHttpTarget(value) {
  if (!closedHttpObject(value, ['resourceGroup', 'namespace', 'queue'])
    || Object.values(value).some(item => !httpText(item) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(item))) httpError('Select a bounded Service Bus queue target.')
  return { resourceGroup: value.resourceGroup.toLowerCase(), namespace: value.namespace.toLowerCase(), queue: value.queue.toLowerCase() }
}
export function normalizeOrder(value) {
  if (!closedHttpObject(value, ['id', 'region', 'quantity']) || typeof value.id !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id) || !['EU', 'US'].includes(value.region)
    || !Number.isInteger(value.quantity) || value.quantity < 1 || value.quantity > 100) httpError('Order must contain valid id, region and integer quantity only.')
  return { id: value.id, region: value.region, quantity: value.quantity }
}
export const HTTP_INPUT_CLASSES = Object.freeze(['none', 'malformed', 'nonobject', 'fields', 'id', 'region',
  'quantity-bool', 'quantity-type', 'quantity-fraction', 'quantity-range', 'valid', 'protected'])
export const validHttpInputClass = value => HTTP_INPUT_CLASSES.includes(value)
/** Value-free observation of actual input; never an automatic handler response. */
export function classifyHttpOrderInput(method, body) {
  if (method === 'GET') return 'none'
  let value
  try { value = JSON.parse(body) } catch { return 'malformed' }
  if (!plainObject(value)) return 'nonobject'
  if (Object.keys(value).length !== 3 || !['id', 'region', 'quantity'].every(key => Object.hasOwn(value, key))) return 'fields'
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id)) return 'id'
  if (!['EU', 'US'].includes(value.region)) return 'region'
  if (typeof value.quantity === 'boolean') return 'quantity-bool'
  if (typeof value.quantity !== 'number' || !Number.isFinite(value.quantity)) return 'quantity-type'
  if (!Number.isInteger(value.quantity)) return 'quantity-fraction'
  if (value.quantity < 1 || value.quantity > 100) return 'quantity-range'
  return 'valid'
}
// Repository DTOs carry private metadata. Identity projects only the business fields.
export function sameCanonicalOrder(a, b) {
  if (!plainObject(a) || !finiteJson(a) || !plainObject(b) || !finiteJson(b)) return false
  try {
    const project = value => normalizeOrder({ id: value.id, region: value.region, quantity: value.quantity })
    const left = project(a), right = project(b)
    return left.id === right.id && left.region === right.region && left.quantity === right.quantity
  } catch { return false }
}
export function normalizeHttpHeaders(value = {}) {
  if (!plainObject(value) || !finiteJson(value)) httpError('Headers must be finite string entries.')
  if (Object.keys(value).length > HTTP_LIMITS.entries) httpError('Header entry limit exceeded.', 'HTTP_LIMIT')
  const result = {}
  for (const [key, entry] of Object.entries(value)) {
    const name = key.toLowerCase()
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || unsafe.has(name) || typeof entry !== 'string'
      || /[\x00-\x1f\x7f]/.test(entry) || entry.length > HTTP_LIMITS.bodyBytes
      || Object.hasOwn(result, name) && result[name] !== entry) httpError('Unsupported or conflicting header.')
    result[name] = entry
  }
  if (jsonBytes(result) > HTTP_LIMITS.bodyBytes) httpError('Header byte limit exceeded.', 'HTTP_LIMIT')
  return result
}
function decode(value) {
  try { return decodeURIComponent(value) } catch { httpError('Malformed URI encoding.') }
}
// Validate an already-decoded path. Percent signs, '?' and '#' are parameter data.
export function normalizeHttpPath(value) {
  if (!httpText(value, HTTP_LIMITS.urlChars) || !value.startsWith('/') || /\\/.test(value)) httpError('Unsupported HTTP path.')
  const segments = value.split('/').slice(1)
  if (segments.some(segment => !segment || /%(?:2f|5c|00)/i.test(segment)
    || ['.', '..'].includes(segment) || /^(?:%2e){1,2}$/i.test(segment))) httpError('Unsupported HTTP path segment.')
  if (segments[0]?.toLowerCase() !== 'api' || segments.length < 2) httpError('HTTP routes use the /api prefix.')
  return '/' + segments.join('/')
}
// Decode only at the raw URL boundary, before the URL class can erase dot segments.
export function parseHttpPath(value) {
  if (!httpText(value, HTTP_LIMITS.urlChars) || !value.startsWith('/') || /[\\?#]/.test(value)) httpError('Unsupported HTTP path.')
  const segments = value.split('/').slice(1).map(segment => {
    const decoded = decode(segment)
    if (/[\/\\\x00-\x1f\x7f]/.test(decoded)) httpError('Unsupported HTTP path segment.')
    return decoded
  })
  return normalizeHttpPath('/' + segments.join('/'))
}
export function parseHttpRequest(intent, { appId } = {}) {
  if (!closedHttpObject(intent, ['method', 'url'], ['headers', 'body']) || typeof intent.method !== 'string') httpError('HTTP request accepts method, URL, headers and body intent only.')
  const identity = normalizeHttpAppId(appId), method = intent.method.toUpperCase()
  if (!['GET', 'POST'].includes(method)) httpError('Only GET and POST are supported.', 'HTTP_UNSUPPORTED')
  if (!httpText(intent.url, HTTP_LIMITS.urlChars) || /[\\#]/.test(intent.url)) httpError('Unsupported or oversized HTTP URL.')
  // Validate the unnormalized path first: URL would otherwise erase dot segments.
  const raw = /^(https?):\/\/([^/?]+)(\/[^?]*)(?:\?(.*))?$/i.exec(intent.url)
  if (!raw) httpError('Unsupported HTTP URL.')
  const path = parseHttpPath(raw[3])
  let url
  try { url = new URL(intent.url) } catch { httpError('Unsupported HTTP URL.') }
  const host = identity.split('/').at(-1) + '.azurewebsites.net'
  const scope = raw[1].toLowerCase() === 'http' && raw[2].toLowerCase() === 'localhost:7071' ? 'local'
    : raw[1].toLowerCase() === 'https' && raw[2].toLowerCase() === host ? 'published' : null
  if (!scope || url.username || url.password) httpError('Only the local or selected Function App endpoint is supported.', 'HTTP_UNSUPPORTED')
  const query = {}, entries = raw[4] ? raw[4].split('&') : []
  if (entries.length > HTTP_LIMITS.entries) httpError('Query entry limit exceeded.', 'HTTP_LIMIT')
  for (const entry of entries) {
    const split = entry.indexOf('='), key = decode((split < 0 ? entry : entry.slice(0, split)).replace(/\+/g, ' '))
    const value = decode((split < 0 ? '' : entry.slice(split + 1)).replace(/\+/g, ' '))
    if (!httpText(key) || unsafe.has(key) || /[\x00-\x1f\x7f]/.test(value) || Object.hasOwn(query, key)) httpError('Unsupported or duplicate query entry.')
    query[key] = value
  }
  const body = intent.body ?? ''
  if (typeof body !== 'string') httpError('HTTP body must be raw text.')
  if (jsonBytes(body) > HTTP_LIMITS.bodyBytes) httpError('HTTP body byte limit exceeded.', 'HTTP_LIMIT')
  return { appId: identity, scope, method, url: intent.url, path, headers: normalizeHttpHeaders(intent.headers), query, body }
}
function routeParts(route) {
  if (!httpText(route, HTTP_LIMITS.urlChars) || route.startsWith('/') || route.endsWith('/')) httpError('Unsupported HTTP route template.')
  const names = new Set()
  return route.split('/').map(part => {
    const parameter = /^\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(part)
    if (parameter) {
      if (unsafe.has(parameter[1]) || names.has(parameter[1])) httpError('Duplicate or unsafe route parameter.')
      names.add(parameter[1])
      if (names.size > HTTP_LIMITS.entries) httpError('Route parameter limit exceeded.', 'HTTP_LIMIT')
      return { parameter: parameter[1] }
    }
    if (!/^[A-Za-z0-9_-]+$/.test(part)) httpError('Routes support literals and whole-segment parameters only.', 'HTTP_UNSUPPORTED')
    return { literal: part.toLowerCase() }
  })
}
function compileRoutes(routes) {
  if (!Array.isArray(routes) || !finiteJson(routes) || routes.length > HTTP_LIMITS.routes) httpError('Invalid or oversized HTTP routes.')
  const compiled = routes.map(route => {
    if (!closedHttpObject(route, ['route', 'methods'], ['authLevel', 'functionId', 'functionName', 'path'])
      || !Array.isArray(route.methods) || route.methods.length < 1 || route.methods.some(method => !['GET', 'POST'].includes(method))
      || new Set(route.methods).size !== route.methods.length
      || route.authLevel !== undefined && !['anonymous', 'function'].includes(route.authLevel)
      || ['functionId', 'functionName', 'path'].some(key => route[key] !== undefined && !httpText(route[key]))) httpError('Invalid HTTP route declaration.')
    return { route, parts: routeParts(route.route) }
  })
  for (let i = 0; i < compiled.length; i++) for (const right of compiled.slice(i + 1)) {
    const left = compiled[i]
    if (left.parts.length !== right.parts.length || !left.route.methods.some(method => right.route.methods.includes(method))) continue
    const overlap = left.parts.every((part, index) => !part.literal || !right.parts[index].literal || part.literal === right.parts[index].literal)
    const dominates = (a, b) => a.parts.every((part, index) => !b.parts[index].literal || part.literal === b.parts[index].literal)
      && a.parts.some((part, index) => part.literal && !b.parts[index].literal)
    if (overlap && !dominates(left, right) && !dominates(right, left)) httpError('Ambiguous same-method HTTP routes.')
  }
  return compiled
}
export function validateHttpRoutes(value) { try { compileRoutes(value); return true } catch { return false } }
export function matchHttpRoute(routes, method, path) {
  const compiled = compileRoutes(routes), segments = normalizeHttpPath(path).split('/').slice(2)
  const matches = compiled.filter(row => row.parts.length === segments.length && row.parts.every((part, index) => !part.literal || part.literal === segments[index].toLowerCase()))
  if (!matches.length) return { status: 404, route: null, params: {}, allow: [] }
  const score = row => row.parts.filter(part => part.literal).length, maximum = Math.max(...matches.map(score))
  const best = matches.filter(row => score(row) === maximum), allow = [...new Set(best.flatMap(row => row.route.methods))].sort()
  const selected = best.find(row => row.route.methods.includes(String(method).toUpperCase()))
  if (!selected) return { status: 405, route: null, params: {}, allow }
  const params = {}
  selected.parts.forEach((part, index) => { if (part.parameter) params[part.parameter] = segments[index] })
  return { status: 200, route: JSON.parse(JSON.stringify(selected.route)), params, allow }
}
