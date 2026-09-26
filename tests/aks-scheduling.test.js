import { describe, expect, it } from 'vitest'
import { schedulePendingPods } from '../src/lib/kubernetes/scheduling.js'
import { seedResourceTest, resourceView, advanceResources, startHealthFault, act } from './helpers/aks.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'

function runWithPendingPod({ cpu = 1250, memory = 128 * 1024 * 1024 } = {}) {
  return {
    nextSequence: 10,
    runtime: { kubernetes: { clusters: { c1: { resources: {
      'Pod/assistant/assistant-1': { kind: 'Pod', metadata: { uid: 'pod-1', namespace: 'assistant', name: 'assistant-1' }, spec: { containers: [{ name: 'api', resources: { requests: { cpu: `${cpu}m`, memory: `${memory}` } } }] }, status: { phase: 'Pending' } },
    }, podSnapshots: {}, events: [], resourcesRuntime: { version: 1, nodes: {
      'worker-a': { allocatableCpuM: 1800, allocatableMemoryBytes: 7168 * 1024 * 1024, fixedCpuM: 800, fixedMemoryBytes: 6144 * 1024 * 1024 },
      'worker-b': { allocatableCpuM: 1800, allocatableMemoryBytes: 7168 * 1024 * 1024, fixedCpuM: 800, fixedMemoryBytes: 6144 * 1024 * 1024 },
    }, assignments: {}, usage: {}, metrics: {}, hpa: {}, experiment: null, receipts: [], incident: null } } } } },
  }
}

describe('AKS resource scheduling', () => {
  it('keeps an oversized resource Pod Pending without a snapshot through the learner build/apply path', () => {
    const { run, target, clusterId } = seedResourceTest({ replicas: 1, resources: { requests: { cpu: '1250m', memory: '128Mi' }, limits: { cpu: '1500m', memory: '256Mi' } } })
    const pod = resourceView(run, target).pods[0]
    expect(pod).toMatchObject({ phase: 'Pending', nodeName: null, schedulingReason: 'Insufficient cpu' })
    expect(run.runtime.kubernetes.clusters[clusterId].podSnapshots[pod.uid]).toBeUndefined()
  })
  it('leaves a 1250m Pod Pending even though total free cluster CPU is 2000m', () => {
    const run = schedulePendingPods(runWithPendingPod(), 'c1', { capabilities: { kubernetesResources: true } })
    const pod = run.runtime.kubernetes.clusters.c1.resources['Pod/assistant/assistant-1']
    expect(pod.status.phase).toBe('Pending')
    expect(pod.spec.nodeName ?? null).toBeNull()
    expect(pod.status.schedulingReason).toBe('Insufficient cpu')
  })

  it('chooses the least CPU-requested fitting node and reserves the effective request', () => {
    const run = runWithPendingPod({ cpu: 500 })
    run.runtime.kubernetes.clusters.c1.resourcesRuntime.assignments.busy = { nodeName: 'worker-a', cpuRequestM: 600, memoryRequestBytes: 0 }
    const scheduled = schedulePendingPods(run, 'c1', { capabilities: { kubernetesResources: true } })
    expect(scheduled.runtime.kubernetes.clusters.c1.resourcesRuntime.assignments['pod-1']).toEqual({ nodeName: 'worker-b', cpuRequestM: 500, memoryRequestBytes: 128 * 1024 * 1024 })
  })

  it('keeps a Pod Pending when aggregate free memory exists but no node can fit it', () => {
    const seeded = seedResourceTest({ replicas: 3, resources: { requests: { cpu: '100m', memory: '600Mi' }, limits: { cpu: '200m', memory: '800Mi' } } })
    expect(resourceView(seeded.run, seeded.target).pods.filter(pod => pod.phase === 'Pending' && pod.schedulingReason === 'Insufficient memory')).toHaveLength(1)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(seeded.run)), seeded.lab)).toBeTruthy()
  })

  it('rejects a reload whose placed Pod reservation or fixed node budget was tampered', () => {
    const seeded = seedResourceTest(); const bad = JSON.parse(JSON.stringify(seeded.run)); const runtime = bad.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime
    delete runtime.assignments[Object.keys(runtime.assignments)[0]]
    expect(() => validateBehavioralRun(bad, seeded.lab)).toThrow()
    const detached = JSON.parse(JSON.stringify(seeded.run)); const uid = Object.keys(detached.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments)[0]
    delete detached.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments[uid]
    delete Object.values(detached.runtime.kubernetes.clusters[seeded.clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.uid === uid).spec.nodeName
    expect(() => validateBehavioralRun(detached, seeded.lab)).toThrow()
    const changed = JSON.parse(JSON.stringify(seeded.run)); changed.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.nodes['worker-a'].fixedCpuM = 1
    expect(() => validateBehavioralRun(changed, seeded.lab)).toThrow()
  })

  it('retains a scheduled Pod reservation across a probe-driven container restart', () => {
    const seeded = seedResourceTest({ replicas: 1 }); let run = advanceResources(seeded.run, seeded.lab, 10)
    const uid = resourceView(run, seeded.target).pods[0].uid; const prior = run.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments[uid]
    const containerId = run.runtime.kubernetes.clusters[seeded.clusterId].health.containers[uid].containerId
    run = startHealthFault(run, seeded.clusterId, uid, 'hung'); run = advanceResources(run, seeded.lab, 60)
    expect(run.runtime.kubernetes.clusters[seeded.clusterId].health.containers[uid].containerId).not.toBe(containerId)
    expect(run.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments[uid]).toEqual(prior)
  })

  it('clears a deleted Pod reservation before reconciliation creates its replacement', () => {
    const seeded = seedResourceTest({ replicas: 1 }); const pod = resourceView(seeded.run, seeded.target).pods[0]
    const name = Object.values(seeded.run.runtime.kubernetes.clusters[seeded.clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.uid === pod.uid).metadata.name
    const run = act(seeded.run, seeded.lab, { type: 'command', line: `kubectl delete pod ${name} -n assistant` }).run
    expect(validateBehavioralRun(run, seeded.lab)).toBeTruthy()
    expect(Object.keys(run.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments)).toHaveLength(1)
    expect(Object.keys(run.runtime.kubernetes.clusters[seeded.clusterId].resourcesRuntime.assignments)).not.toContain(pod.uid)
  })
})
