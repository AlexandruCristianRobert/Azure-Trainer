import { expect, test } from 'vitest'
import { parse, stringify } from 'yaml'
import { aksReleasesIndependentLab as lab } from '../src/data/labs/aks-journey/releases-independent.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { verifyReleaseState } from '../src/lib/kubernetes/release-evidence.js'
import { getRolloutSummary } from '../src/lib/kubernetes/rollouts.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { routeServiceRequest } from '../src/lib/kubernetes/connectivity.js'
import { labById, nextLabFor } from '../src/data/labs/index.js'
import { act, executeAksSolution, executeIndependentRelease } from './helpers/aks.js'
import { RELEASE_MANIFEST } from '../src/data/templates/aks-python/releases.js'

const target = () => lab.scenarios['release-v2'].target
const state = run => run.runtime.kubernetes.clusters[target().clusterId]
const initial = () => createBehavioralRun(lab, { attemptId: 'independent-release' })
const done = (run, index) => evaluateLab(lab, run).tasks[index].done
const checkpoints = new Map()
const through = index => {
  if (!checkpoints.has(index)) checkpoints.set(index, executeAksSolution(index ? through(index - 1) : initial(), lab, lab.tasks[index]))
  return structuredClone(checkpoints.get(index))
}

test('standalone Lab21 starts with three healthy v1 Pods and leaves policy for the learner', () => {
  const run = initial(); const deployment = parse(run.project.savedFiles['k8s/deployment.yaml'])
  expect(labById(lab.id)).toBe(lab)
  expect(nextLabFor(labById('aks-releases-troubleshooting'))).toBe(lab)
  expect(nextLabFor(lab)).toBe(labById('aks-diagnosis-guided'))
  expect(lab).toMatchObject({ journeyOrder: 21, labMode: 'independent', engineVersion: 2, contentVersion: 1 })
  expect(deployment.spec.replicas).toBe(3)
  for (const key of ['strategy', 'minReadySeconds', 'progressDeadlineSeconds', 'revisionHistoryLimit']) expect(deployment.spec[key]).toBeUndefined()
  expect(getRolloutSummary(run, target())).toMatchObject({ complete: true, desired: 3, available: 3, currentRevision: 1 })
  expect(Object.keys(run.project.savedFiles)).toHaveLength(13)
  expect(run.artifacts.publishedTags['acraksreleasesindependent.azurecr.io/assistant:release-missing']).toBeUndefined()
  expect(state(run).rollouts.receipts).toHaveLength(0)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
})

test.each([{ maxSurge: 1, maxUnavailable: 0 }, { maxSurge: '25%', maxUnavailable: '0%' }])('real traversal accepts resolved rolling budgets %j', strategy => {
  const run = executeIndependentRelease(initial(), lab, strategy)
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  const final = verifyReleaseState(run, lab, 'final-v2')
  expect(final.passed).toBe(true)
  expect(final.evidence.samples.map(({ question, answer, sources, release, artifactId }) => ({ question, answer, sources, release, artifactId }))).toEqual([
    { question: 'How long are backups kept?', answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], release: '2.0', artifactId: final.evidence.artifactId },
    { question: 'Who provides support?', answer: 'Contact the training desk for support.', sources: ['training-support'], release: '2.0', artifactId: final.evidence.artifactId },
  ])
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
  const pods = getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api')
  expect(pods).toHaveLength(3)
  const info = routeServiceRequest(run, { origin: { kind: 'external', clusterId: target().clusterId }, hostname: '192.0.2.10', port: 80, method: 'GET', path: '/api/info' }, lab)
  expect(info.outcome).toMatchObject({ status: 200, body: { version: '2.0' } })
  for (const e of state(run).rollouts.receipts.filter(e => e.outcome === 'passed')) {
    expect(e.samples.every(s => s.rollout.desired === 3 && s.rollout.available >= 3 && s.status === 200)).toBe(true)
    expect(e.samples.every(s => s.rolloutPolicy.surge <= 1 && s.rolloutPolicy.unavailable === 0)).toBe(true)
    expect(e.samples.every(s => s.rolloutPolicy.nonterminating <= 4)).toBe(true)
    expect(e.samples.some(s => s.rollout.terminating > 0)).toBe(true)
    for (const sample of e.samples.filter(s => s.release === '2.0')) {
      expect(sample.sources).toEqual([sample.question.startsWith('How') ? 'training-backups' : 'training-support'])
      expect(sample.answer).toBe(sample.question.startsWith('How') ? 'Training backups are kept for 30 days.' : 'Contact the training desk for support.')
      expect(sample.operations.map(o => o.operation)).toEqual(['embedding', 'postgres-query', 'answer'])
      expect(sample.operations.every(o => o.status === 'succeeded')).toBe(true)
      expect(sample.integrationTrace.sourceProvenance).toBe('rows')
    }
  }
  expect(pods.every(p => !state(run).rollouts.proofs[state(run).resources['Deployment/assistant/assistant-api'].metadata.uid].restart.beforePodUids.includes(p.metadata.uid))).toBe(true)
})

test('brief violations observed during release cannot be hidden by correcting only the terminal policy', () => {
  let run = through(1); const d = parse(lab.solutionFiles['k8s/deployment.yaml']); d.spec.minReadySeconds = 0
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(d) }).run
  run = act(run, lab, { type: 'aks-release-start', scenarioId: 'release-v2' }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 1 }).run
  d.spec.minReadySeconds = 5
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(d) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'release-v2' }).run
  expect(getRolloutSummary(run, target()).complete).toBe(true)
  expect(done(run, 2)).toBe(false)
})

test('same-time policy edits are observations even when replica and traffic state do not change', () => {
  let run = executeAksSolution(through(1), lab, { ...lab.tasks[2], solution: { steps: lab.tasks[2].solution.steps.filter(step => step.control !== 'finish') } })
  const d = parse(run.project.savedFiles['k8s/deployment.yaml'])
  for (const deadline of [121, 60]) {
    d.spec.progressDeadlineSeconds = deadline
    run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(d) }).run
    run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  }
  expect(state(run).rollouts.experiment.samples.some(sample => sample.rolloutPolicy.progressDeadlineSeconds === 121)).toBe(true)
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'release-v2' }).run
  expect(done(run, 2)).toBe(false)
})

test('healthy old v2 traffic cannot finish the current unpublished-image revision', () => {
  let run = through(3)
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'recover-v2' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'recovered-v2' }).run
  expect(state(run).rollouts.receipts.at(-1)).toMatchObject({ outcome: 'failed' })
  expect(done(run, 4)).toBe(false)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test('unpublished image creates actual waiting Pod/event/deadline while three v2 backends serve', () => {
  const run = through(3); const e = state(run).rollouts.experiment
  expect([0, 1, 2, 3].every(index => done(run, index))).toBe(true)
  expect(e).toMatchObject({ status: 'active', incidentSeen: true, deadlineSeen: true })
  expect(e.incident.reasons).toContain('ImageNotFound')
  expect(state(run).events.some(event => event.reason === 'ImageNotFound' && event.message.includes('release-missing'))).toBe(true)
  expect(getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api').some(p => p.status.containerStatuses[0].state.waiting?.reason === 'ImageNotFound')).toBe(true)
  expect(e.samples.at(-1)).toMatchObject({ status: 200, release: '2.0', rollout: { available: 3, complete: false } })
  expect(e.samples.at(-1).backends).toHaveLength(3)
  expect(getRolloutSummary(run, target()).conditions.some(c => c.reason === 'ProgressDeadlineExceeded')).toBe(true)
})

test('saved image correction is an equally valid recovery and all six Tasks pass immediately', () => {
  let run = initial()
  for (const [index, task] of lab.tasks.entries()) {
    run = executeAksSolution(run, lab, index === 4 ? { ...task, solution: task.solution.alternatives[0] } : task)
    expect(done(run, index), task.id).toBe(true)
  }
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(true)
})

test.each([
  ['replicas', 2], ['minReadySeconds', 0], ['progressDeadlineSeconds', 44], ['progressDeadlineSeconds', 121], ['revisionHistoryLimit', 1], ['maxUnavailable', 1], ['maxSurge', 2],
])('rejects a policy violating the independent brief: %s=%s', (key, value) => {
  let run = through(1); const d = parse(lab.solutionFiles['k8s/deployment.yaml'])
  if (key.startsWith('max')) d.spec.strategy.rollingUpdate[key] = value
  else d.spec[key] = value
  run = executeAksSolution(run, lab, { ...lab.tasks[2], solution: { steps: lab.tasks[2].solution.steps
    .filter(s => !(key === 'replicas' && s.control === 'finish'))
    .map(s => s.kind === 'file' ? { ...s, content: stringify(d) } : s) } })
  expect(done(run, 2)).toBe(false)
})

test.each([['cpu', '50m'], ['memory', '64Mi']])('lowering the fixed %s request cannot satisfy the independent brief', (resource, value) => {
  const d = parse(lab.solutionFiles['k8s/deployment.yaml'])
  d.spec.template.spec.containers[0].resources.requests[resource] = value
  const run = executeAksSolution(through(1), lab, { ...lab.tasks[2], solution: { steps: lab.tasks[2].solution.steps
    .map(step => step.kind === 'file' ? { ...step, content: stringify(d) } : step) } })
  expect(getRolloutSummary(run, target())).toMatchObject({ complete: true, available: 3 })
  expect(state(run).rollouts.receipts.at(-1).samples.every(sample => sample.rollout.available >= 3 && sample.status === 200)).toBe(true)
  expect(done(run, 2)).toBe(false)
  expect(verifyReleaseState(run, lab, 'final-v2')).toMatchObject({ passed: false, reason: expect.stringContaining('brief') })
})

test('correct release-v2 tag built from stale v1 source cannot earn publication or release', () => {
  let run = through(0)
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesindependent --image assistant:release-v2 .' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'published-v2' }).run
  expect(done(run, 1)).toBe(false)
  run = executeAksSolution(run, lab, lab.tasks[2]); expect(done(run, 2)).toBe(false)
})

test('successful recovery receipt cannot replace skipped incident Verify or backfill it after repair', () => {
  let run = executeAksSolution(through(2), lab, { ...lab.tasks[3], solution: { steps: lab.tasks[3].solution.steps.filter(s => s.scenarioId !== 'failed-revision') } })
  run = executeAksSolution(run, lab, lab.tasks[4])
  expect(state(run).rollouts.receipts.at(-1).outcome).toBe('passed')
  expect(done(run, 3)).toBe(false); expect(done(run, 4)).toBe(false)
  run = act(run, lab, { type: 'aks-request', scenarioId: 'failed-revision' }).run
  expect(done(run, 3)).toBe(false)
})

test('undo-only leaves saved missing tag and fails repeatability until witnessed apply/restart', () => {
  const run = through(4)
  expect(done(run, 4)).toBe(true)
  expect(run.project.savedFiles['k8s/deployment.yaml']).toContain('release-missing')
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
  expect(done(through(5), 5)).toBe(true)
})

test('cancel/retry allocates fresh epoch; reload retains active samples and requires matching diagnosis', () => {
  let run = through(3); const old = state(run).rollouts.experiment
  run = act(run, lab, { type: 'aks-release-cancel' }).run
  run = act(run, lab, lab.solutionActionResolvers['previous-healthy-release'](run)).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = executeAksSolution(run, lab, lab.tasks[3])
  const current = state(run).rollouts.experiment
  expect(current.incidentEpoch).toBeGreaterThan(old.incidentEpoch)
  run = JSON.parse(JSON.stringify(run)); expect(validateBehavioralRun(run, lab)).toBeTruthy()
  expect(state(run).rollouts.experiment.samples).toEqual(current.samples)
  run = executeAksSolution(run, lab, lab.tasks[4]); expect(done(run, 4)).toBe(true)
})

test.each(['app.py', 'k8s/deployment.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/service-external.yaml'])('current final proof invalidates edit/revert to %s', path => {
  let run = through(5); const saved = run.project.savedFiles[path]
  let changed = saved + '\n# changed source\n'
  if (path !== 'app.py') {
    const o = parse(saved)
    if (o.kind === 'Deployment') o.spec.minReadySeconds = 6
    if (o.kind === 'ConfigMap') o.data.APP_ENV = 'other'
    if (o.kind === 'Secret') o.stringData.PGPASSWORD = 'other'
    if (o.kind === 'Service') o.spec.selector.app = 'other'
    changed = stringify(o)
  }
  run = act(run, lab, { type: 'save-file', path, text: changed }).run
  run = act(run, lab, { type: 'save-file', path, text: saved }).run
  expect(done(run, 5)).toBe(false)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test('current final proof rejects stale info.version even when captured source and all AI answers are v2', () => {
  let run = initial()
  const source = lab.solutionFiles['app.py'].replace('def info():', 'INFO_VERSION = "1.0"\n\ndef info():')
    .replace('"version": SERVICE_VERSION', '"version": INFO_VERSION')
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: source }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesindependent --image assistant:release-v2 .' }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: lab.solutionFiles['k8s/deployment.yaml'] }).run
  for (const path of RELEASE_MANIFEST.kubernetesFiles) run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  for (const path of RELEASE_MANIFEST.kubernetesFiles) run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  const info = routeServiceRequest(run, { origin: { kind: 'external', clusterId: target().clusterId }, hostname: '192.0.2.10', port: 80, method: 'GET', path: '/api/info' }, lab)
  expect(info.outcome).toMatchObject({ status: 200, body: { version: '1.0' } })
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test('full ordinary traversal rejects rebinding the support question to backups despite successful provenance', () => {
  let run = initial()
  const source = lab.solutionFiles['app.py'].replace('question = question.strip()', 'question = "How long are backups kept?"')
  for (const task of lab.tasks) {
    run = executeAksSolution(run, lab, { ...task, solution: { ...task.solution, steps: task.solution.steps
      .filter(step => !['recovered-v2', 'final-v2'].includes(step.scenarioId))
      .map(step => step.kind === 'file' && step.path === 'app.py' ? { ...step, content: source } : step) } })
    if (['recovered-v2', 'final-v2'].includes(task.verification.scenarioId))
      run = applyRunAction(run, { type: 'aks-request', scenarioId: task.verification.scenarioId }, lab).run
  }
  const support = state(run).rollouts.receipts.flatMap(receipt => receipt.samples)
    .find(sample => sample.question === 'Who provides support?' && sample.release === '2.0')
  expect(support).toMatchObject({ status: 200, answer: 'Training backups are kept for 30 days.', sources: ['training-backups'], integrationTrace: { sourceProvenance: 'rows' } })
  expect(support.operations.map(operation => operation.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
  expect(done(run, 2)).toBe(false)
  expect(done(run, 4)).toBe(false)
  expect(done(run, 5)).toBe(false)
  expect(evaluateLab(lab, run).isComplete).toBe(false)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test('final live proof checks support separately even when backups and current v2 artifact are correct', () => {
  let run = initial()
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: lab.solutionFiles['app.py'].replace('question = question.strip()', 'question = "How long are backups kept?"') }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesindependent --image assistant:release-v2 .' }).run
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: lab.solutionFiles['k8s/deployment.yaml'] }).run
  for (const path of RELEASE_MANIFEST.kubernetesFiles) run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  for (const path of RELEASE_MANIFEST.kubernetesFiles) run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  expect(getRolloutSummary(run, target())).toMatchObject({ complete: true, available: 3 })
  const support = routeServiceRequest(run, { origin: { kind: 'external', clusterId: target().clusterId }, hostname: '192.0.2.10', port: 80,
    method: 'POST', path: '/api/ask', body: { question: 'Who provides support?' } }, lab)
  expect(support.outcome.status).toBe(200)
  expect(support.outcome.body.release).toBe('2.0')
  expect(support.outcome.dependencyTrace.map(operation => operation.status)).toEqual(['succeeded', 'succeeded', 'succeeded'])
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test('correct terminal answers cannot erase earlier wrong successful release samples', () => {
  let run = through(1)
  const source = lab.solutionFiles['app.py'].replace('question = question.strip()', 'question = "How long are backups kept?"')
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: source }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesindependent --image assistant:release-v2 .' }).run
  run = executeAksSolution(run, lab, { ...lab.tasks[2], solution: { steps: lab.tasks[2].solution.steps.filter(step => step.control !== 'finish') } })
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: lab.solutionFiles['app.py'] }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesindependent --image assistant:release-v2 .' }).run
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  expect(state(run).rollouts.experiment.terminalSinceMs).not.toBeNull()
  expect(state(run).rollouts.experiment.samples.some(sample => sample.question === 'Who provides support?' && sample.status === 200 && sample.answer === 'Training backups are kept for 30 days.')).toBe(true)
  expect(state(run).rollouts.experiment.samples.slice(-2).map(sample => sample.answer)).toEqual(expect.arrayContaining(['Training backups are kept for 30 days.', 'Contact the training desk for support.']))
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'release-v2' }).run
  expect(done(run, 2)).toBe(false)
})
