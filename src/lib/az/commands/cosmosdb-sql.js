import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import * as cosmos from '../../sandbox/cosmosdb.js'
import { parseInlineJson } from '../../sandbox/cosmosdb-policies.js'
import { presentCosmosContainer, presentCosmosDatabase } from '../cosmosdb-arm.js'
import { AzError } from '../../sandbox/errors.js'

const ACCOUNT = { name: '--account-name', aliases: ['-a'], required: true, kind: 'string', dest: 'account', help: 'Name of the Azure Cosmos DB account.' }
const DATABASE = { name: '--database-name', aliases: ['-d'], required: true, kind: 'string', dest: 'database', help: 'Name of the SQL database.' }
const NAME = { name: '--name', aliases: ['-n'], required: true, kind: 'string', dest: 'name', help: 'Name of the resource.' }
const PARTITION_KEY = { name: '--partition-key-path', aliases: ['-p'], required: true, kind: 'string', dest: 'partitionKeyPath', help: 'Partition key JSON path.' }
const THROUGHPUT = { name: '--throughput', aliases: [], required: false, kind: 'int', dest: 'throughput', help: 'Manual RU/s throughput.', defaultValue: 400 }
const MAX_THROUGHPUT = { name: '--max-throughput', aliases: [], required: false, kind: 'int', dest: 'maxThroughput', help: 'Autoscale max RU/s throughput. Mutually exclusive with --throughput.' }
const VECTOR_EMBEDDINGS = { name: '--vector-embeddings', aliases: [], required: false, kind: 'string', dest: 'vectorEmbeddings', help: 'Inline JSON vector embedding policy.' }
const INDEXING = { name: '--idx', aliases: [], required: false, kind: 'string', dest: 'indexingPolicy', help: 'Inline JSON indexing policy.' }

const databaseEvent = (type, account, database) => event(type, 'cosmosDatabase', { name: database.name, resourceGroup: account.resourceGroup, account: account.name })
const containerEvent = (type, account, database, container) => event(type, 'cosmosContainer', { name: container.name, resourceGroup: account.resourceGroup, account: account.name, database: database.name })

function requireYes(values) {
  if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
}

function containerValues(values) {
  return {
    ...values,
    vectorEmbeddingPolicy: values.vectorEmbeddings === undefined ? null : parseInlineJson('--vector-embeddings', values.vectorEmbeddings),
    indexingPolicy: values.indexingPolicy === undefined ? null : parseInlineJson('--idx', values.indexingPolicy),
  }
}

export const cosmosdbSqlGroup = defineGroup(['cosmosdb', 'sql'], 'Manage Azure Cosmos DB SQL resources.', {
  database: defineGroup(['cosmosdb', 'sql', 'database'], 'Manage Azure Cosmos DB SQL databases.', {
    create: defineCommand(['cosmosdb', 'sql', 'database', 'create'], 'Create a SQL database.', {
      latencyMs: LATENCY.mutate,
      args: [NAME, ACCOUNT, ARG.resourceGroup],
      run: ({ sandbox }, values) => {
        let existed = false
        try { existed = !!cosmos.getCosmosDatabase(sandbox, values.resourceGroup, values.account, values.name) } catch { /* operation reports parent and validation errors */ }
        const { sandbox: next, resource, account } = cosmos.createCosmosDatabase(sandbox, values)
        return { sandbox: next, output: presentCosmosDatabase(resource, account), events: [databaseEvent(existed ? 'updated' : 'created', account, resource)] }
      },
    }),
    show: defineCommand(['cosmosdb', 'sql', 'database', 'show'], 'Show a SQL database.', {
      args: [NAME, ACCOUNT, ARG.resourceGroup],
      run: ({ sandbox }, values) => {
        const account = cosmos.getCosmosAccount(sandbox, values.resourceGroup, values.account)
        return { sandbox, output: presentCosmosDatabase(cosmos.getCosmosDatabase(sandbox, values.resourceGroup, values.account, values.name), account) }
      },
    }),
    list: defineCommand(['cosmosdb', 'sql', 'database', 'list'], 'List SQL databases.', {
      args: [ACCOUNT, ARG.resourceGroup],
      run: ({ sandbox }, values) => {
        const account = cosmos.getCosmosAccount(sandbox, values.resourceGroup, values.account)
        return { sandbox, output: cosmos.listCosmosDatabases(sandbox, values.resourceGroup, values.account).map((database) => presentCosmosDatabase(database, account)) }
      },
    }),
    delete: defineCommand(['cosmosdb', 'sql', 'database', 'delete'], 'Delete a SQL database.', {
      latencyMs: LATENCY.mutate,
      args: [NAME, ACCOUNT, ARG.resourceGroup, ARG.yes],
      run: ({ sandbox }, values) => {
        requireYes(values)
        const { sandbox: next, resource, account } = cosmos.deleteCosmosDatabase(sandbox, values)
        return { sandbox: next, output: null, events: [databaseEvent('deleted', account, resource)] }
      },
    }),
  }),
  container: defineGroup(['cosmosdb', 'sql', 'container'], 'Manage Azure Cosmos DB SQL containers.', {
    create: defineCommand(['cosmosdb', 'sql', 'container', 'create'], 'Create a SQL container.', {
      latencyMs: LATENCY.mutate,
      args: [NAME, ACCOUNT, DATABASE, ARG.resourceGroup, PARTITION_KEY, THROUGHPUT, MAX_THROUGHPUT, VECTOR_EMBEDDINGS, INDEXING],
      run: ({ sandbox, context }, values) => {
        let existed = false
        try { existed = !!cosmos.getCosmosContainer(sandbox, values.resourceGroup, values.account, values.database, values.name) } catch { /* operation reports parent and validation errors */ }
        const dataScale = context?.lab?.dataScale
        const scaleValues = dataScale ? { physicalPartitions: dataScale.physicalPartitions, logicalScale: dataScale.logicalScale } : {}
        const { sandbox: next, resource, account, database } = cosmos.createCosmosContainer(sandbox, { ...containerValues(values), ...scaleValues })
        return { sandbox: next, output: presentCosmosContainer(resource, database, account), events: [containerEvent(existed ? 'updated' : 'created', account, database, resource)] }
      },
    }),
    update: defineCommand(['cosmosdb', 'sql', 'container', 'update'], 'Update a SQL container indexing policy.', {
      latencyMs: LATENCY.mutate,
      args: [NAME, ACCOUNT, DATABASE, ARG.resourceGroup, INDEXING],
      run: ({ sandbox }, values) => {
        const account = cosmos.getCosmosAccount(sandbox, values.resourceGroup, values.account)
        const database = cosmos.getCosmosDatabase(sandbox, values.resourceGroup, values.account, values.database)
        const indexingPolicy = values.indexingPolicy === undefined ? null : parseInlineJson('--idx', values.indexingPolicy)
        const { sandbox: next, container } = cosmos.updateCosmosContainer(sandbox, { resourceGroup: values.resourceGroup, accountName: values.account, databaseName: values.database, name: values.name, indexingPolicy })
        return { sandbox: next, output: presentCosmosContainer(container, database, account), events: [containerEvent('updated', account, database, container)] }
      },
    }),
    show: defineCommand(['cosmosdb', 'sql', 'container', 'show'], 'Show a SQL container.', {
      args: [NAME, ACCOUNT, DATABASE, ARG.resourceGroup],
      run: ({ sandbox }, values) => {
        const account = cosmos.getCosmosAccount(sandbox, values.resourceGroup, values.account)
        const database = cosmos.getCosmosDatabase(sandbox, values.resourceGroup, values.account, values.database)
        return { sandbox, output: presentCosmosContainer(cosmos.getCosmosContainer(sandbox, values.resourceGroup, values.account, values.database, values.name), database, account) }
      },
    }),
    list: defineCommand(['cosmosdb', 'sql', 'container', 'list'], 'List SQL containers.', {
      args: [ACCOUNT, DATABASE, ARG.resourceGroup],
      run: ({ sandbox }, values) => {
        const account = cosmos.getCosmosAccount(sandbox, values.resourceGroup, values.account)
        const database = cosmos.getCosmosDatabase(sandbox, values.resourceGroup, values.account, values.database)
        return { sandbox, output: cosmos.listCosmosContainers(sandbox, values.resourceGroup, values.account, values.database).map((container) => presentCosmosContainer(container, database, account)) }
      },
    }),
    delete: defineCommand(['cosmosdb', 'sql', 'container', 'delete'], 'Delete a SQL container.', {
      latencyMs: LATENCY.mutate,
      args: [NAME, ACCOUNT, DATABASE, ARG.resourceGroup, ARG.yes],
      run: ({ sandbox }, values) => {
        requireYes(values)
        const { sandbox: next, resource, account, database } = cosmos.deleteCosmosContainer(sandbox, values)
        return { sandbox: next, output: null, events: [containerEvent('deleted', account, database, resource)] }
      },
    }),
  }),
})
