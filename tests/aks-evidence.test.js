import { describe, expect, it } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { seedFoundation } from './helpers/aks.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'

function request(run, lab, extras = {}) { return applyRunAction(run, { type: 'aks-request', scenarioId: 'info', ...extras }, lab) }

describe('AKS request evidence', () => {
  it('rejects caller-supplied outcomes', () => {
    const { run, lab } = seedFoundation()
    const result = request(run, lab, { status: 200, body: lab.scenarios.info.expected.body })
    expect(result.diagnostics[0].code).toBe('INVALID_AKS_ACTION')
    expect(result.run.evidence).toEqual(run.evidence)
  })

  it('records a response from captured Pod source and Service routing', () => {
    const { run, lab } = seedFoundation()
    const result = request(run, lab)
    expect(result.diagnostics).toEqual([])
    const record = result.run.evidence.experimentsById[`evidence-${run.nextSequence + 1}`]
    expect(record.outcome).toBe('passed')
    expect(record.measurements.status).toBe(200)
    expect(record.measurements.selectedPodUid).toBeTruthy()
    expect(record.measurements.selectedPods).toHaveLength(2)
    expect(record.measurements.selectedPods.every(pod => pod.matchesExpected)).toBe(true)
  })

  it('returns inspectable failures when the Service is missing', () => {
    const { run, lab, clusterId } = seedFoundation()
    const state = run.runtime.kubernetes.clusters[clusterId]
    const resources = { ...state.resources }; delete resources['Service/assistant/assistant']
    const broken = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes,
      clusters: { ...run.runtime.kubernetes.clusters, [clusterId]: { ...state, resources } } } } }
    const result = request(broken, lab)
    expect(result.run.runtime.kubernetes.requests.at(-1).status).toBe(503)
    expect(result.diagnostics[0].code).toBe('SERVICE_NOT_FOUND')
  })

  it('does not verify replacement without a matching deletion receipt', () => {
    const { run, lab } = seedFoundation()
    const result = applyRunAction(run, { type: 'aks-request', scenarioId: 'replacement' }, lab)
    const record = result.run.evidence.experimentsById[`evidence-${run.nextSequence + 1}`]
    expect(record.outcome).toBe('failed')
    expect(record.measurements.replacementProven).toBe(false)
  })

  it('does not accept a causal-looking replacement receipt without a matching Pod delete command', () => {
    const { run, lab, clusterId } = seedFoundation()
    const state = run.runtime.kubernetes.clusters[clusterId]
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod')
    const fake = { cause: 'pod-delete', sequence: Number(pod.metadata.uid.slice(5)), deletedPodUid: 'kube-1', deletedPodName: 'forged-1',
      deletedReplicaSetUid: pod.metadata.ownerReferences[0].uid, templateHash: state.podSnapshots[pod.metadata.uid].templateHash,
      replacementPodUid: pod.metadata.uid, replacementPodName: pod.metadata.name,
      replacementReplicaSetUid: pod.metadata.ownerReferences[0].uid, replacementTemplateHash: state.podSnapshots[pod.metadata.uid].templateHash }
    const forged = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes,
      clusters: { ...run.runtime.kubernetes.clusters, [clusterId]: { ...state, receipts: [fake] } } } } }
    const result = applyRunAction(forged, { type: 'aks-request', scenarioId: 'replacement' }, lab)
    const record = result.run.evidence.experimentsById[`evidence-${run.nextSequence + 1}`]
    expect(record.outcome).toBe('failed')
    expect(record.measurements.replacementProven).toBe(false)
  })

  it('rejects a saved build artifact whose appSpec no longer matches its captured files', () => {
    const { run, lab, clusterId } = seedFoundation()
    const state = run.runtime.kubernetes.clusters[clusterId]
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod')
    const artifactId = state.podSnapshots[pod.metadata.uid].artifactId
    const artifact = run.artifacts.buildsById[artifactId]
    const forged = { ...run, artifacts: { ...run.artifacts, buildsById: { ...run.artifacts.buildsById,
      [artifactId]: { ...artifact, appSpec: { ...artifact.appSpec, version: 'forged' } } } } }
    expect(() => applyRunAction(forged, { type: 'aks-request', scenarioId: 'info' }, lab)).toThrow(/Kubernetes/)
  })

  it('keeps request sequences unique and earlier than their verification records', () => {
    const { run, lab } = seedFoundation()
    const first = request(run, lab).run
    const second = request(first, lab).run
    const runtimeRequests = second.runtime.kubernetes.requests
    expect(new Set(runtimeRequests.map(item => item.sequence)).size).toBe(runtimeRequests.length)
    expect(runtimeRequests.every(item => item.sequence < second.nextSequence)).toBe(true)
    const requestRecord = second.evidence.experimentsById[`evidence-${first.nextSequence + 1}`]
    expect(requestRecord.sequence).toBeGreaterThan(runtimeRequests.at(-1).sequence)
  })

  it('bounds Pod-delete receipts while retaining the latest recovery records', () => {
    const { run: initial, lab, clusterId } = seedFoundation()
    let run = initial
    for (let index = 0; index < 105; index++) {
      const pod = Object.values(run.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'Pod')
      run = applyRunAction(run, { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n assistant` }, lab).run
    }
    expect(run.runtime.kubernetes.clusters[clusterId].receipts).toHaveLength(100)
  })

  it('rejects a Service targetPort that does not reach the captured listener', () => {
    const { run, lab, clusterId } = seedFoundation()
    const state = run.runtime.kubernetes.clusters[clusterId]
    const service = state.resources['Service/assistant/assistant']
    const changed = { ...service, spec: { ...service.spec, ports: [{ ...service.spec.ports[0], targetPort: 8181 }] } }
    const broken = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes,
      clusters: { ...run.runtime.kubernetes.clusters, [clusterId]: { ...state, resources: { ...state.resources, 'Service/assistant/assistant': changed } } } } } }
    const result = request(broken, lab)
    expect(result.run.runtime.kubernetes.requests.at(-1).diagnosticCode).toBe('TARGET_PORT_MISMATCH')
    expect(result.run.evidence.experimentsById[`evidence-${run.nextSequence + 1}`].outcome).toBe('failed')
  })

  it('reports a Service with zero selected Pods as a failed request', () => {
    const { run, lab, clusterId } = seedFoundation()
    const state = run.runtime.kubernetes.clusters[clusterId]
    const service = state.resources['Service/assistant/assistant']
    const changed = { ...service, spec: { ...service.spec, selector: { app: 'missing' } } }
    const broken = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes,
      clusters: { ...run.runtime.kubernetes.clusters, [clusterId]: { ...state, resources: { ...state.resources, 'Service/assistant/assistant': changed } } } } } }
    const result = request(broken, lab)
    expect(result.diagnostics[0].code).toBe('NO_RUNNING_BACKENDS')
    expect(result.run.runtime.kubernetes.requests.at(-1).runningReplicaCount).toBe(0)
  })

  it('keeps old captured image output distinct from newly saved source', () => {
    const { run, lab } = seedFoundation()
    const edited = applyRunAction(run, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'].replace('"1.0"', '"2.0"') }, lab)
    const result = request(edited.run, lab)
    const record = result.run.evidence.experimentsById[`evidence-${edited.run.nextSequence + 1}`]
    expect(record.measurements.body.version).toBe('1.0')
    expect(result.run.dependencyGenerations[Object.keys(lab.tasks[0].dependencies).find(key => key.startsWith('aks-source:'))]).toBe(1)
    expect(result.run.dependencyGenerations['file:app.py']).toBe(run.dependencyGenerations['file:app.py'] + 1)
  })

  it('does not resolve the named Service from a different namespace', () => {
    const { run, lab } = seedFoundation()
    const scenario = { ...lab.scenarios.info, target: { ...lab.scenarios.info.target, namespace: 'other' } }
    const otherLab = { ...lab, scenarios: { ...lab.scenarios, info: scenario } }
    const result = request(run, otherLab)
    expect(result.diagnostics[0].code).toBe('SERVICE_NOT_FOUND')
    expect(result.run.runtime.kubernetes.requests.at(-1).namespace).toBe('other')
  })

  it('bumps a dependency when a relevant Service change is restored', () => {
    const { run, lab } = seedFoundation()
    const verified = request(run, lab).run
    const key = Object.keys(lab.tasks[0].dependencies)[0]
    const original = verified.project.savedFiles['k8s/service.yaml']
    const altered = original.replace('targetPort: http', 'targetPort: 8080')
    const edit = (current, text) => applyRunAction(current, { type: 'save-file', path: 'k8s/service.yaml', text }, lab).run
    const apply = current => applyRunAction(current, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }, lab).run
    const changed = apply(edit(verified, altered))
    const restored = apply(edit(changed, original))
    expect(restored.dependencyGenerations[key]).toBe(2)
    expect(restored.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id].resources['Service/assistant/assistant'].spec.ports[0].targetPort).toBe('http')
    expect(restored.evidence.currentEvidenceByTask['info-task']).toBeTruthy()
  })

  it('preserves a dependency generation for context switches, unrelated namespaces and no-op applies', () => {
    const seeded = seedFoundation()
    const run = request(seeded.run, seeded.lab).run; const lab = seeded.lab
    const key = Object.keys(lab.tasks[0].dependencies)[0]
    let next = applyRunAction(run, { type: 'command', line: 'kubectl config set-context --current --namespace default' }, lab).run
    next = applyRunAction(next, { type: 'command', line: 'kubectl apply -f k8s/service.yaml' }, lab).run
    const otherNamespace = applyRunAction(next, { type: 'save-file', path: 'k8s/namespace.yaml', text: 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: unrelated\n' }, lab).run
    next = applyRunAction(otherNamespace, { type: 'command', line: 'kubectl apply -f k8s/namespace.yaml' }, lab).run
    expect(next.dependencyGenerations[key] ?? 0).toBe(run.dependencyGenerations[key] ?? 0)
    const restoredFromStorage = JSON.parse(JSON.stringify(next))
    expect(validateBehavioralRun(restoredFromStorage, lab).evidence.currentEvidenceByTask['info-task']).toBe(run.evidence.currentEvidenceByTask['info-task'])
  })

  it('accepts a fresh request only after a Pod deletion replacement receipt', () => {
    const { run, lab, clusterId } = seedFoundation()
    const pod = Object.values(run.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'Pod')
    const deleted = applyRunAction(run, { type: 'command', line: `kubectl delete -n assistant pod ${pod.metadata.name}` }, lab)
    expect(deleted.run.runtime.kubernetes.clusters[clusterId].receipts.some(item => item.cause === 'pod-delete'
      && item.replacementPodUid && item.replacementPodUid !== item.deletedPodUid)).toBe(true)
    const result = applyRunAction(deleted.run, { type: 'aks-request', scenarioId: 'replacement' }, lab)
    const record = result.run.evidence.experimentsById[`evidence-${deleted.run.nextSequence + 1}`]
    expect(record.outcome).toBe('passed')
    expect(record.measurements.replacementProven).toBe(true)
  })
})
