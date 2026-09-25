import { describe, expect, it } from 'vitest'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { aksProbesGuidedLab } from '../src/data/labs/aks-journey/probes-guided.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { act, executeAksSolution } from './helpers/aks.js'

function task(run, id) { return evaluateLab(aksProbesGuidedLab, run).tasks.find(item => item.id === id) }

function executeBefore(run, taskId) {
  const index = aksProbesGuidedLab.tasks.findIndex(item => item.id === taskId)
  for (const item of aksProbesGuidedLab.tasks.slice(0, index)) run = executeAksSolution(run, aksProbesGuidedLab, item)
  return run
}

function runExperiment(run, scenarioId) {
  run = act(run, aksProbesGuidedLab, { type: 'aks-probe-start', scenarioId }).run
  let advances = 0
  while (Object.values(run.runtime.kubernetes.clusters).some(state => state.health?.experiment?.scenarioId === scenarioId)) {
    if (++advances > 20) throw new Error(`Experiment ${scenarioId} exceeded the bounded guided window`)
    run = act(run, aksProbesGuidedLab, { type: 'aks-advance', seconds: 30 }).run
  }
  return run
}

function solutionRun(attemptId = 'guided-probes') {
  let run = createBehavioralRun(aksProbesGuidedLab, { attemptId })
  for (const item of aksProbesGuidedLab.tasks) run = executeAksSolution(run, aksProbesGuidedLab, item)
  return run
}

describe('guided AKS health probes Lab 13', () => {
  it('declares Lab 13 tasks, stages, named scenarios, and complete worked Solutions', () => {
    expect(aksProbesGuidedLab).toMatchObject({
      id: 'aks-probes-guided', status: 'available', skillAreaId: 'containers', service: 'aks',
      contentVersion: 1, journeyId: 'aks-knowledge-assistant', journeyOrder: 13, labMode: 'guided',
      manifestId: 'aks-python-health-v1',
    })
    expect(aksProbesGuidedLab.capabilities).toMatchObject({ kubernetes: true, kubernetesConfiguration: true,
      kubernetesConnectivity: true, kubernetesAiIntegration: true, kubernetesProbes: true, acrBuild: true })
    expect(aksProbesGuidedLab.tasks.map(item => item.id)).toEqual([
      'health-source', 'probe-manifest', 'protected-startup', 'traffic-withdrawal', 'automatic-recovery', 'final-answer',
    ])
    expect(aksProbesGuidedLab.scenarios).toMatchObject({
      'guided-probe-startup': { kind: 'aks-probe', version: 1 },
      'guided-probe-readiness': { kind: 'aks-probe', version: 1 },
      'guided-probe-hang': { kind: 'aks-probe', version: 1 },
      'guided-probe-final': { kind: 'aks-request', version: 1 },
    })
    for (const item of aksProbesGuidedLab.tasks) {
      expect(item.explanation, item.id).toBeTruthy()
      expect(item.hints, item.id).toHaveLength(2)
      expect(item.examNote, item.id).toBeTruthy()
      expect(item.solution.steps.length, item.id).toBeGreaterThan(0)
    }
  })

  it('completes all three probe experiments and the final current assistant answer', () => {
    const run = solutionRun()
    expect(evaluateLab(aksProbesGuidedLab, run).isComplete).toBe(true)
    expect(evaluateLab(aksProbesGuidedLab, run).tasks.every(item => item.done)).toBe(true)
    expect(Object.values(run.evidence.experimentsById).filter(item => item.scenarioId.startsWith('guided-probe-')))
      .toHaveLength(4)
    const clusterId = run.sandbox.aksClusters[0].id
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant')).toHaveLength(2)
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant').every(pod => pod.status.conditions.some(item => item.type === 'Ready' && item.status === 'True'))).toBe(true)
  })

  it('requires saved health source, a build, and applied probe YAML as separate deployment states', () => {
    let run = createBehavioralRun(aksProbesGuidedLab, { attemptId: 'guided-probes-build-gaps' })
    const source = aksProbesGuidedLab.solutionFiles['app.py']
    run = act(run, aksProbesGuidedLab, { type: 'draft', path: 'app.py', text: source }).run
    expect(task(run, 'health-source').done).toBe(false)
    run = act(run, aksProbesGuidedLab, { type: 'save-file', path: 'app.py' }).run
    expect(task(run, 'health-source').done).toBe(false)
    run = executeAksSolution(run, aksProbesGuidedLab, aksProbesGuidedLab.tasks.find(item => item.id === 'health-source'))
    expect(task(run, 'health-source').done).toBe(true)
    expect(task(run, 'probe-manifest').done).toBe(false)

    const deployment = aksProbesGuidedLab.solutionFiles['k8s/deployment.yaml']
    run = act(run, aksProbesGuidedLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: deployment }).run
    expect(task(run, 'probe-manifest').done).toBe(false)
    run = act(run, aksProbesGuidedLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(task(run, 'probe-manifest').done).toBe(true)

    run = act(run, aksProbesGuidedLab, { type: 'save-file', path: 'app.py',
      text: run.project.savedFiles['app.py'].replace('initialized() else 503', 'False else 503') }).run
    expect(task(run, 'health-source').done).toBe(false)
  })

  it('rejects constant startup and readiness responses that bypass observed behavior', () => {
    let run = executeBefore(createBehavioralRun(aksProbesGuidedLab, { attemptId: 'guided-probes-constant-start' }), 'protected-startup')
    let code = run.project.savedFiles['app.py'].replace('200 if initialized() else 503', '200')
    run = act(run, aksProbesGuidedLab, { type: 'save-file', path: 'app.py', text: code }).run
    run = act(run, aksProbesGuidedLab, { type: 'command', line: 'az acr build -r acraksprobesguided -t assistant:health-v1 .' }).run
    run = runExperiment(run, 'guided-probe-startup')
    expect(task(run, 'protected-startup').done).toBe(false)

    run = executeBefore(createBehavioralRun(aksProbesGuidedLab, { attemptId: 'guided-probes-constant-ready' }), 'traffic-withdrawal')
    code = run.project.savedFiles['app.py'].replace('200 if initialized() and accepting_requests() else 503', '200')
    run = act(run, aksProbesGuidedLab, { type: 'save-file', path: 'app.py', text: code }).run
    run = act(run, aksProbesGuidedLab, { type: 'command', line: 'az acr build -r acraksprobesguided -t assistant:health-v1 .' }).run
    run = runExperiment(run, 'guided-probe-readiness')
    expect(task(run, 'traffic-withdrawal').done).toBe(false)
  })

  it('requires all probes and rejects manual Pod deletion as hang recovery evidence', () => {
    let run = executeBefore(createBehavioralRun(aksProbesGuidedLab, { attemptId: 'guided-probes-no-probes' }), 'probe-manifest')
    const manifest = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    const container = manifest.spec.template.spec.containers[0]
    delete container.startupProbe; delete container.readinessProbe; delete container.livenessProbe
    run = act(run, aksProbesGuidedLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manifest) }).run
    run = act(run, aksProbesGuidedLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(task(run, 'probe-manifest').done).toBe(false)

    run = executeBefore(createBehavioralRun(aksProbesGuidedLab, { attemptId: 'guided-probes-pod-delete' }), 'automatic-recovery')
    run = act(run, aksProbesGuidedLab, { type: 'aks-probe-start', scenarioId: 'guided-probe-hang' }).run
    run = act(run, aksProbesGuidedLab, { type: 'aks-advance', seconds: 60 }).run
    const clusterId = run.sandbox.aksClusters[0].id
    const targetPod = getDeploymentPods(run, clusterId, 'assistant', 'assistant')[0]
    run = act(run, aksProbesGuidedLab, { type: 'command', line: `kubectl delete pod ${targetPod.metadata.name} -n assistant` }).run
    expect(task(run, 'automatic-recovery').done).toBe(false)
    expect(run.runtime.kubernetes.clusters[clusterId].health.receipts.at(-1)).toMatchObject({ status: 'cancelled' })
    expect(validateBehavioralRun(run, aksProbesGuidedLab)).toBe(run)
  })

  it('does not verify startup before its controlled experiment window finishes', () => {
    let run = executeBefore(createBehavioralRun(aksProbesGuidedLab, { attemptId: 'guided-probes-partial-window' }), 'protected-startup')
    run = act(run, aksProbesGuidedLab, { type: 'aks-probe-start', scenarioId: 'guided-probe-startup' }).run
    run = act(run, aksProbesGuidedLab, { type: 'aks-advance', seconds: 20 }).run
    expect(task(run, 'protected-startup').done).toBe(false)
    expect(Object.values(run.runtime.kubernetes.clusters).some(state => state.health.experiment?.status === 'active')).toBe(true)
    expect(Object.keys(run.evidence.currentEvidenceByTask)).not.toContain('protected-startup')
  })
})
