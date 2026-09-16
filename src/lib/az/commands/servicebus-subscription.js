import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentSubscription } from '../arm.js'
import { ruleGroup } from './servicebus-rule.js'

const NAME = ARG.name('Name of Subscription.')
const PROPERTY_ARGS = [
  { name: '--max-delivery-count', aliases: [], required: false, kind: 'int', dest: 'maxDeliveryCount', help: 'Number of maximum deliveries.', defaultValue: 10 },
  { name: '--lock-duration', aliases: [], required: false, kind: 'string', dest: 'lockDuration', help: 'ISO 8601 lock duration timespan for the subscription. The default value is 1 minute.' },
  { name: '--enable-dead-lettering-on-message-expiration', aliases: [], required: false, kind: 'bool', dest: 'deadLetteringOnMessageExpiration', help: 'Value that indicates whether a subscription has dead letter support when a message expires.' },
  { name: '--dead-letter-on-filter-exceptions', aliases: [], required: false, kind: 'bool', dest: 'deadLetteringOnFilterEvaluationExceptions', help: 'Value that indicates whether a subscription has dead letter support on filter evaluation exceptions.' },
  { name: '--default-message-time-to-live', aliases: [], required: false, kind: 'string', dest: 'defaultMessageTimeToLive', help: 'ISO 8061 Default message timespan to live value.' },
  { name: '--enable-session', aliases: [], required: false, kind: 'bool', dest: 'requiresSession', help: 'Value indicating if a subscription supports the concept of sessions.' },
  { name: '--enable-batched-operations', aliases: [], required: false, kind: 'bool', dest: 'enableBatchedOperations', help: 'Value that indicates whether server-side batched operations are enabled.' },
  { name: '--status', aliases: [], required: false, kind: 'string', choices: ['Active', 'Disabled', 'SendDisabled', 'ReceiveDisabled'], dest: 'status', help: 'Enumerates the possible values for the status of a messaging entity.' },
]
const KEYS = PROPERTY_ARGS.map((a) => a.dest)
const props = (v) => Object.fromEntries(KEYS.filter((k) => v[k] !== undefined).map((k) => [k, v[k]]))
const SCOPE = [NAME, ARG.namespace, ARG.topic, ARG.resourceGroup]

// Ruling N: events carry the canonical stored name/topic/namespace/resourceGroup
// — never the user-typed `v.*` casing. `ns`/`t` are fetched via ops before the
// mutation; `name` is the stored subscription name (resource.name on
// create/update, ops.getSubscription(...).name on delete).
const sEvent = (type, ns, t, name) => event(type, 'subscription', { name, resourceGroup: ns.resourceGroup, namespace: ns.name, topic: t.name })

// Ruling N helper (brief Step 4): fetches the parent chain from the
// PRE-mutation sandbox, shared by all four commands below.
function context(sandbox, v) {
  const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
  const t = ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.topic)
  return { ns, t }
}

export const subscriptionGroup = defineGroup(['servicebus', 'topic', 'subscription'], 'Manage Azure Service Bus Subscription.', {
  create: defineCommand(['servicebus', 'topic', 'subscription', 'create'], 'Create the ServiceBus Subscription.', {
    latencyMs: LATENCY.mutate,
    args: [...SCOPE, ...PROPERTY_ARGS],
    examples: [{ summary: 'Create a new Subscription.', command: 'az servicebus topic subscription create --resource-group myresourcegroup --namespace-name mynamespace --topic-name mytopic --name mysubscription' }],
    run: ({ sandbox }, v) => {
      const { ns, t } = context(sandbox, v)
      const existed = t.subscriptions.some((s) => s.name.toLowerCase() === v.name.toLowerCase())
      const { sandbox: next, resource } = ops.createSubscription(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, name: v.name, ...props(v) })
      return { sandbox: next, output: presentSubscription(resource, t, ns), events: [sEvent(existed ? 'updated' : 'created', ns, t, resource.name)] }
    },
  }),
  show: defineCommand(['servicebus', 'topic', 'subscription', 'show'], 'Get a subscription description for the specified topic.', {
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const { ns, t } = context(sandbox, v)
      return { sandbox, output: presentSubscription(ops.getSubscription(sandbox, v.resourceGroup, v.namespace, v.topic, v.name), t, ns) }
    },
  }),
  list: defineCommand(['servicebus', 'topic', 'subscription', 'list'], 'List all the subscriptions under a specified topic.', {
    args: [ARG.namespace, ARG.topic, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const { ns, t } = context(sandbox, v)
      return { sandbox, output: ops.listSubscriptions(sandbox, v.resourceGroup, v.namespace, v.topic).map((s) => presentSubscription(s, t, ns)) }
    },
  }),
  delete: defineCommand(['servicebus', 'topic', 'subscription', 'delete'], 'Delete a subscription from the specified topic.', {
    latencyMs: LATENCY.mutate,
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const { ns, t } = context(sandbox, v)
      const s = ops.getSubscription(sandbox, v.resourceGroup, v.namespace, v.topic, v.name)
      const { sandbox: next } = ops.deleteSubscription(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, name: v.name })
      return { sandbox: next, output: null, events: [sEvent('deleted', ns, t, s.name)] }
    },
  }),
  rule: ruleGroup,
})
