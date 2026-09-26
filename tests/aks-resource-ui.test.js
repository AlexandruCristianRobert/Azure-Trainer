import { describe, expect, it } from 'vitest'
import { act, advanceResources, resourceView, seedResourceTest } from './helpers/aks.js'

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
    expect(nodeTop).toContain('CPU(instant delivered)')
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
    expect(previous).toMatch(/OOMKilled|simulated/i)
  })
})
