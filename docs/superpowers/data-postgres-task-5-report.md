# Task 5 report — PostgreSQL planner, build, recall and pools

Created `src/lib/data/pg-plan.js`, `src/lib/data/pg-pool.js`, and exactly the four specified cases in `tests/data-pg-plan.test.js`. Planner decisions consume Task 3's bound AST; no SQL is independently reparsed. No dependencies installed, no Azure/network calls, no old journey changes. Engine wiring is deferred to Task 4 under the controller's explicit dependency-order ruling; `pg-engine.js` does not exist yet.

## Planner and build behavior

The planner recognizes a B-tree equality predicate on its leading column (a usable leftmost prefix), matching JSONB containment for GIN, and ANN expression/operator/opclass combinations with ascending distance ordering and LIMIT. A vector distance query without a usable matching ANN index stays exact with Seq Scan cost. Multiple ordering keys conservatively retain the exact plan. Query tuning reads settings before server parameters, then deterministic defaults: HNSW ef_search 40, IVFFlat probes 1, lists 100, iterative scan disabled.

Costs and recall use the specified formulas. Matches are the real bound WHERE matches over joined sample contexts, scaled by the table's declared logical rows; predicate operators include equality, comparisons, IN, JSON containment, JSON extraction and vector distance. Qualified joined relations do not overwrite base rows. HNSW candidates equal ef_search; IVFFlat candidates equal probes × logicalRows / lists. ANN row counts use the actual conditional sample fraction and are capped by LIMIT and estimated matching rows. HNSW iterative scanning fills available matching rows up to LIMIT at 1.5 times latency. Partial indexes require conservative query-predicate implication: identical predicates, equality/IN subsets, and stronger JSON containment are supported. Samples alone never prove implication. An indexed chunks predicate cannot be justified by a filter on joined documents metadata.

Index casts match the query expression including cast type/dimensions. Vector decoding and distance evaluation validate finite arrays and dimensions; halfvec uses two bytes for the graph-memory and index-size estimates. Build and size formulas are unchanged, using only the indexed subset for a partial index. With 250000 rows × 8 vector dimensions, graph memory is 12500 kB, index size is 10.4 MB and an in-memory build on two cores is 100 simulated seconds. The public default 65536 kB fits; at 1024 kB the estimate is 7324.21875 seconds and fails the 1800-second budget. Lab 6 must explicitly seed 1024 kB as already ruled. The server model continues to own the 25%-of-memory parameter ceiling.

All figures are **Simulated estimate — not an Azure guarantee.**

## Shared Task 4 interfaces

`planSelect(db, boundSelect, settings, server)` returns node, optional index name, estimatedRows, latencyMs, recall, rowsReturnedBeforeLimit and EXPLAIN-style `text` (array of lines). `buildIndex(db, createIndex, server)` returns `{ ok: true, buildSeconds, sizeMb, label }` or `{ ok: false, error }`; it does not mutate/register an index. `simulatePoolLoad` is exported from `pg-pool.js` and re-exported from `pg-plan.js`.

Shared helpers exported by `pg-plan.js`:

- `makePgRowContext(row, tableName, alias?)` creates `{ row, relations }`, with the base row under its name and alias.
- `samplePgContexts(db, boundSelect)` evaluates actual qualified equality JOINs and returns those contexts. Missing joined matches produce no context.
- `evaluatePgExpression(expression, context)` handles bound literals, column qualification, JSON extraction, casts, distance and star. Primitives/object/array parameter values remain data. SQL aliases belong to the caller's projection names.
- `matchesPgWhere(context, conditions)` evaluates the AND condition list, treating NULL as excluded by WHERE.
- `decodePgVector(value, dimensions?)`, `jsonContains(actual, wanted)`, and `pgPartialIndexUsable(index, boundSelect)` expose the same decoding/containment/implication logic.

Expression/vector errors throw an Error with `code: 'DataError'`; unbound/unsupported AST operations use `code: 'DATA_UNSUPPORTED'` and the required message prefix. The engine should validate schema/existence/constraints, catch these errors, obtain/filter/sort actual contexts with these helpers, cap output at `min(LIMIT, plan.rowsReturnedBeforeLimit, actual matched sample count)`, then project via the evaluator. Exact `rowsReturnedBeforeLimit` is a logical cardinality estimate; it never authorizes fabricating sample rows. ANN recall is a teaching estimate, not an independently implemented graph search.

## Pool formula and scheduling assumption

Steady direct concurrency at 600 RPS × 29 ms is 17.4 regardless of replica count, so it cannot by itself reproduce the specified replica-scaling incident. The controller approved an explicit teaching workload assumption: a synchronized cold-connection burst reserves **six overlapping connection attempts per replica**, added to steady demand. Direct peak demand is `ceil(RPS × 0.029 + replicas × 6)`. This is a deterministic scheduling scenario, not an Azure platform claim.

Available server slots are `max_connections - 3`. Direct accepted fraction is `min(1, available / peakDemand)`; served requests are floored and also bounded by connection service capacity over the window. Pools reserve `replicas × poolMaxSize` persistent server connections and remove the cold burst; PgBouncer reserves at most default_pool_size with 5000 client slots and requires enabled=true. Query demand for either pooling mode is `ceil(RPS × 0.004)`. Connections above available slots cause the specified too-many-clients error. Requests beyond service capacity over the load window remain unserved. `queueFactor = max(0, demand / capacity - 1)` and `p95 = setup + 4 × (1 + queueFactor)`, with setup=25 ms direct and 1 ms pooled. Throughput is served / seconds.

Hand-calculated prescribed scenarios at max_connections=50 (47 available), over ten seconds:

| Mode | Replicas / RPS | Peak server connections | Served / failed | p95 ms |
| --- | --- | --- | --- | --- |
| Per request baseline | 2 / 600 | 30 | 6000 / 0 | 29 |
| Per request scaling incident | 6 / 600 | 47 of 54 attempted | 5222 / 778 | 29.596 |
| Pool, five slots per replica | 6 / 600 | 30 | 6000 / 0 | 5 |
| PgBouncer, forty slots | 6 / 1200 | 40 | 12000 / 0 | 5 |

These are formula derivations, not additional executed test cases. Eager pool reservation is also a teaching assumption: all configured persistent slots count even when the instantaneous query demand is smaller.

## Verification

| Step | Command | Result | Elapsed |
| --- | --- | --- | --- |
| Red before implementation | `npm.cmd test -- tests/data-pg-plan.test.js` | Exit 1, expected missing pg-plan.js module; no collected cases | 3.644 s command wall time; Vitest 0.981 s |
| Green | `npm.cmd test -- tests/data-pg-plan.test.js` | Exit 0, 4/4 passed | 3.555 s command wall time; Vitest 1.17 s |
| Parser compatibility | `npm.cmd test -- tests/data-pg-sql.test.js` | Exit 0, 5/5 passed | 3.308 s command wall time; Vitest 1.02 s |
| Build | `npm.cmd run build` | Exit 0; 519 modules; production artifacts generated | Vite 11.29 s |
| Whitespace/status review | `git diff --check` and scoped status | No whitespace errors; pre-existing ledger CRLF advisory only | 0.388 s combined command |

No existing/full suite, AKS, Container Apps or browser tests were run. The SQL file currently has five cases; Task 4 adds the remaining three. Existing Vite bundle-size advisory remains. The required four cases cover ANN operator/opclass choice, ef_search tradeoff, low-memory build failure and direct exhaustion versus PgBouncer. B-tree, GIN, partial predicate implication, joins, casts, IVFFlat, iterative scan and further pool scenarios were reviewed in source, with no extra tests added under the binding light-testing rule. This is an explicit coverage limitation. Task 4 must wire and verify runtime consumption. The progress ledger's unrelated existing change is not part of this commit. Commit attribution follows the accurate-attribution ruling; no unrelated Claude footer.

## Review round 1 fixes

Confirmed both P2 findings with exactly two new core regression cases. The original binder inserted object parameters directly into expression slots; `evaluatePgExpression` dispatched on their `kind` property, so JSON `{ kind: 'article' }` threw DATA_UNSUPPORTED and expression-shaped JSON could be evaluated as AST. The binder now represents every non-null, non-array object parameter as **`{ kind: 'literal', value: originalData }`**. The evaluator returns that node's value directly, without inspecting data fields. AST traversals, including binding an already-bound statement, treat literal nodes as atomic and must never descend into `literal.value` as AST. Cast nodes surround these literals normally; WHERE containment and partial implication both unwrap them through the shared evaluator. Primitive values, LIMIT integers and vector arrays keep their existing representations. The regression covers ordinary kind-bearing JSON, malicious column-shaped JSON, jsonb casts and partial-index implication through parse → bind → evaluate. Task 4 must consume this updated bound AST contract rather than independently interpreting parameter objects.

The PgBouncer model previously reserved the full configured default_pool_size even when there was one pooled client. Its client reservation is now `replicas × poolMaxSize`; server reservation is `min(clientReservation, 5000, default_pool_size)`. The 5000-client admission fraction is based on the actual client reservation, not query concurrency. Remaining server-capacity and queueing formulas are unchanged. The one-client regression now serves all 1000 requests over ten seconds with one peak server slot and zero failures instead of reserving 50 slots and failing 60 requests. This refines the original pool description above; all four prescribed baseline/scaling/pool/PgBouncer scenario calculations remain unchanged.

| Step | Command | Result | Elapsed |
| --- | --- | --- | --- |
| Regression red | `npm.cmd test -- tests/data-pg-plan.test.js` | Exit 1; original 4 pass, both new cases fail with the reported symptoms | 1.493 s command wall time; Vitest 0.465 s |
| Regression green | `npm.cmd test -- tests/data-pg-plan.test.js` | Exit 0; 6/6 pass | 1.232 s command wall time; Vitest 0.377 s |
| Parser compatibility | `npm.cmd test -- tests/data-pg-sql.test.js` | Exit 0; 5/5 pass | 1.211 s command wall time; Vitest 0.366 s |
| Build | `npm.cmd run build` | Exit 0; 519 modules; existing bundle advisory | 4.833 s command wall time; Vite 4.11 s |

Round 1 required verification command wall time totals 8.769 seconds. No other tests, dependency installation or engine edits were performed. Partial implication and jsonb-cast coverage now include the specific data/AST collision regression; broader original coverage limits still apply.
