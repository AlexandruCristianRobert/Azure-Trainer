import { executeMessagingEntry } from './execute.js'
import { runMessagingFunctions } from './functions.js'
import { messagingCommandAllowed } from './shell.js'
import { messagingMeasurements, messagingDiagnosticsExpected } from './evidence.js'
import { recordVerification } from '../labEngine/evidence.js'
import { cloneJson, isJsonValue } from '../labEngine/run.js'
import { fail } from '../labEngine/errors.js'

/** Internal adapter: only an engine-validated intent may reach saved source execution. */
export function applyMessagingAction(run, action, lab) {
  if (!isJsonValue(action) || Object.keys(action).length !== 3 || action.type !== 'messaging-run'
    || !messagingCommandAllowed(run, lab, action.entry, action.mode)
    || action.mode === 'functions' && (lab.messagingInput?.functions?.entry ?? 'function_app.py') !== action.entry) fail('INVALID_EFFECT', 'Messaging execution intent is malformed or unavailable.')
  if ((run.runtime.messaging.executionReceipts?.length ?? 0) >= 50 || run.runtime.messaging.nextId >= Number.MAX_SAFE_INTEGER - 1) {
    const diagnostic = { code: 'MESSAGING_LIMIT', message: 'The command receipt limit is reached. Reset for a fresh attempt.', path: action.entry, line: 1, column: 1 }
    return { run, lines: [`${action.entry}:1:1 ${diagnostic.code}: ${diagnostic.message}`], portalEvents: [], diagnostics: [diagnostic], execution: null }
  }
  const result = action.mode === 'functions' ? runMessagingFunctions(run, lab) : executeMessagingEntry(run, lab, action.entry, action.mode)
  let next = result.run
  if (result.execution) {
    const measurements = cloneJson(messagingMeasurements(run.runtime.messaging, next.runtime.messaging, result.execution, action.entry, action.mode, result.diagnostics))
    const state = next.runtime.messaging, executionId = `execution-${state.nextId}`
    const receipt = { id: executionId, entry: action.entry, mode: action.mode, measurements: cloneJson(measurements) }
    next = { ...next, runtime: { ...next.runtime, messaging: { ...state, nextId: state.nextId + 1,
      executionReceipts: [...(state.executionReceipts ?? []), receipt] } } }
    measurements.executionId = executionId
    const safeDiagnostics = messagingDiagnosticsExpected(measurements, lab.messagingExercise)
    for (const declaration of lab.messagingExercise.tasks.filter(item => item.entry === action.entry && item.mode === action.mode)) {
      const task = lab.tasks.find(task => task.id === declaration.taskId)
      // Every reached source must be a freshness dependency, including protected helpers.
      const sourcesCovered = result.execution.sourcePaths.every(path => Object.hasOwn(task.dependencies ?? {}, `messaging:file:${path}`))
      let passed = false
      try { passed = safeDiagnostics && sourcesCovered && measurements.trace.some(row => row.kind !== 'advance')
        && declaration.check(cloneJson(measurements)) === true } catch { /* failed behavior */ }
      next = recordVerification(next, lab, task.id, { scenarioId: declaration.scenarioId, scenarioVersion: declaration.scenarioVersion,
        outcome: passed ? 'passed' : 'failed', completed: true, startedAtMs: run.runtime.simTimeMs,
        endedAtMs: next.runtime.simTimeMs, measurements })
    }
  }
  return { ...result, run: next }
}
