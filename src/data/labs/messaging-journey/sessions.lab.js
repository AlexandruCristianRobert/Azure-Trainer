import { SERVICEBUS_SESSIONS_STARTER_FILES, SERVICEBUS_SESSIONS_SOLUTION_FILES } from '../../templates/messaging-python/servicebus.js'
import { messagingMetadata, messagingTask, file, command, ordersNamespace, baselineReadme, exerciseTask, GROUP_ID, NAMESPACE_ID, exactOrder, receivedCompletion, receiptApplicationWork } from './helpers.js'
import { seedMessagingStage } from './seeds.js'

const STEPS_ID = `${NAMESPACE_ID}/queues/order-steps`
const sessionsReady = ({ sandbox }) => ordersNamespace(sandbox)?.sku === 'Standard'
  && ordersNamespace(sandbox)?.queues.some(row => row.name === 'order-steps' && row.status === 'Active' && row.requiresSession === true)
const configure = messagingTask({ id: 'configure-order-sessions',
  text: 'Create session-enabled queue order-steps on prepared Standard sb-orders in rg-messaging with --enable-session true. This independent baseline supplies earlier-stage configuration only; no earlier Lab completion is needed.',
  rationale: { concept: 'Session-enabled queue', what: 'Requires a session ID on messages and an explicit session lease when receiving.', why: 'Steps belonging to o1 need one consumer to own that session while processing them in queue sequence.', without: 'Ordinary queue locks do not establish exclusive ownership of a related sequence.', csharp: 'C# uses AcceptSessionAsync(queueName, sessionId) and ServiceBusSessionReceiver. Ordering is scoped to one session, not global across sessions.' },
  check: sessionsReady,
  solution: { steps: [command('az servicebus queue create --resource-group rg-messaging --namespace-name sb-orders --name order-steps --enable-session true')] },
})
const dependencies = { paths: ['producer.py', 'worker.py', 'clients.py', 'training_runtime.py'], resourceIds: [GROUP_ID, NAMESPACE_ID, STEPS_ID], check: sessionsReady }
const publish = messagingTask({ id: 'publish-order-steps',
  text: 'Implement producer.py: send o1-step1 (o1, EU, quantity 2, step 1), o2-step1 (o2, EU, quantity 1, step 1), then o1-step2 (o1, EU, quantity 2, step 2) to order-steps. Set session_id from each actual order ID. Call worker.process_steps after sending. Save the producer; the next Task runs the full exercise.',
  rationale: { concept: 'Session identity groups related steps', what: 'Sets the broker session envelope independently of the JSON body.', why: 'Interleaving o2 demonstrates that the o1 receiver selects only its own two related steps.', without: 'A missing session ID is rejected, while a wrong ID separates the related steps.', csharp: 'C# sets ServiceBusMessage.SessionId to the order ID before sending.' },
  ...dependencies, solution: { steps: [file('producer.py', SERVICEBUS_SESSIONS_SOLUTION_FILES['producer.py'])] },
})
const consume = messagingTask({ id: 'process-session-in-order',
  text: 'Implement worker.process_steps using get_queue_receiver(queue_name="order-steps", session_id="o1"). Receive o1 steps in sequence, decode actual messages, perform each distinct step, record and complete each copy after its work. Run python producer.py. Step 1 and step 2 are different work even though both have order ID o1: do not reuse the earlier whole-order was_processed guard, which would skip step 2. Leave o2 unconsumed.',
  rationale: { concept: 'Session lease and ordered step work', what: 'Owns explicit session o1 and executes its two actual steps in received order.', why: 'Step identity is (order ID, step), so both steps need work. The shared processed teaching marker retains the first order record; its later no-op does not replace the second step effect.', without: 'Reordering business work defeats session sequencing, and a whole-order guard suppresses valid later steps. Other sessions have independent ordering; there is no global order guarantee.', csharp: 'C# ServiceBusSessionReceiver owns a session lease; sequential handler execution preserves the received order within that session.' },
  hints: ['Use one explicit o1 receiver and process its returned messages sequentially.', 'The interleaved o2 receipt must remain active and have no business work or processed marker.'],
  ...dependencies, solution: { steps: [file('worker.py', SERVICEBUS_SESSIONS_SOLUTION_FILES['worker.py']), command('python producer.py')] },
})

function orderedSessionSteps(measurement) {
  const rows = measurement.receipts.servicebus
  if (rows.length !== 3 || rows.some(row => row.entityId !== STEPS_ID)) return false
  const first = rows.find(row => row.messageId === 'o1-step1'), second = rows.find(row => row.messageId === 'o1-step2'), other = rows.find(row => row.messageId === 'o2-step1')
  if (!first || !second || !other || new Set(rows.map(row => row.sourceMessageId)).size !== 3) return false
  const firstOrder = { id: 'o1', region: 'EU', quantity: 2, step: 1 }, secondOrder = { ...firstOrder, step: 2 }
  const firstReceipt = receivedCompletion(measurement, first), secondReceipt = receivedCompletion(measurement, second)
  if (!firstReceipt || !secondReceipt) return false
  const work = measurement.trace.filter(trace => trace.kind === 'order-work')
  return first.sessionId === 'o1' && second.sessionId === 'o1' && other.sessionId === 'o2'
    && first.sequence < other.sequence && other.sequence < second.sequence
    && other.status === 'active' && other.subQueue === 'active' && other.lockHistory.length === 0
    && exactOrder(JSON.parse(other.body), { id: 'o2', region: 'EU', quantity: 1, step: 1 })
    && rows.every(row => Object.keys(row.properties).length === 0
      && measurement.trace.some(trace => trace.kind === 'send' && trace.entityId === STEPS_ID && trace.messageId === row.messageId && trace.sourceMessageId === row.sourceMessageId && trace.sessionId === row.sessionId)
      && measurement.trace.some(trace => trace.kind === 'enqueue' && trace.messageRecordId === row.id && trace.entityId === STEPS_ID))
    && first.lockHistory[0].receiverId === second.lockHistory[0].receiverId
    && firstReceipt.receiveAt < secondReceipt.receiveAt && firstReceipt.completeAt < secondReceipt.completeAt
    && measurement.trace[firstReceipt.receiveAt].sessionId === 'o1' && measurement.trace[secondReceipt.receiveAt].sessionId === 'o1'
    && receiptApplicationWork(measurement, first, firstOrder) && receiptApplicationWork(measurement, second, secondOrder, false)
    && work.length === 2 && firstReceipt.linked(work[0]) && secondReceipt.linked(work[1])
    && !measurement.trace.some(trace => ['receive', 'order-work', 'order-record', 'complete'].includes(trace.kind) && trace.messageRecordId === other.id)
    && measurement.trace.filter(trace => ['order-work', 'order-record'].includes(trace.kind)).length === 4
    && (measurement.effects.after.workByOrder?.o1 ?? 0) - (measurement.effects.before.workByOrder?.o1 ?? 0) === 2
    && Object.keys(measurement.effects.after.workByOrder ?? {}).length === 1
    && Object.keys(measurement.effects.after.processed ?? {}).length === 1
    && exactOrder(measurement.effects.after.processed.o1, firstOrder)
}

export const sessionsLab = {
  ...messagingMetadata, id: 'messaging-sessions', title: 'Simulated: Own a session and process ordered steps', journeyOrder: 6, minutes: 35,
  brief: 'Create session-enabled order-steps and write a producer plus explicit o1 session consumer. Independent baseline supplies rg-messaging, Standard sb-orders and empty earlier-stage orders configuration only. No earlier Lab is required. Interleaved o2 stays unconsumed; ordering is per session in this bounded simulation.',
  initialProjectFiles: { ...SERVICEBUS_SESSIONS_STARTER_FILES, 'README.md': baselineReadme('Independent prepared baseline: rg-messaging in West Europe, Standard sb-orders and empty earlier-stage orders queue. New order-steps configuration, producer.py and worker.py are unfinished. No messages, business effects, completed receipts, evidence or execution journal are prepared. The one python producer.py exercise sends o1 step 1, o2 step 1, o1 step 2, then selects explicit session o1. Distinct steps each perform work; whole-order duplicate guards are inappropriate for step identity. The processed teaching marker retains the first record and the second marker is a no-op. o2 remains active. A session lease orders related received work only; no global or production durability guarantee is demonstrated.') },
  initializeSimulation: run => seedMessagingStage(run, 'sessions'), tasks: [configure, publish, consume],
  messagingExercise: { commands: [{ entry: 'producer.py', mode: 'script' }], tasks: [exerciseTask(publish, 'producer.py', orderedSessionSteps), exerciseTask(consume, 'producer.py', orderedSessionSteps)] },
}
