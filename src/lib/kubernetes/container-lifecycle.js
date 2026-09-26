import { resolvePodConfiguration } from './configuration.js'
import { ACR_PULL_ROLE_ID } from '../sandbox/roleAssignments.js'
import { appendHealthReceipt } from './health-history.js'

function canPull(run, cluster, image) {
  const host = image?.split('/')[0]?.toLowerCase()
  const registry = run.sandbox.containerRegistries.find(item => item.loginServer.toLowerCase() === host)
  return !!registry && run.sandbox.roleAssignments.some(item => item.scope.toLowerCase() === registry.id.toLowerCase()
    && item.principalId.toLowerCase() === cluster.identityProfile.kubeletidentity.objectId.toLowerCase()
    && item.roleDefinitionId === ACR_PULL_ROLE_ID)
}

function resolvedSnapshot(run, state, pod) {
  const image = pod.spec.containers[0].image
  const cluster = run.sandbox.aksClusters.find(item => item.id === pod.clusterId)
  if (!cluster || !canPull(run, cluster, image)) return { reason: 'RegistryAccessDenied' }
  const artifactId = run.artifacts.publishedTags[image]
  const artifact = run.artifacts.buildsById[artifactId]
  const source = artifact && run.artifacts.sourceSnapshotsByHash[artifact.sourceHash]
  if (!artifact || !source) return { reason: 'ImageNotFound' }
  const config = resolvePodConfiguration(state.resources, pod.metadata.namespace, pod.spec)
  if (config.diagnostics.length) return { reason: config.diagnostics[0].mount ? 'FailedMount' : 'CreateContainerConfigError' }
  return { artifactId, config, source }
}

export function scheduleProbeRestart(container, pod, type, nowMs) {
  if (container.terminatedAtMs !== null || container.restartAtMs !== null) return
  if (nowMs - container.startedAtMs >= 600_000) container.consecutiveRestarts = 0
  const grace = (pod.spec?.terminationGracePeriodSeconds ?? 30) * 1000
  const backoff = Math.min(10 * 2 ** container.consecutiveRestarts, 300) * 1000
  container.ready = false
  container.terminatedAtMs = nowMs + grace
  container.restartAtMs = container.terminatedAtMs + backoff
  container.restartDelayMs = backoff
  for (const check of Object.values(container.checks)) if (check) { check.nextAtMs = null; check.pending = null }
  container.restartReason = type === 'startup' ? 'StartupProbeFailed' : 'LivenessProbeFailed'
}

export function terminateForMemoryLimit(input, clusterId, podUid, atMs) {
  const run = structuredClone(input)
  const state = run.runtime?.kubernetes?.clusters?.[clusterId]
  const container = state?.health?.containers?.[podUid]
  const pod = Object.values(state?.resources ?? {}).find(item => item.kind === 'Pod' && item.metadata.uid === podUid)
  if (!container || !pod || container.terminatedAtMs !== null || container.restartAtMs !== null) return run
  if (atMs - container.startedAtMs >= 600_000) container.consecutiveRestarts = 0
  const backoff = Math.min(10 * 2 ** container.consecutiveRestarts, 300) * 1000
  container.ready = false
  container.terminatedAtMs = atMs
  container.restartAtMs = atMs + backoff
  container.restartDelayMs = backoff
  container.restartReason = 'OOMKilled'
  container.restartBlockReason = null
  for (const check of Object.values(container.checks)) if (check) { check.nextAtMs = null; check.pending = null }
  const ready = (pod.status.conditions ?? []).filter(item => item.type !== 'Ready' && item.type !== 'ContainersReady')
  pod.status.conditions = [...ready, { type: 'Ready', status: 'False' }, { type: 'ContainersReady', status: 'False' }]
  pod.status.containerStatuses = [{ name: pod.spec.containers[0].name, ready: false, started: false,
    restartCount: container.restartCount, state: { terminated: { reason: 'OOMKilled', exitCode: 137, finishedAtMs: atMs } },
    ...(container.previous ? { lastState: { terminated: { reason: container.previous.reason, exitCode: container.previous.exitCode ?? null } } } : {}) }]
  state.health.events ??= []
  state.health.events.push({ type: 'container-terminated', atMs, podUid, containerId: container.containerId, reason: 'OOMKilled', exitCode: 137 })
  if (state.health.events.length > 1000) state.health.events.splice(0, state.health.events.length - 1000)
  state.events = [...(state.events ?? []), { apiVersion: 'v1', kind: 'Event',
    metadata: { name: `event-${(state.events ?? []).length + 1}`, namespace: pod.metadata.namespace },
    reason: 'OOMKilled', message: `Container ${pod.spec.containers[0].name} exceeded its memory limit and was terminated with exit code 137.`, simulated: true }].slice(-300)
  return run
}

export function processContainerLifecycle(run, atMs, lab) {
  if (lab?.capabilities?.kubernetesProbes !== true) return run
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes.clusters ?? {})) for (const [uid, container] of Object.entries(state.health?.containers ?? {})) {
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === uid)
    if (!pod) continue
    if (container.terminatedAtMs !== null && container.terminatedAtMs <= atMs) {
      container.previous = { containerId: container.containerId, logs: container.currentLogs, reason: container.restartReason,
        ...(container.restartReason === 'OOMKilled' ? { exitCode: 137 } : {}) }
      container.currentLogs = []
      container.terminatedAtMs = null
      const usage = state.resourcesRuntime?.usage?.[uid]
      if (usage) {
        usage.cpuDemandM = 0; usage.cpuDeliveredM = 0; usage.cpuThrottledM = 0
        usage.readySinceMs = null; usage.window = null
      }
    }
    if (container.restartAtMs === null || container.restartAtMs > atMs) continue
    if (!pod || pod.status?.phase !== 'Running') continue
    const snapshot = resolvedSnapshot(run, state, { ...pod, clusterId })
    if (snapshot.reason) {
      container.restartBlockReason = snapshot.reason
      pod.status.containerStatuses = [{ name: pod.spec.containers[0].name, ready: false,
        restartCount: container.restartCount, state: { waiting: { reason: snapshot.reason } },
        lastState: container.previous ? { terminated: { reason: container.previous.reason } } : {} }]
      continue
    }
    const prior = state.podSnapshots[uid]
    state.podSnapshots[uid] = {
      artifactId: snapshot.artifactId, templateHash: prior.templateHash,
      environment: { ...snapshot.config.environment },
      files: { ...structuredClone(snapshot.source.files), ...snapshot.config.files },
      configRefs: snapshot.config.configRefs,
    }
    delete state.projectionDue[uid]
    const restartCount = container.restartCount + 1
    const startedAtMs = atMs
    const duration = lab.healthFixture.initializationSeconds * 1000
    const probes = pod.spec.containers[0]
    state.health.containers[uid] = {
      ...container, containerId: `container-${run.nextSequence++}`, startedAtMs, initializedAtMs: startedAtMs + duration,
      startupPassed: !probes.startupProbe, ready: !probes.startupProbe && !probes.readinessProbe,
      restartCount, consecutiveRestarts: container.consecutiveRestarts + 1,
      terminatedAtMs: null, restartAtMs: null,
      checks: {
        startup: probes.startupProbe ? { nextAtMs: startedAtMs + probes.startupProbe.initialDelaySeconds * 1000, pending: null, successes: 0, failures: 0 } : null,
        readiness: probes.readinessProbe ? { nextAtMs: null, pending: null, successes: 0, failures: 0 } : null,
        liveness: probes.livenessProbe ? { nextAtMs: null, pending: null, successes: 0, failures: 0 } : null,
      }, currentLogs: [], previous: container.previous, restartReason: null, restartDelayMs: null,
      restartBlockReason: null, localFaults: { ...container.localFaults, hung: false },
    }
    if (state.resourcesRuntime?.usage?.[uid]) {
      const usage = state.resourcesRuntime.usage[uid]
      state.resourcesRuntime.usage[uid] = { ...usage, containerId: state.health.containers[uid].containerId,
        cpuDemandM: 0, cpuDeliveredM: 0, cpuThrottledM: 0, cpuDemandTotalM: 0, cpuDeliveredTotalM: 0,
        cpuThrottledTotalM: 0, memoryBytes: 96 * 1024 * 1024, readySinceMs: null, window: null }
    }
    appendHealthReceipt(state, { cause: container.restartReason === 'OOMKilled' ? 'oom' : 'probe', probeType: container.restartReason, podUid: uid,
      oldContainerId: container.containerId, newContainerId: state.health.containers[uid].containerId,
      atMs, restartCount })
  }
  return run
}
