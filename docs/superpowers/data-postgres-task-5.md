### Task 5: Planner, cost, recall, build and pool model

**Files:** Create `src/lib/data/pg-plan.js`, `src/lib/data/pg-pool.js`, `tests/data-pg-plan.test.js`.

**Produces (all deterministic):**
```js
export function planSelect(db, stmt, settings, server) // → { node: 'Seq Scan'|'Index Scan'|'Bitmap Heap Scan'|'Index Scan using <hnsw>'|'Index Scan using <ivfflat>', index?, estimatedRows, latencyMs, recall /* 0..1, 1 for exact */, rowsReturnedBeforeLimit, text /* EXPLAIN-style lines */ }
export function buildIndex(db, stmt, server) // → { ok: true, buildSeconds, sizeMb } | { ok: false, error }
export function simulatePoolLoad({ replicas, requestsPerSecond, seconds, mode: 'per-request'|'pool'|'pgbouncer', poolMaxSize, server }) // → { served, failed, p95Ms, throughputRps, peakServerConnections, errors: string[] }
```
Model rules (teaching approximations; document them in a comment block at the top of the file):
- **Seq Scan** cost scales with logical rows: `latencyMs = 0.004 * logicalRows` for heap scans, `0.02 * logicalRows` when ordering by vector distance (exact kNN).
- **B-tree.** A B-tree on the equality columns, with a usable leftmost prefix, gives an Index Scan: `latencyMs = 0.8 + 0.01 * matches`.
- **GIN.** `@>` on jsonb with a GIN index (`jsonb_ops` or `jsonb_path_ops`) gives a Bitmap Heap Scan at `1.5 + 0.02 * matches`. Without GIN, it's a Seq Scan.
- **HNSW** is used only when the ORDER BY operator matches the opclass (`<=>`↔`*_cosine_ops`, `<->`↔`*_l2_ops`, `<#>`↔`*_ip_ops`) **and** there's a LIMIT. Otherwise the plan is a Seq Scan (Review Focus #3).
  - `latencyMs = 2 + 0.05 * ef_search`.
  - `recall = min(1, 0.80 + 0.004 * ef_search)` (default `ef_search` 40 → 0.96).
  - `ef_search` must be ≥ LIMIT for full results.
- **IVFFlat:** `latencyMs = 1.5 + 0.6 * probes * (logicalRows / lists) / 1000`; `recall = min(1, 0.70 + 0.6 * probes / lists)`.
- **Filtered ANN.** A WHERE filter under an ANN index is post-filtered. Rows returned = `min(LIMIT, round(ef_search_or_candidates * selectivity))`, where selectivity = the matching sample fraction. When `hnsw.iterative_scan` is `relaxed_order` or `strict_order`, keep scanning until LIMIT rows are found (latency × 1.5). A partial index whose WHERE matches the filter gives full rows.
- **HNSW build.** Required memory = `logicalRows * dims * 4 * 1.6 / 1024` kB (vector) or half for `halfvec`.
  - If `maintenance_work_mem` (kB) is below required, the build takes `buildSeconds = 600 * required / mem`.
  - It fails when `buildSeconds > 1800` with `ERROR: could not build HNSW index within the simulated time budget; increase maintenance_work_mem or compute (NOTICE: hnsw graph no longer fits into maintenance_work_mem)`.
  - Otherwise `buildSeconds = 0.0008 * logicalRows / vCores`.
  - `maintenance_work_mem` above 25% of server memory gives `ERROR: invalid value for parameter "maintenance_work_mem"` (enforced in `setPostgresParameter`, so it lives in Task 2's model; Task 5 only reads it).
  - IVFFlat build is cheaper: `0.0003 * logicalRows / vCores`, and needs no memory check.
- **Index size.** `sizeMb = logicalRows * dims * (4 | 2 for halfvec) * 1.3 / 1e6`.
- **Pool model.**
  - Per request: each request opens a new connection; setup is 25 ms (TLS + auth); connections close after.
  - Pool: `replicas * poolMaxSize` persistent connections, 1 ms checkout.
  - PgBouncer (port 6432): server connections are capped at `pgbouncer.default_pool_size`; client connections are unlimited up to 5000.
  - Server limit = `max_connections - 3` (reserved for superuser and Azure). Excess connection attempts fail with `FATAL: sorry, too many clients already` (Review Focus #4).
  - Query time per request: 4 ms.
  - Throughput and p95 come from a simple queueing approximation: concurrency = min(connections available, demand); `p95 = setup + query * (1 + queueFactor)`. Document the formula.

- [ ] **Step 1: Write the failing tests** (these four only):
```js
import { describe, expect, it } from 'vitest'
import { planSelect, buildIndex, simulatePoolLoad } from '../src/lib/data/pg-plan.js'
// (simulatePoolLoad lives in pg-pool.js and is re-exported from pg-plan.js for this test)
const server = { tier: 'GeneralPurpose', vCores: 2, memoryGiB: 8, parameters: { maintenance_work_mem: '65536', max_connections: '859', 'pgbouncer.default_pool_size': '50' } }
const db = (indexes = []) => ({ tables: [{ name: 'chunks', logicalRows: 250000, columns: [{ name: 'embedding', type: 'vector', dimensions: 8 }, { name: 'product', type: 'text' }], rows: [{ product: 'a' }, { product: 'b' }, { product: 'b' }, { product: 'b' }] }], indexes })
const knn = (op = '<=>') => ({ kind: 'select', table: 'chunks', where: [], orderBy: [{ column: 'embedding', operator: op }], limit: 3 })
const hnsw = (opclass) => ({ name: 'h', table: 'chunks', method: 'hnsw', columns: [{ name: 'embedding', opclass }], with: {} })

describe('pg plan model', () => {
  it('uses HNSW only when the operator matches the opclass', () => {
    expect(planSelect(db([hnsw('vector_cosine_ops')]), knn('<=>'), {}, server).node).toMatch(/hnsw|Index Scan using h/)
    expect(planSelect(db([hnsw('vector_l2_ops')]), knn('<=>'), {}, server).node).toBe('Seq Scan')
  })
  it('trades recall for latency with hnsw.ef_search', () => {
    const low = planSelect(db([hnsw('vector_cosine_ops')]), knn(), { 'hnsw.ef_search': 10 }, server)
    const high = planSelect(db([hnsw('vector_cosine_ops')]), knn(), { 'hnsw.ef_search': 100 }, server)
    expect(high.recall).toBeGreaterThan(low.recall)
    expect(high.latencyMs).toBeGreaterThan(low.latencyMs)
  })
  it('fails an HNSW build when maintenance_work_mem is far too small', () => {
    const tiny = { ...server, parameters: { ...server.parameters, maintenance_work_mem: '1024' } }
    expect(buildIndex(db(), { ...hnsw('vector_cosine_ops') }, tiny).ok).toBe(false)
    expect(buildIndex(db(), { ...hnsw('vector_cosine_ops') }, { ...server, parameters: { ...server.parameters, maintenance_work_mem: '2097152' } }).ok).toBe(true)
  })
  it('exhausts max_connections without a pool and not with PgBouncer', () => {
    const s = { ...server, parameters: { ...server.parameters, max_connections: '50' } }
    const naive = simulatePoolLoad({ replicas: 6, requestsPerSecond: 600, seconds: 10, mode: 'per-request', poolMaxSize: 0, server: s })
    const bouncer = simulatePoolLoad({ replicas: 6, requestsPerSecond: 600, seconds: 10, mode: 'pgbouncer', poolMaxSize: 20, server: { ...s, parameters: { ...s.parameters, 'pgbouncer.enabled': 'true', 'pgbouncer.default_pool_size': '40' } } })
    expect(naive.errors.join(' ')).toMatch('too many clients already')
    expect(bouncer.failed).toBe(0)
    expect(bouncer.p95Ms).toBeLessThan(naive.p95Ms)
  })
})
```
- [ ] **Step 2:** Run `npx vitest run tests/data-pg-plan.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement, and wire `planSelect` and `buildIndex` into `pg-engine.js`.
- [ ] **Step 4:** Run again (4 passed), then `npx vitest run tests/data-pg-sql.test.js` (still 8 passed). Then `npm run build`.
- [ ] **Step 5:** Commit `feat(data): add PostgreSQL planner, recall, build and pool model`.

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
