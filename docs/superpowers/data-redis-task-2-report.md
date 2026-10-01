# Task 2 — Redis storage, TTL and bounded memory

Implementation author: Codex. Implemented on `codex/data-redis` in `.superpowers/worktrees/data-redis`, starting from `c84d7b4`. No merge or push. Controller-owned progress ledger was left untouched.

## Owned changes

- Added `src/lib/data/redis-store.js`: immutable Redis command execution, passive simulated expiry, atomic bounded writes, JSON scalar/binary values and cumulative measurements.
- Added `tests/data-redis-store.test.js`: exactly the four specified permanent `it` cases. Assertions also cover unsupported SET/glob syntax, native errors, clone isolation, JSON save validity, binary byte accounting, reserved object-key safety and snapshot deletion.
- Updated `src/components/blade/RedisEnterpriseBlade.vue` to import `redisMemory` instead of duplicating its formula. Existing read-only key/TTL presentation and simulation clock are preserved.
- Existing persisted validator already accepts these entry/binary/measurement schemas; no model change was needed. No search, SDK, runtime, templates, fixtures or Labs were edited.

## Downstream API contracts

```js
executeRedis(sandbox, target, command, args, { nowMs = 0 } = {})
// => { sandbox, value, measurements, error? }
redisMemory(database, nowMs)
// => { usedBytes, keyCount, persistentKeys }
```

Target is `{kind:'redis',resourceGroup,cluster,database:'default'}`. Commands are case-insensitive. Every execution returns a cloned sandbox, including errors. Caller must retain the returned sandbox to accumulate measurements. Value objects are detached from both caller arguments and returned database entries. Command-layer strings and finite numbers remain strings/numbers; binary values are canonical `{redisKind:'bytes',base64:string}` descriptors. No typed arrays, Map, decoded response conversion or CLI presentation is introduced here.

Supported commands and argument forms:

| Command | Arguments | Result |
| --- | --- | --- |
| GET | `[key]` | scalar/descriptor, or `null` |
| SET | `[key,value]`, `[key,value,'EX',positiveIntegerSeconds]` | `'OK'` |
| DEL | `[key,...]` | number deleted |
| EXISTS | `[key,...]` | number present, including repeated named keys |
| TTL | `[key]` | floored seconds, `-1` persistent, `-2` missing |
| EXPIRE | `[key,integerSeconds]` | `1` present / `0` missing; nonpositive expires immediately |
| HSET | `[key,fieldMapping]` | number of newly added fields |
| HGETALL | `[key]` | detached field map, `{}` missing |
| SCAN | `['0', 'MATCH', prefixGlob, 'COUNT', positiveInteger]`, options optional/order-independent | `['0', sortedMatchingKeys]` |
| INFO | `['memory']` | `{used_memory,maxmemory,maxmemory_policy:'noeviction',estimate}` |

Controller-approved SCAN simplification: one complete snapshot, terminal cursor string `'0'`, COUNT validated as a hint, maximum 4096 live database keys. MATCH supports exact literal keys, `*`, or one trailing `*`; other glob constructs and nonzero cursors fail closed. Task 4 can implement redis-py `scan_iter` by consuming the snapshot before learner deletions. No invented raw `SCAN_ITER` command or separate helper is exported.

Expiry uses only supplied simulation time: a key expires at `expiresAtMs <= nowMs`. All expired entries are purged before command execution/capacity accounting; each is counted once in the returned state. SET replaces type/value and clears an old TTL unless EX is present. HSET preserves TTL. GET/HGETALL increment hits/misses and update successful entry access time; EXISTS/TTL/SCAN/INFO do not count as cache reads. Measurements are cumulative database `{hits,misses,expiredKeys,rejectedWrites}` plus current `usedBytes`.

Memory is 64 bytes per live key + UTF-8 key bytes + value bytes. Hashes add UTF-8 field-name/value bytes and 16 bytes per field. Binary byte counts use decoded base64 length. Each index adds 256 bytes plus 32 for each live hash key with its prefix. Persistent keys are counted, not returned by name. `redisMemory` is read-only and filters expiry without updating stats. INFO/Blade estimates are labelled `Simulated estimate — not an Azure guarantee.`

Over-budget growing SET/HSET operations restore the complete prior entry and increment `rejectedWrites`; expired capacity is reclaimed first. Deletes/expiry and writes that do not grow memory remain possible above the limit. No eviction or RediSearch allocator behavior is fabricated. Native arity/integer/WRONGTYPE/OOM errors return `error.code:'ResponseError'`; unsupported commands/options/data/globs return `DATA_UNSUPPORTED` and the required message prefix. A missing target database returns `ConnectionError`.

## RED evidence

Used the real Task 1 resource APIs and a minimal fail-closed storage export scaffold, so imports/resource setup succeeded and storage behavior was missing.

First `npm.cmd test -- tests/data-redis-store.test.js`: exit 1, measured 1.346s (tool 1.415s), four failures. GET returned null before expiry; HSET did not add a field; SCAN lacked a value and the test dereferenced null; OOM was not implemented. Changed the SCAN test to assert no error before reading its value, retaining the supplied invalidation assertions. Also corrected the persistence assertion API name from `isValidSandbox` to the repository's `isSandboxShape` before reaching GREEN.

Second identical RED command: exit 1, measured 1.311s (tool 1.351s). All four failed as assertions on missing behavior:

```text
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
tests/data-redis-store.test.js (4 tests | 4 failed) 11ms
× expires at the boundary and SET without EX clears an old TTL
  expected null not to be null
× preserves hash TTL and rejects wrong-type reads
  expected null to be 1 // Object.is equality
× invalidates both product namespaces without deleting another product
  expected { code: 'DATA_UNSUPPORTED', …(1) } to be undefined
× rejects over-budget writes atomically and reuses expired capacity
  expected 'Not supported by the simulator: Redis…' to contain 'OOM'
Test Files 1 failed (1)
Tests 4 failed (4)
Duration 440ms (transform 89ms, setup 0ms, collect 140ms, tests 11ms, environment 0ms, prepare 92ms)
Verification elapsed: 1.311s; exit: 1
```

An initial combined apply_patch failed its Blade context check and changed no files; corrected the patch context and applied the implementation. This was not a verification run or behavior failure.

## GREEN and build evidence

`npm.cmd test -- tests/data-redis-store.test.js`: exit 0, measured 1.263s (tool 1.293s). Full relevant output:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-redis-store.test.js

RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
✓ tests/data-redis-store.test.js (4 tests) 9ms
Test Files 1 passed (1)
Tests 4 passed (4)
Start at 23:14:20
Duration 445ms (transform 89ms, setup 0ms, collect 138ms, tests 9ms, environment 0ms, prepare 92ms)
Verification elapsed: 1.263s; exit: 0
```

Single `npm.cmd run build`: exit 0, measured 4.840s (tool 4.879s). Full relevant output:

```text
> azure-trainer@0.1.0 build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 542 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                       0.88 kB │ gzip:   0.46 kB
dist/assets/LabPage-BM7-q5me.css     10.22 kB │ gzip:   1.90 kB
dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip:   8.25 kB
dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip:  38.44 kB
dist/assets/LabPage-DeKU3DNU.js     305.82 kB │ gzip:  78.94 kB
dist/assets/index-CcGLmiHW.js     2,318.10 kB │ gzip: 625.38 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 4.13s
Verification elapsed: 4.840s; exit: 0
```

`git diff --check` passed with no whitespace findings; normal Git LF-to-CRLF advisories were present. `git diff --cached --check` also passed on the four owned files, measured 0.032s. Combined RED/GREEN/build measurement: **8.760 seconds**, or **8.792 seconds including the measured staged diff check** (test/build tool command wall times ~8.938s), far below 30 minutes. No TTL waiting, full/AKS/Container Apps/browser suites, installs, network or real Azure execution.

## Self-review and remaining concerns

Reviewed command branches, immutable return paths, rollback, expiry boundary, hash TTL, own-property handling, descriptor canonicalization and memory accounting against the brief. Reserved key/field names are written as own properties to avoid prototype pollution. Persisted state passed the existing shape validator through JSON round-trip in the focused tests. Four tests retain all supplied literal behavior assertions and use no mocks.

Index accounting was reviewed against the existing Task 1 schema; search creation/query behavior and redis-py/CLI conversion are outside this task and await downstream checks. The four tests are intentionally not a complete Redis command edge-case suite. No browser inspection or Lab walkthrough was run at this core-only stage. Single-snapshot SCAN is a bounded teaching contract, not a complete Redis cursor implementation. Existing bundle-size advisory remains; no compiler errors. No persisted schema compatibility concerns found.
