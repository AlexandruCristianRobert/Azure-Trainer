import { validateMessagingState, validOrderEffectTrace } from '../messaging/state.js'
import { HTTP_LIMITS, normalizeOrder, sameCanonicalOrder, normalizeHttpAppId, normalizeHttpTarget,
  closedHttpObject, httpCounter, httpError } from './contracts.js'
import { emptyHttpFunctionsState, validateHttpFunctionsState } from './state.js'

const clone = value => JSON.parse(JSON.stringify(value))
const sameTarget = (a, b) => ['resourceGroup', 'namespace', 'queue'].every(key => a[key].toLowerCase() === b[key])
// The global broker trace can rotate. Command snapshots retain authoritative lineage.
const retainedTraces = messaging => [...messaging.deliveries,
  ...(messaging.executionReceipts ?? []).flatMap(receipt => receipt.measurements.trace)]
function contextIdentity(context) {
  return { appId: normalizeHttpAppId(context.appId), target: normalizeHttpTarget(context.target) }
}
function actualEntity(messaging, target) {
  return Object.values(messaging.entities).find(entity => entity.kind === 'queue' && sameTarget(entity.target, target)) ?? null
}
function messageOrder(message) {
  try { return normalizeOrder(JSON.parse(message.body)) } catch { return null }
}
function actualSend(messaging, identity, order, sendReceiptId) {
  const entity = actualEntity(messaging, identity.target), traces = retainedTraces(messaging)
  const send = traces.find(row => row.id === sendReceiptId && row.kind === 'send' && row.entityId === entity?.id)
  const message = entity?.messages.find(row => row.sourceMessageId === send?.sourceMessageId
    && row.messageId === send?.messageId && sameCanonicalOrder(messageOrder(row), order))
  const enqueue = traces.find(row => row.kind === 'enqueue' && row.entityId === entity?.id
    && row.messageRecordId === message?.id && row.sourceMessageId === send?.sourceMessageId)
  return send && message && enqueue ? { send, message, entity } : null
}
function acceptedMessage(messaging, record) {
  const actual = actualSend(messaging, record, record.order, record.sendReceiptId)
  return actual && actual.message.id === record.messageRecordId && actual.message.sourceMessageId === record.sourceMessageId
    && actual.send.timeMs === record.acceptedAtMs ? actual : null
}

/** Read-only projection: neither this repository nor an HTTP request drains work. */
export function readOrderStatus(messaging, context) {
  if (!validateMessagingState(messaging)) httpError('Invalid messaging repository state.')
  const identity = contextIdentity(context), orderId = context.orderId
  if (typeof orderId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(orderId)) httpError('Invalid order identity.')
  const extension = messaging.httpFunctions ?? emptyHttpFunctionsState()
  if (!validateHttpFunctionsState(extension)) httpError('Invalid HTTP repository state.')
  const allAccepted = extension.accepted.filter(row => sameTarget(row.target, identity.target) && row.order.id === orderId)
  const accepted = allAccepted.find(row => row.appId === identity.appId)
  if (allAccepted.length && !accepted) return null
  let actual = accepted ? acceptedMessage(messaging, accepted) : null
  if (accepted && !actual) return null
  if (!accepted) {
    const entity = actualEntity(messaging, identity.target)
    const message = entity?.messages.find(row => messageOrder(row)?.id === orderId)
    if (!message) return null
    const send = retainedTraces(messaging).find(row => row.kind === 'send' && row.entityId === entity.id && row.sourceMessageId === message.sourceMessageId)
    if (!send) return null
    actual = actualSend(messaging, identity, messageOrder(message), send.id)
    if (!actual) return null
  }
  const { message, entity, send } = actual, order = accepted?.order ?? messageOrder(message)
  const processed = messaging.effects.processed?.[orderId]
  const work = sameCanonicalOrder(processed, order) && retainedTraces(messaging).find(row => row.kind === 'order-record'
    && row.entityId === entity.id && row.messageRecordId === message.id && row.messageId === message.messageId
    && sameCanonicalOrder(row.order, order) && validOrderEffectTrace(row, messaging))
  const status = work ? 'processed' : ['deadletter', 'expired'].includes(message.status) ? 'failed' : 'pending'
  return { ...clone(order), status, generation: accepted?.generation ?? 0,
    origin: { appId: identity.appId, target: clone(identity.target), acceptedId: accepted?.id ?? null,
      entityId: entity.id, messageRecordId: message.id, sendReceiptId: send.id, workerReceiptId: work?.id ?? null } }
}
export function classifySubmission(messaging, context, value) {
  const order = normalizeOrder(value), prior = readOrderStatus(messaging, { ...context, orderId: order.id })
  return prior === null ? { kind: 'new' } : { kind: sameCanonicalOrder(prior, order) ? 'reuse' : 'conflict', record: prior }
}

/** Trusted runtime admission after a genuine queue send, with immutable business payload. */
export function recordAcceptedOrder(extension, fields, messaging) {
  if (!validateHttpFunctionsState(extension) || !validateMessagingState(messaging)
    || !closedHttpObject(fields, ['appId', 'target', 'order', 'generation', 'sendReceiptId'])
    || !httpCounter(fields.generation) || fields.generation < 1) httpError('Invalid accepted-order admission.')
  const identity = contextIdentity(fields), order = normalizeOrder(fields.order)
  const actual = actualSend(messaging, identity, order, fields.sendReceiptId)
  if (!actual) httpError('Accepted order requires a genuine matching queue send.')
  const prior = extension.accepted.find(row => row.appId === identity.appId && sameTarget(row.target, identity.target) && row.order.id === order.id)
  if (prior) {
    if (!sameCanonicalOrder(prior.order, order) || !acceptedMessage(messaging, prior)) httpError('Accepted order payload is immutable.')
    return clone(extension)
  }
  if (extension.accepted.some(row => row.sendReceiptId === fields.sendReceiptId)) httpError('A queue send already belongs to an accepted order.')
  if (extension.accepted.length >= HTTP_LIMITS.accepted || extension.nextId >= Number.MAX_SAFE_INTEGER) httpError('Accepted-order limit exceeded.', 'HTTP_LIMIT')
  const result = clone(extension)
  result.accepted.push({ id: `http-accepted-${result.nextId++}`, ...identity, order,
    generation: fields.generation, sendReceiptId: actual.send.id, messageRecordId: actual.message.id,
    sourceMessageId: actual.message.sourceMessageId, acceptedAtMs: actual.send.timeMs })
  if (!validateHttpFunctionsState(result)) httpError('Accepted order exceeds bounded state.', 'HTTP_LIMIT')
  return result
}
