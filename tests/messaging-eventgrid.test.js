import { describe, it, expect } from 'vitest'
import { applyEventGridOperation } from '../src/lib/messaging/eventgrid.js'
import { emptyMessagingState, validateMessagingState } from '../src/lib/messaging/state.js'
import { createSandbox, isSandboxShape, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { createResourceGroup, createNamespace, createQueue } from '../src/lib/sandbox/ops.js'
import { applyServiceBusOperation } from '../src/lib/messaging/servicebus.js'
import { createStorageAccount, createFunctionApp } from '../src/lib/sandbox/functions.js'
import { createEventGridTopic, createEventGridSubscription } from '../src/lib/sandbox/eventgrid.js'
import { parseMessagingProject } from '../src/lib/messaging/python.js'
import { executeMessagingEntry } from '../src/lib/messaging/execute.js'
import { EVENTGRID_SOLUTION_FILES } from '../src/data/templates/messaging-python/eventgrid.js'
import { SERVICEBUS_STARTER_FILES, SERVICEBUS_SOLUTION_FILES } from '../src/data/templates/messaging-python/servicebus.js'
import { MESSAGING_RUNTIME_FILES } from '../src/data/templates/messaging-python/runtime.js'
import { runLine } from '../src/lib/az/shell.js'
import { eventgridFilteredSubscriptionLab } from '../src/data/labs/eventgrid-filtered-subscription.lab.js'
import { EVENTGRID_LABS } from '../src/data/labs/messaging-journey/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-messaging/providers`
const destination = `${root}/Microsoft.Storage/storageAccounts/stmessagingorders/blobServices/default/containers/event-deadletters`
const endpoint = 'https://orders.trainer.invalid/events'
const target = { resourceGroup: 'rg-messaging', topic: 'evgt-orders' }
const event = { id: 'e1', subject: '/orders/eu/o1', eventType: 'Contoso.OrderProcessed', data: { order_id: 'o1' }, dataVersion: '1.0' }
function fixture(options = {}) {
  let sandbox = createResourceGroup(createSandbox(), { name: 'rg-messaging', location: 'westeurope' }).sandbox
  sandbox = createStorageAccount(sandbox, { resourceGroup: 'rg-messaging', name: 'stmessagingorders' }).sandbox
  sandbox.storageAccounts[0].blobContainers = ['event-deadletters']
  sandbox = createEventGridTopic(sandbox, { resourceGroup: 'rg-messaging', name: 'evgt-orders' }).sandbox
  sandbox = createEventGridSubscription(sandbox, { resourceGroup: 'rg-messaging', topicName: 'evgt-orders', name: 'order-notifications', endpoint, ...options }).sandbox
  return { sandbox }
}
const publish = (sandbox, events = [event]) => applyEventGridOperation(emptyMessagingState(), sandbox, { kind: 'publish', target, events })
const deliver = (state, sandbox, status, deliveryId = state.eventGrid.deliveries[0].id) => applyEventGridOperation(state, sandbox, { kind: 'deliver', deliveryId, status })
const advance = (state, sandbox, milliseconds) => applyEventGridOperation(state, sandbox, { kind: 'advance', milliseconds })
const record = result => result.state.eventGrid.deliveries[0]
const out = result => result.lines.filter(line => line.kind === 'out').map(line => line.text).join('\n')
const err = result => result.lines.filter(line => line.kind === 'err').map(line => line.text).join('\n')

describe('bounded Event Grid publication and delivery', () => {
  it('causal event receipts reject journal-only publication base-field and callback timing tampering after retained trace eviction', () => {
    for (const lab of [EVENTGRID_LABS[0], EVENTGRID_LABS[1]]) {
      let run = createBehavioralRun(lab, { attemptId: `strict-event-journal-${lab.id}` })
      for (const task of lab.tasks) for (const step of task.solution.steps) {
        const result = applyRunAction(run, step.kind === 'file'
          ? { type: 'save-file', path: step.path, text: step.content } : { type: 'command', line: step.line }, lab)
        expect(result.diagnostics ?? []).toEqual([])
        run = result.run
      }
      const actual = JSON.parse(JSON.stringify(run.runtime.messaging))
      actual.eventGrid.traces = []
      expect(validateMessagingState(actual)).toBe(true)
      const changes = lab.journeyOrder === 7
        ? [{ attempts: 99 }, { deliveryId: 'nonexistent' }, { status: 'delivered' }, { reason: 'fabricated' }, { timing: 'real-Azure-time' }]
        : [{ timing: 'real-Azure-time' }]
      for (const change of changes) {
        const forged = JSON.parse(JSON.stringify(actual))
        const kind = lab.journeyOrder === 7 ? 'publish' : 'notification'
        Object.assign(forged.executionReceipts.at(-1).measurements.trace.find(row => row.kind === kind), change)
        expect(validateMessagingState(forged), `${kind} ${JSON.stringify(change)}`).toBe(false)
      }
    }
  })
  it('causal event receipts expose actual publication without a subscriber', () => {
    const { sandbox } = fixture()
    sandbox.eventGridTopics[0].eventSubscriptions = []
    const result = publish(sandbox)
    expect(result.trace[0]).toMatchObject({ kind: 'publish', topicId: `${root}/Microsoft.EventGrid/topics/evgt-orders`.toLowerCase(), event })
    expect(result.state.eventGrid.deliveries).toEqual([])
    expect(validateMessagingState(result.state)).toBe(true)
    const forged = JSON.parse(JSON.stringify(result.state))
    forged.eventGrid.traces[0].event.data.order_id = 'unrelated'
    expect(validateMessagingState(forged)).toBe(false)
  })
  it('causal event receipts bound retained event payloads after publication trace eviction', () => {
    const { sandbox } = fixture()
    sandbox.eventGridTopics[0].eventSubscriptions = []
    const result = publish(sandbox)
    const evicted = JSON.parse(JSON.stringify(result.state))
    evicted.eventGrid.traces = []
    evicted.eventGrid.events[0].event.data = { order_id: 'x'.repeat(128 * 1024) }
    expect(validateMessagingState(evicted)).toBe(false)
  })
  it('routes exact event types and case-aware subject filters with isolated fan-out', () => {
    let { sandbox } = fixture({ includedEventTypes: ['Contoso.OrderProcessed'], subjectBeginsWith: '/ORDERS/EU/', subjectEndsWith: '/o1' })
    sandbox = createEventGridSubscription(sandbox, { ...target, topicName: target.topic, name: 'second-handler', endpoint, subjectBeginsWith: '/ORDERS/EU/', isSubjectCaseSensitive: true }).sandbox
    const result = publish(sandbox, [event, { ...event, id: 'e2', eventType: 'Other' }, { ...event, id: 'e3', subject: '/orders/us/o1' }])
    expect(result.diagnostics).toEqual([])
    expect(result.value).toHaveLength(1)
    expect(record(result)).toMatchObject({ event, attempts: 0, status: 'pending', endpoint })
    expect(result.state.deliveries).toEqual([])
    expect(validateMessagingState(JSON.parse(JSON.stringify(result.state)))).toBe(true)
    sandbox = createEventGridSubscription(sandbox, { topicName: target.topic, resourceGroup: target.resourceGroup, name: 'second-handler', endpoint, subjectBeginsWith: '' }).sandbox
    const fanout = publish(sandbox)
    const success = deliver(fanout.state, sandbox, 200)
    expect(success.state.eventGrid.deliveries.map(d => d.status)).toEqual(['delivered', 'pending'])
    expect(record(fanout).status).toBe('pending')
    success.state.eventGrid.deliveries[0].event.data.order_id = 'changed'
    expect(success.state.eventGrid.deliveries[1].event.data.order_id).toBe('o1')
  })
  it.each([400, 401, 403, 413])('a webhook %i is terminal and deadletters after one attempt', status => {
    const { sandbox } = fixture({ maxDeliveryAttempts: 3, deadLetterDestination: destination })
    const result = deliver(publish(sandbox).state, sandbox, status)
    expect(record(result)).toMatchObject({ attempts: 1, status: 'deadlettered', reason: 'NonRetryableStatus', deadLetter: { destination, event } })
    expect(validateMessagingState(result.state)).toBe(true)
  })
  it('retries 503 only after a logical tick, then accepts explicit success', () => {
    const { sandbox } = fixture({ maxDeliveryAttempts: 3 })
    const transient = deliver(publish(sandbox).state, sandbox, 503)
    expect(record(transient)).toMatchObject({ attempts: 1, status: 'retrying', nextAttemptAtMs: 1000 })
    const tooEarly = deliver(transient.state, sandbox, 200)
    expect(tooEarly.state).toBe(transient.state)
    expect(tooEarly.diagnostics[0].code).toBe('MESSAGING_RUNTIME')
    const result = deliver(advance(transient.state, sandbox, 1000).state, sandbox, 202)
    expect(record(result)).toMatchObject({ attempts: 2, status: 'delivered', lastStatus: 202 })
    expect(result.trace[0].timing).toBe('logical-simulator-ticks')
  })
  it('bounds attempts and TTL by whichever expires first', () => {
    const { sandbox } = fixture({ maxDeliveryAttempts: 2, eventTimeToLiveInMinutes: 1, deadLetterDestination: destination })
    const first = deliver(publish(sandbox).state, sandbox, 503)
    const exhausted = deliver(advance(first.state, sandbox, 1000).state, sandbox, 503)
    expect(record(exhausted)).toMatchObject({ attempts: 2, status: 'deadlettered', reason: 'MaxDeliveryAttemptsExceeded' })
    const expired = advance(first.state, sandbox, 60000)
    expect(record(expired)).toMatchObject({ attempts: 1, status: 'deadlettered', reason: 'TimeToLiveExceeded' })
    expect(validateMessagingState(expired.state)).toBe(true)
    let sharedSandbox = createNamespace(sandbox, { resourceGroup: 'rg-messaging', name: 'sb-orders' }).sandbox
    sharedSandbox = createQueue(sharedSandbox, { resourceGroup: 'rg-messaging', namespace: 'sb-orders', name: 'orders', lockDuration: 'PT30S' }).sandbox
    const busTarget = { resourceGroup: 'rg-messaging', namespace: 'sb-orders', queue: 'orders' }
    const sent = applyServiceBusOperation(first.state, sharedSandbox, { kind: 'send', target: busTarget, message: { body: 'work', properties: {} } })
    const locked = applyServiceBusOperation(sent.state, sharedSandbox, { kind: 'receive', target: busTarget, receiverId: 'worker' })
    const sharedAdvance = advance(locked.state, sharedSandbox, 60000)
    expect(sharedAdvance.diagnostics).toEqual([])
    expect(Object.values(sharedAdvance.state.entities)[0].messages[0]).toMatchObject({ status: 'active', lockToken: null })
    expect(record(sharedAdvance).reason).toBe('TimeToLiveExceeded')
  })
  it('visibly drops without a destination or when the prepared container disappears', () => {
    let { sandbox } = fixture()
    expect(record(deliver(publish(sandbox).state, sandbox, 400))).toMatchObject({ status: 'dropped', deadLetter: null })
    sandbox = fixture({ deadLetterDestination: destination }).sandbox
    const pending = publish(sandbox)
    sandbox = { ...sandbox, storageAccounts: [] }
    expect(record(deliver(pending.state, sandbox, 400))).toMatchObject({ status: 'dropped', reason: 'DeadLetterDestinationUnavailable' })
  })
  it('validates persisted retry/envelope/status combinations and finite bounded operations', () => {
    const { sandbox } = fixture()
    const result = publish(sandbox)
    for (const change of [{ status: 'made-up' }, { attempts: 31 }, { event: { ...event, id: null } }, { status: 'delivered', attempts: 0 }, { deadLetter: { destination, event } }]) {
      const malformed = JSON.parse(JSON.stringify(result.state)); Object.assign(malformed.eventGrid.deliveries[0], change)
      expect(validateMessagingState(malformed)).toBe(false)
    }
    expect(publish(sandbox, Array.from({ length: 51 }, () => event)).diagnostics[0].code).toBe('MESSAGING_LIMIT')
    expect(deliver(result.state, sandbox, 99).state).toBe(result.state)
    const forged = JSON.parse(JSON.stringify(result.state))
    Object.assign(forged.eventGrid.deliveries[0], { status: 'dropped', nextAttemptAtMs: null, reason: 'NonRetryableStatus' })
    expect(validateMessagingState(forged)).toBe(false)
    const forgedTrace = JSON.parse(JSON.stringify(result.state))
    forgedTrace.eventGrid.traces[1].kind = 'delivered'
    expect(validateMessagingState(forgedTrace)).toBe(false)
    const nullRecord = JSON.parse(JSON.stringify(result.state)); nullRecord.eventGrid.deliveries[0] = null
    expect(validateMessagingState(nullRecord)).toBe(false)
  })
  it('rejects successful delivery restored as dropped or deadlettered exhaustion', () => {
    const { sandbox } = fixture({ maxDeliveryAttempts: 1, deadLetterDestination: destination })
    const successful = deliver(publish(sandbox).state, sandbox, 200)
    expect(successful.diagnostics).toEqual([])
    expect(validateMessagingState(JSON.parse(JSON.stringify(successful.state)))).toBe(true)
    for (const status of ['dropped', 'deadlettered']) {
      const malformed = JSON.parse(JSON.stringify(successful.state))
      Object.assign(malformed.eventGrid.deliveries[0], { status, reason: 'MaxDeliveryAttemptsExceeded', deadLetter: status === 'deadlettered'
        ? { destination, event, reason: 'MaxDeliveryAttemptsExceeded', attempts: 1, timeMs: 0 } : null })
      expect(validateMessagingState(malformed)).toBe(false)
    }
  })
  it('requires an actual terminal cause for unavailable-destination drops', () => {
    const { sandbox } = fixture({ maxDeliveryAttempts: 2, eventTimeToLiveInMinutes: 1, deadLetterDestination: destination })
    const pending = publish(sandbox)
    const transient = deliver(pending.state, sandbox, 503)
    expect(pending.diagnostics).toEqual([])
    expect(transient.diagnostics).toEqual([])
    for (const state of [pending.state, transient.state]) {
      const malformed = JSON.parse(JSON.stringify(state))
      Object.assign(malformed.eventGrid.deliveries[0], { status: 'dropped', nextAttemptAtMs: null, reason: 'DeadLetterDestinationUnavailable' })
      expect(validateMessagingState(malformed)).toBe(false)
    }
    const missingDestination = { ...sandbox, storageAccounts: [] }
    const outcomes = [
      advance(pending.state, missingDestination, 60000),
      deliver(pending.state, missingDestination, 400),
      deliver(advance(transient.state, missingDestination, 1000).state, missingDestination, 503),
    ]
    for (const outcome of outcomes) {
      expect(outcome.diagnostics).toEqual([])
      expect(record(outcome)).toMatchObject({ status: 'dropped', reason: 'DeadLetterDestinationUnavailable' })
      expect(validateMessagingState(JSON.parse(JSON.stringify(outcome.state)))).toBe(true)
    }
  })
  it('creates and reads CLI retry/destination fields and rejects unresolved or out-of-range values', () => {
    const { sandbox } = fixture()
    const base = 'az eventgrid topic event-subscription'
    const args = '-g rg-messaging --topic-name evgt-orders -n order-notifications'
    const created = runLine(sandbox, `${base} create ${args} --endpoint ${endpoint} --max-delivery-attempts 3 --event-ttl 1 --deadletter-endpoint ${destination}`)
    expect(err(created)).toBe('')
    const shown = JSON.parse(out(runLine(created.sandbox, `${base} show ${args}`)))
    expect(shown.properties).toMatchObject({ retryPolicy: { maxDeliveryAttempts: 3, eventTimeToLiveInMinutes: 1 }, deadLetterDestination: { endpointType: 'StorageBlob', properties: { resourceId: `${root}/Microsoft.Storage/storageAccounts/stmessagingorders`, blobContainerName: 'event-deadletters' } } })
    for (const flag of ['--max-delivery-attempts 0', '--max-delivery-attempts 31', '--event-ttl 1441', `--deadletter-endpoint ${destination.replace('event-deadletters', 'missing')}`]) expect(err(runLine(sandbox, `${base} update ${args} ${flag}`))).not.toBe('')
    expect(isSandboxShape(created.sandbox)).toBe(true)
    for (const change of [{ maxDeliveryAttempts: 31 }, { eventTimeToLiveInMinutes: 0 }, { deadLetterDestination: 'bogus' }, { endpointType: 'AzureFunction', endpoint }]) {
      const malformed = JSON.parse(JSON.stringify(created.sandbox)); Object.assign(malformed.eventGridTopics[0].eventSubscriptions[0], change)
      expect(isSandboxShape(malformed)).toBe(false)
    }
    const malformed = JSON.parse(JSON.stringify(sandbox)); malformed.storageAccounts[0].blobContainers = ['event-deadletters', 'event-deadletters']; expect(isSandboxShape(malformed)).toBe(false)
  })
  it('resolves AzureFunction ARM identity and uses its different terminal-status policy', () => {
    let { sandbox } = fixture()
    sandbox = createFunctionApp(sandbox, { resourceGroup: 'rg-messaging', name: 'func-orders', storageAccount: 'stmessagingorders', runtime: 'node', runtimeVersion: '22' }).sandbox
    const functionId = `${root}/Microsoft.Web/sites/func-orders/functions/order_event`
    const result = runLine(sandbox, `az eventgrid topic event-subscription update -g rg-messaging --topic-name evgt-orders -n order-notifications --update-endpoint-type azurefunction --endpoint ${functionId}`)
    expect(err(result)).toBe('')
    expect(JSON.parse(out(result)).properties.destination).toEqual({ endpointType: 'AzureFunction', properties: { resourceId: functionId } })
    expect(isSandboxShape(result.sandbox)).toBe(true)
    expect(record(deliver(publish(result.sandbox).state, result.sandbox, 401)).status).toBe('retrying')
    expect(record(deliver(publish(result.sandbox).state, result.sandbox, 403)).status).toBe('dropped')
    expect(err(runLine(sandbox, `az eventgrid topic event-subscription update -g rg-messaging --topic-name evgt-orders -n order-notifications --update-endpoint-type azurefunction --endpoint ${functionId.replace('func-orders', 'missing')}`))).not.toBe('')
  })
  it('preserves legacy config-only subscription shape and seed', () => {
    let sandbox = eventgridFilteredSubscriptionLab.seed(createSandbox())
    for (const task of eventgridFilteredSubscriptionLab.tasks) sandbox = runLine(sandbox, task.solution).sandbox
    const subscription = sandbox.eventGridTopics[0].eventSubscriptions[0]
    expect(subscription).toMatchObject({ endpointType: 'WebHook', endpoint: 'https://events.contoso.com/api/orders' })
    expect(subscription).not.toHaveProperty('maxDeliveryAttempts')
    expect(subscription).not.toHaveProperty('deadLetterDestination')
    expect(isSandboxShape(sandbox)).toBe(true)
  })
  it('executes aliased SDK publication and allowlisted handler source against the exact routed envelope', () => {
    let { sandbox } = fixture()
    sandbox = createNamespace(sandbox, { resourceGroup: 'rg-messaging', name: 'sb-orders' }).sandbox
    sandbox = createQueue(sandbox, { resourceGroup: 'rg-messaging', namespace: 'sb-orders', name: 'orders' }).sandbox
    const files = { ...EVENTGRID_SOLUTION_FILES, 'events.py': `from azure.eventgrid import EventGridEvent as Fact\nfrom clients import publisher as sender\ndef main():\n    sender.send(Fact(subject="/orders/eu/o1", event_type="Contoso.OrderProcessed", data={"order_id":"o1"}, data_version="1.0", id="e1"))\n` }
    const run = { project: { savedFiles: files, files: { 'handler.py': 'invalid unsaved draft' } }, sandbox, runtime: { messaging: emptyMessagingState() } }
    const lab = { messagingInput: { eventGridHandlers: { [endpoint]: 'handler.py' } } }
    const published = executeMessagingEntry(run, lab, 'events.py')
    expect(published.diagnostics).toEqual([])
    expect(published.run.runtime.messaging.eventGrid.deliveries[0].event).toEqual(event)
    const deliveryId = published.run.runtime.messaging.eventGrid.deliveries[0].id
    const handled = executeMessagingEntry(published.run, lab, 'handler.py', 'eventgrid-handler', { deliveryId })
    expect(handled.diagnostics).toEqual([])
    expect(handled.run.runtime.messaging.effects.notifications).toEqual({ e1: { eventId: 'e1', orderId: 'o1' } })
    expect(handled.run.runtime.messaging.eventGrid.deliveries[0]).toMatchObject({ status: 'delivered', lastStatus: 200 })
    const denied = executeMessagingEntry(published.run, { messagingInput: {} }, 'handler.py', 'eventgrid-handler', { deliveryId })
    expect(denied.run).toBe(published.run)
    expect(denied.diagnostics[0].code).toBe('MESSAGING_CONFIG')
    const transientFiles = { ...files, 'handler.py': 'def handle_event(event):\n    if event.event_type == "Contoso.OrderProcessed":\n        return 503\n    return 400\n' }
    const transient = executeMessagingEntry({ ...published.run, project: { savedFiles: transientFiles } }, lab, 'handler.py', 'eventgrid-handler', { deliveryId })
    expect(transient.run.runtime.messaging.eventGrid.deliveries[0]).toMatchObject({ status: 'retrying', lastStatus: 503 })
    const driven = executeMessagingEntry(published.run, lab, 'handler.py')
    expect(driven.diagnostics).toEqual([])
    expect(driven.run.runtime.messaging.eventGrid.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 1 })
    expect(driven.run.runtime.messaging.effects.notifications).toEqual({ e1: { eventId: 'e1', orderId: 'o1' } })
    expect(driven.run.runtime.messaging.eventGrid.traces.filter(trace => trace.kind === 'delivered')).toHaveLength(1)
    const recovered = executeMessagingEntry(published.run, { messagingInput: { ...lab.messagingInput, handlerStatus: { o1: [503, 200] } } }, 'handler.py')
    expect(recovered.diagnostics).toEqual([])
    expect(recovered.run.runtime.messaging.eventGrid.deliveries[0]).toMatchObject({ status: 'delivered', attempts: 2, lastStatus: 200 })
    expect(recovered.run.runtime.messaging.timeMs).toBe(1000)
    expect(recovered.run.runtime.messaging.effects.notifications).toEqual({ e1: { eventId: 'e1', orderId: 'o1' } })
    const boundedSandbox = createEventGridSubscription(sandbox, { resourceGroup: 'rg-messaging', topicName: 'evgt-orders', name: 'order-notifications', endpoint, maxDeliveryAttempts: 2 }).sandbox
    const permanentlyFailed = executeMessagingEntry({ ...published.run, sandbox: boundedSandbox, runtime: { messaging: publish(boundedSandbox).state } }, { messagingInput: { ...lab.messagingInput, handlerStatus: { o1: [503] } } }, 'handler.py')
    expect(permanentlyFailed.diagnostics).toEqual([])
    expect(permanentlyFailed.run.runtime.messaging.eventGrid.deliveries[0]).toMatchObject({ status: 'dropped', attempts: 2, reason: 'MaxDeliveryAttemptsExceeded' })
    expect(permanentlyFailed.run.runtime.messaging.effects).toEqual({})
    const forbiddenOverride = executeMessagingEntry(published.run, lab, 'handler.py', 'eventgrid-handler', { deliveryId, eventGridHandlers: { [endpoint]: 'handler.py' } })
    expect(forbiddenOverride.run).toBe(published.run)
    expect(forbiddenOverride.diagnostics[0].code).toBe('MESSAGING_CONFIG')
    const unsupportedCallback = { ...files, 'handler.py': 'from training_runtime import deliver_events\ndef handle_event(event):\n    open("secret")\n    return 200\ndef main():\n    deliver_events(handle_event)\n' }
    const rejectedCallback = executeMessagingEntry({ ...published.run, project: { savedFiles: unsupportedCallback } }, lab, 'handler.py')
    expect(rejectedCallback.run.runtime.messaging).toBe(published.run.runtime.messaging)
    expect(rejectedCallback.diagnostics[0].code).toBe('MESSAGING_UNSUPPORTED')
    const invalidRegistration = executeMessagingEntry(run, { messagingInput: { eventGridHandlers: { 'https://unregistered.trainer.invalid/events': 'handler.py' } } }, 'events.py')
    expect(invalidRegistration.run).toBe(run)
    expect(invalidRegistration.diagnostics[0].code).toBe('MESSAGING_CONFIG')
    const filteredSandbox = { ...sandbox, eventGridTopics: fixture({ includedEventTypes: ['Other'] }).sandbox.eventGridTopics }
    const filteredRun = executeMessagingEntry({ ...run, sandbox: filteredSandbox }, lab, 'events.py')
    expect(filteredRun.diagnostics).toEqual([])
    expect(filteredRun.run.runtime.messaging.eventGrid.events.map(row => row.event.id)).toEqual(['e1'])
    expect(filteredRun.run.runtime.messaging.eventGrid.deliveries).toEqual([])
    const filteredHandler = executeMessagingEntry(filteredRun.run, lab, 'handler.py')
    expect(filteredHandler.diagnostics).toEqual([])
    expect(filteredHandler.run.runtime.messaging.effects).toEqual({})
    const excluded = publish(fixture({ includedEventTypes: ['Other'] }).sandbox)
    expect(excluded.value).toEqual([])
    expect(excluded.state.effects).toEqual({})
    const old = parseMessagingProject(SERVICEBUS_STARTER_FILES, { entry: 'producer.py', fixedFiles: MESSAGING_RUNTIME_FILES })
    expect(old.diagnostics).toEqual([])
    let busSandbox = createNamespace({ ...sandbox, eventGridTopics: [] }, { resourceGroup: 'rg-messaging', name: 'sb-orders' }).sandbox
    busSandbox = createQueue(busSandbox, { resourceGroup: 'rg-messaging', namespace: 'sb-orders', name: 'orders' }).sandbox
    const oldRun = executeMessagingEntry({ project: { savedFiles: SERVICEBUS_STARTER_FILES }, sandbox: busSandbox, runtime: { messaging: emptyMessagingState() } }, { messagingInput: {} }, 'producer.py')
    expect(oldRun.diagnostics).toEqual([])
    expect(Object.values(oldRun.run.runtime.messaging.entities)[0].messages[0].messageId).toBe('m1')
    expect(oldRun.run.runtime.messaging).not.toHaveProperty('eventGrid')
    const cumulativeRun = { ...run, project: { savedFiles: { ...files, 'worker.py': SERVICEBUS_SOLUTION_FILES['worker.py'] } } }
    const cumulativeProducer = executeMessagingEntry(cumulativeRun, lab, 'producer.py')
    expect(cumulativeProducer.diagnostics).toEqual([])
    const cumulativeWorker = executeMessagingEntry(cumulativeProducer.run, lab, 'worker.py')
    expect(cumulativeWorker.diagnostics).toEqual([])
    expect(Object.values(cumulativeWorker.run.runtime.messaging.entities)[0].messages[0].status).toBe('completed')
  })
})
