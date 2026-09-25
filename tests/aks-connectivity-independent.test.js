import { describe, expect, it } from 'vitest'
import { aksConnectivityIndependentLab } from '../src/data/labs/aks-journey/connectivity-independent.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { executeAksSolution, act } from './helpers/aks.js'

describe('independent AKS connectivity Lab', () => {
  it('completes from a fresh standalone run using the authored Solutions', () => {
    let run = createBehavioralRun(aksConnectivityIndependentLab, { attemptId: 'independent-network' })
    for (const task of aksConnectivityIndependentLab.tasks) run = executeAksSolution(run, aksConnectivityIndependentLab, task)
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
})
