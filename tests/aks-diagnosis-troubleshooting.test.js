import { beforeAll, expect, test } from 'vitest'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { probeIncidentSnapshot } from '../src/lib/kubernetes/diagnosis-incidents.js'
import { labById } from '../src/data/labs/index.js'
import { diagnosisTwoPodRepair } from '../src/data/labs/aks-journey/diagnosis-troubleshooting.lab.js'
import { executeAksSolution, executeDiagnosisRepair, act } from './helpers/aks.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { createBehavioralSession } from '../src/lib/labEngine/session.js'

const lab = labById('aks-diagnosis-troubleshooting')
const target = () => lab.scenarios.incident.target
const state = run => run.runtime.kubernetes.clusters[target().clusterId]
const pods = run => getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api')
const done = (run, id) => evaluateLab(lab, run).tasks.find(task => task.id === id).done
const verify = (run, id) => applyRunAction(run, { type: 'aks-request', scenarioId: id }, lab)
let seed, routed

beforeAll(() => {
  seed = createBehavioralRun(lab, { attemptId: 'lab23-test' })
  routed = executeAksSolution(seed, lab, lab.tasks[0])
})

test('standalone seed has two ready v2 Pods, both saved and captured faults, and five complete Tasks', () => {
  expect(lab).toMatchObject({ journeyOrder: 23, journeyId: 'aks-knowledge-assistant', labMode: 'troubleshooting', contentVersion: 1 })
  expect(lab.tasks).toHaveLength(5)
  for (const task of lab.tasks) {
    expect(task.hints).toHaveLength(2)
    expect(task.solution.steps.length).toBeGreaterThan(1)
    expect(task.explanation.length).toBeGreaterThan(30)
    expect(task.examNote.length).toBeGreaterThan(20)
  }
  expect(seed.project.savedFiles['k8s/service-internal.yaml']).toContain('targetPort: 8081')
  expect(seed.project.savedFiles['k8s/service-external.yaml']).toContain('targetPort: 8081')
  expect(seed.project.savedFiles['k8s/configmap.yaml']).toContain('https://ai-missing.example')
  expect(seed.project.savedFiles['k8s/deployment.yaml']).toContain('acraksdiagnosistroubleshooting.azurecr.io/assistant:diagnostics-v1')
  expect(seed.artifacts.publishedTags['acraksdiagnosistroubleshooting.azurecr.io/assistant:diagnostics-v1']).toBeTruthy()
  expect(pods(seed)).toHaveLength(2)
  expect(pods(seed).every(pod => state(seed).health.containers[pod.metadata.uid].ready)).toBe(true)
  expect(pods(seed).every(pod => state(seed).podSnapshots[pod.metadata.uid].environment.AI_ENDPOINT === 'https://ai-missing.example')).toBe(true)
  expect(validateBehavioralRun(seed, lab)).toBeTruthy()
})

test('first route failure selects ready endpoints, refuses 8081 before Python, and retains a pure controlled probe', () => {
  expect(done(routed, 'route-observed')).toBe(true)
  const observation = state(routed).diagnosis.incident.observations[0]
  expect(observation.records.request).toMatchObject({ status: null, transport: { ok: false, reason: 'CONNECTION_REFUSED' } })
  expect(observation.records.request.route.selectedCount).toBe(2)
  expect(observation.records.application).toEqual([])
  expect(observation.records.dependency).toEqual([])
  const before = JSON.stringify(routed)
  const probe = probeIncidentSnapshot(routed, observation.id, lab)
  expect(probe.snapshot).toMatchObject({ historical: true, status: 502, body: { code: 'AI_ENDPOINT' } })
  expect(JSON.stringify(routed)).toBe(before)
  expect(probeIncidentSnapshot(routed, { observationId: observation.id, port: 80 }, lab).snapshot).toBeNull()
  expect(done(routed, 'internal-recovered')).toBe(false)
})

test('port-first repair exposes real embedding failure; ConfigMap apply needs Pod replacement', () => {
  let run = structuredClone(routed)
  for (const path of ['k8s/service-internal.yaml', 'k8s/service-external.yaml']) {
    run = act(run, lab, { type: 'save-file', path, text: lab.solutionFiles[path] }).run
    run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  }
  run = verify(run, 'dependency-observed').run
  expect(done(run, 'dependency-observed')).toBe(true)
  const record = run.evidence.experimentsById[run.evidence.currentEvidenceByTask['dependency-observed']]
  expect(record.measurements).toMatchObject({ status: 502, body: { code: 'AI_ENDPOINT' }, provenanceValid: true })
  expect(record.measurements.dependencyTrace.map(item => [item.operation, item.status])).toEqual([['embedding', 'failed']])
  run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text: lab.solutionFiles['k8s/configmap.yaml'] }).run
  expect(done(verify(run, 'internal-recovered').run, 'internal-recovered')).toBe(false)
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run
  expect(pods(run).every(pod => state(run).podSnapshots[pod.metadata.uid].environment.AI_ENDPOINT === 'https://ai-missing.example')).toBe(true)
  expect(done(verify(run, 'internal-recovered').run, 'internal-recovered')).toBe(false)
})

test.each([{ targetPort: 8080, repairTogether: false }, { targetPort: 'http', repairTogether: true }])('both repair paths recover and retain distinct current proof ($targetPort, together=$repairTogether)', ({ targetPort, repairTogether }) => {
  let run = executeDiagnosisRepair(structuredClone(routed), lab, { targetPort, repairTogether })
  for (const id of ['route-observed', 'dependency-observed', 'internal-recovered', 'external-recovered', 'repeatable-repair'])
    expect(done(run, id), id).toBe(true)
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
  const before = JSON.stringify(run)
  const observation = state(run).diagnosis.incident.observations[0]
  const second = run.evidence.experimentsById[run.evidence.currentEvidenceByTask['dependency-observed']]
  expect(second.measurements.origin === 'incident-snapshot').toBe(repairTogether)
  expect(probeIncidentSnapshot(run, observation.id, lab).snapshot).toMatchObject({ status: 502, body: { code: 'AI_ENDPOINT' } })
  expect(JSON.stringify(run)).toBe(before)
})

test('ConfigMap-first repair leaves refused traffic until both Services are corrected; historical probe then exposes the masked cause', () => {
  const run = executeDiagnosisRepair(structuredClone(routed), lab, { targetPort: 'http', configFirst: true })
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  const second = run.evidence.experimentsById[run.evidence.currentEvidenceByTask['dependency-observed']]
  expect(second.measurements).toMatchObject({ origin: 'incident-snapshot', status: 502, body: { code: 'AI_ENDPOINT' } })
})

test('re-Verify after recovery retains an authentic live 502 while its request exists, then labels a pruned observation as snapshot', () => {
  const recovered = executeDiagnosisRepair(structuredClone(routed), lab, { targetPort: 8080 })
  const prior = recovered.evidence.experimentsById[recovered.evidence.currentEvidenceByTask['dependency-observed']]
  expect(prior.measurements.origin.kind).toBe('pod')
  const requests = recovered.runtime.kubernetes.requests.length
  const again = verify(recovered, 'dependency-observed')
  expect(again.run.runtime.kubernetes.requests).toHaveLength(requests)
  expect(done(again.run, 'dependency-observed')).toBe(true)
  const current = again.run.evidence.experimentsById[again.run.evidence.currentEvidenceByTask['dependency-observed']]
  expect(current.measurements).toMatchObject({ observationOrigin: 'observed-live-history', requestId: prior.measurements.requestId,
    status: 502, body: { code: 'AI_ENDPOINT' }, origin: { kind: 'pod' } })
  expect(again.lines[0].text).toContain('Historical observed-live request')
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(again.run)), lab)).toBeTruthy()
  const pruned = structuredClone(recovered)
  pruned.runtime.kubernetes.requests = pruned.runtime.kubernetes.requests.filter(item => item.id !== prior.measurements.requestId)
  expect(validateBehavioralRun(pruned, lab)).toBeTruthy()
  const afterPruning = verify(pruned, 'dependency-observed')
  const retained = afterPruning.run.evidence.experimentsById[afterPruning.run.evidence.currentEvidenceByTask['dependency-observed']]
  expect(retained.measurements).toMatchObject({ origin: 'incident-snapshot', status: 502, body: { code: 'AI_ENDPOINT' } })
})

test('a forged probe-only record cannot be relabeled as observed-live history', () => {
  const run = executeDiagnosisRepair(structuredClone(routed), lab, { targetPort: 'http', repairTogether: true })
  const record = run.evidence.experimentsById[run.evidence.currentEvidenceByTask['dependency-observed']]
  const incident = state(run).diagnosis.incident
  record.measurements = { ...record.measurements, origin: { kind: 'pod', clusterId: target().clusterId, podUid: incident.observations[0].capsule.podUid },
    requestId: 'request-999999', requestSequence: record.sequence - 1, transport: { ok: true, reason: null },
    route: { serviceUid: incident.target.serviceUid }, serviceUid: incident.target.serviceUid,
    deploymentUid: incident.target.deploymentUid }
  expect(validateBehavioralRun(run, lab)).toBeTruthy()
  const again = verify(run, 'dependency-observed')
  const current = again.run.evidence.experimentsById[again.run.evidence.currentEvidenceByTask['dependency-observed']]
  expect(current.measurements.origin).toBe('incident-snapshot')
  expect(current.measurements).not.toHaveProperty('observationOrigin', 'observed-live-history')
})

test('authored Solutions grade at each Task, require final witness, survive reload and produce Result', async () => {
  let run = structuredClone(seed)
  for (const [index, task] of lab.tasks.entries()) {
    run = executeAksSolution(run, lab, task)
    expect(done(run, task.id), task.id).toBe(true)
    if (index === 3) expect(done(verify(run, 'repeatable-repair').run, 'repeatable-repair')).toBe(false)
    run = JSON.parse(JSON.stringify(run))
    expect(validateBehavioralRun(run, lab)).toBeTruthy()
  }
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  const stale = structuredClone(run), staleUid = pods(stale)[0].metadata.uid
  state(stale).podSnapshots[staleUid].environment.AI_ENDPOINT = 'https://ai-missing.example'
  expect(diagnosisTwoPodRepair(stale)).toBe(false)
  expect(evaluateLab(lab, stale).isComplete).toBe(false)
  const repository = behavioralRepository()
  await repository.saveRun(run, { expectedRevision: 0 })
  const session = createBehavioralSession({ lab, repository, reduce: applyRunAction, createAttemptId: () => 'next-lab23' })
  await session.load()
  await session.complete({ id: 'lab23-result', finishedAt: '2026-09-30T15:00:00Z' })
  expect(repository.results).toMatchObject([{ labId: lab.id, tasksDone: 5, total: 5, attemptId: 'lab23-test' }])
})

test('retained snapshot rejects foreign attempt, epoch and target; probe redacts Secrets and accepts no caller outcome', () => {
  const observation = state(routed).diagnosis.incident.observations[0]
  expect(JSON.stringify(probeIncidentSnapshot(routed, observation.id, lab))).not.toContain('training-only-password')
  for (const mutate of [
    run => { run.attemptId = 'foreign' },
    run => { state(run).diagnosis.incident.epoch++ },
    run => { state(run).diagnosis.incident.target.serviceUid = 'foreign-service' },
  ]) {
    const wrong = structuredClone(routed)
    mutate(wrong)
    expect(probeIncidentSnapshot(wrong, observation.id, lab).snapshot).toBeNull()
    expect(() => validateBehavioralRun(wrong, lab)).toThrow()
  }
  expect(probeIncidentSnapshot(routed, { observationId: observation.id, status: 200 }, lab).snapshot).toBeNull()
})
