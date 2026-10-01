import { describe, expect, it } from 'vitest'
import { replaySolution } from './helpers/dataLab.js'
import { labById } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'

describe('PostgreSQL data Labs', () => {
  it('Lab 9 independently onboards v3 audiences with SQL-grounded retrieval, indexed metadata and six-replica load', () => {
    // Ignoring audience, returning canned rows, preloading v3 or accepting
    // stale deployed evidence must prevent independent completion.
    const lab = labById('data-postgres-independent')
    expect(lab).toBeDefined()
    const fresh = createBehavioralRun(lab, { attemptId: 'postgres-independent-fresh' })
    expect(evaluateLab(lab, fresh).tasks.filter(task => task.done)).toEqual([])
    expect(Object.keys(fresh.evidence.experimentsById)).toEqual([])
    expect(fresh.sandbox.postgresServers[0].databases[0].tables.find(table => table.name === 'documents').rows.some(row => row.version === 'v3')).toBe(false)
    const loadedSeed = applyRunAction(fresh, { type: 'command', line: 'psql "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge user=assistant_admin" -f load-v3.sql' }, lab)
    expect(loadedSeed.lines.some(line => line.kind === 'err')).toBe(false)
    const ignoredAudience = applyRunAction(loadedSeed.run, { type: 'data-request', scenarioId: 'v3-retrieval' }, lab)
    expect(ignoredAudience.lines[0].measurements.values.map(rows => rows.map(row => row.id))).toEqual([[33, 34], [33, 34], [37, 38], [37, 38]])
    expect(evaluateLab(lab, ignoredAudience.run).tasks.filter(task => task.done)).toEqual([])
    const { run, state } = replaySolution(lab)
    expect(state.tasks.filter(task => !task.done).map(task => task.id)).toEqual([])
    expect(state.isComplete).toBe(true)
    const proof = id => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]].measurements
    const retrieved = proof('v3-retrieval')
    expect(retrieved.values.map(rows => rows.map(row => row.id))).toEqual([[33, 34], [35, 36], [37, 38], [39, 40]])
    for (let stepIndex = 0; stepIndex < 4; stepIndex++) {
      const calls = retrieved.calls.filter(call => call.plan && call.stepIndex === stepIndex)
      expect(calls).toHaveLength(1)
      expect(calls[0].rows).toEqual(retrieved.values[stepIndex])
      expect(calls[0].plan.recall).toBeGreaterThanOrEqual(0.95)
      expect(calls[0].latencyMs).toBeLessThanOrEqual(20)
    }
    const metadata = proof('audience-indexed')
    expect(metadata.values.map(rows => rows.map(row => row.id))).toEqual([[17], [18], [19], [20]])
    expect(metadata.calls.filter(call => call.plan).every(call => !!call.plan.index)).toBe(true)
    expect(proof('scale-stable')).toMatchObject({ status: 200, replicas: 6, failed: 0, throughputRps: 1000, poolMaxSize: 5, mode: 'pgbouncer' })
    expect(proof('scale-stable').calls.filter(call => call.plan)[0].rows.map(row => row.id)).toEqual([33, 34])
    const changed = applyRunAction(run, { type: 'command', line: 'psql "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge user=assistant_admin" -c "DROP INDEX chunks_embedding_hnsw"' }, lab)
    expect(changed.lines.some(line => line.kind === 'err')).toBe(false)
    expect(evaluateLab(lab, changed.run).tasks.find(task => task.id === 'v3-retrieval').done).toBe(false)
    const replaced = applyRunAction(run, { type: 'command', line: 'psql "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge user=assistant_admin" -f load.sql' }, lab)
    expect(replaced.lines.some(line => line.kind === 'err')).toBe(false)
    expect(evaluateLab(lab, replaced.run).tasks.filter(task => task.done)).toEqual([])
  })
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
  it('Lab 7 observes naive exhaustion then completes deployed pooling and port 6432 load through ordered Solutions', () => {
    // Missing current pool/DSN grading, fabricated load success or baseline
    // invalidation after a pool repair must prevent completion.
    const lab = labById('data-postgres-pooling-guided')
    expect(lab).toBeDefined()
    const fresh = createBehavioralRun(lab, { attemptId: 'postgres-pooling-fresh' })
    expect(evaluateLab(lab, fresh).tasks.filter(task => ['naive-load', 'exhaust', 'app-pool', 'pooled-load', 'bouncer-load'].includes(task.id) && task.done)).toEqual([])
    expect(fresh.sandbox.postgresServers[0].skuName).toBe('Standard_D2ds_v5')
    expect(fresh.sandbox.postgresServers[0].parameters.max_connections).toBe('50')
    expect(fresh.runtime.kubernetes.clusters[lab.scenarios['load-600rps-naive'].target.clusterId].resources['Deployment/assistant/assistant-api'].spec.replicas).toBe(2)
    const { run, state } = replaySolution(lab)
    expect(state.tasks.filter(task => !task.done).map(task => task.id)).toEqual([])
    expect(state.isComplete).toBe(true)
    const proof = id => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]].measurements
    expect(proof('naive-load')).toMatchObject({ mode: 'per-request', replicas: 2, failed: 0, p95Ms: 29 })
    expect(proof('exhaust')).toMatchObject({ mode: 'per-request', replicas: 6, status: 503 })
    expect(proof('exhaust').errors).toContain('FATAL: sorry, too many clients already')
    expect(proof('exhaust').failed).toBeGreaterThan(0)
    expect(proof('pooled-load')).toMatchObject({ mode: 'pgbouncer', replicas: 6, poolMaxSize: 5, failed: 0, p95Ms: 5 })
    expect(proof('bouncer-load')).toMatchObject({ mode: 'pgbouncer', replicas: 6, poolMaxSize: 5, failed: 0, peakServerConnections: 20 })
    expect(proof('bouncer-load').calls.filter(call => typeof call.sql === 'string').every(call => call.poolLifetime === 'module' && call.poolMaxSize === 5)).toBe(true)
    expect(proof('bouncer-load').calls.filter(call => call.plan)[0].rows.map(row => row.id)).toEqual([1, 2])
  })
  it('Lab 8 starts with five unsatisfied incidents and repairs each through ordered standalone Solutions', () => {
    // A solved seed, static-code grading, stale app proof or mismatched
    // distance index must prevent troubleshooting completion.
    const lab = labById('data-postgres-troubleshooting')
    expect(lab).toBeDefined()
    const fresh = createBehavioralRun(lab, { attemptId: 'postgres-troubleshooting-fresh' })
    expect(lab.tasks.map(task => task.id)).toEqual(['quote-safe', 'latency-restored', 'index-rebuilt', 'filtered-complete', 'load-stable'])
    expect(evaluateLab(lab, fresh).tasks.filter(task => task.done)).toEqual([])
    expect(Object.keys(fresh.evidence.experimentsById)).toEqual([])
    expect(fresh.sandbox.postgresServers[0]).toMatchObject({ skuName: 'Standard_B1ms', parameters: { maintenance_work_mem: '1024', max_connections: '50' } })
    expect(fresh.sandbox.postgresServers[0].databases[0].indexes.find(index => index.method === 'hnsw').columns[0].opclass).toBe('vector_l2_ops')
    const observe = (run, scenarioId) => applyRunAction(run, { type: lab.scenarios[scenarioId].kind, scenarioId }, lab)
    const measurement = result => result.lines[0].measurements
    const quote = measurement(observe(fresh, 'question-with-quote'))
    expect(quote.status).toBeGreaterThanOrEqual(400)
    expect(quote.error.message.toLowerCase()).toContain('syntax error')
    const latency = measurement(observe(fresh, 'retrieve-latency'))
    expect(latency.calls.filter(call => call.plan)[0].plan.node).toBe('Seq Scan')
    expect(latency.calls.reduce((sum, call) => sum + call.latencyMs, 0)).toBeGreaterThan(100)
    expect(measurement(observe(fresh, 'load-600rps'))).toMatchObject({ status: 503, mode: 'per-request', replicas: 6 })
    // The filtered defect emerges after the distance-index repair; it is
    // latent under the initial exact scan, rather than an artificial failure.
    const applyStep = (run, step) => applyRunAction(run, step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: step.content }
      : step.kind === 'command' ? { type: 'command', line: step.line }
        : { type: lab.scenarios[step.scenarioId].kind, scenarioId: step.scenarioId }, lab).run
    let databaseOnly = fresh
    for (const step of lab.tasks[1].solution.steps.slice(0, 4)) databaseOnly = applyStep(databaseOnly, step)
    databaseOnly = observe(databaseOnly, 'retrieve-latency').run
    expect(evaluateLab(lab, databaseOnly).tasks.find(task => task.id === 'latency-restored').done).toBe(false)
    let staged = fresh
    for (const task of lab.tasks.slice(0, 2)) for (const step of task.solution.steps) staged = applyStep(staged, step)
    expect(measurement(observe(staged, 'retrieve-filtered')).value.length).toBeLessThan(2)
    for (const step of lab.tasks[2].solution.steps.slice(0, 3)) staged = applyStep(staged, step)
    const blockedBuild = applyRunAction(staged, { type: 'command', line: 'psql "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge user=assistant_admin" -c "CREATE INDEX chunks_embedding_hnsw ON chunks USING hnsw (embedding vector_cosine_ops)"' }, lab)
    expect(blockedBuild.lines.some(line => line.kind === 'err' && line.text.includes('could not build HNSW index'))).toBe(true)
    expect(blockedBuild.run.sandbox.postgresServers[0].databases[0].indexes.some(index => index.method === 'hnsw')).toBe(false)
    const { run, state } = replaySolution(lab)
    expect(state.tasks.filter(task => !task.done).map(task => task.id)).toEqual([])
    expect(state.isComplete).toBe(true)
    const proof = id => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]].measurements
    expect(proof('quote-safe')).toMatchObject({ status: 200, value: [] })
    expect(proof('quote-safe').calls.filter(call => call.plan)[0].rows).toEqual([])
    for (const id of ['latency-restored', 'index-rebuilt']) {
      expect(proof(id).value.map(row => row.id)).toEqual([17, 9])
      expect(proof(id).calls.filter(call => call.plan)[0].plan.node).toMatch(/^Index Scan/)
    }
    expect(proof('filtered-complete').value.map(row => row.id)).toEqual([1, 2])
    expect(proof('load-stable')).toMatchObject({ status: 200, mode: 'pgbouncer', replicas: 6, poolMaxSize: 5, failed: 0, p95Ms: 5 })
    expect(proof('load-stable').calls.filter(call => typeof call.sql === 'string').every(call => call.poolLifetime === 'module' && call.poolMaxSize === 5)).toBe(true)
  })
})
