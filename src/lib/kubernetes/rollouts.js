import { resolveRolloutBudget } from './rollout-schema.js'
import { pruneRevisionHistory } from './rollout-history.js'
import { createPod } from './reconcile.js'

const active = pod => pod.metadata.deletionTimestamp === undefined
const ready = pod => active(pod) && pod.status?.phase === 'Running' && pod.status.conditions?.some(item => item.type === 'Ready' && item.status === 'True')
const owner = (item, uid) => item.metadata.ownerReferences?.some(ref => ref.uid === uid)

function select(run, clusterId, deployment) {
  const state = run.runtime.kubernetes.clusters[clusterId]
  const rollout = state.rollouts?.deployments[deployment.metadata.uid]
  const sets = Object.values(state.resources).filter(item => item.kind === 'ReplicaSet' && owner(item, deployment.metadata.uid))
  const pods = Object.values(state.resources).filter(item => item.kind === 'Pod' && sets.some(rs => owner(item, rs.metadata.uid)))
  return { state, rollout, sets, pods, current: sets.find(rs => rs.metadata.uid === rollout?.currentRsUid) }
}

function isAvailable(pod, rollout, minReadySeconds, atMs) {
  return ready(pod) && Number.isFinite(rollout.availableSinceByPod[pod.metadata.uid])
    && atMs - rollout.availableSinceByPod[pod.metadata.uid] >= minReadySeconds * 1000
}

function summary(run, deployment, view) {
  const { rollout, pods } = view
  const desired = deployment.spec.replicas
  const current = pods.filter(pod => owner(pod, rollout.currentRsUid))
  const updated = current.filter(active).length
  const available = pods.filter(pod => isAvailable(pod, rollout, deployment.spec.minReadySeconds ?? 0, run.runtime.simTimeMs)).length
  const terminating = pods.filter(pod => !active(pod)).length
  const complete = updated === desired && current.filter(pod => isAvailable(pod, rollout, deployment.spec.minReadySeconds ?? 0, run.runtime.simTimeMs)).length === desired
    && pods.every(pod => owner(pod, rollout.currentRsUid))
  return { desired, updated, ready: pods.filter(ready).length, available, unavailable: Math.max(0, desired - available), terminating, complete,
    currentRevision: rollout.currentRevision, conditions: structuredClone(rollout.conditions) }
}

export function getRolloutSummary(run, target) {
  const state = run.runtime?.kubernetes?.clusters?.[target.clusterId]
  const deployment = Object.values(state?.resources ?? {}).find(item => item.kind === 'Deployment'
    && (target.deploymentUid ? item.metadata.uid === target.deploymentUid : item.metadata.name === target.deploymentName && item.metadata.namespace === target.namespace))
  if (!deployment || !state.rollouts?.deployments[deployment.metadata.uid]) return null
  return summary(run, deployment, select(run, target.clusterId, deployment))
}

function refreshAvailability(view, atMs) {
  const { rollout, pods, state } = view
  for (const uid of Object.keys(rollout.availableSinceByPod)) if (!pods.some(pod => pod.metadata.uid === uid && ready(pod))) delete rollout.availableSinceByPod[uid]
  for (const pod of pods) {
    const health = state.health?.containers?.[pod.metadata.uid]
    if (!ready(pod) || health && (health.restartAtMs !== null || health.terminatedAtMs !== null)) {
      delete rollout.availableSinceByPod[pod.metadata.uid]
    } else {
      // A new container cannot inherit an earlier container's continuous Ready age.
      const started = health?.startedAtMs ?? 0
      if (rollout.availableSinceByPod[pod.metadata.uid] < started) delete rollout.availableSinceByPod[pod.metadata.uid]
      rollout.availableSinceByPod[pod.metadata.uid] ??= atMs
    }
  }
}

function terminate(view, pod, atMs, graceSeconds = pod.spec.terminationGracePeriodSeconds ?? 30) {
  pod.metadata.deletionTimestamp = atMs
  if (view.state.resourcesRuntime) view.state.resourcesRuntime.terminationDue[pod.metadata.uid] = atMs + graceSeconds * 1000
  delete view.rollout.availableSinceByPod[pod.metadata.uid]
  const container = view.state.health?.containers?.[pod.metadata.uid]
  if (container) {
    container.ready = false
    for (const check of Object.values(container.checks)) if (check) { check.nextAtMs = null; check.pending = null }
  }
}

export function reconcileRollouts(input, clusterId, atMs, lab) {
  if (lab?.capabilities?.kubernetesRollouts !== true) return { run: input, changed: false }
  let run = structuredClone(input)
  const cluster = run.sandbox.aksClusters.find(item => item.id === clusterId)
  const deployments = Object.values(run.runtime.kubernetes.clusters[clusterId]?.resources ?? {}).filter(item => item.kind === 'Deployment')
  for (const deployment of deployments) {
    let view = select(run, clusterId, deployment)
    if (!view.rollout || !view.current) continue
    const D = deployment.spec.replicas
    const experiment = view.state.rollouts.experiment
    if (experiment?.deploymentUid === deployment.metadata.uid && experiment.status === 'active'
      && Number.isInteger(experiment.baselineReplicas) && experiment.baselineReplicas !== D) {
      experiment.status = 'cancelled'; experiment.cancellationReason = 'desired-replicas-changed'; experiment.endedAtMs = atMs
    }
    const stableScale = view.rollout.conditions.some(item => item.type === 'Progressing' && item.reason === 'NewReplicaSetAvailable')
      && view.pods.every(pod => owner(pod, view.current.metadata.uid) && active(pod))
    const { surge: S, unavailable: U } = resolveRolloutBudget(deployment.spec.strategy?.rollingUpdate ?? { maxSurge: '25%', maxUnavailable: '25%' }, D)
    refreshAvailability(view, atMs)
    let converged = false
    for (let pass = 0; pass < 300; pass++) {
      view = select(run, clusterId, deployment)
      let structural = false
      const currentPods = view.pods.filter(pod => active(pod) && owner(pod, view.current.metadata.uid))
      const count = Math.max(0, Math.min(D - currentPods.length, D + S - view.pods.filter(active).length))
      for (let i = 0; i < count; i++) { createPod(run, cluster, deployment, view.current, currentPods.length + i); structural = true }
      view = select(run, clusterId, deployment)
      let available = view.pods.filter(pod => isAvailable(pod, view.rollout, deployment.spec.minReadySeconds ?? 0, atMs)).length
      const revisions = new Map(view.rollout.revisions.map(item => [item.rsUid, item.revision]))
      const old = view.pods.filter(pod => active(pod) && !owner(pod, view.current.metadata.uid)).sort((a, b) =>
        revisions.get(a.metadata.ownerReferences[0].uid) - revisions.get(b.metadata.ownerReferences[0].uid) || b.metadata.uid.localeCompare(a.metadata.uid))
      // Failed old Pods retire first, then available old Pods in revision/UID order.
      const ordered = [...old.filter(pod => !isAvailable(pod, view.rollout, deployment.spec.minReadySeconds ?? 0, atMs)),
        ...old.filter(pod => isAvailable(pod, view.rollout, deployment.spec.minReadySeconds ?? 0, atMs))]
      for (const pod of ordered) {
        const healthy = isAvailable(pod, view.rollout, deployment.spec.minReadySeconds ?? 0, atMs)
        if (healthy && available - 1 < D - U) continue
        terminate(view, pod, atMs); if (healthy) available--; structural = true
      }
      const currentActive = view.pods.filter(pod => active(pod) && owner(pod, view.current.metadata.uid))
      const excess = stableScale ? currentActive.slice(D) : [...currentActive].sort((a, b) =>
        Number(isAvailable(a, view.rollout, deployment.spec.minReadySeconds ?? 0, atMs)) - Number(isAvailable(b, view.rollout, deployment.spec.minReadySeconds ?? 0, atMs))
        || b.metadata.uid.localeCompare(a.metadata.uid)).slice(0, Math.max(0, currentActive.length - D))
      for (const pod of excess) {
        const healthy = isAvailable(pod, view.rollout, deployment.spec.minReadySeconds ?? 0, atMs)
        if (!stableScale && healthy && available - 1 < D - U) continue
        terminate(view, pod, atMs, stableScale && view.state.resourcesRuntime ? 1 : undefined)
        if (healthy) available--
        structural = true
      }
      for (const rs of view.sets) {
        const replicas = Object.values(view.state.resources).filter(pod => pod.kind === 'Pod' && active(pod) && owner(pod, rs.metadata.uid)).length
        if (rs.spec.replicas !== replicas) { rs.spec.replicas = replicas; rs.metadata.resourceVersion = String(Number(rs.metadata.resourceVersion) + 1) }
      }
      if (!structural) { converged = true; break }
    }
    if (!converged) throw new Error('Rolling update controller did not converge within its bounded passes.')
    view = select(run, clusterId, deployment)
    refreshAvailability(view, atMs)
    const status = summary(run, deployment, view)
    const next = { updated: status.updated, ready: view.pods.filter(pod => owner(pod, view.current.metadata.uid) && ready(pod)).length,
      available: view.pods.filter(pod => owner(pod, view.current.metadata.uid) && isAvailable(pod, view.rollout, deployment.spec.minReadySeconds ?? 0, atMs)).length,
      oldActive: view.pods.filter(pod => active(pod) && !owner(pod, view.current.metadata.uid)).length }
    const previous = view.rollout.progressSnapshot
    const progress = next.updated > previous.updated || next.ready > previous.ready || next.available > previous.available || next.oldActive < previous.oldActive
    if (progress) view.rollout.lastProgressAtMs = atMs
    view.rollout.observedGeneration = deployment.metadata.generation ?? 1
    view.rollout.progressSnapshot = next
    const exceeded = !status.complete && atMs - view.rollout.lastProgressAtMs >= (deployment.spec.progressDeadlineSeconds ?? 600) * 1000
    view.rollout.conditions = [{ type: 'Available', status: status.available >= D - U ? 'True' : 'False', reason: status.available >= D - U ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable' },
      { type: 'Progressing', status: exceeded ? 'False' : 'True', reason: status.complete ? 'NewReplicaSetAvailable' : exceeded ? 'ProgressDeadlineExceeded' : 'ReplicaSetUpdated' }]
    if (status.complete) run = pruneRevisionHistory(run, { clusterId, deploymentUid: deployment.metadata.uid })
  }
  return { run, changed: JSON.stringify(run) !== JSON.stringify(input) }
}

export function nextRolloutDeadline(run, limit) {
  let next = null
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes.clusters ?? {})) for (const deployment of Object.values(state.resources).filter(item => item.kind === 'Deployment')) {
    const view = select(run, clusterId, deployment)
    if (!view.rollout) continue
    const times = Object.values(view.rollout.availableSinceByPod).map(value => value + (deployment.spec.minReadySeconds ?? 0) * 1000)
    if (!summary(run, deployment, view).complete) times.push(view.rollout.lastProgressAtMs + (deployment.spec.progressDeadlineSeconds ?? 600) * 1000)
    for (const value of times) if (value > run.runtime.simTimeMs && value <= limit && (next === null || value < next)) next = value
  }
  return next
}
