export function presentRegistry(registry) {
  return { id: registry.id, name: registry.name, resourceGroup: registry.resourceGroup, location: registry.location,
    loginServer: registry.loginServer, sku: { name: registry.sku, tier: registry.sku }, tags: registry.tags ?? {},
    type: 'Microsoft.ContainerRegistry/registries', provisioningState: 'Succeeded' }
}

export function presentIdentity(identity) {
  return { id: identity.id, name: identity.name, resourceGroup: identity.resourceGroup, location: identity.location,
    clientId: identity.clientId, principalId: identity.principalId, tags: identity.tags ?? {},
    type: 'Microsoft.ManagedIdentity/userAssignedIdentities', provisioningState: 'Succeeded' }
}
