import { FUNCTIONS_CAPSTONE_STARTER_FILES, FUNCTIONS_CAPSTONE_SOLUTION_FILES } from '../../templates/messaging-python/functions.js'
import { functionsMetadata, messagingTask, file, command, functionsReadme, functionsExerciseTask, FUNCTION_APP_ID, ORDERS_ID, receiptApplicationWork, receivedCompletion, exactOrder, publishedEvents, notifiedFunctionDelivery } from './helpers.js'
import { seedMessagingStage } from './seeds.js'
import { createFunctionAppTask, configureFunctionsHostTask } from './functions-servicebus.lab.js'
import { configureFunctionSubscriptionTask, functionSubscriptionReady, functionEventPaths, functionEventResources, functionFact } from './functions-eventgrid.lab.js'

const validOrders = [{ id: 'o1', region: 'EU', quantity: 2 }, { id: 'o3', region: 'EU', quantity: 1 }]
function capstoneWork(measurement) {
  const rows = measurement.receipts.servicebus
  if (rows.length !== 4 || rows.some(row => row.entityId !== ORDERS_ID)) return false
  const first = rows.find(row => row.messageId === 'm1'), duplicate = rows.find(row => row.messageId === 'm1-retry')
  const sibling = rows.find(row => row.messageId === 'm3'), invalid = rows.find(row => row.messageId === 'bad')
  if (!first || !duplicate || !sibling || !invalid) return false
  if (!receiptApplicationWork(measurement, first, validOrders[0]) || !receiptApplicationWork(measurement, sibling, validOrders[1])) return false
  const duplicateReceipt = receivedCompletion(measurement, duplicate)
  if (!duplicateReceipt || !exactOrder(JSON.parse(duplicate.body), validOrders[0])
    || measurement.trace.some(trace => ['order-work', 'order-record'].includes(trace.kind) && duplicateReceipt.linked(trace))) return false
  if (!exactOrder(JSON.parse(invalid.body), { id: 'o2', region: 'EU', quantity: 0 })
    || invalid.status !== 'deadletter' || invalid.deadLetterReason !== 'MaxDeliveryCountExceeded' || invalid.deliveryCount !== 4
    || invalid.lockHistory.length !== 3 || invalid.lockHistory.some(lock => lock.settlement !== 'abandon')) return false
  if (measurement.trace.some(trace => ['order-work', 'order-record', 'complete'].includes(trace.kind) && trace.messageRecordId === invalid.id)) return false
  if (!invalid.lockHistory.every(lock => measurement.trace.some(trace => trace.kind === 'abandon' && trace.entityId === ORDERS_ID && trace.messageRecordId === invalid.id && trace.lockToken === lock.lockToken && trace.receiverId === lock.receiverId))) return false
  if (measurement.diagnostics.length !== 3 || !invalid.lockHistory.every((lock, index) =>
    measurement.diagnostics.some(diagnostic => {
      const failure = diagnostic.handlerFailure
      return diagnostic.code === 'MESSAGING_RUNTIME' && diagnostic.errorType === 'ValueError'
        && failure?.kind === 'servicebus' && failure.appId === FUNCTION_APP_ID && failure.messageRecordId === invalid.id
        && failure.entityId === ORDERS_ID && failure.messageId === 'bad' && failure.attempt === index + 1
        && failure.lockToken === lock.lockToken && failure.receiverId === lock.receiverId
    }))) return false
  return exactOrder(measurement.effects.after.workByOrder, { o1: 1, o3: 1 })
    && Object.keys(measurement.effects.after.processed ?? {}).length === 2
    && validOrders.every(order => exactOrder(measurement.effects.after.processed?.[order.id], order))
    && measurement.trace.filter(trace => ['order-work', 'order-record'].includes(trace.kind)).length === 4
}
function capstoneEndToEnd(measurement) {
  if (!capstoneWork(measurement) || !publishedEvents(measurement, validOrders.map(functionFact))
    || measurement.receipts.eventgrid.length !== 2 || measurement.trace.filter(trace => trace.kind === 'notification').length !== 2
    || Object.keys(measurement.effects.after.notifications ?? {}).length !== 2) return false
  return validOrders.every(order => {
    const fact = functionFact(order), delivery = measurement.receipts.eventgrid.find(row => row.event.id === fact.id)
    const physical = measurement.receipts.servicebus.find(row => row.messageId === (order.id === 'o1' ? 'm1' : 'm3'))
    const receipt = receivedCompletion(measurement, physical)
    const markerAt = measurement.trace.findIndex(trace => trace.kind === 'order-record' && receipt.linked(trace))
    const publishAt = measurement.trace.findIndex(trace => trace.kind === 'publish' && trace.eventRecordId === delivery?.eventRecordId && trace.event.id === fact.id)
    return delivery?.attempts === 1 && markerAt < publishAt && publishAt < receipt.completeAt
      && measurement.trace.some((trace, index) => index > publishAt && trace.kind === 'route' && trace.deliveryId === delivery.id && trace.eventRecordId === delivery.eventRecordId)
      && notifiedFunctionDelivery(measurement, delivery, fact)
  })
}
const settings = configureFunctionsHostTask(FUNCTIONS_CAPSTONE_SOLUTION_FILES)
const notify = messagingTask({ id: 'capstone-notify-end-to-end',
  text: 'Implement both Python v2 Functions in function_app.py before starting the host. ProcessOrder must decode the actual received body, reject quantity <= 0 with ValueError before work, and guard was_processed(order["id"]) before work, record and publication. Derive Contoso.OrderProcessed after new work: ID e-<order id>, subject /orders/<region>/<id>, data version 1.0 and data {order_id, region, quantity}. NotifyOrder must call record_notification using its actual event.id and event.get_json()["order_id"]. Save and run func start once for the bounded end-to-end fixture: m1/o1 and its duplicate, invalid bad/o2 quantity0 and valid sibling m3/o3 quantity1. Require one work and e-o1 notification for o1, one work and e-o3 notification for o3, no duplicate publication, and actual ValueError abandon/redelivery/DLQ for bad with no invalid work/event. Inspect the visible intentional diagnostics; reset before a fresh replay.',
  rationale: { concept: 'End-to-end command to business fact to notification', what: 'Proves real queue work, host completion, exact event routing and same-attempt callback notification in one exercise.', why: 'Successful siblings and the linked invalid-order terminal path must remain independently observable.', without: 'Delivery success alone can hide a no-op callback; accepting all runtime errors can hide application failures.', csharp: 'C# ServiceBusTrigger and EventGridTrigger implement the same host-mediated flow; the editable track here is Python only.' },
  hints: ['Validate before work; guard before both work and publisher.send.', 'Implement both handlers before func start; the route targets NotifyOrder in the same app.'],
  paths: functionEventPaths, resourceIds: functionEventResources, check: functionSubscriptionReady,
  solution: { steps: [file('function_app.py', FUNCTIONS_CAPSTONE_SOLUTION_FILES['function_app.py']), command('func start')] },
})
export const messagingCapstoneLab = {
  ...functionsMetadata, contentVersion: 2, id: 'messaging-orders-capstone', title: 'Simulated capstone: Process orders and notify completion', journeyOrder: 12, minutes: 50, labMode: 'capstone',
  brief: 'Build the combined Python v2 Functions flow from a minimal app. Independent prepared group/namespace/queue/topic/storage and four active input messages are supplied, without work or proof. Create the app and notification route, configure the host and implement both handlers. One bounded func start includes duplicate work prevention, derived completion events, actual notifications and an intentionally invalid order reaching DLQ while valid siblings succeed. No cleanup/deployment framework or previous Lab required.',
  initialProjectFiles: { ...FUNCTIONS_CAPSTONE_STARTER_FILES, 'README.md': functionsReadme('Prepared rg-messaging in West Europe, Standard sb-orders, active orders maxDeliveryCount3, EventGridSchema evgt-orders and stmessagingorders. Active input m1/o1 EU2, m1-retry/o1 EU2, bad/o2 EU0 and m3/o3 EU1. Function App and subscription are absent; source contains only FunctionApp construction and host settings are unfinished. No completion answers, events, effects, host, execution journal or evidence are seeded. The exact bad receipt is an intentional ValueError fixture, not permission to ignore other diagnostics. Its three abandon attempts lead to MaxDeliveryCountExceeded DLQ, deliveryCount4. Successful siblings publish only e-o1/e-o3 and notify actual envelopes. Publication after work is causal teaching behavior, not atomic production outbox durability.') },
  initializeSimulation: run => seedMessagingStage(run, 'capstone'), tasks: [createFunctionAppTask(false), configureFunctionSubscriptionTask(), settings, notify],
  messagingInput: { functions: { appId: FUNCTION_APP_ID } },
  messagingExercise: { commands: [{ entry: 'function_app.py', mode: 'functions' }], expectedFailures: [{ kind: 'servicebus', entityId: ORDERS_ID, messageId: 'bad' }], tasks: [functionsExerciseTask(notify, capstoneEndToEnd)] },
}
