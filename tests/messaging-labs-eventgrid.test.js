import { describe, it, expect } from 'vitest'
import * as journey from '../src/data/labs/messaging-journey/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'

// Breaks caught: missing publication payload, wrong filtered route, absent
// callback work and recovery that never reaches its actual terminal destination.
function replayMessagingSolution(lab, files = {}, commands = {}) {
  let run = createBehavioralRun(lab, { attemptId: `eventgrid-${lab.id}` })
  for (const task of lab.tasks) for (const step of task.solution.steps) {
    const action = step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: files[step.path] ?? step.content }
      : { type: 'command', line: commands[step.line] ?? step.line }
    const result = applyRunAction(run, action, lab)
    expect(result.diagnostics ?? []).toEqual([])
    expect(result.lines?.filter(row => row.kind === 'err') ?? []).toEqual([])
    run = result.run
  }
  return run
}

describe('Event Grid curriculum', () => {
  const labs = journey.EVENTGRID_LABS ?? []
  const labAt = index => { expect(labs).toHaveLength(3); return labs[index] }
  it('independent baselines leave all new Tasks and execution proof pending', () => {
    expect(labs.map(lab => [lab.id, lab.journeyOrder])).toEqual([
      ['messaging-publish-events', 7], ['messaging-event-filters', 8], ['messaging-event-recovery', 9],
    ])
    for (const lab of labs) {
      const run = createBehavioralRun(lab, { attemptId: `start-${lab.id}` })
      expect(evaluateLab(lab, run).tasks.every(task => !task.done)).toBe(true)
      expect(run.runtime.messaging.executionReceipts).toEqual([])
      expect(run.runtime.messaging.effects).toEqual({})
      expect(run.evidence.experimentsById).toEqual({})
      expect(run.sandbox.eventGridTopics).toEqual([])
    }
  })
  it('publishes the actual completed-order application fact without a subscriber', () => {
    const lab = labAt(0), run = replayMessagingSolution(lab)
    expect(run.runtime.messaging.eventGrid.events.map(row => row.event)).toEqual([
      { id: 'e-eu', subject: '/orders/eu/o1', eventType: 'Contoso.OrderProcessed', data: { order_id: 'o1', region: 'EU', quantity: 2 }, dataVersion: '1.0' },
    ])
    expect(run.runtime.messaging.eventGrid.deliveries).toEqual([])
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
  })
  it('custom events reach only the intended handler', () => {
    const lab = labAt(1), run = replayMessagingSolution(lab)
    expect(Object.keys(run.runtime.messaging.effects.notifications)).toEqual(['e-eu'])
    expect(run.runtime.messaging.eventGrid.events.map(row => row.event.id)).toEqual(['e-eu', 'e-us', 'e-other'])
    expect(run.runtime.messaging.eventGrid.deliveries.map(row => [row.event.id, row.status, row.attempts])).toEqual([['e-eu', 'delivered', 1]])
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
  })
  it('the same exact event facts may be published in another order', () => {
    const lab = labAt(1)
    const original = lab.tasks[2].solution.steps[0].content
    const run = replayMessagingSolution(lab, { 'events.py': original.replace('publisher.send([e_eu, e_us, e_other])', 'publisher.send([e_other, e_us, e_eu])') })
    expect(run.runtime.messaging.eventGrid.events.map(row => row.event.id)).toEqual(['e-other', 'e-us', 'e-eu'])
    expect(run.runtime.messaging.eventGrid.deliveries.map(row => [row.event.id, row.status])).toEqual([['e-eu', 'delivered']])
    expect(run.runtime.messaging.effects.notifications).toEqual({ 'e-eu': { eventId: 'e-eu', orderId: 'o1' } })
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
  })
  it.each(['e_eu, e_us', 'e_eu, e_us, e_us', 'e_eu, e_us, e_other, e_other'])('exact fact matching rejects missing duplicate or extra publication: %s', batch => {
    const lab = labAt(1), original = lab.tasks[2].solution.steps[0].content
    const run = replayMessagingSolution(lab, { 'events.py': original.replace('publisher.send([e_eu, e_us, e_other])', `publisher.send([${batch}])`) })
    expect(run.runtime.messaging.eventGrid.deliveries.map(row => row.event.id)).toEqual(['e-eu'])
    expect(evaluateLab(lab, run).tasks.slice(-2).map(task => task.done)).toEqual([false, false])
  })
  it('logical retries recover one actual event and deadletter another to the prepared container', () => {
    const lab = labAt(2), run = replayMessagingSolution(lab)
    const rows = run.runtime.messaging.eventGrid.deliveries
    expect(rows.map(row => [row.event.id, row.status, row.attempts])).toEqual([['e-eu', 'delivered', 2], ['e-terminal', 'deadlettered', 3]])
    expect(run.runtime.messaging.effects.notifications).toEqual({ 'e-eu': { eventId: 'e-eu', orderId: 'o1' } })
    expect(rows[1].deadLetter).toMatchObject({ event: rows[1].event, attempts: 3, reason: 'MaxDeliveryAttemptsExceeded' })
    expect(rows[1].deadLetter.destination.toLowerCase()).toContain('/stmessagingorders/blobservices/default/containers/event-deadletters')
    expect(run.runtime.messaging.timeMs).toBe(2000)
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
  })
  it('a wrong subject filter cannot pass even with successful delivery and extra notifications', () => {
    const lab = labAt(1)
    const original = lab.tasks[1].solution.steps[0].line
    const run = replayMessagingSolution(lab, {}, { [original]: original.replace('/orders/eu/', '/orders/') })
    expect(Object.keys(run.runtime.messaging.effects.notifications)).toEqual(['e-eu', 'e-us'])
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('saved relevant source changes and reverts stale proof while unrelated README edits preserve it', () => {
    expect(labs).toHaveLength(3)
    for (const lab of labs) {
      let run = replayMessagingSolution(lab)
      run = applyRunAction(run, { type: 'save-file', path: 'README.md', text: 'My unrelated notes' }, lab).run
      expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
      const path = lab.journeyOrder === 7 ? 'events.py' : 'handler.py', original = run.project.savedFiles[path]
      run = applyRunAction(run, { type: 'save-file', path, text: original + '\n# edited\n' }, lab).run
      expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
      run = applyRunAction(run, { type: 'save-file', path, text: original }, lab).run
      expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
    }
  })
  it('callback proof rejects a marker written by main after acknowledging a no-op callback', () => {
    const lab = labAt(1)
    const run = replayMessagingSolution(lab, { 'handler.py': `from events import publish_events
from training_runtime import record_notification, deliver_events
def handle_event(event):
    return 200
def main():
    publish_events()
    deliver_events(handle_event)
    record_notification("e-eu", "o1")
` })
    expect(run.runtime.messaging.effects.notifications).toEqual({ 'e-eu': { eventId: 'e-eu', orderId: 'o1' } })
    expect(run.runtime.messaging.eventGrid.deliveries[0].status).toBe('delivered')
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('actual subscription configuration changes and reverts stale source-dependent proof', () => {
    const lab = labAt(1)
    let run = replayMessagingSolution(lab)
    const prefix = 'az eventgrid topic event-subscription update --resource-group rg-messaging --topic-name evgt-orders --name order-notifications --subject-begins-with '
    run = applyRunAction(run, { type: 'command', line: prefix + '/orders/' }, lab).run
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
    run = applyRunAction(run, { type: 'command', line: prefix + '/orders/eu/' }, lab).run
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
})
