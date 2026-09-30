import { describe, expect, it } from 'vitest'
import { LabEngineError } from '../src/lib/labEngine/errors.js'
import { createBehavioralRun, validateBehavioralRun, bumpDependency } from '../src/lib/labEngine/run.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { canonicalize, recordVerification } from '../src/lib/labEngine/evidence.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { behavioralLab } from './helpers/behavioralLab.js'

function completed(result = {}) {
  return {
    scenarioId: 'healthy-request',
    scenarioVersion: 1,
    completed: true,
    outcome: 'passed',
    startedAtMs: 0,
    endedAtMs: 1000,
    measurements: { status: 200 },
    ...result,
  }
}

function expectCode(callback, code) {
  expect(callback).toThrowError(LabEngineError)
  try { callback() } catch (error) { expect(error.code).toBe(code) }
}

describe('behavioral run contracts', () => {
  it('binds selector snapshots and reevaluation to their owning Task while retaining legacy selectors', () => {
    const lab = behavioralLab(), task = lab.tasks.find(item => item.id === 'request')
    task.dependencies = { owner: (_context, owner) => owner?.id ?? 'missing-owner', legacy: context => context.project.savedFiles['src/app.txt'] }
    const run = recordVerification(createBehavioralRun(lab, { attemptId: 'owner-boundary' }), lab, 'request', completed())
    const record = run.evidence.experimentsById[run.evidence.currentEvidenceByTask.request]
    expect(record.dependencyValues).toEqual({ owner: 'request', legacy: 'healthy' })
    expect(evaluateLab(lab, run).tasks.find(item => item.id === 'request').done).toBe(true)
    task.dependencies.owner = (_context, owner) => owner?.id === 'request' ? 'changed-owner-proof' : 'request'
    expect(evaluateLab(lab, run).tasks.find(item => item.id === 'request').done).toBe(false)
  })

  it('isolates trusted simulation initialization from learner evidence and rejects extra fields', () => {
    const lab = behavioralLab()
    lab.initializeSimulation = (fresh) => {
      fresh.evidence.currentEvidenceByTask.request = 'forged'
      fresh.history.push('forged command')
      fresh.hintsRevealed.request = 1
      return { sandbox: fresh.sandbox, artifacts: fresh.artifacts, runtime: fresh.runtime, nextSequence: fresh.nextSequence }
    }
    const run = createBehavioralRun(lab, { attemptId: 'seed-boundary' })
    expect(run.evidence.currentEvidenceByTask).toEqual({})
    expect(run.history).toEqual([])
    expect(run.hintsRevealed).toEqual({})
    lab.initializeSimulation = (fresh) => ({ sandbox: fresh.sandbox, artifacts: fresh.artifacts,
      runtime: fresh.runtime, nextSequence: fresh.nextSequence, evidence: fresh.evidence })
    expectCode(() => createBehavioralRun(lab, { attemptId: 'extra-field' }), 'INVALID_LAB')
    lab.initializeSimulation = (fresh) => ({ sandbox: fresh.sandbox, artifacts: fresh.artifacts,
      runtime: fresh.runtime, nextSequence: 0 })
    expectCode(() => createBehavioralRun(lab, { attemptId: 'bad-counter' }), 'INVALID_RUN')
    lab.initializeSimulation = true
    expectCode(() => createBehavioralRun(lab, { attemptId: 'bad-hook' }), 'INVALID_LAB')
  })

  it('creates isolated version-2 runs with a normalized seeded sandbox and complete empty containers', () => {
    const lab = behavioralLab()
    const first = createBehavioralRun(lab, { attemptId: 'attempt-1' })
    const second = createBehavioralRun(lab, { attemptId: 'attempt-2' })

    expect(first).toMatchObject({
      schemaVersion: 2, labId: 'behavioral-lab', contentVersion: 1, attemptId: 'attempt-1', revision: 0, nextSequence: 1,
      sandbox: { resourceGroups: [{ name: 'seeded-rg', location: 'westeurope' }], containerApps: [] },
      project: { savedFiles: { 'src/app.txt': 'healthy' }, draftFiles: { 'src/app.txt': 'healthy' }, fileVersions: {}, diagnostics: [] },
      artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} },
      runtime: { simTimeMs: 0, deploymentsByApp: {}, replicasByApp: {}, activeScenario: null, scheduledEvents: [] },
      evidence: { experimentsById: {}, currentEvidenceByTask: {}, milestoneRecords: [] },
      stages: { activeStageId: null, sealedStages: [], cleanupCheckpoint: null },
      dependencyGenerations: {}, scrollback: [], history: [], hintsRevealed: {}, solutionsRevealed: {}, elapsedMs: 0, completedAt: null, resultId: null,
    })
    first.sandbox.resourceGroups.push({ name: 'changed' })
    first.project.savedFiles['src/app.txt'] = 'changed'
    expect(second.sandbox.resourceGroups).toEqual([{ name: 'seeded-rg', location: 'westeurope' }])
    expect(second.project.savedFiles).toEqual({ 'src/app.txt': 'healthy' })
    expectCode(() => createBehavioralRun(lab, { attemptId: '' }), 'INVALID_RUN')
  })

  it('canonicalizes JSON by sorted object keys while retaining array order', () => {
    expect(canonicalize({ b: [2, { z: true, a: null }], a: 1 })).toBe('{"a":1,"b":[2,{"a":null,"z":true}]}')
    expect(canonicalize([2, 1])).toBe('[2,1]')
    expect(canonicalize([null, [1, { b: 2, a: 3 }]])).toBe('[null,[1,{"a":3,"b":2}]]')
  })

  it('rejects sparse arrays and array data that JSON serialization would discard', () => {
    const withExtra = [1]
    withExtra.extra = 2
    const customPrototype = [1]
    Object.setPrototypeOf(customPrototype, Object.create(Array.prototype))
    for (const value of [Array(2), withExtra, customPrototype]) {
      expectCode(() => canonicalize(value), 'INVALID_EVIDENCE')
    }
  })

  it('rejects unsupported original dependency selector values without changing the run or selector value', () => {
    for (const value of [{ number: Number.NaN }, { number: Infinity }, new Date('2026-09-22T00:00:00Z'), { callback: () => true }, Array(1)]) {
      const lab = behavioralLab()
      lab.tasks[0].dependencies = { application: () => value }
      const run = createBehavioralRun(lab, { attemptId: 'attempt-1' })
      const before = structuredClone(run)
      expectCode(() => recordVerification(run, lab, 'request', completed()), 'INVALID_EVIDENCE')
      expect(run).toEqual(before)
      if (value instanceof Date) expect(value.toISOString()).toBe('2026-09-22T00:00:00.000Z')
      if ('number' in Object(value)) expect(Number.isNaN(value.number) || value.number === Infinity).toBe(true)
    }
  })

  it('records immutable live evidence and invalidates only its declared dependency generation', () => {
    const lab = behavioralLab()
    let run = createBehavioralRun(lab, { attemptId: 'attempt-1' })
    const original = run
    expect(evaluateLab(lab, run).isComplete).toBe(false)

    run = recordVerification(run, lab, 'request', completed())
    expect(run).not.toBe(original)
    expect(run.evidence.experimentsById['evidence-1']).toMatchObject({
      id: 'evidence-1', sequence: 1, labId: 'behavioral-lab', attemptId: 'attempt-1', contentVersion: 1,
      taskId: 'request', scenarioId: 'healthy-request', scenarioVersion: 1,
      dependencyValues: { application: { source: 'healthy', route: '/health' } }, dependencyGenerations: { application: 0 },
    })
    expect(original.evidence.experimentsById).toEqual({})
    expect(evaluateLab(lab, run).tasks[0].status).toBe('done')

    const changed = bumpDependency(run, 'application')
    expect(changed.sandbox).toBe(run.sandbox)
    expect(changed.dependencyGenerations).toEqual({ application: 1 })
    expect(evaluateLab(lab, changed).tasks[0].status).toBe('needs-verification')
    expect(evaluateLab(lab, run).tasks[0].status).toBe('done')
    expect(evaluateLab(lab, bumpDependency(run, 'unrelated')).tasks[0].status).toBe('done')
  })

  it('treats property-order-equivalent dependencies as current but generation changes away and back as stale', () => {
    const lab = behavioralLab()
    let run = recordVerification(createBehavioralRun(lab, { attemptId: 'attempt-1' }), lab, 'request', completed())
    run = { ...run, project: { ...run.project, savedFiles: { 'src/app.txt': 'healthy' } } }
    expect(evaluateLab(lab, run).tasks[0].status).toBe('done')
    const stale = bumpDependency(bumpDependency(run, 'application'), 'application')
    expect(evaluateLab(lab, stale).tasks[0].status).toBe('needs-verification')
  })

  it('does not let failed, cancelled, incomplete, or wrong-identity verification award credit', () => {
    const lab = behavioralLab()
    for (const result of [
      completed({ outcome: 'failed' }),
      completed({ completed: false, outcome: 'cancelled' }),
      completed({ completed: false, outcome: 'failed' }),
    ]) {
      const run = recordVerification(createBehavioralRun(lab, { attemptId: 'attempt-1' }), lab, 'request', result)
      expect(evaluateLab(lab, run).tasks[0].status).toBe('pending')
    }
    const run = createBehavioralRun(lab, { attemptId: 'attempt-1' })
    expectCode(() => recordVerification(run, lab, 'request', completed({ scenarioId: 'wrong' })), 'INVALID_EVIDENCE')
    expectCode(() => recordVerification(run, lab, 'request', completed({ scenarioVersion: 2 })), 'INVALID_EVIDENCE')
  })

  it('uses the latest verification result so a later failure cannot be hidden by an earlier pass', () => {
    const lab = behavioralLab()
    let run = recordVerification(createBehavioralRun(lab, { attemptId: 'attempt-1' }), lab, 'request', completed())
    run = recordVerification(run, lab, 'request', completed({ outcome: 'failed', endedAtMs: 2000 }))
    expect(evaluateLab(lab, run).tasks[0]).toMatchObject({ status: 'needs-verification', done: false, evidenceIds: ['evidence-1', 'evidence-2'] })
  })

  it('keeps never-passed failed, cancelled, and incomplete verification histories pending', () => {
    const lab = behavioralLab()
    for (const result of [
      completed({ outcome: 'failed' }),
      completed({ completed: false, outcome: 'cancelled' }),
      completed({ completed: false, outcome: 'failed' }),
    ]) {
      const run = recordVerification(createBehavioralRun(lab, { attemptId: 'attempt-1' }), lab, 'request', result)
      expect(evaluateLab(lab, run).tasks[0].status).toBe('pending')
    }
    const malformedPass = createBehavioralRun(lab, { attemptId: 'attempt-1' })
    malformedPass.evidence.experimentsById.forged = completed({})
    malformedPass.evidence.experimentsById.forged.id = 'forged'
    malformedPass.evidence.experimentsById.forged.sequence = 1
    malformedPass.evidence.experimentsById.forged.taskId = 'request'
    malformedPass.evidence.experimentsById.forged.labId = 'wrong-lab'
    malformedPass.evidence.experimentsById.forged.attemptId = 'attempt-1'
    malformedPass.evidence.experimentsById.forged.contentVersion = 1
    malformedPass.evidence.experimentsById.forged.dependencyValues = { application: { source: 'healthy', route: '/health' } }
    malformedPass.evidence.experimentsById.forged.dependencyGenerations = { application: 0 }
    expect(evaluateLab(lab, malformedPass).tasks[0].status).toBe('pending')
  })

  it('requires current predicate state alongside evidence while predicate-only and legacy Tasks evaluate directly', () => {
    const lab = behavioralLab()
    let run = recordVerification(createBehavioralRun(lab, { attemptId: 'attempt-1' }), lab, 'request', completed())
    run = { ...run, project: { ...run.project, savedFiles: { 'src/app.txt': 'broken' } } }
    expect(evaluateLab(lab, run).tasks[0].status).toBe('needs-verification')
    expect(evaluateLab(lab, run).tasks[1]).toMatchObject({ status: 'done', done: true, evidenceIds: [] })

    const legacy = { id: 'legacy', tasks: [{ id: 'legacy-task', check: (sandbox) => sandbox.ready, text: 'Legacy' }] }
    expect(evaluateLab(legacy, { sandbox: { ready: true } })).toMatchObject({ doneCount: 1, total: 1, isComplete: true })
    expect(evaluateLab(legacy, { sandbox: { ready: false } }).tasks[0]).toMatchObject({ index: 0, done: false, status: 'pending' })
  })

  it('rejects malformed or incompatible persisted records without mutating compatible records during migration', () => {
    const lab = behavioralLab()
    const run = createBehavioralRun(lab, { attemptId: 'attempt-1' })
    const migrated = migrateBehavioralRun(run, lab)
    expect(migrated).toEqual(run)
    expect(migrated).not.toBe(run)
    expectCode(() => validateBehavioralRun({ ...run, nextSequence: Number.NaN }, lab), 'INVALID_RUN')
    expectCode(() => validateBehavioralRun({ ...run, schemaVersion: 3 }, lab), 'UNSUPPORTED_SCHEMA')
    expectCode(() => validateBehavioralRun({ ...run, contentVersion: 2 }, lab), 'INCOMPATIBLE_CONTENT')
    expectCode(() => validateBehavioralRun({ ...run, runtime: new Date() }, lab), 'INVALID_RUN')
    expectCode(() => validateBehavioralRun({ ...run, completedAt: 'simulated-complete', resultId: null }, lab), 'INVALID_RUN')
    expectCode(() => validateBehavioralRun({ ...run, completedAt: null, resultId: 'result-1' }, lab), 'INVALID_RUN')
    expect(validateBehavioralRun({ ...run, completedAt: 'simulated-complete', resultId: 'result-1' }, lab)).toMatchObject({ resultId: 'result-1' })
    const circular = { ...run }; circular.project = circular
    expectCode(() => validateBehavioralRun(circular, lab), 'INVALID_RUN')
    try { migrateBehavioralRun({ schemaVersion: 9, labId: lab.id }, lab) } catch (error) {
      expect(error.code).toBe('UNSUPPORTED_SCHEMA')
      expect(error.details.raw).toEqual({ schemaVersion: 9, labId: lab.id })
    }
    expectCode(() => createBehavioralRun({ ...lab, engineVersion: 3 }, { attemptId: 'attempt-1' }), 'UNSUPPORTED_ENGINE')
  })

  it('rejects persisted evidence that crosses run identity boundaries or reuses a sequence', () => {
    const lab = behavioralLab()
    let run = recordVerification(createBehavioralRun(lab, { attemptId: 'attempt-1' }), lab, 'request', completed())
    run = recordVerification(run, lab, 'request', completed({ outcome: 'failed', endedAtMs: 2000 }))
    const crossAttempt = structuredClone(run)
    crossAttempt.evidence.experimentsById['evidence-1'].attemptId = 'other-attempt'
    expectCode(() => validateBehavioralRun(crossAttempt, lab), 'INVALID_RUN')
    const duplicateSequence = structuredClone(run)
    duplicateSequence.evidence.experimentsById['evidence-2'].sequence = 1
    expectCode(() => validateBehavioralRun(duplicateSequence, lab), 'INVALID_RUN')
  })

  it('never grades a malformed behavioral run as complete', () => {
    const lab = behavioralLab()
    const valid = recordVerification(createBehavioralRun(lab, { attemptId: 'attempt-1' }), lab, 'request', completed())
    const badSequence = structuredClone(valid)
    badSequence.nextSequence = 1
    const badMap = structuredClone(valid)
    badMap.evidence.currentEvidenceByTask.request = 'missing-record'
    const badIdentity = structuredClone(valid)
    badIdentity.evidence.experimentsById['evidence-1'].attemptId = 'different-attempt'
    const twoRecords = recordVerification(valid, lab, 'request', completed())
    const duplicateSequence = structuredClone(twoRecords)
    duplicateSequence.evidence.experimentsById['evidence-2'].sequence = 1
    for (const run of [badSequence, badMap, badIdentity, duplicateSequence]) {
      const grade = evaluateLab(lab, run)
      expect(grade.isComplete).toBe(false)
      expect(grade.doneCount).toBe(0)
      expect(grade.tasks.every((task) => task.done === false && task.status === 'pending')).toBe(true)
    }
  })
})
