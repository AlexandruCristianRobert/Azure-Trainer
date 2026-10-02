import { SUBSCRIPTION_ID } from '../sandbox/model.js'

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
  ancestors.add(value)
  const keys = Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === 'length'))
  const valid = keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return typeof key === 'string' && descriptor.enumerable && own(descriptor, 'value') && finiteJson(descriptor.value, ancestors)
  })
  ancestors.delete(value)
  return valid
}

export function emptyMessagingState() {
  return { version: 1, nextId: 1, timeMs: 0, entities: {}, deliveries: [], effects: {}, hosts: {} }
}

export function validateMessagingState(state) {
  if (!finiteJson(state) || !plainObject(state) || state.version !== 1 || !counter(state.nextId) || state.nextId < 1
    || !counter(state.timeMs) || !plainObject(state.entities) || !Array.isArray(state.deliveries)
    || state.deliveries.length > 500 || !plainObject(state.effects) || !plainObject(state.hosts)) return false
  let maximumId = 0
  const allocated = new Set()
  const id = (value, unique = false) => {
    const match = /^(?:message|lock|trace)-([1-9]\d*)$/.exec(value)
    if (!match || !Number.isSafeInteger(Number(match[1])) || (unique && allocated.has(value))) return false
    maximumId = Math.max(maximumId, Number(match[1]))
    if (unique) allocated.add(value)
    return true
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
  return state.nextId > maximumId
}
