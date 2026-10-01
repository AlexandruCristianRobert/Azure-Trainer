# Task 4 — Redis Python recognition and runtime

Implementation author: Codex. Worktree `.superpowers/worktrees/data-redis`, branch `codex/data-redis`, starting base `db3cd3815878641bd835c872381a2453d5a5bef7`. No merge or push. Controller ledger excluded.

## Implemented and downstream contract

- `src/lib/data/sdk-catalog.js` declares Redis constructors and all requested methods once. Only delete and execute_command have variadic binding. Constructors accept only host/port positionally; password, ssl, decode_responses, protocol are keyword-only. hset mapping is keyword-only. Protocol accepts only literal 2; unsupported shapes/keywords and uncatalogued calls fail closed.
- `src/lib/data/python-sdk.js` selects Redis only from trusted `manifest.dataBackend === 'redis'`. Imports are read from actual parsed ImportStatement nodes; `import redis as ...` and `from redis import Redis as ...` constructors bind aliases. Receiver identities come from lowered constructors, not manifest receiver assertions. The new string concatenation, comparisons, float and protected helper forms are Redis-gated. Existing Cosmos/Postgres recognition remains on its existing paths.
- `src/data/templates/data-python/redis-runtime.js` exports `REDIS_HELPER_FILES`, `REDIS_HELPER_ARITIES`, and `REDIS_RUNTIME_MANIFEST`. Task 5 should spread the last export and add its routes/editZones/fixedFiles. Canonical protected file is `training_runtime.py`; runtimeFunctions are response_key, semantic_key, encode_answer, decode_answer, pack_embedding, decode_search, embed, source_answer. Each must have its sole canonical fixed definition, and learner definitions, assignments, parameter/loop targets or imports cannot shadow protected identities. Constructor rebindings also fail closed.
- The exported real Python helper source imports only hashlib/json/struct, contains fixture-derived maps, and implements actual normalized UTF-8 SHA-256, JSON dumps/loads, `struct.pack('<8f', ...)`, RESP2 row decoding, scoped origin lookup and revision state. It imports no Lab module. The 256 Task 1 aliases remain explicit mappings to their canonical fixture; source and vectors are not generated success values.
- Key contract confirmed by controller: `ka:answer:{product}:{version}:{language}:{sha256(normalized question)}` and `ka:sem:{product}:{version}:{language}:{sha256(normalized question)}`. Normalization trims, lowercases and collapses whitespace. The simulator uses a synchronous browser-safe SHA-256 implementation with no new dependency, independently asserted against the known `abc` digest. Scope strings are used verbatim; request scope validation belongs to the downstream protected request boundary.
- `src/lib/data/redis-runtime.js` delegates recognized commands to executeRedis / executeRedisSearch. Binary data uses canonical JSON bytes descriptors; redis-py responses honor decode_responses and decode actual search/payload results. SET/EXPIRE native callbacks, integer EXISTS, mapping HSET/HGETALL, snapshot scan_iter and variadic deletion are supported. No real Python/network/Azure execution occurs.
- `runDataFunction` initializes lowered Redis clients, advances the context sandbox after each delegated operation and preserves it if a later operation fails. Redis answers are detached finite JSON. Existing return shape gains `redis:{calls,originCalls,sourceCalls,traceTruncated,measurements}` only for a trusted parsed Redis app and target. Evidence is derived from real operations/helpers, never caller arguments. Calls record command, bound command args, raw store value, per-operation stats deltas, hit where appropriate, and error. Each evidence collection caps at 256; saturation sets traceTruncated, which downstream trace-based proofs must reject. The origin counter remains actual even if source trace truncates.
- Connection checks require actual supplied cluster host/port, TLS and training-only password; constructors are never traced and ConnectionError messages contain no credentials. Measurements include the exact `Simulated estimate — not an Azure guarantee.` label.
- `source_answer` resolves revisions from `scenarioState.sourceRevisions[product]`, then the current database sourceRevisions, then 1. Revisions 1/2 use Task 1's actual scoped source. Source calls record detached arguments/result and sourceRevision. Task 5/6 scenario code should supply the canonical product revision map through this field. Python's counterpart exposes SOURCE_REVISIONS for the equivalent fixture scenario state.

## RED evidence

Added exactly two SDK cases, with no future application-template import. They use the literal semantic_lookup and complete cached_answer functions from the brief, canonical helper files, real lowered alias clients, actual Redis resource/store/search state, and REDIS_TARGET. No mocks.

`npm.cmd test -- tests/data-python-sdk.test.js`: exit 1; measured **1.5127994s** (tool wall 1.5634018s). Relevant full failure output:

```text
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
tests/data-python-sdk.test.js (13 tests | 2 failed) 60ms
× executes a parameterized Redis semantic hit from real binary vectors and protected decoders
  expected diagnostics []
  received DATA_UNSUPPORTED: Not supported by the simulator: BinaryExpression
  app.py:4:13
× executes Redis miss, real SET EX and repeat hit with one protected scoped origin call
  expected diagnostics []
  received DATA_UNSUPPORTED: Not supported by the simulator: the call 'response_key(...)'
  app.py:4:11
Test Files 1 failed (1)
Tests 2 failed | 11 passed (13)
Start at 23:39:19
Duration 624ms (transform 148ms, collect 265ms, tests 60ms, prepare 93ms)
Verification elapsed: 1.5127994s; exit: 1
```

Both failures were expected missing Redis lowering behavior, rather than broken resource setup/imports. Eleven existing shared SDK cases passed.

## GREEN and single build

First implementation GREEN, same explicit SDK file: exit 0; measured **1.492828s** (tool wall 1.5246566s), 13/13 passed, bodies 79ms; Vitest duration 660ms (transform 159ms, collect 283ms, prepare 99ms), start 23:44:21.

Self-review corrected inherited hit-counter deltas, protected alias/function/constructor rebindings, constructor third positional rejection, integer EXISTS and raw command callback conversion. Additional assertions were placed within the same two cases, without adding test bodies. They cover canonical SHA-256, real 14-day scenario revision, helper tampering/shadowing, keyword-only hset mapping, constructor shape/TLS/credential redaction, actual payload preservation, HSET/HGETALL/EXPIRE/TTL/EXISTS, SCAN snapshot plus bytes-key deletion, variadic DEL exact args, native WRONGTYPE after a successful write retaining the sandbox, and the 256 trace cap with a miss against a sandbox that already has historical hits.

GREEN after these assertions: exit 0; measured **1.5436857s** (tool wall 1.5769084s); 13/13 passed; bodies 120ms; Vitest duration 698ms (transform 153ms, collect 279ms, prepare 98ms), start 23:47:05.

Final exact SDK command after tightening the positional-constructor assertion and freezing manifest arrays:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-python-sdk.test.js
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
✓ tests/data-python-sdk.test.js (13 tests) 108ms
Test Files 1 passed (1)
Tests 13 passed (13)
Start at 23:48:14
Duration 652ms (transform 146ms, setup 0ms, collect 263ms, tests 108ms, environment 0ms, prepare 93ms)
Verification elapsed: 1.4719519s; exit: 0
```

Measured **1.4719519s**, tool wall 1.4962025s. Output clean.

Single `npm.cmd run build`, exit 0; measured **4.9265246s**, tool wall 4.9667232s:

```text
> azure-trainer@0.1.0 build
> vite build
vite v6.4.3 building for production...
transforming...
✓ 547 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                       0.88 kB │ gzip:   0.46 kB
dist/assets/LabPage-BM7-q5me.css     10.22 kB │ gzip:   1.90 kB
dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip:   8.25 kB
dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip:  38.44 kB
dist/assets/LabPage-CUEirOwz.js     305.15 kB │ gzip:  78.66 kB
dist/assets/index-BMMj5jRO.js     2,354.82 kB │ gzip: 637.52 kB
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking
- Adjust chunk size limit via build.chunkSizeWarningLimit.
✓ built in 4.17s
Verification elapsed: 4.9265246s; exit: 0
```

Total measured test/build verification **10.9477896 seconds** (tool wall approximately 11.128s), far below 30 minutes. `git diff --check` passed; only normal LF-to-CRLF advisories. Staged owned-file `git diff --cached --check` also passed, measured **0.0322696s**, exit 0; combined measured verification including this check is **10.9800592 seconds**. No bare/full test command, AKS, Container Apps, browser suites, per-Lab tests, dependency installs, network or real Python execution, real cloud operation or wall-time TTL waits. No per-Lab walkthrough belongs to this shared SDK task; those remain downstream.

## Files and self-review

Owned files: `src/lib/data/redis-runtime.js`, `src/data/templates/data-python/redis-runtime.js`, `src/lib/data/sdk-catalog.js`, `src/lib/data/python-sdk.js`, `src/lib/data/runtime.js`, `tests/data-python-sdk.test.js`, and this report. Ignored scratch task-4-report.md is a pointer only. No source/storage/search/model/CLI/template-application/Lab or controller ledger changes.

Read the complete brief and upstream interface reports, then reviewed all owned new files and changed diffs against the required subset and native constructor amendments. Verified the tests execute actual lowered learner functions and resource state; no fixture can manufacture a hit. Protected source/schema/index/storage separation and existing shared SDK semantics remained intact. Runtime is kept in one focused Redis module; the already-large shared recognizer/runtime received only integration branches. No uncertainty requiring a blocker was found.

Limits: this is the declared bounded redis-py subset, not arbitrary Python, a general Redis query parser, or complete byte-key dictionary semantics. HGETALL's string field keys represent the authored string-key mapping subset; values retain real binary/decode behavior. Canonical Python helpers are parsed/protected but deliberately never executed. General edge-case protocol parity, excluded suites and Lab pipeline walk-throughs were not run under the prescribed scope. Downstream evaluators must reject redis.traceTruncated for any trace-based proof. The existing Vite bundle-size advisory remains; no compiler errors.
