import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentTopic } from '../arm.js'
import { subscriptionGroup } from './servicebus-subscription.js'

const NAME = ARG.name('Name of Topic.')
const PROPERTY_ARGS = [
  { name: '--max-size', aliases: [], required: false, kind: 'int', dest: 'maxSizeInMegabytes', help: 'Maximum size of topic in megabytes, which is the size of the memory allocated for the topic.', defaultValue: 1024 },
  { name: '--default-message-time-to-live', aliases: [], required: false, kind: 'string', dest: 'defaultMessageTimeToLive', help: 'ISO 8601 Default message timespan to live value.' },
  { name: '--enable-partitioning', aliases: [], required: false, kind: 'bool', dest: 'enablePartitioning', help: 'Value that indicates whether the topic to be partitioned across multiple message brokers is enabled.' },
  { name: '--enable-duplicate-detection', aliases: [], required: false, kind: 'bool', dest: 'requiresDuplicateDetection', help: 'Value indicating if this topic requires duplicate detection.' },
  { name: '--duplicate-detection-history-time-window', aliases: [], required: false, kind: 'string', dest: 'duplicateDetectionHistoryTimeWindow', help: 'ISO8601 timespan structure that defines the duration of the duplicate detection history. The default value is 10 minutes.' },
  { name: '--enable-batched-operations', aliases: [], required: false, kind: 'bool', dest: 'enableBatchedOperations', help: 'Value that indicates whether server-side batched operations are enabled.' },
  { name: '--enable-ordering', aliases: [], required: false, kind: 'bool', dest: 'supportOrdering', help: 'Value that indicates whether the topic supports ordering.' },
  { name: '--status', aliases: [], required: false, kind: 'string', choices: ['Active', 'Disabled', 'SendDisabled', 'ReceiveDisabled'], dest: 'status', help: 'Enumerates the possible values for the status of a messaging entity.' },
]
const KEYS = PROPERTY_ARGS.map((a) => a.dest)
const props = (v) => Object.fromEntries(KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]))
const SCOPE = [NAME, ARG.namespace, ARG.resourceGroup]

// Ruling N: events carry the canonical stored name/namespace/resourceGroup —
// never the user-typed `v.*` casing. `ns` is the namespace fetched via
// ops.getNamespace before the mutation; `name` is the stored topic name
// (resource.name on create/update, ops.getTopic(...).name on delete).
const tEvent = (type, ns, name) => event(type, 'topic', { name, resourceGroup: ns.resourceGroup, namespace: ns.name })

export const topicGroup = defineGroup(['servicebus', 'topic'], 'Manage Azure Service Bus Topic and Authorization Rule.', {
  create: defineCommand(['servicebus', 'topic', 'create'], 'Create the Service Bus Topic.', {
    latencyMs: LATENCY.mutate,
    args: [...SCOPE, ...PROPERTY_ARGS],
    examples: [{ summary: 'Create a new Service Bus Topic.', command: 'az servicebus topic create --resource-group myresourcegroup --namespace-name mynamespace --name mytopic' }],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const existed = ns.topics.some((t) => t.name.toLowerCase() === v.name.toLowerCase())
      const { sandbox: next, resource } = ops.createTopic(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name, ...props(v) })
      return { sandbox: next, output: presentTopic(resource, ns), events: [tEvent(existed ? 'updated' : 'created', ns, resource.name)] }
    },
  }),
  show: defineCommand(['servicebus', 'topic', 'show'], 'Get a description for the specified topic.', {
    args: SCOPE,
    run: ({ sandbox }, v) => ({ sandbox, output: presentTopic(ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.name), ops.getNamespace(sandbox, v.resourceGroup, v.namespace)) }),
  }),
  list: defineCommand(['servicebus', 'topic', 'list'], 'List all the topics in a namespace.', {
    args: [ARG.namespace, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      return { sandbox, output: ops.listTopics(sandbox, v.resourceGroup, v.namespace).map((t) => presentTopic(t, ns)) }
    },
  }),
  delete: defineCommand(['servicebus', 'topic', 'delete'], 'Delete a topic from the specified namespace and resource group.', {
    latencyMs: LATENCY.mutate,
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const t = ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.name)
      const { sandbox: next } = ops.deleteTopic(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name })
      return { sandbox: next, output: null, events: [tEvent('deleted', ns, t.name)] }
    },
  }),
  subscription: subscriptionGroup,
})
