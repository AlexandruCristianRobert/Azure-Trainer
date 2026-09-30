import { previewBicepDeployment } from './preview.js'
import { appendBicepAttempt, bicepTargetKey, emptyBicepProvenance } from './provenance.js'
import { createIdentity } from '../sandbox/identity.js'
import { createRegistry } from '../sandbox/registry.js'
import { createContainerAppEnvironment, createContainerApp } from '../sandbox/containerapps.js'
import { createFoundryAccount, createFoundryProject, createFoundryDeployment } from '../sandbox/foundry.js'
import { createDeclaredRoleAssignment } from '../sandbox/roleAssignments.js'
import { reconcileDeployment, appArmId } from '../simulation/runtime.js'

const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const appType = 'Microsoft.App/containerApps'
const groupOf = node => node.armId.match(/\/resourceGroups\/([^/]+)/i)?.[1]
const accountOf = node => node.body.parent.id.match(/\/accounts\/([^/]+)$/i)?.[1]
const envMap = entries => Object.fromEntries(entries.map(item => [item.name, item.value]))

function applyResource(sandbox, node, lab) {
  const resourceGroup = groupOf(node)
  const name = node.name
  switch (node.type) {
    case 'Microsoft.ContainerRegistry/registries':
      return createRegistry(sandbox, { resourceGroup, name, location: node.location, sku: 'Basic' }).sandbox
    case 'Microsoft.ManagedIdentity/userAssignedIdentities':
      return createIdentity(sandbox, { resourceGroup, name, location: node.location }).sandbox
    case 'Microsoft.App/managedEnvironments':
      return createContainerAppEnvironment(sandbox, { resourceGroup, name, location: node.location }).sandbox
    case 'Microsoft.CognitiveServices/accounts':
      return createFoundryAccount(sandbox, { resourceGroup, name, location: node.location, sku: node.body.sku.name,
        identity: node.body.identity, allowProjectManagement: node.body.properties.allowProjectManagement }).sandbox
    case 'Microsoft.CognitiveServices/accounts/projects':
      return createFoundryProject(sandbox, { resourceGroup, accountName: accountOf(node), name }).sandbox
    case 'Microsoft.CognitiveServices/accounts/deployments':
      return createFoundryDeployment(sandbox, { resourceGroup, accountName: accountOf(node), name,
        modelName: node.body.properties.model.name, modelVersion: node.body.properties.model.version, sku: node.body.sku.name }).sandbox
    case 'Microsoft.Authorization/roleAssignments':
      return createDeclaredRoleAssignment(sandbox, { name, scope: node.body.scope.id,
        principalId: node.body.properties.principalId, roleDefinitionId: node.body.properties.roleDefinitionId }).sandbox
    case appType: {
      const properties = node.body.properties
      const container = properties.template.containers[0]
      const rule = properties.template.scale.rules[0]
      const created = createContainerApp(sandbox, { resourceGroup, name, environment: properties.managedEnvironmentId,
        image: container.image, ingress: 'external', targetPort: properties.configuration.ingress.targetPort,
        minReplicas: properties.template.scale.minReplicas, maxReplicas: properties.template.scale.maxReplicas,
        cpu: container.resources.cpu, memory: container.resources.memory,
        userAssigned: Object.keys(node.body.identity.userAssignedIdentities)[0],
        registryIdentity: properties.configuration.registries[0].identity,
        registryServer: properties.configuration.registries[0].server,
        envVars: Object.entries(envMap(container.env)), scaleRuleName: rule.name, scaleRuleType: 'cpu',
        scaleRuleMetadata: Object.entries(rule.custom.metadata) }, lab)
      created.resource.containerName = container.name
      created.resource.envVars = envMap(container.env)
      if (container.probes !== undefined) created.resource.probes = structuredClone(container.probes)
      return created.sandbox
    }
    default: throw new Error(`Unsupported Bicep resource ${node.type}.`)
  }
}

function activationReady(run, node, lab) {
  const app = run.sandbox.containerApps.find(item => same(item.name, node.name) && same(item.resourceGroup, groupOf(node)))
  const env = envMap(node.body.properties.template.containers[0].env)
  const image = node.body.properties.template.containers[0].image.toLowerCase()
  const buildId = run.artifacts.publishedTags[image]
  const artifact = run.artifacts.buildsById[buildId]
  if (!artifact?.appSpec?.foundry || artifact.appSpec.foundry.endpoint !== env.FOUNDRY_ENDPOINT
    || artifact.appSpec.foundry.deployment !== env.FOUNDRY_DEPLOYMENT) {
    throw new Error('Resolved Foundry module outputs do not match the published application artifact.')
  }
  const identity = run.sandbox.managedIdentities.find(item => same(item.id, app.userAssigned))
  const registry = run.sandbox.containerRegistries.find(item => same(item.loginServer, app.registryServer))
  const account = run.sandbox.foundryAccounts.find(item => same(item.endpoint, env.FOUNDRY_ENDPOINT))
  const hasGrant = (scope, role) => run.sandbox.roleAssignments.some(item => same(item.scope, scope)
    && same(item.principalId, identity?.principalId) && same(item.roleDefinitionId, role))
  if (!identity || !same(identity.id, app.registryIdentity) || !registry || !account
    || !account.deployments.some(item => same(item.name, env.FOUNDRY_DEPLOYMENT))
    || !hasGrant(registry.id, '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    || (!(lab?.capabilities?.bicepDeployment === true && lab.capabilities.bicepIdentityFault === true)
      && !hasGrant(account.id, 'a97b65f3-24c7-4388-baec-2e87135dc908'))) {
    throw new Error('The app requires its attached UAMI and exact registry and Foundry grants before activation.')
  }
  return app
}

/** Applies only supported, validated graph nodes. A failed app step leaves prior app/runtime intact. */
export function applyBicepDeployment(run, graph, { name, sourceHash, parameterHash, fileVersions = run.project?.fileVersions ?? {}, parameterPath, templatePath } = {}, lab = {
  capabilities: { cpuScaling: true }, cpuScaling: { allowedResources: [{ cpu: 0.5, memory: '1Gi' }] },
}) {
  const target = graph?.target?.name ?? ''
  const key = bicepTargetKey(target, name)
  const proposed = previewBicepDeployment(graph, run.sandbox, run.artifacts, lab, run)
  const operations = []
  let next = run
  let failure = proposed.diagnostics[0] ?? null
  let appEvent = null
  const ordered = [...proposed.operations.filter(item => item.type !== appType),
    ...proposed.operations.filter(item => item.type === appType)]
  if (!failure) for (const operation of ordered) {
    const node = graph.order.find(item => item.id === operation.nodeId)
    const inactiveApp = node.type === appType && !next.runtime.deploymentsByApp[operation.id]?.active
    if (operation.changeType === 'ignored-existing' || operation.changeType === 'no-change' && !inactiveApp) {
      operations.push({ id: operation.id, type: operation.type, name: operation.name, changeType: operation.changeType })
      continue
    }
    try {
      if (node.type.startsWith('Microsoft.CognitiveServices/') && operation.changeType === 'modify')
        throw new Error('Updating a create-only Foundry resource is unsupported.')
      const sandbox = operation.changeType === 'no-change' ? next.sandbox : applyResource(next.sandbox, node, lab)
      let candidate = { ...next, sandbox }
      if (node.type === appType) {
        const app = activationReady(candidate, node, lab)
        const repair = lab?.capabilities?.acaCapstone === true
          && next.runtime.incident?.status === 'active' && next.runtime.incident.appId === operation.id
          && next.sandbox.containerApps.some(item => same(appArmId(item), operation.id) && item.incidentDrift)
        const activated = reconcileDeployment(candidate, app, { forceActivation: repair })
        if (activated.diagnostics.length) throw new Error(activated.diagnostics.map(item => item.message).join(' '))
        candidate = activated.run
        if (repair) {
          const apps = candidate.sandbox.containerApps.map(item => {
            if (!same(appArmId(item), operation.id)) return item
            const restored = { ...item }
            delete restored.incidentDrift
            return restored
          })
          candidate = { ...candidate, sandbox: { ...candidate.sandbox, containerApps: apps },
            runtime: { ...candidate.runtime, incident: { ...candidate.runtime.incident, status: 'repaired',
              restoredGeneration: candidate.runtime.deploymentsByApp[operation.id].active.generation } } }
        }
        appEvent = { resourceType: 'containerApp', type: operation.changeType === 'create' ? 'created' : 'updated',
          resourceGroup: app.resourceGroup, name: app.name, appId: appArmId(app) }
      }
      next = candidate
      operations.push({ id: operation.id, type: operation.type, name: operation.name, changeType: operation.changeType })
    } catch (error) {
      failure = { code: 'BICEP_APPLY_FAILED', message: error?.message ?? String(error), ...node.source }
      break
    }
  }
  const status = failure ? 'failed' : 'succeeded'
  const state = next.runtime.bicep ?? emptyBicepProvenance()
  const record = { id: `bicep-attempt-${state.nextAttempt}`, key, target, name, status,
    sourceHash, parameterHash, fileVersions: structuredClone(fileVersions),
    ...(parameterPath ? { parameterPath, sequence: run.nextSequence } : {}),
    ...(templatePath ? { templatePath } : {}), operations,
    outputs: status === 'succeeded' ? structuredClone(graph.outputs ?? {}) : {},
    diagnostics: failure ? [failure] : [] }
  const repaired = status === 'succeeded' && run.runtime.incident?.status === 'active'
    && next.runtime.incident?.status === 'repaired'
  next = { ...next, ...(parameterPath ? { nextSequence: run.nextSequence + 1 } : {}),
    runtime: { ...next.runtime, bicep: appendBicepAttempt(state, record),
      ...(repaired ? { incident: { ...next.runtime.incident, repairAttempt: structuredClone(record) } } : {}) } }
  return { run: next, record, events: status === 'succeeded' && appEvent ? [appEvent] : [], diagnostics: record.diagnostics }
}
