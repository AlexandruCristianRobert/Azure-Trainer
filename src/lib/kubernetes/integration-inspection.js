const SAFE_BINDINGS = ['collection', 'audience', 'published', 'vector', 'cutoff', 'limit']
const PROFILE_LABELS = Object.freeze({
  healthy: 'Healthy',
  'embedding-throttle-once': 'Throttled once',
  'postgres-unavailable-once': 'Database unavailable once',
  'answer-unavailable-always': 'Persistent answer failure',
  'embedding-timeout-always': 'Persistent timeout',
  'retry-after-too-long': 'Retry delay exceeds budget',
})
const empty = Object.freeze({ scenarioId: null, available: false })
function secretsFor(run) {
  const secrets = new Set()
  for (const state of Object.values(run?.runtime?.kubernetes?.clusters ?? {})) {
    for (const [uid, snapshot] of Object.entries(state?.podSnapshots ?? {})) for (const ref of snapshot.configRefs ?? []) {
      if (ref.kind !== 'Secret') continue
      const secret = ref.mode === 'file' ? snapshot.files?.[ref.target] : snapshot.environment?.[ref.target]
      if (typeof secret === 'string' && secret) secrets.add(secret)
    }
    for (const resource of Object.values(state?.resources ?? {})) if (resource.kind === 'Secret') for (const encoded of Object.values(resource.data ?? {})) {
      if (typeof encoded !== 'string' || !encoded) continue
      secrets.add(encoded)
      try { const decoded = atob(encoded); if (decoded) secrets.add(decoded) } catch { /* malformed Secret fixtures add no decoded value */ }
    }
  }
  return [...secrets].sort((a, b) => b.length - a.length)
}
const safeString = (value, secrets) => {
  if (typeof value !== 'string' || value.length > 128 || /[a-z][a-z+.-]*:\/\/[^/\s]*?(?::[^@/\s]+)?@/i.test(value)) return '[REDACTED]'
  return secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value)
}
const copyNumber = value => Number.isFinite(value) && value >= 0 && value <= 5000 ? value : null

function safeBindings(value, secrets) {
  const result = {}
  for (const key of SAFE_BINDINGS) {
    const item = value?.[key]
    if (item === undefined) continue
    if (key === 'published' && typeof item === 'boolean') result[key] = item
    else if (key === 'cutoff' && typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 2) result[key] = item
    else if (key === 'limit' && Number.isInteger(item) && item >= 1 && item <= 3) result[key] = item
    else if (key === 'vector' && typeof item === 'string' && /^\[\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:\s*,\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?){2}\s*\]$/i.test(item)) result[key] = safeString(item, secrets)
    else if (key === 'collection' || key === 'audience') result[key] = safeString(item, secrets)
    else result[key] = '[REDACTED]'
  }
  return result
}

/** Pure, read-only projection of the latest request for a Lab-declared AI scenario. */
export function inspectIntegration(run, lab, scenarioId) {
  const scenario = lab?.scenarios?.[scenarioId]
  if (scenario?.kind !== 'aks-request' || scenario.request?.path !== '/api/ask'
    || scenario.request?.method !== 'POST' || typeof scenario.request?.body?.question !== 'string'
    || typeof scenario.integrationProfile !== 'string' || !PROFILE_LABELS[scenario.integrationProfile]) return { ...empty }
  const request = [...(run?.runtime?.kubernetes?.requests ?? [])].reverse().find(item => item.scenarioId === scenarioId
    && item.request?.method === 'POST' && item.request?.path === '/api/ask' && item.integrationTrace)
  if (!request) return { scenarioId, available: true, question: scenario.request.body.question,
    profile: { id: scenario.integrationProfile, label: PROFILE_LABELS[scenario.integrationProfile] }, hasTrace: false }

  const trace = request.integrationTrace
  const secrets = secretsFor(run)
  const cleanId = value => safeString(value, secrets)
  const bindings = safeBindings(trace.queryBindings, secrets)
  const vector = bindings.vector
  const dimension = typeof vector === 'string' && vector.startsWith('[') ? vector.slice(1, -1).split(',').length : null
  const attempts = Array.isArray(trace.attempts) ? trace.attempts.slice(0, 9).map(item => ({
    operation: ['embedding', 'postgres-query', 'answer'].includes(item.operation) ? item.operation : 'unknown',
    attemptNumber: Number.isInteger(item.attemptNumber) && item.attemptNumber >= 1 && item.attemptNumber <= 3 ? item.attemptNumber : null,
    startMs: copyNumber(item.startMs), durationMs: copyNumber(item.durationMs), timeoutMs: copyNumber(item.timeoutMs),
    waitMs: copyNumber(item.delayBeforeNextMs), errorCode: typeof item.errorCode === 'string' && item.errorCode.length <= 64 ? item.errorCode : null,
  })) : []
  const distances = Array.isArray(trace.rankedDistances) ? trace.rankedDistances.slice(0, 3).flatMap(item =>
    typeof item?.id === 'string' && item.id.length <= 96 && Number.isFinite(item.distance) && item.distance >= 0 && item.distance <= 2
      ? [{ id: cleanId(item.id), distance: item.distance }] : []) : []
  const ops = ['embedding', 'postgres-query', 'answer'].map(name => ({ name,
    status: request.dependencyTrace?.find(item => item.operation === name)?.status ?? 'not-reached',
    attempts: attempts.filter(item => item.operation === name),
  }))
  const responseSources = Array.isArray(request.body?.sources) ? request.body.sources.filter(item => typeof item === 'string' && item.length <= 96).slice(0, 3) : []
  const sourceIds = trace.sourceProvenance === 'rows' ? responseSources : []
  return {
    scenarioId, available: true, hasTrace: true, question: scenario.request.body.question,
    profile: { id: scenario.integrationProfile, label: PROFILE_LABELS[scenario.integrationProfile] },
    validation: { disposition: trace.inputDisposition === 'rejected' ? 'rejected' : trace.inputDisposition === 'accepted' ? 'accepted' : 'unknown', status: Number.isInteger(request.status) ? request.status : null },
    vector: { dimension: Number.isInteger(dimension) && dimension <= 64 ? dimension : null, provenance: ['embedding', 'input', 'literal'].includes(trace.vectorProvenance) ? trace.vectorProvenance : null },
    bindings, rankedDocuments: distances.length ? distances : (trace.selectedIds ?? []).slice(0, 3).filter(id => typeof id === 'string').map(id => ({ id: cleanId(id), distance: null })),
    contextIds: Array.isArray(trace.contextIds) ? trace.contextIds.slice(0, 3).filter(id => typeof id === 'string' && id.length <= 96).map(cleanId) : [],
    sourceIds: sourceIds.map(cleanId), operations: ops, elapsedMs: copyNumber(trace.elapsedMs),
  }
}

/** Latest read-only integration summary per declared scenario on one cluster. */
export function inspectIntegrationRequests(run, lab, clusterId) {
  const seen = new Set()
  const summaries = []
  for (const request of [...(run?.runtime?.kubernetes?.requests ?? [])].reverse()) {
    const requestClusterId = request.clusterId ?? request.origin?.clusterId ?? request.route?.clusterId ?? request.route?.origin?.clusterId
    if (requestClusterId !== clusterId || !request.integrationTrace || seen.has(request.scenarioId)) continue
    const view = inspectIntegration(run, lab, request.scenarioId)
    if (!view.available) continue
    seen.add(request.scenarioId)
    summaries.push({ id: request.id, scenarioId: request.scenarioId, question: view.question, profile: view.profile.label,
      status: request.status, elapsedMs: view.elapsedMs,
      operations: view.operations.filter(operation => operation.status !== 'not-reached').map(operation => `${operation.name}: ${operation.status}`) })
  }
  return summaries
}

export { PROFILE_LABELS as INTEGRATION_PROFILE_LABELS }
