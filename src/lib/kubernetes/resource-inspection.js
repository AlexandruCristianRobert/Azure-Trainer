import { getDeploymentPods } from './reconcile.js'

export function inspectResources(run, target) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  const runtime = state.resourcesRuntime
  const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName).map(pod => {
    const usage = runtime?.usage?.[pod.metadata.uid]
    const container = state.health?.containers?.[pod.metadata.uid]
    const ready = pod.status?.phase === 'Running' && pod.metadata.deletionTimestamp === undefined && container?.ready === true
      && container.terminatedAtMs === null && container.restartAtMs === null
      && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')
    const metrics = ready ? (runtime?.metrics?.[pod.metadata.uid] ?? []).filter(item => item.containerId === container?.containerId)
      .map(item => ({ ...item, ageSeconds: Math.max(0, (run.runtime.simTimeMs - item.windowEndMs) / 1000) })) : []
    return { uid: pod.metadata.uid, phase: pod.status?.phase ?? null, nodeName: pod.spec?.nodeName ?? null,
      schedulingReason: pod.status?.schedulingReason ?? null, containerId: container?.containerId ?? null,
      readySinceMs: ready ? usage?.readySinceMs ?? null : null, cpuDemandM: ready ? usage?.cpuDemandM ?? null : null,
      cpuDeliveredM: ready ? usage?.cpuDeliveredM ?? null : null, cpuThrottledM: ready ? usage?.cpuThrottledM ?? null : null,
      routedWorkCpuM: usage?.routedWorkCpuM ?? 0,
      memoryBytes: ready ? usage?.memoryBytes ?? null : null, backlog: usage?.backlog ?? 0,
      metrics: metrics.length ? structuredClone(metrics) : null,
      oomCount: runtime?.receipts?.filter(item => item.kind === 'container-termination' && item.podUid === pod.metadata.uid && item.reason === 'OOMKilled').length ?? 0,
      containerTerminations: structuredClone((runtime?.receipts ?? []).filter(item => item.podUid === pod.metadata.uid && item.kind === 'container-termination')) }
  }).sort((a, b) => a.uid.localeCompare(b.uid))
  const experiment = runtime?.experiment ?? null
  return { nodes: structuredClone(runtime?.nodes ?? {}), assignments: structuredClone(runtime?.assignments ?? {}), pods,
    experiment: structuredClone(experiment), totals: structuredClone(experiment?.totals ?? { arrivals: 0, completed: 0, remaining: 0, peakBacklog: 0 }),
    overflowBacklog: experiment?.overflowBacklog ?? 0, oomCount: runtime?.receipts?.filter(item => item.kind === 'container-termination' && item.reason === 'OOMKilled').length ?? 0,
    containerTerminations: structuredClone((runtime?.receipts ?? []).filter(item => item.kind === 'container-termination')),
    cpuDemandM: Object.values(runtime?.usage ?? {}).reduce((sum, usage) => sum + usage.cpuDemandM, 0),
    cpuDeliveredM: Object.values(runtime?.usage ?? {}).reduce((sum, usage) => sum + usage.cpuDeliveredM, 0),
    cpuThrottledM: Object.values(runtime?.usage ?? {}).reduce((sum, usage) => sum + usage.cpuThrottledM, 0),
    cpuThrottledTotalM: Object.values(runtime?.usage ?? {}).reduce((sum, usage) => sum + (usage.cpuThrottledTotalM ?? 0), 0),
    unsupported: experiment?.unsupported ?? null }
}
