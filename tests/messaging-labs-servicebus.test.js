import { describe, it, expect } from 'vitest'
import { SERVICEBUS_FOUNDATION_LABS } from '../src/data/labs/messaging-journey/index.js'
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
  it('appends the independent simulated labs to the catalog in journey order', () => {
    expect(SERVICEBUS_FOUNDATION_LABS.map(lab => lab.id)).toEqual(['messaging-send', 'messaging-receive', 'messaging-deadletter'])
    expect(LABS.slice(-3).map(lab => lab.id)).toEqual(['messaging-send', 'messaging-receive', 'messaging-deadletter'])
  })
})
