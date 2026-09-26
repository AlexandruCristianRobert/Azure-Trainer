export function clearPodState(state, uid) {
  delete state.podSnapshots[uid]
  delete state.projectionDue[uid]
  delete state.resourcesRuntime?.assignments?.[uid]
  delete state.resourcesRuntime?.usage?.[uid]
  delete state.resourcesRuntime?.terminationDue?.[uid]
  delete state.health?.containers?.[uid]
}

export function deleteCascade(state, roots, namespace = null) {
  const ids = new Set(roots.map(item => item.metadata.uid))
  let changed = true
  while (changed) {
    changed = false
    for (const candidate of Object.values(state.resources)) {
      if ((namespace !== null && candidate.metadata.namespace === namespace)
        || candidate.metadata.ownerReferences?.some(ref => ids.has(ref.uid))) {
        if (!ids.has(candidate.metadata.uid)) { ids.add(candidate.metadata.uid); changed = true }
      }
    }
  }
  for (const candidate of Object.values(state.resources)) if (ids.has(candidate.metadata.uid)) {
    if (candidate.kind === 'Pod') clearPodState(state, candidate.metadata.uid)
    delete state.resources[`${candidate.kind}/${candidate.metadata.namespace ?? ''}/${candidate.metadata.name}`]
  }
}
