### Task 3: PostgreSQL SQL subset parser

**Files:** Create `src/lib/data/pg-sql.js`, `tests/data-pg-sql.test.js`.

**Grammar (case-insensitive keywords; anything else → `DATA_UNSUPPORTED`):**
```
stmt := CREATE EXTENSION [IF NOT EXISTS] name
      | CREATE TABLE [IF NOT EXISTS] name ( coldef {, coldef} [, PRIMARY KEY (col)] )
      | CREATE INDEX [CONCURRENTLY] [IF NOT EXISTS] name ON table [USING (btree|gin|hnsw|ivfflat)] ( idxcol {, idxcol} ) [WITH ( k = v {, k = v} )] [WHERE cond]
      | DROP INDEX [IF EXISTS] name
      | SET name = value | SET name TO value          (hnsw.ef_search, ivfflat.probes, hnsw.iterative_scan, maintenance_work_mem)
      | INSERT INTO table ( cols ) VALUES ( vals ) {, ( vals )}
      | [EXPLAIN [( ANALYZE )] | EXPLAIN ANALYZE] select
select := SELECT cols FROM table [JOIN table ON a.c = b.c] [WHERE cond {AND cond}] [ORDER BY orderexpr [ASC|DESC] {, …}] [LIMIT n|param]
coldef := name type [PRIMARY KEY] [NOT NULL] [REFERENCES table (col)] [GENERATED ALWAYS AS IDENTITY] [DEFAULT now()]
type := bigint | int | integer | text | jsonb | timestamptz | boolean | vector(n) | halfvec(n)
idxcol := col [opclass] | (expr)            opclass ∈ vector_cosine_ops, vector_l2_ops, vector_ip_ops, halfvec_cosine_ops, jsonb_path_ops, jsonb_ops
cond := col (= | <> | < | <= | > | >=) val | col @> val | col->>'key' = val | col IN (val, …) | (embedding <=> val) < val
orderexpr := col | embedding (<=> | <-> | <#>) val [::vector | ::halfvec(n)]
val := literal | %s | %(name)s | $n
```
Statements are separated by `;` (a `-f` file may contain several).

**Produces:**
```js
export function parsePgSql(text) // → { statements: Stmt[] } | { error: { code: 'DATA_UNSUPPORTED'|'SyntaxError', message, line, column } }
export function bindParams(stmt, params) // psycopg rules: %s positional (list/tuple), %(name)s named (dict); mismatch → { error: { code: 'ProgrammingError', message } }
```
- [ ] **Step 1: Write the failing tests** (these five only):
```js
import { describe, expect, it } from 'vitest'
import { parsePgSql, bindParams } from '../src/lib/data/pg-sql.js'

describe('parsePgSql', () => {
  it('parses a pgvector table and an HNSW index with opclass and WITH options', () => {
    const r = parsePgSql('CREATE TABLE chunks (id bigint PRIMARY KEY, content text, embedding vector(8)); CREATE INDEX chunks_hnsw ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);')
    expect(r.statements.map(s => s.kind)).toEqual(['create-table', 'create-index'])
    expect(r.statements[0].columns[2]).toMatchObject({ name: 'embedding', type: 'vector', dimensions: 8 })
    expect(r.statements[1]).toMatchObject({ method: 'hnsw', columns: [{ name: 'embedding', opclass: 'vector_cosine_ops' }], with: { m: 16, ef_construction: 64 } })
  })
  it('parses a filtered nearest-neighbour SELECT with EXPLAIN ANALYZE', () => {
    const r = parsePgSql("EXPLAIN ANALYZE SELECT id, content FROM chunks WHERE product = %s ORDER BY embedding <=> %s::vector LIMIT 3")
    expect(r.statements[0]).toMatchObject({ kind: 'select', explain: { analyze: true }, limit: 3 })
    expect(r.statements[0].orderBy[0]).toMatchObject({ operator: '<=>' })
  })
  it('parses jsonb containment and GIN indexes', () => {
    const r = parsePgSql("CREATE INDEX docs_meta ON documents USING gin (metadata jsonb_path_ops); SELECT id FROM documents WHERE metadata @> %s")
    expect(r.statements[0]).toMatchObject({ method: 'gin', columns: [{ name: 'metadata', opclass: 'jsonb_path_ops' }] })
    expect(r.statements[1].where[0]).toMatchObject({ operator: '@>' })
  })
  it('binds psycopg parameters and rejects a count mismatch', () => {
    const [stmt] = parsePgSql('SELECT id FROM documents WHERE product = %s AND version = %s').statements
    expect(bindParams(stmt, ['contoso-backup']).error.code).toBe('ProgrammingError')
    expect(bindParams(stmt, ['contoso-backup', 'v2']).error).toBeUndefined()
  })
  it('flags unsupported SQL without pretending it is a PostgreSQL error', () => {
    const r = parsePgSql('SELECT * FROM chunks FULL OUTER JOIN documents USING (id)')
    expect(r.error.code).toBe('DATA_UNSUPPORTED')
    expect(r.error.message).toMatch(/^Not supported by the simulator:/)
  })
})
```
- [ ] **Step 2:** Run `npx vitest run tests/data-pg-sql.test.js`. Expected: FAIL.
- [ ] **Step 3:** Implement the tokenizer + recursive descent in the style of `src/lib/data/cosmos-query.js` (read it first). Target ≤ ~400 lines.
- [ ] **Step 4:** Run again. Expected: 5 passed. Then `npm run build`.
- [ ] **Step 5:** Commit `feat(data): add bounded PostgreSQL SQL parser`.

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
