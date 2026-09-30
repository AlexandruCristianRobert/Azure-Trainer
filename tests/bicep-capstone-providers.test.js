import { describe, expect, it } from 'vitest'
import { createSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { validateBicepProviders } from '../src/lib/bicep/providers.js'
import { previewBicepDeployment } from '../src/lib/bicep/preview.js'
import { applyBicepDeployment } from '../src/lib/bicep/deploy.js'
import { emptyBicepProvenance } from '../src/lib/bicep/provenance.js'
import { CAPSTONE_MANIFEST, CAPSTONE_SOLUTION_FILES } from '../src/data/templates/containerapps-dotnet/capstone.js'
import { compileBicepProject } from '../src/lib/bicep/compile.js'
import { buildImage } from '../src/lib/project/build.js'
import { createIdentity } from '../src/lib/sandbox/identity.js'
import { bicepCommandSource } from '../src/lib/az/commands/deployment.js'

const group = 'rg-aca-capstone'
const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
const targets = [
  { templatePath: 'infra/bootstrap.bicep', parameterPath: 'infra/bootstrap.bicepparam', resourceGroup: group, deploymentName: 'bootstrap', registryName: 'acrcapstone', identityName: 'id-capstone' },
  { templatePath: 'infra/main.bicep', parameterPath: 'infra/main.bicepparam', resourceGroup: group, deploymentName: 'application', registryName: 'acrcapstone', identityName: 'id-capstone' },
]
const lab = { manifestId: 'containerapps-dotnet-capstone-v1', capabilities: { bicepDeployment: true, acaCapstone: true, cpuScaling: true, healthProbes: true },
  cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] }, bicepTargets: targets }
const node = (type, name, body, path = 'infra/bootstrap.bicep') => ({ id: `${path}#${name}`, kind: 'resource', type, name,
  apiVersion: type === 'Microsoft.ContainerRegistry/registries' ? '2025-11-01' : '2024-11-30',
  armId: `${root}/providers/${type}/${name}`, location: 'eastus', existing: false,
  source: { path, line: 1, column: 1 }, body: { name, location: 'eastus', ...body }, bindings: [] })
const registry = node('Microsoft.ContainerRegistry/registries', 'acrcapstone', { sku: { name: 'Basic' } })
const identity = node('Microsoft.ManagedIdentity/userAssignedIdentities', 'id-capstone', {})
const planned = createIdentity({ ...createSandbox(), resourceGroups: [{ name: group, location: 'eastus' }] },
  { resourceGroup: group, name: identity.name, location: 'eastus' }).resource
const graph = { target: { name: group, id: root, location: 'eastus' }, subscriptionId: SUBSCRIPTION_ID,
  order: [registry, identity], outputs: { registryId: registry.armId, registryServer: 'acrcapstone.azurecr.io',
    identityId: identity.armId, identityClientId: planned.clientId, identityPrincipalId: planned.principalId } }
const make = () => {
  const sandbox = createSandbox()
  sandbox.resourceGroups.push({ name: group, location: 'eastus' })
  return { sandbox, artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} }, project: { fileVersions: {} },
    runtime: { bicep: emptyBicepProvenance(), deploymentsByApp: {} }, nextSequence: 1, dependencyGenerations: {} }
}

describe('Capstone bootstrap providers', () => {
  it('previews and creates a Basic ACR and UAMI with inspectable outputs; reapply is a no-op', () => {
    const run = make()
    expect(previewBicepDeployment(graph, run.sandbox, run.artifacts, lab, run).operations.map(item => item.changeType)).toEqual(['create', 'create'])
    const options = { name: 'bootstrap', templatePath: targets[0].templatePath, parameterPath: targets[0].parameterPath,
      sourceHash: 'bootstrap-source', parameterHash: 'bootstrap-params', fileVersions: { 'infra/bootstrap.bicep': 1, 'infra/bootstrap.bicepparam': 1 } }
    const first = applyBicepDeployment(run, graph, options, lab)
    expect(first.record.status).toBe('succeeded')
    expect(first.record.outputs).toEqual(graph.outputs)
    expect(first.run.sandbox.containerRegistries).toMatchObject([{ id: registry.armId, sku: 'Basic', loginServer: 'acrcapstone.azurecr.io' }])
    expect(first.run.sandbox.managedIdentities).toMatchObject([{ id: identity.armId }])
    expect(previewBicepDeployment(graph, first.run.sandbox, first.run.artifacts, lab, first.run).operations.map(item => item.changeType)).toEqual(['no-change', 'no-change'])
  })

  it('rejects unsupported bootstrap SKU and foreign resource target', () => {
    const run = make()
    const badSku = structuredClone(graph)
    badSku.order[0].body.sku.name = 'Standard'
    expect(validateBicepProviders(badSku, run.sandbox, run.artifacts, lab, run).diagnostics).not.toEqual([])
    const foreign = structuredClone(graph)
    foreign.order[0].armId = foreign.order[0].armId.replace(group, 'other-rg')
    expect(validateBicepProviders(foreign, run.sandbox, run.artifacts, lab, run).diagnostics).not.toEqual([])
    const wrongName = structuredClone(graph)
    wrongName.order[0].name = wrongName.order[0].body.name = 'otheracr'
    wrongName.order[0].armId = `${root}/providers/Microsoft.ContainerRegistry/registries/otheracr`
    wrongName.outputs.registryId = wrongName.order[0].armId
    wrongName.outputs.registryServer = 'otheracr.azurecr.io'
    expect(validateBicepProviders(wrongName, run.sandbox, run.artifacts, lab, run).diagnostics).not.toEqual([])
  })
})

describe('Capstone main providers', () => {
  const compiled = (path, files = CAPSTONE_SOLUTION_FILES) => compileBicepProject(files, CAPSTONE_MANIFEST,
    { resourceGroup: { name: group, location: 'eastus' }, parameterPath: path })
  const bootstrapOptions = { name: 'bootstrap', templatePath: targets[0].templatePath, parameterPath: targets[0].parameterPath,
    sourceHash: 'bootstrap-source', parameterHash: 'bootstrap-params', fileVersions: { 'infra/bootstrap.bicep': 1, 'infra/bootstrap.bicepparam': 1, 'infra/modules/foundation.bicep': 1 } }
  const mainOptions = { name: 'application', templatePath: targets[1].templatePath, parameterPath: targets[1].parameterPath,
    sourceHash: 'main-source', parameterHash: 'main-params', fileVersions: { 'infra/main.bicep': 1, 'infra/main.bicepparam': 1, 'infra/modules/application.bicep': 1 } }
  const readyMain = () => {
    const application = compiled(targets[1].parameterPath).graph
    const project = { manifestId: CAPSTONE_MANIFEST.id, savedFiles: CAPSTONE_SOLUTION_FILES,
      draftFiles: CAPSTONE_SOLUTION_FILES, fileVersions: {} }
    const initial = { ...make(), project }
    const first = applyBicepDeployment(initial, compiled(targets[0].parameterPath).graph,
      { ...bootstrapOptions, ...bicepCommandSource(initial, targets[0].parameterPath) }, lab)
    const built = buildImage(first.run,
      { registryId: registry.armId, loginServer: 'acrcapstone.azurecr.io', image: 'api:v1' })
    return { application, ready: { ...first.run, project, artifacts: built.artifacts, nextSequence: built.nextSequence } }
  }
  it('binds local existing resources to successful bootstrap output and source provenance', () => {
    const foundation = compiled(targets[0].parameterPath)
    const application = compiled(targets[1].parameterPath)
    expect(foundation.diagnostics).toEqual([])
    expect(application.diagnostics).toEqual([])
    const first = applyBicepDeployment(make(), foundation.graph, bootstrapOptions, lab)
    expect(first.record.status).toBe('succeeded')
    expect(first.record.outputs).toMatchObject({ registryId: registry.armId, identityId: identity.armId })
    expect(validateBicepProviders(application.graph, first.run.sandbox, first.run.artifacts, lab, first.run).diagnostics[0]?.message)
      .toMatch(/Image/)
    const withoutProvenance = structuredClone(first.run)
    withoutProvenance.runtime.bicep = emptyBicepProvenance()
    expect(validateBicepProviders(application.graph, withoutProvenance.sandbox, withoutProvenance.artifacts, lab, withoutProvenance).diagnostics[0]?.message)
      .toMatch(/bootstrap/)
  })
  it('activates only a published image with three full HTTP probe tuples and preserves no-op generation', () => {
    const { ready, application } = readyMain()
    const unbuiltRun = { ...ready, artifacts: { buildsById: {}, publishedTags: {}, sourceSnapshotsByHash: {} } }
    const unbuilt = previewBicepDeployment(application, unbuiltRun.sandbox, unbuiltRun.artifacts, lab, unbuiltRun)
    expect(unbuilt.diagnostics[0].message).toMatch(/Image/)
    const preview = previewBicepDeployment(application, ready.sandbox, ready.artifacts, lab, ready)
    expect(preview.diagnostics).toEqual([])
    expect(preview.operations.at(-1).desired.probes).toHaveLength(3)
    const deployed = applyBicepDeployment(ready, application, mainOptions, lab)
    expect(deployed.record.diagnostics).toEqual([])
    expect(deployed.record.status).toBe('succeeded')
    const appId = application.order.find(item => item.type === 'Microsoft.App/containerApps').armId
    expect(deployed.run.runtime.deploymentsByApp[appId].active).toMatchObject({
      appSpec: { healthEndpoints: [{ path: '/health/startup' }, { path: '/health/ready' }, { path: '/health/live' }] },
      probeConfig: { probes: [{ type: 'Startup' }, { type: 'Readiness' }, { type: 'Liveness' }] },
    })
    expect(previewBicepDeployment(application, deployed.run.sandbox, deployed.run.artifacts, lab, deployed.run)
      .operations.map(item => item.changeType)).toEqual(['ignored-existing', 'ignored-existing',
        'no-change', 'no-change', 'no-change', 'no-change', 'no-change', 'no-change', 'no-change'])
    const repeated = applyBicepDeployment(deployed.run, application, mainOptions, lab)
    expect(repeated.run.runtime.deploymentsByApp[appId].active.generation)
      .toBe(deployed.run.runtime.deploymentsByApp[appId].active.generation)
  })
  it('rejects omitted grants and malformed probe tuples before apply', () => {
    const { ready, application } = readyMain()
    const noGrant = structuredClone(application)
    noGrant.order = noGrant.order.filter(item => item.type !== 'Microsoft.Authorization/roleAssignments'
      || item.body.scope.id === registry.armId)
    expect(previewBicepDeployment(noGrant, ready.sandbox, ready.artifacts, lab, ready).diagnostics).not.toEqual([])
    for (const mutate of [
      probe => { delete probe.timeoutSeconds },
      probe => { probe.httpGet.port = 8081 },
      probe => { probe.httpGet.scheme = 'TCP' },
      probe => { probe.failureThreshold = 11 },
    ]) {
      const invalid = structuredClone(application)
      mutate(invalid.order.find(item => item.type === 'Microsoft.App/containerApps').body.properties.template.containers[0].probes[0])
      expect(previewBicepDeployment(invalid, ready.sandbox, ready.artifacts, lab, ready).diagnostics).not.toEqual([])
    }
  })
  it('keeps the previous active app when a later app update fails', () => {
    const { ready, application } = readyMain()
    const first = applyBicepDeployment(ready, application, mainOptions, lab)
    expect(first.record.status).toBe('succeeded')
    const changed = structuredClone(application)
    const app = changed.order.find(item => item.type === 'Microsoft.App/containerApps')
    app.body.properties.configuration.ingress.targetPort = 9000
    for (const probe of app.body.properties.template.containers[0].probes) probe.httpGet.port = 9000
    const attempted = applyBicepDeployment(first.run, changed, { ...mainOptions, sourceHash: 'changed-main' }, lab)
    expect(attempted.record.status).toBe('failed')
    expect(attempted.record.diagnostics[0].message).toMatch(/target port|listener/i)
    expect(attempted.run.sandbox.containerApps).toEqual(first.run.sandbox.containerApps)
    expect(attempted.run.runtime.deploymentsByApp).toEqual(first.run.runtime.deploymentsByApp)
  })
  it('previews a changed probe threshold as an app modification and activates its exact tuple', () => {
    const { ready, application } = readyMain()
    const first = applyBicepDeployment(ready, application, mainOptions, lab)
    const changed = structuredClone(application)
    changed.order.find(item => item.type === 'Microsoft.App/containerApps')
      .body.properties.template.containers[0].probes[1].failureThreshold = 3
    const preview = previewBicepDeployment(changed, first.run.sandbox, first.run.artifacts, lab, first.run)
    expect(preview.diagnostics).toEqual([])
    expect(preview.operations.at(-1).changeType).toBe('modify')
    const second = applyBicepDeployment(first.run, changed, { ...mainOptions, sourceHash: 'probe-change' }, lab)
    expect(second.record.status).toBe('succeeded')
    const appId = changed.order.find(item => item.type === 'Microsoft.App/containerApps').armId
    expect(second.run.runtime.deploymentsByApp[appId].active.probeConfig.probes[1].failureThreshold).toBe(3)
    expect(second.run.runtime.deploymentsByApp[appId].active.generation)
      .not.toBe(first.run.runtime.deploymentsByApp[appId].active.generation)
  })
  it('rejects literal substitutions for both existing resource names and stale bootstrap source', () => {
    const { ready } = readyMain()
    for (const file of ['infra/main.bicep', 'infra/modules/application.bicep']) {
      const text = CAPSTONE_SOLUTION_FILES[file]
      const changed = file === 'infra/main.bicep'
        ? text.replace('registryName: registryName', "registryName: 'acrcapstone'")
        : text.replace('name: registryName', "name: 'acrcapstone'")
      const graph = compiled(targets[1].parameterPath, { ...CAPSTONE_SOLUTION_FILES, [file]: changed }).graph
      expect(graph).toBeTruthy()
      expect(previewBicepDeployment(graph, ready.sandbox, ready.artifacts, lab, ready).diagnostics[0]?.message)
        .toMatch(/parameter|binding/i)
    }
    const graph = compiled(targets[1].parameterPath).graph
    const detached = structuredClone(graph)
    detached.order.find(item => item.type === 'Microsoft.ContainerRegistry/registries').expression.properties = []
    expect(previewBicepDeployment(detached, ready.sandbox, ready.artifacts, lab, ready).diagnostics).not.toEqual([])
    const editedBootstrap = structuredClone(ready)
    editedBootstrap.project.savedFiles['infra/modules/foundation.bicep'] += '\n// changed after successful bootstrap'
    expect(previewBicepDeployment(graph, editedBootstrap.sandbox, editedBootstrap.artifacts, lab, editedBootstrap).diagnostics[0]?.message)
      .toMatch(/bootstrap.*source|source.*bootstrap/i)
  })
})
