import { describe, expect, it } from 'vitest'
import { validateBicepProviders } from '../src/lib/bicep/providers.js'
import { previewBicepDeployment } from '../src/lib/bicep/preview.js'
import { createSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { createIdentity } from '../src/lib/sandbox/identity.js'
import { applyBicepDeployment } from '../src/lib/bicep/deploy.js'
import { simulateFoundryRequest } from '../src/lib/simulation/inference.js'

const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/demo-rg`
const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/sampleacr`
const source = { path: 'infra/main.bicep', line: 7, column: 1 }
function node(type, name, body, options = {}) {
  return { id: `main#${name}`, kind: 'resource', type, apiVersion: options.version ?? ({
    'Microsoft.ContainerRegistry/registries': '2025-11-01',
    'Microsoft.ManagedIdentity/userAssignedIdentities': '2024-11-30',
    'Microsoft.App/managedEnvironments': '2025-07-01',
    'Microsoft.App/containerApps': '2025-07-01',
    'Microsoft.CognitiveServices/accounts': '2025-06-01',
    'Microsoft.CognitiveServices/accounts/projects': '2025-06-01',
    'Microsoft.CognitiveServices/accounts/deployments': '2025-06-01',
    'Microsoft.Authorization/roleAssignments': '2022-04-01',
  })[type], name, armId: options.armId ?? `${root}/providers/${type}/${name}`,
    location: 'eastus', existing: options.existing ?? false, source, body: { name, location: 'eastus', ...body }, bindings: options.bindings ?? [] }
}
function fixture() {
  const sandbox = createSandbox()
  sandbox.resourceGroups.push({ name: 'demo-rg', location: 'eastus' })
  sandbox.containerRegistries.push({ id: registryId, name: 'sampleacr', resourceGroup: 'demo-rg', location: 'eastus', loginServer: 'sampleacr.azurecr.io', sku: 'Basic', tags: null })
  const registry = node('Microsoft.ContainerRegistry/registries', 'sampleacr', {}, { existing: true })
  const identity = node('Microsoft.ManagedIdentity/userAssignedIdentities', 'app-id', {})
  const plannedIdentity = createIdentity(sandbox, { resourceGroup: 'demo-rg', name: identity.name, location: 'eastus' }).resource
  const environment = node('Microsoft.App/managedEnvironments', 'app-env', { properties: { appLogsConfiguration: { destination: 'none' } } })
  const account = node('Microsoft.CognitiveServices/accounts', 'myfoundry', { kind: 'AIServices', sku: { name: 'S0' }, identity: { type: 'SystemAssigned' }, properties: { allowProjectManagement: true, customSubDomainName: 'myfoundry' } })
  const project = node('Microsoft.CognitiveServices/accounts/projects', 'chat', { parent: { id: account.armId } }, { armId: `${account.armId}/projects/chat`, bindings: [{ path: '/parent', source: account.id, property: '' }] })
  const deployment = node('Microsoft.CognitiveServices/accounts/deployments', 'chat-model', { parent: { id: account.armId }, sku: { name: 'GlobalStandard', capacity: 10 }, properties: { model: { format: 'OpenAI', name: 'gpt-5-mini', version: '2025-08-07' } } }, { armId: `${account.armId}/deployments/chat-model`, bindings: [{ path: '/parent', source: account.id, property: '' }] })
  const principalId = plannedIdentity.principalId
  const clientId = plannedIdentity.clientId
  const role = (name, scope, definition, scopeNode) => node('Microsoft.Authorization/roleAssignments', name, { scope: { id: scope }, properties: { principalId, principalType: 'ServicePrincipal', roleDefinitionId: `/subscriptions/${SUBSCRIPTION_ID}/providers/Microsoft.Authorization/roleDefinitions/${definition}` } }, { armId: `${scope}/providers/Microsoft.Authorization/roleAssignments/${name}`, bindings: [{ path: '/scope', source: scopeNode.id, property: '' }, { path: '/properties/principalId', source: identity.id, property: 'properties.principalId', via: 'main#identity-module' }] })
  const acrRole = role('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', registryId, '7f951dda-4ed3-4680-a7ca-43fe172d538d', registry)
  const aiRole = role('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', account.armId, 'a97b65f3-24c7-4388-baec-2e87135dc908', account)
  delete acrRole.body.location; delete aiRole.body.location
  const app = node('Microsoft.App/containerApps', 'myapp', { identity: { type: 'UserAssigned', userAssignedIdentities: { [`${identity.armId}`]: {} } }, properties: {
    managedEnvironmentId: environment.armId,
    configuration: { ingress: { external: true, targetPort: 8080 }, registries: [{ server: 'sampleacr.azurecr.io', identity: identity.armId }] },
    template: { containers: [{ name: 'api', image: 'sampleacr.azurecr.io/api:v1', resources: { cpu: 0.5, memory: '1Gi' }, env: [
      { name: 'APP_ENV', value: 'training' }, { name: 'AZURE_CLIENT_ID', value: clientId },
      { name: 'FOUNDRY_ENDPOINT', value: 'https://myfoundry.services.ai.azure.com/openai/v1/' }, { name: 'FOUNDRY_DEPLOYMENT', value: 'chat-model' },
    ] }], scale: { minReplicas: 1, maxReplicas: 5, rules: [{ name: 'cpu', custom: { type: 'cpu', metadata: { type: 'Utilization', value: '60' } } }] } },
  } }, { bindings: [
    { path: '/properties/managedEnvironmentId', source: environment.id, property: 'id' },
    { path: '/identity/userAssignedIdentities', source: identity.id, property: 'id' },
    { path: '/properties/configuration/registries/0/server', source: registry.id, property: 'properties.loginServer' },
    { path: '/properties/configuration/registries/0/identity', source: identity.id, property: 'id' },
    { path: '/properties/template/containers/0/image', source: registry.id, property: 'properties.loginServer' },
    { path: '/properties/template/containers/0/env/1/value', source: identity.id, property: 'properties.clientId', via: 'main#identity-module' },
    { path: '/properties/template/containers/0/env/2/value', source: account.id, property: 'properties.endpoint', via: 'main#foundry-module' },
    { path: '/properties/template/containers/0/env/3/value', source: deployment.id, property: 'name', via: 'main#foundry-module' },
  ] })
  const graph = { target: { name: 'demo-rg', location: 'eastus', id: root }, subscriptionId: SUBSCRIPTION_ID, order: [registry, identity, environment, account, project, deployment, acrRole, aiRole, app] }
  const artifact = { id: 'build-1', image: { registryId, loginServer: 'sampleacr.azurecr.io', repository: 'api', tag: 'v1' }, appSpec: { foundry: { endpoint: 'https://myfoundry.services.ai.azure.com/openai/v1/', deployment: 'chat-model' } } }
  const artifacts = { publishedTags: { 'sampleacr.azurecr.io/api:v1': 'build-1' }, buildsById: { 'build-1': artifact } }
  return { graph, sandbox, artifacts, nodes: { registry, identity, environment, account, project, deployment, acrRole, aiRole, app } }
}

function faultFixture() {
  const base = fixture()
  const { graph, sandbox, nodes } = base
  const decoy = node('Microsoft.ManagedIdentity/userAssignedIdentities', 'decoy-id', {})
  const principal = createIdentity(sandbox, { resourceGroup: 'demo-rg', name: decoy.name, location: 'eastus' }).resource.principalId
  graph.order.splice(graph.order.indexOf(nodes.environment), 0, decoy)
  nodes.aiRole.body.properties.principalId = principal
  nodes.aiRole.bindings.find(item => item.path === '/properties/principalId').source = decoy.id
  return { ...base, nodes: { ...nodes, decoy } }
}

const faultLab = { capabilities: { bicepDeployment: true, bicepIdentityFault: true, cpuScaling: true },
  cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] } }

describe('Lab 14 Bicep identity fault boundary', () => {
  it('keeps Lab 13 strict and accepts only a linked decoy account role under the trusted capability', () => {
    const { graph, sandbox, artifacts, nodes } = faultFixture()
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics).not.toEqual([])
    expect(validateBicepProviders(graph, sandbox, artifacts, faultLab).diagnostics).toEqual([])
    expect(previewBicepDeployment(graph, sandbox, artifacts, faultLab).operations).toHaveLength(10)
    nodes.aiRole.bindings = nodes.aiRole.bindings.filter(item => item.path !== '/properties/principalId')
    expect(validateBicepProviders(graph, sandbox, artifacts, faultLab).diagnostics).not.toEqual([])
  })

  it('rejects a third identity, extra role, wrong registry principal, and wrong app identity', () => {
    const cases = [
      ({ graph, nodes }) => graph.order.splice(2, 0, node('Microsoft.ManagedIdentity/userAssignedIdentities', 'third-id', {})),
      ({ graph, nodes }) => { const extra = structuredClone(nodes.aiRole); extra.name = extra.body.name = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; extra.id = 'main#extra-role'; extra.armId = `${nodes.account.armId}/providers/Microsoft.Authorization/roleAssignments/${extra.name}`; graph.order.splice(-1, 0, extra) },
      ({ nodes }) => { nodes.acrRole.body.properties.principalId = nodes.aiRole.body.properties.principalId; nodes.acrRole.bindings.find(item => item.path === '/properties/principalId').source = nodes.decoy.id },
      ({ nodes }) => { nodes.app.body.identity.userAssignedIdentities = { [nodes.decoy.armId]: {} }; nodes.app.bindings.find(item => item.path === '/identity/userAssignedIdentities').source = nodes.decoy.id },
    ]
    for (const mutate of cases) {
      const item = faultFixture(); mutate(item)
      expect(validateBicepProviders(item.graph, item.sandbox, item.artifacts, faultLab).diagnostics).not.toEqual([])
    }
  })

  it('rejects an account role granted at another declared account instead of the app endpoint', () => {
    const { graph, sandbox, artifacts, nodes } = faultFixture()
    const other = node('Microsoft.CognitiveServices/accounts', 'otherfoundry', {
      kind: 'AIServices', sku: { name: 'S0' }, identity: { type: 'SystemAssigned' },
      properties: { allowProjectManagement: true, customSubDomainName: 'otherfoundry' },
    })
    graph.order.splice(graph.order.indexOf(nodes.account), 0, other)
    nodes.aiRole.body.scope.id = other.armId
    nodes.aiRole.armId = `${other.armId}/providers/Microsoft.Authorization/roleAssignments/${nodes.aiRole.name}`
    nodes.aiRole.bindings.find(item => item.path === '/scope').source = other.id
    expect(validateBicepProviders(graph, sandbox, artifacts, faultLab).diagnostics).not.toEqual([])
  })

  it('requires both role principals to pass through a declared identity module output', () => {
    for (const roleName of ['acrRole', 'aiRole']) {
      const { graph, sandbox, artifacts, nodes } = faultFixture()
      delete nodes[roleName].bindings.find(item => item.path === '/properties/principalId').via
      expect(validateBicepProviders(graph, sandbox, artifacts, faultLab).diagnostics).not.toEqual([])
    }
  })

  it('deploys a decoy grant, denies the caller before upstream, then recovers after a corrected grant', () => {
    const { graph, sandbox, artifacts, nodes } = faultFixture()
    artifacts.buildsById['build-1'].appSpec.listeningPort = 8080
    artifacts.buildsById['build-1'].appSpec.routes = [{ method: 'POST', path: '/api/summarize' }]
    artifacts.buildsById['build-1'].appSpec.foundry = { ...artifacts.buildsById['build-1'].appSpec.foundry,
      method: 'POST', path: '/api/summarize', inputField: 'text', outputField: 'summary', identity: 'user-assigned',
      tokenScope: 'https://ai.azure.com/.default', sdkRetries: 0, configured: true }
    const run = { sandbox, artifacts, runtime: { deploymentsByApp: {}, simTimeMs: 0,
      bicep: { nextAttempt: 1, nextPreview: 1, attempts: [], previews: [], currentByTarget: {}, retired: {} } },
      project: { fileVersions: {} }, nextSequence: 1, dependencyGenerations: {} }
    const options = { name: 'first', sourceHash: 'source', parameterHash: 'params' }
    const initial = applyBicepDeployment(run, graph, options, faultLab)
    expect(initial.record.status).toBe('succeeded')
    const scenario = { appId: nodes.app.armId, request: { method: 'POST', path: '/api/summarize', body: { text: 'Hello' } }, faultProfile: { attempts: [] } }
    const denied = simulateFoundryRequest(initial.run, scenario)
    expect(denied).toMatchObject({ status: 502, diagnostic: { code: 'FOUNDRY_ACCESS_DENIED' }, upstream: { attempts: [] } })
    nodes.aiRole.body.properties.principalId = nodes.acrRole.body.properties.principalId
    nodes.aiRole.bindings.find(item => item.path === '/properties/principalId').source = nodes.identity.id
    nodes.aiRole.name = nodes.aiRole.body.name = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    nodes.aiRole.armId = `${nodes.account.armId}/providers/Microsoft.Authorization/roleAssignments/${nodes.aiRole.name}`
    const repaired = applyBicepDeployment(initial.run, graph, options, faultLab)
    expect(repaired.record.status).toBe('succeeded')
    expect(simulateFoundryRequest(repaired.run, scenario).status).toBe(200)
  })

  it('still requires primary AcrPull and rolls back a failed app step after earlier resources', () => {
    const item = faultFixture()
    const { graph, sandbox, artifacts, nodes } = item
    graph.order.splice(graph.order.indexOf(nodes.acrRole), 1)
    expect(previewBicepDeployment(graph, sandbox, artifacts, faultLab).diagnostics).not.toEqual([])
    graph.order.splice(graph.order.indexOf(nodes.aiRole), 0, nodes.acrRole)
    artifacts.buildsById['build-1'].appSpec.listeningPort = 9000
    const run = { sandbox, artifacts, runtime: { deploymentsByApp: {},
      bicep: { nextAttempt: 1, nextPreview: 1, attempts: [], previews: [], currentByTarget: {}, retired: {} } },
      project: { fileVersions: {} }, nextSequence: 1, dependencyGenerations: {} }
    const applied = applyBicepDeployment(run, graph, { name: 'first', sourceHash: 'source', parameterHash: 'params' }, faultLab)
    expect(applied.record.status).toBe('failed')
    expect(applied.record.operations.some(item => item.type === 'Microsoft.Authorization/roleAssignments')).toBe(true)
    expect(applied.run.sandbox.containerApps).toEqual([])
    expect(applied.run.runtime.deploymentsByApp).toEqual({})
    expect(run.sandbox.managedIdentities).toEqual([])
  })
})

describe('pinned Bicep providers and read-only what-if', () => {
  it('activates only after both declared grants, then preserves active generation on no-op and failed update', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    graph.order.splice(graph.order.indexOf(nodes.app), 1)
    graph.order.splice(graph.order.indexOf(nodes.acrRole), 0, nodes.app)
    artifacts.buildsById['build-1'].appSpec.listeningPort = 8080
    const run = { sandbox, artifacts, runtime: { deploymentsByApp: {}, bicep: { nextAttempt: 1, attempts: [], previews: [], currentByTarget: {} } },
      project: { fileVersions: {} }, nextSequence: 1, dependencyGenerations: {} }
    const options = { name: 'first', sourceHash: 'source', parameterHash: 'params' }
    const lab = { capabilities: { cpuScaling: true }, cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] } }
    const first = applyBicepDeployment(run, graph, options, lab)
    expect(first.record.diagnostics).toEqual([])
    expect(first.record.status).toBe('succeeded')
    expect(first.events).toHaveLength(1)
    expect(first.run.sandbox.roleAssignments.map(item => item.id)).toEqual([nodes.acrRole.name, nodes.aiRole.name])
    expect(first.record.operations.at(-1).type).toBe('Microsoft.App/containerApps')
    const appId = nodes.app.armId
    const active = first.run.runtime.deploymentsByApp[appId].active
    expect(active.scalePolicy.maxReplicas).toBe(5)
    const second = applyBicepDeployment(first.run, graph, options, lab)
    expect(second.record.operations.every(item => ['no-change', 'ignored-existing'].includes(item.changeType))).toBe(true)
    expect(second.run.runtime.deploymentsByApp[appId].active).toEqual(active)
    const withExtra = structuredClone(second.run)
    withExtra.sandbox.containerApps[0].envVars.OBSOLETE = 'remove-me'
    const replaced = applyBicepDeployment(withExtra, graph, options, lab)
    expect(replaced.run.sandbox.containerApps[0].envVars.OBSOLETE).toBeUndefined()
    expect(replaced.run.sandbox.containerApps[0].containerName).toBe('api')
    const changed = structuredClone(graph)
    changed.order.find(item => item.type === 'Microsoft.App/containerApps').body.properties.template.scale.maxReplicas = 7
    const updated = applyBicepDeployment(second.run, changed, options, lab)
    expect(updated.record.status).toBe('succeeded')
    expect(updated.run.runtime.deploymentsByApp[appId].active.scalePolicy.maxReplicas).toBe(7)
    const broken = structuredClone(changed)
    broken.order.find(item => item.type === 'Microsoft.App/containerApps').body.properties.template.scale.maxReplicas = 8
    const failedRun = structuredClone(updated.run)
    failedRun.artifacts.buildsById['build-1'].appSpec.foundry.deployment = 'wrong'
    const failed = applyBicepDeployment(failedRun, broken, options, lab)
    expect(failed.record.status).toBe('failed')
    expect(failed.run.sandbox.containerApps[0].maxReplicas).toBe(7)
    expect(failed.run.runtime.deploymentsByApp[appId].active.scalePolicy.maxReplicas).toBe(7)
    const activationFailure = structuredClone(updated.run)
    activationFailure.artifacts.buildsById['build-1'].appSpec.listeningPort = 9000
    const rolledBack = applyBicepDeployment(activationFailure, broken, options, lab)
    expect(rolledBack.record.status).toBe('failed')
    expect(rolledBack.run.sandbox.containerApps[0].maxReplicas).toBe(7)
    expect(rolledBack.run.runtime.deploymentsByApp[appId].active.scalePolicy.maxReplicas).toBe(7)
  })
  it('accepts planned parents, exact seeded ACR and published image, then previews creates without mutation', () => {
    const { graph, sandbox, artifacts } = fixture(); const before = JSON.stringify({ sandbox, artifacts })
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics).toEqual([])
    const result = previewBicepDeployment(graph, sandbox, artifacts)
    expect(result.diagnostics).toEqual([])
    expect(result.operations.map(item => item.changeType)).toEqual(['ignored-existing', ...Array(8).fill('create')])
    expect(JSON.stringify({ sandbox, artifacts })).toBe(before)
  })
  it('rejects unsupported versions and extra provider fields at source', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    nodes.identity.apiVersion = '2023-01-31'
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0]).toMatchObject({ code: 'UNSUPPORTED_BICEP', path: source.path, line: 7 })
    nodes.identity.apiVersion = '2024-11-30'; nodes.identity.body.tags = { surprise: 'yes' }
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
  })
  it('rejects an unlinked published-image literal and wrong role scope', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    nodes.app.bindings = nodes.app.bindings.filter(item => item.path !== '/properties/template/containers/0/image')
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
    nodes.app.bindings.push({ path: '/properties/template/containers/0/image', source: nodes.registry.id, property: 'properties.loginServer' })
    nodes.acrRole.body.scope.id = nodes.account.armId
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
  })
  it('detects replica-only modifications, ignores unrelated tags and retains omitted resources', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    sandbox.containerAppEnvironments.push({ name: 'app-env', resourceGroup: 'demo-rg', location: 'eastus', tags: null })
    sandbox.containerApps.push({ name: 'myapp', resourceGroup: 'demo-rg', location: 'eastus', environment: 'app-env', environmentResourceGroup: 'demo-rg', image: 'sampleacr.azurecr.io/api:v1', userAssigned: nodes.identity.armId, registryIdentity: nodes.identity.armId, registryServer: 'sampleacr.azurecr.io', ingress: 'external', targetPort: 8080, cpu: 0.5, memory: '1Gi', minReplicas: 1, maxReplicas: 4, scaleRules: [{ name: 'cpu', custom: { type: 'cpu', metadata: { type: 'Utilization', value: '60' } } }], envVars: { APP_ENV: 'training', AZURE_CLIENT_ID: createIdentity(sandbox, { resourceGroup: 'demo-rg', name: 'app-id', location: 'eastus' }).resource.clientId, FOUNDRY_ENDPOINT: 'https://myfoundry.services.ai.azure.com/openai/v1/', FOUNDRY_DEPLOYMENT: 'chat-model' }, tags: { unrelated: 'yes' } })
    expect(previewBicepDeployment(graph, sandbox, artifacts).operations.at(-1).changeType).toBe('modify')
    sandbox.containerApps[0].maxReplicas = 5
    const matched = previewBicepDeployment(graph, sandbox, artifacts).operations.at(-1)
    expect(matched.current).toEqual(matched.desired)
    expect(matched.changeType).toBe('no-change')
    graph.order.pop()
    expect(previewBicepDeployment(graph, sandbox, artifacts).operations).toHaveLength(8)
    expect(sandbox.containerApps).toHaveLength(1)
  })
  it('rejects a role UUID/name or triple collision with existing CLI grants', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    sandbox.roleAssignments.push({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', scope: registryId, principalId: nodes.acrRole.body.properties.principalId, principalType: 'ServicePrincipal', roleDefinitionId: '7f951dda-4ed3-4680-a7ca-43fe172d538d', roleName: 'AcrPull' })
    expect(previewBicepDeployment(graph, sandbox, artifacts).diagnostics[0].code).toBe('BICEP_ROLE_CONFLICT')
  })
  it('requires one UAMI, exact grants and a single app in the graph', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    graph.order.splice(graph.order.indexOf(nodes.acrRole), 1)
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
    graph.order.push(nodes.acrRole, node('Microsoft.ManagedIdentity/userAssignedIdentities', 'second-id', {}))
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
  })
  it('rejects a second container and credential registry fields', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    nodes.app.body.properties.template.containers.push({ ...nodes.app.body.properties.template.containers[0], name: 'other' })
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
    nodes.app.body.properties.template.containers.pop()
    nodes.app.body.properties.configuration.registries[0].passwordSecretRef = 'secret'
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
  })
  it('rejects role principals and client IDs that differ from the planned UAMI', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    nodes.acrRole.body.properties.principalId = '11111111-1111-4111-8111-111111111111'
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
    nodes.acrRole.body.properties.principalId = nodes.aiRole.body.properties.principalId
    nodes.app.body.properties.template.containers[0].env[1].value = '22222222-2222-4222-8222-222222222222'
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
  })
  it('rejects two declared GUIDs for the same role triple before preview', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    const duplicate = structuredClone(nodes.acrRole)
    duplicate.name = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    duplicate.body.name = duplicate.name
    duplicate.armId = `${registryId}/providers/Microsoft.Authorization/roleAssignments/${duplicate.name}`
    duplicate.id = 'main#duplicateRole'
    graph.order.splice(graph.order.indexOf(nodes.aiRole), 0, duplicate)
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0]).toMatchObject({ code: 'BICEP_ROLE_CONFLICT', path: source.path, line: source.line })
    expect(previewBicepDeployment(graph, sandbox, artifacts).operations).toEqual([])
  })
  it('returns located Bicep diagnostics when identity adapter rejects a name', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    nodes.identity.name = '-bad'
    nodes.identity.body.name = '-bad'
    nodes.identity.armId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/-bad`
    const result = validateBicepProviders(graph, sandbox, artifacts)
    expect(result.diagnostics[0]).toMatchObject({ code: 'UNSUPPORTED_BICEP', path: source.path, line: source.line, column: source.column })
  })
  it('requires child name, location and parent fields', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    delete nodes.project.body.location
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
    nodes.project.body.location = 'eastus'
    delete nodes.deployment.body.location
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
  })
  it('rejects a duplicate GUID with a different role triple', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    const duplicate = structuredClone(nodes.aiRole)
    duplicate.id = 'main#duplicateGuid'
    duplicate.name = nodes.acrRole.name
    duplicate.body.name = duplicate.name
    duplicate.armId = `${nodes.account.armId}/providers/Microsoft.Authorization/roleAssignments/${duplicate.name}`
    graph.order.splice(graph.order.indexOf(nodes.app), 0, duplicate)
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('BICEP_ROLE_CONFLICT')
  })
  it.each([
    ['Microsoft.ContainerRegistry/registries', 'registry'],
    ['Microsoft.ManagedIdentity/userAssignedIdentities', 'identity'],
    ['Microsoft.App/managedEnvironments', 'environment'],
    ['Microsoft.CognitiveServices/accounts', 'account'],
    ['Microsoft.CognitiveServices/accounts/projects', 'project'],
    ['Microsoft.CognitiveServices/accounts/deployments', 'deployment'],
    ['Microsoft.Authorization/roleAssignments', 'acrRole'],
    ['Microsoft.App/containerApps', 'app'],
  ])('rejects an unpinned API version for %s', (_type, symbol) => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    nodes[symbol].apiVersion = '2020-01-01'
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0]).toMatchObject({ code: 'UNSUPPORTED_BICEP', path: source.path, line: source.line })
  })
  it('rejects child location and parent mismatches', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    nodes.project.body.location = 'westus'
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
    nodes.project.body.location = 'eastus'
    nodes.project.body.parent.id = registryId
    expect(validateBicepProviders(graph, sandbox, artifacts).diagnostics[0].code).toBe('UNSUPPORTED_BICEP')
  })
  it('normalizes modeled environment defaults and ignores unrelated tags', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    sandbox.containerAppEnvironments.push({ name: nodes.environment.name.toUpperCase(), resourceGroup: 'DEMO-RG', location: 'eastus', tags: { owner: 'cli' }, createdAt: '2026-09-23T00:00:00Z' })
    const operations = previewBicepDeployment(graph, sandbox, artifacts).operations
    expect(operations[0].changeType).toBe('ignored-existing')
    expect(operations.find(item => item.nodeId === nodes.environment.id).changeType).toBe('no-change')
  })
  it('rejects a Sandbox role with the declared GUID but a different triple', () => {
    const { graph, sandbox, artifacts, nodes } = fixture()
    sandbox.roleAssignments.push({ id: nodes.acrRole.name, scope: nodes.account.armId,
      principalId: nodes.acrRole.body.properties.principalId, principalType: 'ServicePrincipal',
      roleDefinitionId: 'a97b65f3-24c7-4388-baec-2e87135dc908', roleName: 'Cognitive Services User' })
    expect(previewBicepDeployment(graph, sandbox, artifacts).diagnostics[0].code).toBe('BICEP_ROLE_CONFLICT')
  })
})
