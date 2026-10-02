import { describe, it, expect } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup, createNamespace, createQueue, createTopic, createSubscription, createRule, deleteRule, updateQueue, updateNamespace } from '../src/lib/sandbox/ops.js'
import { emptyMessagingState, validateMessagingState } from '../src/lib/messaging/state.js'
import { applyServiceBusOperation } from '../src/lib/messaging/servicebus.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'

function brokerFixture(props = {}) {
  let sandbox = createResourceGroup(createSandbox(), { name: 'rg-messaging', location: 'westeurope' }).sandbox
  sandbox = createNamespace(sandbox, { resourceGroup: 'rg-messaging', name: 'sb-orders' }).sandbox
  sandbox = createQueue(sandbox, { resourceGroup: 'rg-messaging', namespace: 'sb-orders', name: 'orders', ...props }).sandbox
  return { sandbox, target: { resourceGroup: 'rg-messaging', namespace: 'sb-orders', queue: 'orders' } }
}
const message = (messageId = 'm1', extra = {}) => ({ body: '{"id":"o1"}', messageId, properties: {}, ...extra })
const send = (state, fixture, payload = message()) => applyServiceBusOperation(state, fixture.sandbox, { kind: 'send', target: fixture.target, message: payload })
const receive = (state, fixture, extra = {}) => applyServiceBusOperation(state, fixture.sandbox, { kind: 'receive', target: fixture.target, receiverId: 'r1', count: 1, ...extra })
const settle = (state, fixture, receipt, kind = 'complete', extra = {}) => applyServiceBusOperation(state, fixture.sandbox, { kind, target: fixture.target, receiverId: 'r1', lockToken: receipt.lockToken, ...extra })
const entity = state => Object.values(state.entities)[0]
function expectFailure(result, original, code) {
  expect(result.state).toBe(original)
  expect(result.value).toBeNull()
  expect(result.trace).toEqual([])
  expect(result.diagnostics[0]).toMatchObject({ code, path: '', line: null, column: null })
}

describe('bounded Service Bus lifecycle', () => {
  it('a wrong lock owner cannot settle the real received message', () => {
    const fixture = brokerFixture()
    const sent = send(emptyMessagingState(), fixture)
    const received = receive(sent.state, fixture)
    const failed = settle(received.state, fixture, received.value[0], 'complete', { receiverId: 'r2' })
    expectFailure(failed, received.state, 'MESSAGING_RUNTIME')
    expect(entity(sent.state).messages[0].status).toBe('active')
    expect(entity(received.state).messages[0].status).toBe('locked')
  })

  it('completion removes a message from processing and rejects double settlement', () => {
    const fixture = brokerFixture()
    const received = receive(send(emptyMessagingState(), fixture).state, fixture)
    const completed = settle(received.state, fixture, received.value[0])
    expect(completed.diagnostics).toEqual([])
    expect(receive(completed.state, fixture).value).toEqual([])
    expectFailure(settle(completed.state, fixture, received.value[0]), completed.state, 'MESSAGING_RUNTIME')
    expect(validateMessagingState(JSON.parse(JSON.stringify(completed.state)))).toBe(true)
  })

  it('expired locks redeliver with a new token and reject the original receipt', () => {
    const fixture = brokerFixture({ lockDuration: 'PT1S' })
    const received = receive(send(emptyMessagingState(), fixture).state, fixture)
    const advanced = applyServiceBusOperation(received.state, fixture.sandbox, { kind: 'advance', milliseconds: 1000 })
    expect(advanced.state.timeMs).toBe(1000)
    expectFailure(settle(advanced.state, fixture, received.value[0]), advanced.state, 'MESSAGING_RUNTIME')
    const next = receive(advanced.state, fixture)
    expect(next.value[0].deliveryCount).toBe(2)
    expect(next.value[0].lockToken).not.toBe(received.value[0].lockToken)
    expect(next.trace[0]).toMatchObject({ kind: 'receive', receiverId: 'r1' })
  })

  it('abandon respects max deliveries and dead-letter replay is send-new then complete-old', () => {
    const fixture = brokerFixture({ maxDeliveryCount: 1 })
    const first = receive(send(emptyMessagingState(), fixture).state, fixture)
    const abandoned = settle(first.state, fixture, first.value[0], 'abandon')
    expect(receive(abandoned.state, fixture).value).toEqual([])
    const dlq = receive(abandoned.state, fixture, { subQueue: 'deadletter' })
    expect(dlq.value[0]).toMatchObject({ body: '{"id":"o1"}', deadLetterReason: 'MaxDeliveryCountExceeded' })
    const replay = send(dlq.state, fixture, message('recovered'))
    const completed = settle(replay.state, fixture, dlq.value[0])
    expect(receive(completed.state, fixture, { subQueue: 'deadletter' }).value).toEqual([])
    expect(receive(completed.state, fixture).value[0].messageId).toBe('recovered')
    expectFailure(applyServiceBusOperation(completed.state, fixture.sandbox, { kind: 'replay', target: fixture.target }), completed.state, 'MESSAGING_UNSUPPORTED')
  })

  it('explicit deadletter preserves the reason for inspection', () => {
    const fixture = brokerFixture()
    const first = receive(send(emptyMessagingState(), fixture).state, fixture)
    const rejected = settle(first.state, fixture, first.value[0], 'deadletter', { reason: 'InvalidOrder', description: 'Missing sku' })
    const inspected = receive(rejected.state, fixture, { subQueue: 'deadletter' })
    expect(inspected.value[0]).toMatchObject({ deadLetterReason: 'InvalidOrder', deadLetterDescription: 'Missing sku' })
  })

  it('same queue names in distinct groups retain independent messages and case-normalized identity', () => {
    const fixture = brokerFixture()
    let sandbox = createResourceGroup(fixture.sandbox, { name: 'rg-other', location: 'westeurope' }).sandbox
    sandbox = createNamespace(sandbox, { resourceGroup: 'rg-other', name: 'sb-other' }).sandbox
    sandbox = createQueue(sandbox, { resourceGroup: 'rg-other', namespace: 'sb-other', name: 'orders' }).sandbox
    fixture.sandbox = sandbox
    const second = { sandbox, target: { resourceGroup: 'rg-other', namespace: 'sb-other', queue: 'orders' } }
    const sent = send(send(emptyMessagingState(), fixture).state, second, message('m2'))
    expect(receive(sent.state, fixture).value[0].messageId).toBe('m1')
    expect(receive(sent.state, second).value[0].messageId).toBe('m2')
    const caps = { sandbox, target: { resourceGroup: 'RG-MESSAGING', namespace: 'SB-ORDERS', queue: 'ORDERS' } }
    expect(receive(sent.state, caps).value[0].messageId).toBe('m1')
    expect(Object.keys(sent.state.entities)).toHaveLength(2)
    expect(Object.keys(sent.state.entities)[0]).toContain('/resourcegroups/rg-messaging/providers/microsoft.servicebus/namespaces/sb-orders/queues/orders')
  })

  it('broker dedup honors its time window without creating business effects', () => {
    const fixture = brokerFixture({ requiresDuplicateDetection: true, duplicateDetectionHistoryTimeWindow: 'PT1S' })
    const sent = send(emptyMessagingState(), fixture)
    const duplicate = send(sent.state, fixture)
    expect(entity(duplicate.state).messages).toHaveLength(1)
    expect(duplicate.value.duplicate).toBe(true)
    expect(duplicate.state.effects).toEqual({})
    const advanced = applyServiceBusOperation(duplicate.state, fixture.sandbox, { kind: 'advance', milliseconds: 1000 })
    const accepted = send(advanced.state, fixture)
    expect(entity(accepted.state).messages).toHaveLength(2)
    expect(accepted.state.effects).toEqual({})
  })

  it('session leases reject competing owners and deliver only that session in sequence', () => {
    const fixture = brokerFixture({ requiresSession: true, lockDuration: 'PT1S' })
    let state = send(emptyMessagingState(), fixture, message('one', { sessionId: '__proto__' })).state
    state = send(state, fixture, message('other', { sessionId: 'other' })).state
    state = send(state, fixture, message('two', { sessionId: '__proto__' })).state
    const first = receive(state, fixture, { sessionId: '__proto__', count: 2 })
    expect(first.value.map(item => item.messageId)).toEqual(['one', 'two'])
    expectFailure(receive(first.state, fixture, { sessionId: '__proto__', receiverId: 'r2' }), first.state, 'MESSAGING_RUNTIME')
    expect(receive(first.state, fixture, { sessionId: 'other', receiverId: 'r2' }).value[0].messageId).toBe('other')
    const advanced = applyServiceBusOperation(first.state, fixture.sandbox, { kind: 'advance', milliseconds: 1000 })
    expect(receive(advanced.state, fixture, { sessionId: '__proto__', receiverId: 'r2' }).value[0].messageId).toBe('one')
    expect(validateMessagingState(first.state)).toBe(true)
  })

  it('validates missing targets, disabled operations, Basic features and session requirements atomically', () => {
    const fixture = brokerFixture({ requiresSession: true })
    const state = emptyMessagingState()
    expectFailure(send(state, fixture), state, 'MESSAGING_CONFIG')
    expectFailure(receive(state, fixture), state, 'MESSAGING_CONFIG')
    expectFailure(send(state, { ...fixture, target: { ...fixture.target, queue: 'missing' } }), state, 'MESSAGING_CONFIG')
    fixture.sandbox = updateNamespace(fixture.sandbox, { resourceGroup: fixture.target.resourceGroup, name: fixture.target.namespace, sku: 'Basic' }).sandbox
    expectFailure(send(state, fixture, message('m1', { sessionId: 's1' })), state, 'MESSAGING_CONFIG')
    const active = brokerFixture()
    active.sandbox = updateQueue(active.sandbox, { ...active.target, name: active.target.queue, status: 'SendDisabled' }).sandbox
    expectFailure(send(state, active), state, 'MESSAGING_CONFIG')
    expect(receive(state, active).diagnostics).toEqual([])
  })

  it('topic rules route independent subscription copies, including the default and OR across rules', () => {
    const fixture = brokerFixture()
    let sandbox = createTopic(fixture.sandbox, { ...fixture.target, name: 'order-work' }).sandbox
    sandbox = createSubscription(sandbox, { ...fixture.target, topic: 'order-work', name: 'all-orders' }).sandbox
    sandbox = createSubscription(sandbox, { ...fixture.target, topic: 'order-work', name: 'eu-orders' }).sandbox
    const ruleTarget = { ...fixture.target, topic: 'order-work', subscription: 'eu-orders' }
    sandbox = deleteRule(sandbox, { ...ruleTarget, name: '$Default' }).sandbox
    sandbox = createRule(sandbox, { ...ruleTarget, name: 'eu', sqlExpression: "region = 'EU' AND priority = 1" }).sandbox
    sandbox = createRule(sandbox, { ...ruleTarget, name: 'uk', sqlExpression: "region = 'UK'" }).sandbox
    const publisher = { sandbox, target: { resourceGroup: 'rg-messaging', namespace: 'sb-orders', topic: 'order-work' } }
    const all = { sandbox, target: { ...publisher.target, subscription: 'all-orders' } }
    const eu = { sandbox, target: { ...publisher.target, subscription: 'eu-orders' } }
    let state = send(emptyMessagingState(), publisher, message('eu', { properties: { region: 'EU', priority: 1 } })).state
    state = send(state, publisher, message('uk', { properties: { region: 'UK' } })).state
    state = send(state, publisher, message('us', { properties: { region: 'US' } })).state
    const allReceipt = receive(state, all, { count: 3 })
    expect(allReceipt.value.map(item => item.messageId)).toEqual(['eu', 'uk', 'us'])
    const euReceipt = receive(allReceipt.state, eu, { count: 3 })
    expect(euReceipt.value.map(item => item.messageId)).toEqual(['eu', 'uk'])
    expect(euReceipt.value[0].id).not.toBe(allReceipt.value[0].id)
    expect(euReceipt.value[0].sourceMessageId).toBe(allReceipt.value[0].sourceMessageId)
    expectFailure(settle(euReceipt.state, eu, allReceipt.value[0]), euReceipt.state, 'MESSAGING_RUNTIME')
  })

  it('unsupported predicates fail even behind an accepting default rule, without partial copies', () => {
    const fixture = brokerFixture()
    let sandbox = createTopic(fixture.sandbox, { ...fixture.target, name: 'order-work' }).sandbox
    sandbox = createSubscription(sandbox, { ...fixture.target, topic: 'order-work', name: 'all-orders' }).sandbox
    sandbox = createRule(sandbox, { ...fixture.target, topic: 'order-work', subscription: 'all-orders', name: 'unsupported', sqlExpression: 'price > 5' }).sandbox
    const state = emptyMessagingState()
    expectFailure(send(state, { sandbox, target: { resourceGroup: 'rg-messaging', namespace: 'sb-orders', topic: 'order-work' } }), state, 'MESSAGING_UNSUPPORTED')
  })

  it('message expiry moves configured messages to DLQ using logical time', () => {
    const fixture = brokerFixture({ defaultMessageTimeToLive: 'PT1S', deadLetteringOnMessageExpiration: true })
    const state = send(emptyMessagingState(), fixture).state
    const advanced = applyServiceBusOperation(state, fixture.sandbox, { kind: 'advance', milliseconds: 1000 })
    expect(receive(advanced.state, fixture).value).toEqual([])
    expect(receive(advanced.state, fixture, { subQueue: 'deadletter' }).value[0].deadLetterReason).toBe('TTLExpiredException')
  })

  it('rejects malformed persisted counters, lock fields, nonfinite data and reused identifiers', () => {
    const fixture = brokerFixture()
    const received = receive(send(emptyMessagingState(), fixture).state, fixture)
    for (const mutate of [state => { state.nextId = 0 }, state => { state.timeMs = Infinity }, state => { state.nextId = 1 }, state => { entity(state).nextSequence = 1 }, state => { entity(state).messages[0].lockToken = null }]) {
      const state = structuredClone(received.state)
      mutate(state)
      expect(validateMessagingState(state)).toBe(false)
      expectFailure(receive(state, fixture), state, 'MESSAGING_CONFIG')
    }
  })

  it('bounds retained messages and traces and ignores caller-supplied internal identifiers', () => {
    const fixture = brokerFixture()
    let state = emptyMessagingState()
    for (let i = 0; i < 50; i++) state = send(state, fixture, message(`m${i}`, { id: 'forged', lockToken: 'forged' })).state
    expect(entity(state).messages[0].id).not.toBe('forged')
    expectFailure(send(state, fixture, message('overflow')), state, 'MESSAGING_LIMIT')
    expectFailure(receive(state, fixture, { count: 51 }), state, 'MESSAGING_LIMIT')
    expectFailure(applyServiceBusOperation(state, fixture.sandbox, { kind: 'advance', milliseconds: -1 }), state, 'MESSAGING_CONFIG')
    expect(validateMessagingState(state)).toBe(true)
    expect(state.deliveries.length).toBeLessThanOrEqual(500)
  })

  it('initializes and strictly validates messaging only for opted-in Lab runs', () => {
    const base = { id: 'messaging-fixture', engineVersion: 2, contentVersion: 1, tasks: [] }
    const legacy = createBehavioralRun(base, { attemptId: 'legacy' })
    expect(legacy.runtime.messaging).toBeUndefined()
    expect(validateBehavioralRun(legacy, base)).toBe(legacy)
    const lab = { ...base, capabilities: { messaging: true } }
    const run = createBehavioralRun(lab, { attemptId: 'messaging' })
    expect(run.runtime.messaging).toEqual({ version: 1, nextId: 1, timeMs: 0, entities: {}, deliveries: [], effects: {}, hosts: {}, executionReceipts: [] })
    run.runtime.messaging.nextId = -1
    expect(() => validateBehavioralRun(run, lab)).toThrow(/messaging/i)
    delete run.runtime.messaging
    expect(() => validateBehavioralRun(run, lab)).toThrow(/messaging/i)
  })

  it('ReceiveDisabled subscriptions still accept topic publication but cannot deliver', () => {
    const fixture = brokerFixture()
    let sandbox = createTopic(fixture.sandbox, { ...fixture.target, name: 'order-work' }).sandbox
    sandbox = createSubscription(sandbox, { ...fixture.target, topic: 'order-work', name: 'paused', status: 'ReceiveDisabled' }).sandbox
    const publisher = { sandbox, target: { resourceGroup: 'rg-messaging', namespace: 'sb-orders', topic: 'order-work' } }
    const sent = send(emptyMessagingState(), publisher)
    expect(sent.diagnostics).toEqual([])
    expect(Object.values(sent.state.entities).find(item => item.kind === 'subscription').messages).toHaveLength(1)
    expectFailure(receive(sent.state, { sandbox, target: { ...publisher.target, subscription: 'paused' } }), sent.state, 'MESSAGING_CONFIG')
  })

  it('rejects persisted entity identity mismatches and forged trace/history shapes', () => {
    const fixture = brokerFixture()
    const received = receive(send(emptyMessagingState(), fixture).state, fixture)
    for (const mutate of [
      state => { entity(state).target.queue = 'another-queue' },
      state => { state.deliveries[0].kind = 'invented-success' },
      state => { state.deliveries[0].receiverId = 5 },
      state => { entity(state).messages[0].lockHistory[0].lockedUntilMs = 0 },
      state => { entity(state).messages[0].deliveryCount = -1 },
    ]) {
      const state = structuredClone(received.state)
      mutate(state)
      expect(validateMessagingState(state)).toBe(false)
    }
  })

  it('retains only the latest 500 trace entries and returns independent deterministic JSON', () => {
    const fixture = brokerFixture()
    const original = emptyMessagingState()
    const a = send(original, fixture)
    const b = send(original, fixture)
    expect(a).toEqual(b)
    a.trace[0].kind = 'edited'
    expect(a.state.deliveries[0].kind).toBe('send')
    const received = receive(b.state, fixture)
    received.value[0].properties.changed = true
    expect(entity(received.state).messages[0].properties).toEqual({})
    let state = emptyMessagingState()
    for (let i = 0; i < 505; i++) state = applyServiceBusOperation(state, fixture.sandbox, { kind: 'advance', milliseconds: 0 }).state
    expect(state.deliveries).toHaveLength(500)
    expect(state.deliveries[0].id).toBe('trace-6')
    expect(validateMessagingState(JSON.parse(JSON.stringify(state)))).toBe(true)
    expect(original).toEqual({ version: 1, nextId: 1, timeMs: 0, entities: {}, deliveries: [], effects: {}, hosts: {}, executionReceipts: [] })
  })

  it('rejects active or expired persisted messages in the deadletter subqueue', () => {
    const fixture = brokerFixture()
    const sent = send(emptyMessagingState(), fixture)
    for (const status of ['active', 'expired']) {
      const malformed = structuredClone(sent.state)
      Object.assign(entity(malformed).messages[0], { status, subQueue: 'deadletter' })
      expect(validateMessagingState(malformed)).toBe(false)
      expectFailure(receive(malformed, fixture), malformed, 'MESSAGING_CONFIG')
      expectFailure(receive(malformed, fixture, { subQueue: 'deadletter' }), malformed, 'MESSAGING_CONFIG')
    }
    const first = receive(sent.state, fixture)
    const rejected = settle(first.state, fixture, first.value[0], 'deadletter')
    const locked = receive(rejected.state, fixture, { subQueue: 'deadletter' })
    expect(validateMessagingState(locked.state)).toBe(true)
    expect(validateMessagingState(settle(locked.state, fixture, locked.value[0]).state)).toBe(true)
  })

  it('rejects a sparse dedup array whose custom property disguises a missing index', () => {
    const fixture = brokerFixture()
    const sent = send(emptyMessagingState(), fixture)
    const sparse = emptyMessagingState()
    sparse.entities = structuredClone(sent.state.entities)
    sparse.nextId = sent.state.nextId
    entity(sparse).dedup = new Array(1)
    entity(sparse).dedup.extra = { messageId: 'm', acceptedAtMs: 0, expiresAtMs: 1000 }
    expect(validateMessagingState(sparse)).toBe(false)
    expectFailure(receive(sparse, fixture), sparse, 'MESSAGING_CONFIG')
  })
})
