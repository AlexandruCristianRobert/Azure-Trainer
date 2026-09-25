import { describe, expect, it } from 'vitest'
import { bicepGuidedLab } from '../src/data/labs/containerapps-journey/bicep-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { LABS, labById, nextLabFor } from '../src/data/labs/index.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const fresh = () => createBehavioralRun(bicepGuidedLab, { attemptId: 'bicep-guided-test' })
const done = (run, id) => evaluateLab(bicepGuidedLab, run).tasks.find(task => task.id === id).done
function through(last) {
  let run = fresh()
  for (const task of bicepGuidedLab.tasks) {
    for (const step of task.solution.steps) run = act(run, step)
    if (task.id === last) break
  }
  return run
}
function act(run, step) {
  const action = step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content }
    : step.kind === 'command' ? { type: 'command', line: step.line } : step.action
  const result = applyRunAction(run, action, bicepGuidedLab)
  expect(result.diagnostics, JSON.stringify(step)).toEqual([])
  expect(result.lines.filter(line => line.kind === 'err'), JSON.stringify(step)).toEqual([])
  return result.run
}

describe('guided Bicep Lab', () => {
  it('starts with only supplied ACR and published Foundry image', () => {
    const run = fresh()
    expect(run.sandbox.containerRegistries).toHaveLength(1)
    expect(run.sandbox.containerApps).toEqual([])
    expect(run.sandbox.managedIdentities).toEqual([])
    expect(run.sandbox.foundryAccounts).toEqual([])
    expect(Object.keys(run.artifacts.publishedTags)).toHaveLength(1)
    expect(run.runtime.bicep.attempts).toEqual([])
    expect(run.runtime.bicep.previews).toEqual([])
    expect(run.evidence.experimentsById).toEqual({})
    expect(evaluateLab(bicepGuidedLab, run).doneCount).toBe(0)
    expect(bicepGuidedLab).toMatchObject({ contentVersion: 1, journeyOrder: 13, labMode: 'guided' })
    expect(LABS.filter((lab) => lab.journeyId === 'containerapps-end-to-end')).toHaveLength(16)
    expect(nextLabFor(labById('aca-foundry-independent'))).toBe(bicepGuidedLab)
    expect(nextLabFor(bicepGuidedLab)?.id).toBe('aca-bicep-troubleshooting')
  })

  it('executes every displayed solution through the reducer and earns active request, scale and no-op proof', () => {
    let run = fresh()
    for (const task of bicepGuidedLab.tasks) {
      expect(task.hints.length).toBeGreaterThan(0)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      for (const step of task.solution.steps) run = act(run, step)
      expect(done(run, task.id), task.id).toBe(true)
    }
    expect(evaluateLab(bicepGuidedLab, run).isComplete).toBe(true)
    expect(run.runtime.bicep.attempts).toHaveLength(3)
    expect(run.runtime.bicep.attempts.at(-1).operations.filter(item => item.changeType === 'modify' || item.changeType === 'create')).toEqual([])
  })

  it('binds preview and deployment to saved versions, parameters and target, including changed-away-back edits', () => {
    let run = through('create')
    const path = 'infra/modules/app.bicep'
    const original = run.project.savedFiles[path]
    run = act(run, { kind: 'file', path, content: original.replace('maxReplicas: 2', 'maxReplicas: 3') })
    expect(done(run, 'preview')).toBe(false)
    expect(done(run, 'request')).toBe(false)
    run = act(run, { kind: 'file', path, content: original })
    expect(done(run, 'preview')).toBe(false)
    expect(done(run, 'request')).toBe(false)
    const draft = applyRunAction(run, { type: 'draft', path, text: original.replace('maxReplicas: 2', 'maxReplicas: 8') }, bicepGuidedLab).run
    expect(done(draft, 'preview')).toBe(false)
    run = act(run, bicepGuidedLab.tasks.find(task => task.id === 'preview').solution.steps[0])
    expect(done(run, 'preview')).toBe(true)
    expect(done(run, 'request')).toBe(false)
    const wrong = applyRunAction(run, { type: 'command', line: 'az deployment group what-if --name second --resource-group rg-aca-bicep --template-file infra/main.bicep --parameters infra/first.bicepparam' }, bicepGuidedLab)
    expect(wrong.lines.some(line => line.kind === 'err')).toBe(false)
    expect(done(wrong.run, 'preview')).toBe(true)
    run = act(run, { kind: 'file', path: 'infra/first.bicepparam', content: run.project.savedFiles['infra/first.bicepparam'].replace("param imageTag = 'v1'", "param imageTag = 'v2'") })
    expect(done(run, 'preview')).toBe(false)
    expect(done(run, 'request')).toBe(false)
  })

  it('rejects literal Foundry output spoofing, and source success alone never earns request or load', () => {
    let run = through('parameters')
    expect(done(run, 'request')).toBe(false)
    expect(done(run, 'load')).toBe(false)
    const path = 'infra/modules/app.bicep'
    const spoof = run.project.savedFiles[path].replace('value: foundryEndpoint', "value: 'https://foundrybicepguided.services.ai.azure.com/openai/v1/'")
    run = act(run, { kind: 'file', path, content: spoof })
    const result = applyRunAction(run, { type: 'command', line: bicepGuidedLab.tasks.find(task => task.id === 'validate').solution.steps[0].line }, bicepGuidedLab)
    expect(result.lines.some(line => line.kind === 'err')).toBe(true)
    expect(result.run.sandbox.containerApps).toEqual([])
    expect(done(result.run, 'connect')).toBe(false)
  })

  it('keeps final request and load evidence current through an unchanged reapply and rejects CLI-only fixes', () => {
    let run = through('load')
    expect(done(run, 'request')).toBe(false)
    expect(done(run, 'load')).toBe(true)
    for (const step of bicepGuidedLab.tasks.find(task => task.id === 'idempotent').solution.steps) run = act(run, step)
    expect(done(run, 'request')).toBe(true)
    expect(done(run, 'load')).toBe(true)
    expect(done(run, 'idempotent')).toBe(true)
    const generation = run.runtime.deploymentsByApp[bicepGuidedLab.scenarios.valid.appId].active.generation
    run = act(run, { kind: 'command', line: bicepGuidedLab.tasks.find(task => task.id === 'idempotent').solution.steps[0].line })
    expect(run.runtime.deploymentsByApp[bicepGuidedLab.scenarios.valid.appId].active.generation).toBe(generation)
    expect(done(run, 'request')).toBe(true)
    expect(done(run, 'load')).toBe(true)
  })

  it('reloads deployment provenance and preserves one read-only Result across Restart', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(bicepGuidedLab.id, { repository })
    const attempt = store.behavioralRun.attemptId
    for (const task of bicepGuidedLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') await store.dispatchBehavioral({ type: 'save-file', path: step.path, text: step.content })
      else if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(step.action)
    }
    expect(store.isComplete).toBe(true)
    expect(store.behavioralRun.runtime.bicep.attempts).toHaveLength(3)
    expect(repository.results).toHaveLength(1)
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.behavioralRun.runtime.bicep.attempts).toHaveLength(3)
    await expect(store.dispatchBehavioral({ type: 'request', scenarioId: 'valid' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(store.behavioralRun.runtime.bicep.attempts).toEqual([])
    expect(repository.results).toHaveLength(1)
  })

  it('records a partial non-app failure while keeping the previous active app snapshot', () => {
    let run = through('create')
    const appId = bicepGuidedLab.scenarios.valid.appId
    const active = run.runtime.deploymentsByApp[appId].active
    const paramPath = 'infra/first.bicepparam'
    run = act(run, { kind: 'file', path: paramPath, content: run.project.savedFiles[paramPath].replace("param environmentName = 'env-bicep'", "param environmentName = 'alternate-env'") })
    const appPath = 'infra/modules/app.bicep'
    run = act(run, { kind: 'file', path: appPath, content: run.project.savedFiles[appPath].replace('targetPort: 8080', 'targetPort: 9090') })
    const create = bicepGuidedLab.tasks.find(task => task.id === 'create').solution.steps[0]
    run = applyRunAction(run, { type: 'command', line: create.line }, bicepGuidedLab).run
    expect(run.runtime.bicep.attempts.at(-1).status).toBe('failed')
    expect(run.runtime.bicep.attempts.at(-1).operations).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'Microsoft.App/managedEnvironments', changeType: 'create' })]))
    expect(run.sandbox.containerAppEnvironments.some(item => item.name === 'alternate-env')).toBe(true)
    expect(run.runtime.deploymentsByApp[appId].active).toEqual(active)
    expect(done(run, 'request')).toBe(false)
  })

  it('accepts an equivalent module instance edit and does not credit a direct CLI scale change', () => {
    let run = through('parameters')
    const mainPath = 'infra/main.bicep'
    run = act(run, { kind: 'file', path: mainPath, content: run.project.savedFiles[mainPath].replace("name: 'app'", "name: 'first-app-module'") })
    expect(done(run, 'connect')).toBe(true)
    for (const task of bicepGuidedLab.tasks.slice(2, 5)) for (const step of task.solution.steps) run = act(run, step)
    expect(done(run, 'create')).toBe(true)
    run = act(run, { kind: 'command', line: 'az containerapp update -g rg-aca-bicep -n api-bicep --max-replicas 5' })
    expect(done(run, 'change')).toBe(false)
    expect(done(run, 'update-create')).toBe(false)
    expect(done(run, 'load')).toBe(false)
  })
  it('requires successful validate and deployment show observations, not just saved source or create', () => {
    let run = through('parameters')
    expect(done(run, 'validate')).toBe(false)
    expect(done(run, 'inspect')).toBe(false)
    run = act(run, bicepGuidedLab.tasks.find(task => task.id === 'validate').solution.steps[0])
    expect(done(run, 'validate')).toBe(true)
    for (const task of bicepGuidedLab.tasks.slice(3, 5)) for (const step of task.solution.steps) run = act(run, step)
    expect(done(run, 'create')).toBe(true)
    expect(done(run, 'inspect')).toBe(false)
    run = act(run, bicepGuidedLab.tasks.find(task => task.id === 'inspect').solution.steps[0])
    expect(done(run, 'inspect')).toBe(false)
    run = act(run, bicepGuidedLab.tasks.find(task => task.id === 'inspect').solution.steps[1])
    expect(done(run, 'inspect')).toBe(true)
  })

  it('keeps the supplied published artifact fixed after Lab start', () => {
    const run = fresh()
    const published = structuredClone(run.artifacts)
    const result = applyRunAction(run, { type: 'command', line: 'az acr build --registry acrbicepguided --image api:v1 --file Dockerfile .' }, bicepGuidedLab)
    expect(result.lines.some(line => line.kind === 'err')).toBe(true)
    expect(result.run.artifacts).toEqual(published)
  })
})
