import { expect, test } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AksExperimentPanel from '../src/components/lab/AksExperimentPanel.vue'
import AksClusterBlade from '../src/components/blade/AksClusterBlade.vue'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { releaseTestRun } from './helpers/aks.js'
import { lab, start, action } from './helpers/release-evidence.js'

async function render(component, behavioralRun, { readOnly = false, busy = false } = {}) {
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useLabRunStore(); await store.load(lab.id, { lab, repository: behavioralRepository() })
  store.behavioralRun = behavioralRun; store.sandbox = behavioralRun.sandbox; store.readOnly = readOnly; store.running = busy
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  const props = component === AksClusterBlade ? { resourceGroup: 'rgaksreleases', name: 'aksreleases' } : {}
  return renderToString(createSSRApp(component, props).use(pinia).use(router))
}

test('release controls are keyboard-native buttons and use a text status and accessible samples table', async () => {
  const html = await render(AksExperimentPanel, start())
  expect(html).toContain('aria-label="AKS release experiments"')
  expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Finish release experiment"/)
  expect(html).toMatch(/<button[^>]*aria-label="Cancel release experiment"/)
  expect(html).toContain('aria-label="Advance release simulation by 15 seconds"')
  expect(html).toContain('role="status" aria-live="polite"')
  expect(html).toContain('baseline')
  expect(html).toContain('Observed samples')
  expect(html).toMatch(/<th scope="col"[^>]*>Available<\/th>/)
  expect(html).toMatch(/<th scope="col"[^>]*>Backend artifacts<\/th>/)
  expect(html).toContain('training-backups')
  expect(html).not.toContain('training-only-password')
})

test('reload resumes active release with disabled start; finish and cancel reflect real action state', async () => {
  let run = JSON.parse(JSON.stringify(start()))
  const active = await render(AksExperimentPanel, run)
  expect(active).toMatch(/aria-label="Start release experiment"[^>]*disabled/)
  expect(active).toContain('1 observed sample')
  run = action(run, { type: 'aks-release-finish', scenarioId: 'release-v2' })
  expect(await render(AksExperimentPanel, run)).toContain('failed')
  run = start(run); run = action(run, { type: 'aks-release-cancel' })
  expect(await render(AksExperimentPanel, run)).toContain('learner-cancelled')
})

test.each([{ readOnly: true }, { busy: true }])('locks release controls for %j', async options => {
  const html = await render(AksExperimentPanel, start(), options)
  expect(html).toMatch(/aria-label="Finish release experiment"[^>]*disabled/)
  expect(html).toMatch(/aria-label="Cancel release experiment"[^>]*disabled/)
})

test('cluster release inspection is pure, with revision/artifact and separate rollout counts', async () => {
  const run = releaseTestRun(); const before = JSON.stringify(run)
  const html = await render(AksClusterBlade, run)
  expect(html).toContain('Release revisions and artifacts')
  expect(html).toContain('updated 2')
  expect(html).toContain('available 2')
  expect(html).toContain('terminating 0')
  expect(html).toContain('sha256:')
  expect(html).not.toContain('training-only-password')
  expect(JSON.stringify(run)).toBe(before)
})

test('component control handler dispatches real start, clock, finish and cancel through the saved session', async () => {
  const pinia = createPinia(); setActivePinia(pinia)
  const repository = behavioralRepository(); await repository.saveRun(releaseTestRun(), { expectedRevision: 0 })
  const store = useLabRunStore(); await store.load(lab.id, { lab, repository })
  let handler
  const component = { ...AksExperimentPanel, created() { handler = this.$.setupState.releaseAction } }
  await renderToString(createSSRApp(component).use(pinia))
  await handler('aks-release-start', 'release-v2')
  expect(store.behavioralRun.runtime.kubernetes.clusters[lab.scenarios['release-v2'].target.clusterId].rollouts.experiment.status).toBe('active')
  await handler('aks-advance', 15)
  expect(store.behavioralRun.runtime.simTimeMs).toBe(30000)
  await handler('aks-release-finish')
  expect(store.behavioralRun.runtime.kubernetes.clusters[lab.scenarios['release-v2'].target.clusterId].rollouts.receipts.at(-1).outcome).toBe('failed')
  await handler('aks-release-start', 'release-v2'); await handler('aks-release-cancel')
  const saved = await repository.loadRun()
  expect(saved.runtime.kubernetes.clusters[lab.scenarios['release-v2'].target.clusterId].rollouts.experiment.cancellationReason).toBe('learner-cancelled')
})

test('missing saved Service is a visible saved/live mismatch, not a match', async () => {
  const run = action(releaseTestRun(), { type: 'save-file', path: 'k8s/service-external.yaml', text: '' })
  expect(await render(AksExperimentPanel, run)).toContain('mismatch; repair and reapply')
})

test('cluster release inspection follows the selected namespace', async () => {
  let run = releaseTestRun()
  const saved = run.project.savedFiles['k8s/namespace.yaml']
  run = action(run, { type: 'save-file', path: 'k8s/namespace.yaml', text: 'apiVersion: v1\nkind: Namespace\nmetadata:\n  name: aaa-empty\n' })
  run = action(run, { type: 'command', line: 'kubectl apply -f k8s/namespace.yaml' })
  run = action(run, { type: 'save-file', path: 'k8s/namespace.yaml', text: saved })
  const html = await render(AksClusterBlade, run)
  expect(html).toMatch(/<option[^>]*>aaa-empty<\/option>/)
  expect(html).not.toContain('Release revisions and artifacts')
})
