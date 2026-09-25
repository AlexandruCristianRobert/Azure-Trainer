import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AksClusterBlade from '../src/components/blade/AksClusterBlade.vue'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { act, advanceHealth, seedHealthTest } from './helpers/aks.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

async function renderBlade(lab, behavioralRun, cluster) {
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useLabRunStore()
  await store.load(lab.id, { lab, repository: behavioralRepository() })
  store.behavioralRun = behavioralRun
  store.sandbox = behavioralRun.sandbox
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  return renderToString(createSSRApp(AksClusterBlade, { resourceGroup: cluster.resourceGroup, name: cluster.name }).use(pinia).use(router))
}

it('renders probe state and experiment timeline as read-only cluster inspection', async () => {
  const seeded = seedHealthTest()
  const started = applyRunAction(seeded.run, { type: 'aks-probe-start', scenarioId: 'coldStartup' }, seeded.lab).run
  const progressing = advanceHealth(started, seeded.lab, 20)
  const cluster = progressing.sandbox.aksClusters.find(item => item.id === seeded.clusterId)
  const html = await renderBlade(seeded.lab, progressing, cluster)

  expect(html).toContain('Read-only health probe inspection')
  expect(html).toContain('Health probe state')
  expect(html).toContain('coldStartup')
  expect(html).toContain('Probe experiment timeline')
  expect(html).toContain('Startup')
  expect(html).toContain('5 failures')
  expect(html).toContain('read-only')
  expect(html).not.toContain('Restart container')
  expect(html).not.toContain('Inject fault')
})

it('shows completed and cancelled experiment history without exposing state-changing controls', async () => {
  const seeded = seedHealthTest()
  const completed = advanceHealth(act(seeded.run, seeded.lab,
    { type: 'aks-probe-start', scenarioId: 'coldStartup' }).run, seeded.lab, 30)
  const cluster = completed.sandbox.aksClusters.find(item => item.id === seeded.clusterId)
  const completedHtml = await renderBlade(seeded.lab, completed, cluster)
  expect(completedHtml).toContain('coldStartup')
  expect(completedHtml).toContain('completed')
  expect(completedHtml).toContain('Probe experiment timeline')

  const cancelled = act(seeded.run, seeded.lab, { type: 'aks-probe-start', scenarioId: 'optionalAiOutage' }).run
  const afterCancel = act(cancelled, seeded.lab, { type: 'aks-probe-cancel' }).run
  const cancelledHtml = await renderBlade(seeded.lab, afterCancel, cluster)
  expect(cancelledHtml).toContain('optionalAiOutage')
  expect(cancelledHtml).toContain('cancelled')
  expect(cancelledHtml).not.toContain('Inject fault')
})
