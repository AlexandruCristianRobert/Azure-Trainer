import { describe, expect, it } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { connectivityDependencies } from '../src/lib/kubernetes/evidence.js'
import { refreshKubernetesDependencies } from '../src/lib/kubernetes/evidence.js'
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

  it('binds proof to the declared Service and enforces the selector failure hop pattern', () => {
    const seed = seedConnectivityTest()
    const lab = connectivityLab(seed)
    const wrongTarget = { ...lab, scenarios: { ...lab.scenarios, 'network-internal': { ...lab.scenarios['network-internal'], target: { ...lab.scenarios['network-internal'].target, serviceName: 'other-service' } } } }
    const wrong = applyRunAction(seed.run, { type: 'aks-request', scenarioId: 'network-internal' }, wrongTarget)
    expect(wrong.run.evidence.currentEvidenceByTask).toEqual({ 'network-task': expect.any(String) })
    expect(evaluateLab(wrongTarget, wrong.run).tasks[0].done).toBe(false)

    const fault = seedConnectivityTest()
    const failureLab = connectivityLab(fault)
    failureLab.scenarios['network-internal'].expected = { status: null, body: null,
      transport: { ok: false, reason: 'NO_READY_ENDPOINTS' }, route: { selectedCount: 0 } }
    const text = fault.run.project.savedFiles['k8s/service.yaml'].replace('app: assistant', 'app: typo')
    let run = applyRunAction(fault.run, { type: 'save-file', path: 'k8s/service.yaml', text }, failureLab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }, failureLab).run
    const observed = applyRunAction(run, { type: 'aks-request', scenarioId: 'network-internal' }, failureLab)
    expect(evaluateLab(failureLab, observed.run).tasks[0].done).toBe(true)
  })

  it('tracks parsed quoted saved Service YAML and stable historical identity', () => {
    const seed = seedConnectivityTest()
    const target = { clusterId: seed.clusterId, namespace: 'assistant', serviceName: 'assistant-internal', clientPodUid: seed.diagnosticPodUid }
    const live = connectivityDependencies(target)
    const historical = connectivityDependencies(target, { historical: true })
    const liveSelector = live[Object.keys(live)[0]]
    const historySelector = historical[Object.keys(historical)[0]]
    const quoted = seed.run.project.savedFiles['k8s/service.yaml'].replace('name: assistant-internal', 'name: "assistant-internal"')
    const run = applyRunAction(seed.run, { type: 'save-file', path: 'k8s/service.yaml', text: quoted }, seed.lab).run
    expect(Object.keys(liveSelector(run).savedServiceFiles)).toEqual(['k8s/service.yaml'])
    const before = historySelector(run)
    const recreated = structuredClone(run)
    recreated.runtime.kubernetes.clusters[seed.clusterId].resources['Service/assistant/assistant-internal'].metadata.uid = 'recreated-service'
    expect(historySelector(recreated)).toEqual(before)
  })

  it('keeps serialized/read-only evidence current but invalidates it for a new candidate label', () => {
    const seed = seedConnectivityTest()
    const lab = connectivityLab(seed)
    let run = applyRunAction(seed.run, { type: 'aks-request', scenarioId: 'network-internal' }, lab).run
    run = structuredClone(JSON.parse(JSON.stringify(run)))
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    run = applyRunAction(run, { type: 'command', line: 'kubectl get services -n assistant -o wide' }, lab).run
    expect(evaluateLab(lab, run).tasks[0].done).toBe(true)
    let changed = structuredClone(run)
    const pod = Object.values(changed.runtime.kubernetes.clusters[seed.clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
    pod.metadata.labels.app = 'changed'
    changed = refreshKubernetesDependencies(run, changed, lab)
    expect(evaluateLab(lab, changed).tasks[0].done).toBe(false)
  })
})
