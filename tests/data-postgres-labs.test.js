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
  it('Lab 6 starts without HNSW proofs and completes sizing, ANN filtering and grounded answers through ordered Solutions', () => {
    // Missing joins, wrong vector opclass, starter seeding or stale deployed
    // retrieval/context evidence must prevent completion.
    const lab = labById('data-postgres-vector-guided')
    expect(lab).toBeDefined()
    const fresh = createBehavioralRun(lab, { attemptId: 'postgres-vector-fresh' })
    const initial = evaluateLab(lab, fresh)
    expect(initial.tasks.filter(task => ['hnsw', 'tuned', 'filtered', 'answer'].includes(task.id) && task.done).map(task => task.id)).toEqual([])
    expect(fresh.sandbox.postgresServers[0].tier).toBe('Burstable')
    expect(fresh.sandbox.postgresServers[0].parameters.maintenance_work_mem).toBe('1024')
    const { run, state } = replaySolution(lab)
    expect(state.tasks.filter(task => !task.done).map(task => task.id)).toEqual([])
    expect(state.isComplete).toBe(true)
    const proof = id => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]].measurements
    expect(proof('exact-knn').value.map(row => row.id)).toEqual([17, 9])
    expect(proof('tuned').value.map(row => row.id)).toEqual([17, 9])
    expect(proof('filtered').value.map(row => row.id)).toEqual([1, 2])
    expect(proof('answer').values[0]).toEqual({ answer: 'Contoso Backup v1 snapshots are retained for 35 days by default.', sources: [1, 2] })
    expect(proof('answer').values[1]).toEqual({ answer: "I couldn't find that in the documentation.", sources: [] })
  })
})
