import { SUBSCRIPTION_ID, cloneSandbox } from './model.js'
import { AzError } from './errors.js'
import { getFoundryAccount } from './foundry.js'

export const ACR_PULL_ROLE_ID = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
const same = (left, right) => String(left).toLowerCase() === String(right).toLowerCase()
export const COGNITIVE_SERVICES_USER_ROLE_ID = 'a97b65f3-24c7-4388-baec-2e87135dc908'
export const COGNITIVE_SERVICES_OPENAI_USER_ROLE_ID = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

/** Bicep declares the assignment UUID; legacy CLI assignments retain their generated IDs. */
export function createDeclaredRoleAssignment(sandbox, { name, scope, principalId, roleDefinitionId }) {
  const definition = roleDefinitionId.split('/').at(-1)
  const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
  const byName = sandbox.roleAssignments.find(item => same(item.id, name))
  const byTriple = sandbox.roleAssignments.find(item => same(item.scope, scope) && same(item.principalId, principalId)
    && same(item.roleDefinitionId, definition))
  if (byName || byTriple) {
    if (byName === byTriple && byName) return { sandbox, resource: byName, existed: true }
    throw new AzError('Conflict', 'Role assignment GUID conflicts with an existing scope/principal/role triple.')
  }
  const created = definition === ACR_PULL_ROLE_ID
    ? createRegistryRoleAssignment(sandbox, { scope, role: definition, principalId })
    : createFoundryRoleAssignment(sandbox, { scope, role: definition, principalId })
  created.resource.id = name
  return created
}
function stableAssignmentUuid(scope, principalId, roleDefinitionId = ACR_PULL_ROLE_ID) {
  const source = `${roleDefinitionId.toLowerCase()}:${scope.toLowerCase()}:${principalId.toLowerCase()}`
  const words = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (const character of source) for (let lane = 0; lane < words.length; lane++) words[lane] = Math.imul(words[lane] ^ (character.charCodeAt(0) + lane), 0x01000193) >>> 0
  const hex = words.map((word) => word.toString(16).padStart(8, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

export function isRegistryScope(scope) {
  return typeof scope === 'string' && /^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.containerregistry\/registries\/[^/]+(?:\/.*)?$/i.test(scope)
}

function registryAtScope(sandbox, scope) {
  const registry = (sandbox.containerRegistries ?? []).find((item) => same(item.id, scope))
  if (!registry) throw new AzError('ResourceNotFound', `Registry scope '${scope}' was not found or is not an exact registry scope.`)
  return registry
}

function roleId(role) {
  if (same(role, 'AcrPull') || same(role, ACR_PULL_ROLE_ID)) return ACR_PULL_ROLE_ID
  throw new AzError('RoleDefinitionDoesNotExist', `The role definition '${role}' was not found for a registry scope.`)
}

export function resolveRegistryPrincipal(sandbox, { assignee, assigneeObjectId, assigneePrincipalType }) {
  if (assignee !== undefined && assigneeObjectId !== undefined) throw new AzError('InvalidArgumentValue', 'Specify either --assignee or --assignee-object-id, not both.', { kind: 'cli' })
  if (assigneePrincipalType !== undefined && assigneePrincipalType !== 'ServicePrincipal') throw new AzError('InvalidArgumentValue', 'Registry AcrPull requires ServicePrincipal.', { kind: 'cli' })
  const supplied = assigneeObjectId ?? assignee
  const identity = (sandbox.managedIdentities ?? []).find((item) => same(item.principalId, supplied))
  if (!identity) throw new AzError('PrincipalNotFound', `The identity principal '${supplied ?? ''}' was not found in the Sandbox.`)
  return { principalId: identity.principalId, principalType: 'ServicePrincipal' }
}

export function createRegistryRoleAssignment(sandbox, { scope, role, principalId, principalType = 'ServicePrincipal' }) {
  const registry = registryAtScope(sandbox, scope)
  const definition = roleId(role)
  const identity = (sandbox.managedIdentities ?? []).find((item) => same(item.principalId, principalId))
  if (principalType !== 'ServicePrincipal' || !identity) throw new AzError('PrincipalNotFound', `The identity principal '${principalId}' was not found in the Sandbox.`)
  const existing = (sandbox.roleAssignments ?? []).find((assignment) => same(assignment.scope, registry.id) && same(assignment.principalId, identity.principalId) && same(assignment.roleDefinitionId, definition))
  const next = cloneSandbox(sandbox)
  if (existing) return { sandbox: next, resource: next.roleAssignments.find((assignment) => assignment.id === existing.id), registry, existed: true }
  const resource = { id: stableAssignmentUuid(registry.id, identity.principalId, definition), principalId: identity.principalId, principalType: 'ServicePrincipal', roleName: 'AcrPull', roleDefinitionId: definition, scope: registry.id }
  next.roleAssignments.push(resource)
  return { sandbox: next, resource, registry, existed: false }
}

export function listRegistryRoleAssignments(sandbox, { scope, role, principalId }) {
  const registry = registryAtScope(sandbox, scope)
  const definition = role === undefined ? null : roleId(role)
  return (sandbox.roleAssignments ?? []).filter((assignment) => same(assignment.scope, registry.id)
    && (definition === null || same(assignment.roleDefinitionId, definition))
    && (principalId === undefined || same(assignment.principalId, principalId)))
}

export function deleteRegistryRoleAssignment(sandbox, { scope, role, principalId }) {
  const registry = registryAtScope(sandbox, scope)
  const definition = roleId(role)
  const assignment = (sandbox.roleAssignments ?? []).find((item) => same(item.scope, registry.id) && same(item.roleDefinitionId, definition) && same(item.principalId, principalId))
  if (!assignment) throw new AzError('RoleAssignmentNotFound', 'The requested role assignment was not found.')
  const next = cloneSandbox(sandbox)
  next.roleAssignments = next.roleAssignments.filter((item) => item.id !== assignment.id)
  return { sandbox: next, resource: assignment, registry }
}

export const roleDefinitionId = () => `/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.Authorization/roleDefinitions/${ACR_PULL_ROLE_ID}`

export function isFoundryAccountScope(scope) {
  return typeof scope === 'string' && /^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.cognitiveservices\/accounts\/[^/]+$/i.test(scope)
}

function foundryAtScope(sandbox, scope) {
  const account = (sandbox.foundryAccounts ?? []).find((item) => same(item.id, scope))
  if (!account) throw new AzError('ResourceNotFound', `Foundry account scope '${scope}' was not found or is not an exact account scope.`)
  return getFoundryAccount(sandbox, account.resourceGroup, account.name)
}

function foundryRole(role) {
  if (same(role, 'Cognitive Services User') || same(role, COGNITIVE_SERVICES_USER_ROLE_ID)) return { id: COGNITIVE_SERVICES_USER_ROLE_ID, name: 'Cognitive Services User' }
  if (same(role, 'Cognitive Services OpenAI User') || same(role, COGNITIVE_SERVICES_OPENAI_USER_ROLE_ID)) return { id: COGNITIVE_SERVICES_OPENAI_USER_ROLE_ID, name: 'Cognitive Services OpenAI User' }
  throw new AzError('RoleDefinitionDoesNotExist', `The role definition '${role}' was not found for a Foundry account scope.`)
}

export function resolveFoundryPrincipal(sandbox, { assignee, assigneeObjectId, assigneePrincipalType }) {
  return resolveRegistryPrincipal(sandbox, { assignee, assigneeObjectId, assigneePrincipalType })
}

export function createFoundryRoleAssignment(sandbox, { scope, role, principalId, principalType = 'ServicePrincipal' }) {
  const account = foundryAtScope(sandbox, scope)
  const definition = foundryRole(role)
  const identity = (sandbox.managedIdentities ?? []).find((item) => same(item.principalId, principalId))
  if (principalType !== 'ServicePrincipal' || !identity) throw new AzError('PrincipalNotFound', `The identity principal '${principalId}' was not found in the Sandbox.`)
  const existing = (sandbox.roleAssignments ?? []).find((item) => same(item.scope, account.id) && same(item.principalId, identity.principalId) && same(item.roleDefinitionId, definition.id))
  const next = cloneSandbox(sandbox)
  if (existing) return { sandbox: next, resource: next.roleAssignments.find((item) => item.id === existing.id), account, existed: true }
  const resource = { id: stableAssignmentUuid(account.id, identity.principalId, definition.id), principalId: identity.principalId, principalType: 'ServicePrincipal', roleName: definition.name, roleDefinitionId: definition.id, scope: account.id }
  next.roleAssignments.push(resource)
  return { sandbox: next, resource, account, existed: false }
}

export function listFoundryRoleAssignments(sandbox, { scope, role, principalId }) {
  const account = foundryAtScope(sandbox, scope)
  const definition = role === undefined ? null : foundryRole(role)
  return (sandbox.roleAssignments ?? []).filter((item) => same(item.scope, account.id)
    && (definition === null || same(item.roleDefinitionId, definition.id))
    && (principalId === undefined || same(item.principalId, principalId)))
}

export function deleteFoundryRoleAssignment(sandbox, { scope, role, principalId }) {
  const account = foundryAtScope(sandbox, scope)
  const definition = foundryRole(role)
  const assignment = (sandbox.roleAssignments ?? []).find((item) => same(item.scope, account.id) && same(item.roleDefinitionId, definition.id) && same(item.principalId, principalId))
  if (!assignment) throw new AzError('RoleAssignmentNotFound', 'The requested role assignment was not found.')
  const next = cloneSandbox(sandbox)
  next.roleAssignments = next.roleAssignments.filter((item) => item.id !== assignment.id)
  return { sandbox: next, resource: assignment, account }
}
