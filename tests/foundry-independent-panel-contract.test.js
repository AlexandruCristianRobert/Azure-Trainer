import { expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'

const store = vi.hoisted(() => ({ labId: 'brief-panel', loading: false, readOnly: false,
  completedAt: null, storageError: null, busy: false }))
vi.mock('../src/stores/labRun.js', () => ({ useLabRunStore: () => store }))
vi.mock('../src/lib/labEngine/evaluate.js', () => ({ evaluateLab: () => ({ tasks: [] }) }))
import FoundryRequestPanel from '../src/components/lab/FoundryRequestPanel.vue'

it('renders the active brief route and named content input', async () => {
  const appId = '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.App/containerApps/api'
  store.lab = { scenarios: { valid: { kind: 'foundry', version: 1, appId, title: 'Brief valid input',
    request: { method: 'POST', path: '/api/brief', body: { content: 'Brief this.' } },
    faultProfile: { attempts: [] }, expected: { status: 200 } } } }
  store.sandbox = { managedIdentities: [], foundryAccounts: [] }
  store.behavioralRun = { attemptId: 'brief-panel-attempt', evidence: { experimentsById: {} },
    runtime: { deploymentsByApp: { [appId]: { active: { appSpec: { foundry: {
      path: '/api/brief', inputField: 'content', outputField: 'brief' } }, foundry: {
      path: '/api/brief', inputField: 'content', outputField: 'brief' } } } } } }
  const html = await renderToString(createSSRApp(FoundryRequestPanel))
  expect(html).toContain('POST /api/brief')
  expect(html).toContain('Input content:')
  expect(html).toContain('Brief this.')
  expect(html).not.toContain('Input text:')
  expect(html).not.toContain('undefined')
})
