import { describe, it, expect } from 'vitest'
import { applyRunAction, applyCommandEffects } from '../src/lib/labEngine/actions.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { createResourceGroup, createNamespace, createQueue } from '../src/lib/sandbox/ops.js'
import { applyServiceBusOperation } from '../src/lib/messaging/servicebus.js'
import { SERVICEBUS_SOLUTION_FILES } from '../src/data/templates/messaging-python/servicebus.js'
import { runLine } from '../src/lib/az/shell.js'
import { messagingDependencies } from '../src/lib/messaging/evidence.js'
import { createStorageAccount, createFunctionApp } from '../src/lib/sandbox/functions.js'
import { createEventGridTopic, createEventGridSubscription } from '../src/lib/sandbox/eventgrid.js'
import { applyEventGridOperation } from '../src/lib/messaging/eventgrid.js'
import { SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { FUNCTIONS_SOLUTION_FILES } from '../src/data/templates/messaging-python/functions.js'
import { EVENTGRID_SOLUTION_FILES } from '../src/data/templates/messaging-python/eventgrid.js'

const target = { resourceGroup: 'rg-messaging', namespace: 'sb-orders', queue: 'orders' }
// Removing the settlement or idempotency guard must fail the real behavior check.
function engineFixture() {
  const original = SERVICEBUS_SOLUTION_FILES['worker.py']
  const lab = {
    id: 'engine-messaging', engineVersion: 2, contentVersion: 1, capabilities: { messaging: true },
    manifestId: 'messaging-python-v1', initialProjectFiles: { ...SERVICEBUS_SOLUTION_FILES },
    resourceSeed(sandbox) {
      sandbox = createResourceGroup(sandbox, { name: target.resourceGroup, location: 'westeurope' }).sandbox
      sandbox = createNamespace(sandbox, { resourceGroup: target.resourceGroup, name: target.namespace }).sandbox
      return createQueue(sandbox, { ...target, name: target.queue }).sandbox
    },
    initializeSimulation(run) {
      let messaging = run.runtime.messaging
      for (const messageId of ['m1', 'm2']) messaging = applyServiceBusOperation(messaging, run.sandbox,
        { kind: 'send', target, message: { messageId, body: '{"id":"o1","region":"EU"}', properties: {} } }).state
      return { sandbox: run.sandbox, artifacts: run.artifacts, runtime: { ...run.runtime, messaging }, nextSequence: run.nextSequence }
    },
    messagingExercise: {
      commands: [{ entry: 'worker.py', mode: 'script' }, { entry: 'producer.py', mode: 'script' }],
      tasks: [{ taskId: 'worker', scenarioId: 'worker-exercise', scenarioVersion: 1, entry: 'worker.py', mode: 'script',
        check: ({ trace, effects, receipts }) => trace.filter(row => row.kind === 'complete').length === 2
          && effects.after.workByOrder?.o1 === 1 && effects.after.processed?.o1?.region === 'EU'
          && receipts.servicebus.length === 2 && receipts.servicebus.every(row => row.status === 'completed') }],
    },
    tasks: [{ id: 'config', check: ({ sandbox }) => sandbox.namespaces[0].queues[0].status === 'Active' },
      { id: 'worker', check: () => true, verification: { scenarioId: 'worker-exercise', scenarioVersion: 1 },
        dependencies: messagingDependencies({ files: ['worker.py', 'clients.py', 'training_runtime.py'],
          resources: { orders: sandbox => sandbox.namespaces[0].queues[0] } }) }],
  }
  return { lab, original, changed: original.replace('receiver.complete_message(message)', 'pass'), run: createBehavioralRun(lab, { attemptId: 'attempt-1' }) }
}
const command = (run, lab, line = 'python worker.py') => applyRunAction(run, { type: 'command', line }, lab)
const save = (run, lab, path, text) => applyRunAction(run, { type: 'save-file', path, text }, lab).run
const done = (lab, run) => evaluateLab(lab, run).tasks.at(-1).done
const appId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-messaging/providers/Microsoft.Web/sites/func-orders`
const entityId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-messaging/providers/Microsoft.ServiceBus/namespaces/sb-orders/queues/orders`.toLowerCase()
function hostFixture({ expected = true, failure = 'raise ValueError("invalid order")' } = {}) {
  const f = engineFixture(), seed = f.lab.resourceSeed
  f.lab.resourceSeed = sandbox => {
    sandbox = seed(sandbox)
    sandbox = createStorageAccount(sandbox, { resourceGroup: target.resourceGroup, name: 'stmessagingorders' }).sandbox
    sandbox = createFunctionApp(sandbox, { resourceGroup: target.resourceGroup, name: 'func-orders', storageAccount: 'stmessagingorders', runtime: 'python', runtimeVersion: '3.12' }).sandbox
    return createEventGridTopic(sandbox, { resourceGroup: target.resourceGroup, name: 'evgt-orders' }).sandbox
  }
  f.lab.initialProjectFiles = { ...FUNCTIONS_SOLUTION_FILES, 'function_app.py': `import json
import azure.functions as func
from training_runtime import perform_order_work, record_processed
app = func.FunctionApp()
@app.function_name(name="ProcessOrder")
@app.service_bus_queue_trigger(arg_name="msg", queue_name="orders", connection="ServiceBusConnection")
def process_order(msg: func.ServiceBusMessage):
    order = json.loads(msg.get_body().decode("utf-8"))
    if order["id"] == "invalid":
        ${failure}
    perform_order_work(order)
    record_processed(order)
` }
  f.lab.messagingInput = { functions: { appId } }
  f.lab.initializeSimulation = run => {
    let messaging = run.runtime.messaging
    for (const [messageId, id] of [['good', 'o1'], ['bad', 'invalid']]) messaging = applyServiceBusOperation(messaging, run.sandbox,
      { kind: 'send', target, message: { messageId, body: JSON.stringify({ id, region: 'EU' }), properties: {} } }).state
    return { sandbox: run.sandbox, artifacts: run.artifacts, runtime: { ...run.runtime, messaging }, nextSequence: run.nextSequence }
  }
  f.lab.messagingExercise = { commands: [{ entry: 'function_app.py', mode: 'functions' }],
    expectedFailures: expected ? [{ kind: 'servicebus', entityId, messageId: 'bad' }] : [],
    tasks: [{ taskId: 'worker', scenarioId: 'worker-exercise', scenarioVersion: 1, entry: 'function_app.py', mode: 'functions',
      check: ({ receipts, effects, trace }) => receipts.servicebus.some(row => row.messageId === 'good' && row.status === 'completed')
        && receipts.servicebus.some(row => row.messageId === 'bad' && row.status === 'deadletter')
        && trace.some(row => row.kind === 'abandon') && effects.after.workByOrder?.o1 === 1 && !effects.after.workByOrder?.invalid }] }
  f.lab.tasks.at(-1).dependencies = messagingDependencies({ files: ['function_app.py', 'training_runtime.py', 'requirements.txt', 'host.json', 'local.settings.json'],
    resources: { orders: sandbox => sandbox.namespaces[0].queues[0], app: sandbox => sandbox.functionApps[0] } })
  f.run = createBehavioralRun(f.lab, { attemptId: 'host-attempt' })
  return f
}
function webhookFixture() {
  const f = engineFixture(), seed = f.lab.resourceSeed, endpoint = 'https://orders.trainer.invalid/events'
  f.lab.resourceSeed = sandbox => {
    sandbox = createEventGridTopic(seed(sandbox), { resourceGroup: target.resourceGroup, name: 'evgt-orders' }).sandbox
    return createEventGridSubscription(sandbox, { resourceGroup: target.resourceGroup, topicName: 'evgt-orders', name: 'order-notifications',
      endpoint, subjectBeginsWith: '/orders/eu/', maxDeliveryAttempts: 3 }).sandbox
  }
  f.lab.initialProjectFiles = { ...EVENTGRID_SOLUTION_FILES,
    'events.py': `from azure.eventgrid import EventGridEvent
from clients import publisher
def main():
    first = EventGridEvent(subject="/orders/eu/o1", event_type="Contoso.OrderProcessed", data={"order_id":"o1"}, data_version="1.0", id="e1")
    second = EventGridEvent(subject="/orders/us/o2", event_type="Contoso.OrderProcessed", data={"order_id":"o2"}, data_version="1.0", id="e2")
    publisher.send([first, second])
` }
  f.lab.messagingInput = { eventGridHandlers: { [endpoint]: 'handler.py' }, handlerStatus: { o1: [503, 200] } }
  f.lab.initializeSimulation = undefined
  f.lab.messagingExercise = { commands: [{ entry: 'events.py', mode: 'script' }, { entry: 'handler.py', mode: 'script' }],
    tasks: [{ taskId: 'worker', scenarioId: 'worker-exercise', scenarioVersion: 1, entry: 'events.py', mode: 'script',
      check: ({ receipts }) => receipts.eventgrid.length === 1 && receipts.eventgrid[0].event.id === 'e1' }] }
  f.lab.tasks.at(-1).dependencies = messagingDependencies({ files: ['events.py', 'clients.py'], resources: { grid: sandbox => sandbox.eventGridTopics[0] } })
  f.run = createBehavioralRun(f.lab, { attemptId: 'webhook-attempt' })
  return f
}

describe('messaging shell, current behavior evidence and persistence', () => {
  it('does not revive evidence after source revert', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    expect(done(f.lab, proved)).toBe(true)
    const changed = save(proved, f.lab, 'worker.py', f.changed)
    const reverted = save(changed, f.lab, 'worker.py', f.original)
    expect(done(f.lab, reverted)).toBe(false)
    expect(Object.values(reverted.evidence.experimentsById)[0].outcome).toBe('passed')
  })
  it('executes saved source while ignoring an unsaved broken draft', () => {
    const f = engineFixture(), draft = applyRunAction(f.run, { type: 'draft', path: 'worker.py', text: f.changed }, f.lab).run
    const result = command(draft, f.lab)
    expect(result.diagnostics).toEqual([])
    expect(done(f.lab, result.run)).toBe(true)
    expect(result.run.runtime.messaging.effects.workByOrder.o1).toBe(1)
  })
  it('preserves proof after unrelated README and no-op configuration edits', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    const edited = save(proved, f.lab, 'README.md', 'Unrelated documentation')
    const noOp = command(edited, f.lab, 'az servicebus queue update -g rg-messaging --namespace-name sb-orders -n orders --status Active').run
    expect(done(f.lab, noOp)).toBe(true)
  })
  it('does not revive evidence after resource configuration change and revert', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    const changed = command(proved, f.lab, 'az servicebus queue update -g rg-messaging --namespace-name sb-orders -n orders --status Disabled').run
    const reverted = command(changed, f.lab, 'az servicebus queue update -g rg-messaging --namespace-name sb-orders -n orders --status Active').run
    expect(done(f.lab, reverted)).toBe(false)
    expect(reverted.dependencyGenerations['messaging:resource:orders']).toBe(2)
  })
  it.each(['settlement', 'guard', 'payload'])('does not grant proof when the %s behavior is wrong', defect => {
    const f = engineFixture()
    const text = defect === 'settlement' ? f.changed : defect === 'guard'
      ? f.original.replace('if not was_processed(order["id"]):', 'if True:')
      : f.original.replace('record_processed(order)', 'record_processed({"id": order["id"], "region": "US"})')
    const result = command(save(f.run, f.lab, 'worker.py', text), f.lab)
    expect(result.diagnostics).toEqual([])
    expect(done(f.lab, result.run)).toBe(false)
    expect(Object.values(result.run.evidence.experimentsById).at(-1)?.outcome).toBe('failed')
  })
  it('does not reuse old receipts when a repeated worker receives nothing', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run, repeated = command(proved, f.lab).run
    expect(done(f.lab, repeated)).toBe(false)
    expect(Object.values(repeated.evidence.experimentsById).at(-1).measurements.trace).toEqual([])
  })
  it('resumes JSON effects and proof, while a new attempt clears both', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    const resumed = deserializeRun(serializeRun(proved, f.lab), f.lab)
    expect(done(f.lab, resumed)).toBe(true)
    expect(resumed.runtime.messaging.effects.workByOrder.o1).toBe(1)
    const fresh = createBehavioralRun(f.lab, { attemptId: 'attempt-2' })
    expect(done(f.lab, fresh)).toBe(false)
    expect(fresh.evidence.experimentsById).toEqual({})
    expect(fresh.runtime.messaging.effects).toEqual({})
  })
  it.each([{ passed: true }, { state: {} }, { runtime: {} }, { evidence: {} }, { mode: 'eventgrid-handler' }, { entry: 'other.py' }])('rejects forged messaging intent %j', extra => {
    const f = engineFixture()
    expect(() => applyCommandEffects(f.run, [{ type: 'messaging-execution', entry: 'worker.py', mode: 'script', ...extra }], f.lab)).toThrow()
    expect(f.run.runtime.messaging.effects).toEqual({})
  })
  it('rejects public messaging-run actions and capabilityless effects', () => {
    const f = engineFixture()
    expect(applyRunAction(f.run, { type: 'messaging-run', entry: 'worker.py', mode: 'script' }, f.lab).diagnostics[0].code).toBe('INVALID_ACTION')
    expect(() => applyCommandEffects(f.run, [{ type: 'messaging-execution', entry: 'worker.py', mode: 'script' }], { ...f.lab, capabilities: {} })).toThrow()
  })
  it.each(['python worker.py; python producer.py', 'python ../worker.py', 'python worker.py && python producer.py', 'python https://example.com/worker.py', 'func start --port 7071'])('rejects unscoped command %s', line => {
    const f = engineFixture(), result = command(f.run, f.lab, line)
    expect(result.run.runtime.messaging.effects).toEqual({})
    expect(done(f.lab, result.run)).toBe(false)
  })
  it('keeps legacy Python command-not-found and emits only intent from the scoped shell', () => {
    const f = engineFixture()
    expect(runLine(f.run.sandbox, 'python worker.py', { lab: { capabilities: {} } }).lines[0].text).toContain('command not found')
    expect(runLine(f.run.sandbox, 'python worker.py', { run: f.run, lab: f.lab }).effects).toEqual([{ type: 'messaging-execution', entry: 'worker.py', mode: 'script' }])
  })
  it('rejects malformed messaging runtime and foreign evidence on resume', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    const malformed = JSON.parse(JSON.stringify(proved)); delete malformed.runtime.messaging
    expect(() => deserializeRun(JSON.stringify(malformed), f.lab)).toThrow()
    const foreign = JSON.parse(JSON.stringify(proved)); Object.values(foreign.evidence.experimentsById)[0].attemptId = 'other'
    expect(() => deserializeRun(JSON.stringify(foreign), f.lab)).toThrow()
  })
  it('runs the actual protected WebHook callback through retries and checks actual publication filtering', () => {
    const f = webhookFixture(), published = command(f.run, f.lab, 'python events.py').run
    expect(done(f.lab, published)).toBe(true)
    const handled = command(published, f.lab, 'python handler.py')
    expect(handled.diagnostics).toEqual([])
    expect(handled.run.runtime.messaging.eventGrid.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 2 })
    expect(handled.run.runtime.messaging.effects.notifications.e1.orderId).toBe('o1')
    const unfiltered = command(f.run, f.lab, 'az eventgrid topic event-subscription update -g rg-messaging --topic-name evgt-orders -n order-notifications --subject-begins-with ""').run
    const leaked = command(unfiltered, f.lab, 'python events.py').run
    expect(leaked.runtime.messaging.eventGrid.deliveries).toHaveLength(2)
    expect(done(f.lab, leaked)).toBe(false)
  })
  it('accepts declared typed invalid receipt only with real abandon/DLQ and successful sibling effects', () => {
    const f = hostFixture(), result = command(f.run, f.lab, 'func start')
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.lines.filter(line => line.kind === 'err')).toHaveLength(result.diagnostics.length)
    expect(result.diagnostics.every(row => row.errorType === 'ValueError' && row.handlerFailure.messageId === 'bad')).toBe(true)
    expect(done(f.lab, result.run)).toBe(true)
    expect(deserializeRun(serializeRun(result.run, f.lab), f.lab).runtime.messaging.hosts[appId.toLowerCase()].generation).toBe(1)
    const saved = save(result.run, f.lab, 'function_app.py', f.lab.initialProjectFiles['function_app.py'] + '\n# saved revision\n')
    expect(done(f.lab, saved)).toBe(false)
    const restarted = command(saved, f.lab, 'func start').run
    expect(restarted.runtime.messaging.hosts[appId.toLowerCase()].generation).toBe(2)
    expect(done(f.lab, restarted)).toBe(false)
  })
  it.each([{ expected: false }, { failure: 'order["missing"]' }, { failure: 'if False:\n            unsupported_call()' }])('never accepts undeclared, arbitrary or unsupported failures %j', options => {
    const f = hostFixture(options), result = command(f.run, f.lab, 'func start')
    expect(done(f.lab, result.run)).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
  })
  it('does not grade a host captured without any delivery, or a function entry different from shell intent', () => {
    const f = hostFixture()
    f.lab.initializeSimulation = undefined
    const empty = createBehavioralRun(f.lab, { attemptId: 'empty-host' })
    expect(done(f.lab, command(empty, f.lab, 'func start').run)).toBe(false)
    f.lab.messagingInput.functions.entry = 'worker.py'
    expect(() => applyCommandEffects(f.run, [{ type: 'messaging-execution', entry: 'function_app.py', mode: 'functions' }], f.lab)).toThrow()
  })
  it('rejects malformed persisted messaging measurements even with matching generic evidence identity', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    const bad = JSON.parse(serializeRun(proved, f.lab))
    Object.values(bad.evidence.experimentsById)[0].measurements = {}
    expect(() => deserializeRun(JSON.stringify(bad), f.lab)).toThrow()
  })
  it('does not grant behavior evidence from a no-op even with a weak authored check', () => {
    const f = engineFixture()
    f.lab.messagingExercise.tasks[0].check = () => true
    const empty = save(f.run, f.lab, 'worker.py', 'def main():\n    pass\n')
    expect(done(f.lab, command(empty, f.lab).run)).toBe(false)
  })
  it('keeps arbitrary custom filter property configuration in relevant dependencies', () => {
    const selector = messagingDependencies({ resources: { rule: sandbox => sandbox.rule } })['messaging:resource:rule']
    const selected = selector({ sandbox: { rule: { name: 'custom', createdAt: 'unstable', correlationFilter: { properties: { messages: 'critical', effects: 'EU' } } } } })
    expect(selected).toEqual({ name: 'custom', correlationFilter: { properties: { messages: 'critical', effects: 'EU' } } })
  })
  it('rejects a persisted passed measurement that no longer satisfies its declared receipt check', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    const forged = JSON.parse(serializeRun(proved, f.lab))
    Object.values(forged.evidence.experimentsById)[0].measurements.receipts.servicebus[0].status = 'active'
    expect(() => deserializeRun(JSON.stringify(forged), f.lab)).toThrow()
  })
  it('invalidates reached client saves and preserves proof for unrelated resource creation', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    const unrelated = command(proved, f.lab, 'az group create -n rg-unrelated -l westeurope').run
    expect(done(f.lab, unrelated)).toBe(true)
    const changed = save(unrelated, f.lab, 'clients.py', f.lab.initialProjectFiles['clients.py'] + '\n# saved dependency\n')
    const reverted = save(changed, f.lab, 'clients.py', f.lab.initialProjectFiles['clients.py'])
    expect(done(f.lab, reverted)).toBe(false)
  })
  it('measures only application effects changed by this command', () => {
    const f = engineFixture()
    f.run.runtime.messaging.effects = { workByOrder: { historical: 9 }, processed: { historical: { id: 'historical', region: 'US' } } }
    const result = command(f.run, f.lab).run
    const measurements = Object.values(result.evidence.experimentsById)[0].measurements
    expect(measurements.effects.after.workByOrder).toEqual({ o1: 1 })
    expect(measurements.effects.after.processed).toEqual({ o1: { id: 'o1', region: 'EU' } })
    expect(result.runtime.messaging.effects.workByOrder.historical).toBe(9)
  })
  it('rejects malformed historic trace shapes even after bounded runtime history eviction', () => {
    const f = engineFixture(), proved = command(f.run, f.lab).run
    const malformed = JSON.parse(serializeRun(proved, f.lab))
    malformed.runtime.messaging.deliveries = []
    Object.values(malformed.evidence.experimentsById)[0].measurements.trace[0].kind = 'invented'
    expect(() => deserializeRun(JSON.stringify(malformed), f.lab)).toThrow()
  })
  it('admits an explicitly declared Event Grid invalid receipt with actual retry exhaustion and a successful sibling', () => {
    const f = hostFixture(), seed = f.lab.resourceSeed
    f.lab.resourceSeed = sandbox => createEventGridSubscription(seed(sandbox), { resourceGroup: target.resourceGroup, topicName: 'evgt-orders', name: 'notify',
      endpointType: 'AzureFunction', endpoint: `${appId}/functions/NotifyOrder`, maxDeliveryAttempts: 2 }).sandbox
    f.lab.initialProjectFiles['function_app.py'] = `import azure.functions as func
from training_runtime import record_notification
app = func.FunctionApp()
@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify(event: func.EventGridEvent):
    order = event.get_json()
    if order["order_id"] == "invalid":
        raise ValueError("invalid notification")
    record_notification(event.id, order["order_id"])
`
    f.lab.initializeSimulation = run => {
      const messaging = applyEventGridOperation(run.runtime.messaging, run.sandbox, { kind: 'publish', target: { resourceGroup: target.resourceGroup, topic: 'evgt-orders' },
        events: ['o1', 'invalid'].map(id => ({ id: `e-${id}`, eventType: 'Contoso.OrderProcessed', data: { order_id: id }, subject: `/orders/${id}`, dataVersion: '1.0' })) }).state
      return { sandbox: run.sandbox, artifacts: run.artifacts, runtime: { ...run.runtime, messaging }, nextSequence: run.nextSequence }
    }
    const subscriptionId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-messaging/providers/Microsoft.EventGrid/topics/evgt-orders/eventSubscriptions/notify`.toLowerCase()
    f.lab.messagingExercise.expectedFailures = [{ kind: 'eventgrid', subscriptionId, eventId: 'e-invalid' }]
    f.lab.messagingExercise.tasks[0].check = ({ receipts, effects }) => receipts.eventgrid.some(row => row.event.id === 'e-o1' && row.status === 'delivered')
      && receipts.eventgrid.some(row => row.event.id === 'e-invalid' && row.status === 'dropped' && row.attempts === 2)
      && effects.after.notifications?.['e-o1']?.orderId === 'o1' && !effects.after.notifications?.['e-invalid']
    f.run = createBehavioralRun(f.lab, { attemptId: 'event-host' })
    const result = command(f.run, f.lab, 'func start')
    expect(result.run.runtime.messaging.eventGrid.deliveries.map(row => row.status)).toEqual(['delivered', 'dropped'])
    expect(done(f.lab, result.run)).toBe(true)
    expect(deserializeRun(serializeRun(result.run, f.lab), f.lab).runtime.messaging.effects.notifications['e-o1'].orderId).toBe('o1')
  })
})
