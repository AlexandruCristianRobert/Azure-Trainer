import { describe, expect, it } from 'vitest'
import { parsePythonIntegration } from '../src/lib/project/python-integration.js'
import { INTEGRATION_MANIFEST, INTEGRATION_SOLUTION_FILES } from '../src/data/templates/aks-python/integration.js'
import { INTEGRATION_FIXTURES } from '../src/data/fixtures/aks/integration.js'
import { simulateIntegration } from '../src/lib/kubernetes/integration.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { makeTrainingSnapshot } from './helpers/aks.js'
import { seedConnectivityTest } from './helpers/aks.js'

const appSpec = parsePythonIntegration(INTEGRATION_SOLUTION_FILES, INTEGRATION_MANIFEST).appSpec
const request = question => ({ method: 'POST', path: '/api/ask', body: { question } })
const snapshot = () => ({ ...makeTrainingSnapshot(), environment: { ...makeTrainingSnapshot().environment, AUDIENCE: 'employee' } })

describe('compiled AKS assistant integration runtime', () => {
  it('executes the authored graph and records dependency provenance', () => {
    const outcome = simulateIntegration(appSpec, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome).toMatchObject({ status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training' } })
    expect(outcome.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
    expect(outcome.integrationTrace).toMatchObject({ profileId: 'healthy', vectorProvenance: 'embedding', selectedIds: ['training-backups'], contextIds: ['training-backups'], sourceProvenance: 'rows', elapsedMs: 120 })
  })

  it('uses one request-local budget across a retry without restarting earlier stages', () => {
    const outcome = simulateIntegration(appSpec, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'embedding-throttle-once')
    expect(outcome.status).toBe(200)
    expect(outcome.integrationTrace.elapsedMs).toBe(310)
    expect(outcome.dependencyTrace[0].attempts).toHaveLength(2)
    expect(outcome.dependencyTrace[0].attempts[0].delayBeforeNextMs).toBe(150)
    expect(outcome.dependencyTrace.slice(1).map(item => item.operation)).toEqual(['postgres-query', 'answer'])
  })

  it('does not call answer for the authored empty-result guard', () => {
    const outcome = simulateIntegration(appSpec, snapshot(), request('What is the travel allowance?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome).toMatchObject({ status: 200, body: { answer: 'No matching documents.', sources: [] } })
    expect(outcome.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query'])
  })

  it('keeps a literal vector observable instead of treating it as an embedding result', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES, 'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('as_vector(vector)', 'as_vector([1, 0, 0])') }
    const literalApp = parsePythonIntegration(files, INTEGRATION_MANIFEST).appSpec
    const outcome = simulateIntegration(literalApp, snapshot(), request('Who provides support?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome).toMatchObject({ status: 422, body: { code: 'UNSUPPORTED_FIXTURE_CONTEXT' } })
    expect(outcome.integrationTrace.vectorProvenance).toBe('literal')
    expect(outcome.integrationTrace.selectedIds).toEqual(['training-backups'])
  })

  it('maps bounded persistent dependency errors through the authored catch path', () => {
    const outcome = simulateIntegration(appSpec, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'answer-unavailable-always')
    expect(outcome).toMatchObject({ status: 503, body: { code: 'DEPENDENCY_UNAVAILABLE' } })
    expect(outcome.dependencyTrace.at(-1).attempts).toHaveLength(3)
    expect(outcome.integrationTrace.elapsedMs).toBe(520)
  })

  it('rejects a context that is real fixture content but does not answer the authored question', () => {
    const wrongContextApp = structuredClone(appSpec)
    wrongContextApp.integration.graph.nodes.find(node => node.op === 'context-rows').fields.content = 'id'
    const outcome = simulateIntegration(wrongContextApp, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome).toMatchObject({ status: 422, body: { code: 'UNSUPPORTED_FIXTURE_CONTEXT' } })
  })

  it('projects only bounded safe query bindings into the integration trace', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES, 'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('"collection": cfg["collection"],', '"collection": cfg["collection"],\n                "secret": cfg["pg_password"],') }
    const tracedApp = parsePythonIntegration(files, INTEGRATION_MANIFEST).appSpec
    const outcome = simulateIntegration(tracedApp, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome.integrationTrace.queryBindings).toEqual({ collection: 'training', audience: 'employee', published: true, vector: '[1,0,0]', cutoff: 0.2, limit: 1 })
    expect(JSON.stringify(outcome.integrationTrace)).not.toContain('training-only-password')
  })

  it('redacts a Secret-derived value even when it is bound under an allowed query field', () => {
    const files = { ...INTEGRATION_SOLUTION_FILES, 'app.py': INTEGRATION_SOLUTION_FILES['app.py'].replace('"collection": cfg["collection"]', '"collection": cfg["pg_password"]') }
    const secretBoundApp = parsePythonIntegration(files, INTEGRATION_MANIFEST).appSpec
    const outcome = simulateIntegration(secretBoundApp, snapshot(), request('How long are backups kept?'), INTEGRATION_FIXTURES, 'healthy')
    expect(outcome.integrationTrace.queryBindings.collection).toBe('[redacted]')
    expect(JSON.stringify(outcome)).not.toContain('training-only-password')
  })

  it('carries a scenario-selected immutable profile and trace through Service routing', () => {
    const seed = seedConnectivityTest()
    const pod = Object.values(seed.run.runtime.kubernetes.clusters[seed.clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
    const artifactId = seed.run.runtime.kubernetes.clusters[seed.clusterId].podSnapshots[pod.metadata.uid].artifactId
    seed.run.artifacts.buildsById[artifactId].appSpec = appSpec
    seed.run.runtime.kubernetes.clusters[seed.clusterId].podSnapshots[pod.metadata.uid].environment.AUDIENCE = 'employee'
    const routed = routeServiceRequest(seed.run, { origin: { kind: 'pod', clusterId: seed.clusterId, podUid: seed.diagnosticPodUid }, hostname: 'assistant-internal.assistant', port: 80,
      method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' }, integrationProfile: 'embedding-throttle-once' }, seed.lab)
    expect(routed.outcome.status).toBe(200)
    expect(routed.outcome.integrationTrace).toMatchObject({ profileId: 'embedding-throttle-once', elapsedMs: 310 })
    expect(routed.run.runtime.kubernetes.requests.at(-1).integrationTrace.profileId).toBe('embedding-throttle-once')
  })
})
