import { canonicalize } from '../labEngine/evidence.js'
import { messagingResourceConfiguration } from '../messaging/evidence.js'
import { closedHttpObject, httpCounter, normalizeOrder, sameCanonicalOrder, normalizeHttpTarget, matchHttpRoute, jsonBytes, HTTP_LIMITS } from './contracts.js'
import { emptyHttpFunctionsState, validateHttpFunctionsState, validateHttpCapture, validateHttpAcceptedRecord, validateHttpRequestRecord, validateHttpResponse } from './state.js'
import { sensitiveTelemetry, sensitiveTelemetryName } from '../observability/privacy.js'
import { parseMessagingProject } from '../messaging/python.js'
import { HTTP_PROFILE } from './contracts.js'
import { HTTP_RUNTIME_FILES } from '../../data/templates/http-functions-python/runtime.js'

const same = (a, b) => canonicalize(a) === canonicalize(b)
const number = id => Number(id.split('-').at(-1))
const exact = (value, keys) => closedHttpObject(value, keys.split(','))
const id = (value, prefix) => typeof value === 'string' && new RegExp(`^${prefix}-[1-9]\\d*$`).test(value)
const list = (value, max = 50) => Array.isArray(value) && value.length <= max
const unique = values => new Set(values).size === values.length
export function httpPublicSafe(value, protectedValues = []) {
  if (typeof value === 'string') {
    if (protectedValues.some(secret => secret && value.includes(secret)) || sensitiveTelemetry(value)) return false
    if (/^\s*[\[{]/.test(value)) { try { return httpPublicSafe(JSON.parse(value), protectedValues) } catch { /* non-JSON text */ } }
  } else if (value && typeof value === 'object') return Object.entries(value).every(([key, item]) => !sensitiveTelemetryName(key)
    && key.toLowerCase() !== 'x-functions-key' && httpPublicSafe(key, protectedValues) && httpPublicSafe(item, protectedValues))
  return true
}
// Only the selected app and its supporting resource configuration affect HTTP freshness.
export function httpResourceStamp(run, lab) {
  const config = lab.messagingInput.httpFunctions, parts = config.appId.toLowerCase().split('/'), name = parts.at(-1), group = parts[4]
  const app = run.sandbox.functionApps.find(row => row.name.toLowerCase() === name && row.resourceGroup.toLowerCase() === group)
  const value = messagingResourceConfiguration({ app: app ?? null,
    group: run.sandbox.resourceGroups.find(row => row.name.toLowerCase() === group) ?? null,
    storage: run.sandbox.storageAccounts.filter(row => row.name === app?.storageAccount && row.resourceGroup === app?.storageResourceGroup),
    namespaces: run.sandbox.namespaces.filter(row => row.name.toLowerCase() === config.target.namespace.toLowerCase() && row.resourceGroup.toLowerCase() === config.target.resourceGroup.toLowerCase()),
    roles: run.sandbox.roleAssignments ?? [], identities: run.sandbox.managedIdentities ?? [] })
  // A deterministic value-free fingerprint: secret-bearing app settings stay private.
  let hash = 2166136261
  for (const char of canonicalize(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0
  return hash.toString(16).padStart(8, '0')
}
export function refreshHttpDependencies(before, after, lab) {
  if (lab?.capabilities?.httpFunctions !== true || httpResourceStamp(before, lab) === httpResourceStamp(after, lab)) return after
  return { ...after, dependencyGenerations: { ...after.dependencyGenerations,
    'http:resources': Math.max(after.dependencyGenerations['http:resources'] ?? 0, (before.dependencyGenerations['http:resources'] ?? 0) + 1) } }
}
export function httpMeasurements(before, after) {
  before ??= emptyHttpFunctionsState()
  const selected = rows => structuredClone(rows.filter(row => number(row.id) >= before.nextId))
  return { version: 1, beforeNextId: before.nextId, afterNextId: after.nextId,
    captures: selected([...after.localHosts, ...after.deployments]).sort((a, b) => number(a.id) - number(b.id)),
    accepted: selected(after.accepted), requests: selected(after.requests), invocations: [] }
}
function validRead(row) {
  if (!id(row?.id, 'http-read') || !httpCounter(row.atNextId) || row.atNextId < 1) return false
  if (row.kind === 'environment') return exact(row, 'id,atNextId,kind,name,value') && typeof row.name === 'string' && row.name.length <= 256
    && (row.value === null || typeof row.value === 'string') && httpPublicSafe(row)
  if (row.kind !== 'repository' || !exact(row, 'id,atNextId,kind,orderId,found,record') || typeof row.orderId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(row.orderId) || typeof row.found !== 'boolean') return false
  if (!row.found) return row.record === null
  const r = row.record
  if (!exact(r, 'id,region,quantity,status,generation,origin') || !['pending', 'processed', 'failed'].includes(r.status) || !httpCounter(r.generation)
    || !exact(r.origin, 'appId,target,acceptedId,entityId,messageRecordId,sendReceiptId,workerReceiptId') || r.id !== row.orderId) return false
  try { normalizeOrder({ id: r.id, region: r.region, quantity: r.quantity }); normalizeHttpTarget(r.origin.target) } catch { return false }
  return typeof r.origin.appId === 'string' && typeof r.origin.entityId === 'string' && id(r.origin.messageRecordId, 'message')
    && id(r.origin.sendReceiptId, 'trace') && (r.origin.acceptedId === null || id(r.origin.acceptedId, 'http-accepted'))
    && (r.origin.workerReceiptId === null || id(r.origin.workerReceiptId, 'trace')) && httpPublicSafe(row)
}
function validInvocation(row) {
  return exact(row, 'executionId,requestId,captureId,functionId,keyId,requestOrder,resourceStamp,resourceGeneration,reads,operations,consumedReadIds,consumedFields,response')
    && id(row.executionId, 'execution') && id(row.requestId, 'http-request') && id(row.captureId, 'http-capture')
    && (row.functionId === null || typeof row.functionId === 'string') && (row.keyId === null || typeof row.keyId === 'string')
    && (row.requestOrder === null || (() => { try { normalizeOrder(row.requestOrder); return true } catch { return false } })())
    && /^[a-f0-9]{8}$/.test(row.resourceStamp) && httpCounter(row.resourceGeneration)
    && list(row.reads) && row.reads.every(validRead) && unique(row.reads.map(r => r.id))
    && list(row.operations) && row.operations.every(op => exact(op, 'id,kind,target,sendReceiptId,acceptedId') && id(op.id, 'http-operation')
      && ['sdk-send', 'binding-send'].includes(op.kind) && id(op.sendReceiptId, 'trace') && (op.acceptedId === null || id(op.acceptedId, 'http-accepted'))
      && (() => { try { return same(normalizeHttpTarget(op.target), op.target) } catch { return false } })()) && unique(row.operations.map(op => op.id))
    && list(row.consumedReadIds) && unique(row.consumedReadIds) && row.consumedReadIds.every(readId => row.reads.some(r => r.id === readId))
    && list(row.consumedFields, 250) && row.consumedFields.every(field => exact(field, 'readId,field') && row.consumedReadIds.includes(field.readId)
      && ['id', 'region', 'quantity', 'status', 'value'].includes(field.field))
    && validateHttpResponse(row.response) && httpPublicSafe(row.response)
}
export function validHttpMeasurement(value) {
  if (!exact(value, 'version,beforeNextId,afterNextId,captures,accepted,requests,invocations') || value.version !== 1
    || !httpCounter(value.beforeNextId) || value.beforeNextId < 1 || !httpCounter(value.afterNextId) || value.afterNextId < value.beforeNextId
    || !list(value.captures, 16) || !value.captures.every(validateHttpCapture) || !list(value.accepted) || !value.accepted.every(validateHttpAcceptedRecord)
    || !list(value.requests, 1) || !value.requests.every(validateHttpRequestRecord) || !list(value.invocations, 1) || !value.invocations.every(validInvocation)
    || value.invocations.length !== value.requests.length || jsonBytes(value) > HTTP_LIMITS.stateBytes) return false
  const numbers = [...value.captures, ...value.accepted, ...value.requests].map(row => number(row.id)).sort((a, b) => a - b)
  return numbers.length === value.afterNextId - value.beforeNextId && numbers.every((n, index) => n === value.beforeNextId + index)
}
function historicalRepository(state, messages, traces, request, target, read) {
  const eligible = traces.filter(row => number(row.id) < read.atNextId), accepted = state.accepted.filter(row => row.order.id === read.orderId
    && same(row.target, target) && eligible.some(trace => trace.id === row.sendReceiptId))
  const owned = accepted.find(row => row.appId === request.appId)
  if (accepted.length && !owned) return null
  const payload = message => { try { return normalizeOrder(JSON.parse(message.body)) } catch { return null } }
  const message = owned ? messages.find(row => row.id === owned.messageRecordId) : messages.find(row => payload(row)?.id === read.orderId
    && eligible.some(trace => trace.kind === 'enqueue' && trace.messageRecordId === row.id)
    && eligible.some(trace => trace.kind === 'send' && trace.entityId === row.entityId && trace.sourceMessageId === row.sourceMessageId)
    && row.entityId.endsWith(`/resourcegroups/${target.resourceGroup}/providers/microsoft.servicebus/namespaces/${target.namespace}/queues/${target.queue}`))
  if (!message) return null
  const order = owned?.order ?? payload(message), send = eligible.find(row => row.kind === 'send' && row.entityId === message.entityId && row.sourceMessageId === message.sourceMessageId)
  if (!send) return null
  const work = eligible.find(row => row.kind === 'order-record' && row.messageRecordId === message.id && sameCanonicalOrder(row.order, order))
  const terminal = eligible.some(row => ['deadletter', 'message-expired'].includes(row.kind) && row.messageRecordId === message.id)
  return { ...order, status: work ? 'processed' : terminal ? 'failed' : 'pending', generation: owned?.generation ?? 0,
    origin: { appId: request.appId, target, acceptedId: owned?.id ?? null, entityId: message.entityId, messageRecordId: message.id, sendReceiptId: send.id, workerReceiptId: work?.id ?? null } }
}
/** Pair every new extension record with its one authoritative command receipt. */
export function validHttpJournal(messaging, labInput, sandbox) {
  try { return checkHttpJournal(messaging, labInput, sandbox) } catch { return false }
}
function checkHttpJournal(messaging, labInput, sandbox) {
  const state = messaging.httpFunctions
  if (state === undefined) return !(messaging.executionReceipts ?? []).some(row => row.measurements.httpFunctions !== undefined)
  if (!validateHttpFunctionsState(state)) return false
  const captures = [...state.localHosts, ...state.deployments], allRows = [...captures, ...state.accepted, ...state.requests]
  for (const [history, selection] of [[state.localHosts, state.currentLocal], [state.deployments, state.currentPublished]]) {
    const latest = {}, generations = {}
    for (const capture of history) {
      if (capture.status !== 'captured' || capture.generation !== (generations[capture.appId] ?? 0) + 1) return false
      latest[capture.appId] = capture.id; generations[capture.appId] = capture.generation
    }
    if (!same(selection, latest)) return false
  }
  for (const capture of captures) {
    const parsed = parseMessagingProject(capture.sources, { entry: capture.entry, mode: 'http-handler', profile: HTTP_PROFILE, fixedFiles: HTTP_RUNTIME_FILES })
    if (parsed.diagnostics.length || !same(capture.routes, parsed.program.httpHandlers.map(({ route, methods, authLevel, functionId, functionName, path }) => ({ route, methods, authLevel, functionId, functionName, path })))) return false
  }
  let next = 1, previousCommand = 0
  const traces = [...messaging.deliveries, ...(messaging.executionReceipts ?? []).flatMap(e => e.measurements.trace)]
  const messages = Object.values(messaging.entities).flatMap(entity => entity.messages)
  for (const execution of messaging.executionReceipts ?? []) {
    const m = execution.measurements.httpFunctions, end = number(execution.id) + 1
    if (!m) { previousCommand = end - 1; continue }
    if (!validHttpMeasurement(m) || m.beforeNextId !== next || m.afterNextId > state.nextId) return false
    for (const row of [...m.captures, ...m.accepted, ...m.requests]) if (!allRows.some(actual => actual.id === row.id && same(actual, row))) return false
    for (const capture of m.captures) if (capture.createdAtMs > messaging.timeMs) return false
    for (const request of m.requests) {
      const invocation = m.invocations.find(row => row.requestId === request.id), capture = captures.find(row => row.id === invocation?.captureId)
      if (!invocation || invocation.executionId !== execution.id || request.executionId !== execution.id || request.afterNextId !== end
        || request.beforeNextId <= previousCommand || request.beforeNextId > number(execution.id)
        || !capture || capture.appId !== request.appId || capture.scope !== request.scope || capture.generation !== request.generation
        || !same(request.response, invocation.response) || !same(execution.measurements.value, request.response)
        || !same(request.operationIds, invocation.operations.map(row => row.id)) || !same(request.readIds, invocation.consumedReadIds)) return false
      const match = matchHttpRoute(capture.routes, request.method, request.path), route = match.route
      if (invocation.functionId !== (route?.functionId ?? null)) return false
      const protectedRoute = request.scope === 'published' && route?.authLevel === 'function'
      if (!protectedRoute && (request.authorization !== 'not-required' || invocation.keyId !== null)
        || protectedRoute && (request.authorization === 'not-required' || (request.authorization === 'granted') !== (invocation.keyId !== null))
        || invocation.keyId !== null && labInput && !labInput.functionKeys.some(key => key.id === invocation.keyId)) return false
      if ((!route || request.authorization === 'denied') && (request.response.statusCode !== (request.authorization === 'denied' ? 401 : match.status)
        || invocation.reads.length || invocation.operations.length || invocation.consumedFields.length)) return false
      if (!same(request.sendReceiptIds, invocation.operations.map(op => op.sendReceiptId))) return false
      for (const op of invocation.operations) {
        const send = execution.measurements.trace.find(row => row.id === op.sendReceiptId && row.kind === 'send')
        if (!send || number(send.id) < request.beforeNextId || number(send.id) >= end - 1) return false
        const entity = messaging.entities[send.entityId]
        if (!entity || !same(normalizeHttpTarget(entity.target), op.target)) return false
        if (op.acceptedId !== null) {
          const accepted = m.accepted.find(row => row.id === op.acceptedId)
          if (!accepted || !invocation.requestOrder || request.method !== 'POST' || accepted.appId !== request.appId || accepted.generation !== request.generation
            || !same(accepted.target, op.target) || accepted.sendReceiptId !== send.id || !same(accepted.order, invocation.requestOrder)) return false
        }
      }
      for (const field of invocation.consumedFields) {
        const read = invocation.reads.find(row => row.id === field.readId)
        if (!read || read.kind === 'repository' && (!read.found || field.field === 'value') || read.kind === 'environment' && field.field !== 'value') return false
        const value = read.kind === 'repository' ? read.record[field.field] : read.value
        let body; try { body = JSON.parse(request.response.body) } catch { body = request.response.body }
        const includes = object => same(object, value) || object && typeof object === 'object' && Object.values(object).some(includes)
        if (!includes(body) && !Object.values(request.response.headers).some(header => includes(header))) return false
      }
      if (!same([...new Set(invocation.consumedFields.map(row => row.readId))], invocation.consumedReadIds)) return false
      for (const read of invocation.reads.filter(row => row.kind === 'repository' && row.found)) {
        const origin = read.record.origin, message = messages.find(row => row.id === origin.messageRecordId)
        if (origin.appId !== request.appId || labInput && !same(origin.target, normalizeHttpTarget(labInput.target)) || !message
          || !traces.some(row => row.kind === 'send' && row.id === origin.sendReceiptId && number(row.id) < request.afterNextId)
          || !sameCanonicalOrder(read.record, JSON.parse(message.body))) return false
        if (read.record.status === 'processed' && !traces.some(row => row.id === origin.workerReceiptId && row.kind === 'order-record'
          && row.messageRecordId === message.id && number(row.id) < request.beforeNextId)) return false
      }
      for (const read of invocation.reads) {
        if (read.atNextId < request.beforeNextId || read.atNextId >= request.afterNextId) return false
        if (read.kind === 'repository') {
          const target = labInput?.target ?? read.record?.origin.target ?? invocation.operations[0]?.target
            ?? state.accepted.find(row => row.appId === request.appId)?.target
          if (target) {
            const expected = historicalRepository(state, messages, traces, request, normalizeHttpTarget(target), read)
            if (read.found !== (expected !== null) || !same(read.record, expected)) return false
          }
        }
      }
      if (!same(request.workerReceiptIds, [...new Set(invocation.reads.filter(row => row.kind === 'repository' && row.found).map(row => row.record.origin.workerReceiptId).filter(Boolean))])) return false
    }
    for (const accepted of m.accepted) {
      const request = m.requests.find(row => row.sendReceiptIds.includes(accepted.sendReceiptId)), message = messages.find(row => row.id === accepted.messageRecordId)
      if (!request || !message || message.sourceMessageId !== accepted.sourceMessageId || !sameCanonicalOrder(accepted.order, JSON.parse(message.body))
        || !execution.measurements.trace.some(row => row.kind === 'send' && row.id === accepted.sendReceiptId && row.timeMs === accepted.acceptedAtMs)
        || !execution.measurements.trace.some(row => row.kind === 'enqueue' && row.messageRecordId === message.id && row.sourceMessageId === accepted.sourceMessageId)) return false
    }
    next = m.afterNextId; previousCommand = end - 1
  }
  if (next !== state.nextId) return false
  const secrets = labInput?.functionKeys.map(key => key.value) ?? []
  return allRows.every(row => row.sources ? Object.values(row.sources).every(text => httpPublicSafe(text, secrets))
    : row.response ? httpPublicSafe(row.response, secrets) && httpPublicSafe(row.path, secrets) : httpPublicSafe(row.order, secrets))
    && (messaging.executionReceipts ?? []).every(row => !row.measurements.httpFunctions || row.measurements.httpFunctions.invocations.every(invocation => httpPublicSafe(invocation.reads, secrets) && httpPublicSafe(invocation.response, secrets)))
}
export function httpActivity(measurement) { return measurement?.requests.length === 1 }
export function httpEvidenceIsCurrent(evidence, run, lab) {
  const m = evidence?.measurements?.httpFunctions
  if (!m?.requests.length) return evidence?.measurements?.mode !== 'http-handler'
  return m.invocations.every(invocation => {
    const state = run.runtime.messaging.httpFunctions, capture = [...state.localHosts, ...state.deployments].find(row => row.id === invocation.captureId)
    const current = capture?.scope === 'local' ? state.currentLocal : state.currentPublished
    return capture && current[capture.appId] === capture.id && invocation.resourceStamp === httpResourceStamp(run, lab)
      && invocation.resourceGeneration === (run.dependencyGenerations['http:resources'] ?? 0)
      && Object.entries(capture.sources).every(([path, source]) => run.project.savedFiles[path] === source && (run.project.fileVersions[path] ?? 0) === capture.sourceVersions[path])
  })
}
