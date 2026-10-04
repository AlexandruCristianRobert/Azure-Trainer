import { beforeEach, describe, expect, it } from 'vitest'
import { createSandbox, SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { createEventGridTopic, createEventGridSubscription } from '../src/lib/sandbox/eventgrid.js'
import { applyEventGridOperation } from '../src/lib/messaging/eventgrid.js'
import { parseMessagingProject } from '../src/lib/messaging/python.js'
import { executeMessagingProgram } from '../src/lib/messaging/vm.js'
import { emptyMessagingState } from '../src/lib/messaging/state.js'
import { messagingDependencies } from '../src/lib/messaging/evidence.js'
import { validateSecurityObservabilityState } from '../src/lib/security/state.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { SECURITY_RUNTIME_FILES } from '../src/data/templates/security-python/runtime.js'

// The assertion gives an intentional RED for the absent evaluator, rather than
// failing test collection. Once present, every test runs the actual module.
const kql = await import('../src/lib/observability/kql.js').catch(() => null)
const dataset = [
  { table: 'AppRequests', id: 'req-1', Name: 'NotifyOrder', Success: true, DurationMs: 10, OperationId: 'op-1', Properties: { size: '3.8', label: 'a|b' } },
  { table: 'AppRequests', id: 'req-2', Name: 'NotifyOrder', Success: false, DurationMs: 20, OperationId: 'op-2', Properties: { size: 'bad' } },
  { table: 'AppRequests', id: 'req-3', Name: 'AcceptOrder', Success: true, DurationMs: null, Properties: {} },
  { table: 'AppTraces', id: 'trace-1', Name: 'a|b', Message: 'trace' },
]

beforeEach(() => {
  expect(kql, 'the pure KQL evaluator must exist').not.toBeNull()
  expect(kql.parseQuery).toBeTypeOf('function')
  expect(kql.executeQuery).toBeTypeOf('function')
})

const querySetup = `from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry import trace
from opentelemetry.trace import SpanKind, Status, StatusCode
from training_runtime import query_telemetry, perform_order_work
import logging
configure_azure_monitor(connection_string="InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://ai-orders.training.invalid/", logger_name="orders")
tracer = trace.get_tracer("orders")
logger = logging.getLogger("orders")
`
const querySecurity = { appId: '/training/func-orders', notificationProvider: { id: 'demo', acceptedKeys: [{ id: 'v1', value: 'demo-key-v1' }] } }
function sourceQuery(code, options = {}) {
  const parsed = parseMessagingProject({ 'worker.py': code }, { entry: 'worker.py', profile: options.profile ?? 'security-observability-v1' })
  if (parsed.diagnostics.length) return { diagnostics: parsed.diagnostics, state: emptyMessagingState() }
  return executeMessagingProgram({ program: parsed.program, sandbox: createSandbox(), state: options.state ?? emptyMessagingState(), input: { securityObservability: querySecurity } })
}
function queryLab() {
  return { id: 'saved-kql', engineVersion: 2, contentVersion: 1, capabilities: { messaging: true, securityObservability: true }, manifestId: 'security-python-v1',
    initialProjectFiles: { ...Object.fromEntries(['clients.py', 'producer.py', 'events.py', 'handler.py', 'function_app.py', 'README.md'].map(path => [path, ''])), ...SECURITY_RUNTIME_FILES,
      'host.json': '{}', 'local.settings.json': '{}',
      'worker.py': querySetup + `def main():
    with tracer.start_as_current_span("NotifyOrder", kind=SpanKind.SERVER):
        perform_order_work({"id": "o1"})
    return query_telemetry("AppRequests | summarize Total=count(), MeanMs=avg(DurationMs)")
`,
      'handler.py': querySetup + `def main():
    with tracer.start_as_current_span("NotifyOrder", kind=SpanKind.SERVER):
        pass
`,
      'events.py': querySetup + `def main():
    logger.info("unrelated")
` }, tasks: [{ id: 'query', check: () => true, verification: { scenarioId: 'query', scenarioVersion: 1 },
        dependencies: messagingDependencies({ files: ['worker.py', 'training_runtime.py'] }) }],
    messagingInput: { securityObservability: querySecurity }, messagingExercise: { commands: ['worker.py', 'handler.py', 'events.py'].map(entry => ({ entry, mode: 'script' })),
      tasks: [{ taskId: 'query', entry: 'worker.py', mode: 'script', scenarioId: 'query', scenarioVersion: 1,
        check: m => m.securityObservability.records.some(r => r.kind === 'telemetry-query' && r.query.operators.some(op => op.type === 'summarize') && r.rows[0]?.Total >= 1) }] } }
}

describe('saved-source telemetry queries', () => {
  // Break: source query dispatch is missing or returns canned totals instead of actual exports.
  it('computes fractional aggregates and receipts with actual table export IDs', () => {
    const result = sourceQuery(querySetup + `def main():
    with tracer.start_as_current_span("NotifyOrder", kind=SpanKind.SERVER):
        pass
    with tracer.start_as_current_span("NotifyOrder", kind=SpanKind.SERVER) as span:
        span.set_status(Status(StatusCode.ERROR))
        perform_order_work({"id": "o1"})
    with tracer.start_as_current_span("NotifyOrder", kind=SpanKind.SERVER):
        pass
    return query_telemetry("AppRequests | summarize Total=count(), Failed=countif(Success == false), MeanMs=avg(DurationMs) | extend Rate=100.0 * Failed / Total")
`)
    expect(result.diagnostics).toEqual([])
    expect(result.value.rows).toEqual([{ Total: 3, Failed: 1, MeanMs: 5 / 3, Rate: 100 / 3 }])
    const receipt = result.state.securityObservability.records.at(-1)
    expect(receipt).toMatchObject({ kind: 'telemetry-query', destination: '/training/applicationinsights/ai-orders', generation: 3,
      exportIds: ['so-1', 'so-3', 'so-4'], inputRowIds: ['telemetry-1', 'telemetry-2', 'telemetry-3'], rows: [{ Total: 3, Failed: 1, MeanMs: 5 / 3, Rate: 100 / 3 }] })
    expect(receipt.query.table).toBe('AppRequests')
    expect(receipt.query.operators.map(op => op.type)).toEqual(['summarize', 'extend'])
    expect(validateSecurityObservabilityState(result.state.securityObservability)).toBe(true)
    result.value.rows[0].Total = 99
    expect(receipt.rows[0].Total).toBe(3)
  })
  // Break: input identity uses workspace span Id or filtered rows rather than internal input row IDs.
  it('selects only the queried table before filtering and preserves constant operator lineage', () => {
    const result = sourceQuery(querySetup + `def main():
    logger.info("unrelated")
    with tracer.start_as_current_span("NotifyOrder", kind=SpanKind.SERVER):
        pass
    return query_telemetry("AppRequests | where Success == false | extend Total=3")
`)
    expect(result.diagnostics).toEqual([])
    expect(result.value).toEqual({ rows: [] })
    expect(result.state.securityObservability.records.at(-1)).toMatchObject({ generation: 1, exportIds: ['so-2'], inputRowIds: ['telemetry-2'],
      query: { table: 'AppRequests', operators: [{ type: 'where' }, { type: 'extend' }] }, rows: [] })
  })
  // Break: query execution unnecessarily depends on exporter configuration or fakes empty rows.
  it('queries retained data without exporter setup and computes empty aggregation', () => {
    const result = sourceQuery('from training_runtime import query_telemetry\ndef main():\n    return query_telemetry("AppRequests | summarize Total=count(), MeanMs=avg(DurationMs)")\n')
    expect(result.diagnostics).toEqual([])
    expect(result.value).toEqual({ rows: [{ Total: 0, MeanMs: null }] })
    expect(result.state.securityObservability.records.at(-1)).toMatchObject({ generation: 0, exportIds: [], inputRowIds: [] })
  })
  // Break: unsupported query syntax gets treated as data, or runs unrelated later effects.
  it('rejects malformed query input before later effects and keeps legacy imports closed', () => {
    const result = sourceQuery(querySetup + 'def main():\n    query_telemetry("AppRequests | join AppTraces")\n    perform_order_work({"id": "o1"})\n')
    expect(result.diagnostics[0]?.code).toBe('KQL_UNSUPPORTED')
    expect(result.state.effects.workByOrder).toBeUndefined()
    expect(result.state.securityObservability.records).toEqual([])
    expect(sourceQuery('from training_runtime import query_telemetry\ndef main():\n    return query_telemetry("AppRequests")\n', { profile: 'messaging-v1' }).diagnostics[0]?.code).toBe('MESSAGING_UNSUPPORTED')
  })
  // Break: dynamic invalid KQL retains earlier effects or discards previous commands.
  it('rolls back earlier command effects on invalid dynamic KQL while retaining prior commands', () => {
    const prior = sourceQuery(querySetup + 'def main():\n    logger.info("retained")\n')
    const result = sourceQuery(querySetup + `def main():
    query = "AppRequests | join AppTraces"
    with tracer.start_as_current_span("discard", kind=SpanKind.SERVER):
        perform_order_work({"id": "o1"})
    print("discard")
    return query_telemetry(query)
`, { state: prior.state })
    expect(result.diagnostics[0]?.code).toBe('KQL_UNSUPPORTED')
    expect(result.state).toEqual(prior.state)
    expect(result.trace).toEqual([])
    expect(result.output).toEqual([])
  })
  // Break: query source/result/AST bypasses public privacy guarding before journal persistence.
  it.each(['AppRequests | extend X="demo-key-v1"', 'AppRequests | extend X="private@example.com"', 'AppRequests | project password=Name'])('rejects sensitive query boundaries: %s', query => {
    const result = sourceQuery(`from training_runtime import query_telemetry\ndef main():\n    return query_telemetry('${query}')\n`)
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    expect(result.state.securityObservability.records.map(row => row.kind)).toEqual(['privacy-violation'])
    expect(JSON.stringify(result)).not.toMatch(/demo-key-v1|private@example.com|password/)
  })
  // Break: replay compares snapshots only and admits coordinated result/query/generation tampering.
  it('restores prefix results and rejects changed query receipts or underlying rows', () => {
    const lab = queryLab(), initial = createBehavioralRun(lab, { attemptId: 'restore-query' })
    const first = applyRunAction(initial, { type: 'command', line: 'python worker.py' }, lab)
    expect(first.diagnostics).toEqual([])
    const later = applyRunAction(first.run, { type: 'command', line: 'python handler.py' }, lab)
    expect(later.diagnostics).toEqual([])
    expect(deserializeRun(serializeRun(later.run, lab), lab).attemptId).toBe('restore-query')
    for (const mutate of [r => { r.rows[0].Total = 99 }, r => { r.generation = 99 }, r => { r.exportIds = [] }, r => { r.inputRowIds = ['fake'] },
      r => { r.destination = '/training/other' }, r => { r.query.operators = [] }]) {
      const forged = JSON.parse(serializeRun(later.run, lab))
      mutate(forged.runtime.messaging.securityObservability.records.find(r => r.kind === 'telemetry-query'))
      expect(() => deserializeRun(JSON.stringify(forged), lab)).toThrow()
    }
    const forged = JSON.parse(serializeRun(later.run, lab))
    const alter = value => { for (const row of value.telemetry ?? []) if (row.id === 'telemetry-1') row.DurationMs = 99 }
    alter(forged.runtime.messaging.securityObservability)
    for (const execution of forged.runtime.messaging.executionReceipts) alter(execution.measurements.securityObservability)
    for (const evidence of Object.values(forged.evidence.experimentsById)) alter(evidence.measurements.securityObservability)
    expect(() => deserializeRun(JSON.stringify(forged), lab)).toThrow()
  })
  // Break: coordinated snapshots admit a query containing known credential text.
  it('rejects coordinated safe-shaped query snapshots containing a known secret on restore', () => {
    const lab = queryLab(), first = applyRunAction(createBehavioralRun(lab, { attemptId: 'private-query' }), { type: 'command', line: 'python worker.py' }, lab)
    expect(first.diagnostics).toEqual([])
    const forged = JSON.parse(serializeRun(first.run, lab))
    const query = kql.parseQuery('AppRequests | where Name == "demo-key-v1" | summarize Total=count(), MeanMs=avg(DurationMs)')
    const change = extension => {
      for (const receipt of extension.records.filter(r => r.kind === 'telemetry-query')) {
        receipt.query = query
        receipt.rows = [{ Total: 0, MeanMs: null }]
      }
    }
    change(forged.runtime.messaging.securityObservability)
    for (const execution of forged.runtime.messaging.executionReceipts) change(execution.measurements.securityObservability)
    for (const evidence of Object.values(forged.evidence.experimentsById)) change(evidence.measurements.securityObservability)
    // No evidence remains to fail the authored task predicate independently.
    forged.evidence.experimentsById = {}
    forged.evidence.currentEvidenceByTask = {}
    expect(() => deserializeRun(JSON.stringify(forged), lab)).toThrow()
  })
  // Break: query admission bypasses the byte bound or partially commits the failed receipt.
  it('atomically rejects query receipts when the shared journal byte budget is full', () => {
    const text = `AppRequests | summarize Total=count() | extend Label="${'x'.repeat(4000)}"`
    const result = sourceQuery(`from training_runtime import query_telemetry
def main():
    query = '${text}'
    for attempt in [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]:
        query_telemetry(query)
`)
    expect(result.diagnostics[0]?.code).toBe('MESSAGING_LIMIT')
    const extension = result.state.securityObservability
    expect(extension.records.length).toBeGreaterThan(0)
    expect(extension.records.length).toBeLessThan(20)
    expect(extension.records.every(r => r.kind === 'telemetry-query' && r.rows[0].Total === 0 && r.rows[0].Label === 'x'.repeat(4000))).toBe(true)
    expect(extension.nextId).toBe(extension.records.length + 1)
    expect(new TextEncoder().encode(JSON.stringify(extension)).length).toBeLessThanOrEqual(128 * 1024)
    expect(validateSecurityObservabilityState(extension)).toBe(true)
  })
  // Break: fresh completion survives new relevant exports or unrelated exports stale it.
  it('invalidates query completion on relevant exports while retaining historical receipts', () => {
    const lab = queryLab()
    const first = applyRunAction(createBehavioralRun(lab, { attemptId: 'query-fresh' }), { type: 'command', line: 'python worker.py' }, lab)
    expect(first.diagnostics).toEqual([])
    expect(evaluateLab(lab, first.run).tasks[0].status).toBe('done')
    const unrelated = applyRunAction(first.run, { type: 'command', line: 'python events.py' }, lab)
    expect(evaluateLab(lab, unrelated.run).tasks[0].status).toBe('done')
    const relevant = applyRunAction(unrelated.run, { type: 'command', line: 'python handler.py' }, lab)
    expect(evaluateLab(lab, relevant.run).tasks[0].status).toBe('needs-verification')
    const restored = deserializeRun(serializeRun(relevant.run, lab), lab)
    const repeated = applyRunAction(restored, { type: 'command', line: 'python worker.py' }, lab)
    expect(repeated.diagnostics).toEqual([])
    expect(evaluateLab(lab, repeated.run).tasks[0].status).toBe('done')
    expect(repeated.run.runtime.messaging.securityObservability.records.filter(r => r.kind === 'telemetry-query').map(r => r.rows[0].Total)).toEqual([1, 3])
  })
  // Break: saved query source can change/revert without invalidating current completion.
  it('invalidates query completion on saved-source change and revert', () => {
    const lab = queryLab(), first = applyRunAction(createBehavioralRun(lab, { attemptId: 'query-edit' }), { type: 'command', line: 'python worker.py' }, lab)
    expect(evaluateLab(lab, first.run).tasks[0].done).toBe(true)
    const text = first.run.project.savedFiles['worker.py']
    const changed = applyRunAction(first.run, { type: 'save-file', path: 'worker.py', text: text + '\n# changed\n' }, lab)
    expect(changed.diagnostics).toEqual([])
    expect(evaluateLab(lab, changed.run).tasks[0].status).toBe('needs-verification')
    const reverted = applyRunAction(changed.run, { type: 'save-file', path: 'worker.py', text }, lab)
    expect(evaluateLab(lab, reverted.run).tasks[0].status).toBe('needs-verification')
  })
  // Break: constants or returned literals masquerade as query aggregation evidence.
  it('requires executed aggregate operator lineage for aggregation completion', () => {
    for (const expression of ['{"rows": [{"Total": 1}]}', 'query_telemetry("AppRequests | extend Total=1 | project Total")']) {
      const lab = queryLab()
      lab.initialProjectFiles['worker.py'] = querySetup + `def main():
    with tracer.start_as_current_span("NotifyOrder", kind=SpanKind.SERVER):
        pass
    return ${expression}
`
      const result = applyRunAction(createBehavioralRun(lab, { attemptId: 'constant-query' }), { type: 'command', line: 'python worker.py' }, lab)
      expect(result.diagnostics).toEqual([])
      expect(evaluateLab(lab, result.run).tasks[0].done).toBe(false)
      expect(Object.values(result.run.evidence.experimentsById).at(-1).outcome).toBe('failed')
    }
  })
  // Break: fractional KQL result support broadens ordinary Messaging's JSON contract.
  it('keeps finite fractional public data gated to the explicit security profile', () => {
    const code = 'import json\ndef main():\n    return json.loads("1.5")\n'
    expect(sourceQuery(code).value).toBe(1.5)
    expect(sourceQuery(code, { profile: 'messaging-v1' }).diagnostics[0]?.code).toBe('MESSAGING_RUNTIME')
  })
  // Break: aborted callbacks retain query receipts/effects, or erase completed siblings/privacy audit.
  it('rolls back aborted Function query receipts while retaining sibling completion and privacy category', () => {
    const lab = queryLab(), appId = `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-kql/providers/Microsoft.Web/sites/func-kql`
    lab.messagingInput.securityObservability = { ...querySecurity, appId }
    lab.messagingInput.functions = { appId }
    lab.messagingExercise = { commands: [{ entry: 'function_app.py', mode: 'functions' }], tasks: [] }
    lab.tasks = []
    lab.initialProjectFiles['function_app.py'] = querySetup + `import azure.functions as func
app = func.FunctionApp()
@app.function_name(name="NotifyOrder")
@app.event_grid_trigger(arg_name="event")
def notify(event: func.EventGridEvent):
    order = event.get_json()
    perform_order_work({"id": order["order_id"]})
    query_telemetry("AppRequests | summarize Total=count()")
    if order["order_id"] == "o2":
        query_telemetry('AppRequests | extend X="demo-key-v1"')
`
    lab.initialProjectFiles['host.json'] = JSON.stringify({ version: '2.0', telemetryMode: 'OpenTelemetry' })
    lab.initialProjectFiles['local.settings.json'] = JSON.stringify({ IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'python', AzureWebJobsStorage: 'UseDevelopmentStorage=true',
      APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://ai-orders.training.invalid/', PYTHON_APPLICATIONINSIGHTS_ENABLE_TELEMETRY: 'false' } })
    lab.resourceSeed = () => {
      let sandbox = createSandbox()
      for (const line of ['az group create -n rg-kql -l westeurope', 'az storage account create -g rg-kql -n stkqlorders',
        'az functionapp create -g rg-kql -n func-kql --storage-account stkqlorders --flexconsumption-location westeurope --runtime python --runtime-version 3.12']) {
        const result = runLine(sandbox, line)
        expect(result.lines.filter(line => line.kind === 'err')).toEqual([])
        sandbox = result.sandbox
      }
      return createEventGridSubscription(createEventGridTopic(sandbox, { resourceGroup: 'rg-kql', name: 'evgt-kql' }).sandbox,
        { resourceGroup: 'rg-kql', topicName: 'evgt-kql', name: 'notify', endpointType: 'AzureFunction', endpoint: `${appId}/functions/NotifyOrder` }).sandbox
    }
    lab.initializeSimulation = run => ({ sandbox: run.sandbox, artifacts: run.artifacts, runtime: { ...run.runtime, messaging: applyEventGridOperation(run.runtime.messaging, run.sandbox,
      { kind: 'publish', target: { resourceGroup: 'rg-kql', topic: 'evgt-kql' }, events: ['1', '2'].map(id => ({ id: `e${id}`, subject: `/orders/o${id}`, eventType: 'OrderCompleted', dataVersion: '1.0', data: { order_id: `o${id}` } })) }).state }, nextSequence: run.nextSequence })
    const result = applyRunAction(createBehavioralRun(lab, { attemptId: 'callback-query' }), { type: 'command', line: 'func start' }, lab)
    expect(result.diagnostics[0]?.code).toBe('SECURITY_PRIVACY')
    const state = result.run.runtime.messaging
    expect(state.effects.workByOrder).toEqual({ o1: 1 })
    expect(state.securityObservability.records.filter(r => r.kind === 'telemetry-query').map(r => r.rows)).toEqual([[{ Total: 0 }]])
    expect(state.securityObservability.records.filter(r => r.kind === 'privacy-violation')).toHaveLength(1)
    expect(state.securityObservability.records.filter(r => r.kind === 'privacy-violation')[0].category).toBe('telemetry')
    expect(state.eventGrid.deliveries.map(r => r.status)).toEqual(['delivered', 'pending'])
    expect(JSON.stringify({ diagnostics: result.diagnostics, records: state.securityObservability, effects: state.effects })).not.toContain('demo-key-v1')
    expect(deserializeRun(serializeRun(result.run, lab), lab).attemptId).toBe('callback-query')
  })
})

const run = (text, rows = dataset, limits) => kql.executeQuery(kql.parseQuery(text), rows, limits)

describe('bounded KQL over actual telemetry', () => {
  it('computes grouped counts, predicates, averages, and derived arithmetic', () => {
    expect(run('AppRequests | where Name == "NotifyOrder" | summarize Total=count(), Failed=countif(Success == false), MeanMs=avg(DurationMs) by Name | extend FailureRate=100.0 * Failed / Total').rows)
      .toEqual([{ Name: 'NotifyOrder', Total: 2, Failed: 1, MeanMs: 15, FailureRate: 50 }])
  })

  it('recomputes from changed input without modifying source rows', () => {
    const before = structuredClone(dataset)
    expect(run('AppRequests | summarize Total=sum(DurationMs)').rows).toEqual([{ Total: 30 }])
    const changed = structuredClone(dataset)
    changed[0].DurationMs = 40
    expect(run('AppRequests | summarize Total=sum(DurationMs)', changed).rows).toEqual([{ Total: 60 }])
    expect(dataset).toEqual(before)
  })

  it('keeps quoted pipes and escaped quotes inside literal strings', () => {
    expect(run('AppRequests | where Name == "a|b" | project Name').rows).toEqual([])
    expect(run('AppTraces | where Name == "a|b" | project Name').rows).toEqual([{ Name: 'a|b' }])
    expect(run('AppTraces | extend Text="a\\\"|b", Other=\'it\\\'s|ok\' | project Text, Other').rows)
      .toEqual([{ Text: 'a"|b', Other: "it's|ok" }])
  })

  it('preserves symbol and keyword strings as literals instead of grammar', () => {
    const literals = ['+', '-', '(', ')', '|', ',', '[', ']', '=', '==', '*', 'and', 'or', 'by', 'asc', 'desc', 'true', 'false', 'null']
    const actual = literals.map(text => {
      try { return run(`AppRequests | take 1 | extend Text="${text}" | project Text`).rows }
      catch (error) { return error.message }
    })
    expect(actual).toEqual(literals.map(Text => [{ Text }]))
    expect(run('AppRequests | where Properties["label"] == "a|b" | project Text=tostring("("), Plus="+"').rows)
      .toEqual([{ Text: '(', Plus: '+' }])
  })

  it('rejects quoted pipeline, comparison, keyword, and assignment grammar tokens', () => {
    const queries = [
      'AppRequests "|" take 1',
      'AppRequests | where 1 "==" 1',
      'AppRequests | where true "and" true',
      'AppRequests | where false "or" true',
      'AppRequests | extend X "=" 1',
      'AppRequests | project X "=" Name',
      'AppRequests | project Name "," Success',
      'AppRequests | summarize N "=" count()',
      'AppRequests | summarize count "(" ")"',
      'AppRequests | summarize N=count() "by" Name',
      'AppRequests | order "by" Name',
      'AppRequests | order by Name "asc"',
      'AppRequests | order by Name "desc"',
      'AppRequests | project X=tostring "(" Name ")"',
      'AppRequests | project X=Properties "[" "label" "]"',
      'AppRequests | project X=Properties["label" "]"',
      'AppRequests | where "(" true ")"',
    ]
    const accepted = queries.filter(query => {
      try { kql.parseQuery(query); return true }
      catch { return false }
    })
    expect(accepted).toEqual([])
  })

  it('rejects quoted signs inside numeric conversion text', () => {
    expect(run('AppRequests | take 1 | project N=toint(\'"+"3\'), D=todouble(\'"-"3\')').rows)
      .toEqual([{ N: null, D: null }])
  })

  it('applies precedence, boolean predicates, property access, and typed conversions', () => {
    expect(run('AppRequests | where Success == false or (Success == true and DurationMs >= 10 and DurationMs < 20) | project Name, N=toint(Properties["size"]), D=todouble(Properties["size"]), S=tostring(Success), Value=2+3*4-8/2').rows)
      .toEqual([
        { Name: 'NotifyOrder', N: 3, D: 3.8, S: 'true', Value: 10 },
        { Name: 'NotifyOrder', N: null, D: null, S: 'false', Value: 10 },
      ])
  })

  it('uses null for missing fields, invalid conversions, and guarded arithmetic', () => {
    expect(run('AppRequests | take 1 | project Missing, Absent=Properties["nope"], Empty=tostring(Missing), Bad=toint("3oops"), Blank=todouble(""), Zero=1/0, NullMath=Missing+1, Huge=1e308*1e308').rows)
      .toEqual([{ Missing: null, Absent: null, Empty: '', Bad: null, Blank: null, Zero: null, NullMath: null, Huge: null }])
    expect(run('AppRequests | where Missing == null').rows).toEqual([])
    expect(run('AppRequests | where Missing != 1').rows).toEqual([])
  })

  it('implements null boolean truth tables and exact numeric comparison', () => {
    expect(run('AppRequests | where Missing or true | summarize N=count()').rows).toEqual([{ N: 3 }])
    expect(run('AppRequests | where Missing and false').rows).toEqual([])
    expect(run('AppRequests | where 10 == "10"').rows).toEqual([])
    expect(run('AppRequests | where 10 != "10" | summarize N=count()').rows).toEqual([{ N: 3 }])
  })

  it('calculates every aggregate while ignoring nonnumeric sum/avg/min/max values', () => {
    expect(run('AppRequests | summarize count(), countif(Success == true), sum(DurationMs), avg(DurationMs), min(DurationMs), max(DurationMs)').rows)
      .toEqual([{ count_: 3, countif_: 2, sum_DurationMs: 30, avg_DurationMs: 15, min_DurationMs: 10, max_DurationMs: 20 }])
    expect(run('AppRequests | summarize S=sum(Properties["size"]), A=avg(Missing), L=min(Missing), H=max(Missing)').rows)
      .toEqual([{ S: 0, A: null, L: null, H: null }])
  })

  it('gives an ungrouped empty count zero and empty average null, but no empty groups', () => {
    expect(run('AppRequests | summarize N=count(), F=countif(Success == false), S=sum(DurationMs), A=avg(DurationMs), L=min(DurationMs), H=max(DurationMs)', []).rows)
      .toEqual([{ N: 0, F: 0, S: 0, A: null, L: null, H: null }])
    expect(run('AppRequests | summarize N=count() by Name', []).rows).toEqual([])
  })

  it('groups by multiple expressions without conflating string and null keys', () => {
    const rows = [
      { table: 'AppMetrics', Name: 'n', Value: null },
      { table: 'AppMetrics', Name: 'n', Value: 'null' },
      { table: 'AppMetrics', Name: 'n' },
    ]
    expect(run('AppMetrics | summarize N=count() by Name, Kind=Value', rows).rows)
      .toEqual([{ Name: 'n', Kind: null, N: 2 }, { Name: 'n', Kind: 'null', N: 1 }])
  })

  it('sorts by multiple keys with stable ties, takes rows, and evaluates extend assignments sequentially', () => {
    expect(run('AppRequests | extend A=DurationMs+1, B=A*2 | order by Success asc, DurationMs desc | take 2 | project Name, A, B').rows)
      .toEqual([{ Name: 'NotifyOrder', A: 21, B: 42 }, { Name: 'NotifyOrder', A: 11, B: 22 }])
    expect(run('AppRequests | order by DurationMs asc | project DurationMs').rows)
      .toEqual([{ DurationMs: 10 }, { DurationMs: 20 }, { DurationMs: null }])
    expect(run('AppRequests | order by DurationMs | take 1 | project DurationMs').rows).toEqual([{ DurationMs: 20 }])
    expect(run('AppRequests | take 0').rows).toEqual([])
  })

  it('selects each exact supported table and excludes internal metadata by default', () => {
    for (const table of ['AppRequests', 'AppDependencies', 'AppExceptions', 'AppTraces', 'AppMetrics']) {
      const rows = [{ table, id: 'internal', generation: 2, destinationId: 'ws', Name: table }, { table: 'unrelated', Name: 'bad' }]
      expect(run(table, rows).rows).toEqual([{ Name: table }])
      expect(run(`${table} | project id, table`, rows).rows).toEqual([{ id: 'internal', table }])
    }
  })

  it('retains frozen parsed operator lineage and input IDs despite empty projections', () => {
    const ast = kql.parseQuery('AppRequests | summarize N=count() | project N')
    const result = kql.executeQuery(ast, dataset)
    expect(result.lineage.table).toBe('AppRequests')
    expect(result.lineage.inputRowIds).toEqual(['req-1', 'req-2', 'req-3'])
    expect(result.lineage.operators.map(item => item.type)).toEqual(['summarize', 'project'])
    expect(Object.isFrozen(ast.operators[0])).toBe(true)
    const changed = structuredClone(ast)
    changed.operators[0].type = 'extend'
    expect(() => kql.executeQuery(changed, dataset)).toThrow(/AST|query/i)
    expect(run('AppRequests | extend N=3').lineage.operators.map(item => item.type)).toEqual(['extend'])
  })

  it('rejects malformed, unsupported, or trailing input at parse time', () => {
    for (const query of [
      '', 'AppRequests |', 'AppRequests || take 1', 'AppRequests | where',
      'AppRequests | project', 'AppRequests | extend X=', 'AppRequests | summarize',
      'AppRequests | take -1', 'AppRequests | take 1.5', 'AppRequests | take 1 junk',
      'AppRequests | where Name == "unfinished', 'AppRequests | where DurationMs >',
      'AppRequests | project Name,', 'AppRequests | order Name',
      'AppRequests | order by', 'AppRequests | summarize X=count(DurationMs)',
      'AppRequests | summarize X=avg()', 'AppRequests | summarize X=percentile(DurationMs,95)',
      'AppRequests | join AppTraces', 'AppRequests | union AppTraces',
      'workspace("other").AppRequests', 'Other | take 1', 'apprequests',
      'AppRequests | where matches_regex(Name,".*")', 'AppRequests | evaluate plugin()',
      'AppRequests | where globalThis.fetch("https://example.org")',
      'AppRequests | project Properties.__proto__', 'AppRequests | project x=Properties[Name]',
      'AppRequests | project Name; AppTraces', 'AppRequests | where 1e999 > 1',
      'AppRequests | extend X=1, X=2', 'AppRequests | summarize N=count() by N=Name',
    ]) expect(() => kql.parseQuery(query), query).toThrow()
  })

  it('bounds source bytes, operator count, expression nesting, and input/output rows', () => {
    expect(() => kql.parseQuery(`AppRequests | extend X="${'x'.repeat(16384)}"`)).toThrow(/limit/i)
    expect(() => kql.parseQuery(`AppRequests | extend X="${'é'.repeat(8200)}"`)).toThrow(/limit/i)
    expect(() => kql.parseQuery(`AppRequests ${'| take 1 '.repeat(17)}`)).toThrow(/limit/i)
    expect(() => kql.parseQuery(`AppRequests | where ${'('.repeat(40)}true${')'.repeat(40)}`)).toThrow(/limit/i)
    expect(() => run('AppRequests', Array.from({ length: 501 }, () => ({ table: 'AppRequests' })))).toThrow(/limit/i)
    const rows = Array.from({ length: 201 }, (_, index) => ({ table: 'AppRequests', DurationMs: index }))
    expect(() => run('AppRequests', rows)).toThrow(/limit/i)
    expect(run('AppRequests | take 200', rows).rows).toHaveLength(200)
    expect(() => run('AppRequests', dataset, { maxInputRows: 3 })).toThrow(/limit/i)
    expect(() => run('AppRequests', dataset, { maxOutputRows: 2 })).toThrow(/limit/i)
    expect(() => run('AppRequests', rows, { maxOutputRows: 500 })).toThrow(/limit/i)
    expect(() => run('AppRequests', dataset, { maxOutputRows: -1 })).toThrow(/limit/i)
  })

  it('does not alias nested output data or read inherited object properties', () => {
    const rows = [{ table: 'AppRequests', Properties: { item: ['a'] } }]
    const output = run('AppRequests | project Properties', rows).rows
    output[0].Properties.item.push('b')
    expect(rows[0].Properties.item).toEqual(['a'])
    expect(run('AppRequests | project X=Properties["constructor"]', rows).rows).toEqual([{ X: null }])
    expect(() => run('AppRequests | project __proto__=Name')).toThrow()
    expect(() => run('AppRequests', null)).toThrow(/dataset/i)
  })
})
