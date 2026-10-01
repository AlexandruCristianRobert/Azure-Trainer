### Task 2: Flexible server model, `az` commands, Blade

**Files:** Create `src/lib/sandbox/postgres.js`, `src/lib/az/commands/postgres.js`, `src/lib/az/postgres-arm.js`, `src/components/blade/PostgresServerBlade.vue`. Modify `src/lib/sandbox/model.js`, `src/lib/az/run.js`, `BladeHost.vue`, and the resource group Blade.

**Model:**
```js
// sandbox.postgresServers[] item:
// { name, resourceGroup, location, version: '16', tier: 'Burstable'|'GeneralPurpose'|'MemoryOptimized', skuName,
//   vCores, memoryGiB, storageSizeGb, adminUser, createdAt,
//   parameters: { 'azure.extensions': '', 'maintenance_work_mem': '65536' /* kB */, 'max_connections': '50', 'pgbouncer.enabled': 'false', 'pgbouncer.default_pool_size': '50', 'shared_buffers': ... },
//   databases: [{ name, extensions: [], tables: [], indexes: [], settings: {} }] }
// SKU table (teaching approximations, from Azure docs naming):
// Burstable: Standard_B1ms (1 vCore, 2 GiB, max_connections 50), Standard_B2s (2, 4, 429)
// GeneralPurpose: Standard_D2ds_v5 (2, 8, 859), Standard_D4ds_v5 (4, 16, 1718)
// MemoryOptimized: Standard_E2ds_v5 (2, 16, 1718), Standard_E4ds_v5 (4, 32, 3437)
export function createPostgresServer(sandbox, opts) / updatePostgresServer(sandbox, opts) / setPostgresParameter(sandbox, { server, resourceGroup, name, value }) / createPostgresDatabase(sandbox, ...) / getPostgresServer(sandbox, name, resourceGroup) / getPostgresDatabase(server, name)
```
- [ ] **Step 1:** Implement the model.
  - `max_connections` defaults by SKU from the table above.
  - Changing the SKU resets `max_connections` to the new default unless it was explicitly set.
  - The `pgbouncer.enabled` value `true` requires tier `GeneralPurpose` or `MemoryOptimized`, else error `BadRequest: PgBouncer is not supported on the Burstable tier.`
  - `azure.extensions` is a comma list, case-insensitive.
- [ ] **Step 2:** Add commands, following `src/lib/az/commands/cosmosdb.js` style:
  - `az postgres flexible-server create --name --resource-group --location --tier --sku-name --storage-size --version --admin-user --admin-password --public-access` (only `None` or an IP range; just recorded)
  - `update --name --resource-group [--tier --sku-name --storage-size]`; storage can only grow, otherwise `BadRequest: Storage size can only be increased.`
  - `show`, `list`, `delete`
  - `parameter set --resource-group --server-name --name --value`, `parameter show`
  - `db create --resource-group --server-name --database-name`, `db list`
  - Register the group in `buildTree()`.
- [ ] **Step 3:** `model.js`: add the `postgresServers` array, a `validPostgresServer` predicate, an optional `isSandboxShape` clause and the `normalizeSandbox` backfill, so older saved runs load.
- [ ] **Step 4:** Blade (read-only, like the Cosmos Blades): overview (FQDN, version, tier/SKU, vCores/memory, storage), Server parameters table (the keys above), Databases table (tables with logical row counts, indexes with type/opclass/size estimate). Open it from the resource group Blade.
- [ ] **Step 5:** `npm run build`, then commit `feat(data): add PostgreSQL flexible server model, az commands and Blade`.

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
