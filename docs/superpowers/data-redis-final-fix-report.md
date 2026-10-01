# Redis final fix wave — 2026-10-02

Implementation author: Codex. Branch `codex/data-redis`, worktree `E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis`, base `51f9bf204c3cfc34776821b0d962cd7146e9a162`. One final fix wave, no subagents, merge or push. Controller-owned progress ledger and final whole-branch review document were not edited or staged. Scoped controller rereview remains pending; this report is implementation evidence, not a competing review decision.

## Changes and interfaces

Both Important findings and the numeric-age/handoff minors are addressed. The existing Vite bundle advisory remains explicitly deferred by controller ruling.

### Actual returned-value provenance

`runtime.js` creates a Redis-only internal `redisFlow` sidecar when the target is Redis and the parsed application declares Redis support. Its WeakMap associates local scopes with metadata, while expression results carry separate metadata through assignments, parameters, nested learner-function returns, list/tuple/dictionary children, loops, lookup, list/next and append. Metadata is never inserted in learner values, SDK arguments, cache storage, or returned answer JSON. Existing Cosmos/Postgres execution does not activate the sidecar; the same eleven legacy SDK cases still pass.

`redis-runtime.js` alone mints origins from successful native GET, individual native FT.SEARCH payload fields, and protected `source_answer`. A reference contains `kind` (`get`, `search`, `source`), the zero-based index in the corresponding complete request call collection, and the actual Redis key for cache reads. `decode_search` transfers only the selected field's metadata to its row. Protected `encode_answer`/`decode_answer` preserve metadata through supported serialization, including decoded native string values under `decode_responses=True`. Every operation still returns its original plain JSON/scalar/canonical bytes value. No public wrapper, caller-provided flag, syntax extension or arbitrary Python execution was added.

The public runtime evidence now includes `redis.returnProvenance`, either one origin reference for the actual returned complete value or `null`. Workload grading first follows this reference to that exact operation/candidate; payload equality is retained only as an integrity/correctness check after identity selection. An unused equal GET, search candidate or source result cannot establish provenance for a separately constructed literal. Native command errors, trace caps, snapshot bounds and source-call accounting retain their existing semantics. Actual frame truncation still invalidates the proof even if a later return carries a reference.

Containers retain metadata per child; an unrelated field cannot inherit the origin of another member. Freshly constructing an answer dictionary from literals, or reconstructing it field by field, does not mint a whole-answer origin. Supported container transport of a whole answer/payload and protected codec round trips preserve it. Arbitrary transformations that reconstruct an equivalent answer are outside this proof contract: they may produce a simulator value but cannot certify a cache/source return merely by equality. This is the declared reconstruction limit, not broader Python execution support.

### Complete-frame grading facts

`redis-actions.js` extends the existing per-request `cacheEffects` summary before the presentation cap. New bounded identity collections are `scanPatterns` and `hashWrittenKeys` (at most 256 each); new scalar witnesses are `searchedSemanticDialect2`, `setWithExpiry` and `expiryApplied`. They reflect successful real operations. No payloads or full extra call traces are stored. Existing actual removed-key identities, live written-key identities, lifetime facts and completeness flags remain available unchanged.

All Guided/Troubleshooting predicates previously reading `measurements.calls` now use these facts or the existing actual removed-key identities. Their common correctness/trust predicates require every request's `cacheEffects.complete === true`. A static search found no remaining `m.calls`/`measurements.calls` grading in any Redis Lab. Presentation truncation remains informational; genuine frame truncation or incomplete facts fails grading. Lab 12 already uses complete-frame summaries and needed no edit.

The read-time age Map now normalizes SET/HSET/GET/DEL/EXPIRE and search-key identities to strings, matching Redis storage. A numeric write followed by a string-equivalent read, and the reverse, both retain known age zero; the existing temporal ordering still prevents a later write from refreshing an earlier accepted read.

The handoff now records completed Lab 12/task review, completed prior final bounded validation, the subsequent whole-branch findings and this fix wave. It explicitly leaves scoped rereview/final acceptance pending and retains the unmerged/unpublished status.

## Focused validation

No permanent test bodies or files were added. Assertions were added only to the two existing Redis SDK cases: real source/GET/search origins, matching unused source/GET/search plus independent literal returns, and nested local calls with list/dictionary/loop transport and encode/decode round trips through a decoded primitive GET string. The total remains nine new Redis cases across the three core files, twenty cases including the eleven earlier SDK cases.

All commands below ran in the worktree. Timings are PowerShell stopwatch wall times. No bare/full-suite command, AKS/Container Apps suite, browser automation, complete Lab matrix, legacy Lab replay, dependency install, network, actual Python/cloud execution or TTL wall wait ran.

### RED — existing SDK file only

`npm.cmd test -- tests/data-python-sdk.test.js`, exit 1, **1.4813595 s**:

```text
tests/data-python-sdk.test.js (13 tests | 2 failed) 81ms
semantic Redis case: expected undefined to match { kind: 'search', callIndex: 0 }
cache Redis case: expected undefined to match { kind: 'source', callIndex: 0 }
Tests 2 failed | 11 passed (13)
Duration 633ms
```

Expected RED: the old runtime had no actual-return reference and inferred provenance only downstream by equality. The eleven existing backend cases passed.

### One disposable focused regression program

Program: `.superpowers/sdd/2026-10-01-data-labs-10-12/final-fix-check.mjs` (ignored scratch). It reuses prior scratch deployment recipes and authored scenarios, exercising actual save → ACR build → distinct Deployment image → apply → captured-image requests. It does not replay whole Labs or claim Lab-wide completion.

`node .superpowers/sdd/2026-10-01-data-labs-10-12/final-fix-check.mjs`, **19.0899997 s**, initially exited 1 on a **harness-only expected-error assertion** at the intentional truncated-frame probe. Completed assertions/output before that harness stop:

```text
PASS canned literal: matching unused source and GET cannot prove either returned answer
PASS noisy Guided: baseline, actual hidden SCAN/DEL freshness, semantic search; complete frames
PASS noisy Troubleshooting: actual freshness, 12 scoped responses with hidden HSETs, relevance search
```

The canned deployed baseline still executes one actual source call and a matching native GET but records zero response hits, invalid provenance and a failed real Guided task. Valid noisy code performs 140 harmless GETs in cached_answer/invalidate_product and 100 in answer, keeping each runtime frame below 256 while overflowing the display trace. Actual Guided baseline/freshness/semantic predicates pass; its displayed trace contains no DEL despite a valid real deletion witness. Troubleshooting freshness/scope/relevance predicates pass; all twelve scoped responses are correct, eight origin calls and four exact hits remain, and no HSET appears in the capped display although the complete-frame hash witnesses prove all four scopes.

At the intentional 257-extra-GET probe, the product correctly returned a workload error line with HTTP 200, `traceTruncated:true`, `provenanceValid:false` and `cacheEffects.complete:false`. The general harness incorrectly required no error line before reaching the negative assertions. Corrected the harness expectation and added a `--remaining` continuation that skips every already-completed positive section. No product change or repeated positive replay was needed.

`node .superpowers/sdd/2026-10-01-data-labs-10-12/final-fix-check.mjs --remaining`, exit 0, **4.4099534 s** (program 4153 ms):

```text
PASS actual frame truncation: incomplete facts and returned proofs refused
PASS numeric/string key ages: both directions age0; Guided=0ms Troubleshooting=0ms total=4153ms
```

The actual Guided task remains false for the incomplete frame. The numeric-age continuation uses SET 123 / GET "123", then SET "123" / GET 123, through deployed supported learner code; both are actual returned cache values, giving two hits, correct answers, known maximum age zero. The zero section timers mean those completed positive sections were deliberately skipped in the continuation.

Per-Lab wall accounting is conservative because the first process ended before printing its per-section timers: charge its entire **19.090 s** to Guided and separately to Troubleshooting, plus the entire **4.410 s** continuation to Guided/core age checks. Each is far below the 30-minute limit. Lab 12 had no replay in this wave. The full 258-request memory incident and schema-repair sequence were not rerun; the migrated small scalar witnesses were inspected and the underlying storage/search cases passed.

### Final single named-core command — GREEN

`npm.cmd test -- tests/data-redis-store.test.js tests/data-redis-search.test.js tests/data-python-sdk.test.js`, exit 0, **2.4631254 s**:

```text
tests/data-redis-store.test.js (4 tests) 10ms
tests/data-python-sdk.test.js (13 tests) 219ms
tests/data-redis-search.test.js (3 tests) 17ms
Test Files 3 passed (3)
Tests 20 passed (20)
Duration 1.60s
```

Output clean. This was the only final three-file core invocation. It ran alongside the independent disposable remainder.

### Single production build

`npm.cmd run build`, exit 0, **4.9245038 s**:

```text
vite v6.4.3 building for production...
554 modules transformed.
dist/assets/index-R50M7UFF.js 2,419.22 kB | gzip 655.09 kB
(!) Some chunks are larger than 500 kB after minification.
built in 4.24s
```

No compiler errors. Only the existing, explicitly deferred chunk-size advisory. Total test/regression/build stopwatch wall, conservatively summing concurrent commands, **32.3689418 seconds**.

## Files and self-review

Owned product/test changes: `src/lib/data/runtime.js`, `src/lib/data/redis-runtime.js`, `src/lib/kubernetes/redis-actions.js`, `src/data/labs/data-journey/redis-cache-guided.lab.js`, `src/data/labs/data-journey/redis-troubleshooting.lab.js`, `tests/data-python-sdk.test.js`. Owned documentation: `docs/superpowers/HANDOFF-data-journey.md` and this report. Scratch check and report pointer are ignored and uncommitted. No helper sources, parser, storage/search implementation, persisted schema, Kubernetes deployment pipeline or PostgreSQL/Cosmos-specific branches were changed.

Self-review read the owned diff and verified that origin references can only be minted by native/helper paths, literals cannot inherit child evaluation state, nested function parameters/returns and field-specific lookups preserve the relevant sidecar only, actual returned references select the exact call/candidate, serialization leaves learner payloads untouched, and runtime versus presentation truncation remain distinct. The large shared runtime received only scoped metadata integration rather than a Python recognizer refactor. Existing bounds cap the request frame, native row collection and returned snapshots; sidecar structures are request-local and never persisted. Named tests confirm the existing SDK backend cases still pass, but excluded browser/legacy journey coverage is not claimed.

`git diff --check` and `git diff --cached --check` passed; only ordinary LF/CRLF conversion advisories appeared while staging. The staged file list contains exactly the eight owned files above; controller ledger/final-review document remain excluded. No unresolved implementation blocker was found. Scope/reconstruction limits and excluded checks are disclosed above. Final acceptance belongs to the controller's scheduled scoped rereview.
