import { RESOURCE_FIXTURES } from '../../data/fixtures/aks/resources.js'
import { kubeObjectKey } from './objects.js'
import { getDeploymentPods } from './reconcile.js'
import { terminateForMemoryLimit } from './container-lifecycle.js'
import { normalizeContainerResources } from './resource-schema.js'

const clone = value => structuredClone(value)
const MiB = 1024 * 1024
const PROFILES = Object.freeze({
  'test-local-work': Object.freeze({ durationSeconds: 30, arrivalRate: 10, kind: 'workload' }),
  'test-ai-wait': Object.freeze({ durationSeconds: 60, arrivalRate: 28, kind: 'ai-wait' }),
})
const isReady = (pod, container) => pod?.status?.phase === 'Running' && pod.metadata.deletionTimestamp === undefined
  && container?.restartAtMs === null && container?.terminatedAtMs === null && container.ready === true

function clusterState(run, clusterId) { return run.runtime.kubernetes.clusters?.[clusterId] }
function resourceState(run, clusterId) { return clusterState(run, clusterId)?.resourcesRuntime }
function podsFor(run, experiment) { return getDeploymentPods(run, experiment.clusterId, experiment.target.namespace, experiment.target.deploymentName) }
function containerFor(state, pod) { return state.health?.containers?.[pod.metadata.uid] }
function workloadFor(run, state, pod) {
  const snapshot = state.podSnapshots?.[pod.metadata.uid]
  return run.artifacts.buildsById?.[snapshot?.artifactId]?.appSpec?.workload ?? null
}

export function startResourceProfileFixture(input, scenarioId, lab) {
  if (!Object.hasOwn(PROFILES, scenarioId) || lab?.capabilities?.kubernetesResources !== true) return { run: input, diagnostics: [{ code: 'INVALID_RESOURCE_PROFILE', message: 'The immutable resource fixture is unavailable.' }] }
  const scenario = lab.scenarios?.[scenarioId]
  const target = scenario?.target
  const state = target && clusterState(input, target.clusterId)
  const deployment = state?.resources?.[kubeObjectKey('Deployment', target.namespace, target.deploymentName)]
  if (scenario?.kind !== 'aks-resource-profile' || scenario.version !== 1 || Object.keys(scenario).sort().join(',') !== 'kind,requiredReadyReplicas,target,version'
    || !target || Object.keys(target).sort().join(',') !== 'clusterId,deploymentName,namespace'
    || !Number.isInteger(scenario.requiredReadyReplicas)
    || scenario.requiredReadyReplicas < 1 || scenario.requiredReadyReplicas > 6
    || !deployment || !getDeploymentPods(input, target.clusterId, target.namespace, target.deploymentName).length) {
    return { run: input, diagnostics: [{ code: 'INVALID_RESOURCE_PROFILE', message: 'The declared resource fixture target is invalid.' }] }
  }
  if (Object.values(input.runtime.kubernetes.clusters ?? {}).some(cluster => ['warming', 'running'].includes(cluster.resourcesRuntime?.experiment?.phase)
    || cluster.health?.experiment?.status === 'active')) return { run: input, diagnostics: [{ code: 'RESOURCE_PROFILE_ACTIVE', message: 'A probe or resource profile is already active.' }] }
  const run = clone(input); const runtime = resourceState(run, target.clusterId)
  if (['warming', 'running'].includes(runtime.experiment?.phase)) return { run: input, diagnostics: [{ code: 'RESOURCE_PROFILE_ACTIVE', message: 'A resource profile is already active.' }] }
  runtime.experiment = { version: 1, profileId: scenarioId, clusterId: target.clusterId,
    target: { namespace: target.namespace, deploymentName: target.deploymentName }, phase: 'warming',
    startedAtMs: run.runtime.simTimeMs, warmupDeadlineMs: run.runtime.simTimeMs + 360_000, phaseZeroAtMs: null,
    requiredReadyReplicas: scenario.requiredReadyReplicas, atMs: run.runtime.simTimeMs, overflowBacklog: 0,
    totals: { arrivals: 0, completed: 0, remaining: 0, peakBacklog: 0 }, unsupported: null }
  return { run: sampleResourceMetrics(run, run.runtime.simTimeMs, lab), diagnostics: [] }
}

function latestComplete(runtime, uid, containerId, beforeMs) {
  return (runtime.metrics[uid] ?? []).some(item => item.containerId === containerId && item.windowEndMs <= beforeMs)
}

function readyProfile(run, state, experiment, atMs) {
  const runtime = state.resourcesRuntime
  const pods = podsFor(run, experiment).filter(pod => isReady(pod, containerFor(state, pod)) && runtime.assignments[pod.metadata.uid]
    && workloadFor(run, state, pod)?.version === 1)
  return pods.length >= experiment.requiredReadyReplicas && pods.every(pod => latestComplete(runtime, pod.metadata.uid,
    containerFor(state, pod).containerId, atMs))
}

function profileRate(experiment, startMs) {
  const profile = PROFILES[experiment.profileId]
  const elapsed = startMs - experiment.phaseZeroAtMs
  return elapsed >= 0 && elapsed < profile.durationSeconds * 1000 ? profile.arrivalRate : 0
}

function maxMin(items, capacity) {
  const result = new Map(items.map(item => [item.uid, 0]))
  let active = [...items].filter(item => item.demand > 0); let left = capacity
  while (active.length && left > 0) {
    const share = left / active.length
    const filled = active.filter(item => item.demand - result.get(item.uid) <= share)
    if (!filled.length) { for (const item of active) result.set(item.uid, result.get(item.uid) + share); break }
    for (const item of filled) { const amount = item.demand - result.get(item.uid); result.set(item.uid, item.demand); left -= amount }
    active = active.filter(item => !filled.includes(item))
  }
  return result
}

function updateBacklog(runtime, experiment, readyPods, availableWork, doneByPod) {
  experiment.overflowBacklog = 0
  const readyIds = new Set(readyPods.map(pod => pod.metadata.uid))
  if (!readyPods.length) {
    experiment.overflowBacklog = availableWork
    for (const usage of Object.values(runtime.usage)) usage.backlog = 0
    return
  }
  const share = availableWork / readyPods.length
  for (const [uid, usage] of Object.entries(runtime.usage)) if (!readyIds.has(uid)) usage.backlog = 0
  for (const pod of readyPods) {
    const uid = pod.metadata.uid; const usage = runtime.usage[uid]
    usage.backlog = Math.max(0, share - (doneByPod.get(uid) ?? 0))
  }
}

function publishMetric(runtime, uid, usage, atMs) {
  const window = usage.window
  if (atMs % 15_000 !== 0 || !window || window.windowEndMs !== atMs) return
  if (window.containerId === usage.containerId && window.readySeconds === 15 && window.readySinceMs <= window.windowStartMs) {
    const samples = runtime.metrics[uid] ?? []
    samples.push({ containerId: usage.containerId, windowStartMs: window.windowStartMs, windowEndMs: atMs,
      cpuAverageM: window.cpuTotalM / 15, memoryPeakBytes: window.memoryPeakBytes, readySinceMs: window.readySinceMs })
    runtime.metrics[uid] = samples.slice(-40)
  }
  usage.window = null
}

export function sampleResourceMetrics(input, atMs, lab) {
  if (lab?.capabilities?.kubernetesResources !== true) return input
  let run = clone(input)
  for (const [clusterId, cluster] of Object.entries(run.runtime.kubernetes.clusters ?? {})) {
    const runtime = cluster.resourcesRuntime; if (!runtime) continue
    for (const [uid, usage] of Object.entries(runtime.usage)) publishMetric(runtime, uid, usage, atMs)
    const experiment = runtime.experiment
    if (experiment?.phase === 'warming' && readyProfile(run, cluster, experiment, atMs)) {
      experiment.phase = 'running'; experiment.phaseZeroAtMs = atMs; experiment.atMs = atMs
    }
  }
  return run
}

export function accountResourceSecond(input, atMs, lab) {
  if (lab?.capabilities?.kubernetesResources !== true) return input
  let run = clone(input)
  const oomTargets = []
  for (const [clusterId, cluster] of Object.entries(run.runtime.kubernetes.clusters ?? {})) {
    const runtime = cluster.resourcesRuntime; if (!runtime) continue
    if (!Number.isFinite(runtime.accountedUntilMs)) { runtime.accountedUntilMs = atMs; continue }
    if (atMs <= runtime.accountedUntilMs || atMs - runtime.accountedUntilMs !== 1000) continue
    runtime.accountedUntilMs = atMs
    for (const usage of Object.values(runtime.usage)) {
      usage.cpuDemandM = 0; usage.cpuDeliveredM = 0; usage.cpuThrottledM = 0
      usage.memoryBytes = RESOURCE_FIXTURES.baseMemoryMiB * MiB
    }
    const experiment = runtime.experiment
    if (experiment?.clusterId === clusterId) {
      experiment.atMs = atMs
      if (experiment.phase === 'warming' && atMs >= experiment.warmupDeadlineMs) {
        experiment.phase = 'unsupported'; experiment.unsupported = 'RESOURCE_WARMUP_TIMEOUT'
      }
    }
    const pods = experiment?.clusterId === clusterId ? podsFor(run, experiment) : []
    const profilePodIds = new Set(pods.map(pod => pod.metadata.uid))
    const readyPods = pods.filter(pod => isReady(pod, containerFor(cluster, pod)) && runtime.assignments[pod.metadata.uid]
      && workloadFor(run, cluster, pod)?.version === 1)
    const startMs = atMs - 1000
    const rate = experiment?.phase === 'running' ? profileRate(experiment, startMs) : 0
    const arrivals = rate
    if (experiment?.phase === 'running') experiment.totals.arrivals += arrivals
    const oldBacklog = experiment?.phase === 'running' ? experiment.overflowBacklog
      + Object.values(runtime.usage).reduce((sum, usage) => sum + usage.backlog, 0) : 0
    const totalAvailableWork = oldBacklog + arrivals
    const workByPod = new Map(readyPods.map(pod => [pod.metadata.uid, totalAvailableWork / Math.max(1, readyPods.length)]))
    const active = []
    for (const pod of Object.values(cluster.resources).filter(item => item.kind === 'Pod' && item.status?.phase === 'Running'
      && item.metadata.deletionTimestamp === undefined && runtime.assignments[item.metadata.uid])) {
      const health = containerFor(cluster, pod); const workload = workloadFor(run, cluster, pod)
      if (!health || !workload || health.startedAtMs >= atMs || health.terminatedAtMs !== null || health.restartAtMs !== null) continue
      const uid = pod.metadata.uid
      const cpuLimitM = normalizeContainerResources(pod.spec.containers[0].resources ?? {}).effective.cpuLimitM ?? Infinity
      const usage = runtime.usage[uid] ??= { containerId: health.containerId, workloadDigest: workload.helperDigest,
        cpuDemandM: 0, cpuDeliveredM: 0, cpuThrottledM: 0, memoryBytes: RESOURCE_FIXTURES.baseMemoryMiB * MiB,
        cpuDemandTotalM: 0, cpuDeliveredTotalM: 0, cpuThrottledTotalM: 0,
        backlog: 0, lastAccountedAtMs: atMs - 1000, readySinceMs: health.ready ? health.startedAtMs : null, window: null }
      if (usage.containerId !== health.containerId) {
        usage.containerId = health.containerId; usage.cpuDemandM = 0; usage.cpuDeliveredM = 0; usage.cpuThrottledM = 0
        usage.cpuDemandTotalM = 0; usage.cpuDeliveredTotalM = 0; usage.cpuThrottledTotalM = 0
        usage.memoryBytes = RESOURCE_FIXTURES.baseMemoryMiB * MiB; usage.backlog = 0; usage.readySinceMs = null; usage.window = null
      }
      const assignedWork = workByPod.get(uid) ?? 0
      const profile = experiment ? PROFILES[experiment.profileId] : null
      const unitCost = profile?.kind === 'ai-wait' ? 1 : workload.units
      const isProfileWork = profilePodIds.has(uid) && profile?.kind === 'workload' && experiment?.phase === 'running'
        && (assignedWork > 0 || rate > 0)
      const scratch = isProfileWork ? workload.scratchMiB * MiB : 0
      const memoryBytes = RESOURCE_FIXTURES.baseMemoryMiB * MiB + scratch
      const workDemandM = assignedWork * unitCost
      const demand = 10 + workDemandM
      const cappedDemand = Math.min(demand, cpuLimitM)
      active.push({ uid, pod, health, workload, usage, demand, cappedDemand, memoryBytes, assignedWork, workDemandM, unitCost })
    }
    for (const nodeName of Object.keys(runtime.nodes)) {
      const items = active.filter(item => runtime.assignments[item.uid].nodeName === nodeName)
      const delivered = maxMin(items.map(item => ({ uid: item.uid, demand: item.cappedDemand })), 1000)
      for (const item of items) {
        const got = delivered.get(item.uid) ?? 0
        item.usage.cpuDemandM = item.demand; item.usage.cpuDeliveredM = got
        item.usage.cpuThrottledM = Math.max(0, item.demand - got); item.usage.memoryBytes = item.memoryBytes
        item.usage.cpuDemandTotalM += item.demand; item.usage.cpuDeliveredTotalM += got; item.usage.cpuThrottledTotalM += Math.max(0, item.demand - got)
        item.usage.lastAccountedAtMs = atMs
        item.done = Math.min(item.assignedWork, Math.max(0, got - 10) / item.unitCost)
        const memoryLimit = normalizeContainerResources(item.pod.spec.containers[0].resources ?? {}).effective.memoryLimitBytes ?? Infinity
        const oom = item.memoryBytes > memoryLimit
        item.oom = oom
        if (!oom && item.health.ready && item.usage.readySinceMs === null) item.usage.readySinceMs = startMs
        if (!item.health.ready) item.usage.readySinceMs = null
        const windowStartMs = Math.floor(startMs / 15_000) * 15_000
        if (!item.usage.window || item.usage.window.containerId !== item.health.containerId || item.usage.window.windowStartMs !== windowStartMs) {
          item.usage.window = { containerId: item.health.containerId, windowStartMs, windowEndMs: windowStartMs + 15_000,
            cpuTotalM: 0, memoryPeakBytes: 0, readySeconds: 0, readySinceMs: item.usage.readySinceMs }
        }
        const window = item.usage.window; window.cpuTotalM += got; window.memoryPeakBytes = Math.max(window.memoryPeakBytes, item.memoryBytes)
        if (item.health.ready && !oom && item.usage.readySinceMs !== null) { window.readySeconds++; window.readySinceMs = Math.min(window.readySinceMs, item.usage.readySinceMs) }
        if (experiment?.phase === 'running') {
          experiment.totals.completed += oom ? 0 : item.done
        }
      }
    }
    if (experiment?.phase === 'running') {
      const done = new Map(active.map(item => [item.uid, item.oom ? 0 : item.done]))
      updateBacklog(runtime, experiment, readyPods, totalAvailableWork, done)
      const totalBacklog = experiment.overflowBacklog + Object.values(runtime.usage).reduce((sum, usage) => sum + usage.backlog, 0)
      experiment.totals.remaining = totalBacklog; experiment.totals.peakBacklog = Math.max(experiment.totals.peakBacklog, totalBacklog)
      const pressure = Object.entries(runtime.nodes).some(([nodeName, node]) => {
        const bytes = active.filter(item => runtime.assignments[item.uid].nodeName === nodeName && !item.oom)
          .reduce((sum, item) => sum + item.memoryBytes, 0)
        return bytes > node.allocatableMemoryBytes - node.fixedMemoryBytes
      })
      if (pressure) { experiment.phase = 'unsupported'; experiment.unsupported = 'UNSUPPORTED_NODE_MEMORY_PRESSURE' }
      const drained = totalBacklog < 1e-9
      const boundedEnd = experiment.phaseZeroAtMs + (PROFILES[experiment.profileId].durationSeconds + 300) * 1000
      if (experiment.phase === 'running' && atMs >= experiment.phaseZeroAtMs + PROFILES[experiment.profileId].durationSeconds * 1000
        && (drained || atMs >= boundedEnd)) experiment.phase = 'complete'
    }
    for (const item of active) if (item.oom) {
      oomTargets.push({ clusterId, podUid: item.uid, containerId: item.health.containerId })
    }
  }
  for (const target of oomTargets) {
    run = terminateForMemoryLimit(run, target.clusterId, target.podUid, atMs)
    const runtime = resourceState(run, target.clusterId)
    runtime.receipts.push({ kind: 'container-termination', podUid: target.podUid, containerId: target.containerId,
      reason: 'OOMKilled', exitCode: 137, atMs })
    if (runtime.receipts.length > 40) runtime.receipts.splice(0, runtime.receipts.length - 40)
    const usage = runtime.usage[target.podUid]
    if (usage) {
      usage.cpuDemandM = 0; usage.cpuDeliveredM = 0; usage.cpuThrottledM = 0
      usage.memoryBytes = RESOURCE_FIXTURES.baseMemoryMiB * MiB; usage.window = null
    }
  }
  return run
}
