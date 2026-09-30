import { expect, test } from 'vitest'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { releaseTestRun, applyReleaseTemplate as applyTemplate } from './helpers/aks.js'
import { advanceKubernetesTime } from '../src/lib/kubernetes/time.js'
import { validateKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { parse, stringify } from 'yaml'

import { target, lab, state, action, start } from './helpers/release-evidence.js'
import { releaseDependencies, verifyReleaseState } from '../src/lib/kubernetes/release-evidence.js'
import { observeReleaseTimestamp } from '../src/lib/kubernetes/release-experiments.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
const applyReleaseTemplate = (run, options = {}) => applyTemplate(run, options, lab)

test('release start observes actual three-stage answers and all captured backend artifacts without advancing time', () => {
  const input = releaseTestRun(); const run = start(input); const e = state(run).rollouts.experiment
  expect(run.runtime.simTimeMs).toBe(15000)
  expect(e).toMatchObject({ status: 'active', phase: 'baseline', attemptId: 'release-test', baselineReplicas: 2, incidentEpoch: 1 })
  expect(e.samples).toHaveLength(1)
  expect(e.samples[0]).toMatchObject({ transport: { ok: true }, status: 200, sources: ['training-backups'] })
  expect(e.samples[0].operations.map(item => item.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
  expect(e.samples[0].backends).toHaveLength(2)
  expect(e.samples[0].backends.every(item => item.revision === 1 && item.artifactId && item.digest)).toBe(true)
  expect(JSON.stringify(e)).not.toContain('training-only-password')
})

test('early finish retains failed receipt and strict cancellation releases the active slot', () => {
  let run = start()
  const forged = applyRunAction(run, { type: 'aks-release-cancel', reason: 'passed' }, lab)
  expect(forged.diagnostics[0].code).toBe('INVALID_AKS_ACTION')
  run = action(run, { type: 'aks-release-finish', scenarioId: 'release-v2' })
  expect(state(run).rollouts.receipts.at(-1)).toMatchObject({ outcome: 'failed', phase: 'finished' })
  run = start(run); run = action(run, { type: 'aks-release-cancel' })
  expect(state(run).rollouts.experiment).toMatchObject({ status: 'cancelled', cancellationReason: 'learner-cancelled' })
  expect(start(run).runtime.simTimeMs).toBe(15000)
})

test('old successful traffic cannot hide stalled new Pods; actual deadline creates incident and repair recovers', () => {
  let run = start(releaseTestRun({ progressDeadlineSeconds: 20 }), 'recover-v2')
  run = applyReleaseTemplate(run, { readinessPath: '/health/missing' })
  run = advanceKubernetesTime(run, 25, lab)
  expect(state(run).rollouts.experiment).toMatchObject({ phase: 'incident-seen', incidentSeen: true, deadlineSeen: true })
  expect(state(run).rollouts.experiment.samples.at(-1).status).toBe(200)
  run = applyReleaseTemplate(run, {})
  run = advanceKubernetesTime(run, 110, lab)
  run = action(run, { type: 'aks-release-finish', scenarioId: 'recover-v2' })
  expect(state(run).rollouts.receipts.at(-1).outcome).toBe('passed')
})

test('stream resumes after reload with identical observations for partitioned clock advances', () => {
  const initial = start()
  const one = advanceKubernetesTime(initial, 12, lab)
  let chunks = advanceKubernetesTime(initial, 5, lab)
  chunks = advanceKubernetesTime(JSON.parse(JSON.stringify(chunks)), 7, lab)
  expect(state(chunks).rollouts.experiment).toEqual(state(one).rollouts.experiment)
  expect(state(one).rollouts.experiment.samples).toHaveLength(13)
  expect(validateKubernetesRuntime(chunks.runtime.kubernetes, chunks, lab)).toBe(true)
})

test('300 second expiry keeps earliest samples and fails instead of claiming terminal success', () => {
  let run = start(); run = advanceKubernetesTime(run, 300, lab)
  const receipt = state(run).rollouts.receipts.at(-1)
  expect(receipt).toMatchObject({ outcome: 'failed', reason: 'experiment-expired', startedAtMs: 15000, endedAtMs: 315000 })
  expect(receipt.samples[0].atMs).toBe(15000)
  expect(receipt.samples.length).toBeLessThanOrEqual(1200)
})

test('final proof rejects saved source edits, undeployed artifacts, stale YAML and unwitnessed restarts with repair hints', async () => {
  const { verifyReleaseState } = await import('../src/lib/kubernetes/release-evidence.js')
  let run = advanceKubernetesTime(applyReleaseTemplate(releaseTestRun({ graceSeconds: 1 })), 45, lab)
  expect(verifyReleaseState(run, lab, 'final-v2')).toMatchObject({ passed: false, reason: expect.stringMatching(/reapply.*restart/i) })
  const changedSource = action(run, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'] + '\n# saved after build\n' })
  expect(verifyReleaseState(changedSource, lab, 'final-v2').reason).toMatch(/rebuild/i)
  let published = action(changedSource, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v2 .' })
  expect(verifyReleaseState(published, lab, 'final-v2').reason).toMatch(/deploy.*artifact|restart.*artifact/i)
  const yaml = parse(run.project.savedFiles['k8s/deployment.yaml']); yaml.spec.template.spec.containers[0].readinessProbe.httpGet.path = '/health/missing'
  const stale = action(run, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(yaml) })
  expect(verifyReleaseState(stale, lab, 'final-v2').reason).toMatch(/saved Deployment.*apply/i)
  const config = parse(run.project.savedFiles['k8s/configmap.yaml']); config.data.APP_ENV = 'new-setting'
  let configRun = action(run, { type: 'save-file', path: 'k8s/configmap.yaml', text: stringify(config) })
  expect(verifyReleaseState(configRun, lab, 'final-v2').reason).toMatch(/configuration.*apply/i)
  configRun = action(configRun, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' })
  expect(verifyReleaseState(configRun, lab, 'final-v2').reason).toMatch(/captured configuration.*restart/i)
})

test('final reapply and subsequent restart prove new Pods; relevant edit/revert invalidates witness', async () => {
  const { verifyReleaseState } = await import('../src/lib/kubernetes/release-evidence.js')
  let run = advanceKubernetesTime(applyReleaseTemplate(releaseTestRun({ graceSeconds: 1 })), 45, lab)
  for (const path of ['k8s/deployment.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/service-internal.yaml', 'k8s/service-external.yaml']) {
    if (run.project.savedFiles[path]) run = action(run, { type: 'command', line: `kubectl apply -f ${path}` })
  }
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
  run = action(run, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' })
  run = advanceKubernetesTime(run, 45, lab)
  const result = verifyReleaseState(run, lab, 'final-v2')
  expect(result.passed, result.reason + JSON.stringify(state(run).rollouts.proofs)).toBe(true)
  expect(result.evidence.podUids).toHaveLength(2)
  const input = structuredClone(run); verifyReleaseState(run, lab, 'final-v2'); expect(run).toEqual(input)
  const saved = run.project.savedFiles['app.py']
  run = action(run, { type: 'save-file', path: 'app.py', text: saved + '\n# edit\n' })
  run = action(run, { type: 'save-file', path: 'app.py', text: saved })
  expect(verifyReleaseState(run, lab, 'final-v2').reason).toMatch(/reapply.*restart/i)
})

test('zero endpoints retains real transport failure and competitors cannot occupy the release slot', () => {
  const initial = releaseTestRun(); const service = parse(initial.project.savedFiles['k8s/service-external.yaml'])
  const path = 'k8s/service-external.yaml'
  service.spec.selector = { app: 'missing' }
  let run = action(initial, { type: 'save-file', path, text: stringify(service) })
  run = action(run, { type: 'command', line: `kubectl apply -f ${path}` })
  run = start(run)
  expect(state(run).rollouts.experiment.samples[0]).toMatchObject({ transport: { ok: false, reason: 'NO_READY_ENDPOINTS' }, status: null })
  expect(applyRunAction(run, { type: 'aks-release-start', scenarioId: 'recover-v2' }, lab).diagnostics[0].message).toMatch(/already active/i)
  lab.scenarios.probe = { kind: 'aks-probe', version: 1, durationSeconds: 60, target, script: { durationSeconds: 60 } }
  expect(applyRunAction(run, { type: 'aks-probe-start', scenarioId: 'probe' }, lab).diagnostics[0].message).toMatch(/release experiment.*active/i)
  delete lab.scenarios.probe
})

test('saved release validation rejects forged identity, timestamps, samples and limits', () => {
  const run = start()
  for (const change of [e => { e.attemptId = 'another-attempt' }, e => { e.baselineReplicas = 0 }, e => { e.baselineReplicas = 3 }, e => { e.incidentEpoch = -1 }, e => { e.startedAtMs = -1 }, e => { e.samples[0].atMs = e.startedAtMs - 1 }, e => { e.samples[0].environment = { PASSWORD: 'leak' } }, e => { e.samples = Array(1201).fill(e.samples[0]) }]) {
    const copy = structuredClone(run); change(state(copy).rollouts.experiment)
    expect(validateKubernetesRuntime(copy.runtime.kubernetes, copy, lab)).toBe(false)
  }
})

test('image/config failures need real event plus deadline and cannot be forged by start controls', () => {
  let run = start(releaseTestRun({ progressDeadlineSeconds: 10 }), 'recover-v2')
  const doc = parse(run.project.savedFiles['k8s/deployment.yaml']); doc.spec.template.spec.containers[0].image = 'acraksreleasesguided.azurecr.io/assistant:unpublished'
  run = action(run, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(doc) })
  run = action(run, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' })
  expect(state(run).rollouts.experiment.incidentSeen).toBe(false)
  run = advanceKubernetesTime(run, 10, lab)
  expect(state(run).rollouts.experiment).toMatchObject({ incidentSeen: true, deadlineSeen: true })
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test('structural same-time changes add samples; unchanged reads and reload do not duplicate them', () => {
  let run = start()
  run = applyReleaseTemplate(run, {})
  const e = state(run).rollouts.experiment
  expect(e.samples.filter(sample => sample.atMs === 15000)).toHaveLength(2)
  const copy = JSON.parse(JSON.stringify(run))
  expect(observeReleaseTimestamp(copy, 15000, lab)).toEqual(copy)
  expect(action(run, { type: 'command', line: 'kubectl rollout status deployment/assistant-api -n assistant --watch=false' }).runtime).toEqual(run.runtime)
})

test('target deletion, replica scaling and namespace change cancel with precise reasons', () => {
  for (const [line, reason] of [['kubectl delete deployment assistant-api -n assistant', 'target-deleted'], ['kubectl scale deployment/assistant-api --replicas 3 -n assistant', 'desired-replicas-changed'], ['kubectl config set-context --current --namespace=assistant', 'context-or-namespace-changed']]) {
    const run = action(start(), { type: 'command', line })
    expect(state(run).rollouts.experiment).toMatchObject({ status: 'cancelled', cancellationReason: reason, baselineReplicas: 2 })
    expect(validateKubernetesRuntime(JSON.parse(JSON.stringify(run.runtime.kubernetes)), run, lab)).toBe(true)
  }
})

test('finished receipt cap keeps forty immutable results and preserves earliest samples within each', () => {
  let run = releaseTestRun()
  for (let index = 0; index < 42; index++) { run = start(run); run = action(run, { type: 'aks-release-finish', scenarioId: 'release-v2' }) }
  expect(state(run).rollouts.receipts).toHaveLength(40)
  expect(state(run).rollouts.receipts.every(receipt => receipt.samples[0].atMs === 15000 && receipt.outcome === 'failed')).toBe(true)
  expect(validateKubernetesRuntime(run.runtime.kubernetes, run, lab)).toBe(true)
})

test('recovery milestone records engine evidence once and stays current across later edits and retry receipts', () => {
  const scopedLab = { ...lab, tasks: [...lab.tasks, { id: 'release-proof', verification: { scenarioId: 'release-v2', scenarioVersion: 1 },
    dependencies: releaseDependencies(target, { historical: true, scenarioId: 'release-v2', incidentEpoch: 1 }), check: () => true }] }
  let run = applyRunAction(releaseTestRun({ graceSeconds: 1 }), { type: 'aks-release-start', scenarioId: 'release-v2' }, scopedLab).run
  run = applyReleaseTemplate(run, {})
  run = advanceKubernetesTime(run, 45, scopedLab)
  const finished = applyRunAction(run, { type: 'aks-release-finish', scenarioId: 'release-v2' }, scopedLab)
  expect(finished.diagnostics).toEqual([]); run = finished.run
  expect(evaluateLab(scopedLab, run).tasks.find(task => task.id === 'release-proof')).toMatchObject({ done: true })
  const evidenceId = run.evidence.currentEvidenceByTask['release-proof']; const source = run.project.savedFiles['app.py']
  run = applyRunAction(run, { type: 'save-file', path: 'app.py', text: source + '\n# later incident\n' }, scopedLab).run
  expect(run.evidence.currentEvidenceByTask['release-proof']).toBe(evidenceId)
  expect(evaluateLab(scopedLab, run).tasks.find(task => task.id === 'release-proof').done).toBe(true)
  run = applyRunAction(run, { type: 'aks-release-start', scenarioId: 'release-v2' }, scopedLab).run
  const selector = Object.values(scopedLab.tasks.at(-1).dependencies)[0]
  const prior = selector(run)
  run = applyRunAction(run, { type: 'aks-release-finish', scenarioId: 'release-v2' }, scopedLab).run
  expect(selector(run)).toEqual(prior)
})

test('a supplied stalled revision is observable without recreating the failure or mutating the Deployment', () => {
  let run = applyReleaseTemplate(releaseTestRun({ progressDeadlineSeconds: 10 }), { readinessPath: '/health/missing' })
  run = advanceKubernetesTime(run, 20, lab)
  const before = structuredClone(state(run).resources)
  run = start(run, 'recover-v2')
  expect(state(run).resources).toEqual(before)
  expect(state(run).rollouts.experiment).toMatchObject({ changedTemplate: true, incidentSeen: true, deadlineSeen: true })
  expect(state(run).rollouts.experiment.incident.reasons).toContain('readiness')
})

test('final Verify records the engine shape and returns a concrete repair message for an incomplete proof', () => {
  const scopedLab = { ...lab, tasks: [...lab.tasks, { id: 'final-proof', verification: { scenarioId: 'final-v2', scenarioVersion: 1 }, dependencies: releaseDependencies(target), check: () => true }] }
  const result = applyRunAction(releaseTestRun(), { type: 'aks-request', scenarioId: 'final-v2' }, scopedLab)
  expect(result.diagnostics).toEqual([])
  const proof = result.run.evidence.experimentsById[result.run.evidence.currentEvidenceByTask['final-proof']]
  expect(proof).toMatchObject({ outcome: 'failed', completed: false, scenarioId: 'final-v2', scenarioVersion: 1, startedAtMs: 15000, endedAtMs: 15000 })
  expect(result.lines[0].text).toMatch(/2.0|rebuild/i)
})

test('missing saved Service cannot pass final repeatability after a new reapply/restart witness', async () => {
  let run = advanceKubernetesTime(applyReleaseTemplate(releaseTestRun({ graceSeconds: 1 })), 45, lab)
  run = action(run, { type: 'save-file', path: 'k8s/service-internal.yaml', text: '# missing internal Service\n' })
  for (const path of ['k8s/deployment.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/service-internal.yaml', 'k8s/service-external.yaml'])
    run = action(run, { type: 'command', line: `kubectl apply -f ${path}` })
  run = action(run, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' })
  run = advanceKubernetesTime(run, 45, lab)
  expect(verifyReleaseState(run, lab, 'final-v2')).toMatchObject({ passed: false, reason: expect.stringMatching(/saved.*configuration\/Services|saved.*Service/i) })
})

test('Secret-derived response environment never enters samples or exports under an ordinary environment name', () => {
  let run = releaseTestRun({ graceSeconds: 1 })
  // The named release formatter supports environment bindings. Exercise the
  // provenance boundary with a Secret-backed binding, then route real traffic.
  const yaml = parse(run.project.savedFiles['k8s/deployment.yaml'])
  const setting = yaml.spec.template.spec.containers[0].env.find(item => item.name === 'APP_ENV')
  setting.valueFrom = { secretKeyRef: { name: 'assistant-credentials', key: 'PGPASSWORD' } }
  run = action(run, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(yaml) })
  run = action(run, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' })
  run = advanceKubernetesTime(run, 45, lab)
  run = start(run)
  run = action(run, { type: 'aks-release-finish', scenarioId: 'release-v2' })
  expect(JSON.stringify(state(run).rollouts.receipts)).not.toContain('training-only-password')
  expect(JSON.stringify(state(run).rollouts.receipts)).not.toContain('environment')
})

test('live undo alone cannot certify final v2 while the saved manifest remains faulty', () => {
  let run = applyReleaseTemplate(releaseTestRun({ graceSeconds: 1 }), { readinessPath: '/health/missing' })
  run = action(run, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant --to-revision=1' })
  run = advanceKubernetesTime(run, 45, lab)
  expect(verifyReleaseState(run, lab, 'final-v2')).toMatchObject({ passed: false, reason: expect.stringMatching(/2.0|rebuild/i) })
  expect(run.project.savedFiles['k8s/deployment.yaml']).toContain('/health/missing')
})

test('finish requires the full ten terminal seconds even after all new Pods are available', () => {
  const initial = applyReleaseTemplate(start(releaseTestRun({ graceSeconds: 1 })), {})
  let early = advanceKubernetesTime(initial, 40, lab)
  expect(state(early).rollouts.experiment.terminalSinceMs).toBe(46000)
  early = action(early, { type: 'aks-release-finish', scenarioId: 'release-v2' })
  expect(state(early).rollouts.receipts.at(-1).outcome).toBe('failed')
  let sufficient = advanceKubernetesTime(initial, 41, lab)
  sufficient = action(sufficient, { type: 'aks-release-finish', scenarioId: 'release-v2' })
  expect(state(sufficient).rollouts.receipts.at(-1).outcome).toBe('passed')
})

test('release incident lookup enforces attempt, target UID and incident epoch identity', async () => {
  const { releaseIncidentObservation } = await import('../src/lib/kubernetes/release-evidence.js')
  let run = applyReleaseTemplate(releaseTestRun({ progressDeadlineSeconds: 10 }), { readinessPath: '/health/missing' })
  run = start(advanceKubernetesTime(run, 20, lab), 'recover-v2')
  expect(releaseIncidentObservation(run, lab, 'recover-v2')).toMatchObject({ incidentEpoch: 2, deploymentUid: 'kube-5' })
  for (const [key, value] of [['attemptId', 'other'], ['deploymentUid', 'another-target'], ['incidentEpoch', 3]]) {
    const copy = structuredClone(run); state(copy).rollouts.experiment[key] = value
    expect(releaseIncidentObservation(copy, lab, 'recover-v2')).toBe(null)
  }
})

test('only a successful unrelated incident advance cancels active release observation', async () => {
  const { aksAiTroubleshootingLab } = await import('../src/data/labs/aks-journey/ai-troubleshooting.lab.js')
  const { createBehavioralRun } = await import('../src/lib/labEngine/run.js')
  const { executeAksSolution } = await import('./helpers/aks.js')
  const { AI_TROUBLESHOOTING_CLUSTER_ID } = await import('../src/data/labs/aks-journey/integration-incidents.js')
  const incidentTarget = { clusterId: AI_TROUBLESHOOTING_CLUSTER_ID, namespace: 'assistant', deploymentName: 'assistant', serviceName: 'assistant-public' }
  const scopedLab = { ...aksAiTroubleshootingLab, capabilities: { ...aksAiTroubleshootingLab.capabilities, kubernetesRollouts: true },
    scenarios: { ...aksAiTroubleshootingLab.scenarios, 'release-v2': { ...lab.scenarios['release-v2'], target: incidentTarget } } }
  let run = createBehavioralRun(scopedLab, { attemptId: 'release-with-incident' })
  run = applyRunAction(run, { type: 'aks-release-start', scenarioId: 'release-v2' }, scopedLab).run
  const rejected = applyRunAction(run, { type: 'aks-integration-next-incident' }, scopedLab)
  expect(rejected.diagnostics.length).toBeGreaterThan(0)
  expect(rejected.run.runtime.kubernetes.clusters[incidentTarget.clusterId].rollouts.experiment.status).toBe('active')
  for (const task of scopedLab.tasks.slice(0, 2)) run = executeAksSolution(run, scopedLab, task)
  run = advanceKubernetesTime(run, 60, scopedLab)
  const advanced = applyRunAction(run, { type: 'aks-integration-next-incident' }, scopedLab)
  expect(advanced.diagnostics).toEqual([])
  expect(advanced.run.runtime.kubernetes.integrationIncident.phase).toBe('filter')
  expect(advanced.run.runtime.kubernetes.clusters[incidentTarget.clusterId].rollouts.experiment).toMatchObject({ status: 'cancelled', cancellationReason: 'unrelated-fault-started' })
})

test('captured configuration identity must match even when its resource version matches', () => {
  let run = advanceKubernetesTime(applyReleaseTemplate(releaseTestRun({ graceSeconds: 1 })), 45, lab)
  // A persisted container snapshot is immutable provenance, not merely a
  // lookup by object name/version. A mismatched captured UID cannot be reused.
  run = JSON.parse(JSON.stringify(run))
  for (const snapshot of Object.values(state(run).podSnapshots)) for (const ref of snapshot.configRefs ?? [])
    if (ref.kind === 'ConfigMap') ref.uid = 'earlier-config-object'
  expect(verifyReleaseState(run, lab, 'final-v2').reason).toMatch(/captured configuration.*restart/i)
})

test('current final dependencies change when availability changes without replacing any Pod', async () => {
  const { getRolloutSummary } = await import('../src/lib/kubernetes/rollouts.js')
  const dependencies = releaseDependencies(target)
  const select = Object.values(dependencies)[0]
  let run = applyReleaseTemplate(releaseTestRun({ graceSeconds: 1 }))
  let found = false
  for (let index = 0; index < 45; index++) {
    const before = select(run); const summary = getRolloutSummary(run, target)
    run = advanceKubernetesTime(run, 1, lab)
    const after = select(run)
    if (JSON.stringify(before.podUids) === JSON.stringify(after.podUids) && JSON.stringify(summary) !== JSON.stringify(getRolloutSummary(run, target))) {
      expect(after).not.toEqual(before)
      found = true
      break
    }
  }
  expect(found).toBe(true)
})

test('a same-time Service routing transition observes the actual failure before another clock tick', () => {
  let run = start()
  const service = parse(run.project.savedFiles['k8s/service-external.yaml'])
  service.spec.selector = { app: 'missing' }
  run = action(run, { type: 'save-file', path: 'k8s/service-external.yaml', text: stringify(service) })
  expect(state(run).rollouts.experiment.samples).toHaveLength(1)
  run = action(run, { type: 'command', line: 'kubectl apply -f k8s/service-external.yaml' })
  expect(state(run).rollouts.experiment.samples).toHaveLength(2)
  expect(state(run).rollouts.experiment.samples.at(-1)).toMatchObject({ atMs: 15000, transport: { ok: false }, backends: [] })
  const before = JSON.stringify(run.runtime)
  run = action(run, { type: 'command', line: 'kubectl get services -n assistant' })
  expect(JSON.stringify(run.runtime)).toBe(before)
})
