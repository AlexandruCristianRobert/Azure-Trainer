import { describe, it, expect } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { validSecurityJournal } from '../src/lib/security/evidence.js'
import { validateSecurityObservabilityState } from '../src/lib/security/state.js'

const modulePath = '../src/data/labs/security-journey/observability.js'
const journey = await import(/* @vite-ignore */ modulePath).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}
  throw error
})
const labs = journey.OBSERVABILITY_LABS ?? []
const at = index => { expect(labs).toHaveLength(6); return labs[index] }
const measurement = run => run.runtime.messaging.executionReceipts.at(-1).measurements
function replay(lab, edit = source => source, allowPrivacy = false) {
  let run = createBehavioralRun(lab, { attemptId: lab.id })
  for (const task of lab.tasks) for (const step of task.solution.steps) {
    const result = applyRunAction(run, step.kind === 'file'
      ? { type: 'save-file', path: step.path, text: edit(step.content, step.path) }
      : { type: 'command', line: step.line }, lab)
    if (!allowPrivacy) {
      expect(result.diagnostics ?? []).toEqual([])
      expect(result.lines?.filter(row => row.kind === 'err') ?? []).toEqual([])
    }
    run = result.run
  }
  return run
}
describe('observability construction Labs', () => {
  // Seeded proof or omitted dependency would incorrectly complete a fresh/restored Lab.
  it('provides six independent unfinished persisted baselines', () => {
    expect(labs.map(lab => [lab.id, lab.journeyOrder])).toEqual([
      ['observability-setup', 6], ['observability-spans', 7], ['observability-context', 8],
      ['observability-logging', 9], ['observability-failure-query', 10], ['observability-metrics', 11],
    ])
    for (const lab of labs) {
      const run = createBehavioralRun(lab, { attemptId: `initial-${lab.id}` })
      expect(run.runtime.messaging.executionReceipts).toEqual([])
      expect(run.runtime.messaging.securityObservability?.telemetry ?? []).toEqual([])
      expect(run.runtime.messaging.effects).toEqual({})
      expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => !task.done)).toBe(true)
    }
  })
  // Missing actual effects, exported rows or typed query evidence must break each replay.
  it.each([0, 1, 2, 3, 4, 5])('replays Solution %i with persisted causal evidence', index => {
    const lab = at(index), run = replay(lab), m = measurement(run)
    expect(evaluateLab(lab, run).tasks.every(task => task.done)).toBe(true)
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => task.done)).toBe(true)
    expect(run.runtime.messaging.effects.notifications['e-o1']).toEqual({ eventId: 'e-o1', orderId: 'o1' })
    expect(m.securityObservability.records.some(row => row.kind === 'telemetry-operation' && row.operation === 'send_notification')).toBe(true)
    if (index === 2) {
      // Admitting a route must not let it replace its owning publication.
      const detached = structuredClone(run.runtime.messaging)
      for (const state of [detached.securityObservability, detached.executionReceipts.at(-1).measurements.securityObservability]) {
        const operation = state.records.find(row => row.operation === 'publisher.send')
        operation.traceIds = operation.traceIds.filter(id => m.trace.find(trace => trace.id === id)?.kind !== 'publish')
      }
      expect(validSecurityJournal(detached)).toBe(false)
      const unrelated = structuredClone(run.runtime.messaging)
      unrelated.executionReceipts.at(-1).measurements.trace.find(trace => trace.kind === 'route').deliveryId = 'eg-delivery-999'
      expect(validSecurityJournal(unrelated)).toBe(false)
    }
    if (index === 3) expect(m.securityObservability.telemetry.find(row => row.table === 'AppTraces')).toMatchObject({ Properties: { 'app.order_id': 'o1', 'app.channel': 'email', 'app.status_code': 202 } })
    if (index === 4) {
      const failure = m.securityObservability.telemetry.find(row => row.Name === 'NotifyOrder' && row.Success === false)
      expect(m.securityObservability.records.find(row => row.kind === 'telemetry-query').rows).toEqual([{ OrderId: 'o1', OperationId: failure.OperationId, DurationMs: 12 }])
    }
    if (index === 5) {
      expect(m.receipts.servicebus[0].deliveryCount).toBe(2)
      expect(m.securityObservability.records.filter(row => row.kind === 'telemetry-query').at(-1).rows).toEqual([{ MeanMs: 20, MaxMs: 20, Attempts: 2, Retries: 1, Failures: 1, FailureRate: 0.5 }])
      const query = m.securityObservability.records.find(row => row.kind === 'telemetry-query')
      const metrics = m.securityObservability.telemetry.filter(row => row.Name === 'orders.duration')
      const exports = metrics.map(metric => m.securityObservability.records.find(row => row.rowId === metric.id))
      expect(exports.map(row => row.metricInput)).toEqual([0, 1].map(rowIndex => ({ queryId: query.id, rowIndex, column: 'DurationMs' })))
      for (const edit of [input => { input.queryId = 'so-999' }, input => { input.rowIndex = 200 },
        input => { input.column = 'Missing' }, input => { input.column = 'x'.repeat(129) }, input => { input.value = 20 }]) {
        const forged = structuredClone(run)
        for (const state of [forged.runtime.messaging.securityObservability, measurement(forged).securityObservability]) {
          edit(state.records.find(row => row.rowId === metrics[0].id).metricInput)
        }
        expect(() => deserializeRun(JSON.stringify(forged), lab)).toThrow()
      }
      const mismatch = structuredClone(run)
      for (const state of [mismatch.runtime.messaging.securityObservability, measurement(mismatch).securityObservability]) {
        const metric = state.telemetry.find(row => row.id === metrics[0].id)
        metric.Sum = metric.Min = metric.Max = 21
      }
      expect(() => deserializeRun(JSON.stringify(mismatch), lab)).toThrow()
    }
    expect(JSON.stringify([run.evidence, run.runtime.messaging])).not.toMatch(/trainer-demo-key-|private@example.com/)
    const changed = applyRunAction(run, { type: 'save-file', path: index === 2 ? 'function_app.py' : 'worker.py', text: '# changed\n' }, lab).run
    expect(evaluateLab(lab, changed).tasks.at(-1).done).toBe(false)
  })
  it('rejects disconnected spans even when the notification succeeds', () => {
    const lab = at(0), run = replay(lab, source => source.replace('with tracer.start_as_current_span("NotifyOrder"):', 'if True:'))
    expect(run.runtime.messaging.effects.notifications['e-o1']).toBeDefined()
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('requires explicit extracted context and published carrier, beyond automatic host roots', () => {
    const lab = at(2)
    for (const edit of [
      source => source.replace('context=propagate.extract(incoming)', 'context=None'),
      source => source.replace('context=propagate.extract(data["trace_context"])', 'context=None'),
      source => source.replace('propagate.inject(carrier)', 'carrier = {}'),
    ]) {
      const run = replay(lab, edit)
      expect(run.runtime.messaging.effects.notifications['e-o1']).toBeDefined()
      expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
    }
    const noOp = replay(lab, source => source.replace('send_notification(event.id, data["order_id"], secret.value, "email")', 'pass'))
    expect(noOp.runtime.messaging.effects.notifications ?? {}).toEqual({})
    expect(evaluateLab(lab, noOp).tasks.at(-1).done).toBe(false)
  })
  it('rejects a sensitive log attempt despite the privacy guard', () => {
    const lab = at(3), run = replay(lab, source => source.replace('"Notification accepted"', '"private@example.com"'), true)
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
    expect(measurement(run).diagnostics.some(row => row.code === 'SECURITY_PRIVACY')).toBe(true)
    // Learner source is intentionally saved in file dependencies; exported evidence is sanitized.
    expect(JSON.stringify(measurement(run))).not.toContain('private@example.com')
  })
  it('rejects fabricated query totals lacking aggregate lineage', () => {
    const lab = at(5), run = replay(lab, source => source.replace(/SUMMARY_QUERY = .*\n/, 'SUMMARY_QUERY = "AppDependencies | take 1 | project MeanMs=20, MaxMs=20, Attempts=2, Retries=1, Failures=1, FailureRate=0.5"\n'))
    expect(measurement(run).securityObservability.records.filter(row => row.kind === 'telemetry-query').at(-1).rows).toEqual([{ MeanMs: 20, MaxMs: 20, Attempts: 2, Retries: 1, Failures: 1, FailureRate: 0.5 }])
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('requires histogram consumption of query cells, not equal literal values alongside an unused query', () => {
    const lab = at(5), run = replay(lab, source => source.replace('latency.record(row["DurationMs"])', 'latency.record(20)'))
    expect(measurement(run).securityObservability.telemetry.filter(row => row.Name === 'orders.duration').map(row => row.Sum)).toEqual([20, 20])
    expect(evaluateLab(lab, run).tasks.at(-1).done).toBe(false)
  })
  it('keeps query numerics usable as numbers while binding direct metric consumption to this execution', () => {
    const lab = at(0), source = lab.tasks[0].solution.steps[0].content.replace('return send_notification', 'send_notification') + `    rows = query_telemetry("AppDependencies | project DurationMs, Level=20, Ratio=DurationMs / 2")
    value = rows["rows"][0]["DurationMs"]
    if value and value == 19:
        print(value)
        logger = logging.getLogger("orders")
        logger.setLevel(rows["rows"][0]["Level"])
        logger.info("Measured", extra={"app.duration": value})
        meter = metrics.get_meter("orders")
        metric = meter.create_histogram("compat.duration")
        metric.record(value)
        metric.record(value + 0)
        return {"value": value, "plus": value + 1, "negative": -value, "text": str(value), "ratio": rows["rows"][0]["Ratio"]}
`
    const run = replay(lab, () => source), m = measurement(run)
    expect(m.value).toEqual({ value: 19, plus: 20, negative: -19, text: '19', ratio: 9.5 })
    expect(m.securityObservability.telemetry.find(row => row.Message === 'Measured').Properties['app.duration']).toBe(19)
    const metrics = m.securityObservability.telemetry.filter(row => row.Name === 'compat.duration')
    const exports = metrics.map(metric => m.securityObservability.records.find(row => row.rowId === metric.id))
    expect(exports[0].metricInput).toMatchObject({ rowIndex: 0, column: 'DurationMs' })
    expect(exports[1].metricInput).toBeUndefined()
    expect(deserializeRun(serializeRun(run, lab), lab).runtime.messaging.executionReceipts.at(-1).measurements.value).toEqual(m.value)
    const again = applyRunAction(run, { type: 'command', line: 'python worker.py' }, lab).run
    const forged = structuredClone(again.runtime.messaging), current = forged.executionReceipts.at(-1).measurements.securityObservability
    const ownExport = current.records.find(row => row.metricInput)
    for (const state of [forged.securityObservability, current]) state.records.find(row => row.id === ownExport.id).metricInput.queryId = exports[0].metricInput.queryId
    expect(validateSecurityObservabilityState(forged.securityObservability)).toBe(true)
    expect(validSecurityJournal(forged)).toBe(false)
    // Safe query numeric handles must not relax other private-handle boundaries.
    for (const value of ['secret.value', 'client']) {
      const rejected = replay(lab, () => source.replace('extra={"app.duration": value}', `extra={"app.duration": ${value}}`), true)
      expect(measurement(rejected).diagnostics.some(row => row.code === 'SECURITY_PRIVACY')).toBe(true)
    }
  })
})
