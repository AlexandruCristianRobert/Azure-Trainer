import { describe, it, expect } from 'vitest'
import { parseMessagingProject } from '../src/lib/messaging/python.js'
import { executeMessagingProgram } from '../src/lib/messaging/vm.js'
import { executeMessagingEntry } from '../src/lib/messaging/execute.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { SERVICEBUS_STARTER_FILES, SERVICEBUS_SOLUTION_FILES } from '../src/data/templates/messaging-python/servicebus.js'
import { MESSAGING_RUNTIME_FILES } from '../src/data/templates/messaging-python/runtime.js'
import { emptyMessagingState, validateMessagingState } from '../src/lib/messaging/state.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup, createNamespace, createQueue, createTopic, createSubscription, updateQueue } from '../src/lib/sandbox/ops.js'

function fixture() {
  let sandbox = createResourceGroup(createSandbox(), { name: 'rg-messaging', location: 'westeurope' }).sandbox
  sandbox = createNamespace(sandbox, { resourceGroup: 'rg-messaging', name: 'sb-orders' }).sandbox
  sandbox = createQueue(sandbox, { resourceGroup: 'rg-messaging', namespace: 'sb-orders', name: 'orders' }).sandbox
  return sandbox
}
const parse = (source, extra = {}) => parseMessagingProject({ ...SERVICEBUS_STARTER_FILES, 'producer.py': source, ...extra }, { entry: 'producer.py', mode: 'script', fixedFiles: MESSAGING_RUNTIME_FILES })
const producer = (body = '"payload"') => `from clients import bus
from azure.servicebus import ServiceBusMessage as Msg
def main():
    with bus.get_queue_sender(queue_name="orders") as sender:
        sender.send_messages(Msg(${body}, message_id="m1"))
`
const messages = state => Object.values(state.entities).flatMap(entity => entity.messages)
function run(source, { state = emptyMessagingState(), sandbox = fixture(), extra = {}, limits, input } = {}) {
  const parsed = parse(source, extra)
  if (parsed.diagnostics.length) return { state, value: null, trace: [], diagnostics: parsed.diagnostics }
  return executeMessagingProgram({ program: parsed.program, state, sandbox, limits, input })
}

describe('source-driven bounded messaging Python', () => {
  it('preserves receipt bodytext string semantics and ordered actual lock provenance', () => {
    const sent = run(producer(`'{"id":"o1","quantity":2}'`))
    const result = run(`from clients import bus
from training_runtime import perform_order_work, record_processed
import json
def work(order):
    perform_order_work(order)
    record_processed(order)
    record_processed(order)
def main():
    with bus.get_queue_receiver(queue_name="orders") as rx:
        for msg in rx.receive_messages():
            text = str(msg)
            plain = '{"id":"o1","quantity":2}'
            order = json.loads(text)
            alias = order
            work(alias)
            rx.complete_message(msg)
            print(text, msg.body.decode("utf-8"))
            return [text, len(text), text + "!", "prefix" + text, "o1" in text, text in [plain], text == plain, text != plain, json.dumps(text), msg.body.decode("utf-8") == text, text[0], str(text)]
`, { state: sent.state })
    expect(result.diagnostics).toEqual([])
    const body = '{"id":"o1","quantity":2}'
    expect(result.value).toEqual([body, 24, body + '!', 'prefix' + body, true, true, true, false, JSON.stringify(body), true, '{', body])
    expect(result.output).toEqual([body + ' ' + body])
    const record = messages(result.state)[0], lock = record.lockHistory[0]
    expect(result.trace.map(row => row.kind)).toEqual(['receive', 'order-work', 'order-record', 'order-record', 'complete'])
    for (const row of result.trace.filter(row => row.kind.startsWith('order-'))) {
      expect(row).toMatchObject({ entityId: record.entityId, messageRecordId: record.id, messageId: 'm1', receiverId: lock.receiverId, lockToken: lock.lockToken, order: { id: 'o1', quantity: 2 } })
    }
    expect(result.trace.filter(row => row.kind === 'order-record').map(row => row.changed)).toEqual([true, false])
    expect(validateMessagingState(result.state)).toBe(true)
    const malformed = JSON.parse(JSON.stringify(result.state))
    malformed.deliveries.find(row => row.kind === 'order-work').lockToken = 'lock-999'
    expect(validateMessagingState(malformed)).toBe(false)
  })
  it('charges receipt bodytext JSON and concatenation against encoded byte limits before work', () => {
    const sent = run(producer('"éééééééééé"'))
    for (const expression of ['json.dumps(str(msg))', 'str(msg) + "é"']) {
      const result = run(`from clients import bus
import json
def main():
    with bus.get_queue_receiver(queue_name="orders") as rx:
        for msg in rx.receive_messages():
            return ${expression}
`, { state: sent.state, limits: { valueBytes: 20 } })
      expect(result.diagnostics[0]?.code).toBe('MESSAGING_LIMIT')
      expect(result.state.effects).toEqual({})
    }
    const queued = run(producer(`'{"id":"o1","quantity":2}'`))
    const capped = run(`from clients import bus
from training_runtime import perform_order_work
import json
def main():
    with bus.get_queue_receiver(queue_name="orders") as rx:
        for msg in rx.receive_messages():
            perform_order_work(json.loads(str(msg)))
`, { state: queued.state, limits: { traces: 1 } })
    expect(capped.diagnostics[0]?.code).toBe('MESSAGING_LIMIT')
    expect(capped.trace.map(row => row.kind)).toEqual(['receive'])
    expect(capped.state.effects).toEqual({})
  })
  it('binds aliased imports and renamed values with CRLF and comments', () => {
    const source = producer().replace(/\bsender\b/g, 'outbox').replace('message_id="m1"))', 'message_id="m1")) # work').replace(/\n/g, '\r\n')
    const parsed = parse(source)
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.program.sourcePaths).toEqual(expect.arrayContaining(['producer.py', 'clients.py']))
    const result = run(source)
    expect(result.diagnostics).toEqual([])
    expect(messages(result.state)[0]).toMatchObject({ body: 'payload', messageId: 'm1' })
    expect(result.trace.map(record => record.kind)).toEqual(['send', 'enqueue'])
  })

  it.each(['open("orders.txt")', '[x for x in [1]]', 'unknown.send_messages("x")', '(lambda: 1)()'])('rejects %s before an earlier send has effects', expression => {
    const source = producer() + `    if False:\n        value = ${expression}\n`
    const state = emptyMessagingState()
    const result = run(source, { state })
    expect(result.state).toBe(state)
    expect(result.trace).toEqual([])
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED', path: 'producer.py', line: 7 })
    expect(result.diagnostics[0].column).toBeGreaterThan(0)
  })

  it('rejects asynchronous source and syntax errors with positions', () => {
    for (const source of ['async def main():\n    print("x")\n', 'def main():\n    x = (\n']) {
      expect(parse(source).diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED', path: 'producer.py', line: expect.any(Number), column: expect.any(Number) })
    }
  })

  it('follows the body, branches and exact received identities', () => {
    const sent = run(producer('"first"'))
    const second = run(producer('"second"').replace('"m1"', '"m2"'), { state: sent.state })
    const result = run(`from clients import bus
def main():
    with bus.get_queue_receiver(queue_name="orders") as rx:
        for item in rx.receive_messages(max_message_count=2):
            if str(item) == "second":
                rx.complete_message(item)
            else:
                rx.abandon_message(item)
`, { state: second.state })
    expect(result.diagnostics).toEqual([])
    expect(messages(result.state).map(m => [m.body, m.status, m.deliveryCount])).toEqual([['first', 'active', 2], ['second', 'completed', 1]])
    expect(validateMessagingState(result.state)).toBe(true)
  })

  it('executes local calls, constants, annotations, dict/list/index and integer addition', () => {
    const result = run(`import json as codec
from clients import bus
from azure.servicebus import ServiceBusMessage
N = 2
def decorate(order: dict) -> dict:
    order["count"] = N + 1
    return order
def main():
    rows = [{"id": "o2"}]
    with bus.get_queue_sender(queue_name="orders") as tx:
        for row in rows:
            tx.send_messages(ServiceBusMessage(codec.dumps(decorate(row))))
`)
    expect(result.diagnostics).toEqual([])
    expect(JSON.parse(messages(result.state)[0].body)).toEqual({ id: 'o2', count: 3 })
  })

  it('ignores unfinished unrelated modules and unreachable function bodies', () => {
    const parsed = parse(producer() + '\ndef unused():\n    open("bad")\n', { 'events.py': 'async def broken(\n' })
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.program.sourcePaths).not.toContain('events.py')
  })

  it('requires the protected helpers and requirements to match exactly', () => {
    for (const path of ['training_runtime.py', 'requirements.txt']) {
      const parsed = parse(producer(), { [path]: 'edited' })
      expect(parsed.program).toBeNull()
      expect(parsed.diagnostics[0]).toMatchObject({ code: 'MESSAGING_CONFIG', path })
    }
  })

  it('counts shared loop/local-call steps and bounds recursion without leaking JS errors', () => {
    const loop = run('def f(x):\n    return x + 1\ndef main():\n    for x in [1,2,3,4,5]:\n        f(x)\n', { limits: { steps: 12 } })
    expect(loop.diagnostics[0]).toMatchObject({ code: 'MESSAGING_LIMIT', path: 'producer.py', line: expect.any(Number) })
    const recursive = run('def main():\n    return main()\n')
    expect(recursive.diagnostics[0]).toMatchObject({ code: 'MESSAGING_LIMIT' })
  })

  it('blocks prototype reads/writes including dynamic JSON keys', () => {
    for (const source of ['def main():\n    x = {}\n    x["__proto__"] = 1\n', 'def main():\n    x = {}\n    print(x.constructor)\n', 'import json\ndef main():\n    x = json.loads(\'{"prototype": 1}\')\n']) {
      expect(run(source).diagnostics[0].code).toMatch(/^MESSAGING_(UNSUPPORTED|RUNTIME)$/)
    }
    expect({}.polluted).toBeUndefined()
  })

  it('keeps business effects separate from idempotent processed markers', () => {
    const source = `from training_runtime import perform_order_work, record_processed, was_processed, record_notification, handler_status
def main():
    order = {"id": "o1"}
    if not was_processed(order["id"]):
        perform_order_work(order)
        record_processed(order)
    record_notification("e1", "o1")
    return handler_status("o1")
`
    const first = run(source, { input: { handlerStatus: { o1: 503 } } })
    expect(first.diagnostics).toEqual([])
    expect(first.value).toBe(503)
    const guarded = run(source, { state: first.state })
    expect(guarded.state.effects.workByOrder.o1).toBe(1)
    const unguarded = run(source.replace('if not was_processed(order["id"]):', 'if True:'), { state: guarded.state })
    expect(unguarded.state.effects.workByOrder.o1).toBe(2)
    expect(Object.keys(unguarded.state.effects.processed)).toEqual(['o1'])
    expect(Object.keys(unguarded.state.effects.notifications)).toEqual(['e1'])
  })

  it('resolves endpoints against the provided Sandbox and positions broker failures', () => {
    const source = producer().replace('queue_name="orders"', 'queue_name="missing"')
    expect(run(source).diagnostics[0]).toMatchObject({ code: 'MESSAGING_CONFIG', path: 'producer.py', line: 5 })
    const wrong = run(producer(), { extra: { 'clients.py': SERVICEBUS_STARTER_FILES['clients.py'].replace('sb-orders.servicebus.windows.net', 'elsewhere.servicebus.windows.net') } })
    expect(wrong.diagnostics[0]).toMatchObject({ code: 'MESSAGING_CONFIG', path: 'clients.py' })
  })

  it('orchestrates scripts once without grading and leaves the run untouched on parse failure', () => {
    const lab = { id: 'messaging-source-fixture', engineVersion: 2, contentVersion: 1, tasks: [], capabilities: { messaging: true }, manifestId: 'messaging-python-v1', initialProjectFiles: SERVICEBUS_SOLUTION_FILES, resourceSeed: fixture }
    const original = createBehavioralRun(lab, { attemptId: 'script-fixture' })
    original.project.draftFiles['producer.py'] = 'def main():\n    open("unsaved")\n'
    const result = executeMessagingEntry(original, lab, 'producer.py')
    expect(result.diagnostics).toEqual([])
    expect(messages(result.run.runtime.messaging)).toHaveLength(1)
    expect(result.portalEvents).toEqual([])
    expect(messages(original.runtime.messaging)).toHaveLength(0)
    expect(result.run.project).toBe(original.project)
    const broken = { ...original, project: { ...original.project, savedFiles: { ...original.project.savedFiles, 'producer.py': producer() + '    open("x")\n' } } }
    expect(executeMessagingEntry(broken, lab, 'producer.py').run).toBe(broken)
  })

  it('preflights uncertain branch receivers before any send', () => {
    const source = producer() + `    if True:
        other = {}
    else:
        other = bus.get_queue_sender(queue_name="orders")
    other.send_messages(Msg("wrong"))
`
    const state = emptyMessagingState(), result = run(source, { state })
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED' })
    expect(result.state).toBe(state)
  })

  it('rejects heterogeneous callable lists during preflight', () => {
    const source = producer() + `    resources = [bus.get_queue_sender(queue_name="orders"), {}]
    for resource in resources:
        resource.send_messages(Msg("wrong"))
`
    expect(parse(source).program).toBeNull()
  })

  it('allows only constants and supported constructors at module scope', () => {
    const source = producer() + '\nbus.get_queue_sender(queue_name="orders").send_messages(Msg("outside"))\n'
    expect(parse(source).diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED', path: 'producer.py' })
  })

  it('supports ordinary dotted module imports and print without fake broker events', () => {
    const source = `import azure.servicebus
import azure.identity as identity
def main():
    bus = azure.servicebus.ServiceBusClient("sb-orders.servicebus.windows.net", identity.DefaultAzureCredential())
    with bus.get_queue_sender(queue_name="orders") as tx:
        tx.send_messages(azure.servicebus.ServiceBusMessage("hello"))
    print("sent", len([1]), True, None)
`
    const result = run(source)
    expect(result.diagnostics).toEqual([])
    expect(result.output).toEqual(['sent 1 True None'])
    expect(result.trace.map(t => t.kind)).toEqual(['send', 'enqueue'])
  })

  it('maps dead-letter reason, UTF-8 body, enum selection and actual receipt settlement', () => {
    const sent = run(producer())
    const rejected = run(`from clients import bus
def main():
    with bus.get_queue_receiver(queue_name="orders") as rx:
        for msg in rx.receive_messages():
            rx.dead_letter_message(msg, reason="BadOrder", error_description="No stock")
`, { state: sent.state })
    expect(rejected.diagnostics).toEqual([])
    const recovered = run(`from clients import bus
from azure.servicebus import ServiceBusSubQueue as SQ
def main():
    with bus.get_queue_receiver(queue_name="orders", sub_queue=SQ.DEAD_LETTER) as rx:
        for msg in rx.receive_messages():
            print(msg.body.decode("utf-8"), msg.dead_letter_reason, msg.dead_letter_error_description)
            rx.complete_message(msg)
`, { state: rejected.state })
    expect(recovered.diagnostics).toEqual([])
    expect(recovered.output).toEqual(['payload BadOrder No stock'])
    expect(messages(recovered.state)[0]).toMatchObject({ status: 'completed', subQueue: 'deadletter' })
  })

  it('binds topic senders and subscription receivers to full Sandbox resource identities', () => {
    let sandbox = createTopic(fixture(), { resourceGroup: 'rg-messaging', namespace: 'sb-orders', name: 'order-work' }).sandbox
    sandbox = createSubscription(sandbox, { resourceGroup: 'rg-messaging', namespace: 'sb-orders', topic: 'order-work', name: 'eu-orders' }).sandbox
    const sent = run(producer().replace('get_queue_sender(queue_name="orders")', 'get_topic_sender(topic_name="order-work")'), { sandbox })
    const received = run(`from clients import bus
def main():
    with bus.get_subscription_receiver(topic_name="order-work", subscription_name="eu-orders") as sub:
        for message in sub.receive_messages():
            sub.complete_message(message)
`, { sandbox, state: sent.state })
    expect(received.diagnostics).toEqual([])
    expect(messages(received.state)[0].entityId).toContain('/topics/order-work/subscriptions/eu-orders')
    expect(messages(received.state)[0].status).toBe('completed')
  })

  it('maps sessions and application properties and cannot settle with another receiver', () => {
    const sandbox = updateQueue(fixture(), { resourceGroup: 'rg-messaging', namespace: 'sb-orders', name: 'orders', requiresSession: true }).sandbox
    const sent = run(producer().replace('message_id="m1"', 'message_id="m1", session_id="customer-a", application_properties={"region": "EU"}'), { sandbox })
    const result = run(`from clients import bus
def main():
    with bus.get_queue_receiver(queue_name="orders", session_id="customer-a") as rx:
        other = bus.get_queue_receiver(queue_name="orders", session_id="customer-a")
        for message in rx.receive_messages():
            print(message.application_properties["region"], message.session_id, message.delivery_count)
            other.complete_message(message)
`, { state: sent.state, sandbox })
    expect(result.output).toEqual(['EU customer-a 1'])
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_RUNTIME', path: 'producer.py', line: 7 })
    expect(messages(result.state)[0].status).toBe('locked')
  })

  it('closes with resources on exit and preserves unsettled PeekLock identity', () => {
    const result = run(`from clients import bus
def main():
    with bus.get_queue_receiver(queue_name="orders") as rx:
        batch = rx.receive_messages()
    rx.complete_message(batch[0])
`, { state: run(producer()).state })
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_RUNTIME', line: 5 })
    expect(messages(result.state)[0].status).toBe('locked')
  })

  it('bounds files, fixture arrays and retained traces explicitly', () => {
    expect(parse('#'.repeat(128 * 1024 + 1)).diagnostics[0].code).toBe('MESSAGING_LIMIT')
    expect(run('def main():\n    pass\n', { input: { messages: Array(51).fill({}) } }).diagnostics[0].code).toBe('MESSAGING_LIMIT')
    const result = run(producer() + '    with bus.get_queue_sender(queue_name="orders") as tx:\n        tx.send_messages(Msg("second"))\n', { limits: { traces: 2 } })
    expect(result.diagnostics[0].code).toBe('MESSAGING_LIMIT')
    expect(result.trace).toHaveLength(2)
    expect(messages(result.state)).toHaveLength(1)
  })

  it('bounds retained receipt history across invocations without rewriting old evidence', () => {
    const abandoned = run(`from clients import bus
def main():
    with bus.get_queue_receiver(queue_name="orders") as rx:
        for message in rx.receive_messages():
            rx.abandon_message(message)
`, { state: run(producer()).state })
    const state = abandoned.state, record = messages(state)[0], first = record.lockHistory[0]
    record.lockHistory = Array.from({ length: 500 }, (_, index) => ({ ...first, lockToken: `lock-${index + 100}` }))
    state.nextId = 1000
    expect(validateMessagingState(state)).toBe(true)
    const result = run('from clients import bus\ndef main():\n    with bus.get_queue_receiver(queue_name="orders") as rx:\n        rx.receive_messages()\n', { state })
    expect(result.diagnostics[0].code).toBe('MESSAGING_LIMIT')
    expect(result.state).toBe(state)
    expect(record.lockHistory).toHaveLength(500)
  })

  it('bounds expanding nested values before JSON conversion can allocate exponentially', () => {
    const result = run(`import json
def main():
    value = [1]
    for item in [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]:
        value = [value, value]
    return json.dumps(value)
`)
    expect(result.diagnostics[0].code).toBe('MESSAGING_LIMIT')
  })

  it('executes the authored worker solution against its actual producer payload', () => {
    const sent = run(SERVICEBUS_SOLUTION_FILES['producer.py'])
    const parsed = parseMessagingProject(SERVICEBUS_SOLUTION_FILES, { entry: 'worker.py', fixedFiles: MESSAGING_RUNTIME_FILES })
    expect(parsed.diagnostics).toEqual([])
    const result = executeMessagingProgram({ program: parsed.program, state: sent.state, sandbox: fixture() })
    expect(result.diagnostics).toEqual([])
    expect(result.state.effects.workByOrder).toEqual({ o1: 1 })
    expect(messages(result.state)[0].status).toBe('completed')
  })

  it('rejects executable annotations before accepting reachable functions', () => {
    const source = producer().replace('def main():', 'def main() -> open("file"):')
    expect(parse(source).diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED', path: 'producer.py', line: 3 })
  })

  it('prevents handler fixture objects from becoming mutable runtime values', () => {
    const input = { handlerStatus: { o1: { changed: false } } }
    const source = 'from training_runtime import handler_status\ndef main():\n    status = handler_status("o1")\n    status["changed"] = True\n'
    expect(run(source, { input }).diagnostics[0]).toMatchObject({ code: 'MESSAGING_CONFIG' })
    expect(input.handlerStatus.o1.changed).toBe(false)
  })

  it('selects elif/boolean branches, sends lists, and enforces the 50-message ceiling', () => {
    const result = run(`from clients import bus
from azure.servicebus import ServiceBusMessage as M
def main():
    count = len([1,2])
    if count < 2 or not True:
        raise ValueError("bad branch")
    elif count >= 2 and count != 3:
        with bus.get_queue_sender(queue_name="orders") as tx:
            tx.send_messages([M(b"one", message_id="a"), M("two", message_id="b")])
    else:
        raise ValueError("bad fallback")
`)
    expect(result.diagnostics).toEqual([])
    expect(messages(result.state).map(m => m.body)).toEqual(['one', 'two'])
    const repeated = run(`from clients import bus
from azure.servicebus import ServiceBusMessage
def main():
    with bus.get_queue_sender(queue_name="orders") as tx:
        for n in [${Array(51).fill('1').join(',')}]:
            tx.send_messages(ServiceBusMessage("x"))
`)
    expect(repeated.diagnostics[0].code).toBe('MESSAGING_LIMIT')
    expect(messages(repeated.state)).toHaveLength(50)
  })

  it('retains actual effects and a positioned ValueError when application code raises', () => {
    const result = run('from training_runtime import perform_order_work\ndef main():\n    perform_order_work({"id":"o1"})\n    raise ValueError("after work")\n')
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_RUNTIME', message: 'ValueError: after work', path: 'producer.py', line: 4 })
    expect(result.state.effects.workByOrder.o1).toBe(1)
    expect(result.value).toBeNull()
  })

  it.each([
    '    other = {}\n    for unused in []:\n        other = bus.get_queue_sender(queue_name="orders")\n    other.send_messages(Msg("bad"))\n',
    '    resources = [bus.get_queue_sender(queue_name="orders")]\n    alias = resources\n    alias[0] = {}\n    resources[0].send_messages(Msg("bad"))\n',
    '    unsafe = {"__proto__": 1}\n',
  ])('rejects uncertain loop/container receivers and literal unsafe keys before effects: %s', suffix => {
    const state = emptyMessagingState(), result = run(producer() + suffix, { state })
    expect(result.diagnostics[0].code).toBe('MESSAGING_UNSUPPORTED')
    expect(result.state).toBe(state)
  })

  it.each([
    'def make():\n    if False:\n        return b"data"\ndef main():\n    perform_order_work({"id":"o1"})\n    make().decode()\n',
    'def use(target, depth):\n    if depth == 0:\n        target.decode()\n    else:\n        use({}, 0)\ndef main():\n    perform_order_work({"id":"o1"})\n    use(b"data", 1)\n',
  ])('rejects implicit-return and changed recursive receiver types before work: %s', body => {
    const state = emptyMessagingState()
    const result = run('from training_runtime import perform_order_work\n' + body, { state })
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_UNSUPPORTED', path: 'producer.py' })
    expect(result.state).toBe(state)
    expect(result.state.effects).toEqual({})
  })

  it('preserves typed values from total conditional returns and final fallthrough returns', () => {
    const result = run('def first(flag):\n    if flag:\n        return b"one"\n    else:\n        return b"two"\ndef second(flag):\n    if flag:\n        return b"three"\n    return b"four"\ndef main():\n    return [first(False).decode(), second(False).decode()]\n')
    expect(result.diagnostics).toEqual([])
    expect(result.value).toEqual(['two', 'four'])
  })

  it('compares dictionary contents without insertion order and uses structural list membership', () => {
    const result = run(`def main():
    left = {"id": "o1", "region": "EU"}
    right = {"region": "EU", "id": "o1"}
    return [left == right, left != right, right in [left], [1, {"a": 2}] in [[1, {"a": 2}]], [2, 1] not in [[1, 2]], [1, 2] == [2, 1]]
`)
    expect(result.diagnostics).toEqual([])
    expect(result.value).toEqual([true, false, true, true, true, false])
  })

  it('preserves SDK handle identity inside structural container comparisons', () => {
    const result = run('from azure.servicebus import ServiceBusMessage\ndef main():\n    first = ServiceBusMessage("x")\n    second = ServiceBusMessage("x")\n    return [[first] == [first], [first] == [second], first in [first], first in [second]]\n')
    expect(result.diagnostics).toEqual([])
    expect(result.value).toEqual([true, false, true, false])
  })

  it('charges structural comparisons to the shared step budget', () => {
    const result = run('def main():\n    left = [1]\n    right = [1]\n    for item in [1,2,3,4,5,6,7,8,9,10]:\n        left = [left,left]\n        right = [right,right]\n    return left == right\n', { limits: { steps: 500 } })
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_LIMIT', path: 'producer.py', line: 7 })
  })

  it('rejects expanded JSON by encoded bytes under a small limit before allocation', () => {
    const result = run('import json\ndef main():\n    value = ["abcdefghijklmnop"]\n    for item in [1,2,3]:\n        value = [value,value]\n    return json.dumps(value)\n', { limits: { valueBytes: 64 } })
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_LIMIT', path: 'producer.py', line: 6 })
    expect(result.diagnostics[0].message).toContain('encoded bytes')
  })

  it('accounts for UTF-8, JSON escapes and container punctuation in the JSON byte limit', () => {
    for (const expression of ['["éé", "éé"]', '["\\n\\n", "\\n\\n"]', '{"a": [1,2,3]}']) {
      expect(run(`import json\ndef main():\n    return json.dumps(${expression})\n`, { limits: { valueBytes: 12 } }).diagnostics[0]?.code).toBe('MESSAGING_LIMIT')
    }
    const accepted = run('import json\ndef main():\n    print(json.dumps({"a": [1,2]}))\n', { limits: { valueBytes: 12 } })
    expect(accepted.diagnostics).toEqual([])
    expect(accepted.output).toEqual(['{"a":[1,2]}'])
  })
})
