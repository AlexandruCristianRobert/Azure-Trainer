import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import ExperimentPanel from '../src/components/lab/ExperimentPanel.vue'
import { foundryGuidedLab } from '../src/data/labs/containerapps-journey/foundry-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { useLabRunStore } from '../src/stores/labRun.js'

async function render(run) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  store.labId = foundryGuidedLab.id
  store.sandbox = run.sandbox
  store.behavioralRun = run
  return renderToString(createSSRApp(ExperimentPanel).use(pinia))
}

it('shows simulated named POST controls and the captured endpoint and caller', async () => {
  const run = createBehavioralRun(foundryGuidedLab, { attemptId: 'foundry-panel' })
  const html = await render(run)
  expect(html).toContain('Foundry Request Controls')
  expect(html).toContain('Summarize valid input')
  expect(html).toContain('Reject blank input')
  expect(html).toContain('POST /api/summarize')
  expect(html).toContain('Simulated')
  expect(html).toContain('Caller identity')
})

it('shows a correlated upstream attempt and public response after the worked path', async () => {
  let run = createBehavioralRun(foundryGuidedLab, { attemptId: 'foundry-panel-result' })
  for (const task of foundryGuidedLab.tasks.slice(0, 5)) for (const step of task.solution.steps) {
    const action = step.kind === 'command' ? { type: 'command', line: step.line }
      : step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content } : step.action
    run = applyRunAction(run, action, foundryGuidedLab).run
  }
  const html = await render(run)
  expect(html).toContain('HTTP 200')
  expect(html).toContain('summarizer-primary')
  expect(html).toContain('foundry-request-')
  expect(html).toContain('Upstream attempts')
})
