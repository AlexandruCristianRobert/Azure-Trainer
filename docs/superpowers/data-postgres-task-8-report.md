# Task 8 report — Lab 5 PostgreSQL connect/schema/indexes

Implemented from `2a64a85`. Registered `postgresConnectGuidedLab` as `data-postgres-connect-guided`, journey order 5, guided, 60 minutes, engine/content versions 2/1, PostgreSQL service, and the PostgreSQL/ACR/Kubernetes capabilities. The target is `pg-assistant` / `knowledge` in `rg-assistant`.

## Exports, seeds and authoring

`postgres-seeds.js` exports `seedPostgresConnectGuided`, `applyPostgresSeedActions`, `seedPostgresSchema` and `seedPostgresApp`. It imports no sibling Lab. The guided initializer supplies only AKS/ACR, attached pull permission, credentials, the assistant namespace and Service. It creates no PostgreSQL resources, app deployment, image, corpus or verification evidence. The learner starts with an unimplemented app and an empty commented schema.sql. Later-Lab recipes reproduce schema/corpus prerequisites independently and build the caller's own starter/faulty sources. Scratch schema/deployment edits are never returned as learner project edits; initializers return only sandbox/artifacts/runtime/nextSequence.

Common helpers now export `PG_SERVER_COMMAND`, `PG_ALLOW_VECTOR_COMMAND`, `PG_DATABASE_COMMAND`, `PG_SCHEMA_SQL`, `pgSqlCommand` and `pgConnectAppSource`. The latter replaces only the document-query prefix and retains the current retrieval/context/answer tail. The Lab's app Solution includes the complete query prefix plus the three later starter zones; it does not solve later retrieval or context tasks. Helpers import no Lab.

The supplied load.sql is protected in the manifest as the exact `-- simulator:load-corpus` marker and remains outside build inputs. All SQL commands use one-shot psql against saved project files or complete `-c` statements. Lab text explains the marker as the simulator's bulk COPY stand-in and labels modeled sizes/plans with `Simulated estimate — not an Azure guarantee.`

## Task conditions and ordered Solutions

Stages/tasks follow provision → schema → code → deploy → indexes. Each of the ten tasks has two hints, an exam note, explanation and complete command/file/scenario Solution steps.

- `server`: exact GeneralPurpose / Standard_D2ds_v5 / version 16, storage at least 32 GiB.
- `allow-vector`, `database`, `extension`: server allow-list, knowledge database, installed vector extension respectively.
- `tables`: actual required columns/types/FK/vector(8), matched to learner-authored schema.sql definitions and a psql -f schema.sql action. Document IDs permit bigint identity or primary key.
- `loaded`: actual 16 document/32 chunk samples and declared 20,000/250,000 logical rows after the fixed loader.
- `code-queries`: supported literal SQL with placeholders and separate params in both edited functions, plus an image built from current saved sources. Real Jsonb adaptation is supplied for containment; the equality branch uses product/version parameters.
- `deployed`: a ready Service-selected assistant-api Pod has an immutable artifact with the current build-source hash.
- `btree`: current learner-built document-query code; actual rows [5, 6, 7, 8], equal to recorded SQL rows; Index Scan on a documents B-tree ordered `(product, version)`.
- `gin`: current learner-built document-query code; actual rows [1, 2], equal to recorded SQL rows; Bitmap Heap Scan using a documents metadata GIN.

Index evidence dependencies are the deployed search function, documents columns, and documents index definitions. Checks read observed app/SQL rows and recorded plans, without filtering rows. Both index Solutions include before/after EXPLAIN ANALYZE. Because the existing index selector captures documents index definitions together, the final GIN Solution refreshes docs-by-product before docs-by-metadata; the final ordered replay retains all ten completed tasks.

## Authorized integration corrections

The replay exposed two existing Task 7 pipeline omissions. The controller authorized these precise additional edits:

1. PostgreSQL's real template Dockerfile had a RUN dependency-install line, while the bounded Python Docker parser only accepted five instructions. `POSTGRES_MANIFEST.pythonInstallInstruction` now declares the exact supplied line. build.js and Kubernetes captured-artifact validation propagate it. The parser permits only that line immediately after WORKDIR, then applies its existing five-instruction validation. Other manifests have no opt-in; arbitrary/changed/extra RUN instructions remain rejected. A read-only search inspected every parser caller; remaining callers belong to AKS-specific helpers/capstone and need no PostgreSQL propagation.
2. PostgreSQL SDK constructor lowering emitted `receiverType: undefined` for untyped catalog calls including Jsonb and register_vector. Artifact JSON serialization dropped these properties, so strict saved-artifact reparsing rejected the Deployment despite matching serialized app specs. Lowering now omits absent return types while retaining declared types. The failed Deployment replay and subsequent green replay cover this integration regression.

Temporary diagnostic logging was removed. Two inline local Node probes traced the failed Deployment's artifact and resource validation; no diagnostic files remain. No runtime rewrite, unrelated journey changes, network, real Azure calls, Python execution, subagents, full/old/AKS/Container Apps/browser tests or other-file tests were performed. The explicit testing restriction overrides the TDD skill's general full-suite instruction.

## Verification and elapsed time

Exactly one permanent `it` was added to `tests/data-postgres-labs.test.js`, using the existing replay helper. Its fresh-run assertions reject pre-solved B-tree/GIN tasks, PostgreSQL resources and image builds. The replay checks every task completes and verifies the actual expected query IDs.

- Initial `npm.cmd test -- tests/data-postgres-labs.test.js`: exit 1, expected missing-registration assertion (`expected undefined to be defined`), 2.796 s wall.
- Six further runs of that same named file investigated the Docker/Deployment integration failures: 2.804, 2.970, 2.822, 2.949, 2.907 and 2.947 s; 17.399 s total. Two read-only inline diagnostic probes took 0.289 and 0.297 s.
- First green replay after integration corrections: exit 0, 1/1 passed, all ten tasks done, 3.045 s wall.
- Final named replay after protecting load.sql: exit 0, 1/1 passed, 3.006 s wall (Vitest test 229 ms).
- Required throwaway no-B-tree sabotage: exit 0, 0.472 s wall. Dropped docs_product_version after the replay, reran docs-by-product, observed HTTP 200 and correct [5, 6, 7, 8] rows but Seq Scan; asserted btree remains incomplete. No sabotage state/file was retained.
- `npm.cmd run build`: exit 0, 529 modules, 4.788 s wall (Vite 4.10 s). Existing large-chunk advisory only.
- Owned tracked diff `git diff --check`: no whitespace errors. Git's normal LF/CRLF notices are not code failures.

Total test/debug/sabotage/build command wall time: approximately 32.09 seconds. Self-review checked stage order, query argument branches, actual-row/plan grading, protected scaffold integrity, current-source/build matching, seed independence, absence of Lab import cycles, and authorized shared scope. No blocking concerns remain. Existing bundle-size advisory remains; browser verification and unrelated suites were intentionally excluded.
