import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import FoundryRequestPanel from '../src/components/lab/FoundryRequestPanel.vue'
import { foundryIndependentLab as lab } from '../src/data/labs/containerapps-journey/foundry-independent.lab.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { useLabRunStore } from '../src/stores/labRun.js'

async function render(run, readOnly = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useLabRunStore()
  store.labId = lab.id
  store.sandbox = run.sandbox
  store.behavioralRun = run
  store.readOnly = readOnly
  return renderToString(createSSRApp(FoundryRequestPanel).use(pinia))
}

function solveSetup(run) {
  for (const task of lab.tasks.slice(0, 5)) for (const step of task.solution.steps) {
    const action = step.kind === 'command' ? { type: 'command', line: step.line }
      : step.kind === 'file' ? { type: 'save-file', path: step.path, text: step.content } : step.action
    run = applyRunAction(run, action, lab).run
  }
  return run
}

function request(run, scenarioId) {
  return applyRunAction(run, { type: 'request', scenarioId }, lab).run
}

it('distinguishes the seeded active API from the named brief route before deployment', async () => {
  const html = await render(createBehavioralRun(lab, { attemptId: 'brief-panel-starter' }))
  expect(html).toContain('Active contract')
  expect(html).toContain('Brief route is not active')
  expect(html).toContain('Named request POST /api/brief')
  for (const scenario of Object.values(lab.scenarios)) expect(html).toContain(scenario.title)
  expect(html).toContain('Input content:')
  expect(html).not.toContain('name="status"')
  expect(html).not.toContain('name="fault"')
})

it('shows the active brief contract and separates public success from its correlated attempt', async () => {
  const run = request(solveSetup(createBehavioralRun(lab, { attemptId: 'brief-panel-valid' })), 'valid')
  const html = await render(run)
  expect(html).toContain('Active contract')
  expect(html).toContain('POST /api/brief')
  expect(html).toContain('content → brief')
  expect(html).toContain('briefing-secondary')
  const publicSection = html.split('Public response')[1].split('Upstream attempts')[0]
  expect(publicSection).toContain('HTTP 200')
  expect(publicSection).toContain('&quot;brief&quot;')
  expect(publicSection).toContain('&quot;deployment&quot;')
  expect(publicSection).toContain('Public body')
  expect(publicSection).not.toContain('Upstream status')
  expect(html).toContain('foundry-request-')
  expect(html).toContain('Caller principal')
  expect(html).toContain('Budget consumed 0 ms of 8,000 ms')
})

it('shows invalid input without an upstream call and a public 503 separately from upstream 429s', async () => {
  let run = solveSetup(createBehavioralRun(lab, { attemptId: 'brief-panel-errors' }))
  run = request(run, 'invalid')
  let html = await render(run)
  expect(html.split('Public response')[1].split('Upstream attempts')[0]).toContain('HTTP 400')
  expect(html).toContain('Zero upstream invocations')
  run = request(run, 'transient')
  html = await render(run)
  expect(html).toContain('Retry-After 1 s')
  expect(html).toContain('Budget consumed 1,200 ms of 8,000 ms')
  run = request(run, 'persistent')
  html = await render(run)
  const publicSection = html.split('Public response')[1].split('Upstream attempts')[0]
  expect(publicSection).toContain('HTTP 503')
  expect(publicSection).toContain('Public error body')
  expect(publicSection).toContain('UPSTREAM_UNAVAILABLE')
  expect(publicSection).not.toContain('HTTP 429')
  expect(html).toContain('Upstream status')
  expect(html).toContain('Budget consumed 3,300 ms of 8,000 ms')
})

it('keeps completed Result evidence visible and disables sending', async () => {
  let run = solveSetup(createBehavioralRun(lab, { attemptId: 'brief-panel-result' }))
  for (const id of ['valid', 'invalid', 'transient', 'persistent']) run = request(run, id)
  const html = await render({ ...run, completedAt: '2026-09-23T00:00:00.000Z' }, true)
  expect(html).toMatch(/<button[^>]*disabled[^>]*>Send named POST<\/button>/)
  expect(html).toContain('HTTP 503')
  expect(html).toContain('Correlated upstream trace')
})
