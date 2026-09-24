import { SUBSCRIPTION_ID, USER_NAME, USER_OBJECT_ID, cloneSandbox, nowIso } from './model.js'
import { normalizeLocation } from './locations.js'
import { AzError } from './errors.js'

export const SECRETS_OFFICER_ROLE_ID = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
export const SECRETS_USER_ROLE_ID = '4633458b-17de-408a-b874-0445c86b69e6'

const ROLES = {
  [SECRETS_OFFICER_ROLE_ID]: 'Key Vault Secrets Officer',
  [SECRETS_USER_ROLE_ID]: 'Key Vault Secrets User',
}
const VAULT_NAME_RE = /^(?=.{3,24}$)[A-Za-z](?!.*--)[A-Za-z0-9-]*[A-Za-z0-9]$/
const SECRET_NAME_RE = /^[A-Za-z0-9-]{1,127}$/
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function requireGroup(sb, name) {
  const group = sb.resourceGroups.find((item) => same(item.name, name))
  if (!group) throw new AzError('ResourceGroupNotFound', `Resource group '${name}' could not be found.`)
  return group
}

function findVault(sb, resourceGroup, name) {
  return sb.keyVaults.find((vault) => same(vault.resourceGroup, resourceGroup) && same(vault.name, name))
}

function requireVaultName(name) {
  if (typeof name !== 'string' || !VAULT_NAME_RE.test(name)) {
    throw new AzError('BadRequest', `Key Vault name '${name}' is invalid. Vault names must be 3-24 characters, start with a letter, end with a letter or number, use letters, numbers or hyphens, and cannot contain consecutive hyphens.`)
  }
}

function requireSecretName(name) {
  if (typeof name !== 'string' || !SECRET_NAME_RE.test(name)) {
    throw new AzError('BadRequest', `Secret name '${name}' is invalid. Secret names must be 1-127 characters and use only letters, numbers and hyphens.`)
  }
}

function versionId(vault) {
  const used = new Set(vault.secrets.flatMap((secret) => secret.versions.map((version) => version.version)))
  let value = ''
  do {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  } while (used.has(value))
  return value
}

function assignmentId() {
  return crypto.randomUUID()
}

function roleFrom(value) {
  if (typeof value !== 'string') throw new AzError('InvalidArgumentValue', 'A supported Key Vault role is required.', { kind: 'cli' })
  const roleId = Object.keys(ROLES).find((id) => same(id, value))
  if (roleId) return { roleDefinitionId: roleId, roleName: ROLES[roleId] }
  const namedRoleId = Object.entries(ROLES).find(([, name]) => same(name, value))?.[0]
  if (!namedRoleId) throw new AzError('RoleDefinitionDoesNotExist', `The role definition '${value}' was not found.`)
  return { roleDefinitionId: namedRoleId, roleName: ROLES[namedRoleId] }
}

function secretFor(vault, name) {
  const secret = vault.secrets.find((item) => same(item.name, name))
  if (!secret) throw new AzError('SecretNotFound', `Secret '${name}' was not found in vault '${vault.name}'.`)
  return secret
}

function resolveSecretId(id) {
  if (typeof id !== 'string') throw new AzError('InvalidArgumentValue', 'argument --id: expected a Key Vault secret ID.', { kind: 'cli' })
  const match = /^https:\/\/([a-z0-9-]+)\.vault\.azure\.net\/secrets\/([A-Za-z0-9-]+)(?:\/([a-f0-9]{32}))?$/i.exec(id)
  if (!match) throw new AzError('InvalidArgumentValue', `The secret ID '${id}' is invalid.`, { kind: 'cli' })
  return { vaultName: match[1], name: match[2], version: match[3] }
}

function exactScope(vault, scope) {
  return typeof scope === 'string' && same(scope, keyVaultId(vault))
}

function requireOfficer(vault) {
  if (!canManageSecrets(vault)) throw new AzError('Forbidden', `The client '${USER_NAME}' does not have secrets management permission on vault '${vault.name}'.`)
}

function canManageSecrets(vault) {
  if (!vault || !vault.enableRbacAuthorization) return false
  return vault.roleAssignments.some((assignment) => same(assignment.principalId, USER_OBJECT_ID)
    && exactScope(vault, assignment.scope) && same(assignment.roleDefinitionId, SECRETS_OFFICER_ROLE_ID))
}

function requireRead(vault) {
  if (!canReadSecrets(vault)) throw new AzError('Forbidden', `The client '${USER_NAME}' does not have secrets read permission on vault '${vault.name}'.`)
}

export function keyVaultId(vault) {
  return `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${vault.resourceGroup}/providers/Microsoft.KeyVault/vaults/${vault.name}`
}

export function canReadSecrets(vault) {
  if (!vault || !vault.enableRbacAuthorization || !Array.isArray(vault.roleAssignments)) return false
  return vault.roleAssignments.some((assignment) => same(assignment.principalId, USER_OBJECT_ID)
    && exactScope(vault, assignment.scope)
    && (same(assignment.roleDefinitionId, SECRETS_OFFICER_ROLE_ID) || same(assignment.roleDefinitionId, SECRETS_USER_ROLE_ID)))
}

export function getKeyVault(sb, resourceGroup, name) {
  if (name === undefined) {
    name = resourceGroup
    resourceGroup = null
  }
  const vaults = resourceGroup === null || resourceGroup === undefined
    ? sb.keyVaults.filter((item) => same(item.name, name))
    : sb.keyVaults.filter((item) => same(item.resourceGroup, resourceGroup) && same(item.name, name))
  if (resourceGroup !== null && resourceGroup !== undefined) requireGroup(sb, resourceGroup)
  if (vaults.length === 0) throw new AzError('ResourceNotFound', `Key Vault '${name}' was not found${resourceGroup ? ` in resource group '${resourceGroup}'` : ''}.`)
  if (vaults.length > 1) throw new AzError('AmbiguousResource', `Key Vault name '${name}' is ambiguous. Specify --resource-group.`, { kind: 'cli' })
  return vaults[0]
}

export function listKeyVaults(sb, resourceGroup = null) {
  if (resourceGroup === null) return sb.keyVaults.slice()
  requireGroup(sb, resourceGroup)
  return sb.keyVaults.filter((vault) => same(vault.resourceGroup, resourceGroup))
}

export function createKeyVault(sb, { resourceGroup, name, location, sku = 'standard', enableRbacAuthorization = true, enablePurgeProtection = false, softDeleteRetentionInDays, tags = null }) {
  const group = requireGroup(sb, resourceGroup)
  requireVaultName(name)
  if (sku !== 'standard' && sku !== 'premium') throw new AzError('InvalidArgumentValue', `Unsupported Key Vault SKU '${sku}'.`, { kind: 'cli' })
  if (enableRbacAuthorization !== true) throw new AzError('InvalidArgumentValue', 'Only Azure RBAC authorization is supported for Key Vaults in the Sandbox.', { kind: 'cli' })
  if (typeof enablePurgeProtection !== 'boolean') throw new AzError('InvalidArgumentValue', '--enable-purge-protection must be true or false.', { kind: 'cli' })
  const retentionDays = softDeleteRetentionInDays ?? 90
  if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 90) throw new AzError('InvalidArgumentValue', '--retention-days must be an integer from 7 to 90.', { kind: 'cli' })
  const current = findVault(sb, group.name, name)
  const otherGroupVault = sb.keyVaults.find((vault) => same(vault.name, name) && !same(vault.resourceGroup, group.name))
  if (otherGroupVault) throw new AzError('Conflict', `Key Vault name '${name}' is already in use in resource group '${otherGroupVault.resourceGroup}'.`)
  const resolvedLocation = location === undefined || location === null ? (current?.location ?? group.location) : normalizeLocation(location)
  if (!resolvedLocation) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${location}' is not available for resource type 'Microsoft.KeyVault/vaults'.`)
  if (current && !same(current.location, resolvedLocation)) throw new AzError('Conflict', `Key Vault '${current.name}' location cannot be changed after creation.`, { kind: 'cli' })
  const next = cloneSandbox(sb)
  let vault = findVault(next, group.name, name)
  if (vault) {
    vault.sku = sku
    vault.enableRbacAuthorization = true
    vault.enablePurgeProtection = vault.enablePurgeProtection || enablePurgeProtection
    if (softDeleteRetentionInDays !== undefined && vault.softDeleteRetentionInDays !== retentionDays) throw new AzError('Conflict', `Soft-delete retention for Key Vault '${vault.name}' cannot be changed after creation.`, { kind: 'cli' })
    if (tags !== null) vault.tags = tags
  } else {
    vault = { name, resourceGroup: group.name, location: resolvedLocation, sku, enableRbacAuthorization: true, enablePurgeProtection, softDeleteRetentionInDays: retentionDays, tags, createdAt: nowIso(), roleAssignments: [], secrets: [] }
    next.keyVaults.push(vault)
  }
  return { sandbox: next, resource: vault }
}

export function updateKeyVault(sb, { resourceGroup, name, enableRbacAuthorization, enablePurgeProtection }) {
  const current = getKeyVault(sb, resourceGroup, name)
  if (enableRbacAuthorization !== undefined && enableRbacAuthorization !== true) throw new AzError('InvalidArgumentValue', 'Only Azure RBAC authorization is supported for Key Vaults in the Sandbox.', { kind: 'cli' })
  if (current.enablePurgeProtection && enablePurgeProtection === false) throw new AzError('Conflict', `Purge protection cannot be disabled for Key Vault '${current.name}'.`, { kind: 'cli' })
  const next = cloneSandbox(sb)
  const vault = findVault(next, current.resourceGroup, current.name)
  if (enableRbacAuthorization !== undefined) vault.enableRbacAuthorization = true
  if (enablePurgeProtection !== undefined) vault.enablePurgeProtection = vault.enablePurgeProtection || enablePurgeProtection
  return { sandbox: next, resource: vault }
}

export function deleteKeyVaultsInGroup(sb, resourceGroup) {
  const next = cloneSandbox(sb)
  next.keyVaults = next.keyVaults.filter((vault) => !same(vault.resourceGroup, resourceGroup))
  return next
}

export function resolveRolePrincipal({ assignee, assigneeObjectId, assigneePrincipalType }) {
  if (assignee !== undefined && assigneeObjectId !== undefined) throw new AzError('InvalidArgumentValue', 'Specify either --assignee or --assignee-object-id, not both.', { kind: 'cli' })
  const supplied = assigneeObjectId ?? assignee
  const known = assigneeObjectId !== undefined ? same(assigneeObjectId, USER_OBJECT_ID) : same(assignee, USER_NAME) || same(assignee, USER_OBJECT_ID)
  if (!supplied || !known) throw new AzError('PrincipalNotFound', `The principal '${supplied ?? ''}' was not found in the Sandbox.`)
  if (assigneePrincipalType !== undefined && assigneePrincipalType !== 'User') throw new AzError('InvalidArgumentValue', 'Only assignee principal type User is supported.', { kind: 'cli' })
  return { principalId: USER_OBJECT_ID, principalType: 'User' }
}

export function createRoleAssignment(sb, { scope, role, principalId, principalType = 'User' }) {
  const vault = sb.keyVaults.find((item) => exactScope(item, scope))
  if (!vault) throw new AzError('ResourceNotFound', `The Key Vault scope '${scope}' was not found or is not a vault-level scope.`)
  if (!same(principalId, USER_OBJECT_ID) || principalType !== 'User') throw new AzError('PrincipalNotFound', 'Only the Sandbox learner User can receive Key Vault roles.')
  const roleInfo = roleFrom(role)
  const existing = vault.roleAssignments.find((assignment) => same(assignment.principalId, USER_OBJECT_ID) && same(assignment.roleDefinitionId, roleInfo.roleDefinitionId) && exactScope(vault, assignment.scope))
  if (existing) return { sandbox: cloneSandbox(sb), resource: cloneSandbox(existing), vault: cloneSandbox(vault), existed: true }
  const next = cloneSandbox(sb)
  const storedVault = next.keyVaults.find((item) => exactScope(item, scope))
  const resource = { id: assignmentId(), principalId: USER_OBJECT_ID, principalType: 'User', roleName: roleInfo.roleName, roleDefinitionId: roleInfo.roleDefinitionId, scope: keyVaultId(storedVault) }
  storedVault.roleAssignments.push(resource)
  return { sandbox: next, resource, vault: storedVault, existed: false }
}

export function listRoleAssignments(sb, { scope, role, principalId }) {
  const vault = sb.keyVaults.find((item) => exactScope(item, scope))
  if (!vault) throw new AzError('ResourceNotFound', `The Key Vault scope '${scope}' was not found or is not a vault-level scope.`)
  const roleInfo = role === undefined ? null : roleFrom(role)
  return vault.roleAssignments.filter((assignment) => (!roleInfo || same(assignment.roleDefinitionId, roleInfo.roleDefinitionId)) && (principalId === undefined || same(assignment.principalId, principalId))).slice()
}

export function deleteRoleAssignment(sb, { scope, role, principalId }) {
  const vault = sb.keyVaults.find((item) => exactScope(item, scope))
  if (!vault) throw new AzError('ResourceNotFound', `The Key Vault scope '${scope}' was not found or is not a vault-level scope.`)
  const roleInfo = roleFrom(role)
  const assignment = vault.roleAssignments.find((item) => same(item.principalId, principalId) && same(item.roleDefinitionId, roleInfo.roleDefinitionId))
  if (!assignment) throw new AzError('RoleAssignmentNotFound', 'The requested role assignment was not found.')
  const next = cloneSandbox(sb)
  const storedVault = next.keyVaults.find((item) => exactScope(item, scope))
  storedVault.roleAssignments = storedVault.roleAssignments.filter((item) => item.id !== assignment.id)
  return { sandbox: next, resource: assignment, vault }
}

function resolveSecret(sb, { vaultName, name, version, id }, authorize) {
  if (id !== undefined) {
    if (vaultName !== undefined || name !== undefined || version !== undefined) throw new AzError('InvalidArgumentValue', '--id cannot be combined with --vault-name, --name or --version.', { kind: 'cli' })
    const selected = resolveSecretId(id)
    vaultName = selected.vaultName
    name = selected.name
    version = selected.version
  }
  const vault = getKeyVault(sb, vaultName)
  authorize(vault)
  const secret = secretFor(vault, name)
  const selectedVersion = version === undefined ? secret.versions.at(-1) : secret.versions.find((item) => same(item.version, version))
  if (!selectedVersion) throw new AzError('SecretNotFound', `Secret version '${version}' was not found for '${secret.name}'.`)
  return { vault, secret, version: selectedVersion }
}

export function setSecret(sb, { vaultName, name, value, contentType = null, tags = null, disabled = false }) {
  const vault = getKeyVault(sb, vaultName)
  requireOfficer(vault)
  requireSecretName(name)
  if (typeof value !== 'string') throw new AzError('InvalidArgumentValue', 'argument --value: expected one argument', { kind: 'cli' })
  if (contentType !== null && typeof contentType !== 'string') throw new AzError('InvalidArgumentValue', '--content-type must be a string.', { kind: 'cli' })
  const next = cloneSandbox(sb)
  const storedVault = findVault(next, vault.resourceGroup, vault.name)
  let secret = storedVault.secrets.find((item) => same(item.name, name))
  if (!secret) {
    secret = { name, versions: [] }
    storedVault.secrets.push(secret)
  }
  const timestamp = nowIso()
  const resource = { version: versionId(storedVault), value, enabled: !disabled, contentType, tags, createdAt: timestamp, updatedAt: timestamp }
  secret.versions.push(resource)
  return { sandbox: next, resource, secret, vault: storedVault }
}

export function showSecret(sb, values) {
  const resolved = resolveSecret(sb, values, requireRead)
  if (!resolved.version.enabled) throw new AzError('SecretDisabled', `Secret '${resolved.secret.name}' version '${resolved.version.version}' is disabled.`)
  return resolved
}

export function listSecrets(sb, { vaultName }) {
  const vault = getKeyVault(sb, vaultName)
  requireRead(vault)
  return { vault, secrets: vault.secrets.slice() }
}

export function listSecretVersions(sb, { vaultName, name }) {
  const vault = getKeyVault(sb, vaultName)
  requireRead(vault)
  return { vault, secret: secretFor(vault, name) }
}

export function updateSecretAttributes(sb, values) {
  const resolved = resolveSecret(sb, values, requireOfficer)
  const next = cloneSandbox(sb)
  const vault = findVault(next, resolved.vault.resourceGroup, resolved.vault.name)
  const secret = secretFor(vault, resolved.secret.name)
  const version = secret.versions.find((item) => item.version === resolved.version.version)
  if (values.enabled !== undefined) version.enabled = values.enabled
  if (values.contentType !== undefined) version.contentType = values.contentType
  if (values.tags !== undefined) version.tags = values.tags
  version.updatedAt = nowIso()
  return { sandbox: next, resource: version, secret, vault }
}
