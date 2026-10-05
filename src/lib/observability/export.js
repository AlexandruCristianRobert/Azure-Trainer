export const TRAINER_CONNECTION_STRING = 'InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://ai-orders.training.invalid/'
export const TELEMETRY_DESTINATION = '/training/applicationinsights/ai-orders'
export const TELEMETRY_EPOCH_MS = Date.parse('2026-01-01T00:00:00.000Z')
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
const text = (value, max = 512) => typeof value === 'string' && value.length > 0 && value.length <= max
const traceId = value => typeof value === 'string' && /^(?!0{32}$)[a-f0-9]{32}$/.test(value)
const spanId = value => typeof value === 'string' && /^(?!0{16}$)[a-f0-9]{16}$/.test(value)
export const validSpanLink = value => exact(value, 'operationId,spanId') && traceId(value.operationId) && spanId(value.spanId)
export function validTelemetryProperties(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 34
    && Object.entries(value).every(([key, item]) => text(key, 128) && !['__proto__', 'constructor', 'prototype'].includes(key)
      && (typeof item === 'string' && item.length <= 512 || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)))
}
export function validTelemetryRow(row) {
  const base = 'id,table,TimeGenerated,OperationId,ParentId,_ResourceId,AppRoleName,ItemCount,Properties,'
  if (!row || !/^telemetry-[1-9]\d*$/.test(row.id) || typeof row.TimeGenerated !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.TimeGenerated) || !Number.isFinite(Date.parse(row.TimeGenerated))
    || new Date(row.TimeGenerated).toISOString() !== row.TimeGenerated || Date.parse(row.TimeGenerated) < TELEMETRY_EPOCH_MS
    || !traceId(row.OperationId) || row.ParentId !== null && !spanId(row.ParentId) || row._ResourceId !== TELEMETRY_DESTINATION
    || !text(row.AppRoleName, 128) || row.ItemCount !== 1 || !validTelemetryProperties(row.Properties) || row.Properties['trainer.simulated'] !== true) return false
  if (['AppRequests', 'AppDependencies'].includes(row.table)) return exact(row, base + 'Id,Name,Success,ResultCode,DurationMs')
    && spanId(row.Id) && text(row.Name, 128) && typeof row.Success === 'boolean' && ['UNSET', 'OK', 'ERROR'].includes(row.ResultCode)
    && Number.isSafeInteger(row.DurationMs) && row.DurationMs >= 0
  if (row.table === 'AppTraces') return exact(row, base + 'Message,SeverityLevel') && text(row.Message) && [1, 2, 3].includes(row.SeverityLevel)
  if (row.table === 'AppExceptions') return exact(row, base + 'ExceptionType,OuterMessage') && row.ExceptionType === 'ValueError' && row.OuterMessage === 'Application ValueError (message omitted)'
  if (row.table === 'AppMetrics') return exact(row, base + 'Name,Sum,Min,Max,Count') && text(row.Name, 128)
    && [row.Sum, row.Min, row.Max].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) && row.Count === 1 && row.Min === row.Sum && row.Max === row.Sum
  return false
}
/** Detached workspace rows; callers cannot change the authoritative journal. */
export function telemetryDataset(state) { return structuredClone((state?.securityObservability ?? state)?.telemetry ?? []) }
