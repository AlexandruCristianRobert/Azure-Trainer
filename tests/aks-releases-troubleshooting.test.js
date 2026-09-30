import { expect, test } from 'vitest'
import { aksReleasesTroubleshootingLab as lab } from '../src/data/labs/aks-journey/releases-troubleshooting.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { verifyReleaseState } from '../src/lib/kubernetes/release-evidence.js'
import { getRolloutSummary } from '../src/lib/kubernetes/rollouts.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { act, executeAksSolution, executeReleaseRecovery } from './helpers/aks.js'
import { labById } from '../src/data/labs/index.js'
import { parse, stringify } from 'yaml'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { RELEASE_FILES } from '../src/data/templates/aks-python/releases.js'

const target = () => lab.scenarios['recover-v2'].target
const state = run => run.runtime.kubernetes.clusters[target().clusterId]
const seeds = new Map()
const initial = (attemptId = 'stalled-release') => {
  if (!seeds.has(attemptId)) seeds.set(attemptId, createBehavioralRun(lab, { attemptId }))
  return structuredClone(seeds.get(attemptId))
}
const done = (run, index) => evaluateLab(lab, run).tasks[index].done
let diagnosticCheckpoint
const diagnosed = () => structuredClone(diagnosticCheckpoint ??= lab.tasks.slice(0, 2).reduce((run, task) => executeAksSolution(run, lab, task), initial()))
const saveApply = (run, path, object) => {
  run = act(run, lab, { type: 'draft', path, text: stringify(object) }).run
  run = act(run, lab, { type: 'save-file', path }).run
  return act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
}

test('Lab20 seed publishes real v2 then stalls on an absent ConfigMap key while retained v1 serves', () => {
  const run = initial(); const s = state(run)
  expect(labById(lab.id)).toBe(lab)
  expect(lab.journeyOrder).toBe(20)
  const v2 = run.artifacts.buildsById[run.artifacts.publishedTags['acraksreleasestroubleshooting.azurecr.io/assistant:release-v2']]
  expect(v2.appSpec.version).toBe('2.0')
  expect(run.artifacts.sourceSnapshotsByHash[v2.sourceHash].files['app.py']).toBe(run.project.savedFiles['app.py'])
  expect(s.resources['ConfigMap/assistant/assistant-config'].data).toMatchObject({ ANSWER_DEPLOYMENT: 'answers-v1' })
  expect(s.resources['ConfigMap/assistant/assistant-config'].data.ANSWER_DEPLOYMENT_V2).toBeUndefined()
  const d = parse(run.project.savedFiles['k8s/deployment.yaml'])
  expect(d.spec.template.spec.containers[0].env.find(env => env.name === 'ANSWER_DEPLOYMENT').valueFrom.configMapKeyRef.key).toBe('ANSWER_DEPLOYMENT_V2')
  expect(getRolloutSummary(run, target())).toMatchObject({ complete: false, currentRevision: 2, available: 2 })
  expect(getRolloutSummary(run, target()).conditions.some(c => c.reason === 'ProgressDeadlineExceeded')).toBe(true)
  const pods = getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api')
  const ready = pods.filter(p => p.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True'))
  expect(ready).toHaveLength(2)
  expect(ready.every(pod => run.artifacts.buildsById[s.podSnapshots[pod.metadata.uid].artifactId].appSpec.version === '1.0')).toBe(true)
  expect(s.rollouts.deployments[s.resources['Deployment/assistant/assistant-api'].metadata.uid].revisions).toHaveLength(2)
  expect(pods.some(p => p.status.containerStatuses[0].state.waiting?.reason === 'CreateContainerConfigError')).toBe(true)
  expect(s.events.some(e => e.reason === 'CreateContainerConfigError' && e.message.includes('ANSWER_DEPLOYMENT_V2'))).toBe(true)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
  expect(lab.tasks.every((task, index) => !done(run, index))).toBe(true)
  for (const task of lab.tasks) {
    expect(task.hints).toHaveLength(2)
    expect(task.solution.steps.length).toBeGreaterThan(1)
    expect(task.examNote.length).toBeGreaterThan(20)
  }
})

test.each(['repair-reference', 'supply-key', 'undo-then-repair'])('all Tasks pass immediately through real recovery path %s', path => {
  const run = executeReleaseRecovery(initial(path), lab, path)
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(true)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
  if (path === 'undo-then-repair') expect(state(run).rollouts.receipts.at(-1).samples.some(sample => sample.status === 200
    && sample.rollout.complete && run.artifacts.buildsById[sample.artifactId]?.appSpec.version === '1.0')).toBe(true)
})

test('observation and diagnosis pass on current seeded incident before any repair', () => {
  let run = executeAksSolution(initial(), lab, lab.tasks[0])
  expect(done(run, 0)).toBe(true); expect(done(run, 1)).toBe(false)
  expect(state(run).rollouts.experiment).toMatchObject({ status: 'active', incidentSeen: true, deadlineSeen: true })
  const sample = state(run).rollouts.experiment.samples.at(-1)
  expect(sample).toMatchObject({ status: 200, release: null })
  expect(run.artifacts.buildsById[sample.artifactId].appSpec.version).toBe('1.0')
  run = executeAksSolution(run, lab, lab.tasks[1])
  expect(done(run, 1)).toBe(true)
  expect(done(run, 2)).toBe(false)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
})

test('rollback alone and successful stale v1 traffic cannot satisfy intended v2 recovery or final proof', () => {
  let run = diagnosed()
  run = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'recover-v2' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'recovered-v2' }).run
  expect(done(run, 2)).toBe(false)
  const sample = state(run).rollouts.receipts.at(-1).samples.at(-1)
  expect(run.artifacts.buildsById[sample.artifactId].appSpec.version).toBe('1.0')
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
  expect(run.project.savedFiles['k8s/deployment.yaml']).toContain('ANSWER_DEPLOYMENT_V2')
})

test('live-only repaired configuration cannot establish repeatable saved-file recovery', () => {
  let run = diagnosed(); const saved = run.project.savedFiles['k8s/configmap.yaml']
  const config = parse(saved); config.data.ANSWER_DEPLOYMENT_V2 = 'answers-v1'
  run = saveApply(run, 'k8s/configmap.yaml', config)
  run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text: saved }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'recover-v2' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'recovered-v2' }).run
  expect(done(run, 2)).toBe(true)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test.each(['answers-missing', ''])('supplying wrong answer key value %s fails real AI recovery', value => {
  let run = diagnosed(); const config = parse(run.project.savedFiles['k8s/configmap.yaml'])
  config.data.ANSWER_DEPLOYMENT_V2 = value
  run = saveApply(run, 'k8s/configmap.yaml', config)
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'recover-v2' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'recovered-v2' }).run
  expect(done(run, 2)).toBe(false)
})

test('diagnosis without matching event and diagnosis after undo fail', () => {
  let run = executeAksSolution(initial(), lab, lab.tasks[0])
  const copy = structuredClone(run); state(copy).events = []
  const noEvent = act(copy, lab, { type: 'aks-request', scenarioId: 'config-diagnosis' }).run
  expect(done(noEvent, 1)).toBe(false)
  run = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'config-diagnosis' }).run
  expect(done(run, 1)).toBe(false)
})

test('recovery cannot retroactively earn skipped configuration diagnosis', () => {
  let run = executeAksSolution(initial(), lab, lab.tasks[0])
  run = executeAksSolution(run, lab, lab.tasks[2])
  expect(state(run).rollouts.receipts.at(-1).outcome).toBe('passed')
  expect(done(run, 2)).toBe(false)
  run = act(run, lab, { type: 'aks-request', scenarioId: 'config-diagnosis' }).run
  expect(done(run, 1)).toBe(false)
})

test('configuration diagnosis requires a previously observed scope for the same active incident', () => {
  let run = act(initial(), lab, { type: 'aks-release-start', scenarioId: 'recover-v2' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'config-diagnosis' }).run
  expect(done(run, 0)).toBe(false); expect(done(run, 1)).toBe(false)
})

test.each(['ImageNotFound', 'Unhealthy', 'wrong-key'])('unrelated event evidence %s cannot earn configuration diagnosis', reason => {
  let run = executeAksSolution(initial(), lab, lab.tasks[0])
  const events = state(run).events
  if (reason === 'wrong-key') events.forEach(event => { event.message = event.message.replace('ANSWER_DEPLOYMENT_V2', 'OTHER_KEY') })
  else events.forEach(event => { event.reason = reason })
  run = act(run, lab, { type: 'aks-request', scenarioId: 'config-diagnosis' }).run
  expect(done(run, 1)).toBe(false)
})

test('malformed supplied key value is rejected before mutation and leaves the real current configuration error', () => {
  let run = diagnosed(); const config = parse(run.project.savedFiles['k8s/configmap.yaml'])
  config.data.ANSWER_DEPLOYMENT_V2 = { deployment: 'answers-v1' }
  run = act(run, lab, { type: 'save-file', path: 'k8s/configmap.yaml', text: stringify(config) }).run
  const result = applyRunAction(run, { type: 'command', line: 'kubectl apply -f k8s/configmap.yaml' }, lab)
  expect(result.diagnostics.length + result.lines.filter(line => line.kind === 'err').length).toBeGreaterThan(0)
  expect(state(result.run).resources['ConfigMap/assistant/assistant-config'].data.ANSWER_DEPLOYMENT_V2).toBeUndefined()
  expect(getRolloutSummary(result.run, target()).complete).toBe(false)
  expect(done(result.run, 2)).toBe(false)
})

test('restarted recovery observation cannot reuse the previous experiment diagnosis', () => {
  let run = diagnosed(); const original = state(run).rollouts.experiment.id
  run = act(run, lab, { type: 'aks-release-cancel' }).run
  run = act(run, lab, { type: 'aks-release-start', scenarioId: 'recover-v2' }).run
  expect(state(run).rollouts.experiment.id).not.toBe(original)
  expect(state(run).rollouts.experiment.incidentSeen).toBe(true)
  run = executeAksSolution(run, lab, lab.tasks[2])
  expect(state(run).rollouts.receipts.at(-1).outcome).toBe('passed')
  expect(done(run, 2)).toBe(false)
})

test('successful selected v2 traffic cannot hide a desired new Pod captured from a mutable tag rebuilt with v1', () => {
  let run = diagnosed(); const config = parse(run.project.savedFiles['k8s/configmap.yaml'])
  expect(done(run, 1)).toBe(true)
  config.data.ANSWER_DEPLOYMENT_V2 = 'answers-v1'
  run = saveApply(run, 'k8s/configmap.yaml', config)
  run = act(run, lab, { type: 'aks-advance', seconds: 5 }).run
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: RELEASE_FILES['app.py'] }).run
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasestroubleshooting --image assistant:release-v2 .' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'recover-v2' }).run
  const terminal = state(run).rollouts.receipts.at(-1).samples.at(-1)
  expect(state(run).rollouts.receipts.at(-1).outcome).toBe('failed')
  expect(terminal).toMatchObject({ status: 200, release: '2.0', rollout: { complete: true } })
  expect(terminal.backends.map(b => run.artifacts.buildsById[b.artifactId].appSpec.version).sort()).toEqual(['1.0', '2.0'])
  run = act(run, lab, { type: 'aks-request', scenarioId: 'recovered-v2' }).run
  expect(done(run, 2)).toBe(false)
})
