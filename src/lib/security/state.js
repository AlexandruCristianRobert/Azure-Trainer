// Public metadata only. Private credentials and provider caches never enter this shape.
export const securityObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
export const securityExact = (value, keys) => securityObject(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
export const securityText = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max
  && !['__proto__', 'constructor', 'prototype'].includes(value)
const count = value => Number.isSafeInteger(value) && value >= 0
const nullable = value => value === null || securityText(value)
const encoded = value => new TextEncoder().encode(JSON.stringify(value)).length
export function safeSecurityJson(value, ancestors = new Set(), depth = 0, budget = { nodes: 0 }) {
  if (depth > 64 || ++budget.nodes > 20000) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if ((!Array.isArray(value) && !securityObject(value)) || ancestors.has(value)) return false
  const keys = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'))
  if (Array.isArray(value) && (Object.getPrototypeOf(value) !== Array.prototype || keys.length !== value.length || keys.some((key, i) => key !== String(i)))) return false
  ancestors.add(value)
  const valid = keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key)
      && descriptor.enumerable && Object.hasOwn(descriptor, 'value') && safeSecurityJson(descriptor.value, ancestors, depth + 1, budget)
  })
  ancestors.delete(value)
  return valid
}
export function emptySecurityObservabilityState() { return { version: 1, nextId: 1, timeMs: 0, records: [], telemetry: [] } }
const selection = value => securityExact(value, 'key,label,revision') && securityText(value.key)
  && (value.label === null || securityText(value.label, 128)) && count(value.revision) && value.revision > 0
const secretMetadata = value => securityExact(value, 'vaultUrl,name,version') && securityText(value.vaultUrl) && securityText(value.name, 127) && /^[a-f0-9]{32}$/.test(value.version)
export function validSecurityInvocation(value) {
  return securityExact(value, 'kind,operationId') && value.kind === 'script' && securityText(value.operationId)
    || securityExact(value, 'kind,appId,functionId,deliveryId,eventRecordId,attempt') && value.kind === 'eventgrid'
    && [value.appId, value.functionId, value.deliveryId, value.eventRecordId].every(item => securityText(item)) && count(value.attempt) && value.attempt > 0 && value.attempt <= 30
}
export function validSecurityRecord(row, previous) {
  if (!securityObject(row) || !/^so-[1-9]\d*$/.test(row.id) || !count(row.timeMs)) return false
  const base = 'id,kind,timeMs,'
  if (row.kind === 'secret-read') return securityExact(row, base + 'principalId,vaultUrl,name,version,configProviderId,keyIds')
    && securityText(row.principalId) && secretMetadata({ vaultUrl: row.vaultUrl, name: row.name, version: row.version }) && nullable(row.configProviderId)
    && Array.isArray(row.keyIds) && row.keyIds.length <= 16 && row.keyIds.every(id => securityText(id, 128)) && new Set(row.keyIds).size === row.keyIds.length
  if (['config-load', 'config-refresh'].includes(row.kind)) return securityExact(row, base + 'providerId,storeId,principalId,selections,outcome')
    && [row.providerId, row.storeId, row.principalId].every(item => securityText(item))
    && Array.isArray(row.selections) && row.selections.length <= 50 && row.selections.every(selection)
    && (row.kind === 'config-load' ? row.outcome === 'loaded' : ['changed', 'unchanged', 'early', 'failed'].includes(row.outcome))
  if (row.kind === 'fixture-advance') return securityExact(row, base + 'step,settings,secrets,providerKeyIds')
    && [1, 2, 3].includes(row.step) && Array.isArray(row.settings) && row.settings.length <= 50
    && row.settings.every(item => securityExact(item, 'storeId,key,label,revision') && securityText(item.storeId)
      && selection({ key: item.key, label: item.label, revision: item.revision }))
    && Array.isArray(row.secrets) && row.secrets.length <= 10 && row.secrets.every(secretMetadata)
    && Array.isArray(row.providerKeyIds) && row.providerKeyIds.length <= 4 && row.providerKeyIds.every(item => securityText(item, 128))
  if (row.kind === 'privacy-violation') return securityExact(row, base + 'category') && ['output', 'argument'].includes(row.category)
  if (row.kind === 'notification-provider') {
    if (!securityExact(row, base + 'providerId,keyId,readId,principalId,secretVersion,eventId,orderId,channel,statusCode,invocation,configProviderId,configKey,configLabel,configRevision')
      || ![row.providerId, row.eventId, row.orderId].every(item => securityText(item)) || !['email', 'sms', 'console'].includes(row.channel)
      || ![202, 401].includes(row.statusCode) || !validSecurityInvocation(row.invocation)
      || ![row.keyId, row.readId, row.principalId, row.secretVersion, row.configProviderId, row.configKey, row.configLabel].every(nullable)) return false
    if (row.configProviderId === null ? row.configKey !== null || row.configLabel !== null || row.configRevision !== null
      : !securityText(row.configKey) || !count(row.configRevision) || row.configRevision < 1
        || !previous.some(item => ['config-load', 'config-refresh'].includes(item.kind) && item.providerId === row.configProviderId
          && item.selections.some(s => s.key === row.configKey && s.label === row.configLabel && s.revision === row.configRevision))) return false
    const read = previous.find(item => item.id === row.readId && item.kind === 'secret-read')
    if (row.readId !== null && (!read || read.principalId !== row.principalId || read.version !== row.secretVersion)) return false
    return row.statusCode === 202 ? !!read && read.keyIds.includes(row.keyId) : row.keyId === null
  }
  return false
}
export function validateSecurityObservabilityState(value) {
  if (!safeSecurityJson(value) || !securityExact(value, 'version,nextId,timeMs,records,telemetry') || value.version !== 1
    || !count(value.nextId) || value.nextId < 1 || !count(value.timeMs) || !Array.isArray(value.records) || value.records.length > 500
    || !Array.isArray(value.telemetry) || value.telemetry.length !== 0 || encoded(value) > 128 * 1024) return false
  let lastTime = 0
  for (let i = 0; i < value.records.length; i++) {
    const row = value.records[i]
    if (!validSecurityRecord(row, value.records.slice(0, i)) || row.id !== `so-${i + 1}` || row.timeMs < lastTime || row.timeMs > value.timeMs) return false
    lastTime = row.timeMs
  }
  return value.nextId === value.records.length + 1
}
export function appendSecurityRecord(state, fields) {
  const record = { id: `so-${state.nextId}`, timeMs: state.timeMs, ...fields }
  const next = { ...state, nextId: state.nextId + 1, records: [...state.records, record] }
  if (!validateSecurityObservabilityState(next)) throw Object.assign(new Error('Security metadata is invalid or exceeds the bounded journal.'), { securityCode: 'MESSAGING_LIMIT' })
  return { state: next, record }
}
