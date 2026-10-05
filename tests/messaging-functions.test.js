import { describe, it, expect } from 'vitest'
import { runMessagingFunctions } from '../src/lib/messaging/functions.js'
import { emptyMessagingState, validateMessagingState } from '../src/lib/messaging/state.js'
import { createSandbox, isSandboxShape, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { createResourceGroup, createNamespace, createQueue } from '../src/lib/sandbox/ops.js'
import { createStorageAccount, createFunctionApp, setFunctionAppSettings } from '../src/lib/sandbox/functions.js'
import { createEventGridTopic, createEventGridSubscription } from '../src/lib/sandbox/eventgrid.js'
import { applyServiceBusOperation } from '../src/lib/messaging/servicebus.js'
import { applyEventGridOperation } from '../src/lib/messaging/eventgrid.js'
import { parseMessagingProject } from '../src/lib/messaging/python.js'
import { FUNCTIONS_SOLUTION_FILES } from '../src/data/templates/messaging-python/functions.js'
import { MESSAGING_RUNTIME_FILES } from '../src/data/templates/messaging-python/runtime.js'
import { runLine } from '../src/lib/az/shell.js'
import { executeMessagingProgram } from '../src/lib/messaging/vm.js'

const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-messaging/providers`
const appId = `${root}/Microsoft.Web/sites/func-orders`
const target = { resourceGroup: 'rg-messaging', namespace: 'sb-orders', queue: 'orders' }
const success = 'order = json.loads(msg.get_body().decode("utf-8"))\n    perform_order_work(order)\n    record_processed(order)'
const header = 'import json\nimport azure.functions as func\nfrom training_runtime import perform_order_work, record_processed, record_notification\napp = func.FunctionApp()\n'
const source = handler => `${header}\n@app.function_name(name="ProcessOrder")\n@app.service_bus_queue_trigger(arg_name="msg", queue_name="orders", connection="ServiceBusConnection")\ndef process_order(msg: func.ServiceBusMessage):\n    ${handler}\n`
const eventHandler = '\n@app.function_name(name="NotifyOrder")\n@app.event_grid_trigger(arg_name="event")\ndef notify_order(event: func.EventGridEvent):\n    order = event.get_json()\n    record_notification(event.id, order["order_id"])\n'
function functionsFixture({ handler = success, events = false, runtime = 'python', runtimeVersion = '3.12' } = {}) {
  let sandbox = createResourceGroup(createSandbox(), { name: 'rg-messaging', location: 'westeurope' }).sandbox
  sandbox = createNamespace(sandbox, { resourceGroup: 'rg-messaging', name: 'sb-orders' }).sandbox
  sandbox = createQueue(sandbox, { ...target, name: target.queue, maxDeliveryCount: 3 }).sandbox
  sandbox = createStorageAccount(sandbox, { resourceGroup: 'rg-messaging', name: 'stmessagingorders' }).sandbox
  sandbox = createFunctionApp(sandbox, { resourceGroup: 'rg-messaging', name: 'func-orders', storageAccount: 'stmessagingorders', runtime, runtimeVersion }).sandbox
  sandbox = createEventGridTopic(sandbox, { resourceGroup: 'rg-messaging', name: 'evgt-orders' }).sandbox
  if (events) sandbox = createEventGridSubscription(sandbox, { resourceGroup: 'rg-messaging', topicName: 'evgt-orders', name: 'order-notifications', endpointType: 'AzureFunction', endpoint: `${appId}/functions/NotifyOrder`, maxDeliveryAttempts: 2 }).sandbox
  let messaging = applyServiceBusOperation(emptyMessagingState(), sandbox, { kind: 'send', target, message: { body: '{"id":"o7","region":"EU"}', messageId: 'm7', properties: {} } }).state
  if (events) messaging = applyEventGridOperation(messaging, sandbox, { kind: 'publish', target: { resourceGroup: 'rg-messaging', topic: 'evgt-orders' }, events: [{ id: 'e7', subject: '/orders/eu/o7', eventType: 'Contoso.OrderProcessed', data: { order_id: 'o7' }, dataVersion: '1.0' }] }).state
  const savedFiles = { ...MESSAGING_RUNTIME_FILES, 'function_app.py': source(handler) + (events ? eventHandler : ''), 'host.json': '{"version":"2.0"}', 'local.settings.json': '{"IsEncrypted":false,"Values":{"FUNCTIONS_WORKER_RUNTIME":"python","AzureWebJobsStorage":"UseDevelopmentStorage=true","ServiceBusConnection__fullyQualifiedNamespace":"sb-orders.servicebus.windows.net"}}' }
  return { run: { sandbox, project: { manifestId: 'messaging-python-v1', savedFiles, draftFiles: { ...savedFiles }, fileVersions: { 'function_app.py': 1 } }, runtime: { messaging }, evidence: { history: [] } }, lab: { messagingInput: { functions: { appId } } } }
}
const messages = result => Object.values(result.run.runtime.messaging.entities).flatMap(entity => entity.messages)
const host = result => result.run.runtime.messaging.hosts[appId.toLowerCase()]

describe('bounded Python Functions host', () => {
  it.each(['other = func.FunctionApp()', 'app = func.FunctionApp()\nother = app'])('rejects distinct registration objects before effects: %s', declaration => {
    const f = functionsFixture({ events: true })
    f.run.project.savedFiles['function_app.py'] = source(success) + '\n' + declaration + eventHandler.replaceAll('@app.', '@other.')
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'MESSAGING_UNSUPPORTED', path: 'function_app.py', line: expect.any(Number), column: expect.any(Number) })])
    expect(result.run.runtime.messaging).toBe(f.run.runtime.messaging)
    expect(result.run.runtime.messaging.effects).toEqual({})
  })
  it('preserves same-object registration aliases across handlers', () => {
    const f = functionsFixture({ events: true })
    f.run.project.savedFiles['function_app.py'] = source(success) + '\nother = app\n' + eventHandler.replaceAll('@app.', '@other.')
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics).toEqual([])
    expect(result.run.runtime.messaging.effects.workByOrder).toEqual({ o7: 1 })
    expect(result.run.runtime.messaging.effects.notifications).toEqual({ e7: { eventId: 'e7', orderId: 'o7' } })
  })
  it('rolls back callback effects when delivery finalization exceeds the trace budget', () => {
    const f = functionsFixture({ events: true })
    const parsed = parseMessagingProject({ 'function_app.py': header + eventHandler }, { entry: 'function_app.py', mode: 'functions' })
    expect(parsed.diagnostics).toEqual([])
    parsed.program.host = { appId: appId.toLowerCase(), bindings: [] }
    // Advancing the two brokers uses two traces; notification consumes the third.
    const result = executeMessagingProgram({ program: parsed.program, state: f.run.runtime.messaging, sandbox: f.run.sandbox, limits: { traces: 3 } })
    expect(result.diagnostics[0].code).toBe('MESSAGING_LIMIT')
    expect(result.state.effects).toEqual({})
    expect(result.trace.map(row => row.kind)).toEqual(['advance', 'advance'])
    expect(result.state.eventGrid.deliveries[0]).toMatchObject({ status: 'pending', attempts: 0 })
    expect(validateMessagingState(JSON.parse(JSON.stringify(result.state)))).toBe(true)
  })
  it('auto-completes only a successful Service Bus handler', () => {
    const f = functionsFixture({ handler: 'raise ValueError("invalid order")' })
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.run.runtime.messaging.effects.processed ?? {}).toEqual({})
    expect(result.run.runtime.messaging.deliveries.some(d => d.kind === 'complete')).toBe(false)
    expect(messages(result)[0]).toMatchObject({ status: 'deadletter', deliveryCount: 4 })
    expect(result.run.runtime.messaging.deliveries.filter(d => d.kind === 'receive')).toHaveLength(3)
    expect(result.diagnostics.some(d => d.message.includes('invalid order'))).toBe(true)
    expect(result.run.evidence).toEqual({ history: [] })
  })
  it('passes the actual message and settles its owning receipt after observed work', () => {
    const f = functionsFixture(), result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics).toEqual([])
    expect(result.run.runtime.messaging.effects).toEqual({ workByOrder: { o7: 1 }, processed: { o7: { id: 'o7', region: 'EU' } } })
    expect(messages(result)[0].status).toBe('completed')
    expect(host(result).handlers[0]).toMatchObject({ kind: 'servicebus', functionName: 'ProcessOrder', argName: 'msg', queueName: 'orders', connection: 'ServiceBusConnection' })
    expect(validateMessagingState(JSON.parse(JSON.stringify(result.run.runtime.messaging)))).toBe(true)
  })
  it('delivers actual Event Grid envelopes only to the registered AzureFunction', () => {
    const f = functionsFixture({ events: true }), result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics).toEqual([])
    expect(result.run.runtime.messaging.effects.notifications).toEqual({ e7: { eventId: 'e7', orderId: 'o7' } })
    expect(result.run.runtime.messaging.eventGrid.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 1, lastStatus: 200 })
  })
  it('retries failed Event Grid Functions without recording a successful notification', () => {
    const f = functionsFixture({ events: true })
    f.run.project.savedFiles['function_app.py'] = source(success) + eventHandler.replace('order = event.get_json()\n    record_notification(event.id, order["order_id"])', 'raise ValueError("notification failed")')
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.run.runtime.messaging.eventGrid.deliveries[0]).toMatchObject({ status: 'dropped', attempts: 2, lastStatus: 500 })
    expect(result.run.runtime.messaging.effects.notifications ?? {}).toEqual({})
    expect(result.diagnostics).not.toEqual([])
  })
  it.each(['connection', 'worker', 'storage', 'version', 'queue', 'argument', 'annotation', 'duplicate', 'manual', 'endpoint'])('rejects invalid %s before any handler effect', problem => {
    const f = functionsFixture({ events: true }), files = f.run.project.savedFiles
    if (problem === 'connection') files['local.settings.json'] = files['local.settings.json'].replace('ServiceBusConnection__fullyQualifiedNamespace', 'WrongConnection__fullyQualifiedNamespace')
    if (problem === 'worker') files['local.settings.json'] = files['local.settings.json'].replace('"python"', '"node"')
    if (problem === 'storage') files['local.settings.json'] = files['local.settings.json'].replace('UseDevelopmentStorage=true', 'real-secret')
    if (problem === 'version') files['host.json'] = '{"version":"1.0"}'
    if (problem === 'queue') files['function_app.py'] = files['function_app.py'].replace('queue_name="orders"', 'queue_name="missing"')
    if (problem === 'argument') files['function_app.py'] = files['function_app.py'].replace('arg_name="msg"', 'arg_name="wrong"')
    if (problem === 'annotation') files['function_app.py'] = files['function_app.py'].replace('msg: func.ServiceBusMessage', 'msg: func.EventGridEvent')
    if (problem === 'duplicate') files['function_app.py'] += eventHandler.replace('def notify_order', 'def second_handler')
    if (problem === 'manual') files['function_app.py'] = files['function_app.py'].replace('perform_order_work(order)', 'msg.complete_message(msg)')
    if (problem === 'endpoint') f.run.sandbox.eventGridTopics[0].eventSubscriptions[0].endpoint = `${appId}/functions/Unregistered`
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run.runtime.messaging.effects).toEqual({})
    expect(messages(result)[0].status).toBe('active')
  })
  it('requires an actual Python app and rejects an absent app identity', () => {
    const f = functionsFixture({ runtime: 'node', runtimeVersion: '22' })
    expect(runMessagingFunctions(f.run, f.lab).diagnostics[0].code).toBe('MESSAGING_CONFIG')
    f.lab.messagingInput.functions.appId = `${root}/Microsoft.Web/sites/absent`
    expect(runMessagingFunctions(f.run, f.lab).run).toBe(f.run)
  })
  it('captures reachable saved sources and revisions then reparses on restart', () => {
    const f = functionsFixture()
    f.run.project.savedFiles['function_app.py'] = source('process(msg)').replace('app = func.FunctionApp()', 'from processing import process\napp = func.FunctionApp()')
    f.run.project.savedFiles['processing.py'] = 'import json\nfrom training_runtime import record_processed\ndef process(message):\n    record_processed(json.loads(message.get_body().decode("utf-8")))\n'
    f.run.project.fileVersions['processing.py'] = 4
    f.run.project.draftFiles['processing.py'] = 'bad draft'
    const first = runMessagingFunctions(f.run, f.lab)
    expect(first.diagnostics).toEqual([])
    expect(host(first).sourceVersions['processing.py']).toBe(4)
    expect(host(first).sources['processing.py']).toContain('record_processed')
    const updated = { ...first.run, project: { ...first.run.project, savedFiles: { ...first.run.project.savedFiles, 'processing.py': 'def process(message):\n    raise ValueError("edited")\n' }, fileVersions: { ...first.run.project.fileVersions, 'processing.py': 5 } } }
    updated.runtime = { ...updated.runtime, messaging: applyServiceBusOperation(updated.runtime.messaging, updated.sandbox, { kind: 'send', target, message: { body: '{"id":"o8"}', properties: {} } }).state }
    const second = runMessagingFunctions(updated, f.lab)
    expect(second.diagnostics.some(d => d.message.includes('edited'))).toBe(true)
    expect(host(second).generation).toBe(2)
    expect(host(second).sourceVersions['processing.py']).toBe(5)
    expect(host(first).sourceVersions['processing.py']).toBe(4)
    expect(second.run.runtime.messaging.effects.processed.o8).toBeUndefined()
  })
  it('preflights every registered function including later unreachable branches', () => {
    const f = functionsFixture()
    f.run.project.savedFiles['function_app.py'] += eventHandler.replace('record_notification(event.id, order["order_id"])', 'if False:\n        unsupported_call()')
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED', path: 'function_app.py' })
    expect(result.run.runtime.messaging.effects).toEqual({})
    expect(messages(result)[0].status).toBe('active')
  })
  it('supports imported type aliases, decorator constants and local callbacks', () => {
    const f = functionsFixture()
    f.run.project.savedFiles['function_app.py'] = source(success).replace('app = func.FunctionApp()', 'Message = func.ServiceBusMessage\nQUEUE = "orders"\nCONNECTION = "ServiceBusConnection"\nNAME = "ProcessOrder"\napp = func.FunctionApp()').replace('name="ProcessOrder"', 'name=NAME').replace('queue_name="orders"', 'queue_name=QUEUE').replace('connection="ServiceBusConnection"', 'connection=CONNECTION').replace('msg: func.ServiceBusMessage', 'msg: Message')
    expect(runMessagingFunctions(f.run, f.lab).diagnostics).toEqual([])
  })
  it('adds paired Python support through CLI/model and preserves protected settings and Node', () => {
    const f = functionsFixture()
    expect(isSandboxShape(f.run.sandbox)).toBe(true)
    expect(() => createFunctionApp(f.run.sandbox, { resourceGroup: 'rg-messaging', name: 'crossed', storageAccount: 'stmessagingorders', runtime: 'python', runtimeVersion: '22' })).toThrow()
    expect(() => setFunctionAppSettings(f.run.sandbox, { resourceGroup: 'rg-messaging', name: 'func-orders', settings: ['FUNCTIONS_WORKER_RUNTIME=node'] })).toThrow()
    const result = runLine(f.run.sandbox, 'az functionapp create -g rg-messaging -n cli-python --storage-account stmessagingorders --flexconsumption-location westeurope --runtime python --runtime-version 3.12')
    expect(result.sandbox.functionApps.some(app => app.name === 'cli-python' && app.runtime === 'python')).toBe(true)
    const output = JSON.parse(result.lines.filter(line => line.kind === 'out').map(line => line.text).join('\n'))
    expect(output.functionAppConfig.runtime).toEqual({ name: 'python', version: '3.12' })
    expect(isSandboxShape(functionsFixture({ runtime: 'node', runtimeVersion: '22' }).run.sandbox)).toBe(true)
  })
  it('executes cumulative Functions solution using causally derived order data', () => {
    const f = functionsFixture({ events: true })
    f.run.runtime.messaging.eventGrid.deliveries = []; f.run.runtime.messaging.eventGrid.events = []; f.run.runtime.messaging.eventGrid.traces = []
    f.run.project.savedFiles = { ...FUNCTIONS_SOLUTION_FILES }
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics).toEqual([])
    expect(result.run.runtime.messaging.eventGrid.events[0].event).toMatchObject({ subject: '/orders/EU/o7', data: { order_id: 'o7', region: 'EU' } })
    expect(result.run.runtime.messaging.effects.notifications).toEqual({ 'order-o7': { eventId: 'order-o7', orderId: 'o7' } })
  })
  it('rejects forged persisted host counters and source identities', () => {
    const result = runMessagingFunctions(...Object.values(functionsFixture()))
    const state = JSON.parse(JSON.stringify(result.run.runtime.messaging))
    state.hosts[appId.toLowerCase()].generation = -1
    expect(validateMessagingState(state)).toBe(false)
    state.hosts[appId.toLowerCase()].generation = 1
    state.hosts[appId.toLowerCase()].sourceVersions['foreign.py'] = 99
    expect(validateMessagingState(state)).toBe(false)
  })
  it('rejects unsupported decorators and annotation expressions with source positions', () => {
    const parsed = parseMessagingProject({ ...MESSAGING_RUNTIME_FILES, 'function_app.py': source(success).replace('msg: func.ServiceBusMessage', 'msg: func.ServiceBusMessage()') }, { entry: 'function_app.py', mode: 'functions' })
    expect(parsed.diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED', path: 'function_app.py' })
    expect(parsed.diagnostics[0].line).toBeGreaterThan(1)
  })
  it('rejects decorator factories in handler bodies before work', () => {
    const f = functionsFixture({ handler: success + '\n    app.event_grid_trigger(arg_name="extra")' })
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics[0].code).toBe('MESSAGING_UNSUPPORTED')
    expect(result.run.runtime.messaging.effects).toEqual({})
    expect(messages(result)[0].status).toBe('active')
  })
  it('classifies actual raised ValueError and links failures to real receipts while siblings succeed', () => {
    const f = functionsFixture({ handler: 'order = json.loads(msg.get_body().decode("utf-8"))\n    if order["id"] == "o7":\n        raise ValueError("learner wording can change")\n    record_processed(order)' })
    f.run.runtime.messaging = applyServiceBusOperation(f.run.runtime.messaging, f.run.sandbox, { kind: 'send', target, message: { body: '{"id":"o8"}', messageId: 'm8', properties: {} } }).state
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics).toHaveLength(3)
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_RUNTIME', errorType: 'ValueError', handlerFailure: { kind: 'servicebus', appId: appId.toLowerCase(), functionName: 'ProcessOrder', functionId: 'function_app.py:process_order', messageRecordId: 'message-3', messageId: 'm7' } })
    const receives = result.run.runtime.messaging.deliveries.filter(trace => trace.kind === 'receive' && trace.messageId === 'm7')
    expect(result.diagnostics.map(d => d.handlerFailure.lockToken)).toEqual(receives.map(trace => trace.lockToken))
    expect(messages(result).map(message => message.status)).toEqual(['deadletter', 'completed'])
    expect(result.run.runtime.messaging.effects.processed).toEqual({ o8: { id: 'o8' } })
    const invalid = functionsFixture({ handler: 'json.loads("broken json")' }), unclassified = runMessagingFunctions(invalid.run, invalid.lab)
    expect(unclassified.diagnostics[0]).toMatchObject({ code: 'MESSAGING_RUNTIME', handlerFailure: { messageId: 'm7' } })
    expect(unclassified.diagnostics[0].errorType).toBeUndefined()
  })
  it('links raised Event Grid Function failures to actual typed delivery/event identities', () => {
    const f = functionsFixture({ events: true })
    f.run.project.savedFiles['function_app.py'] = source(success) + eventHandler.replace('order = event.get_json()\n    record_notification(event.id, order["order_id"])', 'raise ValueError("a different message")')
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics[0]).toMatchObject({ errorType: 'ValueError', handlerFailure: { kind: 'eventgrid', appId: appId.toLowerCase(), functionName: 'NotifyOrder', functionId: 'function_app.py:notify_order', deliveryId: 'eg-delivery-7', eventRecordId: 'eg-event-5', eventId: 'e7' } })
    expect(result.diagnostics.map(d => d.handlerFailure.attempt)).toEqual([1, 2])
  })
  it.each(['before', 'after'])('rejects an unsupported decorated class %s a valid handler before receiving work', position => {
    const f = functionsFixture(), valid = source(success)
    const declaration = '@unknown_decorator()\nclass Unimplemented:\n    arbitrary_side_effect()\n'
    const prefix = position === 'before' ? header : valid
    f.run.project.savedFiles['function_app.py'] = position === 'before' ? valid.replace(header, header + declaration) : valid + declaration
    const result = runMessagingFunctions(f.run, f.lab)
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED', path: 'function_app.py', line: prefix.split('\n').length, column: 1 })
    expect(result.run).toBe(f.run)
    expect(result.run.runtime.messaging.deliveries.some(trace => trace.kind === 'receive')).toBe(false)
    expect(result.run.runtime.messaging.effects).toEqual({})
    expect(messages(result)[0].status).toBe('active')
  })
})
