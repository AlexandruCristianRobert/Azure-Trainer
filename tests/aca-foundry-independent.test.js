import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { foundryIndependentLab as lab } from '../src/data/labs/containerapps-journey/foundry-independent.lab.js'
import { LABS, labById, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const fresh = () => createBehavioralRun(lab, { attemptId: 'brief-independent-test' })
const done = (run, id) => evaluateLab(lab, run).tasks.find((task) => task.id === id).done
const actionFor = (step) => step.kind === 'command' ? { type: 'command', line: step.line }
  : step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content } : step.action
function act(run, action, failed = false) {
  const result = applyRunAction(run, action, lab)
  if (!failed && action.type !== 'request') {
    expect(result.lines.filter((line) => line.kind === 'err'), JSON.stringify(action)).toEqual([])
    expect(result.diagnostics, JSON.stringify(action)).toEqual([])
  }
  return result.run
}
const solve = (run, task) => task.solution.steps.reduce((current, step) => act(current, actionFor(step)), run)
const prepared = () => lab.tasks.filter((task) => !task.verification).reduce(solve, fresh())

describe('independent Foundry Lab', () => {
  it('seeds a private API with distinct attached pull and unattached inference identities, without Foundry or proof', () => {
    const run = fresh()
    expect(lab).toMatchObject({ engineVersion: 2, contentVersion: 1, journeyOrder: 12, labMode: 'independent' })
    expect(LABS).toHaveLength(22)
    expect(nextLabFor(labById('aca-foundry-troubleshooting'))).toBe(lab)
    expect(nextLabFor(lab)).toBe(labById('aca-bicep-guided'))
    expect(run.sandbox.foundryAccounts).toEqual([])
    expect(run.sandbox.managedIdentities).toHaveLength(2)
    expect(run.sandbox.containerApps).toHaveLength(1)
    const app = run.sandbox.containerApps[0]
    const [pull, inference] = run.sandbox.managedIdentities
    expect(app.userAssigned).toContain(pull.id)
    expect(app.userAssigned).not.toContain(inference.id)
    expect(app.registryIdentity).toBe(pull.id)
    expect(run.sandbox.roleAssignments).toEqual([expect.objectContaining({ scope: run.sandbox.containerRegistries[0].id,
      principalId: pull.principalId, roleName: 'AcrPull' })])
    expect(run.runtime.deploymentsByApp[lab.scenarios.valid.appId].active.appSpec.foundry).toBeNull()
    expect(run.evidence.experimentsById).toEqual({})
    expect(run.hintsRevealed).toEqual({})
    expect(evaluateLab(lab, run).doneCount).toBe(0)
  })

  it('executes every optional Solution and proves all four independent request outcomes', () => {
    let run = fresh()
    for (const task of lab.tasks) {
      expect(task.hints.length).toBeGreaterThan(0)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      expect(task.examNote).toBeTruthy()
      run = solve(run, task)
      expect(done(run, task.id), task.id).toBe(true)
    }
    const measurement = (id) => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]].measurements
    expect(measurement('valid')).toMatchObject({ status: 200, path: '/api/brief',
      body: { deployment: 'briefing-secondary' } })
    expect(measurement('valid').body).toHaveProperty('brief')
    expect(measurement('valid').upstream.attempts).toHaveLength(1)
    expect(measurement('invalid')).toMatchObject({ status: 400, upstream: { attempts: [] } })
    expect(measurement('transient').status).toBe(200)
    expect(measurement('transient').upstream.attempts.map((attempt) => attempt.status)).toEqual([429, 200])
    expect(measurement('persistent').status).toBe(503)
    expect(measurement('persistent').upstream.attempts).toHaveLength(3)
    expect(evaluateLab(lab, run).isComplete).toBe(true)
  })

  it('accepts a second supported policy and keeps source, build, deployment, and proof distinct', () => {
    let run = prepared()
    const settingsPath = 'src/Trainer.Api/appsettings.json'
    const old = run.project.savedFiles[settingsPath]
    const alternative = old.replace('"TotalAttempts": 3', '"TotalAttempts": 2')
      .replace('"TotalBudgetSeconds": 8', '"TotalBudgetSeconds": 5')
      .replace('"AttemptTimeoutSeconds": 2', '"AttemptTimeoutSeconds": 1')
    run = act(run, { type: 'draft', path: settingsPath, text: alternative })
    run = act(run, { type: 'save-file', path: settingsPath })
    run = act(run, actionFor(lab.tasks.find((task) => task.id === 'deploy').solution.steps.at(-2)))
    expect(run.runtime.deploymentsByApp[lab.scenarios.valid.appId].active.appSpec.foundry.maxAttempts).toBe(3)
    run = act(run, actionFor(lab.tasks.find((task) => task.id === 'deploy').solution.steps.at(-1)))
    for (const task of lab.tasks.filter((task) => task.verification)) run = solve(run, task)
    const persistent = run.evidence.experimentsById[run.evidence.currentEvidenceByTask.persistent]
    expect(persistent.measurements.upstream.attempts).toHaveLength(2)
    expect(persistent.endedAtMs - persistent.startedAtMs).toBeLessThanOrEqual(5000)
    expect(evaluateLab(lab, run).isComplete).toBe(true)
  })

  it('does not grant proof for invalid input without inference access, a pull caller, or a wrong account', () => {
    let run = fresh()
    run = act(run, { type: 'request', scenarioId: 'invalid' })
    expect(done(run, 'invalid')).toBe(false)
    run = prepared()
    const account = run.sandbox.foundryAccounts[0]
    const [pull, inference] = run.sandbox.managedIdentities
    const denied = { ...run, sandbox: { ...run.sandbox, roleAssignments: run.sandbox.roleAssignments.filter((item) => item.scope !== account.id) } }
    const invalid = applyRunAction(denied, { type: 'request', scenarioId: 'invalid' }, lab)
    expect(invalid.lines.at(-1)).toMatchObject({ status: 400, upstream: { attempts: [] } })
    expect(done(invalid.run, 'invalid')).toBe(false)
    const wrongCaller = act(run, { type: 'command', line: `az containerapp update -g ${pull.resourceGroup} -n ${run.sandbox.containerApps[0].name} --set-env-vars AZURE_CLIENT_ID=${pull.clientId}` })
    expect(done(act(wrongCaller, { type: 'request', scenarioId: 'valid' }), 'valid')).toBe(false)
    const wrongScope = applyRunAction(denied, { type: 'command', line:
      `az role assignment create --assignee-object-id ${inference.principalId} --role "Cognitive Services User" --scope ${account.id}/projects/brief-project` }, lab)
    expect(wrongScope.lines.some((line) => line.kind === 'err')).toBe(true)
    expect(done(act(wrongScope.run, { type: 'request', scenarioId: 'valid' }), 'valid')).toBe(false)
  })

  it('rejects unsupported policies at build while retaining the current active proof', () => {
    let run = act(prepared(), { type: 'request', scenarioId: 'valid' })
    expect(done(run, 'valid')).toBe(true)
    const path = 'src/Trainer.Api/appsettings.json'
    const original = run.project.savedFiles[path]
    const build = lab.tasks.find((task) => task.id === 'deploy').solution.steps.at(-2).line
    for (const [from, to] of [['"TotalAttempts": 3', '"TotalAttempts": 1'],
      ['"TotalBudgetSeconds": 8', '"TotalBudgetSeconds": 9'],
      ['"HonorRetryAfter": true', '"HonorRetryAfter": false']]) {
      run = act(run, { type: 'save-file', path, text: original.replace(from, to) })
      const failed = applyRunAction(run, { type: 'command', line: build }, lab)
      expect(failed.lines.some((line) => line.kind === 'err')).toBe(true)
      expect(done(failed.run, 'valid')).toBe(true)
      expect(done(failed.run, 'deploy')).toBe(true)
      run = act(failed.run, { type: 'save-file', path, text: original })
    }
  })

  it('keeps proof through drafts and build, then requires a new request after active policy change', () => {
    let run = act(prepared(), { type: 'request', scenarioId: 'valid' })
    const path = 'src/Trainer.Api/appsettings.json'
    const changed = run.project.savedFiles[path].replace('"TotalAttempts": 3', '"TotalAttempts": 2')
    run = act(run, { type: 'draft', path, text: changed })
    expect(done(run, 'valid')).toBe(true)
    run = act(run, { type: 'save-file', path })
    expect(done(run, 'valid')).toBe(true)
    expect(done(run, 'deploy')).toBe(true)
    const steps = lab.tasks.find((task) => task.id === 'deploy').solution.steps
    run = act(run, actionFor(steps.at(-2)))
    expect(done(run, 'valid')).toBe(true)
    run = act(run, actionFor(steps.at(-1)))
    expect(done(run, 'valid')).toBe(false)
    run = act(run, { type: 'request', scenarioId: 'valid' })
    expect(done(run, 'valid')).toBe(true)
    run = act(run, actionFor(steps.at(-1)))
    expect(done(run, 'valid')).toBe(true)
    const grant = lab.tasks.find((task) => task.id === 'access').solution.steps[0].line
    run = act(run, { type: 'command', line: grant.replace('assignment create', 'assignment delete').replace(' --assignee-principal-type ServicePrincipal', '') })
    expect(done(run, 'valid')).toBe(false)
    run = act(run, { type: 'command', line: grant })
    expect(done(run, 'valid')).toBe(false)
  })

  it('rejects the wrong active account or deployment despite a saved supported brief contract', () => {
    const base = prepared()
    const path = 'src/Trainer.Api/appsettings.json'
    const original = base.project.savedFiles[path]
    const steps = lab.tasks.find((task) => task.id === 'deploy').solution.steps
    for (const [from, to] of [['briefing-secondary', 'briefing-wrong'],
      ['foundryindependent.services.ai.azure.com', 'foundrywrong.services.ai.azure.com']]) {
      let run = act(base, { type: 'save-file', path, text: original.replace(from, to) })
      run = act(run, actionFor(steps.at(-2)))
      run = act(run, actionFor(steps.at(-1)))
      run = act(run, { type: 'request', scenarioId: 'valid' })
      expect(done(run, 'valid')).toBe(false)
      expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask.valid].measurements.status).toBe(502)
    }
  })

  it('persists assistance and one read-only Result, then restarts with no inherited proof', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(lab.id, { repository })
    await store.revealHint(lab.tasks[0].id)
    await store.revealSolution(lab.tasks.at(-1).id)
    const attempt = store.behavioralRun.attemptId
    for (const task of lab.tasks.slice(0, 2)) for (const step of task.solution.steps) {
      if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(actionFor(step))
    }
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.hintsUsed).toBe(1)
    for (const task of lab.tasks.slice(2)) for (const step of task.solution.steps) {
      if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(actionFor(step))
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    await expect(store.dispatchBehavioral({ type: 'request', scenarioId: 'valid' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(store.behavioralRun.evidence.experimentsById).toEqual({})
  })
})
