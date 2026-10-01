# Task 12 / Lab 9 implementation report

Status: Lab9 — DONE. Base: `4ecebaf`. Workspace: `E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-postgres`.

## Implementation

- Registered the independent PostgreSQL Lab with exactly three tasks: `v3-retrieval`, `audience-indexed`, `scale-stable`. Brief states outcomes; solutions supply one complete HNSW + JSONB GIN + module-pool/PgBouncer design.
- Added four fictional `contoso-support` v3 documents, English/German × admin/user, and eight 8-dimensional chunks. Base document/chunk IDs and fixture values are preserved. Combined logical counts remain 20,000 documents / 250,000 chunks. Expected chunk IDs are `[33,34]`, `[35,36]`, `[37,38]`, `[39,40]`; metadata lookup IDs are `17`, `18`, `19`, `20`.
- Derivative immutable manifest protects `load-v3.sql`, the paired audience-capable HTTP scaffold, exact baseline, and combined training fixtures. The base PostgreSQL manifest and Cosmos fixtures are unchanged. `psql` recognizes only the derivative manifest + exact registered v3 file path/marker, then uses the existing validated, atomic `loadCorpus` injection API; no generic SQL marker matching was added.
- Captured PostgreSQL appSpec records the derivative fixture selector. Embedding and grounded-answer helpers select the appropriate authored fixture from that deployed artifact; fixtures do not populate database rows. The real Python training scaffold embeds the same mapping and server forwards the fifth audience argument.
- Independent seed reproduces optimized base RAG, HNSW, metadata indexes, module pool, enabled PgBouncer port 6432 and six replicas. It builds caller-owned unfinished audience edit zones, loads only the base corpus, and creates no verification evidence.
- Grading correlates each returned value with its own actual SQL SELECT trace/step, IDs, metadata, plan recall and summed simulated request latency. Retrieval accepts any supported index/tuning design meeting recall ≥0.95 / latency ≤20ms. Metadata accepts an applicable audience B-tree (column or JSON extraction expression) or metadata GIN, with unrestricted index names. Load requires actual SQL-grounded v3 rows, six replicas, served 30,000 requests over 30 seconds, throughput ≥1000rps and zero failures, consistent actual module-pool and DSN mode.
- Solutions build/apply a YAML declaration of two replicas, explicitly scale to six, and refresh earlier proofs after later shared deployments. Earliest seed artifact cannot satisfy code grading.
- Authorized extra helper scope: current-function comparison resolves the caller's project manifest; `pg:rows:<table>` dependencies capture the bounded visible dataset so corpus replacement stales existing proofs. Source hash, deployed functions/DSN, index definitions and relevant server/connection/load settings are also captured. No controller ledger or handoff changes are owned here.

## TDD evidence

The single new replay catches missing registration, an already loaded seed, ignored audience, ungrounded returned rows, threshold failures, unsupported metadata plans, incorrect six-replica throughput, and stale proofs after index/data replacement. Exactly one new `it` was added.

RED command: `npm.cmd test -- tests/data-postgres-labs.test.js` (exit 1, wall 7.175s).

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-postgres-labs.test.js
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-postgres
❯ tests/data-postgres-labs.test.js (5 tests | 1 failed) 4459ms
× PostgreSQL data Labs > Lab 9 independently onboards v3 audiences with SQL-grounded retrieval, indexed metadata and six-replica load 5ms
  → expected undefined to be defined
FAIL tests/data-postgres-labs.test.js > PostgreSQL data Labs > Lab 9 independently onboards v3 audiences with SQL-grounded retrieval, indexed metadata and six-replica load
AssertionError: expected undefined to be defined
❯ tests/data-postgres-labs.test.js:13:17
  12| const lab = labById('data-postgres-independent')
  13| expect(lab).toBeDefined()
Test Files 1 failed (1)
Tests 1 failed | 4 passed (5)
Start at 19:05:29
Duration 6.34s (transform 791ms, setup 0ms, collect 1.56s, tests 4.46s, environment 0ms, prepare 62ms)
```

Expected failure: the independent Lab was not yet registered, before any production implementation.

Intermediate run (same command, exit 1, wall 8.453s): Lab replay completed but the stale assertion reported `expected true to be false` at line 37. Root cause investigation found that the test attempted ARM `hnsw.ef_search`, which is not a supported Flexible Server parameter; the command was rejected and state did not change. Corrected the test to a supported `DROP INDEX` operation and asserted command acceptance. The production dependency mechanism needed no fix. Subsequent runs passed 5/5 at 8.503s and 8.532s wall.

Final GREEN command: `npm.cmd test -- tests/data-postgres-labs.test.js` (exit 0, wall 8.562s).

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-postgres-labs.test.js
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-postgres
✓ tests/data-postgres-labs.test.js (5 tests) 5824ms
  ✓ PostgreSQL data Labs > Lab 9 independently onboards v3 audiences with SQL-grounded retrieval, indexed metadata and six-replica load 1616ms
  ✓ PostgreSQL data Labs > Lab 6 starts without HNSW proofs and completes sizing, ANN filtering and grounded answers through ordered Solutions 442ms
  ✓ PostgreSQL data Labs > Lab 7 observes naive exhaustion then completes deployed pooling and port 6432 load through ordered Solutions 1314ms
  ✓ PostgreSQL data Labs > Lab 8 starts with five unsatisfied incidents and repairs each through ordered standalone Solutions 2320ms
Test Files 1 passed (1)
Tests 5 passed (5)
Start at 19:14:03
Duration 7.76s (transform 842ms, setup 0ms, collect 1.64s, tests 5.82s, environment 0ms, prepare 83ms)
```

The Lab 5 test also passed (below Vitest's slow-test display threshold). Test output contained no warnings.

## Additional verification

One inline Node scoped probe (exit 0, wall 1.598s) replayed the independent Lab, selected the Service's deployed artifact, then invoked its bounded `answer` interpreter for each of the four v3 questions. It asserted HTTP 200, literal fixture answer, actual expected source IDs and two request-local training trace entries per answer. No Python execution, network, Azure, browser or extra test suite was used.

```text
v3 derivative answer probe: four source-grounded answers passed; base Lab 6 behavior remains covered by scoped replay.
```

The probe command was a PowerShell literal here-string piped to `node --input-type=module`, importing the Lab, `replaySolution`, `pgDeployedArtifact`, `runDataFunction` and `SUPPORT_V3_QUESTIONS`; all four outputs were asserted, never fabricated.

Final build command: `npm.cmd run build` (exit 0, wall 4.709s; prior successful build 4.684s).

```text
> azure-trainer@0.1.0 build
> vite build
vite v6.4.3 building for production...
transforming...
✓ 535 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                       0.88 kB │ gzip:   0.46 kB
dist/assets/LabPage-BgxcCD0X.css      9.67 kB │ gzip:   1.84 kB
dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip:   8.25 kB
dist/assets/vendor-gT9JDirl.js       98.85 kB │ gzip:  38.43 kB
dist/assets/LabPage-CADD_Qu9.js     298.24 kB │ gzip:  76.58 kB
dist/assets/index-gDTaBj_d.js     2,308.14 kB │ gzip: 622.68 kB
(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 4.05s
```

Scoped `git diff --check -- <owned tracked source/test paths>` exited 0; Git emitted only its LF→CRLF normalization notices. Aggregate measured verification command wall time: **52.216s** (all RED/intermediate/GREEN runs, two builds and tiny probe), well below the 30-minute testing limit.

## Owned files

- `src/data/fixtures/data/corpus-v3.js`
- `src/data/templates/data-python/postgres-independent.js`
- `src/data/labs/data-journey/postgres-independent.lab.js`
- `src/data/labs/data-journey/postgres-seeds.js`
- `src/data/labs/data-journey/postgres-helpers.js`
- `src/data/labs/index.js`
- `src/lib/project/manifests.js`
- `src/lib/data/python-sdk.js`
- `src/lib/data/runtime.js`
- `src/lib/data/psql.js`
- `tests/data-postgres-labs.test.js`
- `docs/superpowers/data-postgres-task-12-report.md`

## Self-review and concerns

Read the full owned diff and new source files after successful replay. Checked routing/signature consistency, immutable artifact fixture selection, distinct scenario steps, supported-index outcome checks, actual-used pool traces, seed rejection, dependency invalidation and ordered/standalone solution refresh. Removed a redundant size-one exception from the PgBouncer consistency check, then re-ran scoped tests and build. Base fixtures/templates and protected exact baseline were retained; helper/seed modules import no Lab module. Commit uses configured actual author, without false Claude attribution.

No known correctness concern remains. The normal Vite large-chunk advisory is retained. Alternate B-tree audience strategy is supported by the grader and existing SQL AST/planner, but this task's one planned replay exercises the GIN design; no extra permanent test was added under the binding light-testing policy.
