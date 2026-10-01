### Task 4: SQL engine + `psql`

**Files:** Create `src/lib/data/pg-engine.js`, `src/lib/data/psql.js`. Modify `src/lib/az/shell.js` (and `src/stores/labRun.js` only if needed to pass `context`). Add 3 `it`s to `tests/data-pg-sql.test.js` (engine-level, through `executePg`).

**Produces:**
```js
export function executePg(sandbox, { server, resourceGroup, database, sql, params, session /* { settings } */, nowMs, port })
// → { sandbox, results: [{ kind, rows?, rowCount?, plan?, notice?, error? }], session }
export function runPsql(sandbox, tokens, context) // shell entry; prints results as psql-style tables, "CREATE TABLE", "CREATE INDEX", "SET", EXPLAIN text
```
Rules:
- **Connection.** `host` must be the server FQDN; `dbname` must exist; port 5432, or 6432 only when `pgbouncer.enabled` is `true`.
  - Unknown host: `psql: error: could not translate host name "<host>" to address`.
  - Missing database: `FATAL: database "<db>" does not exist`.
  - Port 6432 with PgBouncer disabled: `connection refused`.
- **Extensions.** `CREATE EXTENSION vector` without `vector` in `azure.extensions` gives `ERROR: extension "vector" is not allow-listed for "azure_pg_admin" users in Azure Database for PostgreSQL` plus `HINT: to learn how to allow an extension or see the list of allowed extensions, please refer to https://go.microsoft.com/fwlink/?linkid=2301063` (Review Focus #2). Without the extension, a `vector(n)` column gives `ERROR: type "vector" does not exist`.
- **Tables.** Tables persist on the database. `INSERT` appends sample rows.
  - Seeds use a hidden helper `loadCorpus(sandbox, ref)` that fills `documents` and `chunks` from `CORPUS` and sets `logicalRows`.
  - Dimension mismatch on insert or query: `ERROR: expected 8 dimensions, not 12`.
- **Indexes.** `CREATE INDEX` delegates build feasibility and timing to `pg-plan.js` `buildIndex(...)`; a failure gives that function's error text.
- **SELECT.** Results come from the sample rows: exact or ANN ranking per `pg-plan.js` `planSelect(...)`, then filters, ordering and limit. `EXPLAIN` prints the plan; `ANALYZE` adds actual time (from the model) and rows.
- **SET** is session-only within one `psql` line or one app request (one-shot). `ALTER DATABASE … SET` is unsupported. Persistent settings go through `az … parameter set`.
- **`psql -f <path>`** reads the saved project file (`run.project.savedFiles[path]`).
- **Shell gating.** `psql` exists only when the Lab has `dataPostgres`; otherwise the output stays `bash: psql: command not found`.

- [ ] **Step 1: Add 3 failing tests** to `tests/data-pg-sql.test.js`:
  - `CREATE EXTENSION vector` fails before allow-listing and succeeds after `setPostgresParameter(... 'azure.extensions', 'VECTOR')`;
  - a `vector(8)` table + 3 inserted rows + `SELECT … ORDER BY embedding <=> %s LIMIT 2` returns the 2 nearest ids;
  - `-f` style multi-statement SQL executes in order.

  Build the Sandbox with `createSandbox()` + `createPostgresServer` + `createPostgresDatabase`.
- [ ] **Step 2:** Run `npx vitest run tests/data-pg-sql.test.js` (expect the 3 new ones to fail), implement, then re-run (8 passed).
- [ ] **Step 3:** Wire `psql` into `shell.js`.
- [ ] **Step 4:** `npm run build`, then commit `feat(data): add PostgreSQL SQL engine and psql`.

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
