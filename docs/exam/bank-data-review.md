# Data bank editorial ledger

Review date: 2026-10-06. All 33 scenarios, configurations and explanations were authored for this project from primary documentation. None are imported or paraphrased exam questions. Every row is **author checked; independent review pending**. Structural GREEN validates shape and hand-checked keys, not factual approval. The controller owns the independent all-item source gate.

Each component is worth one point. Every component has a structured reason and checks for every legal candidate. Multi-response and hot-area items require the stated two candidates; multipart widgets assess components separately. The single primary objective remains canonical even when a scenario mentions other stores. d019 tests the configured authoritative-history boundary and its disposable copy, with both components mapped to cosmos-history; it does not introduce a cross-objective cache component.

## Primary paths used in the rows

Aliases below identify exact URLs, not search-result pages. All were opened and inspected on the review date. The `ref-data.*` catalog entries resolve the 12 canonical concept references; additional IDs provide the narrower methods, operators, limits and lifecycle evidence.

| Alias | Exact primary URL and sections inspected |
| --- | --- |
| C-read-cost | https://learn.microsoft.com/en-us/azure/cosmos-db/optimize-cost-reads-writes — point reads, read consistency cost, paged query charge, write index cost |
| C-python | https://learn.microsoft.com/en-us/python/api/azure-cosmos/azure.cosmos.containerproxy?view=azure-python — read_item method and required partition_key |
| C-consistency | https://learn.microsoft.com/en-us/azure/cosmos-db/consistency-levels — session single-writer/token guarantees and eventual behavior |
| C-vector | https://learn.microsoft.com/en-us/azure/cosmos-db/vector-search — feature enablement and container vector policies |
| C-index | https://learn.microsoft.com/en-us/azure/cosmos-db/index-policy — included/excluded path notation and write RU consequences |
| C-processor | https://learn.microsoft.com/en-us/azure/cosmos-db/change-feed-processor — supported SDKs, lease container, at-least-once and retry from established checkpoints |
| C-modes | https://learn.microsoft.com/en-us/azure/cosmos-db/change-feed-modes — latest-version creates/updates, coalescing and absence of deletes |
| C-ttl | https://learn.microsoft.com/en-us/azure/cosmos-db/time-to-live — container-level disabled TTL versus item overrides |
| P-python | https://learn.microsoft.com/en-us/azure/postgresql/connectivity/connect-python — psycopg execute with separate %s value tuple |
| P-prepare | https://www.postgresql.org/docs/18/sql-prepare.html — PREPARE, EXECUTE and DEALLOCATE lifecycle |
| P-extension | https://www.postgresql.org/docs/18/sql-createextension.html — enabling installed extension in a database |
| P-vector | https://github.com/pgvector/pgvector — Getting Started, Querying, Indexing, HNSW Index Build Time, Filtering, Iterative Index Scans |
| P-index | https://www.postgresql.org/docs/18/indexes-types.html — B-tree ranges, equality-only Hash and GIN categories |
| P-json | https://www.postgresql.org/docs/18/datatype-json.html — jsonb GIN jsonb_ops and @> containment |
| P-compute | https://learn.microsoft.com/en-us/azure/postgresql/compute-storage/concepts-compute — compute tiers and CPU/memory sizing |
| P-pool | https://learn.microsoft.com/en-us/azure/postgresql/connectivity/concepts-pgbouncer — supported tiers, explicit enablement and transaction pooling |
| P-limits | https://learn.microsoft.com/en-us/azure/postgresql/configure-maintain/concepts-limits — maximum/reserved connections and resource consumption |
| R-set | https://redis.io/docs/latest/commands/set/ — EX expiration in seconds and plain SET behavior |
| R-del | https://redis.io/docs/latest/commands/del/ — removal of specified keys |
| R-vector | https://redis.io/docs/latest/develop/ai/search-and-query/vectors/ — Search vector field schema, compatible query bytes, metadata primary filters, KNN and DIALECT 2 |
| Cache-aside | https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside — cache miss/fill and source-update-before-invalidation ordering |

The obsolete attempted `/azure/postgresql/connectivity/concepts-limits` returned an internal fetch error. It is not retained in the reference catalog. The corrected `configure-maintain/concepts-limits` page was opened successfully. No answer relies on a fixed connection default, PgBouncer deployment default, specific compute SKU, embedding model name or maximum vector dimension.

## All-item answer and distractor review

Concept/objective columns omit only the shared `data.` prefix. Source aliases expand to the exact paths above. Keys are in canonical component order.

| ID | Concept / objective | Primary paths | Keys and answer justification | Distractor checks | Date / outcome |
| --- | --- | --- | --- | --- | --- |
| ai200-d001 | cosmos-history / cosmos-query | C-python, C-read-cost | point: read_item supplies ID and partition key for one item. | SQL on both keys is still a query; scanning conversations is not a point read. | 2026-10-06; author checked; independent pending |
| ai200-d002 | cosmos-request-cost / cosmos-cost | C-consistency, C-read-cost | session: retained relevant token and one writer meet read-your-writes without strong read-cost doubling. | Strong meets freshness but violates the stated cost requirement; eventual lacks the guarantee. | 2026-10-06; author checked; independent pending |
| ai200-d003 | postgres-parameters / postgres-query | P-python | params: separately bound tuple preserves the original title as data. | f-string interpolation admits syntax; stripping quotes corrupts input and still interpolates. | 2026-10-06; author checked; independent pending |
| ai200-d004 | postgres-filtered-rag / postgres-rag | P-vector | cosine: <=> ascending is nearest-first cosine distance with the existing tenant predicate. | <-> is L2; DESC reverses distance order. | 2026-10-06; author checked; independent pending |
| ai200-d005 | redis-cache / redis-cache | R-del, R-set, Cache-aside | invalidate: delete the known stale copy after the source commits. | Waiting permits stale hits; extending TTL prolongs them. No concurrent reader/writer race is asserted away silently: it is explicitly excluded. | 2026-10-06; author checked; independent pending |
| ai200-d006 | postgres-pooling / postgres-connections | P-pool | transaction: backend can be reused after a transaction ends while client stays connected. | Waiting for disconnect describes session retention; permanent reservation contradicts transaction pooling. Supported server and explicit enablement are stated. | 2026-10-06; author checked; independent pending |
| ai200-d007 | cosmos-vector-search / cosmos-vector | C-vector | dimension + metric: 128 and cosine match the supplied vector contract. | 64 mismatches length; euclidean is valid generally but wrong for this requirement. | 2026-10-06; author checked; independent pending |
| ai200-d008 | postgres-sizing / postgres-capacity | P-compute, P-vector | cpu + memory: evaluate sustained CPU capacity and safe HNSW build-memory budget separately. | Redis TTL allocates neither; more disk does not set maintenance_work_mem. Neither action guarantees retrieval quality. | 2026-10-06; author checked; independent pending |
| ai200-d009 | cosmos-request-cost / cosmos-cost | C-read-cost, C-index | exclude + measure: avoid indexing unused debugPayload and measure write charges. | Dropping required queried paths violates the explicit contract; exclusions do not make writes free. Scalar descendants remain within /debugPayload/* path exclusion notation. | 2026-10-06; author checked; independent pending |
| ai200-d010 | redis-vector-search / redis-vector | R-vector, R-set | filter + vector: indexed compatible vectors and tenant predicate support filtered KNN. | GET addresses a key; TTL controls lifecycle, neither supplies Search KNN. Deployment Search capability is explicit. | 2026-10-06; author checked; independent pending |
| ai200-d011 | cosmos-feed-processing / cosmos-change-feed | C-processor | idempotent + leases: replay-safe effects and persistent lease coordination. | Exactly-once sink effects are unsupported; Python uses pull model rather than this .NET/Java processor builder. Existing checkpoint avoids an unqualified first-ever-delegate retry claim. | 2026-10-06; author checked; independent pending |
| ai200-d012 | redis-cache / redis-cache | R-set, R-del, Cache-aside | expiry + delete: expiration bounds copy lifetime; deletion reacts to known updates. | Plain SET supplies no expiry; deleting source history is not response-copy invalidation. Explicit no-race context. | 2026-10-06; author checked; independent pending |
| ai200-d013 | postgres-model / postgres-schema | P-extension, P-vector | extension → table → insert: enable vector type, define vector(3), then insert matching synthetic vector. | DROP removes a needed type provider; every other stage is wrong before prerequisites or after it is already completed. Component-specific candidate checks cover all positions. | 2026-10-06; author checked; independent pending |
| ai200-d014 | postgres-parameters / postgres-query | P-prepare, P-python | begin → query → commit: IDs label PREPARE, EXECUTE and DEALLOCATE, respectively. Labels are lifecycle operations, not BEGIN/COMMIT SQL. | EXECUTE before PREPARE and premature DEALLOCATE lack the statement; interpolation is outside the requested lifecycle. Every position has candidate checks. | 2026-10-06; author checked; independent pending |
| ai200-d015 | cosmos-request-cost / cosmos-cost | C-read-cost | read → cost → compare: consume all pages, sum all charges, compare complete totals. | Last page alone undercounts; comparison before the complete current total is unavailable. Sequence checks distinguish each stage. | 2026-10-06; author checked; independent pending |
| ai200-d016 | redis-cache / redis-cache | Cache-aside, R-set | miss → source → store: establish miss, obtain source response, fill with expiration. | Cannot store the fresh response before obtaining it; an unrelated stale key cannot answer the request. No concurrent update is assumed. | 2026-10-06; author checked; independent pending |
| ai200-d017 | postgres-filtered-rag / postgres-rag | P-vector | baseline → ann → recall: save exact reference, evaluate HNSW on the same workload, compare recall/latency. | Comparison needs both sets; introducing ANN before this baseline breaks the declared sequence; ANN has no perfect recall guarantee. | 2026-10-06; author checked; independent pending |
| ai200-d018 | postgres-index-choice / postgres-index | P-index, P-json | btree, gin: timestamp range and jsonb @> containment. | Hash is equality-only; indexes on the other column do not implement the required predicate. GIN operator class is explicitly jsonb_ops. | 2026-10-06; author checked; independent pending |
| ai200-d019 | cosmos-history / cosmos-query | C-read-cost, C-ttl, Cache-aside | history, cache: reconstruct durable messages from configured Cosmos authority; reuse a valid generated response from its configured copy store. | Expiring response copies cannot reconstruct required history; messages alone are not the existing generated-response copy; expiry is not absence of authoritative history. No universal exclusivity claim. | 2026-10-06; author checked; independent pending |
| ai200-d020 | postgres-filtered-rag / postgres-rag | P-vector | l2, cosine, negative: <->, <=> and <#> respectively. | Each other operator has a different metric; <#> is negative inner product, not a positive similarity scalar. | 2026-10-06; author checked; independent pending |
| ai200-d021 | postgres-pooling / postgres-connections | P-pool, P-limits | app, server: process-local client reuse versus PgBouncer backend reuse. | Disk owns neither; a local pool does not coordinate all PgBouncer clients, and PgBouncer does not own process-local checkout. | 2026-10-06; author checked; independent pending |
| ai200-d022 | postgres-filtered-rag / postgres-rag | P-vector, P-python | tenant, distance: bound WHERE tenant predicate and ascending cosine operator. | TRUE admits other tenants; DESC retrieves farthest first. Python execute tuple order matches the two SQL placeholders. | 2026-10-06; author checked; independent pending |
| ai200-d023 | postgres-parameters / postgres-query | P-python | bound, literal: one-element tuple and data semantics. | Concatenation is not binding; a bound value is not executable SQL. %s is Python client placeholder syntax, distinct from d014 server $1 syntax. | 2026-10-06; author checked; independent pending |
| ai200-d024 | cosmos-vector-search / cosmos-vector | C-vector | path, size: /embedding and 128 match the declared float32 vectors. | /content points at the wrong property; 64 conflicts with length. No model-default dimension is claimed. | 2026-10-06; author checked; independent pending |
| ai200-d025 | redis-vector-search / redis-vector | R-vector | tag, knn: tenant TAG predicate precedes the KNN clause with compatible bytes, PARAMS and DIALECT 2. | * allows other tenants; GET is not a vector clause. Only capability explicitly supported by this deployment is assumed. | 2026-10-06; author checked; independent pending |
| ai200-d026 | postgres-pooling / postgres-connections | P-pool, P-limits | limit, headroom: bound aggregate pools across replicas and reserve resources for other consumers. | Unlimited process pools can exhaust finite limits; allocating every available connection leaves no required headroom. No static numeric default is asserted. | 2026-10-06; author checked; independent pending |
| ai200-d027 | cosmos-feed-processing / cosmos-change-feed | C-processor, C-modes | yes, no: tolerate replay; latest-version feed omits hard deletes. | Opposite responses invent exactly-once delivery or all-versions-and-deletes scope. Established checkpoint and .NET V3 are explicit. | 2026-10-06; author checked; independent pending |
| ai200-d028 | redis-cache / redis-cache | R-del, R-set, Cache-aside | yes, no: deletion forces a source lookup; remaining TTL does not synchronize a stale copy. | Opposite responses deny key removal or invent source freshness before expiry. No writer/reader race is assumed. | 2026-10-06; author checked; independent pending |
| ai200-d029 | postgres-filtered-rag / postgres-rag | P-vector | no, yes: filtered ANN does not guarantee exact count/recall; bounded iterative scans can expand search. | Opposite responses invent exact filtered ANN or deny documented >=0.8.0 iterative scanning. Configured limits still apply. | 2026-10-06; author checked; independent pending |
| ai200-d030 | postgres-filtered-rag / postgres-rag | P-vector, P-python | filter + order: WHERE tenant and ascending cosine distance implement the two decisions. | Projection changes columns, not row eligibility or distance ranking. Regions are finite normalized geometry, not executable markup. | 2026-10-06; author checked; independent pending |
| ai200-d031 | redis-cache / redis-cache | R-set, R-del, Cache-aside | ttl + invalidate: expiry on fill and affected-key removal on update. | Erasing durable messages is outside the response-copy lifecycle. No concurrency claim is hidden. | 2026-10-06; author checked; independent pending |
| ai200-d032 | cosmos-feed-processing / cosmos-change-feed | C-processor, C-modes | latest, idempotent: state latest-version create/update scope and replay-safe sink effects. | Full version/deletion audit belongs to a broader mode; exactly-once effects contradict at-least-once processing. This case member explicitly covers feed consequences alongside d009 indexing and d019 history. | 2026-10-06; author checked; independent pending |
| ai200-d033 | postgres-sizing / postgres-capacity | P-compute, P-vector | memory, compute: build graph memory versus sustained query CPU. | Renaming allocates no build memory; TTL allocates no PostgreSQL compute. A safe measured RAM margin is stated, not an arbitrary unbounded memory value. | 2026-10-06; author checked; independent pending |

## Coverage and freshness families

Counts by objective: cosmos-query 2; cosmos-cost 3; cosmos-vector 2; cosmos-change-feed 3; postgres-query 3; postgres-schema 1; postgres-index 1; postgres-capacity 2; postgres-rag 6; postgres-connections 3; redis-cache 5; redis-vector 2. Total 33. Kinds: single 6, multiple 6, build 5, matching 4, dropdown 5, grid 3, hot 2, screen 2. Cases preserve authored order: case-d1 d004/d022/d030; case-d2 d009/d019/d032.

The bank has 21 distinct families. Shared families are deliberately conservative; a changed widget, number, or extra component does not make repeated core knowledge fresh:

| Family | Members | Shared knowledge |
| --- | --- | --- |
| ai200-d003 | d003, d023 | Separate title binding from SQL syntax |
| ai200-d004 | d004, d020, d022, d030 | pgvector cosine/operator identification and tenant-restricted nearest ordering |
| ai200-d005 | d005, d028 | Known stale-copy invalidation versus waiting for TTL |
| ai200-d006 | d006, d021 | PgBouncer transaction/backend reuse and pool layer |
| ai200-d007 | d007, d024 | Cosmos embedding-policy vector contract |
| ai200-d008 | d008, d033 | Separate PostgreSQL CPU capacity and HNSW build memory |
| ai200-d010 | d010, d025 | Redis Search tenant metadata plus vector KNN |
| ai200-d011 | d011, d027, d032 | Latest-version processor scope, replay and lease-backed processing |
| ai200-d012 | d012, d031 | Cache-copy expiration plus update invalidation |

The 12 remaining items use their own IDs: d001/d002/d009/d013/d014/d015/d016/d017/d018/d019/d026/d029. d029 is filtered ANN underfill/iterative-scan behavior, distinct from d017 benchmark comparison and d004 exact operator/filter syntax. d015 totals paged read charges, distinct from d009 write index cost. d016 tests cache miss-fill prerequisites, distinct from invalidating an already stale key. These distinctions remain subject to independent editorial review; none imply enough samples for mastery.
