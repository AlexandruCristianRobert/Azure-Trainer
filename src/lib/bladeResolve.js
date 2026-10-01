const LIST = { kind: 'resource-groups' }

function hasGroup(sb, name) {
  return (sb.resourceGroups ?? []).some((g) => g.name.toLowerCase() === String(name).toLowerCase())
}

function hasNamespace(sb, rg, name) {
  return (sb.namespaces ?? []).some((n) => n.resourceGroup.toLowerCase() === String(rg).toLowerCase() && n.name.toLowerCase() === String(name).toLowerCase())
}

function hasResource(resources, rg, name) {
  return (resources ?? []).some((resource) => resource.resourceGroup.toLowerCase() === String(rg).toLowerCase() && resource.name.toLowerCase() === String(name).toLowerCase())
}

function findCosmosAccount(sb, rg, name) {
  return (sb.cosmosAccounts ?? []).find((account) => account.resourceGroup.toLowerCase() === String(rg).toLowerCase() && account.name.toLowerCase() === String(name).toLowerCase())
}

function findCosmosDatabase(sb, rg, accountName, name) {
  return findCosmosAccount(sb, rg, accountName)?.databases?.find((database) => database.name === name)
}

function hasCosmosContainer(sb, rg, accountName, databaseName, name) {
  return findCosmosDatabase(sb, rg, accountName, databaseName)?.containers?.some((container) => container.name === name) ?? false
}

function findKeyVault(sb, rg, name) {
  return (sb.keyVaults ?? []).find((vault) => vault.resourceGroup.toLowerCase() === String(rg).toLowerCase() && vault.name.toLowerCase() === String(name).toLowerCase())
}

function hasKeyVaultSecret(sb, rg, vaultName, name) {
  return findKeyVault(sb, rg, vaultName)?.secrets?.some((secret) => secret.name.toLowerCase() === String(name).toLowerCase()) ?? false
}

function findEventGridTopic(sb, rg, name) {
  return (sb.eventGridTopics ?? []).find((topic) => topic.resourceGroup.toLowerCase() === String(rg).toLowerCase() && topic.name.toLowerCase() === String(name).toLowerCase())
}

function hasEventGridSubscription(sb, rg, topicName, name) {
  return findEventGridTopic(sb, rg, topicName)?.eventSubscriptions?.some((subscription) => subscription.name.toLowerCase() === String(name).toLowerCase()) ?? false
}

export function resolveBlade(blade, sandbox) {
  if (!blade) return { ...LIST }
  if (blade.kind === 'servicebus-namespace') {
    if (hasNamespace(sandbox, blade.resourceGroup, blade.name)) return { ...blade, tab: blade.tab ?? 'queues' }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'containerapp-environment') {
    if (hasResource(sandbox.containerAppEnvironments, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'containerapp') {
    if (hasResource(sandbox.containerApps, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'aks-cluster') {
    if (hasResource(sandbox.aksClusters, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'container-registry' || blade.kind === 'managed-identity') {
    const resources = blade.kind === 'container-registry' ? sandbox.containerRegistries : sandbox.managedIdentities
    if (hasResource(resources, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'storage-account') {
    if (hasResource(sandbox.storageAccounts, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'function-app') {
    if (hasResource(sandbox.functionApps, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'cosmos-account') {
    if (findCosmosAccount(sandbox, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'postgres-server') {
    if (hasResource(sandbox.postgresServers, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'cosmos-database') {
    if (findCosmosDatabase(sandbox, blade.resourceGroup, blade.account, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'cosmos-account', resourceGroup: blade.resourceGroup, name: blade.account }, sandbox)
  }
  if (blade.kind === 'cosmos-container') {
    if (hasCosmosContainer(sandbox, blade.resourceGroup, blade.account, blade.database, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'cosmos-database', resourceGroup: blade.resourceGroup, account: blade.account, name: blade.database }, sandbox)
  }
  if (blade.kind === 'key-vault') {
    if (findKeyVault(sandbox, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'key-vault-secret') {
    if (hasKeyVaultSecret(sandbox, blade.resourceGroup, blade.vault, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'key-vault', resourceGroup: blade.resourceGroup, name: blade.vault }, sandbox)
  }
  if (blade.kind === 'eventgrid-subscription') {
    if (hasEventGridSubscription(sandbox, blade.resourceGroup, blade.topic, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'eventgrid-topic', resourceGroup: blade.resourceGroup, name: blade.topic }, sandbox)
  }
  if (blade.kind === 'eventgrid-topic') {
    if (findEventGridTopic(sandbox, blade.resourceGroup, blade.name)) return { ...blade }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'resource-group') return hasGroup(sandbox, blade.name) ? { ...blade } : { ...LIST }
  return { ...LIST }
}
