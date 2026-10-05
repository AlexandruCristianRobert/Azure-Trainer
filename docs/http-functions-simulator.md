# HTTP Functions simulator

The HTTP Functions journey continues the Order Processing Application through eight guided Labs and one capstone. Every Lab starts independently: resource, SDK client, repository and protected worker prerequisites are supplied as disclosed by its brief. The capstone supplies an empty queue, actual modeled cloud settings and an unfinished order API. No new Lab starts with HTTP captures, requests, acceptance or completion proof. Solutions are hidden on demand; Task Rationale and authored, locally copyable Explanation Prompts remain separate. C# isolated-worker comparisons explain equivalent concepts; only the Python subset executes.

This is a bounded browser simulation. It starts no HTTP server, makes no HTTP/Azure/SDK network call, runs no Python process and installs no production Azure SDK. `DefaultAzureCredential` represents the trainer identity rather than proof of real permissions. The `func-orders.azurewebsites.net` address is deterministic teaching data. There is no deployment pipeline, cloud secret management or background worker.

## Order behavior

An order contains exactly `id`, `region` and `quantity`. The ID matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`; region is `EU` or `US`; quantity is an integer from 1 to 100 and cannot be a boolean. Executed learner code must reject malformed JSON, arrays, missing/extra fields and invalid types/ranges with 400 and no enqueue. The host's input classification never supplies a response on the learner's behalf.

`POST /api/orders` must actually enqueue before a 202 JSON `{id,status:"pending"}` response with `Location: /api/orders/{id}` can earn acceptance credit. A same-payload retry reads the original accepted record and returns 200 with its actual current status and Location without another send. A changed payload under the same ID returns 409 and preserves the original payload and work. A failed enqueue yields a value-free 503 without a new accepted order.

`GET /api/orders/{id}` consumes a repository record for 200 JSON `{id,status}` or returns 404 for an actual missing lookup. Pending means accepted/queued; processed requires matching actual worker work and `record_processed` lineage; failed means terminal dead-letter/expiry without successful work. `python worker.py` explicitly receives, performs work, records processing and completes the actual message. Neither a request nor a host capture runs it implicitly.

`OrderStatusRepository().get(id)` is a trainer-supplied read-only projection of actual retained queue, immutable accepted-payload and worker state. Returned learner fields are `id`, `region`, `quantity`, `status`, or `None` for missing. It is not a production Python package, database, global dictionary or distributed transaction. Acceptance belongs to its app, target and order, with genuine send/message links; a different app cannot claim that acceptance by raw queue lookup. Raw queue fallback is allowed only without an HTTP acceptance for that target/order, for disclosed earlier prerequisites. Captures/restarts and persisted restore retain this teaching view; reset clears it. Requests execute sequentially and synchronously: the retry lesson does not guarantee concurrent idempotency, an atomic outbox or exactly-once production processing.

## Supported commands and saved-source captures

The only HTTP Core Tools forms are `func start` and `func azure functionapp publish func-orders`. The former captures saved sources plus `local.settings.json` for `http://localhost:7071/api/...`; the latter captures the saved project for `https://func-orders.azurewebsites.net/api/...`. Save alone cannot change a running snapshot. Publish/start again after edits. Cloud app settings are read from the actual modeled Function App on every invocation; local settings remain the captured snapshot. Host configuration supports `{"version":"2.0"}` without extra options, and local settings require unencrypted Python plus `AzureWebJobsStorage=UseDevelopmentStorage=true`. Actual resource group, app, storage and supported Python 3.12 / Functions 4 / Linux / Flex Consumption configuration are validated.

Restricted `curl` accepts GET/POST, one URL, `-X`/`--request`, `-H`/`--header`, inline `-d`/`--data`, and presentation-only `-i`/`--include`. Data without an explicit method implies POST. Only the two stated endpoints are admitted. Unsupported flags, data-file `@` forms, external hosts, credentials in URLs, duplicate conflicting headers, ambiguous routes and oversized input diagnose before application effects. Query parameters are bounded ordinary text; query `code` and `Authorization` header authentication are unsupported. An unknown route returns 404; a known route with the wrong method returns 405 and `Allow`.

The capstone is one compact episode after saving its API: publish; keyless POST and GET are rejected; malformed and boolean-quantity POSTs with the demo header are rejected; valid POST is accepted; GET is pending; run `python worker.py`; GET is processed; unchanged POST is reused; changed POST conflicts. Publish and the worker invocation are the only two non-curl commands. Cloud `ENVIRONMENT=published` and `ServiceBusConnection__fullyQualifiedNamespace=sb-orders.servicebus.windows.net` are supplied capstone prerequisites. The publish Lab instead teaches configuring those actual settings.

## Python v2 and SDK subset

HTTP profile `http-functions-v1` and manifest `http-functions-python-v1` reuse the bounded Messaging interpreter. HTTP handlers are a separate registration/capture surface from legacy queue/Event Grid Functions hosts. Supported HTTP calls are:

- `func.FunctionApp(http_auth_level=...)`, `@app.function_name(name=...)`, and `@app.route(route=..., methods=..., auth_level=..., trigger_arg_name=...)`. Routes use literals or whole-segment `{name}` parameters under `/api`, GET/POST methods and one FunctionApp. Omitted methods default to GET/POST. `func.AuthLevel.ANONYMOUS` and `FUNCTION` are the two levels.
- Typed `func.HttpRequest` and `func.HttpResponse` handlers. Requests expose `method`, `url`, `params`, `route_params`, `headers`, `get_json()` and `get_body()` (bytes with supported `decode`). Responses accept text `body`, integer `status_code`, string-entry `headers`, and `mimetype`.
- `OrderStatusRepository()` / `.get(order_id)`, `os.getenv(key, default)`, dictionary `.get(key, default)`, `isinstance(value, str|int|bool|dict|list)`, bounded string iteration, `len`, comparisons, conditionals and ordinary bounded synchronous functions. Boolean is an integer under Python-style `isinstance`, so reject `bool` explicitly before accepting `int`.
- `json.loads`/`dumps`, bounded lists/dictionaries, `str`, `print`, and one `try` / `except ValueError` arm for recoverable JSON parsing. Security, unsupported-syntax and limit diagnostics cannot be swallowed by that arm.
- One optional `@app.service_bus_queue_output(arg_name=..., queue_name=..., connection=...)` and matching `output: func.Out[str]` parameter, with one `.set(text)` value. The connection resolves the actual `ServiceBusConnection__fullyQualifiedNamespace` app setting, rather than trusting a literal queue label.

The shared synchronous Messaging SDK subset remains available: `DefaultAzureCredential()`, `ServiceBusClient(fully_qualified_namespace, credential)`, `ServiceBusMessage(body, message_id, session_id, application_properties)`, queue/topic senders with `send_messages`, queue/subscription receivers with bounded `receive_messages`, and actual-receipt `complete_message`, `abandon_message`, `dead_letter_message`. Queue receivers support `sub_queue`, `session_id`, `max_wait_time`; subscription receivers support topic/subscription, subqueue and wait options. These are modeled calls, not installed SDK objects. The HTTP curriculum uses queue sends and the supplied worker; it adds no Event Grid, database or monitoring lessons. Protected `perform_order_work`, `record_processed` and `was_processed` are teaching helpers.

Only declared imports/call signatures and saved manifest files are admitted. No arbitrary imports/eval, async, blueprints, streams, multipart, admin keys or OAuth are implemented. HTTP expressions combining an unparenthesized leading `not` with `and`/`or` fail closed with a diagnostic: use `(not condition) or other_condition`, `not (condition or other_condition)`, or separate `if` statements. The authored validation uses separate checks. Legacy profile parsing is unchanged; this is a stated HTTP subset limitation, not a general Python parser fix.

## Keys, operation boundaries and evidence

Local Core Tools key enforcement is disabled. Published function-level routes check only the trusted demo fixture through `x-functions-key`, before handler reads or broker work. Missing/wrong keys yield 401; anonymous routes need no key. Both capstone order routes explicitly require function-level access. An explicitly anonymous route is not overridden by a FunctionApp default. Function keys teach access keys, not user identity, RBAC or production authentication.

The fixture key is private trusted Lab input. Key/request/SDK handles cannot be serialized, and guards exclude protected values and sensitive payload fields from public responses, diagnostics, captured settings/source, read evidence and broker data. Ordinary worker execution uses the same protected-value guards. Auth metadata retains a value-free outcome and fixture key ID. Authored demo-only hidden Solution commands deliberately show the dummy key; they are not claimed to be redacted. Explanation Prompts include only authored task/rationale text and omit workspace contents and keys.

`Out[str].set` stages a value. A normal, validated response below 400 permits an actual broker flush; failed response/flush rolls back staged output, yields 503 where appropriate, and creates no staged acceptance. By contrast, a completed SDK send remains accepted even if later handler/response validation fails or its acknowledgement is lost. These distinct boundaries are teaching semantics, not a production distributed transaction guarantee.

Repository/environment fields have private provenance through direct JSON/HttpResponse consumption. An unused lookup followed by a literal matching body cannot earn read credit. Return actual `record.id`/`record.status` or the executed environment value directly; arithmetic/string transformations need not preserve direct-read credit. Unknown lookups prove their actual missing read plus 404; there is no invented missing scalar to consume.

One authoritative `executionReceipts` journal owns captured requests, reads, operations and broker links. Read/operation IDs are invocation-local and must be qualified by both `executionId` and `requestId`; naked IDs from different requests cannot be compared. All retained capstone observations require the current capture, identical saved source contents AND versions, and current resource stamp/generation. Source/resource change and change/revert stale proof; README notes do not. A matching accepted payload, repository read, worker origin, actual binding operation and exactly one enqueue/work are required; status labels alone are insufficient. Historical effects without current task evidence cannot complete a new task. Restore validates snapshots, responses, auth, payload immutability, consumption and cross-command ownership.

HTTP extension version 1 requires `Request.inputClass`, mirrored in its owning `Invocation.inputClass`: a mandatory value-free input category, not the raw body or a body hash. Only a canonical valid order projection may appear as `requestOrder`. This strict version 1 format rejects saves with missing/altered categories. Browser storage provenance is not cryptographic protection against coherent wholesale rewriting of all related records.

## Bounds and reset

Limits fail explicitly rather than evicting lineage needed for current proof. Some combined limits are reached before their individual maxima:

| Surface | Maximum |
| --- | --- |
| Retained HTTP captures across local/published scopes | 16 |
| Accepted orders / retained requests | 50 / 100 |
| HTTP extension encoded state | 256 KiB, with 64 KiB request admission headroom |
| Combined saved source in one capture | 64 KiB |
| Request URL | 2,048 characters |
| Request body / response body / staged output | 16 KiB each |
| Header block | 32 entries and 16 KiB |
| Query entries / route parameters / route declarations | 32 each |
| Manifest files / each file / total project | 16 / 128 KiB / 512 KiB |
| Per-invocation reads / read data / SDK operations | 50 / 64 KiB / 50 |
| Retained executions / messages / teaching records per family | 50 each |
| Source analysis steps / shared VM steps / local call frames | 10,000 / 10,000 / 100 |
| Application data / value nesting | 128 KiB / 100 levels |
| Execution trace, diagnostics, printed lines, retained lock history | 500 each; printed data also 128 KiB |

Reset restores that Lab's supplied prerequisites and clears acceptance, work and verification proof. Persisted source/state are bounded finite typed JSON, not production durability. No real Azure request, Python process or elapsed network waiting is needed for these checks.

## References and focused verification

Production concepts and Python/C# examples are grounded in Microsoft's [HTTP trigger reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger), [Service Bus output binding reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-output), and [AI-200 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200). Their production APIs exceed this trainer's declared subset.

`npm run test:http-functions` runs exactly the seven HTTP owning files (contracts, SDK, engine, basic Labs, hosting Labs, capstone, catalog). Normal Pages CI invokes this focused command before the existing Pages-base build. Local completion uses that aggregate, the six named Messaging/Security/Data compatibility files, and one `npm run build -- --base=/Azure-Trainer/`; it does not run the full, AKS, Container Apps, cloud, Python or browser suites.
