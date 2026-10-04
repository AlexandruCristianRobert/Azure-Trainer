import { appendSecurityRecord, validateSecurityObservabilityState, securityObject } from '../security/state.js'
import { TELEMETRY_SIGNATURES, TELEMETRY_CONSTANTS, TELEMETRY_COSTS } from './sdk.js'
import { TRAINER_CONNECTION_STRING, TELEMETRY_DESTINATION, TELEMETRY_EPOCH_MS, validTelemetryProperties } from './export.js'
import { sensitiveTelemetry, sensitiveTelemetryName } from './privacy.js'

export const TELEMETRY_OPERATIONS = new Set(Object.keys(TELEMETRY_COSTS))
const traceparent = /^00-((?!0{32})[a-f0-9]{32})-((?!0{16})[a-f0-9]{16})-(00|01)$/
export function createTelemetrySession(context) {
  const { handle, info, fail } = context
  let configured = false, role = null, active = null, serial = 0, started = 0, nesting = 0, cost = 0
  const state = () => context.getState().securityObservability
  const update = extension => context.setState({ ...context.getState(), securityObservability: extension })
  function record(fields, loc) {
    try { const result = appendSecurityRecord(state(), fields); update(result.state); return result.record }
    catch { fail('Telemetry journal capacity exceeded.', loc, 'MESSAGING_LIMIT') }
  }
  function guard(value, loc, category = 'telemetry') {
    context.guard(value, loc, category)
    if (sensitiveTelemetry(value, info)) {
      record({ kind: 'privacy-violation', category }, loc)
      fail('Sensitive data is not allowed at this public boundary.', loc, 'SECURITY_PRIVACY')
    }
  }
  function safeText(value, loc, max = 128) {
    guard(value, loc)
    if (typeof value !== 'string' || !value.length || value.length > max) fail('Telemetry requires bounded nonempty text.', loc, 'MESSAGING_CONFIG')
    return value
  }
  function attributes(value, loc) {
    const result = value == null ? {} : value
    guard(result, loc)
    if (!validTelemetryProperties(result) || Object.keys(result).length > 32) fail('Telemetry supports at most 32 safe scalar attributes.', loc, 'MESSAGING_LIMIT')
    return structuredClone(result)
  }
  function required(loc) { if (!configured) fail('Configure the trainer Azure Monitor exporter explicitly before telemetry use.', loc, 'MESSAGING_CONFIG') }
  function nextContext(parent) {
    const id = (BigInt(state().nextId) * 1000n + BigInt(++serial)).toString(16).padStart(16, '0')
    return { id, operationId: parent?.operationId ?? ('a'.repeat(16) + id), parentId: parent?.id ?? null }
  }
  function exported(fields, span, loc) {
    required(loc)
    const before = state(), id = `telemetry-${before.telemetry.length + 1}`
    const row = { id, TimeGenerated: new Date(TELEMETRY_EPOCH_MS + before.timeMs).toISOString(), OperationId: span.operationId, ParentId: span.id,
      _ResourceId: TELEMETRY_DESTINATION, AppRoleName: role, ItemCount: 1,
      Properties: { 'trainer.simulated': true, 'trainer.timing': 'logical-operation-cost', ...fields.Properties }, ...fields }
    // Fields may override ParentId for actual span rows, but never simulator properties.
    row.Properties = { ...fields.Properties, 'trainer.simulated': true, 'trainer.timing': 'logical-operation-cost' }
    const record = { id: `so-${before.nextId}`, timeMs: before.timeMs, kind: 'telemetry-export', rowId: id,
      destination: TELEMETRY_DESTINATION, operationId: row.OperationId, spanId: row.Id ?? row.ParentId }
    const next = { ...before, nextId: before.nextId + 1, records: [...before.records, record], telemetry: [...before.telemetry, row] }
    if (!validateSecurityObservabilityState(next)) fail('Telemetry rows exceed the bounded schema or journal capacity.', loc, 'MESSAGING_LIMIT')
    update(next)
  }
  function spanValue(owner, loc) {
    const value = info(owner)
    if (value?.type !== 'span' || !value.span || value.span.ended) fail('An active span handle is required.', loc, 'MESSAGING_CONFIG')
    return value.span
  }
  function extract(carrier, loc) {
    if (!securityObject(carrier) || Object.keys(carrier).length > 32) fail('Propagation requires a bounded dictionary carrier.', loc, 'MESSAGING_CONFIG')
    const value = carrier.traceparent ?? carrier['Diagnostic-Id']
    if (value === undefined) return handle('tracecontext', { span: null })
    const match = typeof value === 'string' && traceparent.exec(value)
    if (!match || carrier.traceparent !== undefined && carrier['Diagnostic-Id'] !== undefined && carrier.traceparent !== carrier['Diagnostic-Id']) fail('Malformed W3C traceparent carrier.', loc, 'MESSAGING_CONFIG')
    return handle('tracecontext', { span: { operationId: match[1], id: match[2] } })
  }
  function exception(span, loc) { exported({ table: 'AppExceptions', ExceptionType: 'ValueError', OuterMessage: 'Application ValueError (message omitted)', Properties: span.attributes }, span, loc) }
  function enter(owner, loc) {
    required(loc)
    const spec = info(owner)
    if (spec?.type !== 'spanmanager' || spec.used) fail('Use a fresh start_as_current_span context manager.', loc, 'MESSAGING_CONFIG')
    if (started >= 100 || nesting >= 16) fail('Telemetry allows 100 spans per command and 16 nested spans.', loc, 'MESSAGING_LIMIT')
    const before = context.getState(), checkpoint = context.checkpoint(), initialCost = cost
    spec.used = true; started++; nesting++
    const previous = active, span = { ...nextContext(spec.contextParent === undefined ? active : spec.contextParent), name: spec.name, kind: spec.kind,
      attributes: spec.attributes, status: 'UNSET', startCost: cost, ended: false }
    active = span
    return { value: handle('span', { span }), exit(error) {
      try {
        if (error?.diagnostic?.errorType === 'ValueError') { span.status = 'ERROR'; exception(span, loc) }
        exported({ table: ['SERVER', 'CONSUMER'].includes(span.kind) ? 'AppRequests' : 'AppDependencies', Id: span.id,
          ParentId: span.parentId, Name: span.name, Success: span.status !== 'ERROR', ResultCode: span.status,
          DurationMs: cost - span.startCost, Properties: span.attributes }, span, loc)
      } catch (failure) {
        context.setState(before); context.restore(checkpoint); cost = initialCost
        throw failure
      } finally { span.ended = true; active = previous; nesting-- }
    } }
  }
  return {
    guard, enter,
    member(owner, name) {
      const value = info(owner)
      return value?.type === 'telemetryenum' && Object.hasOwn(TELEMETRY_CONSTANTS[value.enum], name)
        ? { handled: true, value: TELEMETRY_CONSTANTS[value.enum][name] } : { handled: false }
    },
    call(name, owner, args, loc) {
      if (!Object.hasOwn(TELEMETRY_SIGNATURES, name)) return { handled: false }
      const result = value => ({ handled: true, value })
      if (name === 'configure_azure_monitor') {
        if (configured || args.connection_string !== TRAINER_CONNECTION_STRING) fail('Use the single pre-provisioned ai-orders trainer connection string.', loc, 'MESSAGING_CONFIG')
        role = safeText(args.logger_name, loc); configured = true; return result(null)
      }
      required(loc)
      if (name === 'get_tracer' || name === 'get_meter') { safeText(args.instrumenting_module_name ?? args.name, loc); return result(handle(name === 'get_tracer' ? 'tracer' : 'meter')) }
      if (name === 'get_current_span') return result(handle('span', { span: active }))
      if (name === 'getLogger') return result(handle('logger', { name: safeText(args.name, loc), level: 20 }))
      if (name === 'Status') {
        if (!Object.values(TELEMETRY_CONSTANTS.StatusCode).includes(args.status_code)) fail('Use a supported StatusCode.', loc, 'MESSAGING_CONFIG')
        return result(handle('spanstatus', { status: args.status_code }))
      }
      if (name === 'tracer.start_as_current_span') {
        const kind = args.kind ?? 'INTERNAL'
        if (!Object.values(TELEMETRY_CONSTANTS.SpanKind).includes(kind)) fail('Use a supported SpanKind.', loc, 'MESSAGING_CONFIG')
        if (args.context != null && info(args.context)?.type !== 'tracecontext') fail('Use a context returned by propagate.extract.', loc, 'MESSAGING_CONFIG')
        return result(handle('spanmanager', { name: safeText(args.name, loc), kind, attributes: attributes(args.attributes, loc),
          contextParent: args.context == null ? undefined : info(args.context).span }))
      }
      if (name.startsWith('span.')) {
        const span = spanValue(owner, loc)
        if (name === 'span.set_attribute') {
          if (typeof args.key !== 'string' || sensitiveTelemetryName(args.key)) { record({ kind: 'privacy-violation', category: 'telemetry' }, loc); fail('Sensitive attribute names are rejected.', loc, 'SECURITY_PRIVACY') }
          span.attributes = attributes({ ...span.attributes, [args.key]: args.value }, loc)
        }
        if (name === 'span.add_event') exported({ table: 'AppTraces', Message: safeText(args.name, loc, 512), SeverityLevel: 1, Properties: attributes(args.attributes, loc) }, span, loc)
        if (name === 'span.record_exception') {
          if (info(args.exception)?.type !== 'error') fail('record_exception requires ValueError.', loc, 'MESSAGING_CONFIG')
          exception(span, loc)
        }
        if (name === 'span.set_status') {
          if (info(args.status)?.type !== 'spanstatus') fail('set_status requires Status(StatusCode).', loc, 'MESSAGING_CONFIG')
          span.status = info(args.status).status
        }
        return result(null)
      }
      if (name === 'extract') return result(extract(args.carrier, loc))
      if (name === 'inject') {
        if (!securityObject(args.carrier) || info(args.carrier) || Object.isFrozen(args.carrier)) fail('Inject into a writable dictionary carrier.', loc, 'MESSAGING_CONFIG')
        if (args.context != null && info(args.context)?.type !== 'tracecontext') fail('Use an extracted context.', loc, 'MESSAGING_CONFIG')
        const span = args.context == null ? active : info(args.context).span
        if (span) args.carrier.traceparent = `00-${span.operationId}-${span.id}-01`
        return result(null)
      }
      if (name === 'logger.setLevel') {
        if (![20, 30, 40].includes(args.level)) fail('Supported logging levels are INFO, WARNING and ERROR.', loc, 'MESSAGING_CONFIG')
        info(owner).level = args.level; return result(null)
      }
      if (name.startsWith('logger.')) {
        const message = safeText(args.msg, loc, 512), properties = attributes(args.extra, loc), level = { 'logger.info': 20, 'logger.warning': 30, 'logger.error': 40 }[name]
        if (info(owner).name !== role) fail('The logger must match the configured logger_name.', loc, 'MESSAGING_CONFIG')
        if (level >= info(owner).level) exported({ table: 'AppTraces', Message: message, SeverityLevel: level / 10 - 1, Properties: properties }, active ?? nextContext(null), loc)
        return result(null)
      }
      if (name.startsWith('meter.')) {
        const metricName = safeText(args.name, loc)
        if (args.unit !== undefined) safeText(args.unit, loc)
        if (args.description !== undefined) safeText(args.description, loc, 512)
        return result(handle(name.endsWith('counter') ? 'counter' : 'histogram', { name: metricName }))
      }
      if (!Number.isFinite(args.amount) || args.amount < 0) fail('Metric measurements must be finite nonnegative numbers.', loc, 'MESSAGING_CONFIG')
      exported({ table: 'AppMetrics', Name: info(owner).name, Sum: args.amount, Min: args.amount, Max: args.amount, Count: 1,
        Properties: attributes(args.attributes, loc) }, active ?? nextContext(null), loc)
      return result(null)
    },
    operation(name, perform, loc) {
      if (!active || !TELEMETRY_OPERATIONS.has(name)) return perform()
      const before = context.getState(), checkpoint = context.checkpoint(), span = active, sequence = state().nextId, traceStart = context.getTrace().length
      let value, error
      try { value = perform() } catch (caught) { error = caught }
      try {
        const success = !error && (name !== 'send_notification' || value?.status_code === 202)
        const elapsed = TELEMETRY_COSTS[name]
        record({ kind: 'telemetry-operation', operation: name, operationId: span.operationId, spanId: span.id,
          success, costMs: elapsed, recordIds: state().records.filter(row => Number(row.id.slice(3)) >= sequence).map(row => row.id),
          traceIds: context.getTrace().slice(traceStart).map(row => row.id) }, loc)
        cost += elapsed
      } catch (failure) { context.setState(before); context.restore(checkpoint); throw failure }
      if (error) throw error
      return value
    },
    invocation(name, carrier, metadata, perform, loc) {
      if (!configured) return perform()
      const previous = active
      active = null
      let scope, error
      try {
        const manager = handle('spanmanager', { name, kind: 'CONSUMER', attributes: attributes(metadata, loc), contextParent: info(extract(carrier ?? {}, loc)).span })
        scope = enter(manager, loc)
        try { return perform() } catch (caught) { error = caught; throw caught }
      } finally { try { scope?.exit(error) } finally { active = previous } }
    },
    checkpoint() { return { active, serial, started, nesting, cost } },
    restore(snapshot) { ({ active, serial, started, nesting, cost } = snapshot) },
  }
}
