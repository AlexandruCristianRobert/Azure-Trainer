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
| 8 Lab 1 — Guided SDK/RUs/indexing/consistency | ⏭ next | — |
| 9 Lab 2 — Guided vectors + change feed | pending | — |
| 10 Lab 3 — Troubleshooting | pending | — |
| 11 Lab 4 — Independent | pending | — |

The Labs aren't registered on Home yet (Task 8 adds the journey and Lab 1). Nothing user-visible changed yet except the Cosmos container Blade rows.

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

## Log

- 2026-10-01 00:14 — design docs committed and pushed; started the Labs 1–4 plan.
- 2026-10-01 00:23 — Labs 1–4 plan written; started subagent-driven execution.
- 2026-10-01 00:30–02:12 — Tasks 1–7 implemented, reviewed and pushed.
- 2026-10-01 02:12 — stopped before Task 8 (deadline 2:30).
