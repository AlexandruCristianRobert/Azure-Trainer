const clone = value => structuredClone(value)

export function inspectProbes(run, target) {
  const clusterId = typeof target === 'string' ? target : target?.clusterId
  const state = run.runtime.kubernetes.clusters?.[clusterId]
  if (!state?.health) return { clusterId, containers: [], experiment: null }
  const pods = new Map(Object.values(state.resources).filter(item => item.kind === 'Pod').map(pod => [pod.metadata.uid, pod]))
  return {
    clusterId,
    experiment: state.health.experiment ? clone(state.health.experiment) : null,
    containers: Object.entries(state.health.containers).map(([podUid, health]) => ({
      podUid, podName: pods.get(podUid)?.metadata.name ?? null, containerId: health.containerId,
      startedAtMs: health.startedAtMs, initializedAtMs: health.initializedAtMs,
      ready: health.ready, restartCount: health.restartCount, checks: clone(health.checks),
    })).sort((a, b) => a.podUid.localeCompare(b.podUid)),
  }
}
