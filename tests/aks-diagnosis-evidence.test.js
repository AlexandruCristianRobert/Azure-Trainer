import { expect, test } from 'vitest'
import * as api from '../src/lib/kubernetes/evidence.js'
import * as release from '../src/lib/kubernetes/release-evidence.js'
import { recordVerification } from '../src/lib/labEngine/evidence.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { seedDiagnosisIncidentTest, act, advanceHealth } from './helpers/aks.js'
import { diagnosisFixture, finalWitness } from './helpers/diagnosis-evidence.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { replayDiagnosisObservation } from '../src/lib/kubernetes/diagnosis-incidents.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { startHealthFault } from './helpers/aks.js'
import { contextFor } from '../src/lib/labEngine/run.js'

const verify = (run, lab, id = 'current') => api.verifyDiagnosis(run, lab, id)
const record = (run, lab, id = 'current') => { const assessed = verify(run, lab, id); return recordVerification(assessed.run, lab, id, assessed.result) }
const done = (run, lab, id = 'current') => evaluateLab(lab, run).tasks.find(task => task.id === id).done
const send = (run, lab, id) => applyRunAction(run, { type: 'aks-request', scenarioId: id }, lab).run

function historicalFixture() {
  let { run, lab, clusterId } = seedDiagnosisIncidentTest()
  lab = { ...lab, tasks: lab.tasks.map(task => ({ ...task, check: () => true, dependencies: task.id === 'observe-port'
    ? api.diagnosisDependencies(lab.scenarios[task.id].target, { historical: true, scenarioId: task.id, lab }) : {} })) }
  run = applyRunAction(run, { type: 'aks-diagnosis-start', scenarioId: 'incident' }, lab).run
  return { run, lab, clusterId }
}

test('a passed historical request recorded without native capture cannot complete its Task', () => {
  const { run, lab, clusterId } = historicalFixture()
  const assessed = verify(run, lab, 'observe-port')
  expect(assessed.result.completed).toBe(true)
  const recorded = recordVerification(assessed.run, lab, 'observe-port', assessed.result)
  expect(recorded.runtime.kubernetes.clusters[clusterId].diagnosis.incident.observations).toHaveLength(0)
  expect(api.diagnosisHistoricalEvidence(recorded, lab, 'observe-port')).toBeNull()
  expect(done(recorded, lab, 'observe-port')).toBe(false)
})

test('caller-supplied pending capture metadata cannot bypass historical authentication', () => {
  const { run, lab } = historicalFixture(), assessed = verify(run, lab, 'observe-port')
  const recorded = recordVerification(assessed.run, lab, 'observe-port', assessed.result)
  const select = Object.values(lab.tasks.find(task => task.id === 'observe-port').dependencies)[0]
  const forged = { ...recorded, diagnosisCapturePendingEvidenceId: recorded.evidence.currentEvidenceByTask['observe-port'] }
  expect(() => select(forged)).toThrow(/capture/i)
})

test('a historical request without an incident cannot certify a null dependency snapshot', () => {
  let { run, lab, clusterId } = historicalFixture()
  run = structuredClone(run)
  run.runtime.kubernetes.clusters[clusterId].diagnosis = { version: 1, incident: null, receipts: [] }
  const assessed = verify(run, lab, 'observe-port')
  expect(assessed.result.completed).toBe(true)
  const recorded = recordVerification(assessed.run, lab, 'observe-port', assessed.result)
  expect(done(recorded, lab, 'observe-port')).toBe(false)
})

test.each(['evidence', 'scenario', 'attempt', 'epoch', 'target'])('historical dependency rejects a foreign %s anchor in both selector contexts', foreign => {
  let { run, lab } = historicalFixture(); run = send(run, lab, 'observe-port')
  expect(done(run, lab, 'observe-port')).toBe(true)
  const select = Object.values(lab.tasks.find(task => task.id === 'observe-port').dependencies)[0]
  expect(select(contextFor(run))).toEqual(select(run))
  const wrong = structuredClone(run), record = wrong.evidence.experimentsById[wrong.evidence.currentEvidenceByTask['observe-port']]
  if (foreign === 'evidence') record.measurements.diagnosisCapture.evidenceId = 'evidence-1'
  if (foreign === 'scenario') record.scenarioId = 'recover-port'
  if (foreign === 'attempt') record.attemptId = 'another-attempt'
  if (foreign === 'epoch') record.measurements.diagnosisCapture.epoch++
  if (foreign === 'target') record.measurements.diagnosisCapture.target.serviceUid = 'kube-999'
  for (const context of [wrong, contextFor(wrong)]) expect(() => select(context)).toThrow(/capture/i)
})

test.each(['missing embedding', 'literal query', 'reordered embedding', 'later embedding'])('exhausted answer rejects %s despite the expected 503 body', mutation => {
  let { run, lab } = diagnosisFixture()
  let source = run.project.savedFiles['app.py']
  const embedding = /        vector = budget\.invoke\([\s\S]*?\n        \)\n/.exec(source)[0]
  if (mutation === 'missing embedding') source = source.replace(embedding, '        vector = [1, 0, 0]\n')
  if (mutation === 'literal query') source = source.replace('"embedding": as_vector(vector)', '"embedding": as_vector([1, 0, 0])')
  if (mutation === 'reordered embedding') source = source.replace(embedding, '').replace('"embedding": as_vector(vector)', '"embedding": as_vector([1, 0, 0])').replace('        if not rows:', embedding + '        if not rows:')
  if (mutation === 'later embedding') source = source.replace('    except DependencyError as error:\n', '    except DependencyError as error:\n' + embedding)
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: source }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
  const result = verify(finalWitness(run, lab), lab, 'exhausted').result
  expect(result.measurements.status).toBe(503)
  expect(result.measurements.body.code).toBe('DEPENDENCY_UNAVAILABLE')
  expect(result.outcome).toBe('failed')
})

test('skipping retrieval with literal rows cannot publish a runnable artifact', () => {
  let { run, lab } = diagnosisFixture()
  const source = run.project.savedFiles['app.py'].replace(/        rows = budget\.invoke\([\s\S]*?\n        \)\n/,
    '        rows = [{"id": "training-backups", "content": "Training backups are kept for 30 days."}]\n')
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: source }).run
  const built = applyRunAction(run, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }, lab)
  expect(built.lines.map(item => item.text).join('\n')).toMatch(/Build failed.*PYTHON_UNSUPPORTED/)
  expect(built.run.artifacts).toEqual(run.artifacts)
})

test.each(['embedding', 'query', 'answer'])('authentic %s failure retains its exact reached prefix and retry attempts', stage => {
  let { run, lab } = diagnosisFixture()
  if (stage === 'embedding') lab = { ...lab, scenarios: { ...lab.scenarios, exhausted: { ...lab.scenarios.exhausted,
    integrationProfile: 'embedding-timeout-always', expected: { status: 504, body: { error: 'A dependency timed out after retries.', code: 'DEPENDENCY_TIMEOUT' } } } } }
  if (stage === 'query') {
    lab = { ...lab, scenarios: { ...lab.scenarios, exhausted: { ...lab.scenarios.exhausted,
      integrationProfile: 'healthy', expected: { status: 503, body: { error: 'The configured PostgreSQL host is not available in this trainer.', code: 'POSTGRES_CONNECTION' } } } } }
    run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text: run.project.savedFiles['k8s/configmap.yaml'].replace('pg-training.example', 'pg-missing.example') }).run
  }
  const result = verify(finalWitness(run, lab), lab, 'exhausted').result
  expect(result.outcome).toBe('passed')
  expect(result.measurements.dependencyTrace.map(item => [item.operation, item.status])).toEqual({
    embedding: [['embedding', 'failed']], query: [['embedding', 'succeeded'], ['postgres-query', 'failed']],
    answer: [['embedding', 'succeeded'], ['postgres-query', 'succeeded'], ['answer', 'failed']],
  }[stage])
  expect(result.measurements.integrationTrace.attempts.filter(item => item.operation === { embedding: 'embedding', query: 'postgres-query', answer: 'answer' }[stage]))
    .toHaveLength(stage === 'query' ? 1 : 3)
})

test('a transient embedding retry preserves authentic successful provenance', () => {
  let { run, lab } = diagnosisFixture()
  lab = { ...lab, scenarios: { ...lab.scenarios, current: { ...lab.scenarios.current, integrationProfile: 'embedding-throttle-once' } } }
  const result = verify(finalWitness(run, lab), lab).result
  expect(result.outcome).toBe('passed')
  expect(result.measurements.integrationTrace.attempts.filter(item => item.operation === 'embedding')).toHaveLength(2)
})

test('diagnosis requires final reapply and restart before accepting actual current routed proof', () => {
  const { run, lab } = diagnosisFixture()
  expect(api.verifyDiagnosis?.(run, lab, 'current')?.result).toMatchObject({ outcome: 'failed', completed: false })
  const ready = finalWitness(run, lab), before = JSON.stringify(ready)
  const result = verify(ready, lab)
  expect(result.result).toMatchObject({ scenarioId: 'current', scenarioVersion: 1, outcome: 'passed', completed: true,
    measurements: { status: 200, body: { sources: ['training-backups'] } } })
  expect(JSON.stringify(ready)).toBe(before)
  expect(result.run.runtime.kubernetes.requests.at(-1).id).toBe(result.result.measurements.requestId)
  expect(done(record(ready, lab), lab)).toBe(true)
})

test('HTTP 200 from a real wrong review audience fails and exposes actual source IDs', () => {
  const { run, lab } = diagnosisFixture({ fault: 'review-audience' })
  const result = verify(finalWitness(run, lab), lab).result
  expect(result).toMatchObject({ outcome: 'failed', measurements: { status: 200, body: { sources: ['00-review-employee'] },
    integrationTrace: { queryBindings: { audience: 'employee' }, selectedIds: ['00-review-employee'] } } })
})

test('a correct HTTP body with a literal query vector lacks real query provenance and fails', () => {
  let { run, lab } = diagnosisFixture()
  const source = run.project.savedFiles['app.py'].replace('"embedding": as_vector(vector)', '"embedding": as_vector([1, 0, 0])')
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: source }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
  const result = verify(finalWitness(run, lab), lab).result
  expect(result.measurements.status).toBe(200)
  expect(result.measurements.body.sources).toEqual(['training-backups'])
  expect(result.outcome).toBe('failed')
})

test('healthy old Pods and a successful response cannot hide broken desired new Pods', () => {
  let { run, lab } = diagnosisFixture(); run = finalWitness(run, lab)
  const path = 'k8s/deployment.yaml'
  run = act(run, lab, { type: 'save-file', path, text: run.project.savedFiles[path].replace('/health/ready', '/health/missing') }).run
  run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = advanceHealth(run, lab, 15)
  const result = verify(run, lab).result
  expect(result.measurements.status).toBe(200)
  expect(result.outcome).toBe('failed')
  expect(result.measurements.consistency.consistent).toBe(false)
})

test('live-only changes, source without rebuild, build without deploy, stale captured env and edit restoration fail', () => {
  let { run, lab } = diagnosisFixture(); run = finalWitness(run, lab)
  const source = run.project.savedFiles['app.py']
  let edited = act(run, lab, { type: 'save-file', path: 'app.py', text: source + '\n# changed\n' }).run
  expect(verify(edited, lab).result.outcome).toBe('failed')
  const published = act(edited, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
  expect(verify(published, lab).result.outcome).toBe('failed')
  edited = act(edited, lab, { type: 'save-file', path: 'app.py', text: source }).run
  expect(verify(edited, lab).result.outcome).toBe('failed')
  expect(verify(act(run, lab, { type: 'command', line: 'kubectl scale deployment/assistant-api --replicas=3 -n assistant' }).run, lab).result.outcome).toBe('failed')
  const path = 'k8s/configmap.yaml'
  edited = act(run, lab, { type: 'save-file', path, text: run.project.savedFiles[path].replace('employee', 'partner') }).run
  edited = act(edited, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  expect(verify(edited, lab).result.measurements.consistency.reasons.join(' ')).toMatch(/Captured configuration.*restart/i)
})

test('independent current cases own separate records and diagnostic reads/unrelated requests preserve proof', () => {
  let { run, lab, clusterId } = diagnosisFixture(); run = record(finalWitness(run, lab), lab)
  const currentId = run.evidence.currentEvidenceByTask.current
  run = record(run, lab, 'blank')
  expect(done(run, lab, 'blank')).toBe(true)
  run = record(run, lab, 'exhausted')
  expect(done(run, lab, 'exhausted')).toBe(true)
  expect(run.evidence.currentEvidenceByTask.exhausted).not.toBe(run.evidence.currentEvidenceByTask.blank)
  expect(run.evidence.currentEvidenceByTask.current).toBe(currentId)
  api.inspectDiagnosis(run, { clusterId, namespace: 'assistant', deploymentName: 'assistant-api', serviceName: 'assistant-internal' })
  run = act(run, lab, { type: 'command', line: 'kubectl get pods -n assistant' }).run
  run = send(run, lab, 'external')
  expect(done(run, lab)).toBe(true)
  expect(run.evidence.currentEvidenceByTask.blank).not.toBe(currentId)
})

test.each(['source', 'yaml', 'config', 'artifact', 'replacement'])('relevant %s mutation invalidates recorded live proof', mutation => {
  let { run, lab, clusterId } = diagnosisFixture(); run = record(finalWitness(run, lab), lab)
  if (mutation === 'source' || mutation === 'yaml' || mutation === 'config') {
    const path = { source: 'app.py', yaml: 'k8s/service-internal.yaml', config: 'k8s/configmap.yaml' }[mutation]
    const text = run.project.savedFiles[path]
    run = act(run, lab, { type: 'save-file', path, text: mutation === 'config' ? text.replace('employee', 'partner') : mutation === 'yaml' ? text.replace('targetPort: http', 'targetPort: 8081') : text + '\n# mutation\n' }).run
  } else if (mutation === 'artifact') run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' }).run
  else {
    const pod = Object.values(run.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
    run = act(run, lab, { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n assistant` }).run
  }
  expect(done(run, lab)).toBe(false)
})

test('historical native capture survives repair/log pruning but rejects changed attempt, target or epoch', () => {
  const fixture = seedDiagnosisIncidentTest(); let { run, lab, clusterId } = fixture
  lab = { ...lab, tasks: lab.tasks.map(task => ({ ...task, check: () => true, dependencies: task.id === 'observe-port'
    ? api.diagnosisDependencies(lab.scenarios[task.id].target, { historical: true, scenarioId: task.id, lab }) : {} })) }
  run = applyRunAction(run, { type: 'aks-diagnosis-start', scenarioId: 'incident' }, lab).run
  run = send(run, lab, 'observe-port')
  const id = run.runtime.kubernetes.clusters[clusterId].diagnosis.incident.observations[0].id
  const path = 'k8s/service-internal.yaml'
  run = act(run, lab, { type: 'save-file', path, text: fixture.run.project.savedFiles[path] }).run
  run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  for (let index = 0; index < 105; index++) run = routeServiceRequest(run, { origin: { kind: 'external', clusterId }, hostname: 'unknown.example.test',
    port: 80, method: 'POST', path: '/api/ask', body: { question: 'How long are backups kept?' } }, null).run
  expect(done(run, lab, 'observe-port')).toBe(true)
  expect(replayDiagnosisObservation(run, id, lab).snapshot.historical).toBe(true)
  for (const mutate of [next => { next.attemptId = 'another-attempt' }, next => { next.runtime.kubernetes.clusters[clusterId].diagnosis.incident.epoch++ },
    next => { next.runtime.kubernetes.clusters[clusterId].diagnosis.incident.target.serviceUid = 'kube-999' }]) {
    const wrong = structuredClone(run); mutate(wrong)
    expect(done(wrong, lab, 'observe-port')).toBe(false)
  }
})

test('shared deployment consistency is pure and returns saved/live, artifact and witnessed final alignment', () => {
  let { run, lab, target } = diagnosisFixture(); run = finalWitness(run, lab)
  const before = JSON.stringify(run), manifest = getProjectManifest(run.project.manifestId)
  expect(release.inspectDeploymentConsistency?.(run, target, manifest)).toMatchObject({ consistent: true, reasons: [], witness: { reapply: expect.any(Object), restart: expect.any(Object) } })
  expect(JSON.stringify(run)).toBe(before)
})

test('a no-match case proves a real empty query and stops before generation', () => {
  let { run, lab } = diagnosisFixture(); run = finalWitness(run, lab)
  const result = verify(run, lab, 'missing').result
  expect(result.measurements.status).toBe(200)
  expect(result.measurements.integrationTrace.selectedIds).toEqual([])
  expect(result.measurements.dependencyTrace.map(item => item.operation)).toEqual(['embedding', 'postgres-query'])
  expect(result.outcome).toBe('passed')
})

test('a missing declared external Service returns a failed finite result without inventing a request record', () => {
  let { run, lab } = diagnosisFixture()
  run = act(run, lab, { type: 'command', line: 'kubectl delete service assistant-public -n assistant' }).run
  const result = verify(run, lab, 'external')
  expect(result.result).toMatchObject({ outcome: 'failed', measurements: { requestId: null, status: null, body: null } })
  expect(result.run).toEqual(run)
})

test('a correct answer routed to another Deployment cannot certify the intended desired Pods', () => {
  let { run, lab, clusterId } = diagnosisFixture()
  const path = 'k8s/deployment.yaml', original = run.project.savedFiles[path]
  const decoy = original.replace('name: assistant-api', 'name: decoy-api').replaceAll('app: assistant', 'app: decoy')
  run = act(run, lab, { type: 'save-file', path, text: decoy }).run
  run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = act(run, lab, { type: 'save-file', path, text: original }).run
  const service = 'k8s/service-internal.yaml'
  run = act(run, lab, { type: 'save-file', path: service, text: run.project.savedFiles[service].replace('app: assistant', 'app: decoy') }).run
  run = finalWitness(run, lab)
  const result = verify(run, lab).result
  const selectedPod = Object.values(run.runtime.kubernetes.clusters[clusterId].resources).find(item => item.metadata.uid === result.measurements.podUid)
  expect(selectedPod.metadata.name).toMatch(/^decoy-api-/)
  expect(result.measurements.status).toBe(200)
  expect(result.measurements.consistency.consistent).toBe(true)
  expect(result.outcome).toBe('failed')
})

test.each(['replacement', 'container restart'])('a %s after the final witness needs a fresh rollout restart before new cases', change => {
  let { run, lab, clusterId } = diagnosisFixture(); run = finalWitness(run, lab)
  const pod = Object.values(run.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'Pod' && item.metadata.namespace === 'assistant')
  run = change === 'replacement' ? act(run, lab, { type: 'command', line: `kubectl delete pod ${pod.metadata.name} -n assistant` }).run
    : startHealthFault(run, clusterId, pod.metadata.uid, 'hung')
  run = advanceHealth(run, lab, 90)
  expect(verify(run, lab).result.measurements.status).toBe(200)
  expect(verify(run, lab).result.outcome).toBe('failed')
  expect(verify(finalWitness(run, lab), lab).result.outcome).toBe('passed')
})
