import { describe, expect, it } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { compileBicepProject } from '../src/lib/bicep/compile.js'
import { applyBicepDeployment } from '../src/lib/bicep/deploy.js'
import { previewBicepDeployment } from '../src/lib/bicep/preview.js'
import { bicepCommandSource } from '../src/lib/az/commands/deployment.js'
import { buildImage } from '../src/lib/project/build.js'
import { CAPSTONE_BICEP_TARGETS, CAPSTONE_MANIFEST, CAPSTONE_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/capstone.js'
import { foundryEvidenceDependencies } from '../src/lib/simulation/inference.js'
import { appArmId } from '../src/lib/simulation/runtime.js'
import { SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { canonicalize } from '../src/lib/labEngine/evidence.js'

const group = 'rg-aca-capstone'
const stageIds = ['prepare', 'publish', 'deploy', 'healthy', 'incident', 'recovery', 'cleanup']
const command = (verb, target = CAPSTONE_BICEP_TARGETS[1]) => `az deployment group ${verb} -g ${group} -n ${target.deploymentName} --template-file ${target.templatePath} --parameters ${target.parameterPath}`
const act = (run, lab, action) => applyRunAction(run, action, lab)

function fixture() {
  const appId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}/providers/Microsoft.App/containerApps/api-capstone`
  const scenarios = Object.fromEntries([
    ['healthy-request', 200, []],
    ['missing-request', 502, []],
    ['transient-request', 200, [{ status: 429, retryAfterSeconds: 2 }, { status: 200 }]],
    ['persistent-request', 503, [{ status: 429, retryAfterSeconds: 1 }, { status: 429, retryAfterSeconds: 2 }, { status: 429 }]],
  ].map(([id, status, attempts]) => [id, { kind: 'foundry', version: 1, appId,
    request: { method: 'POST', path: '/api/summarize', body: { text: 'Capstone incident' } },
    faultProfile: { attempts }, expected: { status,
      ...(id === 'missing-request' ? { diagnosticCode: 'FOUNDRY_DEPLOYMENT_NOT_FOUND' } : {}) } }]))
  return { id: 'capstone-incident-fixture', engineVersion: 2, contentVersion: 1,
    manifestId: CAPSTONE_MANIFEST.id, initialProjectFiles: CAPSTONE_SOLUTION_FILES,
    capabilities: { acaCapstone: true, bicepDeployment: true, acrBuild: true, foundryInference: true, cpuScaling: true, healthProbes: true },
    cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] },
    bicepTargets: CAPSTONE_BICEP_TARGETS, scenarios,
    stages: stageIds.map(id => ({ id, taskIds: id === 'recovery' ? ['recovery', 'persistent'] : [id] })),
    tasks: [...stageIds, 'persistent'].map(id => ({ id,
      check: ({ runtime }) => id !== 'healthy' || Object.values(runtime.deploymentsByApp).some(item => item.active?.foundry),
      ...({ healthy: 'healthy-request', incident: 'missing-request', recovery: 'transient-request', persistent: 'persistent-request' }[id]
        ? { verification: { scenarioId: { healthy: 'healthy-request', incident: 'missing-request', recovery: 'transient-request', persistent: 'persistent-request' }[id], scenarioVersion: 1 },
          dependencies: id === 'healthy' ? foundryEvidenceDependencies(appId) : { incident: ({ runtime }) => runtime.incident?.id ?? null } }
        : {}) })),
  }
}

function prepared() {
  const lab = fixture()
  let run = createBehavioralRun(lab, { attemptId: 'incident-run' })
  run = act(run, lab, { type: 'command', line: `az group create -n ${group} -l eastus` }).run
  const graph = path => compileBicepProject(run.project.savedFiles, CAPSTONE_MANIFEST,
    { resourceGroup: { name: group, location: 'eastus' }, parameterPath: path }).graph
  const bootstrap = CAPSTONE_BICEP_TARGETS[0]
  run = applyBicepDeployment(run, graph(bootstrap.parameterPath),
    { name: bootstrap.deploymentName, ...bicepCommandSource(run, bootstrap.parameterPath),
      parameterPath: bootstrap.parameterPath, templatePath: bootstrap.templatePath }, lab).run
  const registry = run.sandbox.containerRegistries[0]
  const built = buildImage(run, { registryId: registry.id, loginServer: registry.loginServer, image: 'api:v1' })
  run = { ...run, artifacts: built.artifacts, nextSequence: built.nextSequence }
  const main = CAPSTONE_BICEP_TARGETS[1]
  const deployed = applyBicepDeployment(run, graph(main.parameterPath),
    { name: main.deploymentName, ...bicepCommandSource(run, main.parameterPath),
      parameterPath: main.parameterPath, templatePath: main.templatePath }, lab)
  expect(deployed.record.diagnostics).toEqual([])
  run = deployed.run
  const app = run.sandbox.containerApps[0]
  const appId = appArmId(app)
  return { lab, run, appId, graph: () => graph(main.parameterPath) }
}

function sealedHealthy() {
  const context = prepared()
  let { run } = context
  for (const id of stageIds.slice(0, 4)) {
    if (id === 'healthy') run = act(run, context.lab, { type: 'request', scenarioId: 'healthy-request' }).run
    run = act(run, context.lab, { type: 'advance-stage' }).run
  }
  return { ...context, run }
}

describe('Capstone incident and source repair', () => {
  it('reopens recovery when a no-change Bicep create records a new attempt after the checkpoint', () => {
    let { run, lab } = sealedHealthy()
    run = act(run, lab, { type: 'inject-incident' }).run
    run = act(run, lab, { type: 'request', scenarioId: 'missing-request' }).run
    run = act(run, lab, { type: 'advance-stage' }).run
    run = act(run, lab, { type: 'command', line: command('create') }).run
    run = act(run, lab, { type: 'request', scenarioId: 'transient-request' }).run
    run = act(run, lab, { type: 'request', scenarioId: 'persistent-request' }).run
    run = act(run, lab, { type: 'advance-stage' }).run
    expect(run.stages.cleanupCheckpoint).toBeTruthy()
    const before = run.runtime.bicep.nextAttempt
    run = act(run, lab, { type: 'command', line: command('create') }).run
    expect(run.runtime.bicep.nextAttempt).toBe(before + 1)
    expect(run.runtime.bicep.attempts.at(-1).operations.every(item =>
      ['no-change', 'ignored-existing'].includes(item.changeType))).toBe(true)
    expect(run.stages.activeStageId).toBe('recovery')
    expect(run.stages.sealedStages).toHaveLength(5)
    expect(run.stages.cleanupCheckpoint).toBeNull()
  })

  it('retains sealed incident evidence after owned-group deletion and rejects a missing app before cleanup', () => {
    const ready = sealedHealthy()
    let { run, lab } = ready
    run = act(run, lab, { type: 'inject-incident' }).run
    run = act(run, lab, { type: 'request', scenarioId: 'missing-request' }).run
    run = act(run, lab, { type: 'advance-stage' }).run
    run = act(run, lab, { type: 'command', line: command('create') }).run
    run = act(run, lab, { type: 'request', scenarioId: 'transient-request' }).run
    run = act(run, lab, { type: 'request', scenarioId: 'persistent-request' }).run
    const premature = structuredClone(run)
    premature.sandbox.containerApps = []
    delete premature.runtime.deploymentsByApp[ready.appId]
    expect(() => validateBehavioralRun(premature, lab)).toThrow()
    run = act(run, lab, { type: 'advance-stage' }).run
    expect(run.stages.cleanupCheckpoint.ownedGroups).toEqual([group])
    const checkpoint = structuredClone(run.stages.cleanupCheckpoint)
    run = act(run, lab, { type: 'command', line: command('what-if') }).run
    expect(run.stages.cleanupCheckpoint).toEqual(checkpoint)
    run = act(run, lab, { type: 'command', line: `az containerapp delete -g ${group} -n api-capstone --yes` }).run
    expect(run.stages.cleanupCheckpoint).toEqual(checkpoint)
    expect(run.stages.deletedApps).toMatchObject([{ appId: ready.appId }])
    expect(validateBehavioralRun(structuredClone(run), lab)).toBeTruthy()
    const erasedDeletion = structuredClone(run)
    erasedDeletion.stages.deletedApps = []
    expect(() => validateBehavioralRun(erasedDeletion, lab)).toThrow()
    run = act(run, lab, { type: 'command', line: `az group delete -n ${group} --yes` }).run
    expect(validateBehavioralRun(run, lab)).toBe(run)
    expect(run.artifacts.publishedTags).toEqual({})
    expect(Object.keys(run.artifacts.buildsById)).toHaveLength(1)
    expect(run.runtime.deploymentsByApp).toEqual({})
    expect(act(run, lab, { type: 'advance-stage' }).run.stages.sealedStages).toHaveLength(7)
  })
  it('gates one-shot injection on sealed health, keeps base and source immutable, and exposes drift to request and what-if', () => {
    const { lab, run: early, appId, graph } = prepared()
    expect(act(early, lab, { type: 'inject-incident' }).diagnostics[0].code).toBe('INVALID_ACTION')
    const ready = sealedHealthy()
    const base = structuredClone(ready.run.runtime.deploymentsByApp[appId])
    const files = structuredClone(ready.run.project.savedFiles)
    const injected = act(ready.run, lab, { type: 'inject-incident' })
    expect(injected.diagnostics[0].code).toBe('CAPSTONE_INCIDENT_INJECTED')
    const run = injected.run
    expect(run.runtime.incident).toMatchObject({ id: `incident-${ready.run.nextSequence}`, appId, sequence: ready.run.nextSequence, status: 'active' })
    expect(run.sandbox.containerApps[0].incidentDrift).toMatchObject({ incidentId: run.runtime.incident.id,
      effectiveDeployment: 'missing-deployment' })
    expect(run.runtime.deploymentsByApp[appId]).toEqual(base)
    expect(run.project.savedFiles).toEqual(files)
    expect(foundryEvidenceDependencies(appId).deployment(run)).toMatchObject({
      generation: run.runtime.incident.effectiveGeneration,
      foundry: { deployment: 'missing-deployment' },
    })
    expect(previewBicepDeployment(graph(), run.sandbox, run.artifacts, lab, run).operations.at(-1).changeType).toBe('modify')
    const failed = act(run, lab, { type: 'request', scenarioId: 'missing-request' })
    expect(failed.lines[0]).toMatchObject({ status: 502, upstream: { deployment: 'missing-deployment', attempts: [] } })
    expect(failed.lines[0].upstream.incidentId).toBe(run.runtime.incident.id)
    expect(failed.diagnostics[0].code).toBe('FOUNDRY_DEPLOYMENT_NOT_FOUND')
    expect(failed.diagnostics[0].incidentId).toBe(run.runtime.incident.id)
    expect(evaluateLab(lab, failed.run).tasks.find(item => item.id === 'healthy').done).toBe(true)
    expect(act(run, lab, { type: 'inject-incident' }).diagnostics[0].code).toBe('INVALID_ACTION')
    expect(act(run, lab, { type: 'inject-incident', appId }).diagnostics[0].code).toBe('INVALID_ACTION')
    expect(validateBehavioralRun(structuredClone(run), lab)).toBeTruthy()
  })

  it('keeps drift through failed apply and CLI update, then repairs through current saved main Bicep', () => {
    const { lab, run: ready, appId, graph } = sealedHealthy()
    const incident = act(ready, lab, { type: 'inject-incident' }).run
    const base = structuredClone(incident.runtime.deploymentsByApp[appId].active)
    const cliAttempt = act(incident, lab, { type: 'command', line: `az containerapp update -g ${group} -n api-capstone --set-env-vars FOUNDRY_DEPLOYMENT=manual-fix` })
    expect(cliAttempt.diagnostics[0].code).toBe('INVALID_ACTION')
    expect(cliAttempt.diagnostics[0].message).toMatch(/saved main Bicep/)
    const cli = cliAttempt.run
    expect(cli.sandbox.containerApps[0].incidentDrift).toEqual(incident.sandbox.containerApps[0].incidentDrift)
    expect(cli.runtime.incident.status).toBe('active')
    expect(cli.runtime.deploymentsByApp[appId].active).toEqual(base)
    expect(cli.sandbox.containerApps[0].envVars).toEqual(incident.sandbox.containerApps[0].envVars)
    const broken = structuredClone(graph())
    broken.order.find(item => item.type === 'Microsoft.App/containerApps').body.properties.configuration.ingress.targetPort = 9000
    for (const probe of broken.order.find(item => item.type === 'Microsoft.App/containerApps').body.properties.template.containers[0].probes) probe.httpGet.port = 9000
    const failed = applyBicepDeployment(incident, broken, { name: 'application', sourceHash: 'bad', parameterHash: 'bad' }, lab)
    expect(failed.record.status).toBe('failed')
    expect(failed.run.runtime.deploymentsByApp[appId].active).toEqual(base)
    expect(failed.run.sandbox.containerApps[0].incidentDrift).toEqual(incident.sandbox.containerApps[0].incidentDrift)
    const repaired = act(incident, lab, { type: 'command', line: command('create') })
    expect(repaired.diagnostics).toEqual([])
    expect(repaired.run.runtime.incident.status).toBe('repaired')
    expect(repaired.run.sandbox.containerApps[0].incidentDrift).toBeUndefined()
    expect(repaired.run.runtime.deploymentsByApp[appId].active.generation).not.toBe(base.generation)
    expect(repaired.run.runtime.deploymentsByApp[appId].active.foundry.deployment).toBe('summarizer-primary')
    expect(previewBicepDeployment(graph(), repaired.run.sandbox, repaired.run.artifacts, lab, repaired.run).operations.at(-1).changeType).toBe('no-change')
  })

  it('captures bounded transient recovery and persistent 429 failure traces', () => {
    const { lab, run: ready } = sealedHealthy()
    const incident = act(ready, lab, { type: 'inject-incident' }).run
    const repaired = act(incident, lab, { type: 'command', line: command('create') }).run
    const recovered = act(repaired, lab, { type: 'request', scenarioId: 'transient-request' })
    expect(recovered.lines[0].status).toBe(200)
    expect(recovered.lines[0].upstream.attempts.map(item => [item.status, item.delayAfterMs])).toEqual([[429, 2000], [200, 0]])
    const persistent = act(recovered.run, lab, { type: 'request', scenarioId: 'persistent-request' })
    expect(persistent.lines[0].status).toBe(503)
    expect(persistent.lines[0].upstream.attempts.map(item => item.status)).toEqual([429, 429, 429])
    expect(persistent.diagnostics[0].code).toBe('UPSTREAM_UNAVAILABLE')
  })

  it('rejects forged and unlinked persisted incident records', () => {
    const { lab, run: ready } = sealedHealthy()
    const incident = act(ready, lab, { type: 'inject-incident' }).run
    for (const [index, mutate] of [
      copy => { copy.runtime.incident.sequence = 1 },
      copy => { copy.runtime.incident.appId = 'foreign' },
      copy => { copy.sandbox.containerApps[0].incidentDrift.effectiveDeployment = 'forged' },
      copy => { delete copy.sandbox.containerApps[0].incidentDrift },
      copy => { copy.stages.sealedStages.pop() },
      copy => { delete copy.runtime.incident.diagnostic },
      copy => { copy.runtime.incident.sequence = copy.stages.sealedStages[3].sequence },
    ].entries()) {
      const forged = structuredClone(incident)
      mutate(forged)
      expect(() => validateBehavioralRun(forged, lab), `forgery ${index}`).toThrow()
    }
  })

  it('rejects a forged repaired state without a successful saved main apply', () => {
    const { lab, run: ready, appId } = sealedHealthy()
    const incident = act(ready, lab, { type: 'inject-incident' }).run
    const forged = structuredClone(incident)
    delete forged.sandbox.containerApps[0].incidentDrift
    forged.runtime.deploymentsByApp[appId].active.generation = 'deployment-forged'
    forged.runtime.incident.status = 'repaired'
    forged.runtime.incident.restoredGeneration = 'deployment-forged'
    expect(() => validateBehavioralRun(forged, lab)).toThrow()
  })

  it('hydrates after the incident diagnostic rolls out of the bounded runtime log', () => {
    const { lab, run: ready } = sealedHealthy()
    const incident = act(ready, lab, { type: 'inject-incident' }).run
    const compacted = structuredClone(incident)
    compacted.runtime.logs = Array.from({ length: 500 }, (_, index) => ({
      level: 'error', message: `Later bounded diagnostic ${index}`,
    }))
    expect(validateBehavioralRun(compacted, lab)).toBe(compacted)
    const forged = structuredClone(compacted)
    forged.runtime.incident.diagnostic.message = 'forged'
    expect(() => validateBehavioralRun(forged, lab)).toThrow()
  })

  it('retains a bounded repair witness after twenty later failed apply records prune the original attempt', () => {
    const { lab, run: ready, appId, graph } = sealedHealthy()
    const incident = act(ready, lab, { type: 'inject-incident' }).run
    let run = act(incident, lab, { type: 'command', line: command('create') }).run
    const original = run.runtime.incident.repairAttempt.id
    const broken = structuredClone(graph())
    const app = broken.order.find(item => item.type === 'Microsoft.App/containerApps')
    app.body.properties.configuration.ingress.targetPort = 9000
    for (const probe of app.body.properties.template.containers[0].probes) probe.httpGet.port = 9000
    for (let index = 0; index < 21; index++) {
      const applied = applyBicepDeployment(run, broken, { name: 'application',
        parameterPath: 'infra/main.bicepparam', templatePath: 'infra/main.bicep',
        sourceHash: 'broken-source', parameterHash: 'broken-parameters',
        fileVersions: { 'infra/main.bicep': 0, 'infra/main.bicepparam': 0 } }, lab)
      expect(applied.record.status).toBe('failed')
      run = applied.run
    }
    expect(run.runtime.bicep.attempts.some(item => item.id === original)).toBe(false)
    expect(run.runtime.deploymentsByApp[appId].active.generation).toBe(run.runtime.incident.restoredGeneration)
    expect(validateBehavioralRun(run, lab)).toBe(run)
    const forged = structuredClone(run)
    forged.runtime.incident.repairAttempt.operations = []
    expect(() => validateBehavioralRun(forged, lab)).toThrow()
    const forgedSeal = structuredClone(run)
    forgedSeal.stages.sealedStages[3].deployment.attemptId = 'bicep-attempt-1'
    forgedSeal.evidence.milestoneRecords[3].snapshot = canonicalize(forgedSeal.stages.sealedStages[3])
    expect(() => validateBehavioralRun(forgedSeal, lab)).toThrow()
  })

  it('keeps historical stage and repair proof through later successful no-op reapplications', () => {
    const { lab, run: ready } = sealedHealthy()
    const incident = act(ready, lab, { type: 'inject-incident' }).run
    let run = act(incident, lab, { type: 'command', line: command('create') }).run
    for (let index = 0; index < 21; index++) {
      const result = act(run, lab, { type: 'command', line: command('create') })
      expect(result.diagnostics).toEqual([])
      run = result.run
    }
    expect(run.runtime.bicep.attempts.some(item => item.id === run.runtime.incident.repairAttempt.id)).toBe(false)
    expect(validateBehavioralRun(run, lab)).toBe(run)
  })
})
