import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { normalizeImageReference } from '../../../lib/simulation/runtime.js'

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

export function matchesApiSpec(spec, { service, port }) {
  const route = spec?.routes?.find((item) => item.method === 'GET' && item.path === '/api/info')
  return spec?.listeningPort === port && route?.response?.service?.value === service
    && route.response.environment?.kind === 'config' && route.response.environment.key === 'APP_ENV'
}

export function createDeploymentCriteria({ group, registry, environment, identity, app, service, port,
  environmentValue, requiredImage = null, capturedArtifact = false }) {
  const root = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${group}`
  const registryId = `${root}/providers/Microsoft.ContainerRegistry/registries/${registry}`
  const identityId = `${root}/providers/Microsoft.ManagedIdentity/userAssignedIdentities/${identity}`
  const appId = `${root}/providers/Microsoft.App/containerApps/${app}`
  const at = (items, name) => items?.find((item) => same(item.name, name) && same(item.resourceGroup, group))
  const registryFor = (context) => at(context.sandbox.containerRegistries, registry)
  const identityFor = (context) => at(context.sandbox.managedIdentities, identity)

  function grantReady(context) {
    const acr = registryFor(context), user = identityFor(context)
    return !!(acr && user && context.sandbox.roleAssignments.some((role) => same(role.scope, acr.id)
      && same(role.principalId, user.principalId) && role.roleName === 'AcrPull'))
  }

  function publishedBuild(context) {
    const reference = normalizeImageReference(requiredImage ?? at(context.sandbox.containerApps, app)?.image)
    const id = context.artifacts.publishedTags[reference]
    const build = context.artifacts.buildsById[id]
    return build && same(build.image.registryId, registryId) && matchesApiSpec(build.appSpec, { service, port })
      && build.dockerSpec?.listeningPort === port ? build : null
  }

  function deploymentEntry(context) {
    return Object.entries(context.runtime.deploymentsByApp).find(([id]) => same(id, appId))?.[1]
  }

  function deploymentReady(context) {
    const resource = at(context.sandbox.containerApps, app)
    const deployed = deploymentEntry(context)
    const active = deployed?.active
    const build = capturedArtifact ? context.artifacts.buildsById[active?.artifactId] : publishedBuild(context)
    return !!(resource && build && deployed?.status === 'succeeded' && active
      && context.sandbox.resourceGroups.some((item) => same(item.name, group) && item.location === 'eastus')
      && registryFor(context)?.sku === 'Basic' && at(context.sandbox.containerAppEnvironments, environment)?.location === 'eastus'
      && same(resource.environment, environment) && same(resource.environmentResourceGroup, group)
      && (!requiredImage || normalizeImageReference(resource.image) === normalizeImageReference(requiredImage))
      && resource.ingress === 'external' && resource.targetPort === port
      && same(resource.userAssigned, identityId) && same(resource.registryIdentity, identityId)
      && same(resource.registryServer, `${registry}.azurecr.io`) && grantReady(context)
      && resource.envVars?.APP_ENV === environmentValue
      && normalizeImageReference(deployed.desired?.image) === normalizeImageReference(active.image)
      && deployed.desired?.targetPort === active.targetPort && deployed.desired?.ingress === active.ingress
      && deployed.desired?.env?.APP_ENV === active.env?.APP_ENV
      && active.artifactId === build.id && active.env.APP_ENV === environmentValue
      && matchesApiSpec(active.appSpec, { service, port }))
  }

  return { registryFor, identityFor, grantReady, publishedBuild, deploymentEntry, deploymentReady, appId }
}
