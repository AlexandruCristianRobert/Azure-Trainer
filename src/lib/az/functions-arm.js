import { SUBSCRIPTION_ID } from '../sandbox/model.js'

const subscription = `/subscriptions/${SUBSCRIPTION_ID}`
const storageId = (account) => `${subscription}/resourceGroups/${account.resourceGroup}/providers/Microsoft.Storage/storageAccounts/${account.name}`
const appId = (app) => `${subscription}/resourceGroups/${app.resourceGroup}/providers/Microsoft.Web/sites/${app.name}`

export function presentStorageAccount(account) {
  return {
    id: storageId(account), name: account.name, resourceGroup: account.resourceGroup, location: account.location,
    type: 'Microsoft.Storage/storageAccounts', kind: account.kind, sku: { name: account.sku, tier: 'Standard' },
    tags: account.tags ?? {}, provisioningState: 'Succeeded',
  }
}

export function presentFunctionApp(app) {
  return {
    id: appId(app), name: app.name, resourceGroup: app.resourceGroup, location: app.location,
    type: 'Microsoft.Web/sites', kind: 'functionapp,linux', reserved: true, httpsOnly: true,
    defaultHostName: `${app.name}.azurewebsites.net`, functionAppConfig: { runtime: { name: 'node', version: '22' } },
    tags: app.tags ?? {}, state: 'Running',
  }
}

export function presentAppSettings(app, { includeValues = false, names = null } = {}) {
  const selected = names === null ? Object.keys(app.appSettings) : names
  return selected.map((name) => ({ name, value: includeValues ? app.appSettings[name] ?? null : null, slotSetting: false }))
}

export function presentCors(cors) {
  return { allowedOrigins: cors.allowedOrigins.slice(), supportCredentials: false }
}
