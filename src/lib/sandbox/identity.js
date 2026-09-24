import { SUBSCRIPTION_ID, cloneSandbox } from './model.js'
import { normalizeLocation } from './locations.js'
import { getResourceGroup } from './ops.js'
import { AzError } from './errors.js'
import { detachIdentityFromApps } from './containerapps.js'

const NAME_RE = /^(?=.{3,128}$)[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$/
const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase()
const sameTags = (left, right) => left !== null && Object.keys(left).length === Object.keys(right).length
  && Object.entries(right).every(([key, value]) => Object.hasOwn(left, key) && left[key] === value)
function stableIdentityUuid(domain, armId) {
  const source = `${domain}:${armId.toLowerCase()}`
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (const character of source) for (let lane = 0; lane < words.length; lane++) words[lane] = Math.imul(words[lane] ^ (character.charCodeAt(0) + lane), 0x01000193) >>> 0
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}
export const identityId = (identity) => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${identity.resourceGroup}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity.name}`
const find = (sandbox, resourceGroup, name) => (sandbox.managedIdentities ?? []).find((identity) => same(identity.resourceGroup, resourceGroup) && same(identity.name, name))

export function getIdentity(sandbox, resourceGroup, name) {
  getResourceGroup(sandbox, resourceGroup)
  const identity = find(sandbox, resourceGroup, name)
  if (!identity) throw new AzError('ResourceNotFound', `Managed identity '${name}' was not found in resource group '${resourceGroup}'.`)
  return identity
}

export function listIdentities(sandbox, resourceGroup = null) {
  if (resourceGroup != null) getResourceGroup(sandbox, resourceGroup)
  return (sandbox.managedIdentities ?? []).filter((identity) => resourceGroup == null || same(identity.resourceGroup, resourceGroup))
}

export function createIdentity(sandbox, { resourceGroup, name, location, tags = null }) {
  const group = getResourceGroup(sandbox, resourceGroup)
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new AzError('BadRequest', `Managed identity name '${name}' is invalid. Names must be 3-128 characters and use letters, numbers, underscores or hyphens.`)
  const current = find(sandbox, group.name, name)
  const resolvedLocation = location == null ? (current?.location ?? group.location) : normalizeLocation(location)
  if (!resolvedLocation) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${location}' is not available for managed identities.`)
  if (current && current.location !== resolvedLocation) throw new AzError('Conflict', `Managed identity '${current.name}' location cannot be changed after creation.`)
  if (current && tags !== null && !sameTags(current.tags, tags)) throw new AzError('Conflict', `Managed identity '${current.name}' tags differ from the existing resource.`)
  const next = cloneSandbox(sandbox)
  if (current) return { sandbox: next, resource: find(next, group.name, name), existed: true }
  const resource = { id: '', name, resourceGroup: group.name, location: resolvedLocation, clientId: '', principalId: '', tags }
  resource.id = identityId(resource)
  resource.clientId = stableIdentityUuid('client', resource.id)
  resource.principalId = stableIdentityUuid('principal', resource.id)
  next.managedIdentities.push(resource)
  return { sandbox: next, resource, existed: false }
}

export function deleteIdentity(sandbox, { resourceGroup, name }) {
  const identity = getIdentity(sandbox, resourceGroup, name)
  const next = cloneSandbox(sandbox)
  detachIdentityFromApps(next, [identity.id])
  next.managedIdentities = next.managedIdentities.filter((item) => !same(item.id, identity.id))
  next.roleAssignments = next.roleAssignments.filter((assignment) => !same(assignment.principalId, identity.principalId))
  return { sandbox: next, resource: identity }
}

export function deleteIdentitiesInGroup(sandbox, resourceGroup) {
  const next = cloneSandbox(sandbox)
  const removed = next.managedIdentities.filter((identity) => same(identity.resourceGroup, resourceGroup))
  const principals = new Set(removed.map((identity) => identity.principalId.toLowerCase()))
  detachIdentityFromApps(next, removed.map((identity) => identity.id))
  next.managedIdentities = next.managedIdentities.filter((identity) => !same(identity.resourceGroup, resourceGroup))
  next.roleAssignments = next.roleAssignments.filter((assignment) => !principals.has(assignment.principalId.toLowerCase()))
  return next
}
