import { describe, it, expect } from 'vitest'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { createResourceGroup, createNamespace, createQueue } from '../src/lib/sandbox/ops.js'
import { createStorageAccount, createFunctionApp } from '../src/lib/sandbox/functions.js'
import { SUBSCRIPTION_ID } from '../src/lib/sandbox/model.js'
import { messagingDependencies } from '../src/lib/messaging/evidence.js'
import { SERVICEBUS_SOLUTION_FILES } from '../src/data/templates/messaging-python/servicebus.js'
import { HTTP_RUNTIME_FILES } from '../src/data/templates/http-functions-python/runtime.js'
import { validHttpJournal } from '../src/lib/http-functions/evidence.js'

const target = { resourceGroup: 'rg-messaging', namespace: 'sb-orders', queue: 'orders' }
const appId = `/subscriptions/${SUBSCRIPTION_ID}/resourcegroups/rg-messaging/providers/microsoft.web/sites/func-orders`.toLowerCase()
const prefix = `import json
import os
import azure.functions as func
from order_store import OrderStatusRepository
from azure.servicebus import ServiceBusMessage
from clients import bus
app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)
store = OrderStatusRepository()
`
const source = prefix + `@app.route(route="orders/{id}", methods=["GET"])
def get_order(req: func.HttpRequest) -> func.HttpResponse:
    record = store.get(req.route_params["id"])
    if record is None:
        return func.HttpResponse("not found", status_code=404)
    return func.HttpResponse(json.dumps({"id":record.id,"status":record.status}), mimetype="application/json")
@app.route(route="orders", methods=["POST"])
def post_order(req: func.HttpRequest) -> func.HttpResponse:
    order = req.get_json()
    record = store.get(order["id"])
    if record is not None:
        if record.region != order["region"] or record.quantity != order["quantity"]:
            return func.HttpResponse("conflict", status_code=409)
        return func.HttpResponse(json.dumps({"id":record.id,"status":record.status}), headers={"Location":"/api/orders/" + order["id"]})
    with bus.get_queue_sender(queue_name="orders") as sender:
        sender.send_messages(ServiceBusMessage(json.dumps(order), message_id=order["id"]))
    return func.HttpResponse("accepted", status_code=202, headers={"Location":"/api/orders/" + order["id"]})
`
function fixture(code = source) {
  const lab = { id: 'engine-http', engineVersion: 2, contentVersion: 1, manifestId: 'http-functions-python-v1',
    capabilities: { messaging: true, httpFunctions: true },
    initialProjectFiles: { ...SERVICEBUS_SOLUTION_FILES, ...HTTP_RUNTIME_FILES, 'function_app.py': code,
      'local.settings.json': JSON.stringify({ IsEncrypted: false, Values: { FUNCTIONS_WORKER_RUNTIME: 'python', AzureWebJobsStorage: 'UseDevelopmentStorage=true', ENVIRONMENT: 'local', ServiceBusConnection__fullyQualifiedNamespace: 'sb-orders.servicebus.windows.net' } }) },
    messagingInput: { httpFunctions: { appId, target, functionKeys: [{ id: 'default', value: 'demo-http-private-key' }] } },
    resourceSeed(sandbox) {
      sandbox = createResourceGroup(sandbox, { name: target.resourceGroup, location: 'westeurope' }).sandbox
      sandbox = createNamespace(sandbox, { resourceGroup: target.resourceGroup, name: target.namespace }).sandbox
      sandbox = createQueue(sandbox, { ...target, name: target.queue }).sandbox
      sandbox = createStorageAccount(sandbox, { resourceGroup: target.resourceGroup, name: 'sthttporders' }).sandbox
      return createFunctionApp(sandbox, { resourceGroup: target.resourceGroup, name: 'func-orders', storageAccount: 'sthttporders', runtime: 'python', runtimeVersion: '3.12' }).sandbox
    },
    messagingExercise: { commands: [{ entry: 'function_app.py', mode: 'http-handler' }, { entry: 'worker.py', mode: 'script' }],
      tasks: [{ taskId: 'http', scenarioId: 'http-request', scenarioVersion: 1, entry: 'function_app.py', mode: 'http-handler',
        check: m => m.httpFunctions?.requests.some(r => r.response.statusCode === 200) === true }] },
    tasks: [{ id: 'http', check: () => true, verification: { scenarioId: 'http-request', scenarioVersion: 1 },
      dependencies: messagingDependencies({ files: ['function_app.py', 'clients.py', ...Object.keys(HTTP_RUNTIME_FILES), 'host.json', 'local.settings.json'],
        resources: { app: sb => sb.functionApps, bus: sb => sb.namespaces, storage: sb => sb.storageAccounts, roles: sb => sb.roleAssignments } }) }],
  }
  return { lab, run: createBehavioralRun(lab, { attemptId: 'http-attempt' }) }
}
const command = (f, line) => { const result = applyRunAction(f.run, { type: 'command', line }, f.lab); f.run = result.run; return result }
const post = (f, quantity = 2, endpoint = 'http://localhost:7071') => command(f, `curl -X POST -H "Content-Type: application/json" -d '{"id":"o1","region":"EU","quantity":${quantity}}' ${endpoint}/api/orders`)
const save = (f, path, text) => { f.run = applyRunAction(f.run, { type: 'save-file', path, text }, f.lab).run }

describe('captured HTTP commands and authoritative evidence', () => {
  it('captures a local host, reads actual 404/pending/processed state and enforces source-owned retries', () => {
    const f = fixture()
    expect(command(f, 'func start').diagnostics).toEqual([])
    const missing = command(f, 'curl -i http://localhost:7071/api/orders/o1')
    expect(missing.diagnostics).toEqual([])
    expect(missing.httpResponse?.statusCode).toBe(404)
    expect(post(f).httpResponse?.statusCode).toBe(202)
    expect(command(f, 'curl http://localhost:7071/api/orders/o1').httpResponse?.body).toContain('pending')
    expect(post(f).httpResponse?.statusCode).toBe(200)
    expect(post(f, 3).httpResponse?.statusCode).toBe(409)
    expect(f.run.runtime.messaging.httpFunctions.accepted).toHaveLength(1)
    expect(command(f, 'python worker.py').diagnostics).toEqual([])
    expect(command(f, 'curl http://localhost:7071/api/orders/o1').httpResponse?.body).toContain('processed')
    expect(deserializeRun(serializeRun(f.run), f.lab).attemptId).toBe('http-attempt')
  })
  it('executes saved captures and invalidates source change/revert until recaptured and requested', () => {
    const f = fixture(prefix + '@app.route(route="health", methods=["GET"])\ndef health(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse("old")\n')
    command(f, 'func start'); command(f, 'curl http://localhost:7071/api/health')
    expect(evaluateLab(f.lab, f.run).tasks[0].done).toBe(true)
    const old = f.run.project.savedFiles['function_app.py']
    save(f, 'function_app.py', old.replace('"old"', '"new"'))
    expect(command(f, 'curl http://localhost:7071/api/health').httpResponse?.body).toBe('old')
    expect(evaluateLab(f.lab, f.run).tasks[0].done).toBe(false)
    save(f, 'function_app.py', old)
    expect(evaluateLab(f.lab, f.run).tasks[0].done).toBe(false)
    command(f, 'func start'); command(f, 'curl http://localhost:7071/api/health')
    expect(evaluateLab(f.lab, f.run).tasks[0].done).toBe(true)
  })
  it('reads current published settings, snapshots local settings, and authorizes before effects', () => {
    const f = fixture(prefix + '@app.route(route="environment", methods=["GET"], auth_level=func.AuthLevel.FUNCTION)\ndef environment(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse(os.getenv("ENVIRONMENT", "unset"))\n')
    expect(command(f, 'func azure functionapp publish wrong-app').diagnostics.length).toBe(1)
    expect(command(f, 'func azure functionapp publish func-orders').diagnostics).toEqual([])
    expect(command(f, 'curl https://func-orders.azurewebsites.net/api/environment').httpResponse.statusCode).toBe(401)
    expect(command(f, 'curl -H "x-functions-key: incorrect" https://func-orders.azurewebsites.net/api/environment').httpResponse.statusCode).toBe(401)
    expect(command(f, 'curl -H "x-functions-key: demo-http-private-key" https://func-orders.azurewebsites.net/api/environment').httpResponse.body).toBe('unset')
    expect(command(f, 'az functionapp config appsettings set -g rg-messaging -n func-orders --settings ENVIRONMENT=published').diagnostics).toEqual([])
    expect(command(f, 'curl -H "x-functions-key: demo-http-private-key" https://func-orders.azurewebsites.net/api/environment').httpResponse.body).toBe('published')
    command(f, 'func start')
    expect(command(f, 'curl http://localhost:7071/api/environment').httpResponse.body).toBe('local')
    save(f, 'local.settings.json', f.run.project.savedFiles['local.settings.json'].replace('"local"', '"changed"'))
    expect(command(f, 'curl http://localhost:7071/api/environment').httpResponse.body).toBe('local')
    const publicData = JSON.stringify(f.run.runtime.messaging)
    expect(publicData).not.toContain('demo-http-private-key')
    const denied = f.run.runtime.messaging.executionReceipts.filter(row => row.measurements.httpFunctions?.requests[0]?.authorization === 'denied')
    expect(denied.every(row => row.measurements.httpFunctions.invocations[0].reads.length === 0)).toBe(true)
  })
  it('keeps an accepted SDK send after handler error so retry reuses actual work', () => {
    const f = fixture(source.replace('return func.HttpResponse("accepted", status_code=202, headers={"Location":"/api/orders/" + order["id"]})', 'raise ValueError("response lost")'))
    command(f, 'func start')
    expect(post(f).httpResponse.statusCode).toBe(503)
    expect(f.run.runtime.messaging.httpFunctions.accepted).toHaveLength(1)
    expect(post(f).httpResponse.statusCode).toBe(200)
    expect(Object.values(f.run.runtime.messaging.entities)[0].messages).toHaveLength(1)
  })
  it('flushes staged output only on normal success and leaves failed flush unaccepted', () => {
    const binding = prefix + `@app.route(route="orders", methods=["POST"])
@app.service_bus_queue_output(arg_name="output", queue_name="orders", connection="ServiceBusConnection")
def submit(req: func.HttpRequest, output: func.Out[str]) -> func.HttpResponse:
    output.set(json.dumps(req.get_json()))
    return func.HttpResponse("accepted", status_code=202)
`
    const f = fixture(binding)
    command(f, 'func start')
    expect(post(f).httpResponse.statusCode).toBe(202)
    expect(f.run.runtime.messaging.httpFunctions.accepted).toHaveLength(1)
    expect(Object.values(f.run.runtime.messaging.entities)[0].messages[0].status).toBe('active')
    const fail = fixture(binding)
    command(fail, 'func start')
    command(fail, 'az servicebus queue update -g rg-messaging --namespace-name sb-orders -n orders --status SendDisabled')
    expect(post(fail).httpResponse.statusCode).toBe(503)
    expect(fail.run.runtime.messaging.httpFunctions.accepted).toEqual([])
    expect(Object.values(fail.run.runtime.messaging.entities).flatMap(entity => entity.messages)).toEqual([])
    const throwing = fixture(binding.replace('return func.HttpResponse("accepted", status_code=202)', 'raise ValueError("stop")'))
    command(throwing, 'func start')
    expect(post(throwing).httpResponse.statusCode).toBe(503)
    expect(throwing.run.runtime.messaging.httpFunctions.accepted).toEqual([])
  })
  it('rejects unsupported intent and models 404/405 without effects', () => {
    const f = fixture()
    command(f, 'func start')
    for (const line of ['curl --silent http://localhost:7071/api/orders/o1', 'curl https://external.example/api/orders',
      'curl -H "x: one" -H "X: two" http://localhost:7071/api/orders', 'curl https://func-orders.azurewebsites.net/api/orders?code=demo-http-private-key']) {
      expect(command(f, line).diagnostics.length).toBe(1)
    }
    expect(command(f, 'curl http://localhost:7071/api/orders').httpResponse).toEqual({ statusCode: 405, headers: { allow: 'POST' }, body: 'Method not allowed.' })
    expect(command(f, 'curl http://localhost:7071/api/missing').httpResponse.statusCode).toBe(404)
    expect(f.run.runtime.messaging.httpFunctions.accepted).toEqual([])
  })
  it('retains history, rejects seventeenth capture, and ignores README edits for freshness', () => {
    const f = fixture(prefix + '@app.route(route="health", methods=["GET"])\ndef health(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse("ok")\n')
    command(f, 'func start'); command(f, 'curl http://localhost:7071/api/health')
    save(f, 'README.md', 'Unrelated notes')
    expect(evaluateLab(f.lab, f.run).tasks[0].done).toBe(true)
    for (let i = 1; i < 16; i++) expect(command(f, 'func start').diagnostics).toEqual([])
    expect(command(f, 'func start').diagnostics[0].code).toBe('HTTP_LIMIT')
    expect(f.run.runtime.messaging.httpFunctions.localHosts).toHaveLength(16)
    expect(deserializeRun(serializeRun(f.run), f.lab)).toBeTruthy()
    expect(evaluateLab(f.lab, f.run).tasks[0].done).toBe(false)
    const rewound = structuredClone(f.run)
    rewound.runtime.messaging.httpFunctions.currentLocal[appId] = rewound.runtime.messaging.httpFunctions.localHosts[0].id
    expect(() => deserializeRun(JSON.stringify(rewound), f.lab)).toThrow()
  })
  it('does not credit unused reads and rejects response, auth, acceptance and crossed-command mutation', () => {
    const f = fixture()
    command(f, 'func start'); post(f); command(f, 'curl http://localhost:7071/api/orders/o1')
    const mutations = [
      state => { state.httpFunctions.requests[0].response.statusCode = 200 },
      state => { state.httpFunctions.requests[0].authorization = 'granted' },
      state => { state.httpFunctions.accepted[0].order.quantity = 3 },
      state => { state.httpFunctions.requests[1].beforeNextId = 1 },
      state => { state.executionReceipts.at(-1).measurements.httpFunctions.invocations[0].consumedFields[0].readId = 'http-read-99' },
      state => { state.httpFunctions.requests[1].sendReceiptIds = [...state.httpFunctions.requests[0].sendReceiptIds] },
      state => { state.httpFunctions.localHosts[0].routes[0].authLevel = 'function'; state.executionReceipts[0].measurements.httpFunctions.captures[0].routes[0].authLevel = 'function' },
    ]
    for (const mutate of mutations) {
      const altered = structuredClone(f.run); mutate(altered.runtime.messaging)
      expect(validHttpJournal(altered.runtime.messaging, f.lab.messagingInput.httpFunctions, altered.sandbox)).toBe(false)
      expect(() => deserializeRun(JSON.stringify(altered), f.lab)).toThrow()
    }
    save(f, 'function_app.py', prefix + '@app.route(route="orders/{id}", methods=["GET"])\ndef get_order(req: func.HttpRequest) -> func.HttpResponse:\n    record = store.get(req.route_params["id"])\n    return func.HttpResponse(\'{"id":"o1","status":"pending"}\')\n')
    command(f, 'func start'); command(f, 'curl http://localhost:7071/api/orders/o1')
    const invocation = f.run.runtime.messaging.executionReceipts.at(-1).measurements.httpFunctions.invocations[0]
    expect(invocation.reads).toHaveLength(1)
    expect(invocation.consumedReadIds).toEqual([])
  })
  it('anchors found:false to the real lookup boundary before its own send', () => {
    const f = fixture(); command(f, 'func start'); post(f)
    const receipt = f.run.runtime.messaging.executionReceipts.at(-1), m = receipt.measurements.httpFunctions
    expect(m.invocations[0].reads[0].atNextId).toBe(m.requests[0].beforeNextId)
    const altered = structuredClone(f.run), last = altered.runtime.messaging.executionReceipts.at(-1)
    last.measurements.httpFunctions.invocations[0].reads[0].atNextId = Number(last.id.split('-').at(-1))
    expect(validHttpJournal(altered.runtime.messaging, f.lab.messagingInput.httpFunctions, altered.sandbox)).toBe(false)
    expect(() => deserializeRun(JSON.stringify(altered), f.lab)).toThrow()
  })
  it('guards known demo keys in ordinary worker output and diagnostics', () => {
    const f = fixture(); command(f, 'func start')
    save(f, 'worker.py', 'def main():\n    print("demo-http-private-key")\n')
    const printed = command(f, 'python worker.py')
    expect(printed.diagnostics[0]?.code).toBe('HTTP_PRIVACY')
    expect(JSON.stringify(printed.lines)).not.toContain('demo-http-private-key')
    save(f, 'worker.py', 'def main():\n    raise ValueError("demo-http-private-key")\n')
    const raised = command(f, 'python worker.py')
    expect(JSON.stringify(raised.diagnostics)).not.toContain('demo-http-private-key')
  })
  it('invalidates resource change/revert, rejects missing app and retains SDK send on oversized response', () => {
    const f = fixture(prefix + '@app.route(route="health", methods=["GET"])\ndef health(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse("ok")\n')
    command(f, 'func start'); command(f, 'curl http://localhost:7071/api/health')
    command(f, 'az functionapp config appsettings set -g rg-messaging -n func-orders --settings ENVIRONMENT=changed')
    command(f, 'az functionapp config appsettings delete -g rg-messaging -n func-orders --setting-names ENVIRONMENT')
    expect(evaluateLab(f.lab, f.run).tasks[0].done).toBe(false)
    command(f, 'curl http://localhost:7071/api/health')
    expect(evaluateLab(f.lab, f.run).tasks[0].done).toBe(true)
    command(f, 'az functionapp delete -g rg-messaging -n func-orders')
    expect(command(f, 'curl http://localhost:7071/api/health').diagnostics[0].code).toBe('HTTP_CONFIG')
    const large = fixture(source.replace('return func.HttpResponse("accepted", status_code=202, headers={"Location":"/api/orders/" + order["id"]})', `return func.HttpResponse("${'x'.repeat(17000)}")`))
    command(large, 'func start')
    expect(post(large).httpResponse.statusCode).toBe(503)
    expect(large.run.runtime.messaging.httpFunctions.accepted).toHaveLength(1)
    expect(post(large).httpResponse.statusCode).toBe(200)
  })
  it('retains a genuine send when a malformed response header fails final validation', () => {
    const f = fixture(source.replace('return func.HttpResponse("accepted", status_code=202, headers={"Location":"/api/orders/" + order["id"]})', `return func.HttpResponse("accepted", mimetype="${'a'.repeat(17000)}")`))
    command(f, 'func start')
    expect(post(f).httpResponse?.statusCode).toBe(503)
    expect(f.run.runtime.messaging.httpFunctions.accepted).toHaveLength(1)
    expect(post(f).httpResponse.statusCode).toBe(200)
  })
  it('rejects borrowing a send from a different request even after mirrored snapshot changes', () => {
    const f = fixture(); command(f, 'func start'); post(f); command(f, 'curl http://localhost:7071/api/orders/o1')
    const altered = structuredClone(f.run), state = altered.runtime.messaging, last = state.executionReceipts.at(-1)
    const first = state.executionReceipts[1].measurements.httpFunctions
    const op = structuredClone(first.invocations[0].operations[0])
    last.measurements.httpFunctions.invocations[0].operations = [op]
    last.measurements.httpFunctions.requests[0].operationIds = [op.id]
    last.measurements.httpFunctions.requests[0].sendReceiptIds = [op.sendReceiptId]
    state.httpFunctions.requests[1] = structuredClone(last.measurements.httpFunctions.requests[0])
    expect(() => deserializeRun(JSON.stringify(altered), f.lab)).toThrow()
  })
  it('rejects protected captured config and raw sensitive body without leaking either into the journal', () => {
    const f = fixture()
    save(f, 'local.settings.json', f.run.project.savedFiles['local.settings.json'].replace('"local"', '"demo-http-private-key"'))
    expect(command(f, 'func start').diagnostics[0].code).toBe('HTTP_PRIVACY')
    expect(f.run.runtime.messaging.httpFunctions).toBeUndefined()
    const clean = fixture(); command(clean, 'func start')
    const result = command(clean, 'curl -d \'{"id":"o1","region":"EU","quantity":2,"password":"hidden-value"}\' http://localhost:7071/api/orders')
    expect(result.httpResponse.statusCode).toBe(503)
    expect(clean.run.runtime.messaging.httpFunctions.accepted).toEqual([])
    expect(JSON.stringify(clean.run.runtime.messaging)).not.toContain('hidden-value')
  })
  it('keeps a GET handler send as actual broker work without claiming POST acceptance', () => {
    const f = fixture(source.replace('route="orders", methods=["POST"]', 'route="orders", methods=["GET"]'))
    command(f, 'func start')
    const result = command(f, 'curl -X GET -d \'{"id":"o1","region":"EU","quantity":2}\' http://localhost:7071/api/orders')
    expect(result.httpResponse?.statusCode).toBe(202)
    expect(f.run.runtime.messaging.httpFunctions.accepted).toEqual([])
    expect(Object.values(f.run.runtime.messaging.entities)[0].messages).toHaveLength(1)
  })
})
