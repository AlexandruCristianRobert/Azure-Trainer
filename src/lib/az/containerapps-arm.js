import { SUBSCRIPTION_ID } from '../sandbox/model.js'
import { attachedIdentityIds } from '../sandbox/containerapps.js'

const subscription = `/subscriptions/${SUBSCRIPTION_ID}`

export function environmentArmId(environment) {
  return `${subscription}/resourceGroups/${environment.resourceGroup}/providers/Microsoft.App/managedEnvironments/${environment.name}`
}

export function presentContainerAppEnvironment(environment) {
  return {
    id: environmentArmId(environment),
    location: environment.location,
    name: environment.name,
    properties: { provisioningState: 'Succeeded' },
    resourceGroup: environment.resourceGroup,
    tags: environment.tags ?? {},
    type: 'Microsoft.App/managedEnvironments',
  }
}

export function presentContainerApp(app) {
  const identityIds = attachedIdentityIds(app)
  const ingress = app.ingress === null ? null : {
    external: app.ingress === 'external',
    fqdn: `${app.name}.${app.environment}.${app.location}.azurecontainerapps.io`,
    targetPort: app.targetPort,
  }
  return {
    id: `${subscription}/resourceGroups/${app.resourceGroup}/providers/Microsoft.App/containerApps/${app.name}`,
    ...(identityIds.length ? { identity: { type: 'UserAssigned', userAssignedIdentities: Object.fromEntries(identityIds.map((id) => [id, {}])) } } : {}),
    location: app.location,
    name: app.name,
    properties: {
      configuration: { activeRevisionsMode: 'Single', ingress: ingress === null ? null : { ...ingress, allowInsecure: false },
        ...(app.registryServer ? { registries: [{ server: app.registryServer, identity: app.registryIdentity }] } : {}) },
      environmentId: environmentArmId({ resourceGroup: app.environmentResourceGroup, name: app.environment }),
      managedEnvironmentId: environmentArmId({ resourceGroup: app.environmentResourceGroup, name: app.environment }),
      provisioningState: 'Succeeded',
      template: {
        containers: [{ image: app.image, name: app.name, resources: { cpu: app.cpu ?? 0.5, memory: app.memory ?? '1Gi' },
          ...(app.envVars && Object.keys(app.envVars).length ? { env: Object.entries(app.envVars).map(([name, value]) => ({ name, value })) } : {}),
          ...(app.probes !== undefined ? { probes: app.probes } : {}) }],
        scale: { maxReplicas: app.maxReplicas, minReplicas: app.minReplicas, rules: app.scaleRules },
      },
    },
    resourceGroup: app.resourceGroup,
    tags: app.tags ?? {},
    type: 'Microsoft.App/containerApps',
  }
}
