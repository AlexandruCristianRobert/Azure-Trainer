import { describe, expect, it } from 'vitest'
import { act, advanceResources, resourceView, seedResourceTest, startHealthFault } from './helpers/aks.js'
import { startResourceProfileFixture } from '../src/lib/kubernetes/resource-usage.js'
import { setDeploymentReplicas } from '../src/lib/kubernetes/scheduling.js'
import { reconcileKubernetes } from '../src/lib/kubernetes/reconcile.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { clearPodState } from '../src/lib/kubernetes/pod-cleanup.js'

function runResourceProfile(run, lab, profileId, seconds) {
  const started = startResourceProfileFixture(run, profileId, lab)
  expect(started.diagnostics).toEqual([])
  let current = started.run
  for (let left = seconds; left > 0;) {
    const step = Math.min(5, left)
    current = advanceResources(current, lab, step)
    left -= step
  }
  return current
}

describe('AKS resource accounting', () => {
  it('records OOM as an abrupt container termination, distinct from CPU throttling', () => {
    const c = seedResourceTest({ resources: { requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '500m', memory: '128Mi' } } })
    const run = runResourceProfile(c.run, c.lab, 'test-local-work', 60)
    const view = resourceView(run, c.target)
    expect(view.oomCount).toBeGreaterThan(0)
    expect(view.containerTerminations.some(t => t.reason === 'OOMKilled' && t.exitCode === 137)).toBe(true)
    expect(run.runtime.kubernetes.clusters[c.clusterId].events.some(event => event.reason === 'OOMKilled')).toBe(true)
    expect(view.cpuThrottledM).toBe(0)
    expect(view.totals.completed).toBe(0)
  })

  it('produces identical totals for one 60 second advance and twelve 5 second advances', () => {
    const c = seedResourceTest()
    const oneStart = startResourceProfileFixture(c.run, 'test-local-work', c.lab).run
    const splitStart = structuredClone(oneStart)
    const one = advanceResources(oneStart, c.lab, 60)
    let split = splitStart
    for (let i = 0; i < 12; i++) split = advanceResources(split, c.lab, 5)
    expect(resourceView(one, c.target).totals).toEqual(resourceView(split, c.target).totals)
    expect(resourceView(one, c.target).pods).toEqual(resourceView(split, c.target).pods)
  })

  it('throttles CPU without restarting and preserves per process memory when replicas increase', () => {
    const c = seedResourceTest({ resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '50m', memory: '256Mi' } } })
    let run = runResourceProfile(c.run, c.lab, 'test-local-work', 40)
    let view = resourceView(run, c.target)
    expect(view.cpuThrottledM).toBeGreaterThan(0)
    expect(view.oomCount).toBe(0)
    expect(view.pods.every(pod => pod.oomCount === 0)).toBe(true)
    expect(view.pods.every(pod => pod.memoryBytes === 192 * 1024 * 1024)).toBe(true)
  })

  it('conserves work after burst arrivals stop and drains queued work when CPU capacity allows', () => {
    const c = seedResourceTest({ resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '50m', memory: '256Mi' } } })
    let run = runResourceProfile(c.run, c.lab, 'test-local-work', 60)
    const burst = resourceView(run, c.target).totals
    expect(burst.arrivals).toBe(300)
    expect(burst.completed).toBeLessThan(burst.arrivals)
    expect(burst.remaining).toBeGreaterThan(0)
    run = advanceResources(run, c.lab, 45)
    const drained = resourceView(run, c.target).totals
    expect(drained.arrivals).toBe(burst.arrivals)
    expect(drained.completed).toBe(burst.arrivals)
    expect(drained.remaining).toBe(0)
  })

  it('publishes only complete ready windows and invalidates a prior container sample after OOM restart', () => {
    const c = seedResourceTest({ resources: { requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '500m', memory: '128Mi' } } })
    let run = startResourceProfileFixture(c.run, 'test-local-work', c.lab).run
    run = advanceResources(run, c.lab, 9)
    expect(resourceView(run, c.target).pods.every(pod => pod.metrics === null)).toBe(true)
    const originalId = run.runtime.kubernetes.clusters[c.clusterId].health.containers[resourceView(run, c.target).pods[0].uid].containerId
    run = advanceResources(run, c.lab, 45)
    let view = resourceView(run, c.target)
    expect(view.pods.every(pod => pod.metrics === null)).toBe(true)
    const restarted = run.runtime.kubernetes.clusters[c.clusterId].health.containers[view.pods[0].uid]
    expect(restarted.containerId).not.toBe(originalId)
    expect(resourceView(run, c.target).pods.find(pod => pod.uid === view.pods[0].uid).metrics).toBe(null)
  })

  it('publishes the first full aligned window only after a Pod is ready for all 15 seconds and survives reload', () => {
    const c = seedResourceTest()
    let run = startResourceProfileFixture(c.run, 'test-local-work', c.lab).run
    run = advanceResources(run, c.lab, 30)
    const pod = resourceView(run, c.target).pods[0]
    expect(pod.metrics).toHaveLength(1)
    expect(pod.metrics[0]).toMatchObject({ windowStartMs: 15_000, windowEndMs: 30_000 })
    const reloaded = structuredClone(run)
    run = advanceResources(reloaded, c.lab, 5)
    expect(resourceView(run, c.target).experiment.phaseZeroAtMs).toBe(30_000)
  })

  it('terminates for OOM before running a probe due at the same timestamp', () => {
    const c = seedResourceTest({ resources: { requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '500m', memory: '128Mi' } } })
    let run = startResourceProfileFixture(c.run, 'test-local-work', c.lab).run
    run = advanceResources(run, c.lab, 30)
    const state = run.runtime.kubernetes.clusters[c.clusterId]
    for (const pod of resourceView(run, c.target).pods) state.health.containers[pod.uid].checks.readiness.nextAtMs = 31_000
    run = advanceResources(run, c.lab, 1)
    const health = run.runtime.kubernetes.clusters[c.clusterId].health
    for (const pod of resourceView(run, c.target).pods) {
      const oomIndex = health.events.findIndex(event => event.type === 'container-terminated' && event.podUid === pod.uid && event.atMs === 31_000)
      expect(oomIndex).toBeGreaterThanOrEqual(0)
      expect(health.events.slice(oomIndex + 1).some(event => event.type === 'probe-result' && event.podUid === pod.uid && event.atMs === 31_000)).toBe(false)
    }
  })

  it('keeps per process memory fixed as replicas increase', () => {
    const c = seedResourceTest({ replicas: 4 })
    const run = runResourceProfile(c.run, c.lab, 'test-local-work', 35)
    const view = resourceView(run, c.target)
    expect(view.pods.filter(pod => pod.phase === 'Running')).toHaveLength(4)
    expect(view.pods.every(pod => pod.memoryBytes === 192 * 1024 * 1024)).toBe(true)
  })

  it('shares node CPU fairly when requested capacity admits more demand than the node can deliver', () => {
    const c = seedResourceTest({ replicas: 6, units: 100, scratchMiB: 1,
      resources: { requests: { cpu: '0' } } })
    const run = runResourceProfile(c.run, c.lab, 'test-local-work', 35)
    const view = resourceView(run, c.target)
    expect(new Set(Object.values(view.assignments).map(item => item.nodeName))).toEqual(new Set(['worker-a']))
    expect(view.cpuThrottledTotalM).toBeGreaterThan(0)
    const delivered = view.pods.map(pod => pod.cpuDeliveredM)
    expect(Math.max(...delivered) - Math.min(...delivered)).toBeLessThan(0.000001)
    expect(view.oomCount).toBe(0)
  })

  it('reports unsupported node memory pressure instead of inventing an eviction', () => {
    const c = seedResourceTest({ replicas: 4, scratchMiB: 512,
      resources: { requests: { cpu: '250m', memory: '1Mi' }, limits: { cpu: '500m', memory: '1Gi' } } })
    const run = runResourceProfile(c.run, c.lab, 'test-local-work', 40)
    const view = resourceView(run, c.target)
    expect(view.unsupported).toBe('UNSUPPORTED_NODE_MEMORY_PRESSURE')
    expect(view.oomCount).toBe(0)
  })

  it('routes /api/work through the captured artifact and charges its declared local CPU units', () => {
    const c = seedResourceTest()
    let run = advanceResources(c.run, c.lab, 15)
    const routed = routeServiceRequest(run, { origin: { kind: 'external', clusterId: c.clusterId }, hostname: '192.0.2.10', port: 80,
      method: 'GET', path: '/api/work' }, c.lab)
    expect(routed.outcome).toMatchObject({ transport: { ok: true }, status: 200,
      body: { checksum: 3230, units: 20, scratch_mib: 96 }, workload: { operation: 'process_batch', units: 20, cpuM: 20 } })
    const charged = resourceView(routed.run, c.target).pods.find(pod => pod.uid === routed.outcome.route.podUid)
    expect(charged.routedWorkCpuM).toBe(20)
  })

  it('charges one millisecond of AI local CPU without counting dependency wait time', () => {
    const c = seedResourceTest()
    const started = startResourceProfileFixture(c.run, 'test-ai-wait', c.lab)
    expect(started.diagnostics).toEqual([])
    let run = advanceResources(started.run, c.lab, 35)
    const demand = resourceView(run, c.target).cpuDemandM
    expect(demand).toBeLessThan(100)
    const atMs = run.runtime.simTimeMs
    const routed = routeServiceRequest(run, { origin: { kind: 'external', clusterId: c.clusterId }, hostname: '192.0.2.10', port: 80,
      method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' }, integrationProfile: 'answer-wait-150ms' }, c.lab)
    expect(routed.outcome.status).toBe(200)
    expect(routed.outcome.dependencyTrace.find(item => item.operation === 'answer').attempts[0].durationMs).toBe(150)
    expect(routed.run.runtime.simTimeMs).toBe(atMs)
    expect(resourceView(routed.run, c.target).cpuDemandM).toBe(demand)
  })

  it('redistributes queued work when all Pods are unready and after scale-down', () => {
    const c = seedResourceTest({ resources: { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '50m', memory: '256Mi' } } })
    let run = runResourceProfile(c.run, c.lab, 'test-local-work', 40)
    const before = resourceView(run, c.target).totals.remaining
    expect(before).toBeGreaterThan(0)
    const state = structuredClone(run.runtime.kubernetes.clusters[c.clusterId])
    const removedUid = resourceView(run, c.target).pods[0].uid
    const queuedOnRemovedPod = state.resourcesRuntime.usage[removedUid].backlog
    const overflowBefore = state.resourcesRuntime.experiment.overflowBacklog
    clearPodState(state, removedUid)
    expect(state.resourcesRuntime.experiment.totals.remaining).toBe(before)
    expect(state.resourcesRuntime.experiment.overflowBacklog).toBe(overflowBefore + queuedOnRemovedPod)
    const scaled = setDeploymentReplicas(run, c.target, 1, { cause: 'manual', lab: c.lab }).run
    run = reconcileKubernetes(scaled, c.lab)
    for (const pod of resourceView(run, c.target).pods) run = startHealthFault(run, c.clusterId, pod.uid, 'admissionClosed')
    run = advanceResources(run, c.lab, 2)
    const view = resourceView(run, c.target)
    expect(view.totals.remaining).toBeGreaterThan(0)
  })
})
