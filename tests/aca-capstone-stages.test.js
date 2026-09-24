import { describe, expect, it } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { canonicalize, recordVerification } from '../src/lib/labEngine/evidence.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { CAPSTONE_STARTER_FILES } from '../src/data/templates/containerapps-dotnet/capstone.js'

const stageIds = ['prepare', 'publish', 'deploy', 'healthy', 'incident', 'recovery', 'cleanup']
function fixture() {
  return {
    id: 'capstone-stage-fixture', engineVersion: 2, contentVersion: 1,
    capabilities: { acaCapstone: true },
    initialProjectFiles: { 'src/app.txt': 'ready' },
    stages: stageIds.map(id => ({ id, title: id, taskIds: [id] })),
    tasks: stageIds.map((id, index) => ({
      id, check: context => context.project.savedFiles['src/app.txt'] === 'ready',
      ...(index === 1 || index === 3 || index === 5 ? {
        verification: { scenarioId: `${id}-proof`, scenarioVersion: 1 },
        dependencies: { source: context => context.project.savedFiles['src/app.txt'] },
      } : {}),
    })),
  }
}
function advance(run, lab) { return applyRunAction(run, { type: 'advance-stage' }, lab) }
function verify(run, lab, id) {
  return recordVerification(run, lab, id, { scenarioId: `${id}-proof`, scenarioVersion: 1,
    completed: true, outcome: 'passed', startedAtMs: 0, endedAtMs: 1, measurements: {} })
}
function reachRecovery(lab) {
  let run = createBehavioralRun(lab, { attemptId: 'cleanup-flow' })
  for (const id of stageIds.slice(0, 5)) {
    if (['publish', 'healthy'].includes(id)) run = verify(run, lab, id)
    run = advance(run, lab).run
  }
  return verify(run, lab, 'recovery')
}

describe('Capstone stage seals', () => {
  it('captures attempt-created groups and seals recovery before cleanup, then requires their deletion before final advance', () => {
    const lab = fixture()
    let run = reachRecovery(lab)
    run = applyRunAction(run, { type: 'command', line: 'az group create -n rg-extra -l eastus' }, lab).run
    expect(run.stages.ownedGroups).toEqual(['rg-extra'])
    run = verify(run, lab, 'recovery')
    const sealed = advance(run, lab).run
    expect(sealed.stages.activeStageId).toBe('cleanup')
    expect(sealed.stages.cleanupCheckpoint).toMatchObject({ stageId: 'recovery', ownedGroups: ['rg-extra'] })
    expect(advance(sealed, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = applyRunAction(sealed, { type: 'command', line: 'az group delete -n rg-extra --yes' }, lab).run
    expect(run.stages.ownedGroups).toEqual(['rg-extra'])
    expect(run.stages.cleanupCheckpoint).toEqual(sealed.stages.cleanupCheckpoint)
    expect(run.sandbox.resourceGroups).toEqual([])
    expect(validateBehavioralRun(run, lab)).toBe(run)
    run = advance(run, lab).run
    expect(run.stages.sealedStages).toHaveLength(7)
    expect(run.stages.activeStageId).toBeNull()
    expect(evaluateLab(lab, run).isComplete).toBe(true)
    run.completedAt = '2026-09-24T00:00:00.000Z'
    run.resultId = 'cleanup-result'
    expect(validateBehavioralRun(structuredClone(run), lab)).toBeTruthy()
  })

  it('rejects deleting an extra group before recovery is sealed, then includes it in cleanup ownership', () => {
    const lab = fixture()
    let run = reachRecovery(lab)
    run = applyRunAction(run, { type: 'command', line: 'az group create -n rg-partial -l eastus' }, lab).run
    const deletion = applyRunAction(run, { type: 'command', line: 'az group delete -n rg-partial --yes' }, lab)
    expect(deletion.diagnostics[0].code).toBe('INVALID_ACTION')
    expect(deletion.run).toEqual(run)
    expect(run.stages.ownedGroups).toEqual(['rg-partial'])
    run = advance(run, lab).run
    expect(run.stages.cleanupCheckpoint.ownedGroups).toEqual(['rg-partial'])
    run = applyRunAction(run, { type: 'command', line: 'az group delete -n rg-partial --yes' }, lab).run
    expect(run.sandbox.resourceGroups).toEqual([])
    const erased = structuredClone(run)
    erased.stages.ownedGroups = []
    erased.stages.groupCreations = []
    expect(() => validateBehavioralRun(erased, lab)).toThrow()
  })

  it('preserves a checkpoint through inspection and reopens recovery on a resource update', () => {
    const lab = fixture()
    let run = reachRecovery(lab)
    run = applyRunAction(run, { type: 'command', line: 'az group create -n rg-owned -l eastus' }, lab).run
    run = verify(run, lab, 'recovery')
    run = advance(run, lab).run
    const checkpoint = structuredClone(run.stages.cleanupCheckpoint)
    run = applyRunAction(run, { type: 'command', line: 'az group show -n rg-owned' }, lab).run
    expect(run.stages.cleanupCheckpoint).toEqual(checkpoint)
    run = applyRunAction(run, { type: 'command', line: 'az group create -n rg-owned -l eastus' }, lab).run
    expect(run.stages.cleanupCheckpoint).toEqual(checkpoint)
    run = applyRunAction(run, { type: 'command', line: 'az group create -n rg-owned -l westus' }, lab).run
    expect(run.stages.activeStageId).toBe('recovery')
    expect(run.stages.cleanupCheckpoint).toBeNull()
    expect(run.stages.ownedGroups).toEqual(['rg-owned'])
  })

  it('derives ownership from ordered attempt creation records through deletion and reload', () => {
    const lab = fixture()
    let run = reachRecovery(lab)
    run = applyRunAction(run, { type: 'command', line: 'az group create -n rg-first -l eastus' }, lab).run
    run = applyRunAction(run, { type: 'command', line: 'az group create -n rg-extra -l eastus' }, lab).run
    expect(run.stages.groupCreations.map(record => record.name)).toEqual(['rg-first', 'rg-extra'])
    expect(run.evidence.groupReceipts.map(record => record.name)).toEqual(['rg-first', 'rg-extra'])
    run = verify(run, lab, 'recovery')
    run = advance(run, lab).run
    run = applyRunAction(run, { type: 'command', line: 'az group delete -n rg-extra --yes' }, lab).run
    expect(validateBehavioralRun(structuredClone(run), lab)).toBeTruthy()
    const erased = structuredClone(run)
    erased.stages.ownedGroups = ['rg-first']
    erased.stages.cleanupCheckpoint.ownedGroups = ['rg-first']
    expect(() => validateBehavioralRun(erased, lab)).toThrow()
    const forgedOrder = structuredClone(run)
    forgedOrder.stages.groupCreations.reverse()
    expect(() => validateBehavioralRun(forgedOrder, lab)).toThrow()
    const forgedSeal = structuredClone(run)
    forgedSeal.stages.sealedStages[5].ownedGroups = ['rg-first']
    forgedSeal.evidence.milestoneRecords[5].snapshot = canonicalize(forgedSeal.stages.sealedStages[5])
    forgedSeal.stages.cleanupCheckpoint.snapshot = canonicalize(forgedSeal.stages.sealedStages[5])
    expect(() => validateBehavioralRun(forgedSeal, lab)).toThrow()
  })

  it('rejects a persisted completion marker before the cleanup stage is sealed', () => {
    const lab = fixture()
    let run = reachRecovery(lab)
    run = advance(run, lab).run
    run.completedAt = '2026-09-24T00:00:00.000Z'
    run.resultId = 'forged-result'
    expect(() => validateBehavioralRun(run, lab)).toThrow()
    expect(evaluateLab(lab, run).isComplete).toBe(false)
  })

  it('reopens recovery after a real source change and rejects forged or missing cleanup checkpoints', () => {
    const lab = { ...fixture(), manifestId: 'containerapps-dotnet-capstone-v1', initialProjectFiles: CAPSTONE_STARTER_FILES }
    lab.tasks = lab.tasks.map(task => ({ ...task, check: () => true,
      ...(task.dependencies ? { dependencies: { source: context => context.project.savedFiles['infra/main.bicep'] } } : {}) }))
    let run = reachRecovery(lab)
    run = advance(run, lab).run
    const forged = structuredClone(run)
    forged.stages.cleanupCheckpoint.ownedGroups = ['hidden']
    expect(() => validateBehavioralRun(forged, lab)).toThrow()
    const missing = structuredClone(run)
    missing.stages.cleanupCheckpoint = null
    expect(() => validateBehavioralRun(missing, lab)).toThrow()
    const text = run.project.savedFiles['infra/main.bicep']
    run = applyRunAction(run, { type: 'save-file', path: 'infra/main.bicep', text: `${text}\n// changed` }, lab).run
    expect(run.stages.activeStageId).toBe('recovery')
    expect(run.stages.cleanupCheckpoint).toBeNull()
    expect(run.stages.sealedStages).toHaveLength(5)
  })
  it('begins at the first stage, advances only the active fully passed stage, and rejects caller fields', () => {
    const lab = fixture()
    let run = createBehavioralRun(lab, { attemptId: 'stages-1' })
    expect(run.stages.activeStageId).toBe('prepare')
    expect(advance(run, lab).run.stages).toMatchObject({ activeStageId: 'publish', sealedStages: [{ stageId: 'prepare', taskIds: ['prepare'] }] })
    run = advance(run, lab).run
    expect(advance(run, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    expect(applyRunAction(run, { type: 'advance-stage', stageId: 'healthy' }, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = verify(run, lab, 'publish')
    const result = advance(run, lab)
    expect(result.run.stages.activeStageId).toBe('deploy')
    expect(result.run.stages.sealedStages[1]).toMatchObject({ stageId: 'publish', taskIds: ['publish'], evidenceIds: ['evidence-2'], sequence: 3, contentVersion: 1 })
    expect(result.run.nextSequence).toBe(4)
    expect(run.stages.activeStageId).toBe('publish')
  })

  it('keeps historical proof valid after live drift, but recovery needs a fresh current proof', () => {
    const lab = fixture()
    let run = createBehavioralRun(lab, { attemptId: 'stages-2' })
    for (const id of stageIds.slice(0, 5)) {
      if (['publish', 'healthy'].includes(id)) run = verify(run, lab, id)
      run = advance(run, lab).run
    }
    expect(run.stages.activeStageId).toBe('recovery')
    run = verify(run, lab, 'recovery')
    run.dependencyGenerations.source = 1
    expect(validateBehavioralRun(run, lab)).toBe(run)
    expect(migrateBehavioralRun(run, lab).stages.sealedStages).toHaveLength(5)
    expect(evaluateLab(lab, run).tasks.find(task => task.id === 'healthy')).toMatchObject({ done: true, status: 'done' })
    expect(evaluateLab(lab, run).tasks.find(task => task.id === 'recovery').done).toBe(false)
    expect(advance(run, lab).diagnostics[0].code).toBe('INVALID_ACTION')
  })

  it('rejects reordered, forged, stale-at-seal, future and oversized summaries before grading', () => {
    const lab = fixture()
    let run = createBehavioralRun(lab, { attemptId: 'stages-3' })
    run = advance(run, lab).run
    run = verify(run, lab, 'publish')
    run = advance(run, lab).run
    const mutate = callback => { const copy = structuredClone(run); callback(copy); expect(() => validateBehavioralRun(copy, lab)).toThrow(); expect(evaluateLab(lab, copy).isComplete).toBe(false) }
    mutate(copy => { copy.stages.sealedStages.reverse() })
    mutate(copy => { copy.stages.sealedStages[1].evidenceIds = ['evidence-999'] })
    mutate(copy => { copy.stages.sealedStages[1].evidenceIds = ['evidence-2', 'evidence-2'] })
    mutate(copy => { copy.stages.sealedStages[1].sequence = copy.nextSequence })
    mutate(copy => { copy.stages.sealedStages[1].sequence = copy.evidence.experimentsById['evidence-2'].sequence })
    mutate(copy => { copy.stages.sealedStages[1].dependencyGenerations.source = 99 })
    mutate(copy => { copy.stages.sealedStages[1].dependencyValues.source = 'forged' })
    mutate(copy => { copy.stages.sealedStages[1].dependencyValues.extra = true })
    mutate(copy => { copy.stages.sealedStages[1].sourceVersions['src/app.txt'] = 999 })
    mutate(copy => { copy.stages.sealedStages[1].sourceHash = 'x'.repeat(100_000) })
    mutate(copy => { copy.stages.activeStageId = 'cleanup' })
    mutate(copy => { copy.stages.cleanupCheckpoint = {} })
    mutate(copy => { copy.sandbox.resourceGroups.push({ name: 'rg-forged', location: 'eastus', tags: null, createdAt: '2026-01-01T00:00:00.000Z' }) })
    mutate(copy => {
      const old = copy.evidence.experimentsById['evidence-2']
      delete copy.evidence.experimentsById['evidence-2']
      copy.evidence.experimentsById['evidence-forged'] = { ...old, id: 'evidence-forged' }
      copy.evidence.currentEvidenceByTask.publish = 'evidence-forged'
      copy.stages.sealedStages[1].evidenceIds = ['evidence-forged']
    })
  })

  it('binds a historical image identity to its build even after later publication changes', () => {
    const lab = fixture()
    let run = createBehavioralRun(lab, { attemptId: 'stages-artifact' })
    run = advance(run, lab).run
    run.artifacts.buildsById['build-2'] = { id: 'build-2', sourceHash: 'src-original', digest: 'sha256:original' }
    run.nextSequence = 3
    run = verify(run, lab, 'publish')
    run = advance(run, lab).run
    expect(run.stages.sealedStages[1].artifact).toEqual({ buildId: 'build-2', sourceHash: 'src-original', digest: 'sha256:original' })
    run.artifacts.buildsById['build-5'] = { id: 'build-5', sourceHash: 'src-later', digest: 'sha256:later' }
    run.nextSequence = 6
    expect(validateBehavioralRun(run, lab)).toBe(run)
    const forged = structuredClone(run)
    forged.stages.sealedStages[1].artifact.digest = 'sha256:later'
    expect(() => validateBehavioralRun(forged, lab)).toThrow()
  })

  it('rejects a rewritten historical source version after a later save', () => {
    const lab = { ...fixture(), manifestId: 'containerapps-dotnet-capstone-v1', initialProjectFiles: CAPSTONE_STARTER_FILES }
    lab.tasks = lab.tasks.map(task => ({ ...task,
      check: context => Boolean(context.project.savedFiles['infra/main.bicep']),
      ...(task.dependencies ? { dependencies: { source: context => context.project.savedFiles['infra/main.bicep'] } } : {}),
    }))
    let run = createBehavioralRun(lab, { attemptId: 'stages-source' })
    const original = run.project.savedFiles['infra/main.bicep']
    run = applyRunAction(run, { type: 'save-file', path: 'infra/main.bicep', text: `${original}\n// first save` }, lab).run
    run = advance(run, lab).run
    run = verify(run, lab, 'publish')
    run = advance(run, lab).run
    expect(run.stages.sealedStages[1].sourceVersions['infra/main.bicep']).toBe(1)
    run = applyRunAction(run, { type: 'save-file', path: 'infra/main.bicep', text: `${original}\n// second save` }, lab).run
    const noOp = applyRunAction(run, { type: 'save-file', path: 'infra/main.bicep', text: `${original}\n// second save` }, lab).run
    expect(noOp.nextSequence).toBe(run.nextSequence)
    expect(noOp.project.sourceJournal).toEqual(run.project.sourceJournal)
    expect(validateBehavioralRun(run, lab)).toBe(run)
    const forged = structuredClone(run)
    forged.stages.sealedStages[1].sourceVersions['infra/main.bicep'] = 2
    forged.evidence.milestoneRecords[1].snapshot = canonicalize(forged.stages.sealedStages[1])
    expect(() => validateBehavioralRun(forged, lab)).toThrow()
    const causalForgery = structuredClone(forged)
    causalForgery.project.sourceJournal[1].sequence = causalForgery.evidence.experimentsById['evidence-3'].sequence
    expect(() => validateBehavioralRun(causalForgery, lab)).toThrow()
  })

  it('keeps pre-Capstone runs compatible and leaves their stage action unavailable', () => {
    const lab = { ...fixture(), capabilities: {} }
    const run = createBehavioralRun(lab, { attemptId: 'old-lab' })
    expect(run.stages.activeStageId).toBeNull()
    expect(advance(run, lab).diagnostics[0].code).toBe('INVALID_ACTION')
    expect(validateBehavioralRun(run, lab)).toBe(run)
  })
})
