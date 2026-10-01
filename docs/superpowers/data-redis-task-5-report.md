# Task 5 — Redis application and workload pipeline

Implementation author: Codex. Worktree `.superpowers/worktrees/data-redis`, branch `codex/data-redis`, base `5c4aca5d53465ddfe3342569c2ad2f899e6eea40`. No merge, push, subagent or reviewer dispatch. Controller ledger excluded.

## Implemented and downstream interfaces

- `src/data/templates/data-python/redis.js` exports `REDIS_MANIFEST`, `REDIS_STARTER_FILES`, `REDIS_SOLUTION_FILES`, `REDIS_SOLUTION_FUNCTIONS` and the protected-boundary product enum. Seven supplied files: app.py, clients.py, training_runtime.py, server.py, Dockerfile, Deployment and Service. Manifest merges Task 4 helper protection, marks `dataApp:true`/`dataBackend:'redis'`, includes every protected file in buildFiles, and uses the existing exact `pythonInstallInstruction: 'RUN pip install redis'` mechanism. No build-engine rewrite or invented helper hash was necessary. Canonical five functions preserve the brief's cache-aside, two-prefix invalidation, binary semantic write/search and 0.05 threshold. Starter functions raise NotImplementedError. Fixed real HTTP handlers dispatch GET /cached with five arguments, GET /answer with four, POST /invalidate with product; enum and TTL validation mirrors the simulator boundary.
- `src/data/labs/data-journey/redis-helpers.js` exports `redisDependencies(target, fields)`, `redisDeployedArtifact`, `redisDeployedFunctionsCurrent`, `redisScenario`, `REDIS_TARGET` (data target), `REDIS_REQUEST_TARGET` (four-field scenario target), `REDIS_DEPENDENCY_TARGET` (combined), resource/index commands and `redisCliCommand`. Helpers import no Lab module. Deployed artifact resolution uses the Service selector, Ready running Deployment Pods and their immutable captured artifact IDs. Saved-function equality compares lowered function bodies to captured bodies; no draft source runs.
- Dependency fields are `images:assistant-api`, `code:assistant-api:<function>`, `redis:resource`, `redis:index:idx:semantic`, `redis:source:<product>`. Resource fingerprints include configuration/modules but exclude keys/stats/time/revisions. Index fingerprints omit creation time. Source revisions are individually selected. Code dependencies include deployed function plus whether the selected current saved function equals it. Lab authors choose narrow fields; historical baseline tasks should omit unrelated source/index/image dependencies. Current freshness tasks should include the changed product source and relevant cache/invalidation functions. No generic whole-database fingerprint was introduced.
- `redisScenario(steps, target=REDIS_REQUEST_TARGET)` is the trusted authoring assembler: primitive REDIS_WORKLOADS named-object args are converted in route order to arrays. It also accepts already ordered arrays. The UI never supplies steps, clocks, revisions, answers or evidence; its only envelope is `{type:'data-cache',scenarioId}`. `validRedisScenario` strictly checks exact scenario, target and step keys, route-specific array arity and scoped enums, positive TTL 1–300, advance 1–300, revision exactly 2, and at most 2048 authored steps. `validDataScenario` delegates the new kind.
- `src/data/labs/data-journey/redis-seeds.js` exports the three requested seeds and `applyRedisSeedActions`. Guided supplies resource group, ACR, AKS credentials, namespace and Service, with no Redis resource. Troubleshooting independently creates the module-omission fault and builds caller-supplied faulty edit zones. Independent supplies resource plus 8-dimensional index and builds caller-supplied unfinished zones. Neither substitutes completed functions or imports sibling Labs. Following existing initializer contracts, returned state is only sandbox/artifacts/runtime/nextSequence; lab source remains the caller's initial files.
- `src/lib/kubernetes/redis-actions.js` exports `applyRedisAction` and strict scenario validation. Route requires both dataRedis capability and trusted Redis manifest, then executes captured appSpec. source-update only changes `database.sourceRevisions[product]`, never cache keys; POST /invalidate runs learner Python; reset-cache deletes only ka:answer:/ka:sem: keys while retaining index/resource/revisions. Advance changes simulation time synchronously; final INFO performs real passive expiry. Existing Postgres/Cosmos branches remain unchanged.
- ExperimentPanel shows workload buttons and a Redis card only with dataRedis. It presents counts, source/cross-filter errors, age, memory, expiry/persistence/rejection metrics, every request's status/body, and bounded operation details. It labels estimates and unavailable/invalid provenance. Existing AKS controls remain available.

## Evidence contract for Lab authors

Measurements include `status,total,responseHits,semanticHits,originCalls,hitRatio,staleAnswers,crossFilterAnswers,expiredKeys,persistentKeys,rejectedWrites,usedBytes,maxAgeSeconds,ageKnown,traceTruncated,displayTraceTruncated,provenanceValid,answersCorrect,calls,requests,values,estimate,artifactId` (and `keyCount` from redisMemory).

`requests` retains **every** actual request as `{stepIndex,route,args,atMs,status,body,originCalls,responseHit,semanticHit,expectedAnswer,provenance}`. `values` retains each body. GET counts require successful non-null actual GET whose decoded payload equals the returned body and no origin call. Semantic hits require an actual FT.SEARCH returned payload matching the response, no origin call and no response hit. Origin counts come from the runtime counter. Answers must match the complete current scoped fixture answer and real cache/source provenance; an unknown or directly canned return cannot pass expectedAnswer. App `hit` fields are never used. Source mismatch and scope mismatch remain separately visible.

All per-request frames contribute counts before a **presentation-only** 256-operation cap is applied to `calls`. `displayTraceTruncated` is informational and does not invalidate complete-frame aggregate counts. A runtime frame with `redis.traceTruncated` is not trusted: `traceTruncated` is set, hit/provenance claims fail, and evidence completion fails. Full request statuses/bodies are never lost to the display cap. Workloads continue following failed requests so bounded memory incidents report real rejected writes instead of a fabricated success; overall status retains a non-200 error.

Evidence `completed` means the workload ran successfully with complete frames; it is not a Lab's answer rubric. Lab checks must inspect the relevant metrics/requests (particularly `provenanceValid`, `answersCorrect`, or a deliberately expected stale/error observation) and use `redisDeployedFunctionsCurrent` where appropriate. Historical evidence owns its measurement snapshot and does not depend on live cache contents/time. An intentional stale-hit observation therefore remains a completed workload with `answersCorrect:false`, `staleAnswers:1`.

## Controller-authorized timestamp compatibility

Controller explicitly authorized optional `writtenAtMs` in Redis key entries, the persistence validator and existing storage-case assertions. SET and HSET stamp supplied simulation time only on successful writes, through existing atomic write handling. Reads and EXPIRE preserve it; OOM rollback retains the old timestamp. Old saved keys without it remain valid. Hit ages use the matching key's actual pre-request write time, not lastAccessMs, guessed TTL or returned app flags; origin responses have zero cache age. If a matched key lacks a valid timestamp, `ageKnown:false` and `maxAgeSeconds:null` prevent false age proof. This is the only store/schema expansion.

## Verification commands, output and time

Prescribed disposable check replaces permanent pipeline/Lab tests and full-suite/TDD defaults. No test was run over tests/ without an explicit path. No AKS/ACA/browser suites, installs, network, real Python/Azure execution or TTL wall waits.

1. `node .superpowers/sdd/2026-10-01-data-labs-10-12/task-5-check.mjs`: exit 0; tool wall **1.6269165s**, assertion/program body **521ms**. It parses and builds starter and solution manifests, then uses real create/save/ACR build/kubectl apply/actions for reset, miss, 5-second advance, hit, source update, stale hit, learner invalidation and fresh source miss. Assertions: total4, responseHits2, originCalls2, hitRatio0.5, staleAnswers1, provenanceValid true, actual maxAge5s, one DEL, final revision2.

   Disposable negative in the same program removes the actual SET line, saves/builds a new image, edits the Deployment image, applies, and executes the same scenario. It proves responseHits0, hitRatio0, originCalls4. This is the one negative probe; no permanent integration test added. Relevant full output:

   ```text
   PASS: starter/solution parse+build; real create/save/build/apply miss-hit-update-invalidate; age=5s; no-SET negative hitRatio=0. 521ms
   ```

2. Controller-approved **single** `npm.cmd test -- tests/data-redis-store.test.js`: exit 0; stopwatch **6.1598761s**, tool wall **6.2139332s**. Reused existing cases, still exactly four case bodies. Added assertions for write timestamp, read/EXPIRE preservation, old-save absence acceptance, invalid negative timestamp, HSET timestamp and atomic OOM retention. Full relevant output:

   ```text
   RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-redis
   ✓ tests/data-redis-store.test.js (4 tests) 8ms
   Test Files 1 passed (1)
   Tests 4 passed (4)
   Start at 00:15:39
   Duration 964ms (transform 89ms, setup 0ms, collect 148ms, tests 8ms, environment 0ms, prepare 479ms)
   Verification elapsed: 6.1598761s; exit: 0
   ```

3. Self-review bound `expectedAnswer` to proven operation provenance as well as answer equality. Re-ran only the same disposable sequence after this localized change, without adding scenarios/negative probes or a replay matrix. Exit 0; combined with `git diff --check`, tool wall **0.8175412s**, program body **555ms**:

   ```text
   PASS: starter/solution parse+build; real create/save/build/apply miss-hit-update-invalidate; age=5s; no-SET negative hitRatio=0. 555ms
   ```

   `git diff --check`: exit 0; only normal LF-to-CRLF advisories, including pre-existing controller ledger dirt.

4. Single `npm.cmd run build`: exit 0; stopwatch **5.4112988s**, tool wall **5.4633564s**. Full relevant output:

   ```text
   vite v6.4.3 building for production...
   ✓ 550 modules transformed.
   dist/index.html                       0.88 kB │ gzip: 0.46 kB
   dist/assets/LabPage-BM7-q5me.css     10.22 kB │ gzip: 1.90 kB
   dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip: 8.25 kB
   dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip: 38.44 kB
   dist/assets/LabPage-InJpJuac.js     308.03 kB │ gzip: 79.49 kB
   dist/assets/index-yqeNxCRU.js     2,370.32 kB │ gzip: 640.82 kB
   (!) Some chunks are larger than 500 kB after minification.
   ✓ built in 4.34s
   Verification elapsed: 5.4112988s; exit: 0
   ```

Combined tool verification wall approximately **14.122s**, comfortably below 30 minutes. The final disposable check/diff check and build ran concurrently; this sum conservatively counts both durations. No full Labs were authored or walked through in this shared pipeline task.

## Files, self-review and limits

Created redis.js application template, redis-helpers.js, redis-seeds.js, redis-actions.js and this report. Modified manifests.js, data-actions.js, labEngine/actions.js, ExperimentPanel.vue, and authorized redis-store.js/model.js/existing storage tests. Ignored scratch check/report pointer are not committed. Controller progress ledger untouched.

Self-reviewed exact route arity, merged helper protection, real build hashes/snapshots, Service selection, source revision isolation, reset ownership, JSON evidence, enum boundaries, aggregate-before-display-cap logic, semantic raw-payload matching, unknown age behavior and atomic timestamp handling. Confirmed parser/build accepts unfinished starters and complete canonical solutions. Existing Docker/build infrastructure supplies the needed install/build capture, so no unnecessary changes there. No broad shared-runtime/recognizer refactor.

Limits: the small disposable sequence exercises cache-aside/invalidation and source freshness, not a second semantic/memory integration matrix or every seed combination. Semantic functions are parsed/built and rely on Task 4's real binary-payload SDK verification; full semantic/TTL/memory/scoped Lab walkthroughs remain Tasks 6–8. UI was compiled, not browser-tested per the prescribed scope. No independent review was spawned; controller review remains pending. Existing bundle-size advisory remains. No unresolved implementation blocker found.
