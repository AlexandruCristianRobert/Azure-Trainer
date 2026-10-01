# Task 9 report — Lab 6 pgvector sizing, indexing and filtered RAG

Implemented from `3bdf3fd`. Registered `postgresVectorGuidedLab` as `data-postgres-vector-guided`, journey order 6, guided, 60 minutes, engine/content versions 2/1, PostgreSQL service and PostgreSQL/ACR/Kubernetes capabilities. Stages and tasks follow exact → size → index → RAG, with seven complete standalone Solutions.

## Seed, source recipes and exports

`seedPostgresVectorGuided` extends the common seed module using `seedPostgresApp`, which independently calls `seedPostgresSchema`. It reproduces AKS/ACR/namespace/Service, PostgreSQL extension/schema, the loaded 16-document/32-chunk samples with 20,000/250,000 logical rows, and documents B-tree/GIN indexes. It explicitly updates the server to Burstable `Standard_B1ms` and `maintenance_work_mem=1024` kB per controller ruling; public model defaults/formulas are unchanged. It builds/deploys only the caller's sources, with solved prior document queries and unfinished retrieval/context/answer zones. It seeds no scenario proof and returns only sandbox/artifacts/runtime/nextSequence; learner schema/deployment files remain intact. Seeds import no Lab modules.

Common helpers additionally export `PG_HNSW_SQL` and `pgVectorAppSource({efSearch=50, iterativeScan='relaxed_order', rag=true})`. Later independent seeds can consume this complete source recipe without a Lab import. `rag=false` preserves context/answer starters; the exploratory source uses explicit ef_search=4 and iterative_scan=off. Retrieval registers vectors, binds all parameters, branches on product=None for actual global ranking, and otherwise joins documents with product/version/language SQL filters. Distance <0.2 excludes unknown-question zero embeddings. The final context/answer recipe uses existing bounded valid Python and passes the built passages/source IDs to training_answer, with the declared empty fallback before that helper. Existing real Jsonb adaptation remains in the prior document-query prefix.

No shared core, template, planner, SQL or SDK modification was required. Dispatch shorthand suggested a /retrieve-exact route, but the controller clarified that the existing protected GET /baseline/exact should remain; it is supplied, immutable and already lowered. `retrieve-exact` is the Lab scenario name, not a new HTTP route.

## Conditions and evidence

- `exact-knn`: fixed route returns the actual global ranking [17,9], matching recorded SQL rows through a Seq Scan. Global IDs are derived from corpus cosine ranking, not the question's filtered fixture IDs. Historical dependencies include only chunks/documents columns; omit subsequent indexes, SKU, pool, images and learner code.
- `scale-up`: GeneralPurpose/MemoryOptimized with at least two vCores.
- `build-memory`: actual logical chunks count/dimensions use the unchanged rows × dimensions × 4 × 1.6 / 1024 formula; memory must fit the graph (12,500 kB here).
- `hnsw`: actual chunks.embedding HNSW with vector_cosine_ops.
- `tuned`: current learner-built deployed source/functions, actual returned [17,9] equal to SQL rows, current matching HNSW plan, app-issued SET ef_search≥45, recorded recall≥0.98 and summed request SQL latency below 25% of historical exact latency.
- `filtered`: current deployed retrieval, actual [1,2] SQL/app rows with all three metadata fields, matching HNSW and app-issued relaxed_order iterative scan. Exploration records what ef_search=4 actually returns without inventing a failure for sufficient rows. Final source restores ef_search=50 and refreshes unfiltered proof.
- `answer`: current deployed retrieval/context/answer, known fixture answer and [1,2] sources, declared unknown empty response, known SQL source IDs and unknown empty SQL rows, and lowered calls to build_context/training_answer. The answer-known scenario records known and unknown values in order; a second ungraded standalone scenario was not introduced. Final solution refreshes both earlier retrieval proofs after the final build.

Checks inspect observed app results/calls/plans and never post-filter inside grading. Code-graded tasks compare deployed immutable artifact source hash to saved build sources and deployed function bodies to parsed saved functions; starter image cannot complete them. Retrieval dependency fields are only retrieval code, document/chunk schema and chunks index definitions; answer adds context/answer bodies. Rebuild/apply/rollout restart captures current sources when reusing a tag. The tuned Solution supplies its exact baseline independently; schema/infrastructure are supplied reproducibly by the seed. IVFFlat lists/probes and halfvec memory/precision tradeoffs appear as optional notes/hints, not required tasks. Partial-index guidance explicitly requires denormalized same-table metadata rather than joined document columns. Simulated estimates are labeled as such.

## TDD, verification and elapsed time

Exactly one new permanent `it` was added to `tests/data-postgres-labs.test.js`. It rejects pre-solved HNSW/tuned/filtered/answer tasks on a fresh seed, checks the explicit tier/memory seed, replays ordered Solutions to all seven completed tasks, and asserts actual global/filtered IDs plus known/unknown answer values. Only this named file was run, as explicitly required; this restriction overrides general skill guidance to run a full suite.

| Check | Result | Command wall time |
| --- | --- | --- |
| `npm.cmd test -- tests/data-postgres-labs.test.js` red | Existing Lab5 passes; new Lab6 fails at missing registration | 3.251 s |
| Same explicit file green | 2/2 pass; all Lab6 tasks complete | 3.484 s |
| Throwaway `node task9-sabotage.mjs` | Wrong vector_l2_ops gives [17,9] via Seq Scan; tuned false | 0.857 s |
| Final explicit replay file | 2/2 pass; all ordered tasks complete | 3.437 s |
| `npm.cmd run build` | Exit 0; 530 modules, Vite 4.00 s | 4.706 s |

Total test/sabotage/build command wall time **15.734 seconds** (unrounded values summed). The temporary sabotage script was removed and its sandbox state was discarded. Owned source/diff self-review checked seed independence, no Lab import cycles, global-vs-filtered ranking, opclass matching, actual-row/plan checks, stage order, standalone Solutions, evidence refresh and historical baseline dependencies. `git diff --check` on owned files passes. The controller ledger is excluded from this commit.

No blocking concern remains. Existing Vite large-bundle advisory remains. No full/SDK/SQL/old/AKS/Container Apps/browser suite, network, real Azure, Python execution or subagent work was performed. Commit attribution uses the configured actual author rather than the brief's unrelated Claude footer.
