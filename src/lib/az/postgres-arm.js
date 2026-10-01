import { SUBSCRIPTION_ID } from '../sandbox/model.js'

const serverId = server => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${server.resourceGroup}/providers/Microsoft.DBforPostgreSQL/flexibleServers/${server.name}`
export function presentPostgresServer(server) {
  return {
    id: serverId(server), name: server.name, resourceGroup: server.resourceGroup, location: server.location,
    type: 'Microsoft.DBforPostgreSQL/flexibleServers', version: server.version, state: 'Ready',
    administratorLogin: server.adminUser, fullyQualifiedDomainName: server.fullyQualifiedDomainName,
    sku: { name: server.skuName, tier: server.tier }, storage: { storageSizeGb: server.storageSizeGb },
    network: { publicAccess: server.publicAccess },
  }
}
export function presentPostgresParameter(server, name) {
  return { id: `${serverId(server)}/configurations/${name}`, name, value: server.parameters[name],
    source: server.parameterOverrides.includes(name) ? 'user-override' : 'system-default',
    type: 'Microsoft.DBforPostgreSQL/flexibleServers/configurations' }
}
export function presentPostgresDatabase(database, server) {
  return { id: `${serverId(server)}/databases/${database.name}`, name: database.name,
    resourceGroup: server.resourceGroup, charset: 'UTF8', collation: 'en_US.utf8',
    type: 'Microsoft.DBforPostgreSQL/flexibleServers/databases' }
}
