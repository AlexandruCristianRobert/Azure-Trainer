# HTTP Functions Learning Journey design

## Intent and authority

The user chose a complete HTTP Order API, a supplied restart-safe status
repository, same-payload retry reuse and changed-payload 409. On 2026-10-05 they
explicitly delegated remaining recommendations and requested the written plan
then immediate Superpowers implementation. This direction authorizes local
implementation/commits after inspectable artifacts and self-review, not a new
remote merge/publication. Do not restart approval menus for delegated defaults.

## Outcome

Add nine independently startable, code-first Labs to the existing Order
Processing Application. Eight guided Labs progressively construct the API; a
final Capstone integrates it. Learners edit saved Python v2 Functions code,
configure/capture its host, submit bounded simulated HTTP requests and inspect
actual queue/status consequences. Supplied worker/repository prerequisites avoid
another database or Messaging curriculum.

## Global Constraints

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

## Application contract

Order payload is exactly {id, region, quantity}: id matches
^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$, region is EU or US, quantity is a non-boolean
integer 1–100. No extra keys. Malformed JSON, arrays, missing/unknown fields,
wrong types and invalid ranges return 400 from executed learner validation
without enqueueing. A bounded ValueError-only try/except path supports
req.get_json(); security/limit/unsupported errors cannot be swallowed.

POST /api/orders performs real modeled Service Bus queue send before 202,
returning {id, status:"pending"} and Location /api/orders/{id}. A repeated
accepted id with the same normalized payload returns 200 with its actual current
status and the same Location, without sending another message. A different
payload under that id returns 409 and leaves original data/work unchanged.
Failed enqueue returns a value-free 503 and records no new accepted order.

GET /api/orders/{id} returns 200 {id,status} from the actual supplied repository;
unknown id returns 404. Status is pending when accepted/queued, processed only
after actual record_processed work, failed if the retained order is terminally
dead-lettered/expired without successful processing. Notification delivery is
separate. The supplied worker is executed explicitly through python worker.py;
an HTTP request/host capture never silently drains the queue.

The supplied OrderStatusRepository is a read view over actual queue/processed
state plus an immutable bounded accepted-payload ledger tied to genuine send
receipts. It survives capture/publish/restart and persisted restore; reset clears
it. No Python global dictionary, fake database or Azure SDK is presented as
production storage. Requests are serialized synchronous teaching invocations;
no production distributed transaction/concurrent idempotency guarantee is made.

An accepted record owns its app+target+order tuple. If any HTTP acceptance exists
for a target/order, another app cannot bypass that ownership through a raw queue
lookup. Raw queue fallback is allowed only when no acceptance exists for that
target/order, supporting disclosed earlier Messaging prerequisites. Successful
processing needs matching target/order work provenance, not the global processed
flag alone; this view is not seeded HTTP completion proof.

## Curriculum

| Order | ID suffix | New learner construction |
| --- | --- | --- |
| 1 | start | Register GET health, HttpResponse and local host capture |
| 2 | status | Route parameters, repository lookup and real pending/404 responses |
| 3 | validation | POST JSON parsing, ValueError handling, type/range validation |
| 4 | enqueue | SDK send, 202 acknowledgement and Location only after real enqueue |
| 5 | retries | Same-body reuse, changed-body 409 and processed status after worker |
| 6 | publish | Capture deployment; local/cloud settings and executed getenv response |
| 7 | keys | Function-key cloud enforcement, local distinction and value-free proof |
| 8 | binding | Replace SDK send with staged Service Bus queue output binding |
| 9 | capstone | Validated protected published API, binding send, status and retry flow |

Full IDs are http-functions-start/status/validation/enqueue/retries/publish/keys/
binding/capstone. Every new Task begins unfinished; later prerequisites are
independently supplied and disclosed. Capstone keeps newly assigned API code
unfinished while supplying the known worker and resource prerequisites.

## Runtime architecture

Use trusted profile http-functions-v1 and manifest http-functions-python-v1,
runtimeFamily messaging. Base Messaging exports remain available, but HTTP is
not an alias for the Security profile and does not add Key Vault/OTel lessons.
Reuse existing guard policy and private WeakMap handle bridge through a focused
HTTP session. Old profiles/imports/decorators/receipts remain unchanged.

New focused src/lib/http-functions modules:

- contracts.js: canonical order/request/response/route limits and validators.
- orders.js: actual repository view, repeat/conflict decisions and accepted-send
  linkage, not a canned status table.
- state.js: optional HTTP extension, exact snapshots and causal journal checks.
- sdk.js and python.js: explicit HTTP signatures/types and registration analysis.
- values.js and runtime.js: private request/response/repository fields, guarded
  JSON consumption, staged output and protected host/environment access.
- execute.js: local/published captures and execution of captured handler source.
- shell.js and evidence.js: strict intent-only curl/Core Tools effects and
  current source/resource/operation evidence.

program.httpHandlers is separate from program.handlers; HTTP capture lives in
optional runtime.messaging.httpFunctions, not legacy stopped-host records.
Minimal hooks integrate parser, VM, shell, actions, measurements, restoration
and current-evidence checks. Do not replace/copy the Messaging interpreter.

Supported learner surface: func.FunctionApp(http_auth_level?), function_name,
route(route,methods,auth_level,trigger_arg_name), func.AuthLevel.ANONYMOUS/
FUNCTION, func.HttpRequest annotations with method/url/params/route_params/
headers/get_json/get_body, func.HttpResponse(body,status_code,headers,mimetype),
OrderStatusRepository().get(id), os.getenv(name,default), dict.get and
isinstance with str/int/bool/dict/list, bounded string iteration for identifier
validation, one ValueError-only except arm, and
service_bus_queue_output(arg_name,queue_name,connection) with func.Out[str].set.
Only GET/POST routes and one optional output binding are supported. No async,
blueprints, streams, multipart, admin keys, OAuth or arbitrary imports/eval.

Repository/environment scalar fields carry private provenance. JSON serialization
and HttpResponse consumption retain value-free lookup/environment record IDs,
so an unused read followed by a matching literal body cannot earn source-read
credit. Public body values remain ordinary JSON. Private key/request/SDK handles
cannot be serialized; arithmetic/string transformations need not preserve
direct-read credit and this limitation is disclosed.

## Captures and commands

func start validates/captures reached saved sources into a local HTTP host;
curl http://localhost:7071/api/... invokes that snapshot. Save alone does not
change captured source. Local settings come from local.settings.json; no local
key enforcement is claimed. No resident OS server or actual network is started.

func azure functionapp publish func-orders validates/captures the same sources
into the actual modeled application's cloud deployment;
curl https://func-orders.azurewebsites.net/api/... invokes its snapshot.
Cloud settings come from actual Function App appSettings on invocation.
Endpoint name is a deterministic teaching address, not a real globally unique
host or a full Azure deployment pipeline. Missing/deleted/wrong-runtime app and
unsupported host settings fail explicitly before application effects.

Shell supports only GET/POST curl, -X/--request, -H/--header, -d/--data and
-i/--include, plus the two stated Core Tools forms. Unknown flags, external
hosts, duplicate conflicting headers, oversized request and ambiguous routes
diagnose before unrelated effects. Known route/wrong method yields 405 with
Allow; unknown route yields 404 without handler invocation.

Published function-level routes accept the authored demo host key via
x-functions-key only; missing/wrong key returns 401 before handler/broker work.
Anonymous routes require no key. Local requests do not enforce this key, matching
ordinary Core Tools behavior. Key fixture belongs to trusted Lab input and
never appears in public captures/evidence/response or GPT prompts. This is
function access-key teaching, not user identity, RBAC, cryptographic browser
storage protection or real secret management.

Output binding stages a single string in Out[str].set. Validate response first;
flush through the actual broker on normal return, then finalize acceptance and
HTTP success. Failure before/during flush commits no staged message/acceptance
and cannot report 202. SDK sends that genuinely complete remain accepted even
if the handler later errors or loses its response; a retry must reuse that
acceptance. Document these distinct transactional teaching boundaries.

## State, evidence and bounds

HTTP extension version1 has nextId, localHosts, deployments, accepted and
requests, plus currentLocal/currentPublished app-to-capture ID maps. The host
and deployment arrays retain historical snapshots separately from current
selection; replacing an active capture does not delete its referenced sources.
Captures store reached sources/versions/routes and logical createdAtMs, and are capped at
16 across scopes. Accepted records <=50, requests <=100, exact ordered IDs and
finite values; total extension <=256 KiB. Captured sources per host <=64 KiB,
request URL <=2048 chars, raw body/response <=16 KiB, headers/query/route params
<=32 entries. Manifest <=16 files, 128 KiB/file, 512 KiB project total; existing
VM steps/frames remain bounded. Reject limits atomically; never evict lineage
needed by current proof.

Each request receipt identifies actual app/capture scope+generation, canonical
method/path, masked authorization result, operation/read IDs, actual response,
linked send/worker receipt IDs and command snapshot boundaries. Caller effects
contain intent only, never success flags, records or authoritative principal.
Accepted-send ownership is derived from these request references and the one
execution journal; admission and grading must check the same app, capture
generation, invocation and command, not merely the existence of a send trace.
Relevant file/resource/capture generations stale proof, including change/revert;
unrelated README edits do not. Restore rejects altered response, accepted payload,
auth metadata, read-consumption links, broker linkage and crossed command
boundaries. Historical valid effects do not become proof for an unfinished Task.

## Verification and delivery

One Solution replay per Lab, unfinished baseline/persistence loop and compact
negatives, with independent task review and a final whole-branch review.
Focused owning files only during development. Final gate: new-journey aggregate,
small Messaging/Security/Data compatibility sample and one Pages-base build.
Include a focused package script and normal Pages CI step, without running
excluded suites locally. Report dependency setup advisories separately; do not
force-upgrade existing packages or bypass workflow checks. Hand off reviewed
local branch; obtain merge/publication authority if requested later.

## Primary references checked 2026-10-05

- [AI-200 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200)
- [HTTP trigger, Python v2 and local/key distinctions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger)
- [Service Bus output binding and Out[str]](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-output)
