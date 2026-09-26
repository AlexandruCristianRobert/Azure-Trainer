import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { seedResourceTest, advanceResources, act } from './helpers/aks.js'
import { reconcileHpa } from '../src/lib/kubernetes/hpa.js'
import { startResourceProfileFixture } from '../src/lib/kubernetes/resource-usage.js'

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

  it('stabilizes a normal clamped downscale against a recent high recommendation', () => {
    const c = seedResourceTest({ replicas: 4 }); let run = advanceResources(c.run, c.lab, 30)
    run = applyHpa({ ...c, run })
    let state = run.runtime.kubernetes.clusters[c.clusterId]
    for (const pod of Object.values(state.resources).filter(pod => pod.kind === 'Pod')) state.resourcesRuntime.metrics[pod.metadata.uid] = [{ containerId: state.health.containers[pod.metadata.uid].containerId, windowStartMs: 15_000, windowEndMs: 30_000, cpuAverageM: 150, memoryPeakBytes: 0, readySinceMs: 10_000 }]
    run = reconcileHpa(run, c.clusterId, 30_000, c.lab)
    run = advanceResources(run, c.lab, 15)
    expect(run.runtime.kubernetes.clusters[c.clusterId].resources['Deployment/assistant/assistant'].spec.replicas).toBe(4)
  })

  it('creates HPA replicas at the sync timestamp and keeps partitioned clocks identical', () => {
    const c = seedResourceTest({ resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '256Mi' } } })
    let run = applyHpa(c)
    run = startResourceProfileFixture(run, 'test-local-work', c.lab).run
    const fixture = structuredClone(run)
    const whole = advanceResources(fixture, c.lab, 50)
    const split = advanceResources(advanceResources(run, c.lab, 45), c.lab, 5)
    const starts = value => Object.values(value.runtime.kubernetes.clusters[c.clusterId].health.containers).map(item => item.startedAtMs).sort()
    expect(starts(whole)).toEqual(starts(split))
    expect(starts(whole)).toContain(45_000)
  })

  it('deletes controller runtime through named, file, and namespace lifecycle paths', () => {
    const c = seedResourceTest(); let run = applyHpa(c)
    run = act(run, c.lab, { type: 'command', line: 'kubectl delete -f k8s/hpa.yaml' }).run
    expect(Object.keys(run.runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.hpa)).toEqual([])
    run = applyHpa({ ...c, run })
    run = act(run, c.lab, { type: 'command', line: 'kubectl delete namespace assistant' }).run
    expect(Object.keys(run.runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.hpa)).toEqual([])
  })

  it('reports an unavailable target and rejects malformed HPA fields without throwing', () => {
    const c = seedResourceTest(); const absent = structuredClone(HPA); absent.spec.scaleTargetRef.name = 'missing'
    let run = applyHpa(c, absent); run = advanceResources(run, c.lab, 15)
    let hpa = Object.values(run.runtime.kubernetes.clusters[c.clusterId].resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    expect(hpa.status.conditions).toContainEqual(expect.objectContaining({ type: 'AbleToScale', reason: 'FailedGetScale' }))
    for (const mutate of [value => { value.spec.behavior = null }, value => { value.status = {} }, value => { value.spec.scaleTargetRef.name = 'other/assistant' }]) {
      const invalid = structuredClone(HPA); mutate(invalid)
      let candidate = act(c.run, c.lab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(invalid) }).run
      expect(() => act(candidate, c.lab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' })).toThrow()
    }
  })

  it('retains history on no-op apply and gives recreated controllers a fresh UID/history', () => {
    const c = seedResourceTest(); let run = applyHpa(c)
    let state = run.runtime.kubernetes.clusters[c.clusterId]; let hpa = Object.values(state.resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    state.resourcesRuntime.hpa[hpa.metadata.uid] = { policyGeneration: 1, nextSyncMs: 15_000, lastSyncMs: 0, recommendations: [{ atMs: 0, replicas: 4 }], lastDecision: null }
    run = act(run, c.lab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }).run
    expect(run.runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.hpa[hpa.metadata.uid].recommendations).toHaveLength(1)
    run = act(run, c.lab, { type: 'command', line: 'kubectl delete hpa assistant-cpu -n assistant' }).run
    run = applyHpa({ ...c, run }); run = advanceResources(run, c.lab, 15); state = run.runtime.kubernetes.clusters[c.clusterId]; hpa = Object.values(state.resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    expect(state.resourcesRuntime.hpa[hpa.metadata.uid].recommendations).toEqual([])
  })

  it('holds adjusted missing metrics inside tolerance and records bounded HPA scale receipts', () => {
    const c = seedResourceTest({ replicas: 4 }); const six = structuredClone(HPA); six.spec.maxReplicas = 6; let run = applyHpa(c, six); run = advanceResources(run, c.lab, 30)
    const state = run.runtime.kubernetes.clusters[c.clusterId]; const hpa = Object.values(state.resources).find(item => item.kind === 'HorizontalPodAutoscaler')
    const pods = Object.values(state.resources).filter(item => item.kind === 'Pod')
    for (const pod of pods.slice(0, 2)) state.resourcesRuntime.metrics[pod.metadata.uid] = [{ containerId: state.health.containers[pod.metadata.uid].containerId, windowStartMs: 15_000, windowEndMs: 30_000, cpuAverageM: 312.5, memoryPeakBytes: 0, readySinceMs: 0 }]
    state.resourcesRuntime.hpa[hpa.metadata.uid].lastSyncMs = null
    run = reconcileHpa(run, c.clusterId, 30_000, c.lab)
    expect(run.runtime.kubernetes.clusters[c.clusterId].resources['Deployment/assistant/assistant'].spec.replicas).toBe(5)
    const high = structuredClone(run); const s = high.runtime.kubernetes.clusters[c.clusterId]
    for (const pod of Object.values(s.resources).filter(item => item.kind === 'Pod')) s.resourcesRuntime.metrics[pod.metadata.uid] = [{ containerId: s.health.containers[pod.metadata.uid].containerId, windowStartMs: 15_000, windowEndMs: 30_000, cpuAverageM: 4000, memoryPeakBytes: 0, readySinceMs: 0 }]
    s.resourcesRuntime.hpa[hpa.metadata.uid].lastSyncMs = null
    const scaled = reconcileHpa(high, c.clusterId, 30_000, c.lab); const receipt = scaled.runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.receipts.filter(item => item.kind === 'hpa-scale').at(-1)
    expect(receipt).toMatchObject({ controllerUid: hpa.metadata.uid, atMs: 30_000, from: 5, to: 6, cause: 'hpa' })
  })
})
