import { describe, expect, it } from 'vitest'
import { deployGuidedLab } from '../src/data/labs/containerapps-journey/deploy-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/starter.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { useProgressStore } from '../src/stores/progress.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

function act(run, action) {
  const result = applyRunAction(run, action, deployGuidedLab)
  expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(action)).toEqual([])
  expect(result.diagnostics, JSON.stringify(action)).toEqual([])
  return result.run
}

function applySolution(run, solution) {
  return solution.steps.reduce((next, step) => {
    if (step.kind === 'file') return act(act(next, { type: 'draft', path: step.path, text: step.content }), { type: 'save-file', path: step.path })
    if (step.kind === 'command') return act(next, { type: 'command', line: step.line })
    return act(next, { type: 'request', ...step.request })
  }, run)
}

describe('guided Container Apps Lab', () => {
  it('publishes a three-stage journey with structured assistance', () => {
    expect(deployGuidedLab).toMatchObject({ engineVersion: 2, contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 1, labMode: 'guided', status: 'available' })
    expect(deployGuidedLab.stages.map((stage) => stage.title)).toEqual(['Prepare', 'Publish', 'Deploy and verify'])
    for (const task of deployGuidedLab.tasks) {
      expect(task.hints).toHaveLength(2)
      expect(task.examNote.length).toBeGreaterThan(0)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      expect(task.solution.steps.every((step) => ['file', 'command', 'experiment'].includes(step.kind))).toBe(true)
    }
  })

  it('executes every worked Solution through run actions and verifies the actual response', () => {
    let run = createBehavioralRun(deployGuidedLab, { attemptId: 'guided-1' })
    for (const [index, task] of deployGuidedLab.tasks.entries()) {
      expect(evaluateLab(deployGuidedLab, run).tasks[index].done).toBe(false)
      run = applySolution(run, task.solution)
      expect(evaluateLab(deployGuidedLab, run).tasks[index].done, task.id).toBe(true)
    }
    expect(evaluateLab(deployGuidedLab, run).isComplete).toBe(true)
    const evidence = Object.values(run.evidence.experimentsById)
    expect(evidence.at(-1)).toMatchObject({ outcome: 'passed', measurements: { status: 200, body: { service: 'contoso-api', environment: 'training' } } })
  })

  it('judges saved source semantics and keeps a failed desired update from satisfying deployment', () => {
    let run = createBehavioralRun(deployGuidedLab, { attemptId: 'guided-2' })
    for (const task of deployGuidedLab.tasks.slice(0, -1)) run = applySolution(run, task.solution)
    run = act(run, { type: 'draft', path: 'src/Trainer.Api/Program.cs', text: SOLUTION_FILES['src/Trainer.Api/Program.cs'].replace('var app =', 'var app =') + '\n' })
    expect(evaluateLab(deployGuidedLab, run).tasks.find((task) => task.id === 'source').done).toBe(true)
    run = applyRunAction(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --image acrguided.azurecr.io/api:missing' }, deployGuidedLab).run
    expect(Object.values(run.runtime.deploymentsByApp)[0].status).toBe('failed')
    expect(evaluateLab(deployGuidedLab, run).tasks.find((task) => task.id === 'deployment').done).toBe(false)
  })

  it('requires a fresh request after a failed desired update is repaired', () => {
    let run = createBehavioralRun(deployGuidedLab, { attemptId: 'guided-5' })
    for (const task of deployGuidedLab.tasks.slice(0, -1)) run = applySolution(run, task.solution)
    run = applyRunAction(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --image acrguided.azurecr.io/api:missing' }, deployGuidedLab).run
    run = applySolution(run, deployGuidedLab.tasks.at(-1).solution)
    expect(Object.values(run.evidence.experimentsById).at(-1).outcome).toBe('passed')
    expect(evaluateLab(deployGuidedLab, run).tasks.at(-1).done).toBe(false)
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-guided -n api-guided --image acrguided.azurecr.io/api:v1' })
    expect(evaluateLab(deployGuidedLab, run).tasks.at(-1).status).toBe('needs-verification')
    run = applySolution(run, deployGuidedLab.tasks.at(-1).solution)
    expect(evaluateLab(deployGuidedLab, run).isComplete).toBe(true)
  })

  it('rejects a literal environment but accepts an equivalent supported service expression', () => {
    let run = createBehavioralRun(deployGuidedLab, { attemptId: 'guided-3' })
    run = applySolution(run, deployGuidedLab.tasks[0].solution)
    const path = 'src/Trainer.Api/Program.cs'
    const literalEnvironment = SOLUTION_FILES[path].replace('builder.Configuration["APP_ENV"]', '"training"')
    run = act(run, { type: 'save-file', path, text: literalEnvironment })
    expect(evaluateLab(deployGuidedLab, run).tasks.find((task) => task.id === 'source').done).toBe(false)
    const literalService = SOLUTION_FILES[path].replace('AppSettings.ServiceName', '"contoso-api"')
    run = act(run, { type: 'save-file', path, text: literalService })
    expect(evaluateLab(deployGuidedLab, run).tasks.find((task) => task.id === 'source').done).toBe(true)
  })

  it('accepts the actual inline service response even when AppSettings is unused', () => {
    let run = createBehavioralRun(deployGuidedLab, { attemptId: 'guided-inline' })
    const path = 'src/Trainer.Api/Program.cs'
    run = act(run, { type: 'save-file', path, text: SOLUTION_FILES[path].replace('AppSettings.ServiceName', '\"contoso-api\" /* inline */') })
    run = act(run, { type: 'save-file', path: 'src/Trainer.Api/AppSettings.cs',
      text: SOLUTION_FILES['src/Trainer.Api/AppSettings.cs'].replace('contoso-api', 'unused-constant') })
    expect(evaluateLab(deployGuidedLab, run).tasks.find((task) => task.id === 'source').done).toBe(true)
  })

  it('accepts case variants of resource names through request verification', () => {
    let run = createBehavioralRun(deployGuidedLab, { attemptId: 'guided-4' })
    for (const task of deployGuidedLab.tasks) {
      const solution = { steps: task.solution.steps.map((step) => step.kind === 'command'
        ? { ...step, line: step.line.replaceAll('rg-aca-guided', 'RG-ACA-GUIDED') }
        : step) }
      run = applySolution(run, solution)
    }
    expect(evaluateLab(deployGuidedLab, run).isComplete).toBe(true)
  })

  it('persists assistance, resumes, commits one Result and restarts as a new run', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const native = behavioralRepository(), store = useLabRunStore()
    await store.load(deployGuidedLab.id, { repository: native })
    await store.revealHint('source')
    await store.revealSolution('source')
    expect(store.doneCount).toBe(0)
    const attempt = store.behavioralRun.attemptId
    await store.load(deployGuidedLab.id, { repository: native })
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.hintsUsed).toBe(1)
    for (const task of deployGuidedLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') { await store.dispatchBehavioral({ type: 'draft', path: step.path, text: step.content }); await store.dispatchBehavioral({ type: 'save-file', path: step.path }) }
      else if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral({ type: 'request', ...step.request })
    }
    expect(store.isComplete).toBe(true)
    expect(native.results).toHaveLength(1)
    expect(useProgressStore().latestResult(deployGuidedLab.id)).toMatchObject({ id: store.resultId, hintsUsed: 1, solutionsUsed: 1 })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(native.results).toHaveLength(1)
  })

  it('keeps the session when Pinia invokes actions through different forwarding proxies', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const native = behavioralRepository(), store = useLabRunStore()
    await new Proxy(store, {}).load(deployGuidedLab.id, { repository: native })
    await new Proxy(store, {}).revealHint('source')
    await new Proxy(store, {}).execute('az group create -n rg-aca-guided -l eastus')
    expect(store.behavioralRun.revision).toBeGreaterThan(1)
    expect(store.behavioralRun.hintsRevealed.source).toBe(1)
    expect(store.behavioralRun.sandbox.resourceGroups).toHaveLength(1)
    expect(localStorage.getItem(`at_run_${deployGuidedLab.id}`)).toBeNull()
  })
})
