import { defineGroup } from '../tree.js'

// Namespace, topic, subscription and rule groups are added in Tasks 6-7.
// `queue` is present here (empty) only so `az servicebus queue ...` and the
// typo-suggestion test ('quene' -> 'queue') resolve; Task 6 replaces this
// whole file when it wires up the real queue commands.
export const servicebusGroup = defineGroup(['servicebus'], 'Manage Azure Service Bus namespaces, queues, topics, subscriptions, rules and geo-disaster recovery configuration alias.', {
  queue: defineGroup(['servicebus', 'queue'], 'Manage Azure Service Bus Queue and Authorization Rule.', {}),
})
