# Data Lab 13 delivery progress — 2026-10-02

Lab `data-knowledge-assistant-capstone` is implemented on `codex/data-capstone`, based on `96e925ae02bfb58f0241ad068f2f9e5c6cb62217`. Catalog order 13 completes the existing Data journey. Seven checkpoints contain 15 measured outcomes. The UI reuses existing styles. Infrastructure, namespace and Service are supplied; learner data resources and API/worker Deployments start absent.

| Delivery boundary | Evidence/status |
| --- | --- |
| Tasks 1–6 implementation | Existing commits and task reports; controller review ledger remains authoritative |
| Task 7 implementation | Own Solutions, controls, scratch seed and exact cleanup integration complete; exact-diff self-review complete |
| Task 7 independent spec/quality review | Pending controller dispatch |
| Whole-branch review/final controller gate | Pending; no approval claimed |
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
