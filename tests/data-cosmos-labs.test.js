import { describe, expect, it } from 'vitest'
import { replaySolution } from './helpers/dataLab.js'
import { cosmosSdkGuidedLab } from '../src/data/labs/data-journey/cosmos-sdk-guided.lab.js'
import { cosmosVectorGuidedLab } from '../src/data/labs/data-journey/cosmos-vector-guided.lab.js'
import { cosmosTroubleshootingLab } from '../src/data/labs/data-journey/cosmos-troubleshooting.lab.js'
import { labById, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'

describe('data journey Labs (solution replay)', () => {
  it('registers as the first Data journey Lab', () => {
    expect(labById('data-cosmos-sdk-guided')).toBe(cosmosSdkGuidedLab)
    expect(nextLabFor({ journeyId: 'data-knowledge-assistant', journeyOrder: 0 })).toBe(cosmosSdkGuidedLab)
  })

  it('Lab 1 completes every Task from its Solutions', () => {
    const { state } = replaySolution(cosmosSdkGuidedLab)
    expect(state.tasks.filter((t) => t.status !== 'done').map((t) => t.id)).toEqual([])
    expect(state.isComplete).toBe(true)
  })

  it('Lab 2 completes every Task from its Solutions', () => {
    const { state } = replaySolution(cosmosVectorGuidedLab)
    expect(state.tasks.filter((t) => t.status !== 'done').map((t) => t.id)).toEqual([])
    expect(state.isComplete).toBe(true)
  })

  it('Lab 3 completes every Task from its Solutions, and starts with every Task failing', () => {
    // Confirms the seeded incidents are real: a fresh run (no fixes, no
    // scenario runs yet) must not already show these five outcome Tasks done.
    const freshRun = createBehavioralRun(cosmosTroubleshootingLab, { attemptId: 'data-cosmos-troubleshooting-fresh' })
    const freshState = evaluateLab(cosmosTroubleshootingLab, freshRun)
    const outcomeIds = ['session-budget', 'ordered-restored', 'write-cost', 'fresh-read', 'feed-complete']
    expect(freshState.tasks.filter((t) => outcomeIds.includes(t.id) && t.status === 'done').map((t) => t.id)).toEqual([])

    const { state } = replaySolution(cosmosTroubleshootingLab)
    expect(state.tasks.filter((t) => t.status !== 'done').map((t) => t.id)).toEqual([])
    expect(state.isComplete).toBe(true)
  })
})
