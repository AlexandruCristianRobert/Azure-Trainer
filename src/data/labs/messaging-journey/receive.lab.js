import { SERVICEBUS_RECEIVE_STARTER_FILES, SERVICEBUS_RECEIVE_SOLUTION_FILES } from '../../templates/messaging-python/servicebus.js'
import { messagingMetadata, messagingTask, file, command, ordersReady, orderResources, baselineReadme, exerciseTask, ORDERS_ID, orderPayload, receiptOperation, completedOrderWork } from './helpers.js'
import { seedMessagingStage } from './seeds.js'

const receive = messagingTask({ id: 'process-order', text: 'Implement worker.py to receive the prepared orders message m1 (o1, EU, quantity 2) with PeekLock. Decode json.loads(str(message)), perform the order work, record the processed order, and only then complete the actual received message. Run python worker.py; no prior Lab completion is required.',
  rationale: { concept: 'PeekLock and explicit completion', what: 'Temporarily owns a received message until the consumer completes, abandons or dead-letters it.', why: 'An order must finish business work and record success before removing its queue delivery.', without: 'Completing early loses unfinished work; omitting completion leaves the message locked and eligible for redelivery.', csharp: 'C# CompleteMessageAsync settles the received ServiceBusReceivedMessage after processing.' },
  hints: ['The protected helpers separate business work from its processed marker; call work, then record, then complete.', 'Use the real received message in complete_message, not the decoded order dictionary.'],
  paths: ['worker.py', 'clients.py', 'training_runtime.py', 'producer.py'], resourceIds: orderResources, check: ordersReady,
  solution: { steps: [file('worker.py', SERVICEBUS_RECEIVE_SOLUTION_FILES['worker.py']), command('python worker.py')] } })

function processedOrder(measurement) {
  const rows = measurement.receipts.servicebus
  if (rows.length !== 1) return false
  const row = rows[0], completed = receiptOperation(measurement, row, 'complete', 'active')
  return row.entityId === ORDERS_ID && row.messageId === 'm1' && row.status === 'completed' && row.subQueue === 'active'
    && orderPayload(row.body, 'o1', 2) && row.lockHistory.length === 1 && completed >= 0
    && measurement.trace.some((trace, index) => index < completed && trace.kind === 'receive' && trace.messageRecordId === row.id && trace.lockToken === row.lockHistory[0].lockToken)
    && completedOrderWork(measurement, row, 'o1', 2)
    && measurement.trace.filter(trace => ['order-work', 'order-record'].includes(trace.kind)).length === 2
    && Object.keys(measurement.effects.after.workByOrder ?? {}).length === 1
    && Object.keys(measurement.effects.after.processed ?? {}).length === 1
}

export const receiveLab = {
  ...messagingMetadata, id: 'messaging-receive', title: 'Simulated: Receive, process and complete an order', journeyOrder: 2, minutes: 30,
  brief: 'Write a Python SDK-shaped PeekLock consumer. Independent supplied baseline: rg-messaging, Standard sb-orders, orders and unprocessed m1 (o1, EU, quantity 2). No previous Lab is required. Execution, identity and record store are bounded trainer simulations.',
  initialProjectFiles: { ...SERVICEBUS_RECEIVE_STARTER_FILES, 'README.md': baselineReadme('Prepared baseline: rg-messaging in West Europe, Standard sb-orders, active orders with max delivery count 5 and expiration dead-lettering. One active m1 contains o1, EU, quantity 2. producer.py is supplied context; worker.py is unfinished. No business work, completion receipts or verification are prepared; earlier Lab completion is unnecessary.') },
  initializeSimulation: run => seedMessagingStage(run, 'receive'), tasks: [receive],
  messagingExercise: { commands: [{ entry: 'worker.py', mode: 'script' }], tasks: [exerciseTask(receive, 'worker.py', processedOrder)] },
}
