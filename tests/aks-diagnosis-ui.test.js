import { expect, test } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import AksExperimentPanel from '../src/components/lab/AksExperimentPanel.vue'
import AksClusterBlade from '../src/components/blade/AksClusterBlade.vue'
import { useLabRunStore } from '../src/stores/labRun.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { seedDiagnosisTest, seedDiagnosisIncidentTest, startHealthFault, advanceHealth } from './helpers/aks.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import * as api from '../src/lib/kubernetes/evidence.js'

async function render(component, fixture, { selectedId = null } = {}) {
  const pinia = createPinia(); setActivePinia(pinia)
  const store = useLabRunStore(); await store.load(fixture.lab.id, { lab: fixture.lab, repository: behavioralRepository() })
  store.behavioralRun = fixture.run; store.sandbox = fixture.run.sandbox
  let setup
  const wrapped = { ...component, created() { setup = this.$.setupState; if (selectedId) setup.diagnosisRequestId = selectedId } }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div />' } }] })
  const props = component === AksClusterBlade ? { resourceGroup: 'rgdiagnosis', name: 'aksdiagnosis' } : {}
  const html = await renderToString(createSSRApp(wrapped, props).use(pinia).use(router))
  return { html, setup, store }
}
const send = fixture => routeServiceRequest(fixture.run, { origin: { kind: 'external', clusterId: fixture.clusterId },
  hostname: fixture.run.runtime.kubernetes.clusters[fixture.clusterId].resources['Service/assistant/assistant-public'].status.loadBalancer.ingress[0].ip,
  port: 80, method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, null)

test('inspection projects isolated redacted current records, linked logs/events and consistency without advancing proof', () => {
  const fixture = seedDiagnosisTest(), sent = send(fixture); fixture.run = sent.run
  const before = JSON.stringify(fixture.run)
  const target = { ...fixture.target, requestId: sent.outcome.requestId }
  expect(api.inspectDiagnosis?.(fixture.run, target)).toMatchObject({ requests: { records: [expect.objectContaining({ id: sent.outcome.requestId })] },
    logs: { current: expect.any(Array), previous: [] }, events: expect.any(Array), consistency: expect.any(Object) })
  const projection = api.inspectDiagnosis(fixture.run, target)
  expect(projection.logs.current.some(item => item.requestId === sent.outcome.requestId)).toBe(true)
  expect(JSON.stringify(projection)).not.toContain('training-only-password')
  projection.requests.records[0].body.answer = 'caller edit'; projection.logs.current.length = 0
  expect(JSON.stringify(fixture.run)).toBe(before)
})

test.each([AksExperimentPanel, AksClusterBlade])('diagnosis component exposes native keyboard selection, request identity, dependency stages and empty states', async component => {
  const fixture = seedDiagnosisTest(), before = JSON.stringify(fixture.run)
  const empty = await render(component, fixture)
  expect(empty.html).toContain('aria-label="Select diagnosis request to inspect"')
  expect(empty.html).toContain('No live current request records')
  const sent = send(fixture); fixture.run = sent.run
  const populated = await render(component, fixture)
  expect(populated.html).toContain(sent.outcome.requestId)
  expect(populated.html).toContain('Live current request records')
  expect(populated.html).toContain('Previous-container records')
  expect(populated.html).toContain('Historical incident snapshots')
  for (const text of ['embedding', 'postgres-query', 'answer', 'container-', 'HTTP 200', 'simulated seconds']) expect(populated.html).toContain(text)
  expect(populated.html).not.toContain('training-only-password')
  expect(JSON.stringify(fixture.run)).toBe(JSON.stringify(sent.run))
  expect(before).not.toBe(JSON.stringify(sent.run))
})

test('selected request links actual previous container logs, with an explicit bounded-history message', async () => {
  const fixture = seedDiagnosisTest(), sent = send(fixture); fixture.run = sent.run
  const pod = Object.values(fixture.run.runtime.kubernetes.clusters[fixture.clusterId].resources).find(item => item.metadata.uid === sent.outcome.podUid)
  // A process hang is an ordinary simulated liveness restart, retaining the same Pod.
  fixture.run = advanceHealth(startHealthFault(fixture.run, fixture.clusterId, pod.metadata.uid, 'hung'), fixture.lab, 90)
  const projected = api.inspectDiagnosis(fixture.run, { ...fixture.target, requestId: sent.outcome.requestId })
  expect(projected.logs.previous.some(item => item.requestId === sent.outcome.requestId)).toBe(true)
  expect(projected.events.some(item => item.podUid === pod.metadata.uid)).toBe(true)
  fixture.run.runtime.kubernetes.requestsTruncated = 7
  const { html } = await render(AksExperimentPanel, fixture, { selectedId: sent.outcome.requestId })
  expect(html).toContain('7 older request records truncated')
  expect(html).toContain(sent.outcome.containerId)
})

test('historical snapshots render separately and opening inspection never allocates or changes evidence', async () => {
  const fixture = seedDiagnosisIncidentTest()
  fixture.run = applyRunAction(fixture.run, { type: 'aks-diagnosis-start', scenarioId: 'incident' }, fixture.lab).run
  fixture.run = applyRunAction(fixture.run, { type: 'aks-request', scenarioId: 'observe-port' }, fixture.lab).run
  const before = JSON.stringify(fixture.run)
  const { html } = await render(AksExperimentPanel, fixture)
  expect(html).toContain('diagnosis-observation-')
  expect(html).toContain('Historical incident snapshots')
  expect(html).toContain('CONNECTION_REFUSED')
  expect(JSON.stringify(fixture.run)).toBe(before)
})
