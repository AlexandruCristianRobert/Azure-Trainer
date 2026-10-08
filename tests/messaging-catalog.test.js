import { describe, it, expect } from 'vitest'
import { LABS, labById, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'

const journey = () => LABS.filter(lab => lab.journeyId === 'messaging-orders')
const ids = [
  'messaging-send', 'messaging-receive', 'messaging-deadletter',
  'messaging-idempotency', 'messaging-topics', 'messaging-sessions',
  'messaging-publish-events', 'messaging-event-filters', 'messaging-event-recovery',
  'messaging-functions-servicebus', 'messaging-functions-eventgrid', 'messaging-orders-capstone',
]

describe('published messaging journey', () => {
  // Catches an incomplete aggregate registration or removal of legacy entry points.
  it('publishes twelve ordered coding-first Labs without removing legacy Labs', () => {
    const labs = journey()
    expect(labs.map(lab => lab.journeyOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(labs.map(lab => lab.id)).toEqual(ids)
    expect(labs.filter(lab => lab.labMode === 'capstone')).toHaveLength(1)
    expect(labs.every(lab => lab.skillAreaId === 'connect')).toBe(true)
    expect(LABS.some(lab => lab.id === 'eventgrid-filtered-subscription')).toBe(true)
    expect(LABS.some(lab => lab.id === 'servicebus-order-backend')).toBe(true)
    expect(new Set(LABS.map(lab => lab.id)).size).toBe(LABS.length)
  })

  it('resolves each published Lab and advances only through its ordered journey', () => {
    for (let index = 0; index < ids.length; index++) {
      const lab = labById(ids[index])
      expect(lab?.id).toBe(ids[index])
      expect(nextLabFor(lab)?.id ?? null).toBe(ids[index + 1] ?? null)
    }
  })

  it('starts independent coding Labs with unfinished Tasks and no execution proof', () => {
    expect(journey()).toHaveLength(12)
    for (const lab of journey()) {
      expect(lab.engineVersion).toBe(2)
      expect(lab.contentVersion).toBe(['messaging-deadletter', 'messaging-topics', 'messaging-sessions', 'messaging-event-filters', 'messaging-functions-servicebus', 'messaging-orders-capstone'].includes(lab.id) ? 2 : 1)
      expect(lab.capabilities.messaging).toBe(true)
      if (lab.journeyOrder >= 10) expect(lab.capabilities.messagingFunctions).toBe(true)
      expect(['guided', 'capstone']).toContain(lab.labMode)
      if (lab.id === 'messaging-deadletter') {
        expect(lab.messagingExercise.commands).toEqual([
          { entry: 'worker.py', mode: 'script' }, { entry: 'producer.py', mode: 'script' },
        ])
      } else if (['messaging-topics', 'messaging-sessions'].includes(lab.id)) {
        expect(lab.messagingExercise.commands).toEqual([
          { entry: 'producer.py', mode: 'script' }, { entry: 'worker.py', mode: 'script' },
        ])
      } else if (lab.id === 'messaging-event-filters') {
        expect(lab.messagingExercise.commands).toEqual([
          { entry: 'events.py', mode: 'script' }, { entry: 'handler.py', mode: 'script' },
        ])
      } else expect(lab.messagingExercise.commands).toHaveLength(1)
      for (const task of lab.tasks) {
        for (const field of ['concept', 'what', 'why', 'without']) expect(task.rationale[field].length).toBeGreaterThan(0)
        expect(task.solution.steps.length).toBeGreaterThan(0)
        expect(task.solution.steps.every(step => ['file', 'command'].includes(step.kind))).toBe(true)
      }
      const run = createBehavioralRun(lab, { attemptId: `catalog-${lab.id}` })
      expect(evaluateLab(lab, run).tasks.every(task => !task.done)).toBe(true)
      expect(run.runtime.messaging.executionReceipts).toEqual([])
      expect(run.evidence.experimentsById).toEqual({})
    }
  })
})
