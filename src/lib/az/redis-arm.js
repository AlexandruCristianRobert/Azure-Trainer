import { SUBSCRIPTION_ID } from '../sandbox/model.js'

const clusterId = cluster => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${cluster.resourceGroup}/providers/Microsoft.Cache/redisEnterprise/${cluster.name}`
export function presentRedisCluster(cluster) {
  return { id: clusterId(cluster), name: cluster.name, resourceGroup: cluster.resourceGroup, location: cluster.location,
    type: 'Microsoft.Cache/redisEnterprise', sku: { name: cluster.sku }, hostName: cluster.hostName, provisioningState: 'Succeeded' }
}
export function presentRedisDatabase(cluster) {
  const database = cluster.database
  return { id: `${clusterId(cluster)}/databases/${database.name}`, name: database.name, resourceGroup: cluster.resourceGroup,
    type: 'Microsoft.Cache/redisEnterprise/databases', provisioningState: 'Succeeded', port: database.port,
    modules: database.modules.map(name => ({ name })), clusteringPolicy: database.clusteringPolicy,
    evictionPolicy: database.evictionPolicy, clientProtocol: database.clientProtocol, accessKeysAuthentication: database.accessKeysAuthentication }
}
