import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as cosmos from '../../sandbox/cosmosdb.js'
import { presentCosmosAccount } from '../cosmosdb-arm.js'
import { AzError } from '../../sandbox/errors.js'

const ACCOUNT = { name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help: 'Name of the Azure Cosmos DB account.' }
const LOCATIONS = { name: '--locations', aliases: [], required: false, kind: 'pairs', dest: 'locations', help: 'One account location: regionName=<location> failoverPriority=0 isZoneRedundant=False.' }
const KIND = { name: '--kind', aliases: [], required: false, kind: 'string', choices: ['GlobalDocumentDB'], dest: 'kind', help: 'Database account kind.', defaultValue: 'GlobalDocumentDB' }
const CONSISTENCY = { name: '--default-consistency-level', aliases: [], required: false, kind: 'string', choices: ['Strong', 'BoundedStaleness', 'Session', 'ConsistentPrefix', 'Eventual'], dest: 'defaultConsistencyLevel', help: 'Default consistency level.', defaultValue: 'Session' }
const CAPABILITIES = { name: '--capabilities', aliases: [], required: false, kind: 'list', dest: 'capabilities', help: 'Supported capability: EnableNoSQLVectorSearch.' }

const accountEvent = (type, account) => event(type, 'cosmosAccount', { name: account.name, resourceGroup: account.resourceGroup })

function requireYes(values) {
  if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
}

export const cosmosdbGroup = defineGroup(['cosmosdb'], 'Manage Azure Cosmos DB database accounts.', {
  create: defineCommand(['cosmosdb', 'create'], 'Create an Azure Cosmos DB account.', {
    latencyMs: LATENCY.mutate,
    args: [ACCOUNT, ARG.resourceGroup, LOCATIONS, KIND, CONSISTENCY, ARG.tags, CAPABILITIES],
    run: ({ sandbox }, values) => {
      let existed = false
      try { existed = !!cosmos.getCosmosAccount(sandbox, values.resourceGroup, values.name) } catch { /* operation reports parent and validation errors */ }
      const { sandbox: next, resource } = cosmos.createCosmosAccount(sandbox, values)
      return { sandbox: next, output: presentCosmosAccount(resource), events: [accountEvent(existed ? 'updated' : 'created', resource)] }
    },
  }),
  update: defineCommand(['cosmosdb', 'update'], 'Update an Azure Cosmos DB account.', {
    latencyMs: LATENCY.mutate,
    args: [ACCOUNT, ARG.resourceGroup, CONSISTENCY, ARG.tags, CAPABILITIES],
    run: ({ sandbox }, values) => {
      const { sandbox: next, resource } = cosmos.updateCosmosAccount(sandbox, values)
      return { sandbox: next, output: presentCosmosAccount(resource), events: [accountEvent('updated', resource)] }
    },
  }),
  show: defineCommand(['cosmosdb', 'show'], 'Show an Azure Cosmos DB account.', {
    args: [ACCOUNT, ARG.resourceGroup],
    run: ({ sandbox }, values) => ({ sandbox, output: presentCosmosAccount(cosmos.getCosmosAccount(sandbox, values.resourceGroup, values.name)) }),
  }),
  list: defineCommand(['cosmosdb', 'list'], 'List Azure Cosmos DB accounts.', {
    args: [ARG.resourceGroupOptional],
    run: ({ sandbox }, values) => ({ sandbox, output: cosmos.listCosmosAccounts(sandbox, values.resourceGroup ?? null).map(presentCosmosAccount) }),
  }),
  delete: defineCommand(['cosmosdb', 'delete'], 'Delete an Azure Cosmos DB account.', {
    latencyMs: LATENCY.mutate,
    args: [ACCOUNT, ARG.resourceGroup, ARG.yes],
    run: ({ sandbox }, values) => {
      requireYes(values)
      const { sandbox: next, resource } = cosmos.deleteCosmosAccount(sandbox, values)
      return { sandbox: next, output: null, events: [accountEvent('deleted', resource)] }
    },
  }),
})
