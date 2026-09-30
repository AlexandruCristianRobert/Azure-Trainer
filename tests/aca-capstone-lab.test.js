import { describe, expect, it } from 'vitest'
import { capstoneLab } from '../src/data/labs/containerapps-journey/capstone.lab.js'
import { LABS, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun, contextFor, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { CAPSTONE_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/capstone.js'
import { projectSourceHash } from '../src/lib/project/build.js'

function act(run, action, expectedDiagnostics = []) {
  const result = applyRunAction(run, action, capstoneLab)
  expect(result.diagnostics.map(item => item.code), JSON.stringify({ action, diagnostics: result.diagnostics })).toEqual(expectedDiagnostics)
  return result.run
}
const command = line => ({ type: 'command', line })
const deploy = (verb, name, root) => command(`az deployment group ${verb} --name ${name} --resource-group rg-aca-capstone --template-file infra/${root}.bicep --parameters infra/${root}.bicepparam`)
function stage(run, id) {
  const tasks = evaluateLab(capstoneLab, run).tasks.filter(task => task.stageId === id)
  expect(tasks.filter(task => !task.done).map(task => task.id)).toEqual([])
  return act(run, { type: 'advance-stage' })
}
function scenario(run, id) {
  if (capstoneLab.scenarios[id].kind === 'foundry') return act(run, { type: 'request', scenarioId: id },
    id === 'incident-request' ? ['FOUNDRY_DEPLOYMENT_NOT_FOUND'] :
      id === 'recovery-persistent' ? ['UPSTREAM_UNAVAILABLE'] : [])
  run = act(run, { type: 'scenario-start', scenarioId: id })
  return act(run, { type: 'simulation-advance', seconds: capstoneLab.scenarios[id].durationSeconds })
}

describe('Container Apps Capstone Lab', () => {
  it('is the final seven-stage Lab and starts with an empty Sandbox and incomplete saved source', () => {
    const run = createBehavioralRun(capstoneLab, { attemptId: 'capstone-fixture' })
    expect(LABS.at(-1).id).toBe('aca-capstone')
    expect(nextLabFor(LABS.at(-2))?.id).toBe('aca-capstone')
    expect(nextLabFor(capstoneLab)).toBeNull()
    expect(capstoneLab.stages.map(stage => stage.id)).toEqual([
      'prepare', 'publish', 'deploy', 'healthy', 'incident', 'recovery', 'cleanup',
    ])
    expect(capstoneLab.labMode).toBe('capstone')
    expect(capstoneLab.stages[0].taskIds).toEqual(['source'])
    expect(capstoneLab.stages[1].taskIds).toEqual(['group', 'bootstrap-preview', 'bootstrap-create', 'publish-image'])
    expect(run.sandbox.resourceGroups).toEqual([])
    expect(run.stages.activeStageId).toBe('prepare')
    expect(evaluateLab(capstoneLab, run).isComplete).toBe(false)
    expect(evaluateLab(capstoneLab, run).tasks.some(task => task.done)).toBe(false)
    expect(applyRunAction(run, { type: 'advance-stage' }, capstoneLab).diagnostics[0].code).toBe('INVALID_ACTION')
  })

  it('requires explicit group inspection and rejects premature stage advancement', () => {
    let run = createBehavioralRun(capstoneLab, { attemptId: 'group-inspection' })
    run = act(run, command('az group create -n rg-aca-capstone -l eastus'))
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'group').done).toBe(false)
    expect(applyRunAction(run, { type: 'advance-stage' }, capstoneLab).diagnostics[0].code).toBe('INVALID_ACTION')
    run = act(run, command('az group show -n rg-aca-capstone'))
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'group').done).toBe(true)
  })

  it('seals buildable saved source before creating any resource group', () => {
    let run = createBehavioralRun(capstoneLab, { attemptId: 'source-first' })
    for (const path of ['src/Trainer.Api/Program.cs', 'src/Trainer.Api/appsettings.json'])
      run = act(run, { type: 'save-file', path, text: CAPSTONE_SOLUTION_FILES[path] })
    expect(run.sandbox.resourceGroups).toEqual([])
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'source').done).toBe(true)
    run = stage(run, 'prepare')
    expect(run.stages.activeStageId).toBe('publish')
  })

  it('does not award work for hints, solutions or a wrong resource group', () => {
    let run = createBehavioralRun(capstoneLab, { attemptId: 'assistance' })
    run = act(run, { type: 'hint', taskId: 'group' })
    run = act(run, { type: 'solution', taskId: 'group' })
    run = act(run, { type: 'elapsed', milliseconds: 4500 })
    expect(run.hintsRevealed.group).toBe(1)
    expect(run.solutionsRevealed.group).toBe(true)
    expect(run.elapsedMs).toBe(4500)
    expect(evaluateLab(capstoneLab, run).doneCount).toBe(0)
    run = act(run, command('az group create -n rg-wrong -l eastus'))
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'group').done).toBe(false)
    expect(applyRunAction(run, command('az group delete -n rg-wrong --yes'), capstoneLab).diagnostics[0].code).toBe('INVALID_ACTION')
  })

  it('requires the active image to capture current saved application source', () => {
    let run = createBehavioralRun(capstoneLab, { attemptId: 'source-image-binding' })
    for (const path of ['src/Trainer.Api/Program.cs', 'src/Trainer.Api/appsettings.json'])
      run = act(run, { type: 'save-file', path, text: CAPSTONE_SOLUTION_FILES[path] })
    run = stage(run, 'prepare')
    run = act(run, command('az group create -n rg-aca-capstone -l eastus'))
    run = act(run, command('az group show -n rg-aca-capstone'))
    for (const verb of ['validate', 'what-if', 'create']) run = act(run, deploy(verb, 'bootstrap', 'bootstrap'))
    run = act(run, command('az deployment group show --name bootstrap --resource-group rg-aca-capstone'))
    run = act(run, command('az acr build --registry acrcapstone --image api:v1 --file Dockerfile .'))
    run = stage(run, 'publish')
    for (const verb of ['validate', 'what-if', 'create']) run = act(run, deploy(verb, 'application', 'main'))
    run = act(run, command('az deployment group show --name application --resource-group rg-aca-capstone'))
    run = stage(run, 'deploy')
    run = scenario(run, 'baseline-request')
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'baseline-request').done).toBe(true)
    const path = 'src/Trainer.Api/Program.cs'
    run = act(run, { type: 'save-file', path, text: CAPSTONE_SOLUTION_FILES[path].replace('units > 100', 'units > 101') })
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'baseline-request').done).toBe(false)
    run = scenario(run, 'baseline-request')
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'baseline-request').done).toBe(false)
    run = act(run, deploy('what-if', 'application', 'main'))
    run = act(run, deploy('create', 'application', 'main'))
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'baseline-request').done).toBe(false)
    const forged = structuredClone(run)
    const artifactId = forged.artifacts.publishedTags['acrcapstone.azurecr.io/api:v1']
    const artifact = forged.artifacts.buildsById[artifactId]
    const oldHash = artifact.sourceHash
    const snapshot = forged.artifacts.sourceSnapshotsByHash[oldHash]
    snapshot.files[path] = forged.project.savedFiles[path]
    const forgedHash = projectSourceHash(snapshot.files)
    snapshot.hash = forgedHash
    artifact.sourceHash = forgedHash
    delete forged.artifacts.sourceSnapshotsByHash[oldHash]
    forged.artifacts.sourceSnapshotsByHash[forgedHash] = snapshot
    expect(() => validateBehavioralRun(forged, capstoneLab)).toThrow()
  })

  it('walks from an empty group through repair, reproducibility, cleanup and Result', () => {
    let run = createBehavioralRun(capstoneLab, { attemptId: 'walkthrough' })
    for (const path of ['src/Trainer.Api/Program.cs', 'src/Trainer.Api/appsettings.json']) {
      run = act(run, { type: 'save-file', path, text: CAPSTONE_SOLUTION_FILES[path] })
    }
    run = stage(run, 'prepare')
    expect(run.sandbox.resourceGroups).toEqual([])
    run = act(run, command('az group create -n rg-aca-capstone -l eastus'))
    run = act(run, command('az group show -n rg-aca-capstone'))
    run = act(run, deploy('validate', 'bootstrap', 'bootstrap'))
    run = act(run, deploy('what-if', 'bootstrap', 'bootstrap'))
    run = act(run, deploy('create', 'bootstrap', 'bootstrap'))
    run = act(run, command('az deployment group show --name bootstrap --resource-group rg-aca-capstone'))
    run = act(run, command('az acr build --registry acrcapstone --image api:v1 --file Dockerfile .'))
    expect(run.artifacts.publishedTags, JSON.stringify(run.artifacts).slice(0, 3000)).toHaveProperty('acrcapstone.azurecr.io/api:v1')
    run = stage(run, 'publish')
    run = act(run, deploy('validate', 'application', 'main'))
    run = act(run, deploy('what-if', 'application', 'main'))
    run = act(run, deploy('create', 'application', 'main'))
    run = act(run, command('az deployment group show --name application --resource-group rg-aca-capstone'))
    run = stage(run, 'deploy')
    expect(run.stages.activeStageId).toBe('healthy')
    for (const id of capstoneLab.stages[3].taskIds) run = scenario(run, id)
    run = stage(run, 'healthy')
    const injected = applyRunAction(run, { type: 'inject-incident' }, capstoneLab)
    expect(injected.diagnostics.map(item => item.code)).toEqual(['CAPSTONE_INCIDENT_INJECTED'])
    run = injected.run
    run = scenario(run, 'incident-request')
    run = act(run, deploy('what-if', 'application', 'main'))
    run = act(run, deploy('create', 'application', 'main'))
    run = scenario(run, 'repair-transient')
    for (const id of ['incident-request', 'repair-transient']) {
      const task = capstoneLab.tasks.find(item => item.id === id)
      const record = run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]]
      for (const [key, selector] of Object.entries(task.dependencies)) {
        expect(record.dependencyValues[key], `${id}:${key}`).toEqual(selector(contextFor(run)))
      }
    }
    run = stage(run, 'incident')
    const programPath = 'src/Trainer.Api/Program.cs'
    run = act(run, { type: 'save-file', path: programPath,
      text: CAPSTONE_SOLUTION_FILES[programPath].replace('units > 100', 'units > 101') })
    run = scenario(run, 'recovery-request')
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'recovery-request').done).toBe(false)
    run = act(run, deploy('what-if', 'application', 'main'))
    run = act(run, deploy('create', 'application', 'main'))
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'recovery-request').done).toBe(false)
    run = act(run, { type: 'save-file', path: programPath, text: CAPSTONE_SOLUTION_FILES[programPath] })
    run = scenario(run, 'recovery-request')
    expect(evaluateLab(capstoneLab, run).tasks.find(task => task.id === 'recovery-request').done).toBe(true)
    for (const id of capstoneLab.stages[5].taskIds.filter(id => capstoneLab.scenarios[id] && id !== 'recovery-request')) run = scenario(run, id)
    expect(['recovery-steady', 'recovery-overload', 'recovery-quiet'].map(id =>
      run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]]?.outcome)).toEqual(['passed', 'passed', 'passed'])
    expect(evaluateLab(capstoneLab, run).tasks.filter(task => task.stageId === 'recovery' && !task.done).map(task => task.id))
      .toEqual(['noop-preview', 'noop-reapply'])
    run = act(run, deploy('what-if', 'application', 'main'))
    run = act(run, deploy('create', 'application', 'main'))
    run = stage(run, 'recovery')
    const checkpoint = structuredClone(run.stages.cleanupCheckpoint)
    const attemptCount = run.runtime.bicep.attempts.length
    run = act(run, deploy('what-if', 'application', 'main'))
    run = act(run, command('az deployment group show --name application --resource-group rg-aca-capstone'))
    expect(run.stages.cleanupCheckpoint).toEqual(checkpoint)
    run = act(run, deploy('create', 'application', 'main'))
    expect(run.runtime.bicep.attempts).toHaveLength(attemptCount + 1)
    expect(run.stages.activeStageId).toBe('recovery')
    expect(run.stages.cleanupCheckpoint).toBeNull()
    run = stage(run, 'recovery')
    run = act(run, command('az group delete -n rg-aca-capstone --yes'))
    run = stage(run, 'cleanup')
    expect(evaluateLab(capstoneLab, run).isComplete).toBe(true)
    expect(run.stages.activeStageId).toBeNull()
    const restored = migrateBehavioralRun(JSON.parse(JSON.stringify(run)), capstoneLab)
    expect(validateBehavioralRun(restored, capstoneLab)).toBe(restored)
    expect(evaluateLab(capstoneLab, restored).isComplete).toBe(true)
    const restarted = createBehavioralRun(capstoneLab, { attemptId: 'restart' })
    expect(restarted.stages.activeStageId).toBe('prepare')
    expect(evaluateLab(capstoneLab, restarted).isComplete).toBe(false)
  })
})
