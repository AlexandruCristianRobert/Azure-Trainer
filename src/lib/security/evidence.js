import { emptySecurityObservabilityState, validateSecurityObservabilityState, safeSecurityJson, securityExact } from './state.js'
import { canonicalize } from '../labEngine/evidence.js'

export function securityMeasurements(before, after) {
  const startSequence = (before ?? emptySecurityObservabilityState()).nextId
  return { version: 1, startSequence, endSequence: after.nextId,
    records: structuredClone(after.records.slice(startSequence - 1)), telemetry: [] }
}
export function validSecurityMeasurement(value) {
  return safeSecurityJson(value) && securityExact(value, 'version,startSequence,endSequence,records,telemetry') && value.version === 1
    && Number.isSafeInteger(value.startSequence) && value.startSequence >= 1 && Number.isSafeInteger(value.endSequence) && value.endSequence >= value.startSequence
    && Array.isArray(value.records) && value.records.length <= 500 && value.records.length === value.endSequence - value.startSequence
    && value.records.every((row, index) => row.id === `so-${value.startSequence + index}`)
    && Array.isArray(value.telemetry) && value.telemetry.length === 0
    && new TextEncoder().encode(JSON.stringify(value)).length <= 128 * 1024
}
export function validSecuritySnapshot(value, state) {
  return validSecurityMeasurement(value) && validateSecurityObservabilityState(state) && value.endSequence <= state.nextId
    && canonicalize(value.records) === canonicalize(state.records.slice(value.startSequence - 1, value.endSequence - 1))
}
export function validSecurityJournal(messaging) {
  const state = messaging.securityObservability
  let next = 1
  for (const execution of messaging.executionReceipts ?? []) {
    const measurement = execution.measurements.securityObservability
    if (measurement === undefined) { if (state !== undefined) return false; continue }
    if (!state || measurement.startSequence !== next || !validSecuritySnapshot(measurement, state)) return false
    for (const row of measurement.records) {
      if (row.kind !== 'notification-provider' || row.invocation.kind !== 'eventgrid') continue
      const invocation = row.invocation
      const delivery = messaging.eventGrid?.deliveries.find(item => item.id === invocation.deliveryId && item.eventRecordId === invocation.eventRecordId)
      if (!delivery || execution.mode !== 'functions' || delivery.endpointType !== 'AzureFunction'
        || !delivery.endpoint.toLowerCase().startsWith(`${invocation.appId.toLowerCase()}/functions/`)
        || delivery.event.id !== row.eventId || delivery.event.data?.order_id !== row.orderId || delivery.attempts < invocation.attempt
        || !execution.measurements.trace.some(trace => trace.deliveryId === delivery.id && trace.attempts === invocation.attempt
          && ['delivered', 'retry', 'deadlettered', 'dropped'].includes(trace.kind))) return false
    }
    next = measurement.endSequence
  }
  return state === undefined || validateSecurityObservabilityState(state) && next === state.nextId
}
export const securityActivity = measurement => measurement?.records.some(row => row.kind === 'notification-provider') === true

export function validSecurityLabContext(messaging, input) {
  if (!input || !messaging.securityObservability) return false
  return messaging.securityObservability.records.every(row => {
    if (row.kind !== 'notification-provider') return true
    if (row.providerId !== input.notificationProvider?.id) return false
    return row.invocation.kind === 'script'
      ? input.operations?.some(operation => operation.operationId === row.invocation.operationId && operation.eventId === row.eventId && operation.orderId === row.orderId) === true
      : row.invocation.appId.toLowerCase() === input.appId?.toLowerCase()
  })
}

/** No whole-vault selector: versions and enabled flags are metadata, never values/hashes. */
export function securityResourceMetadata(sandbox) {
  return {
    identities: (sandbox.managedIdentities ?? []).map(identity => ({ id: identity.id, clientId: identity.clientId, principalId: identity.principalId })),
    apps: (sandbox.functionApps ?? []).map(app => ({ name: app.name, resourceGroup: app.resourceGroup, identities: app.userAssignedIdentityIds ?? [] })),
    vaults: (sandbox.keyVaults ?? []).map(vault => ({ name: vault.name, resourceGroup: vault.resourceGroup, roles: vault.roleAssignments,
      secrets: vault.secrets.map(secret => ({ name: secret.name, versions: secret.versions.map(version => ({ version: version.version, enabled: version.enabled })) })) })),
    stores: (sandbox.appConfigurationStores ?? []).map(store => ({ name: store.name, resourceGroup: store.resourceGroup, roles: store.roleAssignments,
      settings: store.settings.map(setting => ({ key: setting.key, label: setting.label, revision: setting.revision, contentType: setting.contentType })) })),
  }
}
