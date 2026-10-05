import { describe, it, expect } from 'vitest'
import { createSandbox, SUBSCRIPTION_ID, USER_OBJECT_ID } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { createEventGridTopic, createEventGridSubscription } from '../src/lib/sandbox/eventgrid.js'
import { applyEventGridOperation } from '../src/lib/messaging/eventgrid.js'
import { SECURITY_RUNTIME_FILES } from '../src/data/templates/security-python/runtime.js'
import { telemetryDataset } from '../src/lib/observability/export.js'
import { parseMessagingProject } from '../src/lib/messaging/python.js'
import { executeMessagingProgram } from '../src/lib/messaging/vm.js'
import { emptyMessagingState } from '../src/lib/messaging/state.js'
import { messagingMeasurements } from '../src/lib/messaging/evidence.js'
import { validSecurityJournal } from '../src/lib/security/evidence.js'
import { validateSecurityObservabilityState } from '../src/lib/security/state.js'

const connection = 'InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://ai-orders.training.invalid/'
const setup = `from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry import trace, propagate, metrics
from opentelemetry.trace import SpanKind, Status, StatusCode
import logging
configure_azure_monitor(connection_string="${connection}", logger_name="orders")
tracer = trace.get_tracer("orders")
logger = logging.getLogger("orders")
meter = metrics.get_meter("orders")
counter = meter.create_counter("orders.processed")
histogram = meter.create_histogram("orders.cost")
`
function run(code, options = {}) {
  const parsed = parseMessagingProject({ 'worker.py': code }, { entry: 'worker.py', profile: options.profile ?? 'security-observability-v1' })
  if (parsed.diagnostics.length) return { diagnostics: parsed.diagnostics, state: emptyMessagingState() }
  return executeMessagingProgram({ program: parsed.program, sandbox: options.sandbox ?? createSandbox(), state: options.state ?? emptyMessagingState(),
    input: { ...options.input, securityObservability: options.security ?? { appId: '/training/func-orders', notificationProvider: { id: 'demo', acceptedKeys: [{ id: 'v1', value: 'demo-key-v1' }] } } }, limits: options.limits })
}
const rows = result => result.state.securityObservability?.telemetry ?? []
const busSource = `from azure.identity import DefaultAzureCredential
from azure.servicebus import ServiceBusClient, ServiceBusMessage
def main():
    bus = ServiceBusClient("sb-orders.servicebus.windows.net", DefaultAzureCredential())
    sender = bus.get_queue_sender("orders")
    receiver = bus.get_queue_receiver("orders")
`
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-telemetry/providers`
const appId = `${root}/Microsoft.Web/sites/func-orders`
const security = { appId, notificationProvider: { id: 'demo', acceptedKeys: [{ id: 'v1', value: 'demo-key-v1' }] }, operations: [{ operationId: 'o1', eventId: 'e1', orderId: 'o1' }] }
function fixture() {
  let sb = createSandbox()
  for (const line of ['az group create -n rg-telemetry -l westeurope', 'az storage account create -g rg-telemetry -n sttelemetryorders',
    'az functionapp create -g rg-telemetry -n func-orders --storage-account sttelemetryorders --flexconsumption-location westeurope --runtime python --runtime-version 3.12',
    'az identity create -g rg-telemetry -n id-orders', 'az servicebus namespace create -g rg-telemetry -n sb-orders',
    'az servicebus queue create -g rg-telemetry --namespace-name sb-orders -n orders',
    'az keyvault create -g rg-telemetry -n kv-orders',
    `az role assignment create --scope ${root}/Microsoft.KeyVault/vaults/kv-orders --role "Key Vault Secrets Officer" --assignee-object-id ${USER_OBJECT_ID}`,
    'az keyvault secret set --vault-name kv-orders --name notification-api-key --value demo-key-v1']) {
    const result = runLine(sb, line); expect(result.lines.filter(item => item.kind === 'err')).toEqual([]); sb = result.sandbox
  }
  sb = runLine(sb, `az functionapp identity assign -g rg-telemetry -n func-orders --identities ${sb.managedIdentities[0].id}`).sandbox
  sb = runLine(sb, `az role assignment create --scope ${root}/Microsoft.KeyVault/vaults/kv-orders --role "Key Vault Secrets User" --assignee-object-id ${sb.managedIdentities[0].principalId}`).sandbox
  return sb
}
function functionsLab(code, settings = {}) {
  return { id: 'telemetry-functions', engineVersion: 2, contentVersion: 1, capabilities: { messaging: true, securityObservability: true }, manifestId: 'security-python-v1',
    initialProjectFiles: { ...Object.fromEntries(['clients.py', 'producer.py', 'worker.py', 'events.py', 'handler.py', 'README.md'].map(path => [path, ''])),
      ...SECURITY_RUNTIME_FILES, 'function_app.py': code, 'host.json': JSON.stringify({ version: '2.0', telemetryMode: 'OpenTelemetry', ...settings.host }),
      'local.settings.json': JSON.stringify({ IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'python', AzureWebJobsStorage: 'UseDevelopmentStorage=true',
        APPLICATIONINSIGHTS_CONNECTION_STRING: connection, PYTHON_APPLICATIONINSIGHTS_ENABLE_TELEMETRY: 'false', ...settings.values } }) }, tasks: [],
    resourceSeed() { return createEventGridSubscription(createEventGridTopic(fixture(), { resourceGroup: 'rg-telemetry', name: 'evgt-orders' }).sandbox,
      { resourceGroup: 'rg-telemetry', topicName: 'evgt-orders', name: 'notifications', endpointType: 'AzureFunction', endpoint: `${appId}/functions/NotifyOrder` }).sandbox },
    messagingInput: { functions: { appId }, securityObservability: security }, messagingExercise: { commands: [{ entry: 'function_app.py', mode: 'functions' }], tasks: [] },
    initializeSimulation(run) {
      const messaging = applyEventGridOperation(run.runtime.messaging, run.sandbox, { kind: 'publish', target: { resourceGroup: 'rg-telemetry', topic: 'evgt-orders' },
        events: ['1', '2'].map(id => ({ id: `e${id}`, subject: `/orders/o${id}`, eventType: 'OrderCompleted', dataVersion: '1.0',
          data: { order_id: `o${id}`, trace_context: { traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01' } } })) }).state
      return { sandbox: run.sandbox, artifacts: run.artifacts, runtime: { ...run.runtime, messaging }, nextSequence: run.nextSequence }
    } }
}

describe('bounded telemetry source SDK', () => {
  // Break: an unsafe later message commits an earlier safe message in the batch.
  it.each([
    ['secret body', '"demo-key-v1"', '', 'demo-key-v1'],
    ['email body', '"private@example.com"', '', 'private@example.com'],
    ['JSON field', `'{"password":"private-value"}'`, '', 'private-value'],
    ['nested JSON field', `'{"order":{"customer":"private-value"}}'`, '', 'private-value'],
    ['message ID', '"order"', ', message_id="private@example.com"', 'private@example.com'],
    ['session ID', '"order"', ', session_id="demo-key-v1"', 'demo-key-v1'],
    ['property value', '"order"', ', application_properties={"routing": "private@example.com"}', 'private@example.com'],
    ['property name', '"order"', ', application_properties={"token": "private-value"}', 'private-value'],
  ])('rejects Service Bus %s before committing any send in the batch', (_, body, options, sensitive) => {
    const before = emptyMessagingState()
    const result = run(busSource + `    safe = ServiceBusMessage("safe", message_id="safe")
    unsafe = ServiceBusMessage(${body}${options})
    sender.send_messages([safe, unsafe])
`, { sandbox: fixture(), security, state: before })
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(result.state.entities).toEqual(before.entities)
    expect(result.state.nextId).toBe(before.nextId)
    expect(result.trace).toEqual([])
    expect(result.output).toEqual([])
    const measurements = messagingMeasurements(before, result.state, { ...result, sourcePaths: ['worker.py'] }, 'worker.py', 'script', result.diagnostics)
    expect(measurements.receipts.servicebus).toEqual([])
    expect(JSON.stringify([result, measurements])).not.toContain(sensitive)
  })
  // Break: receive publishes an unsafe pre-existing body before print/conversion rejects it.
  it.each(['print(message)', 'print(str(message))', 'print(message.body.decode("utf-8"))'])('guards incoming receipt data before %s can publish it', expression => {
    const sandbox = fixture()
    const seeded = run(busSource + '    sender.send_messages(ServiceBusMessage(\'{"password":"private-value"}\', message_id="incoming"))\n', { sandbox, profile: 'messaging-v1' })
    expect(seeded.diagnostics).toEqual([])
    const before = seeded.state
    const result = run(busSource + `    for message in receiver.receive_messages(max_message_count=1):
        ${expression}
`, { sandbox, security, state: before })
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(result.state.entities).toEqual(before.entities)
    expect(result.state.deliveries).toEqual(before.deliveries)
    expect(result.trace).toEqual([])
    expect(result.output).toEqual([])
    const measurements = messagingMeasurements(before, result.state, { ...result, sourcePaths: ['worker.py'] }, 'worker.py', 'script', result.diagnostics)
    expect(measurements.receipts.servicebus).toEqual([])
    expect(JSON.stringify([result.trace, result.output, result.diagnostics, measurements])).not.toContain('private-value')
  })
  // Break: settlement metadata is retained in the broker and execution evidence.
  it.each([
    ['reason="private@example.com"', 'private@example.com'],
    ['error_description="demo-key-v1"', 'demo-key-v1'],
  ])('rejects sensitive dead-letter metadata: %s', (argumentsText, sensitive) => {
    const before = emptyMessagingState()
    const result = run(busSource + `    sender.send_messages(ServiceBusMessage("safe", message_id="safe"))
    for message in receiver.receive_messages(max_message_count=1):
        receiver.dead_letter_message(message, ${argumentsText})
`, { sandbox: fixture(), security, state: before })
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    const message = Object.values(result.state.entities).flatMap(entity => entity.messages)[0]
    expect(message).toMatchObject({ status: 'locked', deadLetterReason: null, deadLetterDescription: null })
    expect(result.trace.some(row => row.kind === 'deadletter')).toBe(false)
    const measurements = messagingMeasurements(before, result.state, { ...result, sourcePaths: ['worker.py'] }, 'worker.py', 'script', result.diagnostics)
    expect(JSON.stringify([result, measurements])).not.toContain(sensitive)
  })
  it.each(['security-observability-v1', 'messaging-v1'])('preserves safe plain and JSON Service Bus sends, receipt print and settlement for %s', profile => {
    const result = run(busSource + `    sender.send_messages([ServiceBusMessage("safe", message_id="plain"), ServiceBusMessage('{"order_id":"o1"}', message_id="json")])
    for message in receiver.receive_messages(max_message_count=2):
        print(message)
        receiver.dead_letter_message(message, reason="Handled", error_description="bounded")
`, { sandbox: fixture(), security, profile })
    expect(result.diagnostics).toEqual([])
    expect(result.output).toEqual(['safe', '{"order_id":"o1"}'])
    expect(Object.values(result.state.entities).flatMap(entity => entity.messages).every(message => message.status === 'deadletter')).toBe(true)
  })
  // Break: spans fail to activate or a return leaks its child context.
  it('exports configured nested spans and restores the parent after a local return', () => {
    const result = run(setup + `def child():
    with tracer.start_as_current_span("child"):
        return 7
def main():
    with tracer.start_as_current_span("NotifyOrder", kind=SpanKind.SERVER) as span:
        span.set_attribute("app.order_id", "o1")
        child()
        trace.get_current_span().add_event("returned")
        logger.info("Notification attempted", extra={"app.order_id": "o1"})
    with tracer.start_as_current_span("sibling"):
        pass
`)
    expect(result.diagnostics).toEqual([])
    const parent = rows(result).find(r => r.Name === 'NotifyOrder'), child = rows(result).find(r => r.Name === 'child')
    expect(parent.table).toBe('AppRequests')
    expect(child).toMatchObject({ table: 'AppDependencies', OperationId: parent.OperationId, ParentId: parent.Id })
    expect(parent.OperationId).toMatch(/^[a-f0-9]{32}$/)
    expect(parent.TimeGenerated).toBe('2026-01-01T00:00:00.000Z')
    expect(parent.Id).toMatch(/^[a-f0-9]{16}$/)
    expect(rows(result).find(r => r.Name === 'sibling').ParentId).toBe(null)
    expect(rows(result).find(r => r.Message === 'returned').ParentId).toBe(parent.Id)
    const measurements = messagingMeasurements(emptyMessagingState(), result.state, { ...result, sourcePaths: ['worker.py'] }, 'worker.py', 'script', [])
    expect(validSecurityJournal({ ...result.state, executionReceipts: [{ mode: 'script', measurements }] })).toBe(true)
  })
  // Break: an escaped application exception loses the active span/error record.
  it('exports sanitized escaped exceptions and explicit statuses', () => {
    const result = run(setup + `def main():
    with tracer.start_as_current_span("fail") as span:
        span.set_status(Status(StatusCode.ERROR))
        span.record_exception(ValueError("order failed"))
        raise ValueError("order failed")
`)
    expect(result.diagnostics[0]?.code).toBe('MESSAGING_RUNTIME')
    expect(rows(result).find(r => r.Name === 'fail')).toMatchObject({ Success: false, ResultCode: 'ERROR' })
    expect(rows(result).filter(r => r.table === 'AppExceptions').length).toBeGreaterThan(0)
  })
  // Break: carrier tokens become forgeable contexts or malformed inputs are accepted.
  it('propagates valid W3C carriers and rejects malformed context before export', () => {
    const result = run(setup + `def main():
    carrier = {}
    with tracer.start_as_current_span("publish"):
        propagate.inject(carrier)
    with tracer.start_as_current_span("consume", context=propagate.extract(carrier), kind=SpanKind.CONSUMER):
        logger.warning("received")
`)
    expect(result.diagnostics).toEqual([])
    const parent = rows(result).find(r => r.Name === 'publish')
    expect(rows(result).find(r => r.Name === 'consume')).toMatchObject({ OperationId: parent.OperationId, ParentId: parent.Id })
    expect(run(setup + 'def main():\n    propagate.extract({"traceparent": "bad"})\n').diagnostics[0]?.code).toBe('MESSAGING_CONFIG')
  })
  // Break: sensitive field names/raw secrets reach public telemetry or diagnostic text.
  it.each(['logger.info("demo-key-v1")', 'span.set_attribute("customer.email", "private@example.com")', 'logger.error("failed", extra={"payload": {"email": "private@example.com"}})'])('rejects sensitive emission: %s', expression => {
    const result = run(setup + `def main():\n    with tracer.start_as_current_span("safe") as span:\n        ${expression}\n`)
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(result.state.securityObservability.records.some(r => r.kind === 'privacy-violation')).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/demo-key-v1|private@example.com/)
  })
  // Break: instrumentation is enabled without an explicit exporter or leaks to old profiles.
  it('requires the trainer destination and keeps the legacy parser closed', () => {
    expect(run(setup.replace(connection, 'InstrumentationKey=other') + 'def main():\n    pass\n').diagnostics[0]?.code).toBe('MESSAGING_CONFIG')
    expect(run(setup + 'def main():\n    pass\n', { profile: 'messaging-v1' }).diagnostics[0]?.code).toBe('MESSAGING_UNSUPPORTED')
    expect(run(setup.replace('logger_name="orders"', 'logger_name="orders", unknown=True') + 'def main():\n    pass\n').diagnostics[0]?.code).toBe('MESSAGING_UNSUPPORTED')
  })
  // Break: actual work is not linked to a span, and measured results are discarded.
  it('links actual business work and records counter/histogram values', () => {
    const result = run(setup + `from training_runtime import perform_order_work, was_processed, record_processed
def main():
    with tracer.start_as_current_span("ProcessOrder"):
        perform_order_work({"id": "o1", "quantity": 2})
        record_processed({"id": "o1"})
        if was_processed("o1"):
            counter.add(1, attributes={"app.order_id": "o1"})
        histogram.record(2, attributes={"app.channel": "email"})
`)
    expect(result.diagnostics).toEqual([])
    expect(result.state.effects.workByOrder.o1).toBe(1)
    const span = rows(result).find(r => r.Name === 'ProcessOrder')
    expect(span.DurationMs).toBeGreaterThan(0)
    expect(rows(result).find(r => r.Name === 'orders.processed')).toMatchObject({ table: 'AppMetrics', Sum: 1, ParentId: span.Id })
    expect(result.state.securityObservability.records.some(r => r.kind === 'telemetry-operation' && r.spanId === span.Id && r.operation === 'perform_order_work')).toBe(true)
    const measurement = messagingMeasurements(emptyMessagingState(), result.state, { ...result, sourcePaths: ['worker.py'] }, 'worker.py', 'script', [])
    measurement.trace = []
    expect(validSecurityJournal({ ...result.state, executionReceipts: [{ mode: 'script', measurements: measurement }] })).toBe(false)
    const wrong = structuredClone({ ...result.state, executionReceipts: [{ mode: 'script', measurements: messagingMeasurements(emptyMessagingState(), result.state, { ...result, sourcePaths: ['worker.py'] }, 'worker.py', 'script', []) }] })
    for (const record of [...wrong.securityObservability.records, ...wrong.executionReceipts[0].measurements.securityObservability.records]) {
      if (record.operation === 'perform_order_work') { record.operation = 'record_processed'; record.costMs = 1 }
    }
    expect(validSecurityJournal(wrong)).toBe(false)
  })
  it('keeps carrier propagation through actual Service Bus messages and received properties readonly', () => {
    const code = setup + `from azure.identity import DefaultAzureCredential
from azure.servicebus import ServiceBusClient, ServiceBusMessage
def main():
    bus = ServiceBusClient("sb-orders.servicebus.windows.net", DefaultAzureCredential())
    sender = bus.get_queue_sender("orders")
    receiver = bus.get_queue_receiver("orders")
    carrier = {}
    with tracer.start_as_current_span("publish", kind=SpanKind.PRODUCER):
        propagate.inject(carrier)
        sender.send_messages(ServiceBusMessage("order", application_properties={"Diagnostic-Id": carrier["traceparent"]}))
    for message in receiver.receive_messages(max_message_count=1):
        with tracer.start_as_current_span("consume", context=propagate.extract(message.application_properties), kind=SpanKind.CONSUMER):
            receiver.complete_message(message)
`
    const result = run(code, { sandbox: fixture(), security })
    expect(result.diagnostics).toEqual([])
    const producer = rows(result).find(row => row.Name === 'publish')
    expect(rows(result).find(row => row.Name === 'consume')).toMatchObject({ OperationId: producer.OperationId, ParentId: producer.Id })
    const readonly = run(code.replace('receiver.complete_message(message)', 'message.application_properties["traceparent"] = "changed"'), { sandbox: fixture(), security })
    expect(readonly.diagnostics[0]?.code).toBe('MESSAGING_UNSUPPORTED')
    const numericCarrier = run(code.replace('carrier["traceparent"]', '"00-11111111111111111111111111111111-2222222222222222-01"'), { sandbox: fixture(), security })
    expect(numericCarrier.diagnostics).toEqual([])
  })
  it('links actual secret read and authorized provider outcome to the active span', () => {
    const result = run(setup + `from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from training_runtime import send_notification
def main():
    client = SecretClient("https://kv-orders.vault.azure.net", DefaultAzureCredential())
    with tracer.start_as_current_span("NotifyOrder"):
        secret = client.get_secret("notification-api-key")
        result = send_notification("e1", "o1", secret.value, "email")
        if result["status_code"] == 202:
            counter.add(1)
`, { sandbox: fixture(), security })
    expect(result.diagnostics).toEqual([])
    const span = rows(result).find(row => row.Name === 'NotifyOrder')
    expect(span.DurationMs).toBe(19)
    const linked = result.state.securityObservability.records.filter(row => row.kind === 'telemetry-operation')
    expect(linked.map(row => row.operation)).toEqual(['secretclient.get_secret', 'send_notification'])
    expect(linked.every(row => row.spanId === span.Id && row.recordIds.length === 1 && row.success)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('demo-key-v1')
  })
  it('restores Functions sibling roots with distinct attempt spans and enforces manual host configuration', () => {
    const code = setup + `import azure.functions as func
app = func.FunctionApp()
@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify(event: func.EventGridEvent):
    data = event.get_json()
    with tracer.start_as_current_span("NotifyOrder"):
        logger.info("received", extra={"app.order_id": data["order_id"]})
`
    const lab = functionsLab(code)
    const initial = createBehavioralRun(lab, { attemptId: 'telemetry-functions' })
    const result = applyRunAction(initial, { type: 'command', line: 'func start' }, lab)
    expect(result.diagnostics).toEqual([])
    const dataset = telemetryDataset(result.run.runtime.messaging)
    const requests = dataset.filter(row => row.table === 'AppRequests')
    expect(requests).toHaveLength(2)
    expect(requests.every(row => row.ParentId === 'bbbbbbbbbbbbbbbb' && row.OperationId === 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true)
    expect(new Set(requests.map(row => row.Id)).size).toBe(2)
    expect(dataset.filter(row => row.Name === 'NotifyOrder').every(row => requests.some(parent => parent.Id === row.ParentId))).toBe(true)
    expect(deserializeRun(serializeRun(result.run, lab), lab).attemptId).toBe('telemetry-functions')
    for (const settings of [{ host: { telemetryMode: 'classic' } }, { values: { PYTHON_APPLICATIONINSIGHTS_ENABLE_TELEMETRY: 'true' } }, { values: { APPLICATIONINSIGHTS_CONNECTION_STRING: 'bad' } }]) {
      const invalid = functionsLab(code, settings)
      expect(applyRunAction(createBehavioralRun(invalid, { attemptId: 'invalid-host' }), { type: 'command', line: 'func start' }, invalid).diagnostics[0]?.code).toBe('MESSAGING_CONFIG')
    }
  })
  it('bounds spans and nesting, rejects extra properties, and projects detached data', () => {
    const many = run(setup + 'def main():\n' + Array.from({ length: 101 }, (_, i) => `    with tracer.start_as_current_span("s${i}"):\n        pass\n`).join(''))
    expect(many.diagnostics[0]?.code).toBe('MESSAGING_LIMIT')
    expect(rows(many)).toHaveLength(100)
    const nested = run(setup + 'def main():\n' + Array.from({ length: 17 }, (_, i) => '    '.repeat(i + 1) + `with tracer.start_as_current_span("n${i}"):\n`).join('') + '    '.repeat(18) + 'pass\n')
    expect(nested.diagnostics[0]?.code).toBe('MESSAGING_LIMIT')
    expect(rows(nested)).toHaveLength(16)
    const attrs = Array.from({ length: 32 }, (_, i) => `"a${i}": ${i}`).join(', ')
    const result = run(setup + `def main():\n    with tracer.start_as_current_span("attrs", attributes={${attrs}}):\n        pass\n`)
    expect(result.diagnostics).toEqual([])
    const snapshot = telemetryDataset(result.state); snapshot[0].Properties.a0 = 'changed'
    expect(rows(result)[0].Properties.a0).toBe(0)
  })
  it('rejects sensitive business payload fields before effects and public traces', () => {
    const result = run(setup + 'from training_runtime import perform_order_work\ndef main():\n    perform_order_work({"id": "o1", "email": "private@example.com"})\n')
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(result.state.effects).toEqual({})
    expect(JSON.stringify(result)).not.toContain('private@example.com')
  })
  it.each(['print("private@example.com")', 'raise ValueError("private@example.com")', 'return {}["private@example.com"]'])('guards other public text boundaries: %s', expression => {
    const result = run(setup + `def main():\n    ${expression}\n`)
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(JSON.stringify(result)).not.toContain('private@example.com')
  })
  it('keeps actual Event Grid published application carriers through webhook delivery', () => {
    const endpoint = 'https://orders.training.invalid/notify'
    const sandbox = createEventGridSubscription(createEventGridTopic(fixture(), { resourceGroup: 'rg-telemetry', name: 'evgt-orders' }).sandbox,
      { resourceGroup: 'rg-telemetry', topicName: 'evgt-orders', name: 'webhook', endpointType: 'WebHook', endpoint }).sandbox
    const result = run(setup + `from azure.identity import DefaultAzureCredential
from azure.eventgrid import EventGridPublisherClient, EventGridEvent
from training_runtime import deliver_events
publisher = EventGridPublisherClient("https://evgt-orders.westeurope-1.eventgrid.azure.net/api/events", DefaultAzureCredential())
def consume(event):
    with tracer.start_as_current_span("consume", context=propagate.extract(event.data["trace_context"]), kind=SpanKind.CONSUMER):
        logger.info("received", extra={"app.order_id": event.data["order_id"]})
    return 200
def main():
    carrier = {}
    with tracer.start_as_current_span("publish", kind=SpanKind.PRODUCER):
        propagate.inject(carrier)
        publisher.send(EventGridEvent("/orders/o1", "OrderCompleted", {"order_id": "o1", "trace_context": carrier}, "1.0", id="e1"))
    deliver_events(consume)
`, { sandbox, security, input: { eventGridHandlers: { [endpoint]: 'worker.py' } } })
    expect(result.diagnostics).toEqual([])
    const producer = rows(result).find(row => row.Name === 'publish')
    expect(rows(result).find(row => row.Name === 'consume')).toMatchObject({ ParentId: producer.Id, OperationId: producer.OperationId })
    expect(result.state.eventGrid.deliveries[0].status).toBe('delivered')
  })
  it('rolls back an over-capacity span as a unit and rejects forged export lineage', () => {
    const result = run(setup + 'from training_runtime import perform_order_work\ndef main():\n    with tracer.start_as_current_span("full"):\n        perform_order_work({"id": "o1"})\n' + Array.from({ length: 180 }, () => '        logger.info("' + 'x'.repeat(500) + '")\n').join(''))
    expect(result.diagnostics[0]?.code).toBe('MESSAGING_LIMIT')
    expect(validateSecurityObservabilityState(result.state.securityObservability)).toBe(true)
    expect(rows(result)).toHaveLength(0)
    expect(result.state.effects).toEqual({})
    const good = run(setup + 'from training_runtime import perform_order_work\ndef main():\n    with tracer.start_as_current_span("work"):\n        perform_order_work({"id": "o1"})\n')
    const measurement = messagingMeasurements(emptyMessagingState(), good.state, { ...good, sourcePaths: ['worker.py'] }, 'worker.py', 'script', [])
    const forged = structuredClone({ ...good.state, executionReceipts: [{ mode: 'script', measurements: measurement }] })
    for (const record of [...forged.securityObservability.records, ...forged.executionReceipts[0].measurements.securityObservability.records]) {
      if (record.kind === 'telemetry-operation') record.spanId = 'cccccccccccccccc'
    }
    expect(validSecurityJournal(forged)).toBe(false)
  })
  it('retains completed Function siblings and discards the telemetry of an aborted callback', () => {
    const code = setup + `import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
app = func.FunctionApp()
client = SecretClient("https://kv-orders.vault.azure.net", DefaultAzureCredential())
@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify(event: func.EventGridEvent):
    logger.info("received", extra={"app.order_id": event.get_json()["order_id"]})
    if event.id == "e2":
        client.get_secret("missing")
`
    const lab = functionsLab(code), result = applyRunAction(createBehavioralRun(lab, { attemptId: 'partial-host' }), { type: 'command', line: 'func start' }, lab)
    expect(result.diagnostics[0]?.code).toBe('SECURITY_AUTH')
    const dataset = telemetryDataset(result.run.runtime.messaging)
    expect(dataset.filter(row => row.table === 'AppRequests')).toHaveLength(1)
    expect(dataset.filter(row => row.table === 'AppTraces').map(row => row.Properties['app.order_id'])).toEqual(['o1'])
    expect(deserializeRun(serializeRun(result.run, lab), lab).attemptId).toBe('partial-host')
  })
  it('preserves only category audit metadata after a Function privacy rollback', () => {
    const code = setup + `import azure.functions as func
from training_runtime import perform_order_work
app = func.FunctionApp()
@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify(event: func.EventGridEvent):
    data = event.get_json()
    perform_order_work({"id": data["order_id"]})
    logger.info("attempted", extra={"app.order_id": data["order_id"]})
    if event.id == "e2":
        logger.info("private@example.com")
`
    const lab = functionsLab(code), result = applyRunAction(createBehavioralRun(lab, { attemptId: 'privacy-host' }), { type: 'command', line: 'func start' }, lab)
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    const state = result.run.runtime.messaging, audit = state.securityObservability.records.filter(row => row.kind === 'privacy-violation')
    expect(audit).toHaveLength(1)
    expect(Object.keys(audit[0]).sort()).toEqual(['category', 'id', 'kind', 'timeMs'])
    expect(audit[0].category).toBe('telemetry')
    expect(state.effects.workByOrder).toEqual({ o1: 1 })
    expect(telemetryDataset(state).filter(row => row.table === 'AppRequests')).toHaveLength(1)
    expect(telemetryDataset(state).filter(row => row.table === 'AppTraces').map(row => row.Properties['app.order_id'])).toEqual(['o1'])
    expect(state.executionReceipts.at(-1).measurements.securityObservability.records.at(-1)).toEqual(audit[0])
    expect(JSON.stringify({ diagnostics: result.diagnostics, records: state.securityObservability, effects: state.effects })).not.toContain('private@example.com')
    expect(deserializeRun(serializeRun(result.run, lab), lab).attemptId).toBe('privacy-host')
  })
  it('admits duplicate processed-order attempts without replacing the first value across restore', () => {
    const code = setup + `from training_runtime import record_processed
def main():
    with tracer.start_as_current_span("RecordOrder"):
        record_processed({"id": "o1", "quantity": 1})
        record_processed({"id": "o1", "quantity": 2})
`
    const lab = functionsLab('')
    lab.initialProjectFiles['worker.py'] = code
    lab.messagingExercise.commands = [{ entry: 'worker.py', mode: 'script' }]
    const initial = createBehavioralRun(lab, { attemptId: 'duplicate-order' })
    const result = applyRunAction(initial, { type: 'command', line: 'python worker.py' }, lab)
    expect(result.diagnostics).toEqual([])
    expect(result.run.runtime.messaging.effects.processed.o1).toEqual({ id: 'o1', quantity: 1 })
    expect(result.run.runtime.messaging.executionReceipts.at(-1).measurements.trace.filter(row => row.kind === 'order-record').map(row => row.changed)).toEqual([true, false])
    const restored = deserializeRun(serializeRun(result.run, lab), lab)
    const repeated = applyRunAction(restored, { type: 'command', line: 'python worker.py' }, lab)
    expect(repeated.diagnostics).toEqual([])
    expect(repeated.run.runtime.messaging.executionReceipts.at(-1).measurements.trace.filter(row => row.kind === 'order-record').map(row => row.changed)).toEqual([false, false])
    expect(deserializeRun(serializeRun(repeated.run, lab), lab).runtime.messaging.effects.processed.o1).toEqual({ id: 'o1', quantity: 1 })
  })
})
