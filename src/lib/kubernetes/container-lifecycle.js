export function scheduleProbeRestart(container, pod, type, nowMs) {
  if (container.terminatedAtMs !== null || container.restartAtMs !== null) return
  const grace = (pod.spec?.terminationGracePeriodSeconds ?? 30) * 1000
  const backoff = Math.min(10 * 2 ** container.consecutiveRestarts, 300) * 1000
  container.ready = false
  container.terminatedAtMs = nowMs + grace
  container.restartAtMs = container.terminatedAtMs + backoff
  container.restartDelayMs = backoff
  for (const check of Object.values(container.checks)) if (check) { check.nextAtMs = null; check.pending = null }
  container.restartReason = type === 'startup' ? 'StartupProbeFailed' : 'LivenessProbeFailed'
}

export function processContainerLifecycle(run, atMs, lab) {
  if (lab?.capabilities?.kubernetesProbes !== true) return run
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) for (const [uid, container] of Object.entries(state.health?.containers ?? {})) {
    if (container.terminatedAtMs !== null && container.terminatedAtMs <= atMs) {
      container.previous = { containerId: container.containerId, logs: container.currentLogs, reason: container.restartReason }
      container.currentLogs = []
      container.terminatedAtMs = null
    }
    if (container.restartAtMs === null || container.restartAtMs > atMs) continue
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === uid)
    if (!pod || pod.status?.phase !== 'Running') continue
    const restartCount = container.restartCount + 1
    const startedAtMs = container.restartAtMs
    const duration = lab.healthFixture.initializationSeconds * 1000
    const probes = pod.spec.containers[0]
    state.health.containers[uid] = {
      ...container, containerId: `container-${run.nextSequence++}`, startedAtMs, initializedAtMs: startedAtMs + duration,
      startupPassed: !probes.startupProbe, ready: !probes.startupProbe && !probes.readinessProbe,
      restartCount, consecutiveRestarts: container.consecutiveRestarts + 1, terminatedAtMs: null, restartAtMs: null,
      checks: {
        startup: probes.startupProbe ? { nextAtMs: startedAtMs + probes.startupProbe.initialDelaySeconds * 1000, pending: null, successes: 0, failures: 0 } : null,
        readiness: probes.readinessProbe ? { nextAtMs: null, pending: null, successes: 0, failures: 0 } : null,
        liveness: probes.livenessProbe ? { nextAtMs: null, pending: null, successes: 0, failures: 0 } : null,
      }, currentLogs: [], previous: container.previous, restartReason: null, restartDelayMs: null,
    }
  }
  return run
}
