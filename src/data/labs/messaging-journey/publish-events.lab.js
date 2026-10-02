import { EVENTGRID_PUBLISH_STARTER_FILES, EVENTGRID_PUBLISH_SOLUTION_FILES } from '../../templates/messaging-python/eventgrid.js'
import { messagingMetadata, messagingTask, file, command, eventReady, eventTopic, eventResources, eventReadme, exerciseTask, publishedEvents } from './helpers.js'
import { seedMessagingStage } from './seeds.js'

export const EU_FACT = Object.freeze({ id: 'e-eu', subject: '/orders/eu/o1', eventType: 'Contoso.OrderProcessed', data: { order_id: 'o1', region: 'EU', quantity: 2 }, dataVersion: '1.0' })
export const createEventTopicTask = () => messagingTask({ id: 'event-topic',
  text: 'Create evgt-orders in rg-messaging, West Europe, using EventGridSchema. This topic accepts application facts about completed orders; the prepared Service Bus namespace continues to carry work commands.',
  rationale: { concept: 'Custom Event Grid topic', what: 'Accepts explicit application events using a known envelope schema.', why: 'Consumers can react to completed business facts independently of the queue worker.', without: 'The publisher has no topic for order completion announcements.', csharp: 'C# uses EventGridPublisherClient and EventGridEvent for the same application event envelope.' },
  hints: ['Use az eventgrid topic create with --input-schema eventgridschema.'],
  solution: { steps: [command('az eventgrid topic create --resource-group rg-messaging --name evgt-orders --location westeurope --input-schema eventgridschema')] },
  check: context => eventReady(context) && eventTopic(context.sandbox)?.location === 'westeurope',
})
const publish = messagingTask({ id: 'publish-order-fact',
  text: 'Write events.py to publish an explicit Contoso.OrderProcessed application fact: event ID e-eu, subject /orders/eu/o1, data version 1.0, data {order_id: o1, region: EU, quantity: 2}. Use EventGridEvent and the supplied publisher, then run python events.py. This exercise takes completion as the stated upstream fact; it does not execute an upstream order worker. There is no subscriber yet: publication still has an actual envelope receipt.',
  rationale: { concept: 'Application event versus command', what: 'Publishes an EventGridEvent describing an already completed business action.', why: 'An explicit type, subject and payload let independent consumers understand what occurred.', without: 'A missing or incorrect envelope announces no trustworthy completion fact.', csharp: 'C# SendEventsAsync accepts EventGridEvent values with Subject, EventType, DataVersion and data.' },
  hints: ['Define main() and send a list containing your event with publisher.send.', 'Use the SDK-shaped keyword names event_type and data_version.'],
  paths: ['events.py', 'clients.py'], resourceIds: eventResources, check: eventReady,
  solution: { steps: [file('events.py', EVENTGRID_PUBLISH_SOLUTION_FILES['events.py']), command('python events.py')] },
})

export const publishEventsLab = {
  ...messagingMetadata, service: 'event-grid', id: 'messaging-publish-events', title: 'Simulated: Publish explicit completed-order events', journeyOrder: 7, minutes: 25,
  brief: 'Write a custom EventGridSchema publisher for an explicit completed-order fact. Independent prepared baseline supplies rg-messaging, Standard sb-orders and empty orders only; create the new evgt-orders topic and finish events.py. No previous Lab is required. Execution, identity and publication are bounded simulations.',
  initialProjectFiles: { ...EVENTGRID_PUBLISH_STARTER_FILES, 'README.md': eventReadme('Independent prepared baseline: rg-messaging in West Europe, Standard sb-orders and empty orders queue. No Event Grid topic, subscribers, events, business effects or evidence are seeded. Create evgt-orders and implement events.py. The stated upstream fact is that o1 (EU, quantity 2) was processed; this Lab only demonstrates announcing that fact. Publication without a subscriber is observable through its actual current-command envelope.') },
  initializeSimulation: run => seedMessagingStage(run, 'publish-events'), tasks: [createEventTopicTask(), publish],
  messagingExercise: { commands: [{ entry: 'events.py', mode: 'script' }], tasks: [exerciseTask(publish, 'events.py', measurement => publishedEvents(measurement, [EU_FACT])
    && measurement.receipts.eventgrid.length === 0 && Object.keys(measurement.effects.after).length === 0)] },
}
