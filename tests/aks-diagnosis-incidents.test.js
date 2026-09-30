import { describe, expect, it } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { applyAksAction } from '../src/lib/kubernetes/actions.js'
import { act, seedDiagnosisIncidentTest, advanceHealth } from './helpers/aks.js'

const api = await import('../src/lib/kubernetes/diagnosis-incidents.js').catch(() => ({}))
const state = (run, clusterId) => run.runtime.kubernetes.clusters[clusterId].diagnosis
const start = (run, lab) => applyRunAction(run, { type: 'aks-diagnosis-start', scenarioId: 'incident' }, lab)
const next = (run, lab) => applyRunAction(run, { type: 'aks-diagnosis-next', scenarioId: 'incident' }, lab)
const verify = (run, lab, scenarioId) => applyRunAction(run, { type: 'aks-request', scenarioId }, lab)
function repair(run, lab) {
  for (const phase of lab.scenarios.incident.phases) for (const edit of phase.edits) {
    run = act(run, lab, { type: 'save-file', path: edit.path, text: edit.before }).run
    run = act(run, lab, { type: 'command', line: `kubectl apply -f ${edit.path}` }).run
  }
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  return advanceHealth(run, lab, 90)
}
const reload = (run, lab) => validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)

describe('retained AKS diagnosis incidents', () => {
  it('commits only declared edits through normal actions and retains actual failed output', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest(), before = structuredClone(run)
    const begun = start(run, lab)
    expect(begun.diagnostics).toEqual([])
    expect(run).toEqual(before)
    expect(begun.run.runtime.simTimeMs).toBe(run.runtime.simTimeMs)
    expect(begun.lines.map(item => item.text).join('\n')).toContain('k8s/service-internal.yaml')
    for (const path of Object.keys(run.project.savedFiles)) expect(begun.run.project.savedFiles[path]).toBe(path === 'k8s/service-internal.yaml' ? lab.scenarios.incident.phases[0].edits[0].after : run.project.savedFiles[path])
    const failed = verify(begun.run, lab, 'observe-port')
    expect(failed.lines[0].measurements.transport.reason).toBe('CONNECTION_REFUSED')
    expect(state(failed.run, clusterId).incident.observations).toHaveLength(1)
    expect(reload(failed.run, lab)).toBeTruthy()
  })

  it('atomically rejects draft mismatch, stale baseline, wrong fixture precondition and active experiments', () => {
    for (const mutate of [
      run => { run.project.draftFiles['app.py'] += '\n' },
      run => { run.project.savedFiles['k8s/service-internal.yaml'] = run.project.draftFiles['k8s/service-internal.yaml'] = run.project.savedFiles['k8s/service-internal.yaml'].replace('targetPort: http', 'targetPort: 8082') },
      run => { const state = run.runtime.kubernetes.clusters[run.sandbox.aksClusters[0].id]; state.projectionDue[Object.keys(state.podSnapshots)[0]] = run.runtime.simTimeMs + 1000 },
    ]) {
      const { run, lab } = seedDiagnosisIncidentTest(); mutate(run)
      const before = JSON.stringify(run), result = start(run, lab)
      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(JSON.stringify(result.run)).toBe(before)
    }
    const { run, lab } = seedDiagnosisIncidentTest()
    const busy = { ...run, runtime: { ...run.runtime, activeScenario: { id: 'other' } } }
    expect(api.startDiagnosisIncident).toBeTypeOf('function')
    expect(api.startDiagnosisIncident(busy, 'incident', lab).run).toBe(busy)
  })

  it('rejects invalid fixture commands atomically, including partial valid application', () => {
    const { run, lab } = seedDiagnosisIncidentTest()
    const broken = structuredClone(lab.scenarios.incident)
    broken.phases[0].commands.push('kubectl apply -f k8s/not-declared.yaml')
    const result = start(run, { ...lab, scenarios: { ...lab.scenarios, incident: broken } })
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run).toEqual(run)
  })

  it('rolls back an earlier staged apply when a later declared saved manifest fails command validation', () => {
    const { run, lab } = seedDiagnosisIncidentTest({ multiCause: true })
    const fixture = structuredClone(lab.scenarios.incident)
    fixture.phases[0].edits[1].after = fixture.phases[0].edits[1].after.replace('kind: ConfigMap', 'kind: Unsupported')
    const before = JSON.stringify(run), result = start(run, { ...lab, scenarios: { ...lab.scenarios, incident: fixture } })
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(JSON.stringify(result.run)).toBe(before)
    expect(JSON.stringify(run)).toBe(before)
  })

  it('rejects incomplete request declarations before changing a fixture', () => {
    const { run, lab } = seedDiagnosisIncidentTest()
    const invalid = { ...lab, scenarios: { ...lab.scenarios, 'observe-port': { ...lab.scenarios['observe-port'], request: { method: 'DELETE', path: '/unknown' } } } }
    const result = start(run, invalid)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.run).toEqual(run)
  })

  it('requires genuine failed observation then current healthy Verify before advancing and reloads every phase', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    let live = start(run, lab).run
    expect(next(live, lab).diagnostics.length).toBeGreaterThan(0)
    live = verify(live, lab, 'observe-port').run
    expect(next(live, lab).diagnostics.length).toBeGreaterThan(0)
    const observed = structuredClone(state(live, clusterId).incident.observations)
    live = repair(live, lab)
    expect(next(live, lab).diagnostics.length).toBeGreaterThan(0)
    live = verify(live, lab, 'recover').run
    live = reload(live, lab)
    const second = next(live, lab)
    expect(second.diagnostics).toEqual([])
    live = advanceHealth(second.run, lab, 90)
    expect(state(live, clusterId).incident.phaseId).toBe('dependency')
    expect(state(live, clusterId).incident.observations).toEqual(observed)
    live = verify(reload(live, lab), lab, 'observe-dependency').run
    expect(state(live, clusterId).incident.observations).toHaveLength(2)
    live = verify(repair(live, lab), lab, 'recover').run
    const done = next(reload(live, lab), lab)
    expect(done.diagnostics).toEqual([])
    expect(state(done.run, clusterId).incident.active).toBe(false)
    expect(state(done.run, clusterId).receipts.length).toBeGreaterThan(0)
    expect(reload(done.run, lab)).toBeTruthy()
  })

  it('retains immutable redacted records across repair, request pruning and target deletion', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    let live = verify(start(run, lab).run, lab, 'observe-port').run
    const observation = structuredClone(state(live, clusterId).incident.observations[0])
    live = repair(live, lab)
    for (let index = 0; index < 105; index++) live = routeServiceRequest(live, { origin: { kind: 'external', clusterId }, hostname: 'unknown.example.test', port: 80, method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, null).run
    live = act(live, lab, { type: 'command', line: 'kubectl delete service assistant-internal -n assistant' }).run
    expect(state(live, clusterId).incident.observations[0]).toEqual(observation)
    const before = JSON.stringify(live), replay = api.replayDiagnosisObservation(live, observation.id, lab)
    expect(replay.diagnostics).toEqual([])
    expect(replay.snapshot.historical).toBe(true)
    expect(replay.snapshot.records.request.transport.reason).toBe('CONNECTION_REFUSED')
    expect(JSON.stringify(replay)).not.toContain('training-only-password')
    replay.snapshot.records.request.status = 200
    expect(JSON.stringify(live)).toBe(before)
    expect(next(live, lab).diagnostics.length).toBeGreaterThan(0)
    expect(reload(live, lab)).toBeTruthy()
  })

  it('rejects replay from another Lab, attempt, epoch or stable target', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    const live = verify(start(run, lab).run, lab, 'observe-port').run, observation = state(live, clusterId).incident.observations[0]
    for (const alter of [
      value => { value.attemptId = 'reset-attempt' }, value => { value.labId = 'other-lab' },
      value => { state(value, clusterId).incident.epoch++ }, value => { state(value, clusterId).incident.target.serviceUid = 'different-service' },
    ]) {
      const wrong = structuredClone(live); alter(wrong)
      expect(api.replayDiagnosisObservation(wrong, observation.id, lab).snapshot).toBeNull()
      expect(() => reload(wrong, lab)).toThrow()
    }
  })

  it('bounds snapshots and receipts independently of ordinary logs and rejects caller fabricated outcomes', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    let live = start(run, lab).run
    for (let index = 0; index < 55; index++) live = verify(live, lab, 'observe-port').run
    expect(state(live, clusterId).incident.observations).toHaveLength(10)
    expect(state(live, clusterId).receipts).toHaveLength(40)
    const before = JSON.stringify(live)
    expect(api.captureDiagnosisObservation(live, 'observe-port', { requestId: 'request-9999', status: 200, body: { forged: true } }, lab)).toEqual(live)
    expect(JSON.stringify(live)).toBe(before)
    expect(reload(live, lab)).toBeTruthy()
  })

  it('strictly validates optional diagnosis state while accepting older saves without it', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    expect(reload(run, lab)).toBeTruthy()
    const live = verify(start(run, lab).run, lab, 'observe-port').run
    for (const alter of [
      value => { value.version = 2 }, value => { value.receipts = Array(41).fill(value.receipts[0]) },
      value => { value.incident.epoch = -1 }, value => { value.incident.startedAtMs = Infinity },
      value => { value.incident.extra = true }, value => { value.incident.observations[0].records.request.status = 200 },
      value => { value.incident.observations[0].records.request.body = { password: 'credential' } },
      value => { value.incident.baselineHashes = {} }, value => { value.incident.observations.push(value.incident.observations[0]) },
    ]) {
      const invalid = structuredClone(live); alter(state(invalid, clusterId))
      expect(() => reload(invalid, lab)).toThrow(/Kubernetes|finite JSON/)
    }
    expect(() => reload(live, { ...lab, capabilities: { ...lab.capabilities, kubernetesDiagnostics: false } })).toThrow(/Kubernetes/)
  })

  it('validates historical records independently of their checksum and rejects added saved fields', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    const live = verify(start(run, lab).run, lab, 'observe-port').run
    for (const alter of [
      snapshot => { snapshot.records.request.podUid = 'kube-999' },
      snapshot => { snapshot.records.request.status = 200 },
      snapshot => { snapshot.records.request.extra = 'untrusted' },
      snapshot => { snapshot.capsule.authProfile = 'untrusted' },
      snapshot => { snapshot.capsule.environment.authorization = 'Bearer credential' },
    ]) {
      const corrupt = structuredClone(live), snapshot = state(corrupt, clusterId).incident.observations[0]
      alter(snapshot)
      const { hash, ...payload } = snapshot; snapshot.hash = api.diagnosisDigest(payload)
      expect(() => reload(corrupt, lab)).toThrow(/Kubernetes/)
    }
  })

  it('captures only a matching actual outcome and makes a repeated capture idempotent', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    const started = start(run, lab).run, observed = applyAksAction(started, { type: 'aks-request', scenarioId: 'observe-port' }, lab).run
    const actual = observed.runtime.kubernetes.requests.at(-1)
    const uncaptured = structuredClone(observed)
    state(uncaptured, clusterId).incident.observations = []
    state(uncaptured, clusterId).receipts = state(uncaptured, clusterId).receipts.filter(item => item.kind === 'started')
    const captured = api.captureDiagnosisObservation(uncaptured, 'observe-port', { requestId: actual.id, status: actual.status, body: actual.body, transport: actual.transport, route: actual.route }, lab)
    expect(state(captured, clusterId).incident.observations).toHaveLength(1)
    expect(api.captureDiagnosisObservation(captured, 'observe-port', { requestId: actual.id }, lab)).toEqual(captured)
    expect(api.captureDiagnosisObservation(uncaptured, 'observe-port', { requestId: actual.id, status: 200 }, lab)).toEqual(uncaptured)
  })

  it('commits a valid applied fixture even when its resulting containers become unhealthy', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    const path = 'k8s/deployment.yaml', before = run.project.savedFiles[path]
    const fixture = { ...lab.scenarios.incident, phases: [{ id: 'readiness', edits: [{ path, before, after: before.replace('/health/ready', '/health/missing') }],
      commands: [`kubectl apply -f ${path}`], observationScenarioId: 'observe-port', recoveryScenarioId: 'recover' }] }
    const scoped = { ...lab, scenarios: { ...lab.scenarios, incident: fixture } }
    const result = start(run, scoped)
    expect(result.diagnostics).toEqual([])
    const advanced = advanceHealth(result.run, scoped, 90)
    expect(advanced.project.savedFiles[path]).toContain('/health/missing')
    expect(state(advanced, clusterId).incident.active).toBe(true)
    expect(Object.values(advanced.runtime.kubernetes.clusters[clusterId].health.containers).some(container => !container.ready)).toBe(true)
    expect(reload(advanced, scoped)).toBeTruthy()
  })

  it('redacts actual Secret-derived application log literals before incident persistence and historical export', () => {
    const { run: initial, lab, clusterId } = seedDiagnosisIncidentTest()
    const source = initial.project.savedFiles['app.py'].replace('log_event("request.started")', 'log_event("training-only-password")')
    let run = act(initial, lab, { type: 'save-file', path: 'app.py', text: source }).run
    run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
    run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
    run = advanceHealth(run, lab, 90)
    const fixture = { ...lab.scenarios.incident, phases: [lab.scenarios.incident.phases[1]] }
    const scoped = { ...lab, scenarios: { ...lab.scenarios, incident: fixture } }
    run = advanceHealth(start(run, scoped).run, scoped, 90)
    const observed = verify(run, scoped, 'observe-dependency').run, diagnosis = state(observed, clusterId)
    expect(diagnosis.incident.observations).toHaveLength(1)
    expect(diagnosis.incident.observations[0].records.application[0].sourceFields.event).toBe('[REDACTED]')
    expect(JSON.stringify(diagnosis)).not.toContain('training-only-password')
    expect(JSON.stringify(api.replayDiagnosisObservation(observed, diagnosis.incident.observations[0].id, scoped))).not.toContain('training-only-password')
    expect(reload(observed, scoped)).toBeTruthy()
  })

  it('redacts newly declared Secret edits in action output before export', () => {
    const { run, lab } = seedDiagnosisIncidentTest()
    const path = 'k8s/secret.yaml', before = run.project.savedFiles[path], after = before.replace('training-only-password', 'new-fixture-credential')
    const fixture = { ...lab.scenarios.incident, phases: [{ id: 'secret', edits: [{ path, before, after }], commands: [`kubectl apply -f ${path}`], observationScenarioId: 'observe-dependency', recoveryScenarioId: 'recover' }] }
    const result = start(run, { ...lab, scenarios: { ...lab.scenarios, incident: fixture } })
    expect(result.diagnostics).toEqual([])
    expect(result.run.project.savedFiles[path]).toContain('new-fixture-credential')
    expect(JSON.stringify(result.lines)).not.toContain('new-fixture-credential')
    expect(JSON.stringify(result.lines)).not.toContain('training-only-password')
  })

  it('seeds both causes together and probes only the isolated historical Service port without live mutation or evidence', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest({ multiCause: true })
    let live = advanceHealth(start(run, lab).run, lab, 90)
    expect(live.project.savedFiles['k8s/configmap.yaml']).toContain('pg-missing.example')
    live = verify(live, lab, 'observe-port').run
    const observation = state(live, clusterId).incident.observations[0], before = JSON.stringify(live)
    const result = api.probeIncidentSnapshot(live, observation.id, lab)
    expect(result.diagnostics).toEqual([])
    expect(result.snapshot.historical).toBe(true)
    expect(result.snapshot.status).toBe(503)
    expect(result.snapshot.body.code).toBe('POSTGRES_CONNECTION')
    expect(result.snapshot.requestId).toMatch(/^snapshot-/)
    expect(result.snapshot.backendPort).toBe(8080)
    expect(JSON.stringify(live)).toBe(before)
    expect(next(live, lab).diagnostics.length).toBeGreaterThan(0)
    expect(api.probeIncidentSnapshot(live, { observationId: observation.id, port: 80 }, lab).snapshot).toBeNull()
    expect(api.probeIncidentSnapshot(live, observation.id, { ...lab, id: 'another-lab' }).snapshot).toBeNull()
    const repaired = repair(live, lab), old = api.probeIncidentSnapshot(repaired, observation.id, lab)
    expect(old.snapshot.body.code).toBe('POSTGRES_CONNECTION')
    expect(reload(repaired, lab)).toBeTruthy()
  })

  it('gates controls and historical replay actions reject caller mutations without allocating evidence', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    for (const action of [{ type: 'aks-diagnosis-start', scenarioId: 'incident', edits: [] }, { type: 'aks-diagnosis-next', scenarioId: 'incident', expected: 200 }]) {
      expect(applyRunAction(run, action, lab).run).toEqual(run)
    }
    expect(start(run, { ...lab, capabilities: { ...lab.capabilities, kubernetesDiagnostics: false } }).diagnostics.length).toBeGreaterThan(0)
    const live = verify(start(run, lab).run, lab, 'observe-port').run
    const result = applyRunAction(live, { type: 'aks-diagnosis-replay', observationId: state(live, clusterId).incident.observations[0].id }, lab)
    expect(result.diagnostics).toEqual([])
    expect(result.run).toEqual(live)
    expect(result.snapshot.historical).toBe(true)
  })

  it('retains required early phases while keeping latest live recovery usable after snapshot rotation', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    let live = verify(start(run, lab).run, lab, 'observe-port').run
    const first = state(live, clusterId).incident.observations[0].id
    live = repair(live, lab)
    for (let index = 0; index < 12; index++) live = verify(live, lab, 'recover').run
    expect(state(live, clusterId).incident.recoveries).toHaveLength(10)
    expect(state(live, clusterId).incident.observations[0].id).toBe(first)
    expect(next(live, lab).diagnostics).toEqual([])
    expect(reload(live, lab)).toBeTruthy()
  })

  it('captures genuine application failure records that outlive their container and live logs', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    let live = verify(repair(verify(start(run, lab).run, lab, 'observe-port').run, lab), lab, 'recover').run
    live = advanceHealth(next(live, lab).run, lab, 90)
    live = verify(live, lab, 'observe-dependency').run
    const observation = state(live, clusterId).incident.observations.at(-1)
    expect(observation.records.application).toHaveLength(2)
    expect(observation.records.dependency.some(item => item.errorCode === 'POSTGRES_CONNECTION')).toBe(true)
    const podName = Object.values(live.runtime.kubernetes.clusters[clusterId].resources).find(item => item.metadata.uid === observation.capsule.podUid).metadata.name
    live = act(live, lab, { type: 'command', line: `kubectl delete pod ${podName} -n assistant` }).run
    live = advanceHealth(live, lab, 90)
    const before = JSON.stringify(live), replay = api.replayDiagnosisObservation(live, observation.id, lab)
    expect(replay.diagnostics).toEqual([])
    expect(replay.snapshot.records.application).toHaveLength(2)
    expect(JSON.stringify(live)).toBe(before)
    expect(reload(live, lab)).toBeTruthy()
  })

  it('blocks experiment starts and retires a deleted target on the existing clock action without losing history', () => {
    const { run, lab, clusterId } = seedDiagnosisIncidentTest()
    let live = verify(start(run, lab).run, lab, 'observe-port').run
    for (const type of ['aks-probe-start', 'aks-resource-start', 'aks-release-start']) expect(applyRunAction(live, { type, scenarioId: 'other' }, lab).run).toEqual(live)
    const id = state(live, clusterId).incident.observations[0].id
    live = act(live, lab, { type: 'command', line: 'kubectl delete service assistant-internal -n assistant' }).run
    live = act(live, lab, { type: 'aks-advance', seconds: 1 }).run
    expect(state(live, clusterId).incident.active).toBe(false)
    expect(state(live, clusterId).receipts.at(-1).kind).toBe('target-deleted')
    expect(api.replayDiagnosisObservation(live, id, lab).diagnostics).toEqual([])
    expect(reload(live, lab)).toBeTruthy()
  })
})
