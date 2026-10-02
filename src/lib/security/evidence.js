import { emptySecurityObservabilityState, validateSecurityObservabilityState, safeSecurityJson, securityExact } from './state.js'
import { canonicalize } from '../labEngine/evidence.js'
import { securityReadKeyIds } from './sdk.js'

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
  const notifications = new Map()
  for (const execution of messaging.executionReceipts ?? []) {
    const measurement = execution.measurements.securityObservability
    if (measurement === undefined) { if (state !== undefined) return false; continue }
    if (!state || measurement.startSequence !== next || !validSecuritySnapshot(measurement, state)) return false
    const reads = new Set(), successes = new Set()
    for (const row of measurement.records) {
      if (row.kind === 'secret-read') reads.add(row.id)
      if (row.kind === 'notification-provider') {
        if (row.readId !== null && !reads.has(row.readId)) return false
        if (row.statusCode === 202) {
          const effect = execution.measurements.effects.after.notifications?.[row.eventId] ?? notifications.get(row.eventId)
          if (!effect || effect.eventId !== row.eventId || effect.orderId !== row.orderId) return false
          successes.add(row.eventId)
        }
      }
      if (row.kind !== 'notification-provider' || row.invocation.kind !== 'eventgrid') continue
      const invocation = row.invocation
      const delivery = messaging.eventGrid?.deliveries.find(item => item.id === invocation.deliveryId && item.eventRecordId === invocation.eventRecordId)
      if (!delivery || execution.mode !== 'functions' || delivery.endpointType !== 'AzureFunction'
        || !delivery.endpoint.toLowerCase().startsWith(`${invocation.appId.toLowerCase()}/functions/`)
        || delivery.event.id !== row.eventId || delivery.event.data?.order_id !== row.orderId || delivery.attempts < invocation.attempt
        || !execution.measurements.trace.some(trace => trace.deliveryId === delivery.id && trace.attempts === invocation.attempt
          && ['delivered', 'retry', 'deadlettered', 'dropped'].includes(trace.kind))) return false
    }
    for (const [eventId, effect] of Object.entries(execution.measurements.effects.after.notifications ?? {})) {
      if (!successes.has(eventId) || !effect) return false
      notifications.set(eventId, effect)
    }
    next = measurement.endSequence
  }
  return state === undefined || validateSecurityObservabilityState(state) && next === state.nextId
}
export const securityActivity = measurement => measurement?.records.some(row => row.kind === 'notification-provider') === true

export function validSecurityLabContext(messaging, input, sandbox) {
  if (!input || !messaging.securityObservability) return false
  for (const execution of messaging.executionReceipts ?? []) {
    let accepted = input.notificationProvider?.acceptedKeys ?? [], step = 0
    const reads = new Map(), versions = new Map()
    const versionKey = row => `${row.vaultUrl.toLowerCase().replace(/\/$/, '')}/${row.name}/${row.version}`
    for (const vault of sandbox?.keyVaults ?? []) for (const secret of vault.secrets) for (const version of secret.versions) {
      versions.set(versionKey({ vaultUrl: `https://${vault.name}.vault.azure.net`, name: secret.name, version: version.version }), version.value)
    }
    for (const row of execution.measurements.securityObservability?.records ?? []) {
      if (row.kind === 'fixture-advance') {
        const change = input.refreshFixture?.[step++]
        if (!change || row.step !== step || row.secrets.length !== (change.secrets ?? []).length) return false
        accepted = change.acceptedKeys ?? accepted
        if (canonicalize(row.providerKeyIds) !== canonicalize(accepted.map(key => key.id))) return false
        for (let index = 0; index < row.secrets.length; index++) {
          const secret = row.secrets[index], authored = change.secrets[index]
          if (secret.vaultUrl.toLowerCase().replace(/\/$/, '') !== `https://${authored.vaultName.toLowerCase()}.vault.azure.net` || secret.name !== authored.name) return false
          versions.set(versionKey(secret), authored.value)
        }
      }
      if (row.kind === 'secret-read') {
        const key = versionKey(row)
        // Retained versions are checked independently. Deleted resources retain historical
        // value-free certification; resource dependency revisions make their proof stale.
        if (versions.has(key) && canonicalize(row.keyIds) !== canonicalize(securityReadKeyIds(versions.get(key), input))) return false
        reads.set(row.id, row)
      }
      if (row.kind !== 'notification-provider') continue
      if (row.providerId !== input.notificationProvider?.id) return false
      if (row.readId !== null && !reads.has(row.readId)) return false
      if (row.statusCode === 202 && (!reads.get(row.readId)?.keyIds.includes(row.keyId) || !accepted.some(key => key.id === row.keyId))) return false
      if (row.invocation.kind === 'script'
        ? !input.operations?.some(operation => operation.operationId === row.invocation.operationId && operation.eventId === row.eventId && operation.orderId === row.orderId)
        : row.invocation.appId.toLowerCase() !== input.appId?.toLowerCase()) return false
    }
  }
  return true
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
