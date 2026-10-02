# Data Lab 13 delivery progress — 2026-10-02

Lab `data-knowledge-assistant-capstone` is implemented on `codex/data-capstone`, based on `96e925ae02bfb58f0241ad068f2f9e5c6cb62217`. Catalog order 13 completes the existing Data journey. Seven checkpoints contain 15 measured outcomes. The UI reuses existing styles. Infrastructure, namespace and Service are supplied; learner data resources and API/worker Deployments start absent.

| Delivery boundary | Evidence/status |
| --- | --- |
| Tasks 1–6 implementation | Existing commits and task reports; controller review ledger remains authoritative |
| Task 7 implementation | Own Solutions, controls, scratch seed and exact cleanup integration complete; exact-diff self-review complete |
| Task 7 independent spec/quality review | Scoped re-review confirms S1/S2/S3/Q7-1 addressed; Q7-R1 implemented in fix round 2; Q7-2 implemented in final wave; final scoped re-review pending |
| Whole-branch review/final controller gate | Whole-branch review found F1/F2/F3 and Q7-2; consolidated fixes implemented, final scoped re-review/controller gate pending; no approval claimed |
| Local merge | Not performed |
| Remote push/publication | Not performed |

## Verification and budget

No permanent cases were added by Task 7. The branch's eight new permanent cases remain the total: two SDK plus six shared capstone cases. The final named files contain 15 SDK and six capstone cases, including their existing cases.

One evolving ignored in-process walkthrough uses `createBehavioralRun`, public `applyRunAction`, `evaluateLab`, the Lab's own file/command/scenario/action Solution steps, and the existing Task 5 public-dispatch helpers and authored incident scenarios. It is not an interactive/browser walkthrough. Development failures used the same script; per-step and per-task JSON snapshots avoid another accepted replay. One failed-prefix restart was necessary after correcting duplicate ordering against the already updated Support corpus. Later continuations resume only affected saved checkpoints. The accepted path has **25 authored answer/RAG calls**, plus **three calls across the two detached pre-incident negative forks**: total 28, with bounded modeled loads and no thousand-request loops.

Verified: absent→ready services and actual corpus/index/policy definitions; source-save versus captured Pod separation; scoped PG answers/sources; exact and paraphrase hits with history writes; foreign scopes; distinct near miss; consumed-empty-result no-match; positive no-op; both Backup cache namespace deletions; Support stale-before/fresh-after propagation; nonempty duplicate and durable restart; visible worker/pool injection; warm versus expired-cache origin pressure; cold PgBouncer recovery with API replicas three; both-resolved fresh final proof; explicit freeze; exact historical owned cleanup; resume after one seal and partial cleanup; completion only after seven seals. Eleven supplied infrastructure references remain protected. Seven creation incarnations, including worker maintenance, have seven exact deletion receipts.

Two detached negatives use the already built pre-incident run, preserving the accepted run: matching literal answers after incidental GET/SELECT, including no-match, fail returned provenance; omitting semantic deletion then applying the previously unapplied Backup revision 2 leaves the immediate paraphrase stale. Missing TTL, foreign filter and loose threshold remain review topics grounded in the existing bounded/scoped/near-miss checks, not an expanded matrix.

| Validation attempt/command | Result | Wall seconds |
| --- | --- | ---: |
| Same ignored `node .superpowers/sdd/2026-10-02-data-lab-13-capstone/task-7-walkthrough.mjs`, initial RED | Missing published Lab13 definition | 0.2920067 |
| Attempt 2 | Empty-context artifact selector initialization failure | 0.2703365 |
| Attempt 3 | Cosmos CLI requires inline policy JSON, not @file | 7.8838909 |
| Attempt 4 | Earlier provision evidence requires end-stage refresh | 12.3713047 |
| Attempt 5 | Duplicate full rows/IR exceeded compact seal bound | 30.8490549 |
| Attempt 6 | Existing affected evidence stale after selector compaction | 0.5796355 |
| Attempt 7 | Worker duplicate incorrectly followed restart/no-op | 19.3317786 |
| Attempt 8 | No-op lease upsert metadata unnecessarily staled feedback proof | 44.6037892 |
| Attempt 9 | Unknown zero embedding rejected by cosine Redis search | 10.6190915 |
| Attempt 10 | All 15 outcomes, seven seals and both negative forks passed | 88.3162541 |
| Retained-snapshot checks, attempts 11/12 | Timestamp normalization, then protected-count expectation corrected | 0.7953653 + 0.8123519 |
| Retained-snapshot checks, attempts 13/14 | Config agreement, actual corpus, saved/Pod separation, tamper, exact receipts and bounded authored count pass; no workloads replayed | 0.8265017 + 1.4383843 |
| `npm.cmd test -- tests/data-python-sdk.test.js tests/data-capstone-core.test.js` | **21/21 pass**, once after fixes | 4.1697747 |
| `npm.cmd run build` | Passed, once; existing >500 kB bundle advisory | 5.3590501 |

Task 7 subtotal before final whitespace checks: **228.5185706 seconds**. Supplied prior aggregate: **194.6124013 seconds**. Combined subtotal: **423.1309719 seconds** (7.05 minutes). All failed assertion runs count. Source/diff investigation is not a repeated validation run. Final static check timings and committed HEAD are appended to the ignored Task 7 report; controller review timings/rulings will extend this ledger.

## Implementation decisions and review boundary

Controller-authorized narrow integration decisions: add the missing protected four-argument GET `/rag` wrapper in server and manifest; carry actual consumed empty PG result provenance through protected `training_no_match(rows)` and detached scoped PG parameters; render current-zone full file Solutions and explicit action steps in TaskRow without executing hints; retain original diagnostic source/proof consistency for exactly the two authored historical incident tasks after repairs; preserve ordered actual `measurements.loads` while retaining the existing `load`, accepting warm/cold observations in one task evidence record or the earlier separate-record form. Each was investigated against the existing producer interface before editing.

Self-review fixes: compact actual row/function dependencies to consistency hashes; durable lease dependency uses id/continuation rather than incidental no-op item metadata; API pool/config must agree with saved source; unknown zero embeddings skip semantic search/storage and still produce real PG no-match/history; duplicate precedes restart; PostgreSQL corpus grading normalizes stored timestamps; protected inventory includes AKS-generated infrastructure/default namespaces. Repair/final evidence remains current and fresh; historical mode is trusted Lab definition metadata and does not relax original record hashes/source journals/incident receipt validation.

This delivery has no cloud/network validation, browser suite, real timers, installation, broad/full suite, AKS/Container Apps/legacy capstone or Data replay suite. Cosmos continuation/lease and concurrency estimates remain teaching approximations. Policy JSON files are supplied in the project; the supported simulated Cosmos CLI uses their complete inline JSON in the runnable Solutions. Whole-branch independent review and the user's integration direction remain outstanding.

## Task 7 fix round 1

Four blocking review findings were reproduced and fixed without a build or accepted walkthrough replay. The later history Solution preserves earlier RAG zones while retaining their saved/deployed checks. History reads require consumed actual Cosmos return identity and the full requested persisted item or vector-query result, with executed equality scope, requested-question embedding and similarity threshold/order semantics. PG empty-source proof now checks actual bound equality predicates rather than positional parameter values. PG readiness requires relevant documents scope/metadata and chunks embedding access paths; arbitrary names and equivalent column expressions are accepted.

The same ignored `task-7-fix-controls.mjs` exercises detached retained snapshots with deliberate parsed captured-artifact substitution: no extra builds, actual interpreted Python/store calls, original snapshot files untouched. All **12 focused controls pass**: valid alternate RAG, actual history and relevant alternative indexes; rejection of canned/incidental history, missing scope or similarity threshold (even with identical rows), unrelated indexes, inequality no-match and incidental literal. The named SDK/core command ran once for shared runtime edits: **21/21 pass**. No permanent case was added; minor Q7-2 is not part of this fix wave.

Added validation before final static check: **7.1153912s**, including setup/diagnostic failures (0.1421658 + 0.3091643 + 0.4237052 + 0.6289886 + 0.5652051), focused GREEN/final controls (0.454322 + 0.5231339), and named tests (4.0687063). Supplied pre-fix aggregate423.9989349s gives **431.1143261s** before final static check. Full commands, output summary, final static timing and commit are appended to the ignored Task 7 report. Independent re-review and whole-branch gate remain pending.

## Task 7 fix round 2

Scoped review confirmed the first four fixes and found Q7-R1: diagnostic capture tried to snapshot `condition.value` for supported `IN`, whose actual AST uses `values`. Capture now selects only documents product/version/language equality predicates needed for scope certification. Unrelated/IN predicates still execute unchanged; inequalities do not become equalities. The same ignored controls script adds one outcome-equivalent `d.id IN (all actual corpus document IDs)` control, parsed without diagnostics: RED500/DATA_UNSUPPORTED, GREEN200 with correct sources[1,2]. All earlier12 controls remain GREEN, **13 total**. Metadata-only restriction required no additional named test/build/full replay. Added RED1.1397407s + GREEN0.9659225s = **2.1056632s** before final static check; supplied aggregate431.8621002s -> **433.9677634s**. Final static timing/commit in ignored report; re-review and whole-branch gate pending.

## Whole-branch final fix wave

F1 final recovery now requires the current captured connection mode/pool size, API replicas and effective PostgreSQL capacity parameters (`max_connections`, `pgbouncer.enabled`, `pgbouncer.default_pool_size`) to match the successful cold pool recovery. The learner brief explains restoring proven settings before fresh final answers and freeze. Existing current source/evidence and freeze checks remain authoritative; a historical resolved flag alone cannot certify current capacity. F2 newly written sessions and QA history must contain the requested question; QA history must also contain the requested message identity and embedding matching an actual requested-question helper call. F3 each actual PostgreSQL trace records its executed statement kind; successful SELECT results count origin demand despite supported comments or a grouped SET LOCAL/SELECT, while cache hits remain zero. Q7-2 durable final recovery renders independently of scrollback using existing styles. M1 baseline bundle optimization remains deferred.

One ignored `final-controls.mjs` uses detached retained snapshots, real parsed learner functions/store execution and compiled-template server rendering. Final **11 controls pass**: valid final capacity, successful fresh answers with regressed capacity rejected, replica drift rejected, complete cache-hit history credited with zero origin, question-less writes rejected, separate QA identity/embedding checks, standard/commented/grouped actual retrieval counted and durable recovery displayed with empty scrollback. The grouped control uses supported literal SQL values because this bounded grammar binds parameters per statement; SQL binding behavior was not expanded. Original snapshots and accepted walkthrough artifacts are untouched. No permanent cases were added.

| Final-wave validation | Result | Wall seconds |
| --- | --- | ---: |
| `node .superpowers/sdd/2026-10-02-data-lab-13-capstone/final-controls.mjs`, initial setup/RED | F1/F2/display RED; comment Python setup and parameterized group setup corrected | 2.100866 |
| Same command, corrected setup/RED | F1/F2/comment/display RED; grouped fixture changed to supported literal values | 1.6955988 |
| Same command, meaningful RED | Seven intended regression failures; valid controls pass | 1.8743666 |
| Same command, GREEN | 10 controls pass | 2.3176408 |
| Same command, separate QA identity/embedding GREEN | 11 controls pass | 1.6845817 |
| `npm.cmd test -- tests/data-python-sdk.test.js tests/data-capstone-core.test.js`, once | **20/21**; SDK15 pass, one core load fixture expected credit for history missing newly required fields | 11.9096768 |
| `npm.cmd run build`, once | 568 modules, passed; existing >500kB advisory | 14.4760703 |
| `npm.cmd test -- tests/data-capstone-core.test.js`, authorized fixture-only exception | **6/6 pass**, corrected existing fixture payloads; assertions/case count unchanged | 11.0822236 |

Final-wave validation subtotal before staged whitespace check: **47.1410246s**. Supplied measured prior **434.0306137s** gives measured **481.1716383s**. The final reviewer probe has unknown duration; controller separately allocates **300s conservatively**, not measured time or an upper bound. Accounted subtotal is **781.1716383s (13.02min)** before staged whitespace check. Final exact timing/commit and full RED/GREEN output are in the ignored `final-fix-report.md`. Only the six-case core file was rerun after the fixture correction; no second SDK/21-case run or build is claimed. No walkthrough replay, browser/cloud/network/legacy/full suite, installation, merge, push or PR occurred. Final scoped review remains pending.
