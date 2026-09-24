import { SUBSCRIPTION_ID, TENANT_ID } from '../sandbox/model.js'
import { keyVaultId } from '../sandbox/keyvault.js'

function epoch(iso) { return Math.floor(new Date(iso).getTime() / 1000) }

function secretId(vault, secret, version) {
  return `https://${vault.name}.vault.azure.net/secrets/${secret.name}/${version.version}`
}

export function presentKeyVault(vault) {
  const sku = { family: 'A', name: vault.sku }
  return {
    id: keyVaultId(vault), location: vault.location, name: vault.name,
    properties: { enablePurgeProtection: vault.enablePurgeProtection, enableRbacAuthorization: vault.enableRbacAuthorization, enableSoftDelete: true, sku, softDeleteRetentionInDays: vault.softDeleteRetentionInDays, tenantId: TENANT_ID, vaultUri: `https://${vault.name}.vault.azure.net/` },
    resourceGroup: vault.resourceGroup, tags: vault.tags ?? {}, type: 'Microsoft.KeyVault/vaults',
  }
}

export function presentSecret(version, secret, vault, { includeValue = false } = {}) {
  const output = {
    attributes: { created: epoch(version.createdAt), enabled: version.enabled, updated: epoch(version.updatedAt) },
    contentType: version.contentType, id: secretId(vault, secret, version), kid: null, managed: null, name: secret.name, tags: version.tags ?? {},
  }
  if (includeValue) output.value = version.value
  return output
}

export function presentRoleAssignment(assignment) {
  return {
    id: `${assignment.scope}/providers/Microsoft.Authorization/roleAssignments/${assignment.id}`,
    name: assignment.id, principalId: assignment.principalId, principalType: assignment.principalType,
    roleDefinitionId: `/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.Authorization/roleDefinitions/${assignment.roleDefinitionId}`,
    roleDefinitionName: assignment.roleName, scope: assignment.scope, type: 'Microsoft.Authorization/roleAssignments',
  }
}
