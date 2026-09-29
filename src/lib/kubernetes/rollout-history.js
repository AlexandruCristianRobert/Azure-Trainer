import { reconcileKubernetesResult } from './reconcile.js'

const clone = value => structuredClone(value)
const canonical = value => Array.isArray(value) ? value.map(canonical) : !value || typeof value !== 'object' ? value : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
const hash = value => { const text = JSON.stringify(value); let h = 2166136261; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return (h >>> 0).toString(16) }
const key = (kind, namespace, name) => `${kind}/${namespace ?? ''}/${name}`
export function rolloutTemplate(template) {
  const value = clone(template)
  delete value?.metadata?.labels?.['pod-template-hash']
  delete value?.metadata?.annotations?.['deployment.kubernetes.io/revision']
  if (value?.metadata?.annotations && Object.keys(value.metadata.annotations).length === 0) delete value.metadata.annotations
  return canonical(value)
}
export const rolloutTemplateHash = template => hash(rolloutTemplate(template))
const deployment = (run, target) => Object.values(run.runtime.kubernetes.clusters[target.clusterId].resources).find(item => item.kind === 'Deployment' && item.metadata.uid === target.deploymentUid)
const replicaSets = (state, uid) => Object.values(state.resources).filter(item => item.kind === 'ReplicaSet' && item.metadata.ownerReferences?.some(ref => ref.uid === uid))
function historyFor(run, target) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]; const deploy = deployment(run, target); state.rollouts ??= { version: 1, deployments: {}, experiment: null, receipts: [] }
  if (state.rollouts.deployments[target.deploymentUid]) return state.rollouts.deployments[target.deploymentUid]
  const currentHash = rolloutTemplateHash(deploy.spec.template); let current = replicaSets(state, deploy.metadata.uid).find(rs => rolloutTemplateHash(rs.spec.template) === currentHash)
  if (!current) {
    const name = `${deploy.metadata.name}-${currentHash}`
    current = { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name, namespace: deploy.metadata.namespace, uid: `kube-${run.nextSequence++}`, resourceVersion: '1', ownerReferences: [{ uid: deploy.metadata.uid, kind: 'Deployment', name: deploy.metadata.name }] }, spec: { replicas: deploy.spec.replicas, selector: clone(deploy.spec.selector), template: clone(deploy.spec.template) }, status: {} }
    state.resources[key('ReplicaSet', current.metadata.namespace, name)] = current
  }
  return state.rollouts.deployments[target.deploymentUid] = { nextRevision: 2, currentRevision: 1, currentRsUid: current.metadata.uid, observedGeneration: deploy.metadata.generation ?? 1, revisions: [{ revision: 1, rsUid: current.metadata.uid, templateHash: currentHash, template: rolloutTemplate(current.spec.template), imageRef: current.spec.template.spec.containers[0]?.image ?? '' }], availableSinceByPod: {}, lastProgressAtMs: run.runtime.simTimeMs ?? 0, progressSnapshot: { updated: 0, ready: 0, available: 0, oldActive: 0 }, conditions: [] }
}
export function registerRevision(input, target, template) {
  const run = clone(input); const state = run.runtime.kubernetes.clusters[target.clusterId]; const deploy = state && deployment(run, target)
  if (!deploy) return { run: input, revision: null, rsUid: null, diagnostics: [{ code: 'KUBE_DEPLOYMENT_NOT_FOUND', message: 'The rollout Deployment is unavailable.' }] }
  const history = historyFor(run, target); const normalized = rolloutTemplate(template); const templateHashValue = hash(normalized); const current = history.revisions.find(item => item.rsUid === history.currentRsUid)
  if (current?.templateHash === templateHashValue) return { run, revision: history.currentRevision, rsUid: history.currentRsUid, diagnostics: [] }
  let revision = history.revisions.find(item => item.templateHash === templateHashValue)
  if (!revision && replicaSets(state, deploy.metadata.uid).length >= 20) return { run: input, revision: null, rsUid: null, diagnostics: [{ code: 'ROLLOUT_REPLICASET_LIMIT', message: 'A Deployment may retain at most 20 ReplicaSets.' }] }
  const number = history.nextRevision++
  if (revision) revision.revision = number
  else {
    const name = `${deploy.metadata.name}-${templateHashValue}`; const rsUid = `kube-${run.nextSequence++}`
    const rs = { apiVersion: 'apps/v1', kind: 'ReplicaSet', metadata: { name, namespace: deploy.metadata.namespace, uid: rsUid, resourceVersion: '1', ownerReferences: [{ uid: deploy.metadata.uid, kind: 'Deployment', name: deploy.metadata.name }] }, spec: { replicas: 0, selector: clone(deploy.spec.selector), template: clone(template) }, status: {} }
    state.resources[key('ReplicaSet', rs.metadata.namespace, name)] = rs
    revision = { revision: number, rsUid, templateHash: templateHashValue, template: normalized, imageRef: template.spec.containers[0]?.image ?? '' }; history.revisions.push(revision)
  }
  history.currentRevision = number; history.currentRsUid = revision.rsUid; history.observedGeneration = deploy.metadata.generation ?? history.observedGeneration
  history.lastProgressAtMs = run.runtime.simTimeMs ?? 0
  history.progressSnapshot = { updated: 0, ready: 0, available: 0, oldActive: 0 }
  history.conditions = []
  return { run, revision: number, rsUid: revision.rsUid, diagnostics: [] }
}
export function pruneRevisionHistory(input, target) {
  const run = clone(input); const state = run.runtime.kubernetes.clusters[target.clusterId]; const history = state?.rollouts?.deployments?.[target.deploymentUid]; const deploy = state && deployment(run, target)
  if (!history || !deploy) return run
  if (!history.conditions.some(item => item?.type === 'Progressing' && item?.status === 'True' && item?.reason === 'NewReplicaSetAvailable')) return run
  const limit = deploy.spec.revisionHistoryLimit ?? 10; const pods = Object.values(state.resources).filter(item => item.kind === 'Pod')
  const removable = history.revisions.filter(item => item.rsUid !== history.currentRsUid).filter(item => { const rs = replicaSets(state, deploy.metadata.uid).find(value => value.metadata.uid === item.rsUid); return rs?.spec.replicas === 0 && !pods.some(pod => pod.metadata.ownerReferences?.some(ref => ref.uid === item.rsUid)) }).sort((a, b) => a.revision - b.revision)
  while (removable.length > limit) { const stale = removable.shift(); const rs = replicaSets(state, deploy.metadata.uid).find(value => value.metadata.uid === stale.rsUid); history.revisions = history.revisions.filter(item => item.rsUid !== stale.rsUid); if (rs) delete state.resources[key('ReplicaSet', rs.metadata.namespace, rs.metadata.name)] }
  return run
}

export function undoDeployment(input, target, { revision = null } = {}, lab) {
  const fail = (code, message) => ({ run: input, lines: [], diagnostics: [{ code, message }] })
  if (lab?.capabilities?.kubernetesRollouts !== true) return fail('ROLLOUT_UNSUPPORTED', 'Deployment undo is available only in release Labs with rollout support.')
  const state = input.runtime?.kubernetes?.clusters?.[target.clusterId]
  const deploy = Object.values(state?.resources ?? {}).find(item => item.kind === 'Deployment'
    && (target.deploymentUid ? item.metadata.uid === target.deploymentUid : item.metadata.namespace === target.namespace && item.metadata.name === target.deploymentName))
  if (!deploy) return fail('KUBE_DEPLOYMENT_NOT_FOUND', 'The rollout Deployment is unavailable.')
  if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) return fail('ROLLOUT_INVALID_REVISION', 'A rollout revision must be a positive integer.')
  const history = state.rollouts?.deployments?.[deploy.metadata.uid]
  const selected = revision === null ? history?.revisions.filter(item => item.revision < history.currentRevision).sort((a, b) => b.revision - a.revision)[0]
    : history?.revisions.find(item => item.revision === revision)
  if (!selected) return fail('ROLLOUT_REVISION_NOT_RETAINED', revision === null ? 'No previous retained revision is available to undo.' : `Revision ${revision} is not retained; it may have been pruned.`)
  if (selected.rsUid === history.currentRsUid) return fail('ROLLOUT_REVISION_CURRENT', `Revision ${selected.revision} is already current.`)
  const rs = replicaSets(state, deploy.metadata.uid).find(item => item.metadata.uid === selected.rsUid)
  if (!rs) return fail('ROLLOUT_REVISION_NOT_RETAINED', `Revision ${selected.revision} has no retained ReplicaSet; it may have been pruned.`)
  const next = clone(input)
  const live = next.runtime.kubernetes.clusters[target.clusterId].resources[key('Deployment', deploy.metadata.namespace, deploy.metadata.name)]
  live.spec.template = clone(selected.template)
  live.metadata.generation = (live.metadata.generation ?? 1) + 1
  live.metadata.resourceVersion = String(Number(live.metadata.resourceVersion) + 1)
  const registered = registerRevision(next, { clusterId: target.clusterId, deploymentUid: deploy.metadata.uid }, live.spec.template)
  if (registered.diagnostics.length) return { run: input, lines: [], diagnostics: registered.diagnostics }
  const result = reconcileKubernetesResult(registered.run, lab)
  if (result.diagnostics.length) return { run: input, lines: [], diagnostics: result.diagnostics }
  return { run: result.run, lines: [{ kind: 'out', text: `deployment.apps/${deploy.metadata.name} rolled back to retained template ${selected.revision} as revision ${registered.revision} (simulated).` }], diagnostics: [] }
}
