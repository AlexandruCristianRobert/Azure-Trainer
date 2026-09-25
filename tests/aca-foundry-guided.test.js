import { describe, expect, it } from 'vitest'
import { foundryGuidedLab } from '../src/data/labs/containerapps-journey/foundry-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { LABS, nextLabFor, labById } from '../src/data/labs/index.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const fresh = () => createBehavioralRun(foundryGuidedLab, { attemptId: 'foundry-guided-test' })
function act(run, action) {
  const result = applyRunAction(run, action, foundryGuidedLab)
  if (action.type !== 'request') {
    expect(result.diagnostics, JSON.stringify(action)).toEqual([])
    expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(action)).toEqual([])
  }
  return result.run
}
const done = (run, id) => evaluateLab(foundryGuidedLab, run).tasks.find((task) => task.id === id).done

describe('guided Foundry integration Lab', () => {
  it('starts with a healthy private API but no Foundry resources or proof', () => {
    const run = fresh()
    expect(foundryGuidedLab).toMatchObject({ engineVersion: 2, contentVersion: 1, journeyOrder: 10, labMode: 'guided', capabilities: { foundryInference: true } })
    expect(run.sandbox.containerApps).toHaveLength(1)
    expect(run.sandbox.foundryAccounts).toEqual([])
    expect(run.evidence.experimentsById).toEqual({})
    expect(run.runtime.deploymentsByApp[foundryGuidedLab.scenarios.valid.appId].active).toBeTruthy()
    expect(evaluateLab(foundryGuidedLab, run).doneCount).toBe(0)
    expect(LABS.filter((lab) => lab.journeyId === 'containerapps-end-to-end')).toHaveLength(16)
    expect(nextLabFor(labById('aca-probes-independent'))).toBe(foundryGuidedLab)
    expect(nextLabFor(foundryGuidedLab)).toBe(labById('aca-foundry-troubleshooting'))
  })

  it('completes every worked solution and records the intended invocation and validation short circuit', () => {
    let run = fresh()
    for (const task of foundryGuidedLab.tasks) {
      expect(task.hints.length).toBeGreaterThan(0)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      expect(task.examNote).toBeTruthy()
      for (const step of task.solution.steps) {
        run = act(run, step.kind === 'command' ? { type: 'command', line: step.line }
          : step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content } : step.action)
      }
      expect(done(run, task.id), task.id).toBe(true)
    }
    const valid = run.evidence.experimentsById[run.evidence.currentEvidenceByTask.valid].measurements
    expect(valid).toMatchObject({ status: 200, body: { deployment: 'summarizer-primary' } })
    expect(valid.upstream.attempts).toHaveLength(1)
    const invalid = run.evidence.experimentsById[run.evidence.currentEvidenceByTask.invalid].measurements
    expect(invalid.status).toBe(400)
    expect(invalid.upstream.attempts).toEqual([])
    expect(evaluateLab(foundryGuidedLab, run).isComplete).toBe(true)
  })

  it('holds inference proof until the role and captured source are ready, then invalidates it after a grant change', () => {
    let run = fresh()
    const tasks = foundryGuidedLab.tasks
    for (const task of tasks.slice(0, 2)) for (const step of task.solution.steps) run = act(run, { type: 'command', line: step.line })
    run = act(run, { type: 'request', scenarioId: 'valid' })
    expect(done(run, 'valid')).toBe(false)
    for (const task of tasks.slice(2, 4)) for (const step of task.solution.steps) run = act(run,
      step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content } : { type: 'command', line: step.line })
    run = act(run, { type: 'request', scenarioId: 'valid' })
    expect(done(run, 'valid')).toBe(true)
    const grant = tasks[2].solution.steps[0].line
    run = act(run, { type: 'command', line: grant.replace('assignment create', 'assignment delete').replace(' --assignee-principal-type ServicePrincipal', '') })
    expect(done(run, 'valid')).toBe(false)
  })

  it('keeps the active capture through draft and build, rejects the project endpoint, then accepts repair', () => {
    let run = fresh()
    for (const task of foundryGuidedLab.tasks.slice(0, 4)) for (const step of task.solution.steps) run = act(run,
      step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content } : { type: 'command', line: step.line })
    run = act(run, { type: 'request', scenarioId: 'valid' })
    expect(done(run, 'valid')).toBe(true)
    const generation = run.runtime.deploymentsByApp[foundryGuidedLab.scenarios.valid.appId].active.generation
    const settings = 'src/Trainer.Api/appsettings.json'
    const wrong = run.project.savedFiles[settings].replace('https://foundryguided.services.ai.azure.com/openai/v1/', 'https://foundryguided.services.ai.azure.com/api/projects/summarizer-project')
    run = act(run, { type: 'draft', path: settings, text: wrong })
    expect(done(run, 'valid')).toBe(true)
    run = act(run, { type: 'save-file', path: settings, text: wrong })
    const build = foundryGuidedLab.tasks[3].solution.steps[1].line
    const deploy = foundryGuidedLab.tasks[3].solution.steps[2].line
    const failedBuild = applyRunAction(run, { type: 'command', line: build }, foundryGuidedLab)
    expect(failedBuild.lines.some((line) => line.kind === 'err')).toBe(true)
    expect(done(failedBuild.run, 'valid')).toBe(true)
    expect(failedBuild.run.runtime.deploymentsByApp[foundryGuidedLab.scenarios.valid.appId].active.generation).toBe(generation)
    run = act(failedBuild.run, { type: 'save-file', path: settings, text: foundryGuidedLab.tasks[3].solution.steps[0].content })
    run = act(run, { type: 'command', line: build })
    run = act(run, { type: 'command', line: deploy })
    expect(done(run, 'valid')).toBe(false)
    run = act(run, { type: 'request', scenarioId: 'valid' })
    expect(done(run, 'valid')).toBe(true)
  })

  it('persists one read-only Result, then restarts without carrying proof into the new attempt', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(foundryGuidedLab.id, { repository })
    const attempt = store.behavioralRun.attemptId
    for (const task of foundryGuidedLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') await store.dispatchBehavioral({ type: 'save-file', path: step.path, text: step.content })
      else if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(step.action)
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    await expect(store.dispatchBehavioral({ type: 'request', scenarioId: 'valid' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(store.behavioralRun.evidence.experimentsById).toEqual({})
    expect(repository.results).toHaveLength(1)
  })
})
