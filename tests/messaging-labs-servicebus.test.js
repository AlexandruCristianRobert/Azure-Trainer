import { describe, it, expect } from 'vitest'
import { SERVICEBUS_FOUNDATION_LABS } from '../src/data/labs/messaging-journey/index.js'
import * as messagingJourney from '../src/data/labs/messaging-journey/index.js'
import { LABS } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'

// Breaks caught: missing send payload, missing work/record/settlement, and
// recovery that skips the actual DLQ or leaves its original unsettled.
function replayMessagingSolution(lab, files = {}) {
  let run = createBehavioralRun(lab, { attemptId: `replay-${lab.id}` })
  for (const task of lab.tasks) for (const step of task.solution.steps) {
    const action = step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: files[step.path] ?? step.content }
      : { type: 'command', line: step.line }
    const result = applyRunAction(run, action, lab)
    expect(result.diagnostics ?? []).toEqual([])
    run = result.run
  }
  return run
}

describe('Service Bus foundation curriculum', () => {
  for (const lab of SERVICEBUS_FOUNDATION_LABS) {
    it(`${lab.id} starts pending and its worked commands demonstrate behavior`, () => {
      const start = createBehavioralRun(lab, { attemptId: `test-${lab.id}` })
      expect(evaluateLab(lab, start).tasks.every(task => !task.done)).toBe(true)
      expect(start.runtime.messaging.executionReceipts).toEqual([])
      expect(start.evidence.experimentsById).toEqual({})
      const proved = replayMessagingSolution(lab)
      const messages = Object.values(proved.runtime.messaging.entities).flatMap(entity => entity.messages)
      if (lab.id === 'messaging-send') {
        expect(messages.map(row => [row.messageId, row.status, JSON.parse(row.body)])).toEqual([['m1', 'active', { id: 'o1', region: 'EU', quantity: 2 }]])
      } else if (lab.id === 'messaging-receive') {
        expect(messages.map(row => [row.messageId, row.status, row.lockHistory.map(lock => lock.settlement)])).toEqual([['m1', 'completed', ['complete']]])
        expect(proved.runtime.messaging.effects.workByOrder).toEqual({ o1: 1 })
        expect(proved.runtime.messaging.effects.processed.o1).toEqual({ id: 'o1', region: 'EU', quantity: 2 })
      } else {
        expect(messages.map(row => [row.messageId, row.status, row.subQueue, JSON.parse(row.body).quantity, row.lockHistory.map(lock => lock.settlement)])).toEqual([
          ['m1', 'completed', 'active', 2, ['complete']],
          ['bad', 'completed', 'deadletter', 0, ['deadletter', 'complete']],
          ['bad-recovered', 'completed', 'active', 1, ['complete']],
        ])
        expect(proved.runtime.messaging.effects.workByOrder).toEqual({ o1: 1, o2: 1 })
        expect(proved.runtime.messaging.effects.processed.o2).toEqual({ id: 'o2', region: 'EU', quantity: 1 })
      }
      expect(evaluateLab(lab, proved).tasks.every(task => task.done)).toBe(true)
      expect(evaluateLab(lab, deserializeRun(serializeRun(proved, lab), lab)).tasks.every(task => task.done)).toBe(true)
    })
  }
  it('rejects a sender that actually sends the wrong order region despite successful execution', () => {
    const lab = SERVICEBUS_FOUNDATION_LABS[0]
    const source = lab.tasks.at(-1).solution.steps[0].content.replace('"region": "EU"', '"region": "US"')
    const changed = replayMessagingSolution(lab, { 'producer.py': source })
    const actual = Object.values(changed.runtime.messaging.entities)[0].messages[0]
    expect(JSON.parse(actual.body).region).toBe('US')
    expect(evaluateLab(lab, changed).tasks.at(-1).done).toBe(false)
  })
  it('rejects completion before actual business work even when final totals and marker are correct', () => {
    const lab = SERVICEBUS_FOUNDATION_LABS[1]
    const run = replayMessagingSolution(lab, { 'worker.py': `from clients import bus
from training_runtime import perform_order_work, record_processed
import json
def main():
    with bus.get_queue_receiver(queue_name="orders") as receiver:
        for message in receiver.receive_messages(max_message_count=10):
            order = json.loads(str(message))
            receiver.complete_message(message)
            record_processed(order)
            perform_order_work(order)
` })
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1 })
    expect(run.runtime.messaging.effects.processed.o1).toEqual({ id: 'o1', region: 'EU', quantity: 2 })
    expect(Object.values(run.runtime.messaging.entities)[0].messages[0].status).toBe('completed')
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
  })
  it('rejects invalid original work substituted for corrected receipt work despite matching final totals', () => {
    const lab = SERVICEBUS_FOUNDATION_LABS[2]
    const run = replayMessagingSolution(lab, { 'worker.py': `from clients import bus
from training_runtime import perform_order_work, record_processed
import json
def process_orders():
    with bus.get_queue_receiver(queue_name="orders") as receiver:
        for message in receiver.receive_messages(max_message_count=10):
            order = json.loads(str(message))
            if order["quantity"] <= 0:
                perform_order_work(order)
                receiver.dead_letter_message(message, reason="InvalidOrder")
            else:
                if order["id"] == "o1":
                    perform_order_work(order)
                record_processed(order)
                receiver.complete_message(message)
def main():
    process_orders()
` })
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1, o2: 1 })
    expect(run.runtime.messaging.effects.processed.o2).toEqual({ id: 'o2', region: 'EU', quantity: 1 })
    expect(Object.values(run.runtime.messaging.entities)[0].messages.map(row => row.status)).toEqual(['completed', 'completed', 'completed'])
    expect(evaluateLab(lab, run).tasks.map(task => task.done)).toEqual([false, false])
  })
  it('appends the independent simulated labs to the catalog in journey order', () => {
    expect(SERVICEBUS_FOUNDATION_LABS.map(lab => lab.id)).toEqual(['messaging-send', 'messaging-receive', 'messaging-deadletter'])
    expect(LABS.filter(lab => SERVICEBUS_FOUNDATION_LABS.includes(lab)).map(lab => lab.id)).toEqual(['messaging-send', 'messaging-receive', 'messaging-deadletter'])
  })
})

// Breaks caught: duplicate business work, wrong subscription consumption/filter
// routing, and session business work reordered independently of broker receipts.
describe('advanced Service Bus curriculum', () => {
  const advanced = messagingJourney.SERVICEBUS_ADVANCED_LABS ?? []
  const labAt = index => {
    expect(advanced).toHaveLength(3)
    return advanced[index]
  }
  const rows = run => Object.values(run.runtime.messaging.entities).flatMap(entity => entity.messages)
  it('advanced independent baselines start with all new Tasks and execution proof pending', () => {
    expect(advanced.map(lab => [lab.id, lab.journeyOrder])).toEqual([
      ['messaging-idempotency', 4], ['messaging-topics', 5], ['messaging-sessions', 6],
    ])
    for (const lab of advanced) {
      const run = createBehavioralRun(lab, { attemptId: `advanced-start-${lab.id}` })
      expect(evaluateLab(lab, run).tasks.every(task => !task.done)).toBe(true)
      expect(run.runtime.messaging.executionReceipts).toEqual([])
      expect(run.runtime.messaging.effects).toEqual({})
      expect(run.evidence.experimentsById).toEqual({})
    }
  })
  it('advanced idempotency Lab counts one business effect for repeated delivery', () => {
    const lab = labAt(0), run = replayMessagingSolution(lab)
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1 })
    expect(rows(run).map(row => [row.messageId, row.status, row.lockHistory.map(lock => lock.settlement)])).toEqual([
      ['m1', 'completed', ['complete']], ['m1-retry', 'completed', ['complete']],
    ])
    expect(run.runtime.messaging.deliveries.filter(row => row.kind === 'order-work').map(row => row.messageId)).toEqual(['m1'])
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
  })
  it('advanced topic subscriptions consume independent EU and all-region copies', () => {
    const lab = labAt(1), run = replayMessagingSolution(lab)
    expect(rows(run).map(row => [row.entityId.split('/').at(-1), row.messageId, row.status, JSON.parse(row.body).region])).toEqual([
      ['eu-orders', 'eu1', 'completed', 'EU'], ['all-orders', 'eu1', 'completed', 'EU'], ['all-orders', 'us1', 'completed', 'US'],
    ])
    const euCopies = rows(run).filter(row => row.messageId === 'eu1')
    expect(euCopies[0].id).not.toBe(euCopies[1].id)
    expect(euCopies[0].sourceMessageId).toBe(euCopies[1].sourceMessageId)
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 2, o2: 1 })
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
  })
  it('advanced sessions perform two ordered o1 steps while another session remains unconsumed', () => {
    const lab = labAt(2), run = replayMessagingSolution(lab)
    expect(rows(run).map(row => [row.messageId, row.sessionId, row.status])).toEqual([
      ['o1-step1', 'o1', 'completed'], ['o2-step1', 'o2', 'active'], ['o1-step2', 'o1', 'completed'],
    ])
    expect(run.runtime.messaging.deliveries.filter(row => row.kind === 'order-work').map(row => [row.messageId, row.order.step])).toEqual([
      ['o1-step1', 1], ['o1-step2', 2],
    ])
    const entity = Object.values(run.runtime.messaging.entities).find(row => row.id.endsWith('/queues/order-steps'))
    expect(Object.keys(entity.sessions)).toEqual(['o1'])
    expect(entity.sessions.o1.receiverId).toBe(rows(run)[0].lockHistory[0].receiverId)
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 2 })
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
  })
  it('advanced topic consumers may process independent subscriptions in either order', () => {
    const lab = labAt(1)
    const source = lab.tasks.at(-1).solution.steps[0].content.replace('    consume_subscription("eu-orders")\n    consume_subscription("all-orders")', '    consume_subscription("all-orders")\n    consume_subscription("eu-orders")')
    const run = replayMessagingSolution(lab, { 'worker.py': source })
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 2, o2: 1 })
    expect(rows(run).every(row => row.status === 'completed')).toBe(true)
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
  })
  it.each([
    ['eu-orders', ['delete --name eu', "create --name '$Default' --filter-type SqlFilter --filter-sql-expression \"region = 'EU'\""], '$Default'],
    ['all-orders', ["create --name '$Default' --filter-type SqlFilter --filter-sql-expression \"region = 'EU'\""], '$Default'],
  ])('advanced topic configuration rejects incorrect %s default-rule semantics', (subscription, mutations, name) => {
    const lab = labAt(1), configure = lab.tasks[0]
    let run = createBehavioralRun(lab, { attemptId: `advanced-rule-${subscription}` })
    const execute = line => {
      const result = applyRunAction(run, { type: 'command', line }, lab)
      expect(result.lines.filter(row => row.kind === 'err')).toEqual([])
      run = result.run
    }
    for (const step of configure.solution.steps) execute(step.line)
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    for (const mutation of mutations) execute(`az servicebus topic subscription rule ${mutation} --resource-group rg-messaging --namespace-name sb-orders --topic-name order-work --subscription-name ${subscription}`)
    const actual = run.sandbox.namespaces.find(row => row.name === 'sb-orders').topics.find(row => row.name === 'order-work').subscriptions.find(row => row.name === subscription)
    expect(actual.rules.map(rule => [rule.name, rule.filterType, rule.sqlExpression])).toEqual([[name, 'SqlFilter', "region = 'EU'"]])
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
  })
  it('advanced idempotency rejects work before the processed guard even though the marker is idempotent', () => {
    const lab = labAt(0)
    const source = lab.tasks.at(-1).solution.steps[0].content.replace('            if not was_processed(order["id"]):\n                perform_order_work(order)', '            perform_order_work(order)\n            if not was_processed(order["id"]):')
    const run = replayMessagingSolution(lab, { 'worker.py': source })
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 2 })
    expect(rows(run).every(row => row.status === 'completed')).toBe(true)
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('advanced topics reject consuming all-orders twice and leaving the EU copy active', () => {
    const lab = labAt(1)
    const source = lab.tasks.at(-1).solution.steps[0].content.replace('consume_subscription("eu-orders")', 'consume_subscription("all-orders")')
    const run = replayMessagingSolution(lab, { 'worker.py': source })
    expect(rows(run).filter(row => row.entityId.endsWith('/eu-orders')).map(row => row.status)).toEqual(['active'])
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('advanced sessions reject reordered actual work even with correct final totals and settlements', () => {
    const lab = labAt(2)
    const source = lab.tasks.at(-1).solution.steps[0].content.replace('        for message in receiver.receive_messages(max_message_count=10):', '        batch = receiver.receive_messages(max_message_count=10)\n        for message in [batch[1], batch[0]]:')
    const run = replayMessagingSolution(lab, { 'worker.py': source })
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 2 })
    expect(rows(run).filter(row => row.sessionId === 'o1').every(row => row.status === 'completed')).toBe(true)
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
})
