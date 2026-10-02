import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { getProjectManifest } from '../../../lib/project/manifests.js'
import { dataCleanupInventory } from '../../../lib/labEngine/data-capstone/ownership.js'
import { PG_CLUSTER_ID, PG_SERVER_COMMAND, PG_ALLOW_VECTOR_COMMAND, PG_DATABASE_COMMAND, pgSqlCommand, PG_HNSW_SQL } from './postgres-helpers.js'
import { REDIS_CREATE_COMMAND, REDIS_INDEX_COMMAND, redisCliCommand } from './redis-helpers.js'
import { DATA_CAPSTONE_TARGET, DATA_CAPSTONE_SOLUTION_FUNCTIONS } from '../../templates/data-python/capstone.js'
import { sourceTextHash } from '../../../lib/labEngine/sourceJournal.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
export { DATA_CAPSTONE_TARGET, pgSqlCommand, redisCliCommand }
export const DATA_CAPSTONE_API_TARGET = Object.freeze({ clusterId: PG_CLUSTER_ID, namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-api' })
export const DATA_CAPSTONE_WORKER_TARGET = Object.freeze({ clusterId: PG_CLUSTER_ID, namespace: 'assistant', deploymentName: 'feedback-worker' })
export const CAPSTONE_PG_COMMANDS = [PG_SERVER_COMMAND, PG_ALLOW_VECTOR_COMMAND, PG_DATABASE_COMMAND].map(line => line.replaceAll('rg-assistant', 'rg-data-capstone'))
export const CAPSTONE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS docs_product_version ON documents (product, version);
CREATE INDEX IF NOT EXISTS docs_metadata ON documents USING gin (metadata jsonb_path_ops);
${PG_HNSW_SQL};
`
export const CAPSTONE_REDIS_COMMANDS = [REDIS_CREATE_COMMAND.replaceAll('rg-assistant', 'rg-data-capstone'), redisCliCommand(REDIS_INDEX_COMMAND)]
export function capstoneArtifact(context, role = 'api') {
  if (!context.runtime?.kubernetes) return null
  const target = role === 'api' ? DATA_CAPSTONE_API_TARGET : DATA_CAPSTONE_WORKER_TARGET
  const pod = getDeploymentPods(context, target.clusterId, target.namespace, target.deploymentName)
    .filter(item => item.status?.phase === 'Running' && item.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True'))
    .sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid))[0]
  const id = pod && context.runtime?.kubernetes?.clusters?.[target.clusterId]?.podSnapshots?.[pod.metadata.uid]?.artifactId
  return id ? context.artifacts?.buildsById?.[id] ?? null : null
}
export function capstoneFunctionsCurrent(context, role, names) {
  const parsed = parsePythonProject(context.project.savedFiles, getProjectManifest(context.project.manifestId))
  const deployed = capstoneArtifact(context, role)?.appSpec?.data?.functions
  return !parsed.diagnostics.length && names.every(name => deployed?.[name]
    && JSON.stringify(deployed[name]) === JSON.stringify(parsed.appSpec?.data?.functions?.[name]))
}
export function capstoneConfigCurrent(context, role = 'api') {
  const parsed = parsePythonProject(context.project.savedFiles, getProjectManifest(context.project.manifestId))
  const deployed = capstoneArtifact(context, role)?.appSpec?.data?.composite?.globals
  return !!deployed && !parsed.diagnostics.length && canonicalize(deployed) === canonicalize(parsed.appSpec?.data?.composite?.globals)
}
export function replaceCapstoneFunctions(source, names) {
  let next = source
  for (const name of names) {
    const pattern = new RegExp(`^def ${name}\\([^]*?(?=^def |$(?![^]))`, 'm')
    if (!pattern.test(next)) throw new Error(`Missing learner function ${name}.`)
    next = next.replace(pattern, DATA_CAPSTONE_SOLUTION_FUNCTIONS[name] + '\n')
  }
  return next
}
export const capstoneServices = context => {
  const pg = context.sandbox?.postgresServers?.find(item => item.name === 'pg-assistant' && item.resourceGroup === 'rg-data-capstone')
  const cosmos = context.sandbox?.cosmosAccounts?.find(item => item.name === 'cosmos-assistant' && item.resourceGroup === 'rg-data-capstone')
  const redis = context.sandbox?.redisClusters?.find(item => item.name === 'redis-assistant' && item.resourceGroup === 'rg-data-capstone')
  return { pg, database: pg?.databases?.find(item => item.name === 'knowledge'), cosmos,
    containers: cosmos?.databases?.find(item => item.name === 'knowledge')?.containers ?? [], redis }
}
function fieldValue(context, field) {
  const { pg, database, cosmos, containers, redis } = capstoneServices(context)
  const match = /^(api|worker):(artifact|config|function:[a-z_]+)$/.exec(field)
  if (match) {
    const artifact = capstoneArtifact(context, match[1])
    if (match[2] === 'artifact') return artifact ? { id: artifact.id, sourceHash: artifact.sourceHash } : null
    if (match[2] === 'config') return { deployed: artifact ? sourceTextHash(canonicalize(artifact.appSpec.data.composite.globals)) : null,
      current: context.project ? capstoneConfigCurrent(context, match[1]) : false }
    const name = match[2].slice(9)
    return { deployed: artifact?.appSpec?.data?.functions?.[name] ? sourceTextHash(canonicalize(artifact.appSpec.data.functions[name])) : null,
      current: context.project ? capstoneFunctionsCurrent(context, match[1], [name]) : false }
  }
  if (field === 'pg:resource') return pg ? { tier: pg.tier, skuName: pg.skuName, storageSizeGb: pg.storageSizeGb, parameters: pg.parameters } : null
  if (field === 'pg:schema') return database ? { extensions: database.extensions, tables: database.tables.map(table => ({ name: table.name, columns: table.columns })) } : null
  if (field === 'pg:rows') return database ? sourceTextHash(canonicalize(database.tables.map(table => ({ name: table.name, rows: table.rows })))) : null
  if (field === 'pg:indexes') return database?.indexes.map(({ sizeMb, buildSeconds, ...definition }) => definition) ?? null
  if (field === 'cosmos:policies') return cosmos ? { consistency: cosmos.defaultConsistencyLevel, capabilities: cosmos.capabilities,
    containers: containers.map(({ name, partitionKeyPath, throughput, vectorEmbeddingPolicy, indexingPolicy }) => ({ name, partitionKeyPath, throughput, vectorEmbeddingPolicy, indexingPolicy })) } : null
  if (field === 'cosmos:lease') return containers.find(item => item.name === 'leases')?.items.map(item => ({ id: item.id, continuation: item.continuation })) ?? null
  if (field === 'cosmos:events') return containers.find(item => item.name === 'events')?.changeLog ?? null
  if (field === 'redis:resource') return redis ? { sku: redis.sku, location: redis.location, port: redis.database.port,
    modules: redis.database.modules, clusteringPolicy: redis.database.clusteringPolicy, evictionPolicy: redis.database.evictionPolicy,
    memoryLimitBytes: redis.database.memoryLimitBytes } : null
  if (field === 'redis:index') { const index = redis?.database.indexes['idx:semantic']; if (!index) return null; const { createdAtMs, ...definition } = index; return definition }
  if (field === 'incident:identity') return context.runtime?.dataCapstone?.incident?.starts ?? []
  if (field === 'ownership:inventory') return context.stages ? dataCleanupInventory(context, { dataRequestTarget: DATA_CAPSTONE_API_TARGET, dataWorkerTarget: DATA_CAPSTONE_WORKER_TARGET }) : null
  throw new Error(`Unknown Data capstone dependency '${field}'.`)
}
export function dataCapstoneDependencies(fields) {
  if (!Array.isArray(fields) || fields.some(field => typeof field !== 'string')) throw new Error('Data capstone fields must be a string array.')
  const sorted = [...new Set(fields)].sort()
  for (const field of sorted) fieldValue({ sandbox: {}, runtime: {}, artifacts: {} }, field)
  return Object.fromEntries(sorted.map(field => [`data-capstone:${field}`, context => fieldValue(context, field)]))
}
