import { applyServiceBusOperation } from './servicebus.js'
import { applyEventGridOperation, getEventGridDelivery, validateEventGridWebhookRegistration } from './eventgrid.js'
import { validateMessagingState, finiteJson } from './state.js'
import { messagingSdkContract, bindArguments, messagingError, safeKey } from './python.js'
import { createSecuritySession, SECURITY_PROFILE, sanitizeSecurityDiagnostics } from '../security/sdk.js'
import { parseEventGridFunctionEndpoint } from '../sandbox/eventgrid-validation.js'
import { createTelemetrySession, TELEMETRY_OPERATIONS } from '../observability/runtime.js'
import { telemetryImport } from '../observability/sdk.js'
import { appendSecurityRecord, emptySecurityObservabilityState } from '../security/state.js'

const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
const clone = value => JSON.parse(JSON.stringify(value))
const RETURN = Symbol('return')
const cap = (value, fallback) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, fallback) : fallback
const scalarStringArguments = Object.freeze({
  ServiceBusClient: ['fully_qualified_namespace'],
  ServiceBusMessage: ['body', 'message_id', 'session_id'],
  EventGridPublisherClient: ['endpoint'],
  EventGridEvent: ['subject', 'event_type', 'data_version', 'id'],
  'bus.get_queue_sender': ['queue_name'],
  'bus.get_topic_sender': ['topic_name'],
  'bus.get_queue_receiver': ['queue_name', 'sub_queue', 'session_id'],
  'bus.get_subscription_receiver': ['topic_name', 'subscription_name', 'sub_queue'],
  'receiver.dead_letter_message': ['reason', 'error_description'],
  'bytes.decode': ['encoding'],
  was_processed: ['order_id'],
  handler_status: ['order_id'],
  record_notification: ['event_id', 'order_id'],
  ValueError: ['message'],
})

/** Executes tagged data only. SDK handles are private WeakMap tokens, never JS objects exposed to Python. */
export function executeMessagingProgram({ program, state, sandbox, input = {}, limits = {} }) {
  const { signatures: SDK_SIGNATURES, exports: SDK_EXPORTS } = messagingSdkContract(program.profile)
  let security = null, telemetry = null
  let current = state, steps = 0, depth = 0, receiverSequence = 0, eventSequence = 0, draining = false, activeDelivery = null
  const trace = [], diagnostics = [], output = [], modules = new Map(), handles = new WeakMap(), orderOrigins = new WeakMap()
  let outputBytes = 0
  const maximumSteps = cap(limits.steps, 10000), maximumTraces = cap(limits.traces, 500)
  const maximumFrames = cap(limits.frames, 100), maximumValues = cap(limits.valueBytes, 128 * 1024)
  const fail = (message, loc, code = 'MESSAGING_RUNTIME', details = {}) => {
    const error = messagingError(code, message, loc)
    Object.assign(error.diagnostic, details)
    throw error
  }
  const tick = loc => { if (++steps > maximumSteps) fail(`Execution exceeds ${maximumSteps} shared steps.`, loc, 'MESSAGING_LIMIT') }
  const handle = (type, fields = {}) => { const token = Object.create(null); handles.set(token, { type, ...fields }); return token }
  const info = token => token && typeof token === 'object' ? handles.get(token) : undefined
  const unbox = value => ['bodytext', 'configvalue'].includes(info(value)?.type) ? info(value).value : value
  const callable = (name, owner) => handle('callable', { name, owner })
  const readonlyProperties = value => {
    const copy = clone(value)
    const freeze = item => { if (item && typeof item === 'object') { Object.values(item).forEach(freeze); Object.freeze(item) } }
    if (telemetry) freeze(copy)
    return copy
  }
  function chargeBytes(budget, bytes, loc) {
    budget.bytes += bytes
    if (budget.bytes > maximumValues) fail(`Application data exceeds ${maximumValues} encoded bytes.`, loc, 'MESSAGING_LIMIT')
  }
  function chargeString(budget, value, loc) {
    chargeBytes(budget, 2, loc) // JSON quotation marks
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index)
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) chargeBytes(budget, 2, loc)
      else if (code < 32) chargeBytes(budget, 6, loc)
      else if (code < 128) chargeBytes(budget, 1, loc)
      else if (code < 2048) chargeBytes(budget, 2, loc)
      else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        chargeBytes(budget, 4, loc); index++
      } else chargeBytes(budget, code >= 0xd800 && code <= 0xdfff ? 6 : 3, loc)
    }
  }
  function jsonValue(value, loc, seen = new Set(), nesting = 0, budget = { bytes: 0 }) {
    tick(loc)
    security?.guard(value, loc)
    telemetry?.guard(value, loc, 'payload')
    value = unbox(value)
    if (nesting > 100) fail('Data nesting exceeds 100.', loc, 'MESSAGING_LIMIT')
    if (info(value)) fail('SDK handles cannot be stored as application data.', loc)
    if (typeof value === 'string') { chargeString(budget, value, loc); return value }
    if (value === null || typeof value === 'boolean' || Number.isSafeInteger(value)
      || program.profile === SECURITY_PROFILE && typeof value === 'number' && Number.isFinite(value)) {
      chargeBytes(budget, String(value).length, loc)
      return value
    }
    if (!value || typeof value !== 'object' || seen.has(value)) fail('A finite JSON value is required.', loc)
    seen.add(value)
    const result = Array.isArray(value) ? [] : Object.create(null)
    chargeBytes(budget, 2, loc) // Braces or brackets
    let first = true
    for (const [key, item] of Object.entries(value)) {
      safeKey(key, loc)
      if (!first) chargeBytes(budget, 1, loc)
      first = false
      if (!Array.isArray(value)) { chargeString(budget, key, loc); chargeBytes(budget, 1, loc) }
      result[key] = jsonValue(item, loc, seen, nesting + 1, budget)
    }
    seen.delete(value)
    return result
  }
  function stringify(value, loc) {
    // jsonValue counts every expanded occurrence before materializing the JSON
    // string, including repeated shared strings and UTF-8/escape overhead.
    return JSON.stringify(jsonValue(value, loc))
  }
  function truth(value) {
    value = unbox(value)
    if (value === null || value === false || value === 0 || value === '') return false
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === 'object' && !info(value)) return Object.keys(value).length > 0
    return true
  }
  function equal(left, right, loc, nesting = 0) {
    tick(loc)
    left = unbox(left); right = unbox(right)
    if (nesting > 100) fail('Comparison nesting exceeds 100.', loc, 'MESSAGING_LIMIT')
    if (left === right) return true
    if (info(left) || info(right)) return false
    if (left === null || right === null || typeof left !== typeof right) return false
    if (typeof left !== 'object') return false
    if (Array.isArray(left) !== Array.isArray(right)) return false
    const leftKeys = Object.keys(left), rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    for (const key of leftKeys) {
      safeKey(key, loc)
      if (!own(right, key) || !equal(left[key], right[key], loc, nesting + 1)) return false
    }
    return true
  }
  function string(value, loc) {
    security?.guard(value, loc)
    if (!info(value) || ['configvalue', 'bodytext', 'bytes'].includes(info(value)?.type)) telemetry?.guard(unbox(value), loc, 'payload')
    const object = info(value)
    if (['bodytext', 'configvalue'].includes(object?.type)) return object.value
    if (object?.type === 'receipt') return object.record.body
    if (object?.type === 'bytes') return object.value
    if (object) fail('This SDK resource cannot be converted to a string.', loc)
    if (typeof value === 'string') return value
    if (value === null) return 'None'
    if (typeof value === 'boolean') return value ? 'True' : 'False'
    return typeof value === 'object' ? stringify(value, loc) : String(value)
  }
  function lookup(env, name, loc) {
    safeKey(name, loc)
    if (env.has(name)) return env.get(name)
    if (['str', 'len', 'print', 'ValueError'].includes(name)) return callable(name)
    fail(`Unbound name '${name}'.`, loc)
  }
  function readIndex(object, key, loc) {
    object = unbox(object); key = unbox(key)
    telemetry?.guard(key, loc, 'payload')
    safeKey(key, loc)
    const selected = security?.index(object, key, loc)
    if (selected?.handled) return selected.value
    if (info(object) || object === null || !['object', 'string'].includes(typeof object)) fail('Only lists, strings and dictionaries support indexing.', loc)
    if ((Array.isArray(object) || typeof object === 'string') && (!Number.isSafeInteger(key) || key < 0)) fail('A nonnegative integer index is required.', loc)
    if (!own(Object(object), key)) fail(`Missing index '${key}'.`, loc)
    return object[key]
  }
  function attribute(value, name, loc) {
    safeKey(name, loc)
    const selected = security?.member(value, name, loc)
    if (selected?.handled) return selected.value
    const telemetryMember = telemetry?.member(value, name, loc)
    if (telemetryMember?.handled) return telemetryMember.value
    const object = info(value)
    if (!object) fail(`Unsupported attribute '${name}'.`, loc, 'MESSAGING_UNSUPPORTED')
    if (object.type === 'module') {
      if (own(SDK_EXPORTS, `${object.module}.${name}`)) return handle('module', { module: `${object.module}.${name}` })
      return importValue({ module: object.module, name, loc })
    }
    if (object.type === 'localmodule') return lookup(initialize(object.path), name, loc)
    if (object.type === 'subqueue' && name === 'DEAD_LETTER') return 'deadletter'
    if (object.type === 'receipt') {
      const metadata = { message_id: 'messageId', session_id: 'sessionId', application_properties: 'properties', delivery_count: 'deliveryCount', dead_letter_reason: 'deadLetterReason', dead_letter_error_description: 'deadLetterDescription' }
      if (name === 'body') return handle('bytes', { value: object.record.body, record: object.record })
      if (own(metadata, name)) return name === 'application_properties' ? readonlyProperties(object.record[metadata[name]]) : clone(object.record[metadata[name]])
    }
    if (object.type === 'functionmessage') {
      const metadata = { message_id: 'messageId', delivery_count: 'deliveryCount', application_properties: 'properties' }
      if (own(metadata, name)) return name === 'application_properties' ? readonlyProperties(object.record[metadata[name]]) : jsonValue(object.record[metadata[name]], loc)
    }
    if (object.type === 'functionevent') {
      const metadata = { id: 'id', subject: 'subject', event_type: 'eventType', data_version: 'dataVersion' }
      if (own(metadata, name)) return jsonValue(object.event[metadata[name]], loc)
    }
    if (object.type === 'event') {
      const metadata = { id: 'id', data: 'data', subject: 'subject', event_type: 'eventType', data_version: 'dataVersion' }
      if (own(metadata, name)) return jsonValue(object.event[metadata[name]], loc)
    }
    const method = `${object.type}.${name}`
    if (own(SDK_SIGNATURES, method)) return callable(method, value)
    fail(`Unsupported member '${name}' on ${object.type}.`, loc, 'MESSAGING_UNSUPPORTED')
  }
  function broker(operation, loc) {
    tick(loc)
    const result = applyServiceBusOperation(current, sandbox, operation)
    if (result.diagnostics.length) throw messagingError(result.diagnostics[0].code, result.diagnostics[0].message, loc)
    if (trace.length + result.trace.length > maximumTraces) fail(`Execution exceeds ${maximumTraces} trace records.`, loc, 'MESSAGING_LIMIT')
    // Retained receipt history is also bounded across repeated script invocations.
    const locks = Object.values(result.state.entities).reduce((sum, entity) => sum + entity.messages.reduce((count, message) => count + message.lockHistory.length, 0), 0)
    if (locks > 500) fail('Retained lock history exceeds 500 receipts; reset this fixture.', loc, 'MESSAGING_LIMIT')
    current = result.state
    trace.push(...result.trace)
    return result.value
  }
  function eventGrid(operation, loc) {
    tick(loc)
    const result = applyEventGridOperation(current, sandbox, operation)
    if (result.diagnostics.length) throw messagingError(result.diagnostics[0].code, result.diagnostics[0].message, loc)
    if (trace.length + result.trace.length > maximumTraces) fail(`Execution exceeds ${maximumTraces} trace records.`, loc, 'MESSAGING_LIMIT')
    current = result.state; trace.push(...result.trace)
    return result.value
  }
  function restoreCallbackState(before, securityCheckpoint, telemetryCheckpoint, error) {
    // Preserve only audit categories observed in this failed callback. Its SDK,
    // business, trace and exported-span effects remain part of the rollback.
    const categories = error.diagnostic?.code === 'SECURITY_PRIVACY'
      ? (current.securityObservability?.records ?? []).slice(before.securityObservability?.records.length ?? 0)
        .filter(row => row.kind === 'privacy-violation').map(row => row.category) : []
    current = before
    if (securityCheckpoint) security.restore(securityCheckpoint)
    if (telemetryCheckpoint) telemetry.restore(telemetryCheckpoint)
    for (const category of categories) current = { ...current,
      securityObservability: appendSecurityRecord(current.securityObservability, { kind: 'privacy-violation', category }).state }
  }
  function deliverEvent(deliveryId, fnId, loc) {
    tick(loc)
    let record
    try { record = getEventGridDelivery(current, sandbox, deliveryId) }
    catch (error) { fail(error.message, loc, error.messagingCode ?? 'MESSAGING_CONFIG') }
    const fn = program.functions[fnId]
    if (record.endpointType !== 'WebHook' || !own(input.eventGridHandlers ?? {}, record.endpoint) || input.eventGridHandlers[record.endpoint] !== fn?.path)
      fail('This endpoint/source is not registered as an allowlisted training webhook handler.', loc, 'MESSAGING_CONFIG')
    const before = current, traceCount = trace.length, previousDelivery = activeDelivery, securityCheckpoint = security?.checkpoint(), telemetryCheckpoint = telemetry?.checkpoint()
    activeDelivery = record
    try {
      const status = invoke(fnId, [handle('event', { event: clone(record.event) })], {}, loc)
      eventGrid({ kind: 'deliver', deliveryId, status }, loc)
      return status
    } catch (error) { restoreCallbackState(before, securityCheckpoint, telemetryCheckpoint, error); trace.length = traceCount; throw error }
    finally { activeDelivery = previousDelivery }
  }
  function hostFunctions(loc) {
    if (!program.host || !Array.isArray(program.handlers) || !program.handlers.length) fail('A Functions host requires validated app/binding registration.', loc, 'MESSAGING_CONFIG')
    // Validate all reachable constructed dependencies before the first receive.
    for (const path of Object.keys(program.globals)) initialize(path)
    const handlerFailure = (error, handler, receipt) => {
      if (error.diagnostic?.code !== 'MESSAGING_RUNTIME') throw error
      diagnostics.push({ ...error.diagnostic, handlerFailure: { kind: handler.kind, appId: program.host.appId, functionId: handler.functionId, functionName: handler.functionName, ...receipt } })
      if (diagnostics.length > maximumTraces) fail('Function failure output exceeds the bounded buffer.', loc, 'MESSAGING_LIMIT')
    }
    let attempts = 0
    for (const binding of program.host.bindings) {
      const receiverId = `functions-${current.nextId}-${++receiverSequence}`
      while (true) {
        tick(loc)
        const records = broker({ kind: 'receive', target: binding.target, receiverId, count: 1 }, loc)
        if (!records.length) break
        const record = records[0]
        let successful = false
        try {
          const at = program.functions[binding.functionId].loc
          const perform = () => invoke(binding.functionId, [handle('functionmessage', { record })], {}, at)
          if (telemetry) telemetry.invocation(`Function ${program.functions[binding.functionId].name}`, record.properties,
            { 'app.attempt': record.deliveryCount, 'app.message_id': record.messageId }, perform, at)
          else perform()
          successful = true
        } catch (error) {
          const handler = program.handlers.find(handler => handler.functionId === binding.functionId)
          handlerFailure(error, handler, { messageRecordId: record.id, messageId: record.messageId, entityId: record.entityId, receiverId, lockToken: record.lockToken, attempt: record.deliveryCount })
        }
        broker({ kind: successful ? 'complete' : 'abandon', target: binding.target, receiverId, lockToken: record.lockToken }, loc)
        attempts++
      }
    }
    eventGrid({ kind: 'advance', milliseconds: 0 }, loc)
    while (true) {
      tick(loc)
      const pending = (current.eventGrid?.deliveries ?? []).filter(record => ['pending', 'retrying'].includes(record.status) && record.endpointType === 'AzureFunction'
        && record.endpoint.slice(0, record.endpoint.toLowerCase().lastIndexOf('/functions/')).toLowerCase() === program.host.appId)
      if (!pending.length) return attempts
      const due = pending.filter(record => record.nextAttemptAtMs <= current.timeMs)
      if (!due.length) {
        const nextTime = Math.min(...pending.map(record => Math.min(record.nextAttemptAtMs, record.expiresAtMs)))
        eventGrid({ kind: 'advance', milliseconds: nextTime - current.timeMs }, loc)
        continue
      }
      for (const selected of due) {
        let record
        try { record = getEventGridDelivery(current, sandbox, selected.id) }
        catch (error) { fail(error.message, loc, error.messagingCode ?? 'MESSAGING_CONFIG') }
        const endpoint = parseEventGridFunctionEndpoint(record.endpoint)
        const handler = program.handlers.find(handler => handler.kind === 'eventgrid' && handler.functionName.toLowerCase() === endpoint?.functionName.toLowerCase())
        if (!handler) fail('Delivery requires the actual registered AzureFunction target.', loc, 'MESSAGING_CONFIG')
        const before = current, traceCount = trace.length, diagnosticCount = diagnostics.length, previousDelivery = activeDelivery, securityCheckpoint = security?.checkpoint(), telemetryCheckpoint = telemetry?.checkpoint()
        activeDelivery = record
        try {
          let successful = false
          try {
            const at = program.functions[handler.functionId].loc
            const perform = () => invoke(handler.functionId, [handle('functionevent', { event: clone(record.event) })], {}, at)
            if (telemetry) telemetry.invocation(`Function ${handler.functionName}`, record.event.data?.trace_context,
              { 'app.attempt': record.attempts + 1, 'app.event_id': record.event.id, 'app.order_id': record.event.data?.order_id ?? 'unknown' }, perform, at)
            else perform()
            successful = true
          } catch (error) { handlerFailure(error, handler, { deliveryId: record.id, eventRecordId: record.eventRecordId, eventId: record.event.id, attempt: record.attempts + 1 }) }
          eventGrid({ kind: 'deliver', deliveryId: record.id, status: successful ? 200 : 500 }, loc)
        } catch (error) {
          // Retain a callback only with its delivery outcome. Keep earlier
          // completed siblings, but never journal an unacknowledged callback trace.
          restoreCallbackState(before, securityCheckpoint, telemetryCheckpoint, error)
          trace.length = traceCount; diagnostics.length = diagnosticCount
          throw error
        }
        finally { activeDelivery = previousDelivery }
        attempts++
      }
    }
  }
  function namespace(endpoint, loc) {
    if (typeof endpoint !== 'string') fail('Supply a Service Bus fully qualified namespace.', loc, 'MESSAGING_CONFIG')
    const matches = (sandbox?.namespaces ?? []).filter(ns => `${ns.name}.servicebus.windows.net`.toLowerCase() === endpoint.toLowerCase())
    if (matches.length !== 1) fail('The Service Bus endpoint must resolve to exactly one supplied Sandbox namespace.', loc, 'MESSAGING_CONFIG')
    return { resourceGroup: matches[0].resourceGroup, namespace: matches[0].name }
  }
  function usable(owner, loc) {
    const object = info(owner)
    if (!object || object.closed) fail('The SDK resource is closed or invalid.', loc)
    if (object.parent) usable(object.parent, loc)
    return object
  }
  function effects(name, key, value, loc, increment = false, application = null) {
    if (typeof key !== 'string' || !key) fail('Teaching record IDs must be nonempty strings.', loc)
    safeKey(key, loc)
    // Refuse before changing the store: every admitted order helper call has a row.
    if (application && (trace.length >= maximumTraces || current.nextId >= Number.MAX_SAFE_INTEGER)) fail('Order effect trace capacity reached.', loc, 'MESSAGING_LIMIT')
    const next = clone(current), map = own(next.effects, name) ? next.effects[name] : {}
    if (!map || typeof map !== 'object' || Array.isArray(map)) fail('Teaching record state is malformed.', loc, 'MESSAGING_CONFIG')
    if (!own(map, key) && Object.keys(map).length >= 50) fail('Teaching record store exceeds 50 records.', loc, 'MESSAGING_LIMIT')
    const changed = increment || !own(map, key)
    if (increment) {
      const count = own(map, key) ? map[key] : 0
      if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) fail('Business effect counter is invalid.', loc, 'MESSAGING_CONFIG')
      map[key] = count + 1
    } else if (!own(map, key)) map[key] = clone(value)
    next.effects[name] = map
    if (application) {
      const receipt = application.receipt
      const row = { id: `trace-${next.nextId++}`, kind: increment ? 'order-work' : 'order-record', timeMs: next.timeMs,
        order: application.order, changed, entityId: receipt?.entityId ?? null, messageRecordId: receipt?.id ?? null,
        messageId: receipt?.messageId ?? null, receiverId: receipt?.receiverId ?? null, lockToken: receipt?.lockToken ?? null }
      next.deliveries = [...next.deliveries, row].slice(-500)
      trace.push(clone(row))
    }
    current = next
    return null
  }
  function call(target, args, kwargs, loc) {
    const name = info(target)?.name
    if (!telemetry || !TELEMETRY_OPERATIONS.has(name)) return callCore(target, args, kwargs, loc)
    return telemetry.operation(name, () => callCore(target, args, kwargs, loc), loc)
  }
  function callCore(target, args, kwargs, loc) {
    tick(loc)
    const functionInfo = info(target)
    if (functionInfo?.type === 'function') return invoke(functionInfo.id, args, kwargs, loc)
    if (functionInfo?.type !== 'callable' || !own(SDK_SIGNATURES, functionInfo.name)) fail('Unresolved callable.', loc, 'MESSAGING_UNSUPPORTED')
    const { name, owner } = functionInfo, [names, required, , positionalLimit] = SDK_SIGNATURES[name]
    const a = bindArguments(names, required, args, kwargs, loc, positionalLimit)
    const instrumented = telemetry?.call(name, owner, a, loc)
    if (instrumented?.handled) return instrumented.value
    const secured = security?.call(name, owner, a, loc)
    if (secured?.handled) return secured.value
    // Only scalar consumers normalize. json.loads still sees the receive binding;
    // dictionaries, SDK handles and numeric arguments retain their existing types.
    for (const field of scalarStringArguments[name] ?? []) if (own(a, field)) a[field] = unbox(a[field])
    if (name === 'DefaultAzureCredential') return handle('credential')
    if (name === 'FunctionApp') return handle('functionapp')
    if (name === 'functionmessage.get_body') return handle('bytes', { value: info(owner).record.body, record: info(owner).record })
    if (name === 'functionevent.get_json') return jsonValue(info(owner).event.data, loc)
    if (name === 'EventGridPublisherClient') {
      if (info(a.credential)?.type !== 'credential') fail('Use the simulated DefaultAzureCredential identity.', loc, 'MESSAGING_CONFIG')
      const topics = (sandbox.eventGridTopics ?? []).filter(topic => `https://${topic.name}.${topic.location}-1.eventgrid.azure.net/api/events`.toLowerCase() === String(a.endpoint).toLowerCase())
      if (typeof a.endpoint !== 'string' || topics.length !== 1) fail('The Event Grid endpoint must resolve to exactly one supplied topic.', loc, 'MESSAGING_CONFIG')
      return handle('publisher', { target: { resourceGroup: topics[0].resourceGroup, topic: topics[0].name } })
    }
    if (name === 'EventGridEvent') {
      const event = jsonValue({ id: a.id ?? `python-event-${current.nextId}-${++eventSequence}`, subject: a.subject, eventType: a.event_type, data: a.data, dataVersion: a.data_version }, loc)
      if (typeof event.id !== 'string' || !event.id || typeof event.subject !== 'string' || typeof event.eventType !== 'string' || !event.eventType || typeof event.dataVersion !== 'string' || !event.dataVersion) fail('EventGridEvent requires valid subject/type/data/version/id fields.', loc)
      return handle('event', { event })
    }
    if (name === 'publisher.send') {
      const publisher = usable(owner, loc), events = Array.isArray(a.events) ? a.events : [a.events]
      if (events.length > 50) fail('Event Grid batch exceeds 50 events.', loc, 'MESSAGING_LIMIT')
      const envelopes = events.map(event => {
        if (info(event)?.type !== 'event') fail('publisher.send requires EventGridEvent values.', loc)
        return jsonValue(info(event).event, loc)
      })
      eventGrid({ kind: 'publish', target: publisher.target, events: envelopes }, loc)
      return null
    }
    if (name === 'deliver_events') {
      const callback = info(a.handler)
      if (callback?.type !== 'function') fail('deliver_events requires an actual local handler callable.', loc)
      if (draining) fail('Nested delivery drains are not supported.', loc, 'MESSAGING_UNSUPPORTED')
      draining = true
      try {
        eventGrid({ kind: 'advance', milliseconds: 0 }, loc)
        let attempts = 0
        while (true) {
          tick(loc)
          const pending = (current.eventGrid?.deliveries ?? []).filter(record => ['pending', 'retrying'].includes(record.status) && record.endpointType === 'WebHook'
            && own(input.eventGridHandlers ?? {}, record.endpoint) && input.eventGridHandlers[record.endpoint] === program.functions[callback.id]?.path)
          if (!pending.length) return attempts
          const due = pending.filter(record => record.nextAttemptAtMs <= current.timeMs)
          if (!due.length) {
            const nextTime = Math.min(...pending.map(record => Math.min(record.nextAttemptAtMs, record.expiresAtMs)))
            eventGrid({ kind: 'advance', milliseconds: nextTime - current.timeMs }, loc)
          } else for (const record of due) { deliverEvent(record.id, callback.id, loc); attempts++ }
        }
      } finally { draining = false }
    }
    if (name === 'ServiceBusClient') {
      if (info(a.credential)?.type !== 'credential') fail('Use the simulated DefaultAzureCredential identity.', loc, 'MESSAGING_CONFIG')
      return handle('bus', { target: namespace(a.fully_qualified_namespace, loc), closed: false })
    }
    if (name === 'ServiceBusMessage') {
      const body = info(a.body)?.type === 'bytes' ? info(a.body).value : unbox(a.body)
      if (typeof body !== 'string') fail('ServiceBusMessage body must be a string or bytes.', loc)
      const properties = a.application_properties === undefined ? {} : jsonValue(a.application_properties, loc)
      if (!properties || Array.isArray(properties) || typeof properties !== 'object') fail('application_properties must be a dictionary.', loc)
      return handle('outgoing', { message: { body, properties, ...(a.message_id === undefined ? {} : { messageId: a.message_id }), ...(a.session_id === undefined ? {} : { sessionId: a.session_id }) } })
    }
    if (name.startsWith('bus.')) {
      const bus = usable(owner, loc), receiver = name.endsWith('receiver')
      for (const field of ['queue_name', 'topic_name', 'subscription_name']) if (a[field] !== undefined && (typeof a[field] !== 'string' || !a[field])) fail(`${field} must be a nonempty string.`, loc, 'MESSAGING_CONFIG')
      if (a.max_wait_time !== undefined && (!Number.isSafeInteger(a.max_wait_time) || a.max_wait_time < 0)) fail('max_wait_time must be a nonnegative integer (simulated, no wall-clock wait).', loc)
      const target = { ...bus.target, ...(a.queue_name ? { queue: a.queue_name } : { topic: a.topic_name }), ...(a.subscription_name ? { subscription: a.subscription_name } : {}) }
      if (a.sub_queue !== undefined && !['active', 'deadletter'].includes(a.sub_queue)) fail('Only the active or DEAD_LETTER subqueue is supported.', loc)
      return handle(receiver ? 'receiver' : 'sender', { target, parent: owner, closed: false, receiverId: `python-${current.nextId}-${++receiverSequence}`, sessionId: a.session_id, subQueue: a.sub_queue ?? 'active' })
    }
    if (name === 'sender.send_messages') {
      const sender = usable(owner, loc), items = Array.isArray(a.messages) ? a.messages : [a.messages]
      if (items.length > 50) fail('A send batch exceeds 50 messages.', loc, 'MESSAGING_LIMIT')
      const payloads = items.map(item => {
        if (info(item)?.type !== 'outgoing') fail('send_messages requires ServiceBusMessage values.', loc)
        return info(item).message
      })
      for (const message of payloads) broker({ kind: 'send', target: sender.target, message }, loc)
      return null
    }
    if (name.startsWith('receiver.')) {
      const receiver = usable(owner, loc)
      if (name === 'receiver.receive_messages') {
        if (a.max_wait_time !== undefined && (!Number.isSafeInteger(a.max_wait_time) || a.max_wait_time < 0)) fail('max_wait_time must be a nonnegative integer.', loc)
        const records = broker({ kind: 'receive', target: receiver.target, receiverId: receiver.receiverId, count: a.max_message_count ?? 1, subQueue: receiver.subQueue, ...(receiver.sessionId === undefined ? {} : { sessionId: receiver.sessionId }) }, loc)
        return records.map(record => handle('receipt', { record }))
      }
      const receipt = info(a.message)
      if (receipt?.type !== 'receipt') fail('Settlement requires the actual received message.', loc)
      const kind = name === 'receiver.complete_message' ? 'complete' : name === 'receiver.abandon_message' ? 'abandon' : 'deadletter'
      broker({ kind, target: receiver.target, receiverId: receiver.receiverId, lockToken: receipt.record.lockToken, ...(a.reason === undefined ? {} : { reason: a.reason }), ...(a.error_description === undefined ? {} : { description: a.error_description }) }, loc)
      return null
    }
    if (name === 'bytes.decode') {
      if (a.encoding !== undefined && !['utf-8', 'utf8'].includes(a.encoding)) fail('Only UTF-8 decoding is supported.', loc, 'MESSAGING_UNSUPPORTED')
      const bytes = info(owner)
      return bytes.record ? handle('bodytext', { value: bytes.value, record: bytes.record }) : bytes.value
    }
    if (name === 'json.dumps') return stringify(a.obj, loc)
    if (name === 'json.loads') {
      const body = info(a.s), source = body?.type === 'bytes' ? body.value : unbox(a.s)
      if (typeof source !== 'string') fail('json.loads requires a string or bytes.', loc)
      if (source.length > maximumValues) fail('JSON exceeds 128 KiB.', loc, 'MESSAGING_LIMIT')
      try {
        const order = jsonValue(JSON.parse(source), loc)
        if (body?.record && order && typeof order === 'object') orderOrigins.set(order, body.record)
        return order
      } catch (error) { if (error.diagnostic) throw error; fail('Invalid JSON payload.', loc) }
    }
    if (name === 'str') {
      const object = info(a.object)
      if (object?.type === 'bodytext') return a.object
      if (object?.type === 'receipt' || object?.type === 'bytes' && object.record) return handle('bodytext', { value: string(a.object, loc), record: object.record })
      return string(a.object, loc)
    }
    if (name === 'len') {
      const object = unbox(a.object)
      if (info(object) || object === null || !['string', 'object'].includes(typeof object)) fail('len requires a string, list or dictionary.', loc)
      return typeof object === 'string' || Array.isArray(object) ? object.length : Object.keys(object).length
    }
    if (name === 'print') {
      const line = a.map(value => string(value, loc)).join(' ')
      security?.guard(line, loc)
      outputBytes += line.length
      if (output.length >= 500 || outputBytes > maximumValues) fail('Printed output exceeds its bounded buffer.', loc, 'MESSAGING_LIMIT')
      output.push(line)
      return null
    }
    if (name === 'ValueError') return handle('error', { message: string(a.message, loc) })
    if (name === 'was_processed') {
      safeKey(a.order_id, loc)
      return own(current.effects, 'processed') && own(current.effects.processed, a.order_id)
    }
    if (name === 'handler_status') {
      safeKey(a.order_id, loc)
      const outcome = input.handlerStatus && own(input.handlerStatus, a.order_id) ? input.handlerStatus[a.order_id] : 200
      if (!Array.isArray(outcome)) return outcome
      return outcome[Math.min(activeDelivery?.attempts ?? 0, outcome.length - 1)]
    }
    if (name === 'record_notification') {
      if (security) fail('Secure notifications require send_notification with an actual retrieved credential.', loc, 'MESSAGING_CONFIG')
      if (typeof a.order_id !== 'string' || !a.order_id) fail('Notification order_id must be a nonempty string.', loc)
      safeKey(a.order_id, loc)
      const value = jsonValue({ eventId: a.event_id, orderId: a.order_id }, loc)
      if (activeDelivery && (trace.length >= maximumTraces || current.nextId >= Number.MAX_SAFE_INTEGER)) fail('Notification trace capacity reached.', loc, 'MESSAGING_LIMIT')
      const changed = !own(current.effects.notifications ?? {}, a.event_id)
      effects('notifications', a.event_id, value, loc)
      if (activeDelivery) {
        const next = clone(current)
        const row = { id: `eg-trace-${next.nextId++}`, kind: 'notification', timeMs: next.timeMs,
          deliveryId: activeDelivery.id, eventRecordId: activeDelivery.eventRecordId, attempts: activeDelivery.attempts + 1,
          status: null, reason: null, timing: 'logical-simulator-ticks', eventId: a.event_id, orderId: a.order_id, changed }
        next.eventGrid.traces.push(row)
        if (next.eventGrid.traces.length > 500) next.eventGrid.traces.shift()
        current = next; trace.push(clone(row))
      }
      return null
    }
    if (name === 'perform_order_work' || name === 'record_processed') {
      const order = jsonValue(a.order, loc)
      if (!order || Array.isArray(order) || typeof order !== 'object' || !own(order, 'id')) fail('An order dictionary with id is required.', loc)
      const application = { order: clone(order), receipt: orderOrigins.get(a.order) ?? null }
      return name === 'perform_order_work' ? effects('workByOrder', order.id, null, loc, true, application) : effects('processed', order.id, order, loc, false, application)
    }
    fail(`Unsupported call '${name}'.`, loc, 'MESSAGING_UNSUPPORTED')
  }
  function evaluate(node, env) {
    tick(node.loc)
    switch (node.kind) {
      case 'literal': return node.value
      case 'bytes': return handle('bytes', { value: node.value })
      case 'name': return lookup(env, node.name, node.loc)
      case 'list': return node.items.map(item => evaluate(item, env))
      case 'dict': {
        const value = Object.create(null)
        for (const [key, item] of node.entries) value[safeKey(unbox(evaluate(key, env)), key.loc)] = evaluate(item, env)
        return value
      }
      case 'index': return readIndex(evaluate(node.object, env), evaluate(node.index, env), node.loc)
      case 'attribute': return attribute(evaluate(node.object, env), node.name, node.loc)
      case 'call': return call(evaluate(node.callee, env), node.args.map(arg => evaluate(arg, env)), Object.fromEntries(Object.entries(node.kwargs).map(([name, value]) => [name, evaluate(value, env)])), node.loc)
      case 'unary': {
        const value = evaluate(node.value, env)
        if (node.op === 'not') return !truth(value)
        if (!Number.isSafeInteger(value)) fail('Unary arithmetic requires an integer.', node.loc)
        return node.op === '-' ? -value : value
      }
      case 'binary': {
        let left = evaluate(node.left, env)
        if (node.op === 'and') return truth(left) ? evaluate(node.right, env) : left
        if (node.op === 'or') return truth(left) ? left : evaluate(node.right, env)
        const right = unbox(evaluate(node.right, env))
        left = unbox(left)
        if (node.op === '+') {
          if (typeof left === 'string' && typeof right === 'string') {
            const budget = { bytes: 0 }; chargeString(budget, left, node.loc); chargeString(budget, right, node.loc)
            return left + right
          }
          if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(left + right)) fail('Addition requires safe integers.', node.loc)
          return left + right
        }
        if (node.op === '==' || node.op === '!=') {
          const same = equal(left, right, node.loc)
          return node.op === '==' ? same : !same
        }
        if (node.op === 'is' || node.op === 'is not') return node.op === 'is' ? left === right : left !== right
        if (node.op === 'in' || node.op === 'not in') {
          let contains
          if (Array.isArray(right)) contains = right.some(value => equal(value, left, node.loc))
          else if (typeof right === 'string' && typeof left === 'string') contains = right.includes(left)
          else if (right && typeof right === 'object' && !info(right)) contains = own(right, safeKey(left, node.loc))
          else fail('Membership requires a list, string or dictionary.', node.loc)
          return node.op === 'in' ? contains : !contains
        }
        if (typeof left !== typeof right || !['number', 'string'].includes(typeof left)) fail('Ordered comparisons require matching strings or integers.', node.loc)
        return node.op === '<' ? left < right : node.op === '<=' ? left <= right : node.op === '>' ? left > right : left >= right
      }
      default: fail('Unknown expression IR.', node.loc, 'MESSAGING_UNSUPPORTED')
    }
  }
  function block(body, env) {
    for (const statement of body) {
      tick(statement.loc)
      if (statement.kind === 'pass') continue
      if (statement.kind === 'if') {
        const branch = statement.branches.find(item => truth(evaluate(item.test, env)))
        const result = block(branch ? branch.body : statement.otherwise, env)
        if (result?.signal === RETURN) return result
        continue
      }
      const value = evaluate(statement.value, env)
      switch (statement.kind) {
        case 'assign':
          if (statement.target.kind === 'name') env.set(safeKey(statement.target.name, statement.loc), value)
          else {
            const object = evaluate(statement.target.object, env), key = unbox(evaluate(statement.target.index, env))
            safeKey(key, statement.loc)
            if (!object || typeof object !== 'object' || info(object)) fail('Assignment requires a dictionary or list.', statement.loc)
            if (Object.isFrozen(object)) fail('Received application_properties are read-only.', statement.loc, 'MESSAGING_UNSUPPORTED')
            if (Array.isArray(object) && (!Number.isSafeInteger(key) || key < 0 || key >= object.length)) fail('List assignment requires an existing index.', statement.loc)
            object[key] = value
          }
          break
        case 'expression': break
        case 'return': return { signal: RETURN, value }
        case 'raise': {
          if (info(value)?.type !== 'error') fail('Only ValueError may be raised.', statement.loc)
          fail(`ValueError: ${info(value).message}`, statement.loc, 'MESSAGING_RUNTIME', { errorType: 'ValueError' }); break
        }
        case 'for': {
          if (!Array.isArray(value)) fail('For requires a bounded list.', statement.loc)
          for (const item of value) { tick(statement.loc); env.set(statement.name, item); const result = block(statement.body, env); if (result?.signal === RETURN) return result }
          break
        }
        case 'with': {
          const resource = usable(value, statement.loc)
          if (resource.type === 'spanmanager' && telemetry) {
            const scope = telemetry.enter(value, statement.loc)
            if (statement.name !== null) env.set(statement.name, scope.value)
            let error
            try { const result = block(statement.body, env); if (result?.signal === RETURN) return result }
            catch (caught) { error = caught; throw caught }
            finally { scope.exit(error) }
            break
          }
          if (!['bus', 'sender', 'receiver'].includes(resource.type)) fail('Only SDK resources support with.', statement.loc)
          env.set(statement.name, value)
          try { const result = block(statement.body, env); if (result?.signal === RETURN) return result }
          finally { resource.closed = true }
          break
        }
        default: fail('Unknown statement IR.', statement.loc, 'MESSAGING_UNSUPPORTED')
      }
    }
    return null
  }
  function invoke(id, args, kwargs, loc) {
    if (++depth > maximumFrames) fail(`Execution exceeds ${maximumFrames} local call frames.`, loc, 'MESSAGING_LIMIT')
    try {
      const fn = program.functions[id]
      if (!fn) fail('Missing lowered function.', loc, 'MESSAGING_UNSUPPORTED')
      const env = new Map(initialize(fn.path)), bound = bindArguments(fn.params, fn.params.length, args, kwargs, loc)
      Object.entries(bound).forEach(([key, value]) => env.set(key, value))
      return block(fn.body, env)?.value ?? null
    } finally { depth-- }
  }
  function importValue(item) {
    if (own(SDK_EXPORTS, item.module)) {
      if (!item.name) return handle('module', { module: item.module.startsWith(`${item.alias}.`) ? item.alias : item.module })
      if (!SDK_EXPORTS[item.module].includes(item.name)) fail('Unsupported import.', item.loc, 'MESSAGING_UNSUPPORTED')
      const imported = telemetry && telemetryImport(item.module, item.name)
      if (imported) return imported.type === 'data' ? imported.constant : handle(imported.type, imported)
      if (item.module === 'azure.functions' && item.name !== 'FunctionApp') return handle(item.name === 'ServiceBusMessage' ? 'functionmessageType' : 'functioneventType')
      if (item.name === 'ServiceBusSubQueue') return handle('subqueue')
      return callable(item.module === 'json' ? `json.${item.name}` : item.name)
    }
    const path = `${item.module.replace(/\./g, '/')}.py`, env = initialize(path)
    return item.name ? lookup(env, item.name, item.loc) : handle('localmodule', { path })
  }
  function initialize(path) {
    if (modules.has(path)) return modules.get(path)
    const env = new Map(); modules.set(path, env)
    for (const [id, fn] of Object.entries(program.functions)) if (fn.path === path) env.set(fn.name, handle('function', { id }))
    for (const item of program.imports[path] ?? []) env.set(item.alias, importValue(item))
    block(program.globals[path] ?? [], env)
    return env
  }
  let value = null
  try {
    if (!validateMessagingState(state) || !finiteJson(input)) fail('Invalid messaging state or fixture input.', { path: program.entry, line: 1, column: 1 }, 'MESSAGING_CONFIG')
    if (program.profile === SECURITY_PROFILE) security = createSecuritySession({ sandbox, input: input.securityObservability, entry: program.entry, mode: program.mode,
      handle, info, fail, getState: () => current, setState: next => { current = next },
      notify: (eventId, orderId, loc) => effects('notifications', eventId, { eventId, orderId }, loc),
      invocation: () => {
        if (!activeDelivery || !program.host) return null
        const endpoint = parseEventGridFunctionEndpoint(activeDelivery.endpoint)
        const handler = program.handlers.find(item => item.kind === 'eventgrid' && item.functionName.toLowerCase() === endpoint?.functionName.toLowerCase())
        return { eventId: activeDelivery.event.id, orderId: activeDelivery.event.data?.order_id,
          linkage: { kind: 'eventgrid', appId: program.host.appId, functionId: handler.functionId, deliveryId: activeDelivery.id, eventRecordId: activeDelivery.eventRecordId, attempt: activeDelivery.attempts + 1 } }
      } })
    if (security) telemetry = createTelemetrySession({ handle, info, fail, guard: (value, loc, category) => security.guard(value, loc, category),
      getState: () => current, setState: next => { current = next }, getTrace: () => trace,
      checkpoint: () => ({ security: security.checkpoint(), traceCount: trace.length }),
      restore: snapshot => { security.restore(snapshot.security); trace.length = snapshot.traceCount } })
    for (const key of ['messages', 'events']) if (Array.isArray(input[key]) && input[key].length > 50) fail('Fixture messages/events exceed 50 records.', { path: program.entry, line: 1, column: 1 }, 'MESSAGING_LIMIT')
    if (input.handlerStatus && Object.keys(input.handlerStatus).length > 50) fail('Handler fixture exceeds 50 outcomes.', { path: program.entry, line: 1, column: 1 }, 'MESSAGING_LIMIT')
    const httpStatus = status => Number.isSafeInteger(status) && status >= 100 && status <= 599
    if (input.handlerStatus !== undefined && (!input.handlerStatus || typeof input.handlerStatus !== 'object' || Array.isArray(input.handlerStatus)
      || Object.values(input.handlerStatus).some(status => Array.isArray(status) ? status.length < 1 || status.length > 30 || !status.every(httpStatus) : !httpStatus(status)))) fail('Handler fixture outcomes must be integer HTTP statuses or 1-30 status sequences.', { path: program.entry, line: 1, column: 1 }, 'MESSAGING_CONFIG')
    if (input.eventGridHandlers !== undefined && !validateEventGridWebhookRegistration(sandbox, input.eventGridHandlers)) fail('Training webhook registrations must resolve actual WebHook subscriptions and bounded source paths.', { path: program.entry, line: 1, column: 1 }, 'MESSAGING_CONFIG')
    value = program.mode === 'functions' ? hostFunctions({ path: program.entry, line: 1, column: 1 }) : program.mode === 'eventgrid-handler'
      ? deliverEvent(input.deliveryId, program.main, { path: program.entry, line: 1, column: 1 })
      : invoke(program.main, [], {}, { path: program.entry, line: 1, column: 1 })
    // The public result is JSON-only; receipt/client closures never escape.
    value = jsonValue(value, { path: program.entry, line: 1, column: 1 })
  } catch (error) {
    value = null
    // Dynamic KQL is parsed at its actual call. A query diagnostic rejects this
    // command atomically, retaining prior commands and no unrelated new effects.
    if (error.diagnostic?.code?.startsWith('KQL_')) {
      current = state.securityObservability === undefined && program.profile === SECURITY_PROFILE
        ? { ...state, securityObservability: emptySecurityObservabilityState() } : state
      trace.length = 0; output.length = 0; diagnostics.length = 0
    }
    diagnostics.push(error.diagnostic ?? { code: 'MESSAGING_RUNTIME', message: 'The bounded script could not execute this value.', path: program.entry, line: 1, column: 1 })
  }
  return { state: current, value, trace, diagnostics: program.profile === SECURITY_PROFILE
    ? sanitizeSecurityDiagnostics(diagnostics, sandbox, input.securityObservability) : diagnostics, output }
}
