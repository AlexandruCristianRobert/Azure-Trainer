# Security and Observability Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver twelve code-first Security and Observability Labs for the existing Order Processing Application and publish them.
**Architecture:** Add the trusted `security-observability-v1` profile to the existing Messaging Python parser/VM. Focused security and telemetry modules own typed operations; one optional `runtime.messaging.securityObservability` extension and the existing executionReceipts journal retain atomic command evidence. Evaluate real KQL strings from saved Python source through a clearly named protected trainer helper, avoiding a second runner or shell protocol.
**Tech Stack:** Existing Vue 3, JavaScript ES modules, Lezer Python IR and Vitest. No new runtime dependencies.
**Spec:** `docs/superpowers/specs/2026-10-02-security-observability-journey-design.md`
**Execution authority:** User explicitly requested autonomous recommended design, plan then Superpowers implementation, merge and publish. Do not add approval pauses.

## Global Constraints

- Exactly 12 Labs, journeyId `security-observability`, skillAreaId `secure`; Labs 1–11 guided and Lab 12 capstone.
- Continue the existing Order Processing Application; browser-only bounded simulation, no live Azure, network SDK calls, installed Python or real credentials.
- Use saved Python source, meaningful simulated SDK operations and actual resource authorization; never exact-match Solution text or grade an unused secret lookup.
- Keep Solutions hidden on demand, Task Rationale separately collapsed and Explanation Prompts locally copyable; prompts contain authored concepts only, no workspace data or credentials.
- Independently supplied earlier-stage baselines contain no completion proof; every newly assigned Task starts unfinished.
- One compact behavior exercise per Lab; no Guided/Troubleshooting/Independent triples, repeated experiment padding or additional Functions/App Service track.
- Preserve existing Messaging and Data behavior and the unrelated approved journey-width CSS change.
- No AKS, Container Apps, full legacy replay, cloud or broad browser test suites. Time every executable test, diagnostic and build attempt including failures, reruns and CI; reduce/refactor checks if cumulative verification exceeds 30 minutes per Lab publication.
- Unsupported source, SDK, CLI or KQL input must produce an explicit diagnostic before unrelated side effects; arbitrary host code, eval, subprocess and network execution remain unavailable.
- Resource authorization uses the application's attached principal at exact supported scopes; learner provisioning authority is not application read authority.
- Public execution traces, telemetry, diagnostics and evidence must not expose demo secret values or sensitive payload values; secrets remain confined to explicitly modeled Key Vault/configuration and opaque consumer handles.
- Evidence comes only from the current execution and actual consumed values, spans or query rows; relevant saved-file/resource changes and change/revert invalidate proof. Unrelated notes do not.
- Persisted runtime and evidence are finite typed bounded data with causal journal linkage; reset clears proof and restores the supplied baseline.

## Review Focus

1. Existing but unattached identity, client/principal ID confusion and wrong-scope role must deny actual runtime read (Task 1/2).
2. A cached or pinned old credential must not pass rotation; restart/reload must not pass same-provider refresh (Task 2/5).
3. Return, error, limit and sibling callback must restore span context; missing/forged carriers must not pass correlation (Task 3/6).
4. Sensitive print, JSON, exception, span, log and query paths must not disclose values or let auto-redaction count as learner success (Task 2/3/4).
5. Restore mutation, source/resource change-revert and stale query dataset must not revive completion (Task 2/4/7).

## Files and responsibilities

- `src/lib/security/{identity,appconfiguration,notifications,sdk,state,evidence}.js`: runtime principal, provider caching, accepted-key consumer, bounded SDK dispatch, public typed records and journal linkage.
- `src/lib/sandbox/appconfiguration.js`, existing identity/functions/keyvault/model/ops: provisionable exact-scope resources and cleanup.
- `src/lib/az/commands/appconfig.js`, existing role/functionapp/index and ARM presenters: narrow supported CLI.
- `src/lib/observability/{sdk,runtime,export,privacy,kql}.js`: explicit instrumentation, context, table projection, safe emission and actual query evaluation.
- Existing Messaging parser/VM/execute/functions/state/actions/evidence: profile-gated integration, manifest-selected scaffolding and original journal.
- `src/data/templates/security-python/{manifest,runtime,security,telemetry}.js`: protected requirements/helpers and saved learner source.
- `src/data/labs/security-journey/{helpers,seeds,index,identity,secrets,rotation,configuration,refresh,telemetry-setup,spans,context,logging,failure-query,metrics,capstone}.lab.js` (helpers/seeds/index use .js): curriculum; no duplicated interpreter.
- Focused tests `tests/security-{resources,sdk,state,labs}.test.js`, `tests/observability-{sdk,kql,labs}.test.js`, `tests/security-observability-{capstone,catalog}.test.js`.
- Registry, HomePage, package scripts, Pages CI and `docs/security-observability-simulator.md`: discovery and publication.

## Shared runtime contract

Trusted Lab capability `securityObservability: true` selects parser profile `security-observability-v1`; old Labs retain default profile. `messagingInput.securityObservability` is authored Lab configuration, never an action-supplied principal or measurement. It contains `appId`, demo notification provider configuration and a bounded optional refresh fixture. Actual attachment/resources resolve from Sandbox.

```js
// Optional extension absent in old Labs.
emptySecurityObservabilityState()
// => {version:1,nextId:1,timeMs:0,records:[],telemetry:[]}
// records <=500, telemetry <=500, no eviction that silently discards required lineage.
// Operation records have unique so-N IDs and finite typed safe public fields.
// Telemetry rows have unique IDs and explicit table/destination/operation lineage.
validateSecurityObservabilityState(value) // boolean; exact schemas, <=128KiB total
// New-profile measurements only:
securityObservability: {
  version: 1, startSequence, endSequence,
  records, telemetry // exact newly committed records/rows, public safe snapshots
}
```

The existing executionReceipts journal remains authoritative. Optional measurement field is admitted only for the new capability/profile. State/journal admission checks monotonic sequence, exact snapshots and latest runtime anchoring; ordinary Messaging measurements retain their original closed schema. Actual exported/query/provider operation records satisfy the new profile activity predicate; merely creating handles or printing does not.

Secret values remain private VM handles with actual read provenance. `secret.value` and reference lookup return secret-bearing tokens, unwrapped only by the provider. Public return/print/json/error/telemetry fail or redact before output/persistence and record only violation category. Use metadata-only resource selectors; never whole vault snapshots or secret hashes. Secret reference URI/version is metadata, not credential content.

New manifest `security-python-v1`, runtimeFamily `messaging`, maximum16 files/128KiB each/512KiB total, protected requirements/runtime chosen from actual manifest. Keep Python shell entries already supported (`worker.py`, `events.py`, `handler.py`, `function_app.py`), preserving `python entry.py` and `func start`.

Tests use PowerShell Stopwatch around each executable command. Report command, RED/GREEN raw output, elapsed seconds (all attempts) and cumulative total. Run only the task's owning file(s), never the package-wide test command. No repeated builds per curriculum Lab.

### Task 1: Provisionable application identity, Key Vault access and App Configuration

**Files:** Modify `src/lib/sandbox/{model,functions,identity,keyvault,ops}.js`, `src/lib/az/{functions-arm,keyvault-arm}.js`, `src/lib/az/commands/{functionapp,role,index}.js`; create `src/lib/sandbox/appconfiguration.js`, `src/lib/az/{appconfiguration-arm}.js`, `src/lib/az/commands/appconfig.js`, `src/lib/security/identity.js`; test `tests/security-resources.test.js`.
**Interfaces:** Produce `resolveRuntimePrincipal(sandbox,{appId},credentialOptions={})` returning actual attached managed identity IDs, `readSecretAsPrincipal(sandbox,{vaultUrl,name,version},principal)` returning actual secret version/value internally, and App Configuration CRUD/role helpers. Export `appConfigurationId(store)`, `getAppConfiguration(sandbox,resourceGroup,name)`, `createAppConfiguration(sandbox,options)`, `setAppConfigurationValue(sandbox,options)`, `listAppConfigurationValues(sandbox,options)`, `readAppConfigurationAsPrincipal(sandbox,options,principal)`. Mutation helpers return `{sandbox,resource}`.

- [ ] Write `security-resources.test.js` with actual Sandbox+CLI setup: managed identity creation, Function attachment, learner-only read denial, correct Secrets User read, wrong vault denial, unattached identity denial, and labeled settings isolation.
```js
expect(() => resolveRuntimePrincipal(sb, {appId}, {managed_identity_client_id: wrongClientId})).toThrow()
expect(() => readSecretAsPrincipal(sb, {vaultUrl, name:'notification-api-key'}, principal)).toThrow()
expect(readSecretAsPrincipal(authorized, {vaultUrl,name:'notification-api-key'}, principal).value).toBe('demo-key-v1')
expect(listAppConfigurationValues(configured,{resourceGroup:'rg-messaging',name:'ac-orders',label:'production'})[0].value).toBe('email')
```
- [ ] Timed RED: `npx vitest run tests/security-resources.test.js`; expected missing helpers/commands.
- [ ] Implement exact-scope authorization. Preserve learner-default Key Vault CLI and vault-local assignments; add valid attached ServicePrincipal support, no global permissive fallback. Secrets User ID `4633458b-17de-408a-b874-0445c86b69e6`; App Configuration Data Reader ID `516239f1-63e1-4d78-a4de-a74fb236a071`.
```text
az functionapp identity assign --resource-group rg-messaging --name func-orders --identities <actual identity ARM ID>
az functionapp identity show --resource-group rg-messaging --name func-orders
az functionapp identity remove --resource-group rg-messaging --name func-orders --identities <actual identity ARM ID>
az appconfig create --resource-group rg-messaging --name ac-orders --location westeurope --sku Free
az appconfig show --resource-group rg-messaging --name ac-orders
az appconfig kv set --name ac-orders --key Orders:Channel --label production --value email --yes
az appconfig kv show --name ac-orders --key Orders:Channel --label production
az appconfig kv list --name ac-orders --label production
az appconfig kv set-keyvault --name ac-orders --key Orders:ApiKey --label production --secret-identifier https://kv-orders.vault.azure.net/secrets/notification-api-key --yes
```
Model optional `appConfigurationStores` for backward-compatible old persisted Sandbox; absent normalizes to[] before creation. Store keys/labels case-sensitive, no-label distinct from named label; <=50 settings/store and bounded strings. Exact store scope Data Reader role; learner CLI provisioning not runtime credentials. Reference content type `application/vnd.microsoft.appconfig.keyvaultref+json;charset=utf-8` and JSON URI, no copied secret. Monotonic revisions support freshness. Function identity deletion/group deletion removes attachments and assignments, including nested vault roles.
- [ ] Timed GREEN owning tests plus `tests/messaging-functions.test.js` only if changed Functions model shape requires compatibility.
- [ ] Self-review scope/cleanup/type guards and commit `feat: add scoped application identity and configuration resources`.

### Task 2: Source-driven secret consumption, refresh and evidence foundation

**Files:** Create `src/lib/security/{appconfiguration,notifications,sdk,state,evidence}.js`, `src/data/templates/security-python/{manifest,runtime}.js`; modify `src/lib/messaging/{python,vm,execute,functions,state,actions,evidence}.js`, `src/lib/labEngine/run.js`, `src/lib/project/manifests.js`; tests `tests/security-sdk.test.js`, `tests/security-state.test.js`.
**Consumes:** Task1 actual principal/secret/App Configuration APIs.
**Produces:** the Shared runtime contract, trusted parser profile; `createSecuritySession(context)` SDK adapter with `call(name,owner,bound,loc)` and `member(owner,name,loc)`, public state/measurement helpers, manifest. Exact dispatch mechanics may use a tagged handled/not-handled result; no arbitrary host objects exposed.
- [ ] Write focused source-execution tests: authentic SDK retrieval yields a provenance-bearing token accepted by provider; literal key/old key/unattached principal rejected; same provider refresh consumes changed label/secret; early refresh is no-op. Write state tests for tampered record, overflow, unsafe keys and metadata privacy.
```python
from azure.identity import DefaultAzureCredential
from azure.keyvault.secrets import SecretClient
from training_runtime import send_notification
def main():
    credential = DefaultAzureCredential()
    client = SecretClient(vault_url="https://kv-orders.vault.azure.net", credential=credential)
    secret = client.get_secret("notification-api-key")
    return send_notification("e-o1", "o1", secret.value, "email")
```
```js
expect(result.state.securityObservability.records.at(-1)).toMatchObject({kind:'notification-provider',statusCode:202})
expect(JSON.stringify(publicMeasurement)).not.toContain('demo-key-v1')
expect(validateSecurityObservabilityState({...state, records:[{kind:'secret-read',value:'leak'}]})).toBe(false)
```
- [ ] Timed RED owning2 test files.
- [ ] Implement explicit exports/signatures/types, keyword-only selector constructors and profile-gated module initializer admission:
```python
SecretClient(vault_url, credential)
client.get_secret(name, version=None)
secret.name
secret.properties.version
secret.value
SettingSelector(key_filter="Orders:*", label_filter="production")
WatchKey("Orders:Sentinel", label="production")
load(endpoint=endpoint, credential=credential, selects=selectors,
     refresh_on=watch_keys, refresh_interval=30,
     keyvault_credential=credential, secret_refresh_interval=60)
config["Orders:Channel"]
config.refresh()
send_notification(event_id, order_id, api_key, channel)
advance_security_fixture()
```
Use lists for selectors/watch keys because bounded Python set literals are unsupported; disclose this supported subset. `DefaultAzureCredential(managed_identity_client_id=clientId)` is bounded managed-identity selection; default resolves the one attached identity, never learner fallback. Secret handle provenance includes exact principal/read/version; fail disabled/latest missing rather than fall back.
Notification provider accepted-key state is distinct from vault versions. Return safe `{status_code:202|401,channel}`, record actual consumed version, configured channel and current invocation linkage. Only accepted genuine credential creates notification business effect. Function calls must bind current Event Grid delivery/attempt; script calls use explicit authored demo operation input and cannot prove Function invocation. Old `record_notification` cannot pass secure tasks.
App Configuration provider cache/IDs private and execution-local; ordered selectors literal/*/terminal prefix only. `refresh()` checks logical interval/sentinel; retains last-good cache on expected refresh failure. Secret refresh interval independent. `advance_security_fixture()` is protected trainer-only, enabled only by an authored <=3-step Lab fixture; it advances logical time and applies disclosed config/secret/provider changes to the session's resource view, not notifications/proof. Reject arbitrary caller changes. This allows Lab5 same-provider refresh in one script without making restart count.
Select fixed scaffolding from the actual manifest, not hardcoded Messaging files; include all reached sources as dependencies. New source imports unavailable in old profile. Restore/rollback extension atomically with incomplete broker callbacks, preserving completed siblings. Validate optional measurements, exact journal snapshots and current-state boundaries, before recordVerification. Do not blanket accept authorization diagnostics as successful.
- [ ] Timed GREEN owning tests + one targeted `tests/messaging-engine.test.js` compatibility run. Include print/json/return/error leak probes, change-revert and ordinary receipt restore.
- [ ] Self-review public snapshots and commit `feat: execute secure credential consumers and cached configuration`.

### Task 3: Real bounded OpenTelemetry spans, context, logs and metrics

**Files:** Create `src/lib/observability/{sdk,runtime,export,privacy}.js`; extend `src/lib/security/{state,evidence}.js`, Messaging parser/VM/Functions integration; test `tests/observability-sdk.test.js`.
**Consumes:** trusted profile/private SDK handle bridge and optional extension from Task2.
**Produces:** `createTelemetrySession(context)`; Application Insights workspace-compatible typed rows in existing extension; `telemetryDataset(state)` immutable projected rows; operation-to-active-span linkage for actual security/business calls.
- [ ] Write RED source tests for explicit configured exporter, span context manager, nested return/error restoration, carrier injection/extraction through actual published/delivered event, safe logger, attempted sensitive emission, and metrics from actual operation results.
```python
from azure.monitor.opentelemetry import configure_azure_monitor
from opentelemetry import trace, propagate, metrics
import logging
configure_azure_monitor(connection_string="InstrumentationKey=00000000-0000-4000-8000-000000000001;IngestionEndpoint=https://ai-orders.training.invalid/", logger_name="orders")
tracer = trace.get_tracer("orders")
logger = logging.getLogger("orders")
def main():
    with tracer.start_as_current_span("NotifyOrder") as span:
        span.set_attribute("app.order_id", "o1")
        logger.info("Notification attempted", extra={"app.order_id": "o1"})
```
```js
expect(rows.find(r=>r.table==='AppDependencies').Name).toBe('NotifyOrder')
expect(child.OperationId).toBe(parent.OperationId)
expect(child.ParentId).toBe(parent.Id)
expect(publicJson).not.toContain('demo-key-v1')
expect(measurement.records.some(r=>r.kind==='privacy-violation')).toBe(true)
```
- [ ] Timed RED owning test file.
- [ ] Implement supported real APIs: `configure_azure_monitor(connection_string,logger_name)`, `trace.get_tracer`, `trace.get_current_span`, `tracer.start_as_current_span(name,context=None,kind=SpanKind.INTERNAL,attributes=None)`, `span.set_attribute/add_event/record_exception/set_status`, `Status(StatusCode.ERROR)`, `propagate.inject/extract`, `logging.getLogger`, `logger.setLevel/info/warning/error`, `metrics.get_meter`, `meter.create_counter/create_histogram`, `counter.add`, `histogram.record`. Explicit signatures and static types; unsupported options diagnostic.
Use private span/context tokens and finally restore parent on return/error/limit. Span without `as` supported for normal Python usage. Trace IDs32hex/span IDs16hex/W3C valid traceparent; reject malformed carrier. `ServiceBusMessage.application_properties` and Function received application_properties readonly data subset; explicitly convert Service Bus `Diagnostic-Id` to propagator traceparent. Event Grid application data `trace_context` carrier, not unsupported CloudEvent extensions. Function siblings restore root and distinct attempts.
Use configured simulated ai-orders destination encoded by trainer connection string; no new cloud resource family required. Explain destination pre-provisioned in README and learner config code sets exporter. Validate selected host configuration on new-profile Functions (`telemetryMode:OpenTelemetry`, explicit Python telemetry setting); old hosts unaffected.
Workspace tables `AppRequests/AppDependencies/AppExceptions/AppTraces/AppMetrics`; PascalCase columns and `Properties`, `OperationId`, `ParentId`, `_ResourceId`, `AppRoleName`, `ItemCount`. Actual spans project based on explicit kind (SERVER/CONSUMER requests, others dependencies); actual escaped ValueError records sanitized exception+ERROR status.
Logical costs from actual operations, not user duration/timestamps; label simulated. Max100 spans/command,16 nested,32attributes,500rows/attempt,128KiB state; reject overflow before partial inadmissible commit. Privacy rejects sensitive names/values and arbitrary sensitive payload fields; record only violation categories and fail task despite safeguard redaction. Preserve useful safe order/attempt/channel metadata.
- [ ] Timed GREEN owning file + narrow Functions context case. No build.
- [ ] Self-review rollback/context/privacy/closed schemas; commit `feat: instrument bounded application telemetry and context`.

### Task 4: Actual KQL evaluation and query lineage

**Files:** Create `src/lib/observability/kql.js`; extend observability SDK/runtime, security state/evidence and parser exports; test `tests/observability-kql.test.js`.
**Consumes:** `telemetryDataset(state)` typed rows, profile/public operation records.
**Produces:** `parseQuery(text)` and `executeQuery(ast,dataset,limits={})`; protected `training_runtime.query_telemetry(query)` returns `{rows}` computed from exported rows and records safe query receipt with exact selected row IDs/input generation/result.
- [ ] Write RED deterministic data tests, strings containing quoted pipes, malformed pipeline rejection, missing/null fields, empty aggregation, arithmetic division guard, lineage mutation and unsupported join.
```js
const query='AppRequests | summarize Total=count(), Failed=countif(Success == false), MeanMs=avg(DurationMs) by Name | extend FailureRate=100.0 * Failed / Total'
expect(executeQuery(parseQuery(query),dataset).rows).toEqual([{Name:'NotifyOrder',Total:2,Failed:1,MeanMs:15,FailureRate:50}])
expect(()=>parseQuery('AppRequests | join AppTraces')).toThrow()
expect(executeQuery(parseQuery('AppRequests | where Name == "a|b" | project Name'),dataset).rows).toEqual([])
```
- [ ] Timed RED single owning file.
- [ ] Implement tokenizer+bounded AST, no eval/regex query-recognition. Tables above; operators `where/project/extend/summarize/order by/take`; comparison/and/or, numeric arithmetic, `Properties["key"]`, `tostring/toint/todouble`; aggregates `count/countif/sum/avg/min/max`. <=16KiB source,16operators,500input,200output. Quoted pipes not delimiters. Invalid numeric conversion/null documented; empty ungrouped count0 and avg null, grouped empty no rows. No cross-workspace/join/plugin/percentile/regex APIs.
```python
from training_runtime import query_telemetry
def main():
    result = query_telemetry("""AppRequests
| where Success == false
| project Name, OperationId, ResultCode""")
    return result
```
Only saved source executes the literal/expression query. Receipt includes parsed operator lineage so replacing query with literal totals/extend constants cannot satisfy aggregation tasks. Dataset selection bound to actual destination/export IDs and current generation. Relevant new exports invalidate prior query completion, no historic union spoof. Typed restore recomputes/adjudicates query result from retained dataset, rejecting changed snapshots. Do not expose secret values through Properties/query operations.
- [ ] Timed GREEN single owning file, include small source integration using Task2/3 adapter.
- [ ] Self-review real computation/empty input/limits; commit `feat: evaluate bounded KQL over actual exported telemetry`.

### Task 5: Code-first security Labs 1–5

**Files:** Create `src/data/templates/security-python/security.js`, `src/data/labs/security-journey/{helpers,seeds,security,identity.lab,secrets.lab,rotation.lab,configuration.lab,refresh.lab}.js`; test `tests/security-labs.test.js`.
**Consumes:** resource helpers, secure SDK/profile, same-provider refresh fixture; actual manifest.
**Produces:** `security.js` exports `SECURITY_LABS` array (orders1–5), importing the five Lab records; shared helpers export `securityTask(options)` and seeds export `seedSecurityStage(run,stage)`, metadata/resources/selectors and Solution/starter source. Shared seed helper may support later stage strings now only with required baseline configuration; no new task proof. The aggregate must not live in helpers.js because Lab records import those helpers.
- [ ] Write RED one parameterized Solution replay for five Labs and one loop unfinished baseline/persistence. Negative cases no actual key consumer, pinned stale version, wrong label, reload instead of refresh.
```js
for (const lab of SECURITY_LABS) {
  const initial=createBehavioralRun(lab,{attemptId:lab.id})
  expect(evaluateLab(lab,initial).tasks.every(t=>!t.done)).toBe(true)
  const completed=replaySolutions(lab,initial)
  expect(evaluateLab(lab,completed).tasks.every(t=>t.done)).toBe(true)
  expect(evaluateLab(lab,deserializeRun(serializeRun(completed,lab),lab)).tasks.every(t=>t.done)).toBe(true)
}
```
- [ ] Timed RED single file.
- [ ] Author five distinct Labs, IDs `security-identity/security-secrets/security-rotation/security-configuration/security-refresh`, journey orders1–5. Resource names rg-messaging/func-orders/kv-orders/ac-orders/id-orders; derive client/principal IDs from actual deterministic identity helpers, no arbitrary credential constants. New provisioning/code tasks unfinished; earlier prerequisites disclosed and supplied. Labs2–5 code in `worker.py`; Lab1 grant/attach plus actual read-consumer compact command. Configuration Lab4 sets label production channel then code consumes actual selected setting. Rotation creates v2 demo credential, provider accepted state explicitly distinct; proof requires latest genuine read+accepted consumption and old credential rejection after fixture revocation. Lab5 sentinel/independent secret-refresh fixture uses same provider before/after, explicit `config.refresh()`, interval/revision change and changed consumed channel/key; reload/newrun fails.
```js
const metadata={engineVersion:2,contentVersion:1,journeyId:'security-observability',skillAreaId:'secure',labMode:'guided',manifestId:'security-python-v1',capabilities:{messaging:true,securityObservability:true}}
const rationale={concept:'Application secret retrieval',what:'Reads a versioned credential through the runtime identity.',why:'The notification consumer needs the current authorized key.',without:'A lookup alone cannot authorize notification.',csharp:'SecretClient.GetSecret parallels get_secret; DefaultAzureCredential follows the same identity idea.'}
```
Use existing task rationale/Solution UI contract and authored local explanation prompts. Select metadata-only vault/store/identity/config/provider generation dependencies with resource change/revert invalidation. Don't seed records/hosts/journal/evidence; refresh fixture baseline private resource view is described. README explicitly demo-only no credentials/network, supported APIs/limits, trainer fixture control and Python-to-C# rationale. Protected runtime documents send_notification/advance_security_fixture/query_telemetry; no fake production SDK.
- [ ] Timed GREEN single file with compact replay + negative edits, no broad matrix.
- [ ] Self-review user learning focus/privacy; commit `feat: add five code-first security labs`.

### Task 6: Instrumentation, context, logs and KQL Labs 6–11

**Files:** Create `src/data/templates/security-python/telemetry.js`, `src/data/labs/security-journey/{telemetry-setup,spans,context,logging,failure-query,metrics}.lab.js`, `src/data/labs/security-journey/observability.js`; extend shared helpers/seeds; test `tests/observability-labs.test.js`.
**Consumes:** shared securityTask/seeds, actual telemetry/KQL APIs and security Lab baseline.
**Produces:** `observability.js` exports `OBSERVABILITY_LABS` array (orders6–11), importing the six Lab records, and integrated saved source reusable by capstone. The aggregate must not live in helpers.js because Lab records import those helpers. Task7's index.js imports SECURITY_LABS and OBSERVABILITY_LABS from their dedicated aggregate modules and appends capstoneLab.
- [ ] Write RED one Solution replay per Lab with unfinished baseline and typed persistence; focused no-span, no-carrier, sensitive-log and fabricated-query negative source edits.
```js
expect(OBSERVABILITY_LABS.map(l=>l.journeyOrder)).toEqual([6,7,8,9,10,11])
expect(measurement.securityObservability.telemetry.some(r=>r.table==='AppTraces')).toBe(true)
expect(queryReceipt.result.rows).toEqual(expectedActualRows)
expect(evaluateLab(lab,runWithMissingPropagation).tasks.at(-1).done).toBe(false)
```
- [ ] Timed RED single file.
- [ ] Author IDs `observability-setup/observability-spans/observability-context/observability-logging/observability-failure-query/observability-metrics`. Setup configures destination+exports actual operation; spans wrap actual business operation and attributes, include actual rejected provider/error path not manual disconnected status. Context uses real Service Bus Function processing, Event Grid event.data trace_context, actual receiving Function extract and related spans; teach Diagnostic-Id conversion where Service Bus carrier used. Logging exports authored safe structured fields; sensitive attempts fail despite guard. Failure Lab10 may supply **disclosed earlier-stage telemetry baseline** for analysis, but no query proof/journal seeded; query must filter actual failures and correct rows, no canned answer. Lab11 emits real counters/histogram around actual success/failure operations and computes mean/max latency, delivery-attempt retries and failure rate from actual rows; conditional source math within supported subset, KQL real arithmetic.
Use `worker.py` for script Labs, `function_app.py`+clients.py for context, source string query in worker.py or imported handler.py (existing manifest paths) rather than new shell/query runner. One compact command exercise per Lab; cap command allowance max5 preserved. Meaningful same-command operation/span associations and query lineage checks, not SDK-call presence. Hidden Solutions/rationale authored C# comparisons and bounded simulation caveats. A no-op callback cannot pass through telemetry alone.
- [ ] Timed GREEN owning file, no build.
- [ ] Self-review correlation/table vocabulary/baseline disclosure; commit `feat: add six observability construction labs`.

### Task 7: Integrated Lab12, catalog, docs and focused publication gate

**Files:** Create `src/data/labs/security-journey/{capstone.lab,index}.js`, `docs/security-observability-simulator.md`, tests `tests/security-observability-{capstone,catalog}.test.js`; modify `src/data/labs/index.js`, `src/pages/HomePage.vue`, `package.json`, `.github/workflows/pages.yml`; shared helpers/seeds/templates if capstone requires new unfinished source.
**Consumes:** Labs1–11/source/runtime. Produces `SECURITY_OBSERVABILITY_LABS` exactly12 registry records once and script `test:security-observability`.
- [ ] RED integrated Solution replay, initial every new task unfinished, actual accepted secret provider+correlated event callback+safe logs+computed query+restore. Negative no consumer/missing span/literal query result/tampered journal and saved-file+resource change-revert; README edit preserves completion.
```js
expect(SECURITY_OBSERVABILITY_LABS).toHaveLength(12)
expect(new Set(SECURITY_OBSERVABILITY_LABS.map(l=>l.id)).size).toBe(12)
expect(LABS.filter(l=>l.journeyId==='security-observability')).toEqual(SECURITY_OBSERVABILITY_LABS)
expect(evaluateLab(capstone,solutionRun).tasks.every(t=>t.done)).toBe(true)
expect(()=>deserializeRun(tamperedSerialization,capstone)).toThrow()
```
- [ ] Timed RED owning2 files.
- [ ] Author `security-observability-capstone`, order12/labMode capstone. Existing Order Processing flow has unfinished new security/instrumentation tasks; secure NotifyOrder consumes actual KeyVault/AppConfig reference, spans surround real received work and callback, source propagates actual carrier, no duplicate notification on repeat business ID, structured metadata safe. One combined bounded exercise (can use func start then saved-source query entry as its two compact commands); query snapshot binds final actual exported dataset. Do not require full enterprise monitoring/resource rewrite.
Register12 exactlyonce. Home title `Security and Observability journey`, description code-first secured Order Processing. Reuse existing UI; no visual redesign or CSS changes in this task. New script lists exactly nine focused files named by this plan; Pages CI adds that script alongside existing focused Data/Messaging checks, never full tests.
```json
"test:security-observability": "vitest run tests/security-resources.test.js tests/security-sdk.test.js tests/security-state.test.js tests/security-labs.test.js tests/observability-sdk.test.js tests/observability-kql.test.js tests/observability-labs.test.js tests/security-observability-capstone.test.js tests/security-observability-catalog.test.js"
```
Docs document exact supported SDK/CLI/KQL syntax, demo identity/credentials/privacy and limitations, independent baselines/refresh fixtures/table naming, focused test command/time budget, C#concept parallels and official Microsoft/OpenTelemetry links.
- [ ] Timed GREEN owning files; then run aggregate once, `npx vitest run tests/messaging-engine.test.js tests/messaging-functions.test.js tests/data-python-sdk.test.js tests/data-capstone-core.test.js`, and `npm run build -- --base=/Azure-Trainer/`. Report all attempts/times; existing bundle-size warning separately, no unrelated warning cleanup.
- [ ] Self-review full spec coverage and commit `feat: publish security and observability learning journey`.

## Controller final integration

Whole-branch read-only review (most capable model) receives spec/plan/diff/test reports and ledger deferred findings. One final fix wave and one scoped re-review if needed; required fixes get focused covering tests. Preserve exhaustive rulings in final handoff and durable release note.

The approved CSS width fix in main remains separate: verify exact two-line diff and commit separately with prior visual/build evidence; do not re-run broad browser checks. Include the discovery discussion as approved/history documentation without letting stale unapproved status contradict current spec.

User has already chosen local merge AND publish: verify main worktree clean (except deliberate separately handled artifacts), merge branch, run compact merged verification if code differs, push main, watch Pages build/deploy, inspect live HTTP status/version/catalog assets. No new permission or integration-option prompt. Remove only this plan's validated scratch/worktree/merged branch when clean and recoverable through git. Never remove sibling workspaces.

## Plan self-review

Coverage: Task1 identity/provisioning; Task2 consumption/refresh/privacy/evidence; Task3 instrumentation/context/metrics; Task4 query semantics; Task5 Labs1–5; Task6 Labs6–11; Task7 capstone/catalog/docs/CI. All five Review Focus classes have owning tests. Shared extension/signature names and profile are consistent, old measurements unchanged. No additional services/CloudEvents/Python subprocess or general-purpose Python/KQL interpreter are included.
