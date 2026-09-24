import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import FoundryRequestPanel from '../src/components/lab/FoundryRequestPanel.vue'
import { foundryTroubleshootingLab as lab } from '../src/data/labs/containerapps-journey/foundry-troubleshooting.lab.js'
import { foundryGuidedLab } from '../src/data/labs/containerapps-journey/foundry-guided.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { useLabRunStore } from '../src/stores/labRun.js'

async function render(run, { readOnly = false, currentLab = lab } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  store.labId = currentLab.id
  store.sandbox = run.sandbox
  store.behavioralRun = run
  store.readOnly = readOnly
  return renderToString(createSSRApp(FoundryRequestPanel).use(pinia))
}

function solve(run, task) {
  for (const step of task.solution.steps) {
    const action = step.kind === 'command' ? { type: 'command', line: step.line }
      : step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content } : step.action
    run = applyRunAction(run, action, lab).run
  }
  return run
}

it('describes every immutable named fixture and only offers a named POST action', async () => {
  const html = await render(createBehavioralRun(lab, { attemptId: 'panel-fixtures' }))
  for (const scenario of Object.values(lab.scenarios)) expect(html).toContain(scenario.title)
  expect(html).toContain('429')
  expect(html).toContain('Retry-After 2 s')
  expect(html).toContain('5,000 ms')
  expect(html).toContain('Task target at its intended stage: HTTP 502')
  expect(html).not.toContain('Expected public HTTP')
  expect(html).toContain('Input text:')
  expect(html).toContain('Send named POST')
  expect(html).not.toContain('name="status"')
  expect(html).not.toContain('name="fault"')
})

it('keeps the verification target conditional when the same fixture runs after endpoint repair', async () => {
  let run = createBehavioralRun(lab, { attemptId: 'panel-stage' })
  run = solve(run, lab.tasks[0])
  let publicResponse = (await render(run)).split('Public response')[1].split('Upstream attempts')[0]
  expect(publicResponse).toContain('FOUNDRY_ACCOUNT_NOT_FOUND')
  run = solve(run, lab.tasks[1])
  run = applyRunAction(run, { type: 'request', scenarioId: 'endpoint' }, lab).run
  const html = await render(run)
  publicResponse = html.split('Public response')[1].split('Upstream attempts')[0]
  expect(publicResponse).toContain('FOUNDRY_DEPLOYMENT_NOT_FOUND')
  expect(publicResponse).not.toContain('FOUNDRY_ACCOUNT_NOT_FOUND')
  expect(html).toContain('Task target at its intended stage: HTTP 502')
  expect(html).not.toContain('Expected public HTTP')
})

it('describes the Guided blank-input fixture without claiming endpoint checks happen first', async () => {
  const run = createBehavioralRun(foundryGuidedLab, { attemptId: 'panel-guided-invalid' })
  const html = await render(run, { currentLab: foundryGuidedLab })
  expect(html).toContain('Reject blank input')
  expect(html).toContain('No upstream fault injected.')
  expect(html).not.toContain('caller access are checked first')
})

it('separates a local diagnostic from the public response and shows zero upstream attempts', async () => {
  let run = createBehavioralRun(lab, { attemptId: 'panel-diagnostic' })
  run = solve(run, lab.tasks[0])
  const html = await render(run)
  expect(html).toContain('Public response')
  expect(html).toContain('HTTP 502')
  expect(html).toContain('Diagnostic code')
  expect(html).toContain('FOUNDRY_ACCOUNT_NOT_FOUND')
  expect(html).toContain('Zero upstream invocations')
  expect(html).toContain('Local simulation')
})

it('shows captured Retry-After, bounded durations and consumed budget for the latest scenario', async () => {
  let run = createBehavioralRun(lab, { attemptId: 'panel-retries' })
  for (const task of lab.tasks.slice(0, 8)) run = solve(run, task)
  let html = await render(run)
  expect(html).toContain('HTTP 200')
  expect(html).toContain('Retry-After 2 s')
  expect(html).toContain('2,000 ms')
  expect(html).toContain('2,200 ms of 10,000 ms')
  expect(html).toContain('summarizer-primary')
  expect(html).toContain('foundry-request-')
  run = solve(run, lab.tasks[8])
  html = await render(run)
  expect(html).toContain('HTTP 503')
  expect(html).toContain('UPSTREAM_UNAVAILABLE')
  run = solve(run, lab.tasks[9])
  html = await render(run)
  expect(html).toContain('HTTP 504')
  expect(html).toContain('UPSTREAM_DEADLINE')
  expect(html).toContain('10,000 ms of 10,000 ms')
  expect(html).toContain('3,000 ms')
  expect(html).toContain('1,000 ms')
})

it('keeps completed attempts read-only while leaving fixture and trace visible', async () => {
  let run = createBehavioralRun(lab, { attemptId: 'panel-complete' })
  for (const task of lab.tasks) run = solve(run, task)
  const html = await render({ ...run, completedAt: '2026-09-23T00:00:00.000Z' }, { readOnly: true })
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Send named POST<\/button>/)
  expect(html).toContain('HTTP 200')
  expect(html).toContain('Healthy model request')
})
