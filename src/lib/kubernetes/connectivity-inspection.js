import { getServiceBackends } from './services.js'

const copy = value => JSON.parse(JSON.stringify(value))
const REDACTED = '[REDACTED]'
const stage = (name, status, detail = '') => ({ name, status, detail })

function secretValues(state) {
  const values = new Set()
  for (const [uid, snapshot] of Object.entries(state?.podSnapshots ?? {})) {
    for (const ref of snapshot.configRefs ?? []) {
      if (ref.kind !== 'Secret') continue
      const value = ref.mode === 'file' ? snapshot.files?.[ref.target] : snapshot.environment?.[ref.target]
      if (typeof value === 'string' && value) values.add(value)
    }
  }
  for (const resource of Object.values(state?.resources ?? {})) {
    if (resource.kind !== 'Secret') continue
    for (const encoded of Object.values(resource.data ?? {})) {
      if (typeof encoded !== 'string') continue
      values.add(encoded)
      try { const decoded = atob(encoded); if (decoded) values.add(decoded) } catch { /* invalid fixture data is not a secret value */ }
    }
  }
  return [...values].sort((a, b) => b.length - a.length)
}

function redact(value, secrets) {
  if (typeof value === 'string') return secrets.reduce((text, secret) => text.split(secret).join(REDACTED), value)
  if (Array.isArray(value)) return value.map(item => redact(item, secrets))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]))
  return value
}

function traceFor(run, clusterId, request) {
  const state = run.runtime.kubernetes.clusters[clusterId]
  const route = request.route ?? {}
  const service = Object.values(state.resources ?? {}).find(item => item.kind === 'Service' && item.metadata.uid === route.serviceUid)
  const pod = Object.values(state.resources ?? {}).find(item => item.kind === 'Pod' && item.metadata.uid === route.podUid)
  const originPod = request.origin?.podUid && Object.values(state.resources ?? {}).find(item => item.kind === 'Pod' && item.metadata.uid === request.origin.podUid)
  const deps = request.dependencyTrace ?? []
  const op = name => deps.find(item => item.operation === name)
  const failedTransport = !request.transport?.ok
  const dnsReached = !!service || (!!request.hostname && !['DNS_NOT_FOUND', 'UNKNOWN_ADDRESS', 'INTERNAL_ADDRESS'].includes(request.transport?.reason))
  const appReached = request.status !== null && request.status !== undefined
  const dependencyStatus = item => item ? (item.status === 'succeeded' ? 'Reached' : 'Failed') : 'Not reached'
  const dependencyDetail = item => item ? [item.reason, item.selectedSourceIds?.join(', ')].filter(Boolean).join(' · ') : ''
  const reason = request.transport?.reason
  return [
    stage('Origin', originPod || request.origin?.kind === 'external' ? 'Reached' : 'Not reached', originPod ? `${originPod.metadata.namespace}/${originPod.metadata.name}` : request.origin?.kind === 'external' ? 'External client' : reason ?? 'Origin unavailable'),
    stage('DNS/address', service || dnsReached ? 'Reached' : failedTransport ? 'Failed' : 'Not reached', service
      ? `${request.hostname ?? ''} · ${service.spec.clusterIP}${service.status?.loadBalancer?.ingress?.[0]?.ip ? ` · ${service.status.loadBalancer.ingress[0].ip}` : ''}`
      : [request.hostname, reason].filter(Boolean).join(' · ') || 'Not reached'),
    stage('Service', route.serviceUid ? 'Reached' : failedTransport ? 'Failed' : 'Not reached', service
      ? `${service.metadata.namespace}/${service.metadata.name} · service port ${request.port} → targetPort ${route.targetPort ?? route.backendPort ?? service.spec.ports?.[0]?.targetPort ?? service.spec.ports?.[0]?.port}`
      : [route.serviceName, reason].filter(Boolean).join(' · ') || 'Not reached'),
    stage('Pod/listener', pod || route.podUid ? reason === 'CONNECTION_REFUSED' ? 'Failed' : 'Reached' : failedTransport ? 'Failed' : 'Not reached', pod
      ? `${pod.metadata.namespace}/${pod.metadata.name} · backend port ${route.backendPort ?? 'unknown'}${reason ? ` · ${reason}` : ''}`
      : [route.podName, reason].filter(Boolean).join(' · ') || 'Not reached'),
    stage('Application', appReached ? 'Reached' : 'Not reached', appReached ? `HTTP ${request.status}` : reason ?? 'Not reached'),
    stage('Embedding', dependencyStatus(op('embedding')), dependencyDetail(op('embedding'))),
    stage('PostgreSQL', dependencyStatus(op('postgres-query')), dependencyDetail(op('postgres-query'))),
    stage('Answer', dependencyStatus(op('answer')), dependencyDetail(op('answer'))),
  ]
}

/** Read-only Service, endpoint and correlated request projection. */
export function inspectConnectivity(run, target) {
  const clusterId = target?.clusterId
  const state = run?.runtime?.kubernetes?.clusters?.[clusterId]
  const service = state?.resources?.[`Service/${target?.namespace}/${target?.serviceName}`] ?? null
  if (!state || !service) return { service: null, requestedPort: null, backends: [], requests: [], logs: [] }
  const backendSet = getServiceBackends(run, { clusterId, namespace: target.namespace, serviceName: target.serviceName })
  const endpointByUid = new Map(backendSet.endpoints.map(endpoint => [endpoint.podUid, endpoint]))
  const backends = backendSet.selectedPods.map(pod => {
    const endpoint = endpointByUid.get(pod.metadata.uid)
    const snapshot = state.podSnapshots?.[pod.metadata.uid]
    const artifact = snapshot && run.artifacts?.buildsById?.[snapshot.artifactId]
    return { podUid: pod.metadata.uid, name: pod.metadata.name, namespace: pod.metadata.namespace,
      address: pod.status?.podIP ?? null, ready: backendSet.readyEndpoints.some(item => item.podUid === pod.metadata.uid),
      endpoint: !!endpoint, endpointPort: endpoint?.port ?? null, listenerPort: artifact?.appSpec?.listeningPort ?? null,
      image: pod.spec?.containers?.[0]?.image ?? '' }
  }).sort((a, b) => a.name.localeCompare(b.name))
  const requests = (run.runtime.kubernetes.requests ?? []).filter(item => item.connectivity === true && item.origin?.clusterId === clusterId
    && (item.route?.serviceUid === service.metadata.uid || item.route?.serviceName === service.metadata.name && item.route?.namespace === service.metadata.namespace))
    .slice(-100).reverse().map(item => ({ id: item.id, requestId: item.id, sequence: item.sequence, method: item.request?.method,
      path: item.request?.path, hostname: item.hostname, port: item.port, status: item.status, scenarioId: item.scenarioId ?? null, transport: copy(item.transport ?? { ok: false, reason: null }),
      route: copy(item.route ?? {}), dependencyTrace: copy(item.dependencyTrace ?? []), trace: traceFor(run, clusterId, item),
      logsCommand: item.route?.podName ? `kubectl logs ${item.route.podName} -n ${item.route.namespace}` : null }))
  const requestIds = new Set(requests.map(item => item.id))
  const secrets = secretValues(state)
  const logs = (state.connectivity?.applicationLogs ?? []).filter(item => requestIds.has(item.requestId)).slice(-200).reverse().map(item => ({
    ...copy(item), command: `kubectl logs ${item.podName} -n ${item.namespace}`,
  }))
  const cleanRequests = redact(requests, secrets)
  const cleanLogs = redact(logs, secrets)
  const serviceView = { ...copy(service), type: service.spec.type ?? 'ClusterIP', address: service.spec.clusterIP ?? null,
    externalAddress: service.status?.loadBalancer?.ingress?.[0]?.ip ?? null, port: service.spec.ports?.[0]?.port ?? null,
    targetPort: service.spec.ports?.[0]?.targetPort ?? null, selector: copy(service.spec.selector ?? {}) }
  return { service: redact(serviceView, secrets), requestedPort: cleanRequests[0]?.port ?? null,
    backends: redact(backends, secrets), requests: cleanRequests, logs: cleanLogs }
}
