### Task 6: psycopg in the SDK catalog, recognizer and runtime

**Files:** Modify `src/lib/data/sdk-catalog.js`, `src/lib/data/python-sdk.js`, `src/lib/data/runtime.js`. Add 2 `it`s to `tests/data-python-sdk.test.js`.

Catalog additions (receiver types `pg-connection`, `pg-cursor`, `pg-pool`, `pg-module`):
```js
'postgres.module.connect': { kind: 'constructor', params: ['conninfo', 'autocommit'], required: ['conninfo'] },          // psycopg.connect(DSN)
'postgres.pool.ConnectionPool': { kind: 'constructor', params: ['conninfo', 'min_size', 'max_size', 'open'], required: ['conninfo'] },
'postgres.pool.connection': { kind: 'method', receiver: 'pg-pool', params: [], required: [] },                         // with pool.connection() as conn:
'postgres.connection.execute': { kind: 'method', receiver: 'pg-connection', params: ['query', 'params'], required: ['query'] },
'postgres.connection.cursor': { kind: 'method', receiver: 'pg-connection', params: [], required: [] },
'postgres.cursor.execute': { kind: 'method', receiver: 'pg-cursor', params: ['query', 'params'], required: ['query'] },
'postgres.cursor.fetchall': { kind: 'method', receiver: 'pg-cursor', params: [], required: [] },
'postgres.cursor.fetchone': { kind: 'method', receiver: 'pg-cursor', params: [], required: [] },
'postgres.register_vector': { kind: 'wiring', params: ['conn'] },                                                      // pgvector.psycopg.register_vector
```
- Results of `execute(...)` on a connection are a cursor (so `.fetchall()` chains).
- Rows are tuples. Learner code indexes them (`row[0]`) or uses `dict_row` (`row_factory=dict_row` on connect, then `row["id"]`); support both.

Recognizer additions:
- **`with`:** `with <call> as <name>:` blocks (pool.connection(), conn.cursor(), psycopg.connect(...)). They bind the name for the block body; the resource closes at block end. The runtime records connection open/close for the pool model.
- **f-strings:** `f"... {name} ..."` as Expr `{ kind: 'fstring', parts }`. The runtime renders them, so string-built SQL behaves like the real thing: a question containing `'` produces `SyntaxError at or near …`, which Lab 8 needs.
- **Tuples:** tuple literals `(a, b)` for params.

Runtime additions:
- `postgres.*` calls run through `executePg` against `lab.dataTarget = { kind: 'postgres', resourceGroup, server, database, port }`.
- The port comes from the DSN the learner wrote in `clients.py` (`port=6432` uses PgBouncer).
- Each request records `calls: [{ call, sql, plan, latencyMs, recall, rows, connection: 'new'|'pooled'|'bouncer' }]`.
- `latencyMs` adds 25 ms per **new** connection (per the pool model), so pooling is visible on single requests too.

- [ ] **Step 1: Add 2 failing tests:**
  - (a) parse + run a `retrieve_passages(question, product)` that does `with pool.connection() as conn:` then `rows = conn.execute(SQL, (embed(question), product)).fetchall()`, against a Sandbox with the corpus loaded; assert status 200 and the expected ids;
  - (b) an f-string SQL with a question containing `'` returns an error whose message contains `syntax error`.
- [ ] **Step 2:** Run `npx vitest run tests/data-python-sdk.test.js` (the 2 new ones fail), implement, then re-run (all pass).
- [ ] **Step 3:** `npm run build`, then commit `feat(data): add psycopg to the SDK catalog, recognizer and runtime`.

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
