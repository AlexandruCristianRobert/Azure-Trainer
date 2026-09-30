import { ACR_PULL_ROLE_ID, COGNITIVE_SERVICES_USER_ROLE_ID } from '../sandbox/roleAssignments.js'
import { createIdentity } from '../sandbox/identity.js'
import { successfulBicepDependency } from './provenance.js'
import { bicepSourceTuple } from './source.js'

const versions = Object.freeze({
  'Microsoft.ContainerRegistry/registries': '2025-11-01',
  'Microsoft.ManagedIdentity/userAssignedIdentities': '2024-11-30',
  'Microsoft.App/managedEnvironments': '2025-07-01',
  'Microsoft.App/containerApps': '2025-07-01',
  'Microsoft.CognitiveServices/accounts': '2025-06-01',
  'Microsoft.CognitiveServices/accounts/projects': '2025-06-01',
  'Microsoft.CognitiveServices/accounts/deployments': '2025-06-01',
  'Microsoft.Authorization/roleAssignments': '2022-04-01',
})
export const BICEP_PROVIDER_VERSIONS = versions
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const keys = (value, allowed, required = []) => object(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key))
const id = value => typeof value === 'string' ? value.toLowerCase() : ''
const bound = (node, path, source, property, via = false) => node.bindings?.some(binding => (binding.path === path || binding.path.startsWith(`${path}/`))
  && binding.source === source.id && (!property || binding.property === property) && (!via || binding.via))

function diagnostic(node, message, code = 'UNSUPPORTED_BICEP') {
  return { code, message, path: node.source?.path ?? 'infra/main.bicep', line: node.source?.line ?? 1, column: node.source?.column ?? 1 }
}

function check(node, condition, message) { if (!condition) throw diagnostic(node, message) }
function targetResource(resources, armId, type) { return resources.find(item => item.node.type === type && same(item.node.armId, armId)) }
function exactLocation(node, graph) { return same(node.location, graph.target.location) && (!Object.hasOwn(node.body, 'location') || same(node.body.location, graph.target.location)) }
function basic(node, graph, allowed, required) {
  check(node, keys(node.body, allowed, required), `${node.type} has unsupported or missing top-level fields.`)
  check(node, typeof node.name === 'string' && node.name.length > 0 && node.body.name === node.name, 'Resource name is invalid.')
  check(node, exactLocation(node, graph), 'Resource location must match the target group.')
  check(node, same(node.armId, `${graph.target.id}/providers/${node.type}/${node.name}`), 'Resource must be in the target resource group.')
}
function parent(node, graph, resources, parentType, segment) {
  check(node, keys(node.body, ['name', 'parent', 'location', 'sku', 'properties'], ['name', 'parent', 'location']), 'Child resource requires name, location and parent with no unsupported fields.')
  check(node, exactLocation(node, graph), 'Child location must match the target group.')
  const account = resources.find(item => item.node.type === parentType && same(node.body.parent?.id, item.node.armId))
  check(node, account && same(node.armId, `${account.node.armId}/${segment}/${node.name}`) && bound(node, '/parent', account.node, '', false), 'Child must reference its declared account parent.')
  return account
}
function findArtifact(artifacts, image, registryId) {
  const buildId = artifacts?.publishedTags?.[image.toLowerCase()]
  const artifact = buildId && artifacts.buildsById?.[buildId]
  return artifact && same(artifact.image?.registryId, registryId) && `${artifact.image?.loginServer}/${artifact.image?.repository}:${artifact.image?.tag}`.toLowerCase() === image.toLowerCase() ? artifact : null
}
function capstoneProbes(node, probes, appSpec, port) {
  check(node, Array.isArray(probes) && probes.length === 3, 'Capstone requires exactly three HTTP probes.')
  const paths = { Startup: '/health/startup', Readiness: '/health/ready', Liveness: '/health/live' }
  const seen = new Set()
  for (const probe of probes) {
    check(node, keys(probe, ['type', 'httpGet', 'initialDelaySeconds', 'periodSeconds', 'timeoutSeconds', 'failureThreshold', 'successThreshold'],
      ['type', 'httpGet', 'initialDelaySeconds', 'periodSeconds', 'timeoutSeconds', 'failureThreshold', 'successThreshold'])
      && Object.hasOwn(paths, probe.type) && !seen.has(probe.type), 'Capstone probe fields or type are unsupported.')
    seen.add(probe.type)
    check(node, keys(probe.httpGet, ['path', 'port', 'scheme'], ['path', 'port', 'scheme'])
      && probe.httpGet.scheme === 'HTTP' && probe.httpGet.path === paths[probe.type]
      && probe.httpGet.port === port && appSpec?.healthEndpoints?.some(item => item.path === probe.httpGet.path),
    'HTTP probe must match a published handler and ingress port.')
    for (const [field, min, max] of [['initialDelaySeconds', 1, 60], ['periodSeconds', 1, 240],
      ['timeoutSeconds', 1, 240], ['failureThreshold', 1, 10], ['successThreshold', 1, 10]])
      check(node, Number.isInteger(probe[field]) && probe[field] >= min && probe[field] <= max,
        `${field} is outside the supported probe range.`)
    check(node, probe.type === 'Readiness' || probe.successThreshold === 1,
      'Startup and liveness success threshold must be one.')
  }
}
function moduleParameterBinding(graph, node, parameter) {
  const module = graph.order.find(item => item.kind === 'module' && node.id.startsWith(`${item.id}:`))
  const property = (expression, name) => expression?.kind === 'object'
    ? expression.properties?.find(item => item.key === name)?.value : null
  const nodeName = property(node.expression, 'name')
  const moduleParams = property(module?.expression, 'params')
  const supplied = property(moduleParams, parameter)
  return nodeName?.kind === 'identifier' && nodeName.name === parameter
    && supplied?.kind === 'identifier' && supplied.name === parameter
    && module?.path === node.source.path
    && module?.body?.params?.[parameter] === graph.parameters?.[parameter]
}

/** Validate the intentionally small Lab 13 ARM subset without changing Sandbox state. */
export function validateBicepProviders(graph, sandbox, artifacts = {}, lab = {}, run = null) {
  const capstone = lab?.manifestId === 'containerapps-dotnet-capstone-v1'
    && lab?.capabilities?.bicepDeployment === true && lab?.capabilities?.acaCapstone === true
  const rootPath = graph?.order?.find(item => item.kind === 'resource')?.id?.startsWith('infra/bootstrap.bicep#')
    ? 'infra/bootstrap.bicep' : 'infra/main.bicep'
  const bootstrap = capstone && rootPath === 'infra/bootstrap.bicep'
  const main = capstone && rootPath !== 'infra/bootstrap.bicep'
  const bootstrapTarget = lab?.bicepTargets?.find(item => item.templatePath === 'infra/bootstrap.bicep')
  const bootstrapProof = main && bootstrapTarget ? successfulBicepDependency(run?.runtime?.bicep, bootstrapTarget) : null
  let currentBootstrap = null
  if (main && bootstrapProof && run?.project?.savedFiles) {
    try { currentBootstrap = bicepSourceTuple(run, bootstrapTarget.parameterPath) } catch { /* The diagnostic below rejects a broken bootstrap source. */ }
  }
  const identityFault = lab?.capabilities?.bicepDeployment === true
    && lab.capabilities.bicepIdentityFault === true
  const resources = []
  const diagnostics = []
  const plannedIdentities = new Map()
  const declaredRoleNames = new Set()
  const declaredRoleTriples = new Set()
  let currentNode = null
  if (!graph || !Array.isArray(graph.order)) return { resources, diagnostics: [{ code: 'BICEP_GRAPH', message: 'Compiled graph is required.', path: 'infra/main.bicep', line: 1, column: 1 }] }
  try {
    if (capstone) {
      const selected = lab.bicepTargets?.find(item => item.templatePath === rootPath)
      check(graph.order[0] ?? { source: { path: rootPath, line: 1, column: 1 } }, selected
        && same(graph.target?.name, selected.resourceGroup)
        && same(graph.target?.id, `/subscriptions/${graph.subscriptionId}/resourceGroups/${selected.resourceGroup}`),
      'Capstone graph must target its manifest-approved local group and root.')
    }
    for (const node of graph.order.filter(item => item.kind === 'resource')) {
      currentNode = node
      check(node, versions[node.type] === node.apiVersion, `Unsupported type or API version ${node.type}@${node.apiVersion}.`)
      const body = node.body
      if (node.type === 'Microsoft.ContainerRegistry/registries') {
        basic(node, graph, bootstrap ? ['name', 'location', 'sku'] : ['name', 'location'], bootstrap ? ['name', 'location', 'sku'] : ['name'])
        check(node, bootstrap ? !node.existing && keys(body.sku, ['name'], ['name']) && body.sku.name === 'Basic' : node.existing,
          bootstrap ? 'Bootstrap must create a Basic registry.' : 'The registry must be declared existing.')
        const registry = sandbox.containerRegistries?.find(item => same(item.id, node.armId) && item.sku === 'Basic' && same(item.location, node.location))
        check(node, bootstrap || registry, 'Existing registry must resolve to the local Basic registry.')
        if (main) check(node, bootstrapProof && same(bootstrapProof.outputs.registryId, node.armId)
          && same(bootstrapProof.outputs.registryServer, registry?.loginServer)
          && moduleParameterBinding(graph, node, 'registryName')
          && same(graph.parameters?.registryName, bootstrapTarget.registryName),
        'Existing registry must bind the main parameter through its module and successful bootstrap output.')
      } else if (node.type === 'Microsoft.ManagedIdentity/userAssignedIdentities') {
        basic(node, graph, ['name', 'location'], ['name', 'location']); check(node, !node.existing || main, 'Identity must be created by the graph.')
        if (main) {
          const existing = sandbox.managedIdentities?.find(item => same(item.id, node.armId) && same(item.location, node.location))
          check(node, node.existing && existing && bootstrapProof && same(bootstrapProof.outputs.identityId, node.armId)
            && same(bootstrapProof.outputs.identityClientId, existing.clientId)
            && same(bootstrapProof.outputs.identityPrincipalId, existing.principalId)
            && moduleParameterBinding(graph, node, 'identityName')
            && same(graph.parameters?.identityName, bootstrapTarget.identityName),
          'Existing identity must bind successful bootstrap outputs and resource ID.')
        }
        plannedIdentities.set(node.id, sandbox.managedIdentities?.find(item => same(item.id, node.armId))
          ?? createIdentity(sandbox, { resourceGroup: graph.target.name, name: node.name, location: node.location }).resource)
      } else if (node.type === 'Microsoft.App/managedEnvironments') {
        basic(node, graph, ['name', 'location', 'properties'], ['name', 'location'])
        check(node, !node.existing && (body.properties === undefined || keys(body.properties, ['appLogsConfiguration']))
          && (body.properties?.appLogsConfiguration === undefined || keys(body.properties.appLogsConfiguration, ['destination'], ['destination']) && body.properties.appLogsConfiguration.destination === 'none'), 'Only app logs destination none is supported.')
      } else if (node.type === 'Microsoft.CognitiveServices/accounts') {
        basic(node, graph, ['name', 'location', 'kind', 'sku', 'identity', 'properties'], ['name', 'location', 'kind', 'sku', 'identity', 'properties'])
        check(node, !node.existing && body.kind === 'AIServices' && keys(body.sku, ['name'], ['name']) && body.sku.name === 'S0'
          && keys(body.identity, ['type'], ['type']) && body.identity.type === 'SystemAssigned'
          && keys(body.properties, ['allowProjectManagement', 'customSubDomainName'], ['allowProjectManagement', 'customSubDomainName'])
          && body.properties.allowProjectManagement === true && same(body.properties.customSubDomainName, node.name), 'Foundry account requires AIServices, S0, system identity, project management and its exact subdomain.')
      } else if (node.type === 'Microsoft.CognitiveServices/accounts/projects') {
        parent(node, graph, resources, 'Microsoft.CognitiveServices/accounts', 'projects')
        check(node, !node.existing && Object.keys(body).every(key => ['name', 'parent', 'location'].includes(key)), 'Project permits only parent, name and location.')
      } else if (node.type === 'Microsoft.CognitiveServices/accounts/deployments') {
        parent(node, graph, resources, 'Microsoft.CognitiveServices/accounts', 'deployments')
        check(node, !node.existing && keys(body.sku, ['name', 'capacity'], ['name', 'capacity']) && body.sku.name === 'GlobalStandard' && body.sku.capacity === 10
          && keys(body.properties, ['model'], ['model']) && keys(body.properties.model, ['format', 'name', 'version'], ['format', 'name', 'version'])
          && body.properties.model.format === 'OpenAI' && body.properties.model.name === 'gpt-5-mini' && body.properties.model.version === '2025-08-07', 'Only gpt-5-mini/2025-08-07 OpenAI GlobalStandard capacity 10 is supported.')
      } else if (node.type === 'Microsoft.Authorization/roleAssignments') {
        check(node, !node.existing && keys(body, ['name', 'scope', 'properties'], ['name', 'scope', 'properties']) && uuid.test(node.name), 'Role assignment requires a GUID name, scope and properties.')
        const scope = resources.find(item => same(item.node.armId, body.scope?.id) && (item.node.type === 'Microsoft.ContainerRegistry/registries' || item.node.type === 'Microsoft.CognitiveServices/accounts'))
        check(node, scope && same(node.armId, `${scope.node.armId}/providers/Microsoft.Authorization/roleAssignments/${node.name}`) && bound(node, '/scope', scope.node), 'Role scope must reference the exact declared registry or Foundry account.')
        check(node, keys(body.properties, ['principalId', 'principalType', 'roleDefinitionId'], ['principalId', 'principalType', 'roleDefinitionId']) && uuid.test(body.properties.principalId)
          && body.properties.principalType === 'ServicePrincipal', 'Role requires a UAMI ServicePrincipal.')
        const identity = resources.find(item => item.node.type === 'Microsoft.ManagedIdentity/userAssignedIdentities'
          && bound(node, '/properties/principalId', item.node, 'properties.principalId', identityFault && !main))
        check(node, identity && same(body.properties.principalId, plannedIdentities.get(identity.node.id)?.principalId), 'Role principal must equal the declared UAMI principal ID.')
        const definition = scope.node.type === 'Microsoft.ContainerRegistry/registries' ? ACR_PULL_ROLE_ID : COGNITIVE_SERVICES_USER_ROLE_ID
        check(node, same(body.properties.roleDefinitionId, `/subscriptions/${graph.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${definition}`), 'Role definition must match its exact scope.')
        const roleName = node.name.toLowerCase()
        const roleTriple = `${body.scope.id.toLowerCase()}|${body.properties.principalId.toLowerCase()}|${definition}`
        if (declaredRoleNames.has(roleName) || declaredRoleTriples.has(roleTriple))
          throw diagnostic(node, 'Declared role GUID or scope/principal/role triple is duplicated.', 'BICEP_ROLE_CONFLICT')
        declaredRoleNames.add(roleName)
        declaredRoleTriples.add(roleTriple)
      } else if (node.type === 'Microsoft.App/containerApps') {
        basic(node, graph, ['name', 'location', 'identity', 'properties'], ['name', 'location', 'identity', 'properties'])
        check(node, !node.existing && keys(body.identity, ['type', 'userAssignedIdentities'], ['type', 'userAssignedIdentities']) && body.identity.type === 'UserAssigned'
          && object(body.identity.userAssignedIdentities) && Object.keys(body.identity.userAssignedIdentities).length === 1, 'App must attach exactly one UAMI.')
        const identityId = Object.keys(body.identity.userAssignedIdentities)[0]
        const identity = targetResource(resources, identityId, 'Microsoft.ManagedIdentity/userAssignedIdentities')
        check(node, identity && keys(body.identity.userAssignedIdentities[identityId], []), 'App UAMI must be a declared identity.')
        check(node, keys(body.properties, ['managedEnvironmentId', 'configuration', 'template'], ['managedEnvironmentId', 'configuration', 'template']), 'App properties have unsupported fields.')
        const env = targetResource(resources, body.properties.managedEnvironmentId, 'Microsoft.App/managedEnvironments')
        check(node, env && bound(node, '/properties/managedEnvironmentId', env.node, 'id'), 'App environment must be linked to the declared environment.')
        const config = body.properties.configuration
        check(node, keys(config, ['ingress', 'registries'], ['ingress', 'registries']) && keys(config.ingress, ['external', 'targetPort'], ['external', 'targetPort'])
          && config.ingress.external === true && Number.isInteger(config.ingress.targetPort) && config.ingress.targetPort > 0 && config.ingress.targetPort <= 65535
          && Array.isArray(config.registries) && config.registries.length === 1, 'App requires supported external ingress and one registry.')
        const registry = resources.find(item => item.node.type === 'Microsoft.ContainerRegistry/registries' && item.node.existing && same(config.registries[0]?.server, `${item.node.name}.azurecr.io`))
        check(node, registry && keys(config.registries[0], ['server', 'identity'], ['server', 'identity']) && same(config.registries[0].identity, identityId)
          && bound(node, '/properties/configuration/registries/0/server', registry.node, 'properties.loginServer')
          && bound(node, '/properties/configuration/registries/0/identity', identity.node, 'id'), 'Registry must use existing ACR server and the attached UAMI.')
        const template = body.properties.template
        check(node, keys(template, ['containers', 'scale'], ['containers', 'scale']) && Array.isArray(template.containers) && template.containers.length === 1, 'App requires exactly one container.')
        const container = template.containers[0]
        check(node, keys(container, main ? ['name', 'image', 'resources', 'env', 'probes'] : ['name', 'image', 'resources', 'env'],
          main ? ['name', 'image', 'resources', 'env', 'probes'] : ['name', 'image', 'resources', 'env']) && typeof container.name === 'string' && container.name.length > 0
          && keys(container.resources, ['cpu', 'memory'], ['cpu', 'memory']) && container.resources.cpu === 0.5 && container.resources.memory === '1Gi'
          && Array.isArray(container.env) && container.env.length === 4, 'Container fields, CPU/memory or env are unsupported.')
        check(node, typeof container.image === 'string' && container.image.toLowerCase().startsWith(`${registry.node.name.toLowerCase()}.azurecr.io/`)
          && bound(node, '/properties/template/containers/0/image', registry.node, 'properties.loginServer')
          && findArtifact(artifacts, container.image, registry.node.armId), 'Image must resolve through existing ACR to its seeded published artifact.')
        const values = Object.fromEntries(container.env.map(entry => [entry.name, entry.value]))
        check(node, container.env.every(entry => keys(entry, ['name', 'value'], ['name', 'value']) && typeof entry.value === 'string')
          && Object.keys(values).length === 4 && ['APP_ENV', 'AZURE_CLIENT_ID', 'FOUNDRY_ENDPOINT', 'FOUNDRY_DEPLOYMENT'].every(name => Object.hasOwn(values, name)), 'App env must contain only the four supported values.')
        const index = name => container.env.findIndex(item => item.name === name)
        check(node, values.APP_ENV.length > 0 && bound(node, '/identity/userAssignedIdentities', identity.node)
          && bound(node, `/properties/template/containers/0/env/${index('AZURE_CLIENT_ID')}/value`, identity.node, 'properties.clientId', !main)
          && same(values.AZURE_CLIENT_ID, plannedIdentities.get(identity.node.id)?.clientId), 'AZURE_CLIENT_ID must equal the declared UAMI client ID and link through its module output.')
        const account = resources.find(item => item.node.type === 'Microsoft.CognitiveServices/accounts'
          && bound(node, `/properties/template/containers/0/env/${index('FOUNDRY_ENDPOINT')}/value`, item.node, 'properties.endpoint', !main)
          && same(values.FOUNDRY_ENDPOINT, `https://${item.node.name.toLowerCase()}.services.ai.azure.com/openai/v1/`))
        const deployment = resources.find(item => item.node.type === 'Microsoft.CognitiveServices/accounts/deployments'
          && bound(node, `/properties/template/containers/0/env/${index('FOUNDRY_DEPLOYMENT')}/value`, item.node, 'name', !main)
          && same(values.FOUNDRY_DEPLOYMENT, item.node.name) && account && id(item.node.armId).startsWith(`${id(account.node.armId)}/deployments/`))
        const artifact = findArtifact(artifacts, container.image, registry.node.armId)
        if (main) capstoneProbes(node, container.probes, artifact?.appSpec, config.ingress.targetPort)
        check(node, deployment && artifact?.appSpec?.foundry?.endpoint === values.FOUNDRY_ENDPOINT && artifact?.appSpec?.foundry?.deployment === values.FOUNDRY_DEPLOYMENT,
          'Foundry env must link to declared outputs and match the published artifact.')
        check(node, keys(template.scale, ['minReplicas', 'maxReplicas', 'rules'], ['minReplicas', 'maxReplicas', 'rules'])
          && Number.isInteger(template.scale.minReplicas) && template.scale.minReplicas >= 1
          && Number.isInteger(template.scale.maxReplicas) && template.scale.maxReplicas >= template.scale.minReplicas && template.scale.maxReplicas <= 1000
          && Array.isArray(template.scale.rules) && template.scale.rules.length === 1
          && keys(template.scale.rules[0], ['name', 'custom'], ['name', 'custom']) && typeof template.scale.rules[0].name === 'string'
          && keys(template.scale.rules[0].custom, ['type', 'metadata'], ['type', 'metadata']) && template.scale.rules[0].custom.type === 'cpu'
          && keys(template.scale.rules[0].custom.metadata, ['type', 'value'], ['type', 'value']) && template.scale.rules[0].custom.metadata.type === 'Utilization'
          && /^(?:[1-9]|[1-9][0-9]|100)$/.test(template.scale.rules[0].custom.metadata.value), 'App requires one supported CPU scale rule and valid replica bounds.')
      }
      resources.push({ node, lineage: node.bindings ?? [] })
    }
    const of = type => resources.filter(item => item.node.type === type)
    if (capstone) {
      const expected = lab.bicepTargets.find(item => item.templatePath === rootPath)
      check(resources[0]?.node ?? graph.order[0], typeof expected?.registryName === 'string'
        && typeof expected?.identityName === 'string'
        && of('Microsoft.ContainerRegistry/registries').length === 1
        && same(of('Microsoft.ContainerRegistry/registries')[0].node.name, expected.registryName)
        && of('Microsoft.ManagedIdentity/userAssignedIdentities').length === 1
        && same(of('Microsoft.ManagedIdentity/userAssignedIdentities')[0].node.name, expected.identityName),
      'Registry and identity must match the manifest-approved Capstone names.')
    }
    if (main) check(resources[0]?.node ?? graph.order[0], currentBootstrap
      && bootstrapProof.sourceHash === currentBootstrap.sourceHash
      && bootstrapProof.parameterHash === currentBootstrap.parameterHash
      && bootstrapProof.templatePath === currentBootstrap.templatePath
      && JSON.stringify(bootstrapProof.fileVersions) === JSON.stringify(currentBootstrap.fileVersions),
    'Main requires the current successful bootstrap source and parameter tuple.')
    if (bootstrap) {
      const registry = of('Microsoft.ContainerRegistry/registries')[0]?.node
      const identity = of('Microsoft.ManagedIdentity/userAssignedIdentities')[0]?.node
      check(registry ?? graph.order[0], resources.length === 2 && registry && identity
        && same(graph.outputs?.registryId, registry.armId)
        && same(graph.outputs?.registryServer, `${registry.name.toLowerCase()}.azurecr.io`)
        && same(graph.outputs?.identityId, identity.armId)
        && same(graph.outputs?.identityClientId, plannedIdentities.get(identity.id)?.clientId)
        && same(graph.outputs?.identityPrincipalId, plannedIdentities.get(identity.id)?.principalId),
      'Bootstrap requires only a Basic registry and UAMI with exact resource outputs.')
    }
    const identities = of('Microsoft.ManagedIdentity/userAssignedIdentities')
    const apps = of('Microsoft.App/containerApps')
    if (main) check(apps[0]?.node ?? graph.order[0], resources.length === 9
      && of('Microsoft.ContainerRegistry/registries').length === 1 && identities.length === 1
      && of('Microsoft.App/managedEnvironments').length === 1
      && of('Microsoft.CognitiveServices/accounts').length === 1
      && of('Microsoft.CognitiveServices/accounts/projects').length === 1
      && of('Microsoft.CognitiveServices/accounts/deployments').length === 1
      && of('Microsoft.Authorization/roleAssignments').length === 2 && apps.length === 1,
    'Capstone main requires one app, environment, account, project, deployment, registry, identity and two grants.')
    if (apps.length) {
      const app = apps[0].node
      check(app, apps.length === 1 && identities.length === (identityFault ? 2 : 1),
        identityFault ? 'This Lab requires one app and exactly two declared UAMIs.' : 'This Lab requires one app and exactly one UAMI.')
      const roles = of('Microsoft.Authorization/roleAssignments').map(item => item.node)
      const registry = of('Microsoft.ContainerRegistry/registries')[0]?.node
      const accounts = of('Microsoft.CognitiveServices/accounts')
      const endpointIndex = app.body.properties.template.containers[0].env
        .findIndex(item => item.name === 'FOUNDRY_ENDPOINT')
      const endpoint = app.body.properties.template.containers[0].env[endpointIndex]?.value
      const account = accounts.find(item => bound(app, `/properties/template/containers/0/env/${endpointIndex}/value`,
        item.node, 'properties.endpoint', !main)
        && same(endpoint, `https://${item.node.name.toLowerCase()}.services.ai.azure.com/openai/v1/`))?.node
      const appIdentity = identities.find(item => same(item.node.armId, Object.keys(app.body.identity.userAssignedIdentities)[0]))?.node
      const roleFor = (scope, roleId, identity) => roles.some(role => same(role.body.scope.id, scope)
        && same(role.body.properties.roleDefinitionId, `/subscriptions/${graph.subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/${roleId}`)
        && bound(role, '/properties/principalId', identity, 'properties.principalId', identityFault && !main))
      check(app, roles.length === 2 && (!identityFault || accounts.length === 1) && registry && account && appIdentity
        && roleFor(registry.armId, ACR_PULL_ROLE_ID, appIdentity)
        && (identityFault ? identities.some(item => roleFor(account.armId, COGNITIVE_SERVICES_USER_ROLE_ID, item.node))
          : roleFor(account.armId, COGNITIVE_SERVICES_USER_ROLE_ID, appIdentity)),
        'App identity requires exact registry AcrPull and account Cognitive Services User grants in the graph.')
    }
  } catch (error) { diagnostics.push(error?.path && error?.line && error?.column ? error : diagnostic(currentNode ?? { source: {} }, error?.message ?? String(error))) }
  return { resources: diagnostics.length ? [] : resources, diagnostics }
}
