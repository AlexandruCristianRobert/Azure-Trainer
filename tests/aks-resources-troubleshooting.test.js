import { describe, expect, it } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { aksResourcesTroubleshootingLab } from '../src/data/labs/aks-journey/resources-troubleshooting.lab.js'
import { executeAksSolution } from './helpers/aks.js'

describe('AKS resource troubleshooting', () => {
  it('cannot inject the memory incident before the scheduling diagnosis and repair', () => {
    const run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resources-incident' })
    const result = applyRunAction(run, { type: 'aks-resource-next-incident' }, aksResourcesTroubleshootingLab)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
  })

  it('executes all ordered solutions through real run actions', () => {
    let run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resources-solution' })
    for (const task of aksResourcesTroubleshootingLab.tasks) {
      try { run = executeAksSolution(run, aksResourcesTroubleshootingLab, task) } catch (error) { throw new Error(`${task.id}: ${error.message}`) }
      if (task.id === 'observe-oom') {
        const repeatedDiagnosis = applyRunAction(run, { type: 'aks-resource-start', scenarioId: 'trouble-resource-pending' }, aksResourcesTroubleshootingLab)
        expect(repeatedDiagnosis.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'RESOURCE_INCIDENT_PHASE' })]))
        expect(repeatedDiagnosis.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
      }
      if (task.id === 'observe-hpa') {
        const baselineNoCpu = applyRunAction(structuredClone(run), { type: 'aks-resource-start', scenarioId: 'trouble-resource-no-cpu-request' }, aksResourcesTroubleshootingLab)
        expect(baselineNoCpu.diagnostics).toEqual([])
        const altered = structuredClone(run)
        const changedSource = altered.project.savedFiles['app.py'].replace('WORK_UNITS = 20', 'WORK_UNITS = 21')
        let candidate = applyRunAction(altered, { type: 'draft', path: 'app.py', text: changedSource }, aksResourcesTroubleshootingLab).run
        candidate = applyRunAction(candidate, { type: 'save-file', path: 'app.py' }, aksResourcesTroubleshootingLab).run
        const rebuilt = applyRunAction(candidate, { type: 'command', line: 'az acr build -r acraksresourcestrouble -t assistant:resources-v1 .' }, aksResourcesTroubleshootingLab)
        expect(rebuilt.diagnostics).toEqual([])
        const invalidatedNoCpu = applyRunAction(rebuilt.run, { type: 'aks-resource-start', scenarioId: 'trouble-resource-no-cpu-request' }, aksResourcesTroubleshootingLab)
        expect(invalidatedNoCpu.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INVALID_RESOURCE_EXPERIMENT' })]))
      }
      const scenario = task.verification?.scenarioId
      if (scenario) {
        const evidenceId = run.evidence.currentEvidenceByTask[task.id]
        const evidence = run.evidence.experimentsById[evidenceId]
        expect(evidence).toMatchObject({ taskId: task.id, scenarioId: scenario, scenarioVersion: 1, completed: true, outcome: 'passed' })
        const cluster = run.runtime.kubernetes.clusters[aksResourcesTroubleshootingLab.scenarios[scenario].target.clusterId]
        const experiment = cluster.resourcesRuntime.experiment
        if (scenario === 'trouble-resource-pending') expect(experiment.pendingProof).toMatchObject({ reasons: ['Insufficient cpu', 'Insufficient cpu'], podUids: expect.arrayContaining([expect.any(String)]) })
        if (scenario === 'trouble-resource-oom') {
          expect(experiment.oomProof).toMatchObject({ podUid: expect.any(String), containerId: expect.any(String), restartCount: expect.any(Number), samePod: true })
          expect(cluster.resourcesRuntime.receipts).toContainEqual(expect.objectContaining({ kind: 'container-termination', podUid: experiment.oomProof.podUid, reason: 'OOMKilled', exitCode: 137, atMs: experiment.oomProof.atMs }))
        }
        if (scenario === 'trouble-resource-no-cpu-request') expect(experiment.hpaObservations.filter(item => item.reason === 'FailedGetResourceMetric' && !item.scalingActive && item.samplePodUids.length >= 2).length).toBeGreaterThanOrEqual(2)
      }
      run = JSON.parse(JSON.stringify(run))
    }
    expect(Object.keys(run.evidence.currentEvidenceByTask)).toEqual(expect.arrayContaining(['observe-pending', 'repair-scheduling', 'observe-oom', 'repair-memory', 'observe-hpa', 'final-cycle']))
  })

  it('records a Pending diagnosis immediately without weakening healthy warmup', () => {
    const run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resources-pending' })
    const result = applyRunAction(run, { type: 'aks-resource-start', scenarioId: 'trouble-resource-pending' }, aksResourcesTroubleshootingLab)
    expect(result.diagnostics).toEqual([])
    const evidence = result.run.evidence.experimentsById[result.run.evidence.currentEvidenceByTask['observe-pending']]
    expect(evidence.outcome).toBe('passed')
    expect(result.run.runtime.kubernetes.clusters[evidence.measurements.clusterId].resourcesRuntime.receipts.at(-1).outcome).toBe('passed')
  })

  it('records a failed public Pending retry after the Pods have been repaired', () => {
    let run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resources-pending-retry' })
    run = applyRunAction(run, { type: 'aks-resource-start', scenarioId: 'trouble-resource-pending' }, aksResourcesTroubleshootingLab).run
    const deploymentStep = task => aksResourcesTroubleshootingLab.tasks.find(item => item.id === task).solution.steps.find(step => step.kind === 'file')
    const manifest = deploymentStep('repair-scheduling')
    run = applyRunAction(run, { type: 'draft', path: manifest.path, text: manifest.content }, aksResourcesTroubleshootingLab).run
    run = applyRunAction(run, { type: 'save-file', path: manifest.path }, aksResourcesTroubleshootingLab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }, aksResourcesTroubleshootingLab).run
    run = applyRunAction(run, { type: 'aks-advance', seconds: 10 }, aksResourcesTroubleshootingLab).run

    const retry = applyRunAction(run, { type: 'aks-resource-start', scenarioId: 'trouble-resource-pending' }, aksResourcesTroubleshootingLab)
    expect(retry.diagnostics).toEqual([])
    const evidenceId = retry.run.evidence.currentEvidenceByTask['observe-pending']
    expect(retry.run.evidence.experimentsById[evidenceId]).toMatchObject({ outcome: 'failed', completed: false })
    expect(retry.run.runtime.kubernetes.clusters[aksResourcesTroubleshootingLab.scenarios['trouble-resource-pending'].target.clusterId].resourcesRuntime.experiment.pendingProof).toBeNull()
  })

  it('rejects the supplied Pending workload when its published tag points to an altered rebuild', () => {
    let run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resources-pending-altered-artifact' })
    const source = run.project.savedFiles['app.py'].replace('WORK_UNITS = 20', 'WORK_UNITS = 21')
    run = applyRunAction(run, { type: 'draft', path: 'app.py', text: source }, aksResourcesTroubleshootingLab).run
    run = applyRunAction(run, { type: 'save-file', path: 'app.py' }, aksResourcesTroubleshootingLab).run
    const rebuilt = applyRunAction(run, { type: 'command', line: 'az acr build -r acraksresourcestrouble -t assistant:resources-v1 .' }, aksResourcesTroubleshootingLab)
    expect(rebuilt.diagnostics).toEqual([])
    const start = applyRunAction(rebuilt.run, { type: 'aks-resource-start', scenarioId: 'trouble-resource-pending' }, aksResourcesTroubleshootingLab)
    expect(start.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'INVALID_RESOURCE_EXPERIMENT' })]))
    expect(start.run.runtime.kubernetes.clusters[aksResourcesTroubleshootingLab.scenarios['trouble-resource-pending'].target.clusterId].resourcesRuntime.experiment).toBeNull()
  })
})
