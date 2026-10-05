# Security and Observability simulator

This twelve-Lab journey continues the Order Processing Application in saved Python source. Labs 1–5 cover identity, Key Vault consumption, rotation, labeled configuration and refresh. Labs 6–11 cover export, spans/failures, propagated context, safe logs, failure queries and metrics. Lab 12 combines the application in one bounded exercise: `func start`, then `python worker.py` to query the final exported dataset. All Labs belong to `security-observability` / Skill Area `secure`; Labs 1–11 are Guided and Lab 12 is a Capstone.

## Execution and independent baselines

The browser parses a bounded Python subset and interprets modeled operations. It never installs Python, executes host code, invokes subprocesses or sends Azure/SDK network calls. Protected `requirements.txt` and `training_runtime.py` describe the supported adapter surface; they are not production dependencies being installed. Unsupported imports, syntax, SDK options and KQL produce explicit diagnostics. Only each Lab's declared entry commands execute; ordinary script Labs use `python worker.py`, the context Lab uses `func start`, and the Capstone permits those two commands.

Every Lab independently supplies its disclosed earlier resources, source and fresh input. It supplies no prior execution journal, effects, exported rows, query results or completion proof. Newly assigned Tasks are unfinished. Reset restores this baseline. Later source may contain completed earlier-stage operations, which run now; they are not seeded evidence. Solutions remain on demand, Task Rationale remains separately collapsed, and locally copyable Explanation Prompts contain authored concepts rather than workspace contents.

Relevant saved-file or resource edits invalidate completion, including change/revert. README notes do not. All source reached during execution must be a declared dependency. Query evidence includes parsed expressions, actual input row/export IDs and computed rows. Restore validates typed bounds, causal journal linkage and recomputes queries over their journal prefix. New exports make older query completion stale. These are local simulation integrity checks, not a cryptographic boundary against a user rewriting browser storage.

## Identity, credentials and privacy

`DefaultAzureCredential()` resolves the actual principal attached to `func-orders`; optional `managed_identity_client_id="..."` selects an attached user-assigned identity. The learner's provisioning session does not grant application read authority. The exact vault scope needs Key Vault Secrets User or a supported read-capable role; App Configuration needs App Configuration Data Reader at its exact store scope. Broad subscription/group inheritance, production token chains and network authentication are not modeled.

All supplied keys are demo fixtures. Never enter real credentials. CLI secret creation/inspection can display demo values, and command history/source remain visible; `--output none` suppresses successful CLI result data, not typed commands/history or errors. Application `secret.value` and resolved Key Vault references are opaque private handles. Only the modeled notification consumer unwraps them. Printing, returning, logging or JSON-serializing these handles is rejected or sanitized. Public execution records carry version/read/principal metadata rather than secret content or hashes. Payload/credential-bearing telemetry is rejected; exception text is omitted. Ordinary safe metadata includes order IDs, attempt numbers, channels and status codes. Browser-local resource storage is not a real secret vault.

## Supported security SDK syntax

```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from azure.appconfiguration.provider import load, SettingSelector, WatchKey
from training_runtime import send_notification, advance_security_fixture

credential = DefaultAzureCredential()
client = SecretClient(vault_url="https://kv-orders.vault.azure.net", credential=credential)
secret = client.get_secret("notification-api-key")  # optional version="32-character-version"
version = secret.properties.version
result = send_notification("e-o1", "o1", secret.value, "email")

config = load(endpoint="https://ac-orders.azconfig.io", credential=credential,
    selects=[SettingSelector(key_filter="Orders:*", label_filter="production")],
    refresh_on=[WatchKey("Orders:Sentinel", label="production")], refresh_interval=30,
    keyvault_credential=credential, secret_refresh_interval=60)
result = send_notification("e-o1", "o1", config["Orders:ApiKey"], config["Orders:Channel"])
config.refresh()
```

Call examples above belong inside the Lab's saved entry/callback as its Task directs. Secret `name` and `properties.version` are metadata; an omitted version reads latest. The provider returns a mapping accessed by exact key. Selectors support an exact key, `*`, or one trailing wildcard, and exact labels; selectors/watch keys use Python lists, not sets. Refresh intervals are positive whole logical seconds (up to 86400). `refresh()` acts on the same provider, with settings and secret caches tracked independently. Supported provider channels are `email`, `sms`, and `console`. `send_notification` returns safe `status_code` / `channel`: 202 for an actually read accepted key, otherwise 401. Event Grid invocations use the received event and order IDs. Reading an unused key does not count.

`advance_security_fixture()` is a trainer control with no caller arguments, not an Azure SDK API. Rotation Lab 3 requires the learner to create demo v2; its fixture changes only independent provider acceptance, allowing latest success and old pinned-version rejection. Refresh Lab 5 advances 60 logical seconds, changes production channel/sentinel and privately rotates the accepted key; its next advance rotates only the key. Both refreshes must use the original provider, `WatchKey("Orders:Sentinel", label="production")`, `refresh_interval=30` and `secret_refresh_interval=60`. These fixtures are explicitly disclosed in each Lab. No fixture changes are accepted from action payloads. Labs 7/10/11 disclose their own rejected-consumer fixture; the Capstone performs no rotation.

## Supported CLI forms used by this journey

Use actual IDs shown in the Lab in place of angle-bracket placeholders; these are syntax examples, not shell variable expansion.

```text
az functionapp identity assign -g rg-messaging -n func-orders --identities <identity-resource-id>
az role assignment create --scope <vault-resource-id> --role "Key Vault Secrets User" --assignee-object-id <identity-principal-id> --assignee-principal-type ServicePrincipal
az role assignment create --scope <store-resource-id> --role "App Configuration Data Reader" --assignee-object-id <identity-principal-id> --assignee-principal-type ServicePrincipal
az keyvault secret set --vault-name kv-orders --name notification-api-key --value trainer-demo-key-v2 --output none
az keyvault secret list --vault-name kv-orders
az keyvault secret list-versions --vault-name kv-orders --name notification-api-key
az keyvault secret show --vault-name kv-orders --name notification-api-key --version <version>
az keyvault secret set-attributes --vault-name kv-orders --name notification-api-key --version <version> --enabled false
az appconfig create -g rg-messaging -n ac-orders --sku Free
az appconfig show -n ac-orders
az appconfig kv set -n ac-orders --key Orders:Channel --label production --value email --yes
az appconfig kv set-keyvault -n ac-orders --key Orders:ApiKey --label production --secret-identifier https://kv-orders.vault.azure.net/secrets/notification-api-key --yes
az appconfig kv show -n ac-orders --key Orders:Channel --label production
az appconfig kv list -n ac-orders --label production
```

Setting writes require `--yes`. An omitted label addresses the unlabeled value, not production. App Configuration supports Free/Standard creation, exact-label list/show, ordinary values with optional `--content-type`, and versioned or versionless Key Vault references. Command `--help` shows the modeled options. The supplied baselines avoid requiring a second provisioning track.

## Supported telemetry SDK syntax

```python
from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry import trace, propagate, metrics
from opentelemetry.trace import SpanKind, Status, StatusCode
import logging

configure_azure_monitor(connection_string="<copy trainer value from local.settings.json>", logger_name="orders")
tracer = trace.get_tracer("orders")
incoming = {"traceparent": msg.application_properties["Diagnostic-Id"]}
with tracer.start_as_current_span("ProcessOrder", context=propagate.extract(incoming),
        kind=SpanKind.CONSUMER, attributes={"app.order_id": order["id"]}) as span:
    span.set_attribute("app.attempt", 1)
    carrier = {}
    propagate.inject(carrier)

logger = logging.getLogger("orders")
logger.setLevel(logging.INFO)
logger.info("Notification accepted", extra={"app.order_id": "o1", "app.status_code": 202})
meter = metrics.get_meter("orders")
attempts = meter.create_counter("orders.attempts")
latency = meter.create_histogram("orders.duration", unit="ms")
attempts.add(1, attributes={"app.order_id": "o1"})
latency.record(20)
```

The snippet shows signatures; the Lab places them around actual received work. Available span kinds: INTERNAL, SERVER, CLIENT, PRODUCER, CONSUMER. `trace.get_current_span()`, `span.add_event(name, attributes={...})`, `span.set_status(Status(StatusCode.ERROR))`, and `span.record_exception(ValueError("..."))` are supported; statuses are UNSET/OK/ERROR. `propagate.inject(carrier, context=...)` accepts an optional modeled context; `extract(carrier)` reads W3C `traceparent`. The Functions exercise maps the actual Service Bus Diagnostic-Id to that carrier, injects the active publishing span into Event Grid data.trace_context and explicitly extracts it in the real notification callback. Inheriting a host root alone does not satisfy that Task.

Logging supports `info`, `warning`, `error` and INFO/WARNING/ERROR levels with safe `extra` metadata. Counter/histogram creation accepts name, optional unit/description; add/record accept amount and optional attributes. The pre-provisioned destination is `ai-orders`; the trainer connection string selects it without opening a connection. The manual host profile uses `host.json` telemetryMode `OpenTelemetry` and `PYTHON_APPLICATIONINSIGHTS_ENABLE_TELEMETRY=false` with explicit `configure_azure_monitor`.

| Table | Modeled contents |
| --- | --- |
| AppRequests | SERVER/CONSUMER spans, including Function host roots |
| AppDependencies | Other spans, including producer/internal work |
| AppTraces | Structured logs and supported span events |
| AppExceptions | Sanitized exception type, without exception text |
| AppMetrics | Individual counter/histogram measurements |

`OperationId` is the trace ID, `Id` is the span ID and `ParentId` links its parent. Workspace-style table/column casing is exact; classic lowercase Application Insights aliases are not supported. `DurationMs` adds deterministic modeled operation cost, never wall-clock latency, SDK performance or an Azure SLA. No production sampling, ingestion delay, distributed transactions or atomic outbox is simulated. Duplicate business work is prevented with the application's modeled marker.

## Supported KQL and numeric lineage

```python
from training_runtime import query_telemetry
query = "AppRequests | where Name == 'NotifyOrder' | summarize Notifications=count(), Failures=countif(Success == false), MeanMs=avg(DurationMs)"
return query_telemetry(query)
```

`query_telemetry` is a protected trainer helper returning `{rows}` from retained exports; it needs no exporter setup of its own. The supported pipeline operators are `where`, `project`, `extend`, `summarize ... by ...`, `order by` (asc/desc), and `take`. Expressions support fields, `Properties['key']`, string/number/boolean/null literals, parentheses, comparisons `== != < <= > >=`, `and`/`or`, arithmetic `+ - * / %`, and conversions `tostring`, `toint`, `todouble`. Aggregates are `count()`, `countif(predicate)`, `sum`, `avg`, `min`, `max`. Unsupported operators/functions fail explicitly, including arbitrary host expressions and logical `not`. Queries are bounded to 16 KiB, 16 operators, 500 input rows and 200 output rows.

Returned numeric query cells are ordinary public JSON numbers. Assigning a cell preserves private same-execution query/row/column provenance for a direct histogram `record(row["DurationMs"])`. Arithmetic or string/JSON conversion loses that direct-cell credit. Literal histogram values remain supported, but an equal literal plus an unused query cannot satisfy Lab 11's query-derived duration Task. Final aggregate checks inspect parsed computation and actual row lineage rather than matching Solution source or accepting printed totals.

The manifest permits at most 16 files, 128 KiB per file and 512 KiB total. Runtime permits 50 command receipts, 500 security records and 500 telemetry rows with a 128 KiB security/observability extension bound. Reset for a fresh exercise before reaching those limits; required lineage is not silently evicted.

## C# parallels and primary references

`SecretClient.get_secret` parallels `SecretClient.GetSecret`; credential/identity attachment and authorization are separate in both languages. Selected App Configuration providers and explicit refresh correspond to the C# configuration provider/refresher concepts. Tracers, span attributes/status and propagated context parallel `ActivitySource`, Activity tags/status and `ActivityContext`. Python meter instruments parallel C# Meter counters/histograms. The editable track remains Python and these adapters support only the documented subset.

Primary references for the production concepts (not claims of full simulator parity): [Microsoft Key Vault Python quickstart](https://learn.microsoft.com/en-us/azure/key-vault/secrets/quick-create-python), [Microsoft App Configuration Python provider quickstart](https://learn.microsoft.com/en-us/azure/azure-app-configuration/quickstart-python-provider), [Microsoft Azure Monitor log queries](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/log-query-overview), and [OpenTelemetry Python instrumentation](https://opentelemetry.io/docs/languages/python/instrumentation/). Links were checked during this integration.

## Focused verification budget

Run `npm run test:security-observability` for exactly the nine owned files. Publication additionally uses `npx vitest run tests/messaging-engine.test.js tests/messaging-functions.test.js tests/data-python-sdk.test.js tests/data-capstone-core.test.js` and one `npm run build -- --base=/Azure-Trainer/`. Pages CI runs this focused journey script alongside the existing focused Data and Messaging checks. Do not replace these with the full test suite or add AKS, Container Apps, cloud, Python-process or broad browser suites. Time every test/diagnostic/build attempt, including failures and CI, with a cumulative 30-minute publication verification cap; reduce/refactor checks if that cap is approached. An existing bundle-size advisory is recorded separately from functional failures.
