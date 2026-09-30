import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as keyvault from '../../sandbox/keyvault.js'
import { presentKeyVault } from '../keyvault-arm.js'
import { secretGroup } from './keyvault-secret.js'

const NAME = ARG.name('Name of the Key Vault.')
const SKU = { name: '--sku', aliases: [], required: false, kind: 'string', choices: ['standard', 'premium'], dest: 'sku', help: 'Key Vault SKU.', defaultValue: 'standard' }
const RBAC = { name: '--enable-rbac-authorization', aliases: [], required: false, kind: 'bool', dest: 'enableRbacAuthorization', help: 'Enable Azure role-based access control authorization.' }
const PURGE = { name: '--enable-purge-protection', aliases: [], required: false, kind: 'bool', dest: 'enablePurgeProtection', help: 'Enable purge protection.' }
const RETENTION = { name: '--retention-days', aliases: [], required: false, kind: 'int', dest: 'softDeleteRetentionInDays', help: 'Soft-delete retention period in days (7-90).', defaultValue: 90 }
const RESOURCE_TYPE = { name: '--resource-type', aliases: [], required: false, kind: 'string', choices: ['vault'], dest: 'resourceType', help: 'Filter results to vault resources.' }
const vaultEvent = (type, vault) => event(type, 'keyVault', { name: vault.name, resourceGroup: vault.resourceGroup })

export const keyvaultGroup = defineGroup(['keyvault'], 'Manage Key Vault resources.', {
  create: defineCommand(['keyvault', 'create'], 'Create a Key Vault.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.location(false), SKU, RBAC, PURGE, RETENTION, ARG.tags],
    run: ({ sandbox }, values) => {
      let existed = false
      try { existed = !!keyvault.getKeyVault(sandbox, values.resourceGroup, values.name) } catch { /* operation returns the authoritative validation error */ }
      const { sandbox: next, resource } = keyvault.createKeyVault(sandbox, values)
      return { sandbox: next, output: presentKeyVault(resource), events: [vaultEvent(existed ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['keyvault', 'show'], 'Show a Key Vault.', {
    args: [NAME, ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: presentKeyVault(keyvault.getKeyVault(sandbox, values.resourceGroup ?? undefined, values.name)) }),
  }),
  list: defineCommand(['keyvault', 'list'], 'List Key Vaults.', {
    args: [ARG.resourceGroupOptional, RESOURCE_TYPE],
    run: ({ sandbox }, values) => ({ sandbox, output: keyvault.listKeyVaults(sandbox, values.resourceGroup ?? null).map(presentKeyVault) }),
  }),
  update: defineCommand(['keyvault', 'update'], 'Update Key Vault protection settings.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroupOptional, RBAC, PURGE],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource } = keyvault.updateKeyVault(sandbox, values)
      return { sandbox: next, output: presentKeyVault(resource), events: [vaultEvent('updated', resource)] }
    },
  }),
  secret: secretGroup,
})
