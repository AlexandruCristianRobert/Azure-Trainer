# Data journey — handoff

Current PostgreSQL branch: `codex/data-postgres`, based on `e059e55`, in `.superpowers/worktrees/data-postgres`. Local implementation only; no PostgreSQL merge or push has been performed. The older Cosmos branch notes below are historical.

## PostgreSQL status — 2026-10-01

Labs 5–9 and their shared simulator support are implemented and task-reviewed. All 12 plan tasks are complete; final whole-branch review is in progress. Progress, review fixes, verification timings and controller decisions are recorded in `docs/superpowers/data-postgres-progress.md`. Task reports are `docs/superpowers/data-postgres-task-N-report.md`.

Validation is intentionally bounded: named Data files only, no existing AKS/Container Apps suites, full suite or browser tests. Lab replay/build checks have taken seconds, not the 30-minute per-lab limit. Real Azure deployment and real Python/SQL execution are outside this simulator's scope. The existing Vite bundle-size advisory remains.

| Lab | File |
| --- | --- |
| 5 Guided: Connect, schema, B-tree and GIN | `src/data/labs/data-journey/postgres-connect-guided.lab.js` |
| 6 Guided: pgvector sizing, filtered RAG | `postgres-vector-guided.lab.js` |
| 7 Guided: Connection pools and PgBouncer | `postgres-pooling-guided.lab.js` |
| 8 Troubleshooting: PostgreSQL incidents | `postgres-troubleshooting.lab.js` |
| 9 Independent: v3 audience-aware retrieval and throughput | `postgres-independent.lab.js` |

Shared support includes `src/lib/data/pg-sql.js`, `pg-engine.js`, `pg-plan.js`, `pg-pool.js`, `psql.js`, PostgreSQL SDK/runtime lowering, Flexible Server CLI/portal state, and the PostgreSQL template/data pipeline. Six-replica validation is gated to PostgreSQL labs; legacy replica limits are preserved.

The latest explicit `tests/data-postgres-labs.test.js` run passes five solution replays. Builds pass with the existing bundle advisory. Browser walkthroughs and excluded journey suites have not been run. Thresholds and connection/vector estimates are teaching models, not Azure guarantees. The independent v3 extension uses its own protected manifest and loader and preserves the base corpus.

## Status — 2026-10-01: Labs 1–4 (Cosmos DB) complete

All 11 tasks of `docs/superpowers/plans/2026-10-01-data-labs-01-04.md` are implemented. Each task was reviewed. A final whole-branch review on Opus returned "ready with fixes", and a single fix wave addressed all 11 findings; its scoped re-review was clean. The four Labs are registered on Home under the **Data journey** (`data-knowledge-assistant`). Not merged to `main`.

- Spec: `docs/superpowers/specs/2026-09-30-data-learning-journey-discussion.md`
- ADR: `docs/adr/0003-shared-sdk-call-catalog-for-data-labs.md`
- Ledger (every task, fix round, ruling and deferred minor): `docs/superpowers/data-journey-sdd-ledger.md`

| Lab | File |
| --- | --- |
| 1 Guided: Conversation History with the Cosmos DB SDK | `src/data/labs/data-journey/cosmos-sdk-guided.lab.js` |
| 2 Guided: Similar questions and a change feed processor | `cosmos-vector-guided.lab.js` |
| 3 Troubleshooting: Conversation History incidents | `cosmos-troubleshooting.lab.js` |
| 4 Independent: Cosmos feedback feature | `cosmos-independent.lab.js` |

Shared engine: `src/lib/data/` (query evaluator, RU cost model, SDK catalog, Python recognizer, runtime, change feed), `src/lib/kubernetes/data-actions.js`, `src/data/templates/data-python/cosmos.js`, `src/data/fixtures/data/knowledge.js`.

## Testing rules (from the learner — must be followed)

- Do not run the existing test suite (`npm test` / `vitest run` without a path).
- Keep tests light. The only Data journey tests are:
  `npx vitest run tests/data-cosmos-query.test.js tests/data-cosmos-cost.test.js tests/data-python-sdk.test.js tests/data-cosmos-labs.test.js` (19 tests, all passing).
- A Lab is verified by `npm run build`, its solution-replay test, and one manual walk-through. **The manual walk-through of Labs 1–4 in the browser hasn't been done yet.**

## How to continue

1. Walk through Labs 1–4 once in `npm run dev`.
2. Decide whether to merge `data-journey` into `main`.
3. Next batch: the Labs 5–9 (PostgreSQL) plan is written: `docs/superpowers/plans/2026-10-01-data-labs-05-09.md` (12 tasks: corpus, flexible server model + az + Blade, SQL parser, engine + psql, planner/pool model, psycopg SDK, template + pipeline, Labs 5–9). Execute it with superpowers:subagent-driven-development on Sonnet subagents.

## Design rules learned (carry into Labs 5–13)

- **Guided Labs:** `stages` and `tasks` are in one order, and that order can be completed top to bottom.
- **Dependencies are narrow:** each verification Task lists only the fields it depends on (`images:<deployment>`, `code:<deployment>:<function>`, `deployedConsistency:<deployment>`, `indexing:<container>`, …). Fixing one thing must never stale another Task's evidence.
- **Solutions stand alone:** every Solution is a complete worked answer (edit, build with a distinct tag, edit yaml, `kubectl apply`, run the scenario). Replaying all Solutions in order completes the Lab.
- **Grade the learner's own work:** Tasks grade the learner's own deployed code. Seeds deploy starter or faulty edit zones, never solved ones. `raise NotImplementedError` fails at call time, so partial builds are allowed.
- **Checks read app results:** checks use rows and charges the app returned, never post-filtering inside the check.
- **No import cycles:** `cosmos-helpers.js` imports no Lab module, and a seed file imports at most one sibling Lab module.
- **Light tests:** one solution-replay `it` per Lab, plus a quick throwaway sabotage check that the Task fails without the learner's fix.

## Rulings made on the learner's behalf (review these)

The full list is in the ledger. The ones that matter most:

1. **No full suite:** never run the full suite. It overrides the superpowers template. Cost if wrong: an existing-test regression goes unnoticed until you run it.
2. **Vector indexing:** a vector `ORDER BY` counts as indexed when a vector index exists, even with `/embedding/*` excluded.
3. **Change feed:** it reaches the runtime through an injectable hook. `read_lease` returns None on 404, labelled simulator-only, with the real try/except shown in a comment.
4. **Worker Deployments:** `src/lib/kubernetes/schema.js` accepts a container `command` field only for `dataCosmos` Labs. `src/lib/project/build.js` skips `PORT_MISMATCH` only for data apps. Both are gated, and other Labs are unchanged.
5. **Lab 1 order:** Lab 1 runs indexing before verification, so it no longer shows the composite-index error first. Lab 3 teaches that error as an incident.
6. **Weak-consistency reads:** under Eventual/ConsistentPrefix, reading an item created in the same request returns 404 ("not yet replicated"). Reading an updated item returns the previous version. Both are teaching approximations.
7. **Lab 4 feedback read:** Lab 4 adds a `question_feedback` edit zone and route. The query grammar now allows `VectorDistance(...) >= x` in WHERE.
8. **Lab 4 scale:** `logicalScale` is 2, not 50, because the 3 RU budget can't be reached at 50 with the cost model. Cross-partition fan-out still costs about 7.5 RU more.
9. **`delete_item`:** unsupported at runtime, because no Lab uses it.
10. **Change log growth:** the unbounded `changeLog` growth is deferred.

## Log

- 2026-10-01 — Labs 5–9 (PostgreSQL) plan written; branch merged into main.

- 2026-10-01 00:14–02:12 — design docs, plan, Tasks 1–7 (engine) implemented, reviewed and pushed; stopped at the 2:30 deadline rule.
- 2026-10-01 08:54–11:02 — Tasks 8–11 (Labs 1–4): each implemented, reviewed and fixed (one fix round each for Labs 1, 3 and 4), then pushed.
- 2026-10-01 — final whole-branch review on Opus found 5 Important and 6 Minor issues. One fix wave addressed all 11, and the re-review was clean.
