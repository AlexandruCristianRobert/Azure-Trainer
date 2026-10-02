import { SUBSCRIPTION_ID } from '../sandbox/model.js'
import { isValidEventGridWebhookEndpoint, parseEventGridFunctionEndpoint, parseEventGridDeadLetterDestination, validRetryValue } from '../sandbox/eventgrid-validation.js'

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
export const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
const counter = value => Number.isSafeInteger(value) && value >= 0
const string = value => typeof value === 'string' && value.length > 0
const nullableString = value => value === null || string(value)

// Inspect descriptors instead of invoking getters while validating persisted input.
export function finiteJson(value, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (!value || typeof value !== 'object' || ancestors.has(value)) return false
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) return false
  } else if (!plainObject(value)) return false
  const keys = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'))
  if (Array.isArray(value) && keys.some((key, index) => key !== String(index))) return false
  ancestors.add(value)
  const valid = keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return typeof key === 'string' && descriptor.enumerable && own(descriptor, 'value') && finiteJson(descriptor.value, ancestors)
  })
  ancestors.delete(value)
  return valid
}

export function emptyMessagingState() {
  return { version: 1, nextId: 1, timeMs: 0, entities: {}, deliveries: [], effects: {}, hosts: {}, executionReceipts: [] }
}

/** Immutable command-boundary data; not executable IR or a grading outcome. */
function validExecutionMeasurement(value) {
  if (!plainObject(value) || Object.keys(value).sort().join(',') !== 'diagnostics,effects,entry,mode,receipts,sourcePaths,trace,value'
    || !['producer.py', 'worker.py', 'events.py', 'handler.py', 'function_app.py'].includes(value.entry)
    || !(value.mode === 'functions' ? value.entry === 'function_app.py' : value.mode === 'script' && value.entry !== 'function_app.py')
    || !Array.isArray(value.sourcePaths) || value.sourcePaths.length < 1 || value.sourcePaths.length > 20
    || !value.sourcePaths.includes(value.entry) || new Set(value.sourcePaths).size !== value.sourcePaths.length
    || value.sourcePaths.some(path => typeof path !== 'string' || path.length > 256)
    || !Array.isArray(value.trace) || value.trace.length > 500 || !Array.isArray(value.diagnostics) || value.diagnostics.length > 500
    || !plainObject(value.receipts) || Object.keys(value.receipts).sort().join(',') !== 'eventgrid,servicebus'
    || !Array.isArray(value.receipts.servicebus) || value.receipts.servicebus.length > 50
    || !Array.isArray(value.receipts.eventgrid) || value.receipts.eventgrid.length > 50
    || !plainObject(value.effects) || Object.keys(value.effects).sort().join(',') !== 'after,before'
    || !plainObject(value.effects.before) || !plainObject(value.effects.after)
    || new TextEncoder().encode(JSON.stringify(value.value)).length > 128 * 1024) return false
  let locks = 0
  for (const receipt of value.receipts.servicebus) {
    if (!plainObject(receipt) || !Array.isArray(receipt.lockHistory)) return false
    locks += receipt.lockHistory.length
  }
  if (locks > 500) return false
  for (const side of ['before', 'after']) for (const [family, entries] of Object.entries(value.effects[side])) {
    if (!['workByOrder', 'processed', 'notifications'].includes(family) || !plainObject(entries) || Object.keys(entries).length > 50) return false
  }
  return true
}

function validHostRecords(hosts, timeMs) {
  if (Object.keys(hosts).length > 16) return false
  const portable = path => path === 'local.settings.json' || typeof path === 'string' && /^(?:[A-Za-z_][A-Za-z0-9_]*\/)*[A-Za-z_][A-Za-z0-9_]*\.(?:py|json|txt)$/.test(path)
  for (const [key, host] of Object.entries(hosts)) {
    if (!plainObject(host) || Object.keys(host).some(field => !['appId', 'entry', 'generation', 'status', 'startedAtMs', 'sources', 'sourceVersions', 'handlers'].includes(field))
      || host.appId !== key || key !== key.toLowerCase() || !key.startsWith(`/subscriptions/${SUBSCRIPTION_ID}/`.toLowerCase())
      || !/^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.web\/sites\/[A-Za-z0-9-]+$/.test(key)
      || !portable(host.entry) || !host.entry.endsWith('.py') || !counter(host.generation) || host.generation < 1 || host.status !== 'stopped'
      || !counter(host.startedAtMs) || host.startedAtMs > timeMs || !plainObject(host.sources) || !plainObject(host.sourceVersions)
      || !own(host.sources, host.entry) || !own(host.sources, 'host.json') || !own(host.sources, 'local.settings.json')
      || Object.keys(host.sources).length > 20 || Object.keys(host.sourceVersions).length !== Object.keys(host.sources).length
      || Object.entries(host.sources).some(([path, source]) => !portable(path) || typeof source !== 'string' || new TextEncoder().encode(source).length > 128 * 1024 || !own(host.sourceVersions, path) || !counter(host.sourceVersions[path]))
      || !Array.isArray(host.handlers) || host.handlers.length < 1 || host.handlers.length > 50) return false
    const names = new Set(), identities = new Set()
    for (const handler of host.handlers) {
      if (!plainObject(handler) || !['servicebus', 'eventgrid'].includes(handler.kind)
        || Object.keys(handler).some(field => !['kind', 'functionName', 'argName', 'functionId', 'path', 'queueName', 'connection'].includes(field))
        || !string(handler.functionName) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(handler.functionName)
        || !string(handler.argName) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(handler.argName)
        || !portable(handler.path) || !handler.path.endsWith('.py') || !own(host.sources, handler.path)
        || typeof handler.functionId !== 'string' || !handler.functionId.startsWith(`${handler.path}:`) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(handler.functionId.slice(handler.path.length + 1))
        || names.has(handler.functionName.toLowerCase()) || identities.has(handler.functionId)
        || (handler.kind === 'servicebus' ? !string(handler.queueName) || !string(handler.connection) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(handler.connection) : handler.queueName !== undefined || handler.connection !== undefined)) return false
      names.add(handler.functionName.toLowerCase()); identities.add(handler.functionId)
    }
  }
  return true
}

export function validateMessagingState(state) {
  if (!finiteJson(state) || !plainObject(state) || state.version !== 1 || !counter(state.nextId) || state.nextId < 1
    || !counter(state.timeMs) || !plainObject(state.entities) || !Array.isArray(state.deliveries)
    || state.deliveries.length > 500 || !plainObject(state.effects) || !plainObject(state.hosts)) return false
  if (!validHostRecords(state.hosts, state.timeMs)) return false
  let maximumId = 0
  const allocated = new Set()
  const id = (value, unique = false, eventGrid = false) => {
    if (typeof value !== 'string') return false
    const match = (eventGrid ? /^(?:eg-event|eg-delivery|eg-trace)-([1-9]\d*)$/ : /^(?:message|lock|trace)-([1-9]\d*)$/).exec(value)
    if (!match || !Number.isSafeInteger(Number(match[1])) || (unique && allocated.has(value))) return false
    maximumId = Math.max(maximumId, Number(match[1]))
    if (unique) allocated.add(value)
    return true
  }
  const executions = state.executionReceipts === undefined ? [] : state.executionReceipts
  if (!Array.isArray(executions) || executions.length > 50) return false
  let previousExecution = 0
  for (const execution of executions) {
    const match = /^execution-([1-9]\d*)$/.exec(execution?.id)
    if (!plainObject(execution) || Object.keys(execution).sort().join(',') !== 'entry,id,measurements,mode'
      || !match || !counter(Number(match[1])) || Number(match[1]) <= previousExecution || allocated.has(execution.id)
      || !validExecutionMeasurement(execution.measurements)
      || execution.entry !== execution.measurements.entry || execution.mode !== execution.measurements.mode) return false
    const sequence = Number(match[1]), traces = new Set()
    for (const trace of execution.measurements.trace) {
      const traceId = /^(?:trace|eg-trace)-([1-9]\d*)$/.exec(trace?.id)
      if (!plainObject(trace) || !traceId || traces.has(trace.id) || Number(traceId[1]) <= previousExecution
        || Number(traceId[1]) >= sequence || !counter(trace.timeMs) || trace.timeMs > state.timeMs) return false
      const kinds = trace.id.startsWith('eg-trace-') ? ['publish', 'route', 'retry', 'delivered', 'deadlettered', 'dropped', 'advance']
        : ['send', 'duplicate', 'enqueue', 'receive', 'complete', 'abandon', 'deadletter', 'advance', 'lock-expired', 'message-expired']
      if (!kinds.includes(trace.kind)) return false
      traces.add(trace.id)
    }
    allocated.add(execution.id)
    maximumId = Math.max(maximumId, sequence)
    previousExecution = sequence
  }
  let messageCount = 0
  for (const [key, entity] of Object.entries(state.entities)) {
    if (!plainObject(entity) || entity.id !== key || key !== key.toLowerCase()
      || !/^\/subscriptions\/[^/]+\/resourcegroups\/[^/]+\/providers\/microsoft\.servicebus\/namespaces\/[^/]+\/(?:queues|topics)\/.+/.test(key)
      || !['queue', 'topic', 'subscription'].includes(entity.kind) || !plainObject(entity.target)
      || !string(entity.target.resourceGroup) || !string(entity.target.namespace)
      || !counter(entity.nextSequence) || entity.nextSequence < 1 || !Array.isArray(entity.messages)
      || !Array.isArray(entity.dedup) || entity.dedup.length > 50 || !plainObject(entity.sessions)) return false
    const target = entity.target
    const suffix = entity.kind === 'queue' ? `queues/${target.queue}` : `topics/${target.topic}${entity.kind === 'subscription' ? `/subscriptions/${target.subscription}` : ''}`
    if ((entity.kind === 'queue' ? !string(target.queue) || target.topic !== undefined || target.subscription !== undefined
      : !string(target.topic) || target.queue !== undefined || (entity.kind === 'subscription' ? !string(target.subscription) : target.subscription !== undefined))
      || key !== `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${target.resourceGroup}/providers/Microsoft.ServiceBus/namespaces/${target.namespace}/${suffix}`.toLowerCase()) return false
    if (!entity.dedup.every(entry => plainObject(entry) && string(entry.messageId) && counter(entry.acceptedAtMs)
      && entry.acceptedAtMs <= state.timeMs && counter(entry.expiresAtMs) && entry.expiresAtMs > entry.acceptedAtMs)) return false
    const sequences = new Set()
    for (const message of entity.messages) {
      messageCount++
      if (!plainObject(message) || !id(message.id, true) || !id(message.sourceMessageId)
        || message.entityId !== key || !counter(message.sequence) || message.sequence < 1
        || message.sequence >= entity.nextSequence || sequences.has(message.sequence)
        || typeof message.body !== 'string' || !string(message.messageId) || !plainObject(message.properties)
        || !nullableString(message.sessionId) || !['active', 'locked', 'completed', 'deadletter', 'expired'].includes(message.status)
        || !['active', 'deadletter'].includes(message.subQueue) || !counter(message.deliveryCount) || message.deliveryCount < 1
        || !counter(message.enqueuedAtMs) || message.enqueuedAtMs > state.timeMs || !counter(message.expiresAtMs)
        || !nullableString(message.deadLetterReason) || (message.deadLetterDescription !== null && typeof message.deadLetterDescription !== 'string')
        || !Array.isArray(message.lockHistory)) return false
      sequences.add(message.sequence)
      if (!message.lockHistory.every(lock => plainObject(lock) && id(lock.lockToken, true) && string(lock.receiverId)
        && counter(lock.lockedAtMs) && lock.lockedAtMs <= state.timeMs && counter(lock.lockedUntilMs) && lock.lockedUntilMs > lock.lockedAtMs
        && [null, 'complete', 'abandon', 'deadletter', 'expired'].includes(lock.settlement)
        && (lock.settlement === null ? lock.settledAtMs === null : counter(lock.settledAtMs) && lock.settledAtMs >= lock.lockedAtMs && lock.settledAtMs <= state.timeMs))) return false
      if (message.status === 'locked') {
        const lock = message.lockHistory.at(-1)
        if (!lock || lock.settlement !== null || message.lockToken !== lock.lockToken || message.receiverId !== lock.receiverId
          || message.lockedUntilMs !== lock.lockedUntilMs || message.lockedUntilMs <= state.timeMs) return false
      } else if (message.lockToken !== null || message.receiverId !== null || message.lockedUntilMs !== null) return false
      if (message.lockHistory.slice(0, message.status === 'locked' ? -1 : undefined).some(lock => lock.settlement === null)) return false
      if (['active', 'expired'].includes(message.status) && message.subQueue !== 'active') return false
      if (message.status === 'deadletter' && (message.subQueue !== 'deadletter' || !string(message.deadLetterReason))) return false
    }
    for (const lease of Object.values(entity.sessions)) {
      if (!plainObject(lease) || !string(lease.receiverId) || !counter(lease.lockedUntilMs) || lease.lockedUntilMs <= state.timeMs) return false
    }
  }
  if (messageCount > 50) return false
  for (const trace of state.deliveries) {
    if (!plainObject(trace) || !id(trace.id, true) || !['send', 'duplicate', 'enqueue', 'receive', 'complete', 'abandon', 'deadletter', 'advance', 'lock-expired', 'message-expired'].includes(trace.kind)
      || !counter(trace.timeMs) || trace.timeMs > state.timeMs
      || (trace.entityId !== null && !own(state.entities, trace.entityId))
      || (trace.entityId === null ? trace.targetKind !== null : trace.targetKind !== state.entities[trace.entityId].kind)
      || !nullableString(trace.messageId) || !nullableString(trace.sessionId) || !nullableString(trace.receiverId)
      || !nullableString(trace.reason) || ![null, 'active', 'deadletter'].includes(trace.subQueue)
      || (trace.deliveryCount !== null && (!counter(trace.deliveryCount) || trace.deliveryCount < 1))
      || (trace.sourceMessageId !== null && !id(trace.sourceMessageId))
      || (trace.messageRecordId !== null && !id(trace.messageRecordId))
      || (trace.lockToken !== null && !id(trace.lockToken))) return false
  }
  if (state.eventGrid !== undefined) {
    const grid = state.eventGrid
    const envelope = event => plainObject(event) && string(event.id) && typeof event.subject === 'string' && string(event.eventType) && string(event.dataVersion) && own(event, 'data')
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if (!plainObject(grid) || !Array.isArray(grid.events) || grid.events.length > 50 || !Array.isArray(grid.deliveries) || grid.deliveries.length > 50 || !Array.isArray(grid.traces) || grid.traces.length > 500) return false
    for (const event of grid.events) if (!plainObject(event) || !/^eg-event-/.test(event.id) || !id(event.id, true, true) || !envelope(event.event)
      || typeof event.topicId !== 'string' || !new RegExp(`^/subscriptions/${SUBSCRIPTION_ID}/resourcegroups/[^/]+/providers/microsoft\\.eventgrid/topics/[^/]+$`).test(event.topicId)
      || !counter(event.publishedAtMs) || event.publishedAtMs > state.timeMs) return false
    for (const delivery of grid.deliveries) {
      if (!plainObject(delivery)) return false
      const source = grid.events.find(event => event.id === delivery.eventRecordId)
      if (!plainObject(delivery) || !/^eg-delivery-/.test(delivery.id) || !id(delivery.id, true, true) || !source || !envelope(delivery.event) || !same(delivery.event, source.event)
        || typeof delivery.subscriptionId !== 'string' || !delivery.subscriptionId.startsWith(`${source.topicId}/eventsubscriptions/`) || !/\/eventsubscriptions\/[^/]+$/.test(delivery.subscriptionId) || delivery.subscriptionId !== delivery.subscriptionId.toLowerCase()
        || (delivery.endpointType === 'WebHook' ? !isValidEventGridWebhookEndpoint(delivery.endpoint) : delivery.endpointType !== 'AzureFunction' || !parseEventGridFunctionEndpoint(delivery.endpoint)
          || parseEventGridFunctionEndpoint(delivery.endpoint).subscriptionId.toLowerCase() !== SUBSCRIPTION_ID.toLowerCase())
        || !validRetryValue(delivery.maxDeliveryAttempts, 30) || !counter(delivery.attempts) || delivery.attempts > delivery.maxDeliveryAttempts
        || !counter(delivery.expiresAtMs) || delivery.expiresAtMs <= source.publishedAtMs || delivery.expiresAtMs > source.publishedAtMs + 1440 * 60000
        || !['pending', 'retrying', 'delivered', 'deadlettered', 'dropped'].includes(delivery.status)
        || !nullableString(delivery.reason)
        || (delivery.deadLetterDestination !== null && (!parseEventGridDeadLetterDestination(delivery.deadLetterDestination) || parseEventGridDeadLetterDestination(delivery.deadLetterDestination).subscriptionId.toLowerCase() !== SUBSCRIPTION_ID.toLowerCase()))) return false
      const pending = ['pending', 'retrying'].includes(delivery.status)
      const successfulStatus = delivery.lastStatus >= 200 && delivery.lastStatus < 300
      const nonRetryableFailure = delivery.attempts > 0 && [400, 403, 413, ...(delivery.endpointType === 'WebHook' ? [401] : [])].includes(delivery.lastStatus)
      const exhaustedFailure = delivery.attempts === delivery.maxDeliveryAttempts && !successfulStatus
      if (pending ? !counter(delivery.nextAttemptAtMs) || delivery.nextAttemptAtMs < source.publishedAtMs || delivery.reason !== null || delivery.deadLetter !== null : delivery.nextAttemptAtMs !== null) return false
      if (delivery.status === 'pending' ? delivery.attempts !== 0 || delivery.lastStatus !== null : delivery.status === 'deadlettered' || delivery.status === 'dropped'
        ? delivery.attempts === 0 && delivery.lastStatus !== null || delivery.attempts > 0 && (!Number.isSafeInteger(delivery.lastStatus) || delivery.lastStatus < 100 || delivery.lastStatus > 599)
        : delivery.attempts === 0 || !Number.isSafeInteger(delivery.lastStatus) || delivery.lastStatus < 100 || delivery.lastStatus > 599) return false
      if (delivery.status === 'pending' && delivery.nextAttemptAtMs !== source.publishedAtMs) return false
      if (delivery.status === 'retrying' && (delivery.attempts >= delivery.maxDeliveryAttempts || delivery.lastStatus >= 200 && delivery.lastStatus < 300 || [400, 403, 413, ...(delivery.endpointType === 'WebHook' ? [401] : [])].includes(delivery.lastStatus))) return false
      if (delivery.status === 'delivered' && (delivery.lastStatus < 200 || delivery.lastStatus >= 300 || delivery.reason !== null)) return false
      if (delivery.status === 'deadlettered') {
        const letter = delivery.deadLetter
        if (!plainObject(letter) || letter.destination !== delivery.deadLetterDestination || !string(letter.destination) || !same(letter.event, delivery.event) || letter.reason !== delivery.reason
          || letter.attempts !== delivery.attempts || !counter(letter.timeMs) || letter.timeMs > state.timeMs) return false
      } else if (delivery.deadLetter !== null) return false
      if (['deadlettered', 'dropped'].includes(delivery.status) && !['NonRetryableStatus', 'MaxDeliveryAttemptsExceeded', 'TimeToLiveExceeded', 'DeadLetterDestinationUnavailable'].includes(delivery.reason)) return false
      if (['deadlettered', 'dropped'].includes(delivery.status) && successfulStatus) return false
      if (delivery.reason === 'NonRetryableStatus' && !nonRetryableFailure) return false
      if (delivery.reason === 'DeadLetterDestinationUnavailable' && (delivery.deadLetterDestination === null || delivery.status !== 'dropped'
        || !(delivery.expiresAtMs <= state.timeMs || nonRetryableFailure || exhaustedFailure))) return false
      if (delivery.reason === 'MaxDeliveryAttemptsExceeded' && !exhaustedFailure || delivery.reason === 'TimeToLiveExceeded' && delivery.expiresAtMs > state.timeMs) return false
    }
    for (const receipt of grid.traces) {
      if (!plainObject(receipt) || !/^eg-trace-/.test(receipt.id) || !id(receipt.id, true, true) || !['publish', 'route', 'retry', 'delivered', 'deadlettered', 'dropped', 'advance'].includes(receipt.kind)
      || !counter(receipt.timeMs) || receipt.timeMs > state.timeMs || receipt.timing !== 'logical-simulator-ticks'
      || (receipt.eventRecordId !== null && !grid.events.some(event => event.id === receipt.eventRecordId))
      || (receipt.deliveryId !== null && !grid.deliveries.some(delivery => delivery.id === receipt.deliveryId && delivery.eventRecordId === receipt.eventRecordId))
      || (receipt.attempts !== null && (!counter(receipt.attempts) || receipt.attempts > 30)) || ![null, 'pending', 'retrying', 'delivered', 'deadlettered', 'dropped'].includes(receipt.status) || !nullableString(receipt.reason)) return false
      if (['publish', 'advance'].includes(receipt.kind)) {
        if (receipt.deliveryId !== null || receipt.attempts !== null || receipt.status !== null || receipt.reason !== null || (receipt.kind === 'publish' ? receipt.eventRecordId === null : receipt.eventRecordId !== null)) return false
      } else {
        const delivery = grid.deliveries.find(delivery => delivery.id === receipt.deliveryId)
        if (!delivery || receipt.attempts === null || receipt.attempts > delivery.attempts) return false
        if (receipt.kind === 'route' && (receipt.status !== 'pending' || receipt.attempts !== 0 || receipt.reason !== null)) return false
        if (receipt.kind === 'retry' && (receipt.status !== 'retrying' || receipt.attempts < 1 || receipt.reason !== null)) return false
        if (receipt.kind === 'delivered' && (receipt.status !== 'delivered' || receipt.attempts < 1 || receipt.reason !== null)) return false
        if (['deadlettered', 'dropped'].includes(receipt.kind) && (receipt.status !== receipt.kind || !string(receipt.reason))) return false
      }
    }
  }
  return state.nextId > maximumId
}
