import { resolveRuntimePrincipal } from './identity.js'
import { readSecretAsPrincipal, setSecret } from '../sandbox/keyvault.js'
import { setAppConfigurationValue, getAppConfiguration, appConfigurationId } from '../sandbox/appconfiguration.js'
import { createConfigurationProvider, validKeyFilter } from './appconfiguration.js'
import { authorizeNotification, validAcceptedKeys, notificationChannels } from './notifications.js'
import { appendSecurityRecord, emptySecurityObservabilityState, safeSecurityJson, securityExact, securityText } from './state.js'

export const SECURITY_PROFILE = 'security-observability-v1'
export const SECURITY_SIGNATURES = Object.freeze({
  DefaultAzureCredential: [['managed_identity_client_id'], 0, 'credential', 0],
  SecretClient: [['vault_url', 'credential'], 2, 'secretclient'],
  'secretclient.get_secret': [['name', 'version'], 1, 'secret'],
  SettingSelector: [['key_filter', 'label_filter'], 0, 'selector', 0],
  WatchKey: [['key', 'label'], 1, 'watchkey'],
  load: [['endpoint', 'credential', 'selects', 'refresh_on', 'refresh_interval', 'keyvault_credential', 'secret_refresh_interval'], 2, 'configprovider', 0],
  'configprovider.refresh': [[], 0, 'data'],
  send_notification: [['event_id', 'order_id', 'api_key', 'channel'], 4, 'data'],
  advance_security_fixture: [[], 0, 'data'],
})
export const SECURITY_EXPORTS = Object.freeze({ 'azure.keyvault.secrets': ['SecretClient'],
  'azure.appconfiguration.provider': ['load', 'SettingSelector', 'WatchKey'] })
export const SECURITY_HELPERS = ['send_notification', 'advance_security_fixture']
export const SECURITY_INITIALIZERS = ['SecretClient', 'load', 'SettingSelector', 'WatchKey']
export function securityMemberType(type, name) {
  if (type === 'secret' && name === 'properties') return 'secretproperties'
  if (type === 'secret' && name === 'value') return 'secretvalue'
  if (type === 'secret' && name === 'name' || type === 'secretproperties' && name === 'version') return 'data'
  return null
}
const allowedKeys = (value, required, optional = []) => safeSecurityJson(value) && value && typeof value === 'object' && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key))
function validInput(input) {
  return allowedKeys(input, ['appId', 'notificationProvider'], ['operations', 'refreshFixture']) && securityText(input.appId)
    && securityExact(input.notificationProvider, 'id,acceptedKeys') && securityText(input.notificationProvider.id, 128) && validAcceptedKeys(input.notificationProvider.acceptedKeys)
    && (input.operations === undefined || Array.isArray(input.operations) && input.operations.length <= 50 && input.operations.every(item => securityExact(item, 'operationId,eventId,orderId')
      && Object.values(item).every(value => securityText(value))) && new Set(input.operations.map(item => item.eventId)).size === input.operations.length)
    && (input.refreshFixture === undefined || Array.isArray(input.refreshFixture) && input.refreshFixture.length <= 3 && input.refreshFixture.every(step =>
      allowedKeys(step, ['advanceMs'], ['settings', 'secrets', 'acceptedKeys']) && Number.isSafeInteger(step.advanceMs) && step.advanceMs >= 0 && step.advanceMs <= 86400000
      && (step.acceptedKeys === undefined || validAcceptedKeys(step.acceptedKeys))
      && (step.settings === undefined || Array.isArray(step.settings) && step.settings.length <= 50 && step.settings.every(setting => allowedKeys(setting, ['name', 'key'], ['label', 'value', 'secretIdentifier'])
        && securityText(setting.name, 50) && securityText(setting.key) && (setting.label === undefined || setting.label === null || securityText(setting.label, 128))
        && (setting.value === undefined || typeof setting.value === 'string' && setting.value.length <= 16384)
        && (setting.secretIdentifier === undefined || securityText(setting.secretIdentifier))))
      && (step.secrets === undefined || Array.isArray(step.secrets) && step.secrets.length <= 10 && step.secrets.every(secret => securityExact(secret, 'vaultName,name,value')
        && securityText(secret.vaultName, 24) && securityText(secret.name, 127) && securityText(secret.value, 1024)))))
    && new TextEncoder().encode(JSON.stringify(input)).length <= 128 * 1024
}

/** Trusted execution adapter. All handles are owned by the VM WeakMap. */
export function createSecuritySession(context) {
  const { input, handle, info, fail } = context
  const loc = { path: context.entry, line: 1, column: 1 }
  if (!validInput(input)) fail('The authored security fixture is malformed or exceeds its limits.', loc, 'MESSAGING_CONFIG')
  let resources = structuredClone(context.sandbox), acceptedKeys = structuredClone(input.notificationProvider.acceptedKeys), step = 0, providerSequence = 0
  const providers = []
  const knownSecrets = new Set([
    ...resources.keyVaults.flatMap(vault => vault.secrets.flatMap(secret => secret.versions.map(version => version.value))),
    ...acceptedKeys.map(key => key.value),
    ...(input.refreshFixture ?? []).flatMap(change => [...(change.secrets ?? []).map(secret => secret.value), ...(change.acceptedKeys ?? []).map(key => key.value)]),
  ].filter(value => typeof value === 'string' && value.length > 0))
  const containsSecret = value => typeof value === 'string' ? [...knownSecrets].some(secret => value.includes(secret))
    : value && typeof value === 'object' && !info(value) ? Object.values(value).some(containsSecret) : false
  const state = () => context.getState().securityObservability ?? emptySecurityObservabilityState()
  const update = extension => context.setState({ ...context.getState(), securityObservability: extension })
  update(state())
  const record = (fields, at) => {
    if (containsSecret(fields)) fail('Credential content cannot be recorded as public metadata.', at, 'SECURITY_PRIVACY')
    try { const result = appendSecurityRecord(state(), fields); update(result.state); return result.record }
    catch { fail('Security operation journal capacity or schema rejected this operation.', at, 'MESSAGING_LIMIT') }
  }
  // Validate every authored resource mutation before executing any saved source.
  let preflight = resources
  try {
    for (const change of input.refreshFixture ?? []) {
      for (const setting of change.settings ?? []) preflight = setAppConfigurationValue(preflight, setting).sandbox
      for (const secret of change.secrets ?? []) preflight = setSecret(preflight, secret).sandbox
    }
  } catch { fail('A security fixture references an unsupported resource change.', loc, 'MESSAGING_CONFIG') }
  function readSecret(request, principal, configProviderId, at) {
    const actual = readSecretAsPrincipal(resources, { ...request, version: request.version ?? undefined }, principal)
    const row = record({ kind: 'secret-read', principalId: principal.principalId, vaultUrl: actual.vaultUrl, name: actual.name,
      version: actual.version, configProviderId }, at)
    return { ...actual, request, principalId: principal.principalId, readId: row.id }
  }
  const privateContext = { info, handle, fail, record, readSecret, sandbox: () => resources, now: () => state().timeMs }
  function advance(at) {
    const change = input.refreshFixture?.[step]
    if (!change) fail('No authored security fixture step remains.', at, 'MESSAGING_CONFIG')
    let next = resources
    const settings = [], secrets = []
    for (const value of change.settings ?? []) {
      const result = setAppConfigurationValue(next, value); next = result.sandbox
      const setting = result.resource
      settings.push({ storeId: appConfigurationId(getAppConfiguration(next, value.name)), key: setting.key, label: setting.label, revision: setting.revision })
    }
    for (const value of change.secrets ?? []) {
      const result = setSecret(next, value); next = result.sandbox
      secrets.push({ vaultUrl: `https://${result.vault.name}.vault.azure.net/`, name: result.secret.name, version: result.resource.version })
    }
    const before = state(), timeMs = before.timeMs + change.advanceMs
    if (!Number.isSafeInteger(timeMs)) fail('Logical security clock overflow.', at, 'MESSAGING_LIMIT')
    update({ ...before, timeMs })
    try { record({ kind: 'fixture-advance', step: step + 1, settings, secrets, providerKeyIds: (change.acceptedKeys ?? acceptedKeys).map(key => key.id) }, at) }
    catch (error) { update(before); throw error }
    resources = next; acceptedKeys = structuredClone(change.acceptedKeys ?? acceptedKeys); step++
    return null
  }
  function invoke(name, owner, args, at) {
    if (name === 'DefaultAzureCredential') return handle('credential', { principal: resolveRuntimePrincipal(resources, { appId: input.appId }, args) })
    if (name === 'SecretClient') {
      const principal = info(args.credential)?.principal
      if (!principal || typeof args.vault_url !== 'string') fail('SecretClient requires an endpoint and runtime credential.', at, 'SECURITY_AUTH')
      return handle('secretclient', { principal, vaultUrl: args.vault_url })
    }
    if (name === 'secretclient.get_secret') {
      const client = info(owner)
      return handle('secret', readSecret({ vaultUrl: client.vaultUrl, name: args.name, version: args.version }, client.principal, null, at))
    }
    if (name === 'SettingSelector') {
      const key_filter = args.key_filter ?? '*', label_filter = args.label_filter ?? null
      if (!validKeyFilter(key_filter) || label_filter !== null && (!securityText(label_filter, 128) || /[*?,\\]/.test(label_filter))) fail('Selectors support exact labels and literal, * or terminal-prefix keys.', at, 'MESSAGING_CONFIG')
      return handle('selector', { key_filter, label_filter })
    }
    if (name === 'WatchKey') {
      const label = args.label ?? null
      if (!securityText(args.key) || /[*?,\\]/.test(args.key) || label !== null && (!securityText(label, 128) || /[*?,\\]/.test(label))) fail('WatchKey requires an exact key and label.', at, 'MESSAGING_CONFIG')
      return handle('watchkey', { key: args.key, label })
    }
    if (name === 'load') {
      const provider = createConfigurationProvider(privateContext, args, `config-${state().nextId}-${++providerSequence}`, at)
      providers.push(provider)
      return handle('configprovider', { provider })
    }
    if (name === 'configprovider.refresh') return info(owner).provider.refresh(at)
    if (name === 'advance_security_fixture') return advance(at)
    if (name === 'send_notification') {
      const channelToken = info(args.channel), channel = channelToken?.type === 'configvalue' ? channelToken.value : args.channel
      if (![args.event_id, args.order_id].every(value => securityText(value)) || !notificationChannels.includes(channel)) fail('Use authored notification identifiers and email, sms or console.', at, 'MESSAGING_CONFIG')
      const invocation = context.invocation()
      let linkage
      if (invocation) {
        if (invocation.eventId !== args.event_id || invocation.orderId !== args.order_id) fail('Notification must consume the current Event Grid delivery.', at, 'MESSAGING_CONFIG')
        linkage = invocation.linkage
      } else {
        if (context.mode !== 'script') fail('A Function notification requires its active Event Grid invocation.', at, 'MESSAGING_CONFIG')
        const operation = input.operations?.find(item => item.eventId === args.event_id && item.orderId === args.order_id)
        if (!operation) fail('The notification must match an authored demo operation.', at, 'MESSAGING_CONFIG')
        linkage = { kind: 'script', operationId: operation.operationId }
      }
      const token = info(args.api_key), keyId = authorizeNotification({ token, acceptedKeys, records: state().records })
      const validRead = token?.type === 'secretvalue' && state().records.some(row => row.id === token.readId)
      const consumedConfig = channelToken?.type === 'configvalue' ? channelToken : null
      // Reserve/validate the public operation before committing its business effect.
      const before = context.getState()
      record({ kind: 'notification-provider', providerId: input.notificationProvider.id, keyId, readId: validRead ? token.readId : null,
        principalId: validRead ? token.principalId : null, secretVersion: validRead ? token.version : null,
        eventId: args.event_id, orderId: args.order_id, channel, statusCode: keyId ? 202 : 401, invocation: linkage,
        configProviderId: consumedConfig?.configProviderId ?? null, configKey: consumedConfig?.configKey ?? null,
        configLabel: consumedConfig?.configLabel ?? null, configRevision: consumedConfig?.configRevision ?? null }, at)
      try { if (keyId) context.notify(args.event_id, args.order_id, at) }
      catch (error) { context.setState(before); throw error }
      return { status_code: keyId ? 202 : 401, channel }
    }
    return undefined
  }
  return {
    call(name, owner, args, at) {
      if (!Object.hasOwn(SECURITY_SIGNATURES, name)) return { handled: false }
      try { return { handled: true, value: invoke(name, owner, args, at) } }
      catch (error) {
        if (error.diagnostic) throw error
        fail('The application identity could not perform the requested resource operation.', at, 'SECURITY_AUTH')
      }
    },
    member(owner, name) {
      const object = info(owner)
      if (object?.type === 'secret' && name === 'value') return { handled: true, value: handle('secretvalue', { ...object, type: 'secretvalue' }) }
      if (object?.type === 'secret' && name === 'properties') return { handled: true, value: handle('secretproperties', { version: object.version }) }
      if (object?.type === 'secret' && name === 'name' || object?.type === 'secretproperties' && name === 'version') return { handled: true, value: object[name] }
      return { handled: false }
    },
    index(owner, key, at) {
      const provider = info(owner)?.provider
      if (info(owner)?.type !== 'configprovider') return { handled: false }
      if (!provider.cache.has(key)) fail('The selected configuration key was not loaded.', at, 'MESSAGING_CONFIG')
      return { handled: true, value: provider.cache.get(key) }
    },
    guard(value, at, category = 'output') {
      const token = info(value)
      if (token && ['secret', 'secretvalue'].includes(token.type) || token?.type === 'configvalue' && containsSecret(token.value) || containsSecret(value)) {
        record({ kind: 'privacy-violation', category }, at)
        fail('Secret-bearing values cannot cross this public boundary.', at, 'SECURITY_PRIVACY')
      }
    },
    checkpoint() { return { resources, acceptedKeys, step, providers: providers.map(provider => ({ provider, cache: provider.cache, selections: provider.selections, watches: provider.watches, lastConfigMs: provider.lastConfigMs, lastSecretMs: provider.lastSecretMs })) } },
    restore(checkpoint) { resources = checkpoint.resources; acceptedKeys = checkpoint.acceptedKeys; step = checkpoint.step
      for (const { provider, ...fields } of checkpoint.providers) Object.assign(provider, fields) },
  }
}
