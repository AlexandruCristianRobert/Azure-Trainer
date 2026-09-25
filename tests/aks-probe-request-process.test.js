import { describe, expect, it } from 'vitest'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { advanceHealth, seedHealthTest, startHealthFault } from './helpers/aks.js'

function request(run, clusterId) {
  const service = run.runtime.kubernetes.clusters[clusterId].resources['Service/assistant/assistant-public']
  return routeServiceRequest(run, { origin: { kind: 'external', clusterId },
    hostname: service.status.loadBalancer.ingress[0].ip, port: 80,
    method: 'GET', path: '/api/info', body: null }, { capabilities: { kubernetesProbes: true } })
}

describe('AKS process facts behind Service requests', () => {
  it('returns INITIALIZING until the selected container finishes initialization', () => {
    const { lab, run, clusterId } = seedHealthTest({ probeOverrides: { startupProbe: null, readinessProbe: null, livenessProbe: null } })
    const before = request(run, clusterId)
    expect(before.outcome).toMatchObject({ transport: { ok: true }, status: 503, body: { error: 'INITIALIZING' } })
    const after = request(advanceHealth(run, lab, 25), clusterId)
    expect(after.outcome).toMatchObject({ transport: { ok: true }, status: 200 })
  })

  it('rejects main API work while admission is closed and times out a hung process', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ startupSeconds: 0,
      probeOverrides: { startupProbe: null, readinessProbe: null, livenessProbe: null } })
    const ready = advanceHealth(run, lab, 1)
    const closed = startHealthFault(ready, clusterId, podUids[0], 'admissionClosed')
    expect(request(closed, clusterId).outcome).toMatchObject({ transport: { ok: true }, status: 503, body: { error: 'NOT_ACCEPTING' } })
    const hung = startHealthFault(ready, clusterId, podUids[0], 'hung')
    expect(request(hung, clusterId).outcome).toMatchObject({ transport: { ok: false, reason: 'PROCESS_TIMEOUT' }, status: null })
  })

  it('attributes safe request logs to the current container', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ startupSeconds: 0 })
    const ready = advanceHealth(run, lab, 1)
    const result = request(ready, clusterId)
    expect(result.outcome.status).toBe(200)
    expect(result.run.runtime.kubernetes.clusters[clusterId].health.containers[podUids[0]].currentLogs.join('\n'))
      .toContain('GET /api/info status=200')
  })

  it('moves actual request logs into --previous ownership after a probe restart', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ startupSeconds: 0,
      probeOverrides: { livenessProbe: { periodSeconds: 1, failureThreshold: 1, timeoutSeconds: 1 } } })
    const ready = advanceHealth(run, lab, 1)
    const withRequest = request(ready, clusterId).run
    const podUid = podUids[0]
    expect(withRequest.runtime.kubernetes.clusters[clusterId].health.containers[podUid].currentLogs.join('\n')).toContain('GET /api/info status=200')
    const hung = startHealthFault(withRequest, clusterId, podUid, 'hung')
    const restarted = advanceHealth(hung, lab, 20)
    const container = restarted.runtime.kubernetes.clusters[clusterId].health.containers[podUid]
    expect(container.restartCount).toBe(1)
    expect(container.previous.logs.join('\n')).toContain('GET /api/info status=200')
    expect(container.currentLogs).toEqual([])
  })
})
