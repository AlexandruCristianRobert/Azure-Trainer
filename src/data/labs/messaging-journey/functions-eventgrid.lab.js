import { FUNCTIONS_EVENTGRID_STARTER_FILES, FUNCTIONS_EVENTGRID_SOLUTION_FILES } from '../../templates/messaging-python/functions.js'
import { functionsMetadata, messagingTask, file, command, functionsReady, functionsPaths, functionsResources, functionsReadme, functionsExerciseTask, EVENT_TOPIC_ID, EVENT_SUBSCRIPTION_ID, FUNCTION_APP_ID, FUNCTION_ENDPOINT, eventSubscription, eq, publishedEvents, notifiedFunctionDelivery, receivedCompletion } from './helpers.js'
import { seedMessagingStage } from './seeds.js'
import { processedFunctionOrder } from './functions-servicebus.lab.js'

export const functionEventResources = [...functionsResources, EVENT_TOPIC_ID, EVENT_SUBSCRIPTION_ID]
export const functionEventPaths = [...functionsPaths, 'clients.py']
export const functionFact = order => ({ id: `e-${order.id}`, subject: `/orders/${order.region}/${order.id}`, eventType: 'Contoso.OrderProcessed', dataVersion: '1.0', data: { order_id: order.id, region: order.region, quantity: order.quantity } })
export const functionSubscriptionReady = context => {
  const row = eventSubscription(context.sandbox)
  return functionsReady(context) && row?.endpointType === 'AzureFunction' && eq(row.endpoint, FUNCTION_ENDPOINT)
    && row.filter.includedEventTypes.length === 1 && row.filter.includedEventTypes[0] === 'Contoso.OrderProcessed'
    && row.filter.subjectBeginsWith === '/orders/EU/' && row.filter.subjectEndsWith === ''
}
export const configureFunctionSubscriptionTask = () => messagingTask({ id: 'event-function-route',
  text: `Create order-notifications on the prepared evgt-orders topic with endpoint type AzureFunction, endpoint ${FUNCTION_ENDPOINT}, included type Contoso.OrderProcessed and subject prefix /orders/EU/. This route targets the new NotifyOrder handler; the supplied ProcessOrder Function publishes actual completed-order facts.`,
  rationale: { concept: 'Event Grid Function endpoint', what: 'Routes selected application event envelopes to a named Function handler.', why: 'An event subscription connects completed work to its independent notification consumer.', without: 'Publication alone does not invoke NotifyOrder or prove notification.', csharp: 'C# EventGridTrigger consumes the same event envelope through its host binding.' },
  check: functionSubscriptionReady,
  solution: { steps: [command(`az eventgrid topic event-subscription create --resource-group rg-messaging --topic-name evgt-orders --name order-notifications --endpoint-type azurefunction --endpoint ${FUNCTION_ENDPOINT} --included-event-types Contoso.OrderProcessed --subject-begins-with /orders/EU/`)] },
})
function notifiedOrder(measurement) {
  if (!processedFunctionOrder(measurement) || measurement.receipts.eventgrid.length !== 1) return false
  const physical = measurement.receipts.servicebus[0], receipt = receivedCompletion(measurement, physical)
  if (!receipt) return false
  const fact = functionFact(JSON.parse(physical.body)), [row] = measurement.receipts.eventgrid
  const markerAt = measurement.trace.findIndex(trace => trace.kind === 'order-record' && receipt.linked(trace))
  const publishAt = measurement.trace.findIndex(trace => trace.kind === 'publish' && trace.eventRecordId === row.eventRecordId && trace.event.id === fact.id)
  return publishedEvents(measurement, [fact]) && markerAt >= 0 && markerAt < publishAt && publishAt < receipt.completeAt
    && row.attempts === 1 && notifiedFunctionDelivery(measurement, row, fact)
    && measurement.trace.some(trace => trace.kind === 'route' && trace.deliveryId === row.id && trace.eventRecordId === row.eventRecordId)
    && measurement.trace.filter(trace => trace.kind === 'notification').length === 1
    && Object.keys(measurement.effects.after.notifications ?? {}).length === 1
}
const notify = messagingTask({ id: 'eventgrid-function',
  text: 'Add NotifyOrder to function_app.py with @app.function_name(name="NotifyOrder"), @app.event_grid_trigger(arg_name="event") and a func.EventGridEvent parameter. Read event.get_json() and record_notification(event.id, data["order_id"]) from that actual envelope. Keep the supplied queue Function, save, then run func start once: processing o1 derives e-o1 /orders/EU/o1 with order_id o1, region EU, quantity 2 before the new callback notifies it.',
  rationale: { concept: 'Event Grid trigger after completed business work', what: 'Consumes the actual application event data and records its notification during the Function callback.', why: 'A successful delivery acknowledgement must follow the intended notification effect in the same attempt.', without: 'A handler that returns successfully without notification cannot prove the business reaction.', csharp: 'Python event.get_json() parallels reading C# EventGridEvent.Data; this non-HTTP Function uses host success acknowledgement.' },
  paths: functionEventPaths, resourceIds: functionEventResources, check: functionSubscriptionReady,
  solution: { steps: [file('function_app.py', FUNCTIONS_EVENTGRID_SOLUTION_FILES['function_app.py']), command('func start')] },
})
export const functionsEventgridLab = {
  ...functionsMetadata, id: 'messaging-functions-eventgrid', title: 'Simulated: React to order completion with an Event Grid Function', journeyOrder: 11, minutes: 30,
  brief: 'Independent prepared storage, Python app/settings, Event Grid topic and earlier Service Bus Function are supplied as source/configuration. No upstream work or completion proof has run. Create the new subscription and write the new Event Grid Function, then func start processes the fresh o1 input and invokes its actual notification callback.',
  initialProjectFiles: { ...FUNCTIONS_EVENTGRID_STARTER_FILES, 'README.md': functionsReadme('Prepared rg-messaging/Standard sb-orders/orders with unprocessed m1 o1/EU/quantity2, stmessagingorders, Python3.12 Functions4 Linux Flex func-orders and EventGridSchema evgt-orders. The earlier ProcessOrder Function and valid host settings are supplied; it has not executed. New order-notifications and NotifyOrder are absent. No events, effects, evidence or journal are seeded. No earlier Lab completion is required.') },
  initializeSimulation: run => seedMessagingStage(run, 'functions-eventgrid'), tasks: [configureFunctionSubscriptionTask(), notify],
  messagingInput: { functions: { appId: FUNCTION_APP_ID } },
  messagingExercise: { commands: [{ entry: 'function_app.py', mode: 'functions' }], tasks: [functionsExerciseTask(notify, notifiedOrder)] },
}
