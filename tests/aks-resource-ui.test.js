import { describe, expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { act, advanceResources, resourceView, seedResourceTest } from './helpers/aks.js'
import AksExperimentPanel from '../src/components/lab/AksExperimentPanel.vue'
import AksClusterBlade from '../src/components/blade/AksClusterBlade.vue'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

async function render(component, lab, behavioralRun, props = {}, readOnly = false) {
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useLabRunStore(); await store.load(lab.id, { lab, repository: behavioralRepository() })
  store.behavioralRun = behavioralRun; store.sandbox = behavioralRun.sandbox; store.readOnly = readOnly
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  return renderToString(createSSRApp(component, props).use(pinia).use(router))
}

describe('AKS resource diagnostics and controls', () => {
  it('projects resource budgets and unknown metrics without requiring a live target', () => {
    const { run, target } = seedResourceTest()
    const view = resourceView(run, target)
    expect(view.nodes['worker-a']).toMatchObject({ capacityCpuM: 2000, capacityMemoryBytes: 8192 * 1024 * 1024, requestedCpuM: 250, requestedMemoryBytes: 128 * 1024 * 1024, remainingCpuM: 750, remainingMemoryBytes: 896 * 1024 * 1024 })
    expect(view.pods.every(pod => pod.metrics === null)).toBe(true)
    expect(resourceView(run, { ...target, namespace: 'missing', deploymentName: 'missing' }).pods).toEqual([])
  })

  it('supports resource kubectl inspection, manual scale, and previous OOM logs', () => {
    const seeded = seedResourceTest({ resources: { requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '500m', memory: '128Mi' } }, scratchMiB: 96 })
    let run = advanceResources(seeded.run, seeded.lab, 30)
    const pods = resourceView(run, seeded.target).pods
    const top = act(run, seeded.lab, { type: 'command', line: 'kubectl top pods -n assistant' }).lines.map(line => line.text).join('\n')
    expect(top).toContain('CPU(15s avg)')
    expect(top).toContain('MEMORY(15s peak)')
    expect(act(seeded.run, seeded.lab, { type: 'command', line: 'kubectl top pods -n assistant' }).lines.map(line => line.text).join('\n')).toContain('<unknown>')
    const nodeTop = act(run, seeded.lab, { type: 'command', line: 'kubectl top nodes' }).lines.map(line => line.text).join('\n')
    expect(nodeTop).toContain('CPU(15s avg)')
    expect(nodeTop).toContain('RESERVATION REMAINING')
    expect(act(run, seeded.lab, { type: 'command', line: 'kubectl get nodes' }).lines.map(line => line.text).join('\n')).toContain('2000m')
    expect(act(run, seeded.lab, { type: 'command', line: 'kubectl describe node worker-a' }).lines.map(line => line.text).join('\n')).toContain('Fixed reservation')
    expect(act(run, seeded.lab, { type: 'command', line: 'kubectl describe deployment assistant -n assistant' }).lines.map(line => line.text).join('\n')).toContain('Resource requests')
    const manifest = run.project.savedFiles['k8s/deployment.yaml']
    run = act(run, seeded.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = act(run, seeded.lab, { type: 'command', line: 'kubectl scale deployment/assistant --replicas 3 -n assistant' }).run
    expect(resourceView(run, seeded.target).pods).toHaveLength(3)
    expect(resourceView(run, seeded.target).experiment.phase).toBe('cancelled')
    expect(run.project.savedFiles['k8s/deployment.yaml']).toBe(manifest)
    expect(pods.length).toBe(2)
  })

  it('retains a previous OOM container log after an active resource workload', () => {
    const seeded = seedResourceTest({ resources: { requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '500m', memory: '128Mi' } }, scratchMiB: 96 })
    let run = act(seeded.run, seeded.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = advanceResources(run, seeded.lab, 45)
    const pod = resourceView(run, seeded.target).pods.find(item => item.containerTerminations.some(event => event.reason === 'OOMKilled'))
    expect(pod).toBeTruthy()
    const previous = act(run, seeded.lab, { type: 'command', line: `kubectl logs ${pod.name} -n assistant --previous` }).lines.map(line => line.text).join('\n')
    expect(previous).toContain('OOMKilled')
    expect(previous).toContain('137')
  })

  it('withholds stale node and Pod windows through OOM backoff until the replacement completes a window', () => {
    const seeded = seedResourceTest({ resources: { requests: { cpu: '250m', memory: '128Mi' }, limits: { cpu: '500m', memory: '128Mi' } }, scratchMiB: 96 })
    let run = advanceResources(seeded.run, seeded.lab, 30)
    expect(resourceView(run, seeded.target).nodes['worker-a'].cpuAverageM).toBe(10)
    run = act(run, seeded.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = advanceResources(run, seeded.lab, 2)
    const duringBackoff = resourceView(run, seeded.target)
    expect(duringBackoff.pods.some(pod => pod.metrics === null)).toBe(true)
    expect(duringBackoff.nodes['worker-a'].cpuAverageM).toBeNull()
    expect(duringBackoff.nodes['worker-a'].memoryPeakBytes).toBeNull()
    run = act(run, seeded.lab, { type: 'aks-resource-cancel' }).run
    run = advanceResources(run, seeded.lab, 60)
    const recovered = resourceView(run, seeded.target)
    expect(recovered.nodes['worker-a'].cpuAverageM).not.toBeNull()
    expect(recovered.nodes['worker-a'].cpuAverageM).not.toBe(recovered.nodes['worker-a'].requestedCpuM)
  })

  it('renders HPA history, hides empty probes, retains work requests with AI capability, and disables completed controls', async () => {
    const seeded = seedResourceTest()
    seeded.lab.scenarios.work = { kind: 'aks-request', version: 1, target: seeded.target, request: { method: 'GET', path: '/api/work' }, expected: { status: 200, body: {} } }
    seeded.lab.tasks.push({ id: 'work', verification: { scenarioId: 'work', scenarioVersion: 1 }, check: () => false })
    const state = seeded.run.runtime.kubernetes.clusters[seeded.clusterId]
    state.resources['HorizontalPodAutoscaler/assistant/assistant-cpu'] = { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', metadata: { name: 'assistant-cpu', namespace: 'assistant', uid: 'hpa-ui' }, spec: { minReplicas: 1, maxReplicas: 4, scaleTargetRef: { kind: 'Deployment', name: 'assistant' }, metrics: [{ resource: { target: { averageUtilization: 60 } } }] }, status: { currentReplicas: 2, desiredReplicas: 3, conditions: [{ type: 'ScalingActive', status: 'True', reason: 'ValidMetricFound' }] } }
    state.resourcesRuntime.hpa['hpa-ui'] = { recommendations: [{ replicas: 3, atMs: 15_000 }] }
    const panel = await render(AksExperimentPanel, seeded.lab, seeded.run)
    expect(panel).toContain('GET /api/work')
    expect(panel).toContain('Start resource profile')
    expect(panel).not.toContain('Health probe timeline')
    const cluster = seeded.run.sandbox.aksClusters.find(item => item.id === seeded.clusterId)
    const blade = await render(AksClusterBlade, seeded.lab, seeded.run, { resourceGroup: cluster.resourceGroup, name: cluster.name })
    expect(blade).toContain('ScalingActive True (ValidMetricFound)')
    expect(blade).toContain('3 @ 15s')
    const completed = { ...seeded.run, completedAt: '2026-09-26T00:00:00.000Z', resultId: 'result-ui' }
    const readonly = await render(AksExperimentPanel, seeded.lab, completed, {}, true)
    expect(readonly).toMatch(/aria-label="Start resource profile" disabled/)
  })
})
