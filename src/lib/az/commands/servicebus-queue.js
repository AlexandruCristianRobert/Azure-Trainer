import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentQueue } from '../arm.js'

const NAME = ARG.name('Name of Queue.')
const STATUS = { name: '--status', aliases: [], required: false, kind: 'string', choices: ['Active', 'Disabled', 'SendDisabled', 'ReceiveDisabled'], dest: 'status', help: 'Enumerates the possible values for the status of a messaging entity.' }

export const QUEUE_PROPERTY_ARGS = [
  { name: '--max-delivery-count', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryCount', help: 'The maximum delivery count. A message is automatically deadlettered after this number of deliveries.', defaultValue: 10 },
  { name: '--enable-dead-lettering-on-message-expiration', aliases: [], required: false, kind: 'bool', dest: 'deadLetteringOnMessageExpiration', help: 'A value that indicates whether this queue has dead letter support when a message expires.' },
  { name: '--default-message-time-to-live', aliases: [], required: false, kind: 'string', dest: 'defaultMessageTimeToLive', help: 'ISO 8601 default message timespan to live value. This is the duration after which the message expires, starting from when the message is sent to Service Bus.' },
  { name: '--lock-duration', aliases: [], required: false, kind: 'string', dest: 'lockDuration', help: 'ISO 8601 timespan duration of a peek-lock; that is, the amount of time that the message is locked for other receivers. The maximum value for LockDuration is 5 minutes; the default value is 1 minute.' },
  { name: '--max-size', aliases: [], required: false, kind: 'int', dest: 'maxSizeInMegabytes', help: 'The maximum size of the queue in megabytes, which is the size of memory allocated for the queue.', defaultValue: 1024 },
  { name: '--enable-session', aliases: [], required: false, kind: 'bool', dest: 'requiresSession', help: 'A value that indicates whether the queue supports the concept of sessions.' },
  { name: '--enable-partitioning', aliases: [], required: false, kind: 'bool', dest: 'enablePartitioning', help: 'A value that indicates whether the queue is to be partitioned across multiple message brokers.' },
  { name: '--enable-duplicate-detection', aliases: [], required: false, kind: 'bool', dest: 'requiresDuplicateDetection', help: 'A value indicating if this queue requires duplicate detection.' },
  { name: '--duplicate-detection-history-time-window', aliases: [], required: false, kind: 'string', dest: 'duplicateDetectionHistoryTimeWindow', help: 'ISO 8601 timeSpan structure that defines the duration of the duplicate detection history. The default value is 10 minutes.' },
  { name: '--enable-batched-operations', aliases: [], required: false, kind: 'bool', dest: 'enableBatchedOperations', help: 'Value that indicates whether server-side batched operations are enabled.' },
  STATUS,
]

const PROPERTY_KEYS = QUEUE_PROPERTY_ARGS.map((a) => a.dest)

function props(v) {
  return Object.fromEntries(PROPERTY_KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]))
}

// Ruling N: events carry the canonical stored name/namespace/resourceGroup —
// never the user-typed `v.*` casing. `ns` is the namespace fetched via
// ops.getNamespace before the mutation; `name` is the stored queue name
// (resource.name on create/update, ops.getQueue(...).name on delete).
const qEvent = (type, ns, name) => event(type, 'queue', { name, resourceGroup: ns.resourceGroup, namespace: ns.name })

export const queueGroup = defineGroup(['servicebus', 'queue'], 'Manage Azure Service Bus Queue and Authorization Rule.', {
  create: defineCommand(['servicebus', 'queue', 'create'], 'Create the Service Bus Queue.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.namespace, ARG.resourceGroup, ...QUEUE_PROPERTY_ARGS],
    examples: [{ summary: 'Create a Service Bus Queue with dead-lettering on message expiration.', command: 'az servicebus queue create --resource-group myresourcegroup --namespace-name mynamespace --name myqueue --enable-dead-lettering-on-message-expiration true' }],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const existed = ns.queues.some((q) => q.name.toLowerCase() === v.name.toLowerCase())
      const { sandbox: next, resource } = ops.createQueue(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name, ...props(v) })
      return { sandbox: next, output: presentQueue(resource, ns), events: [qEvent(existed ? 'updated' : 'created', ns, resource.name)] }
    },
  }),
  show: defineCommand(['servicebus', 'queue', 'show'], 'Get a description for the specified queue.', {
    args: [NAME, ARG.namespace, ARG.resourceGroup],
    run: ({ sandbox }, v) => ({ sandbox, output: presentQueue(ops.getQueue(sandbox, v.resourceGroup, v.namespace, v.name), ops.getNamespace(sandbox, v.resourceGroup, v.namespace)) }),
  }),
  list: defineCommand(['servicebus', 'queue', 'list'], 'List the queues within a namespace.', {
    args: [ARG.namespace, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      return { sandbox, output: ops.listQueues(sandbox, v.resourceGroup, v.namespace).map((q) => presentQueue(q, ns)) }
    },
  }),
  update: defineCommand(['servicebus', 'queue', 'update'], 'Update the Service Bus Queue.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.namespace, ARG.resourceGroup, ...QUEUE_PROPERTY_ARGS],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const { sandbox: next, resource } = ops.updateQueue(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name, ...props(v) })
      return { sandbox: next, output: presentQueue(resource, ns), events: [qEvent('updated', ns, resource.name)] }
    },
  }),
  delete: defineCommand(['servicebus', 'queue', 'delete'], 'Delete a queue from the specified namespace in a resource group.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.namespace, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const q = ops.getQueue(sandbox, v.resourceGroup, v.namespace, v.name)
      const { sandbox: next } = ops.deleteQueue(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, name: v.name })
      return { sandbox: next, output: null, events: [qEvent('deleted', ns, q.name)] }
    },
  }),
})
