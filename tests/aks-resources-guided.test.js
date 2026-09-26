import { describe, expect, it } from 'vitest'
import { aksResourcesGuidedLab } from '../src/data/labs/aks-journey/resources-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { act, executeAksSolution } from './helpers/aks.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { RESOURCE_FILES } from '../src/data/templates/aks-python/resources.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'

describe('AKS guided resources and scaling lab', () => {
  it('seeds one healthy starter Pod without resource settings or an HPA', () => {
    const run = createBehavioralRun(aksResourcesGuidedLab, { attemptId: 'guided-resources-seed' })
    const clusterId = run.sandbox.aksClusters[0].id
    const state = run.runtime.kubernetes.clusters[clusterId]
    const deployment = state.resources['Deployment/assistant/assistant']
    const saved = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
    const pods = getDeploymentPods(run, clusterId, 'assistant', 'assistant')
    expect(saved.spec.replicas).toBe(1)
    expect(deployment.spec.replicas).toBe(1)
    expect(pods).toHaveLength(1)
    expect(pods[0].status.phase).toBe('Running')
    expect(pods[0].status.conditions).toContainEqual(expect.objectContaining({ type: 'Ready', status: 'True' }))
    expect(pods[0].spec.containers[0].resources).toBeUndefined()
    expect(Object.values(state.resources).filter(item => item.kind === 'HorizontalPodAutoscaler')).toHaveLength(0)
  })

  it('completes manual scaling, HPA scale-out and scale-in, then the final AI proof', () => {
    let run = createBehavioralRun(aksResourcesGuidedLab, { attemptId: 'guided-resources' })
    let beforeManual
    for (const task of aksResourcesGuidedLab.tasks) {
      run = executeAksSolution(run, aksResourcesGuidedLab, task)
      expect(evaluateLab(aksResourcesGuidedLab, run).tasks.find(item => item.id === task.id).done, `${task.id} should pass immediately after its Solution`).toBe(true)
      if (task.id === 'resource-sizing') beforeManual = structuredClone(run)
      if (task.id === 'manual-replicas') {
        const literalOnly = structuredClone(run)
        const id = literalOnly.evidence.currentEvidenceByTask['manual-replicas']
        literalOnly.evidence.experimentsById[id].measurements.samples = [{ request: { path: '/api/work' }, body: { checksum: 3230 } }]
        expect(evaluateLab(aksResourcesGuidedLab, literalOnly).tasks.find(item => item.id === 'manual-replicas').done).toBe(false)
      }
      if (task.id === 'adopt-hpa') {
        const noLimits = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
        delete noLimits.spec.template.spec.containers[0].resources.limits
        const altered = act(run, aksResourcesGuidedLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(noLimits) }).run
        expect(evaluateLab(aksResourcesGuidedLab, altered).tasks.find(item => item.id === 'adopt-hpa').done).toBe(false)
        const started = applyRunAction(run, { type: 'aks-resource-start', scenarioId: 'guided-resource-cycle' }, aksResourcesGuidedLab)
        expect(started.diagnostics).toEqual([])
        const manuallyScaled = applyRunAction(started.run, { type: 'command', line: 'kubectl scale deployment/assistant --replicas 3 -n assistant' }, aksResourcesGuidedLab)
        expect(manuallyScaled.diagnostics).toEqual([])
        const testClusterId = run.sandbox.aksClusters[0].id
        expect(manuallyScaled.run.runtime.kubernetes.clusters[testClusterId].resourcesRuntime.experiment).toMatchObject({ phase: 'cancelled', outcome: 'cancelled' })
        expect(manuallyScaled.run.evidence.currentEvidenceByTask['scale-cycle']).toBeUndefined()
      }
      if (task.id === 'scale-cycle') {
        const missingScaleProof = structuredClone(run)
        const id = missingScaleProof.evidence.currentEvidenceByTask['scale-cycle']
        missingScaleProof.evidence.experimentsById[id].measurements.scaleReceipts = []
        expect(evaluateLab(aksResourcesGuidedLab, missingScaleProof).tasks.find(item => item.id === 'scale-cycle').done).toBe(false)
        const earlyScaleIn = structuredClone(run)
        const earlyId = earlyScaleIn.evidence.currentEvidenceByTask['scale-cycle']
        const start = earlyScaleIn.evidence.experimentsById[earlyId].startedAtMs
        const down = earlyScaleIn.evidence.experimentsById[earlyId].measurements.scaleReceipts.find(item => item.to === 2 && item.from > 2)
        if (down) down.atMs = start + 120_000
        expect(evaluateLab(aksResourcesGuidedLab, earlyScaleIn).tasks.find(item => item.id === 'scale-cycle').done).toBe(false)
      }
      if (task.id === 'cpu-versus-wait') {
        const missingAiOperations = structuredClone(run)
        const id = missingAiOperations.evidence.currentEvidenceByTask['cpu-versus-wait']
        missingAiOperations.evidence.experimentsById[id].measurements.samples = []
        expect(evaluateLab(aksResourcesGuidedLab, missingAiOperations).tasks.find(item => item.id === 'cpu-versus-wait').done).toBe(false)
      }
      if (task.id === 'final-answer') {
        const missingAiOperations = structuredClone(run)
        const id = missingAiOperations.evidence.currentEvidenceByTask['final-answer']
        missingAiOperations.evidence.experimentsById[id].measurements.integrationTrace = null
        expect(evaluateLab(aksResourcesGuidedLab, missingAiOperations).tasks.find(item => item.id === 'final-answer').done).toBe(false)
        const reduced = act(run, aksResourcesGuidedLab, { type: 'save-file', path: 'app.py',
          text: run.project.savedFiles['app.py'].replace('WORK_UNITS = 20', 'WORK_UNITS = 19').replace('SCRATCH_MIB = 96', 'SCRATCH_MIB = 95') }).run
        expect(evaluateLab(aksResourcesGuidedLab, reduced).tasks.find(item => item.id === 'workload-source').done).toBe(false)
        const stale = act(run, aksResourcesGuidedLab, { type: 'save-file', path: 'app.py', text: `${run.project.savedFiles['app.py']}\n# stale image source` }).run
        expect(evaluateLab(aksResourcesGuidedLab, stale).tasks.find(item => item.id === 'workload-source').done).toBe(false)
        const literalApp = run.project.savedFiles['app.py'].replace('return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)',
          'return {"status": 200, "body": {"checksum": 3230, "units": 20}}')
        const savedLiteral = applyRunAction(run, { type: 'save-file', path: 'app.py', text: literalApp }, aksResourcesGuidedLab)
        expect(savedLiteral.diagnostics).toEqual([])
        const literalBuild = applyRunAction(savedLiteral.run, { type: 'command', line: 'az acr build -r acraksresourcesguided -t assistant:resources-v1 .' }, aksResourcesGuidedLab)
        expect(literalBuild.diagnostics.length > 0 || literalBuild.lines.some(line => line.kind === 'err')).toBe(true)
        const literalDeploy = applyRunAction(savedLiteral.run, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }, aksResourcesGuidedLab)
        expect(evaluateLab(aksResourcesGuidedLab, literalDeploy.run).tasks.find(item => item.id === 'workload-source').done).toBe(false)
      }
    }
    let hpaBeforeManual = act(beforeManual, aksResourcesGuidedLab, { type: 'command', line: 'kubectl scale deployment/assistant --replicas 3 -n assistant' }).run
    const manualManifest = parseYaml(hpaBeforeManual.project.savedFiles['k8s/deployment.yaml'])
    manualManifest.spec.replicas = 3
    hpaBeforeManual = act(hpaBeforeManual, aksResourcesGuidedLab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(manualManifest) }).run
    hpaBeforeManual = act(hpaBeforeManual, aksResourcesGuidedLab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    hpaBeforeManual = act(hpaBeforeManual, aksResourcesGuidedLab, { type: 'save-file', path: 'k8s/hpa.yaml', text: RESOURCE_FILES['k8s/hpa.yaml'] }).run
    hpaBeforeManual = act(hpaBeforeManual, aksResourcesGuidedLab, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }).run
    const prematureManual = applyRunAction(hpaBeforeManual, { type: 'aks-resource-start', scenarioId: 'guided-resource-manual' }, aksResourcesGuidedLab)
    expect(prematureManual.diagnostics[0].message).toMatch(/no HPA/i)
    expect(evaluateLab(aksResourcesGuidedLab, run).isComplete).toBe(true)
  })

  it('requires captured source operation, declared work and HPA experiment evidence', () => {
    expect(aksResourcesGuidedLab.tasks.map(task => task.id)).toEqual([
      'workload-source', 'resource-sizing', 'manual-replicas', 'adopt-hpa', 'scale-cycle', 'cpu-versus-wait', 'final-answer',
    ])
    expect(aksResourcesGuidedLab.scenarios['guided-resource-cycle'].profileId).toBe('guided-cycle')
    expect(aksResourcesGuidedLab.tasks.every(task => task.hints?.length === 2 && task.solution?.steps?.length && task.examNote)).toBe(true)
  })
})
