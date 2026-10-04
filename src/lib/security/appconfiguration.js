import { readAppConfigurationAsPrincipal, appConfigurationId, KEY_VAULT_REFERENCE_CONTENT_TYPE } from '../sandbox/appconfiguration.js'
import { securityText } from './state.js'

export function validKeyFilter(value) {
  return securityText(value) && !/[?,\\]/.test(value) && (value === '*' || !value.includes('*') || /^[^*]+\*$/.test(value))
}
const matches = (key, filter) => filter === '*' || (filter.endsWith('*') ? key.startsWith(filter.slice(0, -1)) : key === filter)
const sameSelections = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Caches are execution-local private handle metadata. Reads retain their originating selector/revision. */
export function createConfigurationProvider(context, options, providerId, loc) {
  const { info, fail } = context
  const principal = info(options.credential)?.principal
  if (!principal) fail('Configuration requires the selected runtime credential.', loc, 'SECURITY_AUTH')
  const store = context.sandbox().appConfigurationStores?.find(item => item.endpoint.toLowerCase() === String(options.endpoint).replace(/\/$/, '').toLowerCase())
  if (!store) fail('Configuration endpoint must resolve an actual store.', loc, 'MESSAGING_CONFIG')
  if (!Array.isArray(options.selects ?? []) || !Array.isArray(options.refresh_on ?? [])) fail('Selectors and watch keys must be lists.', loc, 'MESSAGING_CONFIG')
  const selectors = options.selects === undefined ? [{ key_filter: '*', label_filter: null }] : options.selects.map(token => info(token))
  if (!Array.isArray(options.selects ?? []) || selectors.length < 1 || selectors.length > 10 || selectors.some(value => !value || value.type && value.type !== 'selector')) fail('Use 1-10 supported SettingSelector values.', loc, 'MESSAGING_CONFIG')
  const watches = options.refresh_on === undefined ? [] : options.refresh_on.map(token => info(token))
  if (!Array.isArray(options.refresh_on ?? []) || watches.length > 10 || watches.some(value => value?.type !== 'watchkey')) fail('Use a bounded list of WatchKey values.', loc, 'MESSAGING_CONFIG')
  const interval = options.refresh_interval ?? 30, secretInterval = options.secret_refresh_interval ?? null
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 86400 || secretInterval !== null && (!Number.isSafeInteger(secretInterval) || secretInterval < 1 || secretInterval > 86400)) fail('Refresh intervals use bounded positive logical seconds.', loc, 'MESSAGING_CONFIG')
  const provider = { type: 'configprovider', id: providerId, storeId: appConfigurationId(store), principal, cache: new Map(), selections: [], watches: [],
    lastConfigMs: context.now(), lastSecretMs: context.now(), interval: interval * 1000, secretInterval: secretInterval === null ? null : secretInterval * 1000 }
  function selected() {
    const values = new Map()
    for (const selector of selectors) for (const setting of readAppConfigurationAsPrincipal(context.sandbox(), { name: store.name, label: selector.label_filter }, principal)) {
      if (matches(setting.key, selector.key_filter)) values.set(setting.key, setting)
    }
    return [...values.values()]
  }
  function watched() {
    return watches.map(watch => {
      const values = readAppConfigurationAsPrincipal(context.sandbox(), { name: store.name, label: watch.label }, principal)
      return values.find(value => value.key === watch.key)?.revision ?? null
    })
  }
  const metadata = values => values.map(({ key, label, revision }) => ({ key, label, revision }))
  function resolve(setting) {
    if (setting.contentType === KEY_VAULT_REFERENCE_CONTENT_TYPE) {
      const secretPrincipal = info(options.keyvault_credential)?.principal
      if (!secretPrincipal) fail('Key Vault references require keyvault_credential.', loc, 'SECURITY_AUTH')
      const uri = JSON.parse(setting.value).uri
      const match = /^(https:\/\/[^/]+)\/secrets\/([^/]+)(?:\/([^/]+))?$/.exec(uri)
      const read = context.readSecret({ vaultUrl: match[1], name: match[2], version: match[3] }, secretPrincipal, providerId, loc)
      return context.handle('secretvalue', { ...read, configProviderId: providerId, configKey: setting.key, configLabel: setting.label, configRevision: setting.revision })
    }
    return context.handle('configvalue', { value: setting.value, configProviderId: providerId, configKey: setting.key, configLabel: setting.label, configRevision: setting.revision })
  }
  function commit(values, watchValues, refreshSecrets) {
    const cache = new Map()
    for (const setting of values) {
      const previous = provider.selections.find(value => value.key === setting.key)
      cache.set(setting.key, !refreshSecrets && previous?.revision === setting.revision && previous?.label === setting.label
        ? provider.cache.get(setting.key) : resolve(setting))
    }
    provider.cache = cache; provider.selections = metadata(values); provider.watches = watchValues
  }
  function journal(kind, outcome) {
    context.record({ kind, providerId, storeId: provider.storeId, principalId: principal.principalId, selections: structuredClone(provider.selections), outcome,
      ...(kind === 'config-load' ? { watchKeys: watches.map(watch => ({ key: watch.key, label: watch.label })),
        refreshIntervalSeconds: interval, secretRefreshIntervalSeconds: secretInterval } : {}),
    }, loc)
  }
  commit(selected(), watched(), true)
  journal('config-load', 'loaded')
  provider.refresh = callLoc => {
    loc = callLoc
    const now = context.now(), configDue = now - provider.lastConfigMs >= provider.interval
    const secretDue = provider.secretInterval !== null && now - provider.lastSecretMs >= provider.secretInterval
    if (!configDue && !secretDue) { journal('config-refresh', 'early'); return null }
    const snapshot = { cache: provider.cache, selections: provider.selections, watches: provider.watches }
    try {
      const watchValues = configDue ? watched() : provider.watches
      const values = configDue ? selected() : []
      const configChanged = configDue && (watches.length ? !sameSelections(watchValues, provider.watches) : !sameSelections(metadata(values), provider.selections))
      if (configChanged) commit(values, watchValues, true)
      else if (secretDue) {
        const cache = new Map(provider.cache)
        for (const metadata of provider.selections) {
          // Refresh only the loaded reference; changed settings wait for configuration refresh.
          const prior = info(provider.cache.get(metadata.key))
          if (prior?.type === 'secretvalue') {
            const secretPrincipal = info(options.keyvault_credential)?.principal
            const read = context.readSecret(prior.request, secretPrincipal, providerId, loc)
            cache.set(metadata.key, context.handle('secretvalue', { ...read, configProviderId: providerId, configKey: metadata.key, configLabel: metadata.label, configRevision: metadata.revision }))
          }
        }
        provider.cache = cache
      }
      if (configDue) provider.lastConfigMs = now
      if (secretDue || configChanged) provider.lastSecretMs = now
      journal('config-refresh', configChanged || secretDue ? 'changed' : 'unchanged')
    } catch (error) {
      Object.assign(provider, snapshot)
      if (!['Forbidden', 'SecretNotFound', 'SecretDisabled', 'ResourceNotFound', 'CredentialUnavailable'].includes(error.code)) throw error
      if (configDue) provider.lastConfigMs = now
      if (secretDue) provider.lastSecretMs = now
      journal('config-refresh', 'failed')
    }
    return null
  }
  return provider
}
