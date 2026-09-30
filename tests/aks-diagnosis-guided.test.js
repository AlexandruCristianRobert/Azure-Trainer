import { expect, test } from 'vitest'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { verifyDiagnosis, diagnosisHistoricalEvidence } from '../src/lib/kubernetes/diagnosis-evidence.js'
import { diagnosisDigest } from '../src/lib/kubernetes/diagnosis-incidents.js'
import { labById } from '../src/data/labs/index.js'
import { act, executeAksSolution } from './helpers/aks.js'
import { createBehavioralSession } from '../src/lib/labEngine/session.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'

const modules = import.meta.glob('../src/data/labs/aks-journey/diagnosis-guided.lab.js', { eager: true })
const lab = Object.values(modules)[0]?.diagnosisGuidedLab
const initial = () => createBehavioralRun(lab, { attemptId: 'guided-diagnosis' })
const target = () => lab.scenarios.incident.target
const state = run => run.runtime.kubernetes.clusters[target().clusterId]
const done = (run, index) => evaluateLab(lab, run).tasks[index].done
const checkpoints = new Map()
function through(index) {
  expect(lab, 'Lab22 implementation is required').toBeTruthy()
  if (!checkpoints.has(index)) checkpoints.set(index, executeAksSolution(index ? through(index - 1) : initial(), lab, lab.tasks[index]))
  return structuredClone(checkpoints.get(index))
}
const next = run => applyRunAction(run, { type: 'aks-diagnosis-next', scenarioId: 'incident' }, lab)
const reload = run => { const saved = JSON.parse(JSON.stringify(run)); expect(validateBehavioralRun(saved, lab)).toBeTruthy(); return saved }

test('standalone registered Lab22 supplies fourteen complete Tasks and two healthy version2 Pods', () => {
  expect(lab).toBeTruthy()
  expect(labById('aks-diagnosis-guided')).toBe(lab)
  expect(lab).toMatchObject({ journeyOrder: 22, journeyId: 'aks-knowledge-assistant', contentVersion: 1, labMode: 'guided', skillAreaId: 'containers', service: 'aks' })
  expect(lab.tasks).toHaveLength(14)
  for (const task of lab.tasks) {
    expect(task.hints).toHaveLength(2)
    expect(task.solution.steps.length).toBeGreaterThan(1)
    expect(task.examNote.length).toBeGreaterThan(20)
    expect(task.explanation.length).toBeGreaterThan(30)
  }
  const run = initial()
  expect(Object.keys(run.project.savedFiles)).toHaveLength(14)
  expect(run.project.savedFiles['app.py']).not.toContain('    log_event("request.started")')
  expect(run.project.savedFiles['k8s/deployment.yaml']).toContain('terminationGracePeriodSeconds: 1')
  const pods = getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api')
  expect(pods).toHaveLength(2)
  expect(pods.every(pod => state(run).health.containers[pod.metadata.uid].ready)).toBe(true)
  expect(state(run).resources['Pod/default/assistant-api']).toBeUndefined()
  reload(run)
})

test('ordinary authored Solutions immediately grade each Task and retain five failures/five recoveries through reload and Result', async () => {
  expect(lab).toBeTruthy()
  let run = initial()
  for (const [index, task] of lab.tasks.entries()) {
    try { run = executeAksSolution(run, lab, task) } catch (error) { throw new Error(`${task.id}: ${error.message}`, { cause: error }) }
    expect(done(run, index), task.id + JSON.stringify(evaluateLab(lab, run).tasks[index])).toBe(true)
    run = reload(run); checkpoints.set(index, run)
  }
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  const incident = state(run).diagnosis.incident
  expect(incident.active).toBe(false)
  expect(incident.observations.map(item => item.phaseId)).toEqual(['selector', 'lifecycle', 'embedding', 'retrieval', 'answer'])
  expect(incident.recoveries.map(item => item.phaseId)).toEqual(['selector', 'lifecycle', 'embedding', 'retrieval', 'answer'])
  for (const snapshot of [...incident.observations, ...incident.recoveries]) {
    expect(snapshot).toMatchObject({ attemptId: 'guided-diagnosis', epoch: incident.epoch, incidentId: incident.id, historical: true })
    expect(diagnosisHistoricalEvidence(run, lab, snapshot.scenarioId)?.observationId).toBe(snapshot.id)
  }
  expect(run.evidence.currentEvidenceByTask['final-internal']).not.toBe(run.evidence.currentEvidenceByTask['final-external'])
  const repository = behavioralRepository()
  await repository.saveRun(run, { expectedRevision: 0 })
  const session = createBehavioralSession({ lab, repository, reduce: applyRunAction, createAttemptId: () => 'another-attempt' })
  await session.load()
  await session.complete({ id: 'guided-diagnosis-result', finishedAt: '2026-09-30T13:00:00Z' })
  expect(repository.results).toMatchObject([{ labId: 'aks-diagnosis-guided', tasksDone: 14, total: 14, attemptId: 'guided-diagnosis' }])
  expect(session.snapshot().run.completedAt).toBe('2026-09-30T13:00:00Z')
})

test('phase owner refuses skipped observation and repaired current evidence', () => {
  let run = through(1)
  run = act(run, lab, { type: 'aks-diagnosis-start', scenarioId: 'incident' }).run
  expect(next(run).diagnostics.length).toBeGreaterThan(0)
  run = act(run, lab, { type: 'aks-request', scenarioId: 'observe-selector' }).run
  expect(next(run).diagnostics.length).toBeGreaterThan(0)
  const repair = lab.tasks[3]
  run = executeAksSolution(run, lab, { ...repair, solution: { steps: repair.solution.steps.filter(step => step.kind !== 'scenario') } })
  expect(next(run).diagnostics.length).toBeGreaterThan(0)
  expect(done(run, 3)).toBe(false)
})

test('native capture binds the actual post-logging baseline and refuses recomputed baseline coordinate tampering', () => {
  const run = through(2), incident = state(run).diagnosis.incident
  expect(incident.observations).toHaveLength(1)
  expect(incident.baselineObjects).toBeInstanceOf(Array)
  const wrong = structuredClone(run)
  state(wrong).diagnosis.incident.baselineObjects = [999]
  expect(() => reload(wrong)).toThrow(/Kubernetes/)
})

test('lifecycle captures same-Pod restart and genuine previous startup logs without fabricated Python requests', () => {
  const run = through(4), observation = state(run).diagnosis.incident.observations.find(item => item.phaseId === 'lifecycle')
  expect(observation.records.request.status).toBe(200) // authentic old healthy Pod traffic
  expect(observation.records.lifecycle.previousServerLogs).toHaveLength(1)
  const pods = getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api')
  const restarted = pods.find(pod => state(run).health.containers[pod.metadata.uid].restartCount > 0)
  expect(restarted).toBeTruthy()
  const container = state(run).health.containers[restarted.metadata.uid]
  expect(container.previous.containerId).not.toBe(container.containerId)
  expect(observation.records.lifecycle.podUid).toBe(restarted.metadata.uid)
  expect(JSON.stringify(observation.records.lifecycle)).toContain('startup')
  expect(JSON.stringify(observation.records.lifecycle)).not.toContain('request.started')
  expect(done(run, 5)).toBe(false)
})

test('old healthy traffic cannot certify lifecycle repair before healthy rollout completion', () => {
  let run = through(3)
  run = act(run, lab, { type: 'aks-diagnosis-next', scenarioId: 'incident' }).run
  run = applyRunAction(run, { type: 'aks-request', scenarioId: 'recover-lifecycle' }, lab).run
  expect(state(run).diagnosis.incident.recoveries.some(item => item.phaseId === 'lifecycle')).toBe(false)
  expect(done(run, 5)).toBe(false)
  expect(next(run).diagnostics.length).toBeGreaterThan(0)
})

test('sealed lifecycle survives live event pruning but recomputed projection tampering is rejected', () => {
  const run = through(4), observation = state(run).diagnosis.incident.observations.find(item => item.phaseId === 'lifecycle')
  state(run).health.events = state(run).health.events.filter(event => event.atMs > observation.simTimeMs)
  state(run).health.receipts = [] // the independent native diagnosis receipt remains
  expect(done(reload(run), 4)).toBe(true)
  const wrong = structuredClone(run), snapshot = state(wrong).diagnosis.incident.observations.find(item => item.phaseId === 'lifecycle')
  snapshot.records.lifecycle.previousContainerId = 'container-9999'
  const record = wrong.evidence.experimentsById[snapshot.evidenceId]
  record.measurements.lifecycle = structuredClone(snapshot.records.lifecycle)
  record.measurements.diagnosisCapture.recordsDigest = diagnosisDigest(snapshot.records)
  const { hash, ...payload } = snapshot; snapshot.hash = diagnosisDigest(payload)
  expect(() => reload(wrong)).toThrow(/Kubernetes/)
})

test('lifecycle proof cannot be supplied by callers or obtained before a real restart', () => {
  const run = through(3), started = act(run, lab, { type: 'aks-diagnosis-next', scenarioId: 'incident' }).run
  expect(verifyDiagnosis(started, lab, 'observe-lifecycle').result.outcome).toBe('failed')
  const forged = applyRunAction(started, { type: 'aks-request', scenarioId: 'observe-lifecycle', lifecycle: { restartCount: 1 } }, lab)
  expect(forged.run).toEqual(started)
  expect(forged.diagnostics.length).toBeGreaterThan(0)
})

test('wrong namespace and saved/live drift do not repair or route the assistant', () => {
  const run = through(2), failed = applyRunAction(run, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n default' }, lab)
  expect(failed.lines.some(line => line.kind === 'err')).toBe(true)
  expect(done(failed.run, 3)).toBe(false)
  const savedOnly = act(run, lab, { type: 'save-file', path: 'k8s/service-internal.yaml', text: lab.solutionFiles['k8s/service-internal.yaml'] }).run
  const verified = applyRunAction(savedOnly, { type: 'aks-request', scenarioId: 'recover-selector' }, lab)
  expect(done(verified.run, 3)).toBe(false)
})

test.each(['build', 'deploy'])('logging proof refuses skipped %s', skip => {
  const task = lab.tasks[1]
  const run = executeAksSolution(through(0), lab, { ...task, solution: { steps: task.solution.steps.filter(step => !(step.kind === 'command' && (step.line.startsWith('kubectl rollout status') || (skip === 'build' ? step.line.startsWith('az acr build') : step.line.startsWith('kubectl apply'))))) } })
  expect(done(run, 1)).toBe(false)
})

test.each(['request id', 'status', 'event'])('logging proof rejects a literal or wrong %s despite HTTP200', mutation => {
  let run = through(0)
  let source = lab.solutionFiles['app.py']
  if (mutation === 'request id') source = source.replace('"request_id": current_request_id()', '"request_id": "request-fixed"')
  if (mutation === 'status') source = source.replace('response["status"]', '200')
  if (mutation === 'event') source = source.replace('log_event("request.completed"', 'log_event("made.up"')
  const task = lab.tasks[1]
  run = executeAksSolution(run, lab, { ...task, solution: { steps: task.solution.steps.map(step => step.kind === 'file' && step.path === 'app.py' ? { ...step, content: source } : step) } })
  expect(done(run, 1)).toBe(false)
})

test('current final cases share one witness, reject saved/live drift and stale witness, and require separate proof', () => {
  let run = through(12)
  expect(done(run, 12)).toBe(true); expect(done(run, 13)).toBe(false)
  expect(verifyDiagnosis(run, lab, 'final-external').result.outcome).toBe('passed')
  const source = run.project.savedFiles['app.py']
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: source + '\n# change\n' }).run
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: source }).run
  expect(done(run, 12)).toBe(false)
  expect(verifyDiagnosis(run, lab, 'final-external').result.outcome).toBe('failed')
})

test.each(['attempt', 'epoch', 'phase'])('historical evidence refuses changed %s identity', mutation => {
  const run = through(2)
  if (mutation === 'attempt') run.attemptId = 'foreign'
  if (mutation === 'epoch') state(run).diagnosis.incident.epoch++
  if (mutation === 'phase') state(run).diagnosis.incident.observations[0].phaseId = 'answer'
  expect(done(run, 2)).toBe(false)
})
