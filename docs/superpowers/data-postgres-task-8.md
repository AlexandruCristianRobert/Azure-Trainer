### Task 8: Lab 5 — Guided: connect, schema, B-tree/GIN

**Files:** Create `postgres-seeds.js` (`seedPostgresConnectGuided`), `postgres-connect-guided.lab.js`. Modify `src/data/labs/index.js`. Create `tests/data-postgres-labs.test.js` (reuse `tests/helpers/dataLab.js` `replaySolution`).

**Lab:**
- `id: 'data-postgres-connect-guided'`, title `Guided: Store the document corpus in PostgreSQL`, `journeyOrder: 5`, `labMode: 'guided'`, `minutes: 60`.
- `lab.dataTarget = { kind: 'postgres', resourceGroup: 'rg-assistant', server: 'pg-assistant', database: 'knowledge' }`.

**Seed:** AKS prerequisites as in `seedCosmosSdkGuided` (cluster, ACR, namespace, credentials); no PostgreSQL resources; app not deployed. The corpus loads when the learner runs the supplied `psql -f load.sql`: `load.sql` is a fixed project file with a special `\copy`-like `-- simulator:load-corpus` directive, which `psql` maps to `loadCorpus`. Document that in the Lab text as the stand-in for a bulk `COPY`.

Stages/Tasks, in the same order (✓ = verification):

| Stage | Task | Condition | Exam Note |
|---|---|---|---|
| provision | `server` | Server `pg-assistant`, tier GeneralPurpose `Standard_D2ds_v5`, storage ≥ 32 GiB, version 16 | Flexible server is the current deployment option; tier sets vCores/memory and the default `max_connections`. |
| provision | `allow-vector` | `azure.extensions` includes `vector` | Extensions must be allow-listed with the `azure.extensions` server parameter before `CREATE EXTENSION`. |
| provision | `database` | Database `knowledge` exists | — |
| schema | `extension` | Extension `vector` created in `knowledge` | `CREATE EXTENSION vector` installs pgvector types and operators in that database. |
| schema | `tables` | `documents` (`id bigint generated always as identity` or `bigint primary key`, `product text`, `version text`, `language text`, `metadata jsonb`, `body text`, `updated_at timestamptz`) and `chunks` (`id`, `document_id` FK, `chunk_index int`, `content text`, `embedding vector(8)`), created from the learner's edited `schema.sql` | Use `jsonb` (not `json`) for queryable metadata and `vector(n)` with the model's dimension count. |
| schema | `loaded` | Corpus loaded (`psql -f load.sql`) | — |
| code | `code-queries` | Deployed-or-saved `get_document` and `search_by_metadata` use `execute(sql, params)` with placeholders (no f-strings or concatenation) | psycopg sends parameters separately from SQL text, which prevents SQL injection. |
| deploy | `deployed` | assistant-api runs a build of the current sources | — |
| indexes | `btree` ✓ | Scenario `docs-by-product` returns the expected rows, and the recorded plan is an Index Scan after the learner creates a B-tree on `(product, version)`. A Seq Scan plan doesn't pass | A multicolumn B-tree serves equality on its leading columns. |
| indexes | `gin` ✓ | Scenario `docs-by-metadata` (`metadata @> %s`) returns the expected rows using a Bitmap Heap Scan on a GIN index | GIN indexes make jsonb containment (`@>`) queries fast; `jsonb_path_ops` is smaller but supports fewer operators. |

The Lab text asks the learner to run `EXPLAIN ANALYZE` in `psql` before and after each index, so they see Seq Scan → Index Scan. Each Task has 2 Hints and a complete Solution (`az postgres flexible-server create … --tier GeneralPurpose --sku-name Standard_D2ds_v5 --storage-size 32 --version 16 --admin-user assistant_admin --admin-password Training-Only-Pa55! --public-access None`, `az postgres flexible-server parameter set --resource-group rg-assistant --server-name pg-assistant --name azure.extensions --value VECTOR`, `az postgres flexible-server db create …`, `psql "<dsn>" -c "CREATE EXTENSION vector"`, `schema.sql` content + `psql … -f schema.sql`, code, build/apply, `CREATE INDEX docs_product_version ON documents (product, version)`, `CREATE INDEX docs_metadata ON documents USING gin (metadata jsonb_path_ops)`, scenarios).

- [ ] **Step 1:** Write the Lab 5 replay test (`tests/data-postgres-labs.test.js`; one `it`; also assert that a fresh run has `btree`/`gin` not done). Run it: FAIL.
- [ ] **Step 2:** Implement the seed, `load.sql`, the Lab and its registration. Run the test (PASS), then `npm run build`.
- [ ] **Step 3:** Throwaway sabotage check: with no B-tree index, `btree` must fail. Commit `feat(data): add Lab 5 PostgreSQL connect and schema guided`.

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
