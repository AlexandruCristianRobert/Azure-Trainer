import { describe, expect, it } from 'vitest'
import { routeServiceRequest, resolveServiceDns } from '../src/lib/kubernetes/connectivity.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { simulateKubernetesRequest } from '../src/lib/kubernetes/requests.js'
import { seedConnectivityTest } from './helpers/aks.js'

const probeFor = (seed, overrides = {}) => ({
  origin: { kind: 'pod', clusterId: seed.clusterId, podUid: seed.diagnosticPodUid },
  hostname: 'assistant-internal.assistant', port: 80, method: 'POST', path: '/api/ask',
  body: { question: 'How long are backups kept?' }, ...overrides,
})

describe('AKS connectivity routing', () => {
  it('records no application or dependency work when the target port is wrong', () => {
    const seed = seedConnectivityTest({ targetPort: 8081 })
    const result = routeServiceRequest(seed.run, probeFor(seed), seed.lab)
    expect(result.outcome.transport).toEqual({ ok: false, reason: 'CONNECTION_REFUSED' })
    expect(result.outcome.status).toBeNull()
    expect(result.outcome.dependencyTrace).toEqual([])
    expect(result.run.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs).toEqual([])
  })

  it('resolves names relative to the diagnostic Pod namespace and accepts qualified trailing-dot names', () => {
    const seed = seedConnectivityTest()
    expect(resolveServiceDns(seed.run, { clusterId: seed.clusterId, clientNamespace: 'diagnostics', hostname: 'assistant-internal.assistant.svc.cluster.local.' }))
      .toMatchObject({ ok: true, address: expect.any(String) })
    expect(resolveServiceDns(seed.run, { clusterId: seed.clusterId, clientNamespace: 'diagnostics', hostname: 'assistant-internal' }))
      .toMatchObject({ ok: false, reason: 'DNS_NOT_FOUND' })
  })

  it('reaches the captured handler and records one correlated redacted application log', () => {
    const seed = seedConnectivityTest()
    const result = routeServiceRequest(seed.run, probeFor(seed), seed.lab)
    expect(result.outcome.transport).toEqual({ ok: true, reason: null })
    expect(result.outcome.status).toBe(200)
    expect(result.outcome.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
    const logs = result.run.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ requestId: result.outcome.requestId, podUid: result.outcome.route.podUid,
      image: 'acraksconfig.azurecr.io/assistant:v1', artifactId: result.outcome.route.artifactId, status: 200 })
    expect(JSON.stringify(logs)).not.toContain('training-only-password')
  })

  it('rejects a wrong Service port before selecting an endpoint', () => {
    const seed = seedConnectivityTest()
    const result = routeServiceRequest(seed.run, probeFor(seed, { port: 8080 }), seed.lab)
    expect(result.outcome.transport).toEqual({ ok: false, reason: 'SERVICE_PORT' })
    expect(result.outcome.route).toEqual({})
    expect(result.run.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs).toEqual([])
  })

  it('reports an internal Service name as an internal address from an external origin', () => {
    const seed = seedConnectivityTest()
    for (const hostname of ['assistant-internal.assistant', 'assistant-internal']) {
      const result = routeServiceRequest(seed.run, { origin: { kind: 'external', clusterId: seed.clusterId }, hostname,
        port: 80, method: 'GET', path: '/api/info', body: null }, seed.lab)
      expect(result.outcome.transport).toEqual({ ok: false, reason: 'INTERNAL_ADDRESS' })
      expect(result.run.runtime.kubernetes.requests).toHaveLength(seed.run.runtime.kubernetes.requests.length + 1)
    }
  })

  it('does not record malformed direct probes or invalid origins', () => {
    const seed = seedConnectivityTest()
    for (const [probe, reason] of [
      [probeFor(seed, { origin: { kind: 'pod', clusterId: seed.clusterId, podUid: 'forged' } }), 'INVALID_ORIGIN'],
      [probeFor(seed, { method: 'DELETE', path: '/api/info' }), 'INVALID_PROBE'],
      [probeFor(seed, { body: { question: 'How long are backups kept?', password: 'training-only-password' } }), 'INVALID_PROBE'],
    ]) {
      const result = routeServiceRequest(seed.run, probe, seed.lab)
      expect(result.run).toBe(seed.run)
      expect(result.outcome.transport).toEqual({ ok: false, reason })
    }
  })

  it('drops application logs when their request records age out of the bounded history', () => {
    const seed = seedConnectivityTest()
    let run = seed.run
    for (let index = 0; index < 105; index++) {
      run = routeServiceRequest(run, probeFor(seed, { method: 'GET', path: '/api/info', body: null }), seed.lab).run
    }
    const logs = run.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs
    expect(run.runtime.kubernetes.requests).toHaveLength(100)
    expect(logs).toHaveLength(100)
    expect(validateBehavioralRun(run, seed.lab)).toBe(run)
  })

  it('returns an application dependency failure with a correlated failed database hop', () => {
    const seed = seedConnectivityTest()
    const pod = Object.values(seed.run.runtime.kubernetes.clusters[seed.clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
    seed.run.runtime.kubernetes.clusters[seed.clusterId].podSnapshots[pod.metadata.uid].environment.PGHOST = 'pg-typo.example'
    const result = routeServiceRequest(seed.run, probeFor(seed), seed.lab)
    expect(result.outcome.transport.ok).toBe(true)
    expect(result.outcome.status).toBe(503)
    expect(result.outcome.dependencyTrace.map(item => [item.operation, item.status])).toEqual([['embedding', 'succeeded'], ['postgres-query', 'failed']])
    const logs = result.run.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs)).not.toContain('training-only-password')
  })

  it('rejects forged, dangling, or unredacted persisted application log records', () => {
    const seed = seedConnectivityTest()
    const result = routeServiceRequest(seed.run, probeFor(seed), seed.lab)
    expect(validateBehavioralRun(result.run, seed.lab)).toBe(result.run)
    for (const corruptLog of [
      log => { log.podUid = 'missing-pod' },
      log => { log.image = 'forged:latest' },
      log => { log.dependencySummary[0].credential = 'training-only-password' },
      log => { log.requestId = 'aks-request-999' },
    ]) {
      const corrupt = structuredClone(result.run)
      corruptLog(corrupt.runtime.kubernetes.clusters[seed.clusterId].connectivity.applicationLogs[0])
      expect(() => validateBehavioralRun(corrupt, seed.lab)).toThrow(/Kubernetes/)
    }
  })

  it('dispatches declared connectivity scenarios through the same router', () => {
    const seed = seedConnectivityTest()
    const scenario = { id: 'network-internal', target: { clusterId: seed.clusterId, namespace: 'assistant', serviceName: 'assistant-internal', deploymentName: 'assistant' },
      connectivity: { origin: { kind: 'pod', clusterId: seed.clusterId, podUid: seed.diagnosticPodUid }, hostname: 'assistant-internal.assistant', port: 80 },
      request: { method: 'GET', path: '/api/info' }, expected: { status: 200, body: { service: 'knowledge-assistant', version: '1.0', environment: 'training' } } }
    const result = simulateKubernetesRequest(seed.run, scenario)
    expect(result.outcome).toBe(true)
    expect(result.measurements.transport).toEqual({ ok: true, reason: null })
    expect(result.run.runtime.kubernetes.requests.at(-1).scenarioId).toBe(scenario.id)
    expect(validateBehavioralRun(result.run, seed.lab)).toBe(result.run)
  })
})
