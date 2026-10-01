### Task 10: Lab 7 — Guided: connection optimization

**Files:** `postgres-pooling-guided.lab.js`; extend seeds; one `it`.

**Seed:** the Lab 6 end state on `Standard_D2ds_v5` with `max_connections` explicitly 50. `clients.py` is the starter: a `connect()` helper that opens a new connection per call (`psycopg.connect(DSN)` inside `retrieve_passages`). assistant-api runs 2 replicas.

| Stage | Task | Condition | Exam Note |
|---|---|---|---|
| baseline | `naive-load` ✓ | Scenario `load-600rps` (2 replicas) records new-connection mode, p95 dominated by setup | Opening a connection costs a TLS handshake and authentication on every request. |
| baseline | `exhaust` ✓ | After `kubectl scale deployment assistant-api --replicas 6`, `load-600rps` records `too many clients already` errors | Each connection is a server process; `max_connections` caps them (some slots are reserved). |
| pool | `app-pool` | Deployed code uses a module-level `ConnectionPool(DSN, max_size=k)` with `with pool.connection() as conn:` and 6 × k ≤ 47 | Size the pool per replica: replicas × max_size must fit under `max_connections`. |
| pool | `pooled-load` ✓ | `load-600rps` at 6 replicas: 0 failed, p95 ≤ 40% of the naive baseline | A client-side pool reuses connections across requests. |
| bouncer | `pgbouncer` | `pgbouncer.enabled = true` | Azure's built-in PgBouncer runs on port 6432; it isn't available on Burstable. |
| bouncer | `bouncer-load` ✓ | Deployed DSN uses `port=6432`; `load-1200rps` at 6 replicas has 0 failed, and peak server connections ≤ `pgbouncer.default_pool_size` | PgBouncer multiplexes many client connections onto fewer server connections; use transaction pooling with no session-level state across transactions. |

- [ ] **Step 1:** Replay test (one `it`). FAIL → implement → PASS → `npm run build`.
- [ ] **Step 2:** Sabotage check: a DSN still on 5432 makes `bouncer-load` fail. Commit `feat(data): add Lab 7 PostgreSQL connection pooling guided`.

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
