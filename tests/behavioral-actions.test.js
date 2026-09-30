import { describe, expect, it } from 'vitest'
import { SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/starter.js'
import { SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { getRequestScenario } from '../src/lib/simulation/requests.js'

const appId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-api/providers/Microsoft.App/containerApps/info-api`
const registryId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-api/providers/Microsoft.ContainerRegistry/registries/acrguided`
const lab = Object.freeze({
  id: 'guided-api', engineVersion: 2, contentVersion: 1, manifestId: 'containerapps-dotnet-v1',
  initialProjectFiles: SOLUTION_FILES, capabilities: { acrBuild: true },
  scenarios: Object.freeze({ info: Object.freeze({ version: 1, appId, request: { method: 'GET', path: '/api/info' }, expected: { status: 200, body: { service: 'contoso-api', environment: 'training' } } }) }),
  tasks: [{ id: 'verify-api', verification: { scenarioId: 'info', scenarioVersion: 1 },
    dependencies: { deployment: ({ runtime }) => runtime.deploymentsByApp[appId]?.active?.generation ?? null },
    check: ({ runtime }) => !!runtime.deploymentsByApp[appId]?.active }],
})

function fixture() { return createBehavioralRun(lab, { attemptId: 'attempt-one' }) }
function act(run, action) { return applyRunAction(run, action, lab).run }
function command(run, line) { return applyRunAction(run, { type: 'command', line }, lab) }
function setup() {
  let run = fixture()
  for (const line of [
    'az group create -n rg-api -l eastus',
    'az acr create -g rg-api -n acrguided --sku Basic',
    'az identity create -g rg-api -n id-guided',
    'az containerapp env create -g rg-api -n api-env',
  ]) run = command(run, line).run
  const principal = run.sandbox.managedIdentities[0].principalId
  run = command(run, `az role assignment create --assignee-object-id ${principal} --role AcrPull --scope ${registryId}`).run
  return run
}
const build = (run, tag = 'v1') => command(run, `az acr build --registry acrguided --image api:${tag} --file Dockerfile .`)
const create = (run, image = 'acrguided.azurecr.io/api:v1', extra = '') => command(run,
  `az containerapp create -g rg-api -n info-api --environment api-env --image ${image} --user-assigned ${run.sandbox.managedIdentities[0].id} --registry-server acrguided.azurecr.io --registry-identity ${run.sandbox.managedIdentities[0].id} --env-vars APP_ENV=training --ingress external --target-port 8080 ${extra}`)
const request = (run) => applyRunAction(run, { type: 'request', appId, method: 'GET', path: '/api/info' }, lab)

describe('guided deployment and request actions', () => {
  it('exposes a detached immutable request scenario from Lab content', () => {
    const scenario = getRequestScenario(lab, 'verify-api')
    expect(scenario).toEqual(lab.scenarios.info)
    expect(scenario).not.toBe(lab.scenarios.info)
    expect(Object.isFrozen(scenario)).toBe(true)
    expect(Object.isFrozen(scenario.expected.body)).toBe(true)
  })

  it('deploys a private built image and verifies the source-derived response against the immutable Lab scenario', () => {
    const start = setup()
    const built = build(start)
    expect(start.artifacts.publishedTags).toEqual({})
    expect(built.diagnostics).toEqual([])
    const deployed = create(built.run)
    expect(deployed.diagnostics).toEqual([])
    expect(deployed.run.runtime.deploymentsByApp[appId].active).toMatchObject({
      artifactId: 'build-1', appSpec: { listeningPort: 8080 }, env: { APP_ENV: 'training' }, targetPort: 8080,
    })
    const shown = JSON.parse(command(deployed.run, 'az containerapp show -g rg-api -n info-api').lines[0].text)
    expect(shown.identity.userAssignedIdentities).toHaveProperty(deployed.run.sandbox.managedIdentities[0].id)
    expect(shown.properties.configuration.registries).toEqual([{ server: 'acrguided.azurecr.io', identity: deployed.run.sandbox.managedIdentities[0].id }])
    expect(shown.properties.template.containers[0].env).toContainEqual({ name: 'APP_ENV', value: 'training' })
    const checked = request(deployed.run)
    expect(checked.lines.at(-1)).toMatchObject({ status: 200, body: { service: 'contoso-api', environment: 'training' } })
    expect(checked.run.evidence.currentEvidenceByTask['verify-api']).toBeTruthy()
    expect(evaluateLab(lab, checked.run).tasks[0].done).toBe(true)
    expect(deployed.run.evidence.currentEvidenceByTask).toEqual({})
  })

  it('keeps the active snapshot through draft, save, build and failed update; no-op retains generation', () => {
    let run = create(build(setup()).run).run
    const first = run.runtime.deploymentsByApp[appId].active
    const path = 'src/Trainer.Api/AppSettings.cs'
    const changed = SOLUTION_FILES[path].replace('contoso-api', 'different-api')
    run = act(run, { type: 'draft', path, text: changed })
    expect(run.project.savedFiles[path]).toBe(SOLUTION_FILES[path])
    expect(request(run).lines.at(-1).body.service).toBe('contoso-api')
    run = act(run, { type: 'save-file', path, text: changed })
    expect(request(run).lines.at(-1).body.service).toBe('contoso-api')
    run = build(run, 'v2').run
    expect(request(run).lines.at(-1).body.service).toBe('contoso-api')
    const failed = command(run, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:missing')
    expect(failed.run.runtime.deploymentsByApp[appId].desired.image).toContain(':missing')
    expect(failed.run.runtime.deploymentsByApp[appId].active).toEqual(first)
    expect(failed.diagnostics.map((diagnostic) => diagnostic.code)).toContain('IMAGE_TAG_NOT_FOUND')
    expect(request(failed.run).lines.at(-1).body.service).toBe('contoso-api')
    const updated = command(failed.run, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:v2')
    expect(updated.run.runtime.deploymentsByApp[appId].active.appSpec.service.value).toBe('different-api')
    const repeat = command(updated.run, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:v2')
    expect(repeat.run.runtime.deploymentsByApp[appId].active.generation).toBe(updated.run.runtime.deploymentsByApp[appId].active.generation)
  })

  it('explains missing publication, denied pull and port mismatch, then repairs ingress without replacing old runtime on failure', () => {
    let run = setup()
    const missing = create(run)
    expect(missing.diagnostics.map((item) => item.code)).toContain('IMAGE_TAG_NOT_FOUND')
    run = build(missing.run).run
    const principal = run.sandbox.managedIdentities[0].principalId
    const revoked = command(run, `az role assignment delete --assignee-object-id ${principal} --role AcrPull --scope ${registryId}`)
    expect(create(revoked.run).diagnostics.map((item) => item.code)).toContain('ACR_PULL_DENIED')
    run = command(revoked.run, `az role assignment create --assignee-object-id ${principal} --role AcrPull --scope ${registryId}`).run
    run = create(run).run
    const active = run.runtime.deploymentsByApp[appId].active
    const badPort = command(run, 'az containerapp ingress update -g rg-api -n info-api --target-port 9090')
    expect(badPort.diagnostics.map((item) => item.code)).toContain('TARGET_PORT_MISMATCH')
    expect(badPort.run.runtime.deploymentsByApp[appId].active).toEqual(active)
    const repaired = command(badPort.run, 'az containerapp ingress update -g rg-api -n info-api --target-port 8080')
    expect(request(repaired.run).lines.at(-1).status).toBe(200)
  })

  it('uses captured runtime after pull revocation and drops it on app or group deletion', () => {
    let run = create(build(setup()).run).run
    const principal = run.sandbox.managedIdentities[0].principalId
    run = command(run, `az role assignment delete --assignee-object-id ${principal} --role AcrPull --scope ${registryId}`).run
    expect(request(run).lines.at(-1).status).toBe(200)
    run = build(run, 'v2').run
    const denied = command(run, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:v2')
    expect(denied.diagnostics.map((item) => item.code)).toContain('ACR_PULL_DENIED')
    expect(request(denied.run).lines.at(-1).status).toBe(200)
    run = denied.run
    run = command(run, 'az containerapp delete -g rg-api -n info-api --yes').run
    expect(run.runtime.deploymentsByApp[appId]).toBeUndefined()
    expect(request(run).lines.at(-1).status).toBe(404)
    run = command(run, 'az group delete -n rg-api --yes').run
    expect(Object.keys(run.artifacts.publishedTags)).toEqual([])
  })

  it('records failed expected requests, rejects caller outcomes and cross-attempt evidence, and locks completed attempts', () => {
    let run = create(build(setup()).run).run
    const bad = applyRunAction(run, { type: 'request', appId, method: 'GET', path: '/api/info', expected: { status: 200 }, passed: true }, lab)
    expect(bad.diagnostics.map((item) => item.code)).toContain('INVALID_ACTION')
    expect(bad.run).toEqual(run)
    const wrong = request(act(run, { type: 'command', line: 'az containerapp update -g rg-api -n info-api --set-env-vars APP_ENV=wrong' }))
    expect(wrong.run.evidence.experimentsById[wrong.run.evidence.currentEvidenceByTask['verify-api']].outcome).toBe('failed')
    expect(evaluateLab(lab, wrong.run).tasks[0].done).toBe(false)
    run = { ...run, completedAt: '2026-09-23T00:00:00Z', resultId: 'result-one' }
    expect(() => applyRunAction(run, { type: 'elapsed', milliseconds: 1 }, lab)).toThrow()
    const foreign = fixture()
    foreign.attemptId = 'attempt-two'
    foreign.evidence = wrong.run.evidence
    expect(() => applyRunAction(foreign, { type: 'elapsed', milliseconds: 1 }, lab)).toThrow()
  })

  it('reads only deployed configuration keys, including names inherited by ordinary objects', () => {
    let run = setup()
    const path = 'src/Trainer.Api/Program.cs'
    const changed = SOLUTION_FILES[path].replace('builder.Configuration["APP_ENV"]', 'builder.Configuration["constructor"]')
    run = act(run, { type: 'save-file', path, text: changed })
    run = create(build(run).run).run
    const actual = request(run)
    expect(actual.lines.at(-1).body.environment).toBeNull()
    expect(actual.run.evidence.experimentsById[actual.run.evidence.currentEvidenceByTask['verify-api']].outcome).toBe('failed')
  })

  it('matches equivalent response property order and preserves verification through a semantic no-op', () => {
    let run = setup()
    const path = 'src/Trainer.Api/Program.cs'
    const changed = SOLUTION_FILES[path].replace(
      'service = AppSettings.ServiceName, environment = builder.Configuration["APP_ENV"]',
      'environment = builder.Configuration["APP_ENV"], service = AppSettings.ServiceName')
    run = act(run, { type: 'save-file', path, text: changed })
    run = create(build(run).run).run
    const verified = request(run).run
    expect(evaluateLab(lab, verified).tasks[0].done).toBe(true)
    const repeated = command(verified, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:v1').run
    expect(evaluateLab(lab, repeated).tasks[0].done).toBe(true)
    expect(repeated.runtime.deploymentsByApp[appId].active.generation).toBe(verified.runtime.deploymentsByApp[appId].active.generation)
  })

  it('resets a dirty draft when saving identical source without changing the saved version', () => {
    let run = fixture()
    const path = 'src/Trainer.Api/Program.cs'
    run = act(run, { type: 'draft', path, text: 'different' })
    const saved = act(run, { type: 'save-file', path, text: SOLUTION_FILES[path] })
    expect(saved.project.draftFiles[path]).toBe(SOLUTION_FILES[path])
    expect(saved.project.fileVersions[path]).toBeUndefined()
  })

  it('reveals only declared hints and counts a solution once', () => {
    const withHints = { ...lab, tasks: [{ ...lab.tasks[0], hints: ['first'], solution: 'worked answer' }] }
    let run = createBehavioralRun(withHints, { attemptId: 'hints-attempt' })
    run = applyRunAction(run, { type: 'hint', taskId: 'verify-api' }, withHints).run
    const exhausted = applyRunAction(run, { type: 'hint', taskId: 'verify-api' }, withHints)
    expect(exhausted.run.hintsRevealed['verify-api']).toBe(1)
    run = applyRunAction(exhausted.run, { type: 'solution', taskId: 'verify-api' }, withHints).run
    expect(applyRunAction(run, { type: 'solution', taskId: 'verify-api' }, withHints).run.solutionsRevealed).toEqual({ 'verify-api': true })
  })

  it('keeps captured source after registry deletion while removing its publication and rejecting a new pull', () => {
    let run = create(build(setup()).run).run
    const buildId = run.runtime.deploymentsByApp[appId].active.artifactId
    run = command(run, 'az acr delete -g rg-api -n acrguided --yes').run
    expect(run.artifacts.publishedTags).toEqual({})
    expect(run.artifacts.buildsById[buildId]).toBeTruthy()
    expect(request(run).lines.at(-1).status).toBe(200)
    run = command(run, 'az acr create -g rg-api -n acrguided --sku Basic').run
    const attempted = command(run, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:v1')
    expect(attempted.diagnostics.map((item) => item.code)).toContain('IMAGE_TAG_NOT_FOUND')
    expect(attempted.run.runtime.deploymentsByApp[appId].active.artifactId).toBe(buildId)
  })

  it('reports source errors on failed builds and truthfully serves a wrong route or response', () => {
    let run = setup()
    const path = 'src/Trainer.Api/Program.cs'
    run = act(run, { type: 'save-file', path, text: 'using Trainer.Api;' })
    const failed = build(run)
    expect(failed.diagnostics.length).toBeGreaterThan(0)
    expect(failed.run.artifacts.publishedTags).toEqual({})
    const wrongRoute = SOLUTION_FILES[path].replace('"/api/info"', '"/api/other"')
    run = act(failed.run, { type: 'save-file', path, text: wrongRoute })
    run = create(build(run).run).run
    expect(request(run).lines.at(-1).status).toBe(404)
    const settings = 'src/Trainer.Api/AppSettings.cs'
    run = act(run, { type: 'save-file', path, text: SOLUTION_FILES[path] })
    run = act(run, { type: 'save-file', path: settings, text: SOLUTION_FILES[settings].replace('contoso-api', 'wrong-service') })
    run = build(run, 'wrong').run
    run = command(run, 'az containerapp update -g rg-api -n info-api --image acrguided.azurecr.io/api:wrong').run
    expect(request(run).lines.at(-1).body.service).toBe('wrong-service')
  })

  it('stores a bounded command transcript and honors clear without erasing command history', () => {
    let run = fixture()
    run = command(run, 'az account show').run
    expect(run.scrollback[0]).toMatchObject({ kind: 'cmd', text: 'az account show' })
    expect(run.scrollback[1].kind).toBe('out')
    expect(run.history).toEqual(['az account show'])
    run = command(run, 'clear').run
    expect(run.scrollback).toEqual([])
    expect(run.history).toEqual(['az account show', 'clear'])
  })

  it('advances study duration without advancing simulated runtime time', () => {
    const run = fixture()
    run.runtime.simTimeMs = 4_321
    run.elapsedMs = 250
    const result = applyRunAction(run, { type: 'elapsed', milliseconds: 1_000 }, lab)
    expect(result.run.elapsedMs).toBe(1_250)
    expect(result.run.runtime.simTimeMs).toBe(4_321)
    expect(run.elapsedMs).toBe(250)
    expect(run.runtime.simTimeMs).toBe(4_321)
  })

  it('reports disabled external ingress until the documented enable command activates it', () => {
    let run = build(setup()).run
    const identity = run.sandbox.managedIdentities[0].id
    run = command(run, `az containerapp create -g rg-api -n info-api --environment api-env --image acrguided.azurecr.io/api:v1 --user-assigned ${identity} --registry-server acrguided.azurecr.io --registry-identity ${identity} --env-vars APP_ENV=training`).run
    expect(request(run).diagnostics.map((item) => item.code)).toContain('INGRESS_UNAVAILABLE')
    run = command(run, 'az containerapp ingress enable -g rg-api -n info-api --type external --target-port 8080').run
    expect(request(run).lines.at(-1).status).toBe(200)
  })
})
