import { describe, expect, it } from 'vitest'
import { evaluateHealthEndpoint } from '../src/lib/kubernetes/probes.js'

describe('AKS probe scheduler', () => {
  it('evaluates compiled health conditions against fixture signals', () => {
    const appSpec = { listeningPort: 8080, health: { endpoints: [{ path: '/health/ready', body: { check: 'readiness' }, statusExpression: {
      kind: 'conditional', condition: { kind: 'and', operands: [{ kind: 'signal', name: 'initialized' }, { kind: 'signal', name: 'accepting_requests' }] }, then: 200, else: 503,
    } }] } }

    expect(evaluateHealthEndpoint(appSpec, { initializedAtMs: 24_000, localFaults: { admissionClosed: false, hung: false } }, {}, '/health/ready', 8080, 20_000)).toMatchObject({ status: 503 })
    expect(evaluateHealthEndpoint(appSpec, { initializedAtMs: 24_000, localFaults: { admissionClosed: false, hung: false } }, {}, '/health/ready', 8080, 24_000)).toMatchObject({ status: 200 })
  })
})
