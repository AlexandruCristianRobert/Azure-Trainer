import { expect, test } from 'vitest'
import { diagnosisGuidedLab as lab } from '../src/data/labs/aks-journey/diagnosis-guided.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { validDiagnosisLifecycle, validSealedLifecycleReceipt } from '../src/lib/kubernetes/diagnosis-lifecycle.js'
import { captureDiagnosisBaseline, diagnosisDigest } from '../src/lib/kubernetes/diagnosis-incidents.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { act, executeAksSolution, seedDiagnosisTest, seedDiagnosisIncidentTest } from './helpers/aks.js'

const start = run => applyRunAction(run, { type: 'aks-diagnosis-start', scenarioId: 'incident' }, lab)
const baselineDone = run => evaluateLab(lab, run).tasks[0].done
const internal = `kubectl exec diagnostics -n diagnostics -- curl -sS -X POST -H 'Content-Type: application/json' -d '{"question":"How long are backups kept?"}' http://assistant-internal.assistant/api/ask`
let logged, unlogged
function loggingBaseline() {
  if (!logged) {
    const scoped = executeAksSolution(createBehavioralRun(lab, { attemptId: 'review-logging' }), lab, lab.tasks[0])
    logged = executeAksSolution(scoped, lab, lab.tasks[1])
  }
  return structuredClone(logged)
}
function unloggedDeployment() {
  if (!unlogged) {
    let run = createBehavioralRun(lab, { attemptId: 'review-no-logging' })
    run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksdiagnosisguided --image assistant:diagnostics-v1 .' }).run
    run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: lab.solutionFiles['k8s/deployment.yaml'] }).run
    run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
    for (const seconds of [60, 30]) run = act(run, lab, { type: 'aks-advance', seconds }).run
    unlogged = run
  }
  return structuredClone(unlogged)
}

test('single-failure native liveness restart stays valid while Guided observation remains stricter', () => {
  const fixture = seedDiagnosisTest()
  let run = fixture.run
  const deployment = run.project.savedFiles['k8s/deployment.yaml'].replace('/health/live', '/health/missing')
    .replace('failureThreshold: 2', 'failureThreshold: 1')
  run = act(run, fixture.lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: deployment }).run
  run = act(run, fixture.lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  run = act(run, fixture.lab, { type: 'aks-advance', seconds: 40 }).run
  const state = run.runtime.kubernetes.clusters[fixture.clusterId]
  const receipt = state.health.receipts.find(item => item.diagnosisLifecycle?.events.length === 1)
  expect(receipt).toBeTruthy()
  expect(validSealedLifecycleReceipt(receipt, run)).toBe(true)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), fixture.lab)).toBeTruthy()
  const projection = { podUid: receipt.podUid, containerId: receipt.newContainerId, previousContainerId: receipt.oldContainerId,
    artifactId: receipt.diagnosisLifecycle.artifactId, restartCount: receipt.restartCount, startedAtMs: receipt.atMs,
    previousServerLogs: receipt.diagnosisLifecycle.previousServerLogs, events: receipt.diagnosisLifecycle.events }
  expect(validDiagnosisLifecycle(projection, run, fixture.target, 0)).toBe(false)
})

test('Guided start rejects an unlogged diagnostics-v1 build even when HTTP200 logging Verify exists', () => {
  let run = unloggedDeployment()
  run = act(run, lab, { type: 'aks-request', scenarioId: 'logging' }).run
  expect(evaluateLab(lab, run).tasks[1].done).toBe(false)
  const result = start(run)
  expect(result.diagnostics.length).toBeGreaterThan(0)
  expect(result.run).toEqual(run)
})

test('Guided start rejects a working deployment with no captured logging Verify', () => {
  let run = unloggedDeployment()
  run = executeAksSolution(run, lab, { ...lab.tasks[1], solution: { steps: lab.tasks[1].solution.steps.filter(step => step.kind !== 'scenario') } })
  expect(start(run).diagnostics.length).toBeGreaterThan(0)
})

test('Guided start accepts authentic captured logging and rejects saved-source or current-container drift', () => {
  const run = loggingBaseline()
  expect(start(run).diagnostics).toEqual([])
  expect(baselineDone(start(run).run)).toBe(true)
  const changed = act(run, lab, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'] + '\n# saved after capture\n' }).run
  expect(start(changed).diagnostics.length).toBeGreaterThan(0)
  let restarted = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  for (const seconds of [60, 30]) restarted = act(restarted, lab, { type: 'aks-advance', seconds }).run
  expect(start(restarted).diagnostics.length).toBeGreaterThan(0)
  restarted = act(restarted, lab, { type: 'aks-request', scenarioId: 'logging' }).run
  expect(start(restarted).diagnostics).toEqual([])
})

test('Guided start accepts equivalent source-emitted logging rather than authored source spelling', () => {
  let run = executeAksSolution(createBehavioralRun(lab, { attemptId: 'review-equivalent' }), lab, lab.tasks[0])
  const source = lab.solutionFiles['app.py'].replace('log_event("request.started")', "log_event('request.started')")
    .replace('log_event("request.completed", response["status"])', "log_event('request.completed', response['status'])")
  run = executeAksSolution(run, lab, { ...lab.tasks[1], solution: { steps: lab.tasks[1].solution.steps.map(step => step.kind === 'file' && step.path === 'app.py' ? { ...step, content: source } : step) } })
  expect(evaluateLab(lab, run).tasks[1].done).toBe(true)
  expect(start(run).diagnostics).toEqual([])
})

test('legacy diagnosis start does not require a Guided logging Task', () => {
  const { run, lab: legacy } = seedDiagnosisIncidentTest()
  expect(applyRunAction(run, { type: 'aks-diagnosis-start', scenarioId: 'incident' }, legacy).diagnostics).toEqual([])
})

test('baseline requires both real internal and external success without ordering commands', () => {
  let run = createBehavioralRun(lab, { attemptId: 'review-baseline' })
  run = act(run, lab, { type: 'aks-request', scenarioId: 'baseline' }).run
  expect(baselineDone(run)).toBe(false)
  run = act(run, lab, { type: 'command', line: internal }).run
  expect(baselineDone(run)).toBe(true)
  expect(baselineDone(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab))).toBe(true)
})

test('broken internal selector cannot certify baseline through a healthy external Service', () => {
  let run = createBehavioralRun(lab, { attemptId: 'review-broken-internal' })
  const path = 'k8s/service-internal.yaml'
  run = act(run, lab, { type: 'save-file', path, text: run.project.savedFiles[path].replace('app: assistant', 'app: assistant-typo') }).run
  run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'baseline' }).run
  expect(baselineDone(run)).toBe(false)
})

test('authenticated baseline survives ordinary live-request pruning and reload with unchanged external evidence', () => {
  let run = executeAksSolution(createBehavioralRun(lab, { attemptId: 'review-pruned-baseline' }), lab, lab.tasks[0])
  expect(baselineDone(run)).toBe(true)
  const evidenceId = run.evidence.currentEvidenceByTask.baseline
  const internalRequestId = run.runtime.kubernetes.requests.find(request => request.route.serviceName === 'assistant-internal').id
  for (let index = 0; index < 100; index++) run = act(run, lab, { type: 'command', line: 'kubectl exec diagnostics -n diagnostics -- curl -sS http://assistant-internal.assistant/api/info' }).run
  expect(run.runtime.kubernetes.requests).toHaveLength(100)
  expect(run.runtime.kubernetes.requests.every(request => request.status === 200)).toBe(true)
  expect(run.runtime.kubernetes.requests.some(request => request.id === internalRequestId)).toBe(false)
  expect(run.evidence.currentEvidenceByTask.baseline).toBe(evidenceId)
  expect(baselineDone(run)).toBe(true)
  run = validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)
  expect(baselineDone(run)).toBe(true)
  expect(run.evidence.currentEvidenceByTask.baseline).toBe(evidenceId)
})

test('native baseline receipts cannot be minted from clones or retargeted by recomputing payload hashes', () => {
  const initial = createBehavioralRun(lab, { attemptId: 'review-baseline-receipt' })
  const target = lab.diagnosisBaseline.target, state = initial.runtime.kubernetes.clusters[target.clusterId]
  const routed = routeServiceRequest(initial, { origin: { kind: 'pod', clusterId: target.clusterId, podUid: state.connectivity.diagnosticPodUids[0] },
    hostname: 'assistant-internal.assistant', port: 80, method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, lab).run
  const cloned = structuredClone(routed)
  expect(captureDiagnosisBaseline(cloned, lab)).toBe(cloned)
  expect(cloned.runtime.kubernetes.clusters[target.clusterId].diagnosis?.baseline).toBeUndefined()
  const address = routed.runtime.kubernetes.requests.at(-1).route.address
  routed.runtime.kubernetes.requests.at(-1).route.address = '203.0.113.99'
  expect(captureDiagnosisBaseline(routed, lab)).toBe(routed)
  routed.runtime.kubernetes.requests.at(-1).route.address = address
  const captured = captureDiagnosisBaseline(routed, lab)
  expect(captured.runtime.kubernetes.clusters[target.clusterId].diagnosis.baseline.request.status).toBe(200)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(captured)), lab)).toBeTruthy()
  for (const field of ['attemptId', 'taskId', 'sourceHash', 'containerId']) {
    const wrong = structuredClone(captured), diagnosis = wrong.runtime.kubernetes.clusters[target.clusterId].diagnosis
    if (field === 'containerId') diagnosis.baseline.request.containerId = 'container-9999'
    else diagnosis.baseline[field] = 'forged'
    diagnosis.baselineReceipt.requestDigest = diagnosisDigest(diagnosis.baseline.request)
    expect(() => validateBehavioralRun(wrong, lab), field).toThrow(/Kubernetes/)
  }
  const replaced = act(captured, lab, { type: 'aks-request', scenarioId: 'baseline' }).run
  const deleted = act(replaced, lab, { type: 'command', line: 'kubectl delete service assistant-internal -n assistant' }).run
  expect(baselineDone(deleted)).toBe(false)
})
