import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as ops from '../../sandbox/ops.js'
import { presentRule } from '../arm.js'

const NAME = ARG.name('Name of Rule.')
const FILTER_TYPE = { name: '--filter-type', aliases: [], required: false, kind: 'string', choices: ['CorrelationFilter', 'SqlFilter'], dest: 'filterType', help: 'Rule Filter types.', defaultValue: 'SqlFilter' }
const SQL = { name: '--filter-sql-expression', aliases: [], required: false, kind: 'string', dest: 'sqlExpression', help: 'SQL expression. e.g. myproperty=test.' }
const CORRELATION_ARGS = [
  { name: '--correlation-id', aliases: [], required: false, kind: 'string', dest: 'correlationId', help: 'Identifier of correlation.' },
  { name: '--label', aliases: [], required: false, kind: 'string', dest: 'label', help: 'Application specific label.' },
  { name: '--message-id', aliases: [], required: false, kind: 'string', dest: 'messageId', help: 'Identifier of message.' },
  { name: '--to', aliases: [], required: false, kind: 'string', dest: 'to', help: 'Address to send to.' },
  { name: '--reply-to', aliases: [], required: false, kind: 'string', dest: 'replyTo', help: 'Address of the queue to reply to.' },
  { name: '--session-id', aliases: [], required: false, kind: 'string', dest: 'sessionId', help: 'Session identifier.' },
  { name: '--content-type', aliases: [], required: false, kind: 'string', dest: 'contentType', help: 'Content type of message.' },
]
const SCOPE = [NAME, ARG.namespace, ARG.topic, ARG.subscription, ARG.resourceGroup]

function correlationFilter(v) {
  const entries = CORRELATION_ARGS.map((a) => [a.dest, v[a.dest]]).filter(([, val]) => val !== undefined)
  return entries.length ? Object.fromEntries(entries) : null
}

// Ruling N: events carry the canonical stored name/topic/subscription/namespace/
// resourceGroup — never the user-typed `v.*` casing. `ns`/`t`/`s` are fetched via
// ops before the mutation; `name` is the stored rule name (resource.name on
// create/update, ops.getRule(...).name on delete).
const rEvent = (type, ns, t, s, name) => event(type, 'rule', { name, resourceGroup: ns.resourceGroup, namespace: ns.name, topic: t.name, subscription: s.name })

export const ruleGroup = defineGroup(['servicebus', 'topic', 'subscription', 'rule'], 'Manage Azure Service Bus Rule.', {
  create: defineCommand(['servicebus', 'topic', 'subscription', 'rule', 'create'], 'Create the ServiceBus Rule for Subscription.', {
    latencyMs: LATENCY.mutate,
    args: [...SCOPE, FILTER_TYPE, SQL, ...CORRELATION_ARGS],
    examples: [{ summary: 'Create Rule.', command: "az servicebus topic subscription rule create --resource-group myresourcegroup --namespace-name mynamespace --topic-name mytopic --subscription-name mysubscription --name myrule --filter-sql-expression \"myproperty='test'\"" }],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const t = ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.topic)
      const s = ops.getSubscription(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription)
      const existed = s.rules.some((r) => r.name.toLowerCase() === v.name.toLowerCase())
      const { sandbox: next, resource } = ops.createRule(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, subscription: v.subscription, name: v.name, filterType: v.filterType ?? 'SqlFilter', sqlExpression: v.sqlExpression ?? null, correlationFilter: correlationFilter(v) })
      return { sandbox: next, output: presentRule(resource, s, t, ns), events: [rEvent(existed ? 'updated' : 'created', ns, t, s, resource.name)] }
    },
  }),
  show: defineCommand(['servicebus', 'topic', 'subscription', 'rule', 'show'], 'Get the description for the specified rule.', {
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const t = ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.topic)
      const s = ops.getSubscription(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription)
      return { sandbox, output: presentRule(ops.getRule(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription, v.name), s, t, ns) }
    },
  }),
  list: defineCommand(['servicebus', 'topic', 'subscription', 'rule', 'list'], 'List all the rules within given topic-subscription.', {
    args: [ARG.namespace, ARG.topic, ARG.subscription, ARG.resourceGroup],
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const t = ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.topic)
      const s = ops.getSubscription(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription)
      return { sandbox, output: ops.listRules(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription).map((r) => presentRule(r, s, t, ns)) }
    },
  }),
  delete: defineCommand(['servicebus', 'topic', 'subscription', 'rule', 'delete'], 'Delete an existing rule.', {
    latencyMs: LATENCY.mutate,
    args: SCOPE,
    run: ({ sandbox }, v) => {
      const ns = ops.getNamespace(sandbox, v.resourceGroup, v.namespace)
      const t = ops.getTopic(sandbox, v.resourceGroup, v.namespace, v.topic)
      const s = ops.getSubscription(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription)
      const r = ops.getRule(sandbox, v.resourceGroup, v.namespace, v.topic, v.subscription, v.name)
      const { sandbox: next } = ops.deleteRule(sandbox, { resourceGroup: v.resourceGroup, namespace: v.namespace, topic: v.topic, subscription: v.subscription, name: v.name })
      return { sandbox: next, output: null, events: [rEvent('deleted', ns, t, s, r.name)] }
    },
  }),
})
