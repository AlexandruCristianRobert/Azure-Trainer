import { describe, it, expect } from 'vitest'
import { seedAksCapstoneAt, verifyAksCapstoneFixture } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateBehavioralRun, createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { recordVerification } from '../src/lib/labEngine/evidence.js'
import { canonicalize } from '../src/lib/labEngine/evidence.js'

describe('AKS capstone checkpoints', () => {
  it('initializes eight separate stages and rejects a broken partition', () => {
    const { lab, run } = seedAksCapstoneAt('source')
    expect(run.stages.activeStageId).toBe('source')
    expect(run.project.sourceJournal).toEqual([])
    expect(() => createBehavioralRun({ ...lab, stages: lab.stages.slice(1) }, { attemptId: 'x' })).toThrow()
  })
  it('requires fresh active-stage proof and journals saves', () => {
    let { lab, run } = seedAksCapstoneAt('source')
    run = verifyAksCapstoneFixture(run, lab)
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'] + '\n# change\n' }, lab).run
    const result = applyRunAction(run, { type: 'aks-advance-stage' }, lab)
    expect(result.diagnostics[0].code).toBe('AKS_STAGE_INCOMPLETE')
    expect(run.project.sourceJournal).toHaveLength(1)
    expect(run.stages.sealedStages).toHaveLength(0)
  })
  it('persists real evidence seals through reload and later source edits', () => {
    const { lab, run } = seedAksCapstoneAt('resilience')
    expect(run.stages.sealedStages).toHaveLength(4)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toEqual(run)
    const edited = applyRunAction(run, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'] + '\n# later\n' }, lab).run
    expect(evaluateLab(lab, edited).tasks.slice(0, 4).every(task => task.done)).toBe(true)
  })
  it('rejects future verification and caller-provided stage state', () => {
    const { lab, run } = seedAksCapstoneAt('source')
    expect(() => verifyAksCapstoneFixture(run, lab, lab.tasks[1].id)).toThrow()
    expect(applyRunAction(run, { type: 'aks-advance-stage', seal: {} }, lab).diagnostics).not.toEqual([])
    expect(applyRunAction(run, { type: 'aks-request', scenarioId: lab.tasks[1].verification.scenarioId }, lab).diagnostics[0].code).toBe('AKS_STAGE_INACTIVE')
  })
  it('seals the evidence-selected build, not the latest unrelated publication', () => {
    let { lab, run } = seedAksCapstoneAt()
    for (const line of ['az group create -n rgcap -l eastus', 'az acr create -g rgcap -n acrcapstone --sku Basic',
      'az acr build -r acrcapstone -t assistant:v1 .']) run = applyRunAction(run, { type: 'command', line }, lab).run
    const chosen = Object.keys(run.artifacts.buildsById)[0]
    const task = lab.tasks[0]
    run = recordVerification(run, lab, task.id, { ...task.verification, completed: true, outcome: 'passed', startedAtMs: 0,
      endedAtMs: 0, measurements: { buildId: chosen } })
    run = applyRunAction(run, { type: 'command', line: 'az acr build -r acrcapstone -t unrelated:v2 .' }, lab).run
    run = applyRunAction(run, { type: 'aks-advance-stage' }, lab).run
    const proof = run.evidence.aksCapstoneReceipts[run.stages.sealedStages[0].receiptIds[0]]
    expect(proof.artifacts.map(item => item.buildId)).toEqual([chosen])
    expect(() => validateBehavioralRun(run, lab)).not.toThrow()
    const snapshot = run.artifacts.sourceSnapshotsByHash[proof.artifacts[0].sourceHash]
    snapshot.files['app.py'] += '\n# forged'
    expect(() => validateBehavioralRun(run, lab)).toThrow()
  })
  it('rejects an unvalidated cleanup checkpoint', () => {
    const { lab, run } = seedAksCapstoneAt('cleanup')
    run.stages.cleanupCheckpoint = { done: true }
    expect(() => validateBehavioralRun(run, lab)).toThrow()
  })
  it('rejects a skipped stage even with a copied milestone', () => {
    const { lab, run } = seedAksCapstoneAt('deployment')
    run.stages.sealedStages[0].stageId = 'deployment'
    run.stages.activeStageId = 'configuration'
    expect(() => validateBehavioralRun(run, lab)).toThrow()
  })
  it('rejects a seal appended after a source edit even when its milestone agrees', () => {
    let { lab, run } = seedAksCapstoneAt()
    run = verifyAksCapstoneFixture(run, lab)
    const legitimatelySealed = applyRunAction(run, { type: 'aks-advance-stage' }, lab).run
    run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'] + '\n# stale\n' }, lab).run
    const seal = { ...legitimatelySealed.stages.sealedStages[0], sequence: run.nextSequence, sourceVersions: run.project.fileVersions }
    run.stages.sealedStages = [seal]
    run.stages.activeStageId = 'deployment'
    run.evidence.milestoneRecords = [{ kind: 'aks-stage-seal', sequence: seal.sequence, attemptId: run.attemptId, snapshot: canonicalize(seal) }]
    run.nextSequence++
    expect(() => validateBehavioralRun(run, lab)).toThrow()
  })
  it('retains measured receipts as redacted bounded summaries', () => {
    let { lab, run } = seedAksCapstoneAt()
    const task = lab.tasks[0]
    run = recordVerification(run, lab, task.id, { ...task.verification, completed: true, outcome: 'passed', startedAtMs: 0,
      endedAtMs: 123, measurements: { profileId: 'measured', password: 'must-not-copy', records: Array.from({ length: 12 }, (_, n) => ({ n })) } })
    const proof = Object.values(run.evidence.aksCapstoneReceipts)[0]
    expect(proof.observation.endedAtMs).toBe(123)
    expect(proof.observation.measurements.password).toBeUndefined()
    expect(proof.observation.measurements.records).toHaveLength(10)
  })
  it.each(['attempt', 'content', 'source', 'sequence', 'evidence', 'extra'])('rejects forged %s seal fields', field => {
    const { lab, run } = seedAksCapstoneAt('deployment')
    const seal = run.stages.sealedStages[0]
    if (field === 'attempt') seal.attemptId = 'other'
    if (field === 'content') seal.contentVersion++
    if (field === 'source') seal.sourceVersions['app.py'] = 99
    if (field === 'sequence') seal.sequence++
    if (field === 'evidence') seal.evidenceIds = []
    if (field === 'extra') seal.done = true
    expect(() => validateBehavioralRun(run, lab)).toThrow()
  })
})
