const copy = value => structuredClone(value)
const byName = (left, right) => String(left.metadata?.name ?? left.name).localeCompare(String(right.metadata?.name ?? right.name))

export function projectKubernetesInspection(run, clusterId) {
  const cluster = (run?.sandbox?.aksClusters ?? []).find(item => item.id === clusterId) ?? null
  const state = cluster && run?.runtime?.kubernetes?.clusters?.[clusterId]
  if (!cluster || !state) return { cluster: null, nodes: [], namespaces: [], deployments: [], pods: [], services: [], events: [], requests: [] }
  const resources = Object.values(state.resources ?? {})
  const select = kind => resources.filter(item => item.kind === kind).sort(byName).map(copy)
  const nodes = Array.from({ length: cluster.nodeCount ?? 0 }, (_, index) => ({ name: `nodepool1-${index}`, status: 'Ready', vmSize: cluster.nodeVmSize }))
  const requests = (run.runtime.kubernetes.requests ?? []).filter(item => item.clusterId === clusterId).map(item => ({
    id: item.id, sequence: item.sequence, scenarioId: item.scenarioId, namespace: item.namespace,
    serviceName: item.serviceName, deploymentName: item.deploymentName, status: item.status,
    diagnosticCode: item.diagnosticCode, simulated: item.simulated,
  })).sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))
  return { cluster: copy(cluster), nodes, namespaces: select('Namespace'), deployments: select('Deployment'), pods: select('Pod'), services: select('Service'), events: (state.events ?? []).map(copy).reverse(), requests }
}
