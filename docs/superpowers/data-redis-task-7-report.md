# Task 7 — Lab 11 Redis incident troubleshooting

Implementation author: Codex. Worktree `.superpowers/worktrees/data-redis`, branch `codex/data-redis`, base `58dfa080097875579f4eef383886210732cfccd3`. No merge, push, subagent/reviewer dispatch, controller-ledger edits or shared-core changes.

## Implemented

Registered `data-redis-troubleshooting`, journey order 11, four ordered stages and six tasks. The canonical independent seed now supplies RediSearch and the initial HASH/FLOAT32/HNSW/COSINE DIM-8 index, per the controller ruling. Only the two wrong invalidation prefixes are initially faulty; no task evidence is seeded. Shared source templates/functions supply complete source cuts without sibling Lab imports.

1. Freshness: the faulty seed scans `ka:answers:` / `ka:semantic:`. The diagnostic primes Backup and Support, updates Backup to revision 2, calls learner invalidation and observes stale exact and semantic revision-1 answers. Recovery scans/deletes both correct product prefixes, returns revision-2 answers, and preserves an actual Support exact hit. The controlled reset is explicitly described as freshness-experiment preparation.
2. Memory: visible full code/build/new-tag/Deployment/apply steps remove string SET EX and hash EXPIRE. The workload has 256 declared known aliases, each GET /cached followed by a one-second simulation advance. Both initial/final 61-second advances are synchronous. Under NoEviction it fills the 64 KiB teaching bound and rejects writes; it does not evict. CLI inspections show TTL for both canonical string/hash and INFO memory. The separate, explicitly named `purge-owned-cache` button deletes only owned `ka:answer:*` and `ka:sem:*` entries, preserving sources/index. Recovery verification never performs cleanup; it requires zero persistent keys/rejected writes, actual SET EX/EXPIRE calls and expiry. A repaired deployment cannot retroactively repair old persistent entries. The cleanup task's historical snapshot retains the index's 256-byte base cost.
3. Scope: visible entry replaces both exact-key call sites and the hash-key call site with question-only names. The same wording is tested against Backup v1/en, Backup v2/en, Backup v1/de and Support v1/en, then through both answer routes and hash writes. Wrong returned scope is observable despite successful HTTP. Complete repair restores every scoped helper call and explicitly purges both unsafe namespaces. Recovery requires all twelve answers correct, four exact hits, eight origins, and scoped HSETs for all four variants.
4. Search: visible FT.DROPINDEX/CREATE commands install DIM 12. A displayed DEL removes only the canonical exact key to force a vector search against existing hashes. The eight-dimensional query reports native ResponseError. Recreating DIM 8 without DD preserves hashes and reuses a correct stored paraphrase answer. Only the next task visibly deploys threshold 0.20. Its explicitly described controlled reset primes only the canonical hash, avoiding pollution by earlier paraphrase/near-miss hashes. HTTP succeeds but the near miss returns a wrong semantic answer. Threshold 0.05 recovers one paraphrase hit and a distinct source near-miss answer.

Every code-changing Solution displays complete cumulative app.py, a distinct image tag, complete Deployment YAML and apply. No verification toggles faults. The final Solution refreshes freshness, memory, scopes and dimensions because their selected code/index actually changed; cache/time are not dependency fingerprints. Explicit cleanup has only resource dependencies. No new stage hook or UI framework was needed.

## Verification scope and results

The brief overrides full-suite/TDD defaults. One ordered Solution walkthrough was interrupted by an authored schema-probe issue and resumed only for search with a reconstructed stage-3 handoff through actual save/build/apply/actions. The controller explicitly approved this narrow continuation. The initial stage 1–3 fault/recovery matrix was not replayed. One disposable threshold-0.20 negative followed the completed walkthrough. No permanent tests, full suite, AKS/ACA/browser tests, package installs, network, real Azure/Python execution or real TTL waits. UI is compiled, not browser-tested.

### Initial ordered walkthrough

Command: `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-7-check.mjs`.

Seed assertions passed: catalog identity, stage/task order, zero solved tasks/evidence, RediSearch enabled and DIM 8. Every Solution step invoked real save-file, command or declared data-cache actions. Immutable deployed artifact identity and complete runtime traces were checked. Diagnostics intentionally failed task predicates; successful repairs passed them.

Relevant output before the interruption:

```text
fresh-after-invalidation #1: HTTP200 total5 responseHits2 semanticHits1 origins2 staleAnswers2 answersCorrectfalse donefalse
fresh-after-invalidation #2: HTTP200 total5 responseHits1 semanticHits0 origins4 staleAnswers0 answersCorrecttrue donetrue
purge-owned-cache: keyCount0 persistentKeys0 usedBytes256 donetrue
memory-restored #1: HTTP500 total258 origins257 persistentKeys152 rejectedWrites106 expiredKeys0 usedBytes65386 donefalse
purge-owned-cache: keyCount0 persistentKeys0 usedBytes256 donetrue
memory-restored #2: HTTP200 total258 origins258 persistentKeys0 rejectedWrites0 expiredKeys258 usedBytes1217 donetrue
scope-isolation #1: HTTP200 total12 responseHits10 origins2 crossFilterAnswers9 answersCorrectfalse donefalse
scope-isolation #2: HTTP200 total12 responseHits4 origins8 crossFilterAnswers0 answersCorrecttrue donetrue
dimensions-restored #1: HTTP500; actual FT.SEARCH ResponseError; donefalse
```

The original DIM-repair probe used the near miss after scope tests had stored a paraphrase hash. Its distance to that hash was `0.0340804936014929`, below even 0.05; the successful search therefore returned the wrong answer and correctly failed the recovery rubric. Corrected only authored Lab probe/setup: explicitly DEL the canonical exact key and query canonical against the preserved correct paraphrase hash. No vector fixture/runtime changes. The final independent relevance experiment explicitly resets its sample and primes canonical only, so its near-miss acceptance remains independently meaningful.

Initial command exited 1 at that schema-recovery assertion. Tool waited 10.010419s plus 0.0418261s for completion; complete initial process wall was not separately captured. TTL CLI commands for both faulty and repaired deployments executed successfully before the interruption; their values were collected in-process but the end-of-program aggregate assertion was not reached, so this report does not claim that aggregate assertion passed.

### Search continuation, final proof refresh and sole disposable negative

Command: `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-7-check.mjs --resume-search`.

The disposable reconstruction builds/applies the cumulative repaired source, performs the actual source-update/freshness action and explicit purge/scope actions to create the stage-3 handoff. An initial reconstruction-only attempt exited 1 in 1.8754292s because its source-changing setup proof was incorrectly asserted current immediately across revision 1→2; the harness now checks that setup's correct measurements and relies on the scheduled final refresh for current evidence. No application/core correction or additional negative test resulted.

Successful continuation exited 0; program wall **11758ms**. Relevant output:

```text
scope-isolation handoff: HTTP200 total12 origins8 responseHits4 answersCorrecttrue donetrue
dimensions-restored #1: HTTP500 total1 origins0 answersCorrectfalse donefalse
dimensions-restored #2: HTTP200 total1 semanticHits1 origins0 answersCorrecttrue donetrue
relevance-restored #1: HTTP200 total3 semanticHits2 origins1 answersCorrectfalse donefalse
fresh-after-invalidation refresh: HTTP200 total5 responseHits1 origins4 staleAnswers0 answersCorrecttrue donetrue
memory-restored refresh: HTTP200 total258 origins258 persistentKeys0 rejectedWrites0 expiredKeys263 usedBytes1217 donetrue
purge-owned-cache: keyCount0 persistentKeys0 usedBytes256 donetrue
scope-isolation refresh: HTTP200 total12 responseHits4 origins8 crossFilterAnswers0 answersCorrecttrue donetrue
dimensions-restored refresh: HTTP200 total1 semanticHits1 origins0 answersCorrecttrue donetrue
relevance-restored #2: HTTP200 total3 semanticHits1 origins2 answersCorrecttrue donetrue
FULL ORDERED COMPLETION: 6/6; schema preserves hashes
relevance-restored #3: HTTP200 total3 semanticHits2 origins1 answersCorrectfalse donefalse
PASS loose-0.20 negative: HTTP 200, wrong near-miss semantic hit, verification false. 11758ms
```

At each DROP/CREATE pair the harness compares the actual key map before/after and confirms hashes are unchanged. Recovery uses the actual FT.SEARCH with DIALECT 2. Final `evaluateLab(...).isComplete` is true. The sole disposable negative restores the captured deployed 0.20/DIM-8 checkpoint and reruns only relevance; actual HTTP is 200, near-miss semanticHit=true, expectedAnswer=false and the Lab task remains false. It does not re-deploy a second sabotage or run a replay matrix.

### Single build and self-review

Command: `npm.cmd run build` (PowerShell stopwatch wrapper). Exit 0; stopwatch **4.799374s**, tool wall **4.8339567s**.

```text
vite v6.4.3 building for production...
✓ 553 modules transformed.
dist/index.html                       0.88 kB │ gzip:   0.46 kB
dist/assets/LabPage-BM7-q5me.css     10.22 kB │ gzip:   1.90 kB
dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip:   8.25 kB
dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip:  38.44 kB
dist/assets/LabPage-DtCCpdlo.js     308.03 kB │ gzip:  79.49 kB
dist/assets/index-GDsqZEpS.js     2,407.62 kB │ gzip: 651.87 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 4.10s
Build verification elapsed: 4.799374s; exit: 0
```

Verification was comfortably below 30 minutes (commands consumed tens of seconds; the interrupted command's exact total process wall is unavailable as noted). `git diff --check` passed; only normal LF→CRLF advisories. Reviewed Lab source, registry diff and canonical seed change. Checked that stage entry source cuts introduce only their declared fault, every call site is covered, cleanup is visible and distinct from TTL verification, dimension repair retains hashes, threshold sampling starts with only canonical hashes, and final affected proofs all refresh together. The existing bundle-size warning remains; no unrelated refactor was attempted.

## Files and handoff

Created `src/data/labs/data-journey/redis-troubleshooting.lab.js`; modified `src/data/labs/data-journey/redis-seeds.js` and `src/data/labs/index.js`; created this report. Disposable walkthrough and report pointer live under ignored `.superpowers/sdd/2026-10-01-data-labs-10-12/` and are not committed. No controller ledger touched.

No unresolved implementation blocker. Limits: no browser testing or existing journey suite under the requested constraints; one walkthrough is evidenced by the initial prefix plus approved search-stage continuation, not a second complete uninterrupted replay. Fault observation is intentionally top-down: rerunning revision-1 freshness diagnostics after source revision 2 is not a new revision-1 incident. Independent review remains the controller's task.
