import { describe, it, expect } from 'vitest'
import { createSandbox, SUBSCRIPTION_ID, USER_OBJECT_ID } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { parseMessagingProject } from '../src/lib/messaging/python.js'
import { executeMessagingProgram } from '../src/lib/messaging/vm.js'
import { emptyMessagingState } from '../src/lib/messaging/state.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { messagingDependencies } from '../src/lib/messaging/evidence.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { createEventGridTopic, createEventGridSubscription } from '../src/lib/sandbox/eventgrid.js'
import { applyEventGridOperation } from '../src/lib/messaging/eventgrid.js'
import { validSecurityJournal, validSecurityLabContext, securityResourceMetadata } from '../src/lib/security/evidence.js'
import { messagingMeasurements } from '../src/lib/messaging/evidence.js'

const runtimePath = '../src/data/templates/security-python/runtime.js'
const runtime = await import(/* @vite-ignore */ runtimePath).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}
  throw error
})
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-security/providers`
const appId = `${root}/Microsoft.Web/sites/func-orders`
const source = `from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from training_runtime import send_notification
def main():
    credential = DefaultAzureCredential()
    client = SecretClient(vault_url="https://kv-orders.vault.azure.net", credential=credential)
    secret = client.get_secret("notification-api-key")
    return send_notification("e-o1", "o1", secret.value, "email")
`
function fixture() {
  let sb = createSandbox()
  const lines = [
    'az group create -n rg-security -l westeurope',
    'az storage account create -g rg-security -n stsecurityorders',
    'az functionapp create -g rg-security -n func-orders --storage-account stsecurityorders --flexconsumption-location westeurope --runtime python --runtime-version 3.12',
    'az identity create -g rg-security -n id-orders',
    'az keyvault create -g rg-security -n kv-orders',
    `az role assignment create --scope ${root}/Microsoft.KeyVault/vaults/kv-orders --role "Key Vault Secrets Officer" --assignee-object-id ${USER_OBJECT_ID}`,
    'az keyvault secret set --vault-name kv-orders --name notification-api-key --value demo-key-v1',
    'az appconfig create -g rg-security -n ac-orders --sku Free',
    'az appconfig kv set -n ac-orders --key Orders:Channel --label production --value email --yes',
    'az appconfig kv set -n ac-orders --key Orders:Sentinel --label production --value 1 --yes',
    'az appconfig kv set-keyvault -n ac-orders --key Orders:ApiKey --label production --secret-identifier https://kv-orders.vault.azure.net/secrets/notification-api-key --yes',
  ]
  for (const line of lines) {
    const result = runLine(sb, line)
    expect(result.lines.filter(item => item.kind === 'err')).toEqual([])
    sb = result.sandbox
  }
  for (const line of [
    `az functionapp identity assign -g rg-security -n func-orders --identities ${sb.managedIdentities[0].id}`,
    `az role assignment create --scope ${root}/Microsoft.KeyVault/vaults/kv-orders --role "Key Vault Secrets User" --assignee-object-id ${sb.managedIdentities[0].principalId}`,
    `az role assignment create --scope ${root}/Microsoft.AppConfiguration/configurationStores/ac-orders --role "App Configuration Data Reader" --assignee-object-id ${sb.managedIdentities[0].principalId}`,
  ]) sb = runLine(sb, line).sandbox
  return sb
}
const config = () => ({ appId, notificationProvider: { id: 'notification-demo', acceptedKeys: [{ id: 'key-v1', value: 'demo-key-v1' }] },
  operations: [{ operationId: 'demo-o1', eventId: 'e-o1', orderId: 'o1' }] })
const projectFiles = code => ({ ...Object.fromEntries(['clients.py', 'producer.py', 'worker.py', 'events.py', 'handler.py', 'function_app.py', 'README.md'].map(path => [path, ''])),
  'host.json': '{"version":"2.0"}', 'local.settings.json': '{"IsEncrypted":false,"Values":{"FUNCTIONS_WORKER_RUNTIME":"python","AzureWebJobsStorage":"UseDevelopmentStorage=true"}}',
  ...(runtime.SECURITY_RUNTIME_FILES ?? {}), 'worker.py': code })
function run(code = source, options = {}) {
  const files = { ...(runtime.SECURITY_RUNTIME_FILES ?? {}), 'worker.py': code }
  const parsed = parseMessagingProject(files, { entry: 'worker.py', profile: options.profile ?? 'security-observability-v1', fixedFiles: runtime.SECURITY_RUNTIME_FILES ?? {} })
  if (parsed.diagnostics.length) return { diagnostics: parsed.diagnostics, state: options.state ?? emptyMessagingState(), output: [], value: null }
  return executeMessagingProgram({ program: parsed.program, sandbox: options.sandbox ?? fixture(), state: options.state ?? emptyMessagingState(),
    input: { securityObservability: options.config ?? config() } })
}
const cached = `from azure.identity import DefaultAzureCredential
from azure.appconfiguration.provider import load, SettingSelector, WatchKey
from training_runtime import send_notification, advance_security_fixture
credential = DefaultAzureCredential()
config = load(endpoint="https://ac-orders.azconfig.io", credential=credential,
    selects=[SettingSelector(key_filter="Orders:*", label_filter="production")],
    refresh_on=[WatchKey("Orders:Sentinel", label="production")], refresh_interval=30,
    keyvault_credential=credential, secret_refresh_interval=60)
def main():
    send_notification("e-o1", "o1", config["Orders:ApiKey"], config["Orders:Channel"])
    advance_security_fixture()
    config.refresh()
    return send_notification("e-o1", "o1", config["Orders:ApiKey"], config["Orders:Channel"])
`

describe('security SDK source execution', () => {
  it('keeps known demo credentials out of source-execution diagnostics', () => {
    const result = run(source.replace('return send_notification("e-o1", "o1", secret.value, "email")', 'return {}["demo-key-v1"]'))
    expect(result.diagnostics).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain('demo-key-v1')
  })
  it('requires successful records to match accepted read provenance and committed effects', () => {
    const sandbox = fixture(), input = config(), before = emptyMessagingState()
    const result = run(source, { sandbox, state: before })
    const measurements = messagingMeasurements(before, result.state, { ...result, sourcePaths: ['worker.py'] }, 'worker.py', 'script', result.diagnostics)
    const state = { ...result.state, executionReceipts: [{ mode: 'script', measurements }] }
    expect(validSecurityJournal(state)).toBe(true)
    expect(validSecurityLabContext(state, input, sandbox)).toBe(true)
    const missingEffect = structuredClone(state)
    missingEffect.effects = {}
    missingEffect.executionReceipts[0].measurements.effects = { before: {}, after: {} }
    expect(validSecurityJournal(missingEffect)).toBe(false)
    const rejectedKey = { ...input, notificationProvider: { ...input.notificationProvider, acceptedKeys: [{ id: 'other-key', value: 'demo-other-key' }] } }
    expect(validSecurityLabContext(state, rejectedKey, sandbox)).toBe(false)
    const laterSandbox = structuredClone(sandbox)
    laterSandbox.keyVaults[0].secrets[0].versions[0].enabled = false
    expect(validSecurityLabContext(state, input, laterSandbox)).toBe(true)
    laterSandbox.keyVaults = []
    expect(validSecurityLabContext(state, input, laterSandbox)).toBe(true)
    const wrongVersion = structuredClone(sandbox)
    wrongVersion.keyVaults[0].secrets[0].versions[0].value = 'demo-other-key'
    expect(validSecurityLabContext(state, input, wrongVersion)).toBe(false)
    const foreignRead = structuredClone(state)
    foreignRead.executionReceipts[0].measurements.securityObservability.startSequence = 2
    foreignRead.executionReceipts[0].measurements.securityObservability.records.shift()
    expect(validSecurityJournal(foreignRead)).toBe(false)
  })
  // Break: a ceremonial secret lookup or literal key authorizing the consumer.
  it('consumes actual secret provenance and rejects literal and retired provider keys', () => {
    const result = run()
    expect(result.diagnostics).toEqual([])
    expect(result.value).toEqual({ status_code: 202, channel: 'email' })
    expect(result.state.effects.notifications['e-o1']).toEqual({ eventId: 'e-o1', orderId: 'o1' })
    expect(result.state.securityObservability.records.at(-1)).toMatchObject({ kind: 'notification-provider', statusCode: 202 })
    const literal = run(source.replace('secret.value, "email"', '"demo-key-v1", "email"'))
    expect(literal.value?.status_code).toBe(401)
    expect(literal.state.effects.notifications).toBeUndefined()
    const retired = run(source, { config: { ...config(), notificationProvider: { id: 'notification-demo', acceptedKeys: [{ id: 'key-v2', value: 'demo-key-v2' }] } } })
    expect(retired.value?.status_code).toBe(401)
    expect(JSON.stringify(result.state.securityObservability)).not.toContain('demo-key-v1')
  })
  // Break: runtime credential selection falling back to the learner.
  it('denies an unattached runtime and gates the new imports from the legacy profile', () => {
    const sandbox = fixture(); sandbox.functionApps[0].userAssignedIdentityIds = []
    expect(run(source, { sandbox }).diagnostics.length).toBeGreaterThan(0)
    const legacy = run(source, { profile: 'messaging-v1' })
    expect(legacy.diagnostics[0]?.code).toBe('MESSAGING_UNSUPPORTED')
    expect(legacy.state.effects).toEqual({})
  })
  // Break: raw token values escaping through any public conversion boundary.
  it.each(['print(secret.value)', 'return secret.value', 'return {"value": secret.value}', 'raise ValueError(secret.value)', 'print(str(secret.value))', 'return json.dumps([secret.value])'])('rejects a secret leak through %s', expression => {
    const code = 'import json\n' + source.replace('return send_notification("e-o1", "o1", secret.value, "email")', expression)
    const result = run(code)
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(JSON.stringify(result)).not.toContain('demo-key-v1')
    expect(result.state.securityObservability.records.at(-1)).toMatchObject({ kind: 'privacy-violation' })
  })
  // Break: bypassing privacy through a literal copy of a known demo credential.
  it('rejects known raw credential text at public output boundaries', () => {
    const result = run(source.replace('return send_notification("e-o1", "o1", secret.value, "email")', 'print("credential=demo-key-v1")'))
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(JSON.stringify(result)).not.toContain('demo-key-v1')
    const sandbox = runLine(fixture(), 'az appconfig kv set -n ac-orders --key Orders:Channel --label production --value demo-key-v1 --yes').sandbox
    const configured = run(cached.slice(0, cached.indexOf('def main():')) + 'def main():\n    return config["Orders:Channel"]\n', { sandbox })
    expect(configured.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(JSON.stringify(configured)).not.toContain('demo-key-v1')
  })
  // Break: a recreated provider or hardcoded channel being counted as refreshed consumption.
  it('refreshes the same cache and consumes changed configuration and resolved secret provenance', () => {
    const authored = config()
    authored.refreshFixture = [{ advanceMs: 60000,
      settings: [{ name: 'ac-orders', key: 'Orders:Channel', label: 'production', value: 'sms' }, { name: 'ac-orders', key: 'Orders:Sentinel', label: 'production', value: '2' }],
      secrets: [{ vaultName: 'kv-orders', name: 'notification-api-key', value: 'demo-key-v2' }], acceptedKeys: [{ id: 'key-v2', value: 'demo-key-v2' }] }]
    const result = run(cached, { config: authored })
    expect(result.diagnostics).toEqual([])
    expect(result.value).toEqual({ status_code: 202, channel: 'sms' })
    const consumed = result.state.securityObservability.records.filter(row => row.kind === 'notification-provider')
    expect(consumed.map(row => row.channel)).toEqual(['email', 'sms'])
    expect(consumed[0].configProviderId).toBe(consumed[1].configProviderId)
    expect(consumed[0].secretVersion).not.toBe(consumed[1].secretVersion)
    expect(consumed[1].configRevision).toBeGreaterThan(consumed[0].configRevision)
    expect(JSON.stringify(result)).not.toContain('demo-key-v')
    const m = messagingMeasurements(emptyMessagingState(), result.state, { ...result, sourcePaths: ['worker.py'] }, 'worker.py', 'script', result.diagnostics)
    const journal = { ...result.state, executionReceipts: [{ mode: 'script', measurements: m }] }
    expect(validSecurityJournal(journal)).toBe(true)
    expect(validSecurityLabContext(journal, authored, fixture())).toBe(true)
    const retired = structuredClone(journal)
    for (const row of retired.executionReceipts[0].measurements.securityObservability.records) {
      if (row.kind === 'notification-provider' && row.keyId === 'key-v2') row.keyId = 'key-v1'
    }
    expect(validSecurityLabContext(retired, authored, fixture())).toBe(false)
    const hardcoded = run(cached.replaceAll('config["Orders:Channel"]', '"email"'), { config: authored })
    expect(hardcoded.state.securityObservability.records.filter(row => row.kind === 'notification-provider').every(row => row.configProviderId === null)).toBe(true)
  })
  // Break: refresh bypassing intervals or coupling secret rotation to a sentinel update.
  it('keeps early cache values, then refreshes a secret without a changed sentinel', () => {
    const authored = config()
    authored.refreshFixture = [{ advanceMs: 1000, secrets: [{ vaultName: 'kv-orders', name: 'notification-api-key', value: 'demo-key-v2' }], acceptedKeys: [{ id: 'key-v2', value: 'demo-key-v2' }] }, { advanceMs: 59000 }]
    const code = cached.replace('return send_notification(', 'send_notification(') + '    advance_security_fixture()\n    config.refresh()\n    return send_notification("e-o1", "o1", config["Orders:ApiKey"], config["Orders:Channel"])\n'
    const result = run(code, { config: authored })
    expect(result.diagnostics).toEqual([])
    expect(result.state.securityObservability.records.filter(row => row.kind === 'notification-provider').map(row => row.statusCode)).toEqual([202, 401, 202])
  })
  // Break: unsupported arguments reaching application effects before rejection.
  it('preflights keyword-only selectors and rejects caller-supplied fixture changes', () => {
    expect(run(cached.replace('SettingSelector(key_filter="Orders:*", label_filter="production")', 'SettingSelector("Orders:*")')).diagnostics[0]?.code).toBe('MESSAGING_UNSUPPORTED')
    expect(run(cached.replace('advance_security_fixture()', 'advance_security_fixture({"value":"wrong"})')).state.effects).toEqual({})
  })
  // Break: source/evidence restore accepting a fabricated operation or stale file revision.
  it('journals public source evidence and invalidates it after save and revert', () => {
    const files = projectFiles(source)
    const lab = { id: 'security-sdk-proof', engineVersion: 2, contentVersion: 1, capabilities: { messaging: true, securityObservability: true },
      manifestId: 'security-python-v1', initialProjectFiles: files, resourceSeed: fixture, messagingInput: { securityObservability: config() },
      tasks: [{ id: 'consume', check: () => true, verification: { scenarioId: 'consume', scenarioVersion: 1 }, dependencies: messagingDependencies({ files: Object.keys(files), resources: { security: securityResourceMetadata } }) }],
      messagingExercise: { commands: [{ entry: 'worker.py', mode: 'script' }], tasks: [{ taskId: 'consume', scenarioId: 'consume', scenarioVersion: 1, entry: 'worker.py', mode: 'script', check: m => m.securityObservability?.records.some(row => row.kind === 'notification-provider' && row.statusCode === 202) }] } }
    let current = createBehavioralRun(lab, { attemptId: 'security-sdk-proof' })
    current = applyRunAction(current, { type: 'command', line: 'python worker.py' }, lab).run
    expect(evaluateLab(lab, current).tasks[0].done).toBe(true)
    expect(JSON.stringify(current.evidence)).not.toContain('demo-key-v1')
    expect(deserializeRun(serializeRun(current, lab), lab).attemptId).toBe('security-sdk-proof')
    const deleted = applyRunAction(current, { type: 'command', line: 'az group delete --name rg-security --yes' }, lab).run
    expect(deleted.sandbox.keyVaults).toEqual([])
    const restoredDeletion = deserializeRun(serializeRun(deleted, lab), lab)
    expect(evaluateLab(lab, restoredDeletion).tasks[0].done).toBe(false)
    expect(restoredDeletion.runtime.messaging.securityObservability.records.at(-1).statusCode).toBe(202)
    const forged = structuredClone(current)
    forged.runtime.messaging.securityObservability.records.at(-1).statusCode = 401
    expect(() => deserializeRun(JSON.stringify(forged), lab)).toThrow()
    const unrelated = structuredClone(current)
    for (const row of [...unrelated.runtime.messaging.securityObservability.records,
      ...unrelated.runtime.messaging.executionReceipts.flatMap(receipt => receipt.measurements.securityObservability.records),
      ...Object.values(unrelated.evidence.experimentsById).flatMap(receipt => receipt.measurements.securityObservability.records)]) {
      if (row.kind === 'notification-provider') row.invocation.operationId = 'unauthored'
    }
    expect(() => deserializeRun(JSON.stringify(unrelated), lab)).toThrow()
    const rejectedLab = { ...lab, messagingInput: { securityObservability: { ...config(), notificationProvider: {
      id: 'notification-demo', acceptedKeys: [{ id: 'key-v2', value: 'demo-key-v2' }] } } } }
    const rejected = applyRunAction(createBehavioralRun(rejectedLab, { attemptId: 'rejected-proof' }), { type: 'command', line: 'python worker.py' }, rejectedLab).run
    expect(evaluateLab(rejectedLab, rejected).tasks[0].done).toBe(false)
    expect(rejected.runtime.messaging.effects).toEqual({})
    const rejectedClaim = structuredClone(rejected)
    for (const row of [...rejectedClaim.runtime.messaging.securityObservability.records,
      ...rejectedClaim.runtime.messaging.executionReceipts.flatMap(receipt => receipt.measurements.securityObservability.records),
      ...Object.values(rejectedClaim.evidence.experimentsById).flatMap(receipt => receipt.measurements.securityObservability.records)]) {
      if (row.kind === 'notification-provider') { row.statusCode = 202; row.keyId = 'key-v2' }
    }
    expect(() => deserializeRun(JSON.stringify(rejectedClaim), rejectedLab)).toThrow()
    for (const text of [source + '\n# changed\n', source]) {
      const saved = applyRunAction(current, { type: 'save-file', path: 'worker.py', text }, lab)
      expect(saved.diagnostics).toEqual([])
      current = saved.run
    }
    expect(evaluateLab(lab, current).tasks[0].done).toBe(false)
  })
  // Break: refresh failure clearing last-good values or secret tokens.
  it('retains last-good cache when a refreshed Key Vault reference cannot resolve', () => {
    const authored = config()
    authored.refreshFixture = [{ advanceMs: 60000, settings: [
      { name: 'ac-orders', key: 'Orders:ApiKey', label: 'production', secretIdentifier: 'https://kv-orders.vault.azure.net/secrets/absent' },
      { name: 'ac-orders', key: 'Orders:Sentinel', label: 'production', value: '2' },
    ] }]
    const result = run(cached, { config: authored })
    expect(result.diagnostics).toEqual([])
    expect(result.value?.status_code).toBe(202)
    expect(result.state.securityObservability.records.find(row => row.kind === 'config-refresh')?.outcome).toBe('failed')
  })
  // Break: a disabled newest secret silently falling back to an older enabled key.
  it('fails the newest disabled version instead of falling back', () => {
    let sandbox = fixture()
    sandbox = runLine(sandbox, 'az keyvault secret set --vault-name kv-orders --name notification-api-key --value demo-key-v2 --disabled true').sandbox
    const result = run(source, { sandbox })
    expect(result.diagnostics[0]?.code).toBe('SECURITY_AUTH')
    expect(result.state.effects.notifications).toBeUndefined()
  })
  // Break: persisted callback records without a completed broker outcome, or script-whitelist substitution.
  it('binds Functions to real deliveries and rolls back an aborted sibling atomically', () => {
    const code = `import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from training_runtime import send_notification
app = func.FunctionApp()
client = SecretClient("https://kv-orders.vault.azure.net", DefaultAzureCredential())
@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify(event: func.EventGridEvent):
    data = event.get_json()
    secret = client.get_secret("notification-api-key")
    send_notification(event.id, data["order_id"], secret.value, "email")
    if event.id == "e-o2":
        client.get_secret("missing")
`
    const lab = { id: 'security-callback', engineVersion: 2, contentVersion: 1, capabilities: { messaging: true, securityObservability: true }, manifestId: 'security-python-v1',
      initialProjectFiles: { ...projectFiles(source), 'function_app.py': code }, tasks: [],
      resourceSeed() {
        let sb = createEventGridTopic(fixture(), { resourceGroup: 'rg-security', name: 'evgt-orders' }).sandbox
        return createEventGridSubscription(sb, { resourceGroup: 'rg-security', topicName: 'evgt-orders', name: 'order-notifications', endpointType: 'AzureFunction', endpoint: `${appId}/functions/NotifyOrder` }).sandbox
      }, messagingInput: { functions: { appId }, securityObservability: config() },
      messagingExercise: { commands: [{ entry: 'function_app.py', mode: 'functions' }], tasks: [] },
      initializeSimulation(run) {
        const messaging = applyEventGridOperation(run.runtime.messaging, run.sandbox, { kind: 'publish', target: { resourceGroup: 'rg-security', topic: 'evgt-orders' },
          events: ['1', '2'].map(id => ({ id: `e-o${id}`, subject: `/orders/o${id}`, eventType: 'OrderCompleted', dataVersion: '1.0', data: { order_id: `o${id}` } })) }).state
        return { sandbox: run.sandbox, artifacts: run.artifacts, runtime: { ...run.runtime, messaging }, nextSequence: run.nextSequence }
      } }
    const initial = createBehavioralRun(lab, { attemptId: 'callback' })
    const result = applyRunAction(initial, { type: 'command', line: 'func start' }, lab)
    expect(result.diagnostics[0]?.code).toBe('SECURITY_AUTH')
    const state = result.run.runtime.messaging
    expect(Object.keys(state.effects.notifications)).toEqual(['e-o1'])
    const providerRows = state.securityObservability.records.filter(row => row.kind === 'notification-provider')
    expect(providerRows).toHaveLength(1)
    expect(providerRows[0].invocation).toMatchObject({ kind: 'eventgrid', attempt: 1 })
    expect(deserializeRun(serializeRun(result.run, lab), lab).attemptId).toBe('callback')
    const forged = structuredClone(result.run)
    for (const row of [...forged.runtime.messaging.securityObservability.records,
      ...forged.runtime.messaging.executionReceipts.flatMap(receipt => receipt.measurements.securityObservability.records)]) {
      if (row.kind === 'notification-provider') row.invocation.deliveryId = 'eg-delivery-999'
    }
    expect(() => deserializeRun(JSON.stringify(forged), lab)).toThrow()
  })
})
