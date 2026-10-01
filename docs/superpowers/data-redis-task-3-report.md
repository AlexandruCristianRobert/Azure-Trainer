# Task 3 — RediSearch vector subset and Cloud Shell

Implementation author: Codex. Implemented on `codex/data-redis` in `.superpowers/worktrees/data-redis`, starting from `9a93b9f`. No merge or push. Controller progress ledger excluded.

## Owned changes and API handoff

- `src/lib/data/redis-search.js`: `executeRedisSearch(sandbox,target,command,args,{nowMs=0}={})` returns the store envelope `{sandbox,value,measurements,error?}`. It reuses store INFO to clone, resolve the target, purge passive expiry and preserve cumulative stats; no store or model edits.
- `float32Blob(vector)` produces canonical JSON `{redisKind:'bytes',base64}` containing actual little-endian FLOAT32 bytes. Rejects nonfinite components, FLOAT32 overflow and sparse arrays. Decode validates canonical base64, exact index byte size, finite components and nonzero cosine norm. Arrays or typed arrays are not disguised as binary descriptors.
- Supports the supplied HASH schema with product/version/language TAGs, one literal prefix, HNSW/FLOAT32/COSINE embedding, DIM 8 or 12; FT.INFO; FT.DROPINDEX without DD; the literal scoped KNN query, K 1–10, one bound PARAMS vector, SORTBY distance ASC, RETURN payload distance, DIALECT 2. Other shapes fail explicitly. No general query parser, iterator or recall machinery.
- FT.SEARCH returns native alternating RESP2 `[count,key,[field,value,...],...]`, scalar strings for payload and distance. Filters all three scopes before exact cosine ranking; stable lexical key tie-break. Binary embeddings cannot be returned.
- FT.INFO returns native flat RESP2 field/value pairs, including nested `index_definition`, `attributes`, `num_docs`, `hash_indexing_failures`, and `Index Errors` pairs. `measurements.indexInfo` is a detached summary `{index_name,num_docs,hash_indexing_failures,indexing_errors:[{key,message}]}`. Invalid live indexed blobs are skipped and reported here; invalid query blobs return `ResponseError`. Diagnostics describe current visible live hashes rather than fabricated successful indexing.
- `measurements` retain stats/current usedBytes and add `estimate:'Simulated estimate — not an Azure guarantee.'` and an explicit teaching approximation label. Index creation uses shared memory accounting, rolls back schema on OOM and increments rejectedWrites. Existing HSET accounting already includes 32 bytes per live matching hash per index atomically. Expiry removes document memory without removing schema; drop preserves hashes.
- `src/lib/data/redis-cli.js`: `runRedisCli(sandbox,tokens,context)` returns the psql-style shell envelope `{sandbox,lines,results,events:[],latencyMs:0}`. Strict one-shot `-h` supplied host, `-p 10000`, `--tls`, `-a Training-Only-Redis-Key`; capability required. Reuses shell tokenization; supports store commands (HSET field pairs converted to mapping) and FT commands. Rejects FT.SEARCH shell binary literals with DATA_UNSUPPORTED; Python is the authored vector path. Binary values display as `<binary>`; FT.INFO presentation appends teaching labels while raw results remain RESP2. No terminal session mode.
- `src/lib/az/shell.js`: two-line import/route addition gated on `context.lab.capabilities.dataRedis===true`. CLI uses only `context.run.runtime.simTimeMs`, falling back to 0 if absent; real study elapsedMs is never simulation time.
- `tests/data-redis-search.test.js`: exactly three permanent `it` bodies using the real sandbox/resource/store/search/shell code, with the supplied literal behavior assertions. No mocks.

Controller clarified during implementation that FT.INFO must retain native RESP2 and the actual shell clock is `context.run.runtime.simTimeMs`; both corrections were included before GREEN. No shared-store/model compatibility change required.

## RED evidence

Tests named the breaks they catch: a closer vector from any wrong scope must not win; unavailable module/index, wrong bytes or over-budget index growth must not succeed; expired hashes and unsupported syntax must not be treated as searchable/supported.

Created a fail-closed search export scaffold so import and real resource/store setup succeeded. Packing scaffold returned an empty canonical descriptor. First command `npm.cmd test -- tests/data-redis-search.test.js` exited 1, measured 2.423s (tool 2.473s), with three expected missing-behavior assertion failures. Full relevant output:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-redis-search.test.js

RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
tests/data-redis-search.test.js (3 tests | 3 failed) 12ms
× filters all answer scopes before cosine ranking 7ms
  expected { code: 'DATA_UNSUPPORTED', …(1) } to be undefined
× requires module/index and rejects mismatched binary dimensions 3ms
  expected 'DATA_UNSUPPORTED' to be 'ResponseError' // Object.is equality
× excludes expired hashes and diagnoses unsupported query shapes 2ms
  expected { code: 'DATA_UNSUPPORTED', …(1) } to be undefined

FAIL filters all answer scopes before cosine ranking
AssertionError: expected { code: 'DATA_UNSUPPORTED', …(1) } to be undefined
Expected: undefined
Received: {code:'DATA_UNSUPPORTED',message:'Not supported by the simulator: Redis search is not implemented.'}
tests/data-redis-search.test.js:31:25, expect(created.error).toBeUndefined()

FAIL requires module/index and rejects mismatched binary dimensions
AssertionError: expected 'DATA_UNSUPPORTED' to be 'ResponseError' // Object.is equality
Expected: "ResponseError"
Received: "DATA_UNSUPPORTED"
tests/data-redis-search.test.js:58:30, expect(missing.error.code).toBe('ResponseError')

FAIL excludes expired hashes and diagnoses unsupported query shapes
AssertionError: expected { code: 'DATA_UNSUPPORTED', …(1) } to be undefined
Expected: undefined
Received: {code:'DATA_UNSUPPORTED',message:'Not supported by the simulator: Redis search is not implemented.'}
tests/data-redis-search.test.js:96:25, expect(expired.error).toBeUndefined()

Test Files 1 failed (1)
Tests 3 failed (3)
Start at 23:22:58
Duration 1.52s (transform 607ms, setup 0ms, collect 1.21s, tests 12ms, environment 0ms, prepare 84ms)
Verification elapsed: 2.423s; exit: 1
```

First implementation run of the same command exited 1, measured 2.444s (tool 2.495s): two cases passed; atomic HSET fixture wrongly assumed 575 bytes and used a 565-byte limit. Actual hand-count is 76 key bytes + 173 field/value bytes + 256 schema + 32 document = 537 bytes, so storage correctly accepted the write. Corrected the test limit to 530 and added an error-defined assertion. Relevant output:

```text
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
tests/data-redis-search.test.js (3 tests | 1 failed) 18ms
× requires module/index and rejects mismatched binary dimensions 6ms
  Cannot read properties of undefined (reading 'message')
FAIL requires module/index and rejects mismatched binary dimensions
TypeError: Cannot read properties of undefined (reading 'message')
tests/data-redis-search.test.js:87:22
Test Files 1 failed (1)
Tests 1 failed | 2 passed (3)
Start at 23:25:50
Duration 1.57s (transform 627ms, setup 0ms, collect 1.24s, tests 18ms, environment 0ms, prepare 88ms)
Verification elapsed: 2.444s; exit: 1
```

Next same file command passed 3/3, measured 2.375s (tool 2.410s), test bodies 13ms, Vitest duration 1.53s (transform 612ms, collect 1.21s, prepare 85ms), start 23:26:42.

Self-review found Array.some/forEach skips sparse array holes, contrary to finite-component packing. Added a regression assertion inside the first existing case and CLI CREATE/memory/DROP/binary-rejection checks inside the existing third case. RED same file command, exit 1, measured 2.388s (tool 2.415s):

```text
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
tests/data-redis-search.test.js (3 tests | 1 failed) 17ms
× filters all answer scopes before cosine ranking 11ms
  expected [Function] to throw an error
FAIL filters all answer scopes before cosine ranking
AssertionError: expected [Function] to throw an error
tests/data-redis-search.test.js:47:39
expect(() => float32Blob(Array(8))).toThrow()
Test Files 1 failed (1)
Tests 1 failed | 2 passed (3)
Start at 23:27:14
Duration 1.52s (transform 607ms, setup 0ms, collect 1.19s, tests 17ms, environment 0ms, prepare 97ms)
Verification elapsed: 2.388s; exit: 1
```

Root cause traced to sparse arrays skipping validation. `Array.from(vector)` makes holes visible as undefined for validation; finite vectors still pack unchanged. Also removed duplicated sandbox from CLI result details to match the existing shell result contract.

## Final GREEN, build and timings

Final `npm.cmd test -- tests/data-redis-search.test.js`, exit 0, measured 2.327s (tool 2.358s). Full relevant output:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-redis-search.test.js

RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
✓ tests/data-redis-search.test.js (3 tests) 14ms
Test Files 1 passed (1)
Tests 3 passed (3)
Start at 23:27:28
Duration 1.50s (transform 599ms, setup 0ms, collect 1.18s, tests 14ms, environment 0ms, prepare 102ms)
Verification elapsed: 2.327s; exit: 0
```

Single `npm.cmd run build`, exit 0, measured 4.879s (tool 4.921s). Full relevant output:

```text
> azure-trainer@0.1.0 build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 544 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                       0.88 kB │ gzip:   0.46 kB
dist/assets/LabPage-BM7-q5me.css     10.22 kB │ gzip:   1.90 kB
dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip:   8.25 kB
dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip:  38.44 kB
dist/assets/LabPage-QR0Scq1p.js     305.15 kB │ gzip:  78.65 kB
dist/assets/index-0USVcaiO.js     2,333.48 kB │ gzip: 630.47 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 4.17s
Verification elapsed: 4.879s; exit: 0
```

Staged owned-file `git diff --cached --check` passed, no whitespace findings; normal LF-to-CRLF advisories during staging. Final `git diff --check` and `git diff --cached --check` including the report passed, measured 0.073s, exit 0; output was only the normal controller-ledger LF-to-CRLF advisory and `Diff verification elapsed: 0.073s; exit: 0`. Test/build total measured **16.836 seconds**, or **16.909 seconds** including this diff check, well below 30 minutes. No store changes, so its four-case file was not rerun. No bare npm test, excluded full/AKS/Container Apps/browser suites, installs, network, real cloud execution or TTL wall waits. No SDK/runtime/template/Lab work or Lab walk-through at this core-only stage.

## Self-review and limits

Reviewed owned code and staged diff against the brief, persistence validator and upstream reports. The three tests exercise literal scope/ranking/distance, key tie-breaks, real bytes, invalid dimensions/descriptors, missing module/index, DIM 12 incident schema, indexing diagnostics, schema/OOM rollback, existing indexed HSET atomicity, TTL expiry accounting, supported/unsupported shape/count/dialect, drop retaining hashes, JSON saved-state validity, shell capability/clock/TLS and one-shot commands. Reserved property writes use own-property definitions. Return arrays/diagnostics are detached; schema data remains persistable. Input sandbox is unchanged except callers deliberately mutate their test capacity fixture.

No new storage/model concern found. Search and INFO enumerate current live fixture hashes exactly; hash_indexing_failures is current invalid live-document count, not Redis background-worker historical telemetry. The parser intentionally requires the authored field/option order and literal bounded identifiers (tags up to 128 chars, index/prefix up to 256); unsupported forms fail closed. HNSW is a labelled exact small-sample teaching approximation. No broader Redis protocol or query coverage is claimed. Existing bundle-size advisory remains; no compiler errors. Independent controller review and downstream Python/runtime/Lab walkthroughs remain later tasks.
