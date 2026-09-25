import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { foundryTroubleshootingLab as lab } from '../src/data/labs/containerapps-journey/foundry-troubleshooting.lab.js'
import { LABS, labById, nextLabFor } from '../src/data/labs/index.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const fresh = () => createBehavioralRun(lab, { attemptId: 'foundry-incident-test' })
const done = (run, id) => evaluateLab(lab, run).tasks.find((task) => task.id === id).done
function actionFor(step) {
  return step.kind === 'command' ? { type: 'command', line: step.line }
    : step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content } : step.action
}
function act(run, action) {
  const result = applyRunAction(run, action, lab)
  expect(result.diagnostics.filter((item) => item.code === 'INVALID_ACTION'), JSON.stringify(action)).toEqual([])
  return result.run
}
function solve(run, task) {
  for (const step of task.solution.steps) run = act(run, actionFor(step))
  return run
}

describe('Foundry troubleshooting Lab', () => {
  it('seeds one active broken incident and registers the next journey Lab', () => {
    const run = fresh()
    expect(lab).toMatchObject({ id: 'aca-foundry-troubleshooting', contentVersion: 1,
      journeyOrder: 11, labMode: 'troubleshooting' })
    expect(LABS.filter((lab) => lab.journeyId === 'containerapps-end-to-end')).toHaveLength(16)
    expect(nextLabFor(labById('aca-foundry-guided'))).toBe(lab)
    expect(nextLabFor(lab)).toBe(labById('aca-foundry-independent'))
    expect(run.sandbox.foundryAccounts).toHaveLength(1)
    expect(run.sandbox.foundryAccounts[0].projects).toHaveLength(1)
    expect(run.sandbox.foundryAccounts[0].deployments).toHaveLength(1)
    expect(run.sandbox.roleAssignments.filter((item) => item.scope === run.sandbox.foundryAccounts[0].id)).toEqual([])
    const active = run.runtime.deploymentsByApp[lab.scenarios.endpoint.appId].active
    expect(active.foundry).toMatchObject({ deployment: 'summarizer-missing', maxAttempts: 1,
      timeoutSeconds: 10, attemptTimeoutSeconds: 3, honorRetryAfter: false })
    expect(active.foundry.endpoint).toContain('foundrywrong')
    expect(run.evidence.experimentsById).toEqual({})
    expect(run.hintsRevealed).toEqual({})
    expect(run.solutionsRevealed).toEqual({})
    expect(evaluateLab(lab, run).doneCount).toBe(0)
    const response = applyRunAction(run, { type: 'request', scenarioId: 'endpoint' }, lab)
    expect(response.lines.at(-1)).toMatchObject({ status: 502, upstream: { attempts: [] } })
    expect(response.run.evidence.experimentsById[response.run.evidence.currentEvidenceByTask.endpoint].measurements)
      .toMatchObject({ observation: 'diagnostic', diagnosticCode: 'FOUNDRY_ACCOUNT_NOT_FOUND' })
  })

  it('follows every declarative solution through diagnosis, repair, bounded failures and final recovery', () => {
    let run = fresh()
    for (const task of lab.tasks) {
      expect(task.hints).toHaveLength(2)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      expect(task.examNote).toBeTruthy()
      run = solve(run, task)
      expect(done(run, task.id), task.id).toBe(true)
    }
    expect(evaluateLab(lab, run).isComplete).toBe(true)
    const measurement = (id) => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]].measurements
    expect(measurement('endpoint')).toMatchObject({ diagnosticCode: 'FOUNDRY_ACCOUNT_NOT_FOUND', upstream: { attempts: [] } })
    expect(measurement('deployment')).toMatchObject({ diagnosticCode: 'FOUNDRY_DEPLOYMENT_NOT_FOUND', upstream: { attempts: [] } })
    expect(measurement('access')).toMatchObject({ diagnosticCode: 'FOUNDRY_ACCESS_DENIED', upstream: { attempts: [] } })
    expect(measurement('transient').upstream.attempts.map((item) => [item.status, item.delayAfterMs]))
      .toEqual([[429, 2000], [200, 0]])
    expect(measurement('persistent')).toMatchObject({ status: 503, diagnosticCode: 'UPSTREAM_UNAVAILABLE' })
    expect(measurement('persistent').upstream.attempts).toHaveLength(3)
    expect(measurement('timeout')).toMatchObject({ status: 504, diagnosticCode: 'UPSTREAM_DEADLINE' })
    expect(measurement('timeout').upstream.attempts.map((item) => item.durationMs)).toEqual([3000, 3000, 1000])
    expect(measurement('healthy')).toMatchObject({ status: 200, body: { deployment: 'summarizer-primary' } })
  })

  it('rejects shortcut grants and drafts, keeps diagnosis history, and refreshes current proof after a real change', () => {
    let run = fresh()
    const appId = lab.scenarios.endpoint.appId
    const accountId = run.sandbox.foundryAccounts[0].id
    const caller = run.sandbox.managedIdentities[0].principalId
    const management = run.sandbox.foundryAccounts[0].identity.principalId
    const wrongScope = `${accountId}/projects/summarizer-project`
    run = solve(run, lab.tasks[0])
    expect(done(run, 'endpoint')).toBe(true)
    const endpointSave = lab.tasks[1].solution.steps[0]
    run = act(run, { type: 'draft', path: endpointSave.path, text: endpointSave.content })
    expect(done(run, 'endpointRepair')).toBe(false)
    run = act(run, actionFor(endpointSave))
    run = act(run, actionFor(lab.tasks[1].solution.steps[1]))
    expect(done(run, 'endpointRepair')).toBe(false)
    run = act(run, actionFor(lab.tasks[1].solution.steps[2]))
    expect(done(run, 'endpointRepair')).toBe(true)
    for (const task of lab.tasks.slice(2, 5)) run = solve(run, task)
    expect(done(run, 'endpoint')).toBe(true)
    expect(done(run, 'deployment')).toBe(true)
    expect(done(run, 'access')).toBe(true)
    const projectGrant = applyRunAction(run, { type: 'command', line:
      `az role assignment create --assignee-object-id ${caller} --role "Cognitive Services User" --scope ${wrongScope}` }, lab)
    expect(projectGrant.lines.some((line) => line.kind === 'err')).toBe(true)
    run = projectGrant.run
    run = act(run, { type: 'command', line:
      `az role assignment create --assignee-object-id ${management} --role "Cognitive Services User" --scope ${accountId}` })
    expect(done(run, 'accessRepair')).toBe(false)
    expect(applyRunAction(run, { type: 'request', scenarioId: 'access' }, lab).lines.at(-1).upstream.attempts).toEqual([])
    run = solve(run, lab.tasks[5])
    expect(done(run, 'accessRepair')).toBe(true)
    run = act(run, { type: 'request', scenarioId: 'healthy' })
    expect(done(run, 'healthy')).toBe(false) // retry policy is still one attempt
    run = solve(run, lab.tasks[6])
    run = act(run, { type: 'request', scenarioId: 'transient' })
    expect(done(run, 'transient')).toBe(true)
    const before = run.runtime.deploymentsByApp[appId].active.generation
    run = act(run, actionFor(lab.tasks[6].solution.steps[2]))
    expect(run.runtime.deploymentsByApp[appId].active.generation).toBe(before)
    expect(done(run, 'transient')).toBe(true)
    const grant = lab.tasks[5].solution.steps[0].line
    run = act(run, { type: 'command', line: grant.replace('assignment create', 'assignment delete').replace(' --assignee-principal-type ServicePrincipal', '') })
    expect(done(run, 'transient')).toBe(false)
    expect(done(run, 'endpoint')).toBe(true)
    run = act(run, actionFor(lab.tasks[5].solution.steps[0]))
    expect(done(run, 'transient')).toBe(false)
    run = act(run, { type: 'request', scenarioId: 'transient' })
    expect(done(run, 'transient')).toBe(true)
  })

  it('requires current resilience proofs in sequence and refreshes downstream proof after an earlier rerun', () => {
    let run = fresh()
    for (const task of lab.tasks.slice(0, 7)) run = solve(run, task)
    run = act(run, { type: 'request', scenarioId: 'healthy' })
    run = act(run, { type: 'request', scenarioId: 'timeout' })
    run = act(run, { type: 'request', scenarioId: 'persistent' })
    expect(['persistent', 'timeout', 'healthy'].map((id) => done(run, id))).toEqual([false, false, false])
    run = solve(run, lab.tasks[7])
    expect(done(run, 'transient')).toBe(true)
    expect(['persistent', 'timeout', 'healthy'].map((id) => done(run, id))).toEqual([false, false, false])
    run = solve(run, lab.tasks[8])
    run = solve(run, lab.tasks[9])
    expect(['persistent', 'timeout', 'healthy'].map((id) => done(run, id))).toEqual([true, true, false])
    run = act(run, { type: 'request', scenarioId: 'transient' })
    expect(['transient', 'persistent', 'timeout', 'healthy'].map((id) => done(run, id)))
      .toEqual([true, false, false, false])
    run = solve(run, lab.tasks[8])
    expect(['persistent', 'timeout'].map((id) => done(run, id))).toEqual([true, false])
    run = solve(run, lab.tasks[9])
    run = solve(run, lab.tasks[10])
    expect(evaluateLab(lab, run).isComplete).toBe(true)
  })

  it('resumes partial work and stores one immutable Result before a fresh Restart', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(lab.id, { repository })
    await store.revealHint('endpoint')
    await store.revealSolution('policy')
    const attempt = store.behavioralRun.attemptId
    for (const task of lab.tasks.slice(0, 3)) for (const step of task.solution.steps) {
      if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(actionFor(step))
    }
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.doneCount).toBeGreaterThan(0)
    for (const task of lab.tasks.slice(3)) for (const step of task.solution.steps) {
      if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(actionFor(step))
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    expect(repository.results[0]).toMatchObject({ labId: lab.id, hintsUsed: 1, solutionsUsed: 1 })
    await expect(store.dispatchBehavioral({ type: 'request', scenarioId: 'healthy' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(store.behavioralRun.evidence.experimentsById).toEqual({})
  })
})
