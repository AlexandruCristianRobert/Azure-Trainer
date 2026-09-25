import { describe, expect, it } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { aksConfigTroubleshootingLab } from '../src/data/labs/aks-journey/config-troubleshooting.lab.js'
import { executeAksSolution } from './helpers/aks.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AksExperimentPanel from '../src/components/lab/AksExperimentPanel.vue'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

async function renderPanel(run) {
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useLabRunStore()
  await store.load(aksConfigTroubleshootingLab.id, { lab: aksConfigTroubleshootingLab, repository: behavioralRepository() })
  store.behavioralRun = run; store.sandbox = run.sandbox
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  return renderToString(createSSRApp(AksExperimentPanel).use(pinia).use(router))
}

describe('AKS staged configuration diagnosis', () => {
  it('cannot advance the incident before recovery verification', () => {
    const run = createBehavioralRun(aksConfigTroubleshootingLab, { attemptId: 'phase-guard' })
    const result = applyRunAction(run, { type: 'aks-config-next-incident' }, aksConfigTroubleshootingLab)
    expect(result.diagnostics[0].code).toBe('AKS_INCIDENT_NOT_READY')
    expect(result.run.project).toEqual(run.project)
    expect(result.run.runtime.kubernetes.configIncident.phase).toBe('reference')
  })

  it('seeds the valid same-named ConfigMap only in the decoy namespace', () => {
    const run = createBehavioralRun(aksConfigTroubleshootingLab, { attemptId: 'namespace-decoy' })
    const state = run.runtime.kubernetes.clusters['/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/rg-aks-config-troubleshooting/providers/Microsoft.ContainerService/managedClusters/aks-config-troubleshooting']
    expect(state.resources['ConfigMap/decoy/assistant-config']?.data.PGDATABASE).toBe('knowledge')
    expect(state.resources['ConfigMap/assistant/assistant-config']).toBeUndefined()
    expect(Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
      .every(pod => pod.status.phase === 'Pending')).toBe(true)
    expect(state.events.some(event => event.reason === 'CreateContainerConfigError')).toBe(true)
  })

  it('requires saved source and fresh verified evidence before injecting each next fault', () => {
    let run = createBehavioralRun(aksConfigTroubleshootingLab, { attemptId: 'phase-guards' })
    const firstTask = aksConfigTroubleshootingLab.tasks[0]
    run = executeAksSolution(run, aksConfigTroubleshootingLab, { ...firstTask, solution: { steps: firstTask.solution.steps.slice(0, 3) } })
    const draft = applyRunAction(run, { type: 'draft', path: 'k8s/configmap.yaml', text: `${run.project.draftFiles['k8s/configmap.yaml']}# unsaved\n` }, aksConfigTroubleshootingLab).run
    const blocked = applyRunAction(draft, { type: 'aks-config-next-incident' }, aksConfigTroubleshootingLab)
    expect(blocked.diagnostics[0].code).toBe('AKS_UNSAVED_INCIDENT_SOURCE')
    expect(blocked.run.project.draftFiles['k8s/configmap.yaml']).toContain('# unsaved')
    expect(blocked.run.runtime.kubernetes.configIncident.phase).toBe('reference')

    const forgedFresh = structuredClone(run)
    const currentId = forgedFresh.evidence.currentEvidenceByTask['repair-reference']
    const record = forgedFresh.evidence.experimentsById[currentId]
    const dependency = Object.keys(record.dependencyValues)[0]
    record.dependencyValues[dependency] = { namespace: 'decoy' }
    const staleEvidence = applyRunAction(forgedFresh, { type: 'aks-config-next-incident' }, aksConfigTroubleshootingLab)
    expect(staleEvidence.diagnostics[0].code).toBe('AKS_INCIDENT_NOT_READY')

    const stale = applyRunAction(run, { type: 'aks-request', scenarioId: 'config-reference-recovered' }, aksConfigTroubleshootingLab).run
    const advanced = applyRunAction(stale, { type: 'aks-config-next-incident' }, aksConfigTroubleshootingLab)
    expect(advanced.diagnostics).toHaveLength(0)
    expect(advanced.run.runtime.kubernetes.configIncident.phase).toBe('key')
    const config = advanced.run.runtime.kubernetes.clusters['/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/rg-aks-config-troubleshooting/providers/Microsoft.ContainerService/managedClusters/aks-config-troubleshooting'].resources['ConfigMap/assistant/assistant-config']
    expect(config.data.PGDATABASE).toBeUndefined()
    expect(Object.values(advanced.run.runtime.kubernetes.clusters['/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/rg-aks-config-troubleshooting/providers/Microsoft.ContainerService/managedClusters/aks-config-troubleshooting'].resources)
      .filter(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
      .every(pod => pod.status.phase === 'Pending')).toBe(true)
    const injected = advanced.run.project.savedFiles['k8s/configmap.yaml']
    const restored = applyRunAction(advanced.run, { type: 'save-file', path: 'k8s/configmap.yaml', text: aksConfigTroubleshootingLab.solutionFiles['k8s/configmap.yaml'] }, aksConfigTroubleshootingLab).run
    expect(restored.project.savedFiles['k8s/configmap.yaml']).not.toBe(injected)
  })

  it('does not let a later-phase request made early satisfy the incident after Continue', () => {
    let run = createBehavioralRun(aksConfigTroubleshootingLab, { attemptId: 'phase-bound-evidence' })
    const firstTask = aksConfigTroubleshootingLab.tasks[0]
    run = executeAksSolution(run, aksConfigTroubleshootingLab, { ...firstTask, solution: { steps: firstTask.solution.steps.slice(0, 3) } })
    run = applyRunAction(run, { type: 'aks-request', scenarioId: 'config-key-recovered' }, aksConfigTroubleshootingLab).run
    expect(run.evidence.experimentsById[run.evidence.currentEvidenceByTask['repair-key']].outcome).toBe('passed')
    run = applyRunAction(run, { type: 'aks-config-next-incident' }, aksConfigTroubleshootingLab).run
    expect(run.runtime.kubernetes.configIncident.phase).toBe('key')
    expect(validateBehavioralRun(structuredClone(run), aksConfigTroubleshootingLab).runtime.kubernetes.configIncident.phase).toBe('key')
    expect(evaluateLab(aksConfigTroubleshootingLab, run).tasks.find(item => item.id === 'repair-key').done).toBe(false)
    run = applyRunAction(run, { type: 'save-file', path: 'k8s/configmap.yaml', text: aksConfigTroubleshootingLab.solutionFiles['k8s/configmap.yaml'] }, aksConfigTroubleshootingLab).run
    run = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }, aksConfigTroubleshootingLab).run
    run = applyRunAction(run, { type: 'aks-request', scenarioId: 'config-key-recovered' }, aksConfigTroubleshootingLab).run
    expect(evaluateLab(aksConfigTroubleshootingLab, run).tasks.find(item => item.id === 'repair-key').done).toBe(true)
  })

  it('preserves historical recovery evidence and requires a restart after the stale environment incident', () => {
    let run = createBehavioralRun(aksConfigTroubleshootingLab, { attemptId: 'three-phases' })
    for (const task of aksConfigTroubleshootingLab.tasks) run = executeAksSolution(run, aksConfigTroubleshootingLab, task)
    const evaluation = evaluateLab(aksConfigTroubleshootingLab, run)
    expect(evaluation.isComplete).toBe(true)
    const oldManifest = run.project.savedFiles['k8s/configmap.yaml'].replace('APP_ENV: training-updated', 'APP_ENV: training')
    const oldSaved = applyRunAction(run, { type: 'save-file', path: 'k8s/configmap.yaml', text: oldManifest }, aksConfigTroubleshootingLab).run
    expect(evaluateLab(aksConfigTroubleshootingLab, oldSaved).tasks.find(item => item.id === 'reproducible-files').done).toBe(false)
    const oldApplied = applyRunAction(oldSaved, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }, aksConfigTroubleshootingLab).run
    expect(evaluateLab(aksConfigTroubleshootingLab, oldApplied).tasks.find(item => item.id === 'reproducible-files').done).toBe(false)
    expect(run.runtime.kubernetes.configIncident.phase).toBe('stale')
    expect(run.runtime.kubernetes.configIncident.transitions).toHaveLength(2)
    expect(evaluation.tasks.map(item => item.id)).toEqual(['repair-reference', 'repair-key', 'observe-stale', 'recover-final', 'reproducible-files'])
    const state = run.runtime.kubernetes.clusters['/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/rg-aks-config-troubleshooting/providers/Microsoft.ContainerService/managedClusters/aks-config-troubleshooting']
    expect(getDeploymentPods(run, '/subscriptions/7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37/resourceGroups/rg-aks-config-troubleshooting/providers/Microsoft.ContainerService/managedClusters/aks-config-troubleshooting', 'assistant', 'assistant')
      .every(pod => state.podSnapshots[pod.metadata.uid].environment.APP_ENV === 'training-updated')).toBe(true)
    expect(applyRunAction(run, { type: 'aks-config-next-incident' }, aksConfigTroubleshootingLab).diagnostics[0].code).toBe('AKS_INCIDENT_COMPLETE')
  })

  it('rejects caller-supplied incident changes and invalid restored phase state', () => {
    const run = createBehavioralRun(aksConfigTroubleshootingLab, { attemptId: 'strict-incident' })
    const forged = applyRunAction(run, { type: 'aks-config-next-incident', phase: 'stale', value: 'attacker' }, aksConfigTroubleshootingLab)
    expect(forged.diagnostics[0].code).toBe('INVALID_ACTION')
    expect(forged.run.runtime.kubernetes.configIncident.phase).toBe('reference')
    const corrupted = structuredClone(run)
    corrupted.runtime.kubernetes.configIncident.phase = 'key'
    expect(() => validateBehavioralRun(corrupted, aksConfigTroubleshootingLab)).toThrow(/Kubernetes/)
    const otherLab = { id: 'unrelated-lab', engineVersion: 2, contentVersion: 1, tasks: [] }
    const otherRun = createBehavioralRun(otherLab, { attemptId: 'no-incident-here' })
    expect(applyRunAction(otherRun, { type: 'aks-config-next-incident' }, otherLab).diagnostics[0].code).toBe('AKS_INCIDENT_NOT_READY')
  })

  it('offers a controlled Continue button only when the active phase is verified and drafts are saved', async () => {
    let run = createBehavioralRun(aksConfigTroubleshootingLab, { attemptId: 'incident-ui' })
    let html = await renderPanel(run)
    expect(html).toContain('Continue to next configuration incident')
    expect(html).toMatch(/button[^>]*disabled[^>]*>Continue to next configuration incident/)
    run = executeAksSolution(run, aksConfigTroubleshootingLab, aksConfigTroubleshootingLab.tasks[0])
    expect(run.runtime.kubernetes.configIncident.phase).toBe('key')
    const keyTask = aksConfigTroubleshootingLab.tasks[1]
    run = executeAksSolution(run, aksConfigTroubleshootingLab, { ...keyTask, solution: { steps: keyTask.solution.steps.slice(0, 3) } })
    html = await renderPanel(run)
    expect(html).not.toMatch(/button[^>]*disabled[^>]*>Continue to next configuration incident/)
  })
})
