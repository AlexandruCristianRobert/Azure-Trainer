import { describe, expect, it } from 'vitest'
import { deployTroubleshootingLab } from '../src/data/labs/containerapps-journey/deploy-troubleshooting.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { useProgressStore } from '../src/stores/progress.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

const appId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-aca-incident/providers/Microsoft.App/containerApps/api-incident`
const command = (run, line) => applyRunAction(run, { type: 'command', line }, deployTroubleshootingLab).run
const diagnosis = (run) => run.runtime.deploymentsByApp[appId]

describe('deployment troubleshooting Lab', () => {
  it('starts each attempt with the same faulty resources and no learner evidence', () => {
    expect(deployTroubleshootingLab).toMatchObject({ id: 'aca-deploy-troubleshooting', engineVersion: 2,
      contentVersion: 1, journeyId: 'containerapps-end-to-end', journeyOrder: 2, labMode: 'troubleshooting' })
    expect(deployTroubleshootingLab.tasks).toHaveLength(2)
    for (const task of deployTroubleshootingLab.tasks) {
      expect(task.hints).toHaveLength(2)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      expect(task.examNote.length).toBeGreaterThan(0)
    }
    const first = createBehavioralRun(deployTroubleshootingLab, { attemptId: 'first' })
    const second = createBehavioralRun(deployTroubleshootingLab, { attemptId: 'second' })
    validateBehavioralRun(first, deployTroubleshootingLab)
    expect(first.project.savedFiles['src/Trainer.Api/Program.cs']).toContain('APP_ENV')
    expect(first.sandbox.resourceGroups).toMatchObject([{ name: 'rg-aca-incident', location: 'eastus' }])
    expect(first.sandbox.containerRegistries).toMatchObject([{ name: 'acrincident' }])
    expect(first.sandbox.managedIdentities).toMatchObject([{ name: 'id-incident' }])
    expect(first.sandbox.containerApps).toMatchObject([{ name: 'api-incident', targetPort: 9090,
      image: 'acrincident.azurecr.io/api:missing' }])
    expect(first.sandbox.roleAssignments).toEqual([])
    expect(Object.keys(first.artifacts.publishedTags)).toEqual(['acrincident.azurecr.io/api:v1'])
    expect(diagnosis(first)).toMatchObject({ status: 'failed', active: null,
      diagnostics: [{ code: 'IMAGE_TAG_NOT_FOUND' }] })
    expect(first.evidence).toEqual({ experimentsById: {}, currentEvidenceByTask: {}, milestoneRecords: [] })
    expect(first.history).toEqual([])
    expect(first.scrollback).toEqual([])
    expect(first.hintsRevealed).toEqual({})
    expect(first.solutionsRevealed).toEqual({})
    expect(first.dependencyGenerations).toEqual({})
    expect(first.artifacts).toEqual(second.artifacts)
    expect(first.sandbox).toEqual(second.sandbox)
    expect(first.runtime).toEqual(second.runtime)
    expect(evaluateLab(deployTroubleshootingLab, first).isComplete).toBe(false)
  })

  it('reveals image, permission and port faults one repair at a time, then requires a real request', () => {
    let run = createBehavioralRun(deployTroubleshootingLab, { attemptId: 'repairs' })
    run = command(run, 'az containerapp update -g rg-aca-incident -n api-incident --image acrincident.azurecr.io/api:v1')
    expect(diagnosis(run)).toMatchObject({ status: 'failed', active: null, diagnostics: [{ code: 'ACR_PULL_DENIED' }] })
    expect(evaluateLab(deployTroubleshootingLab, run).doneCount).toBe(0)
    const principalId = run.sandbox.managedIdentities[0].principalId
    const registryId = run.sandbox.containerRegistries[0].id
    run = command(run, `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`)
    run = command(run, 'az containerapp update -g rg-aca-incident -n api-incident --image acrincident.azurecr.io/api:v1')
    expect(diagnosis(run)).toMatchObject({ status: 'failed', active: null, diagnostics: [{ code: 'TARGET_PORT_MISMATCH' }] })
    expect(evaluateLab(deployTroubleshootingLab, run).doneCount).toBe(0)
    run = command(run, 'az containerapp ingress enable -g rg-aca-incident -n api-incident --type external --target-port 8080')
    expect(diagnosis(run)).toMatchObject({ status: 'succeeded', diagnostics: [] })
    expect(diagnosis(run).active).toBeTruthy()
    expect(evaluateLab(deployTroubleshootingLab, run).tasks.map((task) => task.done)).toEqual([true, false])
    run = applyRunAction(run, { type: 'request', appId, method: 'GET', path: '/api/info' }, deployTroubleshootingLab).run
    expect(evaluateLab(deployTroubleshootingLab, run).isComplete).toBe(true)
    expect(Object.values(run.evidence.experimentsById).at(-1)).toMatchObject({ outcome: 'passed',
      measurements: { status: 200, body: { service: 'contoso-api', environment: 'training' } } })
  })

  it('accepts a valid publication under the desired tag after the other faults are repaired', () => {
    let run = createBehavioralRun(deployTroubleshootingLab, { attemptId: 'publish-repair' })
    run = command(run, 'az acr build --registry acrincident --image api:missing --file Dockerfile .')
    const principalId = run.sandbox.managedIdentities[0].principalId
    const registryId = run.sandbox.containerRegistries[0].id
    run = command(run, `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`)
    run = command(run, 'az containerapp ingress enable -g rg-aca-incident -n api-incident --type external --target-port 8080')
    expect(diagnosis(run).status).toBe('succeeded')
    expect(evaluateLab(deployTroubleshootingLab, run).tasks[0].done).toBe(true)
    run = applyRunAction(run, { type: 'request', appId, method: 'GET', path: '/api/info' }, deployTroubleshootingLab).run
    expect(evaluateLab(deployTroubleshootingLab, run).isComplete).toBe(true)
  })

  it('accepts a valid published tag when the image host and repository use different case', () => {
    let run = createBehavioralRun(deployTroubleshootingLab, { attemptId: 'case-repair' })
    run = command(run, 'az containerapp update -g rg-aca-incident -n api-incident --image ACRINCIDENT.azurecr.io/API:v1')
    const principalId = run.sandbox.managedIdentities[0].principalId
    const registryId = run.sandbox.containerRegistries[0].id
    run = command(run, `az role assignment create --assignee-object-id ${principalId} --assignee-principal-type ServicePrincipal --role AcrPull --scope ${registryId}`)
    run = command(run, 'az containerapp ingress enable -g rg-aca-incident -n api-incident --type external --target-port 8080')
    expect(diagnosis(run).status).toBe('succeeded')
    expect(evaluateLab(deployTroubleshootingLab, run).tasks[0].done).toBe(true)
  })

  it('does not let a previous active generation prove a failed desired update', () => {
    let run = createBehavioralRun(deployTroubleshootingLab, { attemptId: 'stale' })
    for (const step of deployTroubleshootingLab.tasks[0].solution.steps) run = command(run, step.line)
    run = applyRunAction(run, { type: 'request', appId, method: 'GET', path: '/api/info' }, deployTroubleshootingLab).run
    expect(evaluateLab(deployTroubleshootingLab, run).isComplete).toBe(true)
    const active = diagnosis(run).active
    run = command(run, 'az containerapp update -g rg-aca-incident -n api-incident --image acrincident.azurecr.io/api:absent')
    expect(diagnosis(run).active).toEqual(active)
    expect(diagnosis(run).status).toBe('failed')
    expect(evaluateLab(deployTroubleshootingLab, run).isComplete).toBe(false)
    run = applyRunAction(run, { type: 'request', appId, method: 'GET', path: '/api/info' }, deployTroubleshootingLab).run
    expect(Object.values(run.evidence.experimentsById).at(-1).outcome).toBe('passed')
    expect(evaluateLab(deployTroubleshootingLab, run).isComplete).toBe(false)
  })

  it('keeps request evidence current across a no-op update and ignores an unrelated request', () => {
    let run = createBehavioralRun(deployTroubleshootingLab, { attemptId: 'no-op' })
    for (const step of deployTroubleshootingLab.tasks[0].solution.steps) run = command(run, step.line)
    run = applyRunAction(run, { type: 'request', appId, method: 'GET', path: '/api/info' }, deployTroubleshootingLab).run
    const passed = run.evidence.currentEvidenceByTask.response
    run = command(run, 'az containerapp update -g rg-aca-incident -n api-incident --image acrincident.azurecr.io/api:v1')
    expect(run.evidence.currentEvidenceByTask.response).toBe(passed)
    expect(evaluateLab(deployTroubleshootingLab, run).isComplete).toBe(true)
    run = applyRunAction(run, { type: 'request', appId: '/apps/unrelated', method: 'GET', path: '/api/info' }, deployTroubleshootingLab).run
    expect(run.evidence.currentEvidenceByTask.response).toBe(passed)
    expect(evaluateLab(deployTroubleshootingLab, run).isComplete).toBe(true)
  })

  it('resumes saved repairs and assistance, commits a Result and restarts the original incident', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const native = behavioralRepository(), store = useLabRunStore()
    await store.load(deployTroubleshootingLab.id, { repository: native })
    const originalAttempt = store.behavioralRun.attemptId
    await store.revealHint('recovery')
    await store.execute('az containerapp update -g rg-aca-incident -n api-incident --image acrincident.azurecr.io/api:v1')
    await store.load(deployTroubleshootingLab.id, { repository: native })
    expect(store.behavioralRun.attemptId).toBe(originalAttempt)
    expect(store.behavioralRun.sandbox.containerApps[0].image).toBe('acrincident.azurecr.io/api:v1')
    expect(store.hintsUsed).toBe(1)
    expect(diagnosis(store.behavioralRun).diagnostics[0].code).toBe('ACR_PULL_DENIED')
    for (const step of deployTroubleshootingLab.tasks[0].solution.steps.slice(1)) await store.execute(step.line)
    await store.dispatchBehavioral({ type: 'request', appId, method: 'GET', path: '/api/info' })
    expect(store.isComplete).toBe(true)
    expect(native.results).toHaveLength(1)
    expect(useProgressStore().latestResult(deployTroubleshootingLab.id)).toMatchObject({ hintsUsed: 1, solutionsUsed: 0 })
    await expect(store.dispatchBehavioral({ type: 'hint', taskId: 'response' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(originalAttempt)
    expect(store.doneCount).toBe(0)
    expect(store.behavioralRun.history).toEqual([])
    expect(store.behavioralRun.evidence.experimentsById).toEqual({})
    expect(store.behavioralRun.sandbox.containerApps[0].image).toBe('acrincident.azurecr.io/api:missing')
    expect(native.results).toHaveLength(1)
  })
})
