import { SERVICEBUS_DEADLETTER_STARTER_FILES, SERVICEBUS_DEADLETTER_SOLUTION_FILES } from '../../templates/messaging-python/servicebus.js'
import { messagingMetadata, messagingTask, file, command, ordersReady, orderResources, baselineReadme, exerciseTask, ORDERS_ID, orderPayload, receiptOperation, completedOrderWork } from './helpers.js'
import { seedMessagingStage } from './seeds.js'

const paths = ['worker.py', 'producer.py', 'clients.py', 'training_runtime.py']
const quarantine = messagingTask({ id: 'quarantine-invalid', text: 'Implement worker.process_orders in worker.py. Decode actual orders receipts; dead-letter quantity <= 0 with reason InvalidOrder. For valid orders perform work, record success, then complete. Prepared inputs: m1 (o1, EU, quantity 2) and bad (o2, EU, quantity 0). The recovery driver in the next Task runs this worker before and after repair in one simulated exercise.',
  rationale: { concept: 'Dead-lettering invalid commands', what: 'Separates a rejected receipt from active processing while retaining its body and diagnostic reason.', why: 'A nonpositive order quantity needs correction, while its valid sibling should finish.', without: 'Invalid business work may occur or poison deliveries remain unresolved.', csharp: 'C# DeadLetterMessageAsync takes the received message and a reason.' },
  hints: ['Use dead_letter_message on the actual receipt in the invalid branch; do not record invalid orders as processed.'],
  paths, resourceIds: orderResources, check: ordersReady,
  solution: { steps: [file('worker.py', SERVICEBUS_DEADLETTER_SOLUTION_FILES['worker.py'])] } })
const recovery = messagingTask({ id: 'recover-order', text: 'Implement producer.py as the recovery driver: run process_orders, read orders with ServiceBusSubQueue.DEAD_LETTER, inspect the received message ID and reason, decode its actual body and correct quantity to 1. Send a new ServiceBusMessage with the original message ID plus -recovered, complete the DLQ original, then run process_orders again. Run python producer.py to verify quarantine, corrected resend and successful business processing together.',
  rationale: { concept: 'DLQ recovery and corrected resend', what: 'Reads a quarantined receipt, sends a corrected new message, and settles the original only after sending.', why: 'Order o2 must return to active processing without leaving an unresolved DLQ copy.', without: 'Removing the original before resend can lose the order; skipping settlement leaves another recoverable copy.', csharp: 'C# uses SubQueue.DeadLetter, creates a new ServiceBusMessage and completes the original receipt.' },
  hints: ['Use a DLQ receiver, a queue sender and the decoded received payload. Sending does not settle the DLQ original.', 'The same worker must consume the corrected new active receipt; direct record-store writes cannot prove recovery.'],
  paths, resourceIds: orderResources, check: ordersReady,
  solution: { steps: [file('producer.py', SERVICEBUS_DEADLETTER_SOLUTION_FILES['producer.py']), command('python producer.py')] } })

// Both Tasks consume this one current command window, not archived evidence.
function quarantinedAndRecovered(measurement) {
  const rows = measurement.receipts.servicebus
  if (rows.length !== 3 || rows.some(row => row.entityId !== ORDERS_ID)) return false
  const good = rows.find(row => row.messageId === 'm1'), bad = rows.find(row => row.messageId === 'bad'), repaired = rows.find(row => row.messageId === 'bad-recovered')
  if (!good || !bad || !repaired || bad.id === repaired.id || bad.sourceMessageId === repaired.sourceMessageId) return false
  const quarantineAt = receiptOperation(measurement, bad, 'deadletter', 'active')
  const originalCompleteAt = receiptOperation(measurement, bad, 'complete', 'deadletter')
  const resendAt = receiptOperation(measurement, repaired, 'enqueue', 'active')
  const repairedCompleteAt = receiptOperation(measurement, repaired, 'complete', 'active')
  const dlqReceiveAt = measurement.trace.findIndex(trace => trace.kind === 'receive' && trace.messageRecordId === bad.id && trace.subQueue === 'deadletter' && trace.lockToken === bad.lockHistory[1]?.lockToken)
  return good.status === 'completed' && good.subQueue === 'active' && orderPayload(good.body, 'o1', 2)
    && receiptOperation(measurement, good, 'complete', 'active') >= 0 && good.lockHistory.length === 1
    && bad.status === 'completed' && bad.subQueue === 'deadletter' && orderPayload(bad.body, 'o2', 0)
    && bad.deadLetterReason === 'InvalidOrder' && bad.lockHistory.length === 2 && quarantineAt >= 0
    && measurement.trace[quarantineAt].reason === 'InvalidOrder'
    && dlqReceiveAt > quarantineAt && resendAt > dlqReceiveAt && originalCompleteAt > resendAt
    && repaired.status === 'completed' && repaired.subQueue === 'active' && orderPayload(repaired.body, 'o2', 1)
    && repaired.lockHistory.length === 1 && repairedCompleteAt > originalCompleteAt
    && measurement.trace.some(trace => trace.kind === 'send' && trace.entityId === ORDERS_ID && trace.messageId === repaired.messageId && trace.sourceMessageId === repaired.sourceMessageId)
    && measurement.trace.some((trace, index) => index > originalCompleteAt && index < repairedCompleteAt && trace.kind === 'receive' && trace.messageRecordId === repaired.id && trace.subQueue === 'active' && trace.lockToken === repaired.lockHistory[0].lockToken)
    && completedOrderWork(measurement, 'o1', 2) && completedOrderWork(measurement, 'o2', 1)
    && Object.keys(measurement.effects.after.workByOrder ?? {}).length === 2
    && Object.keys(measurement.effects.after.processed ?? {}).length === 2
}

export const deadletterLab = {
  ...messagingMetadata, id: 'messaging-deadletter', title: 'Simulated: Quarantine and recover an invalid order', journeyOrder: 3, minutes: 40,
  brief: 'Write validation and DLQ recovery with Python SDK-shaped calls. Independent supplied baseline: rg-messaging, Standard sb-orders, orders, valid m1 and invalid bad; both are active and unprocessed. No previous Lab is required. One bounded simulated exercise rejects, corrects, resends and completes actual receipts.',
  initialProjectFiles: { ...SERVICEBUS_DEADLETTER_STARTER_FILES, 'README.md': baselineReadme('Prepared baseline: rg-messaging in West Europe, Standard sb-orders, active orders with max delivery count 5 and expiration dead-lettering. Active m1 contains o1, EU, quantity 2; active bad contains o2, EU, quantity 0. Both worker.py and the producer.py recovery driver are unfinished. No DLQ/completed receipts, business work or verification are prepared. Save both implementations, then python producer.py runs the worker, repairs actual DLQ receipts, settles originals, and runs the worker on corrected resends. No earlier Lab completion is needed.') },
  initializeSimulation: run => seedMessagingStage(run, 'deadletter'), tasks: [quarantine, recovery],
  messagingExercise: { commands: [{ entry: 'producer.py', mode: 'script' }], tasks: [exerciseTask(quarantine, 'producer.py', quarantinedAndRecovered), exerciseTask(recovery, 'producer.py', quarantinedAndRecovered)] },
}
