import { SUBSCRIPTION_ID } from '../sandbox/model.js'
import { getNamespace, getQueue, getTopic, getSubscription } from '../sandbox/ops.js'
import { finiteJson, plainObject, validateMessagingState } from './state.js'

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const clone = value => JSON.parse(JSON.stringify(value))
const put = (object, key, value) => Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true })
const text = value => typeof value === 'string' && value.length > 0
const counter = value => Number.isSafeInteger(value) && value >= 0
function reject(code, message) { throw Object.assign(new Error(message), { messagingCode: code }) }
const config = message => reject('MESSAGING_CONFIG', message)
const runtime = message => reject('MESSAGING_RUNTIME', message)

function duration(value, field) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value)
  if (!match || !match.slice(1).some(Boolean)) config(`${field} must be a supported positive ISO duration.`)
  const milliseconds = Number(match[1] ?? 0) * 86400000 + Number(match[2] ?? 0) * 3600000 + Number(match[3] ?? 0) * 60000 + Number(match[4] ?? 0) * 1000
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) config(`${field} must be positive.`)
  return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(milliseconds))
}
const deadline = (now, milliseconds) => Math.min(Number.MAX_SAFE_INTEGER, now + milliseconds)

function resolve(sandbox, target, kind) {
  if (!plainObject(target) || !text(target.resourceGroup) || !text(target.namespace)
    || (text(target.queue) === text(target.topic)) || (target.subscription !== undefined && (!text(target.subscription) || text(target.queue)))) config('Supply a queue or topic/subscription target with resourceGroup and namespace.')
  const ns = getNamespace(sandbox, target.resourceGroup, target.namespace)
  if (!['Basic', 'Standard', 'Premium'].includes(ns.sku)) config('The namespace tier is invalid.')
  const topic = target.topic ? getTopic(sandbox, ns.resourceGroup, ns.name, target.topic) : null
  const resource = target.queue ? getQueue(sandbox, ns.resourceGroup, ns.name, target.queue)
    : target.subscription ? getSubscription(sandbox, ns.resourceGroup, ns.name, topic.name, target.subscription) : topic
  const targetKind = target.queue ? 'queue' : target.subscription ? 'subscription' : 'topic'
  if (targetKind === 'topic' && kind !== 'send' && kind !== 'advance') config('Receive and settlement require a queue or subscription.')
  if (targetKind === 'subscription' && kind === 'send') config('Send to the topic, not a subscription.')
  if (ns.sku === 'Basic' && (topic || resource.requiresSession || resource.requiresDuplicateDetection)) config('Topics, sessions and duplicate detection require Standard or Premium tier.')
  const direction = ['send', 'send-copy'].includes(kind) ? 'send' : kind === 'advance' ? null : 'receive'
  for (const candidate of [topic, resource].filter(Boolean)) {
    if (!['Active', 'Disabled', 'SendDisabled', 'ReceiveDisabled'].includes(candidate.status)) config('The entity status is invalid.')
    if (direction && (candidate.status === 'Disabled' || candidate.status === `${direction === 'send' ? 'Send' : 'Receive'}Disabled`)) config(`The entity is disabled for ${direction}.`)
  }
  for (const key of ['requiresSession', 'requiresDuplicateDetection', 'deadLetteringOnMessageExpiration']) {
    if (resource[key] !== undefined && typeof resource[key] !== 'boolean') config(`${key} must be boolean.`)
  }
  if (resource.maxDeliveryCount !== undefined && (!counter(resource.maxDeliveryCount) || resource.maxDeliveryCount < 1)) config('maxDeliveryCount must be a positive integer.')
  const ttlMs = duration(resource.defaultMessageTimeToLive, 'defaultMessageTimeToLive')
  const lockMs = targetKind === 'topic' ? null : duration(resource.lockDuration, 'lockDuration')
  const dedupMs = resource.requiresDuplicateDetection ? duration(resource.duplicateDetectionHistoryTimeWindow, 'duplicateDetectionHistoryTimeWindow') : null
  const canonical = { resourceGroup: ns.resourceGroup, namespace: ns.name,
    ...(topic ? { topic: topic.name, ...(target.subscription ? { subscription: resource.name } : {}) } : { queue: resource.name }) }
  const id = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${ns.resourceGroup}/providers/Microsoft.ServiceBus/namespaces/${ns.name}/${topic ? `topics/${topic.name}${target.subscription ? `/subscriptions/${resource.name}` : ''}` : `queues/${resource.name}`}`.toLowerCase()
  return { id, kind: targetKind, target: canonical, resource, lockMs, ttlMs, dedupMs }
}

// Parse a deliberately small SQL grammar. Never evaluate learner text as code.
function rulePredicate(rule) {
  if (rule.filterType !== 'SqlFilter' || typeof rule.sqlExpression !== 'string') reject('MESSAGING_UNSUPPORTED', 'Only SQL equality joined by AND is supported for Service Bus rules.')
  let remaining = rule.sqlExpression.trim()
  if (/^1\s*=\s*1$/.test(remaining)) return () => true
  const predicates = []
  while (remaining) {
    const match = /^(?:(user|sys)\.)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*('(?:[^']|'')*'|-?\d+(?:\.\d+)?|true\b|false\b)/i.exec(remaining)
    if (!match) reject('MESSAGING_UNSUPPORTED', `Unsupported Service Bus predicate: ${rule.sqlExpression}`)
    const [, scope, name, literal] = match
    const value = literal.startsWith("'") ? literal.slice(1, -1).replace(/''/g, "'") : /^(true|false)$/i.test(literal) ? literal.toLowerCase() === 'true' : Number(literal)
    if (scope?.toLowerCase() === 'sys' && !['MessageId', 'SessionId'].includes(name)) reject('MESSAGING_UNSUPPORTED', `Unsupported system property ${name}.`)
    predicates.push(message => {
      const object = scope?.toLowerCase() === 'sys' ? message : message.properties
      const key = scope?.toLowerCase() === 'sys' ? `${name[0].toLowerCase()}${name.slice(1)}` : name
      return own(object, key) && object[key] === value
    })
    remaining = remaining.slice(match[0].length).trim()
    if (!remaining) break
    if (!/^AND\s+/i.test(remaining)) reject('MESSAGING_UNSUPPORTED', `Unsupported Service Bus predicate: ${rule.sqlExpression}`)
    remaining = remaining.replace(/^AND\s+/i, '')
    if (!remaining) reject('MESSAGING_UNSUPPORTED', 'AND must be followed by an equality predicate.')
  }
  if (!predicates.length) reject('MESSAGING_UNSUPPORTED', 'A SQL filter cannot be empty.')
  return message => predicates.every(predicate => predicate(message))
}

function entityFor(state, resolved) {
  if (!own(state.entities, resolved.id)) put(state.entities, resolved.id, { id: resolved.id, kind: resolved.kind, target: resolved.target, nextSequence: 1, messages: [], dedup: [], sessions: {} })
  return state.entities[resolved.id]
}
const allocate = (state, prefix) => {
  if (state.nextId >= Number.MAX_SAFE_INTEGER) reject('MESSAGING_LIMIT', 'The messaging identifier counter is exhausted.')
  return `${prefix}-${state.nextId++}`
}

function record(state, trace, kind, resolved = null, message = null, extra = {}) {
  const event = { id: allocate(state, 'trace'), kind, timeMs: state.timeMs, entityId: resolved?.id ?? null,
    targetKind: resolved?.kind ?? null, messageRecordId: message?.id ?? null, sourceMessageId: message?.sourceMessageId ?? null,
    messageId: message?.messageId ?? null, sessionId: message?.sessionId ?? null, subQueue: message?.subQueue ?? null,
    receiverId: message?.receiverId ?? null, lockToken: message?.lockToken ?? null, deliveryCount: message?.deliveryCount ?? null, reason: null, ...extra }
  trace.push(event)
  state.deliveries.push(event)
  state.deliveries = state.deliveries.slice(-500)
}

function release(message, state, settlement) {
  const lock = message.lockHistory.at(-1)
  if (lock && lock.settlement === null) { lock.settlement = settlement; lock.settledAtMs = state.timeMs }
  message.lockToken = null
  message.receiverId = null
  message.lockedUntilMs = null
}
function deadletter(message, reason, description = null) {
  message.status = 'deadletter'
  message.subQueue = 'deadletter'
  message.deadLetterReason = reason
  message.deadLetterDescription = description
}
function redeliver(message, resource) {
  message.deliveryCount++
  if (message.subQueue === 'active' && message.deliveryCount > resource.maxDeliveryCount) deadletter(message, 'MaxDeliveryCountExceeded')
  else message.status = message.subQueue === 'deadletter' ? 'deadletter' : 'active'
}

function expire(state, sandbox, trace) {
  for (const entity of Object.values(state.entities)) {
    const resolved = resolve(sandbox, entity.target, 'advance')
    for (const message of entity.messages) {
      if (message.status === 'locked' && message.lockedUntilMs <= state.timeMs) {
        const old = { receiverId: message.receiverId, lockToken: message.lockToken }
        release(message, state, 'expired')
        redeliver(message, resolved.resource)
        record(state, trace, 'lock-expired', resolved, message, old)
      }
      if (message.subQueue === 'active' && ['active', 'locked'].includes(message.status) && message.expiresAtMs <= state.timeMs) {
        release(message, state, 'expired')
        if (resolved.resource.deadLetteringOnMessageExpiration) deadletter(message, 'TTLExpiredException')
        else message.status = 'expired'
        record(state, trace, 'message-expired', resolved, message)
      }
    }
    for (const [session, lease] of Object.entries(entity.sessions)) if (lease.lockedUntilMs <= state.timeMs) delete entity.sessions[session]
    entity.dedup = entity.dedup.filter(entry => entry.expiresAtMs > state.timeMs)
  }
}

function validatePayload(message, resolved) {
  if (!plainObject(message) || !finiteJson(message) || typeof message.body !== 'string'
    || (message.messageId !== undefined && !text(message.messageId)) || !plainObject(message.properties)
    || (message.sessionId !== undefined && message.sessionId !== null && !text(message.sessionId))) config('Messages require a string body, an optional nonempty messageId/sessionId and JSON properties.')
  if (resolved.resource.requiresSession && !text(message.sessionId)) config('This entity requires a message sessionId.')
}

export function applyServiceBusOperation(originalState, sandbox, operation) {
  try {
    if (!validateMessagingState(originalState)) config('The persisted messaging state is malformed.')
    if (!plainObject(operation) || !finiteJson(operation)) config('Supply a finite JSON Service Bus operation.')
    if (!['send', 'receive', 'complete', 'abandon', 'deadletter', 'advance'].includes(operation.kind)) reject('MESSAGING_UNSUPPORTED', `Unsupported Service Bus operation: ${operation.kind}`)
    const state = clone(originalState)
    const trace = []
    let value
    if (operation.kind === 'advance') {
      if (!counter(operation.milliseconds)) config('advance.milliseconds must be a nonnegative safe integer.')
      if (!Number.isSafeInteger(state.timeMs + operation.milliseconds)) reject('MESSAGING_LIMIT', 'The logical messaging clock is exhausted.')
      state.timeMs += operation.milliseconds
      expire(state, sandbox, trace)
      record(state, trace, 'advance')
      value = { timeMs: state.timeMs }
    } else {
      const resolved = resolve(sandbox, operation.target, operation.kind)
      const entity = entityFor(state, resolved)
      if (operation.kind === 'send') {
        validatePayload(operation.message, resolved)
        const payload = operation.message
        const destinations = resolved.kind === 'topic' ? resolved.resource.subscriptions.map(subscription => {
          const destination = resolve(sandbox, { ...resolved.target, subscription: subscription.name }, 'send-copy')
          if (!Array.isArray(subscription.rules)) config('Subscription rules must be an array.')
          const predicates = subscription.rules.map(rulePredicate)
          return { destination, matches: predicates.some(predicate => predicate(payload)) }
        }).filter(item => item.matches).map(item => item.destination) : [resolved]
        destinations.forEach(destination => validatePayload(payload, destination))
        entity.dedup = entity.dedup.filter(entry => entry.expiresAtMs > state.timeMs)
        const duplicate = resolved.dedupMs !== null && text(payload.messageId) && entity.dedup.some(entry => entry.messageId === payload.messageId)
        if (duplicate) {
          record(state, trace, 'duplicate', resolved, null, { messageId: payload.messageId })
          value = { duplicate: true, sourceMessageId: null, messageRecordIds: [] }
        } else {
          if (Object.values(state.entities).reduce((sum, item) => sum + item.messages.length, 0) + destinations.length > 50) reject('MESSAGING_LIMIT', 'The messaging fixture limit is 50 retained message copies.')
          if (resolved.dedupMs && entity.dedup.length >= 50) reject('MESSAGING_LIMIT', 'The deduplication fixture limit is 50 message IDs.')
          const sourceMessageId = allocate(state, 'message')
          const messageId = payload.messageId ?? sourceMessageId
          if (resolved.dedupMs) entity.dedup.push({ messageId, acceptedAtMs: state.timeMs, expiresAtMs: deadline(state.timeMs, resolved.dedupMs) })
          record(state, trace, 'send', resolved, null, { sourceMessageId, messageId, sessionId: payload.sessionId ?? null })
          const messageRecordIds = destinations.map(destination => {
            const inbox = entityFor(state, destination)
            if (inbox.nextSequence >= Number.MAX_SAFE_INTEGER) reject('MESSAGING_LIMIT', 'The entity sequence counter is exhausted.')
            const message = { id: allocate(state, 'message'), sourceMessageId, entityId: destination.id, sequence: inbox.nextSequence++,
              body: payload.body, messageId, properties: clone(payload.properties), sessionId: payload.sessionId ?? null,
              status: 'active', subQueue: 'active', deliveryCount: 1, enqueuedAtMs: state.timeMs,
              expiresAtMs: deadline(state.timeMs, Math.min(resolved.ttlMs, destination.ttlMs)),
              lockToken: null, receiverId: null, lockedUntilMs: null, lockHistory: [], deadLetterReason: null, deadLetterDescription: null }
            inbox.messages.push(message)
            record(state, trace, 'enqueue', destination, message)
            return message.id
          })
          value = { duplicate: false, sourceMessageId, messageRecordIds }
        }
      } else if (operation.kind === 'receive') {
        if (!text(operation.receiverId)) config('receive requires a nonempty receiverId.')
        const count = operation.count ?? 1
        if (!counter(count) || count < 1) config('receive.count must be a positive integer.')
        if (count > 50) reject('MESSAGING_LIMIT', 'A receive may request at most 50 messages.')
        const subQueue = operation.subQueue ?? 'active'
        if (!['active', 'deadletter'].includes(subQueue)) config('subQueue must be active or deadletter.')
        if (resolved.resource.requiresSession) {
          if (!text(operation.sessionId)) config('A session-enabled receiver requires sessionId.')
          const lease = own(entity.sessions, operation.sessionId) ? entity.sessions[operation.sessionId] : null
          if (lease && lease.receiverId !== operation.receiverId) runtime('The session is already leased to another receiver.')
          put(entity.sessions, operation.sessionId, { receiverId: operation.receiverId, lockedUntilMs: deadline(state.timeMs, resolved.lockMs) })
        } else if (operation.sessionId !== undefined && operation.sessionId !== null) config('This entity does not use session receivers.')
        const selected = entity.messages.filter(message => message.subQueue === subQueue && message.status === (subQueue === 'active' ? 'active' : 'deadletter')
          && (!resolved.resource.requiresSession || message.sessionId === operation.sessionId)).sort((a, b) => a.sequence - b.sequence).slice(0, count)
        const locks = Object.values(state.entities).reduce((sum, item) => sum + item.messages.reduce((count, message) => count + message.lockHistory.length, 0), 0)
        if (locks + selected.length > 500) reject('MESSAGING_LIMIT', 'Retained lock history exceeds 500 receipts; reset this fixture.')
        value = selected.map(message => {
          message.status = 'locked'
          message.receiverId = operation.receiverId
          message.lockToken = allocate(state, 'lock')
          message.lockedUntilMs = deadline(state.timeMs, resolved.lockMs)
          message.lockHistory.push({ lockToken: message.lockToken, receiverId: operation.receiverId, lockedAtMs: state.timeMs, lockedUntilMs: message.lockedUntilMs, settlement: null, settledAtMs: null })
          record(state, trace, 'receive', resolved, message)
          return clone(message)
        })
      } else {
        if (!text(operation.receiverId) || !text(operation.lockToken)) config('Settlement requires receiverId and lockToken.')
        const message = entity.messages.find(item => item.lockToken === operation.lockToken)
        if (!message || message.status !== 'locked' || message.receiverId !== operation.receiverId || message.lockedUntilMs <= state.timeMs) runtime('The message lock is missing, expired, settled or owned by another receiver.')
        if (resolved.resource.requiresSession && (!own(entity.sessions, message.sessionId) || entity.sessions[message.sessionId].receiverId !== operation.receiverId)) runtime('The receiver no longer owns this session.')
        if (operation.kind === 'deadletter' && ((operation.reason !== undefined && !text(operation.reason))
          || (operation.description !== undefined && typeof operation.description !== 'string'))) config('Dead-letter reason and description must be strings.')
        record(state, trace, operation.kind, resolved, message, { reason: operation.kind === 'deadletter' ? operation.reason ?? 'DeadLettered' : null })
        release(message, state, operation.kind)
        if (operation.kind === 'complete') message.status = 'completed'
        else if (operation.kind === 'abandon') redeliver(message, resolved.resource)
        else deadletter(message, operation.reason ?? 'DeadLettered', operation.description ?? null)
        value = clone(message)
      }
    }
    if (!validateMessagingState(state)) reject('MESSAGING_LIMIT', 'The operation cannot produce valid bounded messaging state.')
    return { state, value, trace: clone(trace), diagnostics: [] }
  } catch (error) {
    return { state: originalState, value: null, trace: [], diagnostics: [{ code: error.messagingCode ?? 'MESSAGING_CONFIG', message: error.message, path: '', line: null, column: null }] }
  }
}
