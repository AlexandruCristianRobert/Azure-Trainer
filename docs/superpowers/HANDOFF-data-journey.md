# Data journey — handoff

Branch: `data-journey` (pushed to origin). On another machine: `git fetch && git checkout data-journey && git pull`.

## STOPPED — 2026-10-01 02:12

Stopped by the learner's rule "stop at 2:30 or when it's best to break". Tasks 1–7 of the Labs 1–4 plan are done and reviewed. Task 8 (Lab 1) wouldn't have finished with its review before 2:30, so it wasn't started. The working tree is clean.

## Where things stand

- Spec: `docs/superpowers/specs/2026-09-30-data-learning-journey-discussion.md` (all decisions settled).
- ADR: `docs/adr/0003-shared-sdk-call-catalog-for-data-labs.md`.
- Plan for Labs 1–4 (Cosmos): `docs/superpowers/plans/2026-10-01-data-labs-01-04.md`.
- SDD ledger (progress, rulings, deferred minors): `docs/superpowers/data-journey-sdd-ledger.md`. This is a mirror; the live ledger is in the git-ignored `.superpowers/sdd/2026-10-01-data-labs-01-04/progress.md`. On a new machine, copy the mirror back there before resuming SDD: `mkdir -p .superpowers/sdd/2026-10-01-data-labs-01-04 && cp docs/superpowers/data-journey-sdd-ledger.md .superpowers/sdd/2026-10-01-data-labs-01-04/progress.md`.

| Plan task | Status | Commits |
| --- | --- | --- |
| 1 Fixtures (`src/data/fixtures/data/knowledge.js`) | ✅ reviewed | c81074c |
| 2 Cosmos items, container update, autoscale | ✅ reviewed | 6913157 |
| 3 Cosmos NoSQL query evaluator (+5 tests) | ✅ reviewed, 1 fix round | 1a42fdb, 37d9aed |
| 4 RU cost model (+4 tests) | ✅ reviewed | 537a607 |
| 5 SDK call catalog + Python recognizer (+4 tests) | ✅ reviewed | a5002b4 |
| 6 Data-app runtime (+1 test) | ✅ reviewed | 253395b |
| 7 Change feed, Cosmos template, AKS pipeline wiring | ✅ reviewed | 45d84f4, 97b013b, 764035c |
| 8 Lab 1 — Guided SDK/RUs/indexing/consistency | implemented, fix round 1 applied, not yet reviewed | 3b72e35, 5c702ab, 9090d63, d120842, ebfe677, 8ae258a + fix round 1 |
| 9 Lab 2 — Guided vectors + change feed | implemented, not yet reviewed | see task-9-report.md |
| 10 Lab 3 — Troubleshooting | ⏭ next | — |
| 11 Lab 4 — Independent | pending | — |

The Data journey and Lab 1 are now registered on Home (`data-knowledge-assistant`). Lab 2 is registered after Lab 1. `tests/data-cosmos-labs.test.js` replays both Labs' Solutions end to end; `npm run build` passes.

## Testing rules (from the learner — must be followed)

- Do not run the existing test suite (`npm test` / `vitest run` without a path).
- Keep tests light: only the few focused tests the plan names; run them by explicit path (`npx vitest run tests/data-cosmos-query.test.js tests/data-cosmos-cost.test.js tests/data-python-sdk.test.js`).
- A Lab is verified by `npm run build`, its solution-replay test, and one manual walk-through.

## How to continue

Open Claude Code on this branch and say: "continue the data journey from docs/superpowers/HANDOFF-data-journey.md". The controller should:

1. Restore the ledger (command above) and use superpowers:subagent-driven-development on `docs/superpowers/plans/2026-10-01-data-labs-01-04.md`, starting at **Task 8**, with Sonnet subagents.
2. Give Task 8's implementer these facts from Task 7:
   - The pipeline lives in `src/lib/kubernetes/data-actions.js`, `src/lib/data/change-feed.js` (`CHANGE_FEED_HOOK`) and `src/data/templates/data-python/cosmos.js`.
   - Labs provide `lab.dataTarget = { resourceGroup, account, database }`.
   - Scenario shapes are `{ kind: 'data-request', steps: [{ route, args }] }` and `{ kind: 'data-worker', steps: [{ action: 'post'|'batch'|'restart'|'redeliver', ... }] }`.
   - `dataDependencies()` in `src/data/labs/data-journey/cosmos-helpers.js` is the evidence-staleness selector set.
   - The worker step contract was designed by the Task 7 implementer; confirm it fits the Labs.
3. After Labs 1–4, run the final whole-branch review (most capable model), then write the plan for Labs 5–9 (PostgreSQL) from the spec.

## Rulings made on the learner's behalf (review these)

1. Never run the full suite (overrides the superpowers implementer template). If this is wrong, an existing-test regression goes unnoticed until you run the suite.
2. The Lab 4 container scale is applied by `az cosmosdb sql container create` from `context.lab.dataScale`.
3. `_lsn` change sequence numbers are counted per container, not Sandbox-wide.
4. A vector `ORDER BY` counts as indexed when a vector index exists, even with `/embedding/*` excluded. This was promoted from a reviewer's Minor note because Lab 2 depends on it.
5. An invalid `consistency_level` produces an `SDK_ARGUMENT` diagnostic; same-file helper calls take positional arguments only.
6. The change feed reaches the runtime through an injectable hook; `read_lease` returns None on 404; there is no try/except support.
7. `delete_item` is left unsupported at runtime (no Lab uses it).
8. Lab target and scenario step shapes are as in step 2 of "How to continue".
9. `src/lib/kubernetes/schema.js` allows a container `command` field, but only for `dataCosmos` Labs, because the worker Deployment needs it. The reviewer confirmed no change for other Labs.
10. (Task 8) `src/lib/project/build.js`'s `buildImage` had a latent bug: it compared `project.appSpec.listeningPort` against the Dockerfile's EXPOSE port unconditionally, but a data app's appSpec (ADR-0002/0003) has no `listeningPort` field, so `az acr build` always failed with a false `PORT_MISMATCH` for *any* data app. Fixed by skipping that comparison when `manifest.dataApp === true`. This blocks every future Data journey Lab needing `acrBuild`, not just Lab 1, so it's worth flagging to the Task 9–11 implementers rather than re-discovering.
11. (Task 8, superseded by fix round 1) Lab 1's `stages` *and* `tasks` array both now follow one safe completion order: provision → tune (`indexing`) → code (`code-crud`) → deploy (`deployed`) → verify (`point-read`, `cross-partition`, `ordered`) → consistency (`read-your-writes`). `indexing` runs before the code/deploy/verify Tasks because `recent_sessions_for_user`'s solution query is a 2-property `ORDER BY` that needs the composite index `indexing` adds, so `cross-partition`/`ordered` can't return 200 before it — and `LabPanel` renders `stages` in array order with all of them open, so the *displayed* order has to be the safe order too, not just the underlying Task array. `ordered` moved from `tune` into `verify` since it is itself a verification Task alongside `point-read`/`cross-partition`. Worth the Task 9–11 implementers checking each Lab's Stage table against its Task dependencies for the same trap.
12. (Task 8, fix round 1) `dataDependencies(target, fields)` now takes the specific fields a Task depends on (`'images'`, `'clientConsistency'`, `'accountConsistency'`, `'indexing:<container>'`) instead of returning one key covering every field for every Lab 1-4 verification Task. The key is distinct per field set, so e.g. `cross-partition` (depends only on `'images'`) no longer goes stale when `indexing` changes `sessions`' policy — only `ordered` (which lists `'indexing:sessions'`) does. Task 9–11 implementers: pass the real field list each Task's `check` reads, not a default.
13. (Task 8) `ordered`'s write-charge comparison uses the simpler of the two options the brief offered: it computes the default-policy write charge for the seeded message shape with `writeCharge()` directly, rather than reading back the specific charge recorded by `point-read`'s own evidence.
14. (Task 9) `data-actions.js`'s `runRequestSteps`/`runWorkerSteps` now also return `values` (every step's own result, in order), surfaced as `measurements.values`. Needed because Lab 2's `similar` Task must prove two separate query results (a paraphrase and a near-miss) from one Task's evidence, and the existing `value` field only ever kept the last step's result. Purely additive — `value`/`calls`/`status`/`stale`/`totalCharge` are unchanged, and no existing evidence/measurements schema check is keyed to a fixed field set.
15. (Task 9) `dataDependencies` gained a new field kind, `images:<deploymentName>` (just that one Deployment's source hash), alongside the existing combined `'images'` (both Deployments' hashes together). A Lab 2 Task that cares about only one Deployment must use the scoped field: `similar` (verified before feedback-worker is ever deployed) uses `'images:assistant-api'`, `no-miss` uses `'images:feedback-worker'`. Using the combined `'images'` for `similar` would have made it go stale the moment `worker-deployed` later deploys feedback-worker — the exact "later Task invalidates earlier evidence" trap ruling 11 warned about, just via a dependency *value* changing rather than a Stage/Task order problem. Task 10–11 implementers: check this for every Task that depends on only one of two Deployments.
16. (Task 9) The Task 7 `data-worker` step contract (`post`/`batch`/`restart`/`redeliver`) fit Lab 2's `feed-restart` scenario (post×3 → batch → restart → post×2 → batch) exactly as-is — `restart` only clears `redeliver`'s in-memory replay buffer, never the Sandbox-persisted lease, so the second batch correctly resumes from the first batch's saved continuation. No `data-actions.js` worker-step change was needed for this. (The `values` change in ruling 14 was needed on the **request** side, for `similar`, not the worker side.)

## Log

- 2026-10-01 00:14 — design docs committed and pushed; started the Labs 1–4 plan.
- 2026-10-01 00:23 — Labs 1–4 plan written; started subagent-driven execution.
- 2026-10-01 00:30–02:12 — Tasks 1–7 implemented, reviewed and pushed.
- 2026-10-01 02:12 — stopped before Task 8 (deadline 2:30).
- 2026-10-01 — Task 8 implemented: Lab 1 (Guided Cosmos SDK conversation history), its seed, shared Cosmos Lab helpers, Home/`index.js` registration and the solution-replay test. Fixed a `buildImage` bug blocking every data app build (ruling 10). `npx vitest run tests/data-cosmos-labs.test.js` and `npm run build` both pass. Not yet reviewed.
- 2026-10-01 — Task 8 fix round 1 (2 Important findings): made `stages`/`tasks` display order match the safe completion order (ruling 11) and made `dataDependencies` take per-Task fields instead of one shared key (ruling 12). Re-ran `npx vitest run tests/data-cosmos-labs.test.js` and `npm run build`; both pass.
- 2026-10-01 — Task 9 implemented: Lab 2 (Guided vectors + change feed), its seed (`seedCosmosVectorGuided`), two minimal additive adaptations to shared Task 7/8 plumbing (rulings 14–15), and the solution-replay test. Confirmed the existing `data-worker` step contract needed no change for `feed-restart` (ruling 16). `npx vitest run tests/data-cosmos-labs.test.js` (3 tests) and `npm run build` both pass; two deliberate sabotage/revert cycles confirmed the new test isn't vacuous. See task-9-report.md for full detail. Not yet reviewed.
