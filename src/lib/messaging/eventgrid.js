import { SUBSCRIPTION_ID, isSandboxShape } from '../sandbox/model.js'
import { getEventGridTopic } from '../sandbox/eventgrid.js'
import { resolveEventGridDeadLetter, isValidEventGridWebhookEndpoint, resolveEventGridFunction } from '../sandbox/eventgrid-validation.js'
import { eventGridTopicId, eventGridSubscriptionId } from '../az/eventgrid-arm.js'
import { finiteJson, plainObject, validateMessagingState } from './state.js'
import { applyServiceBusOperation } from './servicebus.js'

const clone = value => JSON.parse(JSON.stringify(value))
const counter = value => Number.isSafeInteger(value) && value >= 0
const text = value => typeof value === 'string' && value.length > 0
function reject(code, message) { throw Object.assign(new Error(message), { messagingCode: code }) }
const config = message => reject('MESSAGING_CONFIG', message)
const runtime = message => reject('MESSAGING_RUNTIME', message)
export const validEventGridEnvelope = event => plainObject(event) && text(event.id) && typeof event.subject === 'string'
  && text(event.eventType) && text(event.dataVersion) && Object.hasOwn(event, 'data') && finiteJson(event.data)
  && new TextEncoder().encode(JSON.stringify(event)).length <= 128 * 1024

/** Trusted Lab registration is checked independently of callback execution/delivery status. */
export function validateEventGridWebhookRegistration(sandbox, registrations) {
  if (!plainObject(registrations) || !finiteJson(registrations) || Object.keys(registrations).length > 50) return false
  return Object.entries(registrations).every(([endpoint, path]) => isValidEventGridWebhookEndpoint(endpoint)
    && typeof path === 'string' && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.py$/.test(path)
    && (sandbox.eventGridTopics ?? []).some(topic => topic.eventSubscriptions.some(subscription => subscription.endpointType === 'WebHook' && subscription.endpoint === endpoint)))
}

/** Readiness check precedes source execution so early/terminal records cannot cause handler effects. */
export function getEventGridDelivery(state, sandbox, deliveryId) {
  if (!validateMessagingState(state) || !isSandboxShape(sandbox)) config('Invalid messaging state or Event Grid configuration.')
  const record = state.eventGrid?.deliveries.find(record => record.id === deliveryId)
  if (!record) runtime('The Event Grid delivery was not found.')
  if (!['pending', 'retrying'].includes(record.status)) runtime('The Event Grid delivery is already terminal.')
  if (record.expiresAtMs <= state.timeMs) runtime('The Event Grid delivery TTL has expired; advance logical time to record its outcome.')
  if (record.nextAttemptAtMs > state.timeMs) runtime('The next attempt is not due in logical simulator ticks.')
  const topic = sandbox.eventGridTopics.find(topic => eventGridTopicId(topic).toLowerCase() === state.eventGrid.events.find(event => event.id === record.eventRecordId)?.topicId)
  const subscription = topic?.eventSubscriptions.find(subscription => eventGridSubscriptionId(topic, subscription).toLowerCase() === record.subscriptionId)
  if (!subscription || subscription.endpoint !== record.endpoint || subscription.endpointType !== record.endpointType) config('The actual Event Grid delivery subscription/endpoint is unavailable or changed.')
  if (record.endpointType === 'AzureFunction' && !resolveEventGridFunction(sandbox, record.endpoint, SUBSCRIPTION_ID)) config('The target Function App is unavailable.')
  return clone(record)
}

/** Finite, immutable simulator operations; no network or real Azure retry schedule. */
export function applyEventGridOperation(state, sandbox, operation) {
  const trace = []
  try {
    if (!validateMessagingState(state) || !isSandboxShape(sandbox) || !plainObject(operation) || !finiteJson(operation)) config('Invalid messaging state, operation, or Event Grid configuration.')
    const next = clone(state)
    next.eventGrid ??= { events: [], deliveries: [], traces: [] }
    const grid = next.eventGrid
    const allocate = prefix => {
      if (next.nextId >= Number.MAX_SAFE_INTEGER) reject('MESSAGING_LIMIT', 'Messaging identity counter is exhausted.')
      return `${prefix}-${next.nextId++}`
    }
    const emit = (kind, record = null, eventRecordId = null) => {
      const receipt = { id: allocate('eg-trace'), kind, timeMs: next.timeMs, deliveryId: record?.id ?? null, eventRecordId: record?.eventRecordId ?? eventRecordId, attempts: record?.attempts ?? null, status: record?.status ?? null, reason: record?.reason ?? null, timing: 'logical-simulator-ticks' }
      if (kind === 'publish') {
        const source = grid.events.find(event => event.id === eventRecordId)
        receipt.topicId = source.topicId; receipt.event = clone(source.event)
      }
      grid.traces.push(receipt); trace.push(clone(receipt))
      if (grid.traces.length > 500) grid.traces.shift()
    }
    const finish = (record, reason) => {
      record.reason = reason; record.nextAttemptAtMs = null
      if (record.deadLetterDestination && resolveEventGridDeadLetter(sandbox, record.deadLetterDestination, SUBSCRIPTION_ID)) {
        record.status = 'deadlettered'
        record.deadLetter = { destination: record.deadLetterDestination, event: clone(record.event), reason, attempts: record.attempts, timeMs: next.timeMs }
      } else {
        record.status = 'dropped'
        if (record.deadLetterDestination) record.reason = 'DeadLetterDestinationUnavailable'
      }
      emit(record.status, record)
    }
    let value
    if (operation.kind === 'publish') {
      if (!plainObject(operation.target) || !text(operation.target.resourceGroup) || !text(operation.target.topic)) config('Supply Event Grid resourceGroup/topic target.')
      const topic = getEventGridTopic(sandbox, operation.target.resourceGroup, operation.target.topic)
      if (!Array.isArray(operation.events) || operation.events.some(event => !validEventGridEnvelope(event))) config('Publish requires EventGridSchema event envelopes.')
      if (operation.events.length > 50 || grid.events.length + operation.events.length > 50) reject('MESSAGING_LIMIT', 'Event Grid fixture exceeds 50 events.')
      value = []
      for (const event of operation.events) {
        const source = { id: allocate('eg-event'), topicId: eventGridTopicId(topic).toLowerCase(), event: clone(event), publishedAtMs: next.timeMs }
        grid.events.push(source); emit('publish', null, source.id)
        for (const subscription of topic.eventSubscriptions) {
          const filter = subscription.filter, normalize = value => filter.isSubjectCaseSensitive ? value : value.toLowerCase()
          if (filter.includedEventTypes.length && !filter.includedEventTypes.includes(event.eventType)
            || !normalize(event.subject).startsWith(normalize(filter.subjectBeginsWith)) || !normalize(event.subject).endsWith(normalize(filter.subjectEndsWith))) continue
          if (grid.deliveries.length >= 50) reject('MESSAGING_LIMIT', 'Event Grid fan-out exceeds 50 retained deliveries.')
          const record = { id: allocate('eg-delivery'), eventRecordId: source.id, subscriptionId: eventGridSubscriptionId(topic, subscription).toLowerCase(), endpointType: subscription.endpointType, endpoint: subscription.endpoint,
            event: clone(event), attempts: 0, maxDeliveryAttempts: subscription.maxDeliveryAttempts ?? 30, expiresAtMs: Math.min(Number.MAX_SAFE_INTEGER, next.timeMs + (subscription.eventTimeToLiveInMinutes ?? 1440) * 60000),
            nextAttemptAtMs: next.timeMs, status: 'pending', lastStatus: null, reason: null, deadLetterDestination: subscription.deadLetterDestination ?? null, deadLetter: null }
          grid.deliveries.push(record); value.push(record.id); emit('route', record)
        }
      }
    } else if (operation.kind === 'deliver') {
      getEventGridDelivery(state, sandbox, operation.deliveryId)
      if (!Number.isSafeInteger(operation.status) || operation.status < 100 || operation.status > 599) runtime('Delivery adapters must return an integer HTTP status (100-599).')
      const record = grid.deliveries.find(record => record.id === operation.deliveryId)
      record.attempts++; record.lastStatus = operation.status
      if (operation.status >= 200 && operation.status < 300) {
        record.status = 'delivered'; record.nextAttemptAtMs = null; emit('delivered', record)
      } else if ([400, 403, 413, ...(record.endpointType === 'WebHook' ? [401] : [])].includes(operation.status)) finish(record, 'NonRetryableStatus')
      else if (record.attempts >= record.maxDeliveryAttempts) finish(record, 'MaxDeliveryAttemptsExceeded')
      else {
        record.status = 'retrying'; record.nextAttemptAtMs = Math.min(Number.MAX_SAFE_INTEGER, next.timeMs + 1000); emit('retry', record)
      }
      value = clone(record)
    } else if (operation.kind === 'advance') {
      if (!counter(operation.milliseconds) || !Number.isSafeInteger(next.timeMs + operation.milliseconds)) runtime('Logical advance requires nonnegative safe integer milliseconds.')
      // Both brokers share the clock: expire Service Bus locks/leases as well.
      const advanced = applyServiceBusOperation(next, sandbox, operation)
      if (advanced.diagnostics.length) reject(advanced.diagnostics[0].code, advanced.diagnostics[0].message)
      for (const key of ['entities', 'deliveries', 'timeMs', 'nextId']) next[key] = advanced.state[key]
      trace.push(...advanced.trace)
      for (const record of grid.deliveries) if (['pending', 'retrying'].includes(record.status) && record.expiresAtMs <= next.timeMs) finish(record, 'TimeToLiveExceeded')
      emit('advance'); value = { timeMs: next.timeMs }
    } else reject('MESSAGING_UNSUPPORTED', `Unsupported Event Grid operation '${operation.kind}'.`)
    if (!validateMessagingState(next)) config('The Event Grid transition produced invalid persisted state.')
    return { state: next, value: clone(value), trace, diagnostics: [] }
  } catch (error) {
    return { state, value: null, trace: [], diagnostics: [{ code: error.messagingCode ?? 'MESSAGING_CONFIG', message: error.message, path: '', line: null, column: null }] }
  }
}
