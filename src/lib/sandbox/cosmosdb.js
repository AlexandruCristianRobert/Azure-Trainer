import { cloneSandbox, nowIso } from './model.js'
import { normalizeLocation } from './locations.js'
import { AzError } from './errors.js'
import { DEFAULT_INDEXING_POLICY, sameJson, validateIndexingPolicy, validateVectorEmbeddingPolicy } from './cosmosdb-policies.js'

const ACCOUNT_RE = /^[a-z0-9-]{3,44}$/
const CONSISTENCY_LEVELS = ['Strong', 'BoundedStaleness', 'Session', 'ConsistentPrefix', 'Eventual']
const VECTOR_CAPABILITY = 'EnableNoSQLVectorSearch'

function findGroup(sandbox, name) {
  return sandbox.resourceGroups.find((group) => group.name.toLowerCase() === String(name).toLowerCase())
}

function requireGroup(sandbox, name) {
  const group = findGroup(sandbox, name)
  if (!group) throw new AzError('ResourceGroupNotFound', `Resource group '${name}' could not be found.`)
  return group
}

function findAccount(sandbox, resourceGroup, name) {
  return sandbox.cosmosAccounts.find((account) => account.resourceGroup.toLowerCase() === String(resourceGroup).toLowerCase() && account.name.toLowerCase() === String(name).toLowerCase())
}

function accountName(name) {
  if (typeof name !== 'string' || !ACCOUNT_RE.test(name)) throw new AzError('BadRequest', 'Cosmos DB account names must be 3-44 characters and contain only lowercase letters, numbers, and hyphens.')
}

function childName(name, type) {
  if (typeof name !== 'string' || name.length === 0 || /[\\/?#]/.test(name)) throw new AzError('BadRequest', `${type} name '${name}' is invalid. Names must be non-empty and cannot contain /, \\, ?, or #.`)
}

function partitionPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.length < 2 || /[*?]/.test(path)) throw new AzError('BadRequest', 'Partition key path must be a JSON path starting with /.')
}

function accountOrThrow(sandbox, resourceGroup, name) {
  requireGroup(sandbox, resourceGroup)
  const account = findAccount(sandbox, resourceGroup, name)
  if (!account) throw new AzError('ResourceNotFound', `The Cosmos DB account '${name}' under resource group '${resourceGroup}' was not found.`)
  return account
}

function databaseOrThrow(sandbox, resourceGroup, accountNameValue, name) {
  const account = accountOrThrow(sandbox, resourceGroup, accountNameValue)
  const database = account.databases.find((item) => item.name === name)
  if (!database) throw new AzError('ResourceNotFound', `The SQL database '${name}' was not found in account '${accountNameValue}'.`)
  return { account, database }
}

function containerOrThrow(sandbox, resourceGroup, accountNameValue, databaseName, name) {
  const { account, database } = databaseOrThrow(sandbox, resourceGroup, accountNameValue, databaseName)
  const container = database.containers.find((item) => item.name === name)
  if (!container) throw new AzError('ResourceNotFound', `The SQL container '${name}' was not found in database '${databaseName}'.`)
  return { account, database, container }
}

function capabilities(value) {
  if (value === undefined) return undefined
  const names = Array.isArray(value) ? value : Object.keys(value)
  if (!Array.isArray(value) && Object.values(value).some((entry) => entry !== '')) throw new AzError('BadRequest', '--capabilities accepts capability names without values.', { kind: 'cli' })
  if (names.length !== 1 || names[0] !== VECTOR_CAPABILITY) throw new AzError('BadRequest', `Unsupported Cosmos DB capability. Only '${VECTOR_CAPABILITY}' is supported.`, { kind: 'cli' })
  return [VECTOR_CAPABILITY]
}

function accountLocation(group, locations) {
  if (locations === undefined) return group.location
  if (Array.isArray(locations)) {
    const seen = new Set()
    locations.forEach(([key]) => {
      if (seen.has(key)) throw new AzError('BadRequest', `--locations contains duplicate ${key}; multi-region account configuration is not supported.`, { kind: 'cli' })
      seen.add(key)
    })
    locations = Object.fromEntries(locations)
  }
  if (!locations || typeof locations !== 'object' || Array.isArray(locations)) throw new AzError('BadRequest', '--locations must define one regionName entry.', { kind: 'cli' })
  const allowed = ['regionName', 'failoverPriority', 'isZoneRedundant']
  if (Object.keys(locations).some((key) => !allowed.includes(key)) || !locations.regionName || (locations.failoverPriority !== undefined && locations.failoverPriority !== '0') || (locations.isZoneRedundant !== undefined && locations.isZoneRedundant !== 'False')) {
    throw new AzError('BadRequest', '--locations supports one regionName with failoverPriority=0 and isZoneRedundant=False.', { kind: 'cli' })
  }
  const location = normalizeLocation(locations.regionName)
  if (!location) throw new AzError('BadRequest', `The provided location '${locations.regionName}' is not available for resource type 'Microsoft.DocumentDB/databaseAccounts'.`)
  return location
}

export function getCosmosAccount(sandbox, resourceGroup, name) {
  return accountOrThrow(sandbox, resourceGroup, name)
}

export function listCosmosAccounts(sandbox, resourceGroup = null) {
  if (resourceGroup === null) return sandbox.cosmosAccounts.slice()
  requireGroup(sandbox, resourceGroup)
  return sandbox.cosmosAccounts.filter((account) => account.resourceGroup.toLowerCase() === resourceGroup.toLowerCase())
}

export function createCosmosAccount(sandbox, { resourceGroup, name, locations, kind = 'GlobalDocumentDB', defaultConsistencyLevel = 'Session', tags = null, capabilities: requestedCapabilities }) {
  const group = requireGroup(sandbox, resourceGroup)
  accountName(name)
  if (kind !== 'GlobalDocumentDB') throw new AzError('BadRequest', "Only kind 'GlobalDocumentDB' is supported in the Sandbox.", { kind: 'cli' })
  if (!CONSISTENCY_LEVELS.includes(defaultConsistencyLevel)) throw new AzError('BadRequest', `Unsupported default consistency level '${defaultConsistencyLevel}'.`, { kind: 'cli' })
  const location = accountLocation(group, locations)
  const capabilityNames = capabilities(requestedCapabilities)
  const duplicate = sandbox.cosmosAccounts.find((account) => account.name.toLowerCase() === name.toLowerCase() && account.resourceGroup.toLowerCase() !== group.name.toLowerCase())
  if (duplicate) throw new AzError('Conflict', `The Cosmos DB account name '${name}' is already in use in resource group '${duplicate.resourceGroup}'.`)
  const next = cloneSandbox(sandbox)
  let account = findAccount(next, group.name, name)
  if (account) {
    if (account.location !== location) throw new AzError('BadRequest', `The location for Cosmos DB account '${account.name}' cannot be changed.`, { kind: 'cli' })
    account.defaultConsistencyLevel = defaultConsistencyLevel
    if (tags !== null) account.tags = tags
    if (capabilityNames) account.capabilities = [...new Set([...account.capabilities, ...capabilityNames])]
  } else {
    account = { name, resourceGroup: group.name, location, kind, defaultConsistencyLevel, capabilities: capabilityNames ?? [], tags, createdAt: nowIso(), databases: [] }
    next.cosmosAccounts.push(account)
  }
  return { sandbox: next, resource: account }
}

export function updateCosmosAccount(sandbox, { resourceGroup, name, defaultConsistencyLevel, tags, capabilities: requestedCapabilities }) {
  accountOrThrow(sandbox, resourceGroup, name)
  if (defaultConsistencyLevel !== undefined && !CONSISTENCY_LEVELS.includes(defaultConsistencyLevel)) throw new AzError('BadRequest', `Unsupported default consistency level '${defaultConsistencyLevel}'.`, { kind: 'cli' })
  const capabilityNames = capabilities(requestedCapabilities)
  const next = cloneSandbox(sandbox)
  const account = findAccount(next, resourceGroup, name)
  if (defaultConsistencyLevel !== undefined) account.defaultConsistencyLevel = defaultConsistencyLevel
  if (tags !== undefined) account.tags = tags
  if (capabilityNames) account.capabilities = [...new Set([...account.capabilities, ...capabilityNames])]
  return { sandbox: next, resource: account }
}

export function deleteCosmosAccount(sandbox, { resourceGroup, name }) {
  const resource = accountOrThrow(sandbox, resourceGroup, name)
  const next = cloneSandbox(sandbox)
  next.cosmosAccounts = next.cosmosAccounts.filter((account) => !(account.resourceGroup.toLowerCase() === resourceGroup.toLowerCase() && account.name.toLowerCase() === name.toLowerCase()))
  return { sandbox: next, resource }
}

export function deleteCosmosAccountsInGroup(sandbox, resourceGroup) {
  const next = cloneSandbox(sandbox)
  next.cosmosAccounts = next.cosmosAccounts.filter((account) => account.resourceGroup.toLowerCase() !== resourceGroup.toLowerCase())
  return next
}

export function getCosmosDatabase(sandbox, resourceGroup, account, name) {
  return databaseOrThrow(sandbox, resourceGroup, account, name).database
}

export function listCosmosDatabases(sandbox, resourceGroup, account) {
  return accountOrThrow(sandbox, resourceGroup, account).databases.slice()
}

export function createCosmosDatabase(sandbox, { resourceGroup, account, name }) {
  accountOrThrow(sandbox, resourceGroup, account)
  childName(name, 'SQL database')
  const next = cloneSandbox(sandbox)
  const storedAccount = findAccount(next, resourceGroup, account)
  let database = storedAccount.databases.find((item) => item.name === name)
  if (!database) {
    database = { name, createdAt: nowIso(), containers: [] }
    storedAccount.databases.push(database)
  }
  return { sandbox: next, resource: database, account: storedAccount }
}

export function deleteCosmosDatabase(sandbox, { resourceGroup, account, name }) {
  const { account: resourceAccount, database } = databaseOrThrow(sandbox, resourceGroup, account, name)
  const next = cloneSandbox(sandbox)
  const storedAccount = findAccount(next, resourceGroup, account)
  storedAccount.databases = storedAccount.databases.filter((item) => item.name !== name)
  return { sandbox: next, resource: database, account: resourceAccount }
}

export function getCosmosContainer(sandbox, resourceGroup, account, database, name) {
  return containerOrThrow(sandbox, resourceGroup, account, database, name).container
}

export function listCosmosContainers(sandbox, resourceGroup, account, database) {
  return databaseOrThrow(sandbox, resourceGroup, account, database).database.containers.slice()
}

export function createCosmosContainer(sandbox, { resourceGroup, account, database, name, partitionKeyPath, throughput = 400, vectorEmbeddingPolicy = null, indexingPolicy = null }) {
  const parent = databaseOrThrow(sandbox, resourceGroup, account, database)
  childName(name, 'SQL container')
  partitionPath(partitionKeyPath)
  if (!Number.isInteger(throughput) || throughput < 400 || throughput % 100 !== 0) throw new AzError('BadRequest', 'Throughput must be at least 400 RU/s and in increments of 100.', { kind: 'cli' })
  const validatedEmbeddingPolicy = vectorEmbeddingPolicy === null ? null : validateVectorEmbeddingPolicy(vectorEmbeddingPolicy)
  const validatedIndexingPolicy = validateIndexingPolicy(indexingPolicy ?? DEFAULT_INDEXING_POLICY, validatedEmbeddingPolicy)
  if (validatedEmbeddingPolicy && !parent.account.capabilities.includes(VECTOR_CAPABILITY)) throw new AzError('BadRequest', `Enable '${VECTOR_CAPABILITY}' on account '${parent.account.name}' before creating a vector container.`, { kind: 'cli' })
  const desired = { partitionKeyPath, throughput, vectorEmbeddingPolicy: validatedEmbeddingPolicy, indexingPolicy: validatedIndexingPolicy }
  const existing = parent.database.containers.find((item) => item.name === name)
  if (existing) {
    if (!sameJson({ partitionKeyPath: existing.partitionKeyPath, throughput: existing.throughput, vectorEmbeddingPolicy: existing.vectorEmbeddingPolicy, indexingPolicy: existing.indexingPolicy }, desired)) {
      throw new AzError('Conflict', `SQL container '${name}' already exists with immutable configuration. To change its configuration, delete and recreate it.`, { kind: 'cli' })
    }
    const next = cloneSandbox(sandbox)
    const storedAccount = findAccount(next, resourceGroup, account)
    const storedDatabase = storedAccount.databases.find((item) => item.name === database)
    return { sandbox: next, resource: storedDatabase.containers.find((item) => item.name === name), account: storedAccount, database: storedDatabase }
  }
  const next = cloneSandbox(sandbox)
  const storedAccount = findAccount(next, resourceGroup, account)
  const storedDatabase = storedAccount.databases.find((item) => item.name === database)
  const resource = { name, ...desired, createdAt: nowIso() }
  storedDatabase.containers.push(resource)
  return { sandbox: next, resource, account: storedAccount, database: storedDatabase }
}

export function deleteCosmosContainer(sandbox, { resourceGroup, account, database, name }) {
  const parent = containerOrThrow(sandbox, resourceGroup, account, database, name)
  const next = cloneSandbox(sandbox)
  const storedDatabase = findAccount(next, resourceGroup, account).databases.find((item) => item.name === database)
  storedDatabase.containers = storedDatabase.containers.filter((item) => item.name !== name)
  return { sandbox: next, resource: parent.container, account: parent.account, database: parent.database }
}
