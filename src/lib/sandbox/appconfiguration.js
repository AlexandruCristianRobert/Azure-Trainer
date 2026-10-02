import { SUBSCRIPTION_ID, USER_OBJECT_ID, cloneSandbox, nowIso } from './model.js'
import { getResourceGroup } from './ops.js'
import { normalizeLocation } from './locations.js'
import { AzError } from './errors.js'
import { validateRuntimePrincipal } from '../security/identity.js'

export const APP_CONFIGURATION_DATA_READER_ROLE_ID = '516239f1-63e1-4d78-a4de-a74fb236a071'
export const KEY_VAULT_REFERENCE_CONTENT_TYPE = 'application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8'
const ROLE_NAME = 'App Configuration Data Reader'
const NAME = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{3,48}[a-zA-Z0-9])$/
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const bounded = (value, max, empty = true) => typeof value === 'string' && value.length <= max && (empty || value.length > 0)
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
const uriValid = uri => typeof uri === 'string' && /^https:\/\/[a-z0-9-]+\.vault\.azure\.net\/secrets\/[A-Za-z0-9-]{1,127}(?:\/[a-f0-9]{32})?$/i.test(uri)
const labelFor = label => label === undefined || label === null ? null : label
const fail = message => { throw new AzError('InvalidArgumentValue', message) }
export const appConfigurationId = store => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${store.resourceGroup}/providers/Microsoft.AppConfiguration/configurationStores/${store.name}`
export const isAppConfigurationScope = scope => typeof scope === 'string' && /^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.appconfiguration\/configurationstores\/[^/]+(?:\/.*)?$/i.test(scope)

export function getAppConfiguration(sandbox, resourceGroup, name) {
  if (name === undefined) { name = resourceGroup; resourceGroup = undefined }
  if (resourceGroup !== undefined && resourceGroup !== null) getResourceGroup(sandbox, resourceGroup)
  const matches = (sandbox.appConfigurationStores ?? []).filter(store => same(store.name, name)
    && (resourceGroup === undefined || resourceGroup === null || same(store.resourceGroup, resourceGroup)))
  if (matches.length !== 1) throw new AzError('ResourceNotFound', 'The exact App Configuration store was not found.')
  return matches[0]
}

export function createAppConfiguration(sandbox, { resourceGroup, name, location, sku = 'Free', tags = null }) {
  const group = getResourceGroup(sandbox, resourceGroup)
  if (typeof name !== 'string' || !NAME.test(name)) fail('App Configuration names use 5-50 letters, numbers and hyphens.')
  if (!['Free', 'Standard'].includes(sku)) fail('Supported App Configuration SKUs are Free and Standard.')
  const resolvedLocation = normalizeLocation(location ?? group.location)
  if (!resolvedLocation) fail('Use a supported App Configuration location.')
  if (!(tags === null || tags && typeof tags === 'object' && !Array.isArray(tags) && Object.values(tags).every(value => typeof value === 'string')))
    fail('Store tags must be string values.')
  const current = (sandbox.appConfigurationStores ?? []).find(store => same(store.name, name))
  if (current && (!same(current.resourceGroup, group.name) || current.location !== resolvedLocation || current.sku !== sku))
    throw new AzError('Conflict', 'An existing store cannot change resource group, location or SKU.')
  const next = cloneSandbox(sandbox)
  next.appConfigurationStores ??= []
  if (current) return { sandbox: next, resource: next.appConfigurationStores.find(store => same(store.name, name)), existed: true }
  const resource = { name, resourceGroup: group.name, location: resolvedLocation, sku, tags, endpoint: `https://${name.toLowerCase()}.azconfig.io`,
    revision: 0, settings: [], roleAssignments: [], createdAt: nowIso() }
  next.appConfigurationStores.push(resource)
  return { sandbox: next, resource, existed: false }
}

function validSetting(setting, revision) {
  if (!exact(setting, 'key,label,value,contentType,revision') || !bounded(setting.key, 512, false)
    || !(setting.label === null || bounded(setting.label, 128, false)) || !bounded(setting.value, 16384)
    || !(setting.contentType === null || bounded(setting.contentType, 256, false))
    || !Number.isSafeInteger(setting.revision) || setting.revision < 1 || setting.revision > revision) return false
  if (setting.contentType === KEY_VAULT_REFERENCE_CONTENT_TYPE) {
    try { const value = JSON.parse(setting.value); return exact(value, 'uri') && uriValid(value.uri) } catch { return false }
  }
  return true
}

export function setAppConfigurationValue(sandbox, { resourceGroup, name, key, label, value, contentType = null, secretIdentifier }) {
  const current = getAppConfiguration(sandbox, resourceGroup, name)
  if (!Number.isSafeInteger(current.revision + 1)) fail('The store revision limit has been reached.')
  if (secretIdentifier !== undefined) {
    if (!uriValid(secretIdentifier)) fail('A reference requires a supported Key Vault secret identifier.')
    if (value !== undefined || contentType !== null) fail('Secret references cannot also contain a value or content type.')
    value = JSON.stringify({ uri: secretIdentifier })
    contentType = KEY_VAULT_REFERENCE_CONTENT_TYPE
  }
  const setting = { key, label: labelFor(label), value, contentType, revision: current.revision + 1 }
  if (!validSetting(setting, setting.revision)) fail('Settings require bounded key, label, value and content type strings.')
  const index = current.settings.findIndex(item => item.key === key && item.label === setting.label)
  if (index === -1 && current.settings.length >= 50) fail('Each store supports at most 50 settings.')
  const next = cloneSandbox(sandbox)
  const store = getAppConfiguration(next, current.resourceGroup, current.name)
  store.revision = setting.revision
  if (index === -1) store.settings.push(setting)
  else store.settings[index] = setting
  return { sandbox: next, resource: setting }
}

export function listAppConfigurationValues(sandbox, { resourceGroup, name, label, key }) {
  const store = getAppConfiguration(sandbox, resourceGroup, name)
  const selectedLabel = labelFor(label)
  if (!(selectedLabel === null || bounded(selectedLabel, 128, false)) || key !== undefined && !bounded(key, 512, false)) fail('Use a bounded exact key and label.')
  return structuredClone(store.settings.filter(setting => setting.label === selectedLabel && (key === undefined || setting.key === key)))
}

/** Returns selected settings internally; reference resolution belongs to the SDK. */
export function readAppConfigurationAsPrincipal(sandbox, options, principal) {
  const actual = validateRuntimePrincipal(sandbox, principal)
  const store = getAppConfiguration(sandbox, options.resourceGroup, options.name)
  if (!store.roleAssignments.some(role => same(role.principalId, actual.principalId) && role.principalType === 'ServicePrincipal'
    && same(role.scope, appConfigurationId(store)) && role.roleDefinitionId === APP_CONFIGURATION_DATA_READER_ROLE_ID))
    throw new AzError('Forbidden', 'The application identity requires Data Reader at this exact store scope.')
  const settings = listAppConfigurationValues(sandbox, options)
  if (options.key === undefined) return settings
  if (!settings.length) throw new AzError('KeyNotFound', 'The exact labeled setting was not found.')
  return settings[0]
}

function storeAtScope(sandbox, scope) {
  const store = (sandbox.appConfigurationStores ?? []).find(item => same(appConfigurationId(item), scope))
  if (!store) throw new AzError('ResourceNotFound', 'App Configuration roles require an exact store scope.')
  return store
}
function roleDefinition(role) {
  if (!same(role, ROLE_NAME) && !same(role, APP_CONFIGURATION_DATA_READER_ROLE_ID)) throw new AzError('RoleDefinitionDoesNotExist', 'Only App Configuration Data Reader is supported at this scope.')
  return APP_CONFIGURATION_DATA_READER_ROLE_ID
}
export function createAppConfigurationRoleAssignment(sandbox, { scope, role, principalId, principalType = 'ServicePrincipal' }) {
  const store = storeAtScope(sandbox, scope)
  const definition = roleDefinition(role)
  if (!(principalType === 'User' && principalId === USER_OBJECT_ID) && !(principalType === 'ServicePrincipal'
    && sandbox.managedIdentities?.some(identity => identity.principalId === principalId))) throw new AzError('PrincipalNotFound', 'Use an actual learner or managed identity principal.')
  const next = cloneSandbox(sandbox)
  const stored = storeAtScope(next, scope)
  const existing = stored.roleAssignments.find(item => same(item.principalId, principalId) && item.roleDefinitionId === definition)
  if (existing) return { sandbox: next, resource: existing, store: stored, existed: true }
  if (stored.roleAssignments.length >= 50) fail('Each store supports at most 50 reader assignments.')
  const resource = { id: crypto.randomUUID(), scope: appConfigurationId(stored), principalId, principalType, roleName: ROLE_NAME, roleDefinitionId: definition }
  stored.roleAssignments.push(resource)
  return { sandbox: next, resource, store: stored, existed: false }
}
export function listAppConfigurationRoleAssignments(sandbox, { scope, role, principalId }) {
  const store = storeAtScope(sandbox, scope)
  if (role !== undefined) roleDefinition(role)
  return structuredClone(store.roleAssignments.filter(item => principalId === undefined || same(item.principalId, principalId)))
}
export function deleteAppConfigurationRoleAssignment(sandbox, { scope, role, principalId }) {
  const store = storeAtScope(sandbox, scope)
  const definition = roleDefinition(role)
  const assignment = store.roleAssignments.find(item => same(item.principalId, principalId) && item.roleDefinitionId === definition)
  if (!assignment) throw new AzError('RoleAssignmentNotFound', 'The requested App Configuration role was not found.')
  const next = cloneSandbox(sandbox)
  storeAtScope(next, scope).roleAssignments = storeAtScope(next, scope).roleAssignments.filter(item => item.id !== assignment.id)
  return { sandbox: next, resource: structuredClone(assignment), store }
}
export function deleteAppConfigurationsInGroup(sandbox, resourceGroup) {
  const next = cloneSandbox(sandbox)
  if (next.appConfigurationStores !== undefined) next.appConfigurationStores = next.appConfigurationStores.filter(store => !same(store.resourceGroup, resourceGroup))
  return next
}

export function validAppConfigurationStores(sandbox) {
  const stores = sandbox.appConfigurationStores === undefined ? [] : sandbox.appConfigurationStores
  if (!Array.isArray(stores) || stores.some(store => !store || typeof store.name !== 'string')
    || new Set(stores.map(store => store.name.toLowerCase())).size !== stores.length) return false
  return stores.every(store => exact(store, 'name,resourceGroup,location,sku,tags,endpoint,revision,settings,roleAssignments,createdAt')
    && typeof store.name === 'string' && NAME.test(store.name) && typeof store.resourceGroup === 'string'
    && sandbox.resourceGroups.some(group => same(group.name, store.resourceGroup)) && normalizeLocation(store.location) === store.location
    && ['Free', 'Standard'].includes(store.sku) && (store.tags === null || exactTags(store.tags))
    && store.endpoint === `https://${store.name.toLowerCase()}.azconfig.io` && Number.isSafeInteger(store.revision) && store.revision >= 0
    && typeof store.createdAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(store.createdAt) && Number.isFinite(Date.parse(store.createdAt))
    && Array.isArray(store.settings) && store.settings.length <= 50 && store.settings.every(setting => validSetting(setting, store.revision))
    && new Set(store.settings.map(setting => JSON.stringify([setting.key, setting.label]))).size === store.settings.length
    && new Set(store.settings.map(setting => setting.revision)).size === store.settings.length
    && Array.isArray(store.roleAssignments) && store.roleAssignments.length <= 50
    && store.roleAssignments.every(role => role && typeof role.principalId === 'string')
    && new Set(store.roleAssignments.map(role => role.id)).size === store.roleAssignments.length
    && new Set(store.roleAssignments.map(role => role.principalId?.toLowerCase())).size === store.roleAssignments.length
    && store.roleAssignments.every(role => exact(role, 'id,scope,principalId,principalType,roleName,roleDefinitionId')
      && typeof role.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(role.id)
      && role.scope === appConfigurationId(store) && role.roleName === ROLE_NAME && role.roleDefinitionId === APP_CONFIGURATION_DATA_READER_ROLE_ID
      && (role.principalType === 'User' && role.principalId === USER_OBJECT_ID || role.principalType === 'ServicePrincipal'
        && sandbox.managedIdentities?.some(identity => identity.principalId === role.principalId))))
}
function exactTags(tags) {
  return !!tags && typeof tags === 'object' && !Array.isArray(tags) && Object.values(tags).every(value => typeof value === 'string')
}
