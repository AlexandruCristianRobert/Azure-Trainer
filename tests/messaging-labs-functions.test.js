import { describe, it, expect } from 'vitest'
import * as journey from '../src/data/labs/messaging-journey/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'

function replay(lab, source) {
  let run = createBehavioralRun(lab, { attemptId: `functions-${lab.id}` })
  for (const task of lab.tasks) for (const step of task.solution.steps) {
    const result = applyRunAction(run, step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: step.path === 'function_app.py' && source ? source : step.content }
      : { type: 'command', line: step.line }, lab)
    expect(result.diagnostics ?? []).toEqual([])
    expect(result.lines?.filter(row => row.kind === 'err') ?? []).toEqual([])
    run = result.run
  }
  return run
}

describe('Functions curriculum', () => {
  const labs = journey.FUNCTIONS_LABS ?? []
  const at = index => { expect(labs).toHaveLength(2); return labs[index] }
  it.each([
    ['host.json', source => source.replace('"2.0"', '"1.0"')],
    ['local.settings.json', source => source.replace('sb-orders.servicebus.windows.net', 'wrong.servicebus.windows.net')],
    ['local.settings.json', source => source.replace('"python"', '"dotnet"')],
    ['local.settings.json', source => source.replace('UseDevelopmentStorage=true', 'invalid-storage')],
  ])('invalid saved %s does not unlock the Function handler', (path, mutate) => {
    const lab = at(0)
    let run = createBehavioralRun(lab, { attemptId: 'invalid-host-settings' })
    for (const step of lab.tasks[0].solution.steps) run = applyRunAction(run, { type: 'command', line: step.line }, lab).run
    for (const step of lab.tasks[1].solution.steps) run = applyRunAction(run, { type: 'save-file', path: step.path, text: step.path === path ? mutate(step.content) : step.content }, lab).run
    expect(evaluateLab(lab, run).tasks.map(task => task.done)).toEqual([true, false, false])
    expect(run.runtime.messaging.executionReceipts).toEqual([])
  })
  it('independent baselines leave every new task and proof unfinished', () => {
    expect(labs.map(lab => [lab.id, lab.journeyOrder])).toEqual([
      ['messaging-functions-servicebus', 10], ['messaging-functions-eventgrid', 11],
    ])
    for (const lab of labs) {
      const run = createBehavioralRun(lab, { attemptId: `initial-${lab.id}` })
      expect(evaluateLab(lab, run).tasks.every(task => !task.done)).toBe(true)
      expect(run.runtime.messaging.effects).toEqual({})
      expect(run.runtime.messaging.executionReceipts).toEqual([])
      expect(run.runtime.messaging.hosts).toEqual({})
      expect(run.evidence.experimentsById).toEqual({})
      expect(run.runtime.messaging.eventGrid?.events ?? []).toEqual([])
    }
  })
  // Missing body provenance/work or premature host completion must fail.
  it('Service Bus Function works on the actual received body before host completion', () => {
    const lab = at(0), run = replay(lab)
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1 })
    const traces = run.runtime.messaging.executionReceipts.at(-1).measurements.trace
    expect(traces.filter(row => ['receive', 'order-work', 'order-record', 'complete'].includes(row.kind)).map(row => row.kind)).toEqual(['receive', 'order-work', 'order-record', 'complete'])
    expect(traces.find(row => row.kind === 'order-work')).toMatchObject({ order: { id: 'o1', region: 'EU', quantity: 2 }, changed: true })
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
  })
  // Removing the real callback notification must leave task11 pending.
  it('new Event Grid Function receives the completed-order fact and emits a same-attempt notification receipt', () => {
    const lab = at(1), run = replay(lab)
    expect(run.runtime.messaging.effects.notifications).toEqual({ 'e-o1': { eventId: 'e-o1', orderId: 'o1' } })
    const measurement = run.runtime.messaging.executionReceipts.at(-1).measurements
    const row = measurement.receipts.eventgrid[0]
    expect(row).toMatchObject({ endpointType: 'AzureFunction', status: 'delivered', attempts: 1, event: { id: 'e-o1', data: { order_id: 'o1', region: 'EU', quantity: 2 } } })
    const notification = measurement.trace.find(trace => trace.kind === 'notification')
    expect(notification).toMatchObject({ deliveryId: row.id, eventRecordId: row.eventRecordId, attempts: 1, changed: true, eventId: 'e-o1', orderId: 'o1' })
    expect(measurement.trace.findIndex(trace => trace.kind === 'delivered')).toBeGreaterThan(measurement.trace.indexOf(notification))
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
  })
  it('a reconstructed order cannot prove receipt-bound work despite correct totals', () => {
    const lab = at(0), source = lab.tasks.at(-1).solution.steps.find(step => step.path === 'function_app.py').content
    const run = replay(lab, source.replace('json.loads(msg.get_body().decode("utf-8"))', '{"id": "o1", "region": "EU", "quantity": 2}'))
    expect(run.runtime.messaging.effects.workByOrder.o1).toBe(1)
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('a no-op Event Grid Function cannot prove notification just by successful delivery', () => {
    const lab = at(1), source = lab.tasks.at(-1).solution.steps.find(step => step.path === 'function_app.py').content
    const run = replay(lab, source.replace('record_notification(event.id, data["order_id"])', 'return None'))
    expect(run.runtime.messaging.eventGrid.deliveries[0].status).toBe('delivered')
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('a completion event published before receipt-bound work cannot prove the completed-business fact', () => {
    const lab = at(1), source = lab.tasks.at(-1).solution.steps.find(step => step.path === 'function_app.py').content
    const work = '        perform_order_work(order)\n        record_processed(order)\n'
    const premature = source.replace(work, '').replace('        publisher.send([event])\n', '        publisher.send([event])\n' + work)
    expect(premature).not.toBe(source)
    const run = replay(lab, premature)
    const measurement = run.runtime.messaging.executionReceipts.at(-1).measurements
    const physical = measurement.receipts.servicebus.find(row => row.messageId === 'm1')
    const delivery = measurement.receipts.eventgrid[0]
    const publicationAt = measurement.trace.findIndex(row => row.kind === 'publish' && row.eventRecordId === delivery.eventRecordId)
    const markerAt = measurement.trace.findIndex(row => row.kind === 'order-record' && row.messageRecordId === physical.id)
    expect(publicationAt).toBeGreaterThan(-1)
    expect(publicationAt).toBeLessThan(markerAt)
    expect(physical.status).toBe('completed')
    expect(delivery.status).toBe('delivered')
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1 })
    expect(run.runtime.messaging.effects.notifications).toEqual({ 'e-o1': { eventId: 'e-o1', orderId: 'o1' } })
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('host settings and actual app configuration are fresh dependencies; README is harmless', () => {
    const lab = at(1)
    let run = replay(lab)
    run = applyRunAction(run, { type: 'save-file', path: 'README.md', text: 'My notes' }, lab).run
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    const original = run.project.savedFiles['local.settings.json']
    run = applyRunAction(run, { type: 'save-file', path: 'local.settings.json', text: original + '\n' }, lab).run
    run = applyRunAction(run, { type: 'save-file', path: 'local.settings.json', text: original }, lab).run
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
    run = replay(lab)
    run = applyRunAction(run, { type: 'command', line: 'az functionapp config appsettings set --resource-group rg-messaging --name func-orders --settings ServiceBusConnection__fullyQualifiedNamespace=wrong.servicebus.windows.net' }, lab).run
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
})
