import { messagingDependencies } from '../../../lib/messaging/evidence.js'
import { securityResourceMetadata } from '../../../lib/security/evidence.js'
import { resolveRuntimePrincipal } from '../../../lib/security/identity.js'
import { readSecretAsPrincipal } from '../../../lib/sandbox/keyvault.js'
import { OLD_SECRET_VERSION, securityProjectFiles, securityReadme } from '../../templates/security-python/security.js'
import { SECURITY_APP_ID, SECURITY_IDENTITY, SECURITY_VAULT_ID, SECURITY_STORE_ID, seedSecurityStage, securityInput } from './seeds.js'
import { seedObservabilityStage, observabilityInput, OBSERVABILITY_CARRIER } from './seeds.js'
import { observabilityProjectFiles } from '../../templates/security-python/telemetry.js'

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
    && loads[0].watchKeys.length === 1 && loads[0].watchKeys[0].key === 'Orders:Sentinel' && loads[0].watchKeys[0].label === 'production'
    && loads[0].refreshIntervalSeconds === 30 && loads[0].secretRefreshIntervalSeconds === 60
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

export const telemetryRows = measurement => measurement.securityObservability?.telemetry ?? []
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const linkedOperation = (m, span, name, record) => !!span && securityRecords(m).some(row => row.kind === 'telemetry-operation'
  && row.spanId === span.Id && row.operationId === span.OperationId && row.operation === name
  && (!record || row.recordIds.includes(record.id) && row.success === (record.statusCode === 202)))
const notification = (m, status = 202) => securityRecords(m).find(row => row.kind === 'notification-provider'
  && row.providerId === 'notification-demo' && row.eventId === 'e-o1' && row.orderId === 'o1' && row.channel === 'email'
  && row.principalId === SECURITY_IDENTITY.principalId && row.statusCode === status
  && securityRecords(m).some(read => read.kind === 'secret-read' && read.id === row.readId && read.version === row.secretVersion
    && read.name === 'notification-api-key' && read.principalId === row.principalId))
const spanFor = (m, record, name) => telemetryRows(m).find(row => row.Name === name && linkedOperation(m, row, 'send_notification', record))
const privacyClean = m => !securityRecords(m).some(row => row.kind === 'privacy-violation') && !m.diagnostics.length
export function setupObserved(m) {
  const call = notification(m), span = call && spanFor(m, call, 'NotifyOrder')
  return privacyClean(m) && !!span && span.Success === true && span.DurationMs === 19
    && linkedOperation(m, span, 'secretclient.get_secret') && consumed(m)
}
export function spansObserved(m) {
  const rejected = notification(m, 401), failed = rejected && spanFor(m, rejected, 'NotifyOrder')
  const accepted = notification(m), success = accepted && spanFor(m, accepted, 'NotifyOrder')
  return setupObserved(m) && !!failed && failed.Success === false && failed.ResultCode === 'ERROR' && failed.DurationMs === 12
    && success.Properties['app.order_id'] === 'o1' && failed.Properties['app.order_id'] === 'o1'
    && success.Properties['app.attempt'] === 1 && failed.Properties['app.attempt'] === 2
    && accepted.readId === rejected.readId && securityRecords(m).some(row => row.kind === 'fixture-advance')
    && telemetryRows(m).some(row => row.table === 'AppExceptions' && row.ParentId === failed.Id && row.OperationId === failed.OperationId)
}
export function loggingObserved(m) {
  const call = notification(m), span = call && spanFor(m, call, 'NotifyOrder')
  return setupObserved(m) && telemetryRows(m).some(row => row.table === 'AppTraces' && row.ParentId === span.Id
    && row.OperationId === span.OperationId && row.SeverityLevel === 1 && row.Message === 'Notification accepted'
    && row.Properties['app.order_id'] === call.orderId && row.Properties['app.channel'] === call.channel
    && row.Properties['app.status_code'] === call.statusCode)
}
export function contextObserved(m) {
  const rows = telemetryRows(m), process = rows.find(row => row.Name === 'ProcessOrder'), publish = rows.find(row => row.Name === 'PublishOrder')
  const call = notification(m), notify = call && spanFor(m, call, 'NotifyOrder'), bus = m.receipts.servicebus[0], delivery = m.receipts.eventgrid[0]
  if (!privacyClean(m) || !process || !publish || !notify || !bus || !delivery) return false
  const carrier = delivery.event.data.trace_context?.traceparent
  return bus.messageId === 'm1' && bus.status === 'completed' && bus.deliveryCount === 1 && bus.properties['Diagnostic-Id'] === OBSERVABILITY_CARRIER
    && process.table === 'AppRequests' && process.OperationId === OBSERVABILITY_CARRIER.split('-')[1] && process.ParentId === OBSERVABILITY_CARRIER.split('-')[2]
    && publish.ParentId === process.Id && publish.OperationId === process.OperationId
    && carrier === `00-${publish.OperationId}-${publish.Id}-01`
    && notify.table === 'AppRequests' && notify.OperationId === publish.OperationId && notify.ParentId === publish.Id
    && notify.Success && linkedOperation(m, process, 'perform_order_work') && linkedOperation(m, process, 'record_processed')
    && linkedOperation(m, publish, 'publisher.send') && linkedOperation(m, notify, 'secretclient.get_secret')
    && delivery.endpointType === 'AzureFunction' && delivery.status === 'delivered' && delivery.attempts === 1
    && delivery.event.id === 'e-o1' && delivery.event.data.order_id === 'o1'
    && call.invocation.kind === 'eventgrid' && call.invocation.deliveryId === delivery.id && call.invocation.eventRecordId === delivery.eventRecordId
    && call.invocation.attempt === 1 && m.effects.after.workByOrder?.o1 === 1 && m.effects.after.processed?.o1?.id === 'o1'
    && m.effects.after.notifications?.['e-o1']?.orderId === 'o1'
    && m.trace.some(row => row.kind === 'publish' && row.eventRecordId === delivery.eventRecordId && row.event.data.trace_context?.traceparent === carrier)
}
// Grade parsed expressions and actual result/row lineage, never Solution source text.
const unwrap = node => node?.kind === 'call' ? unwrap(node.arg) : node
const field = (node, name) => unwrap(node)?.kind === 'field' && unwrap(node).name === name
const property = (node, key) => unwrap(node)?.kind === 'property' && unwrap(node).key === key
const literal = (node, value) => node?.kind === 'literal' && node.value === value
const comparison = (node, match, op, value) => node?.kind === 'binary' && node.op === op && match(node.left) && literal(node.right, value)
const contains = (node, test) => !!node && (test(node) || node.kind === 'binary' && node.op === 'and' && (contains(node.left, test) || contains(node.right, test)))
const hasWhere = (q, test) => q.query.operators.some(op => op.type === 'where' && contains(op.expression, test))
const queryBound = (m, q, table) => q?.kind === 'telemetry-query' && q.query.table === table && q.destination === '/training/applicationinsights/ai-orders'
  && same(q.inputRowIds, telemetryRows(m).filter(row => row.table === table).map(row => row.id))
  && q.exportIds.length === q.inputRowIds.length && q.inputRowIds.length > 0
export function failureQueryObserved(m) {
  if (!spansObserved(m)) return false
  const q = securityRecords(m).filter(row => row.kind === 'telemetry-query').at(-1)
  if (!queryBound(m, q, 'AppDependencies') || !hasWhere(q, node => comparison(node, expr => field(expr, 'Success'), '==', false))
    || !hasWhere(q, node => comparison(node, expr => field(expr, 'Name'), '==', 'NotifyOrder'))) return false
  const project = q.query.operators.find(op => op.type === 'project')
  if (!project || q.query.operators.filter(op => op.type === 'project').length !== 1
    || q.query.operators.some(op => !['where', 'project', 'order'].includes(op.type))) return false
  const columns = Object.fromEntries(project.columns.map(column => [column.name, column.expression]))
  const expected = telemetryRows(m).filter(row => row.Name === 'NotifyOrder' && row.Success === false)
    .map(row => ({ OrderId: row.Properties['app.order_id'], OperationId: row.OperationId, DurationMs: row.DurationMs }))
  return property(columns.OrderId, 'app.order_id') && field(columns.OperationId, 'OperationId') && field(columns.DurationMs, 'DurationMs') && same(q.rows, expected)
}
export function metricsObserved(m) {
  if (!privacyClean(m) || !notification(m) || !notification(m, 401)) return false
  const bus = m.receipts.servicebus[0], spans = telemetryRows(m).filter(row => row.Name === 'NotifyAttempt')
  if (!bus || bus.messageId !== 'm1' || bus.status !== 'completed' || bus.deliveryCount !== 2 || spans.length !== 2) return false
  if (!same(bus.lockHistory.map(lock => lock.settlement), ['abandon', 'complete'])) return false
  if (!spans.every((span, index) => span.Properties['app.attempt'] === index + 1 && span.Properties['app.order_id'] === 'o1'
    && span.DurationMs === 20 && span.Success === (index === 1) && linkedOperation(m, span, 'secretclient.get_secret')
    && linkedOperation(m, span, 'send_notification', notification(m, index === 0 ? 401 : 202))
    && securityRecords(m).some(op => op.kind === 'telemetry-operation' && op.spanId === span.Id
      && op.operation === (index === 0 ? 'receiver.abandon_message' : 'receiver.complete_message')
      && op.traceIds.some(id => m.trace.some(trace => trace.id === id && trace.messageRecordId === bus.id && trace.lockToken === bus.lockHistory[index].lockToken))))) return false
  const metricRows = telemetryRows(m).filter(row => row.table === 'AppMetrics')
  if (metricRows.filter(row => row.Name === 'orders.attempts').length !== spans.length
    || !spans.every(span => metricRows.some(row => row.Name === 'orders.attempts' && row.ParentId === span.Id && row.Sum === 1
      && row.Properties['app.attempt'] === span.Properties['app.attempt'] && row.Properties['app.order_id'] === 'o1'))
    || metricRows.filter(row => row.Name === 'orders.failures').length !== 1
    || !metricRows.some(row => row.Name === 'orders.failures' && row.ParentId === spans[0].Id && row.Sum === 1
      && row.Properties['app.attempt'] === 1 && row.Properties['app.order_id'] === 'o1')
    || !same(metricRows.filter(row => row.Name === 'orders.duration').map(row => row.Sum), spans.map(row => row.DurationMs))) return false
  const queries = securityRecords(m).filter(row => row.kind === 'telemetry-query'), q = queries.at(-1)
  if (!queryBound(m, q, 'AppDependencies') || !hasWhere(q, node => comparison(node, expr => field(expr, 'Name'), '==', 'NotifyAttempt'))) return false
  const aggregate = q.query.operators.find(op => op.type === 'summarize'), extension = q.query.operators.find(op => op.type === 'extend')
  if (!aggregate || aggregate.groups.length || aggregate.aggregates.length !== 5 || !extension
    || q.query.operators.filter(op => op.type === 'summarize').length !== 1 || q.query.operators.filter(op => op.type === 'extend').length !== 1
    || q.query.operators.some(op => !['where', 'summarize', 'extend'].includes(op.type))) return false
  const columns = Object.fromEntries(aggregate.aggregates.map(column => [column.name, column]))
  const rate = extension.columns.find(column => column.name === 'FailureRate')?.expression
  return columns.MeanMs?.fn === 'avg' && field(columns.MeanMs.expression, 'DurationMs')
    && columns.MaxMs?.fn === 'max' && field(columns.MaxMs.expression, 'DurationMs') && columns.Attempts?.fn === 'count'
    && columns.Retries?.fn === 'countif' && comparison(columns.Retries.expression, node => property(node, 'app.attempt'), '>', 1)
    && columns.Failures?.fn === 'countif' && comparison(columns.Failures.expression, node => field(node, 'Success'), '==', false)
    && extension.columns.length === 1 && rate?.kind === 'binary' && rate.op === '/' && field(rate.left, 'Failures') && field(rate.right, 'Attempts')
    && same(q.rows, [{ MeanMs: spans.reduce((total, span) => total + span.DurationMs, 0) / spans.length, MaxMs: Math.max(...spans.map(span => span.DurationMs)),
      Attempts: spans.length, Retries: bus.lockHistory.length - 1, Failures: spans.filter(span => !span.Success).length,
      FailureRate: spans.filter(span => !span.Success).length / spans.length }])
    && queries.some(query => query !== q && queryBound(m, query, 'AppDependencies')
      && hasWhere(query, node => comparison(node, expr => field(expr, 'Name'), '==', 'NotifyAttempt'))
      && query.query.operators.filter(op => op.type === 'project').length === 1
      && query.query.operators.every(op => ['where', 'project', 'order'].includes(op.type))
      && query.query.operators.find(op => op.type === 'project').columns.some(column => column.name === 'DurationMs' && field(column.expression, 'DurationMs'))
      && same(query.rows, spans.map(span => ({ DurationMs: span.DurationMs }))))
}
export function observabilityLab({ stage, order, title, brief, text, rationale, source, starter, behavior }) {
  const context = stage === 'context', entry = context ? 'function_app.py' : 'worker.py', mode = context ? 'functions' : 'script'
  const paths = context ? ['function_app.py', 'clients.py', 'host.json', 'local.settings.json', 'training_runtime.py', 'requirements.txt'] : securityPaths
  const task = securityTask({ id: `construct-${stage}`, text, rationale, stage: 'secrets', paths,
    hints: ['Use the actual operation result and exported correlation/row evidence. Save the source, then run the one command. Reset restores fresh inputs.'],
    solution: { steps: [file(entry, source), command(context ? 'func start' : 'python worker.py')] } })
  task.dependencies = messagingDependencies({ files: paths, resources: { ...securitySelectors('secrets'),
    ...(context || stage === 'metrics' ? { bus: sandbox => sandbox.namespaces.filter(row => row.name === 'sb-orders') } : {}),
    ...(context ? { events: sandbox => sandbox.eventGridTopics.filter(row => row.name === 'evgt-orders'),
      host: sandbox => sandbox.functionApps.filter(row => row.name === 'func-orders' && row.resourceGroup === 'rg-messaging')
        .map(row => ({ runtime: row.runtime, runtimeVersion: row.runtimeVersion, functionsVersion: row.functionsVersion,
          os: row.os, hostingPlan: row.hostingPlan, storageAccount: row.storageAccount, storageResourceGroup: row.storageResourceGroup,
          namespace: row.appSettings.ServiceBusConnection__fullyQualifiedNamespace ?? null })),
      storage: sandbox => sandbox.storageAccounts.filter(row => row.name === 'stmessagingorders' && row.resourceGroup === 'rg-messaging')
        .map(row => ({ name: row.name, resourceGroup: row.resourceGroup })),
    } : {}),
  } })
  return { ...securityMetadata, service: 'application-insights', id: `observability-${stage}`, title, journeyOrder: order, minutes: 25, brief,
    initialProjectFiles: observabilityProjectFiles(brief, starter, context), initializeSimulation: run => seedObservabilityStage(run, stage), tasks: [task],
    messagingInput: { securityObservability: observabilityInput(stage), ...(context ? { functions: { appId: SECURITY_APP_ID } } : {}) },
    messagingExercise: { commands: [{ entry, mode }], tasks: [{ taskId: task.id, ...task.verification, entry, mode, check: behavior }] },
  }
}
