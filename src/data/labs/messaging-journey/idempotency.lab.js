import { SERVICEBUS_IDEMPOTENCY_STARTER_FILES, SERVICEBUS_IDEMPOTENCY_SOLUTION_FILES } from '../../templates/messaging-python/servicebus.js'
import { messagingMetadata, messagingTask, file, command, ordersReady, orderResources, baselineReadme, exerciseTask, ORDERS_ID, orderPayload, completedOrderWork, receivedCompletion } from './helpers.js'
import { seedMessagingStage } from './seeds.js'

const duplicateSafe = messagingTask({ id: 'guard-duplicate-order',
  text: 'Implement worker.py for two prepared orders deliveries: m1 and m1-retry both contain o1, EU, quantity 2. Decode the actual receipt, check was_processed(order["id"]) before perform_order_work, and record only new work. Complete the received message even when its order was already processed. Run python worker.py. This independent baseline needs no earlier Lab completion.',
  rationale: { concept: 'Consumer idempotency before business work', what: 'Uses the business order ID to skip work already recorded while settling every delivery.', why: 'Repeated deliveries of o1 must produce one business effect. An idempotent marker alone cannot undo repeated work.', without: 'A guard after work still performs the effect twice; skipping duplicate completion leaves another unresolved delivery.', csharp: 'C# consumers also check a durable business key before work and then CompleteMessageAsync. Broker duplicate detection suppresses matching send message IDs within a configured window; it does not prevent redelivery of accepted messages. This fixture uses two send IDs for the same business order.' },
  hints: ['Place work and record inside the unprocessed branch; put complete_message after the branch.', 'The protected record store is a bounded teaching simulation, not an atomic production transaction.'],
  paths: ['worker.py', 'producer.py', 'clients.py', 'training_runtime.py'], resourceIds: orderResources, check: ordersReady,
  solution: { steps: [file('worker.py', SERVICEBUS_IDEMPOTENCY_SOLUTION_FILES['worker.py']), command('python worker.py')] },
})

function oneOrderEffect(measurement) {
  const rows = measurement.receipts.servicebus
  if (rows.length !== 2 || rows.some(row => row.entityId !== ORDERS_ID || !orderPayload(row.body, 'o1', 2))) return false
  const first = rows.find(row => row.messageId === 'm1'), duplicate = rows.find(row => row.messageId === 'm1-retry')
  if (!first || !duplicate || first.id === duplicate.id || first.sourceMessageId === duplicate.sourceMessageId) return false
  const firstReceipt = receivedCompletion(measurement, first), duplicateReceipt = receivedCompletion(measurement, duplicate)
  const applications = measurement.trace.filter(trace => ['order-work', 'order-record'].includes(trace.kind))
  return !!firstReceipt && !!duplicateReceipt && completedOrderWork(measurement, first, 'o1', 2)
    && firstReceipt.completeAt < duplicateReceipt.completeAt
    && applications.length === 2 && applications.every(trace => firstReceipt.linked(trace))
    && Object.keys(measurement.effects.after.workByOrder ?? {}).length === 1
    && Object.keys(measurement.effects.after.processed ?? {}).length === 1
}

export const idempotencyLab = {
  ...messagingMetadata, id: 'messaging-idempotency', title: 'Simulated: Make repeated order deliveries safe', journeyOrder: 4, minutes: 30,
  brief: 'Write a consumer guard before actual business work. Independent prepared baseline: rg-messaging, Standard sb-orders, orders, and two active copies of business order o1 (m1 and m1-retry). No earlier Lab is required. Each received copy must complete; bounded simulated work occurs once.',
  initialProjectFiles: { ...SERVICEBUS_IDEMPOTENCY_STARTER_FILES, 'README.md': baselineReadme('Independent prepared baseline: rg-messaging in West Europe, Standard sb-orders and active orders (max delivery count 5, expiration dead-lettering). m1 and m1-retry have distinct broker send identities and the same unprocessed payload o1/EU/quantity 2. producer.py is earlier-stage context; worker.py is unfinished. Broker send deduplication is not enabled. No business effects, completed receipts or execution proof are seeded. This models repeated delivery of a business command without requiring a prior Lab or real clock wait.') },
  initializeSimulation: run => seedMessagingStage(run, 'idempotency'), tasks: [duplicateSafe],
  messagingExercise: { commands: [{ entry: 'worker.py', mode: 'script' }], tasks: [exerciseTask(duplicateSafe, 'worker.py', oneOrderEffect)] },
}
