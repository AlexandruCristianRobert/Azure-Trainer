import { describe, expect, it } from 'vitest'
import { replaySolution } from './helpers/dataLab.js'
import { cosmosSdkGuidedLab } from '../src/data/labs/data-journey/cosmos-sdk-guided.lab.js'
import { cosmosVectorGuidedLab } from '../src/data/labs/data-journey/cosmos-vector-guided.lab.js'
import { labById, nextLabFor } from '../src/data/labs/index.js'

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
})
