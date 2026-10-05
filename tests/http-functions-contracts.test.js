import { describe, it, expect } from 'vitest'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup, createNamespace, createQueue } from '../src/lib/sandbox/ops.js'
import { emptyMessagingState, validateMessagingState } from '../src/lib/messaging/state.js'
import { applyServiceBusOperation } from '../src/lib/messaging/servicebus.js'
import { parseMessagingProject } from '../src/lib/messaging/python.js'
import { executeMessagingProgram } from '../src/lib/messaging/vm.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyMessagingAction } from '../src/lib/messaging/actions.js'
import { SERVICEBUS_SOLUTION_FILES, MESSAGING_RUNTIME_FILES } from '../src/data/templates/messaging-python/servicebus.js'

// Missing modules become an explicit missing-contract assertion, not a collection error.
const contracts = await import('../src/lib/http-functions/contracts.js').catch(() => ({}))
const orders = await import('../src/lib/http-functions/orders.js').catch(() => ({}))
const state = await import('../src/lib/http-functions/state.js').catch(() => ({}))
const fn = (module, name) => { expect(module[name], `${name} contract`).toBeTypeOf('function'); return module[name] }
const order = { id: 'o1', region: 'EU', quantity: 2 }
const appId = '/subscriptions/demo/resourceGroups/rg-messaging/providers/Microsoft.Web/sites/func-orders'
const target = { resourceGroup: 'rg-messaging', namespace: 'sb-orders', queue: 'orders' }
const context = { appId, target, orderId: 'o1' }
function fixture(props = {}) {
  let sandbox = createResourceGroup(createSandbox(), { name: target.resourceGroup, location: 'westeurope' }).sandbox
  sandbox = createNamespace(sandbox, { resourceGroup: target.resourceGroup, name: target.namespace }).sandbox
  sandbox = createQueue(sandbox, { ...target, name: target.queue, ...props }).sandbox
  return sandbox
}
function sent(sandbox = fixture(), value = order, messaging = emptyMessagingState()) {
  const result = applyServiceBusOperation(messaging, sandbox, { kind: 'send', target, message: { body: JSON.stringify(value), messageId: value.id, properties: {} } })
  expect(result.diagnostics).toEqual([])
  return result
}
function accepted(result) {
  return fn(orders, 'recordAcceptedOrder')(fn(state, 'emptyHttpFunctionsState')(), {
    appId, target, order, generation: 1, sendReceiptId: result.trace.find(row => row.kind === 'send').id,
  }, result.state)
}
const routes = [
  { route: 'orders/{id}', methods: ['GET'], authLevel: 'anonymous', functionId: 'function_app.py:get_order', functionName: 'GetOrder', path: 'function_app.py' },
  { route: 'orders/latest', methods: ['POST'], authLevel: 'function', functionId: 'function_app.py:latest', functionName: 'Latest', path: 'function_app.py' },
]
const requestRecord = path => ({ id: 'http-request-3', appId: appId.toLowerCase(), scope: 'local', generation: 1, method: 'GET',
  path, authorization: 'not-required', operationIds: [], readIds: ['http-read-1'],
  response: { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"status":"pending"}' },
  sendReceiptIds: [], workerReceiptIds: [], executionId: 'execution-9', beforeNextId: 4, afterNextId: 10 })

describe('HTTP order contracts', () => {
  it('normalizes exact payloads and compares repository metadata through canonical fields', () => {
    const normalize = fn(contracts, 'normalizeOrder'), same = fn(contracts, 'sameCanonicalOrder')
    expect(normalize({ quantity: 2, region: 'EU', id: 'o1' })).toEqual(order)
    expect(same({ ...order, status: 'pending', origin: { sendReceiptId: 'trace-2' }, generation: 1 }, order)).toBe(true)
    expect(same(order, { ...order, quantity: 3 })).toBe(false)
    for (const quantity of [true, 0, 101, 1.5, '2']) expect(() => normalize({ ...order, quantity })).toThrow()
    for (const value of [{ ...order, extra: 1 }, { ...order, id: '__proto__' }, { ...order, region: 'eu' }, [], null]) expect(() => normalize(value)).toThrow()
    expect(() => normalize(Object.assign(Object.create({ inherited: true }), order))).toThrow()
    expect(() => normalize({ ...order, get quantity() { throw Error('getter invoked') } })).toThrow(/order/i)
  })
  it('parses only supported intent and preserves route parameter values', () => {
    const parse = fn(contracts, 'parseHttpRequest')
    const intent = { method: 'post', url: 'HTTP://LOCALHOST:7071/API/Orders/O_A?region=EU', headers: { 'Content-Type': 'application/json' }, body: '{bad json' }
    expect(parse(intent, { appId })).toMatchObject({ scope: 'local', method: 'POST', path: '/API/Orders/O_A', query: { region: 'EU' }, headers: { 'content-type': 'application/json' }, body: '{bad json' })
    expect(parse({ method: 'GET', url: 'https://FUNC-ORDERS.azurewebsites.net/api/health' }, { appId }).scope).toBe('published')
    expect(intent.headers).toEqual({ 'Content-Type': 'application/json' })
    for (const url of ['file:///api/orders', 'https://example.com/api/orders', 'http://localhost:80/api/orders', 'http://user@localhost:7071/api/orders', 'http://localhost:7071/api/%2f', 'http://localhost:7071/api/%5c', 'http://localhost:7071/api/%00', 'http://localhost:7071/api/%xx', 'http://localhost:7071/api/%252f', 'http://localhost:7071/api/orders#fragment']) expect(() => parse({ method: 'GET', url }, { appId })).toThrow()
    expect(() => parse({ method: 'GET', url: 'http://localhost:7071/api/orders', success: true }, { appId })).toThrow()
    expect(() => parse({ method: 'DELETE', url: 'http://localhost:7071/api/orders' }, { appId })).toThrow()
    expect(() => parse({ method: 'GET', url: 'http://localhost:7071/api/orders', headers: { A: 'one', a: 'two' } }, { appId })).toThrow()
  })
  it('rejects byte and entry limits without truncating the request', () => {
    const parse = fn(contracts, 'parseHttpRequest')
    expect(() => parse({ method: 'POST', url: 'http://localhost:7071/api/orders', body: 'é'.repeat(8193) }, { appId })).toThrow()
    expect(() => parse({ method: 'GET', url: 'http://localhost:7071/api/orders', headers: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`x-${i}`, 'a'])) }, { appId })).toThrow()
    expect(() => parse({ method: 'GET', url: 'http://localhost:7071/api/orders?' + 'a'.repeat(2048) }, { appId })).toThrow()
  })
  it.each([['%2541', '%41'], ['%25', '%'], ['%3F', '?'], ['%23', '#']])('preserves encoded parameter %s through matching and persisted validation', (encoded, expected) => {
    const parsed = fn(contracts, 'parseHttpRequest')({ method: 'GET', url: 'http://localhost:7071/api/orders/' + encoded }, { appId })
    expect(parsed.path).toBe('/api/orders/' + expected)
    expect(fn(contracts, 'matchHttpRoute')(routes, parsed.method, parsed.path).params).toEqual({ id: expected })
    expect(fn(state, 'validateHttpRequestRecord')(requestRecord(parsed.path))).toBe(true)
    for (const segment of ['%2f', '%5c', '%00', '%2e', '%2e%2e', '%xx', '%252f']) expect(() => fn(contracts, 'parseHttpRequest')({ method: 'GET', url: 'http://localhost:7071/api/orders/' + segment }, { appId })).toThrow()
  })
  it('gives static routes precedence and separates method 405 from path 404', () => {
    const match = fn(contracts, 'matchHttpRoute')
    expect(match(routes, 'GET', '/API/ORDERS/O_A')).toMatchObject({ status: 200, route: routes[0], params: { id: 'O_A' } })
    expect(match(routes, 'GET', '/api/orders/LATEST')).toEqual({ status: 405, route: null, params: {}, allow: ['POST'] })
    expect(match(routes, 'POST', '/api/unknown')).toEqual({ status: 404, route: null, params: {}, allow: [] })
    expect(() => match([routes[0], { ...routes[0], route: 'orders/{other}' }], 'GET', '/api/orders/o1')).toThrow()
    expect(() => match([{ ...routes[0], route: '{first}/latest' }, { ...routes[0], route: 'orders/{last}' }], 'GET', '/api/orders/latest')).toThrow()
    for (const route of ['orders/{id:int}', 'orders/prefix{id}', 'orders/{id}/{id}', 'orders/{__proto__}']) expect(() => match([{ ...routes[0], route }], 'GET', '/api/orders/o1')).toThrow()
    const tooManyParameters = Array.from({ length: 33 }, (_, i) => `{p${i}}`).join('/')
    expect(() => match([{ ...routes[0], route: tooManyParameters }], 'GET', '/api/orders/o1')).toThrow()
  })
})

describe('actual queue status and immutable acceptance', () => {
  it('unknown orders and standalone processed flags cannot manufacture status', () => {
    const read = fn(orders, 'readOrderStatus')
    expect(read(emptyMessagingState(), context)).toBeNull()
    const messaging = { ...emptyMessagingState(), effects: { processed: { o1: order } } }
    expect(validateMessagingState(messaging)).toBe(true)
    expect(read(messaging, context)).toBeNull()
  })
  it('records only a genuine matching send and isolates app and queue acceptance', () => {
    const result = sent(), extension = accepted(result), record = extension.accepted[0]
    expect(fn(state, 'validateHttpFunctionsState')(extension)).toBe(true)
    expect(record).toMatchObject({ appId: appId.toLowerCase(), order, generation: 1 })
    const messaging = { ...result.state, httpFunctions: extension }
    expect(fn(orders, 'readOrderStatus')(messaging, context)).toMatchObject({ ...order, status: 'pending' })
    expect(fn(orders, 'readOrderStatus')(messaging, { ...context, appId: appId + '-other' })).toBeNull()
    expect(fn(orders, 'readOrderStatus')(messaging, { ...context, target: { ...target, queue: 'other' } })).toBeNull()
    expect(fn(orders, 'classifySubmission')(messaging, context, { quantity: 2, region: 'EU', id: 'o1' }).kind).toBe('reuse')
    expect(fn(orders, 'classifySubmission')(messaging, context, { ...order, quantity: 4 }).kind).toBe('conflict')
    expect(fn(orders, 'classifySubmission')(messaging, context, { ...order, id: 'o2' })).toEqual({ kind: 'new' })
    expect(() => fn(orders, 'recordAcceptedOrder')(extension, { appId, target, order: { ...order, quantity: 4 }, generation: 1, sendReceiptId: record.sendReceiptId }, result.state)).toThrow()
    expect(() => fn(orders, 'recordAcceptedOrder')(fn(state, 'emptyHttpFunctionsState')(), { appId, target, order, generation: 1, sendReceiptId: 'trace-999', success: true }, result.state)).toThrow()
    expect(extension.accepted).toHaveLength(1)
    record.order.quantity = 99
    expect(Object.values(result.state.entities)[0].messages[0].body).toBe('{"id":"o1","region":"EU","quantity":2}')
  })
  it('reads full prequeued business orders without creating HTTP acceptance', () => {
    const result = sent()
    expect(fn(orders, 'readOrderStatus')(result.state, context)).toMatchObject({ ...order, status: 'pending', generation: 0, origin: { acceptedId: null } })
    expect(result.state.httpFunctions).toBeUndefined()
    const partial = sent(fixture(), { id: 'o1', region: 'EU' })
    expect(fn(orders, 'readOrderStatus')(partial.state, context)).toBeNull()
  })
  it('does not reuse the same send receipt as another app acceptance', () => {
    const result = sent(), extension = accepted(result)
    expect(() => fn(orders, 'recordAcceptedOrder')(extension, {
      appId: appId + '-other', target, order, generation: 1, sendReceiptId: extension.accepted[0].sendReceiptId,
    }, result.state)).toThrow()
  })
  it('processing requires a matching actual received-order receipt, never another queue marker', () => {
    const sandbox = fixture(), result = sent(sandbox), extension = accepted(result)
    const parsed = parseMessagingProject(SERVICEBUS_SOLUTION_FILES, { entry: 'worker.py', mode: 'script', fixedFiles: MESSAGING_RUNTIME_FILES })
    expect(parsed.diagnostics).toEqual([])
    const worked = executeMessagingProgram({ program: parsed.program, state: result.state, sandbox })
    expect(worked.diagnostics).toEqual([])
    expect(fn(orders, 'readOrderStatus')({ ...worked.state, httpFunctions: extension }, context)).toMatchObject({ ...order, status: 'processed' })
    const flagOnly = { ...result.state, effects: worked.state.effects, httpFunctions: extension }
    expect(fn(orders, 'readOrderStatus')(flagOnly, context).status).toBe('pending')
    const changed = { ...worked.state, effects: { ...worked.state.effects, processed: { o1: { ...order, quantity: 3 } } }, httpFunctions: extension }
    expect(fn(orders, 'readOrderStatus')(changed, context).status).toBe('pending')
  })
  it('real processing in another queue cannot process the accepted target', () => {
    let sandbox = fixture()
    sandbox = createQueue(sandbox, { ...target, name: 'other' }).sandbox
    const first = sent(sandbox), extension = accepted(first)
    const other = applyServiceBusOperation(first.state, sandbox, { kind: 'send', target: { ...target, queue: 'other' }, message: { body: JSON.stringify(order), messageId: 'other-o1', properties: {} } })
    expect(other.diagnostics).toEqual([])
    const files = { ...SERVICEBUS_SOLUTION_FILES, 'worker.py': SERVICEBUS_SOLUTION_FILES['worker.py'].replace('queue_name="orders"', 'queue_name="other"') }
    const parsed = parseMessagingProject(files, { entry: 'worker.py', mode: 'script', fixedFiles: MESSAGING_RUNTIME_FILES })
    expect(parsed.diagnostics).toEqual([])
    const worked = executeMessagingProgram({ program: parsed.program, state: other.state, sandbox })
    expect(worked.diagnostics).toEqual([])
    expect(worked.state.effects.processed.o1).toEqual(order)
    expect(fn(orders, 'readOrderStatus')({ ...worked.state, httpFunctions: extension }, context).status).toBe('pending')
  })
  it('retains send and processing provenance through the real command journal after trace eviction', () => {
    const lab = { id: 'http-contract-journal', engineVersion: 2, contentVersion: 1, capabilities: { messaging: true },
      manifestId: 'messaging-python-v1', tasks: [], resourceSeed: () => fixture(),
      initialProjectFiles: { ...SERVICEBUS_SOLUTION_FILES, 'producer.py': SERVICEBUS_SOLUTION_FILES['producer.py'].replace('"region": "EU"', '"region": "EU", "quantity": 2') },
      messagingExercise: { commands: [{ entry: 'producer.py', mode: 'script' }, { entry: 'worker.py', mode: 'script' }], tasks: [] } }
    const produced = applyMessagingAction(createBehavioralRun(lab, { attemptId: 'http-contract-attempt' }), { type: 'messaging-run', entry: 'producer.py', mode: 'script' }, lab)
    expect(produced.diagnostics).toEqual([])
    const extension = accepted({ state: produced.run.runtime.messaging, trace: produced.execution.trace })
    const worked = applyMessagingAction(produced.run, { type: 'messaging-run', entry: 'worker.py', mode: 'script' }, lab)
    expect(worked.diagnostics).toEqual([])
    let messaging = worked.run.runtime.messaging
    for (let i = 0; i < 500; i++) {
      const advanced = applyServiceBusOperation(messaging, worked.run.sandbox, { kind: 'advance', milliseconds: 1 })
      expect(advanced.diagnostics).toEqual([])
      messaging = advanced.state
    }
    expect(messaging.deliveries.some(row => row.kind === 'send' || row.kind === 'order-record')).toBe(false)
    expect(messaging.executionReceipts).toHaveLength(2)
    expect(fn(orders, 'readOrderStatus')({ ...messaging, httpFunctions: extension }, context)).toMatchObject({ ...order, status: 'processed' })
  })
  it.each(['deadletter', 'expired'])('reports real terminal %s records as failed', terminal => {
    const sandbox = fixture({ defaultMessageTimeToLive: 'PT1S' }), result = sent(sandbox), extension = accepted(result)
    let next
    if (terminal === 'expired') next = applyServiceBusOperation(result.state, sandbox, { kind: 'advance', milliseconds: 1000 })
    else {
      const received = applyServiceBusOperation(result.state, sandbox, { kind: 'receive', target, receiverId: 'worker', count: 1 })
      next = applyServiceBusOperation(received.state, sandbox, { kind: 'deadletter', target, receiverId: 'worker', lockToken: received.value[0].lockToken })
    }
    expect(next.diagnostics).toEqual([])
    expect(fn(orders, 'readOrderStatus')({ ...next.state, httpFunctions: extension }, context).status).toBe('failed')
  })
})

describe('closed bounded HTTP state', () => {
  it('validates empty state and rejects arbitrary success, prototypes and extra state fields', () => {
    const empty = fn(state, 'emptyHttpFunctionsState')(), valid = fn(state, 'validateHttpFunctionsState')
    expect(valid(empty)).toBe(true)
    for (const value of [{ ...empty, requests: [{ success: true }] }, { ...empty, unknown: true }, { ...empty, nextId: Infinity }, Object.assign(Object.create({ forged: true }), empty)]) expect(valid(value)).toBe(false)
    expect(validateMessagingState(emptyMessagingState())).toBe(true)
  })
  it('admits typed captures and request links but rejects altered schemas and exhausted bounds', () => {
    const valid = fn(state, 'validateHttpFunctionsState'), empty = fn(state, 'emptyHttpFunctionsState')()
    const capture = { id: 'http-capture-1', appId: appId.toLowerCase(), scope: 'local', generation: 1, status: 'captured', createdAtMs: 0,
      entry: 'function_app.py', sources: { 'function_app.py': '# handler' }, sourceVersions: { 'function_app.py': 1 }, routes }
    const request = { id: 'http-request-2', appId: appId.toLowerCase(), scope: 'local', generation: 1, method: 'GET',
      path: '/api/orders/O_A', authorization: 'not-required', operationIds: [], readIds: ['http-read-1'],
      response: { statusCode: 200, headers: { 'content-type': 'application/json' }, body: '{"id":"O_A","status":"pending"}' },
      sendReceiptIds: [], workerReceiptIds: [], executionId: 'execution-9', beforeNextId: 4, afterNextId: 10 }
    const extension = { ...empty, nextId: 3, localHosts: [capture], currentLocal: { [capture.appId]: capture.id }, requests: [request] }
    expect(valid(extension)).toBe(true)
    for (const patch of [{ success: true }, { authorization: 'secret-key' }, { afterNextId: 4 }, { readIds: ['fake'] },
      { response: { ...request.response, headers: { 'x-functions-key': 'secret' } } }]) expect(valid({ ...extension, requests: [{ ...request, ...patch }] })).toBe(false)
    expect(valid({ ...extension, localHosts: [{ ...capture, sources: { 'function_app.py': 'é'.repeat(32769) } }] })).toBe(false)
    expect(valid({ ...extension, requests: Array(101).fill(request) })).toBe(false)
    expect(valid({ ...extension, requests: [{ ...request, response: { ...request.response, body: 'a'.repeat(16385) } }] })).toBe(false)
    const recorded = accepted(sent()), reordered = JSON.parse(JSON.stringify(recorded))
    reordered.accepted[0].order = { quantity: 2, region: 'EU', id: 'o1' }
    reordered.accepted[0].target = { queue: 'orders', namespace: 'sb-orders', resourceGroup: 'rg-messaging' }
    expect(valid(reordered)).toBe(true)
    expect(valid({ ...extension, accepted: recorded.accepted })).toBe(false)
  })
  it('retains capture generations while current references select an active bounded snapshot', () => {
    const valid = fn(state, 'validateHttpFunctionsState'), empty = fn(state, 'emptyHttpFunctionsState')()
    const capture = { id: 'http-capture-1', appId: appId.toLowerCase(), scope: 'local', generation: 1, status: 'stopped', createdAtMs: 0,
      entry: 'function_app.py', sources: { 'function_app.py': '# handler' }, sourceVersions: { 'function_app.py': 1 }, routes }
    const latest = { ...capture, id: 'http-capture-2', generation: 2, status: 'captured', createdAtMs: 10 }
    const extension = { ...empty, nextId: 4, localHosts: [capture, latest], currentLocal: { [capture.appId]: latest.id }, requests: [requestRecord('/api/orders/o1')] }
    expect(valid(extension)).toBe(true)
    expect(valid({ ...extension, localHosts: [latest] })).toBe(false)
    for (const currentLocal of [{ [capture.appId]: 'http-capture-999' }, { [appId.toLowerCase() + '-other']: latest.id }, { [capture.appId]: capture.id }]) expect(valid({ ...extension, currentLocal })).toBe(false)
    for (const patch of [{ generation: 1 }, { createdAtMs: -1 }, { createdAtMs: Infinity }, { unexpected: true }]) expect(valid({ ...extension, localHosts: [capture, { ...latest, ...patch }] })).toBe(false)
    const published = { ...latest, id: 'http-capture-4', scope: 'published' }
    expect(valid({ ...extension, nextId: 5, deployments: [published], currentPublished: { [capture.appId]: published.id } })).toBe(true)
    expect(valid({ ...extension, nextId: 5, deployments: [published], currentLocal: { [capture.appId]: published.id } })).toBe(false)
    const history = Array.from({ length: 16 }, (_, i) => ({ ...latest, id: `http-capture-${i + 1}`, generation: i + 1, createdAtMs: i }))
    expect(valid({ ...empty, nextId: 17, localHosts: history, currentLocal: { [capture.appId]: history.at(-1).id } })).toBe(true)
    expect(valid({ ...empty, nextId: 18, localHosts: [...history, { ...latest, id: 'http-capture-17', generation: 17 }], currentLocal: { [capture.appId]: 'http-capture-17' } })).toBe(false)
    expect(extension.localHosts).toHaveLength(2)
  })
})
