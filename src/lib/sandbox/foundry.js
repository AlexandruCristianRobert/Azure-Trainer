import { SUBSCRIPTION_ID, cloneSandbox } from './model.js'
import { normalizeLocation } from './locations.js'
import { getResourceGroup } from './ops.js'
import { AzError } from './errors.js'

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const ACCOUNT_NAME = /^(?=.{2,64}$)[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/
const CHILD_NAME = /^(?=.{2,64}$)[a-zA-Z0-9][a-zA-Z0-9_-]*[a-zA-Z0-9]$/
export const FOUNDRY_API_VERSION = '2025-06-01'
export const foundryAccountId = ({ resourceGroup, name }) => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroup}/providers/Microsoft.CognitiveServices/accounts/${name}`
export const foundryAccountEndpoint = (name) => `https://${name.toLowerCase()}.services.ai.azure.com/openai/v1/`
export const foundryProjectId = (account, name) => `${account.id}/projects/${name}`
export const foundryDeploymentId = (account, name) => `${account.id}/deployments/${name}`
const accounts = (sandbox) => sandbox.foundryAccounts ?? []
const findAccount = (sandbox, name) => accounts(sandbox).find((item) => same(item.name, name))

function stableUuid(domain, id) {
  const source = `${domain}:${id.toLowerCase()}`
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (const character of source) for (let lane = 0; lane < words.length; lane++) words[lane] = Math.imul(words[lane] ^ (character.charCodeAt(0) + lane), 0x01000193) >>> 0
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

export function getFoundryAccount(sandbox, resourceGroup, name) {
  getResourceGroup(sandbox, resourceGroup)
  const account = findAccount(sandbox, name)
  if (!account || !same(account.resourceGroup, resourceGroup)) throw new AzError('ResourceNotFound', `Foundry account '${name}' was not found.`)
  return account
}

export function listFoundryAccounts(sandbox, resourceGroup = null) {
  if (resourceGroup != null) getResourceGroup(sandbox, resourceGroup)
  return accounts(sandbox).filter((account) => resourceGroup == null || same(account.resourceGroup, resourceGroup))
}

export function createFoundryAccount(sandbox, { resourceGroup, name, location, sku = 'S0', identity = null, allowProjectManagement = false }) {
  const group = getResourceGroup(sandbox, resourceGroup)
  if (typeof name !== 'string' || !ACCOUNT_NAME.test(name)) throw new AzError('BadRequest', `Foundry account name '${name}' is invalid.`)
  if (sku !== 'S0') throw new AzError('InvalidArgumentValue', `Only S0 Foundry account SKU is supported.`)
  if (typeof allowProjectManagement !== 'boolean') throw new AzError('InvalidArgumentValue', 'Foundry project management setting must be a boolean.')
  if (identity !== null && (identity?.type !== 'SystemAssigned' || Object.keys(identity).some((key) => key !== 'type'))) throw new AzError('InvalidArgumentValue', 'Only a system-assigned account management identity is supported.')
  const current = findAccount(sandbox, name)
  const resolvedLocation = location == null ? (current?.location ?? group.location) : normalizeLocation(location)
  if (!resolvedLocation) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${location}' is not available for Foundry accounts.`)
  if (current) throw new AzError('Conflict', `Foundry account '${name}' already exists.`)
  const next = cloneSandbox(sandbox)
  if (!next.foundryAccounts) next.foundryAccounts = []
  const id = foundryAccountId({ resourceGroup: group.name, name })
  const resource = {
    id, name, resourceGroup: group.name, location: resolvedLocation, kind: 'AIServices', sku, allowProjectManagement,
    endpoint: foundryAccountEndpoint(name),
    identity: identity ? { type: 'SystemAssigned', principalId: stableUuid('foundry-account-principal', id) } : null,
    projects: [], deployments: [],
  }
  next.foundryAccounts.push(resource)
  return { sandbox: next, resource, existed: false }
}

export function deleteFoundryAccount(sandbox, { resourceGroup, name }) {
  const account = getFoundryAccount(sandbox, resourceGroup, name)
  const next = cloneSandbox(sandbox)
  next.foundryAccounts = next.foundryAccounts.filter((item) => !same(item.id, account.id))
  next.roleAssignments = next.roleAssignments.filter((assignment) => !same(assignment.scope, account.id))
  return { sandbox: next, resource: account }
}

export function deleteFoundryAccountsInGroup(sandbox, resourceGroup) {
  const next = cloneSandbox(sandbox)
  const removed = accounts(next).filter((account) => same(account.resourceGroup, resourceGroup))
  const scopes = new Set(removed.map((account) => account.id.toLowerCase()))
  next.foundryAccounts = accounts(next).filter((account) => !scopes.has(account.id.toLowerCase()))
  next.roleAssignments = next.roleAssignments.filter((assignment) => !scopes.has(assignment.scope.toLowerCase()))
  return next
}

function childName(name) {
  if (typeof name !== 'string' || !CHILD_NAME.test(name)) throw new AzError('BadRequest', `Foundry child resource name '${name}' is invalid.`)
}

export function getFoundryProject(sandbox, resourceGroup, accountName, name) {
  const account = getFoundryAccount(sandbox, resourceGroup, accountName)
  const project = account.projects.find((item) => same(item.name, name))
  if (!project) throw new AzError('ResourceNotFound', `Foundry project '${name}' was not found.`)
  return project
}

export function listFoundryProjects(sandbox, resourceGroup, accountName) {
  return getFoundryAccount(sandbox, resourceGroup, accountName).projects.slice()
}

export function createFoundryProject(sandbox, { resourceGroup, accountName, name }) {
  const account = getFoundryAccount(sandbox, resourceGroup, accountName)
  if (!account.allowProjectManagement || account.identity?.type !== 'SystemAssigned') throw new AzError('InvalidArgumentValue', 'Foundry project creation requires project management enabled and a system-assigned account identity.')
  childName(name)
  if (account.projects.some((item) => same(item.name, name))) throw new AzError('Conflict', `Foundry project '${name}' already exists.`)
  const next = cloneSandbox(sandbox)
  const target = getFoundryAccount(next, resourceGroup, accountName)
  const resource = { id: foundryProjectId(target, name), name, endpoint: `https://${target.name.toLowerCase()}.services.ai.azure.com/api/projects/${name}`, location: target.location }
  target.projects.push(resource)
  return { sandbox: next, resource, account: target }
}

export function getFoundryDeployment(sandbox, resourceGroup, accountName, name) {
  const account = getFoundryAccount(sandbox, resourceGroup, accountName)
  const deployment = account.deployments.find((item) => same(item.name, name))
  if (!deployment) throw new AzError('ResourceNotFound', `Foundry deployment '${name}' was not found.`)
  return deployment
}

export function listFoundryDeployments(sandbox, resourceGroup, accountName) {
  return getFoundryAccount(sandbox, resourceGroup, accountName).deployments.slice()
}

export function createFoundryDeployment(sandbox, { resourceGroup, accountName, name, modelName, modelVersion, sku }) {
  const account = getFoundryAccount(sandbox, resourceGroup, accountName)
  childName(name)
  if (modelName !== 'gpt-5-mini' || modelVersion !== '2025-08-07' || sku !== 'GlobalStandard') throw new AzError('InvalidArgumentValue', 'Only the simulated gpt-5-mini/2025-08-07/GlobalStandard deployment profile is supported.')
  if (account.deployments.some((item) => same(item.name, name))) throw new AzError('Conflict', `Foundry deployment '${name}' already exists.`)
  const next = cloneSandbox(sandbox)
  const target = getFoundryAccount(next, resourceGroup, accountName)
  const resource = { id: foundryDeploymentId(target, name), name, modelName, modelVersion, sku }
  target.deployments.push(resource)
  return { sandbox: next, resource, account: target }
}
