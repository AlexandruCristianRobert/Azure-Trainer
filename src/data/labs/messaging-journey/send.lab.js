import { SERVICEBUS_SEND_STARTER_FILES, SERVICEBUS_SEND_SOLUTION_FILES } from '../../templates/messaging-python/servicebus.js'
import { messagingMetadata, messagingTask, file, command, eq, ordersNamespace, ordersQueue, ordersReady, orderResources, baselineReadme, exerciseTask, ORDERS_ID, orderPayload, receiptOperation } from './helpers.js'
import { seedMessagingStage } from './seeds.js'

const provision = [
  messagingTask({ id: 'resource-group', text: 'Create rg-messaging in West Europe for the simulated order-processing application.',
    rationale: { concept: 'Resource group', what: 'Groups resources under one lifecycle and location choice.', why: 'The orders namespace needs an owned deployment scope.', without: 'The namespace cannot be created in the requested application group.' },
    hints: ['Use az group create with a name and location.'],
    solution: { steps: [command('az group create --name rg-messaging --location westeurope')] },
    check: ({ sandbox }) => sandbox.resourceGroups.some(row => eq(row.name, 'rg-messaging') && row.location === 'westeurope') }),
  messagingTask({ id: 'namespace', text: 'Create Standard Service Bus namespace sb-orders in rg-messaging. The supplied clients.py uses its SDK-shaped endpoint and simulated DefaultAzureCredential identity.',
    rationale: { concept: 'Service Bus namespace and identity', what: 'A namespace hosts messaging entities; the credential supplies a client identity.', why: 'Standard supports the later topic, duplicate-detection and session exercises.', without: 'The client has no matching namespace; Basic cannot support those later features.', csharp: 'ServiceBusClient also takes a namespace and TokenCredential in C#.' },
    hints: ['Use az servicebus namespace create and --sku Standard. This trainer does not test real Azure permissions.'],
    solution: { steps: [command('az servicebus namespace create --resource-group rg-messaging --name sb-orders --sku Standard')] },
    check: ({ sandbox }) => ordersNamespace(sandbox)?.sku === 'Standard' }),
  messagingTask({ id: 'queue', text: 'Create orders in sb-orders with max delivery count 5 and dead-lettering on expiration enabled. This queue buffers order commands for a background worker.',
    rationale: { concept: 'Service Bus queue', what: 'Retains a message for one competing consumer and holds failed deliveries separately.', why: 'Order intake and processing can run independently while exposing poison or expired orders.', without: 'There is no orders destination or bounded failure policy.' },
    hints: ['Set --max-delivery-count and --enable-dead-lettering-on-message-expiration on queue create.'],
    solution: { steps: [command('az servicebus queue create --resource-group rg-messaging --namespace-name sb-orders --name orders --max-delivery-count 5 --enable-dead-lettering-on-message-expiration true')] },
    check: context => ordersReady(context) && ordersQueue(context.sandbox)?.maxDeliveryCount === 5 && ordersQueue(context.sandbox)?.deadLetteringOnMessageExpiration === true }),
]
const send = messagingTask({ id: 'send-order', text: 'Implement producer.py to serialize order o1, region EU, quantity 2 into a ServiceBusMessage with message ID m1. Send it to orders using the supplied bus client and run python producer.py. Verification inspects the actual simulated queue receipt.',
  rationale: { concept: 'SDK sender and message envelope', what: 'Serializes business data into a message body and sends the envelope through a queue sender.', why: 'The worker must receive this order payload and stable transport identity.', without: 'No order reaches the queue, or incorrect data reaches processing.', csharp: 'C# uses a ServiceBusSender and ServiceBusMessage with a serialized body and MessageId.' },
  hints: ['Use json.dumps for the dictionary, then bus.get_queue_sender and send_messages.', 'Run the saved producer to generate a fresh enqueue receipt.'],
  paths: ['producer.py', 'clients.py'], resourceIds: orderResources, check: ordersReady,
  solution: { steps: [file('producer.py', SERVICEBUS_SEND_SOLUTION_FILES['producer.py']), command('python producer.py')] } })

function sentOrder(measurement) {
  const rows = measurement.receipts.servicebus
  if (rows.length !== 1) return false
  const row = rows[0]
  return row.entityId === ORDERS_ID && row.messageId === 'm1' && row.status === 'active' && row.subQueue === 'active'
    && orderPayload(row.body, 'o1', 2) && Object.keys(row.properties).length === 0
    && receiptOperation(measurement, row, 'enqueue') >= 0
    && measurement.trace.filter(trace => trace.kind === 'send').length === 1
    && measurement.trace.some(trace => trace.kind === 'send' && trace.entityId === ORDERS_ID && trace.messageId === row.messageId && trace.sourceMessageId === row.sourceMessageId)
    && Object.keys(measurement.effects.after).length === 0
}

export const sendLab = {
  ...messagingMetadata, id: 'messaging-send', title: 'Simulated: Send order commands with Service Bus', journeyOrder: 1, minutes: 30,
  brief: 'Create the order queue and write a Python SDK-shaped sender. Execution is simulated: no Azure deployment, authentication or Python process runs. clients.py supplies a simulated identity; you create the resources and send the actual order payload.',
  initialProjectFiles: { ...SERVICEBUS_SEND_STARTER_FILES, 'README.md': baselineReadme('No application resources or messages are prepared. Create rg-messaging, Standard sb-orders and orders, then implement producer.py. The supplied clients.py targets sb-orders; new work starts unfinished.') },
  initializeSimulation: run => seedMessagingStage(run, 'send'), tasks: [...provision, send],
  messagingExercise: { commands: [{ entry: 'producer.py', mode: 'script' }], tasks: [exerciseTask(send, 'producer.py', sentOrder)] },
}
