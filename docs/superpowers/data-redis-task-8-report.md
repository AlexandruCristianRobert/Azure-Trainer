# Task 8 — Lab 12 independent Redis caching and batch handoff

Implementation author: Codex. Worktree `.superpowers/worktrees/data-redis`, branch `codex/data-redis`, base `5bfd564e8b821bc91597d7e14282caf852684c42`. No merge, push, subagent/reviewer dispatch or controller-ledger edits. Implementation was already approved; integration/publishing still needs user direction.

## Implemented

Registered `data-redis-independent`, journey order 12, independent mode, Data skill area and `managed-redis` service with engine 2/content 1 and `dataRedis`, ACR build and Kubernetes capabilities. The independently restartable shared seed provides the supplied resource, RediSearch and DIM-8 index, infrastructure and unfinished current app zones; it has zero solved evidence. No sibling Lab is imported and no seed change was needed.

The independent brief has measurable outcomes and no implementation hints. It permits learner TTLs 1–60 and cosine thresholds 0–1. All five deployed functions must match the learner's saved functions, but they are never compared against solution source. Grading requires actual answers/source IDs/scopes, proven origin/cache provenance, complete runtime traces, known bounded hit age, actual cache reuse and bounded memory. `displayTraceTruncated` remains presentation-only. No direct application hit flag/counter is accepted.

The exact 20 GET requests (the learner's POST invalidation is an additional control request excluded from the hit-ratio denominator) are:

| Positions | Requests |
| --- | --- |
| 1–4 | Canonical retention warmups in Backup v1/en, Backup v2/en, Backup v1/de and Support v1/en |
| 5–8 | Exact repeats in the same scope order |
| 9–12 | Retention paraphrases in the same scope order |
| 13–16 | Early-deletion near misses, each with a distinct expected answer in the same scope order |
| 17–18 | Backup canonical and paraphrase after source revision 2 and learner POST invalidation |
| 19–20 | Backup and Support canonical requests after a synchronous 61-second advance |

There is one initial lab-owned `ka:answer:` / `ka:sem:` reset per workload and no intervening reset. The index remains. The acceptance check requires total 20, hitRatio ≥0.40, responseHits ≥4, semanticHits ≥4, staleAnswers=0, crossFilterAnswers=0, rejectedWrites=0, persistentKeys=0, answersCorrect/provenanceValid true, traceTruncated false, ageKnown true with finite maxAgeSeconds≤60 and usedBytes≤64 KiB. The last two requests must compute current origins after expiration. Under the supplied NoEviction fixture, zero rejected writes also proves memory never exceeded its bound during accepted writes.

Actual successful Redis write/expiry operations grade lifetime choices independently of Python spelling. SET EX and SET followed by EXPIRE in one request both qualify; HSET/EXPIRE supports semantic keys. At request boundaries newly written keys require expiry, and TTL durations must stay within 1–60. This trace check does not require the canonical source text or a fixed 60-second TTL.

The separate immediate-freshness scenario primes Backup and Support through GET /answer (both exact strings and semantic hashes), updates Backup, invokes learner invalidation, then requests Backup exact through /cached and paraphrase through /answer at the identical simulation time. It requires actual positive DELs naming the actual primed Backup keys in both namespaces, not merely SCAN commands or prefix text, plus four origin calls in total and current revision-2 answers. Backup primed keys cannot have been deleted before the invalidation request. Support keys cannot appear in invalidation DELs; subsequent Support exact and semantic hits must both succeed. The post-update exact route does not refill semantic storage before the paraphrase probe, so deleting only the exact cache cannot pass this proof.

Complete standalone Solution steps save app.py, clients.py and Dockerfile, build `assistant:redis-independent-solution`, save a Deployment with that distinct image and apply it, then execute the declared scenarios. The final task's standalone Solution runs immediate freshness followed by the 20-request workload, cumulatively satisfying both tasks. Supplied protected helpers/server/Service remain available from the seed. The worked source is one valid 60-second/0.05 design, not the rubric.

## Controller-authorized core correction

The first actual revision-1→2 run reproduced a shared evidence defect: `applyRedisAction` recorded the final source value with the old dependency generation, then `applyRunAction` refreshed Kubernetes dependencies and incremented that generation. The same newly completed proof was therefore stale immediately.

The controller authorized a narrow correction. `src/lib/kubernetes/redis-actions.js` now calls `refreshKubernetesDependencies(previousRun, finalScenarioRun, lab)` before `recordVerification`. This refresh-before-record ordering captures current values and generations without rebinding any old record. The outer `applyRunAction` refresh computes `previousGeneration+1`, so the same change is not double-incremented. The correction is within the already capability/manifest-gated Redis scenario handler; PostgreSQL/Cosmos branches and shared refresh semantics were unchanged.

The disposable regression's `source-baseline` selector uses the same Redis dependency key as the actual tasks: resource, idx:semantic, Backup and Support source revisions, and all five deployed-function/current-saved-function fields. It first creates a completed correct revision-1 proof and verifies it current. After immediate-freshness changes Backup to revision 2, that prior record is deep-equal to its captured identity, measurements, dependency values and generations, but its verdict is stale. The newly produced immediate-freshness proof is current on the first run, without repeating the scenario to hide the defect.

## Verification route, commands, output and time

This is an **in-process simulator walkthrough**, not a manual browser walkthrough. It uses real `createBehavioralRun`, save-file, ACR build, Deployment-image save, kubectl apply and declared data-cache actions; requests run immutable captured Pod artifacts. No real Python, cloud/network operation or TTL wall wait occurs. No permanent Lab tests or new permanent core cases were added. The prescribed lighter verification overrides full-suite/TDD template defaults.

1. RED: `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-8-check.mjs --red`, exit 1, tool wall **2.0885695s**. The actual immediate-freshness payload was correct, but evidence generation was 2 and returned-run generation 3:

   ```text
   source-baseline: HTTP200 total1 origins1 answersCorrecttrue done=true
   immediate-freshness: HTTP200 total6 responseHits1 semanticHits1 origins4 answersCorrecttrue done=false
   SAME-ACTION source generations: evidence=2 run=3
   AssertionError: same new source-changing proof must be current without repetition
   false !== true
   ```

2. GREEN core check and single ordered positive worked-solution path: `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-8-check.mjs`, tool wall **2.9170969s**. The full actual source-changing freshness and 20-request solution actions completed; every declared request-group assertion passed, both real tasks reported `done=true`, new generation was 3/3, and the unchanged old source-baseline record was stale:

   ```text
   source-baseline: HTTP200 total1 origins1 answersCorrecttrue done=true
   immediate-freshness: HTTP200 total6 responseHits1 semanticHits1 hitRatio0.3333333333333333 origins4
     answersCorrecttrue provenanceValidtrue traceTruncatedfalse ageKnowntrue maxAgeSeconds0
     staleAnswers0 crossFilterAnswers0 rejectedWrites0 persistentKeys0 usedBytes2675 expiredKeys0 done=true
   SAME-ACTION source generations: evidence=3 run=3
   cache-contract: HTTP200 total20 responseHits4 semanticHits5 hitRatio0.45 origins11
     answersCorrecttrue provenanceValidtrue traceTruncatedfalse ageKnowntrue maxAgeSeconds0
     staleAnswers0 crossFilterAnswers0 rejectedWrites0 persistentKeys0 usedBytes2293 expiredKeys6 done=true
   ```

   This command then **exited 1 on a disposable harness identity assertion**, after both real tasks had passed. It attempted `evaluateLab(originalTwoTaskLab, temporaryThreeTaskRegressionRun).isComplete`; the extra source-baseline task is not part of the original Lab, so that cross-definition run cannot validate as the original Lab. This was not an application/runtime/rubric failure. Corrected the harness completion assertion to check both original task verdicts on its consistent three-task definition. A pure original-Lab `isComplete` assertion was not rerun; both actual task states and complete request-group assertions are evidenced above. No second full positive replay was performed.

   The small DEL predicate was subsequently tightened during self-review to require the actual primed key names and reject premature deletion, rather than accept any same-prefix DEL argument. The controller authorized one affected freshness-only verification of this change (item 5); no second 20-request positive replay was performed.

3. Sole disposable negative continuation: `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-8-check.mjs --negative-only`, exit 0, tool wall **1.2222701s**, program wall **925ms**. It starts a fresh independent seed, saves an exact-only `answer`, builds `assistant:redis-independent-exact-only`, saves that Deployment image, applies and runs only the 20-request contract:

   ```text
   cache-contract: HTTP200 total20 responseHits4 semanticHits0 hitRatio0.2 origins16
     answersCorrecttrue provenanceValidtrue traceTruncatedfalse ageKnowntrue maxAgeSeconds0
     staleAnswers0 crossFilterAnswers0 rejectedWrites0 persistentKeys0 usedBytes1077 expiredKeys5 done=false
   PASS exact-only negative: semanticHits0, hitRatio0.2, correct HTTP200 answers rejected by contract. Program wall 925ms
   ```

4. Single production build: `npm.cmd run build` (PowerShell stopwatch wrapper), exit 0, stopwatch **4.9227044s**, tool wall **4.9571809s**:

   ```text
   vite v6.4.3 building for production...
   ✓ 554 modules transformed.
   dist/index.html                       0.88 kB │ gzip:   0.46 kB
   dist/assets/LabPage-BM7-q5me.css     10.22 kB │ gzip:   1.90 kB
   dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip:   8.25 kB
   dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip:  38.44 kB
   dist/assets/LabPage-wEUxZAv4.js     308.03 kB │ gzip:  79.49 kB
   dist/assets/index-BxSwLsjE.js     2,414.08 kB │ gzip: 653.43 kB
   (!) Some chunks are larger than 500 kB after minification.
   ✓ built in 4.22s
   Task8 build elapsed: 4.9227044s; exit: 0
   ```

5. Affected-only final predicate verification, controller-authorized: `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-8-check.mjs --freshness-only`, exit 0, tool wall **2.302892s**, program wall **1989ms**. This executes real Solution save/build/distinct-image/apply, one prior source-baseline request and only immediate-freshness. It does not repeat the positive 20-request workload or the negative:

   ```text
   source-baseline: HTTP200 total1 origins1 answersCorrecttrue done=true
   immediate-freshness: HTTP200 total6 responseHits1 semanticHits1 origins4
     answersCorrecttrue provenanceValidtrue traceTruncatedfalse ageKnowntrue maxAgeSeconds0
     staleAnswers0 crossFilterAnswers0 rejectedWrites0 persistentKeys0 usedBytes2675 done=true
   SAME-ACTION source generations: evidence=3 run=3
   PASS affected freshness: actual primed-key DELs, immediate revision2, Support both hits;
     same new proof current, old source-baseline unchanged/stale. Program wall 1989ms
   ```

   This passes the final tightened rubric on a real revision-1→2 run, checks the unchanged prior source-dependent record's stale verdict, and checks current evidence immediately after the same source-changing action. The controller did not require a second worker build for this predicate-only correction; its final branch build remains reserved.

Total tool verification wall **13.4880094s**, well below 30 minutes. No named core-file reruns were performed by this worker: the controller reserves the final three-file core run and final build after review. No full suite, AKS/ACA tests, PostgreSQL Lab replay, browser automation, installs, real Azure/network/Python execution or simulated TTL wall waits were run.

## Files, self-review and handoff limits

Created `src/data/labs/data-journey/redis-independent.lab.js` and this report. Modified `src/data/labs/index.js`, the authorized narrow `src/lib/kubernetes/redis-actions.js` evidence ordering, and `docs/superpowers/HANDOFF-data-journey.md`. Controller-owned `data-redis-progress.md` remains untouched/unstaged. Scratch walkthrough and report pointer are under ignored `.superpowers/sdd/2026-10-01-data-labs-10-12/` and are not committed.

Reviewed workload order/20-GET denominator, four scope-distinct answers/source IDs, near-miss outcomes, actual-cache provenance, unknown-age rejection, both-type immediate invalidation and Support preservation, runtime-vs-display trace caps, actual lifetime operation grading, standalone save/build/distinct-image/apply Solution, independent unfinished seed, and narrow dependency/evidence generation behavior. No sibling Lab imports or unrelated runtime refactor occurred. The brief supplies outcomes rather than implementation steps. Checks compare saved functions only with the learner's own deployed capture, not canonical source.

Fixed revision-2 source updates are idempotent on repeated workloads. The Solution runs immediate freshness first to prove a real revision-1→2 transition, then the main workload at revision 2. The main workload still declares its update/invalidation boundary and executes the real revision-1→2 transition when run by itself on a fresh seed (also exercised by the exact-only negative). No revision-reset core action was added to manufacture a transition. The main reuse proof and freshness proof remain independent measurement snapshots; cache contents/time are not dependency fingerprints.

Handoff accurately lists unmerged/unpublished branch state, prior task implementation/review evidence, nine new permanent core cases (4 storage, 3 search, 2 SDK; final named files total 20 including the 11 earlier SDK cases), bounded verification and in-process versus manual distinction. Lab 12/final branch review and controller final named-file tests/build are pending at worker handoff. Publishing needs user integration direction. The existing Vite bundle advisory and excluded browser/legacy journey coverage remain. The temporary-harness completion assertion is explicitly disclosed above; the final tightened predicate passed only its controller-authorized affected scenario, with no further verification matrix.

## Review fix round 1 — complete cache facts before the display cap

Review of `3385875` found one Important issue: Lab 12's lifetime and deletion predicates still inspected `measurements.calls`, which is capped at 256 for presentation. One hundred harmless GETs per answer hid the German exact SET EX=61 from that list, allowing the lifetime contract to pass; the same cap could hide valid invalidation DELs and falsely fail freshness. This section supersedes the original lifetime/deletion implementation descriptions above.

The controller authorized a narrow `redis-actions.js` evidence extension and Lab predicate correction. Every request now derives `request.cacheEffects` from its complete runtime frame **before** the presentation cap:

- `complete`: runtime frame completeness plus bounded mutation-summary completeness; incomplete runtime frames remain untrusted. Presentation truncation alone never fails this fact.
- `writtenKeys`: at most 256 `{key,type}` identities actually written successfully and still live at that request boundary. It carries no cached payload or uncapped operation dump.
- `removedKeys`: at most 256 `{key,type,command}` identities actually removed by successful DEL or nonpositive EXPIRE. The observer replays successful SET/HSET/EXPIRE/DEL against live pre-request key metadata. Missing or duplicate DEL arguments do not invent removals. HSET retains an existing expiry, SET replaces it, and successful EXPIRE applies the actual native result.
- `persistentKeys` and `maxRemainingTtlSeconds`: scalar facts from the actual live key state at each completed request boundary, including keys outside the two standard namespaces. This permits SET followed by EXPIRE within a request and preserved HSET TTLs while rejecting a surviving 61-second lifetime or persistent key immediately, even if it disappears later in the workload.

The returned facts are plain bounded JSON, not internal Maps or raw full traces. Mutation identity overflow makes only `cacheEffects.complete` false, so the Lab refuses unsupported proof rather than accepting an incomplete summary. No persistent sandbox schema, parser, SDK, storage/search engine, supported syntax or legacy Lab predicate was changed. Complete-frame `traceTruncated` still fails normal provenance/completion; `displayTraceTruncated` remains presentation-only.

Lab 12 lifetime checks now consume all request-boundary facts. Immediate freshness consumes the actual priming `writtenKeys`, invalidation `removedKeys` and earlier requests' removals. It requires matching actual string/hash key identities and DEL command type for both primed Backup caches, rejects premature removal, rejects actual Support removals and still requires the immediate current source payloads plus Support exact/semantic hits. No predicate grades `measurements.calls` or exact canonical source text.

### RED

Appended the regression mode to the **existing ignored** `task-8-check.mjs`; no permanent test or additional scratch file. Command: `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-8-check.mjs --trace-cap-regression`. Exit 1; tool wall **1.5079711s**:

```text
hiddenTTL61: displayTruncated=true frameTruncated=false visibleBadTTL=0 hitRatio=0.45 done=true
AssertionError: hidden TTL61 must fail even when display trace is capped
true !== false
```

The regression deploys the learner code through real save/build/distinct-image/apply actions. Each answer performs 100 harmless missing GETs, each request frame stays below its 256-operation limit, and German exact writes have TTL 61. Actual correct answers and 0.45 hitRatio remain intact; only the capped display loses the bad writes.

### GREEN and one build

Same command after the correction, exit 0; first tool wall **3.2385813s**, program **2954ms**. Hidden TTL61 was rejected, valid TTL60 noisy code passed both scenarios, and `evaluateLab` on the **original consistent two-task Lab** returned `isComplete=true`. This resolves the original temporary three-task harness identity verification limitation without rerunning the earlier walkthrough/negative matrix.

Extended assertions in that same two-case regression to cover the required alternative expiry operations and actual deletion identities: the valid implementation uses SET followed by EXPIRE, performs another HSET after establishing expiry (preserving that TTL), and includes duplicate real-key and absent-key arguments in each DEL. Re-ran only this affected regression command, exit 0; tool wall **3.4844701s**, program **3202ms**:

```text
hiddenTTL61: displayTruncated=true frameTruncated=false visibleBadTTL=0 hitRatio=0.45 done=false
validTTL60: freshnessDone=true workloadDone=true isComplete=true hitRatio=0.45
  displayTruncated=true frameTruncated=false; SETthenEXPIRE+HSETpreservedTTL valid,
  actualRemoved2 despite duplicate/absentDEL; program 3202ms
```

The valid freshness request's removal summary contains exactly the two real primed Backup identities and excludes the nonexistent argument. Both 20-request and freshness proofs pass despite their display cap. No extra original exact-only negative, original ordinary solution replay, or source-generation matrix was rerun.

Single `npm.cmd run build`, exit 0; stopwatch **5.0613443s**, tool wall **5.1075217s**:

```text
vite v6.4.3 building for production...
✓ 554 modules transformed.
dist/index.html                       0.88 kB │ gzip:   0.46 kB
dist/assets/LabPage-BM7-q5me.css     10.22 kB │ gzip:   1.90 kB
dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip:   8.25 kB
dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip:  38.44 kB
dist/assets/LabPage-B1lqgTgg.js     308.03 kB │ gzip:  79.49 kB
dist/assets/index-Bo20RRKs.js     2,415.24 kB │ gzip: 653.90 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 4.20s
Task8 fix build elapsed: 5.0613443s; exit: 0
```

Fix-round verification tool wall **13.3385442s**, well below 30 minutes. No named core files, full suite, AKS/ACA tests, PostgreSQL replays, browser tests, installs, network or real Python/Azure execution were run. Final shared-core checks and branch review remain controller-owned. Self-review checked native positive mutation-result handling, absent/duplicate arguments, live-entry filtering, SET/HSET expiry semantics, scalar lifetime coverage of arbitrary key namespaces, bounded persistable facts and no use of display trace in Lab 12 grading. `git diff --check` passed with normal LF/CRLF advisories. Controller progress ledger remains untouched.
