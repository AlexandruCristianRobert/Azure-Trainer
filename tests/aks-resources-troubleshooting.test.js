import { describe, expect, it } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { parse, stringify } from 'yaml'
import { normalizeContainerResources } from '../src/lib/kubernetes/resource-schema.js'
import { aksResourcesTroubleshootingLab } from '../src/data/labs/aks-journey/resources-troubleshooting.lab.js'
import { executeAksSolution } from './helpers/aks.js'

describe('AKS resource troubleshooting', () => {
  it('cannot inject the memory incident before the scheduling diagnosis and repair', () => {
    const run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resources-incident' })
    const result = applyRunAction(run, { type: 'aks-resource-next-incident' }, aksResourcesTroubleshootingLab)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
  })

  it('executes every ordered solution through real actions and immediately grades each task', () => {
    let run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resources-solution' })
    const checkpoints = {}
    for (const task of aksResourcesTroubleshootingLab.tasks) {
      try { run = executeAksSolution(run, aksResourcesTroubleshootingLab, task) } catch (error) { throw new Error(`${task.id}: ${error.message}`) }
      const taskState = evaluateLab(aksResourcesTroubleshootingLab, run).tasks.find(item => item.id === task.id)
      expect(taskState).toMatchObject({ done: true, status: 'done' })
      if (task.id === 'repair-hpa') {
        let missingSavedRequest = structuredClone(run)
        const withoutRequest = missingSavedRequest.project.savedFiles['k8s/deployment.yaml'].replace(/\n\s+cpu: "250m"/, '')
        missingSavedRequest = applyRunAction(missingSavedRequest, { type: 'draft', path: 'k8s/deployment.yaml', text: withoutRequest }, aksResourcesTroubleshootingLab).run
        missingSavedRequest = applyRunAction(missingSavedRequest, { type: 'save-file', path: 'k8s/deployment.yaml' }, aksResourcesTroubleshootingLab).run
        expect(evaluateLab(aksResourcesTroubleshootingLab, missingSavedRequest).tasks.find(item => item.id === 'repair-hpa')).toMatchObject({ done: false })

        let changedSavedPolicy = structuredClone(run)
        const changedPolicy = changedSavedPolicy.project.savedFiles['k8s/hpa.yaml'].replace('averageUtilization: 60', 'averageUtilization: 61')
        changedSavedPolicy = applyRunAction(changedSavedPolicy, { type: 'draft', path: 'k8s/hpa.yaml', text: changedPolicy }, aksResourcesTroubleshootingLab).run
        changedSavedPolicy = applyRunAction(changedSavedPolicy, { type: 'save-file', path: 'k8s/hpa.yaml' }, aksResourcesTroubleshootingLab).run
        expect(evaluateLab(aksResourcesTroubleshootingLab, changedSavedPolicy).tasks.find(item => item.id === 'repair-hpa')).toMatchObject({ done: false })
      }
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
      checkpoints[task.id] = structuredClone(run)
      run = JSON.parse(JSON.stringify(run))
    }
    expect(Object.keys(run.evidence.currentEvidenceByTask)).toEqual(expect.arrayContaining(['observe-pending', 'repair-scheduling', 'observe-oom', 'repair-memory', 'observe-hpa', 'final-cycle']))
    expect(evaluateLab(aksResourcesTroubleshootingLab, run)).toMatchObject({ isComplete: true, doneCount: aksResourcesTroubleshootingLab.tasks.length })

    const originalPolicy = run.project.savedFiles['k8s/hpa.yaml']
    let changedPolicy = applyRunAction(run, { type: 'draft', path: 'k8s/hpa.yaml', text: originalPolicy.replace('averageUtilization: 60', 'averageUtilization: 61') }, aksResourcesTroubleshootingLab).run
    changedPolicy = applyRunAction(changedPolicy, { type: 'save-file', path: 'k8s/hpa.yaml' }, aksResourcesTroubleshootingLab).run
    let restoredPolicy = applyRunAction(changedPolicy, { type: 'draft', path: 'k8s/hpa.yaml', text: originalPolicy }, aksResourcesTroubleshootingLab).run
    restoredPolicy = applyRunAction(restoredPolicy, { type: 'save-file', path: 'k8s/hpa.yaml' }, aksResourcesTroubleshootingLab).run
    const stale = evaluateLab(aksResourcesTroubleshootingLab, restoredPolicy)
    expect(stale.tasks.find(item => item.id === 'final-cycle')).toMatchObject({ done: false })
    expect(stale.tasks.find(item => item.id === 'final-answer')).toMatchObject({ done: false })

    const oversizedResult = applyRunAction(checkpoints['observe-pending'], { type: 'command', line: 'kubectl scale deployment/assistant --replicas 3 -n assistant' }, aksResourcesTroubleshootingLab)
    expect(oversizedResult.diagnostics).toEqual([])
    const oversizedPods = Object.values(oversizedResult.run.runtime.kubernetes.clusters[aksResourcesTroubleshootingLab.scenarios['trouble-resource-pending'].target.clusterId].resources)
      .filter(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
    expect(oversizedPods).toHaveLength(3)
    expect(oversizedPods.every(item => item.status.phase === 'Pending')).toBe(true)

    let requestOnly = structuredClone(checkpoints['observe-oom'])
    const raisedRequestDoc = parse(requestOnly.project.savedFiles['k8s/deployment.yaml'])
    raisedRequestDoc.spec.template.spec.containers[0].resources.requests.memory = '256Mi'
    const raisedRequest = stringify(raisedRequestDoc)
    requestOnly = applyRunAction(requestOnly, { type: 'draft', path: 'k8s/deployment.yaml', text: raisedRequest }, aksResourcesTroubleshootingLab).run
    requestOnly = applyRunAction(requestOnly, { type: 'save-file', path: 'k8s/deployment.yaml' }, aksResourcesTroubleshootingLab).run
    const requestOnlyApply = applyRunAction(requestOnly, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }, aksResourcesTroubleshootingLab)
    expect(requestOnlyApply.diagnostics).toEqual([])
    expect(requestOnlyApply.lines).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'err', text: expect.stringContaining('request') })]))
    const unchangedMemory = requestOnlyApply.run.runtime.kubernetes.clusters[aksResourcesTroubleshootingLab.scenarios['trouble-resource-oom'].target.clusterId]
      .resources['Deployment/assistant/assistant'].spec.template.spec.containers[0].resources
    expect(unchangedMemory).toMatchObject({ requests: { memory: '128Mi' }, limits: { memory: '128Mi' } })

    let reducedWork = structuredClone(checkpoints['observe-oom'])
    reducedWork = applyRunAction(reducedWork, { type: 'draft', path: 'app.py', text: reducedWork.project.savedFiles['app.py'].replace('WORK_UNITS = 20', 'WORK_UNITS = 1') }, aksResourcesTroubleshootingLab).run
    reducedWork = applyRunAction(reducedWork, { type: 'save-file', path: 'app.py' }, aksResourcesTroubleshootingLab).run
    reducedWork = applyRunAction(reducedWork, { type: 'aks-resource-start', scenarioId: 'trouble-resource-memory-fixed' }, aksResourcesTroubleshootingLab).run
    reducedWork = applyRunAction(reducedWork, { type: 'aks-advance', seconds: 60 }, aksResourcesTroubleshootingLab).run
    expect(evaluateLab(aksResourcesTroubleshootingLab, reducedWork).tasks.find(item => item.id === 'repair-memory')).toMatchObject({ done: false })

    let limitOnly = structuredClone(checkpoints['observe-hpa'])
    const noCpuRequestDoc = parse(aksResourcesTroubleshootingLab.tasks.find(item => item.id === 'repair-hpa').solution.steps.find(step => step.kind === 'file' && step.path === 'k8s/deployment.yaml').content)
    delete noCpuRequestDoc.spec.template.spec.containers[0].resources.requests.cpu
    const noCpuRequest = stringify(noCpuRequestDoc)
    limitOnly = applyRunAction(limitOnly, { type: 'draft', path: 'k8s/deployment.yaml', text: noCpuRequest }, aksResourcesTroubleshootingLab).run
    limitOnly = applyRunAction(limitOnly, { type: 'save-file', path: 'k8s/deployment.yaml' }, aksResourcesTroubleshootingLab).run
    const limitOnlyDeployment = applyRunAction(limitOnly, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }, aksResourcesTroubleshootingLab)
    expect(limitOnlyDeployment.diagnostics).toEqual([])
    limitOnly = limitOnlyDeployment.run
    const limitOnlyHpa = applyRunAction(limitOnly, { type: 'command', line: 'kubectl apply -f k8s/hpa.yaml' }, aksResourcesTroubleshootingLab)
    expect(limitOnlyHpa.diagnostics).toEqual([])
    limitOnly = limitOnlyHpa.run
    const limitOnlyLive = limitOnly.runtime.kubernetes.clusters[aksResourcesTroubleshootingLab.scenarios['trouble-resource-no-cpu-request'].target.clusterId]
      .resources['Deployment/assistant/assistant'].spec.template.spec.containers[0].resources
    expect(limitOnlyLive.requests.cpu).toBeUndefined()
    expect(normalizeContainerResources(limitOnlyLive).effective.cpuRequestM).toBe(500)
    limitOnly = applyRunAction(limitOnly, { type: 'aks-advance', seconds: 30 }, aksResourcesTroubleshootingLab).run
    expect(evaluateLab(aksResourcesTroubleshootingLab, limitOnly).tasks.find(item => item.id === 'repair-hpa')).toMatchObject({ done: false })
  })

  it('publishes a complete troubleshooting lesson with a current final AI proof', () => {
    expect(aksResourcesTroubleshootingLab.status).toBe('available')
    for (const task of aksResourcesTroubleshootingLab.tasks) {
      expect(task.hints).toHaveLength(2)
      expect(task.solution?.steps?.length).toBeGreaterThan(0)
      expect(task.examNote).toBeTruthy()
    }
    const final = aksResourcesTroubleshootingLab.tasks.find(task => task.id === 'final-answer')
    expect(final.verification).toEqual({ scenarioId: 'trouble-resource-final', scenarioVersion: 1 })
    expect(aksResourcesTroubleshootingLab.scenarios['trouble-resource-final']).toMatchObject({ kind: 'aks-request', integrationProfile: 'healthy' })
  })

  it('accepts the supported 300m/600m repair through the final HPA and AI proofs', () => {
    const lab = { ...aksResourcesTroubleshootingLab, tasks: aksResourcesTroubleshootingLab.tasks.map(task => ({
      ...task, solution: { steps: task.solution.steps.map(step => step.kind === 'file' && step.path === 'k8s/deployment.yaml'
        ? { ...step, content: step.content.replace('cpu: "250m"', 'cpu: "300m"').replace('cpu: "500m"', 'cpu: "600m"') } : step) },
    })) }
    let run = createBehavioralRun(lab, { attemptId: 'resources-alternate-cpu-final' })
    for (const task of lab.tasks) {
      run = executeAksSolution(run, lab, task)
      expect(evaluateLab(lab, run).tasks.find(item => item.id === task.id)).toMatchObject({ done: true, status: 'done' })
    }
    expect(evaluateLab(lab, run)).toMatchObject({ isComplete: true })
    expect(run.runtime.kubernetes.clusters[lab.scenarios['trouble-resource-cycle'].target.clusterId].resources['Deployment/assistant/assistant']
      .spec.template.spec.containers[0].resources).toMatchObject({ requests: { cpu: '300m' }, limits: { cpu: '600m' } })
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
