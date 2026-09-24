import { describe, expect, it } from 'vitest'
import { bicepTroubleshootingLab } from '../src/data/labs/containerapps-journey/bicep-troubleshooting.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { applyCommandEffects } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { migrateBehavioralRun } from '../src/lib/labEngine/migrations.js'
import { LABS, nextLabFor } from '../src/data/labs/index.js'
import { createPinia, setActivePinia } from 'pinia'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const fresh = () => createBehavioralRun(bicepTroubleshootingLab, { attemptId: 'incident-test' })
const done = (run, id) => evaluateLab(bicepTroubleshootingLab, run).tasks.find(task => task.id === id).done
function act(run, step) {
  const action = step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content }
    : step.kind === 'command' ? { type: 'command', line: step.line } : step.action
  const result = applyRunAction(run, action, bicepTroubleshootingLab)
  if (step.kind !== 'scenario' || step.action.scenarioId !== 'access-denied') {
    expect(result.diagnostics, JSON.stringify(step)).toEqual([])
    expect(result.lines.filter(line => line.kind === 'err'), JSON.stringify(step)).toEqual([])
  }
  return result.run
}
function through(last) {
  let run = fresh()
  for (const task of bicepTroubleshootingLab.tasks) {
    for (const step of task.solution.steps) run = act(run, step)
    if (task.id === last) break
  }
  return run
}

describe('Bicep troubleshooting Lab', () => {
  it('seeds only the Basic registry and healthy image, with three faults in saved files', () => {
    const run = fresh()
    expect(run.sandbox.containerRegistries).toEqual([expect.objectContaining({ sku: 'Basic' })])
    expect(run.sandbox.containerApps).toEqual([])
    expect(run.sandbox.managedIdentities).toEqual([])
    expect(run.sandbox.foundryAccounts).toEqual([])
    expect(Object.keys(run.artifacts.publishedTags)).toHaveLength(1)
    expect(run.runtime.bicep.incidentPreview).toBeUndefined()
    expect(run.runtime.bicep.previews).toEqual([])
    expect(run.evidence.experimentsById).toEqual({})
    expect(run.project.draftFiles).toEqual(run.project.savedFiles)
    expect(run.project.savedFiles['infra/main.bicep']).toContain('environment.outputs.environmntId')
    expect(run.project.savedFiles['infra/main.bicep']).toContain('identity.outputs.decoyPrincipalId')
    expect(run.project.savedFiles['infra/first.bicepparam']).toContain("environmentName = 'env-bicep-test'")
    expect(bicepTroubleshootingLab).toMatchObject({ journeyOrder: 14, labMode: 'troubleshooting', contentVersion: 1 })
    expect(nextLabFor(LABS.at(-4))).toBe(bicepTroubleshootingLab)
    expect(nextLabFor(bicepTroubleshootingLab)?.id).toBe('aca-bicep-independent')
  })

  it('executes displayed solutions, captures the wrong preview, and recovers through distinct requests', () => {
    let run = fresh()
    const bad = applyRunAction(run, { type: 'command', line: bicepTroubleshootingLab.tasks[0].solution.steps.at(-1).line }, bicepTroubleshootingLab)
    expect(bad.diagnostics[0]).toMatchObject({ code: 'MISSING_BICEP_OUTPUT', path: 'infra/main.bicep' })
    expect(bad.run.runtime.bicep.observations).toEqual([])
    for (const task of bicepTroubleshootingLab.tasks) {
      expect(task.hints.length).toBeGreaterThan(0)
      expect(task.solution.steps.length).toBeGreaterThan(0)
      for (const step of task.solution.steps) run = act(run, step)
      expect(done(run, task.id), task.id).toBe(true)
    }
    expect(evaluateLab(bicepTroubleshootingLab, run).isComplete).toBe(true)
    expect(run.runtime.bicep.incidentPreview.operations).toContainEqual(expect.objectContaining({
      type: 'Microsoft.App/managedEnvironments', name: 'env-bicep-test', changeType: 'create' }))
    const denied = Object.values(run.evidence.experimentsById).find(item => item.scenarioId === 'access-denied')
    const recovered = Object.values(run.evidence.experimentsById).find(item => item.scenarioId === 'recovered')
    expect(denied.measurements).toMatchObject({ status: 502, diagnosticCode: 'FOUNDRY_ACCESS_DENIED', upstream: { attempts: [] } })
    expect(recovered.measurements.status).toBe(200)
    expect(denied.sequence).toBeLessThan(recovered.sequence)
  })

  it('keeps the incident preview after history pruning and rejects forged milestone fields on reload', () => {
    let run = through('wrong-preview')
    const incident = structuredClone(run.runtime.bicep.incidentPreview)
    const preview = bicepTroubleshootingLab.tasks.find(task => task.id === 'wrong-preview').solution.steps.at(-1)
    for (let index = 0; index < 12; index++) run = act(run, preview)
    expect(run.runtime.bicep.previews).toHaveLength(10)
    expect(run.runtime.bicep.previews.some(item => item.id === incident.id)).toBe(false)
    expect(migrateBehavioralRun(structuredClone(run), bicepTroubleshootingLab).runtime.bicep.incidentPreview).toEqual(incident)
    for (const mutate of [
      item => { item.runtime.bicep.incidentPreview.parameterHash = 'forged' },
      item => { item.runtime.bicep.incidentPreview.operations[0].name = 'forged' },
      item => { item.runtime.bicep.incidentPreview.fileVersions['infra/first.bicepparam'] = 9 },
    ]) {
      const forged = structuredClone(run); mutate(forged)
      expect(() => validateBehavioralRun(forged, bicepTroubleshootingLab)).toThrow()
    }
  })

  it('rejects a fabricated incident copied into a run whose original preview was pruned', () => {
    const genuineState = through('wrong-preview').runtime.bicep
    const genuine = genuineState.incidentPreview
    let run = through('repair-output')
    const wrong = bicepTroubleshootingLab.tasks.find(task => task.id === 'wrong-preview').solution.steps[0].line
    for (let index = 0; index < 12; index++) {
      run = act(run, { kind: 'command', line: wrong.replace('--name first', '--name alternate') })
    }
    expect(run.runtime.bicep.incidentPreview).toBeUndefined()
    expect(run.runtime.bicep.previews[0].id).toBe('bicep-preview-3')
    const forged = structuredClone(run)
    forged.runtime.bicep.incidentPreview = structuredClone(genuine)
    expect(() => validateBehavioralRun(forged, bicepTroubleshootingLab)).toThrow()
    forged.runtime.bicep.previewChain.incident = structuredClone(genuineState.previewChain.incident)
    expect(() => validateBehavioralRun(forged, bicepTroubleshootingLab)).toThrow()
  })

  it('rejects caller-supplied incident data and accepts an equivalent saved source repair', () => {
    let run = through('repair-output')
    expect(() => applyCommandEffects(run, [{ type: 'bicep-preview', name: 'first',
      resourceGroup: 'rg-aca-bicep-incident', incidentPreview: { status: 'succeeded' } }], bicepTroubleshootingLab)).toThrow()
    const original = run.project.savedFiles['infra/main.bicep']
    run = act(run, { kind: 'file', path: 'infra/main.bicep', content: `${original}\n// Equivalent output repair.\n` })
    const validate = bicepTroubleshootingLab.tasks.find(task => task.id === 'repair-output').solution.steps.at(-1)
    run = act(run, validate)
    for (const task of bicepTroubleshootingLab.tasks.slice(1, 5)) for (const step of task.solution.steps) run = act(run, step)
    const repair = bicepTroubleshootingLab.tasks.find(task => task.id === 'repair-identity')
    for (const step of repair.solution.steps) run = act(run, step.kind === 'file'
      ? { ...step, content: `${step.content}\n// Same intended role binding.\n` } : step)
    run = act(run, bicepTroubleshootingLab.tasks.find(task => task.id === 'recovered').solution.steps[0])
    expect(done(run, 'repair-identity')).toBe(true)
    expect(done(run, 'recovered')).toBe(true)
  })

  it('does not accept a draft, stale saved version, or CLI-only account grant as a source repair', () => {
    let run = through('access-denied')
    const repair = bicepTroubleshootingLab.tasks.find(task => task.id === 'repair-identity').solution.steps[0]
    run = applyRunAction(run, { type: 'draft', path: repair.path, text: repair.content }, bicepTroubleshootingLab).run
    expect(done(run, 'repair-identity')).toBe(false)
    run = through('recovered')
    const path = 'infra/main.bicep'
    const original = run.project.savedFiles[path]
    run = act(run, { kind: 'file', path, content: `${original}\n` })
    run = act(run, { kind: 'file', path, content: original })
    expect(done(run, 'repair-identity')).toBe(false)
    expect(done(run, 'recovered')).toBe(false)
  })

  it('requires the seeded wrong parameter version before it can record incident preview', () => {
    let run = through('repair-output')
    const path = 'infra/first.bicepparam'
    const original = run.project.savedFiles[path]
    run = act(run, { kind: 'file', path, content: original.replace('env-bicep-test', 'env-bicep-incident') })
    run = act(run, { kind: 'file', path, content: original })
    run = act(run, bicepTroubleshootingLab.tasks.find(task => task.id === 'wrong-preview').solution.steps[0])
    expect(run.runtime.bicep.incidentPreview).toBeUndefined()
    expect(done(run, 'wrong-preview')).toBe(false)
    expect(run.runtime.bicep.previews).toHaveLength(1)
  })

  it('does not award the incident milestone for another deployment name or group', () => {
    let run = through('repair-output')
    const wrong = bicepTroubleshootingLab.tasks.find(task => task.id === 'wrong-preview').solution.steps[0].line
    run = act(run, { kind: 'command', line: wrong.replace('--name first', '--name alternate') })
    expect(run.runtime.bicep.incidentPreview).toBeUndefined()
    expect(run.runtime.bicep.previews).toHaveLength(1)
    run = act(run, { kind: 'command', line: 'az group create -n rg-alternate -l eastus' })
    const otherGroup = applyRunAction(run, { type: 'command', line: wrong.replace('rg-aca-bicep-incident', 'rg-alternate') }, bicepTroubleshootingLab)
    expect(otherGroup.lines[0].kind).toBe('err')
    expect(otherGroup.run.runtime.bicep.incidentPreview).toBeUndefined()
    run = act(run, { kind: 'command', line: wrong })
    expect(run.runtime.bicep.incidentPreview).toBeDefined()
  })

  it('rejects a CLI OpenAI User bypass while the authored graph still grants the decoy', () => {
    let run = through('access-denied')
    const primary = run.sandbox.managedIdentities.find(item => item.name === 'id-bicep-incident')
    const account = run.sandbox.foundryAccounts[0]
    run = act(run, { kind: 'command', line: `az role assignment create --assignee-object-id ${primary.principalId} --role "Cognitive Services OpenAI User" --scope ${account.id}` })
    const request = applyRunAction(run, { type: 'request', scenarioId: 'recovered' }, bicepTroubleshootingLab)
    expect(request.lines[0].status).toBe(200)
    expect(done(request.run, 'repair-identity')).toBe(false)
    expect(done(request.run, 'recovered')).toBe(false)
  })

  it('does not credit denial after the source is repaired ahead of the named request', () => {
    let run = through('deploy-decoy')
    const repair = bicepTroubleshootingLab.tasks.find(task => task.id === 'repair-identity').solution.steps[0]
    run = act(run, repair)
    for (const step of bicepTroubleshootingLab.tasks.find(task => task.id === 'repair-identity').solution.steps.slice(1, 3)) run = act(run, step)
    const denied = applyRunAction(run, { type: 'request', scenarioId: 'access-denied' }, bicepTroubleshootingLab)
    expect(denied.lines[0].status).toBe(502)
    expect(done(denied.run, 'access-denied')).toBe(false)
    expect(done(denied.run, 'repair-identity')).toBe(false)
  })

  it('does not let a later unrelated denial reuse the earlier decoy evidence', () => {
    const run = through('recovered')
    const changed = structuredClone(run)
    const primary = changed.sandbox.managedIdentities.find(item => item.name === 'id-bicep-incident')
    changed.sandbox.roleAssignments = changed.sandbox.roleAssignments.filter(item =>
      !(item.principalId === primary.principalId && item.roleName === 'Cognitive Services User'))
    const denied = applyRunAction(changed, { type: 'request', scenarioId: 'access-denied' }, bicepTroubleshootingLab)
    expect(denied.lines[0].status).toBe(502)
    expect(done(denied.run, 'access-denied')).toBe(false)
  })

  it('keeps recovered evidence current on a no-op reapply and rolls back a failed app update', () => {
    let run = through('recovered')
    const appId = bicepTroubleshootingLab.scenarios.recovered.appId
    const active = structuredClone(run.runtime.deploymentsByApp[appId].active)
    const create = bicepTroubleshootingLab.tasks.find(task => task.id === 'repair-identity').solution.steps[3]
    run = act(run, create)
    expect(run.runtime.bicep.attempts.at(-1).operations.every(item => ['no-change', 'ignored-existing'].includes(item.changeType))).toBe(true)
    expect(run.runtime.deploymentsByApp[appId].active).toEqual(active)
    expect(done(run, 'recovered')).toBe(true)
    const broken = structuredClone(run)
    broken.artifacts.buildsById[broken.artifacts.publishedTags['acrbicepincident.azurecr.io/api:v1']].appSpec.listeningPort = 9000
    const path = 'infra/modules/app.bicep'
    const changed = applyRunAction(broken, { type: 'save-file', path, text: broken.project.savedFiles[path].replace('maxReplicas: 2', 'maxReplicas: 3') }, bicepTroubleshootingLab).run
    const failed = applyRunAction(changed, { type: 'command', line: create.line }, bicepTroubleshootingLab)
    expect(failed.run.runtime.bicep.attempts.at(-1).status).toBe('failed')
    expect(failed.run.runtime.deploymentsByApp[appId].active).toEqual(active)
    expect(failed.run.sandbox.containerApps[0].maxReplicas).toBe(2)
  })

  it('reloads an assisted completed Result and starts a fresh run on Restart', async () => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
    const repository = behavioralRepository(), store = useLabRunStore()
    await store.load(bicepTroubleshootingLab.id, { repository })
    const attempt = store.behavioralRun.attemptId
    await store.dispatchBehavioral({ type: 'reveal-hint', taskId: 'repair-output' })
    for (const task of bicepTroubleshootingLab.tasks) for (const step of task.solution.steps) {
      if (step.kind === 'file') await store.dispatchBehavioral({ type: 'save-file', path: step.path, text: step.content })
      else if (step.kind === 'command') await store.execute(step.line)
      else await store.dispatchBehavioral(step.action)
    }
    expect(store.isComplete).toBe(true)
    expect(repository.results).toHaveLength(1)
    await store.reload()
    expect(store.behavioralRun.attemptId).toBe(attempt)
    expect(store.behavioralRun.runtime.bicep.incidentPreview).toBeDefined()
    await expect(store.dispatchBehavioral({ type: 'request', scenarioId: 'recovered' })).rejects.toMatchObject({ code: 'READ_ONLY' })
    await store.restart()
    expect(store.behavioralRun.attemptId).not.toBe(attempt)
    expect(store.doneCount).toBe(0)
    expect(repository.results).toHaveLength(1)
  })
})
