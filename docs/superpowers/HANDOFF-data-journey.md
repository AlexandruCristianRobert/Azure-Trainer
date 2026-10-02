# Data journey — handoff

PostgreSQL Labs 5–9, terminal focus, and editor keyboard changes have been fast-forward integrated into `main` from `codex/data-postgres`, based on `e059e55`. Integration is reviewed and verified; the requested publish target is `origin/main`. The older Cosmos branch notes below are historical.

The approved Redis Labs 10–12 batch was fast-forward merged into local `main` from `codex/data-redis` at `05c3abb`, following the user's option 1. The merged tree passed all 20 named core cases in 3.401 seconds and build in 6.016 seconds. No remote push or publishing was performed. Labs 10–12 and shared simulator support are present. Tasks 1–8, including Lab 12, have controller-recorded review approvals. Final bounded validation passed; the whole-branch review found two Important proof defects and two minor fixes. The final fix wave addresses those findings, and its scoped rereview approved all findings with no new blocking issue. The merged Redis feature worktree and branch were removed after verification; committed source, reports and rulings remain on main. Publishing still requires user direction. Lab 13 remains a separate capstone plan. Preserve the named-core-tests-only policy and reduce verification if a lab exceeds 30 minutes.

## Redis status — 2026-10-02

| Lab | File | Evidence |
| --- | --- | --- |
| 10 Guided: exact cache, TTL, invalidation, vector reuse | `src/data/labs/data-journey/redis-cache-guided.lab.js` | `data-redis-task-6-report.md` |
| 11 Troubleshooting: freshness, memory, scope, schema/relevance | `src/data/labs/data-journey/redis-troubleshooting.lab.js` | `data-redis-task-7-report.md` |
| 12 Independent: scoped answer caching contract | `src/data/labs/data-journey/redis-independent.lab.js` | `data-redis-task-8-report.md` |

The eight-task plan is `docs/superpowers/plans/2026-10-01-data-labs-10-12.md`; the controller ledger is `docs/superpowers/data-redis-progress.md`. Reports `data-redis-task-1-report.md` through `data-redis-task-8-report.md` record commands, results, review fixes and limitations. Prior implementation commits are `af71ed9` (resources/fixtures), `c310732` (storage), `a621f1c` (search), `74f657b` / `3d37b54` (SDK and protection fixes), `9a79a87` / `f4a2c40` (application pipeline and read-time age), `5f301fe` (Lab 10), `eb8e653` (Lab 11), and `3385875` / `1baf339` (Lab 12 and complete-frame lifetime/deletion fixes). Task 8 and its review are complete; decisions are in the controller ledger.

Shared support includes Managed Redis CLI/portal state, NoEviction storage and expiry, filtered HASH/FLOAT32/DIM-8/COSINE search, redis-py lowering/runtime, protected helpers/templates, independent seeds and deployed-image workload execution. Routing requires `dataRedis` plus a trusted Redis manifest. Saved drafts only become active through save, ACR build, a distinct Deployment image and apply. No real Azure, network calls or Python execution occurs. All estimates are teaching models, not Azure guarantees; the 64 KiB memory bound is not the real Balanced_B0 capacity.

Exactly nine new permanent core case bodies were added: storage 4, search 3 and Redis SDK 2. The SDK file retains its 11 earlier cases (13 total), so the final three named files contain 20 cases in total. No permanent per-Lab tests were added. Verification uses disposable in-process solution actions and one negative probe per Lab, plus builds; these are not manual browser walkthroughs. The guided walkthrough is recorded in Task 6; Task 7 records its interrupted prefix and search continuation. Task 8 records the same-action source-generation RED/GREEN check, one ordered worked-solution path and its exact-only negative continuation. No full suite, AKS/ACA tests, existing PostgreSQL replay, browser automation, package installs or TTL wall waits were run for this batch.

Lab 12's actual 20-request measurements were HTTP 200, four exact hits, five semantic hits, hitRatio 0.45, all scoped answers/source IDs correct, zero stale/cross-filter answers, zero persistent keys and rejected writes, known maximum hit age 0 seconds, and final memory 2,293 bytes. It advanced simulation 61 seconds and observed six expirations. Immediate Backup invalidation returned revision 2 without advancing time and preserved Support exact/semantic hits. Exact-only caching produced correct answers but semanticHits=0 and hitRatio=0.20, so the contract failed. Task 8's single production build passed in 4.923 seconds; the existing bundle-size advisory remains.

Source updates now refresh dependency generations before recording the new Redis scenario proof. Historical source-dependent records remain unchanged and stale when their source changes; the same newly completed source-changing scenario is current immediately. Fixed revision-2 updates are idempotent on repeated workloads. The worked solution runs immediate freshness first for the real revision-1→2 transition, then the main workload; the main workload still declares its update/invalidation sequence and independently performs revision-1→2 on a fresh seed. See Task 8's report for the disposable harness's temporary three-task identity mismatch after both real tasks had passed; it resumed only the negative probe, without a second full positive replay. The final primed-key deletion predicate subsequently passed one controller-authorized affected freshness-only check in 2.303 seconds, including same-action current proof and unchanged old source-dependent record becoming stale.

Lab 12 review found and fixed display-capped lifetime/deletion grading. Each request now carries bounded complete-frame cache mutation identities and actual request-boundary lifetime facts; Lab 12 grades these independently of the display trace. The focused regression rejects a hidden German TTL61 write while valid TTL60 code with 100 harmless GETs per answer passes freshness and all 20 requests, hitRatio 0.45, and the original two-task Lab's actual `isComplete=true`. The same valid case accepts SET followed by EXPIRE, preserved HSET expiry, and duplicate/absent DEL arguments without inventing removed keys. This resolves the earlier harness identity completion-assertion limitation. The fix-round build passed in 5.061 seconds with the existing bundle advisory; commands and 13.339-second verification wall are in the Task 8 report. No permanent cases or broad verification matrix were added.

Final bounded validation at `1baf339` passed all 20 cases in the three named core files in 2.387 seconds and the production build in 4.885 seconds; see `data-redis-final-report.md`. Whole-branch review at `51f9bf2` subsequently found equality-based returned-answer provenance and remaining Guided/Troubleshooting grading through display-capped calls. The final fix uses Redis-only runtime sidecar provenance tied to the actual returned value and bounded complete-frame witnesses for every Redis Lab predicate, and normalizes numeric/string key ages. Its verification and limits are in `data-redis-final-fix-report.md`; the controller's scoped rereview approved all findings. Final accepted-tree validation at `2ef54ef` passed 20 cases in 2.576 seconds and build in 5.211 seconds. The declared provenance boundary certifies whole-answer codec/container/function transport, not independent field-by-field equivalent reconstruction. The existing bundle-size advisory is explicitly deferred. UI was compiled but not browser-tested. Production concurrency, identity, networking, monitoring, messaging and replication remain outside this batch.

## PostgreSQL status — 2026-10-01

Labs 5–9 and their shared simulator support are implemented and task-reviewed. All 12 plan tasks are complete. Final whole-branch review's four original findings were addressed; its residual pool-accounting issue was resolved in the user-authorized integration follow-up. Terminal submission also restores focus to the new prompt. Focused integration-follow-up review approved the change without findings. Progress, review fixes, verification timings and controller decisions are recorded in `docs/superpowers/data-postgres-progress.md`. Task reports are `docs/superpowers/data-postgres-task-N-report.md`.

Validation is intentionally bounded: named Data files only, no existing AKS/Container Apps suites, full suite or browser tests. Lab replay/build checks have taken seconds, not the 30-minute per-lab limit. Real Azure deployment and real Python/SQL execution are outside this simulator's scope. The existing Vite bundle-size advisory remains.

| Lab | File |
| --- | --- |
| 5 Guided: Connect, schema, B-tree and GIN | `src/data/labs/data-journey/postgres-connect-guided.lab.js` |
| 6 Guided: pgvector sizing, filtered RAG | `postgres-vector-guided.lab.js` |
| 7 Guided: Connection pools and PgBouncer | `postgres-pooling-guided.lab.js` |
| 8 Troubleshooting: PostgreSQL incidents | `postgres-troubleshooting.lab.js` |
| 9 Independent: v3 audience-aware retrieval and throughput | `postgres-independent.lab.js` |

Shared support includes `src/lib/data/pg-sql.js`, `pg-engine.js`, `pg-plan.js`, `pg-pool.js`, `psql.js`, PostgreSQL SDK/runtime lowering, Flexible Server CLI/portal state, and the PostgreSQL template/data pipeline. Six-replica validation is gated to PostgreSQL labs; legacy replica limits are preserved.

The latest merged-main six-file run passes 42 tests: SQL 10, plan 7, SDK 11, five Lab solution replays, one terminal-focus component regression, and eight editor keyboard tests. Vitest took 8.18 seconds; build passed in 4.17 seconds with the existing bundle advisory. Browser walkthroughs and excluded journey suites have not been run. Thresholds and connection/vector estimates are teaching models, not Azure guarantees. The independent v3 extension uses its own protected manifest and loader and preserves the base corpus.

### Resolved integration follow-up

Actual PG SQL calls now report request-local poolIdentity, preserving identity across checkouts and distinguishing equal-sized pool objects. Load simulation rejects multiple active pools as unsupported rather than undercounting them. Unused global pools do not affect the modeled active pool, and direct PgBouncer remains supported.

The terminal waits for the replacement prompt to render after a submitted command, then restores focus after success or error. See `data-postgres-merge-prep-report.md` for red/green regressions and the pool-load probe. Historical final review records remain in `data-postgres-final-findings.md` and `data-postgres-final-fix-report.md`.

The approved editor defaults are four spaces for Python/C# and two for other files. Tab/Shift+Tab indent/unindent current or selected rows; Enter preserves indentation and adds one unit after a Python block colon. Escape followed by Tab/Shift+Tab leaves the editor. Python handling is intentionally line-local, not a full parser or formatter. Focused review's backward-navigation finding was fixed in `59e6053`; scoped rereview approved it without remaining findings. See `project-editor-keyboard-report.md`.

## Status — 2026-10-01: Labs 1–4 (Cosmos DB) complete

All 11 tasks of `docs/superpowers/plans/2026-10-01-data-labs-01-04.md` are implemented. Each task was reviewed. A final whole-branch review on Opus returned "ready with fixes", and a single fix wave addressed all 11 findings; its scoped re-review was clean. The four Labs are registered on Home under the **Data journey** (`data-knowledge-assistant`). Not merged to `main`.

- Spec: `docs/superpowers/specs/2026-09-30-data-learning-journey-discussion.md`
- ADR: `docs/adr/0003-shared-sdk-call-catalog-for-data-labs.md`
- Ledger (every task, fix round, ruling and deferred minor): `docs/superpowers/data-journey-sdd-ledger.md`

| Lab | File |
| --- | --- |
| 1 Guided: Conversation History with the Cosmos DB SDK | `src/data/labs/data-journey/cosmos-sdk-guided.lab.js` |
| 2 Guided: Similar questions and a change feed processor | `cosmos-vector-guided.lab.js` |
| 3 Troubleshooting: Conversation History incidents | `cosmos-troubleshooting.lab.js` |
| 4 Independent: Cosmos feedback feature | `cosmos-independent.lab.js` |

Shared engine: `src/lib/data/` (query evaluator, RU cost model, SDK catalog, Python recognizer, runtime, change feed), `src/lib/kubernetes/data-actions.js`, `src/data/templates/data-python/cosmos.js`, `src/data/fixtures/data/knowledge.js`.

## Testing rules (from the learner — must be followed)

- Do not run the existing test suite (`npm test` / `vitest run` without a path).
- Keep tests light. The only Data journey tests are:
  `npx vitest run tests/data-cosmos-query.test.js tests/data-cosmos-cost.test.js tests/data-python-sdk.test.js tests/data-cosmos-labs.test.js` (19 tests, all passing).
- A Lab is verified by `npm run build`, its solution-replay test, and one manual walk-through. **The manual walk-through of Labs 1–4 in the browser hasn't been done yet.**

## How to continue

1. Walk through Labs 1–4 once in `npm run dev`.
2. Decide whether to merge `data-journey` into `main`.
3. Next batch: the Labs 5–9 (PostgreSQL) plan is written: `docs/superpowers/plans/2026-10-01-data-labs-05-09.md` (12 tasks: corpus, flexible server model + az + Blade, SQL parser, engine + psql, planner/pool model, psycopg SDK, template + pipeline, Labs 5–9). Execute it with superpowers:subagent-driven-development on Sonnet subagents.

## Design rules learned (carry into Labs 5–13)

- **Guided Labs:** `stages` and `tasks` are in one order, and that order can be completed top to bottom.
- **Dependencies are narrow:** each verification Task lists only the fields it depends on (`images:<deployment>`, `code:<deployment>:<function>`, `deployedConsistency:<deployment>`, `indexing:<container>`, …). Fixing one thing must never stale another Task's evidence.
- **Solutions stand alone:** every Solution is a complete worked answer (edit, build with a distinct tag, edit yaml, `kubectl apply`, run the scenario). Replaying all Solutions in order completes the Lab.
- **Grade the learner's own work:** Tasks grade the learner's own deployed code. Seeds deploy starter or faulty edit zones, never solved ones. `raise NotImplementedError` fails at call time, so partial builds are allowed.
- **Checks read app results:** checks use rows and charges the app returned, never post-filtering inside the check.
- **No import cycles:** `cosmos-helpers.js` imports no Lab module, and a seed file imports at most one sibling Lab module.
- **Light tests:** one solution-replay `it` per Lab, plus a quick throwaway sabotage check that the Task fails without the learner's fix.

## Rulings made on the learner's behalf (review these)

The full list is in the ledger. The ones that matter most:

1. **No full suite:** never run the full suite. It overrides the superpowers template. Cost if wrong: an existing-test regression goes unnoticed until you run it.
2. **Vector indexing:** a vector `ORDER BY` counts as indexed when a vector index exists, even with `/embedding/*` excluded.
3. **Change feed:** it reaches the runtime through an injectable hook. `read_lease` returns None on 404, labelled simulator-only, with the real try/except shown in a comment.
4. **Worker Deployments:** `src/lib/kubernetes/schema.js` accepts a container `command` field only for `dataCosmos` Labs. `src/lib/project/build.js` skips `PORT_MISMATCH` only for data apps. Both are gated, and other Labs are unchanged.
5. **Lab 1 order:** Lab 1 runs indexing before verification, so it no longer shows the composite-index error first. Lab 3 teaches that error as an incident.
6. **Weak-consistency reads:** under Eventual/ConsistentPrefix, reading an item created in the same request returns 404 ("not yet replicated"). Reading an updated item returns the previous version. Both are teaching approximations.
7. **Lab 4 feedback read:** Lab 4 adds a `question_feedback` edit zone and route. The query grammar now allows `VectorDistance(...) >= x` in WHERE.
8. **Lab 4 scale:** `logicalScale` is 2, not 50, because the 3 RU budget can't be reached at 50 with the cost model. Cross-partition fan-out still costs about 7.5 RU more.
9. **`delete_item`:** unsupported at runtime, because no Lab uses it.
10. **Change log growth:** the unbounded `changeLog` growth is deferred.

## Log

- 2026-10-01 — Labs 5–9 (PostgreSQL) plan written; branch merged into main.

- 2026-10-01 00:14–02:12 — design docs, plan, Tasks 1–7 (engine) implemented, reviewed and pushed; stopped at the 2:30 deadline rule.
- 2026-10-01 08:54–11:02 — Tasks 8–11 (Labs 1–4): each implemented, reviewed and fixed (one fix round each for Labs 1, 3 and 4), then pushed.
- 2026-10-01 — final whole-branch review on Opus found 5 Important and 6 Minor issues. One fix wave addressed all 11, and the re-review was clean.
