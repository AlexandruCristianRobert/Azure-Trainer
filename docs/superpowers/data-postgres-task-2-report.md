# Task 2 report — PostgreSQL flexible server

Implemented the server model, Azure CLI group, ARM presenters, migration backfill, read-only Blade, resource navigation, notification events, and resource-group deletion cascade.

## Interfaces for subsequent tasks

- `sandbox.postgresServers` contains servers with `name`, `resourceGroup`, `location`, `version`, `tier`, `skuName`, `vCores`, `memoryGiB`, `storageSizeGb`, `adminUser`, `publicAccess`, `fullyQualifiedDomainName`, `createdAt`, `parameters`, `parameterOverrides`, and `databases`.
- `parameters` values are strings. Memory parameters are kB. `azure.extensions` is a lowercase deduplicated comma list. `parameterOverrides` records explicit parameter changes so `max_connections` survives later compute updates.
- Each database starts as `{ name, extensions: [], tables: [], indexes: [], settings: {} }`. The Blade reads `table.logicalRows`, `table.rows`, `index.method`, `index.columns[].opclass`, and `index.sizeMb` from later SQL/planner work.
- `getPostgresServer(sandbox, name, resourceGroup)` permits omitted resource group for unique global-name lookup. `getPostgresDatabase(server, name)` reads a database. Both throw `AzError` for missing resources.
- `createPostgresServer`, `updatePostgresServer`, `setPostgresParameter`, `createPostgresDatabase`, and `deletePostgresServer` return immutable `{ sandbox, resource }`; database creation additionally returns the stored `server`. Database creation accepts `{ server, resourceGroup, name }` or `{ server, resourceGroup, databaseName }`.
- `POSTGRES_SKUS` is exported from `sandbox/model.js`; all six teaching SKU approximations are centralized. `validPostgresServer` is exported from that file.
- `maintenance_work_mem` cannot exceed 25% of current server memory, including when reducing compute. PgBouncer cannot be enabled on Burstable, including a downgrade with PgBouncer already enabled. Storage cannot shrink.
- Events use `postgresServer` and `postgresDatabase`; the Blade kind is `postgres-server`. `buildTree()` registers `postgres`. `runAz` already dispatches this tree generically, so `az/run.js` needs no artificial edit.

## Verification

- Inline throwaway Node smoke: PowerShell here-string piped to `node --input-type=module -`; exit 0, **0.420 seconds**. Exercised resource group creation, server creation via `runAz`, normalized extension allow list, immutable parameter update, database creation, maintenance memory ceiling, Burstable PgBouncer rejection, SKU connection default reset, explicit connection-limit preservation, storage shrink rejection, shape validation, older-save backfill, and resource-group deletion cascade.
- `npm.cmd run build`; exit 0, **14.675 seconds** wall time; Vite reported 519 modules and build time 12.50 seconds. Existing large-chunk advisory remains.
- `git -c safe.directory=E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-postgres diff --check`; no whitespace errors.
- No permanent tests added. No existing suite, browser tests, or dependency installation performed.

## Self-review and concerns

Reviewed shared sizing/default semantics, errors, immutable mutations, persistence validation, missing-resource Blade fallback, and database/index shape compatibility against Task 5. Password input is accepted but never retained. Public access is validated and recorded without any network behavior. The Blade labels all sizing/count/index estimates as simulated and provides Cloud Shell hints for mutations.

No blocking concerns. The current model intentionally supports version 16 and the six planned SKUs. The read-only Blade was compiled successfully; visual browser verification was excluded by the binding testing policy. Commit attribution follows the controller ruling instead of the inaccurate Claude footer in the brief.
