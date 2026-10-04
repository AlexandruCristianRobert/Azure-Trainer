import { messagingDependencies } from '../../../lib/messaging/evidence.js'
import { securityResourceMetadata } from '../../../lib/security/evidence.js'
import { resolveRuntimePrincipal } from '../../../lib/security/identity.js'
import { readSecretAsPrincipal } from '../../../lib/sandbox/keyvault.js'
import { OLD_SECRET_VERSION, securityProjectFiles, securityReadme } from '../../templates/security-python/security.js'
import { SECURITY_APP_ID, SECURITY_IDENTITY, SECURITY_VAULT_ID, SECURITY_STORE_ID, seedSecurityStage, securityInput } from './seeds.js'

export const securityMetadata = Object.freeze({ engineVersion: 2, contentVersion: 1, journeyId: 'security-observability', skillAreaId: 'secure',
  service: 'key-vault', status: 'available', labMode: 'guided', manifestId: 'security-python-v1', capabilities: { messaging: true, securityObservability: true } })
export const file = (path, content) => ({ kind: 'file', path, content })
export const command = line => ({ kind: 'command', line })
export const securityPaths = ['worker.py', 'training_runtime.py', 'requirements.txt']
export const securityVault = sandbox => sandbox.keyVaults.find(vault => vault.resourceGroup === 'rg-messaging' && vault.name === 'kv-orders')
export const securityStore = sandbox => sandbox.appConfigurationStores.find(store => store.resourceGroup === 'rg-messaging' && store.name === 'ac-orders')
export function securitySelectors(stage) {
  const select = field => sandbox => {
    const values = securityResourceMetadata(sandbox)[field]
    return values.filter(row => field === 'identities' ? row.id === SECURITY_IDENTITY.id : row.resourceGroup === 'rg-messaging' && row.name === ({ apps: 'func-orders', vaults: 'kv-orders', stores: 'ac-orders' })[field])
  }
  const input = securityInput(stage)
  return { identity: select('identities'), application: select('apps'), vault: select('vaults'),
    ...(['configuration', 'refresh'].includes(stage) ? { store: select('stores') } : {}),
    provider: () => ({ id: input.notificationProvider.id, initialKeyIds: input.notificationProvider.acceptedKeys.map(key => key.id),
      changes: (input.refreshFixture ?? []).map(change => ({ advanceMs: change.advanceMs, keyIds: change.acceptedKeys?.map(key => key.id) ?? [] })) }),
  }
}
export function securityTask({ id, text, rationale, hints = [], solution, stage, paths = [], check = securityReady }) {
  return { id, text, rationale, hints, solution, check,
    ...(paths.length ? { verification: { scenarioId: `${id}-behavior`, scenarioVersion: 1 },
      dependencies: messagingDependencies({ files: paths, resources: securitySelectors(stage) }) } : {}),
  }
}
export function securityReady({ sandbox }) {
  try {
    const principal = resolveRuntimePrincipal(sandbox, { appId: SECURITY_APP_ID })
    return principal.identityId === SECURITY_IDENTITY.id && !!readSecretAsPrincipal(sandbox, { vaultUrl: 'https://kv-orders.vault.azure.net', name: 'notification-api-key' }, principal)
  } catch { return false }
}
export const securityRecords = measurement => measurement.securityObservability?.records ?? []
export const consumed = (measurement, keyId = 'key-v1', channel = 'email') => {
  const records = securityRecords(measurement)
  return records.some(row => row.kind === 'notification-provider' && row.providerId === 'notification-demo' && row.statusCode === 202
    && row.eventId === 'e-o1' && row.orderId === 'o1' && row.channel === channel && row.keyId === keyId
    && row.principalId === SECURITY_IDENTITY.principalId && row.invocation.kind === 'script' && row.invocation.operationId === 'notify-o1'
    && records.some(read => read.kind === 'secret-read' && read.id === row.readId && read.version === row.secretVersion
      && read.name === 'notification-api-key' && read.vaultUrl.toLowerCase().replace(/\/$/, '') === 'https://kv-orders.vault.azure.net'
      && read.principalId === row.principalId && read.keyIds.includes(keyId)))
}
export const selectedConsumption = (measurement, channel = 'email') => {
  const records = securityRecords(measurement)
  return consumed(measurement, 'key-v1', channel) && records.some(row => row.kind === 'notification-provider' && row.statusCode === 202
    && row.configKey === 'Orders:Channel' && row.configLabel === 'production' && row.channel === channel
    && records.some(load => load.kind === 'config-load' && load.storeId === SECURITY_STORE_ID && load.providerId === row.configProviderId
      && load.principalId === SECURITY_IDENTITY.principalId && load.selections.some(setting => setting.key === 'Orders:Channel' && setting.label === row.configLabel && setting.revision === row.configRevision))
    && records.some(read => read.kind === 'secret-read' && read.id === row.readId && read.configProviderId === row.configProviderId))
}
export const rotationConsumed = measurement => {
  const records = securityRecords(measurement), changeAt = records.findIndex(row => row.kind === 'fixture-advance' && row.step === 1 && row.secrets.length === 0 && row.providerKeyIds.length === 1 && row.providerKeyIds[0] === 'key-v2')
  const successAt = records.findIndex(row => row.kind === 'notification-provider' && row.statusCode === 202 && row.keyId === 'key-v2' && row.secretVersion !== OLD_SECRET_VERSION)
  const rejectedAt = records.findIndex(row => row.kind === 'notification-provider' && row.statusCode === 401 && row.secretVersion === OLD_SECRET_VERSION
    && records.some(read => read.id === row.readId && read.kind === 'secret-read' && read.version === OLD_SECRET_VERSION && read.keyIds.includes('key-v1')))
  return consumed(measurement, 'key-v2') && changeAt >= 0 && successAt > changeAt && rejectedAt > successAt
    && records.findIndex(row => row.kind === 'secret-read' && row.id === records[successAt].readId) > changeAt
}
export const rotationReady = context => {
  if (!securityReady(context)) return false
  const latest = securityVault(context.sandbox)?.secrets.find(secret => secret.name === 'notification-api-key')?.versions.at(-1)
  return latest?.enabled === true && latest.version !== OLD_SECRET_VERSION
}
export const latestRotationReady = context => rotationReady(context) &&
  securityRecords(context.runtime.messaging.executionReceipts.at(-1)?.measurements ?? {}).some(row => row.kind === 'notification-provider' && row.statusCode === 202
    && row.secretVersion === securityVault(context.sandbox).secrets.find(secret => secret.name === 'notification-api-key').versions.at(-1).version)
export const configurationReady = context => securityReady(context) && securityStore(context.sandbox)?.settings.some(setting => setting.key === 'Orders:Channel' && setting.label === 'production') === true
export const refreshConsumed = measurement => {
  const records = securityRecords(measurement), calls = records.filter(row => row.kind === 'notification-provider')
  if (calls.length !== 3 || !calls.every(row => row.statusCode === 202 && row.configKey === 'Orders:Channel' && row.configLabel === 'production'
    && row.configProviderId === calls[0].configProviderId && row.principalId === SECURITY_IDENTITY.principalId)) return false
  const [before, changed, independent] = calls
  const loads = records.filter(row => row.kind === 'config-load'), refreshes = records.filter(row => row.kind === 'config-refresh'), fixtures = records.filter(row => row.kind === 'fixture-advance')
  return loads.length === 1 && loads[0].providerId === before.configProviderId && loads[0].storeId === SECURITY_STORE_ID
    && loads[0].selections.every(setting => setting.label === 'production') && refreshes.length === 2 && fixtures.length === 2
    && refreshes.every(row => row.providerId === before.configProviderId && row.outcome === 'changed')
    && before.channel === 'email' && changed.channel === 'sms' && independent.channel === 'sms'
    && before.keyId === 'key-v1' && changed.keyId === 'key-v2' && independent.keyId === 'key-v3'
    && before.secretVersion !== changed.secretVersion && changed.secretVersion !== independent.secretVersion
    && changed.configRevision > before.configRevision && independent.configRevision === changed.configRevision
    && fixtures[0].timeMs - before.timeMs >= 60000 && fixtures[1].timeMs - fixtures[0].timeMs >= 60000
    && fixtures[0].settings.some(setting => setting.key === 'Orders:Sentinel' && setting.label === 'production') && fixtures[1].settings.length === 0
    && calls.every((call, index) => {
      const callAt = records.indexOf(call), readAt = records.findIndex(read => read.kind === 'secret-read' && read.id === call.readId
        && read.version === call.secretVersion && read.configProviderId === before.configProviderId && read.keyIds.includes(call.keyId))
      return readAt >= 0 && readAt < callAt && (index === 0 || records.indexOf(fixtures[index - 1]) > records.indexOf(calls[index - 1])
        && readAt > records.indexOf(fixtures[index - 1]) && records.indexOf(refreshes[index - 1]) > readAt && records.indexOf(refreshes[index - 1]) < callAt)
    }) && consumed(measurement)
}
export const securityExerciseTask = (task, check) => ({ taskId: task.id, ...task.verification, entry: 'worker.py', mode: 'script', check })
export function securityLab({ stage, order, title, brief, tasks, behavior, starter }) {
  const code = tasks.at(-1)
  return { ...securityMetadata, id: `security-${stage}`, title, journeyOrder: order, minutes: 20, brief,
    initialProjectFiles: securityProjectFiles(securityReadme(brief), starter), initializeSimulation: run => seedSecurityStage(run, stage), tasks,
    messagingInput: { securityObservability: securityInput(stage) },
    messagingExercise: { commands: [{ entry: 'worker.py', mode: 'script' }], tasks: [securityExerciseTask(code, behavior)] },
  }
}
export { SECURITY_IDENTITY, SECURITY_VAULT_ID, SECURITY_STORE_ID }
