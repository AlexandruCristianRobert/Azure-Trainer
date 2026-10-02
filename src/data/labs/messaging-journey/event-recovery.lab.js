import { EVENTGRID_RECOVERY_STARTER_FILES, EVENTGRID_RECOVERY_SOLUTION_FILES } from '../../templates/messaging-python/eventgrid.js'
import { messagingMetadata, messagingTask, file, command, eventReady, eventSubscription, eventResources, eventReadme, exerciseTask, publishedEvents, notifiedDelivery, exactEvent, eq, EVENT_SUBSCRIPTION_ID, EVENT_ENDPOINT, STORAGE_ID, EVENT_DESTINATION, messagingResourceById } from './helpers.js'
import { seedMessagingStage } from './seeds.js'
import { createEventTopicTask, EU_FACT } from './publish-events.lab.js'

const terminal = { id: 'e-terminal', subject: '/orders/eu/o2', eventType: 'Contoso.OrderProcessed', data: { order_id: 'o2', region: 'EU', quantity: 1 }, dataVersion: '1.0' }
const configure = messagingTask({ id: 'bounded-event-recovery',
  text: `Configure order-notifications on evgt-orders for WebHook https://orders.trainer.invalid/events, Contoso.OrderProcessed, subject prefix /orders/eu/. Set max attempts 3, TTL 1 minute, and dead-letter destination ${EVENT_DESTINATION}. This independent Lab already owns stmessagingorders and prepared event-deadletters; you select that actual resource, rather than create a blob container. Inspect the subscription with its show command.`,
  rationale: { concept: 'Bounded retry, TTL and dead-letter destination', what: 'Limits recovery attempts and event lifetime and preserves terminal output at an owned destination.', why: 'Transient failures should recover while a persistent failure has an observable terminal outcome.', without: 'Retries have no requested bound or terminal events are dropped without the prepared dead-letter output.', csharp: 'C# handlers return HTTP failure/success; retry policy and storage destination remain subscription configuration.' },
  hints: ['Set --max-delivery-attempts 3 --event-ttl 1 --deadletter-endpoint to the supplied container ARM identity.'],
  solution: { steps: [command(`az eventgrid topic event-subscription create --resource-group rg-messaging --topic-name evgt-orders --name order-notifications --endpoint ${EVENT_ENDPOINT} --included-event-types Contoso.OrderProcessed --subject-begins-with /orders/eu/ --max-delivery-attempts 3 --event-ttl 1 --deadletter-endpoint ${EVENT_DESTINATION}`),
    command('az eventgrid topic event-subscription show --resource-group rg-messaging --topic-name evgt-orders --name order-notifications')] },
  check: context => {
    const row = eventSubscription(context.sandbox)
    return eventReady(context) && row?.endpoint === EVENT_ENDPOINT && row.endpointType === 'WebHook'
      && row.filter.includedEventTypes.length === 1 && row.filter.includedEventTypes[0] === 'Contoso.OrderProcessed'
      && row.filter.subjectBeginsWith === '/orders/eu/' && row.filter.subjectEndsWith === '' && !row.filter.isSubjectCaseSensitive
      && row.maxDeliveryAttempts === 3 && row.eventTimeToLiveInMinutes === 1 && eq(row.deadLetterDestination, EVENT_DESTINATION)
      && !!messagingResourceById(context.sandbox, EVENT_DESTINATION)
  },
})
const handle = messagingTask({ id: 'recover-event-delivery',
  text: 'Write handler.py handle_event(event) to read the actual order_id, obtain handler_status(order_id), record_notification(event.id, order_id) only when status is 200, then return that integer. main() calls the prepared events.publish_events() and deliver_events(handle_event), printing attempts. Run python handler.py once. The fixture offers o1 statuses [503, 200] and o2 status 503; it does not grade you. Observe e-eu recover on attempt 2, e-terminal reach the configured dead-letter container on attempt 3, and only e-eu notify. The bridge advances bounded logical ticks without real backoff waits; this is not the Azure retry schedule.',
  rationale: { concept: 'Actual failure, retry and recovery', what: 'Returns real callback statuses while performing business work only on a successful attempt.', why: 'Recovery requires the actual second callback and notification, and persistent failure must reach the actual configured terminal destination.', without: 'A fixture status lookup alone proves no callback work; acknowledging every failure hides recovery and terminal output.', csharp: 'C# webhook handlers return retryable HTTP statuses on transient failure and success only after the business effect.' },
  hints: ['The supplied events.py publishes e-eu/o1 and e-terminal/o2. Save your handler before running.', 'deliver_events returns the number of actual attempts; terminal trace lines expose outcomes and logical timing.'],
  paths: ['handler.py', 'events.py', 'clients.py', 'training_runtime.py'], resourceIds: [...eventResources, EVENT_SUBSCRIPTION_ID, STORAGE_ID, EVENT_DESTINATION],
  check: context => eventReady(context) && !!eventSubscription(context.sandbox),
  solution: { steps: [file('handler.py', EVENTGRID_RECOVERY_SOLUTION_FILES['handler.py']), command('python handler.py')] },
})
function recoveryBehavior(measurement) {
  const rows = measurement.receipts.eventgrid
  if (!publishedEvents(measurement, [EU_FACT, terminal]) || rows.length !== 2) return false
  const good = rows.find(row => row.event.id === 'e-eu'), bad = rows.find(row => row.event.id === 'e-terminal')
  const linked = (trace, row) => trace.deliveryId === row.id && trace.eventRecordId === row.eventRecordId
  const publication = row => measurement.trace.find(trace => trace.kind === 'publish' && trace.eventRecordId === row.eventRecordId)
  return good?.attempts === 2 && notifiedDelivery(measurement, good, EU_FACT)
    && bad?.subscriptionId === EVENT_SUBSCRIPTION_ID && bad.endpoint === EVENT_ENDPOINT && bad.endpointType === 'WebHook'
    && exactEvent(bad.event, terminal) && bad.status === 'deadlettered' && bad.attempts === 3 && bad.lastStatus === 503
    && [good, bad].every(row => row.maxDeliveryAttempts === 3 && row.expiresAtMs === publication(row)?.timeMs + 60000 && eq(row.deadLetterDestination, EVENT_DESTINATION)
      && measurement.trace.some(trace => trace.kind === 'publish' && trace.eventRecordId === row.eventRecordId && exactEvent(trace.event, row.event))
      && measurement.trace.some(trace => trace.kind === 'route' && linked(trace, row)))
    && measurement.trace.filter(trace => trace.kind === 'retry' && linked(trace, good)).map(trace => trace.attempts).join(',') === '1'
    && measurement.trace.filter(trace => trace.kind === 'retry' && linked(trace, bad)).map(trace => trace.attempts).join(',') === '1,2'
    && bad.reason === 'MaxDeliveryAttemptsExceeded' && bad.deadLetter?.reason === bad.reason && bad.deadLetter.attempts === 3
    && eq(bad.deadLetter.destination, EVENT_DESTINATION) && exactEvent(bad.deadLetter.event, terminal) && bad.deadLetter.timeMs === publication(bad).timeMs + 2000
    && measurement.trace.some(trace => trace.kind === 'deadlettered' && linked(trace, bad) && trace.attempts === 3 && trace.timeMs === bad.deadLetter.timeMs)
    && measurement.trace.filter(trace => trace.kind === 'notification').length === 1
    && Object.keys(measurement.effects.after.notifications ?? {}).join(',') === 'e-eu' && measurement.value === null
}
export const eventRecoveryLab = {
  ...messagingMetadata, service: 'event-grid', id: 'messaging-event-recovery', title: 'Simulated: Recover and observe terminal event delivery', journeyOrder: 9, minutes: 35,
  brief: 'Configure actual attempt/TTL/dead-letter policy and write a status-aware callback. Independent prepared baseline owns rg-messaging, Standard sb-orders, empty orders, stmessagingorders and event-deadletters. New topic/subscription and handler Tasks are unfinished. One bounded python handler.py exercise shows transient recovery plus terminal output, without real waiting or previous Lab completion.',
  initialProjectFiles: { ...EVENTGRID_RECOVERY_STARTER_FILES, 'README.md': eventReadme('Independent prepared baseline: rg-messaging in West Europe, Standard sb-orders and empty orders, owned stmessagingorders account with prepared event-deadletters container. This trainer has no general blob creation API or real blob durability. New evgt-orders/subscription and handler.py are unfinished. Prepared events.py publishes explicit e-eu/o1 and e-terminal/o2 facts during your final handler exercise; no events/effects/terminal answers/evidence are seeded. Fixture status helper supplies [503,200] for o1 and persistent 503 for o2; actual callback return and notification work determine observed behavior.') },
  initializeSimulation: run => seedMessagingStage(run, 'event-recovery'), tasks: [createEventTopicTask(), configure, handle],
  messagingInput: { eventGridHandlers: { [EVENT_ENDPOINT]: 'handler.py' }, handlerStatus: { o1: [503, 200], o2: 503 } },
  messagingExercise: { commands: [{ entry: 'handler.py', mode: 'script' }], tasks: [exerciseTask(handle, 'handler.py', recoveryBehavior)] },
}
