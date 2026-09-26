import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { seedResourceTest, advanceResources, act } from './helpers/aks.js'
import { reconcileHpa } from '../src/lib/kubernetes/hpa.js'

const HPA = {
  apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler',
  metadata: { name: 'assistant-cpu', namespace: 'assistant' },
  spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'assistant' }, minReplicas: 2, maxReplicas: 4,
    metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 60 } } }],
    behavior: { scaleDown: { stabilizationWindowSeconds: 60 } } },
}

function applyHpa(c, hpa = HPA) {
  let run = act(c.run, c.lab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(hpa) }).run
  return act(run, c.lab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }).run
}

describe('AKS CPU HPA', () => {
  it('uses effective CPU requests, not limits, for observed utilization', () => {
    const c = seedResourceTest()
    let run = applyHpa(c)
    run = advanceResources(run, c.lab, 15)
    const state = run.runtime.kubernetes.clusters[c.clusterId]
    const hpaUid = Object.values(state.resources).find(item => item.kind === 'HorizontalPodAutoscaler').metadata.uid
    for (const pod of Object.values(state.resources).filter(item => item.kind === 'Pod')) {
      const containerId = state.health.containers[pod.metadata.uid].containerId
      state.resourcesRuntime.metrics[pod.metadata.uid] = [{ containerId, windowStartMs: 0, windowEndMs: 15_000, cpuAverageM: 150, memoryPeakBytes: 0, readySinceMs: 0 }]
    }
    state.resourcesRuntime.hpa[hpaUid].lastSyncMs = null
    run = reconcileHpa(run, c.clusterId, 15_000, c.lab)
    const hpa = Object.values(run.runtime.kubernetes.clusters[c.clusterId].resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    expect(hpa.status.currentMetrics[0].resource.current.averageUtilization).toBe(60)
    expect(hpa.status.desiredReplicas).toBe(2)
  })

  it('does not double-sync after an identical timestamp or reload', () => {
    const c = seedResourceTest()
    let run = applyHpa(c)
    run = advanceResources(run, c.lab, 30)
    const hpa = Object.values(run.runtime.kubernetes.clusters[c.clusterId].resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    const before = structuredClone(run.runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.hpa[hpa.metadata.uid])
    run = advanceResources(structuredClone(run), c.lab, 1)
    const after = run.runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.hpa[hpa.metadata.uid]
    expect(after.lastSyncMs).toBe(before.lastSyncMs)
    expect(after.recommendations).toEqual(before.recommendations)
  })

  it('keeps replicas when complete metrics are unavailable and flags absent CPU requests', () => {
    const c = seedResourceTest({ resources: { limits: { memory: '256Mi' } } })
    let run = applyHpa(c)
    run = advanceResources(run, c.lab, 30)
    const hpa = Object.values(run.runtime.kubernetes.clusters[c.clusterId].resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    expect(hpa.status.conditions).toContainEqual(expect.objectContaining({ type: 'ScalingActive', status: 'False', reason: 'FailedGetResourceMetric' }))
    expect(hpa.status.desiredReplicas).toBe(2)
  })

  it('defaults a CPU request from a CPU limit and rejects a duplicate target controller', () => {
    const c = seedResourceTest({ resources: { limits: { cpu: '250m', memory: '256Mi' } } })
    let run = applyHpa(c)
    run = advanceResources(run, c.lab, 30)
    const hpa = Object.values(run.runtime.kubernetes.clusters[c.clusterId].resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    expect(hpa.status.conditions).toContainEqual(expect.objectContaining({ type: 'ScalingActive', status: 'True' }))
    const duplicate = structuredClone(HPA); duplicate.metadata.name = 'other-cpu'
    run = act(run, c.lab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(duplicate) }).run
    expect(() => act(run, c.lab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' })).toThrow(/already controls/i)
  })

  it('enforces bounds even without metrics and resets recommendation history for policy changes', () => {
    const c = seedResourceTest({ replicas: 5 })
    const hpa = structuredClone(HPA); hpa.spec.minReplicas = 2; hpa.spec.maxReplicas = 4
    let run = applyHpa(c, hpa)
    run = advanceResources(run, c.lab, 15)
    let live = run.runtime.kubernetes.clusters[c.clusterId].resources['Deployment/assistant/assistant']
    expect(live.spec.replicas).toBe(4)
    const edited = parseYaml(run.project.savedFiles['k8s/hpa.yaml']); edited.spec.behavior.scaleDown.stabilizationWindowSeconds = 0
    run = act(run, c.lab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(edited) }).run
    run = act(run, c.lab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }).run
    const controller = Object.values(run.runtime.kubernetes.clusters[c.clusterId].resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    expect(run.runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.hpa[controller.metadata.uid].recommendations).toEqual([])
  })
})
