import { describe, expect, it } from 'vitest'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { getServiceBackends } from '../src/lib/kubernetes/services.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { act, advanceHealth, healthContainer, seedHealthTest, startHealthFault } from './helpers/aks.js'

const stateFor = (run, clusterId) => run.runtime.kubernetes.clusters[clusterId]

function restartSeed() {
  return seedHealthTest({ startupSeconds: 0, probeOverrides: {
    livenessProbe: { initialDelaySeconds: 0, periodSeconds: 1, timeoutSeconds: 1, failureThreshold: 1 },
  } })
}

function failLiveness({ lab, run, clusterId, podUid }) {
  let next = startHealthFault(run, clusterId, podUid, 'hung')
  next = advanceHealth(next, lab, 1)
  return advanceHealth(next, lab, 1)
}

function restartAtDeadline(run, lab, clusterId, podUid) {
  const container = healthContainer(run, clusterId, podUid)
  if (!Number.isFinite(container.restartAtMs)) throw new Error('Liveness failure did not schedule a restart')
  const seconds = Math.ceil((container.restartAtMs - run.runtime.simTimeMs) / 1000)
  return advanceHealth(run, lab, Math.max(1, seconds))
}

describe('AKS container restart lifecycle', () => {
  it('restarts a container in the same Pod after liveness failure and retains previous logs', () => {
    const { lab, run: initial, clusterId, podUids, target } = restartSeed()
    const run = advanceHealth(initial, lab, 1)
    const podUid = podUids[0]
    const pod = getDeploymentPods(run, clusterId, 'assistant', 'assistant').find(item => item.metadata.uid === podUid)
    const before = healthContainer(run, clusterId, podUid)
    const initialState = stateFor(run, clusterId).health.containers[podUid]
    initialState.currentLogs.push('container started')
    const failed = failLiveness({ lab, run, clusterId, podUid })
    expect(healthContainer(failed, clusterId, podUid).containerId).toBe(before.containerId)
    const restarted = restartAtDeadline(failed, lab, clusterId, podUid)
    const currentPod = getDeploymentPods(restarted, clusterId, 'assistant', 'assistant').find(item => item.metadata.uid === podUid)
    const after = healthContainer(restarted, clusterId, podUid)

    expect(currentPod.metadata.uid).toBe(pod.metadata.uid)
    expect(after.containerId).not.toBe(before.containerId)
    expect(after.restartCount).toBe(1)
    expect(after.previous).toMatchObject({ containerId: before.containerId, logs: ['container started'] })
    expect(after.startedAtMs).toBeGreaterThan(before.startedAtMs)
    expect(getServiceBackends(failed, target).readyEndpoints.map(item => item.podUid)).not.toContain(podUid)
  })

  it('uses 10, 20, and 40 second exponential restart backoff delays', () => {
    const { lab, run: initial, clusterId, podUids } = restartSeed()
    const podUid = podUids[0]
    let current = advanceHealth(initial, lab, 1)
    const delays = []
    for (const delay of [10, 20, 40]) {
      const failed = failLiveness({ lab, run: current, clusterId, podUid })
      const container = healthContainer(failed, clusterId, podUid)
      expect(container.restartAtMs - container.terminatedAtMs).toBe(delay * 1000)
      delays.push(container.restartAtMs - container.terminatedAtMs)
      current = restartAtDeadline(startHealthFault(failed, clusterId, podUid, 'hung', false), lab, clusterId, podUid)
      expect(healthContainer(current, clusterId, podUid).restartCount).toBe(delays.length)
    }
    expect(delays).toEqual([10_000, 20_000, 40_000])
  })

  it('does not restart for readiness failures and withdraws then restores the EndpointSlice endpoint', () => {
    const { lab, run: initial, clusterId, podUids, target } = seedHealthTest({ startupSeconds: 0,
      probeOverrides: { readinessProbe: { periodSeconds: 1, failureThreshold: 1 } } })
    const run = advanceHealth(initial, lab, 1)
    const podUid = podUids[0]
    const before = healthContainer(run, clusterId, podUid)
    expect(getServiceBackends(run, target).readyEndpoints).toHaveLength(2)
    const failed = advanceHealth(startHealthFault(run, clusterId, podUid, 'admissionClosed'), lab, 1)
    expect(healthContainer(failed, clusterId, podUid)).toMatchObject({ ready: false, restartCount: 0, containerId: before.containerId })
    expect(getServiceBackends(failed, target).readyEndpoints).toHaveLength(1)
    const restored = advanceHealth(startHealthFault(failed, clusterId, podUid, 'admissionClosed', false), lab, 1)
    expect(healthContainer(restored, clusterId, podUid)).toMatchObject({ ready: true, restartCount: 0, containerId: before.containerId })
    expect(getServiceBackends(restored, target).readyEndpoints).toHaveLength(2)
  })

  it('distinguishes container restart, manual rollout restart, and Pod deletion identities', () => {
    const { lab, run: initial, clusterId, podUids } = restartSeed()
    const run = advanceHealth(initial, lab, 1)
    const podUid = podUids[0]
    const failed = failLiveness({ lab, run, clusterId, podUid })
    const restarted = restartAtDeadline(failed, lab, clusterId, podUid)
    const containerRestart = healthContainer(restarted, clusterId, podUid)
    expect(containerRestart.restartCount).toBe(1)
    const rolled = act(restarted, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' }).run
    const afterRollout = getDeploymentPods(rolled, clusterId, 'assistant', 'assistant')
    expect(afterRollout.map(item => item.metadata.uid)).not.toContain(podUid)
    expect(afterRollout).toHaveLength(2)
    expect(stateFor(rolled, clusterId).receipts.at(-1)?.cause).toBe('template')

    const first = afterRollout[0]
    const deleted = act(rolled, lab, { type: 'command', line: `kubectl delete pod ${first.metadata.name} -n assistant` }).run
    const replacements = getDeploymentPods(deleted, clusterId, 'assistant', 'assistant')
    expect(replacements).toHaveLength(2)
    expect(replacements.map(item => item.metadata.uid)).not.toContain(first.metadata.uid)
    expect(stateFor(deleted, clusterId).receipts.at(-1)).toMatchObject({ cause: 'pod-delete', deletedPodUid: first.metadata.uid })
  })

  it('preserves the old image and configuration snapshot until a new Pod is created', () => {
    const { lab, run: initial, clusterId, podUids } = seedHealthTest({ startupSeconds: 0 })
    const podUid = podUids[0]
    const originalRun = advanceHealth(initial, lab, 1)
    const originalSnapshot = structuredClone(stateFor(originalRun, clusterId).podSnapshots[podUid])
    const originalArtifact = originalSnapshot.artifactId
    let changed = act(originalRun, lab, { type: 'save-file', path: 'k8s/configmap.yaml',
      text: originalRun.project.savedFiles['k8s/configmap.yaml'].replace('PGHOST: pg-training.example', 'PGHOST: pg-v2.example') }).run
    changed = act(changed, lab, { type: 'save-file', path: 'app.py',
      text: changed.project.savedFiles['app.py'].replace('SERVICE_VERSION = "2.0"', 'SERVICE_VERSION = "2.1"') }).run
    changed = act(changed, lab, { type: 'command', line: 'az acr build --registry acraksprobesguided -t assistant:health-v2 .' }).run
    changed = act(changed, lab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run
    const configUpdated = stateFor(changed, clusterId)
    expect(configUpdated.podSnapshots[podUid].artifactId).toBe(originalArtifact)
    expect(configUpdated.podSnapshots[podUid].environment.PGHOST).toBe('pg-training.example')
    const deployment = changed.project.savedFiles['k8s/deployment.yaml'].replace('assistant:health-v1', 'assistant:health-v2')
    changed = act(changed, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: deployment }).run
    changed = act(changed, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    const replacements = getDeploymentPods(changed, clusterId, 'assistant', 'assistant')
    expect(originalSnapshot.environment.PGHOST).toBe('pg-training.example')
    expect(replacements.every(item => item.metadata.uid !== podUid)).toBe(true)
    expect(replacements.every(item => stateFor(changed, clusterId).podSnapshots[item.metadata.uid].artifactId !== originalArtifact)).toBe(true)
    expect(replacements.every(item => stateFor(changed, clusterId).podSnapshots[item.metadata.uid].environment.PGHOST === 'pg-v2.example')).toBe(true)
  })

  it('round-trips restart state through behavioral run validation', () => {
    const { lab, run: initial, clusterId, podUids } = restartSeed()
    const run = advanceHealth(initial, lab, 1)
    const failed = failLiveness({ lab, run, clusterId, podUid: podUids[0] })
    const saved = JSON.parse(JSON.stringify(failed))
    expect(validateBehavioralRun(saved, lab)).toBe(saved)
    expect(healthContainer(saved, clusterId, podUids[0])).toMatchObject({ restartAtMs: expect.any(Number), terminatedAtMs: expect.any(Number) })
    const restored = restartAtDeadline(saved, lab, clusterId, podUids[0])
    expect(healthContainer(restored, clusterId, podUids[0])).toMatchObject({ restartCount: 1, previous: { containerId: expect.any(String) } })
  })
})
