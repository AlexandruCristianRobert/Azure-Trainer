import { describe, it, expect } from 'vitest'
import { parseMessagingProject } from '../src/lib/messaging/python.js'
import { executeMessagingProgram } from '../src/lib/messaging/vm.js'
import { emptyMessagingState } from '../src/lib/messaging/state.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup, createNamespace, createQueue } from '../src/lib/sandbox/ops.js'
import { applyServiceBusOperation } from '../src/lib/messaging/servicebus.js'
import { parseHttpRequest, HTTP_PROFILE } from '../src/lib/http-functions/contracts.js'
import { SERVICEBUS_SOLUTION_FILES } from '../src/data/templates/messaging-python/servicebus.js'
import { getProjectManifest } from '../src/lib/project/manifests.js'
import { httpSdkContract } from '../src/lib/http-functions/sdk.js'
const appId = '/subscriptions/demo/resourcegroups/rg-messaging/providers/microsoft.web/sites/func-orders'
const target = { resourceGroup: 'rg-messaging', namespace: 'sb-orders', queue: 'orders' }
const order = { id: 'o1', region: 'EU', quantity: 2 }
const prefix = 'import json\nimport os\nimport azure.functions as func\nfrom order_store import OrderStatusRepository\napp = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)\nstore = OrderStatusRepository()\n'
function fixture() {
  let sandbox = createResourceGroup(createSandbox(), { name: target.resourceGroup, location: 'westeurope' }).sandbox
  sandbox = createNamespace(sandbox, { resourceGroup: target.resourceGroup, name: target.namespace }).sandbox
  return createQueue(sandbox, { ...target, name: target.queue }).sandbox
}
function run(body, { state = emptyMessagingState(), method = 'GET', raw = '', settings = {}, protectedValues = [], limits = {}, route = 'orders/{id}', params = { id: 'o1' }, decorators = '', signature = 'req: func.HttpRequest', imports = '' } = {}) {
  const source = prefix + imports + `@app.route(route="${route}", methods=["${method}"])\n` + decorators + `def handler(${signature}) -> func.HttpResponse:\n` + body.split('\n').map(line => '    ' + line).join('\n') + '\n'
  const parsed = parseMessagingProject({ 'function_app.py': source }, { entry: 'function_app.py', mode: 'http-handler', profile: HTTP_PROFILE })
  expect(parsed.diagnostics).toEqual([])
  const request = parseHttpRequest({ method, url: 'http://localhost:7071/api/orders/o1', body: raw }, { appId })
  return executeMessagingProgram({ program: parsed.program, state, sandbox: fixture(), limits,
    httpInvocation: { request, route: parsed.program.httpHandlers[0], params, appId, target, generation: 1, settings, protectedValues } })
}
describe('bounded Python HTTP session', () => {
  it('publishes an HTTP contract extending base Messaging without Security imports', () => {
    const contract = httpSdkContract(HTTP_PROFILE)
    expect(contract.exports['azure.servicebus']).toContain('ServiceBusClient')
    expect(contract.exports['azure.functions']).toContain('HttpResponse')
    expect(contract.exports['azure.keyvault.secrets']).toBeUndefined()
  })
  it('executes registered request fields and returns a real normalized response', () => {
    const result = run('return func.HttpResponse(json.dumps({"method":req.method,"id":req.route_params["id"],"query":req.params.get("missing", "fallback")}), status_code=201, headers={"X-Result":"ok"}, mimetype="application/json")')
    expect(result.diagnostics).toEqual([])
    expect(result.value).toEqual({ statusCode: 201, headers: { 'x-result': 'ok', 'content-type': 'application/json' }, body: '{"method":"GET","id":"o1","query":"fallback"}' })
  })
  it('catches malformed JSON only as ValueError and leaves fractional and boolean validation to source', () => {
    const body = 'try:\n    order = req.get_json()\nexcept ValueError:\n    return func.HttpResponse("bad JSON", status_code=400)\nif not isinstance(order, dict):\n    return func.HttpResponse("bad type", status_code=400)\nquantity = order.get("quantity")\nif isinstance(quantity, bool) or not isinstance(quantity, int):\n    return func.HttpResponse("bad quantity", status_code=400)\nreturn func.HttpResponse("valid", status_code=202)'
    for (const raw of ['{', '[]', '{"quantity":1.5}', '{"quantity":true}']) {
      const result = run(body, { method: 'POST', raw })
      expect(result.diagnostics).toEqual([]); expect(result.value.statusCode).toBe(400)
    }
    expect(run(body, { method: 'POST', raw: '{"quantity":2}' }).value.statusCode).toBe(202)
  })
  it('alternate JSON parsing catches malformed request bytes as ValueError', () => {
    const body = 'try:\n    order = json.loads(req.get_body().decode())\nexcept ValueError:\n    return func.HttpResponse("bad JSON", status_code=400)\nreturn func.HttpResponse(json.dumps(order), mimetype="application/json")'
    const malformed = run(body, { method: 'POST', raw: '{' })
    expect(malformed.diagnostics).toEqual([])
    expect(malformed.value).toMatchObject({ statusCode: 400, body: 'bad JSON' })
    expect(malformed.trace).toEqual([])
    const valid = run(body, { method: 'POST', raw: JSON.stringify(order) })
    expect(valid.diagnostics).toEqual([])
    expect(JSON.parse(valid.value.body)).toEqual(order)
  })
  it.each([
    ['privacy', 'json.loads(req.get_body().decode())', '{"password":"hidden"}', {}, 'HTTP_PRIVACY'],
    ['limit', 'json.loads(req.get_body().decode())', 'a'.repeat(64), { valueBytes: 32 }, 'MESSAGING_LIMIT'],
    ['unsupported', 'json.loads(req.get_body().decode("ascii"))', '{}', {}, 'MESSAGING_UNSUPPORTED'],
    ['argument type', 'json.loads(1)', '{}', {}, 'MESSAGING_RUNTIME'],
  ])('alternate JSON parsing does not catch %s errors as ValueError', (_name, expression, raw, limits, code) => {
    const result = run(`try:\n    order = ${expression}\nexcept ValueError:\n    return func.HttpResponse("caught", status_code=400)\nreturn func.HttpResponse("ok")`, { method: 'POST', raw, limits })
    expect(result.value).toBeNull()
    expect(result.diagnostics[0].code).toBe(code)
    expect(result.diagnostics[0].errorType).toBeUndefined()
  })
  it('alternate JSON parsing preserves the legacy malformed JSON diagnostic', () => {
    const parsed = parseMessagingProject({ 'producer.py': 'import json\ndef main():\n    return json.loads("{")\n' }, { entry: 'producer.py' })
    expect(parsed.diagnostics).toEqual([])
    const result = executeMessagingProgram({ program: parsed.program, state: emptyMessagingState(), sandbox: fixture() })
    expect(result.diagnostics[0]).toMatchObject({ code: 'MESSAGING_RUNTIME', message: 'Invalid JSON payload.' })
    expect(result.diagnostics[0].errorType).toBeUndefined()
  })
  it('retains only consumed repository and environment field read IDs through JSON', () => {
    const sent = applyServiceBusOperation(emptyMessagingState(), fixture(), { kind: 'send', target, message: { body: JSON.stringify(order), messageId: 'o1', properties: {} } })
    const result = run('record = store.get(req.route_params["id"])\nreturn func.HttpResponse(json.dumps({"id":record.id,"status":record.status,"env":os.getenv("ENVIRONMENT")}), mimetype="application/json")', { state: sent.state, settings: { ENVIRONMENT: 'local' } })
    expect(result.diagnostics).toEqual([])
    expect(JSON.parse(result.value.body)).toEqual({ id: 'o1', status: 'pending', env: 'local' })
    expect(result.http.consumedReadIds).toHaveLength(2)
    expect(result.http.reads.map(read => read.kind)).toEqual(['repository', 'environment'])
    const unused = run('record = store.get("o1")\nenv = os.getenv("ENVIRONMENT")\nreturn func.HttpResponse("pending local")', { state: sent.state, settings: { ENVIRONMENT: 'local' } })
    expect(unused.http.consumedReadIds).toEqual([])
  })
  it('supports bounded string iteration and does not catch execution limits', () => {
    const result = run('for c in req.route_params["id"]:\n    if c not in "abcdefghijklmnopqrstuvwxyz0123456789":\n        return func.HttpResponse("invalid", status_code=400)\nreturn func.HttpResponse("ok")')
    expect(result.value.body).toBe('ok')
    const limited = run('try:\n    for c in "abcdefghijklmnopqrstuvwxyz":\n        print(c)\nexcept ValueError:\n    return func.HttpResponse("caught")\nreturn func.HttpResponse("ok")', { limits: { steps: 35 } })
    expect(limited.value).toBeNull(); expect(limited.diagnostics[0].code).toBe('MESSAGING_LIMIT')
  })
  it('stages one output value without touching the broker and discards it on an error response', () => {
    const options = { method: 'POST', raw: JSON.stringify(order), decorators: '@app.service_bus_queue_output(arg_name="output", queue_name="orders", connection="OrdersBus")\n', signature: 'req: func.HttpRequest, output: func.Out[str]' }
    const result = run('output.set(json.dumps(req.get_json()))\nreturn func.HttpResponse("queued", status_code=202)', options)
    expect(result.diagnostics).toEqual([]); expect(result.trace).toEqual([])
    expect(result.http.stagedOutput).toMatchObject({ value: JSON.stringify(order), queueName: 'orders', connection: 'OrdersBus' })
    expect(run('output.set(json.dumps(req.get_json()))\nreturn func.HttpResponse("bad", status_code=400)', options).http.stagedOutput).toBeNull()
  })
  it('guards demo keys and sensitive payloads before printing, responding or staging', () => {
    for (const body of ['return func.HttpResponse("private-demo-key")', 'print("private-demo-key")\nreturn func.HttpResponse("ok")', 'return func.HttpResponse(json.dumps({"password":"hidden"}))']) {
      const result = run(body, { protectedValues: ['private-demo-key'] })
      expect(result.value).toBeNull(); expect(result.output).toEqual([])
      expect(JSON.stringify(result.diagnostics)).not.toContain('private-demo-key')
      expect(result.diagnostics[0].code).toBe('HTTP_PRIVACY')
    }
  })
  it('rejects unsupported branches and HTTP imports on old profiles before effects', () => {
    const source = prefix + '@app.route(route="health",methods=["GET"])\ndef health(req: func.HttpRequest) -> func.HttpResponse:\n    if False:\n        eval("oops")\n    return func.HttpResponse("ok")\n'
    expect(parseMessagingProject({ 'function_app.py': source }, { entry: 'function_app.py', mode: 'http-handler', profile: HTTP_PROFILE }).program).toBeNull()
    expect(parseMessagingProject({ 'function_app.py': source }, { entry: 'function_app.py', mode: 'functions' }).program).toBeNull()
  })
  it('commits genuine SDK acceptance despite a subsequent handler error and refuses a duplicate send', () => {
    const imports = 'from azure.identity import DefaultAzureCredential\nfrom azure.servicebus import ServiceBusClient, ServiceBusMessage\n'
    const send = 'order = req.get_json()\nclient = ServiceBusClient("sb-orders.servicebus.windows.net", DefaultAzureCredential())\nsender = client.get_queue_sender(queue_name="orders")\nsender.send_messages(ServiceBusMessage(json.dumps(order), message_id=order["id"]))\n'
    const options = { imports, method: 'POST', raw: JSON.stringify(order) }
    const result = run(send + 'raise ValueError("response failed")', options)
    expect(result.value).toBeNull(); expect(result.diagnostics[0].errorType).toBe('ValueError')
    expect(result.state.httpFunctions.accepted).toHaveLength(1)
    expect(result.state.httpFunctions.accepted[0]).toMatchObject({ order, appId, generation: 1 })
    expect(result.http.operations[0]).toMatchObject({ kind: 'sdk-send', acceptedId: result.state.httpFunctions.accepted[0].id, sendReceiptId: result.state.httpFunctions.accepted[0].sendReceiptId })
    const retry = run(send + 'return func.HttpResponse("ok", status_code=202)', { ...options, state: result.state })
    expect(retry.value).toBeNull(); expect(retry.trace).toEqual([])
    expect(Object.values(retry.state.entities)[0].messages).toHaveLength(1)
  })
  it('does not credit a send whose body differs from the actual request', () => {
    const result = run('client = ServiceBusClient("sb-orders.servicebus.windows.net", DefaultAzureCredential())\nsender = client.get_queue_sender(queue_name="orders")\nsender.send_messages(ServiceBusMessage("different body"))\nreturn func.HttpResponse("ok", status_code=202)', {
      method: 'POST', raw: JSON.stringify(order), imports: 'from azure.identity import DefaultAzureCredential\nfrom azure.servicebus import ServiceBusClient, ServiceBusMessage\n',
    })
    expect(result.diagnostics).toEqual([]); expect(result.http.operations[0].acceptedId).toBeNull()
    expect(result.state.httpFunctions?.accepted ?? []).toEqual([])
  })
  it.each([HTTP_PROFILE, 'messaging-v1'])('executes the ordinary worker under %s with the protected manifest', profile => {
    const manifest = getProjectManifest('http-functions-python-v1')
    expect(manifest.id).toBe('http-functions-python-v1')
    const files = { ...SERVICEBUS_SOLUTION_FILES, ...manifest.fixedFiles }
    const parsed = parseMessagingProject(files, { entry: 'worker.py', mode: 'script', profile, fixedFiles: manifest.fixedFiles })
    expect(parsed.diagnostics).toEqual([])
    const sent = applyServiceBusOperation(emptyMessagingState(), fixture(), { kind: 'send', target, message: { body: JSON.stringify(order), messageId: 'o1', properties: {} } })
    const result = executeMessagingProgram({ program: parsed.program, state: sent.state, sandbox: fixture() })
    expect(result.diagnostics).toEqual([]); expect(result.state.effects.processed.o1).toEqual(order)
  })
  it('rejects readonly request writes and credential header serialization', () => {
    const write = run('req.route_params["id"] = "changed"\nreturn func.HttpResponse("ok")')
    expect(write.value).toBeNull(); expect(write.diagnostics[0].code).toBe('MESSAGING_UNSUPPORTED')
    const result = run('return func.HttpResponse(req.get_body().decode())', { method: 'POST', raw: '{"email":"person@example.com"}' })
    expect(result.value).toBeNull(); expect(result.diagnostics[0].code).toBe('HTTP_PRIVACY')
  })
  it('rejects a sensitive queued body before receiving or recording work', () => {
    const manifest = getProjectManifest('http-functions-python-v1')
    const parsed = parseMessagingProject({ ...SERVICEBUS_SOLUTION_FILES, ...manifest.fixedFiles }, { entry: 'worker.py', profile: HTTP_PROFILE })
    const sent = applyServiceBusOperation(emptyMessagingState(), fixture(), { kind: 'send', target, message: { body: '{"id":"o1","email":"person@example.com"}', messageId: 'o1', properties: {} } })
    const result = executeMessagingProgram({ program: parsed.program, state: sent.state, sandbox: fixture() })
    expect(result.diagnostics[0].code).toBe('HTTP_PRIVACY')
    expect(result.trace).toEqual([])
    expect(result.state).toBe(sent.state)
  })
  it('does not leak protected settings into read measurements even when unused', () => {
    const result = run('unused = os.getenv("ENVIRONMENT")\nreturn func.HttpResponse("ok")', { settings: { ENVIRONMENT: 'private-demo-key' }, protectedValues: ['private-demo-key'] })
    expect(result.diagnostics[0].code).toBe('HTTP_PRIVACY')
    expect(result.http.reads).toEqual([])
    expect(JSON.stringify(result.http)).not.toContain('private-demo-key')
  })
  it('guards settlement diagnostics before recording the broker effect', () => {
    const sent = applyServiceBusOperation(emptyMessagingState(), fixture(), { kind: 'send', target, message: { body: JSON.stringify(order), messageId: 'o1', properties: {} } })
    const result = run('client = ServiceBusClient("sb-orders.servicebus.windows.net", DefaultAzureCredential())\nreceiver = client.get_queue_receiver(queue_name="orders")\nfor message in receiver.receive_messages(max_message_count=1):\n    receiver.dead_letter_message(message, reason="private-demo-key")\nreturn func.HttpResponse("done")', {
      state: sent.state, protectedValues: ['private-demo-key'], imports: 'from azure.identity import DefaultAzureCredential\nfrom azure.servicebus import ServiceBusClient\n',
    })
    expect(result.diagnostics[0]?.code).toBe('HTTP_PRIVACY')
    expect(result.trace.map(row => row.kind)).toEqual(['receive'])
    expect(JSON.stringify(result.trace)).not.toContain('private-demo-key')
  })
  it('bounds response bytes and read count without catching them as ValueError', () => {
    const oversized = run('try:\n    return func.HttpResponse(req.get_body().decode())\nexcept ValueError:\n    return func.HttpResponse("caught")', { method: 'POST', raw: 'a'.repeat(16384) })
    expect(oversized.value.body).toHaveLength(16384)
    const result = run('try:\n    for c in "' + 'a'.repeat(51) + '":\n        unused = os.getenv("ENVIRONMENT", "local")\nexcept ValueError:\n    return func.HttpResponse("caught")\nreturn func.HttpResponse("ok")')
    expect(result.value).toBeNull(); expect(result.diagnostics[0].code).toBe('HTTP_LIMIT'); expect(result.http.reads).toHaveLength(50)
  })
  it('rejects multiple apps, duplicate routes, arbitrary except, and wrong output signatures', () => {
    const sources = [
      prefix + 'other = func.FunctionApp()\n@app.route(route="a")\ndef a(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse("a")\n@other.route(route="b")\ndef b(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse("b")\n',
      prefix + '@app.route(route="a")\ndef a(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse("a")\n@app.route(route="a")\ndef b(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse("b")\n',
      prefix + '@app.route(route="a")\ndef a(req: func.HttpRequest) -> func.HttpResponse:\n    try:\n        return func.HttpResponse("a")\n    except Exception:\n        return func.HttpResponse("b")\n',
      prefix + '@app.route(route="a")\n@app.service_bus_queue_output(arg_name="output", queue_name="orders", connection="OrdersBus")\ndef a(req: func.HttpRequest, output: func.Out[int]) -> func.HttpResponse:\n    return func.HttpResponse("a")\n',
    ]
    for (const source of sources) expect(parseMessagingProject({ 'function_app.py': source }, { entry: 'function_app.py', mode: 'http-handler', profile: HTTP_PROFILE }).program).toBeNull()
  })
  it('resolves list constants but rejects mutated method lists instead of publishing stale routes', () => {
    const source = prefix + 'METHODS = ["GET"]\nALIASED = METHODS\n@app.route(route="health", methods=METHODS, auth_level=func.AuthLevel.FUNCTION)\ndef health(req: func.HttpRequest) -> func.HttpResponse:\n    return func.HttpResponse("ok")\n'
    const parse = text => parseMessagingProject({ 'function_app.py': text }, { entry: 'function_app.py', mode: 'http-handler', profile: HTTP_PROFILE })
    expect(parse(source).program.httpHandlers[0]).toMatchObject({ route: 'health', methods: ['GET'], authLevel: 'function' })
    expect(parse(source.replace('@app.route', 'ALIASED[0] = "POST"\n@app.route')).program).toBeNull()
  })
})
