import { cloneSandbox } from './model.js'
import { normalizeLocation } from './locations.js'
import { AzError } from './errors.js'

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const bad = message => { throw new AzError('BadRequest', message) }

export function getRedisCluster(sandbox, { resourceGroup, name }) {
  return (sandbox.redisClusters ?? []).find(cluster => same(cluster.name, name) && same(cluster.resourceGroup, resourceGroup)) ?? null
}

export function createRedisCluster(sandbox, options) {
  const { name, resourceGroup, sku = 'Balanced_B0', modules = [], clusteringPolicy = 'EnterpriseCluster',
    evictionPolicy = 'NoEviction', clientProtocol = 'Encrypted', accessKeysAuthentication = 'Enabled', port = 10000,
    memoryLimitBytes = 65536 } = options
  const group = sandbox.resourceGroups.find(group => same(group.name, resourceGroup))
  if (!group) throw new AzError('ResourceGroupNotFound', `Resource group '${resourceGroup}' could not be found.`)
  if (typeof name !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(name)) bad('Redis cluster names must be 3-63 lowercase letters, numbers, or hyphens, starting and ending with a letter or number.')
  const location = normalizeLocation(options.location ?? group.location)
  if (!location) bad(`The provided location '${options.location}' is not available.`)
  if (sku !== 'Balanced_B0') bad('Only Balanced_B0 is supported by the Redis simulator.')
  if (!Array.isArray(modules) || modules.length > 1 || modules.some(module => module !== 'RediSearch')) bad('Only the optional RediSearch module is supported at creation.')
  if (clusteringPolicy !== 'EnterpriseCluster' || evictionPolicy !== 'NoEviction') bad('This simulator requires EnterpriseCluster and NoEviction for Azure Managed Redis.')
  if (clientProtocol !== 'Encrypted' || accessKeysAuthentication !== 'Enabled' || port !== 10000) bad('This simulator requires encrypted clients, explicitly enabled training-only key authentication, and port 10000.')
  if (!Number.isFinite(memoryLimitBytes) || memoryLimitBytes < 0) bad('The teaching memory limit must be finite and nonnegative.')
  const existing = getRedisCluster(sandbox, { name, resourceGroup })
  if (existing) {
    const database = existing.database
    if (existing.location !== location || existing.sku !== sku || database.modules.join(',') !== modules.join(',')
      || database.clusteringPolicy !== clusteringPolicy || database.evictionPolicy !== evictionPolicy
      || database.clientProtocol !== clientProtocol || database.accessKeysAuthentication !== accessKeysAuthentication
      || database.port !== port || database.memoryLimitBytes !== memoryLimitBytes) {
      bad('Existing Redis configuration cannot be changed by create. Modules are selected at creation; recreate the cluster to change them.')
    }
    const next = cloneSandbox(sandbox)
    return { sandbox: next, cluster: getRedisCluster(next, { name, resourceGroup }) }
  }
  const next = cloneSandbox(sandbox)
  const cluster = { name, resourceGroup: group.name, location, sku, hostName: `${name}.${location}.redis.training.invalid`,
    database: { name: 'default', port, modules: [...modules], clusteringPolicy, evictionPolicy, clientProtocol,
      accessKeysAuthentication, keys: {}, indexes: {}, memoryLimitBytes, sourceRevisions: {},
      stats: { hits: 0, misses: 0, expiredKeys: 0, rejectedWrites: 0 } } }
  next.redisClusters ??= []
  next.redisClusters.push(cluster)
  return { sandbox: next, cluster }
}

export function deleteRedisCluster(sandbox, { resourceGroup, name }) {
  const cluster = getRedisCluster(sandbox, { resourceGroup, name })
  if (!cluster) throw new AzError('ResourceNotFound', `Redis cluster '${name}' was not found.`)
  const next = cloneSandbox(sandbox)
  next.redisClusters = next.redisClusters.filter(candidate => !(same(candidate.name, name) && same(candidate.resourceGroup, resourceGroup)))
  return { sandbox: next }
}
