import { parseQuery, executeQuery } from './kql.js'
import { telemetryDataset, TELEMETRY_DESTINATION } from './export.js'
import { sensitiveTelemetry, sensitiveTelemetryName } from './privacy.js'

/** Semantic names are guarded even when an empty result never emits a column. */
export function sensitiveQuery(query) {
  if (sensitiveTelemetry(query)) return true
  function names(value) {
    if (!value || typeof value !== 'object') return false
    return Object.entries(value).some(([key, item]) => (key === 'name' || key === 'key') && typeof item === 'string' && sensitiveTelemetryName(item)
      || names(item))
  }
  return names(query)
}

/** Exact table exports at this journal prefix; generation never counts queries. */
export function queryInputs(state, table, records = state.records) {
  const exported = new Set(records.filter(row => row.kind === 'telemetry-export').map(row => row.rowId))
  const dataset = telemetryDataset(state).filter(row => exported.has(row.id))
  const ids = new Set(dataset.filter(row => row.table === table && row._ResourceId === TELEMETRY_DESTINATION).map(row => row.id))
  const exportIds = records.filter(row => row.kind === 'telemetry-export' && row.destination === TELEMETRY_DESTINATION && ids.has(row.rowId)).map(row => row.id)
  return { dataset, exportIds, generation: exportIds.length }
}

export function evaluateTelemetryQuery(query, state, records = state.records) {
  const inputs = queryInputs(state, query.table, records)
  const { rows, lineage } = executeQuery(query, inputs.dataset)
  return { kind: 'telemetry-query', destination: TELEMETRY_DESTINATION, generation: inputs.generation,
    exportIds: inputs.exportIds, inputRowIds: lineage.inputRowIds, query: structuredClone(query), rows }
}

const same = (a, b) => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a).sort(), other = Object.keys(b).sort()
  return keys.length === other.length && keys.every((key, i) => key === other[i] && same(a[key], b[key]))
}
/** Restore recomputes real prefix data instead of accepting matching snapshots. */
export function validTelemetryQuery(row, state, previous) {
  try {
    if (sensitiveQuery(row.query) || sensitiveTelemetry(row.rows)) return false
    const computed = evaluateTelemetryQuery(row.query, state, previous)
    return Object.entries(computed).every(([key, value]) => same(row[key], value))
  } catch { return false }
}

/** Historical receipts stay admissible; only current completion uses this gate. */
export function telemetryQueriesCurrent(measurement, state) {
  return (measurement?.records ?? []).filter(row => row.kind === 'telemetry-query').every(row => {
    const inputs = queryInputs(state, row.query.table)
    return row.destination === TELEMETRY_DESTINATION && row.generation === inputs.generation && same(row.exportIds, inputs.exportIds)
  })
}

export { parseQuery }
