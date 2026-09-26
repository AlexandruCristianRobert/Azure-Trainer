import { getDeploymentPods } from './reconcile.js'
import { normalizeContainerResources } from './resource-schema.js'
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))

function nodeBudgets(nodes, assignments, usage, metrics, state, nowMs) {
  return Object.fromEntries(Object.entries(nodes ?? {}).map(([name, node]) => {
    const assigned = Object.entries(assignments ?? {}).filter(([, item]) => item.nodeName === name)
    const requested = assigned.reduce((total, [, item]) => ({ cpuM: total.cpuM + (item.cpuRequestM ?? 0), memoryBytes: total.memoryBytes + (item.memoryRequestBytes ?? 0) }), { cpuM: 0, memoryBytes: 0 })
    const current = assigned.reduce((total, [uid]) => ({ cpuDeliveredM: total.cpuDeliveredM + (usage?.[uid]?.cpuDeliveredM ?? 0), cpuThrottledM: total.cpuThrottledM + (usage?.[uid]?.cpuThrottledM ?? 0) }), { cpuDeliveredM: 0, cpuThrottledM: 0 })
    const samples = assigned.map(([uid]) => {
      const pod = Object.values(state.resources ?? {}).find(item => item.kind === 'Pod' && item.metadata.uid === uid)
      const containerId = state.health?.containers?.[uid]?.containerId
      return (metrics?.[uid] ?? []).filter(sample => sample.containerId === containerId).at(-1) ?? null
    })
    const sameWindow = samples.length && samples.every(Boolean) && samples.every(sample => sample.windowEndMs === samples[0].windowEndMs)
    const memoryPeakBytes = sameWindow ? samples.reduce((sum, sample) => sum + sample.memoryPeakBytes, 0) : null
    const cpuAverageM = sameWindow ? samples.reduce((sum, sample) => sum + sample.cpuAverageM, 0) : null
    return [name, { ...node, capacityCpuM: 2000, capacityMemoryBytes: 8192 * 1024 * 1024,
      requestedCpuM: requested.cpuM, requestedMemoryBytes: requested.memoryBytes,
      ...current, cpuAverageM, memoryPeakBytes, metricAgeSeconds: sameWindow ? Math.max(0, (nowMs - samples[0].windowEndMs) / 1000) : null,
      remainingCpuM: node.allocatableCpuM - node.fixedCpuM - requested.cpuM,
      remainingMemoryBytes: node.allocatableMemoryBytes - node.fixedMemoryBytes - requested.memoryBytes }]
  }))
}

export function inspectResources(run, target) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  if (!state) return { nodes: {}, assignments: {}, pods: [], deployment: null, hpas: [], experiment: null,
    totals: { arrivals: 0, completed: 0, remaining: 0, peakBacklog: 0 }, overflowBacklog: 0, oomCount: 0,
    containerTerminations: [], cpuDemandM: 0, cpuDeliveredM: 0, cpuThrottledM: 0, cpuThrottledTotalM: 0, unsupported: null }
  const runtime = state.resourcesRuntime
  const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName).map(pod => {
    const usage = runtime?.usage?.[pod.metadata.uid]
    const container = state.health?.containers?.[pod.metadata.uid]
    const ready = pod.status?.phase === 'Running' && pod.metadata.deletionTimestamp === undefined && container?.ready === true
      && container.terminatedAtMs === null && container.restartAtMs === null
      && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')
    const metrics = ready ? (runtime?.metrics?.[pod.metadata.uid] ?? []).filter(item => item.containerId === container?.containerId)
      .map(item => ({ ...item, ageSeconds: Math.max(0, (run.runtime.simTimeMs - item.windowEndMs) / 1000) })) : []
    const resources = normalizeContainerResources(pod.spec?.containers?.[0]?.resources ?? {})
    return { uid: pod.metadata.uid, name: pod.metadata.name, phase: pod.status?.phase ?? null, nodeName: pod.spec?.nodeName ?? null, ready,
      schedulingReason: pod.status?.schedulingReason ?? null, containerId: container?.containerId ?? null,
      readySinceMs: ready ? usage?.readySinceMs ?? null : null, cpuDemandM: ready ? usage?.cpuDemandM ?? null : null,
      cpuDeliveredM: ready ? usage?.cpuDeliveredM ?? null : null, cpuThrottledM: ready ? usage?.cpuThrottledM ?? null : null,
      routedWorkCpuM: usage?.routedWorkCpuM ?? 0,
      resources: copy(resources),
      memoryBytes: ready ? usage?.memoryBytes ?? null : null, backlog: usage?.backlog ?? 0,
      metrics: metrics.length ? copy(metrics) : null,
      oomCount: runtime?.receipts?.filter(item => item.kind === 'container-termination' && item.podUid === pod.metadata.uid && item.reason === 'OOMKilled').length ?? 0,
      containerTerminations: copy((runtime?.receipts ?? []).filter(item => item.podUid === pod.metadata.uid && item.kind === 'container-termination')) }
  }).sort((a, b) => a.uid.localeCompare(b.uid))
  const experiment = runtime?.experiment ?? null
  const hpas = Object.values(state.resources ?? {}).filter(item => item.kind === 'HorizontalPodAutoscaler'
    && item.metadata.namespace === target.namespace && item.spec?.scaleTargetRef?.name === target.deploymentName)
  const deployment = state.resources?.[`Deployment/${target.namespace}/${target.deploymentName}`] ?? null
  const readyReplicas = pods.filter(pod => pod.ready).length
  return { nodes: nodeBudgets(runtime?.nodes, runtime?.assignments, runtime?.usage, runtime?.metrics, state, run.runtime.simTimeMs), assignments: copy(runtime?.assignments ?? {}), pods,
    deployment: deployment ? { desiredReplicas: deployment.spec.replicas, readyReplicas } : null,
    hpas: hpas.map(hpa => ({ ...copy(hpa), targetReadyReplicas: readyReplicas, controller: copy(runtime?.hpa?.[hpa.metadata.uid] ?? null) })),
    experiment: copy(experiment), totals: copy(experiment?.totals ?? { arrivals: 0, completed: 0, remaining: 0, peakBacklog: 0 }),
    overflowBacklog: experiment?.overflowBacklog ?? 0, oomCount: runtime?.receipts?.filter(item => item.kind === 'container-termination' && item.reason === 'OOMKilled').length ?? 0,
    containerTerminations: copy((runtime?.receipts ?? []).filter(item => item.kind === 'container-termination')),
    cpuDemandM: Object.values(runtime?.usage ?? {}).reduce((sum, usage) => sum + usage.cpuDemandM, 0),
    cpuDeliveredM: Object.values(runtime?.usage ?? {}).reduce((sum, usage) => sum + usage.cpuDeliveredM, 0),
    cpuThrottledM: Object.values(runtime?.usage ?? {}).reduce((sum, usage) => sum + usage.cpuThrottledM, 0),
    cpuThrottledTotalM: Object.values(runtime?.usage ?? {}).reduce((sum, usage) => sum + (usage.cpuThrottledTotalM ?? 0), 0),
    unsupported: experiment?.unsupported ?? null }
}
