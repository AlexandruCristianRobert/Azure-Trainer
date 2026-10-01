# SDD ledger — plan: docs/superpowers/plans/2026-10-01-data-labs-01-04.md
Spec: docs/superpowers/specs/2026-09-30-data-learning-journey-discussion.md
Branch: data-journey. Merge base: ef4f7e7-era main (git merge-base main HEAD).

## Preflight scan
| Tasks | Shared file/interface | Finding |
|---|---|---|
| 2↔3,4,6 | container fields (items, physicalPartitions, logicalScale, indexingPolicy.compositeIndexes) | consistent |
| 3↔4 | isPathIndexed exported by cosmos-query.js, consumed by cosmos-cost.js | consistent (Task 4 text says to export it in Task 3 file; allowed) |
| 5↔6,7 | parseDataApp appSpec.data.functions / manifest.editZones, receivers | consistent |
| 6↔7 | recordChange wired into runtime upsert | Task 7 modifies runtime.js; ok |
| 7↔8-11 | manifest id data-python-cosmos-v1, capability dataCosmos, scenario kinds data-request/data-worker | consistent |
| 8↔9-11 | tests/data-cosmos-labs.test.js + tests/helpers/dataLab.js | consistent |
| 11 | lab.dataScale applied "in createCosmosContainer" | sandbox fn has no lab; see Ruling 2 |
| each task | self-consistency | Task 4 interface fixed; others ok |

Ruling 1: Implementer template says "run the full suite once before committing"; overridden — never run full suite (learner's binding rule, spec Testing policy) — cost if wrong: an existing test regression goes unnoticed until the learner runs the suite.
Ruling 2: Lab 4 scale hook — the az container create command applies run.lab.dataScale from command context, not the sandbox function signature — keeps sandbox pure — cost if wrong: minor refactor.

## Progress
Task 1: implemented c81074c (base 6cac9e0); in review
Task 1: complete (commits 6cac9e0..c81074c, review clean)
Task 1: minor (deferred): deep-freeze style differs from AKS fixtures
Task 1: minor (deferred): embed() treats unknown deployment names as v1 without validation
Task 2: dispatched (base 7138b72)
Ruling 3: Task 2 _lsn per container (not sandbox-wide) accepted — Cosmos LSNs are per partition/container; Task 7 change log is per container — cost if wrong: small refactor in Task 7
Task 2: complete (commits 7138b72..6913157, review clean)
Task 2: minor (deferred): container update help doesn't say --idx is effectively required
Task 2: minor (deferred): legacy persisted containers lacking compositeIndexes may Conflict on identical re-create (same pre-existing pattern as vectorIndexes)
Task 2: minor (deferred): commit trailer says "Sonnet 5" instead of "Sonnet 5.5"
Task 2: minor (deferred): blade item count label "(simulated)" vs global phrase
Task 3: dispatched (base 6913157)
Task 3: implemented 1a42fdb (base 428781b); in review
Ruling 4: Task 3 reviewer Minor "VectorDistance path counted in usedIndex" promoted to Important — Lab 2 requires /embedding/* excluded, so vector queries would be mis-scored as full scans — cost if wrong: one extra fix round
Task 3: fix round 1/5 dispatched (FIX_BASE 1a42fdb)
Task 3: minor (deferred): cosmos-query.js 364 lines vs ~300 guidance
Task 3: fix round 1/5 (1 addressed, 0 open; commits 1a42fdb..37d9aed)
Task 3: complete (commits 428781b..37d9aed, review clean)
Task 4: dispatched (base e7f97c9)
Task 4: complete (commits e7f97c9..537a607, review clean)
Task 5: dispatched (base ca97432); rulings in dispatch: wiring entries for get_database_client/get_container_client; raise NotImplementedError → DATA_UNSUPPORTED 'not completed'; sdk-attribute for last_response_headers etag
Ruling 5: Task 5 invalid consistency_level uses SDK_ARGUMENT; call-local args positional-only — both reasonable and unspecified — cost if wrong: small recognizer tweak
Task 5: complete (commits ca97432..a5002b4, review clean)
Task 5: minor (deferred): lookupCall returns {key, ...entry}
Task 5: minor (deferred): if/else, raise, invalid consistency, call-local paths covered only informally (light-testing rule)
Task 6: dispatched (base ec469be). Ruling 6: change feed via injectable hook {read, recordChange} supplied by Task 7; read_lease 404→None; no try/except — cost if wrong: Task 7 wiring adjustments
Ruling 7: delete_item runtime left DATA_UNSUPPORTED — no Lab 1-4 uses it — cost if wrong: add store delete later
Task 6: complete (commits ec469be..253395b, review clean)
Task 6: minor (deferred): findAccountByName duplicated inline; change feed charge assumes partitionsTouched 1
Task 7: dispatched (base 49713e3). Ruling 8: lab.dataTarget supplies account/db; data-request has multi-step steps sharing scenarioState; data-worker steps post/batch/restart/redeliver; incremental commits for deadline — cost if wrong: Lab wiring adjustments
Ruling 9: Task 7 extended kubernetes/schema.js with dataCosmos-gated container 'command' field — needed for worker Deployment — cost if wrong: schema change affects other Labs (gated, reviewer to check)
Task 7: complete (commits 49713e3..764035c, review clean)
Task 7: minor (deferred): AksExperimentPanel dataEvidence optional-chaining style; dataDependencies() unused until Task 8 (signature may need adjustment)
Task 7: note for Task 8: data-worker step contract (post = raw container write, redeliver re-sends previous batch) is implementer-designed — confirm fits Labs
STOPPED at 02:12 (Task 8 would not finish + review before the 2:30 deadline). Next: Task 8 (Lab 1). Tasks 1-7 complete.
RESUMED by learner request: Tasks 8-11. Task 8: dispatched (base a5418fa)
Ruling 10: Task 8 build.js PORT_MISMATCH skip for dataApp accepted (gated, needed by all data Labs) — cost if wrong: build check gap for data apps
Ruling 11: Task 8 — (a) stages display order must equal the safe completion order: provision → tune(indexing) → code → deploy → verify(point-read, cross-partition, ordered) → consistency; the "see the composite-index error first" moment is dropped from Lab 1 (Lab 3 teaches it as an incident) — (b) dataDependencies becomes per-Task: each verification Task snapshots only the fields it depends on — Guided Lab must be an ordered walkthrough (CONTEXT.md); Labs 2-4 reuse the helper — cost if wrong: Lab 1 narrative slightly less dramatic
Task 8: minor (deferred): extra registration test in data-cosmos-labs.test.js; dataScale value undocumented
Task 8: fix round 1/5 dispatched (FIX_BASE 8ae258a)
Task 8: fix round 1/5 (2 addressed, 0 open; commits 8ae258a..3b61403)
Task 8: complete (commits a5418fa..3b61403, review clean)
Task 9: dispatched (base ac5ce42)
Task 9: implemented ac5ce42..7c1f95e; in review
Task 9: complete (commits ac5ce42..7c1f95e, review clean)
Task 9: Ruling 12: `similar` merged into one 8-step scenario (engine maps 1 scenario → 1 Task evidence) — accepted — cost if wrong: none
Task 9: minor (deferred): Sonnet 5 vs 5.5 commit trailers (harness attribution)
Ruling 13: Lab-file helpers (findReturnCall/file/commands/scenario/parsed) duplicated between Lab 1 and 2 — Task 10 extracts them into cosmos-helpers.js before adding Lab 3 — avoids 4× copies — cost if wrong: small refactor risk to Labs 1-2 (covered by replay tests)
