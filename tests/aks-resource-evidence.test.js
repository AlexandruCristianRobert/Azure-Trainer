import { describe, expect, it } from 'vitest'
import { advanceResources, act, resourceView, seedResourceTest } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { resourceDependencies } from '../src/lib/kubernetes/evidence.js'
import { setDeploymentReplicas } from '../src/lib/kubernetes/scheduling.js'

function seedAdoptedProfile(profileId, { resources, units = 20, scratchMiB = 96, maxReplicas = 6, targetUtilization = 60, stabilization = 60 } = {}) {
  const hpa = { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', metadata: { name: 'assistant-cpu', namespace: 'assistant' },
    spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'assistant' }, minReplicas: 2, maxReplicas,
      metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: targetUtilization } } }],
      behavior: { scaleDown: { stabilizationWindowSeconds: stabilization } } } }
  const seeded = seedResourceTest({ hpa, resources, units, scratchMiB })
  const deployment = parseYaml(seeded.run.project.savedFiles['k8s/deployment.yaml']); delete deployment.spec.replicas
  let run = act(seeded.run, seeded.lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
  run = act(run, seeded.lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const scenarioId = `${profileId}-alias`
  seeded.lab.scenarios[scenarioId] = { kind: 'aks-resource-profile', version: 1, profileId, target: {
    clusterId: seeded.clusterId, namespace: seeded.target.namespace, deploymentName: seeded.target.deploymentName }, requiredReadyReplicas: 2 }
  seeded.lab.tasks.push({ id: `evidence-${scenarioId}`, verification: { scenarioId, scenarioVersion: 1 },
    dependencies: resourceDependencies(seeded.target, { historical: true, profileId }), check: () => false })
  return { ...seeded, run, scenarioId }
}

describe('resource experiment evidence', () => {
  it('rejects caller supplied load and outcomes without changing Kubernetes state', () => {
    const { run, lab } = seedResourceTest()
    const result = applyRunAction(run, { type: 'aks-resource-start', scenarioId: 'test-local-work', cpuUsage: 100, desiredReplicas: 6 }, lab)
    expect(result.diagnostics[0].code).toBe('INVALID_AKS_ACTION')
    expect(result.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
  })

  it('cancels source edits and manual scale, then leaves the cancellation stable after restore', () => {
    const { run: initial, lab, target } = seedResourceTest()
    lab.tasks.push({ id: 'source-generation-check', verification: { scenarioId: 'test-local-work', scenarioVersion: 1 },
      dependencies: resourceDependencies(target, { historical: true, profileId: 'test-local-work' }), check: () => false })
    let run = act(initial, lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = act(run, lab, { type: 'save-file', path: 'app.py', text: `${run.project.savedFiles['app.py']}\n# change` }).run
    expect(resourceView(run, target).experiment).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' })
    run = act(run, lab, { type: 'save-file', path: 'app.py', text: initial.project.savedFiles['app.py'] }).run
    expect(resourceView(run, target).experiment.phase).toBe('cancelled')
    const sourceDependency = Object.keys(resourceDependencies(target, { historical: true, profileId: 'test-local-work' }))[0]
    expect(run.dependencyGenerations[sourceDependency]).toBe(2)

    const fresh = seedResourceTest()
    run = act(fresh.run, fresh.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = setDeploymentReplicas(run, fresh.target, 3, { cause: 'manual', lab: fresh.lab }).run
    expect(resourceView(run, fresh.target).experiment).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' })
  })

  it('does not cancel for another namespace, but cancels on target Pod deletion through command effects', () => {
    const first = seedResourceTest()
    let run = act(first.run, first.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = act(run, first.lab, { type: 'save-file', path: 'k8s/namespace.yaml', text: 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: unrelated\n' }).run
    run = act(run, first.lab, { type: 'command', line: 'kubectl apply -f k8s/namespace.yaml' }).run
    expect(resourceView(run, first.target).experiment.phase).toBe('warming')
    const pod = Object.values(run.runtime.kubernetes.clusters[first.clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.namespace === first.target.namespace)
    run = act(run, first.lab, { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n ${first.target.namespace}` }).run
    expect(resourceView(run, first.target).experiment).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' })
    expect(JSON.parse(JSON.stringify(run)).runtime.kubernetes.clusters[first.clusterId].resourcesRuntime.experiment.phase).toBe('cancelled')
  })

  it('retains phase-boundary request provenance through HPA cooldown and cancellation after Pod deletion', () => {
    const c = seedAdoptedProfile('guided-cycle')
    let run = act(c.run, c.lab, { type: 'aks-resource-start', scenarioId: c.scenarioId }).run
    run = advanceResources(run, c.lab, 150)
    expect(resourceView(run, c.target).experiment.routeSamples.filter(item => item.offsetSeconds === 120)).toHaveLength(1)
    const pod = Object.values(run.runtime.kubernetes.clusters[c.clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.namespace === c.target.namespace)
    run = act(run, c.lab, { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n ${c.target.namespace}` }).run
    expect(resourceView(run, c.target).experiment).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' })
    expect(JSON.parse(JSON.stringify(run)).runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.experiment.routeSamples.some(item => item.offsetSeconds === 120)).toBe(true)
  })

  it('validates a cancelled historical experiment after its target Deployment is deleted', () => {
    const c = seedResourceTest()
    let run = act(c.run, c.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = act(run, c.lab, { type: 'command', line: 'kubectl delete deployment assistant -n assistant' }).run
    expect(run.runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.experiment).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' })
    expect(JSON.parse(JSON.stringify(run)).runtime.kubernetes.clusters[c.clusterId].resourcesRuntime.experiment.phase).toBe('cancelled')
  })

  it('retains completed success/failure records when target Deployment or Namespace deletion invalidates evidence', () => {
    const passed = seedResourceTest({ replicas: 2 })
    passed.lab.tasks.push({ id: 'completed-success-proof', verification: { scenarioId: 'test-local-work', scenarioVersion: 1 },
      dependencies: resourceDependencies(passed.target, { historical: true, profileId: 'test-local-work' }), check: () => false })
    let run = act(passed.run, passed.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = advanceResources(run, passed.lab, 60)
    const success = resourceView(run, passed.target).experiment
    expect(success).toMatchObject({ phase: 'complete', outcome: 'passed' })
    const successEvidenceId = run.evidence.currentEvidenceByTask['completed-success-proof']
    const successEvidence = run.evidence.experimentsById[successEvidenceId]
    const successDependency = Object.keys(successEvidence.dependencyValues)[0]
    const deletedDeployment = applyRunAction(run, { type: 'command', line: 'kubectl delete deployment assistant -n assistant' }, passed.lab)
    expect(deletedDeployment.diagnostics).toEqual([])
    expect(deletedDeployment.run.runtime.kubernetes.clusters[passed.clusterId].resourcesRuntime.experiment).toMatchObject({ phase: 'complete', outcome: 'passed' })
    expect(deletedDeployment.run.dependencyGenerations[successDependency]).toBeGreaterThan(successEvidence.dependencyGenerations[successDependency])
    const successReload = JSON.parse(JSON.stringify(deletedDeployment.run))
    expect(applyRunAction(successReload, { type: 'aks-resource-cancel' }, passed.lab).diagnostics[0].code).toBe('INVALID_RESOURCE_EXPERIMENT')

    const failed = seedResourceTest({ replicas: 2 })
    failed.lab.scenarios['test-local-work'] = { ...failed.lab.scenarios['test-local-work'], requiredReadyReplicas: 3 }
    failed.lab.tasks.push({ id: 'completed-failure-proof', verification: { scenarioId: 'test-local-work', scenarioVersion: 1 },
      dependencies: resourceDependencies(failed.target, { historical: true, profileId: 'test-local-work' }), check: () => false })
    run = act(failed.run, failed.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = advanceResources(run, failed.lab, 300)
    run = advanceResources(run, failed.lab, 60)
    const failure = resourceView(run, failed.target).experiment
    expect(failure).toMatchObject({ phase: 'complete', outcome: 'failed' })
    const failureEvidenceId = run.evidence.currentEvidenceByTask['completed-failure-proof']
    const failureEvidence = run.evidence.experimentsById[failureEvidenceId]
    const failureDependency = Object.keys(failureEvidence.dependencyValues)[0]
    const deletedNamespace = applyRunAction(run, { type: 'command', line: 'kubectl delete namespace assistant' }, failed.lab)
    expect(deletedNamespace.diagnostics).toEqual([])
    expect(deletedNamespace.run.runtime.kubernetes.clusters[failed.clusterId].resourcesRuntime.experiment).toMatchObject({ phase: 'complete', outcome: 'failed' })
    expect(deletedNamespace.run.dependencyGenerations[failureDependency]).toBeGreaterThan(failureEvidence.dependencyGenerations[failureDependency])
    const failureReload = JSON.parse(JSON.stringify(deletedNamespace.run))
    expect(applyRunAction(failureReload, { type: 'aks-resource-cancel' }, failed.lab).diagnostics[0].code).toBe('INVALID_RESOURCE_EXPERIMENT')
  })

  it('enforces resource/probe experiment exclusivity in both start directions', () => {
    const c = seedResourceTest()
    c.lab.scenarios['probe-for-resource-test'] = { kind: 'aks-probe', version: 1, durationSeconds: 60,
      target: { clusterId: c.clusterId, namespace: c.target.namespace, deploymentName: c.target.deploymentName, serviceName: 'assistant' },
      script: { durationSeconds: 60, finishAfterStartSeconds: 60, sampleAtSeconds: [] } }
    let run = act(c.run, c.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    const probeFirst = applyRunAction(run, { type: 'aks-probe-start', scenarioId: 'probe-for-resource-test' }, c.lab)
    expect(probeFirst.diagnostics[0].message).toMatch(/resource experiment is already active/i)
    run = act(c.run, c.lab, { type: 'aks-probe-start', scenarioId: 'probe-for-resource-test' }).run
    const resourceSecond = applyRunAction(run, { type: 'aks-resource-start', scenarioId: 'test-local-work' }, c.lab)
    expect(resourceSecond.diagnostics[0].code).toBe('RESOURCE_EXPERIMENT_ACTIVE')
  })

  it('cancels when an active profile loses its HPA and accepts only value-free explicit cancellation', () => {
    const c = seedAdoptedProfile('guided-cycle')
    let run = act(c.run, c.lab, { type: 'aks-resource-start', scenarioId: c.scenarioId }).run
    run = act(run, c.lab, { type: 'command', line: 'kubectl delete hpa assistant-cpu -n assistant' }).run
    expect(resourceView(run, c.target).experiment).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' })

    const fresh = seedResourceTest()
    run = act(fresh.run, fresh.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    const forged = applyRunAction(run, { type: 'aks-resource-cancel', reason: 'passed' }, fresh.lab)
    expect(forged.diagnostics[0].code).toBe('INVALID_AKS_ACTION')
    expect(forged.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
    run = act(run, fresh.lab, { type: 'aks-resource-cancel' }).run
    expect(resourceView(run, fresh.target).experiment.phase).toBe('cancelled')
  })

  it('warms on complete metrics, runs the declared profile, and keeps routed proof through JSON reload', () => {
    const { run: initial, lab, target } = seedResourceTest({ replicas: 2 })
    let run = act(initial, lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    run = advanceResources(run, lab, 15)
    run = JSON.parse(JSON.stringify(run))
    run = advanceResources(run, lab, 45)
    const view = resourceView(run, target)
    expect(view.experiment.phase).toBe('complete')
    expect(view.experiment.totals.arrivals).toBe(300)
    expect(view.experiment.routeSamples.length).toBeGreaterThanOrEqual(2)
    expect(view.experiment.routeSamples.at(-1).route.podUid).toBeTruthy()
    expect(view.experiment.routeSamples.at(-1).body.checksum).toBe(3230)
    expect(view.experiment.observations.length).toBeLessThanOrEqual(700)
    expect(view.experiment.routeSamples.length).toBeLessThanOrEqual(12)
    const oneShot = seedResourceTest({ replicas: 2 })
    let comparison = act(oneShot.run, oneShot.lab, { type: 'aks-resource-start', scenarioId: 'test-local-work' }).run
    comparison = advanceResources(comparison, oneShot.lab, 60)
    const compared = resourceView(comparison, oneShot.target).experiment
    expect(view.experiment.totals).toEqual(compared.totals)
    expect(view.experiment.routeSamples.map(item => item.requestId)).toEqual(compared.routeSamples.map(item => item.requestId))
    expect(view.experiment.observations.map(item => [item.second, item.completed, item.remaining])).toEqual(compared.observations.map(item => [item.second, item.completed, item.remaining]))
  })

  it('completes the fixed manual three-replica workload from real router samples', () => {
    const { run: initial, lab, target } = seedResourceTest({ replicas: 3 })
    lab.scenarios['manual-alias'] = { kind: 'aks-resource-profile', version: 1, profileId: 'manual-work',
      target: { clusterId: target.clusterId, namespace: target.namespace, deploymentName: target.deploymentName }, requiredReadyReplicas: 3 }
    lab.tasks.push({ id: 'manual-history-proof', verification: { scenarioId: 'manual-alias', scenarioVersion: 1 },
      dependencies: resourceDependencies(target, { historical: true, profileId: 'manual-work' }), check: () => false })
    let run = act(initial, lab, { type: 'aks-resource-start', scenarioId: 'manual-alias' }).run
    run = advanceResources(run, lab, 60)
    const experiment = resourceView(run, target).experiment
    expect(experiment.phase).toBe('complete')
    expect(experiment.outcome).toBe('passed')
    expect(experiment.totals).toMatchObject({ arrivals: 300, completed: 300, remaining: 0 })
    expect(experiment.routeSamples.filter(item => item.final).at(-1).workload).toMatchObject({ operation: 'process_batch', units: 20, checksum: 3230 })
    const proofId = run.evidence.currentEvidenceByTask['manual-history-proof']
    const proof = run.evidence.experimentsById[proofId]
    const dependencyKey = Object.keys(proof.dependencyValues)[0]
    const beforeGeneration = proof.dependencyGenerations[dependencyKey]
    const deployment = parseYaml(run.project.savedFiles['k8s/deployment.yaml']); delete deployment.spec.replicas
    run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
    run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    const hpa = { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', metadata: { name: 'assistant-cpu', namespace: target.namespace },
      spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: target.deploymentName }, minReplicas: 2, maxReplicas: 4,
        metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 60 } } }] } }
    run = act(run, lab, { type: 'save-file', path: 'k8s/hpa.yaml', text: stringifyYaml(hpa) }).run
    run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }).run
    expect(run.dependencyGenerations[dependencyKey] ?? 0).toBe(beforeGeneration)
    expect(run.evidence.currentEvidenceByTask['manual-history-proof']).toBe(proofId)
  })

  it('waits for the adopted HPA minimum, observes scale out and scale in, and retains real receipts', () => {
    const hpa = { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', metadata: { name: 'assistant-cpu', namespace: 'assistant' },
      spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'assistant' }, minReplicas: 2, maxReplicas: 4,
        metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 60 } } }],
        behavior: { scaleDown: { stabilizationWindowSeconds: 60 } } } }
    const seeded = seedResourceTest({ hpa })
    const deployment = parseYaml(seeded.run.project.savedFiles['k8s/deployment.yaml']); delete deployment.spec.replicas
    let run = act(seeded.run, seeded.lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
    run = act(run, seeded.lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    const scenarioId = 'guided-cycle-alias'
    seeded.lab.scenarios[scenarioId] = { kind: 'aks-resource-profile', version: 1, profileId: 'guided-cycle', target: {
      clusterId: seeded.clusterId, namespace: seeded.target.namespace, deploymentName: seeded.target.deploymentName }, requiredReadyReplicas: 2 }
    seeded.lab.tasks.push({ id: 'guided-evidence', verification: { scenarioId, scenarioVersion: 1 },
      dependencies: resourceDependencies(seeded.target, { historical: true, profileId: 'guided-cycle' }), check: () => false })
    run = act(run, seeded.lab, { type: 'aks-resource-start', scenarioId }).run
    run = advanceResources(run, seeded.lab, 240)
    run = JSON.parse(JSON.stringify(run))
    run = advanceResources(run, seeded.lab, 60)
    const experiment = resourceView(run, seeded.target).experiment
    expect(experiment.phaseZeroAtMs).toBeGreaterThan(0)
    expect(experiment.baselineReplicas).toBe(2)
    expect(experiment.phase).toBe('complete')
    expect(experiment.outcome).toBe('passed')
    expect(experiment.scaleReceipts.some(item => item.from === 2 && item.to === 4)).toBe(true)
    expect(experiment.scaleReceipts.some(item => item.from > item.to)).toBe(true)
    expect(experiment.routeSamples.filter(item => item.offsetSeconds === 120)).toHaveLength(1)
    expect(experiment.scaleReceipts.some(item => item.from > item.to && item.atMs > experiment.phaseZeroAtMs + 120_000)).toBe(true)
    expect(experiment.totals.remaining).toBe(0)
    const evidenceId = run.evidence.currentEvidenceByTask['guided-evidence']
    expect(evidenceId).toBeTruthy()
    const evidence = run.evidence.experimentsById[evidenceId]
    for (const key of Object.keys(evidence.dependencyValues)) expect(run.dependencyGenerations[key] ?? 0).toBe(evidence.dependencyGenerations[key])
  })

  it('samples the real AI answer with dependency wait time excluded from local CPU', () => {
    const c = seedAdoptedProfile('ai-wait')
    let run = act(c.run, c.lab, { type: 'aks-resource-start', scenarioId: c.scenarioId }).run
    run = advanceResources(run, c.lab, 90)
    const experiment = resourceView(run, c.target).experiment
    expect(experiment.phaseZeroAtMs).toBeGreaterThan(0)
    expect(experiment.phase).toBe('complete')
    expect(experiment.outcome).toBe('passed')
    expect(experiment.routeSamples.filter(item => item.request.path === '/api/ask').every(item => item.status === 200 && item.body.answer)).toBe(true)
    expect(experiment.routeSamples.at(-1).integrationTrace.profileId).toBe('answer-wait-150ms')
    expect(experiment.scaleReceipts.some(item => item.to > item.from)).toBe(false)
    expect(experiment.observations.every(item => item.pods.filter(pod => pod.ready).every(pod => pod.cpuDemandM < 100))).toBe(true)
  })

  it.each([
    ['reference', { cpu: '300m', memory: '256Mi' }, { cpu: '600m', memory: '384Mi' }, 60, 60],
    ['alternative', { cpu: '250m', memory: '256Mi' }, { cpu: '500m', memory: '384Mi' }, 70, 90],
  ])('checks independent-cycle throughput and bounds for the %s configuration', (_label, requests, limits, targetUtilization, stabilization) => {
    const c = seedAdoptedProfile('independent-cycle', { resources: { requests, limits }, units: 30, scratchMiB: 160,
      maxReplicas: 6, targetUtilization, stabilization })
    let run = act(c.run, c.lab, { type: 'aks-resource-start', scenarioId: c.scenarioId }).run
    run = advanceResources(run, c.lab, 30)
    run = advanceResources(run, c.lab, 300)
    const experiment = resourceView(run, c.target).experiment
    expect(experiment.phase).toBe('complete')
    expect(experiment.outcome).toBe('passed')
    expect(experiment.totals.completed).toBe(experiment.totals.arrivals)
    expect(experiment.observations.find(item => item.second === 90).completed).toBeGreaterThanOrEqual(32 - 1e-9)
    expect(experiment.observations.find(item => item.second === 150).remaining).toBe(0)
    expect(experiment.observations.at(-1)).toMatchObject({ desiredReplicas: 2, readyReplicas: 2 })
    expect(experiment.routeSamples.every(item => item.workload.units === 30 && item.workload.checksum === 7395)).toBe(true)
  })

  it('keeps the manual historical selector stable across same-file unrelated documents and HPA adoption', () => {
    const { run: initial, lab, target } = seedResourceTest({ replicas: 3 })
    const selector = resourceDependencies(target, { historical: true, profileId: 'manual-work' })
    const value = run => Object.values(selector)[0]({ runtime: run.runtime, project: run.project, artifacts: run.artifacts, sandbox: run.sandbox })
    const before = value(initial)
    const config = { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'other-config', namespace: 'other' }, data: { sample: 'unrelated' } }
    let run = act(initial, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: `${initial.project.savedFiles['k8s/deployment.yaml']}\n---\n${initial.project.savedFiles['k8s/service.yaml']}\n---\n${stringifyYaml(config)}` }).run
    expect(value(run)).toEqual(before)

    const hpa = { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', metadata: { name: 'assistant-cpu', namespace: target.namespace },
      spec: { scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: target.deploymentName }, minReplicas: 2, maxReplicas: 4,
        metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 60 } } }] } }
    const deployment = parseYaml(initial.project.savedFiles['k8s/deployment.yaml'])
    delete deployment.spec.replicas
    const text = `${stringifyYaml(deployment)}\n---\n${stringifyYaml(hpa)}\n---\n${stringifyYaml(config)}`
    run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text }).run
    expect(value(run)).toEqual(before)
  })
})
