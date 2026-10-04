import { describe, it, expect } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'

const modulePath = '../src/data/labs/security-journey/capstone.lab.js'
const loaded = await import(/* @vite-ignore */ modulePath).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}
  throw error
})
const lab = loaded.securityObservabilityCapstoneLab
function replay(edit = source => source) {
  expect(lab).toBeDefined()
  let run = createBehavioralRun(lab, { attemptId: 'capstone' })
  for (const task of lab.tasks) for (const step of task.solution.steps) {
    const result = applyRunAction(run, step.kind === 'file' ? { type: 'save-file', path: step.path, text: edit(step.content, step.path) } : { type: 'command', line: step.line }, lab)
    expect(result.diagnostics ?? []).toEqual([])
    expect(result.lines?.filter(row => row.kind === 'err') ?? []).toEqual([])
    run = result.run
  }
  return run
}
const done = run => evaluateLab(lab, run).tasks.every(task => task.done)
describe('integrated secure and observed order capstone', () => {
  it('starts every assigned task unfinished with resources and fresh input only', () => {
    expect(lab).toBeDefined()
    const run = createBehavioralRun(lab, { attemptId: 'fresh' })
    expect(run.runtime.messaging.executionReceipts).toEqual([])
    expect(run.runtime.messaging.effects).toEqual({})
    expect(run.runtime.messaging.securityObservability?.telemetry ?? []).toEqual([])
    expect(evaluateLab(lab, deserializeRun(serializeRun(run, lab), lab)).tasks.every(task => !task.done)).toBe(true)
    expect(lab.messagingExercise.commands).toHaveLength(2)
  })
  it('consumes the production reference in a correlated callback, deduplicates, logs safely, computes and restores', () => {
    const run = replay(), state = run.runtime.messaging
    expect(done(run)).toBe(true)
    expect(done(deserializeRun(serializeRun(run, lab), lab))).toBe(true)
    expect(state.executionReceipts.map(row => row.mode)).toEqual(['functions', 'script'])
    expect(state.effects.workByOrder).toEqual({ o1: 1 })
    expect(state.effects.notifications).toEqual({ 'e-o1': { eventId: 'e-o1', orderId: 'o1' } })
    const host = state.executionReceipts[0].measurements
    expect(host.receipts.servicebus.map(row => [row.messageId, row.status])).toEqual([['m1', 'completed'], ['m1-retry', 'completed']])
    const records = host.securityObservability.records, call = records.find(row => row.kind === 'notification-provider')
    expect(records.filter(row => row.kind === 'notification-provider')).toHaveLength(1)
    expect(call).toMatchObject({ statusCode: 202, channel: 'email', configLabel: 'production', invocation: { kind: 'eventgrid' } })
    expect(records.find(row => row.id === call.readId)).toMatchObject({ kind: 'secret-read', configProviderId: call.configProviderId })
    expect(host.securityObservability.telemetry.find(row => row.table === 'AppTraces')).toMatchObject({ Message: 'Notification accepted', Properties: { 'app.order_id': 'o1', 'app.channel': 'email', 'app.status_code': 202 } })
    const query = state.executionReceipts[1].measurements.securityObservability.records.find(row => row.kind === 'telemetry-query')
    expect(query.rows).toEqual([{ Notifications: 1, Failures: 0, MeanMs: 21 }])
    expect(query.inputRowIds).toEqual(state.securityObservability.telemetry.filter(row => row.table === 'AppRequests').map(row => row.id))
    expect(JSON.stringify([run.evidence, state])).not.toMatch(/trainer-demo-key-|private@example.com/)
    const forged = JSON.parse(serializeRun(run, lab))
    forged.runtime.messaging.executionReceipts[1].measurements.securityObservability.records.find(row => row.kind === 'telemetry-query').rows[0].Notifications = 100
    expect(() => deserializeRun(JSON.stringify(forged), lab)).toThrow()
  })
  it.each([
    ['no consumer', source => source.replace('result = send_notification(event.id, data["order_id"], config["Orders:ApiKey"], config["Orders:Channel"])', 'result = {"status_code": 202, "channel": "email"}')],
    ['missing callback span', source => source.replace('with tracer.start_as_current_span("NotifyOrder", context=propagate.extract(data["trace_context"]), kind=SpanKind.CONSUMER, attributes={"app.order_id": data["order_id"]}):', 'if True:')],
    ['missing extraction', source => source.replace('context=propagate.extract(data["trace_context"])', 'context=None')],
    ['no duplicate guard', source => source.replace('if was_processed(order["id"]):', 'if False:')],
    ['literal query result', source => source.replace(/query = .*\n/, 'query = "AppRequests | take 1 | project Notifications=1, Failures=0, MeanMs=21"\n')],
  ])('rejects %s', (_, edit) => { expect(done(replay(edit))).toBe(false) })
  it('rejects an unused in-span load when the consumed provider was loaded outside NotifyOrder', () => {
    const run = replay((source, path) => path !== 'function_app.py' ? source : source.replace(
      /^(    with tracer\.start_as_current_span\("NotifyOrder"[^\n]+\n)(        credential = DefaultAzureCredential\(\)\n        config = load\([^\n]+\n            selects=\[[^\n]+\n)/m,
      (_, span, consumedLoad) => consumedLoad.split('\n').map(line => line.startsWith('    ') ? line.slice(4) : line).join('\n') + span
        + '        unused = load(endpoint="https://ac-orders.azconfig.io", credential=credential, selects=[SettingSelector(key_filter="Orders:Channel", label_filter="production")])\n'))
    const host = run.runtime.messaging.executionReceipts[0].measurements, records = host.securityObservability.records
    const call = records.find(row => row.kind === 'notification-provider'), notify = host.securityObservability.telemetry.find(row => row.Name === 'NotifyOrder')
    expect(call.statusCode).toBe(202)
    expect(host.effects.after.notifications).toEqual({ 'e-o1': { eventId: 'e-o1', orderId: 'o1' } })
    expect(records.filter(row => row.kind === 'config-load')).toHaveLength(2)
    const consumedLoad = records.find(row => row.kind === 'config-load' && row.providerId === call.configProviderId)
    const inSpanLoad = records.find(row => row.kind === 'telemetry-operation' && row.operation === 'load' && row.spanId === notify.Id)
    expect(inSpanLoad).toBeDefined()
    expect(inSpanLoad.recordIds).not.toContain(consumedLoad.id)
    expect(inSpanLoad.recordIds).not.toContain(call.readId)
    expect(evaluateLab(lab, run).tasks.map(task => task.done)).toEqual([false, false])
  })
  it('invalidates saved source and resource change/revert while allowing notes', () => {
    let run = replay()
    run = applyRunAction(run, { type: 'save-file', path: 'README.md', text: 'My notes' }, lab).run
    expect(done(run)).toBe(true)
    const source = run.project.savedFiles['function_app.py']
    for (const text of [source + '\n# edit\n', source]) run = applyRunAction(run, { type: 'save-file', path: 'function_app.py', text }, lab).run
    expect(done(run)).toBe(false)
    run = replay()
    for (const value of ['console', 'email']) run = applyRunAction(run, { type: 'command', line: `az appconfig kv set -n ac-orders --key Orders:Channel --label production --value ${value} --yes` }, lab).run
    expect(evaluateLab(lab, run).tasks.every(task => !task.done)).toBe(true)
  })
})
