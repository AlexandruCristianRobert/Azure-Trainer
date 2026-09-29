import { describe, expect, test } from 'vitest'
import { normalizeRolloutSpec, resolveRolloutBudget } from '../src/lib/kubernetes/rollout-schema.js'
import { registerRevision, pruneRevisionHistory } from '../src/lib/kubernetes/rollout-history.js'
import { seedFoundation, createAksTestRun, act } from './helpers/aks.js'
import { applyKubernetesObjects } from '../src/lib/kubernetes/objects.js'
import { getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { validateKubernetesRuntime } from '../src/lib/kubernetes/state.js'
import { validateKubernetesObject } from '../src/lib/kubernetes/schema.js'

describe('rollout schema', () => {
  test('normalizes the supported rolling update defaults and percentage budget', () => {
    expect(normalizeRolloutSpec({}).value).toEqual({ type: 'RollingUpdate', rollingUpdate: { maxSurge: '25%', maxUnavailable: '25%' }, minReadySeconds: 0, progressDeadlineSeconds: 600, revisionHistoryLimit: 10 })
    expect(resolveRolloutBudget({ maxSurge: '25%', maxUnavailable: '25%' }, 3)).toEqual({ surge: 1, unavailable: 0 })
    expect(resolveRolloutBudget({ maxSurge: 0, maxUnavailable: '25%' }, 2)).toEqual({ surge: 0, unavailable: 1 })
  })

  test.each([[0, 0], ['0%', 0], [0, '0%'], ['0%', '0%']])('rejects configured zero availability budget %o/%o', (maxSurge, maxUnavailable) => {
    expect(normalizeRolloutSpec({ rollingUpdate: { maxSurge, maxUnavailable } }).diagnostics[0].code).toBe('INVALID_ROLLOUT_BUDGET')
  })
  test('rejects deadline equal to min ready', () => {
    expect(normalizeRolloutSpec({ progressDeadlineSeconds: 5, minReadySeconds: 5 }).diagnostics[0].code).toBe('INVALID_ROLLOUT_STRATEGY')
  })
  test.each([{ rollingUpdate: null }, { rollingUpdate: { maxSurge: null } }, { type: null }, { minReadySeconds: null }, { progressDeadlineSeconds: null }, { revisionHistoryLimit: null }, { rollingUpdate: { maxSurge: '25.0%' } }, { rollingUpdate: { maxUnavailable: 7 } }])('rejects malformed rollout configuration %o', spec => {
    expect(normalizeRolloutSpec(spec).diagnostics.length).toBeGreaterThan(0)
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
  const seeded = seedFoundation();
  expect(validateKubernetesRuntime(seeded.run.runtime.kubernetes, seeded.run, seeded.lab)).toBe(true)
  seeded.lab = { ...seeded.lab, capabilities: { ...seeded.lab.capabilities, kubernetesRollouts: true } }
  return seeded
}
function desired(run, clusterId, mutate = value => value) {
  const live = structuredClone(run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'])
  return mutate({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: live.metadata.name, namespace: live.metadata.namespace, ...(live.metadata.labels ? { labels: live.metadata.labels } : {}) }, spec: live.spec })
}
function apply(run, lab, clusterId, object) { return applyKubernetesObjects(run, [object], { clusterId }, lab) }

test('initializes an empty rollout-capable cluster through public connection actions', () => {
  let { run, lab } = createAksTestRun({ capabilities: { acrBuild: true, kubernetes: true, kubernetesRollouts: true } })
  for (const line of ['az group create -n rgrollouts -l eastus', 'az acr create -g rgrollouts -n acrrollouts --sku Basic', 'az aks create -g rgrollouts -n aksrollouts --enable-managed-identity --generate-ssh-keys --attach-acr acrrollouts', 'az aks get-credentials -g rgrollouts -n aksrollouts']) run = act(run, lab, { type: 'command', line }).run
  expect(validateKubernetesRuntime(run.runtime.kubernetes, run, lab)).toBe(true)
  expect(Object.values(run.runtime.kubernetes.clusters)[0].rollouts).toEqual({ version: 1, deployments: {}, experiment: null, receipts: [] })
})

test('bootstraps an eligible saved deployment without replacing its ReplicaSet or Pods', () => {
  const { run, lab, clusterId } = rolloutSeed(); const state = run.runtime.kubernetes.clusters[clusterId]
  const rsUid = Object.values(state.resources).find(item => item.kind === 'ReplicaSet').metadata.uid
  const podUids = getDeploymentPods(run, clusterId, 'assistant', 'assistant').map(item => item.metadata.uid).sort()
  const result = apply(run, lab, clusterId, desired(run, clusterId))
  const rollout = result.run.runtime.kubernetes.clusters[clusterId].rollouts.deployments[state.resources['Deployment/assistant/assistant'].metadata.uid]
  expect(result.diagnostics).toEqual([])
  const live = result.run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant']
  expect(validateKubernetesObject({ apiVersion: live.apiVersion, kind: live.kind, metadata: { name: live.metadata.name, namespace: live.metadata.namespace, labels: live.metadata.labels }, spec: live.spec }, { namespace: 'assistant', capabilities: { kubernetesConfiguration: true, kubernetesRollouts: true } }).diagnostics).toEqual([])
  expect(validateKubernetesRuntime(result.run.runtime.kubernetes, result.run, lab)).toBe(true)
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

test('controller template labels and revision annotations do not create revisions but restart does', () => {
  let { run, lab, clusterId } = rolloutSeed(); run = apply(run, lab, clusterId, desired(run, clusterId)).run
  const uid = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].metadata.uid
  run = apply(run, lab, clusterId, desired(run, clusterId, value => {
    value.spec.template.metadata.labels['pod-template-hash'] = 'generated'
    value.spec.template.metadata.annotations = { 'deployment.kubernetes.io/revision': '12' }
    return value
  })).run
  expect(run.runtime.kubernetes.clusters[clusterId].rollouts.deployments[uid].currentRevision).toBe(1)
  run = apply(run, lab, clusterId, desired(run, clusterId, value => {
    value.spec.template.metadata.annotations['kubectl.kubernetes.io/restarted-at'] = 'sim-0-99'; return value
  })).run
  expect(run.runtime.kubernetes.clusters[clusterId].rollouts.deployments[uid].currentRevision).toBe(2)
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

test('history limit counts eligible zero-replica sets separately from active retained revisions', () => {
  let { run, lab, clusterId } = rolloutSeed(); run = apply(run, lab, clusterId, desired(run, clusterId)).run
  const uid = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].metadata.uid
  const template = run.runtime.kubernetes.clusters[clusterId].resources['Deployment/assistant/assistant'].spec.template
  for (let index = 0; index < 3; index++) run = registerRevision(run, { clusterId, deploymentUid: uid }, { ...template, metadata: { labels: { app: 'assistant' }, annotations: { revision: String(index) } } }).run
  const state = run.runtime.kubernetes.clusters[clusterId]
  state.resources['Deployment/assistant/assistant'].spec.revisionHistoryLimit = 1
  state.rollouts.deployments[uid].conditions = [{ type: 'Progressing', status: 'True', reason: 'NewReplicaSetAvailable' }]
  const pruned = pruneRevisionHistory(run, { clusterId, deploymentUid: uid }).runtime.kubernetes.clusters[clusterId]
  expect(pruned.rollouts.deployments[uid].revisions.map(item => item.revision)).toEqual([1, 3, 4])
})

test('release scope rejects HPA with an explicit fixed-replica trainer message', () => {
  const hpa = { apiVersion: 'autoscaling/v2', kind: 'HorizontalPodAutoscaler', metadata: { name: 'assistant', namespace: 'assistant' }, spec: {} }
  const result = validateKubernetesObject(hpa, { capabilities: { kubernetesResources: true, kubernetesRollouts: true } })
  expect(result.diagnostics[0].message).toMatch(/release.*fixed.*replica/i)
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

test('validates a JSON reloaded multi-revision deployment against each retained template', () => {
  let { run, lab, clusterId } = rolloutSeed()
  run = apply(run, lab, clusterId, desired(run, clusterId)).run
  run = apply(run, lab, clusterId, desired(run, clusterId, value => {
    value.spec.template.metadata.annotations = { release: 'second' }; return value
  })).run
  run = JSON.parse(JSON.stringify(run))
  expect(validateKubernetesRuntime(run.runtime.kubernetes, run, lab)).toBe(true)
  const state = run.runtime.kubernetes.clusters[clusterId]
  const uid = state.resources['Deployment/assistant/assistant'].metadata.uid
  expect(state.rollouts.deployments[uid].revisions).toHaveLength(2)
  const corruptions = [
    history => { history.currentRsUid = 'missing' },
    history => { history.nextRevision = history.currentRevision },
    history => { history.nextRevision = history.currentRevision + 2 },
    history => { history.currentRevision = 1 },
    history => { history.revisions[0].templateHash = 'deadbeef' },
    history => { history.revisions[0].template.spec.containers[0].image = 'bad:v1' },
    history => { history.lastProgressAtMs = -1 },
    history => { history.lastProgressAtMs = 1 },
    history => { history.availableSinceByPod['missing'] = 0 },
    history => { history.observedGeneration = 0 },
    history => { history.progressSnapshot.updated = -1 },
  ]
  for (const corrupt of corruptions) {
    const broken = structuredClone(run)
    corrupt(broken.runtime.kubernetes.clusters[clusterId].rollouts.deployments[uid])
    expect(validateKubernetesRuntime(broken.runtime.kubernetes, broken, lab)).toBe(false)
  }
  const broken = structuredClone(run)
  const rs = Object.values(broken.runtime.kubernetes.clusters[clusterId].resources).find(item => item.kind === 'ReplicaSet')
  rs.spec.selector = { matchLabels: { app: 'wrong' } }
  expect(validateKubernetesRuntime(broken.runtime.kubernetes, broken, lab)).toBe(false)
  const untracked = structuredClone(run)
  delete untracked.runtime.kubernetes.clusters[clusterId].rollouts.deployments[uid]
  expect(validateKubernetesRuntime(untracked.runtime.kubernetes, untracked, lab)).toBe(false)
})
