import { expect, test } from 'vitest'
import { aksReleasesGuidedLab as lab } from '../src/data/labs/aks-journey/releases-guided.lab.js'
import { createBehavioralRun, validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { verifyReleaseState } from '../src/lib/kubernetes/release-evidence.js'
import { getRolloutSummary } from '../src/lib/kubernetes/rollouts.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { act, executeAksSolution } from './helpers/aks.js'
import { labById } from '../src/data/labs/index.js'
import { parse, stringify } from 'yaml'

const target = () => lab.scenarios['release-v2'].target
const state = run => run.runtime.kubernetes.clusters[target().clusterId]
const initial = () => createBehavioralRun(lab, { attemptId: 'guided-release' })
const done = (run, index) => evaluateLab(lab, run).tasks.find(task => task.id === lab.tasks[index].id).done
const checkpoints = new Map()
const through = index => {
  if (checkpoints.has(index)) return structuredClone(checkpoints.get(index))
  let run = index === 0 ? initial() : through(index - 1)
  run = executeAksSolution(run, lab, lab.tasks[index]); checkpoints.set(index, run)
  return structuredClone(run)
}

test('registered standalone Lab19 starts with two Available captured v1 Pods and complete learner help', () => {
  const run = initial()
  expect(labById('aks-releases-guided')).toBe(lab)
  expect(lab).toMatchObject({ journeyOrder: 19, journeyId: 'aks-knowledge-assistant', engineVersion: 2, contentVersion: 1, service: 'aks', labMode: 'guided' })
  expect(lab.tasks.map(task => task.verification.scenarioId)).toEqual(['baseline-v1', 'published-v2', 'release-v2', 'failed-revision', 'recovered-v2', 'final-v2'])
  for (const task of lab.tasks) {
    expect(task.hints).toHaveLength(2)
    expect(task.explanation.length).toBeGreaterThan(30)
    expect(task.examNote.length).toBeGreaterThan(20)
    expect(task.solution.steps.length).toBeGreaterThan(1)
  }
  expect(Object.keys(run.project.savedFiles)).toHaveLength(13)
  expect(run.project.savedFiles['k8s/hpa.yaml']).toBeUndefined()
  expect(getRolloutSummary(run, target())).toMatchObject({ complete: true, available: 2, currentRevision: 1 })
  const pods = getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api')
  expect(pods).toHaveLength(2)
  expect(pods.every(pod => run.artifacts.buildsById[state(run).podSnapshots[pod.metadata.uid].artifactId].appSpec.version === '1.0')).toBe(true)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
})

test('every real Guided Solution immediately completes its Task and the complete Lab Result', () => {
  let run = initial()
  for (const [index, task] of lab.tasks.entries()) {
    run = executeAksSolution(run, lab, task)
    expect(done(run, index), task.id + JSON.stringify(evaluateLab(lab, run).tasks[index])).toBe(true)
    expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
    checkpoints.set(index, run)
  }
  expect(evaluateLab(lab, run).isComplete).toBe(true)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(true)
})

test('publication captures current source without changing the running v1 artifact; skipped rebuild fails', () => {
  let run = through(0)
  const noBuild = { ...lab.tasks[1], solution: { steps: lab.tasks[1].solution.steps.filter(step => step.kind !== 'command' || !step.line?.startsWith('az acr build')) } }
  run = executeAksSolution(run, lab, noBuild)
  expect(done(run, 1)).toBe(false)
  run = executeAksSolution(run, lab, lab.tasks[1])
  expect(done(run, 1)).toBe(true)
  expect(getRolloutSummary(run, target()).currentRevision).toBe(1)
  const pods = getDeploymentPods(run, target().clusterId, 'assistant', 'assistant-api')
  expect(pods.every(pod => state(run).podSnapshots[pod.metadata.uid].artifactId === run.artifacts.publishedTags['acraksreleasesguided.azurecr.io/assistant:release-v1'])).toBe(true)
})

test('failed exercise observes real new-Pod readiness and deadline while healthy old v2 traffic continues', () => {
  const run = through(3); const e = state(run).rollouts.experiment
  expect(e).toMatchObject({ scenarioId: 'recover-v2', status: 'active', incidentSeen: true, deadlineSeen: true })
  expect(e.incident.reasons).toContain('readiness')
  expect(e.samples.at(-1)).toMatchObject({ status: 200, release: '2.0' })
  expect(e.samples.at(-1).rollout.complete).toBe(false)
  expect(done(run, 3)).toBe(true)
  expect(done(run, 4)).toBe(false)
  expect(done(run, 2)).toBe(true)
})

test('premature recovery finish fails and live undo does not repair the saved readiness manifest', () => {
  let run = through(3)
  const undo = lab.solutionActionResolvers['previous-healthy-release'](run)
  run = act(run, lab, undo).run
  run = act(run, lab, { type: 'aks-release-finish', scenarioId: 'recover-v2' }).run
  run = act(run, lab, { type: 'aks-request', scenarioId: 'recovered-v2' }).run
  expect(done(run, 4)).toBe(false)
  run = through(4)
  expect(done(run, 4)).toBe(true)
  expect(run.project.savedFiles['k8s/deployment.yaml']).toContain('/health/missing')
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test('fresh recovery attempts allocate a distinct incident epoch and require a newly observed stall', () => {
  let run = through(3); const oldEpoch = state(run).rollouts.experiment.incidentEpoch
  run = act(run, lab, { type: 'aks-release-cancel' }).run
  run = act(run, lab, { type: 'aks-release-start', scenarioId: 'recover-v2' }).run
  expect(state(run).rollouts.experiment.incidentEpoch).toBeGreaterThan(oldEpoch)
  expect(state(run).rollouts.experiment.incidentSeen).toBe(false)
})

test('saved fresh recovery identity cannot replay the previous attempt incident epoch', () => {
  let run = act(initial(), lab, { type: 'aks-release-start', scenarioId: 'recover-v2' }).run
  const epoch = state(run).rollouts.experiment.incidentEpoch
  run = act(run, lab, { type: 'aks-release-cancel' }).run
  run = act(run, lab, { type: 'aks-release-start', scenarioId: 'recover-v2' }).run
  const copy = structuredClone(run); state(copy).rollouts.experiment.incidentEpoch = epoch
  expect(() => validateBehavioralRun(copy, lab)).toThrow(/Kubernetes runtime/)
})

test('healthy old ReplicaSet requests cannot complete a release with the current ReplicaSet unready', () => {
  let run = through(1)
  const steps = lab.tasks[2].solution.steps.filter(step => !step.line?.startsWith('kubectl rollout status'))
    .map(step => step.kind === 'file' ? { ...step, content: step.content.replace('/health/ready', '/health/missing') } : step)
  run = executeAksSolution(run, lab, { ...lab.tasks[2], solution: { steps } })
  expect(state(run).rollouts.receipts.at(-1).samples.at(-1).status).toBe(200)
  expect(state(run).rollouts.receipts.at(-1).outcome).toBe('failed')
  expect(done(run, 2)).toBe(false)
})

test('rollback resolver uses the actual preceding healthy revision after an extra restart', () => {
  let run = through(2)
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  run = act(run, lab, { type: 'aks-advance', seconds: 90 }).run
  expect(getRolloutSummary(run, target()).currentRevision).toBe(3)
  run = executeAksSolution(run, lab, lab.tasks[3])
  const action = lab.solutionActionResolvers['previous-healthy-release'](run)
  expect(action.line).toContain('--to-revision=3')
  run = act(run, lab, action).run
  expect(getRolloutSummary(run, target()).currentRevision).toBe(5)
  expect(run.project.savedFiles['k8s/deployment.yaml']).toContain('/health/missing')
})

test('historical milestones survive future edits but missing or mismatched receipts cannot fabricate them', () => {
  let run = through(5)
  const ids = { ...run.evidence.currentEvidenceByTask }
  run = act(run, lab, { type: 'save-file', path: 'app.py', text: run.project.savedFiles['app.py'] + '\n# later edit\n' }).run
  expect([0, 1, 2, 3, 4].every(index => done(run, index))).toBe(true)
  expect(done(run, 5)).toBe(false)
  expect(run.evidence.currentEvidenceByTask).toEqual(ids)
  const clean = initial()
  expect(lab.tasks.every((task, index) => !done(clean, index))).toBe(true)
  for (const index of [0, 1, 3, 4]) {
    const copy = structuredClone(run)
    copy.evidence.experimentsById[ids[lab.tasks[index].id]].measurements.identity.receiptId = 'unrelated-receipt'
    expect(done(copy, index)).toBe(false)
  }
})

test.each(['app.py', 'k8s/deployment.yaml', 'k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/service-external.yaml'])('final proof invalidates a relevant saved edit and revert: %s', path => {
  let run = through(5); const saved = run.project.savedFiles[path]
  let edited = saved + '\n# changed captured source\n'
  if (path !== 'app.py') {
    const object = parse(saved)
    if (object.kind === 'Deployment') object.spec.template.spec.containers[0].readinessProbe.httpGet.path = '/health/missing'
    if (object.kind === 'ConfigMap') object.data.APP_ENV = 'changed'
    if (object.kind === 'Secret') object.stringData.PGPASSWORD = 'changed-training-password'
    if (object.kind === 'Service') object.spec.selector.app = 'changed'
    edited = stringify(object)
  }
  run = act(run, lab, { type: 'save-file', path, text: edited }).run
  run = act(run, lab, { type: 'save-file', path, text: saved }).run
  expect(done(run, 5)).toBe(false)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test('rechecking an earned milestone does not leave orphaned request provenance after v1 cleanup', () => {
  let run = through(0)
  run = act(run, lab, { type: 'aks-request', scenarioId: 'baseline-v1' }).run
  run = executeAksSolution(run, lab, lab.tasks[1])
  run = executeAksSolution(run, lab, lab.tasks[2])
  expect(done(run, 0)).toBe(true)
  expect(validateBehavioralRun(JSON.parse(JSON.stringify(run)), lab)).toBeTruthy()
})

test('republishing the final mutable tag invalidates captured artifact proof', () => {
  let run = through(5)
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided --image assistant:release-v2 .' }).run
  expect(done(run, 5)).toBe(false)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})

test.each(['k8s/configmap.yaml', 'k8s/secret.yaml', 'k8s/service-external.yaml'])('final proof rejects live configuration/Service changes with saved files restored: %s', path => {
  let run = through(5); const saved = run.project.savedFiles[path]; const object = parse(saved)
  if (object.kind === 'ConfigMap') object.data.APP_ENV = 'changed'
  if (object.kind === 'Secret') object.stringData.PGPASSWORD = 'changed-training-password'
  if (object.kind === 'Service') object.spec.selector.app = 'missing'
  run = act(run, lab, { type: 'save-file', path, text: stringify(object) }).run
  run = act(run, lab, { type: 'command', line: `kubectl apply -f ${path}` }).run
  run = act(run, lab, { type: 'save-file', path, text: saved }).run
  expect(done(run, 5)).toBe(false)
  expect(verifyReleaseState(run, lab, 'final-v2').passed).toBe(false)
})
