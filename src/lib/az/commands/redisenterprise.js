import { defineGroup, defineCommand, ARG, LATENCY, event } from '../tree.js'
import { createRedisCluster, getRedisCluster, deleteRedisCluster } from '../../sandbox/redis.js'
import { AzError } from '../../sandbox/errors.js'
import { presentRedisCluster, presentRedisDatabase } from '../redis-arm.js'

const NAME = ARG.name('Azure Managed Redis cluster name.')
const field = (name, dest, help, extra = {}) => ({ name, dest, help, kind: 'string', ...extra })
const get = (sandbox, values) => {
  const cluster = getRedisCluster(sandbox, values)
  if (!cluster) throw new AzError('ResourceNotFound', `Redis cluster '${values.name}' was not found.`)
  return cluster
}
const change = (type, cluster) => event(type, 'redisCluster', { name: cluster.name, resourceGroup: cluster.resourceGroup })
export const redisenterpriseGroup = defineGroup(['redisenterprise'], 'Manage Azure Managed Redis (local training simulation).', {
  create: defineCommand(['redisenterprise', 'create'], 'Create an Azure Managed Redis cluster and default database.', {
    latencyMs: LATENCY.mutate,
    args: [NAME, ARG.resourceGroup, ARG.location(false),
      field('--sku', 'sku', 'Supported teaching SKU.', { required: true }),
      field('--modules', 'modules', 'Optional module selected at creation: name=RediSearch.', { kind: 'pairs' }),
      field('--clustering-policy', 'clusteringPolicy', 'EnterpriseCluster.'),
      field('--eviction-policy', 'evictionPolicy', 'NoEviction.'),
      field('--client-protocol', 'clientProtocol', 'Encrypted.'),
      field('--access-keys-auth', 'accessKeysAuthentication', 'Enabled; fictional training-only authentication.', { required: true }),
      field('--port', 'port', 'Database port 10000.', { kind: 'int' })],
    run: ({ sandbox }, values) => {
      const existed = getRedisCluster(sandbox, values)
      const modules = (values.modules ?? []).map(([key, value]) => {
        if (key !== 'name' || value !== 'RediSearch') throw new AzError('BadRequest', 'Only --modules name=RediSearch is supported.')
        return 'RediSearch'
      })
      const { sandbox: next, cluster } = createRedisCluster(sandbox, { ...values, modules })
      return { sandbox: next, output: presentRedisCluster(cluster), events: [change(existed ? 'updated' : 'created', cluster)] }
    },
  }),
  show: defineCommand(['redisenterprise', 'show'], 'Show an Azure Managed Redis cluster.', {
    args: [NAME, ARG.resourceGroup], run: ({ sandbox }, values) => ({ sandbox, output: presentRedisCluster(get(sandbox, values)) }),
  }),
  delete: defineCommand(['redisenterprise', 'delete'], 'Delete an Azure Managed Redis cluster.', {
    latencyMs: LATENCY.mutate, args: [NAME, ARG.resourceGroup, ARG.yes],
    run: ({ sandbox }, values) => {
      if (!values.yes) throw new AzError('Cancelled', 'Operation cancelled. Pass --yes to confirm deletion in the Sandbox.', { kind: 'cli' })
      const cluster = get(sandbox, values)
      return { ...deleteRedisCluster(sandbox, values), output: null, events: [change('deleted', cluster)] }
    },
  }),
  database: defineGroup(['redisenterprise', 'database'], 'Inspect the default Redis database.', {
    show: defineCommand(['redisenterprise', 'database', 'show'], 'Show Redis database settings.', {
      args: [ARG.resourceGroup, field('--cluster-name', 'name', 'Cluster name.', { required: true }), field('--database-name', 'databaseName', 'default.', { required: true })],
      run: ({ sandbox }, values) => {
        const cluster = get(sandbox, values)
        if (values.databaseName !== cluster.database.name) throw new AzError('ResourceNotFound', `Redis database '${values.databaseName}' was not found.`)
        return { sandbox, output: presentRedisDatabase(cluster) }
      },
    }),
  }),
})
