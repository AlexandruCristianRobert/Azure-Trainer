const copy = value => structuredClone(value)
const byName = (left, right) => String(left.metadata?.name ?? left.name).localeCompare(String(right.metadata?.name ?? right.name))

export function projectKubernetesInspection(run, clusterId) {
  const cluster = (run?.sandbox?.aksClusters ?? []).find(item => item.id === clusterId) ?? null
  const state = cluster && run?.runtime?.kubernetes?.clusters?.[clusterId]
  if (!cluster || !state) return { cluster: null, nodes: [], namespaces: [], deployments: [], pods: [], services: [], serviceEndpoints: [], events: [], requests: [] }
  const resources = Object.values(state.resources ?? {})
  const select = kind => resources.filter(item => item.kind === kind).sort(byName).map(copy)
  const nodes = Array.from({ length: cluster.nodeCount ?? 0 }, (_, index) => ({ name: `nodepool1-${index}`, status: 'Ready', vmSize: cluster.nodeVmSize }))
  const serviceEndpoints = resources.filter(item => item.kind === 'Service').sort(byName).map(service => {
    const namespace = service.metadata.namespace
    const targetPort = service.spec.ports?.[0]?.targetPort
    const readyBackends = resources.filter(pod => pod.kind === 'Pod' && pod.metadata.namespace === namespace
      && pod.status?.phase === 'Running' && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')
      && Object.entries(service.spec.selector ?? {}).every(([key, value]) => pod.metadata.labels?.[key] === value)
      && (typeof targetPort === 'number' || pod.spec.containers?.some(container => container.ports?.some(port => port.name === targetPort))))
      .sort(byName).map(pod => ({ name: pod.metadata.name, image: pod.spec.containers?.[0]?.image ?? '' }))
    const container = resources.find(pod => pod.kind === 'Pod' && pod.metadata.namespace === namespace && readyBackends.some(backend => backend.name === pod.metadata.name))?.spec.containers?.[0]
    const resolvedPort = typeof targetPort === 'number' ? targetPort : container?.ports?.find(port => port.name === targetPort)?.containerPort ?? null
    return { name: service.metadata.name, namespace, type: service.spec.type ?? 'ClusterIP', port: service.spec.ports?.[0]?.port ?? null, targetPort, resolvedPort, readyBackends }
  })
  const requests = (run.runtime.kubernetes.requests ?? []).filter(item => item.clusterId === clusterId).map(item => ({
    id: item.id, sequence: item.sequence, scenarioId: item.scenarioId, namespace: item.namespace,
    serviceName: item.serviceName, deploymentName: item.deploymentName, status: item.status,
    diagnosticCode: item.diagnosticCode, simulated: item.simulated,
  })).sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))
  const events = (state.events ?? []).map(event => {
    const next = copy(event)
    if (next.metadata?.namespace) return next
    const image = /for (.+) failed:/.exec(next.message ?? '')?.[1]
    const matches = image ? resources.filter(resource => resource.kind === 'Deployment' && resource.spec?.template?.spec?.containers?.some(container => container.image === image)) : []
    const namespaces = [...new Set(matches.map(resource => resource.metadata.namespace).filter(Boolean))]
    return namespaces.length === 1 ? { ...next, metadata: { ...next.metadata, namespace: namespaces[0] } } : next
  }).reverse()
  return { cluster: copy(cluster), nodes, namespaces: select('Namespace'), deployments: select('Deployment'), pods: select('Pod'), services: select('Service'), serviceEndpoints, events, requests }
}
