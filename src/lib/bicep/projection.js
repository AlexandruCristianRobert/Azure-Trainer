const canonical = value => typeof value === 'string' ? value.toLowerCase() : value
const sorted = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map(key => [key.toLowerCase(), sorted(value[key])]))
  : Array.isArray(value) ? value.map(sorted) : value
const identityId = body => Object.keys(body.identity.userAssignedIdentities)[0]
const envMap = entries => Object.fromEntries(entries.map(entry => [entry.name, entry.value]))

/** Complete modeled desired state. Generated IDs, tags and timestamps are excluded. */
export function desiredBicepProjection(node) {
  const body = node.body
  const base = { type: canonical(node.type), name: canonical(node.name), location: canonical(node.location) }
  switch (node.type) {
    case 'Microsoft.ContainerRegistry/registries': return { ...base, sku: 'Basic' }
    case 'Microsoft.ManagedIdentity/userAssignedIdentities': return base
    case 'Microsoft.App/managedEnvironments': return { ...base, appLogsDestination: body.properties?.appLogsConfiguration?.destination ?? 'none' }
    case 'Microsoft.CognitiveServices/accounts': return { ...base, kind: body.kind, sku: body.sku.name, identity: body.identity.type, allowProjectManagement: body.properties.allowProjectManagement, customSubDomainName: canonical(body.properties.customSubDomainName) }
    case 'Microsoft.CognitiveServices/accounts/projects': return { ...base, parent: canonical(body.parent.id) }
    case 'Microsoft.CognitiveServices/accounts/deployments': return { ...base, parent: canonical(body.parent.id), sku: body.sku.name, capacity: body.sku.capacity, model: sorted(body.properties.model) }
    case 'Microsoft.Authorization/roleAssignments': return { type: canonical(node.type), name: canonical(node.name), scope: canonical(body.scope.id), principalId: canonical(body.properties.principalId), principalType: body.properties.principalType, roleDefinitionId: canonical(body.properties.roleDefinitionId) }
    case 'Microsoft.App/containerApps': {
      const props = body.properties; const container = props.template.containers[0]
      return { ...base, environmentId: canonical(props.managedEnvironmentId), identityId: canonical(identityId(body)), registryServer: canonical(props.configuration.registries[0].server), registryIdentity: canonical(props.configuration.registries[0].identity), ingress: 'external', targetPort: props.configuration.ingress.targetPort,
        containerName: container.name, image: canonical(container.image), cpu: container.resources.cpu, memory: container.resources.memory, env: sorted(envMap(container.env)), minReplicas: props.template.scale.minReplicas, maxReplicas: props.template.scale.maxReplicas, scaleRules: sorted(props.template.scale.rules),
        ...(container.probes === undefined ? {} : { probes: sorted(container.probes) }) }
    }
    default: return null
  }
}

export function currentBicepProjection(node, sandbox) {
  const group = node.armId?.match(/\/resourceGroups\/([^/]+)/i)?.[1]
  const same = (a, b) => canonical(a) === canonical(b)
  const inGroup = item => same(item.resourceGroup, group) && same(item.name, node.name)
  let resource
  switch (node.type) {
    case 'Microsoft.ContainerRegistry/registries': resource = sandbox.containerRegistries?.find(inGroup); return resource && { type: canonical(node.type), name: canonical(resource.name), location: canonical(resource.location), sku: resource.sku }
    case 'Microsoft.ManagedIdentity/userAssignedIdentities': resource = sandbox.managedIdentities?.find(inGroup); return resource && { type: canonical(node.type), name: canonical(resource.name), location: canonical(resource.location) }
    case 'Microsoft.App/managedEnvironments': resource = sandbox.containerAppEnvironments?.find(inGroup); return resource && { type: canonical(node.type), name: canonical(resource.name), location: canonical(resource.location), appLogsDestination: resource.appLogsDestination ?? 'none' }
    case 'Microsoft.CognitiveServices/accounts': resource = sandbox.foundryAccounts?.find(inGroup); return resource && { type: canonical(node.type), name: canonical(resource.name), location: canonical(resource.location), kind: resource.kind, sku: resource.sku, identity: resource.identity?.type, allowProjectManagement: resource.allowProjectManagement, customSubDomainName: canonical(resource.name) }
    case 'Microsoft.CognitiveServices/accounts/projects': {
      const account = sandbox.foundryAccounts?.find(item => same(item.id, node.body.parent.id)); resource = account?.projects?.find(item => same(item.name, node.name))
      return resource && { type: canonical(node.type), name: canonical(resource.name), location: canonical(resource.location), parent: canonical(account.id) }
    }
    case 'Microsoft.CognitiveServices/accounts/deployments': {
      const account = sandbox.foundryAccounts?.find(item => same(item.id, node.body.parent.id)); resource = account?.deployments?.find(item => same(item.name, node.name))
      return resource && { type: canonical(node.type), name: canonical(resource.name), location: canonical(account.location), parent: canonical(account.id), sku: resource.sku, capacity: resource.capacity ?? 10, model: { format: 'OpenAI', name: resource.modelName, version: resource.modelVersion } }
    }
    case 'Microsoft.Authorization/roleAssignments': {
      resource = sandbox.roleAssignments?.find(item => same(item.id, node.name)); return resource && { type: canonical(node.type), name: canonical(resource.id), scope: canonical(resource.scope), principalId: canonical(resource.principalId), principalType: resource.principalType, roleDefinitionId: canonical(resource.roleDefinitionId.startsWith('/') ? resource.roleDefinitionId : `/subscriptions/${node.armId.match(/\/subscriptions\/([^/]+)/i)?.[1]}/providers/Microsoft.Authorization/roleDefinitions/${resource.roleDefinitionId}`) }
    }
    case 'Microsoft.App/containerApps': {
      resource = sandbox.containerApps?.find(inGroup); if (!resource) return null
      const environment = sandbox.containerAppEnvironments?.find(item => same(item.resourceGroup, resource.environmentResourceGroup) && same(item.name, resource.environment))
      return { type: canonical(node.type), name: canonical(resource.name), location: canonical(resource.location), environmentId: canonical(environment ? `${node.armId.slice(0, node.armId.toLowerCase().indexOf('/providers/microsoft.app/containerapps/'))}/providers/Microsoft.App/managedEnvironments/${environment.name}` : ''),
        identityId: canonical(Array.isArray(resource.userAssigned) ? resource.userAssigned[0] : resource.userAssigned), registryServer: canonical(resource.registryServer), registryIdentity: canonical(resource.registryIdentity), ingress: resource.ingress, targetPort: resource.targetPort,
        containerName: resource.containerName ?? node.body.properties.template.containers[0].name, image: canonical(resource.image), cpu: resource.cpu, memory: resource.memory,
        env: sorted(resource.incidentDrift ? { ...resource.envVars, FOUNDRY_DEPLOYMENT: resource.incidentDrift.effectiveDeployment } : resource.envVars ?? {}),
        minReplicas: resource.minReplicas, maxReplicas: resource.maxReplicas, scaleRules: sorted(resource.scaleRules ?? []),
        ...(resource.probes === undefined ? {} : { probes: sorted(resource.probes) }) }
    }
    default: return null
  }
}
