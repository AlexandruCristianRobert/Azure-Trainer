import { describe, expect, it } from 'vitest'
import { deployIndependentLab } from '../src/data/labs/containerapps-journey/deploy-independent.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { STARTER_FILES, SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/starter.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { useProgressStore } from '../src/stores/progress.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

const taskDone = (run, id) => evaluateLab(deployIndependentLab, run).tasks.find((task) => task.id === id)?.done
function act(run, action, { failure = false } = {}) {
  const result = applyRunAction(run, action, deployIndependentLab)
  if (!failure) {
    expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(action)).toEqual([])
    expect(result.diagnostics, JSON.stringify(action)).toEqual([])
  }
  return result.run
}
function solution(run, task) {
  return task.solution.steps.reduce((current, step) => {
    if (step.kind === 'file') return act(act(current, { type: 'draft', path: step.path, text: step.content }), { type: 'save-file', path: step.path })
    if (step.kind === 'command') return act(current, { type: 'command', line: step.line })
    return act(current, { type: 'request', ...step.request })
  }, run)
}
const completePrerequisites = () => deployIndependentLab.tasks.slice(0, -1).reduce(solution, createBehavioralRun(deployIndependentLab, { attemptId: 'prerequisites' }))

describe('independent Container Apps Lab', () => {
  it('starts from the reusable starter with an empty Sandbox and six requirement outcomes', () => {
    expect(deployIndependentLab).toMatchObject({ id: 'aca-deploy-independent', engineVersion: 2,
      contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 3,
      labMode: 'independent', skillAreaId: 'containers' })
    expect(deployIndependentLab.stages.map((stage) => stage.title)).toEqual(['Deployment requirements'])
    expect(deployIndependentLab.tasks).toHaveLength(6)
    for (const task of deployIndependentLab.tasks) {
      expect(task.hints).toHaveLength(2)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      expect(task.examNote.length).toBeGreaterThan(0)
    }
    const run = createBehavioralRun(deployIndependentLab, { attemptId: 'independent' })
    expect(run.project.savedFiles).toEqual(STARTER_FILES)
    expect(run.sandbox.containerApps).toEqual([])
    expect(run.sandbox.containerRegistries).toEqual([])
    expect(run.artifacts.publishedTags).toEqual({})
    expect(run.evidence.experimentsById).toEqual({})
    expect(evaluateLab(deployIndependentLab, run).isComplete).toBe(false)
  })

  it('executes all optional Solutions and observes the required running response', () => {
    let run = createBehavioralRun(deployIndependentLab, { attemptId: 'worked' })
    for (const task of deployIndependentLab.tasks) run = solution(run, task)
    expect(evaluateLab(deployIndependentLab, run).isComplete).toBe(true)
    expect(Object.values(run.evidence.experimentsById).at(-1)).toMatchObject({ outcome: 'passed',
      measurements: { status: 200, body: { service: 'orders-api', environment: 'staging' } } })
  })

  it('accepts infrastructure first and an inline service expression with unused old settings', () => {
    let run = createBehavioralRun(deployIndependentLab, { attemptId: 'alternative' })
    run = solution(run, deployIndependentLab.tasks[2])
    const sourceTask = deployIndependentLab.tasks[0]
    for (const step of sourceTask.solution.steps) {
      const content = step.path.endsWith('Program.cs')
        ? SOLUTION_FILES[step.path].replace('AppSettings.ServiceName', '"orders-api" /* response name */')
        : step.path.endsWith('AppSettings.cs') ? SOLUTION_FILES[step.path] : step.content
      run = act(run, { type: 'save-file', path: step.path, text: content })
    }
    expect(taskDone(run, 'source')).toBe(true)
    run = solution(run, deployIndependentLab.tasks[1])
    run = solution(run, deployIndependentLab.tasks[3])
    expect(taskDone(run, 'artifact')).toBe(true)
    run = solution(run, deployIndependentLab.tasks[4])
    run = solution(run, deployIndependentLab.tasks[5])
    expect(evaluateLab(deployIndependentLab, run).isComplete).toBe(true)
  })

  it('rejects hardcoded staging and old Guided source and Docker values', () => {
    let run = createBehavioralRun(deployIndependentLab, { attemptId: 'old-values' })
    run = act(run, { type: 'save-file', path: 'src/Trainer.Api/Program.cs', text: SOLUTION_FILES['src/Trainer.Api/Program.cs'] })
    expect(taskDone(run, 'source')).toBe(false)
    const hardcoded = SOLUTION_FILES['src/Trainer.Api/Program.cs'].replace('builder.Configuration["APP_ENV"]', '"staging"')
    run = act(run, { type: 'save-file', path: 'src/Trainer.Api/Program.cs', text: hardcoded })
    run = act(run, { type: 'save-file', path: 'src/Trainer.Api/AppSettings.cs', text: SOLUTION_FILES['src/Trainer.Api/AppSettings.cs'].replace('contoso-api', 'orders-api') })
    run = act(run, { type: 'save-file', path: 'src/Trainer.Api/appsettings.json', text: '{"ListeningPort":9090}' })
    expect(taskDone(run, 'source')).toBe(false)
    run = act(run, { type: 'save-file', path: 'src/Trainer.Api/Program.cs', text: SOLUTION_FILES['src/Trainer.Api/Program.cs'] })
    expect(taskDone(run, 'source')).toBe(true)
    expect(taskDone(run, 'docker')).toBe(false)
  })

  it('keeps draft, saved, built, published and active versions distinct', () => {
    let run = completePrerequisites()
    expect(taskDone(run, 'deployment')).toBe(true)
    const oldBuild = Object.values(run.artifacts.publishedTags)[0]
    const oldActive = Object.values(run.runtime.deploymentsByApp)[0].active.artifactId
    const path = 'src/Trainer.Api/AppSettings.cs'
    run = act(run, { type: 'draft', path, text: SOLUTION_FILES[path] })
    expect(taskDone(run, 'source')).toBe(true)
    expect(Object.values(run.artifacts.publishedTags)[0]).toBe(oldBuild)
    run = act(run, { type: 'save-file', path })
    expect(taskDone(run, 'source')).toBe(false)
    expect(Object.values(run.artifacts.publishedTags)[0]).toBe(oldBuild)
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.artifactId).toBe(oldActive)
    run = act(run, { type: 'command', line: deployIndependentLab.tasks[3].solution.steps[0].line })
    const rebuilt = Object.values(run.artifacts.publishedTags)[0]
    expect(rebuilt).not.toBe(oldBuild)
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.artifactId).toBe(oldActive)
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-independent -n api-independent --image acrindependent.azurecr.io/orders:v2' })
    expect(Object.values(run.runtime.deploymentsByApp)[0].active.artifactId).toBe(rebuilt)
    expect(taskDone(run, 'deployment')).toBe(false)
  })

  it('does not borrow a passing old active request after a failed desired update', () => {
    let run = completePrerequisites()
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-independent -n api-independent --image acrindependent.azurecr.io/orders:missing' }, { failure: true })
    run = solution(run, deployIndependentLab.tasks.at(-1))
    expect(Object.values(run.evidence.experimentsById).at(-1).outcome).toBe('passed')
    expect(evaluateLab(deployIndependentLab, run).isComplete).toBe(false)
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-independent -n api-independent --image acrindependent.azurecr.io/orders:v2' })
    expect(taskDone(run, 'response')).toBe(false)
    run = solution(run, deployIndependentLab.tasks.at(-1))
    expect(evaluateLab(deployIndependentLab, run).isComplete).toBe(true)
  })

  it('rejects invalid builds atomically and reports a target-port mismatch', () => {
    let run = createBehavioralRun(deployIndependentLab, { attemptId: 'failures' })
    run = solution(run, deployIndependentLab.tasks[0])
    run = solution(run, deployIndependentLab.tasks[2])
    run = act(run, { type: 'save-file', path: 'Dockerfile', text: STARTER_FILES.Dockerfile })
    const failed = applyRunAction(run, { type: 'command', line: deployIndependentLab.tasks[3].solution.steps[0].line }, deployIndependentLab)
    expect(failed.diagnostics.length).toBeGreaterThan(0)
    expect(failed.run.artifacts.publishedTags).toEqual({})
    run = solution(failed.run, deployIndependentLab.tasks[1])
    run = solution(run, deployIndependentLab.tasks[3])
    const wrongPort = deployIndependentLab.tasks[4].solution.steps[0].line.replace('--target-port 9090', '--target-port 8080')
    run = act(run, { type: 'command', line: wrongPort }, { failure: true })
    expect(Object.values(run.runtime.deploymentsByApp)[0].diagnostics[0].code).toBe('TARGET_PORT_MISMATCH')
    expect(taskDone(run, 'deployment')).toBe(false)
  })

  it('requires a fresh correct response after runtime environment repair', () => {
    let run = createBehavioralRun(deployIndependentLab, { attemptId: 'runtime-config' })
    for (const task of deployIndependentLab.tasks.slice(0, 4)) run = solution(run, task)
    const wrongEnv = deployIndependentLab.tasks[4].solution.steps[0].line.replace('APP_ENV=staging', 'APP_ENV=training')
    run = act(run, { type: 'command', line: wrongEnv })
    run = solution(run, deployIndependentLab.tasks[5])
    expect(Object.values(run.evidence.experimentsById).at(-1)).toMatchObject({
      outcome: 'failed', measurements: { status: 200, body: { service: 'orders-api', environment: 'training' } },
    })
    expect(taskDone(run, 'response')).toBe(false)
    run = act(run, { type: 'command', line: 'az containerapp update -g rg-aca-independent -n api-independent --set-env-vars APP_ENV=staging' })
    expect(taskDone(run, 'response')).toBe(false)
    run = solution(run, deployIndependentLab.tasks[5])
    expect(evaluateLab(deployIndependentLab, run).isComplete).toBe(true)
  })

  it('resumes partial progress and assistance, commits one Result, then restarts fresh', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const native = behavioralRepository(), store = useLabRunStore()
    await store.load(deployIndependentLab.id, { repository: native })
    await store.revealHint('source')
    await store.revealSolution('source')
    await store.dispatchBehavioral({ type: 'command', line: 'az group create -n rg-aca-independent -l eastus' })
    const attempt = store.behavioralRun.attemptId
    await store.load(deployIndependentLab.id, { repository: native })
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.behavioralRun.sandbox.resourceGroups).toHaveLength(1)
    expect(store.hintsUsed).toBe(1)
    for (const task of deployIndependentLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') {
        await store.dispatchBehavioral({ type: 'draft', path: step.path, text: step.content })
        await store.dispatchBehavioral({ type: 'save-file', path: step.path })
      } else if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral({ type: 'request', ...step.request })
    }
    expect(store.isComplete).toBe(true)
    expect(native.results).toHaveLength(1)
    expect(useProgressStore().latestResult(deployIndependentLab.id)).toMatchObject({
      hintsUsed: 1, solutionsUsed: 1, tasksDone: 6, total: 6,
    })
    await expect(store.dispatchBehavioral({ type: 'hint', taskId: 'response' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.behavioralRun.sandbox.containerRegistries).toEqual([])
    expect(store.behavioralRun.artifacts.publishedTags).toEqual({})
    expect(native.results).toHaveLength(1)
  })
})
