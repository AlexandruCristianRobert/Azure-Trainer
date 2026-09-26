import { getServiceBackends } from './services.js'
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const experimentView = value => value ? {
  scenarioId: value.scenarioId, scenarioVersion: value.scenarioVersion ?? 1, status: value.status,
  outcome: value.outcome ?? null,
  phase: value.phase ?? null, startedAtMs: value.startedAtMs, baselineReadyAtMs: value.baselineReadyAtMs ?? null,
  endsAtMs: value.endsAtMs, podUids: [...(value.podUids ?? [])], samples: clone(value.samples ?? []), summary: clone(value.summary ?? {}),
} : null

export function inspectProbes(run, target) {
  const clusterId = typeof target === 'string' ? target : target?.clusterId
  const state = run.runtime.kubernetes.clusters?.[clusterId]
  if (!state?.health) return { clusterId, containers: [], experiment: null }
  const pods = new Map(Object.values(state.resources).filter(item => item.kind === 'Pod').map(pod => [pod.metadata.uid, pod]))
  const deployment = typeof target === 'object' ? state.resources[`Deployment/${target.namespace}/${target.deploymentName}`] : null
  const image = deployment?.spec?.template?.spec?.containers?.[0]?.image ?? null
  const artifactId = image ? run.artifacts?.publishedTags?.[image] ?? null : null
  const artifact = artifactId ? run.artifacts?.buildsById?.[artifactId] : null
  const backends = typeof target === 'object' && target.serviceName ? getServiceBackends(run, target) : null
  return {
    clusterId,
    sourceVersion: image ? { image, artifactId, sourceHash: artifact?.sourceHash ?? null, version: artifact?.appSpec?.version ?? null } : null,
    readyBackendCount: backends?.readyEndpoints?.length ?? 0,
    experiment: experimentView(state.health.experiment),
    receipts: state.health.receipts.map(experimentView),
    timeline: [...(state.health.events ?? []).map(clone), ...Object.entries(state.health.containers).flatMap(([podUid, health]) => Object.entries(health.checks ?? {}).flatMap(([kind, check]) => {
      if (!check) return []
      return [{ podUid, kind, atMs: check.pending?.startedAtMs ?? check.nextAtMs ?? health.startedAtMs, successes: check.successes, failures: check.failures }]
    }))].sort((a, b) => a.atMs - b.atMs),
    containers: Object.entries(state.health.containers).map(([podUid, health]) => ({
      podUid, podName: pods.get(podUid)?.metadata.name ?? null, containerId: health.containerId,
      startedAtMs: health.startedAtMs, initializedAtMs: health.initializedAtMs,
      terminatedAtMs: health.terminatedAtMs, restartAtMs: health.restartAtMs,
      restartReason: health.restartReason ?? health.previous?.reason ?? null,
      ready: health.ready, restartCount: health.restartCount, checks: Object.fromEntries(Object.entries(health.checks).map(([kind, check]) => [kind, check?.nextAtMs === null && check?.pending === null && !health.startupPassed ? null : clone(check)])),
    })).sort((a, b) => a.podUid.localeCompare(b.podUid)),
  }
}
