import { EVENTGRID_FILTER_STARTER_FILES, EVENTGRID_FILTER_SOLUTION_FILES } from '../../templates/messaging-python/eventgrid.js'
import { messagingMetadata, messagingTask, file, command, eventReady, eventSubscription, eventResources, eventReadme, exerciseTask, publishedEvents, notifiedDelivery, exactEvent, EVENT_SUBSCRIPTION_ID, EVENT_ENDPOINT } from './helpers.js'
import { seedMessagingStage } from './seeds.js'
import { createEventTopicTask, EU_FACT } from './publish-events.lab.js'

export const FILTER_FACTS = Object.freeze([EU_FACT,
  { id: 'e-us', subject: '/orders/us/o2', eventType: 'Contoso.OrderProcessed', data: { order_id: 'o2', region: 'US', quantity: 1 }, dataVersion: '1.0' },
  { id: 'e-other', subject: '/orders/eu/o3', eventType: 'Contoso.OrderAccepted', data: { order_id: 'o3', region: 'EU', quantity: 1 }, dataVersion: '1.0' },
])
export const eventFilterReady = ({ sandbox }) => {
  const row = eventSubscription(sandbox), filter = row?.filter
  return row?.endpointType === 'WebHook' && row.endpoint === EVENT_ENDPOINT && filter.includedEventTypes.length === 1
    && filter.includedEventTypes[0] === 'Contoso.OrderProcessed' && filter.subjectBeginsWith === '/orders/eu/'
    && filter.subjectEndsWith === '' && !filter.isSubjectCaseSensitive
}
const configure = messagingTask({ id: 'filter-order-notifications',
  text: 'Create order-notifications on evgt-orders, with WebHook endpoint https://orders.trainer.invalid/events. Include only Contoso.OrderProcessed and subject prefix /orders/eu/ with default case-insensitive matching. The Lab registers that simulated endpoint to handler.py; registration is not webhook deployment.',
  rationale: { concept: 'Event type and subject filtering', what: 'Routes only events matching both the explicit event type and literal subject prefix.', why: 'The EU notification consumer should ignore US completions and EU order-accepted events.', without: 'Unrelated events trigger business notifications, or the intended event never arrives.', csharp: 'C# delivery receives the same filtered EventGridEvent; filters are subscription configuration, not a client-side predicate.' },
  hints: ['Use topic event-subscription create with --included-event-types and --subject-begins-with.'],
  solution: { steps: [command(`az eventgrid topic event-subscription create --resource-group rg-messaging --topic-name evgt-orders --name order-notifications --endpoint ${EVENT_ENDPOINT} --included-event-types Contoso.OrderProcessed --subject-begins-with /orders/eu/`)] },
  check: context => eventReady(context) && eventFilterReady(context),
})
const resources = [...eventResources, EVENT_SUBSCRIPTION_ID]
const paths = ['events.py', 'handler.py', 'clients.py', 'training_runtime.py']
const publish = messagingTask({ id: 'publish-filter-fixture',
  text: 'Implement events.py with publish_events() and main(). Publish three application events (data version 1.0): e-eu, Contoso.OrderProcessed, /orders/eu/o1, {order_id: o1, region: EU, quantity: 2}; e-us, Contoso.OrderProcessed, /orders/us/o2, {order_id: o2, region: US, quantity: 1}; e-other, Contoso.OrderAccepted, /orders/eu/o3, {order_id: o3, region: EU, quantity: 1}. Save events.py and run python events.py to verify publication and routing before implementing the callback.',
  rationale: { concept: 'Publish facts for routing', what: 'Sends actual SDK-shaped event envelopes that exercise both filter dimensions.', why: 'Observed route isolation should follow real event metadata rather than a handler pretending events were filtered.', without: 'There is no actual publication proving which events the subscription accepted.', csharp: 'C# constructs the same three EventGridEvent envelopes and sends them as a batch.' },
  paths: paths.filter(path => path !== 'handler.py'), resourceIds: resources, check: context => eventReady(context) && !!eventSubscription(context.sandbox),
  solution: { steps: [file('events.py', EVENTGRID_FILTER_SOLUTION_FILES['events.py']), command('python events.py')] },
})
const handle = messagingTask({ id: 'handle-filtered-event',
  text: 'Write handle_event(event) in handler.py. Read order_id from the actual event.data, obtain handler_status(order_id), record_notification(event.id, order_id) only on status 200, then return that integer status. In main(), call deliver_events(handle_event) and print its attempt count. Save and run python handler.py once to consume the already published fixture: only e-eu may cause a notification. These protected helpers are trainer bridges, not public Azure webhook APIs.',
  rationale: { concept: 'Webhook callback outcome and business effect', what: 'Uses the delivered envelope to perform a notification and returns its actual HTTP outcome.', why: 'A successful delivery acknowledgement must correspond to business work on that same event.', without: 'A no-op status 200 acknowledges delivery without the requested notification; a fabricated marker outside the callback cannot prove handling.', csharp: 'An ASP.NET/C# webhook similarly reads the event payload and returns an HTTP status after processing.' },
  hints: ['Use deliver_events only from main(); the previous task already published the events.'],
  paths, resourceIds: resources, check: context => eventReady(context) && !!eventSubscription(context.sandbox)
    && context.runtime.messaging.eventGrid?.events.length === FILTER_FACTS.length
    && FILTER_FACTS.every(fact => context.runtime.messaging.eventGrid.events.some(row => exactEvent(row.event, fact))),
  solution: { steps: [file('handler.py', EVENTGRID_FILTER_SOLUTION_FILES['handler.py']), command('python handler.py')] },
})
function publishedFilterFixture(measurement) {
  const [row] = measurement.receipts.eventgrid
  return publishedEvents(measurement, FILTER_FACTS) && measurement.receipts.eventgrid.length === 1
    && row.subscriptionId === EVENT_SUBSCRIPTION_ID && row.event.id === EU_FACT.id && row.status === 'pending' && row.attempts === 0
    && measurement.trace.some(trace => trace.kind === 'route' && trace.deliveryId === row.id && trace.eventRecordId === row.eventRecordId)
    && Object.keys(measurement.effects.after).length === 0
}
function filteredBehavior(measurement) {
  const [row] = measurement.receipts.eventgrid
  return measurement.receipts.eventgrid.length === 1
    && row.attempts === 1 && notifiedDelivery(measurement, row, EU_FACT)
    && measurement.trace.filter(trace => trace.kind === 'notification').length === 1
    && Object.keys(measurement.effects.after.notifications ?? {}).join(',') === 'e-eu'
}
export const eventFiltersLab = {
  ...messagingMetadata, contentVersion: 2, service: 'event-grid', id: 'messaging-event-filters', title: 'Simulated: Filter and handle custom order events', journeyOrder: 8, minutes: 35,
  brief: 'Configure an Event Grid subscription and write both publisher and actual callback. Independent prepared baseline supplies only earlier rg-messaging/sb-orders/orders configuration; new topic, subscription and code Tasks are unfinished. Run python events.py to publish and verify three facts, then python handler.py to observe only the intended EU completion notification. No real webhook deployment or previous Lab required.',
  initialProjectFiles: { ...EVENTGRID_FILTER_STARTER_FILES, 'README.md': eventReadme('Independent prepared baseline: rg-messaging in West Europe, Standard sb-orders, empty orders queue. New evgt-orders and order-notifications do not exist; events.py and handler.py are unfinished. No events, effects or evidence are seeded. The fixed endpoint is registered by trusted Lab data to your actual handler.py. First save events.py and run python events.py to publish the three stated envelopes and verify the filtered route. Then save handler.py and run python handler.py to drain the already routed callbacks; do not republish the fixture from the handler.') },
  initializeSimulation: run => seedMessagingStage(run, 'event-filters'), tasks: [createEventTopicTask(), configure, publish, handle],
  messagingInput: { eventGridHandlers: { [EVENT_ENDPOINT]: 'handler.py' } },
  messagingExercise: { commands: [{ entry: 'events.py', mode: 'script' }, { entry: 'handler.py', mode: 'script' }], tasks: [exerciseTask(publish, 'events.py', publishedFilterFixture), exerciseTask(handle, 'handler.py', filteredBehavior)] },
}
