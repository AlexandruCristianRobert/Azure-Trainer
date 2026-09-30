import { expect, it } from 'vitest'
import { parse, stringify } from 'yaml'
import { runKubectl } from '../src/lib/kubernetes/kubectl.js'
import * as historyApi from '../src/lib/kubernetes/rollout-history.js'
import { getRolloutSummary } from '../src/lib/kubernetes/rollouts.js'
import { advanceKubernetesTime } from '../src/lib/kubernetes/time.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { validateKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { validateBehavioralRun } from '../src/lib/labEngine/run.js'
import { redactRolloutOutput } from '../src/lib/kubernetes/diagnostics.js'
import { act, releaseTestRun, applyReleaseTemplate, releaseUndoFixture, getReleaseConfigSnapshot, RELEASE_TARGET as target, RELEASE_TEST_LAB as lab, seedFoundation } from './helpers/aks.js'

const state = run => run.runtime.kubernetes.clusters[target.clusterId]
const deployment = run => state(run).resources['Deployment/assistant/assistant-api']
const history = run => state(run).rollouts.deployments[deployment(run).metadata.uid]
const command = (run, text) => runKubectl(run.sandbox, text.split(' '), { run, lab })
const output = result => result.lines.map(line => line.text).join('\n')
const rollout = (run, text) => command(run, `rollout ${text} deployment/assistant-api -n assistant`)

it('lists retained revisions with a current marker and the real ReplicaSet and image reference', () => {
  const run = applyReleaseTemplate(releaseTestRun())
  const before = structuredClone(run)
  const result = rollout(run, 'history')
  expect(result.lines[0].kind).toBe('out')
  expect(output(result)).toMatch(/REVISION\s+CURRENT\s+REPLICASET\s+IMAGE REFERENCE\s+OBSERVED DIGESTS/)
  expect(output(result)).toMatch(/1\s+\s*[- ]\s+assistant-api-/)
  expect(output(result)).toMatch(/2\s+\*/)
  expect(output(result)).toContain('acraksreleasesguided.azurecr.io/assistant:release-v1')
  expect(output(result)).toContain('acraksreleasesguided.azurecr.io/assistant:release-v2')
  expect(output(result)).toContain(run.artifacts.buildsById[state(run).podSnapshots[getDeploymentPods(run, target.clusterId, 'assistant', 'assistant-api')[0].metadata.uid].artifactId].digest)
  expect(output(result)).not.toMatch(/change.cause/i)
  expect(result.effects).toBeUndefined()
  expect(run).toEqual(before)
})

it('inspects a selected retained template with references and probes without disclosing environment values', () => {
  const run = applyReleaseTemplate(releaseTestRun())
  const result = command(run, 'rollout history deployment/assistant-api -n assistant --revision=1')
  expect(result.lines[0].kind).toBe('out')
  expect(output(result)).toContain('Revision: 1')
  expect(output(result)).toContain('Image reference: acraksreleasesguided.azurecr.io/assistant:release-v1')
  expect(output(result)).toContain('Image pull policy: Always')
  expect(output(result)).toContain('ConfigMap assistant-config')
  expect(output(result)).toContain('Secret assistant-credentials/PGPASSWORD')
  expect(output(result)).toContain('/health/ready')
  expect(output(result)).not.toContain('training-only-password')
  expect(output(result)).not.toContain(btoa('training-only-password'))
  expect(command(run, 'rollout history deployment/assistant-api -n assistant --revision 99').lines[0].kind).toBe('err')
})

it('uses explicit context and namespace selection for history, status and undo without switching context', () => {
  let run = applyReleaseTemplate(releaseTestRun())
  const name = run.runtime.kubernetes.currentContext
  run.runtime.kubernetes.contexts.selected = { ...run.runtime.kubernetes.contexts[name], namespace: 'assistant' }
  run.runtime.kubernetes.contexts[name].namespace = 'default'
  for (const verb of ['history', 'status', 'undo']) {
    expect(output(command(run, `rollout ${verb} deployment/assistant-api`))).toMatch(/not found/)
    const result = command(run, `rollout ${verb} deployment/assistant-api --context selected`)
    expect(result.lines[0].kind).toBe('out')
    expect(run.runtime.kubernetes.currentContext).toBe(name)
  }
  expect(output(command(run, 'rollout history deployment/assistant-api --context missing -n assistant'))).toMatch(/Context.*not found/)
  expect(output(command(run, 'rollout undo deployment/assistant-api -n missing'))).toMatch(/Namespace.*not found/)
})

it('status is a read-only snapshot with distinct progressing counts and a trainer limit for watch=true', () => {
  const run = applyReleaseTemplate(releaseTestRun())
  const before = structuredClone(run)
  for (const suffix of ['', ' --watch=false', ' --watch false']) {
    const result = command(run, `rollout status deployment/assistant-api -n assistant${suffix}`)
    expect(result.lines[0].kind).toBe('out')
    expect(output(result)).toContain('updated=1/2 ready=2 available=2 unavailable=0 terminating=0')
    expect(output(result)).toMatch(/snapshot.*advance.*simulated time/i)
    expect(output(result)).not.toMatch(/successfully rolled out/)
    expect(result.effects).toBeUndefined()
  }
  const watching = command(run, 'rollout status deployment/assistant-api -n assistant --watch=true')
  expect(watching.lines[0].kind).toBe('err')
  expect(output(watching)).toMatch(/trainer.*watch/i)
  expect(run).toEqual(before)
})

it('status reports a stalled new revision even when every old Pod is healthy and does not recover it', () => {
  const run = advanceKubernetesTime(applyReleaseTemplate(releaseTestRun({ progressDeadlineSeconds: 20 }), { readinessPath: '/health/missing' }), 20, lab)
  const before = structuredClone(run)
  const result = rollout(run, 'status')
  expect(result.lines[0].kind).toBe('err')
  expect(output(result)).toContain('ProgressDeadlineExceeded')
  expect(output(result)).toContain('updated=1/2 ready=2 available=2 unavailable=0 terminating=0')
  expect(output(result)).toContain('kubectl describe deployment assistant-api -n assistant')
  expect(run).toEqual(before)
})

it('status reports success only after the desired new replicas become Available and old Pods leave', () => {
  let run = applyReleaseTemplate(releaseTestRun())
  run = advanceKubernetesTime(run, 30, lab)
  expect(output(rollout(run, 'status'))).not.toMatch(/successfully rolled out/)
  run = advanceKubernetesTime(run, 90, lab)
  expect(output(rollout(run, 'status'))).toMatch(/successfully rolled out/)
  expect(output(rollout(run, 'status'))).toContain('updated=2/2 ready=2 available=2 unavailable=0 terminating=0')
})

it('undo promotes the selected template to a new monotonic revision, retaining live settings and saved files', () => {
  const run = releaseUndoFixture()
  const before = structuredClone(run)
  const result = applyRunAction(run, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant --to-revision=1' }, lab)
  expect(result.lines[0].kind).toBe('out')
  expect(getRolloutSummary(result.run, target).currentRevision).toBe(3)
  expect(history(result.run).currentRsUid).toBe(history(run).revisions.find(item => item.revision === 1).rsUid)
  expect(deployment(result.run).spec.template.spec.containers[0].image).toBe('acraksreleasesguided.azurecr.io/assistant:release-v1')
  expect(deployment(result.run).spec.replicas).toBe(2)
  expect(deployment(result.run).spec.strategy).toEqual(deployment(run).spec.strategy)
  expect(result.run.project).toEqual(run.project)
  expect(result.run.artifacts).toEqual(run.artifacts)
  expect(getReleaseConfigSnapshot(result.run)).toEqual(getReleaseConfigSnapshot(run))
  expect(run).toEqual(before)
  const restored = advanceKubernetesTime(result.run, 120, lab)
  expect(getRolloutSummary(restored, target).complete).toBe(true)
  for (const pod of getDeploymentPods(restored, target.clusterId, 'assistant', 'assistant-api')) {
    expect(state(restored).podSnapshots[pod.metadata.uid].environment).toMatchObject({ APP_ENV: 'recovery-current', PGPASSWORD: 'current-secret-after-v1' })
  }
})

it('default undo selects the immediately previous retained revision after repeated promotions', () => {
  let run = applyReleaseTemplate(releaseTestRun())
  run = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant' }).run
  expect(history(run).currentRevision).toBe(3)
  run = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant' }).run
  expect(history(run).currentRevision).toBe(4)
  expect(deployment(run).spec.template.spec.containers[0].image).toContain('release-v2')
})

it.each(['--to-revision=99', '--to-revision=2', '--to-revision=0', '--to-revision=-1', '--to-revision=1.5', '--to-revision=abc', '--to-revision='])('rejects unavailable or invalid undo %s atomically', suffix => {
  const run = applyReleaseTemplate(releaseTestRun())
  const before = structuredClone(run)
  const result = applyRunAction(run, { type: 'command', line: `kubectl rollout undo deployment/assistant-api -n assistant ${suffix}` }, lab)
  expect(result.lines[0].kind).toBe('err')
  expect(result.run.runtime).toEqual(before.runtime)
  expect(result.run.nextSequence).toBe(before.nextSequence)
  expect(result.run.project).toEqual(before.project)
  expect(result.run.artifacts).toEqual(before.artifacts)
  expect(run).toEqual(before)
})

it('rejects default undo with no previous revision and explicitly pruned revisions atomically', () => {
  const initial = releaseTestRun({ revisionHistoryLimit: 0 })
  const pruned = advanceKubernetesTime(applyReleaseTemplate(initial), 90, lab)
  for (const [run, suffix] of [[initial, ''], [pruned, '--to-revision=1']]) {
    const before = structuredClone(run)
    const result = command(run, `rollout undo deployment/assistant-api -n assistant ${suffix}`.trim())
    expect(result.lines[0].kind).toBe('err')
    expect(output(result)).toMatch(/previous|retained|pruned/i)
    expect(result.effects).toBeUndefined()
    expect(run).toEqual(before)
  }
})

it.each(['history --revision=1 --revision 2', 'history --revision=-1', 'history --revision=1.5', 'history --revision', 'history --watch=false', 'undo --revision=1', 'undo --to-revision=1 --to-revision=2', 'status --watch=false --watch true', 'status --watch=maybe', 'status --to-revision=1', 'restart --watch=false'])('rejects malformed, duplicate or unsupported flags: %s', form => {
  const run = applyReleaseTemplate(releaseTestRun())
  const [verb, ...options] = form.split(' ')
  const result = command(run, `rollout ${verb} deployment/assistant-api -n assistant ${options.join(' ')}`)
  expect(result.lines[0].kind).toBe('err')
  expect(result.effects).toBeUndefined()
})

it('exposes the undo helper without changing config or source', () => {
  expect(typeof historyApi.undoDeployment).toBe('function')
  const run = releaseUndoFixture()
  const result = historyApi.undoDeployment(run, target, { revision: 1 }, lab)
  expect(result.diagnostics).toEqual([])
  expect(result.run.project.savedFiles).toEqual(run.project.savedFiles)
  expect(getReleaseConfigSnapshot(result.run)).toEqual(getReleaseConfigSnapshot(run))
  expect(getRolloutSummary(result.run, target).currentRevision).toBe(3)
})

it('preserves earlier Lab rollout status and restart behavior and gates history and undo', () => {
  const seeded = seedFoundation()
  const result = act(seeded.run, seeded.lab, { type: 'command', line: 'kubectl rollout status deployment/assistant -n assistant' })
  expect(output(result)).toMatch(/successfully rolled out/)
  const restart = act(seeded.run, seeded.lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant -n assistant' })
  expect(output(restart)).toMatch(/restarted/)
  for (const verb of ['history', 'undo']) {
    const rejected = runKubectl(seeded.run.sandbox, ['rollout', verb, 'deployment/assistant', '-n', 'assistant'], { run: seeded.run, lab: seeded.lab })
    expect(rejected.lines[0].kind).toBe('err')
    expect(rejected.effects).toBeUndefined()
  }
})

it('get and describe expose rollout snapshots and ReplicaSet history with separate observed digests', () => {
  const run = advanceKubernetesTime(applyReleaseTemplate(releaseTestRun()), 15, lab)
  const before = structuredClone(run)
  const sets = output(command(run, 'get replicasets -n assistant'))
  expect(sets).toMatch(/NAME\s+REVISION\s+CURRENT\s+DESIRED\s+READY\s+IMAGE REFERENCE\s+OBSERVED DIGESTS/)
  expect(sets).toContain('release-v1')
  expect(sets).toContain('release-v2')
  const deployments = output(command(run, 'get deployments -n assistant'))
  expect(deployments).toMatch(/NAME\s+REVISION\s+UPDATED\s+READY\s+AVAILABLE\s+UNAVAILABLE\s+TERMINATING/)
  expect(deployments).toMatch(/assistant-api\s+2\s+2\/2\s+2\s+2\s+0\s+1/)
  const description = output(command(run, 'describe deployment assistant-api -n assistant'))
  expect(description).toContain('Revision: 2')
  expect(description).toContain('updated=2/2 ready=2 available=2 unavailable=0 terminating=1')
  expect(description).toContain('Progressing=True (ReplicaSetUpdated)')
  expect(description).toContain('Image reference: acraksreleasesguided.azurecr.io/assistant:release-v2')
  expect(description).toContain('Observed digests: sha256:')
  expect(description).toContain('Resource requests: cpu=250m, memory=128Mi')
  for (const digest of Object.values(run.artifacts.buildsById).map(build => build.digest)) expect(sets).toContain(digest)
  expect(run).toEqual(before)
})

it('describe explains the deadline condition and inspection commands without choosing recovery', () => {
  const run = advanceKubernetesTime(applyReleaseTemplate(releaseTestRun({ progressDeadlineSeconds: 20 }), { readinessPath: '/health/missing' }), 20, lab)
  const description = output(command(run, 'describe deployment assistant-api -n assistant'))
  expect(description).toContain('Progressing=False (ProgressDeadlineExceeded)')
  expect(description).toContain('kubectl get pods -n assistant')
  expect(description).not.toContain('kubectl rollout undo')
})

it('undo keeps actual desired replicas and the currently configured strategy instead of historical values', () => {
  let run = applyReleaseTemplate(releaseTestRun())
  const value = parse(run.project.savedFiles['k8s/deployment.yaml'])
  Object.assign(value.spec, { replicas: 3, minReadySeconds: 8, progressDeadlineSeconds: 45, revisionHistoryLimit: 1 })
  value.spec.strategy.rollingUpdate = { maxSurge: '25%', maxUnavailable: '0%' }
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(value) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const result = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant --to-revision 1' })
  expect(deployment(result.run).spec).toMatchObject({ replicas: 3, minReadySeconds: 8, progressDeadlineSeconds: 45, revisionHistoryLimit: 1,
    strategy: { type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '0%' } } })
  const completed = advanceKubernetesTime(result.run, 120, lab)
  expect(getRolloutSummary(completed, target)).toMatchObject({ desired: 3, updated: 3, available: 3, complete: true, currentRevision: 3 })
})

it('mutable-tag undo under Always pulls the currently published artifact while history retains the image reference', () => {
  let run = releaseTestRun()
  const original = run.artifacts.publishedTags['acraksreleasesguided.azurecr.io/assistant:release-v1']
  run = advanceKubernetesTime(applyReleaseTemplate(run), 90, lab)
  run = act(run, lab, { type: 'command', line: 'az acr build --registry acraksreleasesguided -t assistant:release-v1 .' }).run
  const published = run.artifacts.publishedTags['acraksreleasesguided.azurecr.io/assistant:release-v1']
  expect(published).not.toBe(original)
  expect(output(command(run, 'rollout history deployment/assistant-api -n assistant --revision=1'))).toContain('Observed digests: <none observed>')
  const saved = structuredClone(run.project)
  const tags = structuredClone(run.artifacts.publishedTags)
  run = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant' }).run
  run = advanceKubernetesTime(run, 120, lab)
  expect(getRolloutSummary(run, target).complete).toBe(true)
  const current = getDeploymentPods(run, target.clusterId, 'assistant', 'assistant-api')
  expect(current).toHaveLength(2)
  for (const pod of current) {
    expect(pod.spec.containers[0]).toMatchObject({ image: 'acraksreleasesguided.azurecr.io/assistant:release-v1', imagePullPolicy: 'Always' })
    expect(state(run).podSnapshots[pod.metadata.uid].artifactId).toBe(published)
  }
  const text = output(command(run, 'rollout history deployment/assistant-api -n assistant --revision=3'))
  expect(text).toContain(run.artifacts.buildsById[published].digest)
  expect(text).not.toContain(run.artifacts.buildsById[original].digest)
  expect(run.project).toEqual(saved)
  expect(run.artifacts.publishedTags).toEqual(tags)
})

it('history, get, describe and logs retain Secret redaction through undo, Pod cleanup and reload', () => {
  let run = releaseUndoFixture()
  const value = parse(run.project.savedFiles['k8s/deployment.yaml'])
  value.spec.template.spec.containers[0].image = 'acraksreleasesguided.azurecr.io/assistant:training-only-password'
  value.spec.template.metadata.labels.secret_hint = 'training-only-password'
  value.spec.template.metadata.labels['training-only-password'] = 'public-label-value'
  value.spec.template.spec.containers[0].livenessProbe.httpGet.path = '/health/current-secret-after-v1'
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(value) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const pod = getDeploymentPods(run, target.clusterId, 'assistant', 'assistant-api').find(item => item.spec.containers[0].image.endsWith(':training-only-password'))
  const old = getDeploymentPods(run, target.clusterId, 'assistant', 'assistant-api').find(item => state(run).podSnapshots[item.metadata.uid])
  const before = structuredClone(run)
  for (const text of ['rollout history deployment/assistant-api -n assistant', 'rollout history deployment/assistant-api -n assistant --revision=3',
    'get replicasets -n assistant', 'get pods -n assistant --show-labels', 'describe deployment assistant-api -n assistant', `describe pod ${pod.metadata.name} -n assistant`, `logs ${old.metadata.name} -n assistant`]) {
    const result = command(run, text)
    expect(result.lines[0].kind).toBe('out')
    expect(output(result)).not.toContain('training-only-password')
    expect(output(result)).not.toContain('current-secret-after-v1')
    expect(output(result)).not.toContain(btoa('current-secret-after-v1'))
  }
  expect(run).toEqual(before)
  const retainedTemplate = structuredClone(history(run).revisions.find(item => item.revision === 3).template)
  const provenance = JSON.stringify(history(run).revisions.find(item => item.revision === 3).redactedPaths)
  expect(provenance).not.toContain('training-only-password')
  expect(provenance).not.toContain('current-secret-after-v1')
  run = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant --to-revision=1' }).run
  run = advanceKubernetesTime(run, 120, lab)
  expect(getRolloutSummary(run, target)).toMatchObject({ complete: true, currentRevision: 4 })
  expect(Object.values(state(run).podSnapshots).some(snapshot => snapshot.environment?.PGPASSWORD === 'training-only-password')).toBe(false)
  expect(history(run).revisions.find(item => item.revision === 3).template).toEqual(retainedTemplate)
  expect(history(run).revisions.find(item => item.revision === 3).imageRef).toContain('training-only-password')
  run = JSON.parse(JSON.stringify(run))
  expect(validateBehavioralRun(run, lab)).toBe(run)
  const reloaded = structuredClone(run)
  for (const text of ['rollout history deployment/assistant-api -n assistant --revision=3', 'rollout history deployment/assistant-api -n assistant', 'get replicasets -n assistant', 'get replicasets -n assistant -o wide']) {
    const result = command(run, text)
    expect(result.lines[0].kind).toBe('out')
    expect(output(result)).not.toContain('training-only-password')
    expect(output(result)).toContain('[REDACTED]')
    if (text.includes('--revision=3')) expect(output(result)).toContain('Retained templates store image references')
  }
  expect(run).toEqual(reloaded)
  // Redaction metadata follows the retained entry and disappears when that
  // entry is pruned. The live/restorable template remains independently intact.
  const current = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'assistant-api', namespace: 'assistant' }, spec: structuredClone(deployment(run).spec) }
  current.spec.revisionHistoryLimit = 0
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(current) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  expect(history(run).revisions).toHaveLength(1)
  expect(history(run).revisions[0].revision).toBe(4)
  expect(history(run).revisions.some(item => item.redactedPaths?.length)).toBe(false)
  expect(validateKubernetesRuntime(run.runtime.kubernetes, run, lab)).toBe(true)
})

it('validates bounded persisted redaction paths and rejects malformed or foreign template coordinates', () => {
  const run = releaseTestRun()
  for (const paths of ['training-only-password', [null], ['/1#key', '/1#key'], ['/missing'], ['/2#key'], ['/1#value'], ['*', '/1#key'], Array(129).fill('/1#key'), [`/${'0'.repeat(513)}#key`]]) {
    const corrupted = structuredClone(run)
    history(corrupted).revisions[0].redactedPaths = paths
    expect(validateKubernetesRuntime(corrupted.runtime.kubernetes, corrupted, lab)).toBe(false)
  }
  for (const paths of [undefined, [], ['/1#key'], ['*']]) {
    const compatible = structuredClone(run)
    if (paths !== undefined) history(compatible).revisions[0].redactedPaths = paths
    expect(validateKubernetesRuntime(compatible.runtime.kubernetes, compatible, lab)).toBe(true)
  }
})

it('many sensitive template fields retain safe bounded inspection through cleanup without copying credentials', () => {
  let run = releaseUndoFixture()
  const value = parse(run.project.savedFiles['k8s/deployment.yaml'])
  value.spec.template.spec.containers[0].image = 'acraksreleasesguided.azurecr.io/assistant:training-only-password'
  value.spec.template.metadata.annotations = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`private-${index}`, 'training-only-password']))
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(value) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const originalTemplate = structuredClone(history(run).revisions.find(item => item.revision === 3).template)
  const paths = history(run).revisions.find(item => item.revision === 3).redactedPaths
  expect(Array.isArray(paths)).toBe(true)
  expect(paths.length).toBeLessThanOrEqual(128)
  expect(JSON.stringify(paths)).not.toContain('training-only-password')
  run = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant --to-revision=1' }).run
  run = JSON.parse(JSON.stringify(advanceKubernetesTime(run, 120, lab)))
  expect(history(run).revisions.find(item => item.revision === 3).template).toEqual(originalTemplate)
  expect(validateKubernetesRuntime(run.runtime.kubernetes, run, lab)).toBe(true)
  expect(output(command(run, 'rollout history deployment/assistant-api -n assistant --revision=3'))).not.toContain('training-only-password')
  expect(output(command(run, 'get replicasets -n assistant'))).not.toContain('training-only-password')
})

it.each([[false, false], [true, false], [false, true]])('mixed old/current credentials stay redacted after cleanup with wildcard=%s and overlapping=%s', (wildcard, overlapping) => {
  let run = releaseUndoFixture()
  const image = 'acraksreleasesguided.azurecr.io/assistant:training-only-password-current-secret-after-v1'
  const value = parse(run.project.savedFiles['k8s/deployment.yaml'])
  value.spec.template.spec.containers[0].image = image
  if (wildcard) value.spec.template.metadata.annotations = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`private-${index}`, 'training-only-password-current-secret-after-v1']))
  if (overlapping) value.spec.template.spec.containers[0].env.push({ name: 'DISPLAY_FRAGMENT',
    value: 'current-secret-after-v1\nObserved digests: <none observed>\nRetained Pod template:\nTemplate hash: ' })
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(value) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const template = structuredClone(history(run).revisions.find(item => item.revision === 3).template)
  if (wildcard) expect(history(run).revisions.find(item => item.revision === 3).redactedPaths).toEqual(['*'])
  run = act(run, lab, { type: 'command', line: 'kubectl rollout undo deployment/assistant-api -n assistant --to-revision=1' }).run
  run = JSON.parse(JSON.stringify(advanceKubernetesTime(run, 120, lab)))
  expect(getRolloutSummary(run, target)).toMatchObject({ complete: true, currentRevision: 4 })
  expect(Object.values(state(run).podSnapshots).some(snapshot => snapshot.environment?.PGPASSWORD === 'training-only-password')).toBe(false)
  expect(history(run).revisions.find(item => item.revision === 3).template).toEqual(template)
  expect(history(run).revisions.find(item => item.revision === 3).imageRef).toBe(image)
  expect(validateBehavioralRun(run, lab)).toBe(run)
  const before = structuredClone(run)
  for (const text of ['rollout history deployment/assistant-api -n assistant --revision=3', 'rollout history deployment/assistant-api -n assistant', 'get replicasets -n assistant', 'get replicasets -n assistant -o wide']) {
    const result = command(run, text)
    expect(result.lines[0].kind).toBe('out')
    expect(output(result)).not.toContain('training-only-password')
    expect(output(result)).not.toContain('current-secret-after-v1')
    expect(output(result)).toContain('[REDACTED]')
  }
  // Also cover current-value text outside any retained-template field. The
  // wildcard state is valid, persisted, and created by ordinary capture.
  const direct = redactRolloutOutput(`selected ${image}; observed current-secret-after-v1`, state(run))
  expect(direct).not.toContain('training-only-password')
  expect(direct).not.toContain('current-secret-after-v1')
  expect(direct).toContain('[REDACTED]')
  expect(run).toEqual(before)
})

it('the undo helper rejects invalid, current, missing and non-release targets without any state mutation', () => {
  const run = applyReleaseTemplate(releaseTestRun())
  for (const [selectedTarget, revision, selectedLab] of [[target, 0, lab], [target, '1', lab], [target, 2, lab], [target, 99, lab], [{ ...target, deploymentName: 'missing' }, 1, lab], [target, 1, { ...lab, capabilities: { ...lab.capabilities, kubernetesRollouts: false } }]]) {
    const before = structuredClone(run)
    const result = historyApi.undoDeployment(run, selectedTarget, { revision }, selectedLab)
    expect(result.diagnostics.length).toBe(1)
    expect(result.run).toBe(run)
    expect(result.run).toEqual(before)
  }
})

it('snapshot reads never initialize missing saved-run history and a selected absent revision fails clearly', () => {
  const run = releaseTestRun()
  delete state(run).rollouts
  const before = structuredClone(run)
  expect(output(rollout(run, 'history'))).toMatch(/No retained rollout history/)
  const selected = command(run, 'rollout history deployment/assistant-api -n assistant --revision=1')
  expect(selected.lines[0].kind).toBe('err')
  expect(output(selected)).toMatch(/not retained|pruned/)
  expect(rollout(run, 'status').lines[0].kind).toBe('err')
  expect(rollout(run, 'undo').lines[0].kind).toBe('err')
  expect(run).toEqual(before)
})

it('selected restart history identifies template annotation keys without disclosing annotation values', () => {
  let run = releaseTestRun()
  run = act(run, lab, { type: 'command', line: 'kubectl rollout restart deployment/assistant-api -n assistant' }).run
  const text = output(command(run, 'rollout history deployment/assistant-api -n assistant --revision=2'))
  expect(text).toContain('Annotation keys: kubectl.kubernetes.io/restarted-at')
  expect(text).toMatch(/Template hash: [0-9a-f]+/)
  expect(text).not.toContain('sim-15000-')
})

it('generic structured get preserves resource serialization when a Secret value overlaps JSON syntax', () => {
  let run = releaseTestRun()
  const secret = parse(run.project.savedFiles['k8s/secret.yaml'])
  secret.stringData.PGPASSWORD = '1'
  run = act(run, lab, { type: 'save-file', path: 'k8s/secret.yaml', text: stringify(secret) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/secret.yaml' }).run
  const text = output(command(run, 'get deployment assistant-api -n assistant -o json'))
  expect(() => JSON.parse(text)).not.toThrow()
  expect(JSON.parse(text).apiVersion).toBe('apps/v1')
  expect(JSON.parse(text).metadata.generation).toBe(1)
})

it('Pod inspection distinguishes its captured digest from the desired Deployment image reference', () => {
  const run = applyReleaseTemplate(releaseTestRun())
  const pod = getDeploymentPods(run, target.clusterId, 'assistant', 'assistant-api').find(item => item.spec.containers[0].image.endsWith('release-v1'))
  const digest = run.artifacts.buildsById[state(run).podSnapshots[pod.metadata.uid].artifactId].digest
  const text = output(command(run, `describe pod ${pod.metadata.name} -n assistant`))
  expect(text).toContain(`Observed digest: ${digest}`)
  expect(text).toContain('Image reference: acraksreleasesguided.azurecr.io/assistant:release-v1')
})

it('namespace and context flags before the rollout subcommand keep its specific flag rules', () => {
  const run = applyReleaseTemplate(releaseTestRun())
  const context = run.runtime.kubernetes.currentContext
  for (const suffix of ['history deployment/assistant-api --revision=1', 'status deployment/assistant-api --watch=false', 'undo deployment/assistant-api --to-revision=1']) {
    expect(command(run, `rollout --context=${context} --namespace=assistant ${suffix}`).lines[0].kind).toBe('out')
  }
  const result = command(run, `rollout --context=${context} --namespace=assistant restart deployment/assistant-api --revision=1`)
  expect(result.lines[0].kind).toBe('err')
  expect(result.effects).toBeUndefined()
})

it('history redacts a current UTF-8 Secret even when the new image has never started', () => {
  let run = releaseTestRun()
  const secret = parse(run.project.savedFiles['k8s/secret.yaml'])
  secret.stringData.PGPASSWORD = 'pässword-current'
  run = act(run, lab, { type: 'save-file', path: 'k8s/secret.yaml', text: stringify(secret) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/secret.yaml' }).run
  const value = parse(run.project.savedFiles['k8s/deployment.yaml'])
  value.spec.template.spec.containers[0].image = 'acraksreleasesguided.azurecr.io/assistant:unpublished'
  value.spec.template.spec.containers[0].readinessProbe.httpGet.path = '/health/pässword-current'
  run = act(run, lab, { type: 'save-file', path: 'k8s/deployment.yaml', text: stringify(value) }).run
  run = act(run, lab, { type: 'command', line: 'kubectl apply -f k8s/deployment.yaml' }).run
  const result = command(run, 'rollout history deployment/assistant-api -n assistant --revision=2')
  expect(result.lines[0].kind).toBe('out')
  expect(output(result)).not.toContain('pässword-current')
  expect(output(result)).toContain('readinessProbe: [REDACTED] port=http')
})
