import { kubeObjectKey } from './objects.js'

const clone = value => structuredClone(value)
const project = value => JSON.parse(JSON.stringify(value))
const serviceAddress = value => `10.96.${Math.floor(value / 254)}.${(value % 254) + 1}`
const podAddress = value => `10.244.${Math.floor(value / 254)}.${(value % 254) + 1}`
const externalAddress = value => `192.0.2.${value}`

export function serviceAllocationDiagnostic(run, clusterId, service, existing = null) {
  const connectivity = run.runtime?.kubernetes?.clusters?.[clusterId]?.connectivity
  if (!connectivity || existing) return null
  if (connectivity.nextServiceAddress > 4063) return { code: 'SIMULATOR_LIMIT', message: 'The simulated Service address range is exhausted.' }
  if (service.spec.type === 'LoadBalancer' && connectivity.nextExternalAddress > 254) return { code: 'SIMULATOR_LIMIT', message: 'The simulated external address range is exhausted.' }
  return null
}

export function initializeConnectivity(input, clusterId) {
  const run = clone(input)
  const state = run.runtime?.kubernetes?.clusters?.[clusterId]
  if (state && !state.connectivity) state.connectivity = {
    version: 1, nextServiceAddress: 1, nextPodAddress: 1, nextExternalAddress: 10,
    diagnosticPodUids: [], applicationLogs: [], incident: run.labId === 'aks-connectivity-troubleshooting'
      ? { id: 'network-hops-v1', phase: 'selector', sequence: 1,
        observations: { selector: null, port: null, dependency: null }, recoveries: { selector: null, port: null, dependency: null } }
      : null,
  }
  return run
}

function ready(pod) { return pod.status?.phase === 'Running' && pod.status?.conditions?.some(item => item.type === 'Ready' && item.status === 'True') }
function selectedPods(state, service) {
  return Object.values(state.resources).filter(pod => pod.kind === 'Pod' && pod.metadata.namespace === service.metadata.namespace
    && Object.entries(service.spec.selector ?? {}).every(([key, value]) => pod.metadata.labels?.[key] === value))
}
function portFor(pod, target) {
  if (typeof target === 'number') return target
  return pod.spec.containers?.[0]?.ports?.find(port => port.name === target)?.containerPort ?? null
}

export function getServiceBackends(run, target) {
  const state = run.runtime?.kubernetes?.clusters?.[target.clusterId]
  const service = state?.resources?.[kubeObjectKey('Service', target.namespace, target.serviceName)] ?? null
  if (!service) return { service: null, selectedPods: [], endpoints: [], readyEndpoints: [], diagnostics: [{ code: 'SERVICE_NOT_FOUND', message: 'The requested Service was not found.' }] }
  const selected = selectedPods(state, service)
  const port = service.spec.ports[0].targetPort ?? service.spec.ports[0].port
  const endpoints = selected.flatMap(pod => {
    const resolved = portFor(pod, port)
    const address = pod.status?.podIP
    return resolved === null || !address ? [] : [{ podUid: pod.metadata.uid, podName: pod.metadata.name, namespace: pod.metadata.namespace, address, port: resolved, ready: ready(pod) }]
  }).sort((a, b) => a.podUid.localeCompare(b.podUid))
  return { service: project(service), selectedPods: project(selected), endpoints, readyEndpoints: endpoints.filter(endpoint => endpoint.ready), diagnostics: [] }
}

function allocate(state, field, limit, render) {
  const value = state.connectivity[field]
  if (!Number.isInteger(value) || value > limit) return null
  state.connectivity[field] = value + 1
  return render(value)
}

function syncSlices(state, service, view) {
  const resources = state.resources
  const previous = Object.entries(resources).filter(([, item]) => item.kind === 'EndpointSlice' && item.metadata.ownerReferences?.[0]?.uid === service.metadata.uid)
  const groups = new Map()
  for (const endpoint of view.endpoints) {
    const group = groups.get(endpoint.port) ?? []
    group.push(endpoint); groups.set(endpoint.port, group)
  }
  if (!groups.size) groups.set(null, [])
  const wanted = new Set()
  for (const [port, endpoints] of groups) {
    const suffix = port === null ? 'empty' : String(port)
    const name = `${service.metadata.name}-${service.metadata.uid.replace(/[^a-z0-9]/g, '').slice(-12)}-${suffix}`.slice(0, 63)
    const key = kubeObjectKey('EndpointSlice', service.metadata.namespace, name); wanted.add(key)
    const projection = { addressType: 'IPv4', ports: port === null ? [] : [{ protocol: 'TCP', port }], endpoints: endpoints.map(endpoint => ({ addresses: [endpoint.address], conditions: { ready: endpoint.ready }, targetRef: { kind: 'Pod', namespace: endpoint.namespace, name: endpoint.podName, uid: endpoint.podUid } })) }
    const old = resources[key]
    const base = { apiVersion: 'discovery.k8s.io/v1', kind: 'EndpointSlice', metadata: { name, namespace: service.metadata.namespace, labels: { 'kubernetes.io/service-name': service.metadata.name }, ownerReferences: [{ apiVersion: 'v1', kind: 'Service', name: service.metadata.name, uid: service.metadata.uid }] }, ...projection }
    const same = old && JSON.stringify({ ...old, metadata: { ...old.metadata, resourceVersion: undefined, uid: undefined } }) === JSON.stringify(base)
    if (!same) resources[key] = { ...base, metadata: { ...base.metadata, uid: old?.metadata.uid ?? `slice-${service.metadata.uid}-${suffix}`, resourceVersion: String(Number(old?.metadata.resourceVersion ?? '0') + 1) } }
  }
  for (const [key] of previous) if (!wanted.has(key)) delete resources[key]
}

export function reconcileServices(input, clusterId) {
  const original = input
  let run = clone(input)
  const state = run.runtime?.kubernetes?.clusters?.[clusterId]
  if (!state?.connectivity) return run
  const pendingPods = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.status?.phase === 'Running' && !item.status?.podIP).length
  if (state.connectivity.nextPodAddress + pendingPods - 1 > 4063) return original
  for (const pod of Object.values(state.resources).filter(item => item.kind === 'Pod' && item.status?.phase === 'Running')) {
    if (!pod.status.podIP) {
      const address = allocate(state, 'nextPodAddress', 4063, podAddress)
      if (!address) continue
      pod.status.podIP = address
    }
  }
  for (const [key, slice] of Object.entries(state.resources)) {
    if (slice.kind !== 'EndpointSlice') continue
    const owner = slice.metadata.ownerReferences?.[0]
    if (!owner || !Object.values(state.resources).some(item => item.kind === 'Service' && item.metadata.uid === owner.uid)) delete state.resources[key]
  }
  for (const service of Object.values(state.resources).filter(item => item.kind === 'Service')) {
    if (!service.spec.clusterIP) {
      const address = allocate(state, 'nextServiceAddress', 4063, serviceAddress)
      if (!address) continue
      service.spec.clusterIP = address
    }
    if (service.spec.type === 'LoadBalancer' && !service.status?.loadBalancer?.ingress?.[0]?.ip) {
      const address = allocate(state, 'nextExternalAddress', 254, externalAddress)
      if (!address) continue
      service.status = { ...(service.status ?? {}), loadBalancer: { ingress: [{ ip: address }] } }
    }
    syncSlices(state, service, getServiceBackends(run, { clusterId, namespace: service.metadata.namespace, serviceName: service.metadata.name }))
  }
  return run
}
