import { describe, expect, it } from 'vitest'
import { evaluateHealthEndpoint } from '../src/lib/kubernetes/probes.js'
import { advanceKubernetesTime } from '../src/lib/kubernetes/time.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { getServiceBackends } from '../src/lib/kubernetes/services.js'
import { advanceHealth, act, healthContainer, seedHealthTest } from './helpers/aks.js'
import { advanceKubernetesTimeResult } from '../src/lib/kubernetes/time.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { HEALTH_SOLUTION_FILES } from '../src/data/templates/aks-python/health.js'

function clusterState(run, clusterId) { return run.runtime.kubernetes.clusters[clusterId] }

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
  it('seeds two health Pods through the real build and Kubernetes apply flow at time zero', () => {
    const { lab, run, clusterId, podUids, target } = seedHealthTest()
    expect(run.runtime.simTimeMs).toBe(0)
    expect(target).toEqual({ clusterId, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant-internal' })
    expect(getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(pod => pod.metadata.uid)).toEqual(podUids)
    expect(run.artifacts.buildsById[run.artifacts.publishedTags['acraksprobesguided.azurecr.io/assistant:health-v1']].appSpec.health.version).toBe(1)
    expect(run.runtime.kubernetes.clusters[clusterId].health.containers).toHaveProperty(podUids[0])
    expect(lab.capabilities).toMatchObject({ kubernetesConnectivity: true, kubernetesAiIntegration: true })
    expect(getServiceBackends(run, target)).toMatchObject({ endpoints: expect.arrayContaining([expect.objectContaining({ ready: false })]) })
    expect(getServiceBackends(run, target).endpoints).toHaveLength(2)
    expect(lab.healthFixture.initializationSeconds).toBe(24)
    expect(getServiceBackends(run, target).service.spec.ports[0].protocol).toBe('TCP')
  })

  it('has the same probe state after one 30-second advance and six 5-second advances', () => {
    const { lab, run, clusterId } = seedHealthTest()
    const once = advanceHealth(run, lab, 30)
    let partitioned = run
    for (let index = 0; index < 6; index++) partitioned = advanceHealth(partitioned, lab, 5)
    expect(partitioned.runtime.simTimeMs).toBe(30_000)
    expect(clusterState(partitioned, clusterId).health).toEqual(clusterState(once, clusterId).health)
  })

  it('gates readiness and liveness until the sixth startup check succeeds at 25 seconds', () => {
    const { lab, run, clusterId, podUids, target } = seedHealthTest()
    const at20 = advanceHealth(run, lab, 20)
    const state = healthContainer(at20, clusterId, podUids[0])
    expect(state.checks.startup.failures).toBe(5)
    expect(state.startupPassed).toBe(false)
    expect(state.ready).toBe(false)
    expect(state.checks.readiness.nextAtMs).toBeNull()
    expect(state.checks.liveness.nextAtMs).toBeNull()
    const at25 = advanceHealth(at20, lab, 5)
    expect(healthContainer(at25, clusterId, podUids[0])).toMatchObject({ startupPassed: true, ready: true, checks: { startup: { successes: 1 } } })
    expect(getServiceBackends(at25, target).readyEndpoints).toHaveLength(2)
  })

  it('starts readiness and liveness immediately when startup probing is omitted', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ probeOverrides: { startupProbe: null } })
    const initial = healthContainer(run, clusterId, podUids[0])
    expect(initial.startupPassed).toBe(true)
    expect(initial.checks.startup).toBeNull()
    expect(initial.checks.readiness.nextAtMs).toBe(0)
    expect(initial.checks.liveness.nextAtMs).toBe(0)
    const firstChecks = advanceHealth(run, lab, 1)
    expect(healthContainer(firstChecks, clusterId, podUids[0])).toMatchObject({
      startupPassed: true, checks: { readiness: { failures: 1 }, liveness: { successes: 1 } },
    })
  })

  it('marks a Pod ready after startup when readiness probing is omitted', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ probeOverrides: { readinessProbe: null } })
    expect(healthContainer(run, clusterId, podUids[0]).checks.readiness).toBeNull()
    const warmed = advanceHealth(run, lab, 25)
    expect(healthContainer(warmed, clusterId, podUids[0])).toMatchObject({ startupPassed: true, ready: true, checks: { readiness: null } })
  })

  it('respects the initial-delay boundary and starts at the exact due second', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ probeOverrides: { startupProbe: { initialDelaySeconds: 3 } } })
    const before = advanceHealth(run, lab, 2)
    expect(healthContainer(before, clusterId, podUids[0]).checks.startup).toMatchObject({ failures: 0, nextAtMs: 3000 })
    const due = advanceHealth(before, lab, 1)
    expect(healthContainer(due, clusterId, podUids[0]).checks.startup).toMatchObject({ failures: 1, nextAtMs: 8000 })
  })

  it('opens zero-delay checks at the same timestamp when startup succeeds immediately', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ startupSeconds: 0 })
    const atOne = advanceHealth(run, lab, 1)
    expect(healthContainer(atOne, clusterId, podUids[0])).toMatchObject({ startupPassed: true, ready: true,
      checks: { startup: { successes: 1 }, readiness: { successes: 1 }, liveness: { successes: 1 } } })
  })

  it('treats HTTP 200 and 399 as success and 199 and 400 as failure', () => {
    for (const [status, expectedSuccess] of [[200, true], [399, true], [199, false], [400, false]]) {
      const files = structuredClone(HEALTH_SOLUTION_FILES)
      files['app.py'] = files['app.py'].replace('200 if initialized() else 503', String(status))
      const { lab, run, clusterId, podUids } = seedHealthTest({ startupSeconds: 0, files })
      const checked = advanceHealth(run, lab, 1)
      const startup = healthContainer(checked, clusterId, podUids[0]).checks.startup
      expect(startup.successes > 0).toBe(expectedSuccess)
      expect(startup.failures > 0).toBe(!expectedSuccess)
    }
  })

  it('projects ConfigMap files and completes a readiness check due at the same simulated second', () => {
    const files = structuredClone(HEALTH_SOLUTION_FILES)
    const configMap = parseYaml(files['k8s/configmap.yaml'])
    configMap.data.PROBE_STATE = 'before'
    files['k8s/configmap.yaml'] = stringifyYaml(configMap)
    const deployment = parseYaml(files['k8s/deployment.yaml'])
    deployment.spec.template.spec.containers[0].readinessProbe.initialDelaySeconds = 35
    deployment.spec.template.spec.containers[0].volumeMounts = [{ name: 'probe-state', mountPath: '/etc/health', readOnly: true }]
    deployment.spec.template.spec.volumes = [{ name: 'probe-state', configMap: { name: 'assistant-config', items: [{ key: 'PROBE_STATE', path: 'state.txt' }] } }]
    files['k8s/deployment.yaml'] = stringifyYaml(deployment)
    let { lab, run, clusterId, podUids } = seedHealthTest({ files })
    const path = 'k8s/configmap.yaml'
    const updated = run.project.savedFiles[path].replace('PROBE_STATE: before', 'PROBE_STATE: after')
    run = act(run, lab, { type: 'save-file', path, text: updated }).run
    run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
    expect(clusterState(run, clusterId).projectionDue[podUids[0]]).toBe(60_000)
    const at60 = advanceHealth(run, lab, 60)
    expect(at60.runtime.simTimeMs).toBe(60_000)
    expect(clusterState(at60, clusterId).projectionDue[podUids[0]]).toBeUndefined()
    expect(clusterState(at60, clusterId).podSnapshots[podUids[0]].files['/etc/health/state.txt']).toBe('after')
    expect(healthContainer(at60, clusterId, podUids[0])).toMatchObject({ ready: true, checks: { readiness: { successes: 1, nextAtMs: 62_000 } } })
  })

  it('does not advance time for reads or no-op applies', () => {
    const { lab, run } = seedHealthTest()
    const read = act(run, lab, { type: 'command', line: 'kubectl get pods -n assistant' }).run
    const noOpApply = act(read, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    expect(run.runtime.simTimeMs).toBe(0)
    expect(read.runtime.simTimeMs).toBe(0)
    expect(noOpApply.runtime.simTimeMs).toBe(0)
  })

  it('keeps source and lookup objects isolated from caller mutation', () => {
    const files = structuredClone(HEALTH_SOLUTION_FILES)
    const { lab, run, clusterId, podUids } = seedHealthTest({ files })
    files['app.py'] = 'mutated caller source'
    expect(run.project.savedFiles['app.py']).toBe(HEALTH_SOLUTION_FILES['app.py'])
    const lookup = healthContainer(run, clusterId, podUids[0])
    lookup.checks.startup.failures = 999
    expect(healthContainer(run, clusterId, podUids[0]).checks.startup.failures).toBe(0)
    expect(advanceHealth(run, lab, 5).runtime.simTimeMs).toBe(5000)
    expect(run.runtime.simTimeMs).toBe(0)
  })

  it('preserves a pending timeout across JSON persistence and reload', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ startupSeconds: 0,
      probeOverrides: { livenessProbe: { periodSeconds: 1, timeoutSeconds: 3 } } })
    const warm = advanceHealth(run, lab, 1)
    clusterState(warm, clusterId).health.containers[podUids[0]].localFaults.hung = true
    const beforeProbe = advanceHealth(warm, lab, 1)
    const pending = healthContainer(beforeProbe, clusterId, podUids[0]).checks.liveness.pending
    expect(pending).toMatchObject({ startedAtMs: 2_000, completeAtMs: 5_000 })
    expect(healthContainer(beforeProbe, clusterId, podUids[0]).checks.liveness.nextAtMs).toBeNull()
    const reloaded = JSON.parse(JSON.stringify(beforeProbe))
    expect(validateBehavioralRun(reloaded, lab)).toBe(reloaded)
    const stillPending = advanceHealth(reloaded, lab, 2)
    expect(healthContainer(stillPending, clusterId, podUids[0]).checks.liveness).toMatchObject({ pending, nextAtMs: null, failures: 0 })
    const afterReload = advanceHealth(stillPending, lab, 1)
    expect(healthContainer(afterReload, clusterId, podUids[0]).checks.liveness).toMatchObject({ pending: null, failures: 1 })
  })

  it('resets consecutive readiness streaks after alternating failure and success', () => {
    const { lab, run, clusterId, podUids } = seedHealthTest({ startupSeconds: 0 })
    const firstPass = advanceHealth(run, lab, 1)
    clusterState(firstPass, clusterId).health.containers[podUids[0]].localFaults.admissionClosed = true
    const failed = advanceHealth(firstPass, lab, 1)
    expect(healthContainer(failed, clusterId, podUids[0])).toMatchObject({ ready: false, checks: { readiness: { failures: 1, successes: 0 } } })
    clusterState(failed, clusterId).health.containers[podUids[0]].localFaults.admissionClosed = false
    const recovered = advanceHealth(failed, lab, 2)
    expect(healthContainer(recovered, clusterId, podUids[0])).toMatchObject({ ready: true, checks: { readiness: { failures: 0, successes: 1 } } })
  })

  it('rejects an over-budget event batch atomically', () => {
    const { lab, run, clusterId } = seedHealthTest()
    const input = structuredClone(run)
    const projectionDue = clusterState(input, clusterId).projectionDue
    for (let index = 0; index < 10_001; index++) projectionDue[`pending-${index}`] = 1000
    const result = advanceKubernetesTimeResult(input, 1, lab)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'SIMULATION_LIMIT' }))
    expect(result.run).toBe(input)
    expect(result.run.runtime.simTimeMs).toBe(0)
  })

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
