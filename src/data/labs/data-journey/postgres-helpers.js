import { SUBSCRIPTION_ID } from '../../../lib/sandbox/model.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { parsePythonProject } from '../../../lib/project/python.js'
import { POSTGRES_MANIFEST } from '../../templates/data-python/postgres.js'

export const PG_GROUP = 'rg-assistant'
export const PG_SERVER = 'pg-assistant'
export const PG_DATABASE = 'knowledge'
export const PG_CLUSTER = 'aks-assistant'
export const PG_REGISTRY = 'acrassistant'
export const PG_NAMESPACE = 'assistant'
export const PG_CLUSTER_ID = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${PG_GROUP}/providers/Microsoft.ContainerService/managedClusters/${PG_CLUSTER}`
export const PG_DATA_TARGET = Object.freeze({ kind: 'postgres', resourceGroup: PG_GROUP, server: PG_SERVER, database: PG_DATABASE, port: 5432 })
export const PG_TARGET = Object.freeze({ ...PG_DATA_TARGET, clusterId: PG_CLUSTER_ID, namespace: PG_NAMESPACE })
export const PG_REQUEST_TARGET = Object.freeze({ clusterId: PG_CLUSTER_ID, namespace: PG_NAMESPACE, serviceName: 'assistant-api', deploymentName: 'assistant-api' })
export const PG_ESTIMATE_LABEL = 'Simulated estimate — not an Azure guarantee.'

// Use the same running Pod snapshot as data-actions, never a saved source file
// or a mutable published tag that could have changed since the Pod started.
export function pgDeployedArtifact(context, target, deploymentName = 'assistant-api') {
  const { clusterId, namespace } = target
  if (!context.runtime?.kubernetes?.clusters?.[clusterId]) return null
  const pod = getDeploymentPods(context, clusterId, namespace, deploymentName)
    .filter(pod => pod.status?.phase === 'Running' && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'))
    .sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid))[0]
  const snapshot = pod && context.runtime.kubernetes?.clusters?.[clusterId]?.podSnapshots?.[pod.metadata.uid]
  return snapshot ? context.artifacts.buildsById?.[snapshot.artifactId] ?? null : null
}
export function pgDsnPort(appSpec) {
  const dsn = appSpec?.data?.postgres?.globals?.DSN
  if (dsn?.kind !== 'literal' || typeof dsn.value !== 'string') return null
  // Canonical template uses a libpq field string. Reject duplicate port fields.
  const ports = [...dsn.value.matchAll(/(?:^|\s)port\s*=\s*(?:'(\d+)'|(\d+))(?=\s|$)/g)]
  return ports.length === 1 ? Number(ports[0][1] ?? ports[0][2]) : null
}
const identifier = value => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)
function fieldValue(context, target, field) {
  const resources = context.runtime.kubernetes?.clusters?.[target.clusterId]?.resources ?? {}
  const server = context.sandbox.postgresServers?.find(item => item.name === target.server && item.resourceGroup === target.resourceGroup)
  const database = server?.databases?.find(item => item.name === target.database)
  let match
  if ((match = /^(images|dsnPort|replicas):([^:]+)$/.exec(field)) && identifier(match[2])) {
    const [, kind, deployment] = match
    if (kind === 'replicas') return resources[`Deployment/${target.namespace}/${deployment}`]?.spec?.replicas ?? null
    const artifact = pgDeployedArtifact(context, target, deployment)
    return kind === 'images' ? artifact?.sourceHash ?? null : pgDsnPort(artifact?.appSpec)
  }
  if ((match = /^code:([^:]+):([^:]+)$/.exec(field)) && identifier(match[1]) && identifier(match[2])) return pgDeployedArtifact(context, target, match[1])?.appSpec?.data?.functions?.[match[2]] ?? null
  if ((match = /^pg:table:([^:]+)$/.exec(field)) && identifier(match[1])) return database?.tables?.find(item => item.name === match[1])?.columns ?? null
  if ((match = /^pg:index:([^:]+)$/.exec(field)) && identifier(match[1])) {
    // Definitions only: estimates/build timings do not change an index's role.
    return (database?.indexes ?? []).filter(item => item.table === match[1]).map(({ sizeMb, buildSeconds, ...definition }) => definition).sort((a, b) => a.name.localeCompare(b.name))
  }
  if ((match = /^pg:param:([A-Za-z_][A-Za-z0-9_.]*)$/.exec(field))) return server?.parameters?.[match[1]] ?? null
  if (field === 'pg:sku') return server ? { tier: server.tier, skuName: server.skuName, vCores: server.vCores, memoryGiB: server.memoryGiB } : null
  throw new Error(`Unknown PostgreSQL dependency field '${field}'.`)
}
export function pgDependencies(target, fields) {
  if (!Array.isArray(fields) || fields.some(field => typeof field !== 'string')) throw new Error('PostgreSQL dependency fields must be a string array.')
  const sorted = [...new Set(fields)].sort()
  // Validate names immediately as well as during evaluation.
  for (const field of sorted) fieldValue({ runtime: {}, sandbox: {}, artifacts: {} }, target ?? {}, field)
  const key = `pg:${target?.clusterId}:${target?.namespace}:${target?.resourceGroup}:${target?.server}:${target?.database}:${sorted.join(',')}`
  return { [key]: context => ({ version: 1, ...Object.fromEntries(sorted.map(field => [field, fieldValue(context, target, field)])) }) }
}

export function pgRequestScenario(steps) {
  return Object.freeze({ kind: 'data-request', version: 1, target: PG_REQUEST_TARGET, steps: Object.freeze(steps.map(step => Object.freeze({ route: step.route, args: Object.freeze([...step.args]) }))) })
}
export function pgLoadScenario({ route = 'GET /retrieve', args, requestsPerSecond = 500, seconds = 30 }) {
  return Object.freeze({ kind: 'data-load', version: 1, target: PG_REQUEST_TARGET, route, args: Object.freeze([...args]), replicas: 'deployment', requestsPerSecond, seconds })
}
export function pgDeployedFunctionsCurrent(context, names, target = PG_TARGET, deployment = 'assistant-api') {
  const captured = pgDeployedArtifact(context, target, deployment)?.appSpec
  const parsed = parsePythonProject(context.project.savedFiles, POSTGRES_MANIFEST)
  return !!captured && !parsed.diagnostics.length && names.every(name => JSON.stringify(captured.data?.functions?.[name] ?? null) === JSON.stringify(parsed.appSpec?.data?.functions?.[name] ?? null))
}
// Historical exact/naive evidence deliberately omits repaired index/pool fields.
// Labs choose fields from what their check reads, and refresh shared-function
// verifications after later edits before moving down the guided task list.
export function pgTask({ fields, dependencies, verification, ...task }) {
  return { ...task, verification, dependencies: dependencies ?? pgDependencies(PG_TARGET, fields ?? []) }
}
