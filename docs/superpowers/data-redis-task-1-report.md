# Task 1 — Redis resources, CLI, portal and fixtures

Implemented on `codex/data-redis`, isolated worktree `.superpowers/worktrees/data-redis`, base `c89dd02`. Implementation author: Codex. No merge or push.

## Changes

- Added `src/lib/sandbox/redis.js`: immutable create/get/delete; `Balanced_B0`, optional creation-time `RediSearch`, EnterpriseCluster, NoEviction, encrypted client, training key authentication and port 10000. Repeated identical create preserves live keys/indexes/stats/source revisions; configuration/module changes require recreation. Fictional supplied host: `{name}.{location}.redis.training.invalid`.
- Added `src/lib/az/commands/redisenterprise.js` and `src/lib/az/redis-arm.js`: only create/show/delete/database show; proper provider IDs/types, no credentials or data payload presentation. CLI requires explicit `--access-keys-auth Enabled`; unsupported options/combinations fail. Delete follows existing `--yes` confirmation convention.
- Added Redis persistence in `model.js`: absent old collection remains valid and normalizes to `[]`; JSON-only, finite values, key/index schemas, canonical base64, nonnegative timestamps/limits/stats, group ownership and duplicate-resource validation. No model/Redis import cycle: validator is in model; resource module imports `cloneSandbox` only.
- Added `RedisEnterpriseBlade.vue`, BladeHost and resource-group listing integration: read-only overview, modules, teaching memory usage/limit, live key names/types/TTL, TAG and HNSW vector schema. Binary/scalar values and credentials are never rendered. Expiry uses `run.behavioralRun.runtime.simTimeMs`; no wall-time waits. Memory uses the planned bounded fixture formula.
- Added `src/data/fixtures/data/redis.js`: base data is cloned and deeply frozen; canonical/paraphrase/near-miss vectors unchanged; scoped same-wording variants, revisioned 35-to-14-day update, protected-origin lookup, embedding helper and 256 deterministic explicit canonical aliases. Primitive bounded workload steps are declared; deployment targets, grading, lab assembly and runtime remain later tasks.

## Controller-approved integration additions

- `src/lib/az/commands/index.js`: conventional command registration replaces the brief's anticipated `az/run.js` integration. `run.js` remains unchanged; existing runner already routes and renders registered groups.
- `src/lib/bladeResolve.js`: four-line Redis existence/fallback branch, required because BladeHost resolves all selected blades through this function.
- `src/lib/sandbox/ops.js`: one-line Redis cascade in resource-group deletion, prevents orphan resources and invalid persisted saves.

No controller ledger, storage/search/runtime/template/Lab files, permanent tests, existing fixture contents or unrelated journey behavior were edited.

## Downstream contracts

`getRedisCluster(sandbox,{resourceGroup,name})` returns cluster or null; CRUD mutations return cloned sandbox (`create` also returns `cluster`). Target is `{kind:'redis',resourceGroup:'rg-assistant',cluster:'redis-assistant',database:'default'}`.

Database has `name:'default'`, `port:10000`, `modules`, policies/protocol/authentication, `keys:{}`, `indexes:{}`, `memoryLimitBytes:65536`, `sourceRevisions:{}`, and `stats:{hits:0,misses:0,expiredKeys:0,rejectedWrites:0}`. A key entry is `{type:'string'|'hash',value,expiresAtMs:null|number,lastAccessMs:number}`. Hash values are field maps. Scalar values are strings or finite numbers; binary values MUST be `{redisKind:'bytes',base64:string}`. Actual FLOAT32 little-endian bytes will be produced by Task 3, not numeric arrays disguised as bytes.

An index is `{name,prefix,fields,createdAtMs?}`. TAG fields are `{name:'product'|'version'|'language',type:'TAG'}`; vector field is `{name:'embedding',type:'VECTOR',algorithm:'HNSW',dataType:'FLOAT32',dimensions:8|12,distanceMetric:'COSINE'}`. Present optional `createdAtMs` must be finite/nonnegative.

Exports: `REDIS_TARGET`, `REDIS_FIXTURES`, `REDIS_WORKLOADS`, `redisEmbed(question,deployment='embeddings-v1')`, and `redisSourceAnswer(scope,question,revision=1)`. Origin returns a fresh `{answer,scope:{product,version,language},sourceRevision,sourceIds}` or explicit null for unknown scope/text/revision. Revision is 1 or 2. Case/whitespace normalization matches canonical, paraphrase, near-miss and alias text. Paraphrases/aliases use canonical current scoped answers; near misses have different answers. `redisEmbed` returns fresh 8/12-dimensional arrays or null. Alias entries carry explicit `of` and vector; no random generation.

Scope variants use the same retention question under backup-v1-en (35 days), backup-v2-en (45 days), backup-v1-de (German 35 days), support-v1-en (diagnostic snapshots, 7 days). Revision 2 changes backup-v1 retention to 14 days in English/German. Each has a distinct near-miss answer as well. The other three base canonical questions and their paraphrases/near misses retain native product/v1/en scope. All origin answers carry provenance; returned scope IDs differ where needed.

Workloads are immutable primitive `{steps:[...]}` entries named `cache-baseline`, `cache-expiry`, `cache-freshness`, `cache-scopes`, `cache-semantic`. Requests carry `{action:'request',route:'GET /cached'|'GET /answer'|'POST /invalidate',args:{question,product,version,language,ttl?}|{product}}`; other steps are `advance` and `source-update`. Final scenario kind/version/target/evidence assembly belongs to Tasks 5–8.

## Verification and timings

Only the disposable `.superpowers/sdd/2026-10-01-data-labs-10-12/task-1-check.mjs` was used. No permanent resource tests, excluded journey suites, full suite, browser automation, installs or network/Azure execution.

1. `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-1-check.mjs` before implementation: expected RED, `AssertionError: Old saves normalize Redis collection`, `undefined !== []`; exit 1, tool wall 1.270s.
2. First implementation run caught parser mismatch (`values.modules.map is not a function`), exit 1, 0.117s. Root cause: repository `kind:'list'` produces objects, while `kind:'pairs'` preserves ordered pairs. Changed only module declaration/parser to pairs, retaining duplicate validation.
3. Initial GREEN: exit 0, 0.110s tool wall; fixture distances, normalization and CLI create/show/database show passed. Expanded same disposable check for review risks: exit 0, 0.230s tool wall, assertion body 0.007s.
4. `npm.cmd run build`: exit 0, measured 5.257s (tool 5.317s), Vite 4.42s. Full relevant output: Vite 6.4.3; 541 modules transformed; `dist/index.html` 0.88kB; LabPage CSS 10.22kB; index CSS 43.07kB; vendor JS 98.85kB; LabPage JS 305.51kB; index JS 2318.00kB. Existing advisory: some chunks exceed 500kB after minification. No compiler errors.
5. Final same focused check after group cascade: exit 0, measured 0.148s (tool 0.194s), assertion body 0.005s. Full result: `PASS: fixture distances and 0.05 threshold; normalization; CLI create/show/database show; nonreset/recreation; binary/timestamp validation; scoped/revised source answers; clone isolation; 256 aliases; group cleanup (0.005s)`.
6. `git diff --check`: exit 0, no whitespace findings; Git reports normal LF-to-CRLF advisory for edited files. No second build for the isolated one-line cleanup; final disposable check directly exercises it.

Combined verification command wall time approximately 7.3 seconds, below the 30-minute ceiling; no waiting for TTL. Distances verified for all four canonical/paraphrase pairs (~0.0341) and all four near misses (~0.1340): 0.05 accepts the paraphrase only.

## Self-review and remaining limits

Reviewed all changed/new files against the brief: scope/IDs/revisions preserved, old saves accepted, re-create cannot reset live state, module additions blocked, empty modules intentionally support omission incident, JSON binary data remains persisted-safe, Blade hides payloads and expired keys, no import cycle, group cleanup leaves valid state. The disposable check remains ignored scratch, not part of the commit.

No visual browser walkthrough was run under the prescribed verification scope. Portal automatically emits generic Redis notifications and does not automatically navigate on Redis creation because `stores/portal.js` was outside original ownership; manual resource-group selection and deletion fallback work. This is a minor presentation integration limit for controller review. Memory accounting in the Blade should consume Task 2's shared implementation once available to prevent duplicate formula drift. Future evaluators must use the documented persistence shapes. Build's existing bundle-size advisory remains.
