import { defineGroup } from '../tree.js'
import { versionCommand } from './misc.js'
import { accountGroup, loginCommand } from './account.js'
import { configureCommand } from './configure.js'
import { groupGroup } from './group.js'
import { servicebusGroup } from './servicebus.js'
import { containerappGroup } from './containerapp.js'
import { cosmosdbGroup } from './cosmosdb.js'
import { cosmosdbSqlGroup } from './cosmosdb-sql.js'
import { keyvaultGroup } from './keyvault.js'
import { roleGroup } from './role.js'
import { storageGroup } from './storage.js'
import { functionappGroup } from './functionapp.js'
import { eventgridGroup } from './eventgrid.js'
import { acrGroup } from './acr.js'
import { identityGroup } from './identity.js'
import { cognitiveservicesGroup } from './cognitiveservices.js'
import { deploymentGroup } from './deployment.js'
import { aksGroup } from './aks.js'
import { postgresGroup } from './postgres.js'
import { redisenterpriseGroup } from './redisenterprise.js'

let AZ_TREE = null

export function buildTree() {
  if (AZ_TREE) return AZ_TREE
  AZ_TREE = defineGroup([], 'Azure CLI (Sandbox)', {
    account: accountGroup,
    aks: aksGroup,
    acr: acrGroup,
    configure: configureCommand,
    containerapp: containerappGroup,
    cognitiveservices: cognitiveservicesGroup,
    cosmosdb: defineCosmosdbGroup(),
    deployment: deploymentGroup,
    eventgrid: eventgridGroup,
    group: groupGroup,
    identity: identityGroup,
    keyvault: keyvaultGroup,
    login: loginCommand,
    postgres: postgresGroup,
    redisenterprise: redisenterpriseGroup,
    servicebus: servicebusGroup,
    storage: storageGroup,
    functionapp: functionappGroup,
    role: roleGroup,
    version: versionCommand,
  })
  return AZ_TREE
}

function defineCosmosdbGroup() {
  return { ...cosmosdbGroup, children: { ...cosmosdbGroup.children, sql: cosmosdbSqlGroup } }
}
