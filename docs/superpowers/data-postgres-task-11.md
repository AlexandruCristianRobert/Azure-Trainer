### Task 11: Lab 8 — Troubleshooting

**Files:** `postgres-troubleshooting.lab.js`; extend seeds; one `it` (with fresh-run "all not done").

**Seed:** the Lab 7 end state, with five baked-in faults (state the symptoms only, not the causes):
1. `retrieve_passages` builds SQL with an f-string → a question containing `'` fails (`question-with-quote` scenario returns a syntax error).
2. The HNSW index uses `vector_l2_ops` while the query uses `<=>` → Seq Scan, latency regression (`retrieve-latency` over budget).
3. The server was scaled down to Burstable B1ms with low `maintenance_work_mem` and the index was dropped → `CREATE INDEX` fails or is too slow (the `index-rebuilt` outcome needs a working HNSW index).
4. Filtered retrieval under HNSW without iterative scan → `retrieve-filtered` returns fewer than LIMIT rows.
5. `clients.py` reverted to per-request connections and replicas scaled to 6 → `load-600rps` exhausts connections.

Outcome Tasks (all ✓, each with narrow fields and a standalone Solution): `quote-safe`, `latency-restored`, `index-rebuilt`, `filtered-complete`, `load-stable`.

- [ ] **Step 1:** Test (fresh run: all 5 not done; replay: all done). FAIL → implement → PASS → `npm run build`.
- [ ] **Step 2:** Commit `feat(data): add Lab 8 PostgreSQL troubleshooting`.

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
