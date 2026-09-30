import { RESOURCE_FIXTURES } from '../../data/fixtures/aks/resources.js'
import { kubeObjectKey } from './objects.js'
import { getDeploymentPods } from './reconcile.js'
import { terminateForMemoryLimit } from './container-lifecycle.js'
import { normalizeContainerResources } from './resource-schema.js'
import { startResourceExperiment } from './resource-experiments.js'

const clone = value => structuredClone(value)
const MiB = 1024 * 1024
const PROFILES = RESOURCE_FIXTURES.profiles
const isReady = (pod, container) => pod?.status?.phase === 'Running' && pod.metadata.deletionTimestamp === undefined
  && container?.restartAtMs === null && container?.terminatedAtMs === null && container.ready === true
const isAliveForAccounting = (container, atMs) => !!container && container.startedAtMs < atMs
  && (container.terminatedAtMs === null ? container.restartAtMs === null : container.terminatedAtMs >= atMs)

function clusterState(run, clusterId) { return run.runtime.kubernetes.clusters?.[clusterId] }
function resourceState(run, clusterId) { return clusterState(run, clusterId)?.resourcesRuntime }
function podsFor(run, experiment) { return getDeploymentPods(run, experiment.clusterId, experiment.target.namespace, experiment.target.deploymentName) }
function containerFor(state, pod) { return state.health?.containers?.[pod.metadata.uid] }
function workloadFor(run, state, pod) {
  const snapshot = state.podSnapshots?.[pod.metadata.uid]
  return run.artifacts.buildsById?.[snapshot?.artifactId]?.appSpec?.workload ?? null
}

export function startResourceProfileFixture(input, scenarioId, lab) {
  return startResourceExperiment(input, scenarioId, lab)
}

function latestComplete(runtime, uid, containerId, beforeMs) {
  return (runtime.metrics[uid] ?? []).some(item => item.containerId === containerId && item.windowEndMs <= beforeMs)
}

function profileRate(experiment, startMs) {
  const profile = PROFILES[experiment.profileId]
  const elapsed = startMs - experiment.phaseZeroAtMs
  const seconds = elapsed / 1000
  return profile.phases.find(([start, end]) => seconds >= start && seconds < end)?.[2] ?? 0
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
      && runtime.assignments[item.metadata.uid])) {
      const health = containerFor(cluster, pod); const workload = workloadFor(run, cluster, pod)
      if ((!workload && lab?.capabilities?.kubernetesRollouts !== true) || !isAliveForAccounting(health, atMs)) continue
      const uid = pod.metadata.uid
      const cpuLimitM = normalizeContainerResources(pod.spec.containers[0].resources ?? {}).effective.cpuLimitM ?? Infinity
      const usage = runtime.usage[uid] ??= { containerId: health.containerId, workloadDigest: workload?.helperDigest ?? null,
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
      const unitCost = profile?.kind === 'ai-wait' ? 1 : workload?.units ?? 1
      const isProfileWork = profilePodIds.has(uid) && profile?.kind === 'workload' && experiment?.phase === 'running'
        && (assignedWork > 0 || rate > 0)
      const scratch = isProfileWork && workload ? workload.scratchMiB * MiB : 0
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
        const metricReady = isReady(item.pod, item.health) && !oom
        if (metricReady && item.usage.readySinceMs === null) item.usage.readySinceMs = startMs
        if (!metricReady) item.usage.readySinceMs = null
        const windowStartMs = Math.floor(startMs / 15_000) * 15_000
        if (!item.usage.window || item.usage.window.containerId !== item.health.containerId || item.usage.window.windowStartMs !== windowStartMs) {
          item.usage.window = { containerId: item.health.containerId, windowStartMs, windowEndMs: windowStartMs + 15_000,
            cpuTotalM: 0, memoryPeakBytes: 0, readySeconds: 0, readySinceMs: item.usage.readySinceMs }
        }
        const window = item.usage.window; window.cpuTotalM += got; window.memoryPeakBytes = Math.max(window.memoryPeakBytes, item.memoryBytes)
        if (metricReady && item.usage.readySinceMs !== null) { window.readySeconds++; window.readySinceMs = Math.min(window.readySinceMs, item.usage.readySinceMs) }
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
      if (totalBacklog < 1e-9 && Math.abs(experiment.totals.arrivals - experiment.totals.completed) < 1e-9)
        experiment.totals.completed = experiment.totals.arrivals
      const observationSecond = Math.floor((atMs - experiment.phaseZeroAtMs) / 1000)
      if (observationSecond >= 1 && !experiment.observations?.some(item => item.second === observationSecond)) {
        const activeIds = new Set(active.map(item => item.uid))
        const allPods = podsFor(run, experiment)
        const deployment = cluster.resources[`Deployment/${experiment.target.namespace}/${experiment.target.deploymentName}`]
        const observation = { atMs, second: observationSecond, arrivals, completed: [...done.values()].reduce((sum, value) => sum + value, 0),
          remaining: totalBacklog, readyReplicas: readyPods.length, desiredReplicas: deployment?.spec?.replicas ?? 0,
          pods: allPods.map(pod => {
            const uid = pod.metadata.uid; const health = containerFor(cluster, pod); const usage = runtime.usage[uid]
            const seenAtMs = experiment.podSeenAt[uid] ??= atMs
            const resources = pod.spec?.containers?.[0]?.resources ?? {}
            return { uid, nodeName: runtime.assignments[uid]?.nodeName ?? null, phase: pod.status?.phase ?? null,
              ready: isReady(pod, health), createdAtMs: seenAtMs, placementAgeSeconds: (atMs - seenAtMs) / 1000,
              restartCount: health?.restartCount ?? 0, containerId: health?.containerId ?? null,
              cpuRequestM: runtime.assignments[uid]?.cpuRequestM ?? 0, memoryRequestBytes: runtime.assignments[uid]?.memoryRequestBytes ?? 0,
              cpuLimitM: normalizeContainerResources(resources).effective.cpuLimitM ?? null,
              memoryLimitBytes: normalizeContainerResources(resources).effective.memoryLimitBytes ?? null,
              cpuDemandM: activeIds.has(uid) ? usage.cpuDemandM : 0, cpuDeliveredM: activeIds.has(uid) ? usage.cpuDeliveredM : 0,
              cpuThrottledM: activeIds.has(uid) ? usage.cpuThrottledM : 0,
              memoryPeakBytes: usage?.memoryBytes ?? 0, backlog: usage?.backlog ?? 0 }
          }).sort((a, b) => a.uid.localeCompare(b.uid)) }
        experiment.observations ??= []; experiment.observations.push(observation)
        if (experiment.observations.length > 700) experiment.observations.splice(0, experiment.observations.length - 700)
      }
      const pressure = Object.entries(runtime.nodes).some(([nodeName, node]) => {
        const bytes = active.filter(item => runtime.assignments[item.uid].nodeName === nodeName && !item.oom)
          .reduce((sum, item) => sum + item.memoryBytes, 0)
        return bytes > node.allocatableMemoryBytes - node.fixedMemoryBytes
      })
      if (pressure) { experiment.phase = 'unsupported'; experiment.unsupported = 'UNSUPPORTED_NODE_MEMORY_PRESSURE' }
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
