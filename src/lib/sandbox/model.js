import { normalizeLocation } from './locations.js'
import { isValidEventGridWebhookEndpoint } from './eventgrid-validation.js'

export const SUBSCRIPTION_ID = '7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37'
export const SUBSCRIPTION_NAME = 'Sandbox'
export const TENANT_ID = '3c1f5a8e-9d2b-4f6a-8e7c-1b2d3e4f5a6b'
export const USER_NAME = 'sam.learner@sandbox.onmicrosoft.com'
export const USER_OBJECT_ID = 'a37a00c7-d689-4b5d-a8c8-1d75f307d5ef'

export function createSandbox() {
  return { resourceGroups: [], namespaces: [], storageAccounts: [], functionApps: [], containerAppEnvironments: [], containerApps: [], containerRegistries: [], managedIdentities: [], roleAssignments: [], foundryAccounts: [], cosmosAccounts: [], keyVaults: [], eventGridTopics: [], defaults: { group: null, location: null } }
}

function object(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function pathEntries(value) {
  return Array.isArray(value) && value.every((entry) => object(entry) && typeof entry.path === 'string')
}

function validVectorPolicy(policy) {
  return policy === null || (object(policy) && pathEntries(policy.vectorEmbeddings)
    && policy.vectorEmbeddings.every((entry) => typeof entry.dataType === 'string'
      && typeof entry.dimensions === 'number' && typeof entry.distanceFunction === 'string'))
}

function validIndexingPolicy(policy) {
  return object(policy) && typeof policy.indexingMode === 'string' && typeof policy.automatic === 'boolean'
    && pathEntries(policy.includedPaths) && pathEntries(policy.excludedPaths)
    && pathEntries(policy.vectorIndexes) && policy.vectorIndexes.every((entry) => typeof entry.type === 'string')
}

function validCosmosContainer(container) {
  return object(container)
    && typeof container.name === 'string'
    && typeof container.partitionKeyPath === 'string'
    && typeof container.throughput === 'number'
    && validVectorPolicy(container.vectorEmbeddingPolicy)
    && validIndexingPolicy(container.indexingPolicy)
}

function validCosmosAccount(account) {
  return object(account)
    && typeof account.name === 'string'
    && typeof account.resourceGroup === 'string'
    && Array.isArray(account.capabilities)
    && account.capabilities.every((capability) => typeof capability === 'string')
    && Array.isArray(account.databases)
    && account.databases.every((database) => object(database) && typeof database.name === 'string' && Array.isArray(database.containers) && database.containers.every(validCosmosContainer))
}

function stringOrNull(value) {
  return value === null || typeof value === 'string'
}

function iso(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value))
}

function tagsOrNull(value) {
  return value === null || (object(value) && Object.values(value).every((entry) => typeof entry === 'string'))
}

function validKeyVaultVersion(version) {
  return object(version)
    && typeof version.version === 'string' && /^[a-f0-9]{32}$/.test(version.version)
    && typeof version.value === 'string' && typeof version.enabled === 'boolean'
    && stringOrNull(version.contentType) && tagsOrNull(version.tags)
    && iso(version.createdAt) && iso(version.updatedAt)
}

function validKeyVaultSecret(secret) {
  return object(secret) && typeof secret.name === 'string'
    && Array.isArray(secret.versions) && secret.versions.length > 0 && secret.versions.every(validKeyVaultVersion)
    && new Set(secret.versions.map((version) => version.version)).size === secret.versions.length
}

const KEY_VAULT_NAME_RE = /^(?=.{3,24}$)[A-Za-z](?!.*--)[A-Za-z0-9-]*[A-Za-z0-9]$/
const SECRET_NAME_RE = /^[A-Za-z0-9-]{1,127}$/
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const REGISTRY_NAME_RE = /^[A-Za-z0-9]{5,50}$/
const IDENTITY_NAME_RE = /^(?=.{3,128}$)[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$/
const ARM_ROOT = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/`
const FOUNDRY_ACCOUNT_NAME_RE = /^(?=.{2,64}$)[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/
const FOUNDRY_CHILD_NAME_RE = /^(?=.{2,64}$)[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/
function foundryManagementPrincipal(id) {
  const source = `foundry-account-principal:${id.toLowerCase()}`
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (const character of source) for (let lane = 0; lane < words.length; lane++) words[lane] = Math.imul(words[lane] ^ (character.charCodeAt(0) + lane), 0x01000193) >>> 0
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}
function validFoundryAccounts(sb) {
  const groups = new Set(sb.resourceGroups.map((group) => String(group.name).toLowerCase()))
  const accounts = sb.foundryAccounts ?? []
  if (!Array.isArray(accounts)) return false
  if (new Set(accounts.map((account) => String(account?.name).toLowerCase())).size !== accounts.length) return false
  return accounts.every((account) => {
    if (!object(account) || !FOUNDRY_ACCOUNT_NAME_RE.test(account.name) || typeof account.resourceGroup !== 'string' || !groups.has(account.resourceGroup.toLowerCase())
      || account.id !== `${ARM_ROOT}${account.resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${account.name}`
      || typeof account.location !== 'string' || account.location !== normalizeLocation(account.location) || account.kind !== 'AIServices' || account.sku !== 'S0'
      || typeof account.allowProjectManagement !== 'boolean'
      || account.endpoint !== `https://${account.name.toLowerCase()}.services.ai.azure.com/openai/v1/`
      || !(account.identity === null || (object(account.identity) && account.identity.type === 'SystemAssigned' && account.identity.principalId === foundryManagementPrincipal(account.id)))
      || !Array.isArray(account.projects) || !Array.isArray(account.deployments)) return false
    if (account.projects.length > 0 && (!account.allowProjectManagement || account.identity?.type !== 'SystemAssigned')) return false
    if (new Set(account.projects.map((project) => String(project?.name).toLowerCase())).size !== account.projects.length) return false
    if (new Set(account.deployments.map((deployment) => String(deployment?.name).toLowerCase())).size !== account.deployments.length) return false
    return account.projects.every((project) => object(project) && FOUNDRY_CHILD_NAME_RE.test(project.name)
      && project.id === `${account.id}/projects/${project.name}`
      && project.endpoint === `https://${account.name.toLowerCase()}.services.ai.azure.com/api/projects/${project.name}`
      && project.location === account.location)
      && account.deployments.every((deployment) => object(deployment) && FOUNDRY_CHILD_NAME_RE.test(deployment.name)
        && deployment.id === `${account.id}/deployments/${deployment.name}` && deployment.modelName === 'gpt-5-mini'
        && deployment.modelVersion === '2025-08-07' && deployment.sku === 'GlobalStandard')
  })
}
function validAcaPrerequisites(sb) {
  const groups = new Set(sb.resourceGroups.map((group) => String(group.name).toLowerCase()))
  const registries = sb.containerRegistries ?? []
  const identities = sb.managedIdentities ?? []
  const assignments = sb.roleAssignments ?? []
  if (!Array.isArray(registries) || !Array.isArray(identities) || !Array.isArray(assignments)) return false
  if (!registries.every((registry) => object(registry) && REGISTRY_NAME_RE.test(registry.name)
    && typeof registry.resourceGroup === 'string' && groups.has(registry.resourceGroup.toLowerCase())
    && registry.id === `${ARM_ROOT}${registry.resourceGroup}/providers/Microsoft.ContainerRegistry/registries/${registry.name}`
    && registry.loginServer === `${registry.name.toLowerCase()}.azurecr.io`
    && typeof registry.location === 'string' && normalizeLocation(registry.location) === registry.location && registry.sku === 'Basic' && tagsOrNull(registry.tags))) return false
  if (new Set(registries.map((registry) => registry.name.toLowerCase())).size !== registries.length) return false
  if (!identities.every((identity) => object(identity) && IDENTITY_NAME_RE.test(identity.name)
    && typeof identity.resourceGroup === 'string' && groups.has(identity.resourceGroup.toLowerCase())
    && identity.id === `${ARM_ROOT}${identity.resourceGroup}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity.name}`
    && UUID_RE.test(identity.clientId) && UUID_RE.test(identity.principalId)
    && identity.id !== identity.clientId && identity.id !== identity.principalId && identity.clientId !== identity.principalId
    && typeof identity.location === 'string' && normalizeLocation(identity.location) === identity.location && tagsOrNull(identity.tags))) return false
  if (new Set(identities.map((identity) => `${identity.resourceGroup}/${identity.name}`.toLowerCase())).size !== identities.length) return false
  if (new Set(identities.map((identity) => identity.principalId.toLowerCase())).size !== identities.length) return false
  if (!assignments.every((assignment) => {
    if (!object(assignment) || !UUID_RE.test(assignment.id) || assignment.principalType !== 'ServicePrincipal'
      || !identities.some((identity) => identity.principalId.toLowerCase() === String(assignment.principalId).toLowerCase())) return false
    const acr = assignment.roleName === 'AcrPull' && assignment.roleDefinitionId === '7f951dda-4ed3-4680-a7ca-43fe172d538d'
      && registries.some((registry) => registry.id.toLowerCase() === String(assignment.scope).toLowerCase())
    const foundry = ((assignment.roleName === 'Cognitive Services User' && assignment.roleDefinitionId === 'a97b65f3-24c7-4388-baec-2e87135dc908')
      || (assignment.roleName === 'Cognitive Services OpenAI User' && assignment.roleDefinitionId === '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'))
      && (sb.foundryAccounts ?? []).some((account) => account.id.toLowerCase() === String(assignment.scope).toLowerCase())
    return acr || foundry
  })) return false
  return new Set(assignments.map((assignment) => assignment.id.toLowerCase())).size === assignments.length
    && new Set(assignments.map((assignment) => `${assignment.scope}/${assignment.principalId}/${assignment.roleDefinitionId}`.toLowerCase())).size === assignments.length
}

function validAppIdentities(sb) {
  return (sb.containerApps ?? []).every((app) => {
    if (!object(app)) return false
    const assigned = app.userAssigned == null ? [] : Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]
    if (assigned.length > 32 || (Array.isArray(app.userAssigned) && assigned.length === 0)
      || assigned.some((id) => typeof id !== 'string' || !sb.managedIdentities?.some((identity) => same(identity.id, id)))
      || new Set(assigned.map((id) => id.toLowerCase())).size !== assigned.length) return false
    return app.registryIdentity == null || (typeof app.registryIdentity === 'string'
      && assigned.some((id) => same(id, app.registryIdentity)))
  })
}
const ROLE_NAMES = {
  'b86a8fe4-44ce-4948-aee5-eccb2c155cd7': 'Key Vault Secrets Officer',
  '4633458b-17de-408a-b874-0445c86b69e6': 'Key Vault Secrets User',
}
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function validKeyVaultRoleAssignment(assignment, vault) {
  const roleName = ROLE_NAMES[String(assignment?.roleDefinitionId).toLowerCase()]
  return object(assignment)
    && typeof assignment.id === 'string' && UUID_RE.test(assignment.id)
    && assignment.principalId === USER_OBJECT_ID && assignment.principalType === 'User'
    && roleName === assignment.roleName
    && typeof assignment.scope === 'string'
    && assignment.scope === `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${vault.resourceGroup}/providers/Microsoft.KeyVault/vaults/${vault.name}`
}

function validKeyVault(vault) {
  return object(vault)
    && typeof vault.name === 'string' && KEY_VAULT_NAME_RE.test(vault.name) && typeof vault.resourceGroup === 'string'
    && typeof vault.location === 'string' && (vault.sku === 'standard' || vault.sku === 'premium')
    && vault.enableRbacAuthorization === true && typeof vault.enablePurgeProtection === 'boolean'
    && Number.isInteger(vault.softDeleteRetentionInDays) && vault.softDeleteRetentionInDays >= 7 && vault.softDeleteRetentionInDays <= 90 && tagsOrNull(vault.tags)
    && iso(vault.createdAt)
    && Array.isArray(vault.roleAssignments) && vault.roleAssignments.every((assignment) => validKeyVaultRoleAssignment(assignment, vault))
    && new Set(vault.roleAssignments.map((assignment) => assignment.id)).size === vault.roleAssignments.length
    && new Set(vault.roleAssignments.map((assignment) => `${assignment.principalId.toLowerCase()}/${assignment.roleDefinitionId.toLowerCase()}/${assignment.scope.toLowerCase()}`)).size === vault.roleAssignments.length
    && Array.isArray(vault.secrets) && vault.secrets.every(validKeyVaultSecret)
    && vault.secrets.every((secret) => SECRET_NAME_RE.test(secret.name))
    && new Set(vault.secrets.map((secret) => secret.name.toLowerCase())).size === vault.secrets.length
}

function validKeyVaultCollection(vaults) {
  return Array.isArray(vaults) && vaults.every(validKeyVault)
    && new Set(vaults.map((vault) => vault.name.toLowerCase())).size === vaults.length
}

const EVENT_GRID_TOPIC_NAME_RE = /^(?=.{3,50}$)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/
const EVENT_GRID_SUBSCRIPTION_NAME_RE = /^(?=.{3,64}$)[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/

function validEventGridFilter(filter) {
  return object(filter)
    && Array.isArray(filter.includedEventTypes)
    && filter.includedEventTypes.every((type) => typeof type === 'string' && type.length > 0 && type !== 'All')
    && new Set(filter.includedEventTypes).size === filter.includedEventTypes.length
    && typeof filter.subjectBeginsWith === 'string' && !/[*?]/.test(filter.subjectBeginsWith)
    && typeof filter.subjectEndsWith === 'string' && !/[*?]/.test(filter.subjectEndsWith)
    && typeof filter.isSubjectCaseSensitive === 'boolean'
}

function validEventGridSubscription(resource) {
  return object(resource)
    && typeof resource.name === 'string' && EVENT_GRID_SUBSCRIPTION_NAME_RE.test(resource.name)
    && resource.endpointType === 'WebHook' && isValidEventGridWebhookEndpoint(resource.endpoint)
    && validEventGridFilter(resource.filter) && iso(resource.createdAt)
}

function validEventGridTopics(topics, resourceGroups) {
  if (!Array.isArray(topics) || !topics.every((topic) => object(topic)
    && typeof topic.name === 'string' && EVENT_GRID_TOPIC_NAME_RE.test(topic.name)
    && typeof topic.resourceGroup === 'string' && typeof topic.location === 'string' && normalizeLocation(topic.location) === topic.location
    && topic.inputSchema === 'EventGridSchema' && tagsOrNull(topic.tags) && iso(topic.createdAt)
    && Array.isArray(topic.eventSubscriptions) && topic.eventSubscriptions.every(validEventGridSubscription)
    && new Set(topic.eventSubscriptions.map((resource) => resource.name.toLowerCase())).size === topic.eventSubscriptions.length)) return false
  if (new Set(topics.map((topic) => topic.name.toLowerCase())).size !== topics.length) return false
  const groups = new Set(resourceGroups.filter((group) => object(group) && typeof group.name === 'string').map((group) => group.name.toLowerCase()))
  return topics.every((topic) => groups.has(topic.resourceGroup.toLowerCase()))
}

const STORAGE_NAME_RE = /^[a-z0-9]{3,24}$/
const FUNCTION_APP_NAME_RE = /^(?=.{2,60}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const SETTING_NAME_RE = /^[A-Za-z0-9._]+$/

function validSettings(settings) {
  return object(settings) && Object.entries(settings).every(([name, value]) => SETTING_NAME_RE.test(name)
    && !/^(AzureWebJobs|FUNCTIONS_|WEBSITE_|SCM_)/i.test(name) && typeof value === 'string')
}

function validOrigin(origin) {
  if (origin === '*') return true
  if (typeof origin !== 'string' || !/^https?:\/\//i.test(origin)) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && !!url.hostname && !url.username && !url.password && url.pathname === '/'
      && !url.search && !url.hash && url.origin === origin
  } catch { return false }
}

function validStorageAccount(account) {
  return object(account) && typeof account.name === 'string' && STORAGE_NAME_RE.test(account.name)
    && typeof account.resourceGroup === 'string' && typeof account.location === 'string' && normalizeLocation(account.location) === account.location
    && account.kind === 'StorageV2' && (account.sku === 'Standard_LRS' || account.sku === 'Standard_ZRS')
    && tagsOrNull(account.tags) && iso(account.createdAt)
}

function validFunctionApp(app) {
  return object(app) && typeof app.name === 'string' && FUNCTION_APP_NAME_RE.test(app.name)
    && typeof app.resourceGroup === 'string' && typeof app.location === 'string' && normalizeLocation(app.location) === app.location
    && typeof app.storageAccount === 'string' && typeof app.storageResourceGroup === 'string'
    && app.hostingPlan === 'FlexConsumption' && app.os === 'Linux' && app.runtime === 'node'
    && app.runtimeVersion === '22' && app.functionsVersion === '4' && app.httpsOnly === true
    && validSettings(app.appSettings) && object(app.cors) && Array.isArray(app.cors.allowedOrigins)
    && app.cors.allowedOrigins.every(validOrigin) && new Set(app.cors.allowedOrigins).size === app.cors.allowedOrigins.length
    && !(app.cors.allowedOrigins.includes('*') && app.cors.allowedOrigins.length > 1)
    && app.cors.supportCredentials === false && tagsOrNull(app.tags) && iso(app.createdAt)
}

function validFunctionResources(sb) {
  const groups = new Set(sb.resourceGroups.filter((group) => object(group) && typeof group.name === 'string').map((group) => group.name.toLowerCase()))
  const storage = sb.storageAccounts
  const apps = sb.functionApps
  if (!Array.isArray(storage) || !storage.every(validStorageAccount)
    || new Set(storage.map((account) => account.name.toLowerCase())).size !== storage.length) return false
  if (!storage.every((account) => groups.has(account.resourceGroup.toLowerCase()))) return false
  if (!Array.isArray(apps) || !apps.every(validFunctionApp)
    || new Set(apps.map((app) => app.name.toLowerCase())).size !== apps.length) return false
  return apps.every((app) => {
    if (!groups.has(app.resourceGroup.toLowerCase())) return false
    const account = storage.find((item) => item.name.toLowerCase() === app.storageAccount.toLowerCase())
    return !!account && account.resourceGroup.toLowerCase() === app.storageResourceGroup.toLowerCase()
      && account.resourceGroup.toLowerCase() === app.resourceGroup.toLowerCase() && account.location === app.location
  })
}

export function isSandboxShape(sb) {
  return !!sb && typeof sb === 'object'
    && Array.isArray(sb.resourceGroups)
    && Array.isArray(sb.namespaces)
    && (!Object.hasOwn(sb, 'storageAccounts') || Array.isArray(sb.storageAccounts))
    && (!Object.hasOwn(sb, 'functionApps') || Array.isArray(sb.functionApps))
    && (!Object.hasOwn(sb, 'containerAppEnvironments') || Array.isArray(sb.containerAppEnvironments))
    && (!Object.hasOwn(sb, 'containerApps') || Array.isArray(sb.containerApps))
    && (!Object.hasOwn(sb, 'cosmosAccounts') || (Array.isArray(sb.cosmosAccounts) && sb.cosmosAccounts.every(validCosmosAccount)))
    && (!Object.hasOwn(sb, 'keyVaults') || validKeyVaultCollection(sb.keyVaults))
    && validFoundryAccounts(sb)
    && (!Object.hasOwn(sb, 'eventGridTopics') || validEventGridTopics(sb.eventGridTopics, sb.resourceGroups))
    && validAcaPrerequisites(sb)
    && validAppIdentities(sb)
    && !!sb.defaults && typeof sb.defaults === 'object'
    && (!Object.hasOwn(sb, 'storageAccounts') && !Object.hasOwn(sb, 'functionApps') || validFunctionResources({ ...sb, storageAccounts: sb.storageAccounts ?? [], functionApps: sb.functionApps ?? [] }))
}

export function cloneSandbox(sb) {
  return JSON.parse(JSON.stringify(sb))
}

export function normalizeSandbox(sb) {
  const next = cloneSandbox(sb)
  if (!Object.hasOwn(next, 'containerAppEnvironments')) next.containerAppEnvironments = []
  if (!Object.hasOwn(next, 'containerApps')) next.containerApps = []
  if (!Object.hasOwn(next, 'storageAccounts')) next.storageAccounts = []
  if (!Object.hasOwn(next, 'functionApps')) next.functionApps = []
  if (!Object.hasOwn(next, 'cosmosAccounts')) next.cosmosAccounts = []
  if (!Object.hasOwn(next, 'keyVaults')) next.keyVaults = []
  if (!Object.hasOwn(next, 'eventGridTopics')) next.eventGridTopics = []
  if (!Object.hasOwn(next, 'containerRegistries')) next.containerRegistries = []
  if (!Object.hasOwn(next, 'managedIdentities')) next.managedIdentities = []
  if (!Object.hasOwn(next, 'roleAssignments')) next.roleAssignments = []
  if (!Object.hasOwn(next, 'foundryAccounts')) next.foundryAccounts = []
  for (const app of next.containerApps) {
    const canonical = (id) => next.managedIdentities.find((identity) => same(identity.id, id))?.id ?? id
    if (Array.isArray(app.userAssigned)) {
      const ids = app.userAssigned.map(canonical)
      app.userAssigned = ids.length === 1 ? ids[0] : ids
    } else if (typeof app.userAssigned === 'string') app.userAssigned = canonical(app.userAssigned)
    if (typeof app.registryIdentity === 'string') app.registryIdentity = canonical(app.registryIdentity)
  }
  return next
}

export function nowIso() {
  return new Date().toISOString()
}
