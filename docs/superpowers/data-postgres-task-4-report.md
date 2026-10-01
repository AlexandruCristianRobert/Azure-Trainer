# Task 4 report — SQL engine and one-shot psql

Initially implemented `pg-engine.js`, `psql.js`, shell dispatch gated by `dataPostgres`, and exactly three engine cases in `tests/data-pg-sql.test.js` (eight total). Review round 1 below adds the two authorized core regressions, bringing the SQL file to ten cases. Read the task brief, progress ledger and Tasks 2/3/5 reports. No dependencies, external execution, network, or subagents were used. Existing progress-ledger edits are outside this commit. Commit attribution follows the controller's accurate-attribution ruling.

## Downstream interfaces

- `executePg(sandbox, { server, resourceGroup, database, sql, params, session, nowMs, port })` returns `{ sandbox, results, session: { settings } }`. Internal callers may identify the server by resource name or its exact FQDN; `psql` requires its FQDN. Database existence and direct/PgBouncer port admission are validated.
- SELECT results have `{ kind: 'select', rows, rowValues, columns, rowCount, plan, latencyMs }`. `rows` are objects; duplicate projection names have last-key-wins dictionary semantics. `rowValues` are ordered arrays preserving every projection, including duplicate names across a JOIN or `SELECT *`; use these for psycopg tuples. `columns` are ordered `{ name, type, dimensions? }` objects. Use column names and row values for dict-row conversion.
- EXPLAIN results have `kind: 'explain'`, `plan.text` with the shared planner's lines (plus simulated actual time/rows for ANALYZE), empty `rows`/`rowValues`, and a `QUERY PLAN` column. Its `rowCount` is the underlying query's actual sample output count. Runtime adapters should consume `plan.text` when representing EXPLAIN output.
- Failed executions return `result.error = { code, message, hint?, line?, column? }`. Unsupported SQL retains `DATA_UNSUPPORTED` and its required message prefix. The extension denial includes the required Azure message and documentation hint. Processing stops at the failed statement, preserving preceding successful statements; a failed INSERT or corpus load publishes no partial rows. Parsing occurs before statement execution, so a parse failure applies no statements.
- Session settings are copied from an explicitly supplied `session`, returned for reuse within one request/psql invocation, and otherwise start empty. They never mutate persistent database/server settings. `nowMs` defaults to deterministic epoch time and controls default-now fields.
- `loadCorpus(sandbox, ref)` requires existing `documents` and `chunks` schemas, validates/coerces their canonical rows, replaces visible samples, and assigns declared logical sizes. It returns `{ sandbox, rowCount, logicalRows }`. An optional `ref.corpus` accepts a later authored fixture with the same corpus shape; no v3 data was invented.
- `runPsql(sandbox, tokens, { run, lab })` reads `run.project.savedFiles`, supports libpq field strings and `-h/-p/-d/-U` (also long forms), and ordered `-c`/`-f` operations. Exact saved `load.sql` content `-- simulator:load-corpus` invokes the fixed bulk-load helper. Results print tables, command tags, structured errors/hints and EXPLAIN text. It returns the updated sandbox, result records and one-shot session alongside normal shell fields. Shell `latencyMs` remains zero; simulated query latency lives on result records, with no real waiting/execution.

Behavioral actions already pass `{ run, lab }` and consume `result.sandbox`, so no action/store edits were needed. All planned PostgreSQL Labs use that engine path; legacy store handling is unchanged.

## Validation and planner integration

The engine uses `parsePgSql` and `bindParams`; it never reparses interpolated parameter data. Literal object nodes are atomic during schema validation and reach the shared evaluator without inspecting payload `kind` fields. Primitive values and vector arrays retain the binder contract.

Schema validation rejects missing/ambiguous columns, invalid references, incompatible types/opclasses, invalid index options and invalid vector dimensions, including queries against empty tables. Primary/not-null/foreign-key constraints are checked before publishing immutable mutations. Joined relations preserve qualification; projecting a missing joined column fails instead of inventing metadata. Partial-index predicates are validated against the indexed table alone, so joined document metadata cannot justify a chunks partial index.

Index registration delegates build feasibility, timing and size to `buildIndex`; SELECT delegates estimates/ANN row caps to `planSelect` and uses its shared row contexts, filtering, expression and vector helpers for actual sample results. No second SQL evaluator or ANN implementation was added. Shared plan labels remain **Simulated estimate — not an Azure guarantee.**

## Verification

Only the named SQL file was tested. No full/old suite, AKS, Container Apps or browser tests were run.

| Step | Command | Result | Command wall time |
| --- | --- | --- | --- |
| Red before implementation | `npm.cmd test -- tests/data-pg-sql.test.js` | 5 parser cases pass; 3 new cases fail because engine module is absent | 1.311 s |
| First green | Same explicit path | 8/8 pass | 1.303 s |
| psql wiring green | Same explicit path | 8/8 pass | 1.724 s |
| Throwaway psql smoke | PowerShell here-string piped to `node --input-type=module -` | Exit 0; one saved-schema/load/index/join scenario; COPY 48, logical chunks 250000, ordered duplicate-name values preserved, original sandbox unchanged | 1.185 s |
| Final scoped green | Same explicit SQL path | 8/8 pass; Vitest 0.529 s | 1.403 s |
| Production build | `npm.cmd run build` | Exit 0; 525 modules; Vite 4.29 s | 5.043 s |
| Whitespace/status review | scoped Git diff/check/status | No whitespace errors; normal LF/CRLF advisories | 0.119 s |

Recorded verification command wall time totals **12.088 seconds** (independent final test/build ran concurrently). Existing Vite large-bundle advisory remains. No permanent tests beyond the required three were added. The three cases exercise allow-list state/immutability, actual nearest-neighbor ordering, and sequential SQL/session/error persistence. The single psql smoke covers shell dispatch, saved-file loading, fixed COPY, planner integration and ordered duplicate projections. Broader schema/error branches were reviewed in source and retain the binding light-testing coverage limit.

## Review round 1 fixes

Confirmed both P2 findings against production code and exactly two new focused engine regression cases. A one-row documents table joined to three chunks produced three real matching contexts, but `selectRows` truncated them to the planner's one-row base-table estimate. Exact execution now applies only the SQL LIMIT to actual sorted/filter-matched sample contexts. The planner's row cap applies only when the chosen index method is HNSW or IVFFlat. Planner estimates and public result fields remain unchanged.

JSONB coercion previously returned bound parameter objects directly, and SELECT projections returned objects from stored sandbox rows. Mutating either the original nested JSON parameter or either output shape therefore changed persistent sandbox data. The engine now copies composite values at insertion and projection boundaries, retaining atomic literal-node evaluation. Bound partial-index predicates are also copied when registering an index, since they share that same storage-boundary issue. The JSON regression verifies nested parameter mutation, object-row and ordered-row result mutation, and continued partial-GIN usability after mutating its original JSON parameter. Storage/output copies use the project's JSON serialization convention; result `rows` and `rowValues` may share values with each other within one result, but neither holds sandbox/parameter references.

| Step | Explicit command | Result | Command wall time |
| --- | --- | --- | --- |
| Initial regression red | `npm.cmd test -- tests/data-pg-sql.test.js` | Original 8 pass; both new cases fail with reported JOIN cap and JSON parameter leak | 1.277 s |
| Exact JOIN fix verification | Same explicit SQL path | 9 pass; only JSON parameter mutation still fails | 1.279 s |
| Storage-copy fix verification | Same explicit SQL path | 9 pass; parameter isolation passes, projected-row mutation still fails | 1.291 s |
| Projection/index-copy green | Same explicit SQL path | 10/10 pass | 1.322 s |
| First build | `npm.cmd run build` | Exit 0; Vite 4.12 s | 4.832 s |
| Partial-index boundary mutation check | Same explicit SQL path, temporarily removing only index-copy fix | 9 pass; JSON case fails because mutated predicate prevents GIN selection | 1.271 s |
| Final green after restoring copy | Same explicit SQL path | 10/10 pass; Vitest 0.499 s | 1.314 s |
| Final build | `npm.cmd run build` | Exit 0; 525 modules; Vite 4.07 s | 4.790 s |

Review-round verification command wall time totals **17.375 seconds** from unrounded tool timing. Final test/build ran concurrently. No additional smoke, other test files, full suite, browser, AKS, Container Apps, dependency installation or subagents were used in this round. The existing bundle-size advisory remains. Public downstream interfaces are unchanged; exact query completeness and detached JSON storage/results now satisfy their immutable execution contract.
