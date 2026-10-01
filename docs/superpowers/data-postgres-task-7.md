### Task 7: Template, pipeline routing, load scenario, result card

**Files:** Create `src/data/templates/data-python/postgres.js`, `src/data/labs/data-journey/postgres-helpers.js`. Modify `src/lib/kubernetes/data-actions.js`, `src/lib/project/manifests.js`, `src/components/lab/AksExperimentPanel.vue`.

**Template `data-python-postgres-v1`:**
- **Files:** `app.py`, `clients.py`, `server.py` (fixed), `schema.sql`, `Dockerfile`, `k8s/deployment.yaml`, `k8s/service.yaml`.
- **`schema.sql`** is editable and used through `psql -f schema.sql`. It's part of the project but not of `buildFiles`.
- **Edit zones:** `get_document`, `search_by_metadata`, `retrieve_passages`, `build_context`, `answer`.
- **Routes:** `GET /documents/{id}`, `GET /documents?product=&version=`, `GET /retrieve?question=&product=&version=&language=`, `GET /answer?question=…` (calls `retrieve_passages` then `build_context`).
- **`clients.py`** (editable): `DSN = "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge user=assistant_admin password=Training-Only-Pa55! sslmode=require"`, plus either a module-level `pool = ConnectionPool(DSN, min_size=1, max_size=5)` or (starter in Lab 7) a `connect()` helper that opens a new connection per call.
- **`answer`** returns `{ answer, sources }` using the corpus fixture answer for the top source, or the declared no-match outcome `{ answer: "I couldn't find that in the documentation.", sources: [] }` when no rows come back.
- **Starter and solution file sets:** `POSTGRES_STARTER_FILES` / `POSTGRES_SOLUTION_FILES`. Starters raise `NotImplementedError` (runtime-unsupported, as in Labs 1–4).

**Pipeline:**
- `data-actions.js` routes to `runDataFunction` with the Postgres target when `lab.capabilities.dataPostgres`.
- New scenario kind `data-load`: `{ kind: 'data-load', route, args, replicas: 'deployment' /* use current replica count */, requestsPerSecond, seconds }`. It runs one representative request to read the app's connection mode (from the recognized code + DSN port), then calls `simulatePoolLoad`. It records `measurements = { served, failed, p95Ms, throughputRps, peakServerConnections, errors, mode }`.
- Replica count comes from the running Deployment (`kubectl scale deployment assistant-api --replicas N` already exists).

**Dependency fields** (`postgres-helpers.js` `pgDependencies(target, fields)`, same fail-closed style as `dataDependencies`):
- `images:<deployment>`, `code:<deployment>:<function>`
- `pg:table:<name>` (columns + types), `pg:index:<table>` (index definitions), `pg:param:<name>`, `pg:sku`, `dsnPort:<deployment>` (port in the deployed `clients.py`), `replicas:<deployment>`

**Result card:** status, rows (first 5, ids + metadata), latency, plan node, recall (when ANN), connection mode, load stats. Labelled `Simulated estimate — not an Azure guarantee.`

- [ ] **Step 1:** Write the template, the routing, the load scenario, the dependency helpers and the card.
- [ ] **Step 2:** Verify with a throwaway script: `parseDataApp(POSTGRES_SOLUTION_FILES)` has 0 diagnostics; starters parse with runtime-unsupported ops only.
- [ ] **Step 3:** `npm run build`, then commit in two parts: `feat(data): add PostgreSQL Knowledge Assistant template` and `feat(data): route the PostgreSQL app and load scenarios through the AKS pipeline`.

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
