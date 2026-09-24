import { SUBSCRIPTION_ID, cloneSandbox, nowIso } from './model.js'
import { normalizeLocation } from './locations.js'
import { AzError } from './errors.js'
import { getResourceGroup } from './ops.js'

const ENVIRONMENT_NAME_RE = /^[-\w.()]+$/
const APP_NAME_RE = /^(?=.{1,31}$)(?!.*--)[a-z](?:[a-z0-9-]*[a-z0-9])?$/
const SCALE_RULE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

function same(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase()
}

export function attachedIdentityIds(app) {
  return (Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]).filter((id) => typeof id === 'string' && id.length > 0)
}

function storedIdentityIds(ids) {
  return ids.length === 0 ? null : ids.length === 1 ? ids[0] : ids
}

export function detachIdentityFromApps(sandbox, identityIds) {
  const removed = new Set(identityIds.map((id) => id.toLowerCase()))
  for (const app of sandbox.containerApps) {
    app.userAssigned = storedIdentityIds(attachedIdentityIds(app).filter((id) => !removed.has(id.toLowerCase())))
    if (typeof app.registryIdentity === 'string' && removed.has(app.registryIdentity.toLowerCase())) app.registryIdentity = null
  }
}

function requireEnvironmentName(name) {
  if (typeof name !== 'string' || !ENVIRONMENT_NAME_RE.test(name)) {
    throw new AzError('BadRequest', `The managed environment name '${name}' is invalid. Names may contain letters, numbers, underscores, hyphens, periods and parentheses.`)
  }
}

function requireAppName(name) {
  if (typeof name !== 'string' || !APP_NAME_RE.test(name)) {
    throw new AzError('BadRequest', `The container app name '${name}' is invalid. Names must start with a lowercase letter, contain fewer than 32 characters, use lowercase letters, numbers or hyphens, and cannot contain consecutive hyphens.`)
  }
}

function requireScaleRuleName(name) {
  if (typeof name !== 'string' || !SCALE_RULE_NAME_RE.test(name)) {
    throw new AzError('BadRequest', `The scale rule name '${name}' is invalid.`)
  }
}

function findEnvironment(sb, resourceGroup, name) {
  return sb.containerAppEnvironments.find((environment) => same(environment.resourceGroup, resourceGroup) && same(environment.name, name))
}

function findApp(sb, resourceGroup, name) {
  return sb.containerApps.find((app) => same(app.resourceGroup, resourceGroup) && same(app.name, name))
}

function resolveEnvironment(sb, reference, appResourceGroup) {
  if (typeof reference !== 'string' || !reference) throw new AzError('InvalidArgumentValue', 'argument --environment: expected an environment name or resource ID.', { kind: 'cli' })
  const id = /^\/subscriptions\/([^/]+)\/resourcegroups\/([^/]+)\/providers\/microsoft\.app\/managedenvironments\/([^/]+)$/i.exec(reference)
  if (id && !same(id[1], SUBSCRIPTION_ID)) throw new AzError('ResourceNotFound', `The subscription '${id[1]}' does not exist in the Sandbox.`)
  const resourceGroup = id ? id[2] : appResourceGroup
  const name = id ? id[3] : reference
  const environment = findEnvironment(sb, resourceGroup, name)
  if (!environment) throw new AzError('ResourceNotFound', `The managed environment '${reference}' could not be found.`)
  return environment
}

function validateReplicaBounds(minReplicas, maxReplicas) {
  if (!Number.isInteger(minReplicas) || minReplicas < 0 || minReplicas > 1000) throw new AzError('InvalidArgumentValue', 'min replicas must be an integer between 0 and 1000.', { kind: 'cli' })
  if (!Number.isInteger(maxReplicas) || maxReplicas < 1 || maxReplicas > 1000) throw new AzError('InvalidArgumentValue', 'max replicas must be an integer between 1 and 1000.', { kind: 'cli' })
  if (minReplicas > maxReplicas) throw new AzError('InvalidArgumentValue', 'min replicas cannot be greater than max replicas.', { kind: 'cli' })
}

function makeRule({ scaleRuleName, scaleRuleType, scaleRuleHttpConcurrency, scaleRuleMetadata }, cpuCapable = false) {
  if (scaleRuleName === undefined && scaleRuleType === undefined && scaleRuleHttpConcurrency === undefined && scaleRuleMetadata === undefined) return null
  if (scaleRuleName === undefined) throw new AzError('InvalidArgumentValue', '--scale-rule-name is required when configuring a scale rule.', { kind: 'cli' })
  requireScaleRuleName(scaleRuleName)
  if (scaleRuleType === undefined) scaleRuleType = 'http'
  if (scaleRuleType === 'cpu') {
    if (!cpuCapable) throw new AzError('InvalidArgumentValue', 'CPU scale rules are available only in a CPU scaling Lab.', { kind: 'cli' })
    if (scaleRuleHttpConcurrency !== undefined) throw new AzError('InvalidArgumentValue', 'HTTP concurrency cannot be combined with a CPU rule.', { kind: 'cli' })
    if (!Array.isArray(scaleRuleMetadata)) throw new AzError('InvalidArgumentValue', 'CPU metadata requires type=Utilization and value=1..100.', { kind: 'cli' })
    const keys = scaleRuleMetadata.map(([key]) => key)
    if (new Set(keys).size !== keys.length) throw new AzError('InvalidArgumentValue', 'Duplicate CPU metadata keys are not supported.', { kind: 'cli' })
    if (keys.some((key) => key !== 'type' && key !== 'value')) throw new AzError('InvalidArgumentValue', 'Unknown CPU metadata key.', { kind: 'cli' })
    if (scaleRuleMetadata.length !== 2) throw new AzError('InvalidArgumentValue', 'CPU metadata requires type=Utilization and value=1..100.', { kind: 'cli' })
    const metadata = Object.fromEntries(scaleRuleMetadata)
    if (metadata.type !== 'Utilization') throw new AzError('InvalidArgumentValue', 'CPU metadata type must be Utilization.', { kind: 'cli' })
    if (!/^(?:[1-9]|[1-9][0-9]|100)$/.test(metadata.value)) throw new AzError('InvalidArgumentValue', 'CPU utilization target must be an integer from 1 to 100.', { kind: 'cli' })
    return { name: scaleRuleName, custom: { type: 'cpu', metadata: { type: 'Utilization', value: metadata.value } } }
  }
  if (scaleRuleHttpConcurrency === undefined) scaleRuleHttpConcurrency = 10
  if (scaleRuleType !== 'http') throw new AzError('InvalidArgumentValue', `Only HTTP scale rules are supported in the Sandbox; received '${scaleRuleType}'.`, { kind: 'cli' })
  if (scaleRuleMetadata !== undefined) throw new AzError('InvalidArgumentValue', 'CPU metadata cannot be combined with an HTTP rule.', { kind: 'cli' })
  if (!Number.isInteger(scaleRuleHttpConcurrency) || scaleRuleHttpConcurrency <= 0) throw new AzError('InvalidArgumentValue', 'HTTP scale rule concurrency must be a positive integer.', { kind: 'cli' })
  return { name: scaleRuleName, http: { metadata: { concurrentRequests: String(scaleRuleHttpConcurrency) } } }
}

function upsertRule(app, rule, replace = false) {
  if (!rule) return
  if (replace) { app.scaleRules = [rule]; return }
  const index = app.scaleRules.findIndex((current) => same(current.name, rule.name))
  if (index === -1) app.scaleRules.push(rule)
  else app.scaleRules[index] = { ...rule, name: app.scaleRules[index].name }
}

function cpuResource(candidate, lab) {
  const capable = lab?.capabilities?.cpuScaling === true
  if (!capable && candidate.cpuSupplied) throw new AzError('InvalidArgumentValue', `unrecognized arguments: --cpu ${candidate.cpuRaw}`, { kind: 'cli' })
  if (!capable && candidate.memorySupplied) throw new AzError('InvalidArgumentValue', `unrecognized arguments: --memory ${candidate.memory}`, { kind: 'cli' })
  if (!capable && (candidate.cpuSupplied || candidate.memorySupplied || candidate.rule?.custom?.type === 'cpu')) {
    throw new AzError('InvalidArgumentValue', 'CPU resources and rules are available only in a CPU scaling Lab.', { kind: 'cli' })
  }
  if (!capable) return
  if (candidate.minReplicas < 1) throw new AzError('InvalidArgumentValue', 'This CPU simulation requires --min-replicas of at least 1.', { kind: 'cli' })
  const allowed = lab.cpuScaling?.allowedResources ?? []
  if (!allowed.some((pair) => pair.cpu === candidate.cpu && pair.memory === candidate.memory)) {
    throw new AzError('InvalidArgumentValue', `CPU/memory pair ${candidate.cpu}/${candidate.memory} is not supported in this Lab.`, { kind: 'cli' })
  }
}

function parseCpu(value, fallback) {
  if (value === undefined) return fallback
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new AzError('InvalidArgumentValue', '--cpu must be a positive number.', { kind: 'cli' })
  return number
}

function parseEnvironmentVariables(entries, flag) {
  if (entries === undefined) return undefined
  if (!Array.isArray(entries) || entries.some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== 'string')) {
    throw new AzError('InvalidArgumentValue', `${flag} requires KEY=value entries.`, { kind: 'cli' })
  }
  return Object.fromEntries(entries)
}

function validateIdentityOptions(sb, userAssigned, registryIdentity, registryServer) {
  if (userAssigned !== undefined && !sb.managedIdentities.some((identity) => same(identity.id, userAssigned))) throw new AzError('ResourceNotFound', `Managed identity '${userAssigned}' was not found.`)
  if (registryIdentity !== undefined && !sb.managedIdentities.some((identity) => same(identity.id, registryIdentity))) throw new AzError('ResourceNotFound', `Registry identity '${registryIdentity}' was not found.`)
  if (registryServer !== undefined && !/^[a-z0-9]+\.azurecr\.io$/i.test(registryServer)) throw new AzError('InvalidArgumentValue', '--registry-server must name a simulated ACR login server.', { kind: 'cli' })
}

export function assignContainerAppIdentity(sb, { resourceGroup, name, userAssigned }) {
  const current = getContainerApp(sb, resourceGroup, name)
  const identity = sb.managedIdentities.find((entry) => same(entry.id, userAssigned))
  if (!identity) throw new AzError('ResourceNotFound', `Managed identity '${userAssigned}' was not found.`)
  if (attachedIdentityIds(current).some((id) => same(id, identity.id))) return { sandbox: sb, resource: current, changed: false }
  if (attachedIdentityIds(current).length >= 32) throw new AzError('InvalidArgumentValue', 'A Container App supports at most 32 assigned identities in this Sandbox.', { kind: 'cli' })
  const next = cloneSandbox(sb)
  const app = findApp(next, resourceGroup, name)
  app.userAssigned = storedIdentityIds([...attachedIdentityIds(app), identity.id])
  return { sandbox: next, resource: app, changed: true }
}

export function getContainerAppEnvironment(sb, resourceGroup, name) {
  getResourceGroup(sb, resourceGroup)
  const environment = findEnvironment(sb, resourceGroup, name)
  if (!environment) throw new AzError('ResourceNotFound', `The managed environment '${name}' under resource group '${resourceGroup}' was not found.`)
  return environment
}

export function listContainerAppEnvironments(sb, resourceGroup = null) {
  if (resourceGroup === null) return sb.containerAppEnvironments.slice()
  getResourceGroup(sb, resourceGroup)
  return sb.containerAppEnvironments.filter((environment) => same(environment.resourceGroup, resourceGroup))
}

export function createContainerAppEnvironment(sb, { resourceGroup, name, location, tags = null }) {
  const group = getResourceGroup(sb, resourceGroup)
  requireEnvironmentName(name)
  const current = findEnvironment(sb, resourceGroup, name)
  let resolvedLocation = current?.location ?? group.location
  if (location !== undefined && location !== null) {
    resolvedLocation = normalizeLocation(location)
    if (!resolvedLocation) throw new AzError('LocationNotAvailableForResourceType', `The provided location '${location}' is not available for resource type 'Microsoft.App/managedEnvironments'.`)
    if (current && !same(current.location, resolvedLocation)) throw new AzError('Conflict', `The managed environment '${current.name}' location cannot be changed after creation.`)
  }
  const next = cloneSandbox(sb)
  let environment = findEnvironment(next, resourceGroup, name)
  if (environment) {
    if (tags !== null) environment.tags = tags
  } else {
    environment = { name, resourceGroup: group.name, location: resolvedLocation, tags, createdAt: nowIso() }
    next.containerAppEnvironments.push(environment)
  }
  return { sandbox: next, resource: environment }
}

export function deleteContainerAppEnvironment(sb, { resourceGroup, name }) {
  const environment = getContainerAppEnvironment(sb, resourceGroup, name)
  const dependent = sb.containerApps.find((app) => same(app.environmentResourceGroup, environment.resourceGroup) && same(app.environment, environment.name))
  if (dependent) throw new AzError('Conflict', `The managed environment '${environment.name}' cannot be deleted while it is used by container app '${dependent.name}' in resource group '${dependent.resourceGroup}'.`)
  const next = cloneSandbox(sb)
  next.containerAppEnvironments = next.containerAppEnvironments.filter((item) => !(same(item.resourceGroup, resourceGroup) && same(item.name, name)))
  return { sandbox: next, resource: null }
}

export function getContainerApp(sb, resourceGroup, name) {
  getResourceGroup(sb, resourceGroup)
  const app = findApp(sb, resourceGroup, name)
  if (!app) throw new AzError('ResourceNotFound', `The container app '${name}' under resource group '${resourceGroup}' was not found.`)
  return app
}

export function listContainerApps(sb, resourceGroup = null) {
  if (resourceGroup === null) return sb.containerApps.slice()
  getResourceGroup(sb, resourceGroup)
  return sb.containerApps.filter((app) => same(app.resourceGroup, resourceGroup))
}

function validateIngress(ingress, targetPort) {
  if (ingress !== undefined && ingress !== null && ingress !== 'external' && ingress !== 'internal') throw new AzError('InvalidArgumentValue', `argument --ingress: invalid choice: '${ingress}' (choose from 'external', 'internal')`, { kind: 'cli' })
  if (targetPort !== undefined && targetPort !== null && (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535)) throw new AzError('InvalidArgumentValue', 'target port must be an integer between 1 and 65535.', { kind: 'cli' })
}

export function createContainerApp(sb, { resourceGroup, name, environment, image, ingress = null, targetPort = null, minReplicas = 0, maxReplicas = 10, cpu, memory, tags = null, userAssigned, registryIdentity, registryServer, envVars, ...scale }, lab = null) {
  const group = getResourceGroup(sb, resourceGroup)
  requireAppName(name)
  if (typeof image !== 'string' || !image) throw new AzError('InvalidArgumentValue', 'argument --image: expected one argument', { kind: 'cli' })
  const env = resolveEnvironment(sb, environment, group.name)
  const current = findApp(sb, resourceGroup, name)
  if (current && (!same(current.environmentResourceGroup, env.resourceGroup) || !same(current.environment, env.name))) {
    throw new AzError('Conflict', `The container app '${current.name}' environment cannot be changed after creation.`)
  }
  validateIngress(ingress, targetPort)
  validateIdentityOptions(sb, userAssigned, registryIdentity, registryServer)
  const nextRegistryIdentity = registryIdentity ?? current?.registryIdentity
  const nextAssignedIds = userAssigned === undefined ? attachedIdentityIds(current ?? { userAssigned: null }) : [userAssigned]
  if (nextRegistryIdentity && !nextAssignedIds.some((id) => same(id, nextRegistryIdentity))) {
    throw new AzError('InvalidArgumentValue', '--registry-identity must be attached to the Container App with --user-assigned.', { kind: 'cli' })
  }
  const parsedEnv = parseEnvironmentVariables(envVars, '--env-vars')
  validateReplicaBounds(minReplicas, maxReplicas)
  const resourceCpu = parseCpu(cpu, current?.cpu ?? 0.5)
  const resourceMemory = memory ?? current?.memory ?? '1Gi'
  const rule = makeRule(scale, lab?.capabilities?.cpuScaling === true)
  cpuResource({ cpu: resourceCpu, cpuRaw: cpu, memory: resourceMemory, minReplicas, rule, cpuSupplied: cpu !== undefined, memorySupplied: memory !== undefined }, lab)
  const next = cloneSandbox(sb)
  let app = findApp(next, resourceGroup, name)
  if (app) {
    app.environment = env.name
    app.environmentResourceGroup = env.resourceGroup
    app.location = env.location
    app.image = image
    if (ingress !== undefined) app.ingress = ingress
    if (targetPort !== undefined) app.targetPort = targetPort
    if (userAssigned !== undefined) app.userAssigned = sb.managedIdentities.find((identity) => same(identity.id, userAssigned)).id
    if (registryIdentity !== undefined) app.registryIdentity = sb.managedIdentities.find((identity) => same(identity.id, registryIdentity)).id
    if (registryServer !== undefined) app.registryServer = registryServer
    if (parsedEnv !== undefined) app.envVars = { ...(app.envVars ?? {}), ...parsedEnv }
    app.minReplicas = minReplicas
    app.maxReplicas = maxReplicas
    app.cpu = resourceCpu
    app.memory = resourceMemory
    if (tags !== null) app.tags = tags
    upsertRule(app, rule, lab?.capabilities?.cpuScaling === true)
  } else {
    app = { name, resourceGroup: group.name, location: env.location, environment: env.name, environmentResourceGroup: env.resourceGroup, image, ingress, targetPort, minReplicas, maxReplicas, cpu: resourceCpu, memory: resourceMemory, scaleRules: [], tags, createdAt: nowIso(), userAssigned: userAssigned === undefined ? null : sb.managedIdentities.find((identity) => same(identity.id, userAssigned)).id, registryIdentity: registryIdentity === undefined ? null : sb.managedIdentities.find((identity) => same(identity.id, registryIdentity)).id, registryServer: registryServer ?? null, envVars: parsedEnv ?? {} }
    upsertRule(app, rule, lab?.capabilities?.cpuScaling === true)
    next.containerApps.push(app)
  }
  return { sandbox: next, resource: app }
}

export function updateContainerApp(sb, { resourceGroup, name, image, minReplicas, maxReplicas, cpu, memory, tags, envVars, ...scale }, lab = null) {
  const current = getContainerApp(sb, resourceGroup, name)
  if (image !== undefined && (!image || typeof image !== 'string')) throw new AzError('InvalidArgumentValue', 'argument --image: expected one argument', { kind: 'cli' })
  const nextMin = minReplicas ?? current.minReplicas
  const nextMax = maxReplicas ?? current.maxReplicas
  validateReplicaBounds(nextMin, nextMax)
  const resourceCpu = parseCpu(cpu, current.cpu ?? 0.5)
  const resourceMemory = memory ?? current.memory ?? '1Gi'
  const rule = makeRule(scale, lab?.capabilities?.cpuScaling === true)
  cpuResource({ cpu: resourceCpu, cpuRaw: cpu, memory: resourceMemory, minReplicas: nextMin, rule, cpuSupplied: cpu !== undefined, memorySupplied: memory !== undefined }, lab)
  const parsedEnv = parseEnvironmentVariables(envVars, '--set-env-vars')
  const next = cloneSandbox(sb)
  const app = findApp(next, resourceGroup, name)
  if (image !== undefined) app.image = image
  if (minReplicas !== undefined) app.minReplicas = minReplicas
  if (maxReplicas !== undefined) app.maxReplicas = maxReplicas
  if (cpu !== undefined) app.cpu = resourceCpu
  if (memory !== undefined) app.memory = resourceMemory
  if (tags !== undefined) app.tags = tags
  if (parsedEnv !== undefined) app.envVars = { ...(app.envVars ?? {}), ...parsedEnv }
  upsertRule(app, rule, lab?.capabilities?.cpuScaling === true)
  return { sandbox: next, resource: app }
}

export function updateContainerAppFromProbeConfig(sb, { resourceGroup, name }, config) {
  getContainerApp(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  const app = findApp(next, resourceGroup, name)
  app.image = config.image
  app.envVars = { ...config.envVars }
  app.cpu = config.cpu
  app.memory = config.memory
  app.minReplicas = config.minReplicas
  app.maxReplicas = config.maxReplicas
  app.probes = structuredClone(config.probes)
  return { sandbox: next, resource: app }
}

export function updateContainerAppIngress(sb, { resourceGroup, name, ingress, targetPort }) {
  getContainerApp(sb, resourceGroup, name)
  validateIngress(ingress, targetPort)
  if (ingress === undefined && targetPort === undefined) throw new AzError('InvalidArgumentValue', 'Specify --type or --target-port for ingress.', { kind: 'cli' })
  const next = cloneSandbox(sb)
  const app = findApp(next, resourceGroup, name)
  if (ingress !== undefined) app.ingress = ingress
  if (targetPort !== undefined) app.targetPort = targetPort
  return { sandbox: next, resource: app }
}

export function deleteContainerApp(sb, { resourceGroup, name }) {
  getContainerApp(sb, resourceGroup, name)
  const next = cloneSandbox(sb)
  next.containerApps = next.containerApps.filter((app) => !(same(app.resourceGroup, resourceGroup) && same(app.name, name)))
  return { sandbox: next, resource: null }
}

export function deleteContainerAppResourcesInGroup(sb, resourceGroup) {
  const hostedEnvironment = sb.containerAppEnvironments.find((environment) => {
    if (!same(environment.resourceGroup, resourceGroup)) return false
    return sb.containerApps.some((app) => !same(app.resourceGroup, resourceGroup) && same(app.environmentResourceGroup, environment.resourceGroup) && same(app.environment, environment.name))
  })
  const crossGroupApp = hostedEnvironment && sb.containerApps.find((app) => !same(app.resourceGroup, resourceGroup) && same(app.environmentResourceGroup, hostedEnvironment.resourceGroup) && same(app.environment, hostedEnvironment.name))
  if (crossGroupApp) throw new AzError('Conflict', `Resource group '${resourceGroup}' cannot be deleted while its managed environment '${hostedEnvironment.name}' is used by container app '${crossGroupApp.name}' in resource group '${crossGroupApp.resourceGroup}'.`)
  const next = cloneSandbox(sb)
  next.containerApps = next.containerApps.filter((app) => !same(app.resourceGroup, resourceGroup))
  next.containerAppEnvironments = next.containerAppEnvironments.filter((environment) => !same(environment.resourceGroup, resourceGroup))
  return next
}
