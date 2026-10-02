# Data Lab 13: Knowledge Assistant Capstone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the 13-Lab Data journey with a resumable capstone that connects PostgreSQL filtered RAG, Cosmos conversation history/change feed, and Redis exact/semantic caches, then proves incident recovery and safe cleanup.

**Architecture:** Extend the existing bounded Python SDK interpreter with a manifest-gated composite data target; do not create a second interpreter or route calls by searching source text. A supplied AKS application and separate worker execute captured image artifacts against the same simulated service state. A Data-only checkpoint/ownership adapter preserves measured historical milestones while requiring fresh recovery evidence before cleanup.

**Tech Stack:** Vue 3, browser-local JavaScript simulation, existing Lezer Python recognizer and SDK catalog, Vitest for focused core cases, Vite build; learner-visible Python 3.12 with azure-cosmos, psycopg 3, psycopg_pool, pgvector and redis-py.

**Spec:** `docs/superpowers/specs/2026-09-30-data-learning-journey-discussion.md`, especially Confirmed decisions, Lab 13, and Testing policy. Read `docs/adr/0003-shared-sdk-call-catalog-for-data-labs.md`, `docs/superpowers/HANDOFF-data-journey.md`, and the Redis final review/rulings for provenance pitfalls.

## Global Constraints

- "One combined Data Learning Journey with a single Capstone Lab that combines all three services".
- "Journey id `data-knowledge-assistant`, `journeyOrder` 1–13, Skill Area `data`"; Capstone service tag `postgresql`, `engineVersion: 2`, `labMode: 'capstone'`, id `data-knowledge-assistant-capstone`, order 13.
- "Each Lab is independently restartable from its own seed; no Lab depends on the learner's earlier Sandbox."
- "The AKS cluster, ACR, namespace and manifests are always supplied." Lab 13 provisions all three data services from scratch; it does not teach infrastructure deployment again.
- "Only application code goes through build/deploy." Saved edits and tag publication alone must not change running application or worker behavior.
- "Do not write per-Lab bespoke lowering code." Unsupported syntax/calls report `DATA_UNSUPPORTED`, never fabricated Azure failures.
- "Authored vectors use **8 dimensions**". Every stored/query vector and protected Python fixture must agree; no reuse of incompatible service-specific fixture answers.
- "Credentials are fictional and supplied (key or connection string) and labelled training-only". No real Azure deployment, cloud access, paid services, identities, networking, monitoring or messaging expansion.
- "No Azure Functions host and no .NET worker in this journey." Use the existing Python pull-model worker and latest-version change feed limits.
- "Tasks judge relative outcomes or thresholds, never exact Azure values"; label measurements `Simulated estimate — not an Azure guarantee.`
- RediSearch uses `EnterpriseCluster`, `NoEviction`, TLS port 10000, module selected at creation. Memory pressure means rejected writes, not invented eviction.
- "Do not run the existing test suite". **Never run bare `npm test`, bare `vitest run`, AKS tests, Container Apps tests, legacy capstone suites, or browser automation.** Run only explicitly named small Data core files.
- "No per-Lab test files by default." The new file below tests shared core adapters, not a permanent whole-Lab replay.
- Keep **at most eight new focused core cases**, one ordered capstone walkthrough, two cheap negative probes, and one final named-path check/build. Track cumulative verification wall time across all agents. Aim below 10 minutes; **at 30 minutes stop repeating checks, profile/refactor or simplify the slow checks**, then run the smallest affected check. Do not weaken correctness thresholds to obtain a pass; report any remaining unverified behavior.
- Preserve the requested subagent-driven method: one implementer, fresh spec reviewer, fresh quality reviewer per task, followed by one whole-branch review. Reviews do not independently rerun successful walkthroughs or grow the test suite by reflex.
- Planning is not execution approval. Review this plan with the learner before product changes. Use the git-worktrees skill at execution time; preserve unrelated changes/worktrees. No push, merge, PR or publishing without integration direction.

## Review Focus

1. A correct-looking literal answer, or an incidental successful cache/SQL call, must not prove a returned cache hit or source-grounded RAG answer. Pin this in Task 1's provenance case and Task 7's literal-return negative probe.
2. A worker restart or Redis write failure must not advance the durable continuation beyond unapplied invalidations. Pin this in Task 3's restart/failure cases.
3. Identical question wording under different product/version/language scopes, or a near miss under a loose threshold, must not return a foreign answer. Pin this in Task 2's fixture contract and Task 7's single walkthrough.
4. An imported run with reordered seals or changed evidence must not unlock later stages; post-seal live drift must not be accepted as fresh final proof. Pin this in Task 4's two cases.
5. A same-named preexisting resource or a group containing supplied infrastructure must not become cleanup-owned; retries after partial cleanup must preserve supplied resources and history. Pin this in Task 6's ownership case and Task 7's cleanup walkthrough.

## Existing code map and required seams

Read these before writing the owning task:

- `src/lib/data/python-sdk.js`: `parseDataApp(files, manifest)` currently selects one backend, lowers clients once, protects runtime helpers, and collects app/worker functions. PG and Redis client construction need one shared mixed globals/clientOps set, not two evaluations.
- `src/lib/data/runtime.js`: `runDataFunction(...)`, `evalCallSdk`, `pgRef`, `evalBuiltin`, and return provenance currently gate on a single `dataTarget.kind`. Cosmos refs use receiver names. Keep legacy targets unchanged.
- `src/lib/data/redis-runtime.js`: codecs, binary vector packing, Redis client validation and provenance; its `source_answer` uses a Redis-only fixture and **must not be enabled for the capstone**.
- `src/lib/data/change-feed.js`: `CHANGE_FEED_HOOK`, latest-version collapse, durable container change log. Reuse unchanged unless a concrete shared-core failure requires a fix.
- `src/lib/data/pg-engine.js`: `executePg`, `loadCorpus(sandbox, ref)` already accepts `ref.corpus`. SQL grammar currently does not offer general UPDATE. The authored update below uses a protected corpus-reload adapter; no speculative SQL grammar expansion.
- `src/lib/kubernetes/data-actions.js`: capability selection currently prefers PG and excludes mixed worker/cache actions. Add a Data-capstone branch **before** single-service dispatch.
- `src/lib/kubernetes/redis-actions.js`: reuse cache fact/provenance rules through a small shared helper extraction, not by weakening its Redis-only manifest gate.
- `src/lib/labEngine/run.js`, `actions.js`, `evaluate.js`, `sourceJournal.js`, `persistence.js`: validation, saves, dispatch, evidence, serialization. Existing ACA/AKS stage engines require fixed unrelated stage counts; do not claim those capabilities to get their UI.
- `src/components/lab/LabPanel.vue`, `ExperimentPanel.vue`, `ProjectEditor.vue`: checkpoint controls, results and cleanup freeze affordance.
- `src/lib/sandbox/ops.js`: group deletion already cascades PostgreSQL/Redis resources. Reuse the supported individual data-service deletes; capstone cleanup must never delete `rg-assistant`, its supplied ACR or AKS cluster.

## File boundaries

| File | Responsibility |
| --- | --- |
| `src/lib/data/targets.js` (new) | Resolve a legacy/composite target by SDK backend with strict manifest/capability checks |
| `src/data/fixtures/data/capstone.js` (new) | One coherent corpus, questions/vectors, revision 2, expected sources and authored scenario definitions |
| `src/data/templates/data-python/capstone.js` (new) | Complete starter/solution project, manifest, routes and declared edit zones |
| `src/data/templates/data-python/capstone-runtime.js` (new) | Protected real Python embedding, codecs and source-grounded answer helper; no Redis-only answer source |
| `src/lib/data/cache-evidence.js` (new) | Shared detached Redis return-provenance/cache effects used by both workload adapters |
| `src/lib/data/capstone-load.js` (new) | Cache-aware connection pressure calculation using observed miss demand and deployed pools |
| `src/lib/kubernetes/data-capstone-actions.js` (new) | Trusted mixed request/worker/load scenarios, routing, facts and verification |
| `src/lib/labEngine/data-capstone/stages.js` (new) | Ordered seals, active-stage gating, validation and cleanup freeze |
| `src/lib/labEngine/data-capstone/ownership.js` (new) | Attempt-owned service creation/deletion receipts, protected inventory and exact cleanup targets |
| `src/lib/labEngine/data-capstone/incidents.js` (new) | One-shot staged fault injection and measured recovery lifecycle |
| `src/data/labs/data-journey/capstone-helpers.js` (new) | Exact commands/targets and dependency selectors for this Lab |
| `src/data/labs/data-journey/capstone-seed.js` (new) | Supplied infrastructure only, no solved data resources/source/evidence |
| `src/data/labs/data-journey/capstone.lab.js` (new) | Seven ordered checkpoints, tasks, brief, solutions and exam notes |
| `src/components/lab/DataCapstonePanel.vue` (new) | Only capstone controls/results/checkpoint and cleanup state presentation |
| `tests/data-capstone-core.test.js` (new) | Six small adapter cases: worker (2), load (1), stages (2), ownership (1) |
| `tests/data-python-sdk.test.js` (existing) | Two mixed interpreter/provenance cases; no whole-Lab replay |

Do not split the SDK catalog into backend copies or refactor unrelated Kubernetes/ACA features. Each task below is independently reviewable; implementation order is sequential because interfaces are shared.

## Shared contracts

```js
// Authored lab target. Cosmos container receiver bindings are declared by manifest.
const DATA_CAPSTONE_TARGET = {
  kind: 'composite',
  postgres: { kind: 'postgres', resourceGroup: 'rg-data-capstone', server: 'pg-assistant', database: 'knowledge', port: 5432 },
  cosmos: { account: 'cosmos-assistant', database: 'knowledge' },
  redis: { kind: 'redis', resourceGroup: 'rg-data-capstone', cluster: 'redis-assistant' },
}
// Manifest: dataApp:true, dataBackend:'composite', id:'data-python-capstone-v1'.
// Capability: dataCapstone:true, kubernetes:true, acrBuild:true.
// Do not set aksCapstone/acaCapstone; single-service UI need not render here.
// Captured appSpec.data.composite = {version:1, globals, clientOps, fixture:'capstone'}.
// Captured data.postgres/data.redis remain available for their existing adapters,
// but initialization executes composite.clientOps exactly once.
// runDataFunction retains its existing signature and adds composite support.
// Returns existing sandbox/status/value/calls/totalCharge PLUS connections,
// trainingCalls, trainingTraceTruncated, redis; no secret-bearing client records.

// UI may supply only {type:'data-capstone',scenarioId}.
// Authored scenarios: {kind:'data-capstone',version:1,stageId,mode,steps}.
// mode: 'request'|'worker'|'load'|'inspect'|'incident'|'cleanup'.
// At most 64 synchronous steps, each selected from this closed set:
// {action:'request',route,args} (manifest route + bounded JSON positional args)
// {action:'worker-batch'} | {action:'worker-restart'} | {action:'worker-redeliver'}
// {action:'advance',seconds:1..300}
// {action:'corpus-update',product:'contoso-backup'|'contoso-support',revision:2,eventId}
// {action:'load',requestsPerSecond:200,seconds:5}
// {action:'inspect'} | {action:'incident-start',incidentId}
// All step content comes from Lab declarations, never UI payloads.
// Backend + API/worker targets come from the trusted Lab, not action data.
// A scenario's known diagnostic fault may be recorded completed as observed,
// but its facts still must satisfy that task.check before a stage can seal.
```

Request facts: detached `{status,body,artifactId,returnedFrom,sourceIds,scope,pgCalls,cosmosCalls,redisCalls}`; `returnedFrom` is derived interpreter provenance, never an app-supplied flag. Aggregate facts: `{answersCorrect,scopeCorrect,provenanceValid,responseHits,semanticHits,ragMisses,staleAnswers,traceComplete,worker:{before,after,handledEventIds,invalidatedKeys},load:{served,failed,p95Ms,throughputRps,peakServerConnections,originRequests},inventory}`. Bound the display independently of complete per-frame facts. Refuse proof from a truncated interpreter frame.

All API routes accept validated body arguments, even GET, following the Cosmos template's existing training server convention. The fixed real-Python server and manifest share the exact same argument contract:

| Route | Function and positional arguments |
| --- | --- |
| `GET /answer` | `answer(question, product, version, language, session_id, message_id)` |
| `GET /sessions` | `get_session(session_id, message_id)` |
| `GET /similar` | `find_similar_questions(question, product, version, language)` |
| `POST /feedback` | `submit_feedback(event_id, product, positive)` |
| `worker:batch` | `process_changes()` |
| `worker:item` | `apply_change(item)` |

Stage/evidence contracts:

```js
// Required stages.js export signatures, not implementation stubs:
// isDataCapstone(lab) -> boolean (capabilities.dataCapstone === true)
// initializeDataStages(lab) -> run.stages shape below
// validateDataStageLab(lab) -> void, throws INVALID_LAB on invalid structure
// validateDataStageState(run, lab) -> void, throws INVALID_RUN on invalid linkage
// advanceDataStage(run, lab) -> action envelope, no caller state
// freezeDataCleanup(run, lab) -> action envelope, only fresh final-recovery proof
// dataSealedTaskIds(run, lab) -> Set<string>
// dataCleanupReady(run, lab) -> boolean
// dataStageView(run, lab) -> detached JSON UI view, no mutation
// run.stages = {activeStageId,sealedStages:[],cleanupCheckpoint:null,
//   data:{version:1,protectedRefs:[],creationReceipts:[],deletionReceipts:[]}}
// run.runtime.dataCapstone = {version:1,incident:null,worker:{lastBatch:[],artifactId:null}}
// Each seal has attemptId/contentVersion/stageId/sequence/taskIds/evidenceIds,
// dependencyValues/dependencyGenerations/sourceVersions/artifactIds/proofHash.
// Hash is integrity linkage, not a cryptographic trust boundary.
// Receipts refer to actual sequences and before/after identities, not names alone.
```

## Task 1: Manifest-gated cross-service SDK execution

**Files:** Create `src/lib/data/targets.js`; modify `src/lib/data/python-sdk.js`, `runtime.js`, `redis-runtime.js`, `pg-sql.js`, `tests/data-python-sdk.test.js`.

**Interfaces:** Consumes legacy `parseDataApp`/`runDataFunction`, SDK_CALLS and existing JSON-bytes Redis representation. Produces `dataTargetFor(target, backend)` where backend is `postgres|cosmos|redis`, the composite appSpec contract above, and unified returned-value provenance. Legacy backend behavior remains identical.

- [ ] **RED:** Add two focused tests using a minimal local mixed manifest, inline clients/source, existing small service seed helpers, and canonical protected codec files. The first executes PG SELECT → Redis SET/GET → Cosmos UPSERT in one function; assert all three actual stores and trace families change. The second reads a cached value but returns an equal literal; assert it is not certified as a cache return. In that second case also assert a single-service manifest cannot select a composite target.

```js
const parsed = parseDataApp(files, mixedManifest)
expect(parsed.diagnostics).toEqual([])
const result = runDataFunction({appSpec:parsed.appSpec,sandbox,dataTarget:target,
  functionName:'round_trip',args:[],nowMs:0,changeFeed:CHANGE_FEED_HOOK})
expect(result.status).toBe(200)
expect(result.calls.some(call => typeof call.sql === 'string')).toBe(true)
expect(result.calls.some(call => call.call === 'cosmos.container.upsert_item')).toBe(true)
expect(result.redis.calls.some(call => call.command === 'SET')).toBe(true)
expect(literalReturn.redis.returnProvenance).toBeNull()
```

The test's local `round_trip` source executes `SET LOCAL hnsw.iterative_scan = strict_order`, performs a parameterized existing PG document read, encodes its returned row, SET/GETs that payload, and upserts `sessions` with `/sessionId`; seed only one row/container/Redis database. The literal variant performs the same GET but returns a literal object. Keep fixture assembly in this test file, not a new production test harness.

- [ ] Run `npm.cmd test -- tests/data-python-sdk.test.js`; confirm the new cases fail for missing mixed support, not broken setup.
- [ ] Resolve each SDK call by catalog backend and receiver type. PG refs use `target.postgres`; Redis uses `target.redis`; Cosmos uses `target.cosmos` and declared container receiver names. Mixed clients constants/pools/Redis constructors initialize once. Validate captured Cosmos wiring (`CosmosClient`, database/container bindings) against the declared literal target; unsupported dynamic wiring fails closed. Do not try to lower Cosmos wiring as a PG constructor.
- [ ] Enable PG expression forms and Redis codec/name protections together only for the mixed manifest. Keep fixed helper arities explicit; define helper profiles so legacy Redis requires its original canonical module. Task 1's inline mixed fixture uses the existing canonical helper file but enables **only** codec/key/vector helpers; `source_answer` is rejected for composite targets even if present in that file. Task 2 supplies the canonical capstone module and registers that protected profile. No Task 1 import may depend on a not-yet-created Task 2 file. Prevent helper/constructor rebinding as before.
- [ ] Support the single bounded `SET LOCAL` keyword form in the existing SQL settings parser, retaining the same allowed setting names/values. Settings last for the current connection context and are discarded when it closes; the capstone uses a `with connect()` transaction context. Existing `SET` remains supported. This is necessary for honest PgBouncer examples, not a general transaction/SQL grammar expansion; the mixed round-trip test exercises it without another case.
- [ ] Make mixed training calls, connections and Redis provenance available together; provenance must survive `decode_answer`, local returns and the actual PG-derived origin payload. A Cosmos history side effect must not erase the returned answer's provenance. No global shared mutable interpreter context across requests.
- [ ] Run the same named file GREEN, inspect the exact diff, pass both review gates, commit `feat(data): add trusted composite SDK targets`.

## Task 2: Coherent capstone fixtures and Python application project

**Files:** Create `src/data/fixtures/data/capstone.js`, `src/data/templates/data-python/capstone.js`, `capstone-runtime.js`; modify `src/lib/project/manifests.js`, `src/lib/data/runtime.js`, `redis-runtime.js`, `src/lib/data/psql.js` only for the named capstone fixture selection.

**Interfaces:** Consumes Task 1. Produces `DATA_CAPSTONE_MANIFEST`, `DATA_CAPSTONE_STARTER_FILES`, `DATA_CAPSTONE_SOLUTION_FILES`, `DATA_CAPSTONE_SOLUTION_FUNCTIONS`, `CAPSTONE_CORPUS`, `CAPSTONE_QUESTIONS`, `CAPSTONE_REVISION_2`, `capstoneExpectedAnswer(question, scope, revision)`. The expected-answer function is a grading oracle, never an application answer shortcut.

- [ ] Write one disposable fixture-contract probe before implementation: require canonical+paraphrase to rank their expected PG chunk IDs, near miss to rank different IDs, and identical wording to produce distinct scoped answers. Reject combining Redis's existing 30-day fixture with PG's 35-day corpus. Start from `CORPUS` and `corpusQuestions()`; retain 35 days for Backup v1 and 45 days for v2. Add paraphrases/near misses and same-wording scope variants **with actual document/chunk rows**, not oracle-only answers. `CAPSTONE_REVISION_2` maps product to authored row replacements: Backup v1 retention becomes 14 days; Support v1 escalation becomes "Set priority to Sev1 and use Request senior engineer review in the ticket panel." Keep IDs stable and scope each replacement to its product/version/language. Applying one product's update preserves all other live rows, including a previously updated product.
- [ ] Supply `app.py`, `worker.py`, `clients.py`, `training_runtime.py`, `server.py`, `worker_server.py`, `Dockerfile`, `schema.sql`, `k8s/deployment.yaml`, `k8s/service.yaml`, `k8s/worker.yaml`, and Cosmos policy JSON files. API and worker command/entrypoints must agree with real Python source. Worker host polls `process_changes()` outside edit zones; simulator runs one batch per declared control. Docker installs all five SDK packages. Import shared learner `invalidate_product` into worker without duplicate function definitions.
- [ ] Protect scaffold/server/codecs/vectors. Keep `clients.py` editable for the pooling repair but validate connection targets; credentials remain fictional and redacted. Edit zones: `retrieve_passages`, `build_context`, `rag_answer`, `cached_answer`, `semantic_lookup`, `remember_semantic`, `invalidate_product`, `answer`, `save_message`, `get_session`, `remember_answer`, `find_similar_questions`, `submit_feedback`, `read_lease`, `save_lease`, `apply_change`, `process_changes`.
- [ ] Register the exact capstone protected helper profile in the recognizer/runtime. Export its canonical files/arities from `capstone-runtime.js`; reject changes, shadowing or replacement modules. Do not include `source_answer`. The fixed `cache_lookup` below is an ordinary parsed function, and embedding/answer helpers consume only this task's coherent corpus.
- [ ] Compose the canonical solution from the existing PG parameterized retrieval/context functions and Redis codecs/cache functions. Rename PG's original answer to `rag_answer`; every miss invokes it, **not** the Redis-only source helper. Use one shared `embed(question)` mapping across all three services. The protected training answer helper derives the answer from actual `context.passages`/sources; it must see updated retrieved passage content after revision 2, rather than returning the old hardcoded fixture answer by chunk ID.
- [ ] In capstone `retrieve_passages`, use `SET LOCAL hnsw.iterative_scan = strict_order` inside the existing connection context before the parameterized filtered SELECT. Do not copy the PG-only example's session-level SET unchanged into a transaction-pooled deployment.

```python
def cached_answer(question, product, version, language, ttl):
    key = response_key(question, product, version, language)
    value = cache.get(key)
    if value is not None:
        return decode_answer(value)
    result = rag_answer(question, product, version, language)
    cache.set(key, encode_answer(result), ex=ttl)
    return result

def answer(question, product, version, language, session_id, message_id):
    result = cache_lookup(question, product, version, language)
    if result is None:
        result = cached_answer(question, product, version, language, 60)
        remember_semantic(question, product, version, language, result, 60)
    save_message(session_id, message_id, question, product, version, language, result)
    remember_answer(session_id, message_id, question, product, version, language, result)
    return result
```

`cache_lookup` is a fixed ordinary Python wrapper: GET + decode on a non-null exact payload; otherwise call learner `semantic_lookup` with threshold 0.05. It is parsed as normal function code, not an intrinsic returning canned hits. `rag_answer` returns `{answer,sources,product,version,language}`; sources are actual PG chunk IDs. Scope fields are copied through cache payloads and Cosmos history. No-match returns the declared no-match answer and empty sources; it does not invent a relevant answer or similarity match.

- [ ] `sessions` partitions by `/sessionId`; save deterministic `message_id` and scoped returned answer on every answer request, including cache hits. `qa_history` partitions by `/product`, stores `id=session_id + ':' + message_id`, scope, question, actual answer/sources and vector. Similar search uses all three scope filters and a cosine distance threshold 0.05; it is a separate history route, not an authoritative replacement for PG retrieval.
- [ ] `events` partitions by `/product`, stores distinct immutable event IDs and type (`negative-feedback|document-update`). Positive feedback writes an observable event with type `positive-feedback` and causes no invalidation. `leases` partitions by `/id`; lease id is `feedback-worker`. Do not confuse lease container state with Cosmos's managed processor lease format.
- [ ] `psql -f schema.sql` creates the existing documents/chunks schema and loads `CAPSTONE_CORPUS` through the named trusted fixture path. Learner creates vector extension/indexes normally; no resources or solved schema in the seed. Protected Python and JS fixtures must use identical answers, normalization, SHA256, FLOAT32 encoding, and JSON payloads.
- [ ] Run the disposable fixture probe GREEN and `npm.cmd run build`. Review; commit `feat(data): add cross-service Knowledge Assistant scaffold`.

## Task 3: Mixed workload bridge, durable worker, and cache-aware pressure

**Files:** Create `src/lib/data/cache-evidence.js`, `src/lib/data/capstone-load.js`, `src/lib/kubernetes/data-capstone-actions.js`, `tests/data-capstone-core.test.js`; modify `src/lib/kubernetes/data-actions.js`, `redis-actions.js`, `src/lib/labEngine/actions.js` and the capstone template's worker solutions.

**Interfaces:** Consumes Tasks 1–2. Produces `validDataCapstoneScenario(scenario, lab)`, `applyDataCapstoneAction(run, action, lab)`, `runCapstoneSteps(run, lab, scenario)`, `simulateCapstoneLoad({requestsPerSecond,seconds,originRequests,replicas,poolMaxSize,mode,server})`. Adapter results use the normal `{run,lines,portalEvents,diagnostics}` envelope. `runCapstoneSteps` returns `{run,measurements}` without recording evidence; public dispatch validates/records once.

- [ ] **RED:** Add three small cases with local minimal appSpecs/resources, not the future Lab import: (1) checkpoint → pending document update → restart → batch handles that event and removes both product cache namespaces, duplicate delivery converges and preserves Support keys; (2) Redis invalidation error leaves continuation unchanged; (3) all-hit load has `originRequests=0`, while expired/all-miss load with an oversized deployed pool reports failures, then bounded pool recovery succeeds.

```js
expect(restarted.measurements.worker.handledEventIds).toContain('update-2')
expect(restarted.measurements.worker.after).not.toBe(before)
expect(failed.measurements.worker.after).toBe(before)
expect(warm.originRequests).toBe(0)
expect(warm.failed).toBe(0)
expect(cold.failed).toBeGreaterThan(0)
expect(repaired.failed).toBe(0)
```

Arrange worker failure with an SDK error from a declared Redis client/index/resource state, not a caller-provided `success:false`. Arrange load directly with server `max_connections:20`, replicas 3, pool max 12 then 4, RPS 200 and duration 5. Define local seed/fixture helpers in this core file and reuse them for later cases.

- [ ] Run `npm.cmd test -- tests/data-capstone-core.test.js` and confirm these three new core behaviors fail before implementing them.
- [ ] Dispatch composite action before legacy PG/Cosmos selection. Validate exact action keys, matching scenario version/stage, supported routes and bounded args. Resolve actual ready API Pod through Service selector, actual worker Pod through its Deployment, and captured build IDs. Worker restart must replace/re-resolve the Pod snapshot via the supported rollout command/reconciliation, not just clear an array labelled restart. Redelivery executes `worker:item` on the last successfully observed batch; it is not a second raw fixture write.
- [ ] Implement worker solution with the existing SDK catalog; imports supply `events`, `leases`, `invalidate_product`. The bounded simulator drains the currently available latest-version batch; real Python polling remains in the protected host.

```python
def read_lease():
    rows = list(leases.query_items(
        query="SELECT * FROM c WHERE c.id = @id",
        parameters=[{"name": "@id", "value": "feedback-worker"}],
        partition_key="feedback-worker"))
    if len(rows) == 0:
        return None
    return rows[0]

def save_lease(continuation):
    return leases.upsert_item({"id": "feedback-worker", "continuation": continuation})

def apply_change(item):
    if item["type"] == "document-update":
        invalidate_product(item["product"])
    if item["type"] == "negative-feedback":
        invalidate_product(item["product"])
    return item["id"]

def process_changes():
    lease = read_lease()
    continuation = None
    start_time = "Beginning"
    if lease is not None:
        continuation = lease.get("continuation")
        start_time = None
    changes = list(events.query_items_change_feed(start_time=start_time, continuation=continuation))
    for change in changes:
        apply_change(change)
    new_continuation = events.client_connection.last_response_headers["etag"]
    save_lease(new_continuation)
    return len(changes)
```

The checkpoint is written **after** every handled item. DELETE is repeat-safe; replay may invalidate an already empty cache but never increments a non-idempotent tally or claims a second business event. Preserve the durable lease on failures and restart. Do not equate handler call count with exactly-once delivery. Latest-version feed does not surface hard deletes; immutable update events avoid collapsed revision history.

- [ ] The trusted `corpus-update` step requires existing learner-created PG schema and Cosmos events container. Build a detached corpus from the current PG rows and overlay only `CAPSTONE_REVISION_2[product]`, then use `loadCorpus(...,{corpus:mergedCorpus})` and write an actual Cosmos `document-update` item via `upsertItem` + `recordChange`. An already applied product revision is idempotent and must not reset another product's revision or create a second distinct business event on retry. Never update Redis keys/source shortcuts or call invalidation automatically. Explain this as a supplied administration event: PG/Cosmos writes are not an atomic cross-service transaction; production needs retry/outbox handling, which is outside this Lab.
- [ ] Extract cache effects/provenance from Redis actions into the shared helper without changing legacy output. Aggregate complete per-request facts before display caps. Count actual SQL-origin misses, cache-hit returns, returned scoped answers, Cosmos history writes, and worker DELs; never count raw successful HTTP or learner counters as proof.
- [ ] Load cannot infer PG mode from an all-hit route. For the mixed manifest, bind pool mode/size to the captured `connect` function and the actual declared pool it returns (unused global pools are ignored). Measure a bounded representative request sequence before calculating miss demand. For a synchronized cold burst, evaluate misses against the same pre-wave cache snapshot so the first request cannot warm all other concurrent requests; commit one deterministic representative wave's actual effects afterward. Use `simulatePoolLoad` with **origin** RPS and deployed replicas; at originRequests=0 return zero PG demand/failures/peak connections without opening PG. Keep cache and Cosmos operations observable separately; label p95 as PostgreSQL-origin teaching approximation, not whole-app p95.
- [ ] Advance `run.runtime.simTimeMs` synchronously; no timers, real TTL waits, prolonged workload loops, or cloud traffic. Refresh dependency generations before recording source-update proofs.
- [ ] Run core file GREEN, build once, review, commit `feat(data): execute mixed requests and checkpointed cache invalidation`.

## Task 4: Data-only resumable stage seals and persistence

**Files:** Create `src/lib/labEngine/data-capstone/stages.js`; modify `src/lib/labEngine/run.js`, `actions.js`, `evaluate.js`, `sourceJournal.js`, `persistence.js`, `tests/data-capstone-core.test.js`.

**Interfaces:** Consumes measured evidence from Task 3. Produces the stage exports/state contracts above; actions `{type:'data-advance-stage'}` and `{type:'data-freeze-cleanup'}` accept no extra fields. No AKA/ACA flags or fixed-stage overrides.

- [ ] **RED:** Add two core cases using a tiny two-stage declaration for generic adapter testing (the actual Lab still declares seven): ordered valid seal survives JSON export/import, but reordered/tampered evidence or skipped stage is rejected; an old sealed success cannot freeze cleanup after deployed code/resource drift until fresh final evidence passes.

```js
expect(resumed.stages.activeStageId).toBe('final')
expect(() => validateDataStageState(tampered, lab)).toThrow()
expect(freezeDataCleanup(drifted, lab).diagnostics.length).toBeGreaterThan(0)
expect(freezeDataCleanup(fresh, lab).run.stages.cleanupCheckpoint).not.toBeNull()
```

Use ordinary `recordVerification` and controlled minimal dependency selectors; do not hand-insert forged successful task flags to make the healthy fixture pass.

- [ ] Run named core file RED; implement bounded ordered stages, partitioned task IDs, per-stage evidence links, attempt/content identities and increasing unique sequence numbers. Initialize sourceJournal for Data capstone and include it in save-file hashing. Avoid touching existing stage counts or source semantics in legacy capstones.
- [ ] Sealing requires every active task's **actual check** plus current measured evidence. Store compact dependency/source/artifact snapshots and proof hashes; validate linkage back to persisted records/source saves on import. Hashes are consistency checks, not tamper-proof authentication. Historical stages remain visibly sealed after later repairs/cleanup; final tasks always use current live dependencies.
- [ ] No inactive-stage scenario, incident injection or seal is accepted; completed historical inspection is read-only. Final recovery evidence must be newer than both incident starts and match current API/worker builds, service configs, indexes, schema and pool settings. Mutable keys and elapsed time are not broad config fingerprints; scenario facts pin the relevant cache observations.
- [ ] Freeze cleanup only in the final checkpoint after final fresh verification. After freeze allow inventory reads, exact owned-resource deletion, cleanup verification and final seal; disallow source saves, builds, mutations, time advances, and new workloads. Retry partial cleanup without reopening earlier stages.
- [ ] Run named core file GREEN and a small serialize/deserialize probe through existing persistence APIs; review, commit `feat(data): preserve ordered Data capstone checkpoints`.

## Task 5: Two explicit cross-service incidents

**Files:** Create `src/lib/labEngine/data-capstone/incidents.js`; modify `data-capstone-actions.js`, the capstone template and fixture scenarios.

**Interfaces:** Consumes Tasks 1–4. Produces `startDataIncident(run, lab, incidentId)` and `dataIncidentView(run, lab)`; incident ids `worker-checkpoint` and `cache-masked-pool`. State stores declared start/observation/recovery evidence sequences and causal command/build receipts; no implicit fault toggle during Verify.

- [ ] Before implementation write a disposable short probe for each incident using the shared action dispatcher: expected-negative baseline is observable, injection is one-shot/active-stage-only, and unchanged bad code/config cannot pass recovery. These probes join the Task 7 walkthrough rather than new permanent cases.
- [ ] Worker incident: visibly save the authored faulty `process_changes` (starts at `Now`, ignores durable continuation, omits save_lease), build a distinct `assistant:capstone-worker-fault` image and apply it to the worker via normal commands. Keep the healthy API image. Earlier healthy worker training updates **Support**, leaving Backup at revision 1. Prime exact+semantic Backup caches with the 35-day answer, establish an earlier lease, post the Backup PG revision-2 update while the worker is stopped/restarting, then run the bad worker. Expected diagnostic: worker appears ready but pending update remains unhandled and both returned cache types are stale **before TTL expiry**. Never reset PG to an older revision just to manufacture this incident.
- [ ] Worker repair: learner restores durable read/checkpoint code, builds `assistant:capstone-worker-fixed`, redeploys worker, resumes from the earlier persisted lease, runs batch then exact and paraphrase requests immediately. Require updated 14-day PG-derived answers, DELs for both cache namespaces, preserved Support keys, lease advancement, worker restart with no missed event, and duplicate delivery convergence. Positive feedback must not clear caches. Do not let passive expiry substitute for invalidation.
- [ ] Pool incident: after worker recovery and fresh priming, visibly change captured clients to module pool `max_size=12` on direct port 5432; scale API to 3 replicas and set server `max_connections=20`. Use an authored fault image/build/apply and parameter/scale commands, all shown in the incident receipt. Warm exact workload is healthy with zero PG demand; advance 61 simulated seconds; cold synchronized origin burst reports failed requests/connection exhaustion. The default target is RPS 200 for 5 simulated seconds.
- [ ] Pool repair: enable PgBouncer, set `pgbouncer.default_pool_size=12`, use a module ConnectionPool `min_size=1,max_size=4` at port 6432, build/deploy a fresh API tag. Re-prime then advance 61 seconds and prove **cold** throughput >=190 RPS, zero failed requests, peak server connections <=17 and origin p95 <=20ms. Also prove correct filtered RAG and Cosmos history for returned successes. Cache hits alone cannot satisfy recovery. These thresholds follow the explicit existing pool teaching model; record them as estimates.
- [ ] Show fault contents, commands, captured build IDs and diagnostic facts. Injection writes only declared fault files/config, never a solution, successful evidence or a task outcome. If prerequisites differ, fail with a diagnostic rather than overwrite arbitrary learner state.
- [ ] Finish the two small probes, build once, review, commit `feat(data): stage worker and cache-masked pool incidents`.

## Task 6: Attempt-owned cleanup with protected prerequisites

**Files:** Create `src/lib/labEngine/data-capstone/ownership.js`; modify `src/lib/labEngine/actions.js`, Data stage/actions adapters, `tests/data-capstone-core.test.js`; use existing `src/lib/az/commands/group.js`, `postgres.js`, `redisenterprise.js`, `cosmosdb.js` deletes rather than a new provider layer.

**Interfaces:** Consumes cleanup freeze from Task 4. Produces `captureDataOwnership(before, after, commandResult, lab)`, `dataCleanupInventory(run, lab)`, `dataFrozenActionAllowed(run, action, lab)`. Inventory rows are `{resourceId,type,createdSequence,protected}`; lookup uses exact normalized IDs and creation receipts, not group/name prefixes.

- [ ] **RED:** Add one core case: preexisting same-name/protected references are never owned; only successful new creations enter receipts; freeze permits deleting exact owned data services, rejects supplied AKS/ACR/group/namespace deletion, and partial-delete retry keeps historical proof. Verify leftover owned service blocks final seal.

```js
expect(inventory.owned.map(row => row.resourceId)).toEqual([createdPgId])
expect(dataFrozenActionAllowed(run, protectedGroupDelete, lab)).toBe(false)
expect(dataCleanupReady(partiallyDeleted, lab)).toBe(false)
expect(dataCleanupReady(allOwnedGone, lab)).toBe(true)
```

The fixture records a real supported command result with before/after inventories; a repeated matching create must not produce a new ownership receipt.

- [ ] Run core file RED. Seed supplied AKS/ACR/namespace/Service in `rg-assistant`; learner creates separate `rg-data-capstone` and all three data services there. Record baseline protected references immediately after initializer returns, using the permitted run initializer fields; do not widen the initializer return schema casually.
- [ ] Intercept successful command results for exact newly created group/PG/Cosmos/Redis identities. Failed create, show, update or re-create of an existing identity cannot claim ownership. Include successful deletion receipts; enforce safety at action dispatch **before** executing a destructive command, even outside freeze for supplied prerequisites.
- [ ] Freeze inventory includes Data services/group and the learner-installed API/worker Deployments. Cleanup deletes those two Deployments, not the supplied namespace, Service, AKS or ACR. Delete data services individually or delete `rg-data-capstone` only when every live resource inside it is attempt-owned and no protected reference is in it. Read-only inspection and retries remain available. Retain build/evidence/source history; active references to deleted deployments/services must not linger as live Data workload state.
- [ ] Canonical command sequence:

```powershell
kubectl delete deployment assistant-api -n assistant
kubectl delete deployment feedback-worker -n assistant
az postgres flexible-server delete -g rg-data-capstone -n pg-assistant --yes
az cosmosdb delete -g rg-data-capstone -n cosmos-assistant --yes
az redisenterprise delete -g rg-data-capstone -n redis-assistant --yes
az group delete -n rg-data-capstone --yes
```

- [ ] Final cleanup proof requires no owned data resources or live API/worker Deployments, intact protected inventory, a frozen final-recovery proof and matching deletion receipts. Clearing arrays or marking tasks done is not cleanup evidence. Recreating owned resources after final cleanup prevents completion; freeze disallows that mutation.
- [ ] Run core file GREEN; review, commit `feat(data): clean up only capstone-owned resources`.

## Task 7: Publish the Lab definition, controls, solutions and bounded handoff

**Files:** Create `src/data/labs/data-journey/capstone-helpers.js`, `capstone-seed.js`, `capstone.lab.js`, `src/components/lab/DataCapstonePanel.vue`, `docs/superpowers/data-capstone-progress.md`; modify `src/data/labs/index.js`, `src/components/lab/LabPanel.vue`, `ExperimentPanel.vue`, `ProjectEditor.vue`, `docs/superpowers/HANDOFF-data-journey.md` and original curriculum status. No legacy capstone Lab edits.

**Interfaces:** Consumes all prior tasks. Produces `dataCapstoneLab`, `seedDataCapstone(run)`, `dataCapstoneDependencies(fields)`, `DATA_CAPSTONE_TARGET`, `DATA_CAPSTONE_API_TARGET`, `DATA_CAPSTONE_WORKER_TARGET`. Seed returns only `{sandbox,artifacts,runtime,nextSequence}`; no saved source/evidence/task solution injection. API target uses supplied `aks-assistant`, namespace `assistant`, Service/Deployment `assistant-api`; worker target uses `feedback-worker`.

- [ ] Author the seven stages below with **15 outcome-based tasks**, not dozens of command-checkbox tasks. Give every task a scenario/evidence selector, current dependency contract, readable brief, complete Solution and exam note. Provision/index readiness inspect tasks grade actual resource definitions, not command history alone. Learner choices within supported outcomes remain valid.

| Checkpoint | Task IDs | Measured deliverable |
| --- | --- | --- |
| `provision` | `postgres-ready`, `cosmos-ready`, `redis-ready` | All three learner-created services/settings, schema/corpus/indexes/containers; no seed shortcuts |
| `application` | `rag-deployed`, `history-and-cache` | Scoped PG RAG with sources; exact/semantic hits; Cosmos messages on every request and filtered similar history |
| `worker` | `worker-deployed`, `feedback-and-update` | Backup negative feedback and Support document update invalidate both namespaces; durable restart/redelivery; positive feedback leaves cache intact |
| `full-flow` | `cross-service-flow` | End-to-end questions, filters, near miss/no-match, actual traces, TTL/memory and correct history |
| `worker-incident` | `worker-fault-observed`, `worker-recovered` | Actual stale response/semantic answers from a missed event, then immediate checkpointed recovery |
| `pool-incident` | `pool-fault-observed`, `pool-recovered` | Warm health hides PG pressure; expired cache reveals failure; rebuilt pool/PgBouncer restores cold workload |
| `final-cleanup` | `final-recovery`, `cleanup-app`, `cleanup-data` | Fresh full proof → explicit freeze → exact cleanup → final seal; resume after partial cleanup |

- [ ] Provide exact provisioning commands from existing PG/Redis helpers with resource-group substitution to `rg-data-capstone`. Cosmos Session account enables `EnableNoSQLVectorSearch`; create knowledge database, sessions `/sessionId`, qa_history `/product` with 8-dim cosine policy and embedding excluded from scalar indexing, events `/product`, leases `/id`. Containers use 400 RU/s teaching setting. PG is GeneralPurpose `Standard_D2ds_v5`, storage 32 GB, vector allow-list, CREATE EXTENSION, documents/chunks SQL, B-tree/GIN metadata indexes and HNSW `vector_cosine_ops`; workload uses transaction-local tuning compatible with PgBouncer. Redis uses existing Balanced_B0/RediSearch command and `idx:semantic` 8-dim HNSW plus scope TAG fields, 64 KiB teaching limit. Full policy files/SQL live in the project so Solutions can refer to runnable saved files.
- [ ] Each code Solution contains the full relevant saved source, distinct image tag, supplied Deployment YAML/image change, apply/rollout and scenario action. Worker/API may run different captured versions; repairing one must not silently deploy the other. First `rag-deployed` solution may leave cache/history/worker functions unfinished, but its scenario uses a fixed route wrapper calling only `rag_answer`; register that additional `GET /rag` route in both server and manifest with four args. This wrapper is ordinary protected Python, not pre-solved RAG. Later Solution functions build on the learner's correct earlier zones; no full-file reset of unrelated current work when merely showing a hint.
- [ ] Dependency selectors whitelist: `api:artifact`, `worker:artifact`, individual deployed function hashes, captured DSN/pool config, live PG schema/rows/indexes/server parameters, Cosmos policies/lease/event revisions, Redis resource/index definition, incident identity and ownership inventory. Separate historical diagnostic baselines from current repair proofs. Do not fingerprint every changing cache key/time globally and invalidate all prior milestones. Validate selected saved/deployed functions agree where the task explicitly asks to deploy current edits.
- [ ] Add DataCapstonePanel only when capability is present. Display active/sealed checkpoints, relevant locked/unlocked scenario buttons, Start incident controls, current facts by service, actual returned sources/history, before/after durable continuation, cache effects, warm/cold origin load, cleanup remaining/protected inventory and freeze/advance controls. Reuse existing styles; no visual redesign. Suppress single-service panels for this capability only; legacy Data labs retain their controls. ProjectEditor disables saves after freeze and explains why; server enforcement remains authoritative.
- [ ] **One ordered walkthrough only:** interactively if available; otherwise a disposable in-process script using `createBehavioralRun`, `applyRunAction`, `evaluateLab` and the Lab's own Solution steps. Support solution steps `{kind:'file',path,content}`, `{kind:'command',line}`, `{kind:'scenario',scenarioId}`, and `{kind:'action',action:{type:'data-advance-stage'|'data-freeze-cleanup'}}`. No permanent Lab replay test or import of legacy replay suites.
- [ ] That single walkthrough must cover: provision absent→ready; saved edit does not affect old Pod; scoped canonical answer with real PG sources; exact repeat and paraphrase hits with Cosmos history writes; foreign-scope isolation; near miss computes a different PG answer; no-match response; positive feedback no-op; negative feedback two-namespace invalidation; document update remains stale before worker and fresh immediately after; durable restart+duplicate; worker incident and repair; warm versus expired-cache pool incident and cold repair; final fresh proof; export/import after a seal and during partial cleanup; cleanup preserves supplied resources and completion requires final seal. Use fewer than 30 authored answer calls plus one modeled warm/cold load pair per phase; no actual thousands-of-requests loops.
- [ ] Two negative probes reuse detached copies of the already built **pre-incident** in-process setup: equal literal answer after incidental GET/SELECT must fail provenance; omit semantic deletion, apply the not-yet-applied Backup revision 2, and prove immediate paraphrase freshness fails. They must not mutate the accepted walkthrough run or reuse an already updated source as a false freshness test. For missing TTL/foreign filter/loose threshold, use reviewer inspection and the existing scoped/near-miss walkthrough rather than growing a test matrix.
- [ ] Final bounded verification, exactly named paths, once after fixes:

```powershell
npm.cmd test -- tests/data-python-sdk.test.js tests/data-capstone-core.test.js
npm.cmd run build
```

- [ ] Record commands, case counts, per-task and cumulative durations, interactive versus in-process walkthrough, each review decision/fix, real-cloud/browser exclusions and any limitations in `data-capstone-progress.md`. Update handoff/catalog status to distinguish implemented/reviewed/local-merged/pushed; do not claim any of those stages without evidence.
- [ ] Commit `feat(labs): add resumable Data Knowledge Assistant capstone`. Request whole-branch review before integration. Apply verified review findings with minimal affected checks, then use finishing-a-development-branch only after actual completion and verification. The user's integration choice controls merge/push; this plan does not authorize publishing.

## Acceptance and test budget ledger

- New permanent cases: Task 1 = 2 SDK/core cases; Task 3 = 3; Task 4 = 2; Task 6 = 1. **Total eight**, not eight per task or per review.
- Per-task RED/GREEN runs target the owning named file only. Builds at the documented shared integration gates; no repeated all-Lab walkthrough per reviewer.
- One final named SDK+capstone-core run/build, one ordered solution walkthrough, two negative probes. Existing AKS/ACA/Data Lab replay files stay excluded.
- Stopwatch includes failed validation, retries, review-triggered runs and disposable probes across all subagents, not just successful Vitest time. At 20 minutes examine the slowest check; at 30 minutes simplify/refactor before continuing, preserve core correctness assertions, document any deferred verification. A slow browser harness is replaced by synchronous in-process checks, not longer timeouts.
- Completion requires all 15 task outcomes, seven ordered seals, fresh recovery and verified owned cleanup. It does not require real-cloud or browser-suite coverage; those remain explicitly unverified.

## Grounding and planning decisions

The curriculum is the already approved architectural spec. This plan elaborates its final delivery batch, as the Redis plan did; it does not reopen a new architecture approval cycle or implement changes before this written plan is reviewed. The three services form one dependent capstone deliverable, not independent speculative subprojects.

1. Reuse the established SDK interpreter and deployment snapshots instead of inventing a mixed-runtime interpreter.
2. Use a dedicated Data stage adapter instead of enabling unrelated ACA/AKS capstone flags. Their stage counts and cleanup assumptions do not match this Lab.
3. Start from PG's actual corpus; add backed paraphrase/near-miss/scope fixtures. Redis-only fixtures have different answers and cannot be the capstone origin.
4. A supplied corpus-update control reloads actual PG rows and writes a Cosmos event; it never invalidates cache. This makes cross-service propagation observable without adding general SQL UPDATE/outbox infrastructure.
5. The worker stores a manually persisted pull-model continuation; at-least-once DELs converge. No exactly-once promise or production transaction guarantee.
6. Cold load models concurrent origin demand using actual deployed pool configuration; a cache-hit route is insufficient evidence for connection recovery.
7. Separate data resource group makes cleanup safe while preserving supplied AKS/ACR. Learner-created API/worker Deployments are removed individually.

Primary technical sources checked 2026-10-02:

- [Cosmos Python pull model, continuation persistence and start-time precedence](https://learn.microsoft.com/en-us/azure/cosmos-db/change-feed-pull-model). Reuse the documented `last_response_headers['etag']` pattern already exposed by the catalog; polling/pagination and lease coordination are bounded teaching approximations, not a production change feed host.
- [Azure SDK Python change feed sample](https://github.com/Azure/azure-sdk-for-python/blob/main/sdk/cosmos/azure-cosmos/samples/change_feed_management.py).
- [Managed Redis module constraints](https://learn.microsoft.com/en-us/azure/redis/redis-modules). Keep existing simulated CLI value `EnterpriseCluster`; documentation calls the policy Enterprise. RediSearch requires NoEviction.
- [PostgreSQL built-in PgBouncer](https://learn.microsoft.com/en-us/azure/postgresql/connectivity/concepts-pgbouncer). Pooled app DSN uses port 6432 and transaction pooling; do not depend on session state carrying across transactions.

## Plan self-review

- Spec coverage: scratch provisioning and schema/index choices = Tasks 2/7; deployed filtered RAG/history/similar/exact/semantic behavior = Tasks 1–3/7; change feed invalidation and durable restart = Task 3; full flow = Task 7; both cross-service incidents/recovery = Task 5; resume/order/evidence = Task 4; ownership and cleanup = Task 6.
- Interface consistency: composite target, manifest id, action/scenario shape, returned facts, helper names and seven stage task IDs are defined above and reused. No accidental `aksCapstone` or `acaCapstone` capability dependency.
- Review Focus: five listed risks map to the owning core cases or bounded walkthrough probes; no default exhaustive edge-case matrix.
- Placeholder scan: each task defines concrete files, API contracts, behavior, checks, commands and commit checkpoint; no deferred implementation placeholders.
- Scope exclusions: no Lab 14, no prerequisite journey reimplementation, general Python/SQL interpreter, real cloud, new identity/networking/messaging architecture, legacy suites, or speculative UI redesign.
- Approval: plan saved for review; execution remains subagent-driven as requested in the existing workflow. No product code, tests, dependencies or external resources changed during planning.
