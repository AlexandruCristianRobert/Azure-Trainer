import { getProjectManifest } from '../project/manifests.js'
import { currentRolloutSecrets, retainedRolloutRedactions } from './rollout-redaction.js'

const copy = value => structuredClone(value)
const issuedDiagnosisRequests = new WeakMap()
// Cloning/persisting a request never grants permission to mint a new receipt.
export const nativeDiagnosisRequest = request => issuedDiagnosisRequests.has(request) && issuedDiagnosisRequests.get(request) === JSON.stringify(request)
const count = value => Number.isSafeInteger(value) && value >= 0
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const sourceKeys = new Set(['event', 'request_id', 'status', 'endpoint', 'deployment', 'configuration_ref', 'error_code'])
const forbiddenKey = /authorization|credential|password|connection.?string|stack|traceback|token|secret/i
const unsafeText = /(?:[a-z][a-z+.-]*:\/\/[^\s/]*@|\b(?:Bearer|Basic)\s+|\b(?:Password|AccountKey|SharedAccessSignature)\s*=|Traceback|\bat\s+\S+\s*\([^)]*:\d+)/i

// The captured project capability also covers scenario/probe callers which have
// no Lab argument. Older manifests never acquire diagnosis state or new IDs.
export function requestDiagnosticsEnabled(run) {
  return getProjectManifest(run.project.manifestId)?.diagnosticsVersion === 1
}

export function allocateRequest(input) {
  const run = copy(input)
  const requestId = `request-${run.nextSequence++}`
  return { run, requestId }
}

export function redactRequestValue(value, state) {
  const secrets = [...retainedRolloutRedactions(state ?? {}), ...currentRolloutSecrets(state ?? {})]
    .filter(Boolean).sort((a, b) => b.length - a.length)
  const clean = (item, depth = 0) => {
    if (depth > 16) return null
    if (typeof item === 'string') {
      if (unsafeText.test(item)) return '[REDACTED]'
      return secrets.reduce((text, secret) => text.split(secret).join('[REDACTED]'), item).slice(0, 4096)
    }
    if (item === null || typeof item === 'boolean') return item
    if (typeof item === 'number') return Number.isFinite(item) ? item : null
    if (Array.isArray(item)) return item.map(entry => clean(entry, depth + 1))
    if (plain(item)) return Object.fromEntries(Object.entries(item).filter(([key]) => !forbiddenKey.test(key))
      .map(([key, entry]) => [clean(key, depth + 1), clean(entry, depth + 1)]))
    return null
  }
  return clean(value)
}

function safeSource(fields, descriptor, state) {
  return redactRequestValue(Object.fromEntries(Object.entries(fields ?? {})
    .filter(([key]) => Object.hasOwn(descriptor?.fields ?? {}, key))), state)
}

function logDescriptors(app) {
  const result = []; let afterCore = false
  for (const statement of app?.diagnostics?.statements ?? []) {
    if (statement.op === 'return') break
    if (statement.op === 'core') afterCore = true
    if (statement.op === 'log' && statement.enabled !== false) result.push({ fields: statement.fields, afterCore })
  }
  return result
}

// Real integration profiles have at most nine attempts. Keep the record bound
// independently defensive without changing or truncating the execution trace.
export function boundDependencyRecords(attempts, envelope, sequence) {
  return { records: attempts.slice(0, 30).map((attempt, index) => ({ ...envelope,
    id: `dependency-${sequence}-${index + 1}`, requestElapsedMs: attempt.startMs,
    operation: attempt.operation, attemptNumber: attempt.attemptNumber, durationMs: attempt.durationMs,
    timeoutMs: attempt.timeoutMs, errorCode: attempt.errorCode, delayBeforeNextMs: attempt.delayBeforeNextMs })),
  truncated: Math.max(0, attempts.length - 30) }
}

/** The dispatch boundary's sole append owner. The compatibility projection is
 * intentionally limited to older manifests and is never a diagnosis store. */
export function recordRequestOutcome(input, target, outcome) {
  const run = copy(input), runtime = run.runtime.kubernetes
  const clusterId = target.origin.clusterId, state = runtime.clusters[clusterId]
  const sequence = Number(outcome.requestId.match(/(?:aks-)?request-(\d+)$/)?.[1])
  const diagnosis = requestDiagnosticsEnabled(run)
  const route = outcome.route ?? {}, container = state?.health?.containers?.[outcome.podUid ?? route.podUid]
  const base = { id: outcome.requestId, sequence, connectivity: true, scenarioId: null,
    transport: outcome.transport, status: outcome.status, route, namespace: route.namespace ?? 'diagnostics',
    dependencyTrace: outcome.dependencyTrace ?? [], origin: target.origin, hostname: target.hostname, port: target.port,
    integrationTrace: outcome.integrationTrace ?? null,
    request: { method: target.method, path: target.path, ...(target.body == null ? {} : { body: target.body }) },
    ...(outcome.workload ? { workload: outcome.workload } : {}) }
  if (diagnosis) {
    const executed = outcome.transport.ok && outcome.podUid !== null && !!container
    const envelope = { requestId: outcome.requestId, clusterId, namespace: base.namespace,
      podUid: executed ? outcome.podUid : null, containerId: executed ? outcome.containerId : null,
      artifactId: executed ? outcome.artifactId : null, simTimeMs: run.runtime.simTimeMs,
      origin: target.origin }
    const elapsedMs = outcome.integrationTrace?.elapsedMs ?? 0
    const attempts = executed ? outcome.integrationTrace?.attempts ?? [] : []
    const dependencies = boundDependencyRecords(attempts, envelope, sequence)
    Object.assign(base, { ...envelope, diagnosticsVersion: 1, requestElapsedMs: elapsedMs,
      body: outcome.body, dependencyRecords: dependencies.records, dependencyTruncated: dependencies.truncated })
    if (executed) {
      const app = run.artifacts.buildsById[outcome.artifactId]?.appSpec
      const descriptors = logDescriptors(app)
      const application = (outcome.appLogRecords ?? []).slice(0, 100).map((fields, index) => ({ ...envelope,
        id: `application-${sequence}-${index + 1}`,
        requestElapsedMs: descriptors[index]?.afterCore ? elapsedMs : 0,
        // Retained logs can outlive the bounded request history. Preserve the
        // actual execution result separately from learner-authored fields.
        resultStatus: outcome.status,
        sourceFields: safeSource(fields, descriptors[index], state),
        sourceBindings: Object.fromEntries(Object.entries(descriptors[index]?.fields ?? {}).filter(([key]) => sourceKeys.has(key))
          .map(([key, descriptor]) => [key, descriptor.kind])) }))
      const stream = [...container.currentLogs, ...redactRequestValue(application, state)]
      container.logsTruncated = (container.logsTruncated ?? 0) + Math.max(0, stream.length - 100)
      container.currentLogs = stream.slice(-100)
    }
    runtime.requestsTruncated = (runtime.requestsTruncated ?? 0) + Math.max(0, runtime.requests.length + 1 - 100)
  } else if (outcome.transport.ok && route.podUid) {
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === route.podUid)
    const summary = (outcome.dependencyTrace ?? []).map(item => ({ operation: item.operation, status: item.status, ...(item.reason ? { reason: item.reason } : {}) }))
    const log = { requestId: outcome.requestId, sequence, podUid: route.podUid, podName: pod.metadata.name,
      namespace: pod.metadata.namespace, image: pod.spec.containers[0].image, method: target.method, path: target.path,
      status: outcome.status, artifactId: route.artifactId, dependencySummary: summary }
    state.connectivity.applicationLogs = [...state.connectivity.applicationLogs, redactRequestValue(log, state)].slice(-200)
    if (container) container.currentLogs = [...container.currentLogs,
      `request=${outcome.requestId} ${target.method} ${target.path} status=${outcome.status} dependencies=${summary.map(item => `${item.operation}:${item.status}`).join(',')}`].slice(-100)
  }
  runtime.requests = [...runtime.requests, redactRequestValue(base, state)].slice(-100)
  if (diagnosis) issuedDiagnosisRequests.set(runtime.requests.at(-1), JSON.stringify(runtime.requests.at(-1)))
  const retainedIds = new Set(runtime.requests.map(item => item.id))
  for (const cluster of Object.values(runtime.clusters)) if (cluster.connectivity)
    cluster.connectivity.applicationLogs = cluster.connectivity.applicationLogs.filter(log => retainedIds.has(log.requestId))
  return run
}

export function inspectRequestRecords(run, { clusterId, requestId }) {
  const state = run.runtime?.kubernetes?.clusters?.[clusterId]
  const request = run.runtime?.kubernetes?.requests?.find(item => item.diagnosticsVersion === 1 && item.clusterId === clusterId && item.id === requestId) ?? null
  const containers = Object.values(state?.health?.containers ?? {})
  const application = containers.flatMap(container => [...container.currentLogs, ...(container.previous?.logs ?? [])])
    .filter(log => plain(log) && log.requestId !== null && log.requestId === requestId && log.clusterId === clusterId)
  return redactRequestValue({ request, application, dependency: request?.dependencyRecords ?? [], truncated: {
    requests: run.runtime?.kubernetes?.requestsTruncated ?? 0,
    application: containers.reduce((total, container) => total + (container.logsTruncated ?? 0) + (container.previous?.logsTruncated ?? 0), 0),
    dependency: request?.dependencyTruncated ?? 0,
  } }, state)
}

export function formatContainerLog(log) {
  return typeof log === 'string' ? log : JSON.stringify(log)
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const clock = value => Number.isSafeInteger(value) && value >= 0
const safe = (value, state) => same(value, redactRequestValue(value, state))
const envelopeKeys = ['id', 'requestId', 'clusterId', 'namespace', 'podUid', 'containerId', 'artifactId', 'simTimeMs', 'requestElapsedMs', 'origin']
function validOrigin(origin, clusterId, state) {
  return plain(origin) && origin.clusterId === clusterId
    && (exact(origin, ['kind', 'clusterId']) && origin.kind === 'external'
      || exact(origin, ['kind', 'clusterId', 'podUid']) && origin.kind === 'pod'
        && state.connectivity?.diagnosticPodUids.includes(origin.podUid))
}
function validEnvelope(item, run, clusterId, state) {
  return item.clusterId === clusterId && typeof item.namespace === 'string' && item.namespace.length <= 63
    && /^kube-[1-9]\d*$/.test(item.podUid ?? '') && /^container-[1-9]\d*$/.test(item.containerId ?? '')
    && typeof item.artifactId === 'string' && !!run.artifacts.buildsById[item.artifactId]
    && clock(item.simTimeMs) && item.simTimeMs <= run.runtime.simTimeMs
    && clock(item.requestElapsedMs) && item.requestElapsedMs <= 5000
    && validOrigin(item.origin, clusterId, state)
    && safe(item, state)
}

export function validRequestDiagnostics(item, run) {
  const newKeys = ['diagnosticsVersion', 'requestId', 'containerId', 'simTimeMs', 'requestElapsedMs', 'dependencyRecords', 'dependencyTruncated']
  if (item.diagnosticsVersion === undefined) return newKeys.every(key => item[key] === undefined)
  if (!requestDiagnosticsEnabled(run) || item.diagnosticsVersion !== 1 || item.id !== `request-${item.sequence}`
    || item.requestId !== item.id || item.clusterId !== item.origin?.clusterId
    || !clock(item.simTimeMs) || item.simTimeMs > run.runtime.simTimeMs || !clock(item.requestElapsedMs) || item.requestElapsedMs > 5000
    || !count(item.dependencyTruncated) || !Array.isArray(item.dependencyRecords) || item.dependencyRecords.length > 30) return false
  const state = run.runtime.kubernetes.clusters[item.clusterId]
  if (!state || !safe(item, state) || !validOrigin(item.origin, item.clusterId, state)
    || !plain(item.transport) || typeof item.transport.ok !== 'boolean' || !plain(item.route)) return false
  if (!item.transport.ok) return item.status === null && item.podUid === null && item.containerId === null && item.artifactId === null
    && item.dependencyRecords.length === 0 && item.dependencyTruncated === 0
    && ['podUid', 'podName', 'artifactId', 'containerId'].every(key => item.route[key] === undefined)
  if (!validEnvelope(item, run, item.clusterId, state) || item.route.podUid !== item.podUid
    || item.route.containerId !== item.containerId || item.route.artifactId !== item.artifactId || item.route.namespace !== item.namespace) return false
  // A retained identity may be historical, but a known live/previous identity
  // must never be reassigned to another Pod in a fabricated client trace.
  for (const [uid, container] of Object.entries(state.health?.containers ?? {})) {
    if ([container.containerId, container.previous?.containerId].includes(item.containerId) && uid !== item.podUid) return false
    if (container.containerId === item.containerId && state.podSnapshots[uid]?.artifactId !== item.artifactId) return false
  }
  if (Number(item.containerId.slice(10)) >= item.sequence) return false
  return item.dependencyRecords.every((record, index) => exact(record, [...envelopeKeys,
    'operation', 'attemptNumber', 'durationMs', 'timeoutMs', 'errorCode', 'delayBeforeNextMs'])
    && validEnvelope(record, run, item.clusterId, state) && record.id === `dependency-${item.sequence}-${index + 1}`
    && ['requestId', 'podUid', 'containerId', 'artifactId', 'namespace', 'simTimeMs'].every(key => record[key] === item[key])
    && same(record.origin, item.origin) && ['embedding', 'postgres-query', 'answer'].includes(record.operation)
    && Number.isInteger(record.attemptNumber) && record.attemptNumber >= 1 && record.attemptNumber <= 3
    && ['durationMs', 'timeoutMs', 'delayBeforeNextMs'].every(key => clock(record[key]) && record[key] <= 5000)
    && (record.errorCode === null || typeof record.errorCode === 'string' && record.errorCode.length <= 64
      && /^(?:[A-Z_0-9]|\[REDACTED\])+$/.test(record.errorCode)))
}

export function validContainerRequestLogs(container, uid, state, run, clusterId) {
  const diagnosis = requestDiagnosticsEnabled(run)
  if (container.logsTruncated !== undefined && (!diagnosis || !count(container.logsTruncated))) return false
  if (container.previous?.logsTruncated !== undefined && (!diagnosis || !count(container.previous.logsTruncated))) return false
  if (diagnosis && container.previous && (container.previous.containerId === container.containerId
    ? container.restartAtMs === null || container.currentLogs.length !== 0 : !/^container-[1-9]\d*$/.test(container.previous.containerId))) return false
  const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === uid)
  const ids = new Set()
  return [[container.currentLogs, container.containerId], [container.previous?.logs ?? [], container.previous?.containerId]].every(([stream, containerId]) =>
    stream.every((log, index) => {
      if (typeof log === 'string') return log.length <= 4096 && (!diagnosis || safe(log, state))
      if (!diagnosis || !exact(log, [...envelopeKeys, 'resultStatus', 'sourceFields', 'sourceBindings']) || !validEnvelope(log, run, clusterId, state)
        || !(log.resultStatus === null || Number.isInteger(log.resultStatus) && log.resultStatus >= 100 && log.resultStatus <= 599)
        || log.podUid !== uid || log.namespace !== pod?.metadata.namespace || log.containerId !== containerId
        || containerId === container.containerId && state.podSnapshots[uid]?.artifactId !== log.artifactId
        || ids.has(log.id) || !plain(log.sourceFields) || !plain(log.sourceBindings)
        || Object.keys(log.sourceFields).some(key => !sourceKeys.has(key))
        || Object.values(log.sourceFields).some(value => value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
        || Object.keys(log.sourceBindings).some(key => !sourceKeys.has(key) || !['literal', 'request-id', 'result-status'].includes(log.sourceBindings[key]))) return false
      ids.add(log.id)
      const match = /^application-([1-9]\d*)-([1-9]\d*)$/.exec(log.id)
      if (!match || Number(match[1]) >= run.nextSequence || Number(match[2]) > 100) return false
      const prior = stream[index - 1]
      if (plain(prior)) {
        const previous = /^application-([1-9]\d*)-([1-9]\d*)$/.exec(prior.id)
        if (!previous || Number(previous[1]) > Number(match[1])
          || Number(previous[1]) === Number(match[1]) && Number(previous[2]) >= Number(match[2])
          || prior.simTimeMs > log.simTimeMs) return false
      }
      if (log.requestId === null) return log.resultStatus === null && Object.values(log.sourceBindings).every(kind => kind === 'literal')
      if (log.requestId !== `request-${match[1]}`) return false
      const request = run.runtime.kubernetes.requests.find(item => item.id === log.requestId)
      if (request && (!['podUid', 'containerId', 'artifactId', 'namespace', 'simTimeMs', 'clusterId'].every(key => request[key] === log[key])
        || log.resultStatus !== request.status || !same(log.origin, request.origin))) return false
      const descriptors = logDescriptors(run.artifacts.buildsById[log.artifactId]?.appSpec)
      const descriptor = descriptors[Number(match[2]) - 1]
      const bindings = Object.fromEntries(Object.entries(descriptor?.fields ?? {}).map(([key, field]) => [key, field.kind]))
      return !!descriptor && exact(log.sourceFields, Object.keys(descriptor.fields)) && same(log.sourceBindings, bindings)
        && Object.entries(descriptor?.fields ?? {}).every(([key, field]) => {
          if (field.kind === 'request-id') return log.sourceFields[key] === log.requestId
          if (field.kind === 'result-status') return log.sourceFields[key] === log.resultStatus
          return same(log.sourceFields[key], redactRequestValue(field.value, state))
        })
    }))
}
