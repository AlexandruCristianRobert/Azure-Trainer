# Task 7 report — PostgreSQL template and pipeline

Implemented from `5e33767`. Owned template, helpers, manifest registration, data actions, Lab action dispatcher and scoped experiment-panel additions. Controller authorized the additional small `python-sdk.js` changes for protected baseline modules and the typed pooling wrapper. No controller-ledger edits are included. No subagents, permanent tests, existing/full/AKS/Container Apps/browser tests, network calls, Python execution or real Azure operations were used. TDD guidance was constrained by the explicit throwaway-parser-only testing instruction; frontend-design guidance preserved existing controls, typography, palette and result layout.

## Template and public interfaces

`data-python-postgres-v1` exports `POSTGRES_MANIFEST`, `POSTGRES_FILES`, `POSTGRES_BUILD_FILES`, `POSTGRES_KUBERNETES_FILES`, `POSTGRES_EDIT_ZONES`, `POSTGRES_ROUTES`, `POSTGRES_STARTER_FILES`, `POSTGRES_SOLUTION_FILES`, `POSTGRES_SOLUTION_FUNCTIONS`, `POSTGRES_DSN`, `POSTGRES_POOL_CLIENTS` and `POSTGRES_NAIVE_CLIENTS`.

The editable functions are `get_document(document_id)`, `search_by_metadata(product, version, metadata=None)`, `retrieve_passages(question, product, version, language)`, `build_context(rows)` and `answer(question, product, version, language)`. Routes map directly to these names. Metadata route arguments `[product, version, null]` select product/version equality; `[product, version, metadataObject]` select JSON containment with real `Jsonb` adaptation. The third argument may be omitted for the equality branch. Retrieve/answer route arguments are `[question, product, version, language]`; the exact baseline takes `[question]`.

All data queries use bound parameters and dictionary rows. Retrieval returns actual chunk IDs and joined document metadata; an authored distance threshold rejects unknown-question zero vectors. The schema uses `vector(8)` and is editable through `psql -f schema.sql`, outside `buildFiles`. `load.sql` contains the engine's exact `-- simulator:load-corpus` marker and is also outside the image inputs. Clients declare the exact training DSN, with module pool maximum 5 and `kwargs={"row_factory": dict_row}`. Both variants expose `connect()`, so Lab 7 changes only clients.py. App queries and the baseline import that wrapper; pooling repair requires no unrelated retrieval edits.

`build_context` produces `{sources: [numeric chunk IDs], passages: joined passage text}`. `training_answer(question, context)` consumes the learner context and grounds the answer in its top source. The protected valid-Python `training_runtime.py` declares the same corpus/question mapping as the bounded runtime. Empty retrieval is handled before the helper, returning exactly `{answer: "I couldn't find that in the documentation.", sources: []}`.

The protected `baseline.py` supplies `exact_baseline`, independently of the starter retrieval/context functions. Its deterministic secondary ID ordering makes the shared planner select exhaustive search: ANN matching requires exactly one ORDER BY expression. It does not introduce unsupported session settings. `baseline.py` is in fixed/build files and `runtimeFunctions`; the PostgreSQL manifest additionally declares `runtimeFiles: ['baseline.py']`. The recognizer requires each runtime file to have present source matching a named `fixedFiles` entry, and fails closed otherwise. Cosmos file discovery remains unchanged. The only extra constructor inference recognizes a declared global `pg-pool`'s `connection()` return through the shared SDK catalog; unknown factories remain unsupported.

## Helpers, evidence and load

Helpers export `PG_GROUP`, `PG_SERVER`, `PG_DATABASE`, `PG_CLUSTER`, `PG_REGISTRY`, `PG_NAMESPACE`, `PG_CLUSTER_ID`, `PG_DATA_TARGET`, `PG_TARGET`, `PG_REQUEST_TARGET`, `PG_ESTIMATE_LABEL`, `pgDependencies`, `pgRequestScenario`, `pgLoadScenario`, `pgDeployedArtifact`, `pgDsnPort`, `pgDeployedFunctionsCurrent` and `pgTask`. `PG_TARGET` combines PostgreSQL and AKS identity; `PG_DATA_TARGET` is the Lab's runtime data target. Helpers import no Lab module.

`pgDependencies(target, fields)` fails closed on unsupported selector names and supports only images, code, schema columns/types, table index definitions, individual server parameters, SKU sizing, deployed DSN port and current Deployment replicas. Fields have distinct sorted-set dependency keys. Code/image/DSN values come from the same ready Pod's immutable artifact snapshot used for requests, never saved files or a mutable republished tag. Index estimates/build durations are excluded from index definitions.

Later Labs must select dependencies based on their checks. Historical exact/naive baselines omit the repaired index/pool/image fields they compare against. A current load verification that depends on pool maximum should include `images:assistant-api`, since global pool size is captured outside individual function bodies. Shared-function edits require refreshing their earlier verifications to preserve top-to-bottom replay completion.

`pgRequestScenario(steps)` supplies the service-routed target and version. `pgLoadScenario({route, args, requestsPerSecond=500, seconds=30})` supplies the same target, `kind: 'data-load'`, version 1 and `replicas: 'deployment'`. The Lab action dispatcher and data bridge both route load actions, gated on `dataPostgres`. One representative deployed app request must succeed and emit recognized SQL calls before load is simulated. Its actual connection evidence plus captured DSN port establish per-request/pool/PgBouncer mode. Module pool maximum comes from captured literal pool arguments, replicas from the current Deployment, and server parameters from the current sandbox server. Ambiguous/missing configurations produce failed evidence. Load measurements include `served`, `failed`, `p95Ms`, `throughputRps`, `peakServerConnections`, `errors`, `mode`, and available replica/pool maximum details. Runtime errors are retained for PostgreSQL requests. Cosmos charge aggregation defaults missing charges to zero.

The PostgreSQL-only result panel shows status/error, first five IDs/document IDs/metadata rows, request latency, plan node/index, ANN recall, connection mode and load statistics/errors. It includes the exact `Simulated estimate — not an Azure guarantee.` label. Existing Cosmos controls and other journeys keep their existing branches.

## Verification and limitations

The single throwaway parser script was run inline with Node; no test file was retained. It asserts zero diagnostics for solution/starter/naive variants, protected baseline lowering in all variants, only `raise-not-implemented` operations in starter edit zones, and valid Lezer Python syntax for the training scaffold. Initial red preflight failed because the template did not yet exist; an exploratory parser pass printed the expected functions/operations. These two exploratory command timings were not retained.

| Retained check | Result | Command wall time |
| --- | --- | --- |
| Parser assertions before final review correction | Exit 0; all specified assertions pass | 0.096 s |
| First production build | Exit 0; 527 modules | 4.751 s |
| Production build after request-error evidence | Exit 0; 527 modules | 4.744 s |
| Final parser assertions | Exit 0; all specified assertions pass | 0.083 s |
| Final `npm.cmd run build` | Exit 0; 527 modules, Vite 4.04 s | 4.758 s |

Retained verification command wall time totals **14.432 seconds** (unrounded values summed); final checks total **4.840 seconds**. Scoped diff review and `git diff --check` found no whitespace errors. Ordinary LF/CRLF Git notices and the existing Vite large-bundle advisory remain. Small simulation/UI checks were intentionally limited to parser assertions, build and source review; no app request/load/SQL execution or browser inspection was added. Future Labs provide their own scenarios, task checks, learner-built-image guards and ordered seed/solution replay. Fixture helper v3 extension remains Task 12's explicit scope.

## Review fix round 1 — protected routes and Service-selected evidence

Addressed the two review findings from `22e7bd8`, with receiving-code-review, systematic-debugging, TDD and verification-before-completion guidance constrained by the controller's explicit test authorization.

The function locator previously searched app.py before fixed baseline.py. Appending a learner `exact_baseline` function could therefore replace the simulator route while the fixed HTTP server still imported the baseline module. The recognizer now resolves declared protected runtime functions from their fixed runtime modules, requires one protected definition, and rejects conflicting definitions in app.py, clients.py, worker.py or another discovered module with `SCAFFOLD_MODIFIED`. Exactly one focused permanent core regression was authorized and added to `tests/data-python-sdk.test.js`. It checks that the unchanged scaffold lowers its protected source, and that learner function collisions prevent an appSpec from being produced. No other permanent test was added.

The dependency artifact helper previously selected a ready Deployment Pod without applying its Service selector. `pgDeployedArtifact` is now the shared Service-aware artifact lookup used by requests, load and dependency selectors. It preserves deterministic ready-Pod selection and immutable snapshot reads, returns null for absent Services or no matching ready endpoint, respects explicit service aliases, and defaults to the assistant-api Service for `PG_TARGET`. The default Deployment resolves from `target.deploymentName` or assistant-api; the existing explicit third Deployment argument remains supported. Cosmos service requests use the same selector/ready-Pod semantics they used previously; worker lookup remains Deployment-based.

A single throwaway artifact-selection script constructed two real sandbox resource records for ready Pods owned by one Deployment: the lexically first Pod was excluded by the Service selector and captured a different image/function/DSN. The check confirmed the selected Pod supplies image, code and DSN dependencies; default/explicit targets and an explicit Service alias agree; absent, unready and unselected endpoints return null. The script was removed after execution. No AKS or browser test path was run.

| Fix verification | Result | Command wall time |
| --- | --- | --- |
| `npm.cmd test -- tests/data-python-sdk.test.js` red | 7 pass, new collision regression fails with learner appSpec accepted | 1.443 s |
| Same explicit SDK path green | 8/8 pass after protected-function resolution | 1.360 s |
| Throwaway `node task7-artifact-smoke.mjs` | Exit 0; Service artifact and dependency selection checks pass; script removed | 0.222 s |
| Final explicit SDK path | 8/8 pass | 1.503 s |
| Final `npm.cmd run build` | Exit 0; 527 modules, Vite 4.39 s | 5.123 s |

Fix-round validation command wall time totals **9.651 seconds** (unrounded values summed). Final SDK/build checks total **6.625 seconds**. Scoped source/diff review and `git diff --check` pass; the existing large-bundle advisory remains. No broader suite, additional core regression, permanent noncore test, browser/network/Python/Azure work or subagent was used. Controller ledger edits remain excluded from the fix commit.
