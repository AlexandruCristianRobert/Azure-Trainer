import { describe, it, expect } from 'vitest'
import { createSandbox, isSandboxShape, normalizeSandbox, SUBSCRIPTION_ID, USER_OBJECT_ID } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import * as keyvault from '../src/lib/sandbox/keyvault.js'

const securityPath = '../src/lib/security/identity.js'
const configPath = '../src/lib/sandbox/appconfiguration.js'
const security = await import(/* @vite-ignore */ securityPath).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}
  throw error
})
const config = await import(/* @vite-ignore */ configPath).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}
  throw error
})
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-messaging/providers`
const appId = `${root}/Microsoft.Web/sites/func-orders`
const vaultUrl = 'https://kv-orders.vault.azure.net/'
const vaultScope = `${root}/Microsoft.KeyVault/vaults/kv-orders`
const storeScope = `${root}/Microsoft.AppConfiguration/configurationStores/ac-orders`
function cli(sandbox, line) {
  const result = runLine(sandbox, line)
  expect(result.lines.filter(item => item.kind === 'err'), line).toEqual([])
  return result.sandbox
}
function fixture() {
  let sb = createSandbox()
  for (const line of [
    'az group create -n rg-messaging -l westeurope',
    'az storage account create -g rg-messaging -n stmessagingorders',
    'az functionapp create -g rg-messaging -n func-orders --storage-account stmessagingorders --flexconsumption-location westeurope --runtime python --runtime-version 3.12',
    'az identity create -g rg-messaging -n id-orders',
    'az identity create -g rg-messaging -n id-other',
    'az keyvault create -g rg-messaging -n kv-orders',
    'az keyvault create -g rg-messaging -n kv-other',
    `az role assignment create --scope ${vaultScope} --role "Key Vault Secrets Officer" --assignee-object-id ${USER_OBJECT_ID}`,
    'az keyvault secret set --vault-name kv-orders --name notification-api-key --value demo-key-v1',
    `az role assignment create --scope ${root}/Microsoft.KeyVault/vaults/kv-other --role "Key Vault Secrets Officer" --assignee-object-id ${USER_OBJECT_ID}`,
    'az keyvault secret set --vault-name kv-other --name notification-api-key --value demo-other-key',
  ]) sb = cli(sb, line)
  return sb
}
function attached(sb) {
  return cli(sb, `az functionapp identity assign -g rg-messaging -n func-orders --identities ${sb.managedIdentities[0].id}`)
}
function authorized(sb, scope = vaultScope, role = 'Key Vault Secrets User') {
  const principalId = sb.managedIdentities[0].principalId
  const result = runLine(sb, `az role assignment create --scope ${scope} --role "${role}" --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal`)
  expect(result.lines.filter(item => item.kind === 'err')).toEqual([])
  expect(JSON.parse(result.lines.filter(item => item.kind === 'out').map(item => item.text).join('\n'))).toMatchObject({ principalId, principalType: 'ServicePrincipal' })
  return result.sandbox
}

describe('scoped Security resource foundation', () => {
  // Break: treating learner provisioning permission as application credentials.
  it('denies application secret reads until its attached principal has the exact vault role', () => {
    expect(typeof security.resolveRuntimePrincipal).toBe('function')
    expect(typeof keyvault.readSecretAsPrincipal).toBe('function')
    let sb = attached(fixture())
    const principal = security.resolveRuntimePrincipal(sb, { appId })
    expect(principal.principalId).toBe(sb.managedIdentities[0].principalId)
    expect(() => keyvault.readSecretAsPrincipal(sb, { vaultUrl, name: 'notification-api-key' }, principal)).toThrow()
    sb = authorized(sb)
    expect(keyvault.readSecretAsPrincipal(sb, { vaultUrl, name: 'notification-api-key' }, principal)).toMatchObject({ value: 'demo-key-v1', name: 'notification-api-key' })
    expect(() => keyvault.readSecretAsPrincipal(sb, { vaultUrl: 'https://kv-other.vault.azure.net/', name: 'notification-api-key' }, principal)).toThrow()
    expect(isSandboxShape(sb)).toBe(true)
    const learnerRole = keyvault.createRoleAssignment(sb, { scope: `${root}/Microsoft.KeyVault/vaults/kv-other`,
      role: 'Key Vault Secrets User', principalId: USER_OBJECT_ID.toUpperCase() })
    expect(learnerRole.resource.principalId).toBe(USER_OBJECT_ID)
    expect(isSandboxShape(learnerRole.sandbox)).toBe(true)
  })
  // Break: selecting by principal ID, accepting an unattached identity, or using a removed attachment.
  it('selects only attached client IDs and rejects stale runtime principals after detach', () => {
    expect(typeof security.resolveRuntimePrincipal).toBe('function')
    let sb = fixture()
    expect(() => security.resolveRuntimePrincipal(sb, { appId })).toThrow()
    sb = authorized(attached(sb))
    const [identity, other] = sb.managedIdentities
    expect(() => security.resolveRuntimePrincipal(sb, { appId }, { managed_identity_client_id: other.clientId })).toThrow()
    expect(() => security.resolveRuntimePrincipal(sb, { appId }, { managed_identity_client_id: identity.principalId })).toThrow()
    const principal = security.resolveRuntimePrincipal(sb, { appId }, { managed_identity_client_id: identity.clientId })
    sb = cli(sb, `az functionapp identity assign -g rg-messaging -n func-orders --identities ${other.id}`)
    expect(() => security.resolveRuntimePrincipal(sb, { appId })).toThrow()
    sb = cli(sb, `az functionapp identity remove -g rg-messaging -n func-orders --identities ${identity.id}`)
    expect(() => keyvault.readSecretAsPrincipal(sb, { vaultUrl, name: 'notification-api-key' }, principal)).toThrow()
    sb = cli(sb, 'az functionapp identity show -g rg-messaging -n func-orders')
    expect(isSandboxShape(sb)).toBe(true)
    const invalidAttachment = structuredClone(sb); invalidAttachment.functionApps[0].userAssignedIdentityIds = null
    expect(isSandboxShape(invalidAttachment)).toBe(false)
  })
  // Break: latest/pinned reads selecting the wrong secret version or allowing a disabled version.
  it('returns actual latest and pinned versions while preserving learner CLI reads', () => {
    expect(typeof keyvault.readSecretAsPrincipal).toBe('function')
    let sb = authorized(attached(fixture()))
    const principal = security.resolveRuntimePrincipal(sb, { appId })
    const v1 = keyvault.readSecretAsPrincipal(sb, { vaultUrl, name: 'notification-api-key' }, principal)
    sb = cli(sb, 'az keyvault secret set --vault-name kv-orders --name notification-api-key --value demo-key-v2')
    expect(keyvault.readSecretAsPrincipal(sb, { vaultUrl, name: 'notification-api-key' }, principal).value).toBe('demo-key-v2')
    expect(keyvault.readSecretAsPrincipal(sb, { vaultUrl, name: 'notification-api-key', version: v1.version }, principal).value).toBe('demo-key-v1')
    expect(keyvault.showSecret(sb, { vaultName: 'kv-orders', name: 'notification-api-key' }).version.value).toBe('demo-key-v2')
    sb = keyvault.updateSecretAttributes(sb, { vaultName: 'kv-orders', name: 'notification-api-key', version: v1.version, enabled: false }).sandbox
    expect(() => keyvault.readSecretAsPrincipal(sb, { vaultUrl, name: 'notification-api-key', version: v1.version }, principal)).toThrow()
  })
  // Break: confusing label/key case, copying a referenced secret, or letting learner access authorize runtime reads.
  it('isolates labeled settings and stores references with exact store runtime authorization', () => {
    expect(typeof config.listAppConfigurationValues).toBe('function')
    let sb = authorized(attached(fixture()))
    for (const line of [
      'az appconfig create -g rg-messaging -n ac-orders -l westeurope --sku Free',
      'az appconfig kv set -n ac-orders --key Orders:Channel --label production --value email --yes',
      'az appconfig kv set -n ac-orders --key Orders:Channel --label development --value console --yes',
      'az appconfig kv set -n ac-orders --key Orders:Channel --value none --yes',
      'az appconfig kv set -n ac-orders --key orders:channel --label production --value lower --yes',
      'az appconfig kv set-keyvault -n ac-orders --key Orders:ApiKey --label production --secret-identifier https://kv-orders.vault.azure.net/secrets/notification-api-key --yes',
      'az appconfig show -g rg-messaging -n ac-orders',
      'az appconfig kv show -n ac-orders --key Orders:Channel --label production',
      'az appconfig kv list -n ac-orders --label production',
    ]) sb = cli(sb, line)
    const options = { resourceGroup: 'rg-messaging', name: 'ac-orders', label: 'production' }
    const settings = config.listAppConfigurationValues(sb, options)
    expect(settings.find(item => item.key === 'Orders:Channel').value).toBe('email')
    expect(config.listAppConfigurationValues(sb, { ...options, label: 'Production' })).toEqual([])
    expect(config.listAppConfigurationValues(sb, { resourceGroup: 'rg-messaging', name: 'ac-orders' }).find(item => item.key === 'Orders:Channel').value).toBe('none')
    const reference = settings.find(item => item.key === 'Orders:ApiKey')
    expect(reference.contentType).toBe('application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8')
    expect(JSON.parse(reference.value)).toEqual({ uri: 'https://kv-orders.vault.azure.net/secrets/notification-api-key' })
    expect(reference.value).not.toContain('demo-key')
    const principal = security.resolveRuntimePrincipal(sb, { appId })
    expect(() => config.readAppConfigurationAsPrincipal(sb, options, principal)).toThrow()
    sb = authorized(sb, storeScope, 'App Configuration Data Reader')
    expect(config.readAppConfigurationAsPrincipal(sb, { ...options, key: 'Orders:Channel' }, principal).value).toBe('email')
    sb = cli(sb, 'az appconfig create -g rg-messaging -n ac-other --sku Free')
    expect(() => config.readAppConfigurationAsPrincipal(sb, { ...options, name: 'ac-other' }, principal)).toThrow()
    const invalidScope = runLine(sb, `az role assignment create --scope ${storeScope}/keyValues/Orders:Channel --role "App Configuration Data Reader" --assignee-object-id ${principal.principalId}`)
    expect(invalidScope.lines.some(item => item.kind === 'err')).toBe(true)
    expect(invalidScope.sandbox).toEqual(sb)
    expect(isSandboxShape(sb)).toBe(true)
  })
  // Break: resetting revisions, accepting oversized values/store counts, or losing old-save compatibility.
  it('bounds configuration state with monotonically increasing revisions and old-save normalization', () => {
    expect(typeof config.createAppConfiguration).toBe('function')
    const old = fixture(); delete old.appConfigurationStores
    expect(isSandboxShape(old)).toBe(true)
    expect(normalizeSandbox(old).appConfigurationStores).toEqual([])
    expect(isSandboxShape({ ...old, appConfigurationStores: null })).toBe(false)
    expect(isSandboxShape({ ...old, appConfigurationStores: [{ name: 42 }] })).toBe(false)
    let sb = config.createAppConfiguration(old, { resourceGroup: 'rg-messaging', name: 'ac-orders', sku: 'Free' }).sandbox
    sb = config.setAppConfigurationValue(sb, { name: 'ac-orders', key: 'Orders:Channel', label: 'production', value: 'email' }).sandbox
    const first = config.listAppConfigurationValues(sb, { name: 'ac-orders', label: 'production' })[0].revision
    sb = config.setAppConfigurationValue(sb, { name: 'ac-orders', key: 'Orders:Channel', label: 'production', value: 'console' }).sandbox
    expect(config.listAppConfigurationValues(sb, { name: 'ac-orders', label: 'production' })[0].revision).toBeGreaterThan(first)
    expect(() => config.setAppConfigurationValue(sb, { name: 'ac-orders', key: 'oversized', value: 'x'.repeat(16385) })).toThrow()
    for (let index = 1; index < 50; index++) sb = config.setAppConfigurationValue(sb, { name: 'ac-orders', key: `k${index}`, value: 'bounded' }).sandbox
    expect(() => config.setAppConfigurationValue(sb, { name: 'ac-orders', key: 'overflow', value: 'bounded' })).toThrow()
    const invalid = structuredClone(sb); invalid.appConfigurationStores[0].settings[0].revision = Infinity
    expect(isSandboxShape(invalid)).toBe(false)
    const malformedRole = structuredClone(sb); malformedRole.appConfigurationStores[0].roleAssignments = [null]
    expect(isSandboxShape(malformedRole)).toBe(false)
    const malformedLocation = structuredClone(sb); malformedLocation.appConfigurationStores[0].location = null
    expect(isSandboxShape(malformedLocation)).toBe(false)
  })
  // Break: retaining Function attachments or nested vault/store assignments after identity/group deletion.
  it.each(['identity', 'group'])('cleans cross-group attachments and nested roles on %s deletion', kind => {
    expect(typeof security.resolveRuntimePrincipal).toBe('function')
    let sb = fixture()
    sb = cli(sb, 'az group create -n rg-identity -l westeurope')
    sb = cli(sb, 'az identity create -g rg-identity -n id-external')
    const identity = sb.managedIdentities.at(-1)
    sb = cli(sb, `az functionapp identity assign -g rg-messaging -n func-orders --identities ${identity.id}`)
    sb = cli(sb, `az role assignment create --scope ${vaultScope} --role "Key Vault Secrets User" --assignee-object-id ${identity.principalId}`)
    sb = cli(sb, 'az appconfig create -g rg-messaging -n ac-orders --sku Free')
    sb = cli(sb, `az role assignment create --scope ${storeScope} --role "App Configuration Data Reader" --assignee-object-id ${identity.principalId}`)
    sb = cli(sb, kind === 'identity' ? 'az identity delete -g rg-identity -n id-external --yes' : 'az group delete -n rg-identity --yes')
    expect(() => security.resolveRuntimePrincipal(sb, { appId })).toThrow()
    expect(sb.keyVaults[0].roleAssignments.some(item => item.principalId === identity.principalId)).toBe(false)
    expect(sb.appConfigurationStores[0].roleAssignments).toEqual([])
    expect(isSandboxShape(sb)).toBe(true)
    sb = cli(sb, 'az group delete -n rg-messaging --yes')
    expect(sb.appConfigurationStores).toEqual([])
  })
})
