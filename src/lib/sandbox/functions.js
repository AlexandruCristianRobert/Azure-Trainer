import { cloneSandbox, nowIso } from './model.js'
import { normalizeLocation } from './locations.js'
import { AzError } from './errors.js'
import { getResourceGroup } from './ops.js'

const STORAGE_NAME_RE = /^[a-z0-9]{3,24}$/
const FUNCTION_APP_NAME_RE = /^(?=.{2,60}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const SETTING_NAME_RE = /^[A-Za-z0-9._]+$/
const RESERVED_SETTING_RE = /^(AzureWebJobs|FUNCTIONS_|WEBSITE_|SCM_)/i

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function storageByName(sb, name) {
  return sb.storageAccounts.find((account) => same(account.name, name))
}

function appByName(sb, name) {
  return sb.functionApps.find((app) => same(app.name, name))
}

function requireStorageName(name) {
  if (typeof name !== 'string' || !STORAGE_NAME_RE.test(name)) throw new AzError('AccountNameInvalid', `The storage account name '${name}' is invalid. Names must be 3-24 lowercase letters or numbers.`)
}

function requireFunctionAppName(name) {
  if (typeof name !== 'string' || !FUNCTION_APP_NAME_RE.test(name)) throw new AzError('BadRequest', `The Function App name '${name}' is invalid. Names must be 2-60 ASCII letters, numbers or hyphens and cannot start or end with a hyphen.`)
}

function requireStorageSku(sku) {
  if (sku !== 'Standard_LRS' && sku !== 'Standard_ZRS') throw new AzError('InvalidArgumentValue', `argument --sku: invalid choice: '${sku}' (choose from 'Standard_LRS', 'Standard_ZRS')`, { kind: 'cli' })
}

function resolveLocation(raw, group, resourceType) {
  const location = raw === undefined || raw === null ? group.location : normalizeLocation(raw)
  if (!location) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${raw}' is not available for resource type '${resourceType}'.`)
  return location
}

function requireCustomSettingName(name) {
  if (typeof name !== 'string' || !SETTING_NAME_RE.test(name)) throw new AzError('InvalidArgumentValue', `Application setting name '${name}' is invalid. Names may contain ASCII letters, numbers, periods and underscores.`)
  if (RESERVED_SETTING_RE.test(name)) throw new AzError('InvalidArgumentValue', `Application setting '${name}' is managed by the Sandbox. Azure runtime and storage configuration settings cannot be changed in this Lab.`)
}

function parseSettings(items) {
  if (!Array.isArray(items) || items.length === 0) throw new AzError('InvalidArgumentValue', 'argument --settings: expected at least one KEY=VALUE setting.', { kind: 'cli' })
  const pairs = []
  for (const item of items) {
    if (typeof item !== 'string' || item.startsWith('@')) throw new AzError('InvalidArgumentValue', 'File references are not supported for application settings in the Sandbox.', { kind: 'cli' })
    const index = item.indexOf('=')
    if (index === -1) throw new AzError('InvalidArgumentValue', `Application setting '${item}' must use KEY=VALUE; an empty value is written as KEY=.`, { kind: 'cli' })
    const name = item.slice(0, index)
    requireCustomSettingName(name)
    pairs.push([name, item.slice(index + 1)])
  }
  return pairs
}

function parseSettingNames(items) {
  if (!Array.isArray(items) || items.length === 0) throw new AzError('InvalidArgumentValue', 'argument --setting-names: expected at least one application setting name.', { kind: 'cli' })
  for (const name of items) requireCustomSettingName(name)
  return items
}

function normalizedOrigin(raw) {
  if (raw === '*') return '*'
  if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw)) throw new AzError('InvalidArgumentValue', `CORS origin '${raw}' is invalid. Use * alone or an HTTP(S) origin.`, { kind: 'cli' })
  let url
  try { url = new URL(raw) } catch { throw new AzError('InvalidArgumentValue', `CORS origin '${raw}' is invalid. Use * alone or an HTTP(S) origin.`) }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new AzError('InvalidArgumentValue', `CORS origin '${raw}' is invalid. Origins must include only an HTTP(S) scheme, host and optional port.`)
  }
  return url.origin
}

function parseOrigins(items, { required = false } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    if (required) throw new AzError('InvalidArgumentValue', 'argument --allowed-origins: expected at least one origin.', { kind: 'cli' })
    return []
  }
  const origins = [...new Set(items.map(normalizedOrigin))]
  if (origins.includes('*') && origins.length > 1) throw new AzError('InvalidArgumentValue', "The wildcard '*' cannot be combined with specific CORS origins.")
  return origins
}

export function getStorageAccount(sb, resourceGroup, name) {
  getResourceGroup(sb, resourceGroup)
  const account = storageByName(sb, name)
  if (!account || !same(account.resourceGroup, resourceGroup)) throw new AzError('ResourceNotFound', `The storage account '${name}' under resource group '${resourceGroup}' was not found.`)
  return account
}

export function listStorageAccounts(sb, resourceGroup = null) {
  if (resourceGroup === null) return sb.storageAccounts.slice()
  getResourceGroup(sb, resourceGroup)
  return sb.storageAccounts.filter((account) => same(account.resourceGroup, resourceGroup))
}

export function createStorageAccount(sb, { resourceGroup, name, location, kind = 'StorageV2', sku = 'Standard_LRS', tags = null }) {
  const group = getResourceGroup(sb, resourceGroup)
  requireStorageName(name)
  if (kind !== 'StorageV2') throw new AzError('InvalidArgumentValue', `Only StorageV2 accounts are supported in the Sandbox; received '${kind}'.`, { kind: 'cli' })
  requireStorageSku(sku)
  const resolvedLocation = resolveLocation(location, group, 'Microsoft.Storage/storageAccounts')
  const existing = storageByName(sb, name)
  if (existing && !same(existing.resourceGroup, resourceGroup)) throw new AzError('Conflict', `The storage account name '${name}' is already used by '${existing.name}' in resource group '${existing.resourceGroup}'.`)
  if (existing && !same(existing.location, resolvedLocation)) throw new AzError('Conflict', `The storage account '${existing.name}' location cannot be changed after creation.`)
  const next = cloneSandbox(sb)
  let account = storageByName(next, name)
  if (account) {
    account.sku = sku
    if (tags !== null) account.tags = tags
  } else {
    account = { name, resourceGroup: group.name, location: resolvedLocation, kind: 'StorageV2', sku, tags, createdAt: nowIso() }
    next.storageAccounts.push(account)
  }
  return { sandbox: next, resource: account }
}

export function deleteStorageAccount(sb, { resourceGroup, name }) {
  const account = getStorageAccount(sb, resourceGroup, name)
  const dependent = sb.functionApps.find((app) => same(app.storageResourceGroup, account.resourceGroup) && same(app.storageAccount, account.name))
  if (dependent) throw new AzError('Conflict', `The storage account '${account.name}' cannot be deleted while Function App '${dependent.name}' uses it.`)
  const next = cloneSandbox(sb)
  next.storageAccounts = next.storageAccounts.filter((item) => !same(item.name, name))
  return { sandbox: next, resource: account }
}

export function getFunctionApp(sb, resourceGroup, name) {
  getResourceGroup(sb, resourceGroup)
  const app = appByName(sb, name)
  if (!app || !same(app.resourceGroup, resourceGroup)) throw new AzError('ResourceNotFound', `The Function App '${name}' under resource group '${resourceGroup}' was not found.`)
  return app
}

export function listFunctionApps(sb, resourceGroup = null) {
  if (resourceGroup === null) return sb.functionApps.slice()
  getResourceGroup(sb, resourceGroup)
  return sb.functionApps.filter((app) => same(app.resourceGroup, resourceGroup))
}

export function createFunctionApp(sb, { resourceGroup, name, storageAccount, flexconsumptionLocation, runtime, runtimeVersion, functionsVersion = '4', osType = 'Linux', tags = null }) {
  const group = getResourceGroup(sb, resourceGroup)
  requireFunctionAppName(name)
  if (!((runtime === 'node' && runtimeVersion === '22') || (runtime === 'python' && runtimeVersion === '3.12'))) throw new AzError('InvalidArgumentValue', 'Supported runtime/version pairs are node/22 and python/3.12.', { kind: 'cli' })
  if (functionsVersion !== '4') throw new AzError('InvalidArgumentValue', `Only Functions version 4 is supported in the Sandbox; received '${functionsVersion}'.`, { kind: 'cli' })
  if (osType !== 'Linux') throw new AzError('InvalidArgumentValue', `Only Linux is supported for Flex Consumption in the Sandbox; received '${osType}'.`, { kind: 'cli' })
  const location = resolveLocation(flexconsumptionLocation, group, 'Microsoft.Web/sites')
  const account = getStorageAccount(sb, group.name, storageAccount)
  if (!same(account.location, location)) throw new AzError('BadRequest', `The Function App and storage account must use the same location. Storage account '${account.name}' is configured for '${account.location}'.`)
  const existing = appByName(sb, name)
  if (existing && !same(existing.resourceGroup, resourceGroup)) throw new AzError('Conflict', `The Function App name '${name}' is already used by '${existing.name}' in resource group '${existing.resourceGroup}'.`)
  if (existing && (!same(existing.location, location) || !same(existing.storageAccount, account.name) || !same(existing.storageResourceGroup, account.resourceGroup) || existing.runtime !== runtime || existing.runtimeVersion !== runtimeVersion || existing.functionsVersion !== functionsVersion || existing.hostingPlan !== 'FlexConsumption' || existing.os !== 'Linux')) {
    throw new AzError('Conflict', `The Function App '${existing.name}' hosting, runtime, location and storage configuration cannot be changed after creation.`)
  }
  const next = cloneSandbox(sb)
  let app = appByName(next, name)
  if (app) {
    if (tags !== null) app.tags = tags
  } else {
    app = { name, resourceGroup: group.name, location, storageAccount: account.name, storageResourceGroup: account.resourceGroup, hostingPlan: 'FlexConsumption', os: 'Linux', runtime, runtimeVersion, functionsVersion: '4', httpsOnly: true, appSettings: {}, cors: { allowedOrigins: [], supportCredentials: false }, tags, createdAt: nowIso() }
    next.functionApps.push(app)
  }
  return { sandbox: next, resource: app }
}

export function deleteFunctionApp(sb, { resourceGroup, name }) {
  const app = getFunctionApp(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  next.functionApps = next.functionApps.filter((item) => !same(item.name, name))
  return { sandbox: next, resource: app }
}

export function assignFunctionAppIdentity(sb, { resourceGroup, name, identities }) {
  const app = getFunctionApp(sb, resourceGroup, name)
  if (!Array.isArray(identities) || !identities.length || identities.length > 32) throw new AzError('InvalidArgumentValue', 'Specify 1-32 actual user-assigned identity ARM IDs.')
  const selected = identities.map(id => (sb.managedIdentities ?? []).find(identity => typeof id === 'string' && same(identity.id, id)))
  if (selected.some(identity => !identity)) throw new AzError('PrincipalNotFound', 'Every attached identity must exist in the Sandbox.')
  const assigned = [...new Set([...(app.userAssignedIdentityIds ?? []), ...selected.map(identity => identity.id)])]
  if (assigned.length > 32) throw new AzError('InvalidArgumentValue', 'An application supports at most 32 attached identities.')
  const next = cloneSandbox(sb)
  const resource = appByName(next, app.name)
  resource.userAssignedIdentityIds = assigned
  return { sandbox: next, resource }
}

export function removeFunctionAppIdentity(sb, { resourceGroup, name, identities }) {
  const app = getFunctionApp(sb, resourceGroup, name)
  if (!Array.isArray(identities) || !identities.length || identities.length > 32 || identities.some(id => typeof id !== 'string'))
    throw new AzError('InvalidArgumentValue', 'Specify 1-32 attached user-assigned identity ARM IDs.')
  if (identities.some(id => !(app.userAssignedIdentityIds ?? []).some(assigned => same(assigned, id))))
    throw new AzError('PrincipalNotFound', 'The requested identity is not attached to this application.')
  const next = cloneSandbox(sb)
  const resource = appByName(next, app.name)
  resource.userAssignedIdentityIds = (resource.userAssignedIdentityIds ?? []).filter(id => !identities.some(selected => same(selected, id)))
  return { sandbox: next, resource }
}

export function detachIdentityFromFunctionApps(sb, identityIds) {
  for (const app of sb.functionApps ?? []) if (app.userAssignedIdentityIds !== undefined)
    app.userAssignedIdentityIds = app.userAssignedIdentityIds.filter(id => !identityIds.some(removed => same(removed, id)))
}

export function setFunctionAppSettings(sb, { resourceGroup, name, settings }) {
  const pairs = parseSettings(settings)
  getFunctionApp(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  const app = appByName(next, name)
  app.appSettings = Object.fromEntries([...Object.entries(app.appSettings), ...pairs])
  return { sandbox: next, resource: app, names: pairs.map(([key]) => key) }
}

export function deleteFunctionAppSettings(sb, { resourceGroup, name, settingNames }) {
  const names = parseSettingNames(settingNames)
  getFunctionApp(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  const app = appByName(next, name)
  const wanted = new Set(names)
  app.appSettings = Object.fromEntries(Object.entries(app.appSettings).filter(([key]) => !wanted.has(key)))
  return { sandbox: next, resource: app, names }
}

export function getFunctionAppCors(sb, resourceGroup, name) {
  return getFunctionApp(sb, resourceGroup, name).cors
}

export function addFunctionAppCors(sb, { resourceGroup, name, allowedOrigins }) {
  const origins = parseOrigins(allowedOrigins, { required: true })
  getFunctionApp(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  const app = appByName(next, name)
  const merged = [...new Set([...app.cors.allowedOrigins, ...origins])]
  if (merged.includes('*') && merged.length > 1) throw new AzError('InvalidArgumentValue', "The wildcard '*' cannot be combined with specific CORS origins.")
  app.cors.allowedOrigins = merged
  return { sandbox: next, resource: app }
}

export function removeFunctionAppCors(sb, { resourceGroup, name, allowedOrigins }) {
  const origins = parseOrigins(allowedOrigins)
  getFunctionApp(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  const app = appByName(next, name)
  app.cors.allowedOrigins = origins.length === 0 ? [] : app.cors.allowedOrigins.filter((origin) => !origins.includes(origin))
  return { sandbox: next, resource: app }
}

export function deleteFunctionResourcesInGroup(sb, resourceGroup) {
  const next = cloneSandbox(sb)
  next.functionApps = next.functionApps.filter((app) => !same(app.resourceGroup, resourceGroup))
  next.storageAccounts = next.storageAccounts.filter((account) => !same(account.resourceGroup, resourceGroup))
  return next
}
