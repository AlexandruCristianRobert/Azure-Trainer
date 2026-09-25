import { describe, expect, it } from 'vitest'
import { aksConnectivityIndependentLab } from '../src/data/labs/aks-journey/connectivity-independent.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { executeAksSolution, act } from './helpers/aks.js'
import { resolveServiceDns } from '../src/lib/kubernetes/connectivity.js'

function solve(run) {
  for (const task of aksConnectivityIndependentLab.tasks) run = executeAksSolution(run, aksConnectivityIndependentLab, task)
  return run
}
function done(run, id) { return evaluateLab(aksConnectivityIndependentLab, run).tasks.find(task => task.id === id).done }

describe('independent AKS connectivity Lab', () => {
  it('completes from a fresh standalone run using the authored Solutions', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'independent-network' })
    run = solve(run)
    expect(evaluateLab(aksConnectivityIndependentLab, run).isComplete).toBe(true)
  })

  it('requires the review route even though the primary application is healthy', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'namespace-decoy' })
    for (const scenarioId of ['independent-network-primary-internal', 'independent-network-primary-external']) {
      run = act(run, aksConnectivityIndependentLab, { type: 'aks-request', scenarioId }).run
    }
    expect(evaluateLab(aksConnectivityIndependentLab, run).isComplete).toBe(false)
  })

  it('accepts either the supplied named or numeric review backend port', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'numeric-review-port' })
    const numeric = aksConnectivityIndependentLab.solutionFiles['k8s/review-service-internal.yaml'].replace('targetPort: http', 'targetPort: 8080')
    run = act(run, aksConnectivityIndependentLab, { type: 'save-file', path: 'k8s/review-service-internal.yaml', text: numeric }).run
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/review-service-internal.yaml' }).run
    expect(evaluateLab(aksConnectivityIndependentLab, run).tasks.find(task => task.id === 'review-internal-service').done).toBe(true)
  })

  it('accepts a YAML formatting variant but rejects a wrong review internal Service port', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'review-port-contract' })
    const formatted = aksConnectivityIndependentLab.solutionFiles['k8s/review-service-internal.yaml'].replace('    - protocol: TCP\n      port: 8080\n      targetPort: http', '    - targetPort: http\n      protocol: TCP\n      port: 8080')
    run = act(run, aksConnectivityIndependentLab, { type: 'save-file', path: 'k8s/review-service-internal.yaml', text: formatted }).run
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/review-service-internal.yaml' }).run
    expect(done(run, 'review-internal-service')).toBe(true)
    const wrongPort = formatted.replace('port: 8080', 'port: 80')
    run = act(run, aksConnectivityIndependentLab, { type: 'save-file', path: 'k8s/review-service-internal.yaml', text: wrongPort }).run
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/review-service-internal.yaml' }).run
    const result = applyRunAction(run, { type: 'aks-request', scenarioId: 'independent-network-review-internal' }, aksConnectivityIndependentLab)
    const evidence = result.run.evidence.experimentsById[result.run.evidence.currentEvidenceByTask['review-internal-answer']]
    expect(evidence.measurements.transport.reason).toBe('SERVICE_PORT')
  })

  it('does not accept caller-supplied primary text as a review answer', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'review-masquerade' })
    for (const id of ['review-internal-service', 'review-external-service']) run = executeAksSolution(run, aksConnectivityIndependentLab, aksConnectivityIndependentLab.tasks.find(task => task.id === id))
    const result = applyRunAction(run, { type: 'aks-request', scenarioId: 'independent-network-review-internal', body: { answer: 'Training backups are kept for 30 days.' } }, aksConnectivityIndependentLab)
    expect(result.diagnostics).toHaveLength(1)
    expect(done(result.run, 'review-internal-answer')).toBe(false)
  })

  it('does not accept a review public route with a ClusterIP Service', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'wrong-review-public-type' })
    const wrongType = aksConnectivityIndependentLab.solutionFiles['k8s/review-service-external.yaml'].replace('type: LoadBalancer', 'type: ClusterIP')
    run = act(run, aksConnectivityIndependentLab, { type: 'save-file', path: 'k8s/review-service-external.yaml', text: wrongType }).run
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/review-service-external.yaml' }).run
    const result = applyRunAction(run, { type: 'aks-request', scenarioId: 'independent-network-review-external' }, aksConnectivityIndependentLab)
    expect(result.diagnostics).toHaveLength(1)
    const evidenceId = result.run.evidence.currentEvidenceByTask['review-external-answer']
    expect(result.run.evidence.experimentsById[evidenceId].outcome).toBe('failed')
  })

  it('requires canonical primary files as well as separate route proofs', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'primary-edit' })
    run = act(run, aksConnectivityIndependentLab, { type: 'save-file', path: 'k8s/primary-deployment.yaml', text: run.project.savedFiles['k8s/primary-deployment.yaml'].replace('replicas: 2', 'replicas: 1') }).run
    expect(evaluateLab(aksConnectivityIndependentLab, run).tasks.find(task => task.id === 'primary-intact').done).toBe(false)
  })

  it('detects an applied primary public Service drift', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'primary-public-drift' })
    const drifted = run.project.savedFiles['k8s/primary-service-external.yaml'].replace('port: 80', 'port: 81')
    run = act(run, aksConnectivityIndependentLab, { type: 'save-file', path: 'k8s/primary-service-external.yaml', text: drifted }).run
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/primary-service-external.yaml' }).run
    expect(evaluateLab(aksConnectivityIndependentLab, run).tasks.find(task => task.id === 'primary-intact').done).toBe(false)
  })

  it('requires the 16-file independent manifest and rejects runtime primary snapshot drift', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'primary-runtime-drift' })
    expect(Object.keys(run.project.savedFiles)).toHaveLength(16)
    const state = run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id]
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.namespace === 'primary')
    state.podSnapshots[pod.metadata.uid] = { ...state.podSnapshots[pod.metadata.uid], environment: { ...state.podSnapshots[pod.metadata.uid].environment, APP_ENV: 'review' } }
    expect(done(run, 'primary-intact')).toBe(false)
  })

  it('permits a canonical primary replacement but rejects a configuration captured by replacement Pods', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'primary-replacement' })
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n primary' }).run
    expect(done(run, 'primary-intact')).toBe(true)
    const drifted = run.project.savedFiles['k8s/primary-configmap.yaml'].replace('APP_ENV: production', 'APP_ENV: review')
    run = act(run, aksConnectivityIndependentLab, { type: 'save-file', path: 'k8s/primary-configmap.yaml', text: drifted }).run
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl apply -f k8s/primary-configmap.yaml' }).run
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n primary' }).run
    expect(done(run, 'primary-intact')).toBe(false)
  })

  it('invalidates only the restarted review route and retains primary proof through a review-only repair', () => {
    let run = solve(createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'route-scoped-repair' }))
    const clusterId = run.sandbox.aksClusters[0].id
    const priorReviewLog = run.runtime.kubernetes.clusters[clusterId].connectivity.applicationLogs.find(log => log.namespace === 'review')
    expect(done(run, 'review-internal-answer')).toBe(true)
    expect(done(run, 'primary-internal-answer')).toBe(true)
    run = act(run, aksConnectivityIndependentLab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n review' }).run
    expect(run.runtime.kubernetes.clusters[clusterId].connectivity.applicationLogs.some(log => log.requestId === priorReviewLog.requestId)).toBe(true)
    expect(done(run, 'review-internal-answer')).toBe(false)
    expect(done(run, 'primary-internal-answer')).toBe(true)
    run = act(run, aksConnectivityIndependentLab, { type: 'aks-request', scenarioId: 'independent-network-review-internal' }).run
    expect(done(run, 'review-internal-answer')).toBe(true)
    expect(done(run, 'primary-external-answer')).toBe(true)
  })

  it('resolves same-named Services against the declared cluster even when addresses match', () => {
    const run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'two-clusters' })
    const firstId = run.sandbox.aksClusters[0].id
    const secondId = `${firstId}-second`
    const second = structuredClone(run.runtime.kubernetes.clusters[firstId])
    second.resources['Service/primary/assistant-internal'].metadata.uid = 'second-service'
    const twoClusters = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes, clusters: { ...run.runtime.kubernetes.clusters, [secondId]: second } } } }
    expect(resolveServiceDns(twoClusters, { clusterId: firstId, clientNamespace: 'primary', hostname: 'assistant-internal' }).serviceKey).toBe('Service/primary/assistant-internal')
    expect(resolveServiceDns(twoClusters, { clusterId: secondId, clientNamespace: 'primary', hostname: 'assistant-internal' }).serviceKey).toBe('Service/primary/assistant-internal')
    expect(twoClusters.runtime.kubernetes.clusters[firstId].resources['Service/primary/assistant-internal'].metadata.uid).not.toBe('second-service')
  })
})
