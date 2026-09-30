import { beforeAll, expect, test } from 'vitest'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { inspectRequestRecords } from '../src/lib/kubernetes/request-records.js'
import { labById } from '../src/data/labs/index.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { executeAksSolution, executeIndependentDiagnosis, act } from './helpers/aks.js'
import { behavioralRepository } from './helpers/behavioralRepository.js'
import { createBehavioralSession } from '../src/lib/labEngine/session.js'

const lab = labById('aks-diagnosis-independent')
const target = () => lab.scenarios.incident.target
const state = run => run.runtime.kubernetes.clusters[target().clusterId]
const pods = run => getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api')
const record = (run, id) => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]]
const done = (run, id) => evaluateLab(lab, run).tasks.find(task => task.id === id).done
const verify = (run, id) => applyRunAction(run, { type: 'aks-request', scenarioId: id }, lab).run
let seed, inspected, repaired, readyOnly

beforeAll(() => {
  seed = createBehavioralRun(lab, { attemptId: 'lab24-test' })
  inspected = executeAksSolution(seed, lab, lab.tasks[0])
  readyOnly = act(inspected, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: inspected.project.savedFiles['k8s/deployment.yaml'].replace('/health/readyz', '/health/ready') }).run
  readyOnly = act(readyOnly, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  readyOnly = act(readyOnly, lab, { type: 'aks-advance', seconds: 90 }).run
  repaired = executeIndependentDiagnosis(structuredClone(inspected), lab)
})

test('starts with captured review audience and no Ready Pods, then retains the initial route failure', () => {
  expect(lab.tasks.map(task => task.id)).toEqual(['inspect-incident', 'restore-backup', 'restore-support', 'validate-empty', 'validate-no-match', 'repeatable-recovery'])
  expect(seed.project.savedFiles['k8s/deployment.yaml']).toContain('/health/readyz')
  expect(seed.project.savedFiles['app.py']).toContain('"audience": "employee"')
  expect(pods(seed)).toHaveLength(2)
  expect(pods(seed).every(pod => !state(seed).health.containers[pod.metadata.uid].ready)).toBe(true)
  expect(done(inspected, 'inspect-incident')).toBe(true)
  expect(state(inspected).diagnosis.incident.observations[0].records.request).toMatchObject({ status: null, transport: { ok: false, reason: 'NO_READY_ENDPOINTS' } })
  expect(validateBehavioralRun(inspected, lab)).toBeTruthy()
})

test.each([['config-binding', 'readiness-first'], ['equivalent-parameter-name', 'readiness-first'], ['config-binding', 'source-first']])('accepts independent repair %s in %s order', (sourceRepair, repairOrder) => {
  const run = sourceRepair === 'config-binding' && repairOrder === 'readiness-first' ? structuredClone(repaired)
    : executeIndependentDiagnosis(structuredClone(inspected), lab, { sourceRepair, repairOrder })
  for (const task of lab.tasks) expect(done(run, task.id), task.id).toBe(true)
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
  expect(record(run, 'repeatable-recovery').measurements).toMatchObject({ status: 504, body: { code: 'DEPENDENCY_TIMEOUT' } })
  const after = verify(run, 'restore-backup')
  expect(record(after, 'restore-backup').measurements.body.sources).toEqual(['review-backups'])
})

test('readiness-only repair exposes HTTP 200 from the wrong review source', () => {
  const run = verify(readyOnly, 'restore-backup')
  expect(record(run, 'restore-backup')).toMatchObject({ outcome: 'failed', measurements: { status: 200,
    body: { answer: 'Internal review policy: keep backups for 60 days.', sources: ['00-review-employee'] },
    integrationTrace: { queryBindings: { audience: 'employee' }, selectedIds: ['00-review-employee'] } } })
  expect(done(run, 'restore-backup')).toBe(false)
})

test('configuration-only repair cannot change a literal audience captured in Python', () => {
  let run = structuredClone(inspected)
  expect(run.project.savedFiles['k8s/configmap.yaml']).toContain('AUDIENCE: partner')
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: readyOnly.project.savedFiles['k8s/deployment.yaml'] }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = verify(run, 'restore-backup')
  expect(record(run, 'restore-backup').measurements.body.sources).toEqual(['00-review-employee'])
  expect(done(run, 'restore-backup')).toBe(false)
})

test('a new build without Deployment update still routes the captured employee binding', () => {
  let run = act(readyOnly, lab, { type: 'save-file', path: 'app.py', text: lab.solutionFiles['app.py'] }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksdiagnosisindependent --image assistant:review-v2 .' }).run
  run = verify(run, 'restore-backup')
  expect(record(run, 'restore-backup').measurements.body.sources).toEqual(['00-review-employee'])
  expect(done(run, 'restore-backup')).toBe(false)
})

test('a literal seven-day answer cannot be published as a release artifact', () => {
  let run = structuredClone(readyOnly)
  const app = run.project.savedFiles['app.py'].replace('format_answer(result["answer"], rows, cfg["environment"])',
    'format_answer("Review backups are kept for 7 days.", rows, cfg["environment"])')
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: app }).run
  const publishedBefore = { ...run.artifacts.publishedTags }
  const result = applyRunAction(run, { type: 'command', line: 'az acr build --registry acraksdiagnosisindependent --image assistant:review-v2 .' }, lab)
  expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'PYTHON_UNSUPPORTED' }))
  expect(result.run.artifacts.publishedTags).toEqual(publishedBefore)
})

test('disabled readiness cannot certify a recovered Deployment', () => {
  let run = structuredClone(repaired)
  const deployment = parseYaml(run.project.savedFiles['k8s/deployment.yaml'])
  delete deployment.spec.template.spec.containers[0].readinessProbe
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringifyYaml(deployment) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = verify(run, 'restore-backup')
  expect(record(run, 'restore-backup').measurements.status).toBe(200)
  expect(done(run, 'restore-backup')).toBe(false)
})

test('constant-200 readiness cannot certify review recovery', () => {
  let run = structuredClone(readyOnly)
  const app = lab.solutionFiles['app.py'].replace('200 if initialized() and accepting_requests() else 503', '200')
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: app }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksdiagnosisindependent --image assistant:review-v2 .' }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: lab.solutionFiles['k8s/deployment.yaml'] }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = verify(run, 'restore-backup')
  expect(record(run, 'restore-backup').measurements.status).toBe(200)
  expect(done(run, 'restore-backup')).toBe(false)
})

test('missing negative-case proof and stale current source both fail completion', () => {
  let run = structuredClone(repaired)
  delete run.evidence.experimentsById[run.evidence.currentEvidenceByTask['validate-no-match']]
  delete run.evidence.currentEvidenceByTask['validate-no-match']
  expect(evaluateLab(lab, run).isComplete).toBe(false)
  run = act(structuredClone(repaired), lab, { type: 'save-file', path: 'app.py', text: repaired.project.savedFiles['app.py'] + '\n# stale saved source\n' }).run
  expect(evaluateLab(lab, run).isComplete).toBe(false)
})

test('negative cases and timeout keep separate current request evidence', () => {
  const run = structuredClone(repaired)
  const ids = ['restore-backup', 'restore-support', 'validate-empty', 'validate-no-match', 'repeatable-recovery'].map(id => record(run, id).measurements.requestId)
  expect(new Set(ids).size).toBe(ids.length)
  const blank = record(run, 'validate-empty').measurements
  expect(blank).toMatchObject({ status: 400, dependencyTrace: [] })
  const missing = record(run, 'validate-no-match').measurements
  expect(missing).toMatchObject({ status: 200, body: { answer: 'No matching documents.', sources: [] } })
  expect(missing.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query'])
  const timeout = record(run, 'repeatable-recovery').measurements
  expect(timeout.integrationTrace.attempts).toHaveLength(3)
  expect(timeout.integrationTrace.attempts.every(item => item.operation === 'embedding')).toBe(true)
  expect(timeout.dependencyTrace.map(item => item.operation)).toEqual(['embedding'])
  const logs = inspectRequestRecords(run, { clusterId: target().clusterId, requestId: timeout.requestId }).application
  expect(logs).toContainEqual(expect.objectContaining({ sourceFields: expect.objectContaining({ event: 'request.completed',
    request_id: timeout.requestId, status: 504 }) }))
  let after = verify(run, 'restore-backup')
  expect(done(after, 'repeatable-recovery')).toBe(true)
  expect(done(after, 'restore-support')).toBe(true)
  expect(done(after, 'validate-empty')).toBe(true)
  expect(done(after, 'validate-no-match')).toBe(true)
  after = verify(after, 'restore-support')
  expect(evaluateLab(lab, after).isComplete).toBe(true)
})

test('captured timeout completion survives bounded live log pruning', () => {
  const run = structuredClone(repaired)
  const requestId = record(run, 'repeatable-recovery').measurements.requestId
  for (const container of Object.values(state(run).health.containers)) {
    container.currentLogs = container.currentLogs.filter(item => item.requestId !== requestId)
    if (container.previous) container.previous.logs = container.previous.logs.filter(item => item.requestId !== requestId)
  }
  const task = lab.tasks.find(item => item.id === 'repeatable-recovery')
  expect(task.check(run)).toBe(true)
  record(run, 'repeatable-recovery').measurements.completionLog.status = 200
  expect(task.check(run)).toBe(false)
})

test('authored Solutions pass at each Task and survive save/reload into Lab Results', async () => {
  let run = structuredClone(seed)
  for (const task of lab.tasks) {
    run = executeAksSolution(run, lab, task)
    expect(done(run, task.id), task.id).toBe(true)
    run = JSON.parse(JSON.stringify(run))
    expect(validateBehavioralRun(run, lab)).toBeTruthy()
  }
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  const repository = behavioralRepository()
  await repository.saveRun(run, { expectedRevision: 0 })
  const session = createBehavioralSession({ lab, repository, reduce: applyRunAction, createAttemptId: () => 'next-lab24' })
  await session.load()
  await session.complete({ id: 'lab24-result', finishedAt: '2026-09-30T15:00:00Z' })
  expect(repository.results).toMatchObject([{ labId: lab.id, tasksDone: 6, total: 6, attemptId: 'lab24-test' }])
})
