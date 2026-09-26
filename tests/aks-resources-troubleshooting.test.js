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
})
