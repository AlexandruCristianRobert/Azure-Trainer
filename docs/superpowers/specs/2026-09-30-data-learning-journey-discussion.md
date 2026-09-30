# Data learning journey: curriculum discussion

Status: curriculum and design decisions settled on 2026-10-01 (the remaining branches were decided on the learner's delegation). No implementation plan exists yet; application implementation has not started.

## Confirmed intent and scope

- The learner is moving from the containers Skill Area (Container Apps and AKS journeys, implemented) to **Develop AI solutions by using Azure data management services** (25–30%).
- Cover all three services in the outline: Azure Cosmos DB for NoSQL, Azure Database for PostgreSQL, and Azure Managed Redis.
- One combined Data Learning Journey with a single Capstone Lab that combines all three services (confirmed 2026-09-30).
- Deferred to later Skill Area journeys: security (Key Vault, identities, Entra database auth), metrics/monitoring (OpenTelemetry, KQL) and messaging (Service Bus, Event Grid). Supply any access these Labs need explicitly, as the AKS journey did.
- Size: the learner asked for at most ~15 Labs. The accepted 13-Lab catalog covers every exam bullet at least three times (Guided, Troubleshooting, Independent), plus once more in the Capstone.

## Delivery constraint: testing

The learner lost many hours to testing during the previous superpowers-driven implementation. The superpowers workflow stays, with this rule:

- **Do not run the existing test suite** (`npm test` / `vitest run` over `tests/`) until the learner explicitly says otherwise. Every implementation plan for this journey must state this and must not contain full-suite steps.
- **Make testing much lighter than before**: far fewer, focused tests on shared core logic only. See "Testing policy" at the end of this document.

## Exam grounding

Checked the [official AI-200 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200) on 2026-09-30.

- **Cosmos DB for NoSQL:** connect with the SDK and run queries; optimize query performance and RUs with indexing policies and consistency levels; store and retrieve embeddings and run vector similarity search; implement a change feed processor.
- **PostgreSQL:** connect and query with SDKs; model schemas and data types; indexing strategies for latency and pgvector compute overhead; configure compute, memory and storage for vector workloads; vector similarity search and RAG with metadata filters; connection optimization.
- **Managed Redis:** data operations including caching, expiration and invalidation; vector indexing for similarity search.

## Accepted catalog (13 Labs)

| # | Type | Lab | Exam bullets |
| --- | --- | --- | --- |
| 1 | Guided | Cosmos SDK connect, point reads vs queries, partition keys, RU charge; indexing policy and consistency tuning | Connect & query; optimize RUs |
| 2 | Guided | Cosmos embeddings, `VectorDistance` search with a filter, change feed processor | Vector search; change feed |
| 3 | Troubleshooting | Cosmos staged faults across all four topics | All Cosmos |
| 4 | Independent | Cosmos brief-driven design, queries, vector search and change feed handler | All Cosmos |
| 5 | Guided | PostgreSQL connect/parameterized queries; schema and data types; B-tree/GIN indexes with `EXPLAIN` | Connect & query; schema; indexing (latency) |
| 6 | Guided | pgvector HNSW vs IVFFlat and query-time tuning; compute/memory/storage sizing; RAG with metadata filter | pgvector indexing; compute; vector/RAG |
| 7 | Guided | PostgreSQL connection optimization: pooling and PgBouncer under measured load | Connection optimization |
| 8 | Troubleshooting | PostgreSQL staged faults across all topics | All PostgreSQL |
| 9 | Independent | PostgreSQL brief-driven RAG store | All PostgreSQL |
| 10 | Guided | Redis cache-aside, TTL, invalidation; vector index, KNN search, semantic cache | Caching; vector indexing |
| 11 | Troubleshooting | Redis staged faults across both topics | All Redis |
| 12 | Independent | Redis brief-driven cache and semantic cache | All Redis |
| 13 | Capstone | PostgreSQL RAG + Cosmos conversation history/change feed + Redis cache and semantic cache, with cross-service incidents | Everything |

Detailed flows and fault sets are in "Detailed Lab flows" below.

## Decisions

## Confirmed: realistic application lifecycle on AKS (2026-10-01)

- The learner chose the realistic lifecycle over run-from-Cloud-Shell scripts: Python application changes take effect only after an image build/publish and a deployment update, as in the AKS journey.
- Host: AKS. Each Lab supplies the cluster, ACR, namespace and manifests. The learner does not author manifests in this journey; the per-change loop is: edit Python → `az acr build` a new tag → `kubectl set image` or edit and `kubectl apply` the supplied Deployment → exercise the app through Experiment Controls.
- Rationale: it reuses the existing Python execution path, image lifecycle and PostgreSQL retrieval simulation, and avoids building and verifying a new Python runtime for Container Apps.
- Database resources and settings are still created and changed through `az` commands; schema, index and `EXPLAIN` work runs through a `psql` session in Cloud Shell. Only application code goes through build/deploy.

## Confirmed: Knowledge Assistant with one role per service (2026-10-01)

Extend the Knowledge Assistant (same Python app, question catalog and fixed embeddings) rather than introduce per-service scenarios:

- **PostgreSQL + pgvector:** the document corpus (passages, metadata such as product/version/language, embeddings) and RAG retrieval with metadata filters.
- **Cosmos DB for NoSQL:** Conversation History: sessions partitioned by `/sessionId`, messages and answer feedback. Vector search finds similar previously answered questions; a change feed processor reacts to new or updated feedback.
- **Azure Managed Redis:** Response Cache (cache-aside on normalized question + filters, with TTL) and Semantic Cache (vector KNN over recent question embeddings with a similarity threshold).
- **Capstone link (see below):** document changes or negative feedback, detected through the Cosmos change feed, invalidate the affected Redis entries.

## Confirmed: real SDK calls in marked edit zones (2026-10-01)

- The learner writes real Python SDK calls (names, parameters and query strings as in `azure-cosmos`, `psycopg` 3 / `psycopg_pool`, and `redis-py`) inside clearly marked functions of a fixed scaffold. The scaffold (server, client construction where not taught, fixtures) is fixed and flagged if modified, as in the AKS integration Labs.
- Recognition uses **one shared SDK call catalog**: each supported call is declared once with its parameters, validation and simulated effect. Do not write per-Lab bespoke lowering code. Calls outside the catalog produce an explicit "unsupported by the simulator" diagnostic, never a fake Azure error.
- Query strings are evaluated by three small, bounded evaluators: a Cosmos NoSQL query subset, a PostgreSQL SQL subset (extending the existing retrieval SQL support), and a Redis query subset. Most exam learning sits in these queries.
- Rationale: the AKS approach (`src/lib/project/python-integration.js`) needs a new bespoke rule for every API shape, which would multiply across three SDKs and 13 Labs. Recorded as [ADR-0003](../../adr/0003-shared-sdk-call-catalog-for-data-labs.md).

## Confirmed: change feed processor as a Python pull-model worker (2026-10-01)

- The Python `azure-cosmos` SDK has no `ChangeFeedProcessor` class (that exists in .NET and Java). Python offers the pull model (`query_items_change_feed`) and the Azure Functions Cosmos DB trigger.
- The learner builds a processor on the pull model, running as a separate worker Deployment in the same AKS namespace (manifest supplied): read changes from a start time or continuation, checkpoint the continuation token in a `leases` container after each handled batch, resume from the checkpoint after restart, and keep the handler idempotent under at-least-once delivery.
- Teach the latest-version mode limits: deletes are not surfaced (use soft delete / TTL) and intermediate updates collapse to the latest version.
- Exam Notes map the mechanism to exam vocabulary: lease container, processor instance name, handler delegate, start time, estimator, and the Functions trigger (`lease_container_name`, `create_lease_container_if_not_exists`).
- No Azure Functions host and no .NET worker in this journey.

## Confirmed: deterministic cost model, threshold-judged (2026-10-01)

- Each service gets a deterministic, documented cost model that produces evidence. Tasks judge relative outcomes or thresholds, never exact Azure values, and panels label the numbers as teaching approximations (ADR-0002).
- Cosmos: ~1 RU point read of a ~1 KB item; query cost from documents scanned; excluded index paths force scans; cross-partition fan-out charge per physical partition; Strong and Bounded Staleness reads at about 2× the RU of Session/Eventual; 429 with retry-after when provisioned RU/s is exceeded.
- PostgreSQL: declared logical table sizes with a small visible sample so `EXPLAIN` chooses realistic plans; vector index recall vs latency via `hnsw.ef_search` / `ivfflat.probes`; HNSW build limited by `maintenance_work_mem` against the declared size; connection setup cost vs pooled reuse and exhaustion at `max_connections`.
- Redis: hit/miss, TTL expiry and memory growth from the actual keys and traffic; eviction at a declared memory limit; KNN from the fixed embeddings.

## Confirmed: provisioning split (2026-10-01)

The AKS cluster, ACR, namespace and manifests are always supplied. The learner provisions data resources with `az` only where provisioning choices are themselves exam content:

| Lab | Learner provisions | Trap taught |
| --- | --- | --- |
| 1 | Cosmos account (default consistency), database, `sessions` container on `/sessionId`, throughput mode (manual / autoscale / serverless) | Partition key is immutable; requests can only relax consistency below the account default |
| 2 | `EnableNoSQLVectorSearch`, a container with vector policy + index, a `leases` container | Vector policy is fixed at container creation |
| 5 | PostgreSQL Flexible Server (tier, SKU, storage), `azure.extensions` allow-list for `vector`, then `CREATE EXTENSION vector` in `psql` | The extension must be allow-listed before `CREATE EXTENSION` succeeds |
| 6 | Compute tier scale and `maintenance_work_mem` for the HNSW build | Burstable vs General Purpose / Memory Optimized for vector workloads |
| 7 | Built-in PgBouncer (`pgbouncer.enabled`) | Pooled connections use port 6432, not 5432 |
| 10 | Azure Managed Redis with the RediSearch module | Modules are selected at creation and cannot be added later |
| 3, 4, 8, 9, 11, 12 | Supplied resources, with faults or brief-required changes | — |
| 13 | All three services from scratch | — |

The existing standalone `cosmos-vector-search` Lab stays unchanged outside the journey, so saved progress is preserved (ADR-0002).

## Decided on the learner's delegation (2026-10-01)

The learner delegated the remaining decisions ("do your recommendation to all of your questions"). The following are recommendations accepted on that basis and can be revisited.

### Identity and catalog placement

- Journey id `data-knowledge-assistant`, `journeyOrder` 1–13, Skill Area `data`, service tag per Lab (`cosmos-db`, `postgresql`, `managed-redis`; Capstone tagged `postgresql`, the primary store). Labs use `engineVersion: 2` like the AKS journey.
- Each Lab is independently restartable from its own seed; no Lab depends on the learner's earlier Sandbox.

### Fixtures

- Extend the Knowledge Assistant question catalog pattern (`src/data/fixtures/aks/knowledge.js`) into a Data fixture set. Authored vectors use **8 dimensions** so they stay visible; Exam Notes state that real embedding models use e.g. 1536 or 3072 dimensions and that stored and query dimensions must match.
- An alternative `embeddings-v2` fixture returns 12-dimensional vectors, to drive dimension-mismatch faults.
- Each canonical question has at least one **paraphrase** (high cosine similarity, same answer) and one **near miss** (moderately similar, different answer), so Semantic Cache thresholds and Cosmos similar-question search have observable right and wrong outcomes.
- Corpus passages carry `product`, `version`, `language` and `updated_at` metadata, so filtered retrieval and invalidation have meaning.
- Credentials are fictional and supplied (key or connection string) and labelled training-only; identity-based access is deferred to the security journey.

### Detailed Lab flows

**Lab 1: Guided, Cosmos SDK, partitioning, RUs, indexing and consistency.** Provision the account, database and `sessions` container. Complete `save_message()` (`upsert_item`), `get_session()` (`read_item` with `partition_key`) and `recent_sessions_for_user()` (`query_items` with `parameters`). Build, publish and deploy. Compare the RU charge of a point read, a single-partition query and a cross-partition query. Replace the default indexing policy with one that excludes unused paths and adds a composite index for `ORDER BY c.userId, c.createdAt DESC`; observe write RU fall and the ordered query succeed. Use Session consistency and prove read-your-writes with the session token; observe the ~2× read charge of Strong / Bounded Staleness.

**Lab 2: Guided, Cosmos vector search and change feed processor.** Enable the vector capability; create `qa_history` with a vector embedding policy (8 dims, cosine) and a vector index, the embedding path excluded from ordinary indexing. Complete `remember_answer()` and `find_similar_questions()` (`SELECT TOP @k ... ORDER BY VectorDistance(c.embedding, @vec)` with `WHERE c.product = @product`, returning the similarity score). Create `leases`. Complete the worker's `process_changes()` with `query_items_change_feed` from a start time or continuation, checkpointing into `leases`. Deploy both, submit feedback, restart the worker and prove no item is missed or double-applied.

**Lab 3: Troubleshooting, Cosmos.** Staged incidents, each diagnosed from evidence, repaired and verified: (1) session reads fan out across partitions because the code omits `partition_key`, exceeding the RU budget; (2) a sort query fails for lack of a composite index, and writes are expensive because the policy indexes the embedding array; (3) read-after-write returns stale data because the client uses Eventual consistency and drops the session token; (4) the worker restarts from "now" and misses feedback because it never persists the continuation token. Optional fifth: vector-dimension mismatch from `embeddings-v2`.

**Lab 4: Independent, Cosmos.** Brief: add a feedback feature. The learner chooses the container design and partition key within a per-operation RU budget, implements similar-question search restricted to a product with a similarity floor, and extends the worker to keep a per-question feedback tally idempotently. Pass by threshold evidence (RU budget, correct similar-question IDs, correct tally after a worker restart and a duplicate delivery).

**Lab 5: Guided, PostgreSQL connect, schema, data types, B-tree/GIN.** Provision the Flexible Server and allow-list `vector`. In `psql`, create `documents` (`id bigint generated always as identity`, `product text`, `version text`, `language text`, `metadata jsonb`, `body text`, `updated_at timestamptz`) and `chunks` (`document_id` FK, `chunk_index int`, `content text`, `embedding vector(8)`); load the supplied corpus. Complete `get_document()` and `search_by_metadata()` with `cur.execute(sql, params)` (parameterized, never string-formatted). Compare `EXPLAIN (ANALYZE)` for a product/version lookup before and after a composite B-tree index, and a `metadata @> %s` filter before and after a GIN index.

**Lab 6: Guided, pgvector indexing, sizing and RAG with metadata filters.** Run exact nearest-neighbour search (`ORDER BY embedding <=> %s LIMIT %s`) and observe the sequential-scan cost at the declared size. Attempt an HNSW build on Burstable with default `maintenance_work_mem` and observe the slow or failed build; scale the tier, raise `maintenance_work_mem`, build HNSW (`vector_cosine_ops`, `m`, `ef_construction`). Compare IVFFlat (`lists`); tune `hnsw.ef_search` / `ivfflat.probes` for recall vs latency; use `halfvec` to shrink the index. Complete `retrieve_passages()` with a metadata filter, observe that an over-selective filter under an approximate index returns too few rows, and fix it with iterative scans (`hnsw.iterative_scan`) or a filtered partial index. Complete `build_context()` and return an answer with source IDs; an empty result returns the declared no-match outcome.

**Lab 7: Guided, connection optimization.** Start with a new connection per request; observe setup cost dominating latency under load, then `max_connections` exhaustion as replicas scale. Introduce `psycopg_pool.ConnectionPool` sized per replica, then enable built-in PgBouncer and switch the app to port 6432 (transaction pooling; avoid session-level state across transactions). Prove throughput and p95 improvement and no exhaustion at the target replica count.

**Lab 8: Troubleshooting, PostgreSQL.** Staged incidents: (1) retrieval built with an f-string breaks on a quote in the question (injection risk), repaired with parameters; (2) sequential-scan latency because the index operator class (`vector_l2_ops`) does not match the query operator (`<=>`); (3) HNSW build fails on an undersized tier / `maintenance_work_mem`; (4) filtered retrieval returns no passages under the approximate index; (5) connection exhaustion after scaling replicas without a pool.

**Lab 9: Independent, PostgreSQL.** Brief: onboard a second product corpus with a new metadata field and language. The learner designs schema changes and indexes, sizes the server, meets a recall floor and p95 target for filtered RAG retrieval, and sustains target throughput through pooling. Pass by threshold evidence.

**Lab 10: Guided, Redis caching and vector search.** Provision Azure Managed Redis with RediSearch. Complete `cached_answer()` as cache-aside: key `ka:answer:{product}:{hash of normalized question}`, `get`, compute on miss, `set(..., ex=ttl)`; observe hits, misses and expiry. Complete `invalidate_product()` so a corpus update removes affected keys (or bumps a version prefix) and prove no stale answer. Create a vector index (`FT.CREATE ... ON HASH PREFIX 1 ka:sem: SCHEMA ... embedding VECTOR HNSW 6 TYPE FLOAT32 DIM 8 DISTANCE_METRIC COSINE`). Complete `semantic_lookup()` with a KNN query and distance threshold; prove a paraphrase hits and a near miss does not.

**Lab 11: Troubleshooting, Redis.** Staged incidents: (1) stale answers after an update because invalidation targets the wrong key pattern; (2) memory growth and evictions because entries lack TTL; (3) cross-product answers because the key omits the product filter; (4) the Semantic Cache answers near misses because the threshold is too loose, or KNN returns nothing because index `DIM` does not match stored vectors.

**Lab 12: Independent, Redis.** Brief: reach a hit-ratio target on a replayed question workload with zero stale or cross-filter answers, using both Response Cache and Semantic Cache, within a declared freshness bound per product.

**Lab 13: Capstone.** Resumable, ordered checkpoints: provision all three services; deploy the Knowledge Assistant with PostgreSQL filtered RAG, Cosmos Conversation History and similar-question search, and Redis Response Cache + Semantic Cache; deploy the change feed worker, which invalidates Redis entries on negative feedback or document updates; prove the full question-to-answer flow; resolve two staged cross-service incidents (e.g. a lost worker checkpoint causing stale cached answers, and pool exhaustion masked by cache hits until TTL expiry); prove recovery; clean up owned resources.

### Blades and Cloud Shell surface

- New read-only Blades: PostgreSQL Flexible Server (overview, compute + storage, server parameters, databases) and Azure Managed Redis (overview, modules, memory/keys, indexes). Existing Cosmos Blades gain throughput, indexing policy, consistency and a `leases` view.
- New command groups, bounded to a documented subset: `az postgres flexible-server` (create, update, parameter set/show, db create), `az redisenterprise` (create with `--modules`, database show), and additions to `az cosmosdb` (default consistency, throughput, indexing policy). A `psql` session in Cloud Shell supports only the SQL subset the Labs teach.

### Delivery

- Follow ADR-0002: deliver the smallest shared prerequisite first, then one Lab at a time, each reviewed before the next.
- Prerequisite order: (1) SDK call catalog + Cosmos query evaluator + Cosmos cost model (Lab 1); (2) vector and change feed support (Lab 2); (3) PostgreSQL resource + `psql` + SQL evaluator + plan/cost model (Lab 5), extended for pgvector (Lab 6) and pooling (Lab 7); (4) Redis resource + command/query evaluator (Lab 10).
- Plans are written in batches: Labs 1–4, 5–9, 10–12, then 13.

### Testing policy (overrides default superpowers test steps)

The learner lost many hours to testing in the previous journeys and explicitly asked for lighter testing going forward (2026-10-01). The superpowers workflow stays, with these rules:

- **Do not run the existing test suite** (`npm test`, or `vitest run` without a path) until the learner says otherwise. No plan step may run it.
- **Write far fewer tests than the AKS and Container Apps journeys.** Test only core logic whose failure would silently teach something wrong: the SDK call catalog, the three query evaluators and the cost models. Target a handful of focused cases per module, not exhaustive permutation or edge-case matrices.
- **No per-Lab test files by default.** A Lab is verified by `npm run build` succeeding and one manual walk-through in the running app. Add a Lab test only for a Task check that proved wrong during that walk-through.
- Run tests only by explicit path (e.g. `npx vitest run tests/data/cosmos-query.test.js`). No browser automation tests unless the learner asks.
- Review fixes should not add regression tests by reflex; add one only when the bug was in shared core logic.
