import { expect, test } from 'vitest'
import { releaseTestRun, applyReleaseTemplate, seedFoundation, act, RELEASE_TEST_LAB as lab, RELEASE_TARGET as target } from './helpers/aks.js'
import { createPod, getDeploymentPods, retryPendingPod } from '../src/lib/kubernetes/reconcile.js'
import { advanceKubernetesTime } from '../src/lib/kubernetes/time.js'
import { getServiceBackends } from '../src/lib/kubernetes/services.js'
import { getRolloutSummary, reconcileRollouts } from '../src/lib/kubernetes/rollouts.js'
import { validateKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { parse, stringify } from 'yaml'
import { terminateForMemoryLimit } from '../src/lib/kubernetes/container-lifecycle.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { schedulePendingPods } from '../src/lib/kubernetes/scheduling.js'

const state = run => run.runtime.kubernetes.clusters[target.clusterId]
const deployment = run => state(run).resources['Deployment/assistant/assistant-api']
const history = run => state(run).rollouts.deployments[deployment(run).metadata.uid]
const status = run => getRolloutSummary(run, target)
const applySpec = (run, change) => {
  const value = parse(run.project.savedFiles['k8s/deployment.yaml'])
  change(value.spec)
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(value) }).run
  return act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
}

const pods = run => getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
const live = run => pods(run).filter(pod => pod.metadata.deletionTimestamp === undefined)

test('starts desired release replicas through the resource and probe lifecycle', () => {
  const run = releaseTestRun()
  expect(live(run)).toHaveLength(2)
  expect(getServiceBackends(run, target).readyEndpoints).toHaveLength(2)
})

test('keeps two old backends until the surge Pod is available, although Ready adds a backend earlier', () => {
  let run = applyReleaseTemplate(releaseTestRun(), {})
  expect(live(run)).toHaveLength(3)
  run = advanceKubernetesTime(run, 10, lab)
  expect(status(run)).toMatchObject({ updated: 1, ready: 3, available: 2, terminating: 0, complete: false })
  expect(getServiceBackends(run, target).readyEndpoints).toHaveLength(3)
  expect(pods(run).filter(pod => pod.metadata.deletionTimestamp !== undefined)).toHaveLength(0)
  run = advanceKubernetesTime(run, 5, lab)
  expect(getServiceBackends(run, target).readyEndpoints).toHaveLength(2)
  expect(pods(run).filter(pod => pod.metadata.deletionTimestamp !== undefined)).toHaveLength(1)
})

test('withdraws terminating endpoints immediately, reserves and accounts their exact grace, then completes', () => {
  let run = applyReleaseTemplate(releaseTestRun({ graceSeconds: 7 }), {})
  run = advanceKubernetesTime(run, 15, lab)
  const old = pods(run).find(pod => pod.metadata.deletionTimestamp !== undefined)
  expect(state(run).resourcesRuntime.assignments[old.metadata.uid]).toBeDefined()
  expect(state(run).resourcesRuntime.usage[old.metadata.uid]).toBeDefined()
  const before = state(run).resourcesRuntime.usage[old.metadata.uid].cpuDeliveredTotalM
  expect(before).toBeGreaterThan(0)
  run = advanceKubernetesTime(run, 6, lab)
  expect(state(run).resourcesRuntime.usage[old.metadata.uid].cpuDeliveredTotalM).toBe(before + 60)
  run = advanceKubernetesTime(run, 1, lab)
  expect(state(run).resourcesRuntime.assignments[old.metadata.uid]).toBeUndefined()
  run = advanceKubernetesTime(run, 30, lab)
  expect(status(run)).toMatchObject({ updated: 2, ready: 2, available: 2, terminating: 0, complete: true })
  expect(pods(run).every(pod => pod.metadata.ownerReferences[0].uid === history(run).currentRsUid)).toBe(true)
  expect(status(run).conditions).toContainEqual({ type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' })
})

test('reports a deadline failure with healthy old traffic and no automatic rollback; real repair resumes progress', () => {
  let run = applyReleaseTemplate(releaseTestRun({ progressDeadlineSeconds: 20 }), { readinessPath: '/health/missing' })
  const current = history(run).currentRsUid
  run = advanceKubernetesTime(run, 20, lab)
  expect(status(run)).toMatchObject({ ready: 2, available: 2, updated: 1, complete: false, currentRevision: 2 })
  expect(status(run).conditions).toContainEqual({ type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded' })
  expect(getServiceBackends(run, target).readyEndpoints).toHaveLength(2)
  expect(history(run).currentRsUid).toBe(current)
  const service = state(run).resources['Service/assistant/assistant-public']
  const request = routeServiceRequest(run, { origin: { kind: 'external', clusterId: target.clusterId },
    hostname: service.status.loadBalancer.ingress[0].ip, port: 80, method: 'GET', path: '/api/info' }, lab)
  expect(request.outcome).toMatchObject({ status: 200, body: { version: '1.0' } })
  expect(run.runtime.simTimeMs).toBe(35000)
  const copy = structuredClone(run)
  getRolloutSummary(run, target); getRolloutSummary(run, target)
  expect(run).toEqual(copy)
  run = applyReleaseTemplate(run, {})
  expect(status(run).conditions.find(item => item.type === 'Progressing').status).toBe('True')
  run = advanceKubernetesTime(run, 90, lab)
  expect(status(run).complete).toBe(true)
})

test('readiness loss clears continuous availability age and waits a full fresh minReady period', () => {
  let run = releaseTestRun()
  const pod = live(run)[0]; const uid = pod.metadata.uid
  state(run).health.containers[uid].localFaults.admissionClosed = true
  run = advanceKubernetesTime(run, 2, lab)
  expect(status(run).available).toBe(1)
  expect(history(run).availableSinceByPod[uid]).toBeUndefined()
  state(run).health.containers[uid].localFaults.admissionClosed = false
  run = advanceKubernetesTime(run, 2, lab)
  expect(status(run).ready).toBe(2)
  expect(status(run).available).toBe(1)
  expect(history(run).availableSinceByPod[uid]).toBe(18000)
  run = advanceKubernetesTime(run, 3, lab)
  expect(status(run).available).toBe(1)
  run = advanceKubernetesTime(run, 1, lab)
  expect(status(run).available).toBe(2)
})

test('a container restart cannot reuse the previous availability timer', () => {
  let run = releaseTestRun()
  const uid = live(run)[0].metadata.uid
  run = terminateForMemoryLimit(run, target.clusterId, uid, run.runtime.simTimeMs)
  run = reconcileRollouts(run, target.clusterId, run.runtime.simTimeMs, lab).run
  expect(history(run).availableSinceByPod[uid]).toBeUndefined()
  run = advanceKubernetesTime(run, 20, lab)
  expect(status(run)).toMatchObject({ ready: 2, available: 1 })
  run = advanceKubernetesTime(run, 5, lab)
  expect(status(run).available).toBe(2)
})

test('Pending surge Pods occupy surge slots while full nodes preserve healthy old replicas', () => {
  let run = releaseTestRun({ resources: { requests: { cpu: '1000m', memory: '128Mi' }, limits: { cpu: '1000m', memory: '256Mi' } }, progressDeadlineSeconds: 20 })
  run = applyReleaseTemplate(run, {})
  expect(live(run)).toHaveLength(3)
  expect(live(run).filter(pod => pod.status.phase === 'Pending')).toHaveLength(1)
  run = advanceKubernetesTime(run, 25, lab)
  expect(status(run)).toMatchObject({ updated: 1, ready: 2, available: 2, terminating: 0, complete: false })
  expect(live(run).find(pod => pod.status.phase === 'Pending').status.schedulingReason).toBe('Insufficient cpu')
})

test('one advance and many advances yield identical timed state, including mid-rollout reload', () => {
  const start = applyReleaseTemplate(releaseTestRun(), {})
  const single = advanceKubernetesTime(start, 95, lab)
  let chunks = structuredClone(start)
  for (const seconds of [3, 7, 5, 11, 9, 30, 30]) {
    chunks = advanceKubernetesTime(JSON.parse(JSON.stringify(chunks)), seconds, lab)
    expect(validateKubernetesRuntime(chunks.runtime.kubernetes, chunks, lab)).toBe(true)
  }
  const differences = (a, b, path = '') => {
    if (JSON.stringify(a) === JSON.stringify(b)) return []
    if (a && b && typeof a === 'object' && typeof b === 'object') return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => differences(a[key], b[key], `${path}.${key}`))
    return [{ path, a, b }]
  }
  expect(differences(chunks, JSON.parse(JSON.stringify(single))).slice(0, 10)).toEqual([])
  expect(status(single).complete).toBe(true)
})

test('no-op and stable replica-only apply retain revision and scale without replacing the template', () => {
  let run = releaseTestRun(); const revision = history(run).currentRevision; const oldUids = live(run).map(pod => pod.metadata.uid)
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  expect(live(run).map(pod => pod.metadata.uid)).toEqual(oldUids)
  run = applySpec(run, spec => { spec.replicas = 3 })
  expect(history(run).currentRevision).toBe(revision)
  expect(live(run)).toHaveLength(3)
  run = advanceKubernetesTime(run, 15, lab)
  expect(status(run).complete).toBe(true)
  run = applySpec(run, spec => { spec.replicas = 1 })
  expect(live(run)).toHaveLength(1)
  expect(live(run)[0].metadata.uid).toBe(oldUids[0])
  expect(history(run).currentRevision).toBe(revision)
})

test('mid-rollout scaling fills current capacity and reduces old replicas within the new budget', () => {
  let run = applyReleaseTemplate(releaseTestRun(), {})
  run = applySpec(run, spec => { spec.replicas = 3 })
  expect(status(run)).toMatchObject({ desired: 3, updated: 2, currentRevision: 2 })
  run = advanceKubernetesTime(run, 15, lab)
  expect(status(run).available).toBeGreaterThanOrEqual(3)
  run = applySpec(run, spec => { spec.replicas = 1 })
  expect(live(run)).toHaveLength(1)
  expect(live(run).every(pod => pod.metadata.ownerReferences[0].uid === history(run).currentRsUid)).toBe(true)
})

test.each([[3, '25%', '0%', 4], [2, 0, '25%', 2], [2, '50%', '50%', 3]])('controller resolves rounding budgets %i %s %s', (replicas, maxSurge, maxUnavailable, count) => {
  let run = releaseTestRun({ replicas, maxSurge, maxUnavailable })
  run = applyReleaseTemplate(run, {})
  expect(live(run)).toHaveLength(count)
  run = advanceKubernetesTime(run, 180, lab)
  expect(status(run)).toMatchObject({ desired: replicas, updated: replicas, complete: true })
})

test('retained ReplicaSet creates and retries from its own image, probes and configuration references', () => {
  let run = releaseTestRun()
  const old = Object.values(state(run).resources).find(item => item.kind === 'ReplicaSet')
  run = applyReleaseTemplate(run, {})
  const oldSet = Object.values(state(run).resources).find(item => item.metadata.uid === old.metadata.uid)
  const cluster = run.sandbox.aksClusters[0]
  const created = createPod(run, cluster, deployment(run), oldSet, 9)
  run = schedulePendingPods(run, target.clusterId, lab)
  const pod = pods(run).find(item => item.metadata.uid === created.metadata.uid)
  expect(pod.spec.containers[0].image).toContain('release-v1')
  // A retained Pod must resolve its original references even if the desired
  // template introduces an unavailable key. Configuration remains current.
  deployment(run).spec.template.spec.containers[0].env.push({ name: 'NEW_ONLY', valueFrom: { configMapKeyRef: { name: 'assistant-config', key: 'missing' } } })
  expect(state(run).resourcesRuntime.assignments[pod.metadata.uid]).toBeDefined()
  retryPendingPod(run, cluster, deployment(run), pod)
  expect(pod.status.phase).toBe('Running')
  expect(state(run).podSnapshots[pod.metadata.uid].artifactId).toBe(run.artifacts.publishedTags['acraksreleasesguided.azurecr.io/assistant:release-v1'])
})

test('completion prunes zero-Pod history, preserving current and the configured old revisions', () => {
  let run = releaseTestRun({ revisionHistoryLimit: 0, graceSeconds: 7 })
  run = applyReleaseTemplate(run, {})
  expect(history(run).revisions).toHaveLength(2)
  run = advanceKubernetesTime(run, 60, lab)
  expect(status(run).complete).toBe(true)
  expect(history(run).revisions).toHaveLength(1)
  expect(Object.values(state(run).resources).filter(item => item.kind === 'ReplicaSet')).toHaveLength(1)
})

test('resident terminating Pods can temporarily exceed surge while their reservations block another surge start', () => {
  let run = applyReleaseTemplate(releaseTestRun({ replicas: 3, graceSeconds: 7,
    resources: { requests: { cpu: '500m', memory: '128Mi' }, limits: { cpu: '500m', memory: '256Mi' } } }), {})
  run = advanceKubernetesTime(run, 15, lab)
  expect(pods(run)).toHaveLength(5)
  expect(live(run)).toHaveLength(4)
  expect(status(run)).toMatchObject({ available: 3, terminating: 1 })
  expect(live(run).filter(pod => pod.status.phase === 'Pending')).toHaveLength(1)
  run = advanceKubernetesTime(run, 6, lab)
  expect(live(run).filter(pod => pod.status.phase === 'Pending')).toHaveLength(1)
  run = advanceKubernetesTime(run, 1, lab)
  expect(live(run).filter(pod => pod.status.phase === 'Pending')).toHaveLength(0)
  run = advanceKubernetesTime(run, 90, lab)
  expect(status(run)).toMatchObject({ available: 3, terminating: 0, complete: true })
})

test('stalled timing and Pending events are invariant across clock partitions and reload', () => {
  const initial = applyReleaseTemplate(releaseTestRun({ progressDeadlineSeconds: 20,
    resources: { requests: { cpu: '1000m', memory: '128Mi' }, limits: { cpu: '1000m', memory: '256Mi' } } }), {})
  const one = advanceKubernetesTime(initial, 25, lab)
  let chunks = initial
  for (let i = 0; i < 5; i++) chunks = advanceKubernetesTime(JSON.parse(JSON.stringify(chunks)), 5, lab)
  expect(state(chunks).events).toEqual(state(one).events)
  expect(history(chunks)).toEqual(history(one))
  expect(state(chunks).health).toEqual(state(one).health)
  expect(status(one).conditions.find(item => item.type === 'Progressing').reason).toBe('ProgressDeadlineExceeded')
})

test('unchanged apply and old readiness successes do not refresh a stalled progress deadline', () => {
  let run = applyReleaseTemplate(releaseTestRun({ progressDeadlineSeconds: 20 }), { readinessPath: '/health/missing' })
  const atMs = history(run).lastProgressAtMs
  run = advanceKubernetesTime(run, 19, lab)
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  expect(history(run).lastProgressAtMs).toBe(atMs)
  run = advanceKubernetesTime(run, 1, lab)
  expect(status(run).conditions.find(item => item.type === 'Progressing').reason).toBe('ProgressDeadlineExceeded')
})

test('rollout-capable saved Foundation runs use the shared grace clock without adding resource capability', () => {
  const seeded = seedFoundation()
  const compatibleLab = { ...seeded.lab, capabilities: { ...seeded.lab.capabilities, kubernetesRollouts: true } }
  let run = seeded.run
  const value = parse(run.project.savedFiles['k8s/deployment.yaml'])
  value.spec.template.metadata.annotations = { release: 'new' }
  run = act(run, compatibleLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(value) }).run
  run = act(run, compatibleLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  run = advanceKubernetesTime(run, 30, compatibleLab)
  expect(getRolloutSummary(run, { clusterId: seeded.clusterId, namespace: 'assistant', deploymentName: 'assistant' }).complete).toBe(true)
  expect(run.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime).toBeUndefined()
  expect(validateKubernetesRuntime(run.runtime.kubernetes, run, compatibleLab)).toBe(true)
})

test('stable replica-only decrease preserves the preceding resource topic one-second scale grace', () => {
  let run = releaseTestRun()
  run = applySpec(run, spec => { spec.replicas = 1 })
  expect(status(run).terminating).toBe(1)
  expect(status(run).complete).toBe(true)
  run = advanceKubernetesTime(run, 1, lab)
  expect(status(run)).toMatchObject({ terminating: 0, complete: true })
})

test.each(['apply', 'manual'])('desired replicas changed by %s cancel only the matching active baseline experiment', cause => {
  let run = releaseTestRun()
  state(run).rollouts.experiment = { status: 'active', deploymentUid: deployment(run).metadata.uid, baselineReplicas: 2 }
  if (cause === 'apply') run = applySpec(run, spec => { spec.replicas = 3 })
  else run = act(run, lab, { type: 'command', line: 'kubectl scale deployment/assistant-api --replicas 3 -n assistant' }).run
  expect(state(run).rollouts.experiment).toMatchObject({ status: 'cancelled', cancellationReason: 'desired-replicas-changed', endedAtMs: 15000 })
  expect(status(run).desired).toBe(3)
})

test('unrelated and old experiment records are left alone by replica changes', () => {
  for (const experiment of [{ status: 'active', deploymentUid: 'other', baselineReplicas: 2 }, { status: 'finished', baselineReplicas: 2 }, { status: 'active' }]) {
    let run = releaseTestRun()
    state(run).rollouts.experiment = { deploymentUid: deployment(run).metadata.uid, ...experiment }
    const original = structuredClone(state(run).rollouts.experiment)
    run = applySpec(run, spec => { spec.replicas = 3 })
    expect(state(run).rollouts.experiment).toEqual(original)
  }
})

test('repairing a missing ConfigMap key resumes the same failed revision without restoring old configuration', () => {
  let run = applyReleaseTemplate(releaseTestRun({ progressDeadlineSeconds: 20 }), {})
  run = applySpec(run, spec => { spec.template.spec.containers[0].env.push({ name: 'RELEASE_SETTING', valueFrom: { configMapKeyRef: { name: 'assistant-config', key: 'RELEASE_SETTING' } } }) })
  run = advanceKubernetesTime(run, 20, lab)
  const revision = history(run).currentRevision
  expect(status(run).conditions.find(item => item.type === 'Progressing').reason).toBe('ProgressDeadlineExceeded')
  const config = parse(run.project.savedFiles['k8s/configmap.yaml'])
  config.data.RELEASE_SETTING = 'repaired-current-value'
  run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text: stringify(config) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run
  run = advanceKubernetesTime(run, 10, lab)
  expect(history(run).currentRevision).toBe(revision)
  expect(status(run).conditions.find(item => item.type === 'Progressing').status).toBe('True')
  run = advanceKubernetesTime(run, 60, lab)
  expect(status(run).complete).toBe(true)
  expect(pods(run).every(pod => state(run).podSnapshots[pod.metadata.uid].environment.RELEASE_SETTING === 'repaired-current-value')).toBe(true)
})

test('terminating Pods keep their live grace process but stop scheduling new probe/restart work', () => {
  let run = applyReleaseTemplate(releaseTestRun({ graceSeconds: 30 }), {})
  run = advanceKubernetesTime(run, 15, lab)
  const old = pods(run).find(pod => pod.metadata.deletionTimestamp !== undefined)
  const uid = old.metadata.uid
  state(run).health.containers[uid].localFaults.hung = true
  const deletedAtMs = run.runtime.simTimeMs
  run = advanceKubernetesTime(run, 10, lab)
  expect(state(run).health.events.filter(event => event.podUid === uid && event.type === 'probe-start' && event.atMs > deletedAtMs)).toEqual([])
  expect(state(run).health.containers[uid].restartAtMs).toBeNull()
  expect(state(run).resourcesRuntime.usage[uid].cpuDeliveredM).toBe(10)
})

test('mid-rollout scale-down retires excess unavailable current Pods before consuming current availability', () => {
  let run = applyReleaseTemplate(releaseTestRun({ replicas: 3, maxSurge: 3 }), {})
  run = advanceKubernetesTime(run, 10, lab)
  const current = live(run).filter(pod => pod.metadata.ownerReferences[0].uid === history(run).currentRsUid)
  state(run).health.containers[current[0].metadata.uid].localFaults.admissionClosed = true
  run = advanceKubernetesTime(run, 5, lab)
  expect(status(run).available).toBe(3)
  run = applySpec(run, spec => { spec.replicas = 1 })
  expect(status(run)).toMatchObject({ updated: 1, available: 1, ready: 1 })
  expect(live(run)[0].metadata.uid).not.toBe(current[0].metadata.uid)
})
