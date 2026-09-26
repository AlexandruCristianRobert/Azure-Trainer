import { describe, expect, it } from 'vitest'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { aksResourcesTroubleshootingLab, RESOURCES_TROUBLESHOOTING_CLUSTER_ID } from '../src/data/labs/aks-journey/resources-troubleshooting.lab.js'
import { aksResourcesGuidedLab } from '../src/data/labs/aks-journey/resources-guided.lab.js'
import { executeAksSolution } from './helpers/aks.js'

const task = id => aksResourcesTroubleshootingLab.tasks.find(item => item.id === id)

describe('AKS resource incident state', () => {
  it('requires value-free incident advancement and keeps the run unchanged when prerequisites are missing', () => {
    const run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resource-incident-action' })
    for (const action of [
      { type: 'aks-resource-next-incident' },
      { type: 'aks-resource-next-incident', phase: 'memory' },
    ]) {
      const result = applyRunAction(run, action, aksResourcesTroubleshootingLab)
      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.run.runtime.kubernetes).toEqual(run.runtime.kubernetes)
    }
  })

  it('rejects a persisted run with a missing or future-phase incident map entry', () => {
    const run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resource-incident-shape' })
    const missing = structuredClone(run)
    missing.runtime.kubernetes.clusters[RESOURCES_TROUBLESHOOTING_CLUSTER_ID].resourcesRuntime.incident = null
    expect(() => validateBehavioralRun(missing, aksResourcesTroubleshootingLab)).toThrow()

    const future = structuredClone(run)
    future.runtime.kubernetes.clusters[RESOURCES_TROUBLESHOOTING_CLUSTER_ID].resourcesRuntime.incident.observations.memory = 'evidence-999'
    expect(() => validateBehavioralRun(future, aksResourcesTroubleshootingLab)).toThrow()
  })

  it('rejects unknown keys and foreign evidence identifiers in persisted incident maps', () => {
    const run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: 'resource-incident-foreign' })
    const unknown = structuredClone(run)
    unknown.runtime.kubernetes.clusters[RESOURCES_TROUBLESHOOTING_CLUSTER_ID].resourcesRuntime.incident.observations.extra = 'evidence-1'
    expect(() => validateBehavioralRun(unknown, aksResourcesTroubleshootingLab)).toThrow()

    const foreign = structuredClone(run)
    foreign.runtime.kubernetes.clusters[RESOURCES_TROUBLESHOOTING_CLUSTER_ID].resourcesRuntime.incident.observations.scheduling = 'evidence-1'
    expect(() => validateBehavioralRun(foreign, aksResourcesTroubleshootingLab)).toThrow()
  })

  it('accepts a supported 300m/600m CPU repair and refuses a recovery after saved source changes', () => {
    const lab = { ...aksResourcesTroubleshootingLab, tasks: aksResourcesTroubleshootingLab.tasks.map(item => item.id !== 'repair-scheduling' ? item : {
      ...item, solution: { steps: item.solution.steps.map(step => step.kind === 'file'
        ? { ...step, content: step.content.replace('250m', '300m').replace('500m', '600m') } : step) },
    }) }
    let run = createBehavioralRun(lab, { attemptId: 'resource-incident-alternative' })
    run = executeAksSolution(run, lab, task('observe-pending'))
    run = executeAksSolution(run, lab, lab.tasks.find(item => item.id === 'repair-scheduling'))
    const deployment = run.runtime.kubernetes.clusters[RESOURCES_TROUBLESHOOTING_CLUSTER_ID].resources['Deployment/assistant/assistant']
    expect(deployment.spec.template.spec.containers[0].resources).toMatchObject({ requests: { cpu: '300m', memory: '128Mi' }, limits: { cpu: '600m', memory: '256Mi' } })
    const id = run.evidence.currentEvidenceByTask['repair-scheduling']
    expect(run.evidence.experimentsById[id].outcome).toBe('passed')

    const dirty = applyRunAction(run, { type: 'draft', path: 'k8s/deployment.yaml', text: `${run.project.savedFiles['k8s/deployment.yaml']}\n# unsaved edit` }, lab).run
    const blockedDirty = applyRunAction(dirty, { type: 'aks-resource-next-incident' }, lab)
    expect(blockedDirty.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AKS_UNSAVED_INCIDENT_SOURCE' })]))
    expect(blockedDirty.run.runtime.kubernetes).toEqual(dirty.runtime.kubernetes)

    const savedDeployment = applyRunAction(blockedDirty.run, { type: 'save-file', path: 'k8s/deployment.yaml' }, lab).run
    const changed = applyRunAction(savedDeployment, { type: 'draft', path: 'app.py', text: `${run.project.savedFiles['app.py']}\n# source edit and restore changes its file version` }, lab).run
    const saved = applyRunAction(changed, { type: 'save-file', path: 'app.py' }, lab).run
    const restoredDraft = applyRunAction(saved, { type: 'draft', path: 'app.py', text: run.project.savedFiles['app.py'] }, lab).run
    const restored = applyRunAction(restoredDraft, { type: 'save-file', path: 'app.py' }, lab).run
    const stale = applyRunAction(restored, { type: 'aks-resource-next-incident' }, lab)
    expect(stale.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AKS_INCIDENT_NOT_READY' })]))
    expect(stale.run.runtime.kubernetes).toEqual(restored.runtime.kubernetes)
  })

  it('requires the saved manifest, applied Deployment, and ready Pods to match the passed recovery receipt', () => {
    const recoveredRun = () => {
      let run = createBehavioralRun(aksResourcesTroubleshootingLab, { attemptId: `resource-incident-fresh-${Math.random()}` })
      run = executeAksSolution(run, aksResourcesTroubleshootingLab, task('observe-pending'))
      return executeAksSolution(run, aksResourcesTroubleshootingLab, task('repair-scheduling'))
    }
    const next = run => applyRunAction(run, { type: 'aks-resource-next-incident' }, aksResourcesTroubleshootingLab)
    const changedYaml = base => base.replace('cpu: "250m"', 'cpu: "300m"').replace('cpu: "500m"', 'cpu: "600m"')

    const savedButUnapplied = recoveredRun()
    const edited = applyRunAction(savedButUnapplied, { type: 'draft', path: 'k8s/deployment.yaml', text: changedYaml(savedButUnapplied.project.savedFiles['k8s/deployment.yaml']) }, aksResourcesTroubleshootingLab).run
    const saved = applyRunAction(edited, { type: 'save-file', path: 'k8s/deployment.yaml' }, aksResourcesTroubleshootingLab).run
    expect(next(saved).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AKS_INCIDENT_NOT_READY' })]))

    const savedReplicaChange = recoveredRun()
    const replicaManifest = savedReplicaChange.project.savedFiles['k8s/deployment.yaml'].replace('replicas: 2', 'replicas: 3')
    const replicaDraft = applyRunAction(savedReplicaChange, { type: 'draft', path: 'k8s/deployment.yaml', text: replicaManifest }, aksResourcesTroubleshootingLab).run
    const replicaSaved = applyRunAction(replicaDraft, { type: 'save-file', path: 'k8s/deployment.yaml' }, aksResourcesTroubleshootingLab).run
    expect(next(replicaSaved).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AKS_INCIDENT_NOT_READY' })]))

    const appliedWithoutFreshReceipt = recoveredRun()
    const modified = applyRunAction(appliedWithoutFreshReceipt, { type: 'draft', path: 'k8s/deployment.yaml', text: changedYaml(appliedWithoutFreshReceipt.project.savedFiles['k8s/deployment.yaml']) }, aksResourcesTroubleshootingLab).run
    const modifiedSaved = applyRunAction(modified, { type: 'save-file', path: 'k8s/deployment.yaml' }, aksResourcesTroubleshootingLab).run
    const applied = applyRunAction(modifiedSaved, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }, aksResourcesTroubleshootingLab)
    expect(applied.diagnostics).toEqual([])
    expect(next(applied.run).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AKS_INCIDENT_NOT_READY' })]))

    const deletedPod = recoveredRun()
    const podName = Object.values(deletedPod.runtime.kubernetes.clusters[RESOURCES_TROUBLESHOOTING_CLUSTER_ID].resources)
      .find(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant').metadata.name
    const deleted = applyRunAction(deletedPod, { type: 'command', line: `kubectl delete pod ${podName} -n assistant` }, aksResourcesTroubleshootingLab)
    expect(deleted.diagnostics).toEqual([])
    expect(next(deleted.run).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'AKS_INCIDENT_NOT_READY' })]))
  })

  it('validates a realistic Lab 16 saved run without Task 6-only experiment fields', () => {
    let run = createBehavioralRun(aksResourcesGuidedLab, { attemptId: 'resource-lab16-legacy-json' })
    for (const id of ['workload-source', 'resource-sizing', 'manual-replicas', 'adopt-hpa'])
      run = executeAksSolution(run, aksResourcesGuidedLab, aksResourcesGuidedLab.tasks.find(item => item.id === id))
    run = applyRunAction(run, { type: 'aks-resource-start', scenarioId: 'guided-resource-cycle' }, aksResourcesGuidedLab).run
    const clusterId = aksResourcesGuidedLab.scenarios['guided-resource-cycle'].target.clusterId
    const runtime = run.runtime.kubernetes.clusters[clusterId].resourcesRuntime
    delete runtime.experiment.hpaObservations
    delete runtime.experiment.pendingProof
    delete runtime.experiment.oomProof
    const legacyShaped = JSON.parse(JSON.stringify(run))
    validateBehavioralRun(legacyShaped, aksResourcesGuidedLab)
    const advanced = applyRunAction(legacyShaped, { type: 'aks-advance', seconds: 1 }, aksResourcesGuidedLab)
    expect(advanced.diagnostics).toEqual([])
    expect(advanced.run.runtime.kubernetes.clusters[clusterId].resourcesRuntime.experiment.phase).toMatch(/^(warming|running)$/)
  })
})
