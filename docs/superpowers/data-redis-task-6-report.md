# Task 6 — Lab 10 guided Redis cache and vector search

Implementation author: Codex. Worktree `.superpowers/worktrees/data-redis`, branch `codex/data-redis`, base `d5f3e35f8909173cba1f4e0cd61177f5c873ae5b`. No merge, push, subagent or reviewer dispatch. Controller progress ledger excluded.

## Implemented

Created `redis-cache-guided.lab.js` and registered `data-redis-cache-guided` in the existing catalog. Journey `data-knowledge-assistant`, order 10, data skill area, `managed-redis`, engine 2/content 1, capabilities Redis/ACR/Kubernetes. Six stages flatten to the exact ten-task order: provision; baseline; TTL at 59 and expiry at 60; stale diagnostic and fresh invalidation; index, paraphrase, near miss; filter isolation/memory.

The independent guided seed remains unchanged: infrastructure, namespace and Service supplied, no Redis, no build, no solved app zones. Every app Solution supplies complete cumulative app.py contents, explicitly saves through the learner-facing file step, uses a distinct image tag, supplies complete Deployment YAML and requires build/apply before its scenario button. Earlier cuts keep future functions unfinished. Resource/index tasks supply their own complete commands; index is created before semantic Python is implemented. Semantic solutions inspect FT.INFO and use the actual supplied protected serialization helpers; no helper performs learner Redis operations.

Authored scenarios are cache-baseline, cache-ttl59, cache-expiry, stale-before-invalidate, fresh-after-invalidate, semantic-paraphrase, semantic-near-miss and filter-isolation. TTL59 runs a 59-second simulated advance and an actual CLI TTL returning 1; expiry advances the final second and records an actual expired key and new origin answer. No real sleep.

The stale diagnostic primes both products, changes only Backup's source revision and preserves the real 35-day/revision-1 response hit. It deliberately completes with answersCorrect=false/staleAnswers=1 and is clearly labelled an expected diagnostic, never a freshness pass. Repair retains existing keys, scans both product-specific namespaces, deletes Backup response keys, returns the authored revision-2/14-day payload and proves Support survives through a real exact hit. Its final measurements have answersCorrect=true and staleAnswers=0. Both products' source revisions belong to this freshness proof.

Semantic proof requires current saved functions equal the Service-selected immutable deployed artifact, actual index-linked FT.SEARCH operations with DIALECT 2, valid complete provenance, actual semantic hits and the correct returned payload. Canonical warmup/paraphrase uses one origin/one semantic hit; near miss searches but computes its distinct answer (two origins/no semantic hit). Four scope variants prime canonical answers then paraphrase each: four origins/four semantic hits, no scope contamination, all payloads match their scoped source and persistentKeys=0. Solutions inspect both namespaces, FT.INFO and INFO memory.

Dependencies exclude live keys, clock, stats, generic images and irrelevant functions. Historical cache/TTL/stale baselines depend only on resource and cached_answer, so invalidation/semantic additions and source revision changes preserve their own snapshots. Freshness owns relevant source revisions/cached_answer/invalidate_product. Semantic proofs own the index and cached_answer/remember_semantic/semantic_lookup/answer, excluding invalidation; only isolation additionally owns Support's source revision. Changes to their own current saved/deployed code or relevant index/source stale the affected proofs through the existing pipeline.

Exam notes cover EX/EXPIRE, TTL -1/-2, cache-aside concurrency limits, scope-safe keys, deletion of both namespaces, HASH FLOAT32/DIM, lower-is-closer cosine distance, DIALECT 2, module immutability and NoEviction/OOM. Memory and latency estimates carry `Simulated estimate — not an Azure guarantee.` The 64 KiB teaching bound is explicitly distinguished from Azure SKU capacity; embeddings-v2's 12 dimensions cannot query this DIM-8 index.

## Verification route, commands, output and wall time

Used a disposable in-process walkthrough through real `createBehavioralRun` and `applyRunAction`, not browser automation. Explicit solution file steps invoke save-file, commands invoke the actual ACR build and Kubernetes apply paths, scenario steps execute captured deployed Python through the real Redis route. No permanent Lab tests, full suite, AKS/ACA/browser tests, network, real Python or real Azure. Brief overrides full-suite/TDD defaults; no permanent tests were added.

1. `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-6-check.mjs`: exit 0; program body **15138 ms**. Exactly one ordered full Solution walkthrough and one semantic-deletion sabotage. Assertions cover restartable no-Redis/no-build/unfinished seed; catalog registration; stage/task order; every task done immediately after its Solution; full guided completion; real CLI TTL=1; immutable selected artifact identity per scenario; complete provenance; saved semantic function not current before build/apply; historical baseline/diagnostic preservation after repair. Relevant output:

   ```text
   PASS provision
   PASS cache-baseline total2 responseHits1 semanticHits0 originCalls1 staleAnswers0 answersCorrecttrue maxAge0 expiredKeys0 persistentKeys0
   PASS cache-ttl59 total2 responseHits1 semanticHits0 originCalls1 staleAnswers0 answersCorrecttrue maxAge59 expiredKeys0 persistentKeys0
   PASS cache-expiry total1 responseHits0 semanticHits0 originCalls1 staleAnswers0 answersCorrecttrue expiredKeys1 persistentKeys0
   PASS stale-before-invalidate total3 responseHits1 originCalls2 staleAnswers1 answersCorrectfalse
   PASS fresh-after-invalidate
   PASS index
   PASS semantic-paraphrase total2 responseHits0 semanticHits1 originCalls1 staleAnswers0 answersCorrecttrue persistentKeys0
   PASS semantic-near-miss total2 semanticHits0 originCalls2 staleAnswers0 answersCorrecttrue persistentKeys0
   PASS filter-isolation total8 semanticHits4 originCalls4 staleAnswers0 answersCorrecttrue persistentKeys0
   FULL GUIDED COMPLETION: 10/10
   PASS semantic-deletion sabotage: freshness task false; actual semantic stale hit revision1/35days after revision2 update. 15138ms
   ```

   The single sabotage restores a source-revision-1 checkpoint, builds/applies semantic code, primes canonical/paraphrase, removes the semantic scan/delete loop, saves/builds a distinct sabotage image and applies it. The real fresh-after-invalidate action updates revision 2 and the freshness task fails. A single scoped GET /answer probe then returns a proven semantic hit with staleAnswers=1, answersCorrect=false and revision1/35days. No fabricated hit fields or task outcomes.

2. Self-review found the initial repair scenario also read the already-stale Backup before invalidation, so its initial aggregate card was answersCorrect=false/staleAnswers=1 even though its final repair payload was correct. Removed that redundant setup read and strengthened the positive repair predicate to require globally correct measurements. Kept the separately labelled stale diagnostic unchanged. Ran only affected provision/cache/stale/fresh setup and checks, not a second full walkthrough or repeated negative matrix:

   `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-6-fresh-check.mjs`, exit 0; tool wall **4.3496297 s**, program **4122 ms**:

   ```text
   PASS final freshness-only correction: answersCorrect=true, staleAnswers=0, originCalls=1, responseHits=2, revision2/14days; baseline/diagnostic remain done. 4122ms
   ```

   Added Support's source revision to the repair dependency because that proof also owns Support correctness, then reran only this same affected freshness check. Exit 0; tool wall **4.1361724 s**, program **3912 ms**. Same passing output ending `3912ms`. No new workload matrix or negative case.

3. Single `npm.cmd run build`, exit 0; stopwatch **5.037562 s**, tool wall **5.0816655 s**:

   ```text
   vite v6.4.3 building for production...
   ✓ 552 modules transformed.
   dist/index.html                       0.88 kB │ gzip: 0.46 kB
   dist/assets/LabPage-BM7-q5me.css     10.22 kB │ gzip: 1.90 kB
   dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip: 8.25 kB
   dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip: 38.44 kB
   dist/assets/LabPage-7A2bppY9.js     308.03 kB │ gzip: 79.49 kB
   dist/assets/index-D_9wT2jC.js     2,391.84 kB │ gzip: 647.64 kB
   (!) Some chunks are larger than 500 kB after minification.
   ✓ built in 4.28s
   Build verification elapsed: 5.037562s; exit: 0
   ```

   The final additional source dependency is covered by the narrow freshness action replay; no second production build was run for that selector-list change. Existing bundle-size advisory remains.

4. `git diff --check` and source/registry self-review: no whitespace errors (normal LF-to-CRLF advisories only). Verification command time totals approximately **29 seconds**, well below the 30-minute limit. Scratch walkthrough/focused programs and report pointer are ignored and not committed.

## Files, self-review and limits

Created `src/data/labs/data-journey/redis-cache-guided.lab.js`; modified only `src/data/labs/index.js`; created this report. No seed/helper/template/shared-core changes were necessary. Controller ledger dirt was preserved and excluded.

Self-reviewed task-stage flattening, current saved versus immutable captured function gates, source/product dependency ownership, historical measurement preservation, binary vector/index schema checks, actual GET/DEL/SCAN/FT.SEARCH provenance, exact TTL boundaries, scoped answers, semantic relevance, support preservation and full completion. Corrected the repair aggregate issue and the relevant Support revision dependency as described above.

No architectural blocker found. UI compilation is verified; browser presentation and existing journey suites are intentionally untested under the batch limits. Diagnostic baseline is historical and should be performed in the authored top-down order before revision 2; rerunning that baseline after revision 2 is not a fresh revision-1 incident. No independent reviewer was spawned; controller review remains pending. Commit author is Codex.
