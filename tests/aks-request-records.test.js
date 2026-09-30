import { describe, expect, it } from 'vitest'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { encodeRunExport } from '../src/lib/labEngine/export.js'
import { probeDependencies, observeProbeExperiment } from '../src/lib/kubernetes/probe-experiments.js'
import { seedDiagnosisTest, seedHealthTest, advanceHealth, startHealthFault, act } from './helpers/aks.js'

// A missing implementation is an assertion failure during the initial RED run.
const implementations = import.meta.glob('../src/lib/kubernetes/request-records.js', { eager: true })
const records = Object.values(implementations)[0] ?? {}
const inspect = (run, clusterId, requestId) => records.inspectRequestRecords?.(run, { clusterId, requestId }) ?? { request: null, application: [], dependency: [], truncated: {} }
const state = (run, clusterId) => run.runtime.kubernetes.clusters[clusterId]
function send(run, clusterId, profile = 'healthy') {
  const service = state(run, clusterId).resources['Service/assistant/assistant-public']
  return routeServiceRequest(run, { origin: { kind: 'external', clusterId }, hostname: service.status.loadBalancer.ingress[0].ip,
    port: 80, method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' }, integrationProfile: profile }, null)
}
const logs = (run, lab, podName, previous = false) => applyRunAction(run, { type: 'command',
  line: `kubectl logs ${podName} -n assistant${previous ? ' --previous' : ''}` }, lab)

describe('container-owned correlated request records', () => {
  it('allocates once with a deterministic shared-clock ID without modifying the input', () => {
    const { run, clusterId } = seedDiagnosisTest(), before = JSON.stringify(run), sequence = run.nextSequence
    const first = send(run, clusterId), second = send(first.run, clusterId)
    expect(first.outcome.requestId).toBe(`request-${sequence}`)
    expect(first.run.nextSequence).toBe(sequence + 1)
    expect(second.outcome.requestId).toBe(`request-${sequence + 1}`)
    expect(second.run.nextSequence).toBe(sequence + 2)
    expect(second.run.runtime.simTimeMs).toBe(15000)
    expect(JSON.stringify(run)).toBe(before)
    expect(records.allocateRequest).toBeTypeOf('function')
    const allocated = records.allocateRequest(run)
    expect(allocated.requestId).toBe(`request-${sequence}`)
    expect(allocated.run.nextSequence).toBe(sequence + 1)
  })

  it('retains a client trace without fabricated execution bindings on connection refusal', () => {
    const { run, lab, clusterId } = seedDiagnosisTest({ fault: 'target-port' }), sent = send(run, clusterId)
    expect(sent.outcome.transport.reason).toBe('CONNECTION_REFUSED')
    expect(sent.outcome).toMatchObject({ status: null, podUid: null, containerId: null, artifactId: null })
    const view = inspect(sent.run, clusterId, sent.outcome.requestId)
    expect(view.request).toMatchObject({ status: null, podUid: null, containerId: null, artifactId: null })
    expect(view.application).toEqual([])
    expect(view.dependency).toEqual([])
    expect(Object.values(state(sent.run, clusterId).health.containers).every(item => item.currentLogs.length === 0)).toBe(true)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(sent.run)), lab)).toBeTruthy()
    for (const change of [
      request => { request.origin.kind = 'forged' }, request => { request.origin.extra = true },
      request => { delete request.transport }, request => { request.route = null },
      request => { request.dependencyTruncated = 1 },
    ]) {
      const saved = structuredClone(sent.run); change(saved.runtime.kubernetes.requests[0])
      expect(() => validateBehavioralRun(saved, lab)).toThrow(/Kubernetes/)
    }
  })

  it.each([['healthy', 200], ['answer-unavailable-always', 503]])('correlates the actual %s handler result to the selected container', (profile, status) => {
    const { run, clusterId } = seedDiagnosisTest(), sent = send(run, clusterId, profile), outcome = sent.outcome
    expect(outcome.status).toBe(status)
    const view = inspect(sent.run, clusterId, outcome.requestId), pod = outcome.route.podUid
    expect(view.application).toHaveLength(2)
    expect(view.application.map(item => item.sourceFields)).toEqual([
      { event: 'request.started', request_id: outcome.requestId, status: null },
      { event: 'request.completed', request_id: outcome.requestId, status },
    ])
    expect(view.application[0]).toMatchObject({ requestId: outcome.requestId, clusterId, namespace: 'assistant', podUid: pod,
      containerId: state(sent.run, clusterId).health.containers[pod].containerId, artifactId: state(sent.run, clusterId).podSnapshots[pod].artifactId,
      simTimeMs: 15000, requestElapsedMs: 0, origin: { kind: 'external', clusterId }, sourceBindings: { request_id: 'request-id', status: 'literal' } })
    expect(view.application[1].sourceBindings.status).toBe('result-status')
    expect(view.application[1].requestElapsedMs).toBe(outcome.integrationTrace.elapsedMs)
    expect(new Set(view.application.map(item => item.id)).size).toBe(2)
    expect(view.dependency.map(item => item.operation)).toContain('answer')
    expect(view.dependency.every(item => item.requestId === outcome.requestId && item.podUid === pod && item.simTimeMs === 15000)).toBe(true)
    expect(state(sent.run, clusterId).connectivity.applicationLogs).toEqual([])
    expect(Object.entries(state(sent.run, clusterId).health.containers).filter(([uid]) => uid !== pod).every(([, item]) => item.currentLogs.length === 0)).toBe(true)
  })

  it('uses the same boundary for internal curl and external scenario verification', () => {
    const { run, lab, clusterId, target } = seedDiagnosisTest()
    const internal = act(run, lab, { type: 'command', line: `kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '{"question":"How long are backups kept?"}' http://assistant-internal.assistant/api/ask` })
    const id = internal.run.runtime.kubernetes.requests.at(-1).id
    expect(id).toBe(`request-${run.nextSequence}`)
    expect(inspect(internal.run, clusterId, id).application).toHaveLength(2)
    const scenario = { kind: 'aks-request', version: 1, target: { clusterId, namespace: target.namespace, deploymentName: target.deploymentName, serviceName: target.externalServiceName }, request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
      connectivity: { origin: { kind: 'external' }, service: { name: 'assistant-public', namespace: 'assistant' }, port: 80 },
      expected: { status: 200, body: send(run, clusterId).outcome.body } }
    const verified = applyRunAction(internal.run, { type: 'aks-request', scenarioId: 'diagnosis-request' }, { ...lab, scenarios: { 'diagnosis-request': scenario },
      tasks: [...lab.tasks, { id: 'diagnosis-proof', verification: { scenarioId: 'diagnosis-request', scenarioVersion: 1 }, dependencies: {}, check: () => false }] })
    expect(verified.diagnostics).toEqual([])
    expect(inspect(verified.run, clusterId, verified.run.runtime.kubernetes.requests.at(-1).id).application).toHaveLength(2)
  })

  it('rotates current records to previous through a real same-Pod liveness restart and deletes them with the Pod', () => {
    const { run, lab, clusterId } = seedDiagnosisTest(), sent = send(run, clusterId), podUid = sent.outcome.podUid
    expect(podUid).toBeTypeOf('string')
    const pod = Object.values(state(sent.run, clusterId).resources).find(item => item.metadata.uid === podUid)
    expect(logs(sent.run, lab, pod.metadata.name, true).lines.map(item => item.text).join(' ')).toContain('no previous terminated container logs')
    const restarted = advanceHealth(startHealthFault(sent.run, clusterId, podUid, 'hung'), lab, 90)
    expect(state(restarted, clusterId).health.containers[podUid].containerId).not.toBe(sent.outcome.containerId)
    expect(state(restarted, clusterId).health.containers[podUid].previous.logs).toEqual(state(sent.run, clusterId).health.containers[podUid].currentLogs)
    expect(logs(restarted, lab, pod.metadata.name, true).lines.map(item => item.text).join(' ')).toContain('request.completed')
    expect(logs(restarted, lab, pod.metadata.name).lines.map(item => item.text).join(' ')).not.toContain(sent.outcome.requestId)
    const before = JSON.stringify(restarted)
    inspect(restarted, clusterId, sent.outcome.requestId); logs(restarted, lab, pod.metadata.name)
    expect(JSON.stringify(restarted)).toBe(before)
    const deleted = act(restarted, lab, { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n assistant` }).run
    expect(state(deleted, clusterId).health.containers[podUid]).toBeUndefined()
    expect(inspect(deleted, clusterId, sent.outcome.requestId).application).toEqual([])
    expect(logs(deleted, lab, pod.metadata.name).lines.map(item => item.text).join(' ')).toContain('was not found')
  })

  it('bounds retained requests and per-container logs and surfaces dropped record counts', () => {
    let { run, clusterId } = seedDiagnosisTest(), last
    for (let index = 0; index < 105; index++) { last = send(run, clusterId); run = last.run }
    expect(run.runtime.kubernetes.requests).toHaveLength(100)
    expect(last.outcome.podUid).toBeTypeOf('string')
    expect(state(run, clusterId).health.containers[last.outcome.podUid].currentLogs).toHaveLength(100)
    expect(inspect(run, clusterId, last.outcome.requestId).truncated).toMatchObject({ requests: 5, application: 110, dependency: 0 })
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), seedDiagnosisTest().lab)).toBeTruthy()
  })

  it('bounds the isolated dependency recorder without persisting impossible simulator traces', () => {
    const { run, lab, clusterId } = seedDiagnosisTest(), sent = send(run, clusterId)
    expect(records.boundDependencyRecords).toBeTypeOf('function')
    const first = inspect(sent.run, clusterId, sent.outcome.requestId).dependency[0]
    const attempts = Array.from({ length: 35 }, (_, index) => ({ operation: 'answer', attemptNumber: 1,
      startMs: index, durationMs: 1, timeoutMs: 100, errorCode: null, delayBeforeNextMs: 0, authorization: 'Bearer should-not-persist' }))
    const { id, requestElapsedMs, operation, attemptNumber, durationMs, timeoutMs, errorCode, delayBeforeNextMs, ...envelope } = first
    const bounded = records.boundDependencyRecords(attempts, envelope, sent.run.runtime.kubernetes.requests[0].sequence)
    expect(bounded.records).toHaveLength(30)
    expect(bounded.truncated).toBe(5)
    expect(JSON.stringify(bounded)).not.toContain('should-not-persist')
    expect(JSON.parse(JSON.stringify(bounded))).toEqual(bounded)
    expect(attempts).toHaveLength(35)
    // Real profiles produce at most nine attempts; the thirty-record defense
    // is tested in isolation, never saved as an impossible integration trace.
    expect(sent.outcome.integrationTrace.attempts.length).toBeLessThanOrEqual(9)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(sent.run)), lab)).toBeTruthy()
    const impossible = structuredClone(sent.run)
    impossible.runtime.kubernetes.requests[0].integrationTrace.attempts = Array.from({ length: 10 }, () => ({ ...sent.outcome.integrationTrace.attempts[0] }))
    expect(() => validateBehavioralRun(impossible, lab)).toThrow(/Kubernetes/)
  })

  it('rejects permitted but unauthored application source fields after round-trip', () => {
    const { run, lab, clusterId } = seedDiagnosisTest(), sent = send(run, clusterId)
    const saved = JSON.parse(JSON.stringify(sent.run))
    expect(validateBehavioralRun(saved, lab)).toBe(saved)
    state(saved, clusterId).health.containers[sent.outcome.podUid].currentLogs[0].sourceFields.endpoint = 'https://forged.example.test'
    expect(() => validateBehavioralRun(saved, lab)).toThrow(/Kubernetes/)
  })

  it('authenticates result-status in retained logs after real request-history eviction and reload', () => {
    const { run, lab, clusterId } = seedDiagnosisTest(), sent = send(run, clusterId)
    let aged = sent.run
    for (let index = 0; index < 100; index++) aged = routeServiceRequest(aged,
      { origin: { kind: 'external', clusterId }, hostname: 'unknown.example.test', port: 80,
        method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, null).run
    const saved = JSON.parse(JSON.stringify(aged))
    expect(validateBehavioralRun(saved, lab)).toBe(saved)
    const view = inspect(saved, clusterId, sent.outcome.requestId)
    expect(view.request).toBeNull()
    expect(view.application).toHaveLength(2)
    expect(view.application.map(item => item.resultStatus)).toEqual([200, 200])
    expect(view.application[1].sourceFields.status).toBe(200)
    const pod = Object.values(state(saved, clusterId).resources).find(item => item.metadata.uid === sent.outcome.podUid)
    expect(logs(saved, lab, pod.metadata.name).lines.map(item => item.text).join(' ')).toContain('"status":200')
    state(saved, clusterId).health.containers[sent.outcome.podUid].currentLogs[1].sourceFields.status = 599
    expect(() => validateBehavioralRun(saved, lab)).toThrow(/Kubernetes/)
  })

  it('strictly validates new state after JSON reload while isolating inspection callers', () => {
    const { run, lab, clusterId } = seedDiagnosisTest(), sent = send(run, clusterId), saved = JSON.parse(JSON.stringify(sent.run))
    expect(validateBehavioralRun(saved, lab)).toBe(saved)
    const view = inspect(saved, clusterId, sent.outcome.requestId)
    expect(view.application).toHaveLength(2)
    view.application[0].sourceFields.event = 'caller mutation'; view.request.route.podUid = 'forged'
    expect(inspect(saved, clusterId, sent.outcome.requestId).application[0].sourceFields.event).toBe('request.started')
    for (const mutate of [
      item => { item.containerId = 'container-forged' }, item => { item.artifactId = null },
      item => { item.simTimeMs = -1 }, item => { item.requestElapsedMs = Infinity },
      item => { item.requestId = null }, item => { item.origin = { kind: 'external', clusterId: 'forged' } },
      item => { item.sourceFields.authorization = 'Bearer secret' }, item => { item.id = 'invalid' },
    ]) {
      const corrupt = structuredClone(saved)
      mutate(state(corrupt, clusterId).health.containers[sent.outcome.podUid].currentLogs[0])
      expect(() => validateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes|finite JSON/)
    }
    const corrupt = structuredClone(saved); corrupt.runtime.kubernetes.requests[0].containerId = 'forged'
    expect(() => validateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
    expect(inspect(saved, 'other-cluster', sent.outcome.requestId)).toMatchObject({ request: null, application: [], dependency: [] })
  })

  it('rejects forged stream ownership, record ordering, nullable fields and truncation counters', () => {
    const { run, lab, clusterId } = seedDiagnosisTest(), sent = send(run, clusterId)
    for (const mutate of [
      saved => { saved.runtime.kubernetes.requestsTruncated = null },
      saved => { saved.runtime.kubernetes.requestsTruncated = -1 },
      saved => { saved.runtime.kubernetes.requests[0].containerId = null },
      saved => { saved.runtime.kubernetes.requests[0].dependencyRecords[0].requestId = 'request-999' },
      saved => { saved.runtime.kubernetes.requests[0].dependencyRecords[0].requestElapsedMs = -1 },
      saved => { const logs = state(saved, clusterId).health.containers[sent.outcome.podUid].currentLogs; logs.reverse() },
      saved => { state(saved, clusterId).health.containers[sent.outcome.podUid].logsTruncated = 0.5 },
      saved => { state(saved, clusterId).health.containers[sent.outcome.podUid].currentLogs[0].artifactId = 'build-forged' },
      saved => { state(saved, clusterId).health.containers[sent.outcome.podUid].currentLogs[0].sourceBindings.request_id = 'literal' },
      saved => { state(saved, clusterId).health.containers[sent.outcome.podUid].currentLogs[0].sourceFields.status = { nested: true } },
      saved => { state(saved, clusterId).health.containers[sent.outcome.podUid].currentLogs[0].sourceFields.event = 'forged-literal' },
      saved => { state(saved, clusterId).health.containers[sent.outcome.podUid].currentLogs[1].sourceFields.status = 201 },
      saved => { const request = saved.runtime.kubernetes.requests[0]; const other = Object.values(state(saved, clusterId).health.containers).find(container => container.containerId !== request.containerId); request.containerId = other.containerId; request.route.containerId = other.containerId },
    ]) {
      const saved = structuredClone(sent.run); mutate(saved)
      expect(() => validateBehavioralRun(saved, lab)).toThrow(/Kubernetes/)
    }
  })

  it('retains literal binding provenance even when a constant matches the actual HTTP status', () => {
    const { run: initial, lab, clusterId } = seedDiagnosisTest()
    let run = act(initial, lab, { type: 'save-file', path: 'app.py', text: initial.project.savedFiles['app.py']
      .replace('current_request_id()', '"learner-literal"').replace('response["status"]', '200') }).run
    run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
    run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
    run = advanceHealth(run, lab, 75)
    const sent = send(run, clusterId), view = inspect(sent.run, clusterId, sent.outcome.requestId)
    expect(view.application.map(item => item.sourceFields.request_id)).toEqual(['learner-literal', 'learner-literal'])
    expect(view.application[1].sourceBindings).toMatchObject({ request_id: 'literal', status: 'literal' })
    expect(view.application[1].sourceFields.status).toBe(sent.outcome.status)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(sent.run)), lab)).toBeTruthy()
  })

  it('rejects reassignment of current execution to an existing newer artifact which its container never captured', () => {
    const { run: initial, lab, clusterId } = seedDiagnosisTest(), sent = send(initial, clusterId)
    let run = act(sent.run, lab, { type: 'save-file', path: 'app.py', text: initial.project.savedFiles['app.py'].replace('SERVICE_VERSION = "2.0"', 'SERVICE_VERSION = "3.0"') }).run
    run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
    const artifactId = run.artifacts.publishedTags['acraksreleasesguided.azurecr.io/assistant:release-v2']
    expect(artifactId).not.toBe(sent.outcome.artifactId)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
    const corrupt = structuredClone(run), request = corrupt.runtime.kubernetes.requests[0]
    request.artifactId = artifactId; request.route.artifactId = artifactId
    for (const dependency of request.dependencyRecords) dependency.artifactId = artifactId
    for (const log of state(corrupt, clusterId).health.containers[request.podUid].currentLogs) log.artifactId = artifactId
    expect(() => validateBehavioralRun(corrupt, lab)).toThrow(/Kubernetes/)
  })

  it('records scenario-probe samples through the same boundary without treating startup as request evidence', () => {
    const { run, lab, clusterId, target } = seedDiagnosisTest()
    const id = 'diagnosis-probe', scenario = { kind: 'aks-probe', version: 1,
      target: { clusterId, namespace: target.namespace, deploymentName: target.deploymentName, serviceName: target.serviceName }, durationSeconds: 30,
      script: { initializationSeconds: 6, finishAfterStartSeconds: 1, sampleAtSeconds: [0, 1] } }
    const probeLab = { ...lab, scenarios: { [id]: scenario } }
    // Seed only the observer's active scenario on the real ready containers.
    // Starting probe experiments during rolling replacement is outside this
    // request-record task; lifecycle/restart behavior is exercised separately.
    const seeded = structuredClone(run), containers = state(seeded, clusterId).health.containers
    const podUids = Object.keys(containers).sort()
    state(seeded, clusterId).health.experiment = { version: 1, scenarioId: id, scenarioVersion: 1, clusterId,
      target: scenario.target, deploymentUid: target.deploymentUid,
      fingerprint: Object.values(probeDependencies(scenario.target))[0](seeded), podUids,
      containerIds: Object.fromEntries(podUids.map(uid => [uid, containers[uid].containerId])), initializationSeconds: 6,
      baselineReadyAtMs: null, startedAtMs: 15000, endsAtMs: 45000, status: 'active', phase: 'warming', samples: [],
      summary: { readinessIntervals: [], restartReceipts: [], sampleCount: 0 }, script: { ...scenario.script, kind: id } }
    const sampled = observeProbeExperiment(seeded, 15000, probeLab)
    const observed = advanceHealth(sampled, probeLab, 1)
    const requests = observed.runtime.kubernetes.requests.filter(item => item.diagnosticsVersion === 1)
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every(item => item.id === `request-${item.sequence}`)).toBe(true)
    expect(requests.some(item => inspect(observed, clusterId, item.id).application.length === 2)).toBe(true)
    expect(inspect(observed, clusterId, null).application).toEqual([])
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(observed)), probeLab)).toBeTruthy()
  })

  it('does not allocate for unsupported syntax including invalid question shape', () => {
    const { run, lab } = seedDiagnosisTest()
    for (const line of ["kubectl exec diagnostics -n diagnostics -- curl -v http://assistant-internal.assistant/api/ask",
      "kubectl exec diagnostics -n diagnostics -- curl -X POST -H 'Content-Type: application/json' -d '{\"question\":\"How long are backups kept?\",\"extra\":true}' http://assistant-internal.assistant/api/ask"]) {
      const result = applyRunAction(run, { type: 'command', line }, lab)
      expect(result.diagnostics.length > 0 || result.lines.some(item => item.kind === 'err')).toBe(true)
      expect(result.run.nextSequence).toBe(run.nextSequence)
      expect(result.run.runtime.kubernetes.requests).toEqual([])
    }
  })

  it('redacts Secret substrings in fields and provenance before persistence and every read', () => {
    const { run, lab, clusterId } = seedDiagnosisTest(), sent = send(run, clusterId)
    expect(records.recordRequestOutcome).toBeTypeOf('function')
    // Use a credential deliberately overlapping the actual authored literal,
    // so literal-descriptor validation must compare its redacted projection.
    const secret = 'started', snapshot = state(run, clusterId).podSnapshots[sent.outcome.podUid]
    snapshot.environment.PGPASSWORD = secret
    snapshot.configRefs.push({ kind: 'Secret', mode: 'env', target: 'PGPASSWORD', namespace: 'assistant', name: 'assistant-db', key: 'PGPASSWORD' })
    const outcome = { ...sent.outcome, body: { error: `prefix-${secret}-suffix` },
      integrationTrace: { ...sent.outcome.integrationTrace, attempts: sent.outcome.integrationTrace.attempts.map(item => ({ ...item, errorCode: `ERROR_${secret}` })) },
      appLogRecords: [{ event: 'request.started', request_id: sent.outcome.requestId, status: null,
      endpoint: 'postgresql://user:password@example.test/db', authorization: 'Bearer credential', connection_string: 'Host=db;Password=credential', stack: 'Traceback credential' }] }
    const stored = records.recordRequestOutcome(records.allocateRequest(run).run, { origin: { kind: 'external', clusterId }, hostname: `host-${secret}`,
      port: 80, method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, outcome)
    const persisted = JSON.stringify({ requests: stored.runtime.kubernetes.requests, logs: state(stored, clusterId).health.containers[sent.outcome.podUid].currentLogs })
    expect(persisted).not.toContain(secret)
    expect(persisted).not.toContain('credential')
    expect(persisted).not.toContain('user:password')
    const view = inspect(stored, clusterId, outcome.requestId)
    expect(JSON.stringify(view)).not.toContain(secret)
    expect(view.application[0].sourceFields.event).toContain('[REDACTED]')
    expect(view.dependency).toHaveLength(3)
    expect(view.dependency.every(item => item.errorCode === 'ERROR_[REDACTED]')).toBe(true)
    // The export-facing evidence slice and the entire run must not introduce
    // any new raw occurrence beyond its authoritative configuration snapshot.
    expect(JSON.stringify(stored).split(secret).length).toBe(JSON.stringify(run).split(secret).length)
    const pod = Object.values(state(stored, clusterId).resources).find(item => item.metadata.uid === sent.outcome.podUid)
    expect(JSON.stringify(logs(stored, lab, pod.metadata.name).lines)).not.toContain(secret)
  })

  it('preserves diagnostics-disabled request IDs and one compatibility log append', () => {
    const fixture = seedHealthTest({ startupSeconds: 6 }), run = advanceHealth(fixture.run, fixture.lab, 15)
    const sent = send(run, fixture.clusterId)
    expect(sent.outcome.requestId).toBe(`aks-request-${run.nextSequence}`)
    expect(state(sent.run, fixture.clusterId).connectivity.applicationLogs).toHaveLength(1)
    expect(state(sent.run, fixture.clusterId).health.containers[sent.outcome.route.podUid].currentLogs).toHaveLength(1)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(sent.run)), fixture.lab)).toBeTruthy()
  })

  it('scrubs real Secret-derived handler data before Verify evidence and run export while keeping configuration functional', () => {
    const { run: initial, lab, clusterId, target } = seedDiagnosisTest()
    const podUid = Object.keys(state(initial, clusterId).health.containers)[0]
    const secret = state(initial, clusterId).podSnapshots[podUid].environment.PGPASSWORD
    expect(secret).toBeTypeOf('string')
    let run = act(initial, lab, { type: 'save-file', path: 'app.py', text: initial.project.savedFiles['app.py']
      .replace('SERVICE_VERSION = "2.0"', `SERVICE_VERSION = "${secret}"`)
      .replace('log_event("request.started")', `log_event("event-${secret}")`) }).run
    run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
    run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
    run = advanceHealth(run, lab, 75)
    const rawConfigurationCount = encodeRunExport({ run }).split(secret).length
    const scenarioId = 'secret-proof', scenario = { kind: 'aks-request', version: 1,
      target: { clusterId, namespace: target.namespace, deploymentName: target.deploymentName, serviceName: target.externalServiceName },
      request: { method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } },
      connectivity: { origin: { kind: 'external' }, service: { name: 'assistant-public', namespace: 'assistant' }, port: 80 },
      expected: { status: 200, body: { answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], environment: 'training', release: '[REDACTED]' } } }
    const proofLab = { ...lab, scenarios: { [scenarioId]: scenario }, tasks: [...lab.tasks,
      { id: 'secret-proof-task', dependencies: {}, verification: { scenarioId, scenarioVersion: 1 }, check: () => false }] }
    const verified = act(run, proofLab, { type: 'aks-request', scenarioId })
    const request = verified.run.runtime.kubernetes.requests.at(-1), view = inspect(verified.run, clusterId, request.id)
    expect(request.status).toBe(200)
    expect(view.application).toHaveLength(2)
    expect(view.application[0].sourceFields.event).toBe('event-[REDACTED]')
    expect(view.dependency).toHaveLength(3)
    const evidence = Object.values(verified.run.evidence.experimentsById)
    expect(evidence).toHaveLength(1)
    expect(evidence[0].outcome).toBe('passed')
    expect(evidence[0].measurements.body.release).toBe('[REDACTED]')
    expect(encodeRunExport({ view, evidence, lines: verified.lines })).not.toContain(secret)
    expect(encodeRunExport({ run: verified.run }).split(secret).length).toBe(rawConfigurationCount)
    const pod = Object.values(state(verified.run, clusterId).resources).find(item => item.metadata.uid === request.podUid)
    expect(encodeRunExport({ lines: logs(verified.run, proofLab, pod.metadata.name).lines })).not.toContain(secret)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(verified.run)), proofLab)).toBeTruthy()
  })
})
