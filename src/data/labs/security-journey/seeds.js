import { createSandbox, SUBSCRIPTION_ID, USER_OBJECT_ID } from '../../../lib/sandbox/model.js'
import { createResourceGroup, createNamespace, createQueue } from '../../../lib/sandbox/ops.js'
import { createEventGridTopic, createEventGridSubscription } from '../../../lib/sandbox/eventgrid.js'
import { applyServiceBusOperation } from '../../../lib/messaging/servicebus.js'
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
export const OBSERVABILITY_CARRIER = '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01'
export const OBSERVABILITY_TARGET = { resourceGroup: SECURITY_GROUP, namespace: 'sb-orders', queue: 'orders' }
export function observabilityInput(stage) {
  const input = securityInput('secrets')
  if (['spans', 'failure-query', 'metrics'].includes(stage)) input.refreshFixture = [{ advanceMs: 60000,
    secrets: [{ vaultName: 'kv-orders', name: 'notification-api-key', value: DEMO_KEYS[1] }],
    acceptedKeys: [{ id: 'key-v2', value: DEMO_KEYS[1] }] }]
  return input
}
/** Only actual resources and an active external queue input; no telemetry/proof. */
export function seedObservabilityStage(run, stage) {
  const seeded = seedSecurityStage(run, 'secrets')
  if (!['context', 'metrics'].includes(stage)) return seeded
  let sandbox = createNamespace(seeded.sandbox, { resourceGroup: SECURITY_GROUP, name: 'sb-orders', sku: 'Standard' }).sandbox
  sandbox = createQueue(sandbox, { resourceGroup: SECURITY_GROUP, namespace: 'sb-orders', name: 'orders', maxDeliveryCount: 3 }).sandbox
  if (stage === 'context') {
    sandbox = createEventGridTopic(sandbox, { resourceGroup: SECURITY_GROUP, name: 'evgt-orders', location: 'westeurope', inputSchema: 'EventGridSchema' }).sandbox
    sandbox = createEventGridSubscription(sandbox, { resourceGroup: SECURITY_GROUP, topicName: 'evgt-orders', name: 'order-notifications',
      endpointType: 'AzureFunction', endpoint: `${SECURITY_APP_ID}/functions/NotifyOrder`, includedEventTypes: ['Contoso.OrderProcessed'], subjectBeginsWith: '/orders/EU/' }).sandbox
  }
  const result = applyServiceBusOperation(seeded.runtime.messaging, sandbox, { kind: 'send', target: OBSERVABILITY_TARGET,
    message: { messageId: 'm1', body: JSON.stringify({ id: 'o1', region: 'EU', quantity: 2 }),
      properties: stage === 'context' ? { 'Diagnostic-Id': OBSERVABILITY_CARRIER } : {} } })
  if (result.diagnostics.length) throw new Error('Observability input fixture could not be prepared.')
  return { ...seeded, sandbox, runtime: { ...seeded.runtime, messaging: result.state } }
}
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
