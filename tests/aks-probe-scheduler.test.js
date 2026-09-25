import { describe, expect, it } from 'vitest'
import { evaluateHealthEndpoint } from '../src/lib/kubernetes/probes.js'
import { advanceKubernetesTime } from '../src/lib/kubernetes/time.js'

function healthRun() {
  const probe = (path, periodSeconds, failureThreshold) => ({ httpGet: { path, port: 8080, scheme: 'HTTP' }, initialDelaySeconds: 0, periodSeconds, timeoutSeconds: 1, failureThreshold, successThreshold: 1 })
  const pod = { kind: 'Pod', metadata: { uid: 'pod-a', name: 'assistant-a', namespace: 'assistant' }, spec: { containers: [{ ports: [{ name: 'http', containerPort: 8080 }], startupProbe: probe('/health/startup', 5, 6), readinessProbe: probe('/health/ready', 2, 1), livenessProbe: probe('/health/live', 5, 2) }] }, status: { phase: 'Running', conditions: [] } }
  const appSpec = { listeningPort: 8080, health: { endpoints: [
    { path: '/health/startup', statusExpression: { kind: 'conditional', condition: { kind: 'signal', name: 'initialized' }, then: 200, else: 503 }, body: { check: 'startup' } },
    { path: '/health/ready', statusExpression: { kind: 'conditional', condition: { kind: 'signal', name: 'initialized' }, then: 200, else: 503 }, body: { check: 'readiness' } },
    { path: '/health/live', statusExpression: { kind: 'constant', value: 200 }, body: { check: 'liveness' } },
  ] } }
  return { nextSequence: 1, runtime: { simTimeMs: 0, kubernetes: { clusters: { c: { resources: { pod }, podSnapshots: { 'pod-a': { artifactId: 'artifact' } }, projectionDue: {} } } } }, artifacts: { buildsById: { artifact: { appSpec } } } }
}

describe('AKS probe scheduler', () => {
  it('evaluates compiled health conditions against fixture signals', () => {
    const appSpec = { listeningPort: 8080, health: { endpoints: [{ path: '/health/ready', body: { check: 'readiness' }, statusExpression: {
      kind: 'conditional', condition: { kind: 'and', operands: [{ kind: 'signal', name: 'initialized' }, { kind: 'signal', name: 'accepting_requests' }] }, then: 200, else: 503,
    } }] } }

    expect(evaluateHealthEndpoint(appSpec, { initializedAtMs: 24_000, localFaults: { admissionClosed: false, hung: false } }, {}, '/health/ready', 8080, 20_000)).toMatchObject({ status: 503 })
    expect(evaluateHealthEndpoint(appSpec, { initializedAtMs: 24_000, localFaults: { admissionClosed: false, hung: false } }, {}, '/health/ready', 8080, 24_000)).toMatchObject({ status: 200 })
  })

  it('suppresses readiness and liveness until startup succeeds at the fixture boundary', () => {
    const lab = { capabilities: { kubernetesProbes: true }, healthFixture: { initializationSeconds: 24 } }
    const early = advanceKubernetesTime(healthRun(), 20, lab)
    const state = early.runtime.kubernetes.clusters.c.health.containers['pod-a']
    expect(state.startupPassed).toBe(false)
    expect(state.ready).toBe(false)
    expect(state.checks.readiness.nextAtMs).toBeNull()
    expect(state.checks.liveness.nextAtMs).toBeNull()
    const ready = advanceKubernetesTime(early, 5, lab)
    expect(ready.runtime.kubernetes.clusters.c.health.containers['pod-a'].ready).toBe(true)
  })

  it('has the same effective health state for one 30-second advance and six 5-second advances', () => {
    const lab = { capabilities: { kubernetesProbes: true }, healthFixture: { initializationSeconds: 24 } }
    const once = advanceKubernetesTime(healthRun(), 30, lab)
    let partitioned = healthRun(); for (let i = 0; i < 6; i++) partitioned = advanceKubernetesTime(partitioned, 5, lab)
    expect(partitioned.runtime.kubernetes.clusters.c.health).toEqual(once.runtime.kubernetes.clusters.c.health)
  })
})
