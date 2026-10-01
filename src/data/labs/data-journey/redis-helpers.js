import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { getProjectManifest } from '../../../lib/project/manifests.js'
import { REDIS_TARGET } from '../../fixtures/data/redis.js'

export { REDIS_TARGET }
export const REDIS_GROUP = 'rg-assistant'
export const REDIS_CLUSTER_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-assistant/providers/Microsoft.ContainerService/managedClusters/aks-assistant`
export const REDIS_REQUEST_TARGET = Object.freeze({ clusterId: REDIS_CLUSTER_ID, namespace: 'assistant', serviceName: 'assistant-api', deploymentName: 'assistant-api' })
export const REDIS_DEPENDENCY_TARGET = Object.freeze({ ...REDIS_TARGET, ...REDIS_REQUEST_TARGET })
export const REDIS_ESTIMATE_LABEL = 'Simulated estimate — not an Azure guarantee.'
export const REDIS_CREATE_COMMAND = 'az redisenterprise create -g rg-assistant -n redis-assistant -l eastus --sku Balanced_B0 --clustering-policy EnterpriseCluster --eviction-policy NoEviction --client-protocol Encrypted --access-keys-auth Enabled --modules name=RediSearch'
export const REDIS_INDEX_COMMAND = 'FT.CREATE idx:semantic ON HASH PREFIX 1 ka:sem: SCHEMA product TAG version TAG language TAG embedding VECTOR HNSW 6 TYPE FLOAT32 DIM 8 DISTANCE_METRIC COSINE'
export const redisCliCommand = command => `redis-cli -h redis-assistant.eastus.redis.training.invalid -p 10000 --tls -a Training-Only-Redis-Key ${command}`

// Immutable Pod snapshot selected by the actual Service, never a saved draft/tag.
export function redisDeployedArtifact(context, target = REDIS_REQUEST_TARGET) {
  const cluster = context.runtime?.kubernetes?.clusters?.[target.clusterId]
  const service = cluster?.resources?.[`Service/${target.namespace}/${target.serviceName ?? 'assistant-api'}`]
  if (!service || !Object.keys(service.spec?.selector ?? {}).length) return null
  const pod = getDeploymentPods(context, target.clusterId, target.namespace, target.deploymentName ?? 'assistant-api')
    .filter(pod => pod.status?.phase === 'Running' && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'))
    .filter(pod => Object.entries(service.spec.selector).every(([key, value]) => pod.metadata.labels?.[key] === value))
    .sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid))[0]
  const snapshot = pod && cluster.podSnapshots?.[pod.metadata.uid]
  return snapshot ? context.artifacts?.buildsById?.[snapshot.artifactId] ?? null : null
}
export function redisDeployedFunctionsCurrent(context, names, target = REDIS_REQUEST_TARGET) {
  const captured = redisDeployedArtifact(context, target)?.appSpec
  const manifest = getProjectManifest(context.project?.manifestId)
  if (manifest.dataBackend !== 'redis') return false
  const parsed = parsePythonProject(context.project.savedFiles, manifest)
  return !!captured?.data?.redis && !parsed.diagnostics.length && names.every(name => captured.data.functions?.[name]
    && JSON.stringify(captured.data.functions[name]) === JSON.stringify(parsed.appSpec?.data?.functions?.[name]))
}
function fieldValue(context, target, field) {
  const cluster = context.sandbox?.redisClusters?.find(item => item.resourceGroup === target.resourceGroup && item.name === target.cluster)
  const database = cluster?.database
  if (field === 'images:assistant-api') return redisDeployedArtifact(context, target)?.sourceHash ?? null
  if (/^code:assistant-api:[a-z_]+$/.test(field)) {
    const name = field.split(':')[2]
    const deployed = redisDeployedArtifact(context, target)?.appSpec?.data?.functions?.[name] ?? null
    return { deployed, current: context.project ? redisDeployedFunctionsCurrent(context, [name], target) : false }
  }
  if (field === 'redis:resource') return cluster ? { hostName: cluster.hostName, sku: cluster.sku, location: cluster.location,
    port: database.port, modules: database.modules, clusteringPolicy: database.clusteringPolicy, evictionPolicy: database.evictionPolicy,
    clientProtocol: database.clientProtocol, accessKeysAuthentication: database.accessKeysAuthentication, memoryLimitBytes: database.memoryLimitBytes } : null
  if (field === 'redis:index:idx:semantic') {
    const index = database?.indexes?.['idx:semantic']
    if (!index) return null
    const { createdAtMs, ...definition } = index
    return definition
  }
  if (/^redis:source:[a-z0-9-]+$/.test(field)) return database?.sourceRevisions?.[field.slice('redis:source:'.length)] ?? 1
  throw new Error(`Unknown Redis dependency field '${field}'.`)
}
export function redisDependencies(target, fields) {
  if (!Array.isArray(fields) || fields.some(field => typeof field !== 'string')) throw new Error('Redis dependency fields must be a string array.')
  const resolved = { ...REDIS_DEPENDENCY_TARGET, ...target }
  const sorted = [...new Set(fields)].sort()
  for (const field of sorted) fieldValue({}, resolved, field)
  return { [`redis:${resolved.clusterId}:${resolved.namespace}:${resolved.resourceGroup}:${resolved.cluster}:${sorted.join(',')}`]: context => ({ version: 1,
    ...Object.fromEntries(sorted.map(field => [field, fieldValue(context, resolved, field)])) }) }
}
// Trusted authoring adapter: primitive fixture named args become ordered route args.
// The UI passes only scenarioId and never calls this with learner-supplied steps.
export function redisScenario(steps, target = REDIS_REQUEST_TARGET) {
  return Object.freeze({ kind: 'data-cache', version: 1, target: Object.freeze({ ...target }), steps: Object.freeze(steps.map(step => {
    if (step.action !== 'request') return Object.freeze({ ...step })
    const names = step.route === 'POST /invalidate' ? ['product'] : ['question', 'product', 'version', 'language', ...(step.route === 'GET /cached' ? ['ttl'] : [])]
    return Object.freeze({ action: 'request', route: step.route, args: Object.freeze(Array.isArray(step.args) ? [...step.args] : names.map(name => step.args[name])) })
  })) })
}
