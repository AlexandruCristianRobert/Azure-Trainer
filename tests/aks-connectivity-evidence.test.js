import { describe, expect, it } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { connectivityDependencies } from '../src/lib/kubernetes/evidence.js'
import { seedConnectivityTest } from './helpers/aks.js'

function connectivityLab(seed) {
  const scenario = {
    kind: 'aks-request', version: 1,
    target: { clusterId: seed.clusterId, namespace: 'assistant', serviceName: 'assistant-internal', deploymentName: 'assistant' },
    connectivity: { origin: { kind: 'diagnostic', namespace: 'diagnostics', name: 'diagnostics' }, hostname: 'assistant-internal.assistant', port: 80 },
    request: { method: 'GET', path: '/api/info' },
    expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } },
  }
  return { ...seed.lab, scenarios: { 'network-internal': scenario }, tasks: [{ id: 'network-task',
    verification: { scenarioId: 'network-internal', scenarioVersion: 1 },
    dependencies: connectivityDependencies({ clusterId: seed.clusterId, namespace: 'assistant', serviceName: 'assistant-internal', clientPodUid: seed.diagnosticPodUid }), check: () => true }] }
}

describe('AKS connectivity evidence', () => {
  it('does not let caller fields or another Service response satisfy a route', () => {
    const seed = seedConnectivityTest()
    const lab = connectivityLab(seed)
    const rejected = applyRunAction(seed.run, { type: 'aks-request', scenarioId: 'network-internal', hostname: 'other.assistant', status: 200, podUid: 'forged' }, lab)
    expect(rejected.diagnostics.length).toBeGreaterThan(0)
    expect(rejected.run.evidence).toEqual(seed.run.evidence)

    const verified = applyRunAction(seed.run, { type: 'aks-request', scenarioId: 'network-internal' }, lab)
    expect(verified.diagnostics).toEqual([])
    expect(evaluateLab(lab, verified.run).tasks[0].done).toBe(true)
    expect(verified.run.runtime.kubernetes.requests.at(-1)).toMatchObject({
      scenarioId: 'network-internal', route: expect.objectContaining({ serviceName: 'assistant-internal', originPodUid: seed.diagnosticPodUid }),
    })
  })

  it('invalidates current proof when the applied Service is restored after a change', () => {
    const seed = seedConnectivityTest()
    const lab = connectivityLab(seed)
    let run = applyRunAction(seed.run, { type: 'aks-request', scenarioId: 'network-internal' }, lab).run
    const original = run.project.savedFiles['k8s/service.yaml']
    run = applyRunAction(run, { type: 'save-file', path: 'k8s/service.yaml', text: original.replace('app: assistant', 'app: other') }, lab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }, lab).run
    run = applyRunAction(run, { type: 'save-file', path: 'k8s/service.yaml', text: original }, lab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }, lab).run
    expect(evaluateLab(lab, run).tasks[0].done).toBe(false)
  })
})
