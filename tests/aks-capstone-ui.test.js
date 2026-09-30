import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import { seedAksCapstoneAt, seedDiagnosisTest, verifyAksCapstoneFixture } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { recordVerification } from '../src/lib/labEngine/evidence.js'
import { inspectAksCapstone } from '../src/lib/kubernetes/capstone/inspection.js'
import { inspectDiagnosis } from '../src/lib/kubernetes/diagnosis-inspection.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { aksDeployGuidedLab } from '../src/data/labs/aks-journey/deploy-guided.lab.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import LabPanel from '../src/components/lab/LabPanel.vue'
import ProjectEditor from '../src/components/lab/ProjectEditor.vue'
import AksExperimentPanel from '../src/components/lab/AksExperimentPanel.vue'
import AksClusterBlade from '../src/components/blade/AksClusterBlade.vue'

function presentedFixture(stage = 'source') {
  const { lab, run } = seedAksCapstoneAt(stage)
  return { run, lab: { ...lab, title: 'AKS capstone fixture', brief: 'Finish eight checkpoints.', skillAreaId: 'containers', service: 'aks',
    stages: lab.stages.map(item => ({ ...item, title: item.id })),
    tasks: lab.tasks.map(item => ({ ...item, title: item.id, description: item.id, hints: ['Hint 1', 'Hint 2'], solution: { summary: 'Solution' }, examNote: 'Exam note' })) } }
}

async function render(component, fixture, { capture = false, props = {}, completedView = false } = {}) {
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useLabRunStore()
  await store.load(fixture.lab.id, { lab: fixture.lab, repository: behavioralRepository() })
  store.behavioralRun = fixture.run; store.sandbox = fixture.run.sandbox
  if (completedView) { store.completedAt = '2026-09-30T17:00:00.000Z'; store.readOnly = true }
  let setup
  const wrapped = capture ? { ...component, created() { setup = this.$.setupState } } : component
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }, { path: '/lab/:id', component: { template: '<div />' } }] })
  const html = await renderToString(createSSRApp(wrapped, props).use(pinia).use(router))
  return { html, setup, store }
}

function removedClusterReceipt(stageId) {
  let { lab, run } = presentedFixture(stageId)
  for (const line of ['az group create -n rgcap -l eastus', 'az acr create -g rgcap -n acrcapstone --sku Basic',
    'az acr build -r acrcapstone -t assistant:v1 .',
    'az aks create -g rgcap -n akscap --enable-managed-identity --generate-ssh-keys',
    'az aks get-credentials -g rgcap -n akscap', 'kubectl apply -f k8s/namespace.yaml', 'kubectl apply -f k8s/deployment.yaml']) {
    const result = applyRunAction(run, { type: 'command', line }, lab)
    expect(result.diagnostics).toEqual([])
    run = result.run
  }
  const clusterId = run.sandbox.aksClusters[0].id
  const buildId = Object.keys(run.artifacts.buildsById)[0]
  const task = lab.tasks.find(item => item.id === `task-${stageId}`)
  run = recordVerification(run, lab, task.id, { ...task.verification, completed: true, outcome: 'passed',
    startedAtMs: 1200, endedAtMs: 2800, measurements: { clusterId, buildId, password: 'must-not-copy',
      diagnosticRecords: [{ requestId: 'request-review-7', code: 'ROUTE_TARGET_PORT', message: 'Service target port refused.' }] } })
  run = applyRunAction(run, { type: 'aks-advance-stage' }, lab).run
  run = applyRunAction(run, { type: 'command', line: 'az group delete -n rgcap --yes' }, lab).run
  expect(run.runtime.kubernetes.clusters).toEqual({})
  return { lab, run, clusterId, buildId }
}

describe('AKS capstone presentation', () => {
  it('inspects eight statuses and current versus historical proof from real stage actions', () => {
    let { lab, run } = presentedFixture()
    let view = inspectAksCapstone(run, lab)
    expect(view.stages).toHaveLength(8)
    expect(view.stages.map(stage => stage.status)).toEqual(['Active', ...Array(7).fill('Locked')])
    expect(view.canAdvance).toBe(false)
    run = verifyAksCapstoneFixture(run, lab)
    view = inspectAksCapstone(run, lab)
    expect(view.canAdvance).toBe(true)
    run = applyRunAction(run, { type: 'aks-advance-stage' }, lab).run
    view = inspectAksCapstone(run, lab)
    expect(view.stages[0]).toMatchObject({ status: 'Sealed', evidenceMode: 'historical' })
    expect(view.stages[1]).toMatchObject({ status: 'Active', evidenceMode: 'current' })
    expect(view.stages[0].proofs[0].evidenceId).toBe(run.stages.sealedStages[0].evidenceIds[0])
  })

  it('shows only the latest current evidence for an active Task', () => {
    const { lab, run } = presentedFixture()
    const first = verifyAksCapstoneFixture(run, lab)
    const second = verifyAksCapstoneFixture(first, lab)
    const view = inspectAksCapstone(second, lab)
    expect(view.activeStage.proofs).toHaveLength(1)
    expect(view.activeStage.proofs[0].evidenceId).toBe(second.evidence.currentEvidenceByTask['task-source'])
  })

  it('fails cleanup eligibility closed and separates exact owned and supplied references', () => {
    const { lab, run } = presentedFixture()
    const view = inspectAksCapstone(run, lab)
    expect(view.cleanup.eligible).toBe(false)
    expect(view.cleanup.remaining).toEqual([])
    expect(view.cleanup.protected.length).toBeGreaterThan(0)
    expect(view.cleanup.protected[0].resourceId).toContain('resourceGroups/')
  })

  it('projects owned resources through partial cleanup from real command effects', () => {
    let { lab, run } = presentedFixture()
    run = applyRunAction(run, { type: 'command', line: 'az group create -n rgcap -l eastus' }, lab).run
    const remaining = inspectAksCapstone(run, lab).cleanup.remaining
    expect(remaining).toHaveLength(1)
    expect(remaining[0].resourceId).toContain('resourceGroups/rgcap')
    run = applyRunAction(run, { type: 'command', line: 'az group delete -n rgcap --yes' }, lab).run
    expect(inspectAksCapstone(run, lab).cleanup.remaining).toEqual([])
    expect(run.stages.aks.creationReceipts).toHaveLength(1)
    expect(run.stages.aks.deletionReceipts).toHaveLength(1)
  })

  it('requires the stage exit handoff even after every active Task passes', () => {
    const { lab, run } = presentedFixture()
    const verified = verifyAksCapstoneFixture(run, lab)
    lab.aksCapstone = { stageExit: () => [{ code: 'HANDOFF_PENDING', message: 'Handoff pending.' }] }
    expect(inspectAksCapstone(verified, lab).canAdvance).toBe(false)
  })

  it('labels the evidence-selected artifact even when another image was built later', () => {
    let { lab, run } = presentedFixture()
    for (const line of ['az group create -n rgcap -l eastus', 'az acr create -g rgcap -n acrcapstone --sku Basic',
      'az acr build -r acrcapstone -t assistant:v1 .']) run = applyRunAction(run, { type: 'command', line }, lab).run
    const selectedId = Object.keys(run.artifacts.buildsById)[0]
    const task = lab.tasks[0]
    run = recordVerification(run, lab, task.id, { ...task.verification, completed: true, outcome: 'passed',
      startedAtMs: 0, endedAtMs: 0, measurements: { buildId: selectedId } })
    run = applyRunAction(run, { type: 'command', line: 'az acr build -r acrcapstone -t unrelated:v2 .' }, lab).run
    run = applyRunAction(run, { type: 'aks-advance-stage' }, lab).run
    expect(inspectAksCapstone(run, lab).artifact.selected.at(-1).buildId).toBe(selectedId)
  })

  it('does not present forged saved progress as a sealed checkpoint', () => {
    const { lab, run } = presentedFixture()
    run.stages.sealedStages.push({ stageId: 'source', sequence: 1, evidenceIds: [], taskIds: ['task-source'] })
    const view = inspectAksCapstone(run, lab)
    expect(view.canAdvance).toBe(false)
    expect(view.stages.every(stage => stage.status === 'Unavailable')).toBe(true)
    expect(view.cleanup.eligible).toBe(false)
  })

  it('renders AKS status and dispatches only the trusted AKS advance action', async () => {
    const fixture = presentedFixture()
    fixture.run = verifyAksCapstoneFixture(fixture.run, fixture.lab)
    const { html, setup, store } = await render(LabPanel, fixture, { capture: true })
    expect(html).toContain('Capstone status')
    expect(html).toContain('Owned resources')
    expect(html).toContain('Supplied prerequisites')
    expect(html).toContain('Advance to deployment')
    expect(html).toContain('Verify task-source')
    const dispatch = vi.fn(async () => ({ effects: { diagnostics: [] } }))
    store.dispatchBehavioral = dispatch
    await setup.stageAction('aks-advance-stage')
    expect(dispatch).toHaveBeenCalledWith({ type: 'aks-advance-stage' })
    await setup.verifyAksTask(fixture.lab.tasks[0])
    expect(dispatch).toHaveBeenCalledWith({ type: 'aks-request', scenarioId: 'verify-source' })
  })

  it('makes the project editor read-only after an AKS cleanup checkpoint', async () => {
    const fixture = presentedFixture()
    fixture.run.stages.cleanupCheckpoint = { sequence: 1 }
    const { html } = await render(ProjectEditor, fixture)
    expect(html).toContain('Cleanup checkpoint')
    expect(html).toMatch(/<textarea[^>]*disabled/)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Save file<\/button>/)
  })

  it('explains frozen experiment controls without changing non-capstone behavior', async () => {
    const fixture = presentedFixture()
    fixture.lab.scenarios = { 'verify-source': { kind: 'aks-request', request: { method: 'GET', path: '/health' } } }
    fixture.run.stages.cleanupCheckpoint = { sequence: 1 }
    const { html } = await render(AksExperimentPanel, fixture)
    expect(html).toContain('Cleanup checkpoint frozen')
    expect(html).toContain('Lab Panel')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Send simulated request<\/button>/)
  })

  it('places a completed capstone Result and sealed receipts in one scroll flow', async () => {
    const fixture = presentedFixture('cleanup')
    const { html } = await render(LabPanel, fixture, { completedView: true })
    expect(html).toContain('lab-panel--completed-capstone')
    expect(html).toContain('Lab complete')
    expect(html).toContain('Capstone sealed stages')
    expect(html.indexOf('Lab complete')).toBeLessThan(html.indexOf('Capstone sealed stages'))
    const ordinary = await render(LabPanel, { lab: aksDeployGuidedLab, run: createBehavioralRun(aksDeployGuidedLab, { attemptId: 'ordinary-complete-ui' }) }, { completedView: true })
    expect(ordinary.html).toContain('Lab complete')
    expect(ordinary.html).not.toContain('lab-panel--completed-capstone')
  })

  it('starts only the declared capstone incident in its active stage', async () => {
    const fixture = presentedFixture('incident')
    fixture.lab.capabilities.kubernetesDiagnostics = true
    fixture.lab.scenarios = { 'capstone-incident': { kind: 'aks-diagnosis', target: { clusterId: '/missing', namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-internal' } } }
    const { html, setup, store } = await render(AksExperimentPanel, fixture, { capture: true })
    expect(html).toContain('Start declared capstone incident')
    expect(html).not.toContain('Start diagnosis incident')
    const dispatch = vi.fn(async () => ({ effects: { diagnostics: [] } }))
    store.dispatchBehavioral = dispatch
    await setup.startCapstoneIncident()
    expect(dispatch).toHaveBeenCalledWith({ type: 'aks-capstone-incident' })
    const wrongStage = presentedFixture('release')
    wrongStage.lab.capabilities.kubernetesDiagnostics = true
    wrongStage.lab.scenarios = fixture.lab.scenarios
    const releaseView = await render(AksExperimentPanel, wrongStage)
    expect(releaseView.html).toMatch(/<button[^>]*disabled[^>]*>Start declared capstone incident<\/button>/)
  })

  it('treats the final comment-only HPA file as intentionally disabled in diagnosis inspection', () => {
    const { run, lab, target } = seedDiagnosisTest()
    run.project.savedFiles['k8s/hpa.yaml'] = '# HPA exercise complete; final deployment uses two fixed replicas.\n'
    const generic = inspectDiagnosis(run, target)
    const capstone = inspectDiagnosis(run, target, { ...lab, capabilities: { ...lab.capabilities, aksCapstone: true } })
    const warning = 'Repair saved configuration/Services so every required live object has a valid saved manifest, then apply them.'
    expect(generic.consistency.reasons).toContain(warning)
    expect(capstone.consistency.reasons).not.toContain(warning)
  })

  it.each(['release', 'incident'])('shows retained %s measurements and identities after actual cluster deletion', async stageId => {
    const fixture = removedClusterReceipt(stageId)
    const proof = inspectAksCapstone(fixture.run, fixture.lab).stages.find(stage => stage.id === stageId).proofs[0]
    expect(proof.targets.length).toBeGreaterThan(0)
    const blade = await render(AksClusterBlade, fixture, { props: { resourceGroup: 'rgcap', name: 'akscap' } })
    expect(blade.html).toContain('Historical capstone receipts')
    for (const text of [fixture.buildId, proof.artifacts[0].digest, proof.targets[0].uid, 'request-review-7', 'ROUTE_TARGET_PORT', '1.2s', '2.8s'])
      expect(blade.html).toContain(text)
    expect(blade.html).not.toContain('must-not-copy')
    const result = await render(LabPanel, fixture, { completedView: true })
    for (const text of [fixture.buildId, proof.targets[0].uid, 'request-review-7', 'ROUTE_TARGET_PORT'])
      expect(result.html).toContain(text)
    expect(result.html).not.toContain('must-not-copy')
  })
})
