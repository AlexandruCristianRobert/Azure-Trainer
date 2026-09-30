import { describe, expect, it } from 'vitest'
import { bicepIndependentLab } from '../src/data/labs/containerapps-journey/bicep-independent.lab.js'
import { BICEP_INDEPENDENT_CONFIGS, BICEP_INDEPENDENT_SOLUTION_FILES, BICEP_INDEPENDENT_BASELINE } from '../src/data/templates/containerapps-dotnet/bicep-independent.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { LABS, nextLabFor } from '../src/data/labs/index.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const [first, second] = BICEP_INDEPENDENT_CONFIGS
const fresh = () => createBehavioralRun(bicepIndependentLab, { attemptId: 'independent-run-test' })
const task = (run, id) => evaluateLab(bicepIndependentLab, run).tasks.find(item => item.id === id)
const command = (verb, config) => `az deployment group ${verb} --name ${config.deploymentName} --resource-group ${config.resourceGroup} --template-file infra/main.bicep --parameters ${config.parameterPath}`
function act(run, action) {
  const result = applyRunAction(run, action, bicepIndependentLab)
  expect(result.diagnostics, JSON.stringify(action)).toEqual([])
  expect(result.lines.filter(line => line.kind === 'err'), JSON.stringify(action)).toEqual([])
  return result.run
}
function through(last) {
  let run = fresh()
  for (const item of bicepIndependentLab.tasks) {
    for (const step of item.solution.steps) run = act(run, step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: step.content }
      : step.kind === 'command' ? { type: 'command', line: step.line } : step.action)
    if (item.id === last) break
  }
  return run
}
const latest = (run, id) => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]]

describe('independent Bicep Lab', () => {
  it('starts with the first stack supplied but no earned tasks, and follows Lab 14 in the journey', () => {
    const run = fresh()
    expect(run.sandbox.containerApps.map(app => app.name)).toEqual([first.appName])
    expect(run.runtime.bicep.attempts).toEqual([])
    expect(evaluateLab(bicepIndependentLab, run).doneCount).toBe(0)
    expect(bicepIndependentLab).toMatchObject({ contentVersion: 1, journeyOrder: 15, labMode: 'independent' })
    expect(nextLabFor(LABS.find(lab => lab.id === 'aca-bicep-troubleshooting'))).toBe(bicepIndependentLab)
    expect(nextLabFor(bicepIndependentLab)?.id).toBe('aca-capstone')
  })

  it('completes second deployment and proof before a fresh first no-change reapply and proof', () => {
    const run = through('first-load')
    expect(evaluateLab(bicepIndependentLab, run).isComplete,
      JSON.stringify(evaluateLab(bicepIndependentLab, run).tasks.map(item => [item.id, item.status, item.reason]))).toBe(true)
    const secondPreview = run.runtime.bicep.previews.find(item => item.target === second.resourceGroup)
    const secondAttempt = run.runtime.bicep.attempts.find(item => item.target === second.resourceGroup)
    const firstPreview = run.runtime.bicep.previews.find(item => item.target === first.resourceGroup)
    const firstAttempt = run.runtime.bicep.attempts.find(item => item.target === first.resourceGroup)
    expect(secondPreview.sequence).toBeLessThan(secondAttempt.sequence)
    expect(secondAttempt.sequence).toBeLessThan(latest(run, 'second-request').sequence)
    expect(secondAttempt.sequence).toBeLessThan(latest(run, 'second-load').sequence)
    expect(Math.max(latest(run, 'second-request').sequence, latest(run, 'second-load').sequence)).toBeLessThan(firstPreview.sequence)
    expect(firstPreview.sequence).toBeLessThan(firstAttempt.sequence)
    expect(firstAttempt.sequence).toBeLessThan(latest(run, 'first-request').sequence)
    expect(firstAttempt.sequence).toBeLessThan(latest(run, 'first-load').sequence)
    expect(firstAttempt.operations.every(item => ['no-change', 'ignored-existing'].includes(item.changeType))).toBe(true)
    expect(latest(run, 'second-request').measurements.status).toBe(200)
    expect(latest(run, 'first-request').measurements.status).toBe(200)
    expect(latest(run, 'second-load').measurements.endReadyReplicas).toBe(4)
    expect(latest(run, 'first-load').measurements.endReadyReplicas).toBe(2)
    expect(migrateBehavioralRun(structuredClone(run), bicepIndependentLab).nextSequence).toBe(run.nextSequence)
  })

  it('rejects early first evidence, wrong pairing and a shared-source away-and-back save', () => {
    let run = fresh()
    run = act(run, { type: 'command', line: command('what-if', first) })
    run = act(run, { type: 'command', line: command('create', first) })
    run = act(run, { type: 'request', scenarioId: 'first-request' })
    expect(task(run, 'first-preview').done).toBe(false)
    expect(task(run, 'first-deploy').done).toBe(false)
    expect(task(run, 'first-request').done).toBe(false)
    const wrong = applyRunAction(run, { type: 'command', line: command('create', second).replace(second.parameterPath, first.parameterPath) }, bicepIndependentLab)
    expect(wrong.lines[0].kind).toBe('err')
    run = through('second-deploy')
    const sourcePath = 'infra/modules/app.bicep'
    const original = run.project.savedFiles[sourcePath]
    run = act(run, { type: 'save-file', path: sourcePath, text: original + '\n' })
    run = act(run, { type: 'save-file', path: sourcePath, text: original })
    expect(task(run, 'second-preview').done).toBe(false)
    expect(task(run, 'second-deploy').done).toBe(false)
  })

  it('requires fresh first proof after the ordered first reapply', () => {
    let run = fresh()
    run = act(run, { type: 'command', line: command('what-if', first) })
    run = act(run, { type: 'command', line: command('create', first) })
    run = act(run, { type: 'request', scenarioId: 'first-request' })
    run = act(run, { type: 'scenario-start', scenarioId: 'first-load' })
    run = act(run, { type: 'simulation-advance', seconds: 90 })
    for (const item of bicepIndependentLab.tasks.slice(0, 5)) for (const step of item.solution.steps)
      run = act(run, step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content }
        : step.kind === 'command' ? { type: 'command', line: step.line } : step.action)
    run = act(run, { type: 'command', line: command('what-if', first) })
    run = act(run, { type: 'command', line: command('create', first) })
    expect(task(run, 'first-deploy').done).toBe(true)
    expect(task(run, 'first-request').done).toBe(false)
    expect(task(run, 'first-load').done).toBe(false)
  })

  it('accepts equivalent module restructuring but rejects direct CLI drift from the intended second app', () => {
    let run = fresh()
    const main = run.project.savedFiles['infra/main.bicep']
    run = act(run, { type: 'save-file', path: 'infra/main.bicep', text: main.replace("name: 'app'", "name: 'staging-app-module'") })
    run = act(run, { type: 'save-file', path: second.parameterPath, text: BICEP_INDEPENDENT_SOLUTION_FILES[second.parameterPath] })
    run = act(run, { type: 'command', line: command('what-if', second) })
    expect(task(run, 'second-preview').done).toBe(true)
    run = act(run, { type: 'command', line: command('create', second) })
    expect(task(run, 'second-deploy').done).toBe(true)
    run = act(run, { type: 'command', line: `az containerapp update -g ${second.resourceGroup} -n ${second.appName} --max-replicas 5` })
    expect(task(run, 'second-deploy').done).toBe(false)
    run = through('second-deploy')
    run = act(run, { type: 'command', line: `az containerapp update -g ${second.resourceGroup} -n ${second.appName} --set-env-vars APP_ENV=cli-only` })
    expect(task(run, 'second-deploy').done).toBe(false)
  })

  it('keeps current proof through a same-target no-change reapply', () => {
    let run = through('second-load')
    expect(task(run, 'second-request').done).toBe(true)
    expect(task(run, 'second-load').done).toBe(true)
    run = act(run, { type: 'command', line: command('create', second) })
    expect(run.runtime.bicep.attempts.at(-1).operations.every(item =>
      ['no-change', 'ignored-existing'].includes(item.changeType))).toBe(true)
    expect(task(run, 'second-request').done).toBe(true)
    expect(task(run, 'second-load').done).toBe(true)
    run = through('first-load')
    run = act(run, { type: 'command', line: command('create', first) })
    expect(run.runtime.bicep.attempts.at(-1).operations.every(item =>
      ['no-change', 'ignored-existing'].includes(item.changeType))).toBe(true)
    expect(task(run, 'first-request').done).toBe(true)
    expect(task(run, 'first-load').done).toBe(true)
  })

  it('does not credit a failed second create or an old active snapshot', () => {
    let run = through('second-deploy')
    const path = 'infra/modules/app.bicep'
    run = act(run, { type: 'save-file', path,
      text: run.project.savedFiles[path].replace('targetPort: 8080', 'targetPort: 9090') })
    run = act(run, { type: 'command', line: command('what-if', second) })
    const attempted = applyRunAction(run, { type: 'command', line: command('create', second) }, bicepIndependentLab)
    expect(attempted.run.runtime.bicep.attempts.at(-1).status).toBe('failed')
    expect(attempted.run.sandbox.containerApps.some(app => app.name === second.appName)).toBe(true)
    expect(task(attempted.run, 'second-deploy').done).toBe(false)
  })

  it('rejects a forged deployment output even when the app still runs correctly', () => {
    let run = through('second-deploy')
    const path = 'infra/main.bicep'
    run = act(run, { type: 'save-file', path,
      text: run.project.savedFiles[path].replace('output foundryDeployment string = foundry.outputs.modelName',
        "output foundryDeployment string = 'spoofed'") })
    run = act(run, { type: 'command', line: command('what-if', second) })
    run = act(run, { type: 'command', line: command('create', second) })
    expect(task(run, 'second-deploy').done).toBe(false)
  })

  it('does not credit a healthy old primary app when current shared source breaks its baseline', () => {
    let run = through('second-load')
    const path = 'infra/modules/app.bicep'
    run = act(run, { type: 'save-file', path,
      text: run.project.savedFiles[path].replace('value: appEnvironment', "value: 'staging'") })
    expect(run.runtime.deploymentsByApp[BICEP_INDEPENDENT_BASELINE.appId]?.active.image).toBe(first.image)
    run = act(run, { type: 'command', line: command('what-if', first) })
    expect(task(run, 'first-preview').done).toBe(false)
    expect(task(run, 'first-deploy').done).toBe(false)
  })

  it('rejects reordered causal records and forged request or CPU measurements on reload', () => {
    const complete = through('first-load')
    const reordered = structuredClone(complete)
    const stagingLoad = latest(reordered, 'second-load')
    const firstPreview = reordered.runtime.bicep.previews.find(item => item.target === first.resourceGroup)
    const old = stagingLoad.sequence
    stagingLoad.sequence = firstPreview.sequence
    firstPreview.sequence = old
    reordered.runtime.bicep.currentByTarget[`${first.resourceGroup}/${first.deploymentName}`].preview.sequence = old
    expect(evaluateLab(bicepIndependentLab, reordered).isComplete).toBe(false)
    for (const [id, mutate] of [
      ['second-request', measurement => { measurement.status = 503 }],
      ['second-load', measurement => { measurement.endReadyReplicas = 1 }],
    ]) {
      const tampered = structuredClone(complete)
      mutate(latest(tampered, id).measurements)
      expect(evaluateLab(bicepIndependentLab, tampered).isComplete, id).toBe(false)
    }
    const reused = structuredClone(complete)
    reused.evidence.currentEvidenceByTask['first-request'] = reused.evidence.currentEvidenceByTask['second-request']
    expect(evaluateLab(bicepIndependentLab, reused).isComplete).toBe(false)
  })

  it('persists completion as one read-only Result and restarts with fresh provenance', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(bicepIndependentLab.id, { repository })
    const attempt = store.behavioralRun.attemptId
    for (const item of bicepIndependentLab.tasks) for (const step of item.solution.steps) {
      if (step.kind === 'file') await store.dispatchBehavioral({ type: 'save-file', path: step.path, text: step.content })
      else if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(step.action)
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    await expect(store.dispatchBehavioral({ type: 'request', scenarioId: 'first-request' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(store.behavioralRun.runtime.bicep.attempts).toEqual([])
  })
})
