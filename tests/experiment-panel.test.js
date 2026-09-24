import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import ExperimentPanel from '../src/components/lab/ExperimentPanel.vue'
import { deployTroubleshootingLab } from '../src/data/labs/containerapps-journey/deploy-troubleshooting.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { useLabRunStore } from '../src/stores/labRun.js'

it('shows the seeded app selected in Experiment Controls before a request', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  const run = createBehavioralRun(deployTroubleshootingLab, { attemptId: 'experiment-ui' })
  store.sandbox = run.sandbox
  store.behavioralRun = run
  const html = await renderToString(createSSRApp(ExperimentPanel).use(pinia))
  expect(html).toMatch(/<option[^>]+selected[^>]*>api-incident<\/option>/)
})
