import { SUBSCRIPTION_ID, cloneSandbox } from './model.js'
import { createResourceGroup, getResourceGroup } from './ops.js'
import { createIdentity } from './identity.js'
import { createRegistryRoleAssignment, deleteRegistryRoleAssignment } from './roleAssignments.js'
import { getRegistry } from './registry.js'
import { AzError } from './errors.js'
import { normalizeLocation } from './locations.js'

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const NAME = /^(?=.{1,63}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/
const uuid = (domain, id) => {
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (const char of `${domain}:${id.toLowerCase()}`) for (let lane = 0; lane < words.length; lane++) words[lane] = Math.imul(words[lane] ^ (char.charCodeAt(0) + lane), 0x01000193) >>> 0
  const hex = words.map(word => word.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}
export const aksClusterId = (resourceGroup, name) => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${name}`
const find = (sandbox, resourceGroup, name) => (sandbox.aksClusters ?? []).find(item => same(item.resourceGroup, resourceGroup) && same(item.name, name))

export function getAksCluster(sandbox, resourceGroup, name) {
  getResourceGroup(sandbox, resourceGroup)
  const resource = find(sandbox, resourceGroup, name)
  if (!resource) throw new AzError('ResourceNotFound', `Managed cluster '${name}' was not found.`)
  return resource
}
export function listAksClusters(sandbox, resourceGroup = null) {
  if (resourceGroup !== null) getResourceGroup(sandbox, resourceGroup)
  return (sandbox.aksClusters ?? []).filter(item => resourceGroup === null || same(item.resourceGroup, resourceGroup))
}
export function createAksCluster(sandbox, options) {
  const group = getResourceGroup(sandbox, options.resourceGroup)
  if (!NAME.test(options.name ?? '')) throw new AzError('BadRequest', 'Managed cluster name is invalid.')
  const current = find(sandbox, group.name, options.name)
  const location = options.location === undefined ? group.location : normalizeLocation(options.location)
  if (!location) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${options.location}' is not available for AKS.`, { kind: 'cli' })
  const nodeCount = options.nodeCount === undefined ? 1 : Number(options.nodeCount)
  if (!Number.isInteger(nodeCount) || nodeCount < 1 || nodeCount > 3) throw new AzError('InvalidArgumentValue', 'argument --node-count must be an integer from 1 to 3.', { kind: 'cli' })
  if ((options.nodeVmSize ?? 'Standard_D2s_v5') !== 'Standard_D2s_v5') throw new AzError('InvalidArgumentValue', 'Only Standard_D2s_v5 is supported in the Sandbox.', { kind: 'cli' })
  if (options.enableManagedIdentity !== true || options.generateSshKeys !== true) throw new AzError('InvalidArgumentValue', 'This Lab requires --enable-managed-identity and --generate-ssh-keys.', { kind: 'cli' })
  if (current) {
    if (current.location !== location || current.nodeCount !== nodeCount || current.nodeVmSize !== (options.nodeVmSize ?? 'Standard_D2s_v5')) throw new AzError('Conflict', `Managed cluster '${current.name}' differs from the existing resource.`)
    return { sandbox: cloneSandbox(sandbox), resource: current, existed: true }
  }
  let next = cloneSandbox(sandbox)
  const nodeResourceGroup = `MC_${group.name}_${options.name}_${location}`
  if (next.resourceGroups.some(item => same(item.name, nodeResourceGroup))) throw new AzError('Conflict', `Node resource group '${nodeResourceGroup}' already exists and is not owned by this cluster.`)
  const identityName = `${options.name}-kubelet`
  if (next.managedIdentities.some(item => same(item.resourceGroup, nodeResourceGroup) && same(item.name, identityName))) throw new AzError('Conflict', `Kubelet identity '${identityName}' already exists and is not owned by this cluster.`)
  next = createResourceGroup(next, { name: nodeResourceGroup, location }).sandbox
  next.resourceGroups.find(item => same(item.name, nodeResourceGroup)).clusterOwner = aksClusterId(group.name, options.name)
  const createdIdentity = createIdentity(next, { resourceGroup: nodeResourceGroup, name: identityName, location })
  next = createdIdentity.sandbox
  const identity = next.managedIdentities.find(item => same(item.id, createdIdentity.resource.id))
  const id = aksClusterId(group.name, options.name)
  identity.clusterOwner = id
  const resource = { id, name: options.name, resourceGroup: group.name, location, nodeResourceGroup, nodeCount, nodeVmSize: options.nodeVmSize ?? 'Standard_D2s_v5', provisioningState: 'Succeeded', identity: { type: 'SystemAssigned', principalId: uuid('control-plane', id) }, identityProfile: { kubeletidentity: { resourceId: identity.id, clientId: identity.clientId, objectId: identity.principalId } } }
  next.aksClusters.push(resource)
  if (options.attachAcr !== undefined) next = createRegistryRoleAssignment(next, { scope: getRegistry(next, options.attachAcr).id, role: 'AcrPull', principalId: identity.principalId }).sandbox
  return { sandbox: next, resource, existed: false }
}
export function updateAksRegistry(sandbox, { resourceGroup, name, registry, attach }) {
  const cluster = getAksCluster(sandbox, resourceGroup, name)
  const principalId = cluster.identityProfile.kubeletidentity.objectId
  if (attach) return createRegistryRoleAssignment(sandbox, { scope: getRegistry(sandbox, registry).id, role: 'AcrPull', principalId })
  return deleteRegistryRoleAssignment(sandbox, { scope: getRegistry(sandbox, registry).id, role: 'AcrPull', principalId })
}
export function deleteAksCluster(sandbox, { resourceGroup, name }) {
  const cluster = getAksCluster(sandbox, resourceGroup, name)
  const next = cloneSandbox(sandbox)
  next.aksClusters = next.aksClusters.filter(item => !same(item.id, cluster.id))
  const identity = next.managedIdentities.find(item => same(item.id, cluster.identityProfile.kubeletidentity.resourceId) && same(item.clusterOwner, cluster.id))
  if (identity) {
    next.managedIdentities = next.managedIdentities.filter(item => !same(item.id, identity.id))
    next.roleAssignments = next.roleAssignments.filter(item => !same(item.principalId, identity.principalId))
  }
  const shared = next.aksClusters.some(item => same(item.nodeResourceGroup, cluster.nodeResourceGroup))
  if (!shared) next.resourceGroups = next.resourceGroups.filter(group => !same(group.name, cluster.nodeResourceGroup) || !same(group.clusterOwner, cluster.id))
  return { sandbox: next, resource: cluster }
}
export function deleteAksClustersInGroup(sandbox, resourceGroup) {
  let next = sandbox
  for (const cluster of listAksClusters(sandbox).filter(item => same(item.resourceGroup, resourceGroup) || same(item.nodeResourceGroup, resourceGroup))) next = deleteAksCluster(next, { resourceGroup: cluster.resourceGroup, name: cluster.name }).sandbox
  return next
}
