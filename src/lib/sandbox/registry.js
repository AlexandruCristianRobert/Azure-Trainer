import { SUBSCRIPTION_ID, cloneSandbox } from './model.js'
import { normalizeLocation } from './locations.js'
import { getResourceGroup } from './ops.js'
import { AzError } from './errors.js'

const NAME_RE = /^[A-Za-z0-9]{5,50}$/
const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase()
const sameTags = (left, right) => left !== null && Object.keys(left).length === Object.keys(right).length
  && Object.entries(right).every(([key, value]) => Object.hasOwn(left, key) && left[key] === value)
export const registryId = (registry) => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${registry.resourceGroup}/providers/Microsoft.ContainerRegistry/registries/${registry.name}`
const find = (sandbox, name) => (sandbox.containerRegistries ?? []).find((registry) => same(registry.name, name))

export function getRegistry(sandbox, resourceGroup, name) {
  if (name === undefined) { name = resourceGroup; resourceGroup = null }
  if (resourceGroup != null) getResourceGroup(sandbox, resourceGroup)
  const registry = find(sandbox, name)
  if (!registry || (resourceGroup != null && !same(registry.resourceGroup, resourceGroup))) throw new AzError('ResourceNotFound', `Container registry '${name}' was not found.`)
  return registry
}

export function listRegistries(sandbox, resourceGroup = null) {
  if (resourceGroup != null) getResourceGroup(sandbox, resourceGroup)
  return (sandbox.containerRegistries ?? []).filter((registry) => resourceGroup == null || same(registry.resourceGroup, resourceGroup))
}

export function createRegistry(sandbox, { resourceGroup, name, location, sku = 'Basic', tags = null }) {
  const group = getResourceGroup(sandbox, resourceGroup)
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new AzError('BadRequest', `Container registry name '${name}' is invalid. Names must be 5-50 alphanumeric characters.`)
  if (sku !== 'Basic') throw new AzError('InvalidArgumentValue', `Only Basic registry SKU is supported in the Sandbox.`, { kind: 'cli' })
  const current = find(sandbox, name)
  if (current && !same(current.resourceGroup, group.name)) throw new AzError('Conflict', `Container registry name '${name}' is already in use.`)
  const resolvedLocation = location == null ? (current?.location ?? group.location) : normalizeLocation(location)
  if (!resolvedLocation) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${location}' is not available for container registries.`)
  if (current && current.location !== resolvedLocation) throw new AzError('Conflict', `Container registry '${current.name}' location cannot be changed after creation.`)
  if (current && tags !== null && !sameTags(current.tags, tags)) throw new AzError('Conflict', `Container registry '${current.name}' tags differ from the existing resource.`)
  const next = cloneSandbox(sandbox)
  if (current) return { sandbox: next, resource: find(next, name), existed: true }
  const resource = { id: '', name, resourceGroup: group.name, location: resolvedLocation, loginServer: `${name.toLowerCase()}.azurecr.io`, sku, tags }
  resource.id = registryId(resource)
  next.containerRegistries.push(resource)
  return { sandbox: next, resource, existed: false }
}

export function deleteRegistry(sandbox, { resourceGroup, name }) {
  const registry = getRegistry(sandbox, resourceGroup, name)
  const next = cloneSandbox(sandbox)
  next.containerRegistries = next.containerRegistries.filter((item) => !same(item.id, registry.id))
  next.roleAssignments = next.roleAssignments.filter((assignment) => !same(assignment.scope, registry.id))
  return { sandbox: next, resource: registry }
}

export function deleteRegistriesInGroup(sandbox, resourceGroup) {
  const next = cloneSandbox(sandbox)
  const removed = next.containerRegistries.filter((registry) => same(registry.resourceGroup, resourceGroup))
  const ids = new Set(removed.map((registry) => registry.id.toLowerCase()))
  next.containerRegistries = next.containerRegistries.filter((registry) => !ids.has(registry.id.toLowerCase()))
  next.roleAssignments = next.roleAssignments.filter((assignment) => !ids.has(assignment.scope.toLowerCase()))
  return next
}
