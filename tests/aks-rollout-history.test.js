import { describe, expect, test } from 'vitest'
import { normalizeRolloutSpec, resolveRolloutBudget } from '../src/lib/kubernetes/rollout-schema.js'
import { registerRevision, pruneRevisionHistory } from '../src/lib/kubernetes/rollout-history.js'
import { seedFoundation } from './helpers/aks.js'
import { applyKubernetesObjects } from '../src/lib/kubernetes/objects.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { validateKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { validateKubernetesObject } from '../src/lib/kubernetes/schema.js'

describe('rollout schema', () => {
  test('normalizes the supported rolling update defaults and percentage budget', () => {
    expect(normalizeRolloutSpec({}).value).toEqual({ type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' }, minReadySeconds: 0, progressDeadlineSeconds: 600, revisionHistoryLimit: 10 })
    expect(resolveRolloutBudget({ maxSurge: '25%', maxUnavailable: '25%' }, 3)).toEqual({ surge: 1, unavailable: 0 })
  })

  test.each([[0, 0], ['0%', 0], [0, '0%'], ['0%', '0%']])('rejects configured zero availability budget %o/%o', (maxSurge, maxUnavailable) => {
    expect(normalizeRolloutSpec({ rollingUpdate: { maxSurge, maxUnavailable } }).diagnostics[0].code).toBe('INVALID_ROLLOUT_BUDGET')
  })
  test('rejects deadline equal to min ready', () => {
    expect(normalizeRolloutSpec({ progressDeadlineSeconds: 5, minReadySeconds: 5 }).diagnostics[0].code).toBe('INVALID_ROLLOUT_STRATEGY')
  })
})

test('reuses a retained template while promoting a monotonic revision', () => {
  const one = { metadata: { labels: { app: 'assistant' } }, spec: { containers: [{ name: 'api', image: 'a:v1' }] } }
  const run = { nextSequence: 10, runtime: { simTimeMs: 0, kubernetes: { clusters: { c1: { resources: {
    'Deployment/assistant/assistant': { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'assistant', namespace: 'assistant', uid: 'deploy-1', generation: 1 }, spec: { replicas: 2, selector: { matchLabels: { app: 'assistant' } }, template: one } },
    'ReplicaSet/assistant/assistant-v1': { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name: 'assistant-v1', namespace: 'assistant', uid: 'rs-1', ownerReferences: [{ uid: 'deploy-1', kind: 'Deployment', name: 'assistant' }] }, spec: { replicas: 2, selector: { matchLabels: { app: 'assistant' } }, template: one } },
  } } } } } }
  const target = { clusterId: 'c1', namespace: 'assistant', deploymentName: 'assistant', deploymentUid: 'deploy-1' }
  const two = { metadata: { labels: { app: 'assistant' } }, spec: { containers: [{ name: 'api', image: 'a:v2' }] } }
  const first = registerRevision(run, target, one)
  const second = registerRevision(first.run, target, two)
  const restored = registerRevision(second.run, target, one)
  expect(restored.revision).toBe(3)
  expect(restored.rsUid).toBe(first.rsUid)
})

function rolloutSeed() {
  const seeded = seedFoundation(); seeded.lab = { ...seeded.lab, capabilities: { ...seeded.lab.capabilities, kubernetesRollouts: true } }
  return seeded
}
function desired(run, clusterId, mutate = value => value) {
  const live = structuredClone(run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'])
  return mutate({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: live.metadata.name, namespace: live.metadata.namespace, labels: live.metadata.labels }, spec: live.spec })
}
function apply(run, lab, clusterId, object) { return applyKubernetesObjects(run, [object], { clusterId }, lab) }

test('bootstraps an eligible saved deployment without replacing its ReplicaSet or Pods', () => {
  const { run, lab, clusterId } = rolloutSeed(); const state = run.runtime.kubernetes.clusters[clusterId]
  const rsUid = Object.values(state.resources).find(item => item.kind === 'ReplicaSet').metadata.uid
  const podUids = getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(item => item.metadata.uid).sort()
  const result = apply(run, lab, clusterId, desired(run, clusterId))
  const rollout = result.run.runtime.kubernetes.clusters[clusterId].rollouts.deployments[state.resources['Deployment/assistant/assistant'].metadata.uid]
  expect(result.diagnostics).toEqual([])
  expect(rollout.currentRsUid).toBe(rsUid)
  expect(getDeploymentPods(result.run, clusterId, 'assistant', 'assistant').map(item => item.metadata.uid).sort()).toEqual(podUids)
})

test('replica and strategy edits retain the current revision while template annotations create one', () => {
  let { run, lab, clusterId } = rolloutSeed(); run = apply(run, lab, clusterId, desired(run, clusterId)).run
  const state = () => run.runtime.kubernetes.clusters[clusterId]; const uid = state().resources['Deployment/assistant/assistant'].metadata.uid
  const revision = () => state().rollouts.deployments[uid]
  const original = revision().currentRevision
  run = apply(run, lab, clusterId, desired(run, clusterId, value => { value.spec.replicas = 1; return value })).run
  run = apply(run, lab, clusterId, desired(run, clusterId, value => { value.spec.strategy.rollingUpdate.maxSurge = 2; return value })).run
  expect(revision().currentRevision).toBe(original)
  run = apply(run, lab, clusterId, desired(run, clusterId, value => { value.spec.template.metadata.annotations = { learner: 'changed' }; return value })).run
  expect(revision().currentRevision).toBe(original + 1)
})

test('prunes only completed zero-replica history without owned Pods', () => {
  let { run, lab, clusterId } = rolloutSeed(); run = apply(run, lab, clusterId, desired(run, clusterId)).run
  const state = run.runtime.kubernetes.clusters[clusterId]; const uid = state.resources['Deployment/assistant/assistant'].metadata.uid
  state.resources['Deployment/assistant/assistant'].spec.revisionHistoryLimit = 0
  for (let index = 0; index < 3; index++) run = registerRevision(run, { clusterId, deploymentUid: uid }, { ...state.resources['Deployment/assistant/assistant'].spec.template, metadata: { labels: { app: 'assistant' }, annotations: { revision: String(index) } } }).run
  const history = run.runtime.kubernetes.clusters[clusterId].rollouts.deployments[uid]
  const beforeCompletion = pruneRevisionHistory(run, { clusterId, deploymentUid: uid })
  expect(beforeCompletion.runtime.kubernetes.clusters[clusterId].rollouts.deployments[uid].revisions).toHaveLength(4)
  history.conditions = [{ type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' }]
  for (const rs of Object.values(run.runtime.kubernetes.clusters[clusterId].resources).filter(item => item.kind === 'ReplicaSet')) rs.spec.replicas = 0
  for (const pod of getDeploymentPods(run, clusterId, 'assistant', 'assistant')) pod.metadata.deletionTimestamp = 1000
  run = pruneRevisionHistory(run, { clusterId, deploymentUid: uid })
  expect(run.runtime.kubernetes.clusters[clusterId].rollouts.deployments[uid].revisions).toHaveLength(2)
})

test('rejects a twenty-first distinct ReplicaSet atomically but accepts retained recovery at the cap', () => {
  let { run, lab, clusterId } = rolloutSeed(); run = apply(run, lab, clusterId, desired(run, clusterId)).run
  const uid = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].metadata.uid
  const target = { clusterId, deploymentUid: uid }; const template = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].spec.template
  const first = structuredClone(template)
  for (let index = 0; index < 19; index++) run = registerRevision(run, target, { ...template, metadata: { labels: { app: 'assistant' }, annotations: { distinct: String(index) } } }).run
  const before = structuredClone(run); const blocked = registerRevision(run, target, { ...template, metadata: { labels: { app: 'assistant' }, annotations: { distinct: 'twenty' } } })
  expect(blocked.diagnostics[0].code).toBe('ROLLOUT_REPLICASET_LIMIT')
  expect(blocked.run.nextSequence).toBe(before.nextSequence)
  expect(blocked.run.runtime.kubernetes).toEqual(before.runtime.kubernetes)
  expect(registerRevision(run, target, first).diagnostics).toEqual([])
})

test('preserves an earlier applied ConfigMap when a twenty-first template is rejected', () => {
  let { run, lab, clusterId } = rolloutSeed(); lab = { ...lab, capabilities: { ...lab.capabilities, kubernetesConfiguration: true } }
  run = apply(run, lab, clusterId, desired(run, clusterId)).run
  const uid = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].metadata.uid; const target = { clusterId, deploymentUid: uid }
  const template = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].spec.template
  for (let index = 0; index < 19; index++) run = registerRevision(run, target, { ...template, metadata: { labels: { app: 'assistant' }, annotations: { distinct: String(index) } } }).run
  const before = structuredClone(run); const blocked = applyKubernetesObjects(run, [
    { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'release-note', namespace: 'assistant' }, data: { note: 'kept' } },
    desired(run, clusterId, value => { value.spec.template.metadata.annotations = { distinct: 'twenty' }; return value }),
  ], { clusterId }, lab)
  expect(blocked.diagnostics[0].code).toBe('ROLLOUT_REPLICASET_LIMIT')
  expect(blocked.run.runtime.kubernetes.clusters[clusterId].resources['ConfigMap/assistant/release-note'].data.note).toBe('kept')
  expect(blocked.run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant']).toEqual(before.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'])
  expect(blocked.run.nextSequence).toBe(before.nextSequence + 1)
  expect(apply(blocked.run, lab, clusterId, desired(blocked.run, clusterId)).diagnostics).toEqual([])
})

test('rejects malformed rollout fields and corrupted persisted rollout references', () => {
  const deployment = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'assistant', namespace: 'assistant' }, spec: { replicas: 1, selector: { matchLabels: { app: 'assistant' } }, template: { metadata: { labels: { app: 'assistant' } }, spec: { containers: [{ name: 'api', image: 'a:v1', imagePullPolicy: 'Always', ports: [{ containerPort: 8080 }] }] } }, strategy: [], minReadySeconds: 1 } }
  for (const strategy of [null, [], { minReadySeconds: 1 }, { progressDeadlineSeconds: 60 }, { revisionHistoryLimit: 3 }]) {
    deployment.spec.strategy = strategy
    expect(validateKubernetesObject(deployment, { namespace: 'assistant', capabilities: { kubernetesRollouts: true } }).diagnostics[0].code).toBe('INVALID_ROLLOUT_STRATEGY')
  }
  let { run, lab, clusterId } = rolloutSeed(); run = apply(run, lab, clusterId, desired(run, clusterId)).run
  const corrupted = structuredClone(run.runtime.kubernetes); const state = corrupted.clusters[clusterId]; const uid = state.resources['Deployment/assistant/assistant'].metadata.uid
  expect(state.rollouts.deployments[uid].currentRsUid).toMatch(/^kube-/)
  state.rollouts.deployments[uid].currentRsUid = 'missing-rs'
  expect(validateKubernetesRuntime(corrupted, run, lab)).toBe(false)
})
