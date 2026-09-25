import { kubeObjectKey } from './objects.js'
import { getServiceBackends } from './services.js'
import { simulateAssistant } from './assistant.js'
import { KNOWLEDGE_FIXTURES } from '../../data/fixtures/aks/knowledge.js'

const clone = value => structuredClone(value)
const resultDns = (ok, reason, service = null, canonicalName = null) => ({ ok, serviceKey: service ? kubeObjectKey('Service', service.metadata.namespace, service.metadata.name) : null,
  address: service?.spec?.clusterIP ?? null, canonicalName, reason })
const ready = pod => pod?.status?.phase === 'Running' && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')

function dnsName(hostname) {
  if (typeof hostname !== 'string' || hostname.includes(':') || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null
  const value = hostname.toLowerCase().replace(/\.$/, '')
  const parts = value.split('.')
  if (parts.length === 1 && /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(parts[0])) return { service: parts[0], namespace: null }
  if (parts.length === 2 && parts.every(part => /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(part))) return { service: parts[0], namespace: parts[1] }
  if ((parts.length === 3 && parts[2] === 'svc') || (parts.length === 5 && parts[2] === 'svc' && parts[3] === 'cluster' && parts[4] === 'local')) {
    if (parts.slice(0, 2).every(part => /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(part))) return { service: parts[0], namespace: parts[1] }
  }
  return null
}

export function resolveServiceDns(run, { clusterId, clientNamespace, hostname }) {
  const parsed = dnsName(hostname)
  if (!parsed) return resultDns(false, 'DNS_NOT_FOUND')
  const namespace = parsed.namespace ?? clientNamespace
  const service = run.runtime?.kubernetes?.clusters?.[clusterId]?.resources?.[kubeObjectKey('Service', namespace, parsed.service)]
  if (!service) return resultDns(false, 'DNS_NOT_FOUND')
  return resultDns(true, null, service, `${service.metadata.name}.${service.metadata.namespace}.svc.cluster.local`)
}

function lookupService(run, probe) {
  const cluster = run.runtime?.kubernetes?.clusters?.[probe.origin.clusterId]
  if (!cluster) return { service: null, reason: 'DNS_NOT_FOUND' }
  const byAddress = Object.values(cluster.resources).find(item => item.kind === 'Service' && item.spec.clusterIP === probe.hostname)
  if (probe.origin.kind === 'external') {
    const service = Object.values(cluster.resources).find(item => item.kind === 'Service' && item.status?.loadBalancer?.ingress?.[0]?.ip === probe.hostname)
    return service ? { service, reason: null } : { service: null, reason: byAddress ? 'INTERNAL_ADDRESS' : 'UNKNOWN_ADDRESS' }
  }
  if (byAddress) return { service: byAddress, reason: null }
  const resolved = resolveServiceDns(run, { clusterId: probe.origin.clusterId, clientNamespace: 'diagnostics', hostname: probe.hostname })
  return resolved.ok ? { service: cluster.resources[resolved.serviceKey], reason: null } : { service: null, reason: resolved.reason }
}

function appResponse(run, cluster, pod, probe) {
  const snapshot = cluster.podSnapshots[pod.metadata.uid]
  const artifact = snapshot && run.artifacts.buildsById[snapshot.artifactId]
  const app = artifact?.appSpec
  const route = app?.routes?.find(item => item.method === probe.method && item.path === probe.path)
  if (!snapshot || !artifact || !route) return { status: 404, body: { error: 'Not found.' }, dependencyTrace: [], diagnostic: { code: 'ROUTE_NOT_FOUND', message: 'The captured application route does not exist.' } }
  if (probe.path === '/api/ask') return simulateAssistant(app, snapshot, probe, KNOWLEDGE_FIXTURES)
  const body = Object.fromEntries(Object.entries(route.response ?? {}).map(([key, expression]) => [key,
    expression.kind === 'config' ? (snapshot.environment?.[expression.key] ?? expression.defaultValue) : expression.value]))
  return { status: 200, body, dependencyTrace: [], diagnostic: null }
}

export function routeServiceRequest(input, probe, lab) {
  const run = clone(input), sequence = run.nextSequence
  const id = `aks-request-${sequence}`, runtime = run.runtime.kubernetes
  const outcome = { requestId: id, transport: { ok: false, reason: null }, status: null, body: null, route: {}, dependencyTrace: [], diagnostic: null }
  let clientNamespace = 'diagnostics'
  if (probe.origin?.kind === 'pod' && Object.keys(probe.origin).sort().join(',') === 'clusterId,kind,podUid') {
    const state = runtime.clusters?.[probe.origin.clusterId]
    const pod = Object.values(state?.resources ?? {}).find(item => item.kind === 'Pod' && item.metadata.uid === probe.origin.podUid)
    const fixture = pod?.metadata?.name === 'diagnostics' && pod.metadata.namespace === 'diagnostics'
      && pod.spec?.containers?.length === 1 && pod.spec.containers[0].image === 'mcr.microsoft.com/aks-trainer/diagnostics:1'
      && ready(pod) && state.connectivity?.diagnosticPodUids.includes(pod.metadata.uid)
    if (!fixture) outcome.transport.reason = 'INVALID_ORIGIN'
    else clientNamespace = pod.metadata.namespace
  } else if (probe.origin?.kind !== 'external' || Object.keys(probe.origin).sort().join(',') !== 'clusterId,kind') outcome.transport.reason = 'INVALID_ORIGIN'
  const cluster = runtime.clusters?.[probe.origin?.clusterId]
  if (!outcome.transport.reason && !cluster) outcome.transport.reason = 'DNS_NOT_FOUND'
  const scheme = typeof probe.hostname === 'string' && probe.hostname.match(/^(https?):\/\//i)
  if (!outcome.transport.reason && scheme) {
    if (scheme[1].toLowerCase() === 'https') outcome.transport.reason = 'TLS_UNSUPPORTED'
    else outcome.transport.reason = 'INVALID_URL'
  }
  let service
  if (!outcome.transport.reason) {
    const found = lookupService(run, { ...probe, origin: probe.origin })
    service = found.service
    if (!service) outcome.transport.reason = found.reason
  }
  if (!outcome.transport.reason && probe.origin.kind === 'pod' && !dnsName(probe.hostname) && !/^10\.96\./.test(probe.hostname)) outcome.transport.reason = 'DNS_NOT_FOUND'
  const state = cluster
  let backends
  if (!outcome.transport.reason) {
    const port = service.spec.ports?.[0]
    if (!port || Number(probe.port) !== port.port) outcome.transport.reason = 'SERVICE_PORT'
    else {
      backends = getServiceBackends(run, { clusterId: probe.origin.clusterId, namespace: service.metadata.namespace, serviceName: service.metadata.name })
      const selectedCount = backends.selectedPods.length
      const withUnresolvedPort = selectedCount > backends.endpoints.length
      outcome.route = { serviceUid: service.metadata.uid, clusterIP: service.spec.clusterIP, externalIP: service.status?.loadBalancer?.ingress?.[0]?.ip ?? null,
        selectedCount, endpointUids: backends.endpoints.map(item => item.podUid), readyEndpointUids: backends.readyEndpoints.map(item => item.podUid) }
      if (withUnresolvedPort && !backends.readyEndpoints.length) outcome.transport.reason = 'NAMED_PORT_UNRESOLVED'
      else if (!backends.readyEndpoints.length) outcome.transport.reason = 'NO_READY_ENDPOINTS'
      else {
        const selected = [...backends.readyEndpoints].sort((a, b) => a.podUid.localeCompare(b.podUid))[0]
        const pod = backends.selectedPods.find(item => item.metadata.uid === selected.podUid)
        outcome.route = { ...outcome.route, podUid: pod.metadata.uid, podName: pod.metadata.name, namespace: pod.metadata.namespace, address: selected.address, backendPort: selected.port,
          artifactId: state.podSnapshots[pod.metadata.uid]?.artifactId ?? null }
        const artifact = run.artifacts.buildsById[state.podSnapshots[pod.metadata.uid]?.artifactId]
        if (artifact?.appSpec?.listeningPort !== selected.port) outcome.transport.reason = 'CONNECTION_REFUSED'
        else {
          outcome.transport = { ok: true, reason: null }
          const response = appResponse(run, state, pod, probe)
          outcome.status = response.status; outcome.body = response.body; outcome.dependencyTrace = response.dependencyTrace ?? []; outcome.diagnostic = response.diagnostic ?? null
          if (outcome.diagnostic?.code === 'POSTGRES_CONNECTION') outcome.dependencyTrace = [...outcome.dependencyTrace, { operation: 'postgres-query', status: 'failed', reason: 'DNS_NOT_FOUND' }]
          const safeSummary = outcome.dependencyTrace.map(item => ({ operation: item.operation, status: item.status, ...(item.reason ? { reason: item.reason } : {}) }))
          const log = { requestId: id, sequence, podUid: pod.metadata.uid, podName: pod.metadata.name, namespace: pod.metadata.namespace,
            image: pod.spec.containers[0].image, method: probe.method, path: probe.path, status: outcome.status,
            artifactId: outcome.route.artifactId, dependencySummary: safeSummary }
          const connectivity = state.connectivity
          connectivity.applicationLogs = [...connectivity.applicationLogs, log].slice(-200)
        }
      }
    }
  }
  if (!outcome.transport.ok && !outcome.transport.reason) outcome.transport.reason = 'NO_READY_ENDPOINTS'
  const requests = [...runtime.requests, { id, sequence, connectivity: true, scenarioId: null, transport: outcome.transport, status: outcome.status,
    route: outcome.route, namespace: outcome.route.namespace ?? clientNamespace, dependencyTrace: outcome.dependencyTrace, origin: probe.origin,
    hostname: probe.hostname, port: probe.port, request: { method: probe.method, path: probe.path, ...(probe.body === null ? {} : { body: probe.body }) } }].slice(-100)
  run.nextSequence = sequence + 1
  run.runtime.kubernetes = { ...runtime, requests }
  return { run, outcome }
}
