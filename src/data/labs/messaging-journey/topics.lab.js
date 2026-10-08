import { SERVICEBUS_TOPICS_STARTER_FILES, SERVICEBUS_TOPICS_SOLUTION_FILES } from '../../templates/messaging-python/servicebus.js'
import { messagingMetadata, messagingTask, file, command, ordersNamespace, baselineReadme, exerciseTask, GROUP_ID, NAMESPACE_ID, exactOrder, receiptApplicationWork } from './helpers.js'
import { seedMessagingStage } from './seeds.js'

const TOPIC_ID = `${NAMESPACE_ID}/topics/order-work`
const EU_ID = `${TOPIC_ID}/subscriptions/eu-orders`, ALL_ID = `${TOPIC_ID}/subscriptions/all-orders`
const topic = sandbox => ordersNamespace(sandbox)?.topics.find(row => row.name === 'order-work')
const subscriptionsReady = ({ sandbox }) => {
  const subscriptions = topic(sandbox)?.subscriptions ?? []
  const eu = subscriptions.find(row => row.name === 'eu-orders'), all = subscriptions.find(row => row.name === 'all-orders')
  return ordersNamespace(sandbox)?.sku === 'Standard' && topic(sandbox)?.status === 'Active'
    && eu?.status === 'Active' && all?.status === 'Active'
    && eu.rules.length === 1 && eu.rules[0].name === 'eu' && eu.rules[0].filterType === 'SqlFilter' && eu.rules[0].sqlExpression === "region = 'EU'"
    && all.rules.length === 1 && all.rules[0].name === '$Default' && all.rules[0].filterType === 'SqlFilter'
    && typeof all.rules[0].sqlExpression === 'string' && /^1\s*=\s*1$/.test(all.rules[0].sqlExpression.trim())
}
const scope = '--resource-group rg-messaging --namespace-name sb-orders'
const configure = messagingTask({ id: 'configure-order-subscriptions',
  text: 'Create topic order-work and independent eu-orders/all-orders subscriptions on prepared Standard sb-orders in rg-messaging. Delete eu-orders rule $Default before adding SqlFilter rule eu with region = \'EU\'. Keep all-orders accepting every message. No earlier Lab completion is required.',
  rationale: { concept: 'Topic fan-out and subscription filters', what: 'Each matching subscription owns a separate message copy and settlement.', why: 'EU orders need a regional consumer while the all-orders consumer receives EU and US orders.', without: 'Keeping $Default makes the EU subscription accept US as well because rules combine as alternatives.', csharp: 'C# CreateRuleOptions configures SqlRuleFilter against message application properties; each subscription has its own ServiceBusReceiver.' },
  check: subscriptionsReady,
  solution: { steps: [
    command(`az servicebus topic create ${scope} --name order-work`),
    command(`az servicebus topic subscription create ${scope} --topic-name order-work --name eu-orders`),
    command(`az servicebus topic subscription create ${scope} --topic-name order-work --name all-orders`),
    command(`az servicebus topic subscription rule delete ${scope} --topic-name order-work --subscription-name eu-orders --name '$Default'`),
    command(`az servicebus topic subscription rule create ${scope} --topic-name order-work --subscription-name eu-orders --name eu --filter-type SqlFilter --filter-sql-expression "region = 'EU'"`),
  ] },
})
const dependencies = { paths: ['producer.py', 'worker.py', 'clients.py', 'training_runtime.py'], resourceIds: [GROUP_ID, NAMESPACE_ID, TOPIC_ID, EU_ID, ALL_ID], check: subscriptionsReady }
const publish = messagingTask({ id: 'publish-regional-orders',
  text: 'Implement producer.py main to send eu1 (o1, EU, quantity 2) and us1 (o2, US, quantity 1) to topic order-work. Put region in each message application_properties using its actual payload. Save producer.py and run python producer.py to verify routing and unlock the consumer task.',
  rationale: { concept: 'Application properties drive routing', what: 'Adds routing metadata to the ServiceBusMessage envelope independently of its JSON body.', why: 'The subscription SQL rule reads application_properties.region, so a body field alone cannot route EU orders.', without: 'Copies reach the wrong subscription or fail to match the regional rule.', csharp: 'C# sets ServiceBusMessage.ApplicationProperties["region"] before sending to a topic.' },
  ...dependencies, paths: dependencies.paths.filter(path => path !== 'worker.py'), solution: { steps: [file('producer.py', SERVICEBUS_TOPICS_SOLUTION_FILES['producer.py']), command('python producer.py')] },
})
const consume = messagingTask({ id: 'consume-independent-subscriptions',
  text: 'Implement worker.process_subscriptions to consume eu-orders and all-orders with separate subscription receivers. Decode each actual copy, perform its independent consumer work, record the order and complete that copy. Save worker.py and run python worker.py. EU copy work and all-orders copy work are separate effects in this exercise: o1 has two, o2 has one.',
  rationale: { concept: 'Independent subscription consumption', what: 'Receives and settles each subscription copy using its own lock.', why: 'Completing the EU copy must not consume the all-orders copy. These two consumers deliberately perform separate work; a single shared whole-order guard would suppress the second consumer.', without: 'A skipped or wrongly selected subscription retains its active copy even if another consumer finishes.', csharp: 'C# creates a receiver with both topicName and subscriptionName and completes the received copy.' },
  hints: ['Use get_subscription_receiver(topic_name="order-work", subscription_name=...) for each subscription.', 'record_processed is an idempotent teaching marker; actual work is required for each independent copy.'],
  ...dependencies, paths: dependencies.paths.filter(path => path !== 'producer.py'), solution: { steps: [file('worker.py', SERVICEBUS_TOPICS_SOLUTION_FILES['worker.py']), command('python worker.py')] },
})

function publishedCopies(measurement) {
  const rows = measurement.receipts.servicebus
  if (rows.length !== 3) return false
  const eu = rows.find(row => row.entityId === EU_ID && row.messageId === 'eu1')
  const allEu = rows.find(row => row.entityId === ALL_ID && row.messageId === 'eu1')
  const us = rows.find(row => row.entityId === ALL_ID && row.messageId === 'us1')
  if (!eu || !allEu || !us || eu.sourceMessageId !== allEu.sourceMessageId || us.sourceMessageId === eu.sourceMessageId) return false
  return rows.every(row => row.status === 'active' && row.subQueue === 'active' && row.lockHistory.length === 0
      && exactOrder(JSON.parse(row.body), row.messageId === 'eu1' ? { id: 'o1', region: 'EU', quantity: 2 } : { id: 'o2', region: 'US', quantity: 1 })
      && exactOrder(row.properties, { region: row.messageId === 'eu1' ? 'EU' : 'US' })
      && measurement.trace.some(trace => trace.kind === 'enqueue' && trace.entityId === row.entityId && trace.messageRecordId === row.id && trace.sourceMessageId === row.sourceMessageId)
      && measurement.trace.some(trace => trace.kind === 'send' && trace.entityId === TOPIC_ID && trace.messageId === row.messageId && trace.sourceMessageId === row.sourceMessageId))
    && measurement.trace.filter(trace => trace.kind === 'send').length === 2
    && !measurement.trace.some(trace => ['receive', 'order-work', 'order-record'].includes(trace.kind))
    && Object.keys(measurement.effects.after).length === 0
}

function independentCopies(measurement) {
  const rows = measurement.receipts.servicebus
  if (rows.length !== 3) return false
  const eu = rows.find(row => row.entityId === EU_ID && row.messageId === 'eu1')
  const allEu = rows.find(row => row.entityId === ALL_ID && row.messageId === 'eu1')
  const us = rows.find(row => row.entityId === ALL_ID && row.messageId === 'us1')
  if (!eu || !allEu || !us || eu.id === allEu.id || eu.sourceMessageId !== allEu.sourceMessageId || us.sourceMessageId === eu.sourceMessageId) return false
  const euOrder = { id: 'o1', region: 'EU', quantity: 2 }, usOrder = { id: 'o2', region: 'US', quantity: 1 }
  const markers = measurement.trace.filter(trace => trace.kind === 'order-record' && trace.order.id === 'o1')
  if (markers.length !== 2 || !markers[0].changed || markers[1].changed) return false
  const euFirst = markers[0].messageRecordId === eu.id
  return rows.every(row => exactOrder(row.properties, { region: row.messageId === 'eu1' ? 'EU' : 'US' }))
    && receiptApplicationWork(measurement, eu, euOrder, euFirst) && receiptApplicationWork(measurement, allEu, euOrder, !euFirst) && receiptApplicationWork(measurement, us, usOrder)
    && measurement.trace.filter(trace => ['order-work', 'order-record'].includes(trace.kind)).length === 6
    && (measurement.effects.after.workByOrder?.o1 ?? 0) - (measurement.effects.before.workByOrder?.o1 ?? 0) === 2
    && (measurement.effects.after.workByOrder?.o2 ?? 0) - (measurement.effects.before.workByOrder?.o2 ?? 0) === 1
    && Object.keys(measurement.effects.after.workByOrder ?? {}).length === 2
    && Object.keys(measurement.effects.after.processed ?? {}).length === 2
    && exactOrder(measurement.effects.after.processed.o1, euOrder) && exactOrder(measurement.effects.after.processed.o2, usOrder)
}

export const topicsLab = {
  ...messagingMetadata, contentVersion: 2, id: 'messaging-topics', title: 'Simulated: Route and consume independent topic copies', journeyOrder: 5, minutes: 40,
  brief: 'Create a topic and EU/all subscriptions, then write Python SDK-shaped publisher and consumers. Independent baseline supplies rg-messaging, Standard sb-orders and earlier orders queue configuration only. No topic, new code answers or execution proof are supplied. No previous Lab is required; routing and effects are bounded simulations.',
  initialProjectFiles: { ...SERVICEBUS_TOPICS_STARTER_FILES, 'README.md': baselineReadme('Independent prepared baseline: rg-messaging in West Europe, Standard sb-orders and empty earlier-stage orders queue. New order-work topic/subscriptions/rule must be configured; producer.py and worker.py are unfinished. Save producer.py and run python producer.py to publish and verify the routed EU and US copies. Then save worker.py and run python worker.py to independently process each copy. The two subscriptions represent separate consumers: o1 work occurs twice, while the teaching processed marker remains idempotent. No messages, business effects, receipts or evidence are seeded.') },
  initializeSimulation: run => seedMessagingStage(run, 'topics'), tasks: [configure, publish, consume],
  messagingExercise: { commands: [{ entry: 'producer.py', mode: 'script' }, { entry: 'worker.py', mode: 'script' }], tasks: [exerciseTask(publish, 'producer.py', publishedCopies), exerciseTask(consume, 'worker.py', independentCopies)] },
}
