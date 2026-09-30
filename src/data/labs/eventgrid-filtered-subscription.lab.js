const GROUP = 'rg-events'
const TOPIC = 'evgt-contoso-orders'
const SUBSCRIPTION = 'eu-order-handler'
const ENDPOINT = 'https://events.contoso.com/api/orders'
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function topic(sandbox) {
  if (!sandbox.resourceGroups.some((group) => same(group.name, GROUP))) return undefined
  return (sandbox.eventGridTopics ?? []).find((item) => same(item.resourceGroup, GROUP) && same(item.name, TOPIC))
}

function subscription(sandbox) {
  return topic(sandbox)?.eventSubscriptions.find((item) => same(item.name, SUBSCRIPTION))
}

export const eventgridFilteredSubscriptionLab = {
  id: 'eventgrid-filtered-subscription',
  title: 'Event Grid custom topic with filtered subscription',
  skillAreaId: 'connect',
  service: 'event-grid',
  minutes: 35,
  status: 'available',
  brief: "Configure Contoso's order-event routing: create a custom Event Grid topic and a webhook subscription for European order-created events with JSON subjects. This Lab records topic, destination and filter configuration; it does not validate the webhook, publish events or deliver requests.",
  seed: (sandbox) => sandbox,
  tasks: [
    {
      id: 'resource-group',
      text: 'Create resource group `rg-events` in West Europe.',
      check: (sandbox) => sandbox.resourceGroups.some((group) => same(group.name, GROUP) && group.location === 'westeurope'),
      hints: [
        'Use `az group create` to organize the Event Grid resources.',
        'Set `--name rg-events --location westeurope`.',
      ],
      solution: 'az group create --name rg-events --location westeurope',
      examNote: 'A resource group provides a lifecycle boundary. Its metadata location can differ from the deployment region of the resources it contains.',
    },
    {
      id: 'custom-topic',
      text: 'Create custom topic `evgt-contoso-orders` in `rg-events`, in West Europe, using `EventGridSchema`.',
      check: (sandbox) => {
        const item = topic(sandbox)
        return !!item && item.location === 'westeurope' && item.inputSchema === 'EventGridSchema'
      },
      hints: [
        'Use `az eventgrid topic create`. A custom topic receives events published by your application.',
        'Set the required name and group, plus `--location westeurope --input-schema eventgridschema`.',
      ],
      solution: 'az eventgrid topic create --name evgt-contoso-orders --resource-group rg-events --location westeurope --input-schema eventgridschema',
      examNote: 'Custom topics carry application-defined events. Event subscriptions describe which events a consumer wants and where they should be delivered.',
    },
    {
      id: 'webhook-subscription',
      text: 'On `evgt-contoso-orders`, create event subscription `eu-order-handler` with WebHook destination `https://events.contoso.com/api/orders`.',
      check: (sandbox) => {
        const item = subscription(sandbox)
        return !!item && item.endpointType === 'WebHook' && item.endpoint === ENDPOINT
      },
      hints: [
        'Use `az eventgrid topic event-subscription create`, identifying the parent topic with `--topic-name`.',
        'Set `--name eu-order-handler --endpoint-type webhook --endpoint https://events.contoso.com/api/orders`, along with the topic and group.',
      ],
      solution: 'az eventgrid topic event-subscription create --name eu-order-handler --resource-group rg-events --topic-name evgt-contoso-orders --endpoint-type webhook --endpoint https://events.contoso.com/api/orders',
      examNote: 'Real Event Grid webhook subscriptions require endpoint validation. This Sandbox stores the destination without contacting it or completing a validation handshake.',
    },
    {
      id: 'event-type-filter',
      text: 'Configure `eu-order-handler` on the required topic to include only event type `Contoso.Order.Created`.',
      check: (sandbox) => {
        const types = subscription(sandbox)?.filter.includedEventTypes ?? []
        return types.length === 1 && types[0] === 'Contoso.Order.Created'
      },
      hints: [
        'Use `az eventgrid topic event-subscription update` to narrow the event types. A subscription initially includes all types.',
        'Pass `--included-event-types Contoso.Order.Created` with the required subscription name, topic and group. The supplied list replaces the previous list.',
      ],
      solution: 'az eventgrid topic event-subscription update --name eu-order-handler --resource-group rg-events --topic-name evgt-contoso-orders --included-event-types Contoso.Order.Created',
      examNote: 'Event types on a custom topic are defined by its publisher. Multiple included types form an OR condition; leaving the type filter unrestricted includes all event types.',
    },
    {
      id: 'subject-filter',
      text: 'For `eu-order-handler`, require subjects beginning `/orders/eu/` and ending `.json`, with case-insensitive subject matching.',
      check: (sandbox) => {
        const filter = subscription(sandbox)?.filter
        return !!filter && filter.subjectBeginsWith === '/orders/eu/' && filter.subjectEndsWith === '.json' && filter.isSubjectCaseSensitive === false
      },
      hints: [
        'Subject prefix and suffix filters use literal strings. Event type, prefix and suffix conditions must all match.',
        'Update with `--subject-begins-with /orders/eu/ --subject-ends-with .json`. Subject matching defaults to case-insensitive; if you changed it on create, repeat the create Solution with `--subject-case-sensitive false` before updating.',
      ],
      solution: 'az eventgrid topic event-subscription update --name eu-order-handler --resource-group rg-events --topic-name evgt-contoso-orders --subject-begins-with /orders/eu/ --subject-ends-with .json',
      examNote: 'A structured subject lets consumers select part of an event stream. Prefix and suffix filters are literal comparisons, not wildcard patterns; this Lab records the policy without processing events.',
    },
  ],
}
