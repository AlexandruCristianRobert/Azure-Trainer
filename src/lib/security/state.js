import { validTelemetryRow, validSpanLink, TELEMETRY_DESTINATION, TELEMETRY_EPOCH_MS } from '../observability/export.js'
import { TELEMETRY_COSTS } from '../observability/sdk.js'
import { validTelemetryQuery } from '../observability/query.js'
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
const refreshSeconds = value => Number.isSafeInteger(value) && value >= 1 && value <= 86400
const watchKey = value => securityExact(value, 'key,label') && securityText(value.key)
  && (value.label === null || securityText(value.label, 128))
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
  if (['config-load', 'config-refresh'].includes(row.kind)) return securityExact(row, base + 'providerId,storeId,principalId,selections,outcome'
    + (row.kind === 'config-load' ? ',watchKeys,refreshIntervalSeconds,secretRefreshIntervalSeconds' : ''))
    && [row.providerId, row.storeId, row.principalId].every(item => securityText(item))
    && Array.isArray(row.selections) && row.selections.length <= 50 && row.selections.every(selection)
    && (row.kind === 'config-load' ? row.outcome === 'loaded' : ['changed', 'unchanged', 'early', 'failed'].includes(row.outcome))
    && (row.kind !== 'config-load' || Array.isArray(row.watchKeys) && row.watchKeys.length <= 10 && row.watchKeys.every(watchKey)
      && refreshSeconds(row.refreshIntervalSeconds) && (row.secretRefreshIntervalSeconds === null || refreshSeconds(row.secretRefreshIntervalSeconds)))
  if (row.kind === 'fixture-advance') return securityExact(row, base + 'step,settings,secrets,providerKeyIds')
    && [1, 2, 3].includes(row.step) && Array.isArray(row.settings) && row.settings.length <= 50
    && row.settings.every(item => securityExact(item, 'storeId,key,label,revision') && securityText(item.storeId)
      && selection({ key: item.key, label: item.label, revision: item.revision }))
    && Array.isArray(row.secrets) && row.secrets.length <= 10 && row.secrets.every(secretMetadata)
    && Array.isArray(row.providerKeyIds) && row.providerKeyIds.length <= 4 && row.providerKeyIds.every(item => securityText(item, 128))
  if (row.kind === 'privacy-violation') return securityExact(row, base + 'category') && ['output', 'argument', 'telemetry', 'payload'].includes(row.category)
  if (row.kind === 'telemetry-export') return securityExact(row, base + 'rowId,destination,operationId,spanId' + (Object.hasOwn(row, 'metricInput') ? ',metricInput' : ''))
    && /^telemetry-[1-9]\d*$/.test(row.rowId) && row.destination === TELEMETRY_DESTINATION && validSpanLink({ operationId: row.operationId, spanId: row.spanId })
    && (!Object.hasOwn(row, 'metricInput') || securityExact(row.metricInput, 'queryId,rowIndex,column')
      && /^so-[1-9]\d*$/.test(row.metricInput.queryId) && count(row.metricInput.rowIndex) && row.metricInput.rowIndex < 200
      && securityText(row.metricInput.column, 128) && previous.some(query => query.kind === 'telemetry-query' && query.id === row.metricInput.queryId
        && Object.hasOwn(query.rows[row.metricInput.rowIndex] ?? {}, row.metricInput.column)
        && Number.isFinite(query.rows[row.metricInput.rowIndex][row.metricInput.column])))
  if (row.kind === 'telemetry-query') return securityExact(row, base + 'destination,generation,exportIds,inputRowIds,query,rows')
    && row.destination === TELEMETRY_DESTINATION && count(row.generation) && row.generation <= 500
    && Array.isArray(row.exportIds) && row.exportIds.length === row.generation && row.exportIds.every(id => previous.some(item => item.id === id && item.kind === 'telemetry-export'))
    && Array.isArray(row.inputRowIds) && row.inputRowIds.length === row.generation && row.inputRowIds.every(id => /^telemetry-[1-9]\d*$/.test(id))
    && securityExact(row.query, 'source,table,operators') && securityText(row.query.source, 16384) && Array.isArray(row.query.operators) && row.query.operators.length <= 16
    && Array.isArray(row.rows) && row.rows.length <= 200
  if (row.kind === 'telemetry-operation') return securityExact(row, base + 'operation,operationId,spanId,success,costMs,recordIds,traceIds')
    && ['secretclient.get_secret', 'load', 'configprovider.refresh', 'send_notification', 'publisher.send', 'sender.send_messages', 'receiver.receive_messages', 'receiver.complete_message', 'receiver.abandon_message', 'receiver.dead_letter_message', 'perform_order_work', 'record_processed'].includes(row.operation)
    && validSpanLink({ operationId: row.operationId, spanId: row.spanId }) && typeof row.success === 'boolean' && row.costMs === TELEMETRY_COSTS[row.operation]
    && Array.isArray(row.recordIds) && row.recordIds.length <= 100 && row.recordIds.every(id => previous.some(record => record.id === id))
    && Array.isArray(row.traceIds) && row.traceIds.length <= 100 && new Set(row.traceIds).size === row.traceIds.length && row.traceIds.every(id => securityText(id, 128))
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
    || !Array.isArray(value.telemetry) || value.telemetry.length > 500 || encoded(value) > 128 * 1024) return false
  if (!value.telemetry.every((row, index) => validTelemetryRow(row) && row.id === `telemetry-${index + 1}`)) return false
  const exports = value.records.filter(row => row.kind === 'telemetry-export')
  if (exports.length !== value.telemetry.length || !exports.every((record, index) => {
    const row = value.telemetry[index]
    return record.rowId === row.id && record.destination === row._ResourceId && record.operationId === row.OperationId
      && record.spanId === (row.Id ?? row.ParentId)
      && Date.parse(row.TimeGenerated) === TELEMETRY_EPOCH_MS + record.timeMs
      && (!Object.hasOwn(record, 'metricInput') || row.table === 'AppMetrics'
        && Number.isFinite(value.records.find(query => query.kind === 'telemetry-query' && query.id === record.metricInput?.queryId)?.rows?.[record.metricInput?.rowIndex]?.[record.metricInput?.column])
        && row.Sum === value.records.find(query => query.kind === 'telemetry-query' && query.id === record.metricInput?.queryId)?.rows?.[record.metricInput?.rowIndex]?.[record.metricInput?.column]
        && row.Min === row.Sum && row.Max === row.Sum && row.Count === 1)
  })) return false
  let lastTime = 0
  for (let i = 0; i < value.records.length; i++) {
    const row = value.records[i]
    if (!validSecurityRecord(row, value.records.slice(0, i)) || row.id !== `so-${i + 1}` || row.timeMs < lastTime || row.timeMs > value.timeMs) return false
    if (row.kind === 'telemetry-query' && !validTelemetryQuery(row, value, value.records.slice(0, i))) return false
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
