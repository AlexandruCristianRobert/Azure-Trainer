import { describe, expect, it } from 'vitest'
import { aksAiTroubleshootingLab } from '../src/data/labs/aks-journey/ai-troubleshooting.lab.js'
import { INTEGRATION_QUERY_SOURCE, INTEGRATION_SOLUTION_FILES } from '../src/data/templates/aks-python/integration.js'
import { AI_TROUBLESHOOTING_CLUSTER_ID, AI_TROUBLESHOOTING_IMAGE, AI_TROUBLESHOOTING_REGISTRY } from '../src/data/labs/aks-journey/integration-incidents.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { act, executeAksSolution } from './helpers/aks.js'

const task = id => aksAiTroubleshootingLab.tasks.find(item => item.id === id)
const solveThrough = id => {
  let run = createBehavioralRun(aksAiTroubleshootingLab, { attemptId: `adversarial-${id}` })
  for (const item of aksAiTroubleshootingLab.tasks) {
    run = executeAksSolution(run, aksAiTroubleshootingLab, item)
    if (item.id === id) break
  }
  return run
}
const advance = run => applyRunAction(run, { type: 'aks-integration-next-incident' }, aksAiTroubleshootingLab)
const deployment = run => run.runtime.kubernetes.clusters[AI_TROUBLESHOOTING_CLUSTER_ID].resources['Deployment/assistant/assistant']

describe('AKS AI troubleshooting adversarial gates', () => {
  it('does not accept the retry observation before the retry phase is revealed', () => {
    let run = createBehavioralRun(aksAiTroubleshootingLab, { attemptId: 'retry-phase-gate' })
    run = executeAksSolution(run, aksAiTroubleshootingLab, task('observe-deployment'))
    run = executeAksSolution(run, aksAiTroubleshootingLab, task('repair-deployment'))

    const result = applyRunAction(run, { type: 'aks-request', scenarioId: 'trouble-ai-no-retry' }, aksAiTroubleshootingLab)

    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run).toBe(run)
    expect(evaluateLab(aksAiTroubleshootingLab, run).tasks.find(item => item.id === 'observe-no-retry').done).toBe(false)
  })

  it('does not advance to retries with a saved, applied ConfigMap that Pods have not captured', () => {
    let run = solveThrough('repair-filter')
    const config = run.project.savedFiles['k8s/configmap.yaml'].replace('AUDIENCE: employee', 'AUDIENCE: visitor')
    run = act(run, aksAiTroubleshootingLab, { type: 'save-file', path: 'k8s/configmap.yaml', text: config }).run
    run = act(run, aksAiTroubleshootingLab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run

    const result = advance(run)

    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run.runtime.kubernetes.integrationIncident.phase).toBe('filter')
  })

  it('invalidates phase receipts when the Deployment is deleted and recreated', () => {
    let run = solveThrough('repair-filter')
    expect(() => act(run, aksAiTroubleshootingLab, { type: 'command', line: 'kubectl delete deployment assistant -n assistant' })).toThrow(/Kubernetes state effect is malformed/)
    const recreated = structuredClone(run)
    deployment(recreated).metadata.uid = `${deployment(recreated).metadata.uid}-recreated`
    expect(() => validateBehavioralRun(recreated, aksAiTroubleshootingLab)).toThrow(/Kubernetes runtime state is missing or malformed/)
  })

  it('requires the audience predicate for the filter recovery proof after rebuilding', () => {
    let run = solveThrough('observe-filter')
    const withoutAudience = INTEGRATION_QUERY_SOURCE.replace(/\n\s+AND audience = %\(audience\)s/, '')
    run = act(run, aksAiTroubleshootingLab, { type: 'save-file', path: 'retrieval.sql', text: withoutAudience }).run
    run = act(run, aksAiTroubleshootingLab, { type: 'command', line: `az acr build -r ${AI_TROUBLESHOOTING_REGISTRY} -t assistant:baseline .` }).run
    run = act(run, aksAiTroubleshootingLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    for (const step of task('repair-filter').solution.steps.filter(item => item.kind !== 'scenario')) {
      if (step.kind === 'file') run = act(run, aksAiTroubleshootingLab, { type: 'save-file', path: step.path, text: step.content }).run
      else run = act(run, aksAiTroubleshootingLab, { type: 'command', line: step.line }).run
    }
    run = act(run, aksAiTroubleshootingLab, { type: 'aks-request', scenarioId: 'trouble-ai-filter-recovered' }).run

    expect(evaluateLab(aksAiTroubleshootingLab, run).tasks.find(item => item.id === 'repair-filter').done).toBe(false)
    expect(deployment(run).spec.template.spec.containers[0].image).toBe(AI_TROUBLESHOOTING_IMAGE.replace(':resilient-v1', ':baseline'))
  })

  it('requires the deployed query audience parameter to come from the captured AUDIENCE setting', () => {
    let run = solveThrough('observe-filter')
    const literalAudience = INTEGRATION_SOLUTION_FILES['app.py'].replace('"audience": cfg["audience"]', '"audience": "employee"')
    expect(literalAudience).not.toBe(INTEGRATION_SOLUTION_FILES['app.py'])
    run = act(run, aksAiTroubleshootingLab, { type: 'save-file', path: 'app.py', text: literalAudience }).run
    run = act(run, aksAiTroubleshootingLab, { type: 'command', line: `az acr build -r ${AI_TROUBLESHOOTING_REGISTRY} -t assistant:baseline .` }).run
    run = act(run, aksAiTroubleshootingLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    for (const step of task('repair-filter').solution.steps.filter(item => item.kind !== 'scenario')) {
      if (step.kind === 'file') run = act(run, aksAiTroubleshootingLab, { type: 'save-file', path: step.path, text: step.content }).run
      else run = act(run, aksAiTroubleshootingLab, { type: 'command', line: step.line }).run
    }
    run = act(run, aksAiTroubleshootingLab, { type: 'aks-request', scenarioId: 'trouble-ai-filter-recovered' }).run

    expect(evaluateLab(aksAiTroubleshootingLab, run).tasks.find(item => item.id === 'repair-filter').done).toBe(false)
  })

  it('retains valid historical receipts through the policy rebuild and records bounded retry traces without secrets', () => {
    const run = solveThrough('final-healthy')
    const incident = run.runtime.kubernetes.integrationIncident
    expect(incident.transitions).toHaveLength(2)
    expect(incident.transitions.every(item => run.evidence.experimentsById[item.evidenceId]?.outcome === 'passed')).toBe(true)

    const measurements = taskId => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[taskId]].measurements
    const noRetry = measurements('observe-no-retry').integrationTrace
    expect(noRetry.attempts.map(item => item.operation)).toEqual(['embedding'])
    expect(noRetry.attempts).toHaveLength(1)
    const embeddingRetry = measurements('transient-embedding').integrationTrace
    expect(embeddingRetry.attempts.map(item => item.operation)).toEqual(['embedding', 'embedding', 'postgres-query', 'answer'])
    expect(embeddingRetry.elapsedMs).toBe(310)
    const postgresRetry = measurements('transient-postgres').integrationTrace
    expect(postgresRetry.attempts.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'postgres-query', 'answer'])
    expect(postgresRetry.elapsedMs).toBe(250)
    const answerFailure = measurements('persistent-answer').integrationTrace
    expect(answerFailure.attempts.filter(item => item.operation === 'answer')).toHaveLength(3)
    expect(answerFailure.elapsedMs).toBe(520)
    const timeout = measurements('persistent-timeout').integrationTrace
    expect(timeout.attempts).toHaveLength(3)
    expect(timeout.elapsedMs).toBe(900)
    const deadline = measurements('deadline-bound').integrationTrace
    expect(deadline.attempts).toHaveLength(1)
    expect(deadline.elapsedMs).toBe(40)
    expect(JSON.stringify(run.runtime.kubernetes.requests)).not.toContain('training-only-password')
  })
})
