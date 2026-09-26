const clone = value => structuredClone(value)
const canonical = value => {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
}
export function rolloutTemplate(template) {
  const value = clone(template)
  delete value?.metadata?.labels?.['pod-template-hash']
  delete value?.metadata?.annotations?.['deployment.kubernetes.io/revision']
  return canonical(value)
}
const hash = value => { const text = JSON.stringify(value); let h = 2166136261; for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619); return (h >>> 0).toString(16) }
const deploymentKey = target => `${target.namespace}/${target.deploymentName}`
function stateFor(run, target) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  state.rollouts ??= { version: 1, deployments: {}, experiment: null, receipts: [] }
  return state.rollouts.deployments[deploymentKey(target)] ??= { nextRevision: 1, currentRevision: null, currentRsUid: null, observedGeneration: 0, revisions: [], availableSinceByPod: {}, lastProgressAtMs: run.runtime.simTimeMs ?? 0, progressSnapshot: { updated: 0, ready: 0, available: 0, oldActive: 0 }, conditions: [] }
}
export function registerRevision(input, target, template) {
  const run = clone(input); const state = run.runtime.kubernetes.clusters[target.clusterId]; const history = stateFor(run, target); const retained = rolloutTemplate(template); const templateHash = hash(retained)
  let revision = history.revisions.find(item => item.templateHash === templateHash)
  const nextRevision = history.nextRevision++
  if (!revision) {
    const rsUid = `kube-${run.nextSequence++}`
    revision = { revision: nextRevision, rsUid, templateHash, template: retained }
    history.revisions.push(revision)
  } else revision.revision = nextRevision
  history.currentRevision = nextRevision; history.currentRsUid = revision.rsUid
  return { run, revision: nextRevision, rsUid: revision.rsUid }
}
export function pruneRevisionHistory(input, target) {
  const run = clone(input); const state = run.runtime.kubernetes.clusters[target.clusterId]; const history = state?.rollouts?.deployments?.[deploymentKey(target)]
  if (!history) return run
  const deployment = Object.values(state.resources).find(item => item.kind === 'Deployment' && item.metadata.namespace === target.namespace && item.metadata.name === target.deploymentName)
  const limit = deployment?.spec?.revisionHistoryLimit ?? deployment?.spec?.strategy?.revisionHistoryLimit ?? 10
  const active = new Set(Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.deletionTimestamp === undefined).flatMap(item => item.metadata.ownerReferences?.map(ref => ref.uid) ?? []))
  const removable = history.revisions.filter(item => item.rsUid !== history.currentRsUid && !active.has(item.rsUid)).sort((a, b) => a.revision - b.revision)
  while (history.revisions.length > Math.min(20, limit + 1) && removable.length) {
    const stale = removable.shift(); history.revisions = history.revisions.filter(item => item.rsUid !== stale.rsUid)
    const rs = Object.values(state.resources).find(item => item.kind === 'ReplicaSet' && item.metadata.uid === stale.rsUid)
    if (rs) delete state.resources[`ReplicaSet/${rs.metadata.namespace ?? ''}/${rs.metadata.name}`]
  }
  return run
}
