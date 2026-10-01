# Final PostgreSQL fix wave

Status: final fix Labs 5–9. Base: `9e30c03`. Four Important findings addressed in one implementation wave; no new architecture ruling needed.

## Changes

- Lab 6 current tuned/filtered/answer dependencies now include the deployed image, connect function, captured DSN port and PgBouncer availability. Historical exact-search dependencies are preserved. Every current app solution restores canonical direct clients before building, and the solution-file snapshot matches those clients. Existing later solution steps refresh their earlier current proofs.
- Backend choice prioritizes explicit trusted `dataBackend` or receiver metadata. The PostgreSQL manifest explicitly declares its backend (inherited by the independent derivative). Explicit Cosmos receiver manifests preserve Cosmos lowering even when a real PostgreSQL import is present. Standalone inference examines parsed top-level import statements and canonical module names; comments, string literals, dotted unrelated modules and unrelated imports aliased to psycopg cannot select PostgreSQL. The bounded recognizer was not otherwise rewritten.
- psycopg SQL parameters accept a named dictionary, preserve every key, adapt each value separately and delegate placeholder validation/binding to the shared engine. Dictionary-valued parameters still require a recognized Jsonb wrapper; the outer parameter mapping does not.
- PgBouncer accepts `poolMaxSize=0` as no application pool. Its direct client demand is `ceil(RPS × 0.004)` and reservations retain default_pool_size, 5000-client and available-slot caps. The existing pool path, queue/rate model and connection limits remain. Load derives the pool maximum or direct provenance from actual SQL calls; unused globals cannot vouch for an application pool. Lab 9 accepts either threshold-compliant module pooling or direct PgBouncer with null call pool metadata. Lab 7 application-pool and Lab 8 pool-repair checks remain strict and unchanged. The direct-demand assumption is explicitly explained as a teaching estimate, with the existing not-an-Azure-guarantee label.

## Red/green evidence

Exactly two new SDK core tests and one pg-plan pool test were added. No permanent lab test was added.

RED command: `npm.cmd test -- tests/data-python-sdk.test.js tests/data-pg-plan.test.js`

Exit 1; 14 passed / 3 failed, 1.397s command wall time (Vitest 586ms). Relevant failures:

```text
backend selection: expected [] diagnostics, received DATA_UNSUPPORTED for CosmosClient(...)
named psycopg binding: expected HTTP 200, received 500
direct PgBouncer: expected served=30000/failed=0/peak=4, received served=0/failed=30000
  Not supported by the simulator: poolMaxSize must be a positive integer.
```

Each failure reproduced its reported production defect before implementation. Backend coverage includes explicit Cosmos, standalone comments/strings, real canonical imports and explicit PostgreSQL runtime-file metadata. Named binding covers scalar values, Jsonb dictionary values and unadapted dictionary rejection. Direct PgBouncer covers demand, capacity limiting, pool-mode zero rejection and disabled PgBouncer.

GREEN focused command: same two-file command; exit 0, 17/17 passing, 1.304s command wall time (Vitest 518ms).

Disposable `node .pg-final-probe.mjs` RED: exit 0, 2.523s, logged Lab 6 all seven tasks complete after port1234 redeploy despite fresh retrieval HTTP500; Lab 9 direct-bouncer SQL returned expected v3 rows with all calls bouncer/null pool metadata but load HTTP400 and scale-stable false. These observations reproduced the grading defects.

GREEN probe: same disposable script, enhanced with assertions; exit 0, 3.704s on final run:

```text
Lab6 invalid DSN done tasks: [ 'exact-knn', 'scale-up', 'build-memory', 'hnsw' ]
Lab6 fresh retrieval status: 500
Lab6 standalone answer solution restores all proofs
Lab9 direct bouncer: { status: 200, served: 30000, failed: 0, poolMaxSize: 0, peakServerConnections: 4 }
Lab9 direct PgBouncer completes with and without unused global pool
```

The temporary probe is removed and excluded from the commit.

## Final verification

`npm.cmd test -- tests/data-pg-sql.test.js tests/data-pg-plan.test.js tests/data-python-sdk.test.js tests/data-postgres-labs.test.js`

Exit 0, 9.157s command wall time (Vitest 8.28s): SQL10/10, plan7/7, SDK10/10, Labs5/5; **32/32 passing**, output pristine. All five ordered Lab replays pass, including guided pooling and troubleshooting requirements.

`npm.cmd run build`

Exit 0, 5.314s command wall time; 535 modules transformed, Vite build completed in 4.51s. Existing advisory about chunks larger than 500kB remains; no build error.

Final probe, named tests and build ran concurrently. Summed test/probe/build command wall times across red, focused green and final checks were approximately 26 seconds; the final concurrent verification batch took approximately 9.3 seconds. This is well below the 30-minute testing limit. No full, AKS, Container Apps or browser suite; no real Azure/network/Python execution.

`git -c safe.directory=E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-postgres diff --check`: exit 0, no whitespace errors (Git emits its existing LF-to-CRLF notices).

## Files owned by this commit

- `src/data/labs/data-journey/postgres-vector-guided.lab.js`
- `src/data/labs/data-journey/postgres-independent.lab.js`
- `src/data/templates/data-python/postgres.js`
- `src/lib/data/python-sdk.js`
- `src/lib/data/runtime.js`
- `src/lib/data/pg-pool.js`
- `src/lib/kubernetes/data-actions.js`
- `tests/data-python-sdk.test.js`
- `tests/data-pg-plan.test.js`
- This report.

Controller-owned progress ledger, HANDOFF and final findings are excluded.

## Self-review and concerns

Read the complete owned diff and checked each finding against the controller rulings. Self-review caught and tightened import inference so aliases and unrelated dotted modules cannot masquerade as canonical SDK imports; the existing backend test covers both. Matched the Lab 6 solution snapshot to its now-explicit restored clients. Confirmed shared SQL binding remains the sole placeholder binder, module-pooled bouncer reservation math is unchanged, direct call metadata stays null and strict guided pool checks are untouched. No unresolved correctness concern or scope expansion.

Accepted limits remain those in the ledger: this is a bounded SQL/Python teaching simulator, not proof of real Azure performance/network/auth/firewall behavior or full SQL/Python/import-alias/async/rollback semantics. Commit attribution uses the configured actual author, Alexandru Cristian Robert; no unrelated co-author footer.
