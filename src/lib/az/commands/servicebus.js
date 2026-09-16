import { defineGroup } from '../tree.js'
import { namespaceGroup } from './servicebus-namespace.js'
import { queueGroup } from './servicebus-queue.js'
import { topicGroup } from './servicebus-topic.js'

export const servicebusGroup = defineGroup(['servicebus'], 'Manage Azure Service Bus namespaces, queues, topics, subscriptions, rules and geo-disaster recovery configuration alias.', {
  namespace: namespaceGroup,
  queue: queueGroup,
  topic: topicGroup,
})
