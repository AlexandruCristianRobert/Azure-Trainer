import { canonicalize } from '../labEngine/evidence.js'
import { finiteJson, plainObject, validateMessagingState } from './state.js'

/** Select Sandbox configuration only; broker records and clocks are never dependencies. */
export function messagingResourceConfiguration(value, dataDictionary = false) {
  if (Array.isArray(value)) return value.map(item => messagingResourceConfiguration(item, dataDictionary))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => dataDictionary || key !== 'createdAt')
    .map(([key, item]) => [key, messagingResourceConfiguration(item, dataDictionary || ['tags', 'appSettings', 'properties', 'applicationProperties'].includes(key))]))
  return value ?? null
}

export function messagingDependencies({ files = [], resources = {} } = {}) {
  return Object.fromEntries([
    ...files.map(path => [`messaging:file:${path}`, ({ project }) => ({ text: project.savedFiles[path] ?? null,
      generation: project.fileVersions[path] ?? 0 })]),
    ...Object.entries(resources).map(([key, selector]) => [`messaging:resource:${key}`, ({ sandbox }) => messagingResourceConfiguration(selector(sandbox))]),
  ])
}

/** Relevant config generations survive change/revert; unchanged selectors never bump. */
export function refreshMessagingDependencies(before, after, lab) {
  if (lab?.capabilities?.messaging !== true) return after
  const generations = { ...after.dependencyGenerations }, changed = new Set()
  for (const task of lab.tasks) for (const [key, selector] of Object.entries(task.dependencies ?? {})) {
    if (!key.startsWith('messaging:resource:') || changed.has(key)) continue
    if (canonicalize(selector(before)) !== canonicalize(selector(after))) {
      generations[key] = Math.max(generations[key] ?? 0, (before.dependencyGenerations[key] ?? 0) + 1)
      changed.add(key)
    }
  }
  return changed.size ? { ...after, dependencyGenerations: generations } : after
}

/** Only receipts physically touched by this execution belong to its measurements. */
export function messagingMeasurements(before, after, execution, entry, mode, diagnostics) {
  const busIds = new Set(execution.trace.map(row => row.messageRecordId).filter(Boolean))
  const eventIds = new Set(execution.trace.map(row => row.deliveryId).filter(Boolean))
  const effects = { before: {}, after: {} }
  for (const family of new Set([...Object.keys(before.effects), ...Object.keys(after.effects)])) {
    const old = before.effects[family] ?? {}, current = after.effects[family] ?? {}
    const keys = [...new Set([...Object.keys(old), ...Object.keys(current)])]
      .filter(key => canonicalize(old[key] ?? null) !== canonicalize(current[key] ?? null))
    if (!keys.length) continue
    effects.before[family] = Object.fromEntries(keys.map(key => [key, old[key] ?? null]))
    effects.after[family] = Object.fromEntries(keys.map(key => [key, current[key] ?? null]))
  }
  return { entry, mode, trace: execution.trace, value: execution.value ?? null, sourcePaths: execution.sourcePaths,
    receipts: {
      servicebus: Object.values(after.entities).flatMap(entity => entity.messages).filter(row => busIds.has(row.id)),
      eventgrid: (after.eventGrid?.deliveries ?? []).filter(row => eventIds.has(row.id)),
    }, effects, diagnostics }
}

export function messagingDiagnosticsExpected(measurements, exercise) {
  return measurements.diagnostics.every(diagnostic => {
    const receipt = diagnostic.handlerFailure
    if (diagnostic.code !== 'MESSAGING_RUNTIME' || diagnostic.errorType !== 'ValueError' || !receipt) return false
    if (receipt.kind === 'servicebus') {
      const record = measurements.receipts.servicebus.find(row => row.id === receipt.messageRecordId && row.entityId === receipt.entityId && row.messageId === receipt.messageId)
      return exercise.expectedFailures?.some(item => item.kind === 'servicebus' && item.entityId === receipt.entityId && item.messageId === receipt.messageId) === true
        && !!record?.lockHistory.some(lock => lock.lockToken === receipt.lockToken && lock.receiverId === receipt.receiverId && lock.settlement === 'abandon')
        && measurements.trace.some(row => row.kind === 'abandon' && row.messageRecordId === receipt.messageRecordId && row.lockToken === receipt.lockToken)
    }
    const record = measurements.receipts.eventgrid.find(row => row.id === receipt.deliveryId && row.eventRecordId === receipt.eventRecordId && row.event.id === receipt.eventId)
    return receipt.kind === 'eventgrid' && exercise.expectedFailures?.some(item => item.kind === 'eventgrid'
      && item.subscriptionId === record?.subscriptionId && item.eventId === receipt.eventId) === true
      && measurements.trace.some(row => row.deliveryId === receipt.deliveryId && row.attempts === receipt.attempt && row.status !== 'delivered')
  })
}

/** Structural and causal admission, not authentication of browser-local storage. */
export function validMessagingEvidence(record, run, lab) {
  const declaration = lab.messagingExercise?.tasks.find(item => item.taskId === record.taskId)
  if (!declaration) return !lab.messagingExercise || !lab.tasks.find(task => task.id === record.taskId)?.verification
  const m = record.measurements, state = run.runtime.messaging
  if (!plainObject(m) || !finiteJson(m) || Object.keys(m).sort().join(',') !== 'diagnostics,effects,entry,executionId,mode,receipts,sourcePaths,trace,value'
    || m.entry !== declaration.entry || m.mode !== declaration.mode
    || !Array.isArray(m.sourcePaths) || m.sourcePaths.length < 1 || m.sourcePaths.length > 20
    || new Set(m.sourcePaths).size !== m.sourcePaths.length || !m.sourcePaths.includes(m.entry)
    || m.sourcePaths.some(path => typeof path !== 'string' || !Object.hasOwn(run.project.savedFiles, path))
    || !Array.isArray(m.trace) || m.trace.length > 500 || !Array.isArray(m.diagnostics) || m.diagnostics.length > 500
    || !plainObject(m.receipts) || Object.keys(m.receipts).sort().join(',') !== 'eventgrid,servicebus'
    || !Array.isArray(m.receipts.servicebus) || m.receipts.servicebus.length > 50
    || !Array.isArray(m.receipts.eventgrid) || m.receipts.eventgrid.length > 50
    || !plainObject(m.effects) || Object.keys(m.effects).sort().join(',') !== 'after,before'
    || !plainObject(m.effects.before) || !plainObject(m.effects.after)) return false
  const execution = state.executionReceipts?.find(receipt => receipt.id === m.executionId)
  const { executionId, ...snapshot } = m
  if (!execution || execution.entry !== m.entry || execution.mode !== m.mode || canonicalize(snapshot) !== canonicalize(execution.measurements)) return false
  const traceIds = new Set(), retained = [...state.deliveries, ...(state.eventGrid?.traces ?? [])]
  for (const trace of m.trace) {
    const match = /^(?:trace|eg-trace)-([1-9]\d*)$/.exec(trace?.id)
    const actual = retained.find(row => row.id === trace?.id)
    if (!plainObject(trace) || !match || Number(match[1]) >= state.nextId || traceIds.has(trace.id)
      || typeof trace.kind !== 'string' || !Number.isSafeInteger(trace.timeMs) || trace.timeMs < 0 || trace.timeMs > state.timeMs
      || actual && canonicalize(actual) !== canonicalize(trace)) return false
    traceIds.add(trace.id)
  }
  const measuredHistory = { ...state, deliveries: m.trace.filter(trace => trace.id.startsWith('trace-')) }
  const eventTrace = m.trace.filter(trace => trace.id.startsWith('eg-trace-'))
  if (state.eventGrid) measuredHistory.eventGrid = { ...state.eventGrid, traces: eventTrace }
  else if (eventTrace.length) return false
  if (!validateMessagingState(measuredHistory)) return false
  const bus = Object.values(state.entities).flatMap(entity => entity.messages)
  const grid = state.eventGrid?.deliveries ?? []
  for (const [rows, actualRows, linkage] of [[m.receipts.servicebus, bus, 'messageRecordId'], [m.receipts.eventgrid, grid, 'deliveryId']]) {
    const ids = new Set()
    for (const row of rows) {
      const actual = actualRows.find(item => item.id === row?.id)
      if (!plainObject(row) || !actual || ids.has(row.id) || !m.trace.some(trace => trace[linkage] === row.id)) return false
      const keys = linkage === 'messageRecordId' ? ['entityId', 'sourceMessageId', 'messageId', 'body'] : ['subscriptionId', 'eventRecordId', 'event']
      if (keys.some(key => canonicalize(row[key]) !== canonicalize(actual[key]))) return false
      ids.add(row.id)
    }
  }
  if (record.outcome !== 'passed') return true
  const task = lab.tasks.find(task => task.id === record.taskId)
  try {
    return m.trace.some(row => row.kind !== 'advance') && messagingDiagnosticsExpected(m, lab.messagingExercise)
      && m.sourcePaths.every(path => Object.hasOwn(task.dependencies ?? {}, `messaging:file:${path}`))
      && declaration.check(JSON.parse(JSON.stringify(m))) === true
  } catch { return false }
}

/** Actual latest boundaries anchor runtime; older snapshots remain their prior outcomes. */
export function validMessagingExecutionReceipts(state) {
  const effects = new Map(), bus = new Map(), grid = new Map()
  for (const execution of state.executionReceipts ?? []) {
    const m = execution.measurements
    if (canonicalize(Object.keys(m.effects.before).sort()) !== canonicalize(Object.keys(m.effects.after).sort())) return false
    for (const [family, values] of Object.entries(m.effects.after)) {
      const before = m.effects.before[family]
      if (canonicalize(Object.keys(before).sort()) !== canonicalize(Object.keys(values).sort())) return false
      for (const [key, value] of Object.entries(values)) {
        const identity = JSON.stringify([family, key]), old = before[key]
        if (canonicalize(old) === canonicalize(value) || effects.has(identity) && canonicalize(effects.get(identity)) !== canonicalize(old)) return false
        if (family === 'workByOrder' ? !Number.isSafeInteger(value) || value <= (old ?? 0) || old !== null && (!Number.isSafeInteger(old) || old < 0)
          : old !== null || !plainObject(value) || (family === 'processed' ? value.id !== key : value.eventId !== key || typeof value.orderId !== 'string')) return false
        effects.set(identity, value)
      }
    }
    for (const [rows, latest, linkage] of [[m.receipts.servicebus, bus, 'messageRecordId'], [m.receipts.eventgrid, grid, 'deliveryId']]) {
      const ids = new Set()
      for (const row of rows) {
        if (!plainObject(row) || typeof row.id !== 'string' || ids.has(row.id) || !m.trace.some(trace => trace[linkage] === row.id)) return false
        latest.set(row.id, row)
        ids.add(row.id)
      }
    }
  }
  for (const [identity, value] of effects) {
    const [family, key] = JSON.parse(identity)
    if (canonicalize(value) !== canonicalize(state.effects[family]?.[key] ?? null)) return false
  }
  const actualBus = Object.values(state.entities).flatMap(entity => entity.messages)
  for (const [latest, actual] of [[bus, actualBus], [grid, state.eventGrid?.deliveries ?? []]]) for (const [id, row] of latest) {
    const current = actual.find(item => item.id === id)
    if (!current || canonicalize(row) !== canonicalize(current)) return false
  }
  return true
}
