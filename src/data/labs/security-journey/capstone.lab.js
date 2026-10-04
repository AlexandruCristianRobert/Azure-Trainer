import { messagingDependencies } from '../../../lib/messaging/evidence.js'
import { CAPSTONE_FUNCTION_SOURCE, CAPSTONE_QUERY_SOURCE, capstoneProjectFiles } from '../../templates/security-python/capstone.js'
import { observabilityContextLab } from './context.lab.js'
import { securityMetadata, securityTask, securitySelectors, securityRecords, telemetryRows, configurationReady, contextObserved, file, command, SECURITY_STORE_ID } from './helpers.js'
import { seedObservabilityStage, securityInput, SECURITY_APP_ID } from './seeds.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export function secureOrderObserved(m) {
  if (!contextObserved(m, 'load')) return false
  const records = securityRecords(m), rows = telemetryRows(m), calls = records.filter(row => row.kind === 'notification-provider')
  const call = calls[0], notify = rows.find(row => row.Name === 'NotifyOrder')
  const duplicate = m.receipts.servicebus.find(row => row.messageId === 'm1-retry')
  return calls.length === 1 && call.configKey === 'Orders:Channel' && call.configLabel === 'production' && call.keyId === 'key-v1'
    && records.some(load => load.kind === 'config-load' && load.providerId === call.configProviderId && load.storeId === SECURITY_STORE_ID
      && load.principalId === call.principalId
      && load.selections.some(setting => setting.key === 'Orders:Channel' && setting.label === 'production' && setting.revision === call.configRevision)
      && records.some(operation => operation.kind === 'telemetry-operation' && operation.operation === 'load'
        && operation.spanId === notify.Id && operation.operationId === notify.OperationId
        && operation.recordIds.includes(load.id) && operation.recordIds.includes(call.readId)))
    && records.some(read => read.kind === 'secret-read' && read.id === call.readId && read.configProviderId === call.configProviderId)
    && duplicate?.status === 'completed' && duplicate.deliveryCount === 1 && m.receipts.servicebus.length === 2
    && !m.trace.some(row => ['order-work', 'order-record'].includes(row.kind) && row.messageRecordId === duplicate.id)
    && m.receipts.eventgrid.length === 1 && m.trace.filter(row => row.kind === 'publish').length === 1
    && Object.keys(m.effects.after.notifications ?? {}).length === 1
    && rows.some(row => row.table === 'AppTraces' && row.ParentId === notify.Id && row.OperationId === notify.OperationId
      && row.Message === 'Notification accepted' && row.SeverityLevel === 1 && row.Properties['app.order_id'] === call.orderId
      && row.Properties['app.channel'] === call.channel && row.Properties['app.status_code'] === call.statusCode)
}
function aggregateObserved(m) {
  const queries = securityRecords(m).filter(row => row.kind === 'telemetry-query'), q = queries.at(-1)
  if (m.diagnostics.length || queries.length !== 1 || q.destination !== '/training/applicationinsights/ai-orders' || q.query.table !== 'AppRequests'
    || q.query.operators.length !== 2 || !q.inputRowIds.length || q.exportIds.length !== q.inputRowIds.length) return false
  const [filter, aggregate] = q.query.operators, predicate = filter.expression
  if (filter.type !== 'where' || predicate?.kind !== 'binary' || predicate.op !== '==' || predicate.left.kind !== 'field'
    || predicate.left.name !== 'Name' || predicate.right.kind !== 'literal' || predicate.right.value !== 'NotifyOrder'
    || aggregate.type !== 'summarize' || aggregate.groups.length || aggregate.aggregates.length !== 3) return false
  const columns = Object.fromEntries(aggregate.aggregates.map(column => [column.name, column])), failure = columns.Failures?.expression
  return columns.Notifications?.fn === 'count' && columns.Failures?.fn === 'countif'
    && failure?.kind === 'binary' && failure.op === '==' && failure.left.kind === 'field' && failure.left.name === 'Success'
    && failure.right.kind === 'literal' && failure.right.value === false && columns.MeanMs?.fn === 'avg'
    && columns.MeanMs.expression.kind === 'field' && columns.MeanMs.expression.name === 'DurationMs'
    && same(m.value, { rows: q.rows })
}
function finalDatasetCurrent({ runtime, sandbox }) {
  if (!configurationReady({ sandbox })) return false
  const state = runtime.messaging, [host, query] = state.executionReceipts.slice(-2)
  if (!host || host.mode !== 'functions' || query?.mode !== 'script' || !secureOrderObserved(host.measurements) || !aggregateObserved(query.measurements)) return false
  const q = securityRecords(query.measurements).find(row => row.kind === 'telemetry-query')
  const rows = state.securityObservability.telemetry.filter(row => row.table === 'AppRequests'), notifications = rows.filter(row => row.Name === 'NotifyOrder')
  return same(q.inputRowIds, rows.map(row => row.id)) && notifications.length === 1
    && same(q.rows, [{ Notifications: notifications.length, Failures: notifications.filter(row => !row.Success).length,
      MeanMs: notifications.reduce((total, row) => total + row.DurationMs, 0) / notifications.length }])
}
const dependencies = { ...observabilityContextLab.tasks[0].dependencies,
  ...messagingDependencies({ files: ['worker.py'], resources: securitySelectors('configuration') }) }
const secure = securityTask({ id: 'secure-observed-order', stage: 'refresh', paths: ['function_app.py'], check: configurationReady,
  text: 'Complete the existing ProcessOrder/NotifyOrder flow. Keep was_processed before work and publication. Explicitly extract the actual Service Bus Diagnostic-Id into a ProcessOrder CONSUMER span, inject PublishOrder context into event data.trace_context and extract it in NotifyOrder. Inside that real callback span load production Orders:* with keyvault_credential and pass Orders:ApiKey plus Orders:Channel to send_notification using the received event/order IDs. Log accepted status, order ID and channel as safe structured metadata. Save both source files before the combined exercise below.',
  rationale: { concept: 'Secure correlated business work', what: 'Combines the actual production reference consumer, asynchronous trace carrier and safe correlated log.', why: 'A notification must both use authorized configuration and explain which real order caused it.', without: 'An unused lookup, disconnected span or duplicate publication cannot establish a secure observed business outcome.', csharp: 'DefaultAzureCredential, selected configuration and Key Vault resolution parallel C# providers; spans and propagated context parallel ActivitySource and ActivityContext. Idempotent markers are a simulation, not an atomic outbox.' },
  solution: { steps: [file('function_app.py', CAPSTONE_FUNCTION_SOURCE)] } })
const query = securityTask({ id: 'query-final-order-telemetry', stage: 'refresh', paths: ['worker.py'], check: finalDatasetCurrent,
  text: 'In worker.py query AppRequests, filter Name to NotifyOrder, and summarize Notifications=count(), Failures=countif(Success == false), MeanMs=avg(DurationMs). Return query_telemetry(query). Save both files, run func start then python worker.py once. Inspect one accepted callback, one work/notification despite m1-retry and a computed final query result. DurationMs is logical modeled cost, not wall time. Reset before another combined exercise.',
  rationale: { concept: 'Final dataset and current evidence', what: 'Computes a notification summary from the actual exports produced by the preceding bounded host command.', why: 'A saved query and current row lineage let the result be checked against the workload that really ran.', without: 'Printed constants or a query over an earlier dataset can claim success without observing the current application.', csharp: 'KQL over workspace-style telemetry is language independent; C# Activity telemetry follows equivalent correlation concepts. query_telemetry is a trainer helper, not an Azure client.' },
  solution: { steps: [file('worker.py', CAPSTONE_QUERY_SOURCE), command('func start'), command('python worker.py')] } })
secure.dependencies = dependencies
query.dependencies = dependencies
const brief = 'Continue the Order Processing Application using independently supplied identity, vault/store reader grants, demo v1 key, production email/reference and the manual OpenTelemetry host settings. Fresh m1 and m1-retry share business ID o1 and an external W3C carrier. Existing work/publication are supplied, but secure NotifyOrder, instrumentation and final query are unfinished. No events, effects, telemetry or prior completion proof are supplied. One combined bounded exercise uses two commands.'
export const securityObservabilityCapstoneLab = { ...securityMetadata, id: 'security-observability-capstone', service: 'application-insights',
  title: 'Simulated capstone: Secure and observe the Order Processing Application', journeyOrder: 12, labMode: 'capstone', minutes: 40, brief,
  initialProjectFiles: capstoneProjectFiles(brief), initializeSimulation: run => seedObservabilityStage(run, 'capstone'), tasks: [secure, query],
  messagingInput: { securityObservability: securityInput('secrets'), functions: { appId: SECURITY_APP_ID } },
  messagingExercise: { commands: [{ entry: 'function_app.py', mode: 'functions' }, { entry: 'worker.py', mode: 'script' }],
    tasks: [{ taskId: secure.id, ...secure.verification, entry: 'function_app.py', mode: 'functions', check: secureOrderObserved },
      { taskId: query.id, ...query.verification, entry: 'worker.py', mode: 'script', check: aggregateObserved }] },
}
