import { describe, expect, it } from 'vitest'
import * as fixture from '../src/data/templates/containerapps-dotnet/bicep-independent.js'
import { initializeBicepIndependentSimulation } from '../src/data/templates/containerapps-dotnet/bicep-independent-seed.js'
import { compileBicepProject } from '../src/lib/bicep/compile.js'
import { previewBicepDeployment } from '../src/lib/bicep/preview.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { simulateFoundryRequest } from '../src/lib/simulation/inference.js'
import { reconcileCpuRuntime } from '../src/lib/simulation/cpu.js'
import { appArmId } from '../src/lib/simulation/runtime.js'

const first = 'infra/first.bicepparam', second = 'infra/second.bicepparam'
const targets = fixture.BICEP_INDEPENDENT_TARGETS
const configs = fixture.BICEP_INDEPENDENT_CONFIGS
const lab = { id: 'aca-bicep-independent', engineVersion: 2, contentVersion: 1,
  manifestId: fixture.BICEP_INDEPENDENT_MANIFEST.id,
  capabilities: { bicepDeployment: true, cpuScaling: true, foundryInference: true },
  bicepTargets: targets, cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] },
  tasks: [], initialProjectFiles: fixture.BICEP_INDEPENDENT_INITIAL_FILES,
  initializeSimulation: initializeBicepIndependentSimulation }
const fresh = () => createBehavioralRun(lab, { attemptId: 'independent-fixture' })
const graph = (files, target) => compileBicepProject(files, fixture.BICEP_INDEPENDENT_MANIFEST,
  { resourceGroup: { name: target.resourceGroup, location: 'eastus' }, parameterPath: target.parameterPath })
const command = (run, line) => applyRunAction(run, { type: 'command', line }, lab)
const deploy = (verb, target) => `az deployment group ${verb} --name ${target.deploymentName} --resource-group ${target.resourceGroup} --template-file infra/main.bicep --parameters ${target.parameterPath}`
const appNode = compiled => compiled.graph.order.find(node => node.type === 'Microsoft.App/containerApps')
const env = app => Object.fromEntries(app.body.properties.template.containers[0].env.map(item => [item.name, item.value]))

describe('independent Bicep two-target fixture', () => {
  it('shares modules while resolving different local names, settings, scale and linked resources', () => {
    const [primary, staging] = configs
    const solution = fixture.BICEP_INDEPENDENT_SOLUTION_FILES
    expect(graph(fixture.BICEP_INDEPENDENT_INITIAL_FILES, staging).diagnostics.length).toBeGreaterThan(0)
    const firstGraph = graph(solution, primary), secondGraph = graph(solution, staging)
    expect(firstGraph.diagnostics).toEqual([])
    expect(secondGraph.diagnostics).toEqual([])
    for (const [compiled, target] of [[firstGraph, primary], [secondGraph, staging]]) {
      const app = appNode(compiled)
      expect(app.name).toBe(target.appName)
      expect(compiled.graph.order.filter(node => node.kind === 'resource')).toHaveLength(9)
      expect(compiled.graph.order.filter(node => node.kind === 'resource').every(node =>
        node.armId.toLowerCase().includes(`/resourcegroups/${target.resourceGroup.toLowerCase()}/`))).toBe(true)
      expect(compiled.graph.order.filter(node => node.type === 'Microsoft.Authorization/roleAssignments')).toHaveLength(2)
      expect(compiled.graph.order.find(node => node.type === 'Microsoft.ContainerRegistry/registries').existing).toBe(true)
      const registry = compiled.graph.order.find(node => node.type === 'Microsoft.ContainerRegistry/registries')
      const account = compiled.graph.order.find(node => node.type === 'Microsoft.CognitiveServices/accounts')
      const identity = compiled.graph.order.find(node => node.type === 'Microsoft.ManagedIdentity/userAssignedIdentities')
      const roles = compiled.graph.order.filter(node => node.type === 'Microsoft.Authorization/roleAssignments')
      expect(roles.map(node => node.body.scope.id).sort()).toEqual([account.armId, registry.armId].sort())
      expect(new Set(roles.map(node => node.body.properties.principalId)).size).toBe(1)
      expect(roles.every(node => node.bindings.some(binding => binding.path === '/properties/principalId'
        && binding.source === identity.id))).toBe(true)
      expect(compiled.graph.order.filter(node => node.type?.startsWith('Microsoft.CognitiveServices/accounts/')).every(node =>
        node.body.parent.id === compiled.graph.order.find(item => item.type === 'Microsoft.CognitiveServices/accounts').armId)).toBe(true)
      expect(env(app).FOUNDRY_DEPLOYMENT).toBe(target.modelDeploymentName)
    }
    expect(env(appNode(firstGraph)).APP_ENV).toBe('training')
    expect(env(appNode(secondGraph)).APP_ENV).toBe('staging')
    expect(appNode(firstGraph).body.properties.template.scale).toMatchObject({ minReplicas: 1, maxReplicas: 2 })
    expect(appNode(secondGraph).body.properties.template.scale).toMatchObject({ minReplicas: 2, maxReplicas: 4 })
  })

  it('seeds two Basic registries and target-specific immutable images but only the first active stack', () => {
    const run = fresh()
    expect(run.sandbox.resourceGroups.map(item => item.name)).toEqual(configs.map(item => item.resourceGroup))
    expect(run.sandbox.containerRegistries.map(item => item.sku)).toEqual(['Basic', 'Basic'])
    expect(Object.keys(run.artifacts.publishedTags)).toHaveLength(2)
    const [primary, staging] = configs
    for (const target of [primary, staging]) {
      const buildId = run.artifacts.publishedTags[target.image.toLowerCase()]
      const artifact = run.artifacts.buildsById[buildId]
      expect(artifact.appSpec.foundry).toMatchObject({ endpoint: target.endpoint, deployment: target.modelDeploymentName })
      expect(run.artifacts.sourceSnapshotsByHash[artifact.sourceHash]).toBeDefined()
    }
    expect(Object.keys(run.artifacts.sourceSnapshotsByHash)).toHaveLength(2)
    expect(run.project.savedFiles).toEqual(fixture.BICEP_INDEPENDENT_INITIAL_FILES)
    expect(run.project.savedFiles['src/Trainer.Api/appsettings.json']).toContain(primary.modelDeploymentName)
    expect(run.sandbox.containerApps.map(item => item.name)).toEqual([primary.appName])
    const active = run.runtime.deploymentsByApp[fixture.BICEP_INDEPENDENT_BASELINE.appId]?.active
    expect(active).toBeDefined()
    expect(active.artifactId).toBe(fixture.BICEP_INDEPENDENT_BASELINE.artifactId)
    expect(active.image).toBe(fixture.BICEP_INDEPENDENT_BASELINE.image)
    expect(active.scalePolicy).toMatchObject(fixture.BICEP_INDEPENDENT_BASELINE.scalePolicy)
    expect(Object.isFrozen(fixture.BICEP_INDEPENDENT_BASELINE.scalePolicy)).toBe(true)
    expect(run.sandbox.managedIdentities).toHaveLength(1)
    expect(run.sandbox.containerAppEnvironments).toHaveLength(1)
    expect(run.sandbox.foundryAccounts).toHaveLength(1)
    const firstPreview = previewBicepDeployment(graph(run.project.savedFiles, primary).graph,
      run.sandbox, run.artifacts, lab)
    expect(firstPreview.diagnostics).toEqual([])
    expect(firstPreview.operations.map(item => item.changeType).every(change =>
      ['no-change', 'ignored-existing'].includes(change))).toBe(true)
    const request = simulateFoundryRequest(run, { appId: fixture.BICEP_INDEPENDENT_BASELINE.appId,
      request: { method: 'POST', path: '/api/summarize', body: { text: 'Primary stack is healthy.' } },
      faultProfile: { attempts: [] } })
    expect(request.status).toBe(200)
    expect(request.upstream.deployment).toBe(primary.modelDeploymentName)
    const cpu = reconcileCpuRuntime(run, lab).runtime.cpuByApp[fixture.BICEP_INDEPENDENT_BASELINE.appId]
    expect(cpu.readyReplicas).toBe(primary.minReplicas)
    expect(run.runtime.bicep.attempts).toEqual([])
    expect(run.runtime.bicep.previews).toEqual([])
    expect(run.runtime.bicep.observations).toEqual([])
    expect(run.history).toEqual([])
    expect(run.evidence.experimentsById).toEqual({})
    expect(run.nextSequence).toBeGreaterThan(2)
    expect(command(run, `az acr build --registry ${primary.registryName} --image api:v3 --file Dockerfile .`).lines[0].kind).toBe('err')
  })

  it('applies the second graph without changing first resources or accepting cross-target registry and image aliases', () => {
    const [primary, staging] = configs
    const run = fresh()
    const firstApp = structuredClone(run.sandbox.containerApps[0])
    const firstActive = structuredClone(run.runtime.deploymentsByApp[fixture.BICEP_INDEPENDENT_BASELINE.appId].active)
    expect(previewBicepDeployment(graph(fixture.BICEP_INDEPENDENT_SOLUTION_FILES, staging).graph,
      run.sandbox, run.artifacts, lab).diagnostics).toEqual([])
    const saved = applyRunAction(run, { type: 'save-file', path: second,
      text: fixture.BICEP_INDEPENDENT_SOLUTION_FILES[second] }, lab)
    expect(saved.diagnostics).toEqual([])
    const preview = command(saved.run, deploy('what-if', staging))
    expect(preview.lines[0].kind).toBe('out')
    const created = command(preview.run, deploy('create', staging))
    expect(created.lines[0].kind).toBe('out')
    expect(created.run.sandbox.containerApps.map(item => item.name)).toEqual([primary.appName, staging.appName])
    expect(created.run.sandbox.containerApps[0]).toEqual(firstApp)
    expect(created.run.runtime.deploymentsByApp[fixture.BICEP_INDEPENDENT_BASELINE.appId].active).toEqual(firstActive)
    expect(created.run.runtime.bicep.attempts.at(-1)).toMatchObject({ target: staging.resourceGroup, parameterPath: second, status: 'succeeded' })
    const secondAppId = appArmId(created.run.sandbox.containerApps.find(item => item.name === staging.appName))
    expect(simulateFoundryRequest(created.run, { appId: secondAppId,
      request: { method: 'POST', path: '/api/summarize', body: { text: 'Staging stack is healthy.' } },
      faultProfile: { attempts: [] } }).status).toBe(200)
    expect(created.run.runtime.deploymentsByApp[secondAppId].active.scalePolicy).toMatchObject({ minReplicas: 2, maxReplicas: 4 })
    const wrongRegistry = { ...fixture.BICEP_INDEPENDENT_SOLUTION_FILES,
      [second]: fixture.BICEP_INDEPENDENT_SOLUTION_FILES[second].replace(staging.registryName, primary.registryName) }
    expect(previewBicepDeployment(graph(wrongRegistry, staging).graph, run.sandbox, run.artifacts, lab).diagnostics.length).toBeGreaterThan(0)
    const wrongImage = { ...fixture.BICEP_INDEPENDENT_SOLUTION_FILES,
      [second]: fixture.BICEP_INDEPENDENT_SOLUTION_FILES[second].replace("param imageTag = 'v2'", "param imageTag = 'v1'") }
    expect(previewBicepDeployment(graph(wrongImage, staging).graph, run.sandbox, run.artifacts, lab).diagnostics.length).toBeGreaterThan(0)
  })
})
