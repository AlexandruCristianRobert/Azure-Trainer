# SDD ledger — plan: docs/superpowers/plans/2026-10-01-data-labs-05-09.md

Branch codex/data-postgres; base e059e55. Tasks 1–12 pending.
Testing: only named data tests by explicit path. No AKS, Container Apps, full suite or browser tests. Reduce checks before 30 minutes per lab.

Preflight: Tasks 1–3 consistent. Task 4 consumes Task 5 planner: execute 5 first. Task 6 consumes corpus/engine; Task 7 consumes SDK/planner/pool. Labs 5 and 7 consistent. Lab 6 needs runnable exact baseline despite starter retrieval. Lab 8 wrong-index/missing-index faults incompatible simultaneously. Lab 9 needs v3 fixture extension. Shared files/interfaces: 1/4/6/12 corpus; 2/4/5 model; 3/4/5 AST; 6/7 runtime; 7–12 helpers/seeds/evidence. Keep narrow dependencies, grade learner-built app, standalone ordered solutions, no import cycles.

Ruling: execute Task 5 before Task 4 because engine requires planner; cost: reordered tasks only.
Ruling: Lab 6 supplies fixed exact-search baseline while learner retrieval remains unfinished; cost: additional supplied route.
Ruling: Lab 8 uses separate stages for wrong-index and missing-index incidents; cost: staged narrative differs.
Ruling: preserve build formula; default B1ms build may be slow rather than fail; cost: baseline differs from failure expectation.
Ruling: native briefs and tracked ledger replace Bash helpers failing on Windows CRLF; cost: bookkeeping tooling differs.
Ruling: use accurate commit attribution rather than the plan's unrelated Claude identity; cost: commit footer differs.

| Task | Internal consistency |
| --- | --- |
| 1 | 16 documents, 32 chunks and six filtered questions agree. |
| 2 | Model validates memory ceiling also consumed by Task 5. |
| 3 | Five parser cases match required AST fields. |
| 4 | Three engine cases bring SQL file to eight; requires planner. |
| 5 | Four planner/pool cases match public exports; default memory does not guarantee build failure. |
| 6 | Two SDK cases exercise connection context manager and unsafe interpolation. |
| 7 | Template adds load.sql beyond initial file list to support Task 8. |
| 8 | Guided task and stage order agree; solution must deploy edited queries. |
| 9 | Exact baseline cannot call unfinished retrieval; fixed route ruling applies. |
| 10 | Baseline and exhaustion require distinct replica counts and durable baseline evidence. |
| 11 | Wrong-opclass index and dropped index require staged faults. |
| 12 | Independent brief requires supplied v3 rows and audience-aware filters. |

| Producer / consumer | Shared file or interface | Resolution |
| --- | --- | --- |
| 1 / 4 | CORPUS and loadCorpus | Preserve canonical document/chunk relation and dimensions. |
| 1 / 6 | embed and corpus questions | Extend PostgreSQL embedding lookup without changing Cosmos fixtures. |
| 1 / 12 | v3 corpus loader | Explicit v3 extension; preserve base corpus. |
| 2 / 4 | postgres.js server/databases/tables/indexes | Single persistent sandbox collection. |
| 2 / 5 | parameters, vCores and memory | Shared validation; planner reads server values. |
| 3 / 4 | parsePgSql/bindParams AST | No independent SQL matching in runtime. |
| 3 / 5 | index and SELECT AST | Match column, opclass, filter and LIMIT. |
| 4 / 5 | executePg -> planSelect/buildIndex | Execute 5 first. |
| 4 / 6 | SQL runtime results | Preserve errors, rows, plans, latency and session settings. |
| 5 / 7 | simulatePoolLoad | Read deployed code mode and current replicas. |
| 6 / 7 | appSpec.data and postgres calls | Capture DSN/pool in immutable build artifact. |
| 7 / 8 | manifest, helper, seed, actions | Register simulator routes and runnable standalone solutions. |
| 7 / 9 | pgDependencies and retrieval evidence | Narrow fields; stale dependent tasks only. |
| 7 / 10 | load scenario and connection stats | Record representative app call and measured mode. |
| 8 / 9 | postgres-seeds.js and schema | Supply independently reproducible prior state with unfinished current edit zones. |
| 9 / 10 | postgres-seeds.js and indexes | Seed optimized retrieval but faulty connection mode. |
| 10 / 11 | postgres-seeds.js and load | Faulty seed, staged incidents, no seeded solution evidence. |
| 10 / 12 | postgres-seeds.js and v3 load | No prior learner progress dependency. |
| 8 / 9 / 10 / 11 / 12 | labs/index.js, postgres-seeds.js, replay file | Implement and review each lab sequentially. |

Controller test elapsed: 0 seconds. Initial checkout was clean at e059e55; baseline full suite explicitly skipped by user policy.

Ruling: corpus IDs are numeric to fit Lab 5 bigint keys — plan's string expected-ID annotation conflicts with its schema — cost: expected ID representation differs.
Environment: user requests no further approval prompts; controller and workers issue no escalation requests. Default worktree dist creation denied after Vite transformed 514 modules; use dedicated permitted temporary build output, report any remaining block.
