const VALUE_KEYS = new Set([
  'APP_ENV', 'AI_ENDPOINT', 'ANSWER_DEPLOYMENT', 'EMBEDDING_DEPLOYMENT',
  'PGHOST', 'PGDATABASE', 'PGUSER', 'COLLECTION',
])
const REDACTED = '[REDACTED]'

function resourceAt(state, reference) {
  return state?.resources?.[`${reference.kind}/${reference.namespace}/${reference.name}`] ?? null
}

/** Read-only, value-safe view of one running Pod's captured configuration. */
export function inspectPodConfiguration(run, clusterId, podUid) {
  const state = run?.runtime?.kubernetes?.clusters?.[clusterId]
  const pod = Object.values(state?.resources ?? {}).find(item => item.kind === 'Pod' && item.metadata.uid === podUid)
  const snapshot = state?.podSnapshots?.[podUid]
  if (!pod || !snapshot) return { podUid, environment: [], mountedFiles: [], references: [], resources: [], pendingProjection: null }

  const references = Array.isArray(snapshot.configRefs) ? snapshot.configRefs : []
  const envRefs = references.filter(reference => reference.mode === 'env')
  const fileRefs = references.filter(reference => reference.mode === 'file')
  const environment = Object.keys(snapshot.environment ?? {}).sort().map(name => {
    const reference = envRefs.find(item => item.target === name)
    const source = reference?.kind ?? 'Literal'
    const value = source === 'Secret' ? REDACTED : VALUE_KEYS.has(name) ? snapshot.environment[name] : undefined
    return { name, source, ...(value === undefined ? {} : { value }) }
  })
  const mountedFiles = fileRefs.map(reference => ({
    path: reference.target,
    source: reference.kind,
    name: reference.name,
    key: reference.key,
    capturedResourceVersion: reference.resourceVersion,
    appliedResourceVersion: resourceAt(state, reference)?.metadata?.resourceVersion ?? null,
    ...(reference.kind === 'Secret' ? { value: REDACTED } : {}),
  })).sort((a, b) => a.path.localeCompare(b.path))
  const resources = []
  const seen = new Set()
  for (const reference of references) {
    const id = `${reference.kind}/${reference.namespace}/${reference.name}`
    if (seen.has(id)) continue
    seen.add(id)
    const resource = resourceAt(state, reference)
    resources.push({
      kind: reference.kind,
      name: reference.name,
      namespace: reference.namespace,
      keys: Object.keys(resource?.data ?? {}).sort(),
      capturedResourceVersion: reference.resourceVersion,
      appliedResourceVersion: resource?.metadata?.resourceVersion ?? null,
    })
  }
  const dueAtMs = state.projectionDue?.[podUid]
  const remainingMs = Number.isFinite(dueAtMs) ? Math.max(0, dueAtMs - (run.runtime.simTimeMs ?? 0)) : null
  const pendingProjection = remainingMs === null ? null : { dueAtMs, remainingMs, secondsRemaining: Math.ceil(remainingMs / 1000) }
  return {
    podUid,
    namespace: pod.metadata.namespace,
    phase: pod.status?.phase ?? 'Unknown',
    environment,
    mountedFiles,
    references: references.map(({ kind, namespace, name, key, uid, resourceVersion, mode, target }) => ({ kind, namespace, name, key, uid, resourceVersion, mode, target })),
    resources: resources.sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`)),
    pendingProjection,
  }
}
