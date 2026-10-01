# Task 10 report — Lab 7 connection pooling and PgBouncer

Implemented from `b5fc1b8`. Registered `postgresPoolingGuidedLab` as `data-postgres-pooling-guided`, journey order 7, guided, 45 minutes, engine/content versions 2/1, PostgreSQL service and PostgreSQL/ACR/Kubernetes capabilities. Three stages contain six Tasks in baseline → pool → bouncer order. Each Solution includes its own required edits/build/deployment/scaling/scenarios; replaying all Solutions top to bottom completes every Task.

## Independent seed and exports

`seedPostgresPoolingGuided` is exported from the common seed module and calls independent `seedPostgresApp`/`seedPostgresSchema`. It supplies GeneralPurpose `Standard_D2ds_v5`, explicit `maintenance_work_mem=65536` kB (the graph requires 12,500 kB), explicit `max_connections=50`, loaded documents/chunks with 20,000/250,000 logical rows, document B-tree/GIN indexes and `PG_HNSW_SQL` cosine HNSW. The Lab supplies the reusable `pgVectorAppSource()` optimized Lab 6 app, but `clients.py` is `POSTGRES_NAIVE_CLIENTS`: `connect()` opens a new psycopg connection on each call. The seed builds only the caller's sources and deploys two replicas. It seeds no task/scenario evidence or current connection repair. No seed or helper imports a Lab module.

The existing `POSTGRES_POOL_CLIENTS` recipe repairs the connection wrapper: a module-level `ConnectionPool(DSN, min_size=1, max_size=5, kwargs={"row_factory": dict_row})`, with `connect()` returning `pool.connection()`. The existing app's `with connect() as conn:` blocks then use reusable connections without unrelated retrieval edits. The bouncer variant changes DSN port from 5432 to 6432. `pgLoadScenario` additionally supports only the optional literal `expectedError: 'too many clients already'`; unknown expectations fail closed.

## Conditions and evidence

- `naive-load`: actual recognized deployed SQL, two replicas, per-request/new mode, zero failures and setup-dominated 29ms p95.
- `exhaust`: actual six-replica naive SQL, HTTP 503, failed requests and the observed `too many clients already` error. A successful observation retains the failed load measurements.
- `app-pool`: current learner-built captured image/source/functions, exactly one captured module pool with positive integer k, actual six-replica load and matching actual SQL pool lifetime/maximum, explicit max_connections=50 and 6×k≤47. Static pool names or unused declarations cannot vouch for reusable clients.
- `pooled-load`: current six-replica reusable module-pool SQL/load, zero failures/errors and p95≤40% of the preserved naive baseline. Both direct pool and module pool through PgBouncer are accepted with matching captured DSN port/actual connection mode. Direct pool demonstrates 5ms versus 29ms; final bouncer Solution refreshes this proof after the DSN/image change.
- `pgbouncer`: GeneralPurpose or MemoryOptimized and enabled=true.
- `bouncer-load`: current module pool/DSN on 6432, actual six-replica 1200-RPS SQL/load, zero failures/errors and peak server connections≤current default_pool_size (solution: 20).

The three 600-RPS phases use distinct IDs `load-600rps-naive`, `load-600rps-exhaust` and `load-600rps-pooled`, with identical route/arguments/RPS/duration. This controller-approved phase naming preserves independent historical proofs instead of overwriting them. `load-1200rps` verifies the final phase.

Historical naive and exhaustion dependencies omit subsequent replica/image/pool/DSN/bouncer repairs; they include only the table definitions, chunks indexes and max_connections used by their observation. Current load/pool dependencies capture images (including actual pool globals), retrieval/connect bodies, current replicas and DSN port, individual max_connections/bouncer parameters, schema/index definitions and server SKU. Solutions refresh the current pooled proof after enabling/changing bouncer parameters and after deploying port 6432. Applying the authored two-replica YAML resets scaling, so every six-replica Solution explicitly scales after apply/restart. Required predecessor naive proof is included in standalone pooled-load and bouncer-load Solutions.

The teaching text preserves the existing declared six-cold-reservations-per-replica model and all pool formulas. It explains transaction pooling, reapplying settings in every request transaction, and no across-request session state. Supplied retrieval reapplies hnsw settings inside each connection context; production SET LOCAL guidance is identified as outside the simulator SQL subset. Numerical estimates carry `Simulated estimate — not an Azure guarantee.`

## Controller-approved narrow integration fixes

1. `data-actions.js` previously recorded all failed loads as unsuccessful experiments, while the generic evaluator requires passed/completed verification evidence. The declared expected-overload observation now completes only when representative SQL succeeded, measured status is 503, failed>0 and actual errors contain the approved literal. HTTP 503/failure/error measurements remain intact; the output explicitly says expected overload observed. Default positive-load behavior and generic evaluator are unchanged.
2. Port 6432 previously concealed whether SQL actually used a module pool: direct psycopg.connect plus an unused global pool could pass captured-global checks. PG-only SQL calls in `runtime.js` now include `poolLifetime`/`poolMaxSize` from the connection's actual pool, null when absent. `data-actions.js` requires every actual SQL call to match the captured module pool before simulating reusable-pool load. Individual direct PgBouncer requests remain supported. No interpreter/planner/formula changes were made.
3. The legacy no-resource-runtime replica cap was three. `scheduling.js` now permits six only for `dataPostgres=true` (or the already-supported resources runtime). Replay then exposed schema revalidation rejecting the six-replica runtime; `schema.js` applies that same PG-only maximum and `state.js` propagates dataPostgres into synthesized validation capabilities. Legacy three-replica behavior remains unchanged. All replica-cap/object-validation callsites were inspected once. Authored manifests remain two replicas; object apply/delete retain their legacy manifest cap and the Solutions use explicit scale commands. No AKS suite was run.

## TDD and validation timing

Exactly one new permanent `it` was added to `tests/data-postgres-labs.test.js`. It checks fresh unsolved connection tasks, compute/max_connections/two-replica seed, full ordered completion, preserved naive/exhaustion measurements, actual module-pool trace metadata, final load results and actual SQL IDs [1,2]. The first red failed at missing Lab registration. Intermediate replay failures identified unsupported scale syntax, the legacy replica cap and downstream schema validation; their results are included below. TDD/systematic-debugging/verification guidance was constrained by the explicit named-file-only testing policy; no full suite was run.

| Check | Result | Command wall time |
| --- | --- | --- |
| `npm.cmd test -- tests/data-postgres-labs.test.js` initial red | 2 pass, new Lab7 missing-registration failure | 3.430 s |
| Same file, first integration replay | 2 pass, scale requires deployment/NAME | 3.602 s |
| Same file, second integration replay | 2 pass, six-replica scaling rejected by legacy cap | 3.755 s |
| Same file after scheduling fix | 2 pass, downstream Kubernetes state/schema rejects six replicas | 3.682 s |
| Same file final green | 3/3 pass; all six Lab7 Tasks complete | 4.793 s |
| Throwaway `node task10-sabotage.mjs` | Exit 0; DSN5432 makes bouncer-load incomplete despite zero-failure actual direct-pool load | 2.057 s |
| `npm.cmd run build` | Exit 0; 531 modules, Vite 4.04 s | 4.755 s |

Total test/sabotage/build command wall time: **26.075 seconds** (unrounded values summed). Final green/sabotage/build total: **11.605 seconds**. The sabotage rebuilds/restarts the learner app with port 5432, explicitly restores six replicas, refreshes both load proofs, and checks pooled-load remains complete while bouncer-load is rejected. The temporary script and its in-memory sandbox were discarded.

Owned source/diff self-review checked captured artifact/current-source grading, actual pool provenance, narrow historical/current dependencies, phase separation, fixed load formulas, task/stage order, standalone solutions, deployment-reset scaling and independent seeds/no Lab cycles. `git diff --check` on owned files passes. The existing Vite large-bundle advisory remains. No blocking concern remains. No SDK/SQL/full/AKS/Container Apps/browser suite, real Azure/network/Python execution, subagents, controller-ledger edits or unrelated attribution footer were used. The commit uses the configured actual author.
