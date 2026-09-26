import { describe, expect, test } from 'vitest'
import { normalizeRolloutSpec, resolveRolloutBudget } from '../src/lib/kubernetes/rollout-schema.js'
import { registerRevision, pruneRevisionHistory } from '../src/lib/kubernetes/rollout-history.js'
import { seedFoundation } from './helpers/aks.js'
import { applyKubernetesObjects } from '../src/lib/kubernetes/objects.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'

describe('rollout schema', () => {
  test('normalizes the supported rolling update defaults and percentage budget', () => {
    expect(normalizeRolloutSpec({}).value).toEqual({ type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' }, minReadySeconds: 0, progressDeadlineSeconds: 600, revisionHistoryLimit: 10 })
    expect(resolveRolloutBudget({ maxSurge: '25%', maxUnavailable: '25%' }, 3)).toEqual({ surge: 1, unavailable: 0 })
  })

  test('rejects an invalid configured zero availability budget', () => {
    expect(normalizeRolloutSpec({ rollingUpdate: { maxSurge: 0, maxUnavailable: 0 } }).diagnostics[0].code).toBe('INVALID_ROLLOUT_BUDGET')
    expect(normalizeRolloutSpec({ rollingUpdate: { maxSurge: '0%', maxUnavailable: '0%' } }).diagnostics[0].code).toBe('INVALID_ROLLOUT_BUDGET')
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
  history.conditions = [{ type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' }]
  for (const rs of Object.values(run.runtime.kubernetes.clusters[clusterId].resources).filter(item => item.kind === 'ReplicaSet')) rs.spec.replicas = 0
  run = pruneRevisionHistory(run, { clusterId, deploymentUid: uid })
  expect(run.runtime.kubernetes.clusters[clusterId].rollouts.deployments[uid].revisions).toHaveLength(2)
})
