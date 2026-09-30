import { SUBSCRIPTION_ID } from '../sandbox/model.js'

const subscription = `/subscriptions/${SUBSCRIPTION_ID}`
const accountId = (account) => `${subscription}/resourceGroups/${account.resourceGroup}/providers/Microsoft.DocumentDB/databaseAccounts/${account.name}`

export function presentCosmosAccount(account) {
  return {
    id: accountId(account),
    kind: account.kind,
    location: account.location,
    locations: [{ locationName: account.location, failoverPriority: 0, isZoneRedundant: false }],
    name: account.name,
    capabilities: account.capabilities.map((name) => ({ name })),
    consistencyPolicy: { defaultConsistencyLevel: account.defaultConsistencyLevel },
    documentEndpoint: `https://${account.name}.documents.azure.com:443/`,
    resourceGroup: account.resourceGroup,
    tags: account.tags ?? {},
    type: 'Microsoft.DocumentDB/databaseAccounts',
  }
}

export function presentCosmosDatabase(database, account) {
  return {
    id: `${accountId(account)}/sqlDatabases/${database.name}`,
    location: account.location,
    name: database.name,
    options: {},
    resource: { id: database.name },
    resourceGroup: account.resourceGroup,
    type: 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases',
  }
}

export function presentCosmosContainer(container, database, account) {
  return {
    id: `${accountId(account)}/sqlDatabases/${database.name}/containers/${container.name}`,
    location: account.location,
    name: container.name,
    options: { throughput: container.throughput },
    resource: {
      id: container.name,
      partitionKey: { paths: [container.partitionKeyPath], kind: 'Hash', version: 2 },
      vectorEmbeddingPolicy: container.vectorEmbeddingPolicy,
      indexingPolicy: container.indexingPolicy,
    },
    resourceGroup: account.resourceGroup,
    type: 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers',
  }
}
