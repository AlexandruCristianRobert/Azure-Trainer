import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { messagingDependencies } from '../../../lib/messaging/evidence.js'

export const MESSAGING_GROUP = 'rg-messaging'
export const MESSAGING_NAMESPACE = 'sb-orders'
export const ORDERS_TARGET = Object.freeze({ resourceGroup: MESSAGING_GROUP, namespace: MESSAGING_NAMESPACE, queue: 'orders' })
export const GROUP_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${MESSAGING_GROUP}`.toLowerCase()
export const NAMESPACE_ID = `${GROUP_ID}/providers/microsoft.servicebus/namespaces/${MESSAGING_NAMESPACE}`
export const ORDERS_ID = `${NAMESPACE_ID}/queues/orders`
export const EVENT_TOPIC_ID = `${GROUP_ID}/providers/microsoft.eventgrid/topics/evgt-orders`
export const EVENT_SUBSCRIPTION_ID = `${EVENT_TOPIC_ID}/eventsubscriptions/order-notifications`
export const EVENT_ENDPOINT = 'https://orders.trainer.invalid/events'
export const STORAGE_ID = `${GROUP_ID}/providers/microsoft.storage/storageaccounts/stmessagingorders`
export const EVENT_DESTINATION = `${STORAGE_ID}/blobservices/default/containers/event-deadletters`
export const eventTopic = sandbox => sandbox.eventGridTopics.find(row => eq(row.resourceGroup, MESSAGING_GROUP) && eq(row.name, 'evgt-orders'))
export const eventSubscription = sandbox => eventTopic(sandbox)?.eventSubscriptions.find(row => eq(row.name, 'order-notifications'))
export const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
export const ordersNamespace = sandbox => sandbox.namespaces.find(row => eq(row.resourceGroup, MESSAGING_GROUP) && eq(row.name, MESSAGING_NAMESPACE))
export const ordersQueue = sandbox => ordersNamespace(sandbox)?.queues.find(row => eq(row.name, 'orders'))
export const ordersReady = ({ sandbox }) => ordersNamespace(sandbox)?.sku === 'Standard' && ordersQueue(sandbox)?.status === 'Active'

// Resolve actual Sandbox configuration by full ARM path. Parent projections omit
// child collections so creating an unrelated queue does not stale orders proof.
export function messagingResourceById(sandbox, id) {
  const parts = id.toLowerCase().split('/').filter(Boolean)
  if (parts[0] !== 'subscriptions' || parts[1] !== SUBSCRIPTION_ID.toLowerCase() || parts[2] !== 'resourcegroups') return null
  const group = sandbox.resourceGroups.find(row => eq(row.name, parts[3]))
  if (!group) return null
  if (parts.length === 4) return group
  if (parts[4] === 'providers' && parts[5] === 'microsoft.eventgrid' && parts[6] === 'topics') {
    const topic = sandbox.eventGridTopics.find(row => eq(row.resourceGroup, group.name) && eq(row.name, parts[7]))
    if (!topic) return null
    if (parts.length === 8) { const { eventSubscriptions, ...configuration } = topic; return configuration }
    return parts.length === 10 && parts[8] === 'eventsubscriptions' ? topic.eventSubscriptions.find(row => eq(row.name, parts[9])) ?? null : null
  }
  if (parts[4] === 'providers' && parts[5] === 'microsoft.storage' && parts[6] === 'storageaccounts') {
    const account = sandbox.storageAccounts.find(row => eq(row.resourceGroup, group.name) && eq(row.name, parts[7]))
    if (!account) return null
    if (parts.length === 8) { const { blobContainers, ...configuration } = account; return configuration }
    return parts.length === 12 && parts[8] === 'blobservices' && parts[9] === 'default' && parts[10] === 'containers'
      && account.blobContainers?.includes(parts[11]) ? { name: parts[11], storageAccount: account.name, resourceGroup: account.resourceGroup } : null
  }
  if (parts[4] !== 'providers' || parts[5] !== 'microsoft.servicebus' || parts[6] !== 'namespaces') return null
  const namespace = sandbox.namespaces.find(row => eq(row.resourceGroup, group.name) && eq(row.name, parts[7]))
  if (!namespace) return null
  if (parts.length === 8) {
    const { queues, topics, ...configuration } = namespace
    return configuration
  }
  if (parts[8] === 'queues' && parts.length === 10) return namespace.queues.find(row => eq(row.name, parts[9])) ?? null
  if (parts[8] !== 'topics') return null
  const topic = namespace.topics.find(row => eq(row.name, parts[9]))
  if (!topic) return null
  if (parts.length === 10) {
    const { subscriptions, ...configuration } = topic
    return configuration
  }
  if (parts[10] === 'subscriptions' && parts.length === 12) return topic.subscriptions.find(row => eq(row.name, parts[11])) ?? null
  return null
}

export function messagingTask({ id, text, rationale, hints = [], solution, paths = [], resourceIds = [], check }) {
  return {
    id, text, rationale, hints, solution, check,
    ...(paths.length ? {
      verification: { scenarioId: `${id}-behavior`, scenarioVersion: 1 },
      dependencies: messagingDependencies({ files: paths, resources: Object.fromEntries(resourceIds.map(id => [id, sandbox => messagingResourceById(sandbox, id)])) }),
    } : {}),
  }
}

export const file = (path, content) => ({ kind: 'file', path, content })
export const command = line => ({ kind: 'command', line })
export const orderResources = [GROUP_ID, NAMESPACE_ID, ORDERS_ID]
export const messagingMetadata = Object.freeze({ engineVersion: 2, contentVersion: 1, journeyId: 'messaging-orders', skillAreaId: 'connect', service: 'service-bus', status: 'available', labMode: 'guided', manifestId: 'messaging-python-v1', capabilities: { messaging: true } })
export const baselineReadme = description => `# Orders: simulated Service Bus\n\n${description}\n\nThis trainer executes a bounded synchronous Python SDK subset, without Python processes, Azure authentication, network calls, or production durability. DefaultAzureCredential is a simulated trainer identity. Work and processed records are protected teaching helpers, not a production database. Only 50 executions and 50 retained messages are supported per attempt; reset restores the supplied fixture and clears proof.\n`

export const exerciseTask = (task, entry, check) => ({ taskId: task.id, ...task.verification, entry, mode: 'script', check })
export const eventResources = [GROUP_ID, NAMESPACE_ID, EVENT_TOPIC_ID]
export const eventReady = ({ sandbox }) => ordersNamespace(sandbox)?.sku === 'Standard' && eventTopic(sandbox)?.inputSchema === 'EventGridSchema'
export const eventReadme = description => baselineReadme(description) + '\nEvent Grid publication and callback registration are simulations: no Azure webhook deployment. The trainer bridge delivers actual event envelopes and drains bounded due retries with logical ticks, without real waits or Azure retry timing guarantees. No FIFO/exactly-once guarantee or real blob durability.\n'

export function exactEvent(actual, expected) {
  return actual?.id === expected.id && actual.subject === expected.subject && actual.eventType === expected.eventType
    && actual.dataVersion === expected.dataVersion && exactOrder(actual.data, expected.data)
    && Object.keys(actual).length === 5
}

export function publishedEvents(measurement, expected) {
  const rows = measurement.trace.filter(row => row.kind === 'publish')
  return rows.length === expected.length && rows.every((row, index) => row.topicId === EVENT_TOPIC_ID
    && exactEvent(row.event, expected[index]) && !!row.eventRecordId)
}

export function notifiedDelivery(measurement, row, expected) {
  if (!row || row.subscriptionId !== EVENT_SUBSCRIPTION_ID || row.endpointType !== 'WebHook' || row.endpoint !== EVENT_ENDPOINT
    || row.status !== 'delivered' || row.lastStatus !== 200 || !exactEvent(row.event, expected)) return false
  const linked = trace => trace.deliveryId === row.id && trace.eventRecordId === row.eventRecordId
  const notifications = measurement.trace.filter(trace => trace.kind === 'notification' && linked(trace))
  if (notifications.length !== 1) return false
  const work = notifications[0]
  return work.attempts === row.attempts && work.changed && work.eventId === row.event.id && work.orderId === row.event.data.order_id
    && measurement.trace.some((trace, index) => index > measurement.trace.indexOf(work) && trace.kind === 'delivered' && linked(trace) && trace.attempts === work.attempts)
    && exactOrder(measurement.effects.after.notifications?.[row.event.id], { eventId: row.event.id, orderId: row.event.data.order_id })
}

export function orderPayload(body, id, quantity) {
  try {
    const order = typeof body === 'string' ? JSON.parse(body) : body
    return order?.id === id && order.region === 'EU' && order.quantity === quantity
      && Object.keys(order).length === 3
  } catch { return false }
}

export const receiptOperation = (measurement, row, kind, subQueue) => measurement.trace.findIndex(trace => trace.kind === kind
  && trace.entityId === ORDERS_ID && trace.messageRecordId === row.id && trace.messageId === row.messageId
  && (subQueue === undefined || trace.subQueue === subQueue)
  && (kind === 'enqueue' || row.lockHistory.some(lock => lock.lockToken === trace.lockToken && lock.receiverId === trace.receiverId && lock.settlement === kind)))

export function completedOrderWork(measurement, row, id, quantity) {
  const completeAt = receiptOperation(measurement, row, 'complete', 'active')
  const complete = measurement.trace[completeAt]
  if (!complete) return false
  const linked = trace => trace.entityId === row.entityId && trace.messageRecordId === row.id && trace.messageId === row.messageId
    && trace.receiverId === complete.receiverId && trace.lockToken === complete.lockToken
  const rows = measurement.trace.filter(trace => ['order-work', 'order-record'].includes(trace.kind) && linked(trace))
  if (rows.length !== 2 || rows[0].kind !== 'order-work' || rows[1].kind !== 'order-record'
    || rows.some(trace => !trace.changed || !orderPayload(trace.order, id, quantity))) return false
  const workAt = measurement.trace.indexOf(rows[0]), markerAt = measurement.trace.indexOf(rows[1])
  return measurement.trace.some((trace, index) => index < workAt && trace.kind === 'receive' && linked(trace))
    && workAt < markerAt && markerAt < completeAt && orderPayload(row.body, id, quantity)
    && (measurement.effects.after.workByOrder?.[id] ?? 0) - (measurement.effects.before.workByOrder?.[id] ?? 0) === 1
    && orderPayload(measurement.effects.after.processed?.[id], id, quantity)
}

// Advanced copies/steps have distinct business semantics. This checks only the
// actual same-lock application sequence; each Lab owns its effect policy.
export const exactOrder = (actual, expected) => actual && typeof actual === 'object'
  && Object.keys(actual).length === Object.keys(expected).length
  && Object.entries(expected).every(([key, value]) => actual[key] === value)

export function receivedCompletion(measurement, row) {
  if (row.status !== 'completed' || row.subQueue !== 'active' || row.lockHistory.length !== 1) return null
  const lock = row.lockHistory[0]
  if (lock.settlement !== 'complete') return null
  const linked = trace => trace.entityId === row.entityId && trace.messageRecordId === row.id
    && trace.messageId === row.messageId && trace.receiverId === lock.receiverId && trace.lockToken === lock.lockToken
  const receiveAt = measurement.trace.findIndex(trace => trace.kind === 'receive' && trace.subQueue === 'active' && linked(trace))
  const completeAt = measurement.trace.findIndex(trace => trace.kind === 'complete' && trace.subQueue === 'active' && linked(trace))
  return receiveAt >= 0 && completeAt > receiveAt ? { linked, receiveAt, completeAt } : null
}

export function receiptApplicationWork(measurement, row, expectedOrder, recordChanged = true) {
  const receipt = receivedCompletion(measurement, row)
  if (!receipt || !exactOrder(JSON.parse(row.body), expectedOrder)) return false
  const work = measurement.trace.filter(trace => ['order-work', 'order-record'].includes(trace.kind) && receipt.linked(trace))
  if (work.length !== 2 || work[0].kind !== 'order-work' || !work[0].changed
    || work[1].kind !== 'order-record' || work[1].changed !== recordChanged
    || work.some(trace => !exactOrder(trace.order, expectedOrder))) return false
  const workAt = measurement.trace.indexOf(work[0]), markerAt = measurement.trace.indexOf(work[1])
  return receipt.receiveAt < workAt && workAt < markerAt && markerAt < receipt.completeAt
}
