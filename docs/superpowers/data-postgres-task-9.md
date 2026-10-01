### Task 9: Lab 6 — Guided: pgvector indexing, sizing, filtered RAG

**Files:** `postgres-vector-guided.lab.js`; extend `postgres-seeds.js`; one `it`.

**Seed:** the Lab 5 end state, on a **Burstable `Standard_B1ms`** server with default `maintenance_work_mem`. The app is deployed with `retrieve_passages`/`build_context` as starters.

| Stage | Task | Condition | Exam Note |
|---|---|---|---|
| exact | `exact-knn` ✓ | Scenario `retrieve-unfiltered` returns the expected top chunks via a Seq Scan plan (no vector index yet). Its recorded latency is the baseline | Exact kNN scans every row: perfect recall, cost grows with table size. |
| size | `scale-up` | Server tier `GeneralPurpose` (or `MemoryOptimized`) with ≥ 2 vCores | Burstable tiers suit dev/test; vector index builds and searches need sustained CPU and memory. |
| size | `build-memory` | `maintenance_work_mem` large enough for the HNSW build (per the model) | HNSW builds are fastest when the graph fits in `maintenance_work_mem`. |
| index | `hnsw` | An HNSW index on `chunks.embedding` with `vector_cosine_ops` exists | The opclass must match the query operator: `<=>` cosine, `<->` L2, `<#>` inner product. |
| index | `tuned` ✓ | Scenario `retrieve-unfiltered` with the app setting `SET hnsw.ef_search = <n>` (learner sets it in code) has recall ≥ 0.98 and latency below 25% of the exact baseline | Higher `ef_search` raises recall and latency; it must be ≥ LIMIT. |
| rag | `filtered` ✓ | Scenario `retrieve-wrong-product-question` returns the filtered expected chunks (none from another product) with LIMIT rows, using iterative scan (`SET hnsw.iterative_scan = relaxed_order`) or a partial index | Filters after an ANN scan can return too few rows; iterative scans or partial indexes fix that. |
| rag | `answer` ✓ | Scenario `answer-known` returns the fixture answer with source ids; `answer-unknown` returns the declared no-match outcome | RAG = retrieve relevant passages, then build the prompt context from them. |

The Lab text also introduces IVFFlat (`lists`, `ivfflat.probes`) and `halfvec` in Exam Notes and Hints. They aren't required Tasks; Lab 9 lets learners choose them.

- [ ] **Step 1:** Replay test (one `it`; assert that `hnsw`-dependent Tasks aren't done on a fresh run). FAIL → implement → PASS → `npm run build`.
- [ ] **Step 2:** Sabotage check: `vector_l2_ops` makes `tuned` fail. Commit `feat(data): add Lab 6 pgvector indexing and filtered RAG guided`.

---


## Global Constraints

- **TESTING RULE (from the learner, binding):** never run the existing test suite. Do not run `npm test`, `npx vitest run` without a file path, or any browser tests. Run only the test files this plan names, by explicit path.
- **LIGHT TESTING (binding):** write only the tests listed here. Review fixes add a regression test only for bugs in `src/lib/data/*` core logic.
- Every task ends with `npm run build` succeeding.
- No code execution, no network, no real Azure (ADR-0001/0002). Unsupported Python or SQL returns code `DATA_UNSUPPORTED` with a message starting `Not supported by the simulator:`.
- Journey `data-knowledge-assistant`; Labs `engineVersion: 2`, `contentVersion: 1`, `skillAreaId: 'data'`, `service: 'postgresql'`, `journeyOrder` 5–9; capability `dataPostgres: true` (plus `acrBuild`, `kubernetes`).
- Server `pg-assistant` in `rg-assistant`, database `knowledge`, admin user `assistant_admin`, fictional training-only password `Training-Only-Pa55!`. FQDN `pg-assistant.postgres.database.azure.com`. Direct port 5432; built-in PgBouncer port 6432.
- Authored vectors are **8 dimensions** (`vector(8)`); the `embeddings-v2` fixture returns 12.
- Declared logical sizes: `documents` 20,000 rows, `chunks` 250,000 rows. Small visible samples hold the real values.
- All numbers are labelled `Simulated estimate — not an Azure guarantee.`
- `psql` is one-shot per Cloud Shell line (the shell has no session mode): `psql "host=<fqdn> port=5432 dbname=knowledge user=assistant_admin" -c "<SQL>"` or `... -f <project file>`. Connection flags `-h`, `-p`, `-d`, `-U` are also accepted.
- `kubectl set image` is not implemented; deploy = edit image in `k8s/deployment.yaml` → `kubectl apply`.
- **Design rules from Labs 1–4 (binding):**
  - **Guided order:** in Guided Labs, `stages` and `tasks` are in one order that can be completed top to bottom.
  - **Narrow dependencies:** every verification Task lists only the dependency fields it depends on.
  - **Standalone Solutions:** every Task Solution is complete and standalone; replaying all Solutions in order completes the Lab.
  - **Grade the learner's work:** seeds deploy starter or faulty edit zones, never solved ones, and code-graded Tasks require a learner-built image.
  - **Checks read app results:** checks read the rows, latency and plans the app or `psql` produced, never post-filtering inside the check.
  - **No import cycles:** helper modules import no Lab module, and a seed file imports at most one sibling Lab module.
- Don't change Labs 1–4 behavior or the AKS / Container Apps journeys. New branches are gated on `dataPostgres` / `manifest.dataApp`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.


Runtime instruction: no subagents; no false attribution in commits; task-specific report and verification elapsed time required. Read data-postgres-progress.md for controller rulings.
