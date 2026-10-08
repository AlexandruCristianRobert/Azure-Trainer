import { describe, it, expect } from 'vitest'
import * as journey from '../src/data/labs/messaging-journey/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'

function replayMessagingSolution(lab, suppressPublish = false) {
  let run = createBehavioralRun(lab, { attemptId: 'capstone-test' })
  for (const task of lab.tasks) for (const step of task.solution.steps) {
    const result = applyRunAction(run, step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: suppressPublish ? step.content.replace('publisher.send([event])', '# missing actual publication') : step.content }
      : { type: 'command', line: step.line }, lab)
    if (step.kind === 'command' && step.line === 'func start') {
      expect(result.diagnostics).toHaveLength(3)
      const invalid = Object.values(result.run.runtime.messaging.entities).flatMap(entity => entity.messages).find(row => row.messageId === 'bad')
      for (const diagnostic of result.diagnostics) {
        expect(diagnostic).toMatchObject({ code: 'MESSAGING_RUNTIME', errorType: 'ValueError', handlerFailure: { kind: 'servicebus', messageId: 'bad', messageRecordId: invalid.id, entityId: invalid.entityId } })
        expect(invalid.lockHistory.some(lock => lock.lockToken === diagnostic.handlerFailure.lockToken && lock.receiverId === diagnostic.handlerFailure.receiverId && lock.settlement === 'abandon')).toBe(true)
      }
    } else {
      expect(result.diagnostics ?? []).toEqual([])
      expect(result.lines?.filter(row => row.kind === 'err') ?? []).toEqual([])
    }
    run = result.run
  }
  return run
}

describe('messaging combined capstone', () => {
  const lab = () => { expect(journey.messagingCapstoneLab).toBeDefined(); return journey.messagingCapstoneLab }
  // Missing work, guard, publish, callback or invalid isolation breaks this proof.
  it('capstone starts unfinished and connects actual processing to notification', () => {
    const definition = lab(), initial = createBehavioralRun(definition, { attemptId: 'initial-capstone' })
    expect(evaluateLab(definition, initial).tasks.every(task => !task.done)).toBe(true)
    expect(initial.runtime.messaging.executionReceipts).toEqual([])
    expect(initial.runtime.messaging.hosts).toEqual({})
    expect(initial.runtime.messaging.effects).toEqual({})
    expect(initial.evidence.experimentsById).toEqual({})
    const run = replayMessagingSolution(definition)
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1, o3: 1 })
    expect(run.runtime.messaging.effects.notifications).toEqual({ 'e-o1': { eventId: 'e-o1', orderId: 'o1' }, 'e-o3': { eventId: 'e-o3', orderId: 'o3' } })
    expect(run.runtime.messaging.eventGrid.events.map(row => row.event)).toEqual([
      { id: 'e-o1', subject: '/orders/EU/o1', eventType: 'Contoso.OrderProcessed', dataVersion: '1.0', data: { order_id: 'o1', region: 'EU', quantity: 2 } },
      { id: 'e-o3', subject: '/orders/EU/o3', eventType: 'Contoso.OrderProcessed', dataVersion: '1.0', data: { order_id: 'o3', region: 'EU', quantity: 1 } },
    ])
    const rows = Object.values(run.runtime.messaging.entities).flatMap(entity => entity.messages)
    expect(rows.filter(row => row.messageId !== 'bad').map(row => row.status)).toEqual(['completed', 'completed', 'completed'])
    expect(rows.find(row => row.messageId === 'bad')).toMatchObject({ status: 'deadletter', deliveryCount: 4, deadLetterReason: 'MaxDeliveryCountExceeded' })
    expect(rows.find(row => row.messageId === 'bad').lockHistory.map(lock => lock.settlement)).toEqual(['abandon', 'abandon', 'abandon'])
    expect(evaluateLab(definition, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(definition, deserializeRun(serializeRun(run, definition), definition)).tasks.every(task => task.done)).toBe(true)
  })
  it('missing actual event publication leaves notification and end-to-end proof pending', () => {
    const definition = lab(), run = replayMessagingSolution(definition, true)
    expect(run.runtime.messaging.effects.workByOrder).toEqual({ o1: 1, o3: 1 })
    expect(run.runtime.messaging.eventGrid.events).toEqual([])
    expect(run.runtime.messaging.effects.notifications ?? {}).toEqual({})
    expect(evaluateLab(definition, run).tasks.at(-1).done).toBe(false)
    expect(evaluateLab(definition, run).isComplete).toBe(false)
  })
})
