export const TELEMETRY_SIGNATURES = Object.freeze({
  query_telemetry: [['query'], 1, 'data'],
  configure_azure_monitor: [['connection_string', 'logger_name'], 2, 'data', 0],
  get_tracer: [['instrumenting_module_name'], 1, 'tracer'],
  get_current_span: [[], 0, 'span'],
  'tracer.start_as_current_span': [['name', 'context', 'kind', 'attributes'], 1, 'spanmanager'],
  'span.set_attribute': [['key', 'value'], 2, 'data'],
  'span.add_event': [['name', 'attributes'], 1, 'data'],
  'span.record_exception': [['exception'], 1, 'data'],
  'span.set_status': [['status'], 1, 'data'],
  Status: [['status_code'], 1, 'spanstatus'],
  inject: [['carrier', 'context'], 1, 'data'],
  extract: [['carrier'], 1, 'tracecontext'],
  getLogger: [['name'], 1, 'logger'],
  'logger.setLevel': [['level'], 1, 'data'],
  'logger.info': [['msg', 'extra'], 1, 'data'],
  'logger.warning': [['msg', 'extra'], 1, 'data'],
  'logger.error': [['msg', 'extra'], 1, 'data'],
  get_meter: [['name'], 1, 'meter'],
  'meter.create_counter': [['name', 'unit', 'description'], 1, 'counter'],
  'meter.create_histogram': [['name', 'unit', 'description'], 1, 'histogram'],
  'counter.add': [['amount', 'attributes'], 1, 'data'],
  'histogram.record': [['amount', 'attributes'], 1, 'data'],
})
export const TELEMETRY_HELPERS = ['query_telemetry']
export const TELEMETRY_EXPORTS = Object.freeze({
  'azure.monitor.opentelemetry': ['configure_azure_monitor'],
  opentelemetry: ['trace', 'propagate', 'metrics'],
  'opentelemetry.trace': ['get_tracer', 'get_current_span', 'SpanKind', 'Status', 'StatusCode'],
  'opentelemetry.propagate': ['inject', 'extract'],
  'opentelemetry.metrics': ['get_meter'],
  logging: ['getLogger', 'INFO', 'WARNING', 'ERROR'],
})
export const TELEMETRY_INITIALIZERS = ['configure_azure_monitor', 'get_tracer', 'getLogger', 'get_meter', 'meter.create_counter', 'meter.create_histogram', 'logger.setLevel']
export const TELEMETRY_COSTS = Object.freeze({ 'secretclient.get_secret': 7, load: 9, 'configprovider.refresh': 4, send_notification: 12, 'publisher.send': 3, 'sender.send_messages': 3, 'receiver.receive_messages': 2, 'receiver.complete_message': 1, 'receiver.abandon_message': 1, 'receiver.dead_letter_message': 1, perform_order_work: 5, record_processed: 1 })
export const TELEMETRY_CONSTANTS = Object.freeze({
  SpanKind: { INTERNAL: 'INTERNAL', SERVER: 'SERVER', CLIENT: 'CLIENT', PRODUCER: 'PRODUCER', CONSUMER: 'CONSUMER' },
  StatusCode: { UNSET: 'UNSET', OK: 'OK', ERROR: 'ERROR' },
  logging: { INFO: 20, WARNING: 30, ERROR: 40 },
})
export function telemetryImport(module, name) {
  if (module === 'opentelemetry') return { type: 'module', module: `opentelemetry.${name}` }
  if (module === 'opentelemetry.trace' && ['SpanKind', 'StatusCode'].includes(name)) return { type: 'telemetryenum', enum: name }
  if (module === 'logging' && Object.hasOwn(TELEMETRY_CONSTANTS.logging, name)) return { type: 'data', constant: TELEMETRY_CONSTANTS.logging[name] }
  return null
}
