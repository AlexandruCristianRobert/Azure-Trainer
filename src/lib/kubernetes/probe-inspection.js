const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const experimentView = value => value ? {
  scenarioId: value.scenarioId, scenarioVersion: value.scenarioVersion ?? 1, status: value.status,
  phase: value.phase ?? null, startedAtMs: value.startedAtMs, baselineReadyAtMs: value.baselineReadyAtMs ?? null,
  endsAtMs: value.endsAtMs, podUids: [...(value.podUids ?? [])], samples: clone(value.samples ?? []), summary: clone(value.summary ?? {}),
} : null

export function inspectProbes(run, target) {
  const clusterId = typeof target === 'string' ? target : target?.clusterId
  const state = run.runtime.kubernetes.clusters?.[clusterId]
  if (!state?.health) return { clusterId, containers: [], experiment: null }
  const pods = new Map(Object.values(state.resources).filter(item => item.kind === 'Pod').map(pod => [pod.metadata.uid, pod]))
  return {
    clusterId,
    experiment: experimentView(state.health.experiment),
    receipts: state.health.receipts.map(experimentView),
    timeline: [...(state.health.events ?? []).map(clone), ...Object.entries(state.health.containers).flatMap(([podUid, health]) => Object.entries(health.checks ?? {}).flatMap(([kind, check]) => {
      if (!check) return []
      return [{ podUid, kind, atMs: check.pending?.startedAtMs ?? check.nextAtMs ?? health.startedAtMs, successes: check.successes, failures: check.failures }]
    }))].sort((a, b) => a.atMs - b.atMs),
    containers: Object.entries(state.health.containers).map(([podUid, health]) => ({
      podUid, podName: pods.get(podUid)?.metadata.name ?? null, containerId: health.containerId,
      startedAtMs: health.startedAtMs, initializedAtMs: health.initializedAtMs,
      ready: health.ready, restartCount: health.restartCount, checks: Object.fromEntries(Object.entries(health.checks).map(([kind, check]) => [kind, check?.nextAtMs === null && check?.pending === null && !health.startupPassed ? null : clone(check)])),
    })).sort((a, b) => a.podUid.localeCompare(b.podUid)),
  }
}
