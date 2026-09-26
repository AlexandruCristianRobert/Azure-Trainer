import { describe, expect, it } from 'vitest'
import { schedulePendingPods } from '../src/lib/kubernetes/scheduling.js'

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
})
