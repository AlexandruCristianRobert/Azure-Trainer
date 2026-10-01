# Task 11 / Lab 8 implementation report

Implemented from `682ca91` in the isolated `data-postgres` worktree. Registered `data-postgres-troubleshooting`, journey order 8, troubleshooting mode, PostgreSQL service, engine/content versions 2/1, and the PostgreSQL/ACR/Kubernetes capabilities. Five ordered stages contain `quote-safe`, `latency-restored`, `index-rebuilt`, `filtered-complete`, and `load-stable`; every Task has verification, narrow dependency fields, hints, an exam note and a standalone complete Solution.

## Seed and accepted incident narrative

The common seed builds only the Lab's supplied faulty app and naive clients, with no verification evidence. It supplies the existing schema/corpus, B-tree and GIN indexes, max_connections=50, and explicitly builds an L2 HNSW index while GeneralPurpose and maintenance_work_mem=65536 make the build viable. Only then does it downgrade to Burstable Standard_B1ms and 1024 kB and scale the Deployment to six. Retrieval uses an f-string exclusion containing the question, ef_search=4 and iterative_scan=off. The f-string is valid for the known authored question and fails through the actual SQL parser for an apostrophe-bearing question.

The controller approved the staged narrative before implementation: the wrong-opclass index and missing-index rebuild incident occur separately. Latency repair sizes the server and replaces L2 with cosine HNSW. The next maintenance stage explicitly drops the index, downgrades to B1ms and lowers memory to 1024 using visible ordinary commands. A CREATE at that point fails the unchanged HNSW build budget. Its Solution enacts those commands, then restores compute/memory and creates a working cosine index. No hidden fault flags or synthetic failure overrides were added. The brief describes symptoms; Task explanations and Solutions diagnose causes.

The metadata-filter defect is truthfully latent while the initial wrong index forces an exact scan. It becomes observable after the distance-index repair: the unchanged candidate model returns fewer than LIMIT 2 with ef_search=4/off. Final code uses ef_search=50 and relaxed_order scans and returns SQL rows [1,2]. Global requests return [17,9]. The quote-bearing question is intentionally outside the fixed embedding corpus: a successful recognized SQL request returns [] with no fabricated passages.

## Grading and replay

Checks require actual SQL-produced rows and plans from the Service-selected immutable deployed artifact. They compare returned rows with the actual SELECT trace. Cosine HNSW grading follows the used plan's index definition and operator class, without requiring a particular index name. Latency must be below 100ms, and rebuilding also requires sustained compute and the graph-memory formula. The load outcome requires six replicas, max_connections=50, zero failures/errors, p95 <=12ms, a positive module-pool size with 6*k <=47, and actual SQL calls reporting the used pool lifetime/size. Direct reusable pools and reusable pools through enabled PgBouncer are accepted. The supplied final Solution uses pool max_size=5, port=6432 and PgBouncer default_pool_size=20.

Self-review found that database-only repair could otherwise use the still-current supplied artifact on a known question. The local current-artifact gate now rejects the deterministic minimum numeric build-N sequence, which is this seed's single prerequisite build. It accepts a later learner build even when source or tag is reused; it does not depend on artifact object insertion order. Saved source and captured function checks still ensure that the selected artifact represents current learner files.

Solutions deploy the learner files with ACR build, edited YAML/apply and rollout restart, then scale to six after the authored two-replica manifest is applied. Subsequent retrieval or client edits refresh the earlier request verifications. All five Outcomes complete after full top-to-bottom replay. Helpers and seeds import no Lab modules; no SDK, SQL engine, planner, pool, Kubernetes or other journey core was changed.

## TDD and verification evidence

Exactly one new permanent `it` was added to the named replay file. It checks all five fresh Tasks are not done and evidence is empty, actual initial quote/scan/load symptoms, filtered under-fill after repair, an actual failed CREATE after visible maintenance commands, rejection of the prerequisite image after database-only repair, then complete ordered recovery and actual final SQL/load results.

| Command | Result | Tool wall time |
| --- | --- | --- |
| `npm.cmd test -- tests/data-postgres-labs.test.js` initial RED | 3 passed / 1 failed: `expected undefined to be defined` at missing Lab 8 registration. This was the expected missing-feature failure. | 4.758 s |
| Same focused command, first GREEN | 4/4 passed, ordered troubleshooting replay complete. | 6.462 s |
| Same focused command, symptom/stage assertions | 4/4 passed, including real quote syntax error, Seq Scan, six-replica overload, ANN under-fill and failed HNSW CREATE. | 6.987 s |
| `npm.cmd run build` | Exit 0; 532 modules transformed; Vite built in 3.93 s. | 4.621 s |
| Same focused command, final seed-build gate | 4/4 passed; Lab 8 2384ms; Vitest duration 6.41 s. | 7.240 s |
| `npm.cmd run build` final | Exit 0; 532 modules transformed; Vite built in 3.99 s. | 4.663 s |

Total verification tool wall time: **34.732 seconds** (tests 25.448 s; builds 9.284 s). Testing remained deliberately scoped and was finished well before the 30-minute threshold. No full suite, browser, AKS or Container Apps suite ran. No real network, Azure or Python execution occurred. TDD, debugging and verification skills were applied within the user's explicit named-file testing override.

## Files and self-review

- `src/data/labs/data-journey/postgres-troubleshooting.lab.js`: new Lab, faulty source, staged incident/recovery recipes and five outcome checks.
- `src/data/labs/data-journey/postgres-seeds.js`: independent troubleshooting prerequisite seed.
- `src/data/labs/index.js`: registration.
- `tests/data-postgres-labs.test.js`: exactly one new replay/incident test.
- `docs/superpowers/data-postgres-task-11-report.md`: this report.

Reviewed owned code and diff for order, standalone prerequisites, narrow fields, current captured artifacts, actual result/plan correlation, seed-only faults, scale-after-apply, and import-cycle scope. The learner-build gap found in self-review was fixed and covered by the existing new `it`. No unresolved correctness concerns. Accepted limitations: the maintenance incident is visibly staged, and ANN under-fill is latent until the wrong distance index is repaired. Both preserve the existing simulator formulas. The production build retains the existing large-chunk advisory; no new build failure or test warning was observed. The controller-owned progress ledger was left out of this commit. Git reports routine LF-to-CRLF warnings on touched text files.
