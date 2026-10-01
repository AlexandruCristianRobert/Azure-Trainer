import { describe, expect, it } from 'vitest'
import { replaySolution } from './helpers/dataLab.js'
import { labById } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'

describe('PostgreSQL data Labs', () => {
  it('Lab 5 starts without index proofs and completes every Task through its ordered Solutions', () => {
    // Missing registration, a pre-solved seed, or stale/wrong query evidence
    // must prevent a learner from completing this guided Lab.
    const lab = labById('data-postgres-connect-guided')
    expect(lab).toBeDefined()
    const fresh = createBehavioralRun(lab, { attemptId: 'postgres-connect-fresh' })
    const initial = evaluateLab(lab, fresh)
    expect(initial.tasks.filter(task => ['btree', 'gin'].includes(task.id) && task.done).map(task => task.id)).toEqual([])
    expect(fresh.sandbox.postgresServers).toEqual([])
    expect(Object.keys(fresh.artifacts.buildsById)).toEqual([])
    const { run, state } = replaySolution(lab)
    expect(state.tasks.filter(task => !task.done).map(task => task.id)).toEqual([])
    expect(state.isComplete).toBe(true)
    const proof = id => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]].measurements
    expect(proof('btree').value.map(row => row.id)).toEqual([5, 6, 7, 8])
    expect(proof('gin').value.map(row => row.id)).toEqual([1, 2])
  })
})
