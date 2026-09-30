import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import ProbeExperimentPanel from '../src/components/lab/ProbeExperimentPanel.vue'
import ExperimentPanel from '../src/components/lab/ExperimentPanel.vue'
import ProjectEditor from '../src/components/lab/ProjectEditor.vue'
import ContainerAppBlade from '../src/components/blade/ContainerAppBlade.vue'
import { probesGuidedLab } from '../src/data/labs/containerapps-journey/probes-guided.lab.js'
import { PROBE_SOLUTION_FILES, probeConfiguration } from '../src/data/templates/containerapps-dotnet/probes.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { useLabRunStore } from '../src/stores/labRun.js'

const probes = ['Startup', 'Readiness', 'Liveness'].map((type) => ({ type,
  httpGet: { path: `/health/${type === 'Startup' ? 'startup' : type === 'Readiness' ? 'ready' : 'live'}`, port: 8080, scheme: 'HTTP' },
  initialDelaySeconds: 5, periodSeconds: 5, timeoutSeconds: 1,
  failureThreshold: type === 'Startup' ? 6 : 2, successThreshold: 1 }))
function action(run, value) {
  const result = applyRunAction(run, value, probesGuidedLab)
  expect(result.diagnostics).toEqual([])
  return result.run
}
function setup() {
  let run = createBehavioralRun(probesGuidedLab, { attemptId: 'probe-panel' })
  run = action(run, { type: 'save-file', path: 'src/Trainer.Api/Program.cs', text: PROBE_SOLUTION_FILES['src/Trainer.Api/Program.cs'] })
  run = action(run, { type: 'command', line: 'az acr build --registry acrprobesguided --image api:v1 --file Dockerfile .' })
  run = action(run, { type: 'save-file', path: 'containerapp.yaml', text: probeConfiguration({ appName: 'api', image: 'acrprobesguided.azurecr.io/api:v1', probes }) })
  return action(run, { type: 'command', line: 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml' })
}
async function render(component, run, props = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  store.labId = probesGuidedLab.id
  store.sandbox = run.sandbox
  store.behavioralRun = run
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  return renderToString(createSSRApp(component, props).use(pinia).use(router))
}

it('shows current replica state and incident transitions after an advance', async () => {
  let run = setup()
  run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
  run = action(run, { type: 'simulation-advance', seconds: 40 })
  const html = await render(ProbeExperimentPanel, run)
  expect(html).toContain('Probe Experiment Controls')
  expect(html).toContain('40/90 seconds')
  expect(html).toContain('Readiness removes one replica')
  expect(html).toContain('Advance 5s')
  expect(html).toContain('Replica 0')
  expect(html).toContain('Ready for traffic')
  expect(html).toContain('Readiness fault starts')
  expect(html).toContain('HTTP 200')
  expect(html).toContain('fresh pair of replicas')
})

it('keeps a paused reloaded scenario selected instead of a prior completed scenario', async () => {
  let run = setup()
  run = action(run, { type: 'scenario-start', scenarioId: 'startup' })
  run = action(run, { type: 'simulation-advance', seconds: 60 })
  run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
  run = action(run, { type: 'simulation-advance', seconds: 30 })
  run = JSON.parse(JSON.stringify(action(run, { type: 'scenario-pause' })))
  const html = await render(ProbeExperimentPanel, run)
  expect(html).toContain('<option value="readiness" selected>Readiness removes one replica</option>')
  expect(html).toContain('Paused · 30/90 seconds')
  expect(html).toContain('55s: replica 0 readiness clears')
})

it('labels a seed without a startup probe as unconfigured rather than completed', async () => {
  const run = createBehavioralRun(probesGuidedLab, { attemptId: 'probe-panel-seed' })
  const panel = await render(ProbeExperimentPanel, run)
  const blade = await render(ContainerAppBlade, run, { resourceGroup: 'rg-aca-probes', name: 'api-probes' })
  expect(panel).toContain('Not configured')
  expect(panel).toContain('Ready · 0/60 seconds')
  expect(blade).toContain('Not configured')
})

it('shows a completed failed experiment at its measured duration', async () => {
  let run = createBehavioralRun(probesGuidedLab, { attemptId: 'probe-panel-failed' })
  run = action(run, { type: 'scenario-start', scenarioId: 'startup' })
  run = action(run, { type: 'simulation-advance', seconds: 60 })
  const html = await render(ProbeExperimentPanel, run)
  expect(html).toContain('Completed · 60/60 seconds')
  expect(html).toContain('failed')
})

it('keeps completed transitions available and disables controls in a read-only attempt', async () => {
  let run = setup()
  run = action(run, { type: 'scenario-start', scenarioId: 'liveness' })
  run = action(run, { type: 'simulation-advance', seconds: 90 })
  run.completedAt = '2026-09-23T00:00:00.000Z'
  const html = await render(ProbeExperimentPanel, run)
  expect(html).toContain('Liveness restart')
  expect(html).toContain('Startup completes')
  expect(html).toContain('Completed · 90/90 seconds')
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Start<\/button>/)
})

it('shows a new active attempt at its live elapsed time even when an older result exists', async () => {
  let run = setup()
  run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
  run = action(run, { type: 'simulation-advance', seconds: 90 })
  expect(await render(ProbeExperimentPanel, run)).toContain('Completed · 90/90 seconds')
  run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
  expect(await render(ProbeExperimentPanel, run)).toContain('Running · 0/90 seconds')
  run = action(run, { type: 'simulation-advance', seconds: 5 })
  expect(await render(ProbeExperimentPanel, run)).toContain('Running · 5/90 seconds')
})

it('labels old checks with the captured path and marks proof stale after a changed deployment', async () => {
  let run = setup()
  run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
  run = action(run, { type: 'simulation-advance', seconds: 90 })
  const changed = probes.map((item) => item.type === 'Readiness' ? { ...item, httpGet: { ...item.httpGet, path: '/health/not-ready' } } : item)
  run = action(run, { type: 'save-file', path: 'containerapp.yaml', text: probeConfiguration({ appName: 'api', image: 'acrprobesguided.azurecr.io/api:v1', probes: changed }) })
  run = action(run, { type: 'command', line: 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml' })
  const html = await render(ProbeExperimentPanel, run)
  expect(html).toContain('/health/ready / HTTP 200')
  expect(html).toContain('Historical verification')
  expect(html).toContain('deployment changed')
  expect(html).not.toContain('/health/not-ready / HTTP 200')
})

it('distinguishes connection failure from timeout for null probe statuses', async () => {
  let run = setup()
  const wrongPort = probes.map((item) => item.type === 'Readiness' ? { ...item, httpGet: { ...item.httpGet, port: 8081 } } : item)
  run = action(run, { type: 'save-file', path: 'containerapp.yaml', text: probeConfiguration({ appName: 'api', image: 'acrprobesguided.azurecr.io/api:v1', probes: wrongPort }) })
  run = action(run, { type: 'command', line: 'az containerapp update -g rg-aca-probes -n api-probes --yaml containerapp.yaml' })
  run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
  run = action(run, { type: 'simulation-advance', seconds: 25 })
  expect(await render(ProbeExperimentPanel, run)).toContain('Connection failed')

  run = setup()
  run = action(run, { type: 'scenario-start', scenarioId: 'liveness' })
  run = action(run, { type: 'simulation-advance', seconds: 41 })
  expect(await render(ProbeExperimentPanel, run)).toContain('Timed out')
})

it('exposes manifest files and fixed helper, and keeps request tool alongside probe controls', async () => {
  const run = setup()
  const editor = await render(ProjectEditor, run)
  expect(editor).toContain('src/Trainer.Api/HealthState.cs')
  expect(editor).toContain('containerapp.yaml')
  expect(editor).toContain('JSON form')
  const experiment = await render(ExperimentPanel, run)
  expect(experiment).toContain('Probe Experiment Controls')
  expect(experiment).toContain('Send request')
})

it('separates deployed probe policy from observed per-replica state in the read-only Blade', async () => {
  let run = setup()
  run = action(run, { type: 'scenario-start', scenarioId: 'readiness' })
  run = action(run, { type: 'simulation-advance', seconds: 40 })
  const html = await render(ContainerAppBlade, run, { resourceGroup: 'rg-aca-probes', name: 'api-probes' })
  expect(html).toContain('Configured health probes')
  expect(html).toContain('/health/ready')
  expect(html).toContain('Observed replica health')
  expect(html).toContain('Replica 0')
  expect(html).toContain('Restarts')
  expect(html).toContain('read-only')
})
