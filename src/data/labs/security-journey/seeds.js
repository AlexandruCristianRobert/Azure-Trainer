import { createSandbox, SUBSCRIPTION_ID, USER_OBJECT_ID } from '../../../lib/sandbox/model.js'
import { createResourceGroup } from '../../../lib/sandbox/ops.js'
import { createIdentity } from '../../../lib/sandbox/identity.js'
import { createStorageAccount, createFunctionApp, assignFunctionAppIdentity } from '../../../lib/sandbox/functions.js'
import { createKeyVault, createRoleAssignment, setSecret } from '../../../lib/sandbox/keyvault.js'
import { createAppConfiguration, createAppConfigurationRoleAssignment, setAppConfigurationValue } from '../../../lib/sandbox/appconfiguration.js'
import { OLD_SECRET_VERSION } from '../../templates/security-python/security.js'

export const SECURITY_GROUP = 'rg-messaging'
export const SECURITY_ROOT = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${SECURITY_GROUP}/providers`
export const SECURITY_APP_ID = `${SECURITY_ROOT}/Microsoft.Web/sites/func-orders`
export const SECURITY_VAULT_ID = `${SECURITY_ROOT}/Microsoft.KeyVault/vaults/kv-orders`
export const SECURITY_STORE_ID = `${SECURITY_ROOT}/Microsoft.AppConfiguration/configurationStores/ac-orders`
const identitySandbox = createResourceGroup(createSandbox(), { name: SECURITY_GROUP, location: 'westeurope' }).sandbox
export const SECURITY_IDENTITY = Object.freeze(createIdentity(identitySandbox, { resourceGroup: SECURITY_GROUP, name: 'id-orders' }).resource)
const DEMO_KEYS = ['trainer-demo-key-v1', 'trainer-demo-key-v2', 'trainer-demo-key-v3']
export function securityInput(stage) {
  const input = { appId: SECURITY_APP_ID, notificationProvider: { id: 'notification-demo', acceptedKeys: [{ id: 'key-v1', value: DEMO_KEYS[0] }] },
    operations: [{ operationId: 'notify-o1', eventId: 'e-o1', orderId: 'o1' }] }
  if (stage === 'rotation') input.refreshFixture = [{ advanceMs: 0, acceptedKeys: [{ id: 'key-v2', value: DEMO_KEYS[1] }] }]
  if (stage === 'refresh') input.refreshFixture = [
    { advanceMs: 60000, settings: [{ name: 'ac-orders', key: 'Orders:Channel', label: 'production', value: 'sms' },
      { name: 'ac-orders', key: 'Orders:Sentinel', label: 'production', value: '2' }],
    secrets: [{ vaultName: 'kv-orders', name: 'notification-api-key', value: DEMO_KEYS[1] }], acceptedKeys: [{ id: 'key-v2', value: DEMO_KEYS[1] }] },
    { advanceMs: 60000, secrets: [{ vaultName: 'kv-orders', name: 'notification-api-key', value: DEMO_KEYS[2] }], acceptedKeys: [{ id: 'key-v3', value: DEMO_KEYS[2] }] },
  ]
  return input
}

/** Actual helper-created resources only; no records, hosts, effects or evidence. */
export function seedSecurityStage(run, stage) {
  if (!['identity', 'secrets', 'rotation', 'configuration', 'refresh'].includes(stage)) throw new Error(`Unknown security fixture: ${stage}`)
  let sandbox = createResourceGroup(run.sandbox, { name: SECURITY_GROUP, location: 'westeurope' }).sandbox
  sandbox = createStorageAccount(sandbox, { resourceGroup: SECURITY_GROUP, name: 'stmessagingorders' }).sandbox
  sandbox = createFunctionApp(sandbox, { resourceGroup: SECURITY_GROUP, name: 'func-orders', storageAccount: 'stmessagingorders', flexconsumptionLocation: 'westeurope', runtime: 'python', runtimeVersion: '3.12' }).sandbox
  sandbox = createIdentity(sandbox, { resourceGroup: SECURITY_GROUP, name: 'id-orders' }).sandbox
  sandbox = createKeyVault(sandbox, { resourceGroup: SECURITY_GROUP, name: 'kv-orders' }).sandbox
  sandbox = createRoleAssignment(sandbox, { scope: SECURITY_VAULT_ID, role: 'Key Vault Secrets Officer', principalId: USER_OBJECT_ID }).sandbox
  sandbox = setSecret(sandbox, { vaultName: 'kv-orders', name: 'notification-api-key', value: DEMO_KEYS[0] }).sandbox
  // Fixed, explicitly disclosed old-version metadata makes the pinned exercise copyable.
  sandbox.keyVaults.find(vault => vault.name === 'kv-orders').secrets[0].versions[0].version = OLD_SECRET_VERSION
  if (stage !== 'identity') {
    sandbox = assignFunctionAppIdentity(sandbox, { resourceGroup: SECURITY_GROUP, name: 'func-orders', identities: [SECURITY_IDENTITY.id] }).sandbox
    sandbox = createRoleAssignment(sandbox, { scope: SECURITY_VAULT_ID, role: 'Key Vault Secrets User', principalId: SECURITY_IDENTITY.principalId, principalType: 'ServicePrincipal' }).sandbox
  }
  if (['configuration', 'refresh'].includes(stage)) {
    sandbox = createAppConfiguration(sandbox, { resourceGroup: SECURITY_GROUP, name: 'ac-orders' }).sandbox
    sandbox = createAppConfigurationRoleAssignment(sandbox, { scope: SECURITY_STORE_ID, role: 'App Configuration Data Reader', principalId: SECURITY_IDENTITY.principalId }).sandbox
    for (const label of ['production', 'development']) {
      sandbox = setAppConfigurationValue(sandbox, { name: 'ac-orders', key: 'Orders:ApiKey', label, secretIdentifier: 'https://kv-orders.vault.azure.net/secrets/notification-api-key' }).sandbox
      sandbox = setAppConfigurationValue(sandbox, { name: 'ac-orders', key: 'Orders:Channel', label, value: label === 'development' ? 'console' : stage === 'configuration' ? 'console' : 'email' }).sandbox
    }
    sandbox = setAppConfigurationValue(sandbox, { name: 'ac-orders', key: 'Orders:Sentinel', label: 'production', value: '1' }).sandbox
  }
  return { sandbox, artifacts: run.artifacts, runtime: run.runtime, nextSequence: run.nextSequence }
}
