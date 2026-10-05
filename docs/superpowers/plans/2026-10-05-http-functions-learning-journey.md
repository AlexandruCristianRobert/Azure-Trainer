# HTTP Functions Learning Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement nine code-first HTTP Functions Labs for the complete Order API and hand off a reviewed, verified local branch.
**Architecture:** Add an explicit HTTP profile/session to the existing bounded Messaging parser/VM, with separate HTTP registrations, capture/request orchestration and optional typed HTTP state. Keep actual broker/processed state and executionReceipts authoritative; supplied repository reads and HTTP responses retain consumption provenance. Reuse the current UI and never run real HTTP/Python/Azure.
**Tech Stack:** Vue 3, JavaScript ES modules, existing Lezer Python IR and Vitest; no added runtime dependencies.
**Spec:** `docs/superpowers/specs/2026-10-05-http-functions-learning-journey-design.md`
**Authority:** User delegated remaining recommendations, requested the written plan and immediate Superpowers implementation. Use subagents with task-scoped independent review; do not add approval menus. New remote merge/publication is not authorized by this instruction.

## Global Constraints

Execution status: all six tasks completed and independently approved. Final
whole-branch findings were resolved in `0426501` and the original reviewer
approved the scoped correction. See `2026-10-05-http-functions-handoff.md` for
verification evidence, rulings, limits and remaining integration choice.

- Exactly nine Labs, journeyId http-functions-orders, skillAreaId connect;
  orders 1–8 guided and order 9 capstone. Maximum 15 is not a target to fill.
- Continue the Order Processing Application; Python v2 decorators with useful
  C# isolated-worker comparisons, not a second execution language.
- Browser-only bounded simulation: no real HTTP/Azure/SDK network requests,
  Python process, installed production SDK or new runtime dependency.
- Saved source drives behavior. Never exact-match Solution text, accept literal
  HTTP success without the required operation, or grade an unused status lookup.
- Hidden on-demand Solutions; separately collapsed Task Rationale and locally
  copyable authored Explanation Prompts, without workspace/key disclosure.
- Independently supplied earlier-stage baselines contain no HTTP request,
  capture, execution or completion proof for a newly assigned Task.
- One compact behavior episode per Lab; no repeated experiment triples or
  additional Cosmos DB, App Service, Entra or monitoring curriculum.
- Preserve existing Messaging, Security/Observability, Data and approved layout.
- Run only owning focused tests while developing; no AKS/Container Apps/full,
  cloud, Python or broad browser suites. Time every test/diagnostic/build attempt,
  including failures/reruns/CI; reduce/refactor if cumulative verification
  exceeds 30 minutes per Lab publication.
- Persist finite typed bounded state; preserve one authoritative executionReceipts
  journal. Source/resource change and change/revert invalidate completion.
- Public response, diagnostic, request evidence and broker data must not reveal
  demo function-key/credential values or sensitive payload fields. Authored
  demo-only commands/source are deliberately not claimed to be redacted.
- Implementation uses an isolated worktree. No new merge, push, deployment or
  destructive cleanup without explicit authority; existing protected artifacts
  and other worktrees remain untouched.

## Review Focus

1. Bad JSON, boolean/fractional quantity, missing/extra/reserved fields and unknown IDs: learner validation yields 400/no send; GET yields real 404 (Tasks1–3).
2. Same-ID retry after SDK send followed by a lost/error response, changed payload and failed output flush: acceptance survives only genuine send and no duplicate/conflict mutation (Tasks1–3).
3. Unused repository/getenv read plus literal response and forged cross-request links: cannot earn read-consumption or current evidence credit (Tasks2/3).
4. Saved source not restarted/published, wrong app/namespace, settings drift and change/revert: execute captured version but never revive current Task proof (Task3).
5. Keys in header/query/print/body/diagnostics, malformed routes and unsupported options: keys remain private; authorization precedes effects; ordinary local keys differ from cloud (Tasks2/3).

## File ownership and shared contract

New modules under `src/lib/http-functions/`: contracts.js/order schema and limits;
orders.js/repository+acceptance; state.js/typed extension; sdk.js/signatures;
python.js/HTTP registration; values.js/private provenance; runtime.js/session;
execute.js/capture/request orchestration; shell.js/intents; evidence.js/current
measurement/context validation. Minimal profile hooks in Messaging parser/VM/
execute/state/evidence/actions, az/shell and Lab engine. No interpreter copy.

`HTTP_PROFILE = 'http-functions-v1'`; `HTTP_MANIFEST` id
http-functions-python-v1, runtimeFamily messaging. Trusted Lab capability
`httpFunctions:true` selects it. Manifest includes function_app.py, clients.py,
worker.py, host.json, local.settings.json, requirements.txt, training_runtime.py,
order_store.py, README.md; <=16 files,128 KiB each,512 KiB total. Protected
`HTTP_RUNTIME_FILES` contain requirements/training_runtime/order_store interface
metadata, not installed SDKs.

`lab.messagingInput.httpFunctions` is exactly
`{appId,target:{resourceGroup,namespace,queue},functionKeys:[{id,value}]}`;
keys <=4 demo fixtures, private. Names rg-messaging/func-orders/sb-orders/orders;
IDs derive actual Sandbox helpers. No action supplies principal, auth success,
receipt/proof or caller-chosen state. New HTTP mode is `http-handler`.

`runtime.messaging.httpFunctions` optional extension:
`{version:1,nextId:1,localHosts:[],deployments:[],currentLocal:{},currentPublished:{},accepted:[],requests:[]}`.
Absent stays absent for old saves; explicit null invalid. Unique capture/
acceptance/request IDs http-capture-N/http-accepted-N/http-request-N use nextId; captures retained <=16,
accepted <=50, requests <=100, total256 KiB. Capture source<=64 KiB each;
URL2048chars, raw request/response16 KiB, maps<=32 entries.

Capture: actual appId, local/published scope, generation, reached sources and file
versions, typed routes, logical createdAtMs. Current app-to-capture ID maps select
active snapshots separately from retained capture arrays. Replacing active capture retains
history up to bound, never silently evicts referenced source. Accepted record:
actual appId/target/canonical order, real message/send receipt IDs and
logical acceptedAtMs. Owning invocation is derived from request sendReceiptIds
and the authoritative execution journal, never supplied by caller intent.
Task3 must enforce app, scope, capture generation and command boundaries before
admission or HTTP credit. Request record: app/scope+generation, canonical request
method/decoded path, safe input metadata, auth outcome (never key value), operations
and consumed read IDs, actual public response, genuine broker links, command
sequence boundaries. Exact final DTO schemas belong to state.js; handoff report
must publish them for later tasks before those tasks start.

HTTP measurement is optional `measurements.httpFunctions`, selecting the exact
new request/acceptance/capture slice through nextId boundaries. The existing
executionReceipts sequence anchors it; no second verification history.

### Task 1: Pure HTTP/order contracts and typed status foundation

**Files:** Create `src/lib/http-functions/{contracts,orders,state}.js`; test `tests/http-functions-contracts.test.js`.
**Consumes:** actual Messaging state and broker records, finiteJson/plainObject conventions; no parser/VM changes.
**Produces:** `HTTP_PROFILE`, `HTTP_LIMITS`, `normalizeOrder(value)`,
`sameCanonicalOrder(a,b)`,
`parseHttpRequest(intent,{appId})`, `matchHttpRoute(routes,method,path)`,
`readOrderStatus(messaging,{appId,target,orderId})`,
`classifySubmission(messaging,context,order)` => new/reuse/conflict plus actual record,
`recordAcceptedOrder(extension,fields,messaging)`,
`emptyHttpFunctionsState()`, `validateHttpFunctionsState(value)`.

- [ ] Author compact RED real Sandbox/broker cases, not mocks. Normalize exact {id,region,quantity}, preserve canonical identity irrespective key order; boolean/fractional/out-of-range quantity and extra keys reject. Pure request parser has intent-only method/url/headers/body; unsupported schemes/hosts/options reject. Route templates only literals and whole-segment {name}; reject duplicate/ambiguous same-method patterns, give static routes precedence, method405/Allow vs path404. Prefix /api; static segments case-insensitive, parameter values preserved; reject encoded slash/backslash/NUL and malformed decoding.
```js
expect(normalizeOrder({quantity:2,region:'EU',id:'o1'})).toEqual({id:'o1',region:'EU',quantity:2})
expect(()=>normalizeOrder({id:'o1',region:'EU',quantity:true})).toThrow()
expect(readOrderStatus(emptyMessagingState(), {appId,target,orderId:'missing'})).toBeNull()
expect(validateHttpFunctionsState({...emptyHttpFunctionsState(),requests:[{success:true}]})).toBe(false)
```
- [ ] Timed RED owning file; missing module converted to absent export assertion, not collection-only failure.
- [ ] Implement field/byte/count limits and exact schemas. Repository derives pending from real retained queue records, processed from actual effects.processed, failed from terminal message state; accepted ledger fixes immutable payload and references genuine actual send. Two targets/apps do not share acceptance. No fixture/caller can manufacture an accepted order from a flag.
```js
const prior = readOrderStatus(messaging, {appId,target,orderId:order.id})
return prior === null ? {kind:'new'} : sameCanonicalOrder(prior,order)
  ? {kind:'reuse',record:prior} : {kind:'conflict',record:prior}
```
Export sameCanonicalOrder from contracts.js, comparing normalized id/region/quantity.
readOrderStatus includes id/region/quantity/status and value-free origin/generation
metadata for private consumption; public responses only expose selected fields.
Task2/3 own runtime journal admission, not this pure helper.
- [ ] Timed GREEN owning file; self-review scope/readonly copies/prototype guards; commit `feat: define HTTP order contracts and typed status state`.

### Task 2: Python v2 HTTP registration and bounded request/response session

**Files:** Create `src/lib/http-functions/{sdk,python,values,runtime}.js`, `src/data/templates/http-functions-python/{manifest,runtime}.js`; modify Messaging python.js/vm.js/execute.js, project/manifests.js; test `tests/http-functions-sdk.test.js`.
**Consumes:** Task1 exact schema/constants/repository helpers and VM WeakMap handle/info bridge.
**Produces:** `HTTP_MANIFEST`, `HTTP_RUNTIME_FILES`, `httpSdkContract(profile)`,
`analyzeHttpHandlers(context)` producing `program.httpHandlers`,
`createHttpSession(context)` with call/member/index/unbox/guard/serialize,
beforeBroker/afterBroker and invoke/finish interfaces; `executeMessagingProgram`
accepts trusted optional `httpInvocation` only from Task3 orchestrator.

- [ ] Write RED source executions with actual parser/VM plus pure trusted invocation fixtures. One request→real HttpResponse; Request fields/get_json/body; route enums/list constants and qualified annotations; repository consumed JSON/env fields; staged output; ValueError catch; old profiles reject HTTP imports/decorators.
```python
import json
import azure.functions as func
from order_store import OrderStatusRepository
app = func.FunctionApp()
store = OrderStatusRepository()
@app.route(route="orders/{id}", methods=["GET"], auth_level=func.AuthLevel.ANONYMOUS)
def get_order(req: func.HttpRequest) -> func.HttpResponse:
    record = store.get(req.route_params["id"])
    if record is None:
        return func.HttpResponse("not found", status_code=404)
    return func.HttpResponse(json.dumps({"id":record.id,"status":record.status}),
        status_code=200, mimetype="application/json")
```
- [ ] Timed RED owning file. Add compact malformed-json/catch and unused-read literal negatives.
- [ ] Implement explicit imported symbols and readonly properties. HTTP profile extends base Messaging, not Security alias; reuse guard policy without instantiating nonexistent security extension. Keep legacy registration union separate. Add only HTTP-profile ValueError try/except, dict.get, bounded string iteration and isinstance with str/int/bool/dict/list; reject arbitrary catch/async/classes/operators. JSON finite fractions may reach validation but bool is distinct for quantity. Static and runtime module/type maps must agree.
```python
try:
    order = req.get_json()
except ValueError:
    return func.HttpResponse("invalid JSON", status_code=400)
if not isinstance(order, dict):
    return func.HttpResponse("invalid order", status_code=400)
```
Analyze every branch before effects. func.Out[str] optional second parameter must
match queue-output arg_name; response annotation is HttpResponse. Registered
FunctionApp object shared, duplicates reject. Publish actual metadata, not AST
source matching. New SDK calls: FunctionApp(http_auth_level?), route(...),
HttpResponse(body,status_code=200,headers?,mimetype?), repository.get(id),
os.getenv(name,default=None), output.set(value), Request methods. HTTP headers
use lowercase canonical keys; request function key stays opaque/guarded.

Private repository/env scalar tokens retain read IDs through guarded json.dumps
and HttpResponse consumption; plain public values stay normal JSON. Reject
unused read plus literal response credit. Bounds/unsupported/security errors
cannot be caught as ValueError. HTTP script worker mode remains ordinary script.

SDK broker send/accepted ledger hooks use actual target and matching normalized
request order. Commit accepted only after successful real send. Output binding
stages; Task3 flushes after valid response, not on exception/error response.
Receipt/string/JSON/header/diagnostic paths compose known demo-key and sensitive
payload guards; never serialize internal handles. Normal legacy broker behavior
and existing guards remain.
- [ ] Timed GREEN owning file plus only a concrete affected legacy selector if needed; self-review map parity/private JSON/limits; commit `feat: execute bounded Python HTTP Functions and output values`.

### Task 3: Captured hosts, publish/curl actions and causal current evidence

**Files:** Create `src/lib/http-functions/{execute,shell,evidence}.js`; modify az/shell.js, messaging/{actions,state,evidence}.js and labEngine/{actions,run,evaluate}.js; extend HTTP runtime/state only if needed; test `tests/http-functions-engine.test.js`.
**Consumes:** Task1/2 contracts/schema/profile/session/manifest.
**Produces:** `captureHttpFunctions(run,lab,scope)`,
`runHttpFunctionsRequest(run,lab,intent)`, `httpShellEffect(tokens,context)`,
`httpMeasurements(before,after)`, `validHttpMeasurement(value)`,
`validHttpJournal(messaging,labInput,sandbox)`, `httpEvidenceIsCurrent(evidence,run,lab)`.

- [ ] RED real createBehavioralRun/app Sandbox/source/curl route test: local capture then GET; cloud publish/settings/Function key; SDK POST actual pending/worker processed; duplicate200/conflict409; output flush success/failure; source/role/resource change-revert; restore mutation.
```js
expect(run('func start').diagnostics).toEqual([])
expect(run('curl -i http://localhost:7071/api/orders/o1').httpResponse.statusCode).toBe(404)
expect(run('curl -X POST -H "Content-Type: application/json" -d \'{"id":"o1","region":"EU","quantity":2}\' http://localhost:7071/api/orders').httpResponse.statusCode).toBe(202)
expect(run('python worker.py').diagnostics).toEqual([])
expect(run('curl http://localhost:7071/api/orders/o1').httpResponse.body).toContain('processed')
```
- [ ] Timed RED owning file.
- [ ] Route intent-only new effects before generic messaging shell routing; `func start` only for trusted HTTP capability calls local capture, legacy still uses old queue-drain. Add publish form and restricted curl flags. Never spawn OS server/request or call remote URI. Resolve actual app resource, captured routes and reached saved files/versions; local localhost7071 vs deterministic actual app cloud host. Wrong scheme/host/flags and ambiguous route diagnose early.
```js
if (lab.capabilities?.httpFunctions && effect.httpFunctions)
  return applyHttpEffect(run, effect.httpFunctions, lab) // defined here, intent-only
```
Add `applyHttpEffect` export in execute.js if this helper is used. Do not
repurpose old GET-only Experiment Controls/requestAction.

On invocation parse captured sources (not drafts/current newly saved source);
local settings captured, cloud appSettings read on invocation; private function
keys from trusted Lab input. Auth precedes handler/effects; local auth disabled,
cloud function-level wrong/missing401, anonymous allowed. No admin/query-code
key path. SDK send survives later handler error with accepted ledger; staged
binding rollback on exception/failed flush; no automatic queue drain. Trace
actual response, consumed reads, send receipt ownership and accepted payload.
Append exact optional HTTP measurement to authoritative executionReceipts,
including capture-only commands without pretending they proved a Task. Mode
http-handler activity requires genuine request operation; queue Tasks require
actual send, GET/settings require consumed fields. Validate response and all
new extension snapshots on action/restore. No action-supplied success/proof.

Source/resource/capture revisions and change-revert invalidate completion.
Historical valid earlier capture/accepted data remains loadable, but stale
completion cannot return. Block oversized request/response/state before
partial inadmissible commit; preserve actual completed SDK sends on response
failure as documented, and no staged binding acceptance on enqueue failure.
- [ ] Timed GREEN owning file; self-review admission/rollback/freshness/privacy; commit `feat: integrate captured HTTP host requests and evidence`.

### Task 4: Guided HTTP construction Labs 1–5

**Files:** Create `src/data/templates/http-functions-python/api.js`,
`src/data/labs/http-functions-journey/{helpers,seeds,basic,start.lab,status.lab,validation.lab,enqueue.lab,retries.lab}.js`; test `tests/http-functions-labs-basic.test.js`.
**Consumes:** Task1–3 runtime/contracts; existing resource and task-rationale contracts.
**Produces:** `HTTP_BASIC_LABS` orders1–5 in basic.js; shared `httpTask(options)`,
`seedHttpStage(run,stage)`, `httpProjectFiles(stage)`, DTO metadata selectors,
starter/Solution constants and provided `HTTP_WORKER_SOURCE`.

**Approved prerequisite refinement:** HTTP-only parser fails closed on ambiguous
unparenthesized `not` combined with `and`/`or`; explicit parentheses or separate
`if` statements remain supported and the limitation is documented. The existing
legacy profiles are unchanged. A trusted host-derived value-free `inputClass`
is mirrored in Request and Invocation, with exact closed enum validation and
matching journal linkage. It distinguishes actual invalid-input categories
without retaining raw bodies, keys or hashes; it never supplies a response or
validation success. Semantic graders require distinct rejected categories plus
a genuine valid branch, not repeated copies of one malformed input. Minimal
contracts/state/parser/execute/evidence hooks and impacted pure fixture fields
are in this Task's reviewed scope. Coherent wholesale browser-storage rewriting
is outside the simulator's noncryptographic provenance guarantees.

- [ ] RED one Solution replay per Lab, unfinished baselines/persistence loop;
  compact unused-read, invalid-but-enqueued, literal202 and duplicate source
  negatives. Exact IDs start/status/validation/enqueue/retries with http-functions-
  prefix, metadata engine2/content1/journeyId http-functions-orders/connect,
  manifest http-functions-python-v1, caps messaging/httpFunctions.
```js
expect(HTTP_BASIC_LABS.map(l=>l.journeyOrder)).toEqual([1,2,3,4,5])
for (const lab of HTTP_BASIC_LABS) {
  const initial=createBehavioralRun(lab,{attemptId:lab.id})
  expect(evaluateLab(lab,initial).tasks.every(t=>!t.done)).toBe(true)
}
```
- [ ] Timed RED owning file.
- [ ] Author code-first Tasks using the existing hidden rationale/Solution UI.
  Supply exact real app/storage/namespace/queue prerequisites through actual
  helpers; no HTTP capture/request/execution/proof seeded. Status Lab may
  supply disclosed pending broker input, not completed HTTP read proof. Worker
  is a protected supplied SDK receive→was_processed→actual work/record→complete
  script, not an authored success callback. Function App remains Python3.12/4.
  API stage/newly assigned source begins unfinished. Examples:
```python
from azure.servicebus import ServiceBusMessage
sender.send_messages(ServiceBusMessage(json.dumps(order), message_id=order["id"]))
return func.HttpResponse(json.dumps({"id":order["id"],"status":"pending"}),
    status_code=202, headers={"Location":"/api/orders/"+order["id"]},
    mimetype="application/json")
```
The enqueue grade checks the real linked send, not this literal pending alone.
Retry source reads actual repository, compares id/region/quantity and returns
200 existing status/no send or409/no mutation. Validation has explicit malformed
JSON and bool/type/range/extra-field checks in learner code. One compact episode
may issue a few short curl requests and worker command; no experiment padding.
Dependencies include all reached code/protected files and actual app/queue/
settings metadata; README irrelevant. Repository/env consumption and response
linkage matter, not exact Solution/command text.
- [ ] Timed GREEN owning file; self-review provenance/baseline/readme/C# prompt privacy; commit `feat: add five HTTP API construction labs`.

### Task 5: Guided publish, function-key and output-binding Labs 6–8

**Files:** Create `src/data/templates/http-functions-python/hosting.js`,
`src/data/labs/http-functions-journey/{hosting,publish.lab,keys.lab,binding.lab}.js`; extend helpers/seeds/api templates as required; test `tests/http-functions-labs-hosting.test.js`.
**Consumes:** Task4 shared metadata/source/helpers and actual HTTP runtime.
**Produces:** `HTTP_HOSTING_LABS` orders6–8; cloud settings/AuthLevel/binding
Solution source reusable by Capstone. Aggregate separate from helper consumers.

- [ ] RED one Solution replay each, initial unfinished/restore loop, narrow
  local-key-vs-cloud, stale-publish, unused-getenv and unflushed binding negatives.
```js
expect(HTTP_HOSTING_LABS.map(l=>l.journeyOrder)).toEqual([6,7,8])
expect(cloudWithoutKey.httpResponse.statusCode).toBe(401)
expect(localSameCode.httpResponse.statusCode).not.toBe(401)
expect(bindingFailure.runtime.messaging.httpFunctions.accepted).toEqual([])
```
- [ ] Timed RED owning file.
- [ ] Publish Lab writes executed getenv/response and actual appsettings, then
  captures cloud source and demonstrates local/cloud distinction. Key Lab
  writes function-level routes and consumes a clearly dummy header key only on
  cloud; wrong/missing key yields401 before code, no key in public evidence or
  prompts. No OAuth/RBAC/key-management subplot.
```python
import json
import azure.functions as func
from order_store import OrderStatusRepository
app = func.FunctionApp()
store = OrderStatusRepository()
@app.route(route="orders", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
@app.service_bus_queue_output(arg_name="output", queue_name="orders",
    connection="ServiceBusConnection")
def submit(req: func.HttpRequest, output: func.Out[str]) -> func.HttpResponse:
    try:
        order = req.get_json()
    except ValueError:
        return func.HttpResponse("invalid JSON", status_code=400)
    if not isinstance(order, dict):
        return func.HttpResponse("invalid order", status_code=400)
    if len(order) != 3 or "id" not in order or "region" not in order or "quantity" not in order:
        return func.HttpResponse("invalid fields", status_code=400)
    if not isinstance(order["id"], str) or len(order["id"]) < 1 or len(order["id"]) > 64:
        return func.HttpResponse("invalid id", status_code=400)
    if order["id"][0] not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789":
        return func.HttpResponse("invalid id", status_code=400)
    for character in order["id"]:
        if character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-":
            return func.HttpResponse("invalid id", status_code=400)
    if order["region"] not in ["EU", "US"]:
        return func.HttpResponse("invalid region", status_code=400)
    if not isinstance(order["quantity"], int) or isinstance(order["quantity"], bool):
        return func.HttpResponse("invalid quantity", status_code=400)
    if order["quantity"] < 1 or order["quantity"] > 100:
        return func.HttpResponse("invalid quantity", status_code=400)
    existing = store.get(order["id"])
    location = "/api/orders/" + order["id"]
    if existing is not None:
        if existing.region != order["region"] or existing.quantity != order["quantity"]:
            return func.HttpResponse("order conflict", status_code=409)
        return func.HttpResponse(json.dumps({"id":existing.id,"status":existing.status}),
            status_code=200, headers={"Location":location}, mimetype="application/json")
    output.set(json.dumps(order))
    return func.HttpResponse(json.dumps({"id":order["id"],"status":"pending"}),
        status_code=202, headers={"Location":location}, mimetype="application/json")
```
This complete binding-focused Solution retains earlier validation/repository
code as supplied prerequisites. Binding Task proves actual staged
value was flushed to actual queue on normal response and not on failed enqueue;
setter presence/returned202 is not proof. Registry/functions connection prefix
must resolve actual intended namespace, local/cloud settings stay distinct.
- [ ] Timed GREEN owning file; self-review supported-vs-real local auth/publish
  disclosure and C# isolated-worker/ServiceBusOutput comparisons; commit
  `feat: add HTTP hosting access and binding labs`.

### Task 6: Capstone, catalog, docs and focused completion gate

**Files:** Create `src/data/templates/http-functions-python/capstone.js`,
`src/data/labs/http-functions-journey/{capstone.lab,index}.js`,
`docs/http-functions-simulator.md`,
`tests/http-functions-{capstone,catalog}.test.js`; modify labs/index.js,
HomePage.vue, package.json, pages.yml; shared helpers/seeds only for capstone.
**Consumes:** HTTP_BASIC_LABS, HTTP_HOSTING_LABS, supplied worker/repository.
**Produces:** `HTTP_FUNCTIONS_LABS` exactlynine; `test:http-functions` exactly
seven owning files, two-command/little-curl complete Capstone source.

- [ ] RED actual protected cloud POST/GET/binding/worker/retry/conflict flow,
  all initial Tasks unfinished, serialized restore and tampered/missing-current
  evidence, README harmless. Catalog IDs/order/pointer navigation exactonce.
```js
expect(HTTP_FUNCTIONS_LABS).toHaveLength(9)
expect(LABS.filter(l=>l.journeyId==='http-functions-orders')).toEqual(HTTP_FUNCTIONS_LABS)
expect(evaluateLab(capstone,completedRun).tasks.every(t=>t.done)).toBe(true)
expect(()=>deserializeRun(tamperedRun,capstone)).toThrow()
```
- [ ] Timed RED two owning files.
- [ ] Capstone writes unfinished request validation/routes/response + key
  annotation/binding + repository consumption; earlier resources and worker
  supplied. One combined bounded episode: publish, rejected unauthorized/invalid,
  accepted202, pending200, worker, processed200, same-body reuse200 and conflict409
  with unchanged queue count. Reuse short actual request fixtures rather than
  many full replay variants. Graders require current captured source/resource
  generations and actual read/send/processed relationships.
  Home title `HTTP Functions journey`; description submitting/checking orders.
  No layout/editor redesign. README/docs disclose every supported SDK/CoreTools/
  curl subset, private supplied repository, sequential idempotency, key privacy,
  local/cloud distinctions and bounds. Official links from spec.
```json
"test:http-functions": "vitest run tests/http-functions-contracts.test.js tests/http-functions-sdk.test.js tests/http-functions-engine.test.js tests/http-functions-labs-basic.test.js tests/http-functions-labs-hosting.test.js tests/http-functions-capstone.test.js tests/http-functions-catalog.test.js"
```
  Add this focused script to normal Pages CI; no workflow bypass.
- [ ] Timed GREEN owning files, then aggregate once; compatibility once:
  messaging-python/functions/eventgrid/engine + security-observability-capstone
  + data-python-sdk (six named files); one `npm run build -- --base=/Azure-Trainer/`.
  Never full tests/AKS/Container Apps. Report existing build advisory and startup
  dependency advisories, no force-upgrade. If failed, diagnose and rerun only
  amended covering subset; count all attempts.
- [ ] Self-review exact nine records/source-current proof/branch scope; commit
  `feat: complete HTTP Functions learning journey`.

## Controller completion

Task-scoped independent spec+quality gates, actual BASE/HEAD packages; fix rounds
resume owner, five maximum, deferred minors recorded. Whole-branch final review
on most capable model; one aggregate fix wave and scoped re-review. Preserve
every ruling/cost in durable handoff. Hand off local branch and explicit remaining
integration authority; no inferred remote merge/publication. Cleanup must not
retry/bypass tool policy or touch retained Security/other worktrees.

## Inline plan self-review

Coverage: Task1 contracts/repository/state; Task2 SDK/IR/private consumed values;
Task3 capture/curl/auth/action/restore; Task4 firstfive; Task5 nextthree; Task6
capstone/catalog/docs/CI. All five Review Focus classes have owning assertions.
HTTP registrations/captures stay out of legacy host union, profile/manifest and
aggregate exports consistent. SDK output/send and request-response failure
boundaries are stated, real local authorization not misrepresented. No new
database/async/server/evaluation dependency. Code snippets specify contracts,
not canned production implementations; runtime DTO handoffs precede consumers.
