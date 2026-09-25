const clone = value => structuredClone(value)

function evaluate(expression, signals) {
  if (expression?.kind === 'constant') return expression.value
  if (expression?.kind === 'signal') return signals[expression.name] === true
  if (expression?.kind === 'not') return !evaluate(expression.operand, signals)
  if (expression?.kind === 'and') return expression.operands.every(item => evaluate(item, signals))
  if (expression?.kind === 'or') return expression.operands.some(item => evaluate(item, signals))
  if (expression?.kind === 'conditional') return evaluate(expression.condition, signals) ? expression.then : expression.else
  return false
}

function namedPort(pod, port) {
  if (Number.isInteger(port)) return port
  return pod?.spec?.containers?.[0]?.ports?.find(item => item.name === port)?.containerPort ?? null
}

export function evaluateHealthEndpoint(appSpec, containerHealth, dependencySignals = {}, path, port, nowMs, pod = null) {
  if (containerHealth?.localFaults?.hung) return { status: null, timeout: true }
  const endpoint = appSpec?.health?.endpoints?.find(item => item.path === path)
  const targetPort = namedPort(pod, port)
  if (!endpoint || !targetPort || targetPort !== appSpec?.listeningPort) return { status: null, connectionFailure: true }
  const signals = {
    initialized: nowMs >= containerHealth.initializedAtMs,
    accepting_requests: !containerHealth.localFaults?.admissionClosed,
    postgres_available: dependencySignals.postgres_available !== false,
    ai_available: dependencySignals.ai_available !== false,
  }
  const status = evaluate(endpoint.statusExpression, signals)
  return { status: Number.isInteger(status) ? status : null, body: endpoint.body }
}

function check(probe, atMs) {
  return probe ? { nextAtMs: atMs, pending: null, successes: 0, failures: 0 } : null
}

function probesFor(pod) {
  const container = pod.spec?.containers?.[0] ?? {}
  return { startup: container.startupProbe ?? null, readiness: container.readinessProbe ?? null, liveness: container.livenessProbe ?? null }
}

function healthAppSpec(run, state, pod) {
  const artifact = run.artifacts.buildsById?.[state.podSnapshots[pod.metadata.uid]?.artifactId]
  return artifact?.appSpec ?? null
}

function fixtureDuration(lab) {
  const seconds = lab?.healthFixture?.initializationSeconds
  return Number.isInteger(seconds) && seconds >= 0 ? seconds * 1000 : null
}

function readyChecks(container, pod, atMs) {
  const { readiness, liveness } = probesFor(pod)
  if (container.checks.readiness && container.checks.readiness.nextAtMs === null) container.checks.readiness.nextAtMs = atMs + (readiness?.initialDelaySeconds ?? 0) * 1000
  if (container.checks.liveness && container.checks.liveness.nextAtMs === null) container.checks.liveness.nextAtMs = atMs + (liveness?.initialDelaySeconds ?? 0) * 1000
  if (!readiness) container.ready = true
}

function syncPodReadiness(pod, container) {
  if (!pod || !container || pod.status?.phase !== 'Running') return
  const conditions = (pod.status.conditions ?? []).filter(item => item.type !== 'Ready' && item.type !== 'ContainersReady')
  const status = container.ready ? 'True' : 'False'
  pod.status.conditions = [...conditions, { type: 'Ready', status }, { type: 'ContainersReady', status }]
}

export function reconcileHealth(input, lab) {
  if (lab?.capabilities?.kubernetesProbes !== true) return input
  const run = clone(input)
  const duration = fixtureDuration(lab)
  if (duration === null) return run
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) {
    state.health ??= { version: 1, containers: {}, experiment: null, receipts: [] }
    const runningPods = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.status?.phase === 'Running')
    const activeUids = new Set(runningPods.map(item => item.metadata.uid))
    for (const uid of Object.keys(state.health.containers)) if (!activeUids.has(uid)) delete state.health.containers[uid]
    for (const pod of runningPods) {
      if (!state.podSnapshots[pod.metadata.uid] || state.health.containers[pod.metadata.uid]) continue
      const probes = probesFor(pod); const startedAtMs = run.runtime.simTimeMs
      const container = state.health.containers[pod.metadata.uid] = {
        containerId: `container-${run.nextSequence++}`, startedAtMs, startupPassed: !probes.startup,
        ready: !probes.startup && !probes.readiness, restartCount: 0, consecutiveRestarts: 0,
        restartAtMs: null, terminatedAtMs: null, initializedAtMs: startedAtMs + duration,
        checks: { startup: check(probes.startup, startedAtMs + (probes.startup?.initialDelaySeconds ?? 0) * 1000), readiness: check(probes.readiness, null), liveness: check(probes.liveness, null) },
        localFaults: { admissionClosed: false, hung: false }, currentLogs: [], previous: null,
      }
      if (container.startupPassed) readyChecks(container, pod, startedAtMs)
      syncPodReadiness(pod, container)
    }
  }
  return run
}

function complete(container, pod, appSpec, type, nowMs) {
  const item = container.checks[type]; if (!item?.pending || item.pending.containerId !== container.containerId || item.pending.completeAtMs > nowMs) return
  const { result, startedAtMs } = item.pending; item.pending = null
  const success = Number.isInteger(result.status) && result.status >= 200 && result.status <= 399
  if (success) { item.successes++; item.failures = 0 } else { item.failures++; item.successes = 0 }
  const probe = probesFor(pod)[type]
  item.nextAtMs = startedAtMs + probe.periodSeconds * 1000
  while (item.nextAtMs <= nowMs) item.nextAtMs += probe.periodSeconds * 1000
  if (type === 'startup' && success && item.successes >= probe.successThreshold) {
    container.startupPassed = true; readyChecks(container, pod, nowMs)
  }
  if (type === 'readiness') {
    if (success && item.successes >= probe.successThreshold) container.ready = true
    if (!success && item.failures >= probe.failureThreshold) container.ready = false
  }
}

function start(container, pod, appSpec, type, nowMs, dependencySignals) {
  const item = container.checks[type]; const probe = probesFor(pod)[type]
  if (!item || item.pending || item.nextAtMs === null || item.nextAtMs > nowMs) return
  const result = evaluateHealthEndpoint(appSpec, container, dependencySignals, probe.httpGet.path, probe.httpGet.port, nowMs, pod)
  const pending = result.timeout ? { containerId: container.containerId, startedAtMs: nowMs, completeAtMs: nowMs + probe.timeoutSeconds * 1000, result: { status: null } }
    : { containerId: container.containerId, startedAtMs: nowMs, completeAtMs: nowMs, result }
  item.pending = pending
  item.nextAtMs = null
}

export function processProbeTimestamp(input, atMs, lab) {
  let run = reconcileHealth(input, lab)
  if (lab?.capabilities?.kubernetesProbes !== true) return run
  for (const state of Object.values(run.runtime.kubernetes.clusters ?? {})) {
    const pods = Object.values(state.resources).filter(item => item.kind === 'Pod').sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid))
    for (const pod of pods) {
      const container = state.health?.containers?.[pod.metadata.uid]
      if (!container || pod.status?.phase !== 'Running') continue
      const appSpec = healthAppSpec(run, state, pod)
      for (const type of ['startup', 'readiness', 'liveness']) complete(container, pod, appSpec, type, atMs)
    }
    for (const pod of pods) {
      const container = state.health?.containers?.[pod.metadata.uid]
      if (!container || pod.status?.phase !== 'Running') continue
      const appSpec = healthAppSpec(run, state, pod)
      for (const type of ['startup', 'readiness', 'liveness']) {
        if ((type === 'readiness' || type === 'liveness') && !container.startupPassed) continue
        start(container, pod, appSpec, type, atMs, {})
      }
    }
    for (const pod of pods) {
      const container = state.health?.containers?.[pod.metadata.uid]
      if (!container || pod.status?.phase !== 'Running') continue
      const appSpec = healthAppSpec(run, state, pod)
      for (const type of ['startup', 'readiness', 'liveness']) complete(container, pod, appSpec, type, atMs)
      syncPodReadiness(pod, container)
    }
  }
  return run
}
