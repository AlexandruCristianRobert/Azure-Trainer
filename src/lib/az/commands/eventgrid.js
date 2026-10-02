import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as eventGrid from '../../sandbox/eventgrid.js'
import { AzError } from '../../sandbox/errors.js'
import { presentEventGridSubscription, presentEventGridTopic } from '../eventgrid-arm.js'

const TOPIC_NAME = ARG.name('Name of the Event Grid topic.')
const SUBSCRIPTION_NAME = ARG.name('Name of the Event Grid event subscription.')
const TOPIC = { name: '--topic-name', aliases: [], required: true, kind: 'string', dest: 'topicName', help: 'Name of the Event Grid topic.' }
const INPUT_SCHEMA = { name: '--input-schema', aliases: [], required: false, kind: 'string', choices: ['eventgridschema'], dest: 'inputSchema', help: 'Topic input schema. Only eventgridschema is supported.', defaultValue: 'eventgridschema' }
const ENDPOINT = { name: '--endpoint', aliases: [], required: true, kind: 'string', dest: 'endpoint', help: 'HTTPS WebHook endpoint URL.' }
const ENDPOINT_UPDATE = { ...ENDPOINT, required: false }
const ENDPOINT_TYPE = { name: '--endpoint-type', aliases: [], required: false, kind: 'string', choices: ['webhook', 'azurefunction'], dest: 'endpointType', help: 'Event subscription endpoint type.', defaultValue: 'webhook' }
const UPDATE_ENDPOINT_TYPE = { name: '--update-endpoint-type', aliases: [], required: false, kind: 'string', choices: ['webhook', 'azurefunction'], dest: 'endpointType', help: 'Event subscription endpoint type to update.' }
const RECOVERY = [
  { name: '--max-delivery-attempts', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryAttempts', help: 'Maximum delivery attempts (1-30).' },
  { name: '--event-ttl', aliases: [], required: false, kind: 'int', dest: 'eventTimeToLiveInMinutes', help: 'Event TTL in minutes (1-1440).' },
  { name: '--deadletter-endpoint', aliases: [], required: false, kind: 'string', dest: 'deadLetterDestination', help: 'Prepared storage blob container ARM resource ID.' },
]
const INCLUDED_EVENT_TYPES = { name: '--included-event-types', aliases: [], required: false, kind: 'raw', dest: 'includedEventTypes', help: 'Space-separated event types. Omit values or use All for all event types.' }
const SUBJECT_BEGINS_WITH = { name: '--subject-begins-with', aliases: [], required: false, kind: 'string', dest: 'subjectBeginsWith', allowEmpty: true, help: 'Literal subject prefix filter. Pass "" to clear it.' }
const SUBJECT_ENDS_WITH = { name: '--subject-ends-with', aliases: [], required: false, kind: 'string', dest: 'subjectEndsWith', allowEmpty: true, help: 'Literal subject suffix filter. Pass "" to clear it.' }
const SUBJECT_CASE_SENSITIVE = { name: '--subject-case-sensitive', aliases: [], required: false, kind: 'bool', dest: 'isSubjectCaseSensitive', help: 'Whether subject matching is case-sensitive.', defaultValue: false }
const YES = { ...ARG.yes, help: 'Required in the Sandbox to confirm deletion.' }

const topicEvent = (type, topic) => event(type, 'eventGridTopic', { name: topic.name, resourceGroup: topic.resourceGroup })
const subscriptionEvent = (type, topic, resource) => event(type, 'eventGridSubscription', { name: resource.name, resourceGroup: topic.resourceGroup, topic: topic.name })

function requireYes(values) {
  if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
}

function topicContext(sandbox, values) {
  return eventGrid.getEventGridTopic(sandbox, values.resourceGroup, values.topicName)
}

const eventSubscriptionGroup = defineGroup(['eventgrid', 'topic', 'event-subscription'], 'Manage Event Grid topic event subscriptions.', {
  create: defineCommand(['eventgrid', 'topic', 'event-subscription', 'create'], 'Create an Event Grid event subscription.', {
    latencyMs: LATENCY.mutate,
    args: [SUBSCRIPTION_NAME, ARG.resourceGroup, TOPIC, ENDPOINT, ENDPOINT_TYPE, INCLUDED_EVENT_TYPES, SUBJECT_BEGINS_WITH, SUBJECT_ENDS_WITH, SUBJECT_CASE_SENSITIVE, ...RECOVERY],
    run: ({ sandbox }, values) => {
      const topic = topicContext(sandbox, values)
      const existed = topic.eventSubscriptions.some((resource) => resource.name.toLowerCase() === values.name.toLowerCase())
      const { sandbox: next, resource, topic: storedTopic } = eventGrid.createEventGridSubscription(sandbox, {
        ...values,
        endpointType: values.endpointType === undefined ? undefined : values.endpointType === 'azurefunction' ? 'AzureFunction' : 'WebHook',
      })
      return { sandbox: next, output: presentEventGridSubscription(resource, storedTopic), events: [subscriptionEvent(existed ? 'updated' : 'created', storedTopic, resource)] }
    },
  }),
  update: defineCommand(['eventgrid', 'topic', 'event-subscription', 'update'], 'Update an Event Grid event subscription.', {
    latencyMs: LATENCY.mutate,
    args: [SUBSCRIPTION_NAME, ARG.resourceGroup, TOPIC, ENDPOINT_UPDATE, UPDATE_ENDPOINT_TYPE, INCLUDED_EVENT_TYPES, SUBJECT_BEGINS_WITH, SUBJECT_ENDS_WITH, ...RECOVERY],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource, topic } = eventGrid.updateEventGridSubscription(sandbox, {
        ...values,
        endpointType: values.endpointType === undefined ? undefined : values.endpointType === 'azurefunction' ? 'AzureFunction' : 'WebHook',
      })
      return { sandbox: next, output: presentEventGridSubscription(resource, topic), events: [subscriptionEvent('updated', topic, resource)] }
    },
  }),
  show: defineCommand(['eventgrid', 'topic', 'event-subscription', 'show'], 'Show an Event Grid event subscription.', {
    args: [SUBSCRIPTION_NAME, ARG.resourceGroup, TOPIC],
    run: ({ sandbox }, values) => {
      const topic = topicContext(sandbox, values)
      return { sandbox, output: presentEventGridSubscription(eventGrid.getEventGridSubscription(sandbox, values.resourceGroup, values.topicName, values.name), topic) }
    },
  }),
  list: defineCommand(['eventgrid', 'topic', 'event-subscription', 'list'], 'List Event Grid event subscriptions for a topic.', {
    args: [ARG.resourceGroup, TOPIC],
    run: ({ sandbox }, values) => {
      const topic = topicContext(sandbox, values)
      return { sandbox, output: eventGrid.listEventGridSubscriptions(sandbox, values.resourceGroup, values.topicName).map((resource) => presentEventGridSubscription(resource, topic)) }
    },
  }),
  delete: defineCommand(['eventgrid', 'topic', 'event-subscription', 'delete'], 'Delete an Event Grid event subscription.', {
    latencyMs: LATENCY.mutate,
    args: [SUBSCRIPTION_NAME, ARG.resourceGroup, TOPIC, YES],
    run: ({ sandbox }, values) => {
      requireYes(values)
      const { sandbox: next, resource, topic } = eventGrid.deleteEventGridSubscription(sandbox, values)
      return { sandbox: next, output: null, events: [subscriptionEvent('deleted', topic, resource)] }
    },
  }),
})

const topicGroup = defineGroup(['eventgrid', 'topic'], 'Manage Event Grid topics.', {
  create: defineCommand(['eventgrid', 'topic', 'create'], 'Create an Event Grid topic.', {
    latencyMs: LATENCY.mutate,
    args: [TOPIC_NAME, ARG.resourceGroup, ARG.location(false), ARG.tags, INPUT_SCHEMA],
    run: ({ sandbox }, values) => {
      const existed = sandbox.eventGridTopics.some((topic) => topic.name.toLowerCase() === values.name.toLowerCase() && topic.resourceGroup.toLowerCase() === values.resourceGroup.toLowerCase())
      const { sandbox: next, resource } = eventGrid.createEventGridTopic(sandbox, {
        ...values,
        inputSchema: values.inputSchema === undefined ? undefined : 'EventGridSchema',
      })
      return { sandbox: next, output: presentEventGridTopic(resource), events: [topicEvent(existed ? 'updated' : 'created', resource)] }
    },
  }),
  show: defineCommand(['eventgrid', 'topic', 'show'], 'Show an Event Grid topic.', {
    args: [TOPIC_NAME, ARG.resourceGroup],
    run: ({ sandbox }, values) => ({ sandbox, output: presentEventGridTopic(eventGrid.getEventGridTopic(sandbox, values.resourceGroup, values.name)) }),
  }),
  list: defineCommand(['eventgrid', 'topic', 'list'], 'List Event Grid topics.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: eventGrid.listEventGridTopics(sandbox, values.resourceGroup ?? null).map(presentEventGridTopic) }),
  }),
  delete: defineCommand(['eventgrid', 'topic', 'delete'], 'Delete an Event Grid topic.', {
    latencyMs: LATENCY.mutate,
    args: [TOPIC_NAME, ARG.resourceGroup, YES],
    run: ({ sandbox }, values) => {
      requireYes(values)
      const { sandbox: next, resource } = eventGrid.deleteEventGridTopic(sandbox, values)
      return { sandbox: next, output: null, events: [topicEvent('deleted', resource)] }
    },
  }),
  'event-subscription': eventSubscriptionGroup,
})

export const eventgridGroup = defineGroup(['eventgrid'], 'Manage Event Grid resources.', { topic: topicGroup })
