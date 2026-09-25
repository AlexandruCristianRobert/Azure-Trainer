import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { inspectConnectivity } from '../src/lib/kubernetes/connectivity-inspection.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { projectKubernetesInspection } from '../src/lib/kubernetes/inspection.js'
import { seedConnectivityTest, seedConfiguredAssistant } from './helpers/aks.js'

function request(run, seed, hostname = 'assistant-internal.assistant', port = 80, method = 'GET') {
  const result = routeServiceRequest(run, { origin: { kind: 'pod', clusterId: seed.clusterId, podUid: seed.diagnosticPodUid }, hostname, port, method, path: method === 'GET' ? '/api/info' : '/api/ask', ...(method === 'POST' ? { body: { question: 'How long are backups kept?' } } : {}) }, seed.lab)
  return { ...result, view: inspectConnectivity(result.run, seed.target) }
}

describe('AKS connectivity inspection', () => {
  it('labels a listener refusal as transport failure and never invents an app log', () => {
    const seed = seedConnectivityTest({ targetPort: 8081 })
    const beforeInspection = JSON.stringify(seed.run)
    const { run, outcome, view } = request(seed.run, seed)
    expect(outcome).toMatchObject({ transport: { ok: false, reason: 'CONNECTION_REFUSED' }, status: null })
    expect(view.service.targetPort).toBe(8081)
    expect(view.backends.length).toBeGreaterThan(0)
    expect(view.backends.every(row => row.listenerPort === 8080)).toBe(true)
    expect(view.requests[0].transport.reason).toBe('CONNECTION_REFUSED')
    expect(view.requests[0].trace.slice(0, 5).map(stage => stage.status)).toEqual(['Reached', 'Reached', 'Reached', 'Failed', 'Not reached'])
    expect(view.requests[0].trace[3].detail).toContain('CONNECTION_REFUSED')
    expect(view.logs).toEqual([])
    expect(JSON.stringify(view)).not.toContain('postgres-query')
    expect(seed.run.runtime.kubernetes.requests).toEqual([])
    expect(seed.run.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs).toEqual([])
    expect(run.runtime.kubernetes.requests).toHaveLength(1)
    const beforePureRead = JSON.stringify(run)
    inspectConnectivity(run, seed.target)
    expect(JSON.stringify(run)).toBe(beforePureRead)
    expect(beforeInspection).toBe(JSON.stringify(seed.run))
  })

  it('shows completed Service and Pod hops when PostgreSQL fails in the handler', () => {
    const seed = seedConnectivityTest()
    const state = seed.run.runtime.kubernetes.clusters[seed.clusterId]
    for (const snapshot of Object.values(state.podSnapshots)) snapshot.environment.PGHOST = 'missing-db.invalid'
    const { outcome, view } = request(seed.run, seed, undefined, undefined, 'POST')
    expect(outcome).toMatchObject({ transport: { ok: true }, status: 503 })
    expect(view.requests[0].route.podUid).toBeTruthy()
    expect(view.requests[0].trace.map(stage => stage.name)).toEqual(['Origin', 'DNS/address', 'Service', 'Pod/listener', 'Application', 'Embedding', 'PostgreSQL', 'Answer'])
    expect(view.requests[0].trace.slice(0, 4).map(stage => stage.status)).toEqual(['Reached', 'Reached', 'Reached', 'Reached'])
    expect(view.requests[0].trace[0].detail).toBe('diagnostics/diagnostics')
    expect(view.requests[0].trace[2].detail).toContain('assistant/assistant-internal')
    expect(view.requests[0].trace[3].detail).toContain('assistant/')
    expect(view.requests[0].trace.find(stage => stage.name === 'PostgreSQL')).toMatchObject({ status: 'Failed' })
    expect(view.logs).toHaveLength(1)
    expect(view.logs[0].requestId).toBe(outcome.requestId)
  })

  it('projects scenario IDs so a panel can select the matching request, not newer Service traffic', async () => {
    const seed = seedConnectivityTest()
    let first = request(seed.run, seed)
    first.run.runtime.kubernetes.requests.at(-1).scenarioId = 'info-check'
    const second = request(first.run, seed, undefined, undefined, 'POST')
    second.run.runtime.kubernetes.requests.at(-1).scenarioId = 'assistant-check'
    const view = inspectConnectivity(second.run, seed.target)
    expect(view.requests.map(item => item.scenarioId)).toEqual(['assistant-check', 'info-check'])
    const panel = await readFile(new URL('../src/components/lab/AksExperimentPanel.vue', import.meta.url), 'utf8')
    expect(panel).toContain('item.scenarioId === choice.value')
  })

  it('redacts Secret values by provenance throughout projected requests and logs', () => {
    const seed = seedConnectivityTest()
    const seedState = seed.run.runtime.kubernetes.clusters[seed.clusterId]
    for (const snapshot of Object.values(seedState.podSnapshots)) {
      snapshot.environment.DISPLAY_NAME = 'secret-despite-benign-key'
      snapshot.configRefs.push({ kind: 'Secret', namespace: 'assistant', name: 'credentials', key: 'VALUE', uid: 'fixture-secret', resourceVersion: '1', mode: 'env', target: 'DISPLAY_NAME' })
    }
    const routed = request(seed.run, seed)
    const state = routed.run.runtime.kubernetes.clusters[seed.clusterId]
    state.connectivity.applicationLogs[0].image = 'secret-despite-benign-key'
    routed.view = inspectConnectivity(routed.run, seed.target)
    expect(JSON.stringify(routed.view)).not.toContain('secret-despite-benign-key')
    expect(JSON.stringify(seed.run.runtime.kubernetes)).toContain('secret-despite-benign-key')
  })

  it('uses shared projections and responsive, keyboard-operable Services and trace views', async () => {
    const blade = await readFile(new URL('../src/components/blade/AksClusterBlade.vue', import.meta.url), 'utf8')
    const panel = await readFile(new URL('../src/components/lab/AksExperimentPanel.vue', import.meta.url), 'utf8')
    expect(blade).toContain('>Services</button>')
    expect(blade).toContain('inspectConnectivity')
    expect(blade).toContain('serviceRows')
    expect(blade).toContain('connectivityEnabled')
    expect(blade).toContain('No Services in this namespace')
    expect(blade).toContain('@click')
    expect(blade).toContain('max-width: 640px')
    expect(blade).toContain('button:focus-visible')
    expect(blade).toContain('@keydown.right.prevent')
    expect(panel).toContain('inspectConnectivity')
    expect(panel).toContain('kubectl logs')
    expect(panel).toContain('hop.name')
    expect(panel).toContain('diagnostics/diagnostics')
    expect(panel).toContain('effects?.diagnostics')
    expect(panel).toContain('No application handler log was recorded')
  })

  it('keeps unknown scenario IDs diagnostic and side-effect free', () => {
    const seed = seedConnectivityTest()
    const result = applyRunAction(seed.run, { type: 'aks-request', scenarioId: 'not-declared' }, seed.lab)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run).toEqual(seed.run)
  })

  it('retains the legacy ready-Service projection for Labs without connectivity capability', async () => {
    const { run, clusterId } = seedConfiguredAssistant()
    const legacyView = projectKubernetesInspection(run, clusterId)
    expect(legacyView.serviceEndpoints.length).toBeGreaterThan(0)
    expect(legacyView.serviceEndpoints[0].readyBackends.length).toBeGreaterThan(0)
    const blade = await readFile(new URL('../src/components/blade/AksClusterBlade.vue', import.meta.url), 'utf8')
    expect(blade).toContain('!connectivityEnabled')
    expect(blade).toContain(':rows="serviceRows"')
  })
})
