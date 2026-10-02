# Data Lab13 implementation and review audit

Final product revision: `bd3443a56f92831e14edce7b2d5cd32995f7ad6d`. Branch: `codex/data-capstone`; base: `36d8cbc0bad235c4e4cba595d0b6768437eab697`.

All seven tasks are complete. Independent task reviews and one whole-branch review followed by one consolidated fix wave and scoped review are clean. SDK15 and current core6 pass; latest UI build passes. Historical accepted walkthrough at39f7ab5 completed15 outcomes/seven seals; subsequent changes have focused coverage, not a new full replay.

Known measured validation481.257857s, plus a separate300s conservative allocation for one incompletely logged final-review probe: accounted781.257857s. These are not an exact measured total or upper bound. No full/AKS/Container Apps/browser/cloud/legacy replay tests were run. M1 existing bundle advisory remains deferred. Merge/push/publication have not been performed.

This is the preserved controller ledger and complete implementation/review report record. Entries below are chronological/historical reports; earlier pending statuses are superseded by the final controller entry and final scoped review. Disposable probes and snapshots are intentionally not permanent tests.

## Archived progress.md

# SDD ledger — plan: docs/superpowers/plans/2026-10-02-data-lab-13-capstone.md

Approved for implementation by user on 2026-10-02. Execution: subagent-driven, sequential implementers; independent spec and quality reviews per task; one broad final review. Main remains unchanged at 36d8cbc. No merge/push/publish authorized.

## Workspace and verification budget

- Worktree: E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-capstone
- Branch: codex/data-capstone; branch base: 36d8cbc0bad235c4e4cba595d0b6768437eab697.
- Supplied Git Bash helper tools work; use task-brief and review-package from skill scripts.
- Baseline named SDK file: 13/13, exit 0, 1.9782066s wall. Parent node_modules resolves correctly; no dependency install needed.
- Cumulative known measured verification wall seconds: 481.2578570 (prior434.0306137 + finalwave47.2272433). Final-review probe exact duration unknown, separately charged300s conservative allocation, accounted781.2578570s (~13.02min), not measured total/upper bound. Count every worker/report run and failed check. At 20 minutes inspect slow checks; at 30 minutes simplify/refactor before further checks. No legacy/full/browser suites.
- New case budget: Task 1 two; Task 3 three; Task 4 two; Task 6 one = eight total.

## Preflight: every task's internal consistency

| Task | Tests/files versus specified implementation | Finding |
| --- | --- | --- |
| 1 | Composite resolver, interpreter clients, provenance, SET LOCAL; two SDK cases | Uses existing helper fixture before Task 2 exists; consistent |
| 2 | Coherent corpus/project, protected helper profile; disposable ranking probe/build | Recognizer helper-profile registration also needs python-sdk.js although omitted from Files line; allowed narrow integration edit |
| 3 | Bridge/worker/cache/load, three core cases; uses Task 2 project | Worker checkpoint follows full successful batch, not after each item despite prose shorthand |
| 4 | Generic bounded stage adapter, two core cases; final fresh freeze | Small two-stage unit fixture versus actual seven-stage Lab must remain supported |
| 5 | Two staged one-shot faults, probes reused in final walkthrough | Healthy worker updates Support, incident updates Backup; no artificial source rollback |
| 6 | Receipt-based owned cleanup, one core case | Protected refs captured after seed return without changing initializer schema |
| 7 | Seven checkpoints/15 tasks, registry/UI/seed/complete solutions; one replay | No permanent Lab replay test; final named core/build only |

## Preflight: every shared task pair

| Pair | Producer → consumer / shared files | Finding |
| --- | --- | --- |
| 1–2 | Composite parser/runtime/profile → fixture/project | Task 2 may extend recognizer helper profile, no future import in Task 1 |
| 1–3 | runDataFunction/targets/provenance → mixed adapter | Caller capability gate belongs at bridge, captured manifest remains interpreter gate |
| 1–4 | Captured artifact identities → seal validation | No parallel edits; no single-service change |
| 1–5 | Captured pool/client/functions → fault artifacts | Faults use normal builds and deployments |
| 1–6 | Strict backend targets → owned service identities | Names alone cannot prove ownership |
| 1–7 | Shared runtime contract → full Lab sources/evidence | Legacy targets preserved |
| 2–3 | Project/worker/fixtures/revision overlays → bridge | Overlay current PG rows preserves earlier product update |
| 2–4 | Manifest/source build files → source journal/artifacts | Protected helpers included in hashes |
| 2–5 | Distinct healthy/fault sources → staged incidents | Backup still revision 1 until worker incident |
| 2–6 | Separate data group/project deploys → inventory | Supplied cluster/registry/Service stay protected |
| 2–7 | Full templates/policy/SQL fixtures → complete solutions | Partial rag route doesn't execute unfinished functions |
| 3–4 | Trusted scenario measurements → current seals | Refresh dependencies before recording proof |
| 3–5 | runCapstoneSteps/action bridge → incident execution | Avoid recursive action dispatch and duplicate evidence |
| 3–6 | Action envelope/runtime effects → cleanup receipts | Destructive safety checked before command effects |
| 3–7 | Workload/worker/load facts → task checks/UI | Complete frame facts independent of display cap |
| 4–5 | Active stage/incident identity → injection gating | No hidden fault on Verify |
| 4–6 | Freeze stage/persistence → inventory/deletion | Final seal requires actual owned cleanup |
| 4–7 | Stage API/view → LabPanel/DataCapstonePanel | No ACA/AKS capstone capabilities |
| 5–6 | Measured recoveries → frozen cleanup | Both incidents resolved with current proof before freeze |
| 5–7 | Fault lifecycle/receipts → staged tasks/solutions | Warm hits cannot prove cold recovery |
| 6–7 | Inventory/protected refs → cleanup solutions/UI | Supplied namespace/Service not deleted |

## Rulings (ordered)

Ruling: the approved named-core-tests-only scope overrides Superpowers templates that require a full suite — the user explicitly prohibited AKS/ACA/full tests and approved this plan's eight-case budget — cost if wrong: unexercised legacy regressions remain possible, disclosed at handoff.

Ruling: Task 2 may modify python-sdk.js narrowly for its canonical capstone helper-profile registration — the task explicitly requires recognizer registration but its Files line omits that consumer — cost if wrong: one extra integration file changes, to be independently reviewed.

Ruling: the durable worker checkpoint is saved after all items in a successful batch, not per item — the binding spec says after each handled batch and the plan's sample correctly does that — cost if wrong: a failed batch repeats earlier idempotent DELs on retry rather than persisting partial progress.

Ruling: generic Data stage validation accepts bounded smaller stage declarations used by core fixtures, while the delivered Lab must declare exactly its seven approved stages — the plan specifies two-stage unit tests and a seven-stage product — cost if wrong: adapter permits more authored shapes, but catalog stage-count correctness is reviewed separately.

Ruling: Task 1 uses declarative named canonical helper profiles and an authored literal manifest.dataTarget expected-target contract, not generic evaluator callback registration — Task 2 already owns its small canonical profile/runtime integration and a callback framework would be speculative — cost if wrong: Task 2 needs a narrow static consumer edit rather than registering custom evaluators externally.

Ruling: Task 2 may enable the existing bounded container command field for dataCapstone in src/lib/kubernetes/schema.js — its worker needs a supplied Python entrypoint while the current validator gates command on dataCosmos only — cost if wrong: one extra capability-scoped schema consumer changes; unrelated Kubernetes labs retain their existing gate.

Ruling: composite PG DSNs accept only the native 5432 and supported PgBouncer 6432 ports while retaining captured server/database and authored target equality — the approved recovery explicitly requires port 6432 without changing the service identity target — cost if wrong: composite port validation is slightly broader; legacy single-service validation remains unchanged.

Ruling: capstone Cosmos history similarity uses the existing VectorDistance similarity score >= 0.95, mathematically equivalent to the approved cosine distance <= 0.05, retaining all three scope filters — current official function reference https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance (2026-03-25) defines similarity and descending score example; MicrosoftLearning exercise calls it distance inconsistently; no shared-core rewrite or per-Lab query profile is warranted — cost if wrong: a future actual-service distance interpretation would require query-threshold adjustment; simulator threshold intent and legacy behavior remain intact. Record score convention visibly in source/docs and probe scoped near-miss rejection.

## Tasks

Ruling: when the platform rejects new subagent threads, reuse an idle non-implementing reviewer with a fully reset task assignment rather than skip the independent quality gate — new Task2 quality spawn failed "agent thread limit reached", with no close-agent tool available; /root/review_planner has not implemented Lab13 and can independently inspect its isolated task diff — cost if wrong: reviewer prior-context bias and strict fresh-thread deviation; task scope/read-only independence retained and disclosed. Retry new-thread dispatch for subsequent roles before fallback reuse.

- [x] Task 1 composite SDK execution — complete commits36d8cbc..aa428bf; spec clean, quality findings Q1–Q4 resolved through three scoped fix rounds; final scoped review clean. SDK15/15, two newcases only. Cannot-verify obligations: Task2 profile/Task3 capability gate tracked; broad legacy checks deliberately excluded, existing13case baseline preserved.
- [x] Task 2 coherent fixtures/Python project — completecommitsaa428bf..d3b94ca; spec/quality findingsS1/S2resolvedbyonescopedfixround, freshscopedreviewclean. Disposablefixture/PythonparityprobesGREEN, onebuildpassed;18.5058148s, zero permanentcases. Initialqualityseatidle-reused /root/review_planner dueplatformthreadlimit, deviationrecorded. No parallelimplementers.
- [x] Task 3 workload bridge/worker/cache-aware load — completecommitsd3b94ca..4225bca; initialspec/qualityE1/E2resolvedonescopedfixround; finalfreshscopedreviewclean. 3corecasesGREEN+onebuild44.6472426s. No parallelimplementers.
- [x] Task 4 resumable checkpoints/persistence — completecommits4225bca..4b7d89f; P1/P2 resolvedonescopedfixround finalfreshreviewclean. 2newcases5/5GREEN+serializeprobe29.3708868s, no build. Future incident/ownership hooks failclosed and documented forTasks5/6/7.
- [x] Task 5 cross-service incidents — complete commits4b7d89f..408cbbb; initial spec compliant, quality I1 resolved one fix round, fresh scoped review clean. Zero permanent cases; two reused disposable probes and one build, 37.7570809s. Task6 maintenance ownership and Task7 catalog integrations tracked below.
- [x] Task 6 owned cleanup — complete commits408cbbb..96e925a, independent spec/quality clean. Named core6/6, one new case,14.5899419s; no build. Task7 hook/seed/walkthrough obligations retained.
- [x] Task 7 Lab/UI/walkthrough/handoff — complete commits96e925a..7440a6a; S1/S2/S3/Q7-1 and introduced Q7-R1 resolved two fix rounds, fresh scoped review clean. Q7-2 deferred minor display issue for final triage. All15 outcomes/seven seals accepted once at39f7ab5; changed grading tested by13 focused controls and named21 cases.
- [x] Whole-branch review/final bounded verification — wholebranch findings F1/F2/F3/Q7-2 resolved in one consolidated wave bd3443a, fresh scoped final review clean; integration options awaiting user choice.

Task 1: fix round 1/5 (2 addressed, 1 open — Q1/Q2 addressed; new Important Q3 dotted-module import normalization; commits 63c307c..cc18ab3). Fix round 2 running same implementer; FIX_BASEcc18ab3. No deferred minors.

Task 1: fix round 2/5 implemented at 22439e5; RED/GREEN15/15; fresh /root/capstone_task1_fixreview2 reviews package review-cc18ab3..22439e5.diff. Awaiting Q3 verdict.

Task 1: fix round 2/5 (1 addressed, 1 open — Q3 addressed; new Important Q4 normalized pgvector root parameter-shadowing; commits cc18ab3..22439e5). Fix round3 running same implementer FIX_BASE22439e5. No deferred minors.

Task 1: fix round3 implemented aa428bf, coveringSDK15/15. Fresh /root/capstone_task1_fixreview3 reviews package review-22439e5..aa428bf.diff. Awaiting Q4 verdict.

Task 1: fix round3/5 (1 addressed, 0 open — Q4 resolved; commits22439e5..aa428bf). Task1 complete: finalscopedreview clean, no deferredminors.

Task2 initialreviews agree S1 similarpagediterable JSONserialization / S2 explicitPython-JSnormalizationparity Important. Fixround1 sameimplementer /root/capstone_task2 running FIX_BASE15519ab. Cannotverify actualCosmosprovisioning/deployedexecution trackedTask3/7; actualnetworkSDK excluded intentionally. Deferredminor M1 existingVitechunkwarning (notintroducedregression), finalreviewtriage; no silence/refactor unrelatedbundle scope.

Task2 fixround1 implementedd3b94ca withactualPython/JSparityprobeRED/GREEN+fixturecontrol,1.0522751s. Newthreadretry succeeded: fresh /root/capstone_task2_fixreview checks review-15519ab..d3b94ca.diff. AwaitingS1/S2verdict.

Task2 fixround1/5 (2addressed,0open; commits15519ab..d3b94ca). Task2complete finalscopedreviewclean, M1baselinechunkwarningdeferredonly.

Ruling: trusted Lab declares dataRequestTarget {clusterId,namespace,serviceName,deploymentName}, dataWorkerTarget {clusterId,namespace,deploymentName}, and dataLoadRequest {route:'GET /answer',args:[question,product,version,language,sessionId,messageId]} for standalone loads — the plan requires targets/authored bounded inputs from the Lab but leaves field names and standalone representative selection open; preceding authored answer steps can supply a bounded wave, otherwise explicit dataLoadRequest is required and missing inputs reject — cost if wrong: Task5/7 must author the additional field; no implicit fixture request or caller target broadening. Load observes the cache snapshot at the load step, not historical request execution, preserving prime/advance/cold ordering.

Ruling: Task3 may narrowly integrate shared runtime.js returned-field provenance and source-consumed helper flow — canonical rag_answer returns a dictionary whose field flows are lost by root-only evidence, so the required actual-PG miss proof otherwise cannot work; generic detached flow metadata must certify actual consumed passage/answer/sources relationships, never source scans, appflags, incidentalcalls plus literals, or capstone lowering — cost if wrong: an extra shared interpreter file changes and needs focused legacy/provenance review; same three corecase budget retained. Task3 owns this integration without reopening completedTask1.

Ruling: Task3 does not gratuitously rewrite Task2's canonical worker just to produce a hunk for its Files list — the full-batch lease and optional lease-query implementation already fulfills this shared contract and Task3's real restart/failure/redelivery cases exercise it — cost if wrong: a missing worker edge remains in unchanged prerequisite code; reviewers can inspect that concrete dependency and final walkthrough covers integrated delivery.

Task3 initialreviews E1historymutationidentity and E2workerhandledactualinvalidation Important. Fixround1 sameimplementer /root/capstone_task3 running FIX_BASE8760178; namedcoreonly existing3cases, no rebuild. M1baselinechunkwarningdeferred; downstreamintegrationcannotverifytrackedTasks4–7. Qualityreadonlyprobe4.2974244s counted.

Task3 fixround1 implemented4225bca, RED2fail/GREEN3/3,5.4136198s. Fresh /root/capstone_task3_fixreview reviews package review-8760178..4225bca.diff. AwaitingE1/E2verdict.

Task3 fixround1/5 (2addressed,0open; commits8760178..4225bca). Task3complete finalscopedreviewclean, M1baselinechunkwarningonlydeferred.

Ruling: stage adapter uses trusted lab.dataCleanup.allowAction(run,action,lab) / ready(run,lab) hooks and fails closed for deletion/readiness without ownership implementation; its wrapper must not collide with Task6 ownership.js required dataFrozenActionAllowed export — Task4 cannot import a future ownership module or create circular dependencies, while central action and direct workload paths must enforce freeze now — cost if wrong: Task6/7 need explicit hook wiring, and absent wiring blocks cleanup rather than permits destructive actions. Authored final-stage scenario.mode='cleanup' distinguishes cleanup tasks from fresh recovery proof tasks.

Ruling: Task4 may narrowly modify evidence.js although omitted from Files line — ordinary public recordVerification must itself gate Data active/frozen stage and derive detached Data proof snapshots tied to exact measured records/source/artifact/dependency identities, otherwise direct verification bypasses the required linkage — cost if wrong: one extra shared consumer changes and requires capability-scoped review; existing signature and legacy branches remain unchanged, caller cannot inject proof and broad mutable cache/time hashes are forbidden.

Ruling: runtime.dataCapstone.incident retains bounded immutable starts [{id,sequence}] (maximum two) alongside current lifecycle state, with causal receipt linkage — Task4 final proof must be newer than both Task5 incident starts, and replacing a single current incident would otherwise lose the earlier start; generic two-stage core may have none while actualLab must require both started/resolved — cost if wrong: Task5/7 need the exact retained-start integration and validation, no bare caller-flag proof.

Ruling: trusted lab.dataIncident.validate(run,lab) is required and fail-closed whenever incident state is nonnull — Task4 cannot import future Task5 receipt/lifecycle implementation; stage validation itself enforces bounded unique increasing starts and final proof newer than the exact retained starts, while Task5 validates actual injection receipt linkage and actualLab checks both resolved — cost if wrong: Task5/7 hook wiring is required or resume/final proof blocks; no unvalidated incident flags accepted.

Task4 reviews P1primaryKey schema fingerprint/P2source snapshot evidence-to-seal linkage Important. Fixround1 sameimplementer /root/capstone_task4 running FIX_BASE50e81ba; existing5corecases only. Review probes4.4673432s counted. Actualincident/ownership/Lab downstream hooks trackedTasks5–7.

Task4 fixround1 implemented4b7d89f, RED2/GREEN5 cases,11.9308023s. Fresh /root/capstone_task4_fixreview reviewing package review-50e81ba..4b7d89f.diff. Awaiting P1/P2 verdict.

Task4 fixround1/5 (2addressed,0open; commits50e81ba..4b7d89f). Task4complete finalscopedreviewclean.

Ruling: Task5 may add a narrow actions.js seam passing a bounded internal {command,saveFile} primitive bundle through the Data adapter into incident injection, preserving existing normal command/save behavior and optional public-call compatibility — fault injection requires actual visible save/build/deploy/config receipts without recursive applyRunAction or incidents importing actions back through a new cycle; no Lab/UI/run-JSON supplied executors or generic evaluator framework — cost if wrong: extra internal optional parameter plumbing and a shared consumer edit need review; direct injection without trusted executor fails closed.

Ruling: trusted lab.dataIncident also declares stageIds for worker-checkpoint/cache-masked-pool and registryName, with validator/view/observation exports — stage-gated one-shot injection and exact registry build commands need these authored identities, not caller payloads — cost if wrong: Task7 must wire the exact declaration and measured observation lifecycle; no implicit target guessing.

Ruling: Task5 may narrowly forward dataCapstone through existing Kubernetes apply/object/state schema-validation consumers — schema.js already authorizes the bounded worker command under dataCapstone, but public dispatcher probe shows upstream callers drop the flag; objects.js39 likewise constructs a fixed dataCosmos-only capability object — cost if wrong: extra shared validation callsites change and need review; no schema loosening or adding legacy capability flags to the Lab, same disposable probe covers public apply.

Ruling: trusted dataIncident.scenarioIds maps each approved incident to an injection-only control scenario, requiring exact declared stage/mode and a single matching incident-start step; ordinary verification scenarios reject incident-start, controls record zero task evidence — the user/spec requires visible explicit injection, never a hidden Verify toggle, while preserving the existing data-capstone action envelope — cost if wrong: Task7 must author separate controls and the bridge needs a bounded matching-task exception, not arbitrary unmeasured scenarios.

Ruling: Task5 may enable dataCapstone alongside existing service capabilities at shell.js native psql/redis-cli gates and redis-cli.js's secondary gate — dispatcher probes expose these missing integrations and Task7 provisioning requires the same native teaching tools without adding legacy flags — cost if wrong: two extra shared CLI consumers change; existing host/TLS/auth/SQL/Redis validations and legacy behavior remain intact, no command-language expansion.

Ruling: worker fault injection uses normal delete/reapply of the learner-installed feedback-worker Deployment to create the stopped-worker update window, not scale-to-zero model expansion — existing supported replicas start at one; supplied namespace/Service/AKS/ACR remain protected, exact maintenance command receipts are retained — cost if wrong: Task6 must authorize receipt-owned pre-freeze workload maintenance and distinguish maintenance from post-freeze cleanup deletions, including narrow stages.js227 receipt-purpose validation; no supplied workload ownership guessing or destructive bypass.

Task5 initialspec compliant; quality Important I1 unlinkedupdateeventversion receipt. Fixround1 sameimplementer /root/capstone_task5 running FIX_BASE6bed967, sameignoredprobes/no rebuild. Reviewprobe0.9598263s counted. HistoricalinformationalUID notblocking withoutauthoritative retainedrecord; noauthenticityframework. Task6maintenance/ownershipandTask7catalog/UI/finalintegration stilltracked.

Task5 fix round1 implemented408cbbb: actual immutable change captured with full update receipt checksum, live historical log consistency and post-deletion validation; RED/GREEN same two probes 4.9375006s. Fresh /root/capstone_task5_fixreview reviewing review-6bed967..408cbbb.diff for I1 only.

Task5: fix round1/5 (1 addressed, 0 open — I1 captured event version/change linkage resolved; commits6bed967..408cbbb). Task5: complete (commits4b7d89f..408cbbb, review clean). Scoped reviewer added 0 validation seconds.

Task6 dispatch base408cbbbbe5eae57275c3c79304ae787c5fbc7445. One permanent core case, no build; exact ownership/maintenance integration consumes Task4/5 hooks. No parallel implementers.

Task6 initial implementer DONE96e925a. Named core6/6, one new case, no build;14.5899419s. Fresh spec /root/capstone_task6_spec and quality /root/capstone_task6_quality review package review-408cbbb..96e925a.diff. Task7 must wire dataCleanup ready=dataOwnedCleanupReady, allowAction=dataFrozenActionAllowed; seed supplied infrastructure/Service but no API/worker Deployments so learner applies create owned incarnations.

Task6: complete (commits408cbbb..96e925a, review clean). Both reviewers added0s validation. Cross-task cannot-verify obligations are explicitly Task7 deliverables, not missing Task6 implementation.

Task7 dispatch base96e925ae02bfb58f0241ad068f2f9e5c6cb62217. One ordered disposable walkthrough, two detached negative forks, final named SDK/core+build only; no permanent case/replay additions.

Ruling: Task7 may narrowly modify capstone.js template and data-capstone-actions.js for the protected four-argument GET /rag wrapper and RAG-only frame grading — Task7 explicitly requires that first-stage route, concrete existing route/fixedFunctions tables omit it, and its Files list omits these consumers — cost if wrong: two extra integration files change and independent review must verify no history bypass on ordinary GET /answer. Empty-result RAG still requires actual consumed PG result provenance, never incidental SELECT plus expected literal.

Ruling: Task7 may add the bounded protected training_no_match(rows) helper through capstone-runtime.js, python-sdk.js and runtime.js plus the bridge — actual empty PG rows cannot produce nonempty passage/source provenance, yet the required no-match response must prove consumed empty scoped results; helper returns the no-match text only for an actual empty list and preserves its existing PG origin with a distinct noMatch marker, while returned sources retains the same empty rows origin — cost if wrong: shared interpreter helper plumbing expands narrowly and needs focused review; accepting incidental SELECT plus literal/no-origin answer remains forbidden. No generic evaluator registration, fixture oracle, or source scan.

Ruling: Task7 may narrowly update TaskRow.vue to explain Data action Solution steps and resolve full file fragments against current saved learner zones — Task7 requires complete runnable Solutions without resetting unrelated correct work; current TaskRow handles static files and has no action-step display — cost if wrong: one extra shared UI consumer changes; Data-specific resolution must leave legacy Solution rendering intact and must not execute actions merely by revealing a hint.

Ruling: Task7 may narrowly add trusted task.evidenceMode='historical' for the two incident diagnostic baselines in stages.js — actual repair changes source/build and live definitions, so requiring the original faulty measured evidence to equal the repaired seal's current source snapshot makes the required observed-then-recovered stage impossible; retain original record/proof source linkage, scenario/check facts and immutable incident identity while permitting observed-or-resolved lifecycle, but compare historical proof to its own captured sources rather than the repaired seal — cost if wrong: two diagnostic baselines remain gradeable historically after later changes, so review must verify only these authored baselines opt in and repair/final proof retain all current/fresh guards. No arbitrary caller evidenceMode or weakening final freeze.

Ruling: Task7 may retain ordered actual load observations as measurements.loads alongside the existing last measurements.load and let pool incident observation use same-record warm/cold loads — the approved15-task Lab has one fault-observed selector and public dispatch only grades its exact declared scenario, while Task5 initially required two separate records; one trusted scenario must capture both actual windows — cost if wrong: narrow bridge/incident consumers expand; review must verify captured fault artifact/config, true61-second timing and actual origin/exhaustion facts for both observations, preserving old distinct-record support and not fabricating measurements.

Task7 implementer DONE39f7ab5d46590bc74512ba5b9f9939b0d6681072. One accepted own-Solution walkthrough15 outcomes/seven seals,28 authored answer calls including two detached negatives. Final named SDK15/core6 pass21/21 and build once passed. Initial validation228.6085715s, total423.2209728s. Independent task reviews pending; no merge/push.

Task7 initial review Important S1 earlier RAG overwrite, S2 fabricated session/similar results gradeable, S3 unrelated PG indexes accepted, Q7-1 empty-result requested scope not enforced. Fix round1 same implementer /root/capstone_task7, FIX_BASE39f7ab5. No permanent cases/build/full walkthrough; focused detached controls plus amended named core/SDK coverage as required. Task7 minor (deferred): Q7-2 durable final recovery display hidden when scrollback cleared; final reviewer triage. Review probes0.7779621s counted.

Task7 fix1 DONE0dedbdd2be7e796b78d4a02be305f3b2ae6ade7c. Twelve focused controls and named21 cases GREEN, added7.1536584s, no build/full accepted replay. Original accepted walkthrough remains historical39f7ab5; changed grading tested through detached actual result controls. Fresh scoped re-review pending.

Task7: fix round1/5 (4 addressed, 1 open — S1/S2/S3/Q7-1 resolved; new Important Q7-R1 scopeFilters processes IN condition.value instead of values, breaking valid equivalent retrieval; commits39f7ab5..0dedbdd). Same implementer round2 FIX_BASE0dedbdd; minimal existing focused control, no build/replay. Review probe0.7095069s counted.

Task7 fix2 implemented7440a6a. Scope capture restricted to actual scope equality predicates;13 total controls (12 previous+oneIN) GREEN,2.1685135s. Fresh /root/capstone_task7_fixreview2 reviews review-0dedbdd..7440a6a.diff; no named/build/replay rerun.

Task7: fix round2/5 (1 addressed, 0 open — Q7-R1 fixed; commits0dedbdd..7440a6a). Task7: complete (commits96e925a..7440a6a, review clean). Scoped reviewer added0s. All implementation tasks complete; wholebranch final review pending at7440a6a, branch base36d8cbc.

Wholebranch /root/capstone_final_review complete7440a6a: With fixes, no Critical; Important F1 final recovery permits current pool-capacity drift, F2 incomplete actual Cosmos history missing question certified, F3 SQL-leading regex miscounts actual commented/multistatement SELECT origin. Minor Q7-2 durable recovery hidden after clear; M1 preexisting bundle warning retained. One detached probe initial yield~10.4s but exact tail stopwatch lost; measured cumulative434.0306137s excludes this unknown-duration probe. Conservative budget charge300s allocation (not measured upper bound) => accounted734.0306137s, ~12.23min. No repeat to recover logs.

Ruling: charge five minutes conservatively to the incomplete-log final-review probe while keeping known measured434.0306137s separate — initial10.4s yield and later process absence confirm execution but cannot reconstruct exact tail; repeating would waste the user's budget — cost if wrong: budget estimate may over/understate actual validation duration, explicitly disclosed, no precise timing claim.

Ruling: retain the final review's declared exclusions for real cloud/SDK networking, production concurrency/coordination/atomicity, browser layout/accessibility execution, legacy/full suites, coordinated whole-save authentication and generalized incident source rewriting; historical full walkthrough/build remain historical rather than imply a fresh replay, and merge/push/publication remain user-controlled — these match approved bounded simulator scope and explicit small-test instruction; reviewed code/focused checks do not establish excluded execution — cost if wrong: those environments/behaviors remain unverified and broader source prerequisites may reject alternate implementations.

Ruling: retain baseline M1 bundle advisory without unrelated optimization — final reviewer found no demonstrated new bundle regression — cost if wrong: larger initial download/runtime cost remains possible, not silently marked fixed.

Final consolidated fix wave dispatch BASE7440a6a; fresh implementer owns F1/F2/F3 and Q7-2 together, no permanent cases/full replay; one affected build permitted because UI template changes. Exactly one scoped final re-review follows, then residuals adjudicated/no second wave.

Final fixer /root/capstone_final_fixes: focused controls GREEN; named21 run20pass/1fail reveals existing core fixture's intentionally successful history lacks newly required question/messageId/embedding. Build passes once. Added measured so far36.058801s; not final aggregate until report. Correct existing fixture payloads, no new cases or assertion weakening.

Ruling: permit one owning core-file rerun after repairing the obsolete successful-history fixture — stricter requested F2 grading exposed missing real fields in shared existing fixture; core fixtures are reused so its six cases are the smallest safe file-level check, SDK15 already passed unchanged in the final wave — cost if wrong: one extra short core run beyond the wave's one-shot plan, explicitly counted; no full suite or build/replay rerun.

Finalwave DONEbd3443a56f92831e14edce7b2d5cd32995f7ad6d. F1/F2/F3/Q7-2 fixed,11 focused controlsGREEN. NamedSDK15passed in20/21run; obsolete corefixture corrected, owningcore6GREEN; oneUIbuildGREEN, no second combined/build/replay. Addedmeasured47.2272433s. Fresh /root/capstone_final_fixreview checking review-7440a6a..bd3443a.diff exactlyone finalscopedseat; no secondfixwave planned.

Final scoped review /root/capstone_final_fixreview: F1/F2/F3/Q7-2 ADDRESSED, no new Critical/Important/minor/outside findings. Historical frozen proof preserved via evaluate59–62/stages262–263. Added0s. Wholebranch complete (commits36d8cbc..bd3443a, review clean after one finalwave). M1 preexisting bundle advisory retained only. All7 tasks/15 outcomes/seven seals complete; SDK15/currentcore6 and latest UI build pass. Original accepted walkthrough remains39f7ab5 historical with subsequent focused changes covered, not rerun. Integration not performed; persist audit then present finishing options.

## Archived final-fix-report.md

# Status: Lab13, final fixes — consolidated wave

Status DONE. Base `7440a6a10571e50df6bb44de3ea6ac8cac8c78a4`; HEAD `bd3443a56f92831e14edce7b2d5cd32995f7ad6d`, `fix(labs): require current capstone recovery and complete history`. Exact tracked diff self-reviewed and committed; tracked worktree clean. Final scoped re-review/controller gate pending. No merge, push or PR.

Read complete final-review.md, binding context.md, approved task-7 brief, task-7 report/interfaces and prior focused controls. Followed the complete implementer prompt, receiving-code-review, systematic-debugging, TDD/writing-good-tests and verification guidance. No subagents or reviewers dispatched. Explicit controller restrictions take precedence over skill generic full-suite requirements.

## Changes and interfaces

- F1: added exported `dataCapstonePoolRecoveryCurrent(run, lab, load)` in the existing composite bridge. It resolves the ready captured API's connection IR through the same connectionConfig used by modeled load and requires mode, module pool size and actual Deployment replicas to equal the successful cold recovery. It compares every capacity parameter consumed by simulatePoolLoad: effective max_connections (default859), PgBouncer enabled (defaultfalse), default_pool_size (default50). It requires nonzero origin demand, zero failures and no recorded load errors. The final task consumes the sealed pool-recovered load and still requires both resolved incidents, current deployed/saved functions/config, complete fresh final evidence, history/cache/provenance and memory/TTL guards. Final brief explains restoring proven capacity settings before fresh answers/freeze. No new scenario/load/replay or source reset was introduced. Existing freeze/stage integrity logic unchanged.
- F2: history credit inspects the expected actual newly written item/partition/revision, retaining existing actual successful upsert, scope, session, answer and source requirements. Both containers require item.question===requested question; qa_history additionally requires messageId===requested message plus its embedding equal to an actual executed embed(requested question) result. IDs/partitions already select the exact request identity. A successful unrelated write still cannot certify an old matching item.
- F3: runtime PG records now add statementKind from each actual executePg result, including errors. Composite originRequests counts a successful statementKind==='select', one origin demand per request; it no longer interprets raw SQL prefixes. Existing per-statement result/provenance and transaction-local setting bookkeeping remain unchanged. Empty result SELECT remains origin work; cache-only frames remain zero.
- Q7-2: moved durable recovery details into their own existing-style response block, outside result's scrollback-dependent v-if. No visual redesign.
- Existing core fixture payloads corrected after named tests exposed incomplete question-less history: sessions gets question; QA gets question/messageId/actual embed(question). Existing assertions and six cases unchanged; no permanent case added.
- Required committed progress document updated with whole-branch findings, truthful pending re-review status, failed run and exception, timings and limits. M1 preexisting bundle advisory remains deferred.

Production files: src/lib/data/runtime.js, src/lib/kubernetes/data-capstone-actions.js, src/data/labs/data-journey/capstone.lab.js, src/components/lab/DataCapstonePanel.vue. Also tests/data-capstone-core.test.js fixture only and docs/superpowers/data-capstone-progress.md. Total committed49 insertions/9 deletions across6 files. Ignored new controls/report only; original historical snapshots, accepted walkthrough scripts/records and previous reports untouched.

## Focused RED/GREEN

Command for all five attempts:

```powershell
$validationWatch = [System.Diagnostics.Stopwatch]::StartNew()
node .superpowers/sdd/2026-10-02-data-lab-13-capstone/final-controls.mjs
$validationWatch.Stop()
Write-Output ('VALIDATION_SECONDS=' + $validationWatch.Elapsed.TotalSeconds)
```

The same ignored final-controls.mjs reads retained task5 and task13 JSON snapshots into detached runs. Real parsed Python is substituted only into detached captured appSpec to avoid a new build/deploy walkthrough. Actual store/interpreter execution supplies measurements. The capacity regression executes the actual fresh final scenario (two answers plus one worker batch, no load/timer loops), then exercises the owning final predicate with those fresh measurements. Other history controls each execute one answer against a detached existing cache; origin controls each execute one RAG. UI control compiles the real SFC template and renders it with retained recovery and result=null using local Vue server renderer; no browser or installed dependency. Original snapshot bytes are checked unchanged.

Initial attempt2.100866s: F1 final pool drift/replicas wrongly pass; F2 question-less/combined QA omissions wrongly get credit; display hidden. Two control setup errors also occurred: literal newline broke Python's one-line SQL string; parameterized multi-statement group failed existing per-statement parameter binding. Corrected newline to escaped Python newline, and used supported literal values for grouped SQL, preserving exact canonical result without broadening SQL binding. Initial Vue renderer warnings were removed by compiler prefixIdentifiers option.

Second attempt1.6955988s: comment actual SELECT reaches200 but origin0; grouped fixture still parameterized and fails500; F1/F2/display still RED. Third attempt1.8743666s is complete meaningful RED before production edits:

```text
PASS F1 proven current final capacity qualifies
FAIL F1 fresh successful answers cannot hide current pool regression: true !== false
FAIL F1 current replica drift invalidates final capacity: true !== false
PASS F2 actual complete history writes qualify on cache hit
FAIL F2 question-less actual writes are rejected: 2 !== 0
FAIL F2 QA identity and requested embedding are required: 2 !== 1
PASS F3 standard actual origin retrieval qualifies
FAIL F3 SQL comments preserve actual origin count: 0 !== 1
FAIL F3 grouped SET LOCAL and SELECT preserve actual origin count: 0 !== 1
FAIL Q7-2 retained final recovery renders with empty scrollback: html.includes('Durable recovered answer') false
```

These are actual outcome failures: regressed server max_connections10 yields successful fresh200 answers/history4/RAGmiss1 but final task wrongly true; replica4 wrongly accepted; actual upserts absent question credited; supported comments/grouped SELECT return the identical standard PG answer/provenance but origin0; empty-scrollback renderer omits durable answer. No fake successful flag or raw-source assertion qualifies these controls.

Fourth attempt2.3176408s GREEN10 controls after minimal production fixes. Fifth attempt1.6845817s splits the QA omission check to prevent message identity from masking wrong embedding, GREEN11:

```text
PASS F1 proven current final capacity qualifies
PASS F1 fresh successful answers cannot hide current pool regression
PASS F1 current replica drift invalidates final capacity
PASS F2 actual complete history writes qualify on cache hit
PASS F2 question-less actual writes are rejected
PASS F2 QA message identity is required
PASS F2 QA requested embedding is required with correct identity
PASS F3 standard actual origin retrieval qualifies
PASS F3 SQL comments preserve actual origin count
PASS F3 grouped SET LOCAL and SELECT preserve actual origin count
PASS Q7-2 retained final recovery renders with empty scrollback
All focused final controls passed; accepted walkthrough was not replayed.
```

No permanent matrix/cases or previous successful scripts were rerun. Existing eight-new-case ceiling retained. Internal interpreter loops are the ordinary runtime, not authored workload request loops. No real timers used.

## Named check, build and approved exception

Executed named combined command ONCE for shared trace change,11.9096768s complete elapsed:

```text
npm.cmd test -- tests/data-python-sdk.test.js tests/data-capstone-core.test.js
✓ tests/data-python-sdk.test.js (15 tests)1089ms
❯ tests/data-capstone-core.test.js (6 tests |1 failed)4062ms
FAIL models zero PG demand for hits and cold concurrent pool pressure followed by bounded pool recovery
tests/data-capstone-core.test.js:166 expected historyWrites1; actual0
Test Files1 failed |1 passed(2)
Tests1 failed |20 passed(21)
Duration9.25s
```

Root cause: the existing simplified core fixture's sessions write omitted question; its optional QA write also omitted question/messageId/embedding. New F2 correctly refuses credit. Corrected those two fixture payloads to full request data with actual helper; did not weaken production checks, assertions or add cases. Controller explicitly authorized **one owning core file six-case rerun** because shared fixture reuse made a one-case run insufficient. No second SDK/combined21 run.

```text
npm.cmd test -- tests/data-capstone-core.test.js
✓ tests/data-capstone-core.test.js (6 tests)3855ms
Test Files1 passed(1)
Tests6 passed(6)
Duration8.84s
complete elapsed11.0822236s
```

Single permitted UI build,14.4760703s complete elapsed:

```text
npm.cmd run build
vite v6.4.3
✓568 modules transformed
✓built in12.29s
(!) Some chunks are larger than500kB after minification.
```

That advisory is preexisting M1, optimization deferred. No other build issue. SDK15 passed with same final production code; core6 passed after fixture correction. This is separate evidence, not a claimed second21-case pass. No build repeated after test-only fixture edit.

Staged whitespace check `git diff --cached --check` passed0.0862187s; only expected local LF-to-CRLF Git notices occurred during staging. Exact committed diff read/self-reviewed; no additional validation after commit.

## Exact budget

All new validations/setup failures/retries/build/static checks counted:

2.100866 +1.6955988 +1.8743666 +2.3176408 +1.6845817 +11.9096768 +14.4760703 +11.0822236 +0.0862187 = **47.2272433 seconds added measured**.

Prior measured434.0306137s +47.2272433s = **481.2578570s measured** (8.0209643min). Unknown reviewer probe retained as unknown; controller conservative allocation300s is separate, not measured duration or upper bound. **Accounted781.2578570s (13.0209643min)**. Below20min profiling/30min simplification thresholds. Discovery/source/diff reading, edits and Git commit are not assertion reruns; no omitted validation attempts.

## Self-review and limitations

Read exact six-file diff; verified F1 compares all parameters used by the existing capacity model and captured module pool/replicas, F2 independently binds question/message/embedding to actual writes while retaining prior provenance, F3 uses actual successful result kind and preserves SET LOCAL grouping, UI durable block has independent render condition. Reviewed fixture correction as required contract repair; no assertions removed. No other polish/refactoring or known blocking issue.

Current capacity equality is the intentionally supported final solution: restore proven settings rather than introducing a second fresh cold-final workload or relaxing historical flags. Final sealed/frozen recovery remains displayed during cleanup. Original accepted end-to-end walkthrough remains historical39f7ab5 evidence, not a new replay claim. Focused controls/new result metadata do not imply retroactive migration of historical saved measurement schemas.

Real cloud/network, browser interaction/layout/accessibility, legacy AKS/ACA/Data replay/full suites remain explicitly unverified/excluded. Compiled template SSR is minimal display validation, not browser coverage. Production cross-service transactions/concurrency/lease coordination and whole-save authentication remain unclaimed teaching-model boundaries. Supported parameterized multi-statement binding was not expanded. M1 bundle advisory deferred. Final scoped review/controller approval pending; integration/publishing not authorized or performed.

## Archived final-fix-review.md

# Final scoped review

Reviewer /root/capstone_final_fixreview, range7440a6a..bd3443a. All findings addressed; no new breakage/outside observations;0s validation.

- F1 ADDRESSED bridge85–96 all actual capacity/mode/pool/replicas checks, lab225 enforced. evaluate59–62/stages262–263 preserve validated frozen historical proof aftercleanup.
- F2 ADDRESSED bridge136–148 actual successful exact upsert/revision/scope/session/answer/sources plus question, QAmessage/requestedembedding. Consumed reads150–166 intact.
- F3 ADDRESSED runtime525 actual statementkind, bridge169 successful select count, cachehits0/comments/groupedSELECT valid.
- Q7-2 ADDRESSED panel69–70 durable recovery outside scrollbackresult.
- Report11 focused RED/GREEN controls checked against actual source; SDK15pass infailedfixture20/21 truthfully preserved then fixturecorrect/core6pass; onebuildgreenM1existingadvisory. No reruns.

Measured481.257857s, separate conservative allocation300s for unknown-duration probe, accounted781.257857s. No residual blocking finding.

## Archived final-review.md

# Wholebranch final review

Reviewer /root/capstone_final_review, range36d8cbc..7440a6a. With fixes; no Critical. Strong composite captured runtime, field provenance, source/evidence seals and exact protected ownership. Truthful historical walkthrough vs focused checks.

Important:

- F1 lab107/223, incidents211: resolved pool status historical; final individual answer scenario lacks fresh cold capacity or current settings equality. Actual public max_connections10 succeeds; model then417/1000failures,116.6RPS. Subsequent final proof/freeze acceptance static conclusion only, tail output lost. Require capacity-affecting current settings/replicas/deployed pool agreement with recovery or bounded fresh cold proof if changed.
- F2 bridge121–132, lab161/187/223: actual historywrites omit checking question; missingquestion can receive credit. Require item.question===args0 and QA message identity/requested-question embedding when certifying record.
- F3 bridge152/runtime525: /^SELECT/ raw text misclassifies supported comments or SET LOCAL;SELECT actual retrieval as zero origin. Carry successful executed statement/result kind in trace and count structured actual SELECT results. Existing parser comment support pg-sql24–38 confirmed; no extra probe.

Minor Q7-2 panel59/68 retained recovery nested under scrollback result hides afterclear; render durable separately. M1 existing bundle advisory deferred.

Validation: one detached probe initial yield~10.4s, exact tail/stopwatch not collected. Later relevant process absent14:58:16.833+03. Controller charges300s conservative allocation, not measured elapsed/upper bound; unknown timing explicitly retained. No suite/build/full replay.

Declined to judge and controller dispositions:

1. Real Azure/SDK/network: excluded simulator scope, unverified.
2. Production concurrency/leasecoordination/crossserviceatomicity: teaching models, unclaimed.
3. Browser interaction/layout/accessibility execution: static UI review only, unverified.
4. LegacyAKS/ACA/Data/replay/full suites: explicit exclusions retained.
5. Fresh full walkthrough/build7440a6a: historical39f7ab5 plus focused checks only; no fresh claim.
6. Coordinated whole-save rewrite authentication: unclaimed; ordinary consistency reviewed.
7. Alternate incident-source shapes beyond declared prerequisites: bounded approved prerequisites, no generalized rewrite.
8. Bundle optimization: baselineM1 deferred, no regression established.
9. Merge/push/publication: awaiting user's integration choice.

Focused outside-diff checks retained snapshot/pool model/artifactvalidator/SQLcomment tokenizer. No further checks. Controller dispositions and costs recorded as chronological rulings in progress ledger.

## Archived task-1-fixreview-1.md

# Task 1 scoped fix review 1

Reviewer /root/capstone_task1_fixreview, range 63c307c..cc18ab3.

Q1 ADDRESSED: python-sdk.js:130–147 protects import history, 454–458,487 resolves identities; foreign/conflicting imports covered.
Q2 ADDRESSED: runtime.js:467–480 sequential successful settings correctly snapshot LOCAL and clear on ordinary SET; four reported sequences covered.

New Important Q3: python-sdk.js:458 unaliased dotted import `import psycopg.types.json` then `psycopg.types.json.Jsonb` duplicates module path and becomes DATA_UNSUPPORTED (prior supported). Normalize root module binding with identity validation. From-import and dotted alias controls pass. Focused readonly parser probe 0.1287012s; no repeated suite. Report15/15 output verified. No out-of-scope observations. Verdict findings remain open: Q3.

## Archived task-1-fixreview-2.md

# Task 1 scoped fix review 2

Reviewer /root/capstone_task1_fixreview2, range cc18ab3..22439e5.

Q3 ADDRESSED python-sdk.js:258; unaliased dottedimports normalize root, aliases/fromimports full identity. Tests:130–141 cover; report15/15 GREEN.

New Important Q4: python-sdk.js:258,133; normalized root pgvector absent trustedConstructors130. `import pgvector.psycopg; def probe(pgvector): return pgvector.psycopg.register_vector(None)` accepts trustedpostgres.register_vector despite parameter shadowing. Protect supported constructor roots. Equivalentpsycopg shadowing rejects. Readonly focusedparserprobe0.139s; nosuite. Outofscope None; verdict Q4open.

## Archived task-1-fixreview-3.md

# Task 1 scoped fix review 3

Reviewer /root/capstone_task1_fixreview3, range 22439e5..aa428bf.

Q4 ADDRESSED python-sdk.js:130,458 identity prefixes protect pgvector root/modulealiases/directimports; import-history rejection132–147 retained; tests144–156 positiveexecution/shadowing. No newbreakage or outofscope. ReportnamedSDK15/15 checked; no testsrerun/additionaltime0s. Verdict allfindingsaddressed noCritical/Importantbreakage.

## Archived task-1-quality-review.md

# Task 1 quality review

Reviewer /root/capstone_task1_quality, gpt-6.1-sol high. Range 36d8cbc..63c307c.

Spec issues found; task quality Needs fixes. No Critical/Minor findings. Strengths: runtime.js:73,109 and targets.js:16 gate complete target/profile and initialize once; SDK tests:76,88,99 preserve origins through codecs/local returns/Cosmos writes and reject literal certification; tests:73–82 exercise actual three-service state.

Important Q1 — python-sdk.js:130,473. Protection derives constructor names from final import binding, but PG_CONSTRUCTORS trusts raw spelling. Both foreign ConnectionPool import and trusted import followed by foreign rebinding parse diagnostics=[] and capture postgres.pool.ConnectionPool. Resolve composite constructor calls from validated identities and detect conflicting imports independently of final binding.

Important Q2 — runtime.js:416,467. Snapshots precede entire SQL batch and ignore subsequent ordinary SET. Pooled same-execute SET relaxed_order then SET LOCAL strict_order closes settings={} whereas separate executes preserve relaxed_order. LOCAL then ordinary SET also closes settings={}. Track restoration sequentially and retain ordinary session settings.

Cannot verify Task 2 profile / Task 3 capability gate: tracked downstream obligations. Outside-diff focused check pg-engine.js:241,257 confirms sequential setting application/session copying. Read-only Node probes Q1 0.116386s + Q2 0.1086422s = 0.2250282s. No suites/git/mutations/subagents; only truncated diff sections recovered.

## Archived task-1-report.md

# Task 1 report: trusted composite SDK targets

Status: DONE. Implemented in the isolated `codex/data-capstone` worktree. No subagents, external reviewers, install, merge, push, build, browser, AKS, ACA, or full-suite runs were performed by this implementer.

Commit: `63c307c6cc46c5bd0dc5dc0111f293574e518f21` — `feat(data): add trusted composite SDK targets`. The six production/test files are committed; this report remains in the intentionally ignored `.superpowers/sdd` working directory. Tracked worktree is clean after the commit.

## Result and changed files

- `src/lib/data/targets.js`: exports `dataTargetFor(target, backend)` and `compositeTargetMatches(expected, actual)`. Backend resolution accepts `postgres`, `cosmos`, and `redis`; composite children require their service identity fields. An omitted composite Redis database resolves to `default`. Legacy targets preserve their existing field behavior.
- `src/lib/data/python-sdk.js`: explicitly selects composite mode only from the trusted manifest, captures one shared globals/clientOps set, lowers PG, Redis, and Cosmos construction through the shared SDK catalog, validates literal Cosmos wiring, preserves imported constructor/helper protections, and defines the narrow static helper profiles.
- `src/lib/data/runtime.js`: initializes composite clients once, routes each SDK family to its target, validates the captured composite target, combines connection/training/Redis evidence, supports actual PG-row origins through codecs and local returns, and restores connection-local settings on close.
- `src/lib/data/redis-runtime.js`: resolves composite Redis targets through the shared resolver and allows the protected codec/key/vector subset while rejecting composite `source_answer`.
- `src/lib/data/pg-sql.js`: recognizes the bounded `SET LOCAL <existing-setting> = <existing-value>` form with the existing allowlists and value validation.
- `tests/data-python-sdk.test.js`: exactly two new cases, with local inline mixed files/manifest and one small seeded document row, Redis database, and Cosmos sessions container. The first proves PG SELECT, binary SET/GET, Cosmos UPSERT/change feed, cache provenance after the side effect, and actual PG-row provenance through encode/decode/local returns. The second proves equal-literal rejection, single-service/composite gate rejection, target mismatch rejection, forbidden source helper rejection, invalid database wiring rejection, and captured consistency for a Cosmos constructor alias.
- This task report.

## Produced interfaces for Task 2 and callers

The temporary Task 1 manifest contract is:

```js
{
  dataApp: true,
  dataBackend: 'composite',
  id: 'data-python-capstone-v1',
  dataTarget: DATA_CAPSTONE_TARGET, // authored literal expected target
  helperProfile: 'redis-codecs',
  runtimeFiles: ['training_runtime.py'],
  fixedFiles: REDIS_HELPER_FILES,
  runtimeFunctions: ['response_key', 'semantic_key', 'encode_answer',
    'decode_answer', 'pack_embedding', 'decode_search', 'embed'],
  receivers: { sessions: 'cosmos-container' },
  // existing editZones/routes contracts also apply
}
```

The captured app contains `data.composite = {version:1, globals, clientOps, fixture:'capstone', helperProfile, target, containers}`. `target` is detached from `manifest.dataTarget`; `containers` maps each declared receiver to its same-named container. Existing `data.postgres` and `data.redis` captures remain available to adapters, but only `composite.clientOps` initializes a composite request. A single-service capture cannot execute with a composite runtime target, nor can a composite capture execute with a single-service or foreign composite target.

Composite Cosmos wiring requires one imported `CosmosClient` (aliases supported), URL `https://<target.cosmos.account>.documents.azure.com:443/`, credential `training-only-key`, a supported literal consistency when supplied, the declared database id, and a literal binding for every declared container receiver. Unsupported dynamic wiring fails closed. The training key stays out of returned client/evidence records. Cosmos constructors are not lowered as PG constructors.

PostgreSQL server and database must match the captured authored identity. Per controller ruling, captured PG DSNs may use ports **5432 or 6432**; `target.postgres.port` identifies the default service endpoint and does not exclude the supported PgBouncer endpoint. Legacy single-service DSN behavior is preserved. `SET LOCAL` values are scoped to the current connection and restored/discarded when that context closes; existing `SET` remains supported.

`runDataFunction` retains its signature. Composite results include existing `sandbox`, `status`, `value`, `calls`, `totalCharge`, plus `connections`, `trainingCalls`, `trainingTraceTruncated`, and `redis`. Provenance is still detached interpreter metadata in `redis.returnProvenance`: Redis GET/search/source origins preserve their legacy shapes; actual PG fetch origins use `{kind:'postgres', callIndex}` where the index addresses unified `calls`. Literal reconstruction never inherits an origin from incidental calls. The legacy `training_answer` builtin records training evidence but does not fabricate a PG origin from a literal context. No global mutable request/interpreter state is introduced.

Task 2 should add its canonical capstone module to the small static `HELPER_PROFILES` boundary and narrowly integrate its fixture-aware embedding/answer helper handling, as authorized by the controller. There is intentionally no arbitrary evaluator callback registry and no Task 1 import of future Task 2 files. `source_answer` remains forbidden for composite targets even though the current canonical Redis helper file contains that function. Capability checks belong to the upcoming caller bridge; this interpreter requires the captured manifest/profile/target contract.

## RED/GREEN evidence and timings

Every test run used exactly:

```text
npm.cmd test -- tests/data-python-sdk.test.js
```

PowerShell `Stopwatch` measured the full command's wall time; no test or build ran outside this named file.

| Run | Result | Wall seconds |
| --- | --- | ---: |
| Supplied baseline, before this implementer | 13 passed | 1.9780000 |
| 1: RED, missing composite lowering | 2 failed, 13 passed | 1.7582070 |
| 2: integrated attempt, fixture region shape | 2 failed, 13 passed | 7.5252928 |
| 3: integrated attempt, unresolved Redis default database | 2 failed, 13 passed | 1.7957163 |
| 4: diagnostic assertion run, same Redis error exposed | 2 failed, 13 passed | 1.6866922 |
| 5: Redis resolved, fixture table-array assertion | 1 failed, 14 passed | 1.7550357 |
| 6: GREEN | 15 passed | 1.6936609 |
| 7: PG-origin and foreign-target assertions included | 15 passed | 1.6865700 |
| 8: RED for Cosmos alias consistency capture | 1 failed, 14 passed | 1.6869289 |
| 9: GREEN, consistency/profile review fixes | 15 passed | 1.6791630 |
| 10: final GREEN after supported-port ruling | 15 passed | 1.7098769 |

Agent-local test wall total: **22.9771437 seconds**. Including supplied baseline: **24.9551437 seconds**.

Static whitespace validation also passed: an inspection command bundled with `git diff --check` took 0.1061045 seconds (tool wall time, includes reading diffs); a separately timed final `git diff --check` took 0.0484696 seconds. Counting both static checks, total agent verification wall time is **23.1317178 seconds**, or **25.1097178 seconds** with the supplied baseline.

Initial RED output:

```text
RUN v2.1.9 .../data-capstone
tests/data-python-sdk.test.js (15 tests | 2 failed)
Both new cases: expected diagnostics []
Received DATA_UNSUPPORTED at app.py:5:9:
  Not supported by the simulator: this method call
Test Files 1 failed (1)
Tests 2 failed | 13 passed (15)
Duration 863ms
VALIDATION_WALL_SECONDS=1.758207
Exit code 1
```

This failure is at the first `conn.execute` in the mixed function, before fixture execution, and demonstrates missing mixed lowering. Later attempts exposed and corrected test setup details (Cosmos locations uses `{regionName:'eastus'}`; PG tables are an array), and the shared Redis target resolver now supplies the default database required by the existing Redis engine. The alias regression was reproduced before its production fix:

```text
tests/data-python-sdk.test.js (15 tests | 1 failed)
Expected 'Eventual'; received null for captured constructor-alias consistency.
Tests 1 failed | 14 passed (15)
VALIDATION_WALL_SECONDS=1.6869289
Exit code 1
```

Final GREEN output:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-python-sdk.test.js
RUN v2.1.9 .../data-capstone
✓ tests/data-python-sdk.test.js (15 tests) 245ms
Test Files 1 passed (1)
Tests 15 passed (15)
Duration 880ms (transform 168ms, setup 0ms, collect 305ms,
  tests 245ms, environment 0ms, prepare 107ms)
VALIDATION_WALL_SECONDS=1.7098769
Exit code 0
```

Final `git diff --check`: exit 0; Git emits the repository's LF-to-CRLF working-copy notices, with no whitespace errors.

## Self-review gates and concerns

Spec self-review: checked every Task 1 brief requirement against the changes; shared captured globals, target routing, canonical helper profile, unsupported-source guard, literal Cosmos wiring, connection-local settings, provenance, and all three evidence families are implemented. Exactly two new `it` cases; no future fixture imports; named-only validation respected.

Quality self-review: inspected the exact diff and new resolver; all request state and provenance stay in the per-request context, client initialization executes once, returned evidence does not include client credentials, literal returns lose provenance, Cosmos history writes do not overwrite the saved answer's origin, and existing 13 cases remain green. The constructor-alias consistency issue found during review is fixed and covered within the second case.

No known blocking concern. The canonical capstone corpus/module and its answer/embedding profile are intentionally Task 2 work. This prerequisite does not claim whole-capstone, browser, build, AKS, ACA, or broad-suite validation. Per-controller independent spec/quality review remains external to this implementer report.

## Review fix round 1: import identity and sequential LOCAL restoration

Fix base: `63c307c6cc46c5bd0dc5dc0111f293574e518f21`. Read the receiving-code-review and systematic-debugging skill instructions fully before investigating. Both quality findings were verified against the implementation and reproduced independently, then fixed one at a time. Scope is exactly these two defects; no cases, suites, builds, framework hooks, or unrelated cleanup were added.

### Defect 1: foreign constructor imports gained trusted PG identity

Reproduction was folded into the existing second mixed case. Replacing the pool import with `from unrelated import ConnectionPool`, or a trusted `psycopg_pool` import followed by that foreign same-name import, previously returned diagnostics `[]` and captured `postgres.pool.ConnectionPool`. The test also retains the opposite import order as a control: conflicting imports must fail regardless of which binding is final.

Root cause: composite PG constructor lowering still used `PG_CONSTRUCTORS[raw(callee)]`, granting authority from the spelling `ConnectionPool`. Constructor-rebinding protection built its protected-name set from only the final `importBindings` map; a foreign final import removed the formerly trusted name from that set. The inverse import order happened to be rejected because its final binding remained trusted.

Fix: composite PG constructor resolution now resolves the callee root through its parsed imported identity before looking up the shared PG catalog mapping. The raw-name legacy path is preserved for non-composite manifests. Composite constructor protection gathers trusted constructor names across the parsed import history, including module/function aliases; a later or earlier conflicting import cannot erase that protection. No generic registry or evaluator framework was introduced.

RED command/output:

```text
npm.cmd test -- tests/data-python-sdk.test.js
tests/data-python-sdk.test.js (15 tests | 1 failed)
from unrelated import ConnectionPool: expected diagnostic true, received false
from psycopg_pool import ConnectionPool / from unrelated import ConnectionPool:
  expected diagnostic true, received false
Both variants captured a non-null trusted appSpec instead of rejecting it.
Tests 1 failed | 14 passed (15)
VALIDATION_WALL_SECONDS=1.802713
Exit 1
```

The initial failed appSpec assertion printed a verbose capture; it was replaced with a boolean null check to keep future failures concise, without changing the expected behavior.

GREEN after the import fix:

```text
npm.cmd test -- tests/data-python-sdk.test.js
✓ tests/data-python-sdk.test.js (15 tests) 278ms
Test Files 1 passed (1)
Tests 15 passed (15)
Duration 838ms
VALIDATION_WALL_SECONDS=1.669152
Exit 0
```

### Defect 2: ordinary settings were erased when LOCAL overrides closed

Reproduction was folded into the existing first mixed case, using its already seeded sandbox and pool. A local, test-only interpreter probe returns the pool's retained simulator settings after the connection closes. This introspection is solely a shared-core regression fixture; it is not authored learner code or a new production test harness.

Four setting sequences are covered with hand-written expected result `{'hnsw.iterative_scan':'relaxed_order'}`:

1. Ordinary `SET relaxed_order`, then `SET LOCAL strict_order` in one `execute` batch.
2. The same sequence in two separate `execute` calls (the previously passing control).
3. `SET LOCAL strict_order`, then ordinary `SET relaxed_order` in one batch.
4. The same LOCAL-then-ordinary sequence in separate calls.

Root cause: LOCAL restoration captured rollback values before the entire SQL batch. An earlier ordinary setting in that batch was therefore absent from the snapshot. A later successful ordinary `SET` also failed to remove an outstanding LOCAL restoration entry, so connection close restored the old value or deleted the new ordinary value.

Fix: retain the settings present before the current statement and walk the actual execution results in order. Only successful `set` results update restoration bookkeeping. The first LOCAL override remembers the prior value; subsequent ordinary SET removes that restoration entry. Shared `bindParams` and `evaluatePgExpression` resolve the setting value using the same bounded SQL semantics as the engine, instead of adding a second setting grammar. Failed statements cannot advance restoration bookkeeping. Connection close keeps its existing restoration mechanism.

RED command/output:

```text
npm.cmd test -- tests/data-python-sdk.test.js
tests/data-python-sdk.test.js (15 tests | 1 failed)
Three failing sequences returned {} instead of
  {'hnsw.iterative_scan':'relaxed_order'}:
  ordinary SET then LOCAL in one batch
  LOCAL then ordinary SET in one batch
  LOCAL then ordinary SET in separate executes
The separate ordinary SET then LOCAL control passed.
Tests 1 failed | 14 passed (15)
VALIDATION_WALL_SECONDS=1.7190448
Exit 1
```

Final GREEN after the restoration fix:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-python-sdk.test.js
RUN v2.1.9 .../data-capstone
✓ tests/data-python-sdk.test.js (15 tests) 291ms
Test Files 1 passed (1)
Tests 15 passed (15)
Duration 880ms (transform 170ms, setup 0ms, collect 294ms,
  tests 291ms, environment 0ms, prepare 105ms)
VALIDATION_WALL_SECONDS=1.6910289
Exit 0
```

Round 1 files changed: `python-sdk.js`, `runtime.js`, and the existing `tests/data-python-sdk.test.js`; the test file remains at 15 cases (13 original plus the two permitted composite cases). Self-review inspected the exact three-file diff. Final `git diff --check` passed, timed at **0.047768 seconds**, with only the usual LF/CRLF notices.

Round 1 added test wall total: **6.8819387 seconds**. Including its static check: **6.9297067 seconds**. Task 1 cumulative agent-local test wall total: **29.8590824 seconds**; cumulative agent-local verification including static checks: **30.0614245 seconds**; including the supplied original baseline: **32.0394245 seconds**. Controller/reviewer verification time outside this implementer is not included here.

Both reproduced defects are fixed and covered; no known remaining issue in this review round. Whole-suite/build/AKS/ACA/browser validation remains intentionally outside the authorized checks.

Round 1 commit: `cc18ab3d136360de25e951b746579b8256375cc5` — `fix(data): validate composite imports and local settings`. Tracked worktree clean after commit; this appended report remains in the ignored task directory.

## Review fix round 2: unaliased dotted Python imports

Fix base: `cc18ab3d136360de25e951b746579b8256375cc5`. The reviewed regression was traced through the parsed import-binding map into `pgConstructorKey`. The debugging/TDD process reproduced it before changing production code. No additional test case, product feature, suite, build, browser, AKS, ACA, or subagent work was introduced.

Root cause: `redisImportEntries` correctly named the local binding `psycopg` for `import psycopg.types.json`, but stored its identity as `psycopg.types.json`. The new composite constructor resolver appended the callee's members `types.json.Jsonb`, yielding the incorrect identity `psycopg.types.json.types.json.Jsonb`. Python instead binds the root package for an unaliased dotted import; explicit aliases bind the full imported module.

Reproduction and controls were folded into the existing second mixed case. It now parses and executes `Jsonb({"kind":"article"})` using each of three import forms: unaliased `import psycopg.types.json`, direct `from psycopg.types.json import Jsonb`, and `import psycopg.types.json as json_sdk`. Each successful runtime result retains the supplied adapted object value. The prior foreign and conflicting constructor-import rejection assertions remain in that same case.

RED output:

```text
npm.cmd test -- tests/data-python-sdk.test.js
tests/data-python-sdk.test.js (15 tests | 1 failed)
import psycopg.types.json: expected diagnostics [], received DATA_UNSUPPORTED:
  the unknown name 'psycopg'
  this method call
at app.py:19:12
The direct from-import and aliased dotted-import controls passed.
Test Files 1 failed (1)
Tests 1 failed | 14 passed (15)
Duration 956ms
VALIDATION_WALL_SECONDS=1.8308611
Exit 1
```

Fix: composite parsed imports normalize an unaliased `import package.submodule` identity to `package`; aliased and from-import identities keep their full paths. Constructor protection scans and final-binding comparisons use the same normalization, preserving conflicting-import rejection. Non-composite imports retain their previous behavior. Constructor execution still requires the validated imported identity and has no raw-name fallback.

Final GREEN output:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-python-sdk.test.js
RUN v2.1.9 .../data-capstone
✓ tests/data-python-sdk.test.js (15 tests) 325ms
Test Files 1 passed (1)
Tests 15 passed (15)
Duration 954ms (transform 182ms, setup 0ms, collect 339ms,
  tests 325ms, environment 0ms, prepare 85ms)
VALIDATION_WALL_SECONDS=1.7938555
Exit 0
```

Changed files: `src/lib/data/python-sdk.js` and `tests/data-python-sdk.test.js`. Exact production diff inspected; final `git diff --check` passed in **0.0420829 seconds**, with only the usual LF/CRLF notices. The file remains at 15 cases: the original 13 and the two permitted mixed cases.

Round 2 test wall total: **3.6247166 seconds**; including static check: **3.6667995 seconds**. Cumulative implementer test wall: **33.4837990 seconds**. Cumulative implementer verification wall including static checks: **33.7282240 seconds**, or **35.7062240 seconds** with the supplied baseline. External controller/reviewer time is excluded.

The reproduced import regression is fixed. No remaining concern for this scoped review finding.

Round 2 commit: `22439e5fae86efcda9b452b2b2e1ed951a044509` — `fix(data): normalize composite dotted import roots`. Tracked worktree clean after commit; report remains in the ignored task directory.

## Review fix round 3: protect every supported imported PG root

Fix base: `22439e5fae86efcda9b452b2b2e1ed951a044509`. Investigated the normalized import map and constructor guard before implementing. The earlier root-normalization fix enabled `pgvector.psycopg.register_vector`, but protection still used a manually enumerated list containing only the fully qualified `pgvector.psycopg.register_vector` identity. It omitted both normalized root `pgvector` and aliased-module identity `pgvector.psycopg`.

Root cause: constructor resolution and immutable-name protection recognized different identity sets. As a result, `import pgvector.psycopg` followed by a function parameter named `pgvector` still lowered to trusted `postgres.register_vector`; the explicit module alias could also be shadowed. The direct from-import was already protected and served as a control.

RED assertions were added inside the existing second mixed case, without adding a new test case. They require DATA_UNSUPPORTED and null appSpec when a parameter shadows each of the module root, module alias, and from-import function. RED output:

```text
npm.cmd test -- tests/data-python-sdk.test.js
tests/data-python-sdk.test.js (15 tests | 1 failed)
import pgvector.psycopg: expected diagnostic/null-capture true, received false
import pgvector.psycopg as vector_sdk:
  expected diagnostic/null-capture true, received false
The direct register_vector from-import shadowing control passed.
Test Files 1 failed (1)
Tests 1 failed | 14 passed (15)
Duration 927ms
VALIDATION_WALL_SECONDS=1.7875348
Exit 1
```

Fix: derive `PG_IMPORT_IDENTITIES` from the finite, supported qualified keys in `PG_CONSTRUCTORS`, including every module prefix and the callable identity. The composite constructor guard uses this derived identity set for normalized roots, aliases, from-imports, and import-history conflict checks. This covers `pgvector`, `pgvector.psycopg`, and the equivalent supported psycopg/JSON/pool module prefixes without a generic framework or raw-name fallback. The non-composite guard path remains unchanged.

Positive registration controls are in the same second case: unaliased module, explicit module alias, and direct from-import each execute `register_vector` against an actual open connection and return status 200. Existing JSON import-form controls and foreign/conflicting-import guards remain active. Final GREEN output:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-python-sdk.test.js
RUN v2.1.9 .../data-capstone
✓ tests/data-python-sdk.test.js (15 tests) 356ms
Test Files 1 passed (1)
Tests 15 passed (15)
Duration 926ms (transform 167ms, setup 0ms, collect 293ms,
  tests 356ms, environment 0ms, prepare 83ms)
VALIDATION_WALL_SECONDS=1.7758453
Exit 0
```

Changed files: `src/lib/data/python-sdk.js` and `tests/data-python-sdk.test.js`. Self-review inspected the exact production diff: protection is derived solely from bounded known identities; initialization remains request-local; no arbitrary constructors or callbacks were introduced; previous import/setting tests remain green. Final `git diff --check` passed in **0.0453968 seconds** with only the usual LF/CRLF notices. There remain exactly 15 test cases.

Round 3 added test wall: **3.5633801 seconds**; including static check: **3.6087769 seconds**. Cumulative implementer test wall: **37.0471791 seconds**. Cumulative implementer verification wall: **37.3370009 seconds**, or **39.3150009 seconds** with the supplied baseline. The reported reviewer reproduction of 0.139 seconds is external to these implementer totals and is available for the controller's aggregate ledger.

The reproduced shadowing defect is fixed and covered. No additional review work or broad validation was dispatched.

Round 3 commit: `aa428bf28d39152263a89aba337231310c25d4df` — `fix(data): protect supported composite constructor roots`. Tracked worktree clean after commit; report remains in the ignored task directory.

## Archived task-1-spec-review.md

# Task 1 spec review

Reviewer /root/capstone_task1_spec, gpt-6.1-sol high. Range 36d8cbc..63c307c.

Spec compliant; quality approved within spec seat. No Critical, Important or Minor findings. All six required files changed. Captured manifest/profile/target gate: python-sdk.js:46, runtime.js:70, targets.js:16. Routing, single initialization, literal Cosmos wiring and bounded SET LOCAL: python-sdk.js:174,471; runtime.js:108,340,420; pg-sql.js:288. Tests prove actual Redis bytes, Cosmos writes/change log, closed connection, cache and PG origins, plus negative literal/target/helper/wiring gates (data-python-sdk.test.js:66,91).

Cannot verify broad legacy preservation from task diff: supplied named SDK run covers 13 existing cases; broader suites intentionally excluded by user. Canonical capstone helper profile belongs Task 2 and caller capability gate belongs Task 3, tracked as downstream obligations, not Task 1 omissions.

Read-only package review; recovered output-truncated sections only. No git, mutations, subagents or tests. Additional validation: 0 seconds.

## Archived task-2-fixreview-1.md

# Task 2 scoped fix review 1

Fresh /root/capstone_task2_fixreview range15519ab..d3b94ca. S1 ADDRESSEDcapstone.js86 listmaterialization; S2 ADDRESSEDfixture12–14 sharedfinitepattern/Pythonhelper13–16/profileonlyRedisruntime172legacypaths preserved. No newbreakage/outofscope. RecordedGREENactualPythonserialization/whitespace/independentSHA256/vectors/fixturecontrol reviewed. No tests/build repeated,0s. Verdictallfindingsaddressed noCritical/Importantbreakage.

## Archived task-2-quality-review.md

# Task 2 quality review

Reviewer /root/review_planner (idle nonimplementing reviewer reused dueplatformthreadlimit), range aa428bf..15519ab. Spec Issues found, quality Needs fixes; twoImportant sameS1/S2as specseat.

S1 capstone.js86,158: query_items pagediterable notJSONserializable byrealhost; boundedlistmaterializationneeded. OfficialContainerProxyreference https://learn.microsoft.com/en-us/python/api/azure-cosmos/azure.cosmos.container.containerproxy?view=azure-python#query-items.
S2 capstone-runtime.js14 / fixturecapstone.js10 / redis-runtime.js10: split vsJSwhitespace acceptedU+0085key/vector mismatch; explicitsharednormalizationneeded.

Strengths stableproductoverlaysfixture67; checkpointorderingcapstone116; fixedparsedwrapperguardsSDK72; DockerhostsSDKs/routescapstone244. Noadditionalblockers; actualnetworkSDKnotrun, officialreturnreferencechecked. Task3bridge/Task7catalogoutsidegate. ExistingVitechunkwarning nochange. Readonlydiffonce, cut-offfunction/reusedPGretrieval/cache/codecs/changefeedrisks focusedonly. No tests/build/subagents/mutations, additionaltime0s.

## Archived task-2-report.md

# Lab 13 Task 2 implementer report

Status: DONE. Base: `aa428bf28d39152263a89aba337231310c25d4df`. Scope is Task 2 only. No permanent test case/file, Azure call, browser, AKS/ACA test, legacy capstone suite, package install, merge, push, or publication was performed. Used the implementer, TDD/writing-good-tests, systematic-debugging, and verification-before-completion instructions; the user's explicitly restricted verification replaces broad suite instructions.

## Implementation and interfaces

- `src/data/fixtures/data/capstone.js`: `CAPSTONE_CORPUS`, `CAPSTONE_QUESTIONS`, `CAPSTONE_REVISION_2`, `capstoneExpectedAnswer(question, scope, revision=1)`, plus `capstoneEmbed(question, deployment='embeddings-v1')`, `capstoneTrainingAnswer(question, context)`, `capstoneCorpusRevision(liveCorpus, product, revision=2)`, `capstoneNormalize`, `CAPSTONE_NO_MATCH`.
- Starts from `CORPUS`/`corpusQuestions`, preserving original primary/foreign keys and Backup v1 35/v2 45-day rows. Adds actual Support diagnostic-retention and four scoped early-deletion document/chunk pairs. Canonical/paraphrase/scoped entries carry expected PG IDs; near misses rank their own rows. Eight-dimensional normalized vectors are shared by PG, Redis, and Cosmos. The PG-only misleading Support-hours embedding is restored to its hours direction so the new Support retention topic ranks correctly.
- Product-specific revision-2 overlays preserve live unrelated rows and earlier other-product updates. Backup v1 English/German changes to 14 days; Support v1 English escalation changes to exactly `Set priority to Sev1 and use Request senior engineer review in the ticket panel.` IDs and scope metadata remain stable.
- The grading oracle is never imported by application runtime. The application helper returns the first actual passage from its returned context, with nonempty source/context validation; it has no canned ID-to-answer lookup. A changed PG passage changes its answer immediately.
- `src/data/templates/data-python/capstone-runtime.js`: exports exact `CAPSTONE_HELPER_FILES`, `CAPSTONE_HELPER_ARITIES`, `CAPSTONE_RUNTIME_MANIFEST`. Helpers: `response_key(4)`, `semantic_key(4)`, `encode_answer(1)`, `decode_answer(1)`, `pack_embedding(1)`, `decode_search(1)`, `embed(1|2)`, `training_answer(2)`. No `source_answer`. Real Python UTF-8/SHA256/compact JSON/little-endian FLOAT32 codecs mirror existing JS runtime contracts and consume the same coherent vector mapping.
- `src/data/templates/data-python/capstone.js`: exports `DATA_CAPSTONE_TARGET`, `DATA_CAPSTONE_MANIFEST`, `DATA_CAPSTONE_STARTER_FILES`, `DATA_CAPSTONE_SOLUTION_FILES`, `DATA_CAPSTONE_SOLUTION_FUNCTIONS`, `DATA_CAPSTONE_EDIT_ZONES`, `DATA_CAPSTONE_ROUTES`, `DATA_CAPSTONE_ROUTE_ARGS`, `DATA_CAPSTONE_SCHEMA`, `DATA_CAPSTONE_POLICIES`.
- Manifest ID `data-python-capstone-v1`, composite target matches the binding context; helper profile is `capstone`. All 17 edit zones exist with unsolved starter bodies. The shared `clients.py` remains editable and starts with direct PG connections for the learner's pooling repair; Task 1's captured target validation remains active, including 5432/6432 support.
- Project includes app/worker/clients/training runtime/API host/worker host/Docker/schema/API+worker deployments/service and three Cosmos policy files. Docker installs all five SDK packages and copies both hosts. API runs `python server.py`; worker manifest runs `python worker_server.py`, which polls `process_changes()` outside edit zones and retries failed batches without changing the lease.
- Solution composes the existing PG retrieval/context and Redis semantic/invalidation functions. Retrieval uses parameterized filtered PG SQL and `SET LOCAL hnsw.iterative_scan = strict_order`. Every cache miss uses `rag_answer`. Fixed `cache_lookup` is ordinary parsed Python: exact GET/decode, otherwise learner semantic lookup at 0.05. It is source-protected against edits, imports, duplicate definitions, assignments, and parameter shadowing, without an intrinsic canned hit.
- Sessions save deterministic message IDs, scope, answer, and actual sources on every request. History IDs are `session_id + ':' + message_id`, partitioned by product, and include the shared embedding. Similar history is a separate route with all three scope filters. Feedback uses `create_item` for immutable unique event IDs and positive/negative event types. Positive events do not invalidate. Worker imports the one app `invalidate_product`; document-update/negative-feedback invalidations complete before the durable `feedback-worker` lease is saved. Missing leases use a bounded query and `next(iter(rows), None)`, valid in Python and the simulator.
- Manifest routes and fixed API body argument contracts: answer(6), sessions(2), similar(4), feedback(3), worker batch(0), worker item(1). `routeArgs` exports the exact ordered names for the bridge.
- `manifests.js` registers the manifest. `python-sdk.js` adds the finite canonical helper profile and fixed parsed wrapper protection; `runtime.js` adds source-content helper selection/training evidence; `redis-runtime.js` selects the coherent embedding mapping. The legacy `redis-codecs` Task 1 profile is preserved for existing mixed-core cases. No callback/evaluator framework was introduced.
- `psql.js` recognizes only the exact trusted capstone manifest + `schema.sql` content, executes the declared tables then loads `CAPSTONE_CORPUS`. Vector extension and indexes are learner operations, absent from the schema/seed. `schema.js` narrowly permits its existing bounded container `command` under `dataCapstone` as well as `dataCosmos`.

## Controller ruling: cosine history acceptance

The existing shared Cosmos scorer returns cosine similarity and orders descending. The controller authorized the equivalent `similarity >= 0.95` predicate for the required `cosine distance <= 0.05` acceptance, preserving all three scope filters and the scorer. The function's source comment explains the conversion. The controller checked the official API reference, updated 2026-03-25: https://learn.microsoft.com/en-us/cosmos-db/query/vectordistance. This task makes no new core scoring model or actual Azure guarantee. The disposable probe demonstrates both foreign-scope and near-miss rejection.

## TDD and verification ledger

All disposable fixture runs used:

```text
node .superpowers/sdd/2026-10-02-data-lab-13-capstone/task-2-probe.mjs
```

PowerShell Stopwatch measures complete command wall time. The probe stays in the ignored task directory and is not committed. Its break is a missing or incoherent capstone fixture (wrong PG IDs, wrong scope, 30-day policy mismatch), plus concrete bounded-source/fixture integration defects. Expectations use literal IDs and hand-checked policy values; actual PG retrieval/history are exercised, not mocked.

| Run | Result | Wall seconds |
| --- | --- | ---: |
| 1 RED before production | coherent corpus absent | 0.0514560 |
| 2 integration | unsupported bare Boolean condition | 0.1167189 |
| 3 diagnostic, before condition fix | same bare Boolean condition | 0.1108409 |
| 4 | PG probe setup omitted extension allowlist | 0.1645627 |
| 5 | probe upsert omitted required options | 0.1729078 |
| 6 GREEN | ranks, scopes, PG revision, missing lease, Cosmos rejection | 0.1764402 |
| 7 RED self-review defect | fixed cache wrapper parameter shadow accepted | 0.1626748 |
| 8 fix attempt | Lezer node wrapper identity falsely flagged canonical definition | 0.0954401 |
| 9 GREEN | guard uses path/positions, canonical and shadow behavior correct | 0.1762095 |
| 10 final GREEN | includes exact named psql loader and whole-project/Docker contracts | 0.2084687 |
| One required build | passed; existing chunk-size warning | 15.9855388 |
| Final `git diff --cached --check` | passed | 0.0322813 |

Probe total **1.4357196 seconds**. Task 2 verification total **17.4535397 seconds**. Controller supplied prior aggregate **39.8079369 seconds**; combined aggregate is **57.2614766 seconds**. No other test/build/static-whitespace validation was run.

### Full initial RED output

```text
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: one coherent capstone corpus must exist; legacy Redis 30-day answers cannot supply PG fixtures
    at file:///E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-capstone/.superpowers/sdd/2026-10-02-data-lab-13-capstone/task-2-probe.mjs:4:8
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:636:26)
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '==',
  diff: 'simple'
}
Node.js v26.1.0
VALIDATION_WALL_SECONDS=0.051456
Exit 1
```

Expected because no capstone corpus/module existed before implementation. It rejects filling the feature by mixing Redis's old answer fixture with PG policies.

### Intermediate failures and corrections

Runs 2 and 3 each reported this sole diagnostic, with expected diagnostics `[]`:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ [
+   {
+     code: 'DATA_UNSUPPORTED',
+     column: 8,
+     line: 91,
+     message: 'Not supported by the simulator: VariableName',
+     path: 'app.py'
+   }
+ ]
- []
at task-2-probe.mjs:28:10
generatedMessage: true; code: ERR_ASSERTION; operator: deepStrictEqual; diff: simple
Node.js v26.1.0
VALIDATION_WALL_SECONDS=0.1167189 (run 2)
VALIDATION_WALL_SECONDS=0.1108409 (run 3)
Exit 1
```

Traced to canonical `if positive:`: lowerCondition requires a comparison. The source now uses `if positive == True`; no grammar expansion. The lease lookup was also changed to the supported optional query pattern following the controller's direction.

Run 4 output:

```text
Error: relation "documents" does not exist
    at fail (src/lib/data/pg-engine.js:7:82)
    at tableFor (src/lib/data/pg-engine.js:11:80)
    at loadCorpus (src/lib/data/pg-engine.js:288:19)
    at task-2-probe.mjs:44:11
code: ProgrammingError
Node.js v26.1.0
VALIDATION_WALL_SECONDS=0.1645627
Exit 1
```

Probe setup lacked the existing `azure.extensions=vector` allowlist; added it and asserted schema execution results before loading. Production was unchanged.

Run 5 output:

```text
TypeError: Cannot destructure property 'nowMs' of 'undefined' as it is undefined.
    at upsertItem (src/lib/data/cosmos-store.js:50:50)
    at task-2-probe.mjs:66:13
Node.js v26.1.0
VALIDATION_WALL_SECONDS=0.1729078
Exit 1
```

The direct test fixture call omitted upsertItem's required fourth `{nowMs}` argument; corrected the disposable setup only.

Run 7 RED output:

```text
AssertionError [ERR_ASSERTION]: fixed ordinary cache_lookup cannot be shadowed by a learner parameter
    at task-2-probe.mjs:41:8
generatedMessage: false; code: ERR_ASSERTION; actual: false; expected: true; operator: ==; diff: simple
Node.js v26.1.0
VALIDATION_WALL_SECONDS=0.1626748
Exit 1
```

Root cause: exact function-text protection did not reject a caller's same-named parameter. Added bounded parsed rebinding/import checks around the canonical ordinary definition.

Run 8 output:

```text
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ [{code:'SCAFFOLD_MODIFIED', column:1, line:1,
+   message:"Fixed scaffold function 'cache_lookup' must match its canonical definition.", path:'app.py'}]
- []
at task-2-probe.mjs:28:10
generatedMessage: true; code: ERR_ASSERTION; operator: deepStrictEqual; diff: simple
Node.js v26.1.0
VALIDATION_WALL_SECONDS=0.0954401
Exit 1
```

Root cause: Lezer returns distinct node wrapper objects during traversal. Comparing source file/from/to positions, rather than object identity, excludes precisely the canonical definition. Ordinary function lowering is unchanged.

### Full GREEN output

Runs 6, 9, and 10 each printed:

```text
PASS coherent PG ranks, paraphrase/near miss, scope answers, 35/45/14-day revisions, overlay preservation, bounded starter/solution parsing
```

Final run 10 complete output:

```text
PASS coherent PG ranks, paraphrase/near miss, scope answers, 35/45/14-day revisions, overlay preservation, bounded starter/solution parsing
VALIDATION_WALL_SECONDS=0.2084687
Exit 0
```

Final probe covers all authored question rank IDs, canonical/paraphrase equality, near-miss distinct IDs, same-wording scope answers, explicit 35/45/14-day policies, exact Support revision text, independent product overlays, actual PG rag outputs and revision/no-match behavior, whole starter/solution project parsing and Docker contract, ordinary wrapper shadow rejection, missing durable lease, exact named `psql -f schema.sql` fixture selection, and Cosmos rejection of near misses and foreign product/version/language history. No whole-capstone walkthrough or worker failure/restart replay was introduced; those belong to later task verification.

### Full required build output

Command: `npm.cmd run build` (once).

```text
> azure-trainer@0.1.0 build
> vite build

vite v6.4.3 building for production...
transforming...
✓ 558 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                       0.88 kB │ gzip:   0.46 kB
dist/assets/LabPage-3h2DwkTU.css     10.22 kB │ gzip:   1.90 kB
dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip:   8.25 kB
dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip:  38.44 kB
dist/assets/LabPage-BaZQVb7z.js     308.03 kB │ gzip:  79.49 kB
dist/assets/index-Di-79Ek1.js     2,447.52 kB │ gzip: 662.60 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 4.76s
VALIDATION_WALL_SECONDS=15.9855388
Exit 0
```

Final staged whitespace validation complete output:

```text
STATIC_VALIDATION_WALL_SECONDS=0.0322813
Exit 0
```

`git add` emitted the repository's usual LF-to-CRLF notices for these nine files; the whitespace check emitted no error.

## Self-review and concerns

Read the exact modified-file diff and each new fixture/template/helper file. Checked all 17 zones, all six route arities, scoped deterministic payloads, SDK package/COPY/worker entrypoint alignment, shared actual source content, stable product overlays, immutable events, checkpoint ordering, helper/wrapper protection, trusted schema selection, and unchanged single-service paths. No known blocking concern. The concrete cache_lookup shadowing issue found during self-review was reproduced then fixed before reporting.

The worker/API are an in-process training simulator with real Python scaffold files; no SDK network execution is claimed. The supplied protected helper's answer is the first retrieved passage, deliberately grounded in returned live content rather than a language-model paraphrase. The known Vite chunk-size warning remains. Fresh independent spec/quality reviews are the controller's responsibility. The report and disposable probe remain ignored, outside the commit.

Commit: `15519ab664ab5919a107e4aecb82c4326a28497b` — `feat(data): add cross-service Knowledge Assistant scaffold`. Post-commit `git status --short` produced no tracked/untracked output.

## Review fix round 1: paged history serialization and explicit whitespace parity

Fix base: `15519ab664ab5919a107e4aecb82c4326a28497b`. Read receiving-code-review completely; systematic-debugging/TDD/verification instructions already read in this task were followed. Both reviewer findings were reproduced before production changes. No permanent cases/files, SDK deployment, expanded suite, browser/AKS/ACA/legacy tests, framework, or rebuild was added.

S1 root cause: the real Cosmos `query_items` returns a paged iterable. The canonical `find_similar_questions` returned it directly, then fixed server `json.dumps` rejected it. The simulator returns arrays, so its existing contract control did not expose this. The canonical route now materializes `list(qa_history.query_items(...))`; scope predicates and threshold are unchanged. An actual Python execution of the exported function, supplied a minimal iterator-shaped query boundary, now serializes the returned history as JSON.

S2 root cause: Python `str.split`/`strip` and JavaScript `\s`/`trim` recognize different whitespace. Python consumes U+0085 and U+001C..U+001F, while JavaScript preserves them; JavaScript consumes U+FEFF, while Python preserves it. Normalization therefore changed both SHA256 key identity and vector lookup. The capstone fixture now declares one finite pattern matching the existing ECMAScript whitespace set: U+0009..U+000D, U+0020, U+00A0, U+1680, U+2000..U+200A, U+2028/U+2029/U+202F/U+205F/U+3000/U+FEFF. Both JS normalization and generated Python `re` normalization collapse that exact pattern, trim the resulting ASCII spaces, and lowercase. No generic Unicode mechanism was introduced. Redis response/semantic key dispatch uses the shared normalizer only for the captured `capstone` profile; legacy single-service/`redis-codecs` behavior keeps its original code path.

Changed production files: `src/data/templates/data-python/capstone.js`, `src/data/fixtures/data/capstone.js`, `src/data/templates/data-python/capstone-runtime.js`, and `src/lib/data/redis-runtime.js`. Only the ignored existing task-2 probe was amended: `--review` executes actual Python via stdin without writing files, checks JSON serialization, all finite whitespace code points, NEL/information-separator retention, independently calculated SHA256 response keys, JS/Python embeddings, and an ordinary known fixture control. `--history` isolates S1.

Commands and all added validation times:

| Run | Command | Result | Wall seconds |
| --- | --- | --- | ---: |
| Probe setup | `node .superpowers/sdd/2026-10-02-data-lab-13-capstone/task-2-probe.mjs --review` | failed due Windows Python stdin encoding | 0.3326656 |
| RED both findings | same `--review` command | 7 concrete failures | 0.1256812 |
| GREEN S1 after its fix | same command plus `--history` | passed actual Python JSON serialization | 0.1197193 |
| GREEN both after S2 fix | same `--review` command | passed | 0.1251174 |
| Existing fixture control | same probe without flags | passed | 0.2524783 |
| Whitespace/exact-diff review | `git diff --check` and `git diff` | exit 0 | 0.0966133 |

Added probe wall total **0.9556618 seconds**; including static validation **1.0522751 seconds**. Task 2 cumulative verification **18.5058148 seconds**. Controller's prior supplied aggregate plus Task 2 cumulative is **58.3137517 seconds**, excluding later external controller/reviewer checks.

Initial setup failure (recorded, no production change): actual Python decoded UTF-8 stdin using Windows default encoding, raising `UnicodeEncodeError: 'utf-8' codec can't encode character '\udc81' in position 2: surrogates not allowed`. Probe now launches `python -X utf8 -c ...`. Exit 1, `VALIDATION_WALL_SECONDS=0.3326656`.

RED output after that setup correction, before any production fix:

```text
FAIL S1 paged history JSON: Object of type list_iterator is not JSON serializable
FAIL S2 normalization/key/vector mismatch: "[U+FEFF]A[U+FEFF][U+FEFF]B[U+FEFF]"
FAIL S2 normalization/key/vector mismatch: "A[U+0085]B"
FAIL S2 normalization/key/vector mismatch: "A\u001cB"
FAIL S2 normalization/key/vector mismatch: "A\u001dB"
FAIL S2 normalization/key/vector mismatch: "A\u001eB"
FAIL S2 normalization/key/vector mismatch: "A\u001fB"
AssertionError [ERR_ASSERTION]: actual Python and JS capstone contracts agree
7 !== 0
at task-2-probe.mjs:47:10
generatedMessage: false; code: ERR_ASSERTION; actual: 7; expected: 0; operator: strictEqual; diff: simple
Node.js v26.1.0
VALIDATION_WALL_SECONDS=0.1256812
Exit 1
```

Invisible BOM/NEL are identified by code point above for readable evidence. The isolated S1 run printed the then-shared success message, but its `--history` selector checked only route serialization; the final probe output now distinguishes that selector accurately. `VALIDATION_WALL_SECONDS=0.1197193`, exit 0.

Full combined GREEN output:

```text
PASS actual Python paged route JSON and Python/JS finite whitespace, response keys, vectors, ordinary fixture control
VALIDATION_WALL_SECONDS=0.1251174
Exit 0
```

Full unchanged fixture-contract control output after the fixes:

```text
PASS coherent PG ranks, paraphrase/near miss, scope answers, 35/45/14-day revisions, overlay preservation, bounded starter/solution parsing
VALIDATION_WALL_SECONDS=0.2524783
Exit 0
```

Self-review inspected the exact four-file production diff: only iterable materialization, the finite shared capstone pattern/Python helper, and profile-gated Redis key normalization changed. The original disposable fixture proves the new `list(...)` source remains accepted by the bounded interpreter and that scope/rank/revision/loader behavior still works. `git diff --check` found no whitespace error; usual LF-to-CRLF notices were printed. No known remaining concern in this review round. No new build was required or performed under the controller's scoped direction.

Fix round 1 commit: `d3b94ca8eeda7a059449c8f720ce506de29e3a55` — `fix(data): align capstone Python routes and normalization`. Post-commit tracked worktree is clean; report/probe remain ignored.

## Archived task-2-spec-review.md

# Task 2 spec review

Reviewer /root/capstone_task2_spec, range aa428bf..15519ab. Spec Issues found; quality Needs fixes.

Important S1 capstone.js:86,158 — find_similar_questions returns SDKquery_items iterable/CosmosItemPaged, protectedserver json.dumps cannotserialize; use list(...). OfficialSDKref https://learn.microsoft.com/en-us/python/api/azure-cosmos/azure.cosmos.container.containerproxy?view=azure-python#query-items.

Important S2 capstone-runtime.js:14 / fixtures/data/capstone.js:10 / redis-runtime.js:10 — Python split and JS whitespace set differ: accepted U+0085 input JS a\u0085b vsPython a b, differentkeys/embeddings. Define matchingnormalization. Readonlyfocusedprobe0.2089035s.

Strengths: fixtureactualrows25 stableoverlay70,80; 17zones/routes/batchcheckpoint capstone.js42,109,262; coherentpolicy/Docker/fixedwrapper239,247,273; namedpsqlloaderpsql.js100; sourcecontentanswerfixture96. Cannotverify actualCosmospartitions/deployedexecution: Tasks3/7tracked. Minor: existingVitechunkwarningacknowledgedbaseline, notdemonstratedregression. No suites/build repeated, outside-diff only inheritedPGtargets/retrieval/Redis scope/invalidation/codecs namedrisks.

## Archived task-3-fixreview-1.md

# Task 3 scoped fix review 1

Fresh /root/capstone_task3_fixreview range8760178..4225bca. E1 ADDRESSEDbridge112,116 expectedID/partitionbeforeafterSDKrevision +scope/body; Cosmosstore66 identicalretryincreasesrevision. E2 ADDRESSEDbridge228 prekeys,249 liveproductkeys,252observedDEL+absence, emptyvalidwithoutDEL. No newbreakage/outofscope. ReportRED2fails/GREEN3/3 assertionschecked; no testsrerun0s. VerdictalladdressednoCritical/Importantbreakage.

## Archived task-3-quality-review.md

# Task 3 quality review

Fresh /root/capstone_task3_quality ranged3b94ca..8760178. SpecIssuesfound, qualityNeedsfixes.

Important E1 data-capstone-actions.js107–112: anysuccessfulupsert+oldexpectedmatchingitemcounts historywrite withoutthisframeexpectedID/bodymutation. Readonlyprobevalidcore-session/core-message thencapturedansweronlyunrelated/other-sessionSupportunrelatedupsert; repeatsamecachedrequestreports1 whileexpected_version1unchanged. Useboundedwriteidentity/body orbeforeafterversion receipt andexistingthirdcaseregression. Probe4.2974244s; nosuites/buildrepeat.

Strengths consumedPGrow/helperproof94/tests128literalreject; restart181; coldsnapshot195/loadzero12; extractedlegacycachehelper1. Cannotverifydownstreamstage/incident/cleanup trackedfuture. Minorbaselinechunkwarning. Focusedchecksconnectionmode/Serviceartifact/fullbatch/Cosmosmutation; cutruntimeprefixread. No otherissues/mutations/subagents.

## Archived task-3-report.md

# Task 3 implementer report

Status: DONE. Base d3b94ca8eeda7a059449c8f720ce506de29e3a55. Worktree data-capstone. Followed supplied implementer, TDD/writing-good-tests, systematic debugging and verification instructions. No subagents, review agents, installs, cloud traffic, real timers, full suites, AKS/ACA/browser/legacy-capstone test suites, future Lab import, push/merge/PR/publish.

Commit: `8760178a8b0e4c18f41c532ceca0f906a87e2653` — `feat(data): execute mixed requests and checkpointed cache invalidation`. Post-commit git status --short is clean; report remains ignored.

## Implemented

Added a composite-capstone bridge before legacy data dispatch and integrated data-capstone into labEngine actions. UI accepts exactly `{type:'data-capstone',scenarioId}`. Authored version-1 scenarios have exact top-level/step keys, at most 64 steps, a declared matching active stage and matching task/scenario version. Request routes and positional arities use Task 2 exports; JSON, string sizes, product/version/language, feedback booleans, advance limits and fixed 200 RPS/5-second load are checked. Trusted Lab target/manifest/capability gates are required before public execution. No caller-supplied outcomes/targets are used.

API execution resolves the ready Service-selector Pod's captured artifact; workers resolve actual Deployment Pods. Restart uses restartDeploymentResult and the supported reconciliation path, verifies a different ready replacement UID, and re-resolves that captured artifact. Worker lease stays durable. Successful batches retain their observed last feed batch; redelivery calls worker:item/apply_change on those items. Reported handled IDs are unique business IDs backed by successful feed checkpoint and product namespace SCANs; actual successful DEL effects determine invalidatedKeys, not a delivery counter. Redis failure stops the interpreter before the lease write. Task 2's canonical worker already supplies the required SDK solution and writes the lease after the full successful batch; it needed no source rewrite. The prose ambiguity was resolved by the controller in favor of full-batch checkpointing.

Trusted corpus-update reads live PG documents/chunks, overlays only the selected revision-2 rows through loadCorpus, preserves IDs/logical scale and other product revisions, and writes an actual immutable document-update Cosmos item plus change log entry. Retry recognizes the existing product/revision business event even if its authored label differs. No Redis source shortcut or automatic invalidation is used. This is supplied administration: the PG/Cosmos operations do not model an atomic cross-service transaction; real production would require retry/outbox handling outside this Lab.

Extracted the existing Redis accepted-return/cache-effect functions into cache-evidence.js without changing the legacy adapter's logic or outputs. Complete per-frame facts are computed before a 256-call presentation cap. Answers require actual returned cache provenance or consumed live PG content/source relationships, actual scopes, and the grading-only fixture oracle. Scoped historyWrites additionally requires a successful Cosmos upsert and a matching real saved item (scope/session/answer/sources). Request facts retain complete PG/Cosmos/Redis calls and training inputs/results, even when display calls are capped. Truncated interpreter/effect frames cannot prove completion.

Load uses authored preceding answer inputs or an explicit trusted fallback, samples each bounded representative against the same cache snapshot at load time, and commits a deterministic representative wave afterward. Therefore an initial cold request cannot warm all concurrent demand. Only observed successful SELECT-origin demand reaches simulatePoolLoad; all-hit load returns zero origin demand/failures/peak PG connections without opening PG. It binds mode and maximum to the captured connect return SDK operation and the actual module pool it references, ignores unused global pools, checks observed SQL connection mode/size, uses deployed replicas, and models demand synchronously. p95 is explicitly labeled a PostgreSQL-origin teaching approximation, separate from observable Redis/Cosmos effects. simTimeMs advances synchronously. Source/dependency generations are refreshed before public verification recording.

## Interface produced

- `src/lib/kubernetes/data-capstone-actions.js` exports `validDataCapstoneScenario(scenario,lab)`, `applyDataCapstoneAction(run,action,lab)`, `runCapstoneSteps(run,lab,scenario)`; data-actions.js re-exports them. The first is authored structure validation; public dispatch additionally gates capability/target/manifest, active stage and matching Task. runCapstoneSteps returns detached `{run,measurements}` and records no evidence. Public apply returns normal `{run,lines,portalEvents,diagnostics}` and records exactly once.
- `src/lib/data/capstone-load.js` exports `simulateCapstoneLoad({requestsPerSecond,seconds,originRequests,replicas,poolMaxSize,mode,server})`; originRequests is the modeled total across the window, not origin RPS. Returns served/failed/p95Ms/throughputRps/peakServerConnections/errors/label/originRequests/latencyScope.
- Trusted `lab.dataRequestTarget={clusterId,namespace,serviceName,deploymentName}`, `lab.dataWorkerTarget={clusterId,namespace,deploymentName}`; neither scenario nor action can override these.
- Standalone load requires `lab.dataLoadRequest={route:'GET /answer',args:[question,product,version,language,sessionId,messageId]}` with the same request validation. No implicit fixture fallback. If earlier authored GET /answer steps exist, their bounded inputs represent the wave; cache is snapshotted AT load, so advance after priming yields cold demand.
- Runtime initializes `run.runtime.dataCapstone={version:1,incident:null,worker:{lastBatch:[],artifactId:null}}` if absent. Worker lastBatch survives scenario calls; restart clears in-memory items only after real replacement, and the durable lease remains in Cosmos.
- Measurements include status/error where applicable, answersCorrect/scopeCorrect/provenanceValid, responseHits/semanticHits/ragMisses/staleAnswers/traceComplete, historyWrites, complete requests, display calls/displayTraceTruncated, artifactIds/totalCharge/estimate, worker `{before,after,handledEventIds,invalidatedKeys,restarts}`, load (or null), inventory (or null). Restart records beforePodUid/afterPodUid/artifactId. Request returnedFrom is response-cache/semantic-cache/postgres/null and never app-supplied.
- Shared runtime extension authorized by controller: successful composite runDataFunction results add bounded detached `returnDataProvenance`, the existing generic `{origin,children}` metadata tree. Legacy results keep their prior shape. A bounded string join retains a common origin only for composite execution; the capstone helper profile propagates actual consumed passages only when passage and first source share a PG origin. The bridge also verifies every returned source origin/kind/call index, returned scoped SQL rows, actual helper inputs/results, and exact returned source-to-consumed-row content relationships. Incidental SQL/helper calls with a literal return or literal passage cannot prove a PG return. No per-Lab parser lowering, source searching or origin flags were introduced.
- `tests/data-capstone-core.test.js` contains exactly THREE permanent cases and exports `capstoneCoreFixture(poolSize=12,{literalReturn,literalPassage})`, `coreScenario(steps)`, and `coreEvent(run,id,type='document-update')` for later Task 4/6 reuse. It uses a local bounded SDK project and minimal ready Kubernetes/resources, no Lab import.
- Incident-start currently fails closed with INVALID_DATA_ACTION explaining the incident adapter is required; implementing the incident lifecycle remains Task 6. Known Redis connection/RU faults and known too-many-clients load observations may be marked completed only in an authored incident-mode scenario; Task checks still judge the facts. Stage seals, cleanup freeze/ownership and final source journal validation remain later owning tasks.

## TDD evidence and complete validation ledger

All core commands: `npm.cmd test -- tests/data-capstone-core.test.js`. PowerShell Stopwatch measured each entire command, including startup. No additional permanent cases or test files were added.

| Run | Result | Wall seconds |
| --- | --- | ---: |
| 1 fixture setup failure | Declared qa_history receiver absent from local clients; removed unused receiver from local manifest | 3.8671952 |
| 2 initial RED, before production | all three cases fail: expected undefined runCapstoneSteps to be a function | 2.7011407 |
| 3 GREEN attempt | 2/3 pass; restart fixture lacks projectionDue map required by clearPodState | 2.9527837 |
| 4 fixture correction | 2/3 pass; seeded Redis keys absent because direct SDK fixture target omitted database:'default' | 2.6453074 |
| 5 concrete origin assertion | 2/3 pass; canonical-return provenance expected true, got false | 2.5997238 |
| 6 origin integration attempt | 2/3 pass; same false provenance | 2.6080575 |
| 7 diagnostic assertion output | Reveals local question used old Redis wording, yielding real no-match/empty PG rows | 2.8221426 |
| 8 GREEN after canonical question correction | 3/3 pass | 2.6752932 |
| 9 GREEN extended existing cases | 3/3 pass; includes scoped update retry and two literal provenance controls | 2.7683964 |
| 10 controlled regression RED | Restore training_answer's original null flow: real [1,2] PG rows/answer present but canonical source-grounded provenance false; 2/3 pass | 2.5219635 |
| 11 GREEN restored narrow consumed-flow fix | 3/3 pass | 2.6765205 |
| One build | npm.cmd run build passes; existing chunk-size warning | 5.3440258 |
| Initial staged whitespace check | git diff --cached --check passes | 0.0320000 |
| 12 final core GREEN after exact-diff contract corrections | 3/3 pass | 2.9839065 |
| Final staged whitespace check | git diff --cached --check passes | 0.0351660 |

Task 3 total verification wall time: **39.2336228 seconds**. Controller supplied prior aggregate: **58.5226552 seconds**. Combined aggregate: **97.7562780 seconds**, excluding later controller/reviewer work. Node source inspections without assertions were read-only investigation, not extra validation runs. All failed test runs are listed above.

Initial meaningful RED output, run 2:

```text
tests/data-capstone-core.test.js (3 tests | 3 failed)
resumes a pending update after worker replacement and redelivers repeat-safe product invalidations
  expected undefined to be type of 'function'
keeps the durable continuation when the declared Redis SDK client fails
  expected undefined to be type of 'function'
models zero PG demand for hits and cold concurrent pool pressure followed by bounded pool recovery
  expected undefined to be type of 'function'
Test Files 1 failed (1); Tests 3 failed (3)
VALIDATION_WALL_SECONDS=2.7011407
Exit 1
```

This is expected: fixtures parsed and reconciled successfully, but the bridge did not yet exist. Cases then exercise actual SDK/state changes, not mocked call counters. Run 10 proves the narrow additional origin contract with a real canonical question after correction: disabling only helper flow restoration causes returnedFrom:null/provenanceValid:false despite actual scoped rows [1,2], an actual helper call, a correct 35-day answer and real history write. The two literal controls remain rejected when the fix is restored.

Final core GREEN output, run 12:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-capstone-core.test.js
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-capstone
✓ tests/data-capstone-core.test.js (3 tests) 173ms
Test Files 1 passed (1)
Tests 3 passed (3)
Duration 2.05s (transform 749ms, collect 1.51s, tests 173ms, prepare 133ms)
VALIDATION_WALL_SECONDS=2.9839065
Exit 0
```

Single build output:

```text
> azure-trainer@0.1.0 build
> vite build
vite v6.4.3 building for production...
transforming...
✓ 561 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                       0.88 kB │ gzip: 0.46 kB
dist/assets/LabPage-3h2DwkTU.css     10.22 kB │ gzip: 1.90 kB
dist/assets/index-A8FG7ZL2.css       43.07 kB │ gzip: 8.25 kB
dist/assets/vendor-Cot1qApE.js       98.85 kB │ gzip: 38.44 kB
dist/assets/LabPage-DbUt5ODL.js     308.03 kB │ gzip: 79.49 kB
dist/assets/index-KmaeTIsx.js     2,466.12 kB │ gzip: 667.86 kB
(!) Some chunks are larger than 500 kB after minification.
✓ built in 4.57s
BUILD_WALL_SECONDS=5.3440258
Exit 0
```

## Files changed / self-review

Created cache-evidence.js, capstone-load.js, data-capstone-actions.js and the three-case core test file. Modified runtime.js (controller-authorized narrow metadata fix), data-actions.js, redis-actions.js and labEngine/actions.js. Report remains ignored scratch. Read the exact staged diff across all eight files and the full final bridge. Checked strict routes/scopes, task-stage gate, source/answer relationships, actual Pod replacement, durable lease ordering, repeat-safe deletes, live corpus overlay/business-ID retry, captured pool reference, synchronous miss demand, complete-before-display facts and shared legacy extraction. Final git diff --cached --check passed; normal LF-to-CRLF notices occurred during staging.

Self-review corrected standalone fallback to require GET /answer specifically and ensured standalone load artifacts are included in aggregate artifactIds; the final core run covers those code paths. The one build precedes these small pure-JS contract corrections; the final core imports/executes the final bridge, and no second build was performed under the strict one-build instruction. The canonical worker solution was already complete in Task 2 and was verified through these real worker cases rather than rewritten.

No known blocking issue. Intended limits: connectionConfig accepts the declared bounded connect body consisting of one direct connection/pool-return SDK operation and literal captured pool values; unrecognized origin configurations fail closed. Whole Lab walkthrough, public-stage/evidence persistence integration, final named SDK regression check, incident adapter and cleanup remain downstream owning task/controller verification. Legacy Redis adapter output was preserved by exact helper extraction, but legacy suites were deliberately not run. The existing Vite chunk-size warning remains.

## Review fix round 1

Fix base: `8760178a8b0e4c18f41c532ceca0f906a87e2653`. Read receiving-code-review fully and followed the already-read systematic debugging/TDD/verification instructions. Read both exact Important findings and persisted spec/quality review reports. Reproduced both before production edits, extending only the original first and third cases. Exactly three permanent core cases remain. No extra test file, rebuild, broader suite, browser/AKS/ACA/legacy suite, subagent, or production runtime framework was introduced.

E1 root cause: historyWrites checked for any successful upsert into each container, then read the expected item after the request. If an older expected item already matched the response, an unrelated write in a different session/product earned false credit. Fix: read the same expected ID/partition before and after this frame and require the real Cosmos item's `_version` to increase, in addition to its existing scope/session/returned-answer/source matching and successful container upsert. The immutable SDK store increments `_version` even for an identical-body retry. This proves a current-frame mutation without extra runtime tracing or app flags.

E1 covering assertions: local fixture optionally declares a minimal qa_history container. A correct request writes both expected items, then an identical cached request legitimately increments both revisions to 2 and credits two scoped history writes. Starting from the first request's state, a captured app variant writes only unrelated IDs in other-session/contoso-support in both containers. Actual successful upserts and actual returned-cache provenance are present; expected item revisions remain 1 and historyWrites must be zero. Before the fix it incorrectly reported 2. This fixture option is test-only; the production interfaces are unchanged.

E2 root cause: handledEventIds accepted a durable checkpoint plus both namespace SCAN patterns. It did not require actual invalidation of keys that existed before the batch. Fix: snapshot the batch's real Redis keys, determine each event product's live preexisting answer/semantic namespace keys, and require every such key to have a successful observed DEL removal effect and to be absent afterward. Both SCAN patterns still must be present. Empty namespaces legitimately need no positive DEL count; repeat delivery remains idempotent and business IDs stay unique. Positive feedback remains non-invalidating. No delivery/handler counter is fabricated.

E2 covering assertions: a parsed/captured worker variant replaces cache.delete(key) with cache.exists(key), preserving actual SCANs and lease checkpointing. The successful SDK trace contains both product namespace scans but no DEL; the original answer/semantic Backup keys and Support key remain. handledEventIds must therefore be empty. Before the fix it incorrectly credited update-2. Existing successful restart/replacement, full-batch lease, SDK failure, real product deletes, replay and Support-key preservation controls still pass.

Commands/times (complete wall time):

| Command | Result | Wall seconds |
| --- | --- | ---: |
| `npm.cmd test -- tests/data-capstone-core.test.js` before fixes | RED: 2 failed, 1 passed; exact E1/E2 failures below | 2.8178069 |
| same named command after fixes | GREEN: all original 3 cases pass, including new assertions | 2.5538099 |
| `git diff --check` plus exact two-file diff review | passed, normal LF-to-CRLF notices | 0.0420030 |

Added verification total: **5.4136198 seconds**. Task 3 cumulative: **44.6472426 seconds**. Prior provided aggregate plus Task 3 cumulative: **103.1698978 seconds**, excluding later independent controller/reviewer checks (the quality review's separately recorded probe remains its own ledger item).

RED output:

```text
tests/data-capstone-core.test.js (3 tests | 2 failed) 134ms
resumes a pending update after worker replacement and redelivers repeat-safe product invalidations
  AssertionError: expected ['update-2'] to deeply equal []
models zero PG demand for hits and cold concurrent pool pressure followed by bounded pool recovery
  AssertionError: expected 2 to be +0
Test Files 1 failed (1)
Tests 2 failed | 1 passed (3)
VALIDATION_WALL_SECONDS=2.8178069
Exit 1
```

GREEN output:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-capstone-core.test.js
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-capstone
✓ tests/data-capstone-core.test.js (3 tests) 165ms
Test Files 1 passed (1)
Tests 3 passed (3)
Duration 1.71s (transform 637ms, collect 1.26s, tests 165ms, prepare 88ms)
VALIDATION_WALL_SECONDS=2.5538099
Exit 0
```

Static validation emitted no whitespace errors, `STATIC_VALIDATION_WALL_SECONDS=0.042003`, exit 0. Self-review read the exact production/test diff: only expected-item revision linkage, pre-batch live namespace removal linkage, and local captured-code controls changed. No production export, scenario/action shape, worker lease behavior, interpreter, existing cache helper, or load calculation changed. No known remaining concern in this fix round.

Fix round 1 commit: `4225bca593d79974a8d78e4f02953d3ddb49c10a` — `fix(data): bind capstone credit to current scoped effects`. Post-commit git status --short is clean; report remains ignored.

## Archived task-3-spec-review.md

# Task 3 spec review

Fresh /root/capstone_task3_spec range d3b94ca..8760178. SpecIssuesfound, qualityNeedsfixes.

Important E2 data-capstone-actions.js239: handledEventIds onlycheckpoint+bothSCANpatterns, omittingDELcancreditexistingkeysremaining. Requireobservedsuccessfulinvalidationandabsenceofmatchingpreexistingkeys; empty/repeatednamespace legitimatewithoutnonzeroDEL.

Strengths exactgates31,249; realworkerrestart179/redelivery215; coldcommonsnapshot195/originpool204; completebeforecaps119; overlay/retry142. CannotverifyfinalLab/stagepersistence trackedlater. MinorbaselineVitechunkwarning. Nodoubletests/build0s. FocusedreadonlychecksreadyServicepostgreshelpers56, fullbatchworker109, corpusoverlay81/pgengine283/Cosmosstore50, pool19, cutruntimecontext72,508. No broadercrawl/mutation/subagents.

## Archived task-4-fixreview-1.md

# Task 4 scoped fix review 1

Fresh /root/capstone_task4_fixreview range50e81ba..4b7d89f. P1 ADDRESSED stages70 actualprimaryKey/pgengine127, regressiontest286. P2 ADDRESSED stages163 proof-source/snapshot equality usedseals212/checkpoints219; historicalversionspreservelegitimatelaterdrift; controls263,274,320. No newbreakage/outofscope. ReportRED2/GREEN5consistent,0s no repeatedtests. AlladdressednoCritical/Importantbreakage.

## Archived task-4-quality-review.md

# Task 4 quality review

Fresh /root/capstone_task4_quality range4225bca..50e81ba. Spec issues found, quality Needs fixes.

Important P2 stages.js154–165: validateSnapshot seal source versions match journal, not referenced evidence dataCapstoneProof.sourceVersions. Ordinary record/save/seal probe evidence1/save2/seal3 updated only seal sourceVersions/hash/milestone; evidence/hash unchanged; deserialize accepts final despite evidence{} vsseal{app.py:1}. Require equality for both seals/checkpoints. Readonlyprobe0.2800517s, no suites repeated. This is causal inconsistency, not authentication protection against rewriting every hash.

Strengths detached identities98–138, central/direct freeze actions580/bridge163, historical milestone linkage215–222. Future incident/ownership hooks notverifiable untilTasks5/6. Only truncated diff recovered/sourceJournal41–57 cutoff continuation read. No other findings.

## Archived task-4-report.md

# Task 4 implementer report

Status: DONE. Base `4225bca593d79974a8d78e4f02953d3ddb49c10a`. Worktree `data-capstone`. Read the full implementer prompt, TDD, writing-good-tests, verification and systematic-debugging instructions. Read task-4-brief.md, full context.md and task-3-report.md; interface-context.md was absent and the controller confirmed context.md is the intended contract. No subagents/reviewers, installs, builds, cloud traffic, timers, full/legacy/AKS/ACA/browser suites, future Lab imports, push/merge/PR/publish.

Commit: `50e81ba7e2affcb8beead4209f0a499b00d54098` — `feat(data): preserve ordered Data capstone checkpoints`. Post-commit git status --short is clean; report/probe remain ignored.

## Implementation

Added Data-only ordered stage adapter with all nine required exports: isDataCapstone, initializeDataStages, validateDataStageLab, validateDataStageState, advanceDataStage, freezeDataCleanup, dataSealedTaskIds, dataCleanupReady, dataStageView. Generic declarations allow 2-7 bounded stages, partitioning at most 64 versioned measured tasks. The future delivered Lab must declare exactly seven. ACA/AKS flags, counts and source behavior were preserved.

Data run creation initializes the exact stages.data and runtime.dataCapstone shapes and a sourceJournal. Source saves use normal validation, increment the causal sequence and persist the actual text hash. Every Data build validates its actual selected build-file content hash against the preceding source journal. Source snapshots, evidence, incident starts, ownership receipt sequences, checkpoint and seal sequences must remain unique, positive and earlier than nextSequence. Ordered stage evidence must occur within that stage's interval.

The controller explicitly approved a narrow additional evidence.js consumer edit. Ordinary recordVerification gates active-stage tasks and frozen non-cleanup proof, then derives a detached dataCapstoneProof from the run: stage/source versions and hashes, actual recorded measurements hash, captured artifact IDs/content hashes, stable live service configuration and immutable incident start identities. No caller-supplied proof is accepted. Each stage checks the actual task.check and latest current measured evidence before sealing. Seals bind attempt/content identity, task/evidence ordering, task-specific dependencies/generations, source versions, artifact IDs, evidence hashes and a proofHash; milestones persist the exact seal snapshot. Import/export validates all these links against real persisted evidence, builds and saves. These hashes are consistency checks, not security authentication.

Stable live fingerprints include current API/worker Deployment/Pod specs and captured Pod artifact IDs, API Service, configuration object digests, PG server parameters/schema/indexes, Cosmos policies/throughput and Redis configuration/index schema. PG rows, Cosmos items/change logs, Redis keys/stats, elapsed time and simulation time are excluded. Mutable cache observations remain measured scenario facts. Historical sealed tasks remain visibly done after later source/service drift; active final tasks require fresh live proof. Frozen final task evidence remains visible after cleanup changes live selectors.

Final freeze requires the final active stage, every non-cleanup final task's actual check and current evidence, saved drafts, no active scenario, evidence newer than the preceding seal and every incident start. The checkpoint binds exact final evidence and its persisted cleanup receipt. New source saves, builds, incident starts, resource creation or non-cleanup evidence after freeze invalidate the checkpoint. Central applyRunAction blocks source writes, build/other commands, clocks and new workloads; the public Data bridge and direct runCapstoneSteps also guard freeze. Inventory inspection is read-only. Cleanup verification may record fresh evidence while retaining frozen recovery proof. Partial cleanup does not reopen earlier stages. Final seal is fail-closed without actual ownership readiness.

Persistence adds serializeRun(run,lab) and deserializeRun(json,lab) to persistence.js, both validating the behavioral run against the trusted Lab. Existing repository signatures and persistence behavior are preserved.

## Downstream integration contracts (controller-approved)

- Task 5 must author `lab.dataIncident.validate(run,lab) -> true|false`. Whenever runtime.dataCapstone.incident is nonnull, this hook is required and must return exactly true; absent/failed validation rejects the run. It must validate actual injection/start receipts and the incident lifecycle without recursively calling validateBehavioralRun. The incident retains `starts:[{id,sequence},...]`, bounded to two unique incident IDs with strictly increasing unique causal sequences. A single initial `{id,sequence}` incident is also supported. Existing evidence may reference prior immutable starts; fresh final proof must match exactly all current starts and be newer than each. The actual seven-stage Lab final checks must require both approved incidents started/resolved. Task 4 does not inject incidents or introduce canned valid incident flags.
- Task 6 must author `lab.dataCleanup.allowAction(run,action,lab) -> true|false` and `lab.dataCleanup.ready(run,lab) -> true|false`. Functions are trusted Lab definition fields, never persisted in run JSON. The former must authorize only inventory reads/exact owned deletions after receipt-based destructive prechecks; the latter must validate receipt-backed current inventory/protected state and cleanup completion without recursive run validation. Missing readiness returns false; missing deletion authorization rejects deletion. Task 6 also owns pre-freeze destructive prechecks and full ownership receipt validation. Task 4 only enforces bounded receipt arrays/causal sequences/deletion-after-checkpoint and does not inject ownership.
- To avoid the required Task 6 ownership.js export name collision, this module's guard is `dataStageFrozenActionAllowed(run,action,lab)`. Task 6 can export `dataFrozenActionAllowed` and supply it via lab.dataCleanup.allowAction.
- Current command guards permit simple az show/list and kubectl get/describe/logs; otherwise defer to the trusted exact-action hook. A purported inventory read that changes sandbox or emits effects is rejected. Direct applyCommandEffects rejects all frozen command effects: the supported data-service deletes have sandbox effects, not Kubernetes/build effects. Any future ownership operation needing command effects must be integrated deliberately by Task 6 under exact receipt-based authorization rather than reopening general effects.
- Cleanup tasks are identified by authored `lab.scenarios[task.verification.scenarioId].mode === 'cleanup'`, only in the final stage. All other final tasks are fresh proof tasks. After freeze, workload scenarios must be mode cleanup/inspect and contain inspect steps only; cleanup measurements/inventory execution remain Task 6's owning integration. Frozen inspect reads do not overwrite proof evidence.

## TDD evidence / validation ledger

Exactly TWO cases were appended to tests/data-capstone-core.test.js (3 -> 5). Original three cases and capstoneCoreFixture/coreScenario/coreEvent exports are preserved. The new fixture minimally extends the existing bounded SDK fixture with a two-stage behavioral envelope, complete fixed source files for normal saves, and controlled dependency selectors. Real worker change-feed processing and scoped answer requests supply measurements; ordinary recordVerification persists them. No successful task flags or mock outcomes were hand-inserted.

The first case catches missing actual checks, inactive recording, changed measured evidence, reordered/changed seal identity and skipped-stage resume; it also proves real source saves preserve historical seals. The second catches PG pool/index, Cosmos policy, worker deployment and saved source drift, then requires fresh actual answer evidence before freeze; central/direct workload guards, final readiness without ownership and frozen JSON resume are covered.

All core runs use `npm.cmd test -- tests/data-capstone-core.test.js`; PowerShell Stopwatch measures complete command wall time including startup.

| Run | Result | Wall seconds |
| --- | --- | ---: |
| Initial RED before production | original 3 pass; 2 new fail because advanceDataStage/freezeDataCleanup are undefined | 2.6936324 |
| First implementation attempt | original 3 pass; 2 new fail envelope validation because raw fixture supplied minimal AKS/ACR/prerequisite arrays are not a full behavioral sandbox | 2.6922950 |
| Fixture envelope correction | original 3 pass; 2 new fail save-history/staleness assertions because missing fixed project files correctly reject normal save | 2.8534626 |
| Complete fixed-source staged fixture | GREEN 5/5 | 2.8961835 |
| Import/runtime/freeze linkage review corrections | GREEN 5/5 | 3.0063822 |
| Node persistence serialize/deserialize probe | passed detached envelope/attempt/source journal/runtime preservation | 0.2312621 |
| Final named core verification after final edits | GREEN 5/5, clean test output | 3.0201996 |
| git diff --check | passed; normal LF-to-CRLF notices only | 0.0466671 |

Task 4 verification total: **17.4400845 seconds**. Prior controller aggregate: **107.4673222 seconds**. Combined: **124.9074067 seconds**, excluding later controller/reviewer checks. All failed test attempts and the probe/static check are included. Read-only source/diff inspections and missing-path discovery were investigation, not additional assertion/check runs. No build was run under the explicit Task 4 instruction.

Initial meaningful RED:

```text
tests/data-capstone-core.test.js (5 tests | 2 failed)
preserves ordered measured stage seals across export while rejecting changed evidence and skipped stages
  expected undefined to be type of 'function'
requires fresh current final evidence after deployed source and service drift before freezing cleanup
  expected undefined to be type of 'function'
Test Files 1 failed (1); Tests 2 failed | 3 passed (5)
VALIDATION_WALL_SECONDS=2.6936324
```

Initial RED checked the existing stage module's namespace for the missing Data API; after implementing the Data module the import was pointed at its defined contract. The behavioral assertions run against the real new adapter, existing SDK bridge, save action, evaluator and ordinary evidence API.

Final GREEN:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-capstone-core.test.js
RUN v2.1.9 E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-capstone
tests/data-capstone-core.test.js (5 tests) 517ms
Test Files 1 passed (1)
Tests 5 passed (5)
Duration 2.17s (transform 695ms, collect 1.36s, tests 517ms, prepare 95ms)
VALIDATION_WALL_SECONDS=3.0201996
```

Probe command: `node .superpowers/sdd/2026-10-02-data-lab-13-capstone/task-4-persistence-probe.mjs`. Output: `Persistence serialize/deserialize probe passed; detached Data envelope, identity and source journal preserved.` `PROBE_WALL_SECONDS=0.2312621`. The ignored probe adds no permanent cases and uses the same persistence serialize/deserialize APIs; the named core cases exercise sealed/frozen resumes.

## Files / self-review / limitations

Created src/lib/labEngine/data-capstone/stages.js. Modified run.js, actions.js, evaluate.js, sourceJournal.js, persistence.js and tests/data-capstone-core.test.js. Additional necessary approved consumer edits: evidence.js automatic ordinary-API proof capture/gates and kubernetes/data-capstone-actions.js direct freeze guard/read-only inspection. Ignored report/probe stay scratch.

Read the exact production/test diff and entire new stage module. Corrected active task intervals/current pointer identity, configuration digests, runtime/source-snapshot validation, immutable incident ordering and checkpoint post-freeze build/creation/evidence rejection. Mutation reasoning: missing task check or current dependency comparison would admit unverified/drifted state; missing record hash would admit changed measurements; missing stage order/interval checks would admit skip/reordering; missing central/direct guards would execute prohibited work. Final named checks and whitespace verification are fresh after edits.

No known blocking issue in Task 4. Deliberate downstream limits: actual incident receipt/lifecycle validation, both approved resolved incidents, exact ownership and actual cleanup inventory are fail-closed hooks until Tasks 5/6/7 implement them. No claim of a complete Lab walkthrough or cleanup implementation. The existing actions.js/run.js remain large shared files; edits are scoped Data branches. Hash linkage is not protection against a party rewriting the entire save and recomputing every consistency hash.

## Review fix round 1

Fix base: `50e81ba`. Read receiving-code-review fully and followed the already-read systematic debugging, TDD/writing-good-tests and verification instructions. Controller supplied two Important findings with exact code paths; persisted review files were not yet present at initial read. Verified each against production before editing: pg-engine enforces table.primaryKey in row insertion and persists it in createTable, whereas the fingerprint selected a nonexistent constraints field. validateSnapshot linked its own sourceVersions to the journal but omitted comparing the referenced record proof's sourceVersions.

P1 root cause: column metadata does not include a table-level PRIMARY KEY declaration. Its actual persisted primaryKey array was absent from the stable schema fingerprint. Fix replaces nonexistent constraints with primaryKey. Covering control creates a real table through executePg with `PRIMARY KEY (id)`, checks its stored `['id']`, then mutates only that array to `[]` in the existing final-drift loop. Before the fix freeze wrongly returned no diagnostics. Column-level constraints remain covered in columns; data rows remain excluded.

P2 root cause: a causal save moved between a verification record and its seal can change source versions at seal time while the record remains older. Seal hash/milestone consistency alone did not prove source currency at sealing. Fix requires each referenced record.dataCapstoneProof.sourceVersions to equal snapshot.sourceVersions in the shared validator used for BOTH seals and cleanup checkpoints. The existing import case starts from a real recorded worker proof, real seal and real subsequent save; it swaps only save/seal causal sequence order, updates the seal's source versions/hash and matching milestone, and preserves all evidence/proof hashes/source save hashes. Before the fix the import accepted this stale record. The final case also creates a real save after fresh final verification, then tests that a cleanup checkpoint/mirrored receipt claiming the newer source version cannot reuse that older final record. Existing legitimate later-source-drift historical resume stays passing.

Exactly five permanent core cases remain; no new case, file, build, broad suite, browser, legacy/AKS/ACA suite, install, subagent or reviewer was added. Only stages.js and the existing two stage cases changed.

| Command | Result | Wall seconds |
| --- | --- | ---: |
| `npm.cmd test -- tests/data-capstone-core.test.js` before fixes | RED: 2 failed, original 3 passed; stale seal import accepted and primary-key drift allowed freeze | 8.6808123 |
| Same command after the two minimal production changes | GREEN: 5/5, including cleanup checkpoint mismatch and legitimate historical drift | 3.1981333 |
| `git diff --check` and subsequent exact two-file diff inspection | passed, only normal LF-to-CRLF notices | 0.0518567 |

Added validation wall time: **11.9308023 seconds**. Task 4 cumulative: **29.3708868 seconds**. Previous Task 4 combined aggregate plus this fix: **136.8382090 seconds**, excluding independent controller/reviewer checks not supplied here. All failed/check commands are included; missing review-path reads were read-only investigation.

RED output:

```text
tests/data-capstone-core.test.js (5 tests | 2 failed) 355ms
preserves ordered measured stage seals across export while rejecting changed evidence and skipped stages
  AssertionError: expected [Function] to throw an error
requires fresh current final evidence after deployed source and service drift before freezing cleanup
  AssertionError: expected 0 to be greater than 0
Test Files 1 failed (1); Tests 2 failed | 3 passed (5)
FIX_VALIDATION_WALL_SECONDS=8.6808123
```

GREEN output:

```text
> azure-trainer@0.1.0 test
> vitest run tests/data-capstone-core.test.js
tests/data-capstone-core.test.js (5 tests) 554ms
Test Files 1 passed (1); Tests 5 passed (5)
Duration 2.28s (transform 700ms, collect 1.38s, tests 554ms, prepare 108ms)
FIX_VALIDATION_WALL_SECONDS=3.1981333
```

Exact diff self-review: production changes are one field selection replacement and one record-to-snapshot source-version equality; tests add a real table-level key fixture and two narrowly scoped causal tamper controls. Both stage/checkpoint consumers share the validator, and historical equality is between the immutable evidence and historical seal rather than current mutable source. Fresh GREEN and whitespace verification follow the final edits. No known remaining concern for these two findings.

Fix commit: `4b7d89f357553936f891ad80f750dd30b32fd69b` — `fix(data): bind stage proof to sealed source and schema`. Post-commit git status --short is clean; report remains ignored.

## Archived task-4-spec-review.md

# Task 4 spec review

Fresh /root/capstone_task4_spec, range4225bca..50e81ba. Spec issues found, quality Needs fixes.

Important P1 stages.js70: tables pick name/columns/nonexistent constraints but omit actual primaryKey (pg-engine154 persisted,127 enforced). PrimaryKey ['id']=>[] leaves live fingerprint identical and stale final proof accepted absent narrower selector. Include primaryKey. Readonly probe PRIMARY_KEY_DRIFT_FINGERPRINT_CHANGED=false,4.1398559s plus initial quoting failure0.0474356s=4.1872915s. No suites/build/browser repeat.

Strengths stage partitioning29, ordinary record gating/evidence56, two measured tests238,264. Cannot verify actual7-stage Lab, incident receipts, ownership partialcleanup—failclosed hooks trackedTasks5–7. No other issues.

## Archived task-5-fixreview-1.md

# Task 5 scoped fix review, round 1

Reviewer /root/capstone_task5_fixreview, fix range6bed967..408cbbb.

- I1 ADDRESSED. incidents.js183–186 captures actual event and original change, hashes complete receipt including _version;292–295 rejects contradictory metadata, binds historical change, supports later writes/service deletion. stages.js179–180 propagates INVALID_RUN.
- New fix breakage: none. Out-of-scope observations: none.
- RED/GREEN and probe assertions inspected, not rerun. Added validation0s.
- All findings addressed, no new Critical/Important breakage.

## Archived task-5-quality-review.md

# Task 5 quality review

Fresh /root/capstone_task5_quality range4b7d89f..6bed967. SpecIssuesfound, qualityNeedsfixes.

Important I1 incidents.js277–282: updateReceipt.event._version shape-only integer check, changeonly actual1=>1001 withstoredCosmosevent1 unchanged/nohashrecompute acceptedbyincidentandbehavioralvalidators. Bindidentity/version authoritativehistoricalevent/evidencelink; preserveaftercleanup. Focusedreadonlyprobe0.908352s +quote setupfailure0.0514743s=0.9598263s. No suites/build/git/mutations. InformationalhistoricalPodUID hasnoauthoritative retainedrecord, notblocking/noauthenticationinfrastructure demanded.

Strengths separatecontrol/zeroevidencebridge314, workerDEL/lease/replay/restart/positiveincidents59, coldpoolrealorigins/thresholds/client/history105. FutureTask6ownership/Task7LabUI remaintracked. Nootherfindings; baselinebuildwarningacknowledged.

## Archived task-5-report.md

# Task 5 implementer report

Status: DONE. Base `4b7d89f357553936f891ad80f750dd30b32fd69b`, branch `codex/data-capstone`, worktree `data-capstone`. Read complete implementer prompt, TDD/writing-good-tests, verification, systematic-debugging, Task 5 brief, full context and Task 3/4 interface reports. Did not read the entire plan. No subagents/reviewers, installs, permanent cases, core-suite rerun, broad/legacy/AKS/ACA/browser suites, real timers, cloud requests, push/merge/PR/publication.

## Implementation

Added `data-capstone/incidents.js` with `startDataIncident(run,lab,incidentId)`, `dataIncidentView(run,lab)`, `validateDataIncident(run,lab)` and `observeDataIncident(run,lab,evidenceId)`. The public three-argument start signature fails closed without the internal optional primitive bundle; the supported UI path is the existing shared dispatcher. Runtime retains `{version:1,starts:[{id,sequence}],records:[...]}` under the existing incident slot. Starts are unique, increasing, max two approved IDs. Receipts retain exact visible actions, actual source-save/build sequences, content hashes, target UID/image/replicas/captured artifact and server parameter observations; receipt hashes detect inconsistent edits. Validation derives active/observed/resolved from linked actual evidence without calling validateBehavioralRun recursively or accepting caller success flags. Historical recovery uses recorded facts and captured immutable builds, so later frozen service deletion does not erase incident proof.

Worker injection accepts the existing canonical process_changes body once, preserved surrounding learner source and the actual matching deployed source/manifest. It requires real healthy answer evidence, live exact+semantic Backup and Support caches, an earlier durable lease, a handled Support revision-2 event, exact original Backup revision-1 PG passages, ready API/worker and saved drafts. Normal `kubectl delete deployment feedback-worker -n assistant` stops the learner-installed worker; trusted corpus administration posts Backup revision 2 with the unchanged lease while stopped. A separate update receipt anchors the actual immutable document-update item between stop and source save. Normal save/build `assistant:capstone-worker-fault`/manifest save/apply recreates the worker with Now/no continuation/no checkpoint. The healthy API remains captured on its previous artifact. Backup is never rolled back.

Diagnostic proof requires a ready fault worker, the actual pending update, unchanged earlier lease, missed business ID, both stale returned cache types with the 35-day answer and live namespaces before TTL, plus Support key preservation. Recovery requires the new capstone-worker-fixed captured build with durable canonical process_changes, resume from the earlier lease, actual DEL effects for all preexisting Backup keys in both namespaces, immediate source-grounded 14-day exact/paraphrase answers before original TTL, unchanged Support keys, an actual nonempty duplicate delivery of the missed event, changed ready Pod UID, a later no-op fixed-worker batch and positive feedback processed afterward with both caches present and unchanged. Worker operation facts include per-step actual before/after leases and keys, pending/delivered/handled event IDs, artifact, DELs and restart step identities.

Pool injection requires measured resolved worker recovery and freshly primed caches, then accepts only complete declared healthy client variants. It saves the module max12/direct5432 fault clients, builds capstone-pool-fault, saves/applies the API manifest, scales API3 and sets max_connections20 through normal commands. Warm proof requires the captured fault image with origin demand0/failures0; cold diagnostic requires a real load window at least61 simulated seconds later, positive origin demand, replicas3/module12/direct pool and actual exhaustion errors. Recovery requires capstone-pool-fixed, exact declared module min1/max4/port6432 clients, PgBouncer enabled/default12, replicas3, re-prime plus61-second cold window, origin demand>0, throughput>=190RPS, failed0, peak<=17, PG-origin p95<=20ms, correct filtered/provenance-backed returned RAG and two current scoped Cosmos history writes. Measurements retain actual load start/prime age/server settings. Existing pool teaching estimates and labels are preserved.

Added template exports `DATA_CAPSTONE_CLIENT_VARIANTS={naive,pooled,fault,fixed}` and `DATA_CAPSTONE_FAULTY_PROCESS_CHANGES`. Added fixture `capstoneIncidentScenarios(workerStageId,poolStageId)` producing separate injection controls and worker-diagnostic/worker-recovery/pool-warm/pool-cold/pool-recovery declarations. No per-Lab interpreter lowering or canned answer path.

## Exact downstream interfaces

Trusted Lab wiring:

```js
dataIncident: {
  validate: validateDataIncident,
  registryName: 'acrassistant',
  stageIds: { 'worker-checkpoint': workerStageId, 'cache-masked-pool': poolStageId },
  scenarioIds: { 'worker-checkpoint': 'inject-worker', 'cache-masked-pool': 'inject-pool' },
}
```

Each injection control must be declared mode incident, its declared active stage, exactly one incident-start with the mapped ID, and MUST NOT be any task.verification.scenarioId. Panel Inject uses unchanged `{type:'data-capstone',scenarioId}`; injection records ZERO evidence and refreshes real dependency generations. Normal Verify observes only. Public dispatch records ordinary evidence once, then passes that actual evidence ID to the observer. runCapstoneSteps still returns `{run,measurements}` without recording; central/public/direct stage and freeze gates remain. Its optional fourth parameter is internal only, never Lab/run/UI JSON.

Controller approved the additional seam: extract the existing save-file body into private saveFileAction, pass private `{command:commandAction,saveFile:saveFileAction}` through applyDataAction/applyDataCapstoneAction; the bridge appends its existing corpusUpdate primitive. Incident module never imports actions.js and never recursively dispatches actions. Existing save validation/journal/dependency and command/effect behavior is reused exactly.

Controller-approved concrete public-dispatch corrections: forward dataCapstone to existing Kubernetes validators in kubectl.js/objects.js/state.js (schema already supports worker command); admit dataCapstone alongside existing capabilities in shell.js psql/redis-cli and redis-cli.js secondary gate. No schema/model changes or legacy capability flags. Existing CLI target/TLS/auth/SQL/Redis checks stay intact.

Task 6 obligation: normal pre-freeze delete/reapply of the learner-installed worker is maintenance, not frozen cleanup. The supplied namespace/Service/AKS/ACR remain untouched. Ownership must permit exact receipt-backed workload maintenance through the same command primitive and distinguish maintenance receipts from post-checkpoint deletion receipts; do not mark supplied workload owned or bypass ownership guards. Existing stages deletion-receipt ordering assumes post-checkpoint deletes and will need the narrow owning integration described by the controller. No future ownership import added here.

Task 7 obligation: provision GeneralPurpose PostgreSQL (PgBouncer rejects Burstable); wire the trusted maps/validator, assign ordinary scenarios to actual measured tasks/stages, final checks require BOTH approved records status resolved and valid, and retain Task 4 exact current starts/fresh final proof rules. Prime Support and both Backup namespaces before each required incident; earlier healthy update is Support only. Pool repair must retain API3 when applying the repaired manifest. Reuse ignored probes/helpers as part of the single walkthrough, no second whole-Lab replay.

## TDD and validation ledger

Before production, wrote exactly two disposable probes in ignored `task-5-probes.mjs`. Their explicit break targets are missing baseline acceptance, inactive injection, repeat injection and unchanged bad code/config recovery. They exercise real applyRunAction saves/builds/applies/config/scale and real composite SDK requests/change-feed/cache/load effects, no successful flags or mock service outcomes. Probe setup uses small independent service state and supplied cluster; it does not import a Lab or legacy replay suite. Worker repair and a short positive cold pool repair tail use normal commands. Final missing-baseline/one-shot assertions use public dispatch, and direct inactive assertions distinguish the stage diagnostic from absent-executor rejection.

Every probe command: `node .superpowers/sdd/2026-10-02-data-lab-13-capstone/task-5-probes.mjs`, wrapped in PowerShell Stopwatch including startup. No permanent cases were added (existing core remains5 and SDK remains existing count).

| Attempt | Result | Wall seconds |
| --- | --- | ---: |
| Setup1 | nonexistent cosmos import; corrected to cosmosdb | 0.1880959 |
| Setup2 | initialized runtime omitted supplied cluster | 0.2415359 |
| Setup3 | initializer requires exact four-field envelope | 0.2344792 |
| Setup4 | supplied namespace absent | 0.3065510 |
| Setup5 | kubectl create unsupported; namespace supplied in seed | 0.2571622 |
| Setup6 | worker command rejected by missing capability forwarding | 0.4083268 |
| Meaningful RED before production | expected startDataIncident function, got undefined | 0.2719989 |
| Attempt8 | normal redis-cli shell capability missing | 0.5265633 |
| Attempt9 | scratch Redis module absent | 0.5143433 |
| Attempt10 | scratch module takes string array, not objects | 0.2308040 |
| Attempt11 | shared scale minimum1; approved delete/reapply instead | 0.7179812 |
| Attempt12 | supported delete syntax is kind plus name | 0.7073305 |
| Attempt13 | pool observation used scenario start instead of actual load start after advance | 2.4051846 |
| GREEN14 | both negative probes pass | 2.5663579 |
| GREEN15 | exact receipt/causal validation tightened, both pass | 2.5295663 |
| Positive tail16 | scratch Burstable does not support PgBouncer | 2.7421681 |
| Positive tail17 | unsupported explicit scratch SKU | 0.2352860 |
| GREEN18 | scratch GeneralPurpose/default SKU; both probes and positive pool repair pass | 3.6799352 |
| GREEN19 | exact restart/nonempty duplicate/positive no-op step relationships, both pass | 3.9056681 |
| Single build | npm.cmd run build passes, existing chunk-size warning | 6.2070295 |
| Final probe20 | public negative baseline/one-shot controls, both pass | 3.8526022 |
| Whitespace check | git diff --check passes, normal LF/CRLF notices | 0.0507106 |

Validation total before final staged whitespace check: **32.7796807 seconds**. Controller supplied prior aggregate **141.3055522 seconds**; combined **174.0852329 seconds**, excluding later review/controller checks. All failed setup/probe commands are counted. Read-only source/diff/contract inspections were investigation, not assertion runs. No full suite was run under the binding explicit testing policy.

Meaningful RED:

```text
AssertionError: Expected values to be strictly equal:
+ 'undefined'
- 'function'
at workerProbe (task-5-probes.mjs)
PROBE_WALL_SECONDS=0.2719989
```

Final GREEN:

```text
Two disposable incident probes passed.
PROBE_WALL_SECONDS=3.8526022
```

Single build: Vite6.4.3,563 modules, built4.96s, exit0. Complete wall6.2070295s. Existing >500kB chunk warning remains. No new build warning/error.

## Files, exact-diff self-review and limits

Created incidents.js. Modified capstone template, capstone fixture scenarios, data-capstone-actions.js and data-actions.js. Additional explicitly approved files: labEngine/actions.js, kubernetes/kubectl.js, objects.js, state.js, az/shell.js, data/redis-cli.js. Scratch probe/report are ignored. No future Lab/ownership file, persistent test case or external write.

Read the exact diff, complete incident module and concrete consumers. Self-review corrected: receipt afterSequence aliasing; load-window timing after authored advance; nonempty duplicate delivery; later fixed worker no-op after actual restart; positive-feedback event/operation linkage with both namespaces present; canonical Backup revision1 prerequisite; exact command/save/apply/config ordering and current Pod artifact receipts; causal stopped-window update receipt. Fresh probes and single build cover final production code. Final scratch-only assertion correction does not change built production.

No known blocking issue in Task 5. Full seven-stage Lab, final evidence/freeze/cleanup and ownership integration remain the designated Task 6/7 work. Receipt/proof hashes enforce persisted consistency, not authentication against complete save rewriting. The existing actions.js shared file remains large; extraction is exactly its old save branch and internal primitive passing. General-purpose stage/ownership behavior and legacy suites were deliberately not expanded or rerun.

Commit: `6bed967` — `feat(data): stage worker and cache-masked pool incidents`. Final `git diff --cached --check` passed, **0.0398996 seconds**, including the new incident file. Task 5 final verification total **32.8195803 seconds**; combined controller aggregate **174.1251325 seconds**. Post-commit status is clean; ignored scratch report/probes remain for Task 7 reuse.

## Review fix round 1

Fix base `6bed967`. Read receiving-code-review completely, used already-read systematic-debugging/TDD/writing-good-tests/verification instructions. Full review files were not yet present at initial read; controller supplied the exact Important finding and reproduction. Inspected the actual Cosmos store and change-feed modules before choosing the fix.

Root cause: the stopped-window updateReceipt validated only that its item `_version` was an integer. That receipt had no hash binding its actual item metadata to the captured update. cosmos-store upsertItem returns a detached versioned item and later upserts increment its version and replace its `_previous` metadata; current mutable item is therefore unsuitable as the sole historical identity. recordChange instead appends an immutable `{lsn,id,partition,ts,body}` log entry and strips every underscore metadata field, including `_version`. Its historical body remains available after worker lease changes and later same-ID writes, until the service is deleted.

Fix: capture the actual just-posted change-log entry along with the actual written item, stopped-window sequencing and earlier lease in updateReceipt, then hash that complete bounded receipt. Validation requires this hash to match; it also requires the captured change's ID/partition/timestamp/body to match the captured item and, whenever the events container is retained, the exact original change to exist in its append-only history. When the container has been removed, the persisted receipt hash retains the captured version linkage. It deliberately does not compare the receipt to the later mutable current item, require new tracing, alter store semantics, or claim authentication against rewriting every hash/history.

Only incidents.js production logic changed. Exact updateReceipt shape now adds `change` and `receiptHash` to the previous fields; no export/signature, action, stage, interpreter, ownership or scenario contract changed. No new permanent case, test file, build, broad suite, install, agent/reviewer or external write.

The SAME ignored worker probe now performs actual baseline/injection, proves actual event version1, changes only receipt version to1001 without hash recomputation, and requires both validateDataIncident rejection and validateBehavioralRun INVALID_RUN. It additionally performs a real later same-ID upsert/change append (live version2) and requires the original incident receipt to remain valid. The SAME pool probe retains all actual worker repair/restart/duplicate/positive and cold pool repair coverage, then removes the Cosmos account in a detached historical-validation control: valid incident history remains accepted, while the same one-field receipt contradiction is still rejected. This is an incident-validator control for the post-service-deletion envelope, not a second cleanup walkthrough or claimed ownership execution.

| Command | Result | Added wall seconds |
| --- | --- | ---: |
| `node .superpowers/sdd/2026-10-02-data-lab-13-capstone/task-5-probes.mjs` before fix | RED: changed receipt version wrongly accepted, true !== false | 0.8831304 |
| same command after fix | GREEN: both existing probes and version/live-write/deleted-service controls pass | 4.0137161 |
| `git diff --check` | passed, normal LF/CRLF notice | 0.0406541 |

Added verification **4.9375006 seconds**. Task 5 cumulative **37.7570809 seconds**; prior reported aggregate plus this fix **179.0626331 seconds**, excluding independent controller/reviewer checks not supplied here. All failed/probe/static commands counted. Read-only missing-review-file discovery and source/diff inspections were investigation.

RED output:

```text
AssertionError: Expected values to be strictly equal:
true !== false
at workerProbe (task-5-probes.mjs:111)
FIX_PROBE_WALL_SECONDS=0.8831304
```

GREEN output:

```text
Two disposable incident probes passed.
FIX_PROBE_WALL_SECONDS=4.0137161
```

Exact diff self-review: one actual-write capture extension and one shared historical validation block; checksum includes `_version` and the full actual change, live log comparison uses the historical entry rather than current item, missing live service retains captured proof, existing stop/source/lease anchors remain checked. Fresh two-probe GREEN and whitespace check follow final production edits. No rebuild was needed for this bounded JS receipt consistency change, under the explicit fix instruction. No known remaining concern for this finding.

Fix commit `408cbbbbe5eae57275c3c79304ae787c5fbc7445` — `fix(data): bind incident update receipt to captured history`. Post-commit status is clean; report/probes remain ignored.

## Archived task-5-spec-review.md

# Task 5 spec review

Fresh /root/capstone_task5_spec range4b7d89f..6bed967. Spec compliant; quality approved within spec seat. No Critical/Important. Strengths fixture117 separatecontrols, incidents121 active/one-shot/primitives,45/57 workeractualstale/DEL/lease/replay/restart/positive,90/99 poolwarmcold/thresholds/artifact/history. Focused stages107/186/193 recordhash/buildsnapshot linkcheck. Futureownership/LabwiringtrackedTasks6/7; ignoredprobe historicalexecution claims reviewedviafullreport output, independentlyintegratedwalkthrough stilldue. MinorbaselinechunkwarningM1. No rerun/probe/build0s.

## Archived task-6-quality-review.md

# Task 6 quality review

Reviewer /root/capstone_task6_quality, range408cbbb..96e925a. Spec compliant; quality approved. No Critical/Important/Minor findings. Validation0s.

Evidence: ownership.js95 group guard;155 exact frozen deletion effect;168 retained incarnations and resurrection rejection; core test322 real command/persistence controls. Focused unchanged risk check sandbox/ops.js100–115 group cascade uses resourceGroup inventory field. Recovered clipped diff middle and commandAction274–311 to confirm effects precede ownership capture.

Cannot verify downstream Task7 seed/hooks/seven stages and full cleanup: tracked as Task7 requirements.

## Archived task-6-report.md

# Task 6 implementer report

Status: DONE. Base `408cbbbbe5eae57275c3c79304ae787c5fbc7445`, branch `codex/data-capstone`, worktree `E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/data-capstone`. Read Task 6 brief, complete binding context and Task 4/5 interface reports; complete implementer prompt, TDD, writing-good-tests, verification and systematic-debugging instructions. Controller explicitly limited testing to one appended permanent case in the existing named core file. No subagents/reviewers, installs, cloud/network traffic, timers, build, full suite, AKS/Container Apps/browser/legacy replay, merge/push/PR/publication.

## Implementation and exact interfaces

Created `src/lib/labEngine/data-capstone/ownership.js`. Required exports:

- `captureDataOwnership(before, after, commandResult, lab) -> run`: compares actual before/after inventories and supported successful command results. The existing command primitive passes the returned result plus its exact executed `command` string. Failed commands, show/update, existing matching creates, baseline identities and unsupported resource types cannot create receipts. Only group/PG/Cosmos/Redis creations and the trusted API/worker Deployment applies are captured. IDs are normalized to lower case with trailing slashes removed; identity matching never uses name/group prefixes.
- `dataCleanupInventory(run, lab) -> {owned,protected,unowned,protectedIntact}`. Each display row is exactly `{resourceId,type,createdSequence,protected}`. Owned means a live identity matching its most recent creation receipt with no matching deletion, excluding protected identities. Supplied references are retained even when absent so their loss is visible. No credentials or service contents are included in inspection.
- `dataFrozenActionAllowed(run, action, lab) -> boolean`: read-only inspection and exact receipt-owned supported service/group/Deployment deletion authorization. Group deletion requires every live resource in that exact group to be owned; an unowned resource or protected prerequisite blocks it. API and worker deletion must match the trusted Lab workload targets. Service/group cleanup requires freeze; exact owned Deployment maintenance is permitted before freeze.

Future Task 7 Lab must wire:

```js
import { dataOwnedCleanupReady, dataFrozenActionAllowed } from '../../../lib/labEngine/data-capstone/ownership.js'
dataCleanup: {
  ready: dataOwnedCleanupReady,
  allowAction: dataFrozenActionAllowed,
}
```

`dataOwnedCleanupReady(run,lab)` requires a cleanup checkpoint, intact protected inventory, no live receipt-owned resources or trusted API/worker Deployments, and a matching deletion receipt for every creation incarnation. Maintenance receipts must precede freeze; cleanup receipts follow it. Live reappearance of a deleted identity without a new creation receipt fails both readiness and import validation. Task 4's normal stage validation continues to validate the frozen final recovery proof before final sealing; no recursive stage/run validation is introduced in the readiness hook.

Internal shared exports `dataProtectedRefs(run)`, `dataCommandAllowed(run,action,lab)`, `dataOwnedDeletionEffect(run,effects,lab)` and `validateDataOwnership(run,lab)` support the normal adapters. `createBehavioralRun` captures protected references immediately after the existing initializer returns its unchanged four fields (`sandbox`, `artifacts`, `runtime`, `nextSequence`). Initial groups/services and supplied AKS/ACR/namespace/Service identities are protected, including supplied Deployments if present. Task 7 initializer must therefore supply infrastructure and Service but leave the learner API/worker Deployments absent.

Normal private `commandAction` checks ownership **before runLine**, covering both public command dispatch and the same private command primitive used by Task 5 incidents. There is no incident bypass, caller ownership flag or permission token. Existing Azure group/PG/Cosmos/Redis commands perform the actual deletion. Actual normal effects are captured after successful application. Pre-freeze Kubernetes state effects that remove inventory also require an exact owned Deployment deletion. Frozen direct effects must consist of precisely the existing supported owned Deployment delete result: the adapter re-executes that supported command against the current detached state and compares the complete effect. Extra mutation or arbitrary Kubernetes/build effects are rejected. Direct accepted deletion effects capture ordinary historical deletion receipts, too.

Creation receipts contain `{sequence,attemptId,resourceId,type,before:null,after:{resourceId,type,uid},command,receiptHash}`. Deletion receipts contain `{sequence,attemptId,resourceId,type,createdSequence,before:{resourceId,type,uid},after:null,purpose,command,receiptHash}`. Purpose is derived from actual freeze state (`maintenance` or `cleanup`), never caller data. UID distinguishes worker incarnations; maintenance delete/reapply retains both historical creation incarnations and the original deletion. Shared stage validation checks receipt integrity, causal uniqueness, historical exact creation/deletion linkage and live identity consistency. The stages deletion-order rule now distinguishes valid pre-freeze maintenance from post-freeze cleanup. Hashes are persisted consistency checks, not authentication against rewriting the entire save and recomputing all hashes.

The inspect scenario now exposes compact ownership inventory. Actual worker deletion clears the active `runtime.dataCapstone.worker` batch/artifact reference; Kubernetes cascade already removes live Deployment/ReplicaSet/Pod/snapshot state. Artifacts, source snapshots, evidence, source journal and command history remain intact. Retry after partial cleanup resumes from saved historical receipts and deletes the remaining owned services without reopening final proof.

## TDD evidence and validation ledger

Exactly one new permanent case appended to `tests/data-capstone-core.test.js` (5 -> 6), reusing `capstoneCoreFixture`, `coreScenario`, `stagedVerify` and existing solution source exports. No second test file or disposable probe added.

The case's specific breaks are missing primitive ownership guard, claiming preexisting/repeated creates, accepting arbitrary frozen effects, deleting foreign/protected group contents, or accepting disappeared/recreated identities without actual receipts. It uses a real initializer with supplied AKS/ACR/namespace/Service and preexisting PG, real supported command results, normal build/apply/delete operations, real measured inspect evidence/stage freeze and normal JSON persistence. The bounded two-stage adapter case does not replay the future seven-stage Lab or claim SDK incident recovery coverage.

Controls cover supplied group/AKS/ACR/PG deletes before freeze; same existing create producing no ownership; failed create; successful new group/PG/Cosmos/Redis; repeat/create/show/update producing no extra receipt; actual returned supported create before/after capture; namespace/Service protection; exact worker maintenance delete/reapply; fresh ordinary proof then freeze; foreign resource in an owned group blocking cascade; arbitrary frozen state mutation rejection; direct exact owned Deployment deletion acceptance/receipt; canonical two Deployments plus three services plus group deletion; actual owned-group cascade alternative; leftover services blocking final seal; partial-delete serialization/resume; array clearing without receipts rejected; historical artifacts/evidence/source/protected inventory preserved; frozen create blocked; reappearing deleted service blocking readiness/import; full cleanup readiness and final sealing.

All named test runs used exactly:

```powershell
$task6Watch = [Diagnostics.Stopwatch]::StartNew()
npm.cmd test -- --run tests/data-capstone-core.test.js
$task6Watch.Stop()
Write-Output "TASK6_VALIDATION_SECONDS=$($task6Watch.Elapsed.TotalSeconds)"
```

| Run | Result | Wall seconds |
| --- | --- | ---: |
| RED before production | missing captureDataOwnership; 1 failed, existing 5 passed | 3.1318171 |
| Initial GREEN | all 6 passed | 3.7675345 |
| Self-review exact creation target/direct deletion/group contamination/recreation controls | all 6 passed | 3.7676421 |
| Final production GREEN after active worker-reference clearing and group-cascade control | all 6 passed | 3.8453907 |
| `git diff --check` | passed; ordinary LF/CRLF notices | 0.0429701 |
| `git diff --cached --check` | passed, including new ownership.js | 0.0345874 |

Task 6 validation subtotal before staged check: **14.5553545 seconds**. Controller supplied prior cumulative **180.0224594 seconds**; combined **194.5778139 seconds** before staged check. All failed/assertion/static commands are included. Read-only source/diff/contract inspections were investigation. No extra probe, broad suite or build was run.

Final Task 6 validation total: **14.5899419 seconds**. Final combined aggregate: **194.6124013 seconds**. Staged whitespace check passed after complete exact-diff self-review; post-commit status is clean. Commit: `96e925ae02bfb58f0241ad068f2f9e5c6cb62217` — `feat(data): clean up only capstone-owned resources`.

Meaningful RED:

```text
tests/data-capstone-core.test.js (6 tests | 1 failed) 530ms
cleans only receipt-backed creations while preserving supplied references and partial cleanup history
  expected undefined to be type of 'function'
Test Files 1 failed (1); Tests 1 failed | 5 passed (6)
Duration 2.19s
TASK6_VALIDATION_SECONDS=3.1318171
```

Final production GREEN:

```text
tests/data-capstone-core.test.js (6 tests) 1260ms
cleans only receipt-backed creations while preserving supplied references and partial cleanup history 726ms
Test Files 1 passed (1); Tests 6 passed (6)
Duration 2.91s (transform 695ms, collect 1.35s, tests 1.26s, prepare 87ms)
TASK6_VALIDATION_SECONDS=3.8453907
```

## Exact diff self-review, files and limits

Created ownership.js; modified labEngine/actions.js, run.js, data-capstone/stages.js, kubernetes/data-capstone-actions.js and the existing core test file. Report is ignored scratch. The existing actions.js/run.js are large shared files, but changes remain bounded Data branches; no unrelated adapters were restructured.

Read exact production/test diff and complete new module, plus actual dispatcher, command result, Kubernetes cascade and incident primitive consumers. Self-review tightened creation capture to the parsed exact ARM identity, rejected resurrection of deleted identities, cleared live worker references on deletion, and covered supported direct effects and owned-group cascade. Normal pre-freeze incident maintenance now records its distinct purpose and preserves both worker incarnations, allowing Task 5's normal primitive to keep its existing receipt observations. No known blocker. Final seven-stage Lab wiring, actual two-incident recovery and ordered whole-Lab walkthrough remain Task 7 work. Full suite/build deliberately unrun under explicit Task 6 instructions.

## Archived task-6-spec-review.md

# Task 6 spec review

Reviewer /root/capstone_task6_spec, range408cbbb..96e925a. Spec compliant; quality approved. No Critical/Important/Minor findings. Validation0s.

Evidence: ownership.js119–146 exact successful supported before/after creations;95–107 pre-execution protection/group guard;155–167 exact direct deletion effects;168–212 historical linkage; stages.js230 purpose ordering; run.js343 post-initializer protected capture; core test322 one comprehensive real-command case. Focused unchanged checks actions.js633 shared guarded incident executor and stages.js206–210 causal receipt sequencing.

Cannot verify downstream Task7 seed, cleanup hooks, incident/full walkthrough: tracked as Task7 requirements.

## Archived task-7-fixreview-1.md

# Task 7 scoped fix round 1

Reviewer /root/capstone_task7_fixreview1, range39f7ab5..0dedbdd.

S1 ADDRESSED lab165–166 preserving earlier RAG; S2 ADDRESSED runtime567–596/bridge136–149/lab162 actual consumed Cosmos; S3 ADDRESSED lab119–126 relevant indexes; Q7-1 ADDRESSED runtime518–524/bridge112–113 actual bound equality scope.

New Important Q7-R1 runtime523–524: capture maps every documents predicate via condition.value, but supported IN holds condition.values. Correct retrieval plus outcome-equivalent d.id IN (all corpus document IDs) returns500/DATA_UNSUPPORTED rather than200. Restrict capture to relevant equality predicates or handle IN safely. Read-only runtime probe0.7095069s; control200, equivalent IN500, no parser diagnostics. No successful checks rerun. Deferred Q7-2 remains outside fix.

Verdict: four addressed; Q7-R1 open.

## Archived task-7-fixreview-2.md

# Task 7 scoped fix round 2

Reviewer /root/capstone_task7_fixreview2, range0dedbdd..7440a6a.

Q7-R1 ADDRESSED runtime520–524 selects scope equality before condition.value, excluding IN; actual SQL unchanged. bridge109–115 still requires actual consumed empty linkage and all three bound equalities. Report RED500 and GREEN13/13 controlHTTP200/correct answer/sources1,2 inspected, no rerun. No new breakage/outside observations. Minor Q7-2 deferred. Validation0s, all findings addressed.

## Archived task-7-quality-review.md

# Task 7 quality review

Reviewer /root/capstone_task7_quality, range96e925a..39f7ab5. Issues found, needs fixes. Seven stages/tasks, separate releases, hooks, gates present; original historical linkage and loads coherent.

- Important Q7-1: data-capstone-actions.js112 checks positional values, not effective scope predicates. Detached actual captured retrieve_passages changes product/version/language equality to <>; no-match still grades emptySourceValid/provenance/answers true. Capture/validate actual executed equality scope semantics while preserving consumed-empty linkage.
- Minor Q7-2: DataCapstonePanel.vue57 gates results on scrollback result; retained recovery68 inside it disappears when scrollback cleared. Render durable recovery independently.

Focused unchanged checks labRun.js31/293 display risk; recovered truncated validateProof/frame/load context. Snapshot inspection0.3753135s plus one frame scope probe0.4026486s; added0.7779621s. No files/mutations/accepted workload or suite/build reruns.

## Archived task-7-report.md

# Task 7 implementer report

Status: DONE. Base `96e925ae02bfb58f0241ad068f2f9e5c6cb62217`, worktree `data-capstone`, branch `codex/data-capstone`. Read the exact Task 7 brief, complete binding context and required earlier interfaces, complete implementer prompt, TDD/writing-good-tests, verification and systematic-debugging instructions. No subagents/reviewers, broad/full tests, browser/cloud/network, installations, long timers, merge/push/PR/publication. User approved existing-style reuse, with no visual redesign.

## Implementation and exact downstream interfaces

Created `capstone-helpers.js`, `capstone-seed.js`, `capstone.lab.js`, `DataCapstonePanel.vue` and `docs/superpowers/data-capstone-progress.md`. Modified catalog, LabPanel, ExperimentPanel, ProjectEditor, handoff and original curriculum status. The controller explicitly authorized bounded extra consumers: TaskRow, capstone template/runtime helper, SDK lowering/runtime, capstone bridge, stages and incidents. No legacy Lab definition was changed.

`dataCapstoneLab`: id `data-knowledge-assistant-capstone`, engine2/content1, journey `data-knowledge-assistant` order13, `labMode:'capstone'`, skill area data, PostgreSQL tag. Exactly seven stages and 15 task IDs from the brief. `dataIncident.validate=validateDataIncident`, stage/scenario maps are worker-checkpoint→worker-incident/inject-worker and cache-masked-pool→pool-incident/inject-pool; registry `acrassistant`. `dataCleanup.ready=dataOwnedCleanupReady`, `allowAction=dataFrozenActionAllowed`.

`seedDataCapstone(run)` returns exactly `{sandbox,artifacts,runtime,nextSequence}`. It supplies AKS/ACR, assistant namespace and Service plus the ordinary generated AKS infrastructure/default namespaces; no API/worker Deployment, data services, corpus, sources, saved source journal, build or evidence injection. Starter files have all learner function zones unfinished. Eleven supplied references are protected in the actual run.

`DATA_CAPSTONE_TARGET` reexports the shared composite target. `DATA_CAPSTONE_API_TARGET` is supplied `aks-assistant`, namespace assistant, Service/Deployment assistant-api; worker target uses feedback-worker. `dataCapstoneDependencies(fields)` fails closed outside its whitelist: api/worker artifact, config and individual function IR hashes/current agreement; PG resource/schema/rows hash/indexes; Cosmos policies, durable id/continuation and event change revisions; Redis resource/index; incident starts; exact ownership inventory. No global clock/cache-key fingerprint is introduced. Pool/final checks explicitly require saved/current API configuration agreement. Historical diagnostics select immutable incident identity and remain bound to original actual receipts.

Every Solution uses full relevant saved file content, actual commands, distinct captured tags, only its own workload image manifest, apply/rollout and authored scenario/action. File resolvers replace only requested function zones in the current saved learner source, and TaskRow displays/copies that complete resolved source without dispatching writes or actions. Action steps explain explicit freeze/advance. Initial RAG calls fixed protected `rag_route(question,product,version,language)` through GET /rag, matching server/manifest, calling only rag_answer. Later cache/history/worker functions preserve earlier current zones. API and worker remain separate captured versions.

Provisioning reuses PG/Redis helpers with `rg-data-capstone` substitution. GeneralPurpose Standard_D2ds_v5/storage32, vector allow-list/extension, coherent corpus/schema, metadata and cosine HNSW indexes, Session/NoSQLVectorSearch Cosmos with four 400 RU/s partitioned containers and DIM8 cosine embedding-exclusion policies, and Balanced_B0 RediSearch/NoEviction/scoped DIM8 HNSW are represented in runnable commands and saved project SQL/policy files. Existing Cosmos CLI supports inline JSON rather than @file; Solutions inline the complete supplied policy JSON. PG retrieval uses SET LOCAL for transaction pooling. Repaired API manifest has replicas3.

No-match proof uses protected `training_no_match(rows)` consuming an actual empty PG result. Runtime retains that PG origin and marker on the returned answer; sources retain the same empty result origin. The bridge requires matching scoped bound parameters, actual zero rows and helper trace. An invented empty array or equal literal after an incidental SELECT has no origin and fails. This adds composite-only detached PG `params` facts, not credentials. Unknown zero embeddings are deliberately skipped by semantic lookup/storage; they still reach PG no-match and exact cache/history.

Only trusted Lab tasks worker-fault-observed/pool-fault-observed may set `evidenceMode:'historical'`. The adapter still validates the original evidence/source journal/hash/scenario/incident receipts and immutable selected dependencies; it relaxes only their comparison against later current source/live configuration and seal source versions. Repair/final proofs preserve the normal current/fresh guards. `measurements.loads` retains each actual modeled load with artifact and step/start identity; existing `.load` remains the last load. Pool observation supports the old separate evidence form and the single-task ordered warm/cold form, retaining exact fault pool/replicas/server/error/time requirements.

UI capability gating suppresses single-service/AKS panels only for Data capstone. Existing styles are reused. It shows locked/active/sealed stages, scenario/one-shot incident controls, actual service facts, sources/history, continuation/restart/DEL effects, warm/cold loads, remaining/protected inventory and freeze/advance. Project saves are disabled/explained after freeze; authoritative central guards remain. Retained final recovery answers remain available after cleanup.

## TDD and bounded verification

No new permanent case, replay file or legacy import was added. Existing 15 SDK + six core cases pass, preserving the branch's eight-new-case maximum. RED was the missing Lab publication assertion in the single ignored disposable script before production code. The script progressively consumes own file/command/scenario/action steps through public dispatch and evaluates actual outcomes. Existing Task5 `dispatch`/`request` helpers and shared authored incident scenarios are reused in that same script; Task5 probes were never run standalone.

Accepted path: **25 authored answer/RAG calls**; two detached negative forks add **three** calls; total **28**, plus bounded modeled warm/cold demand and no request loops. One accepted walkthrough completes all15 outcomes/seven seals. Development failures are recorded separately; there was one necessary failed-prefix restart after fixing duplicate ordering once Support was already updated. Later generated JSON checkpoints resume only affected portions. Final snapshot-only checks do not rerun workloads or the accepted walkthrough.

Assertions cover absent→ready provisioning, actual definitions/corpus; real saved-source/old-Pod separation; scoped PG passage/source provenance; exact/semantic hits with actual history writes; scoped similar history; foreign product/version/language; different near-miss PG answer; actual empty-source no-match; positive no-op, both negative-feedback DEL namespaces, Support update stale-before/fresh-after; nonempty duplicate before restart and durable later no-op; one-shot visible worker injection and immediate repair; actual warm versus expired-cache pool fault and cold PgBouncer recovery; both incidents resolved with fresh final sources/history; freeze rejects saves and premature final seal; JSON resume after a seal and partial cleanup; protected refs intact; seven exact creation/deletion incarnations including maintenance; completion only after final seal. Retained malformed diagnostic evidence is rejected on JSON import.

Negative1 takes an already built pre-incident detached run, performs successful incidental scoped SELECT and cache lookup, then returns the exact expected nonempty/no-match literals. Both expectedAnswer facts are true but returnedFrom is null and provenanceValid false. Negative2 takes another detached copy of the same pre-incident setup, drops semantic deletion only, deploys that worker, applies previously unapplied Backup revision2 and immediately queries paraphrase: returnedFrom semantic-cache, staleAnswers1, answer35days, expectedAnswer false. Accepted run serialization is unchanged by either fork. No false freshness test reuses updated Backup source.

Full timing/attempt ledger is committed in `docs/superpowers/data-capstone-progress.md`. Task7 assertions/probes/final checks subtotal before final whitespace checks **228.5185706s**; prior aggregate **194.6124013s**; combined **423.1309719s**. Failed validation runs and retries count. Read-only discovery/source/diff investigation is not an assertion rerun.

Final required commands ran exactly once after fixes:

```
npm.cmd test -- tests/data-python-sdk.test.js tests/data-capstone-core.test.js
Test Files 2 passed; Tests 21 passed (15 SDK,6 core); Vitest3.14s
complete wall4.1697747s

npm.cmd run build
568 modules; built4.59s; existing >500kB bundle warning only
complete wall5.3590501s
```

Meaningful RED: `AssertionError: Lab13 must publish its own seven-stage runnable definition`, actual undefined; wall0.2920067s. Final accepted walkthrough output lists every task, seven seals, partial cleanup resume and `One own-Solution walkthrough passed.` Last snapshot checks report current config, corpus, saved/Pod separation, exact receipts, tamper and authored-count assertions passed without workloads.

## Self-review, decisions and limits

Read the exact tracked diff and final new files. Fixes from actual failed consumers: empty-context selector guard; supported inline Cosmos policies; end-stage narrow prior verification refresh; compact row/function hashes to fit bounded seals; duplicate-before-restart ordering; durable continuation rather than incidental lease upsert version; zero-vector semantic bypass; original-record historical diagnostics and ordered load aggregation; current API config agreement; normalized SQL timestamp corpus comparison; correct actual protected/generated infrastructure count. Controller-authorized seam decisions are listed in the progress ledger; independent spec/quality and whole-branch reviews are pending, not claimed.

No known blocker. Real cloud/browser/legacy/full suite coverage remains explicitly unverified. Hashes are persisted consistency checks, not authentication against rewriting an entire save. The existing shared runtime/bridge/stage files remain sizable; edits stayed bounded. No optional edge-case matrix, speculative visual work, installation or publication occurred. Controller will add independent review findings, final whole-branch gate, chronological rulings and integration direction.

## Final commit and static checks

Committed exact self-reviewed 19-file diff as `39f7ab5d46590bc74512ba5b9f9939b0d6681072`, `feat(labs): add resumable Data Knowledge Assistant capstone`. Tracked worktree is clean. No merge, push or publication.

`git diff --check` passed in 0.052909s; `git diff --cached --check` passed in 0.0370919s. Final Task7 validation total **228.6085715s**; prior plus Task7 **423.2209728s** (7.054 minutes). No further test, replay or build was run after the final named 21-case command and single build above. Independent reviews and whole-branch final gate are still pending.

## Fix round 1 — review findings S1/S2/S3/Q7-1

Fix base `39f7ab5d46590bc74512ba5b9f9939b0d6681072`. Complete independent spec/quality reports read; receiving-review, debugging/TDD/writing-good-tests and verification guidance followed. Four Important findings confirmed with focused RED before production edits. Minor Q7-2 deferred by controller, not silently treated as fixed.

Root causes and exact downstream changes:

- S1: history release used the verification list as its replacement list. Exclude the three earlier RAG functions only from this later edit; checks/dependencies remain. Equivalent correct learner RAG using `retrieved_rows` executes and its parsed IR survives the history resolver.
- S2: history predicate compared shallow literals and bridge only graded answer routes. Composite runtime now captures actual read id/partition/full public item, actual query rows and parsed/bound effective filter/vector/order facts. Its ordinary value-flow carries consumed Cosmos call identity through a copied result list. Actual capstone embedding helper calls are traced in their existing redis-helper execution branch. Bridge `historyReadValid` requires that same consumed call, full returned item/rows, requested id/partition, effective product/version/language equality, requested-question embedding and >=0.95 cosine similarity threshold plus vector ordering. `GET /sessions` and `/similar` contribute to `provenanceValid`; owning Lab requires both read facts. Incidental calls or invented equal-looking dictionaries/lists never earn a Cosmos origin.
- S3: readiness previously accepted methods anywhere. Now B-tree's leading scope columns and GIN metadata must be on documents; cosine HNSW embedding must be on chunks, with no irrelevant partial predicate. Arbitrary names, equivalent plain column expressions and both jsonb opclasses/default remain supported.
- Q7-1: actual zero-row PG result linkage alone did not establish scope because only positional values were checked. Composite SDK records `scopeFilters` from the actual successful statement AST bound with its actual parameters, resolving the documents relation/alias. Bridge requires effective equality on the three requested scope fields on that same consumed PG call. No SQL/source regex or expected-answer oracle is used for this check; actual rows/helper/source linkage remains unchanged. `<>` predicates fail even when they yield the expected no-match answer.

Changed production files: only `capstone.lab.js`, `src/lib/data/runtime.js`, `src/lib/kubernetes/data-capstone-actions.js`; plus required progress document. Exact diff self-reviewed. No new permanent cases, build, full walkthrough, matrix, cloud/browser/legacy/full suite, merge or push.

### Focused RED/GREEN and boundaries

One ignored script `node .superpowers/sdd/2026-10-02-data-lab-13-capstone/task-7-fix-controls.mjs`, evolved in place. It reads original task3/task5 snapshots without rewriting them. Detached captured-artifact substitution uses real parsed learner source and actual runtime/store execution; it deliberately avoids redundant build/public-dispatch replays. PG index controls execute actual supported SQL, not fabricated index JSON. The owning task predicate consumes original accepted unrelated measurements plus newly executed history read facts; this is a focused boundary check, not a new accepted walkthrough.

Meaningful RED output: S1 overwrites alternative variable IR; S2 accepts canned reads, incidental real reads then invented returns and missing scoped predicates; S3 accepts distractions-table indexes; Q7-1 accepts inequality no-match. Existing valid alternative RAG, actual history, alternative relevant indexes, actual scoped no-match and literal-after-incidental-call rejection run alongside these negatives. Initial test setup used an incomplete variable rename and was corrected before meaningful RED; an in-memory stage mutation in the test observation helper was changed to a detached clone, leaving snapshot files untouched. First GREEN found missing embedding trace because composite `embed` lowers through redis-helper, not builtin; trace was moved to the actual executed branch. Diagnostic/failing attempts count.

Final script output: **12 PASS**, `All focused Task7 review controls passed; accepted evidence was not replayed.` Includes equality of returned rows with/without threshold to show semantic provenance—not body inequality—rejects the unbounded vector query. Four authored `/rag` calls per complete controls attempt plus bounded two-read observations; no load/timer/request loops. Original accepted walkthrough remains its earlier25+3-call evidence, not rerun or rewritten.

Validation ledger (seconds): initial failed Node quoting inspection0.1421658; script setup failure0.3091643; meaningful RED0.4237052; first GREEN diagnostic failure0.6289886; detailed diagnostic failure0.5652051; GREEN0.454322; final12-control pass0.5231339. Shared logic warranted exactly one named `npm.cmd test -- tests/data-python-sdk.test.js tests/data-capstone-core.test.js`: **21/21**, Vitest3.01s, tests1.70s, complete wall4.0687063s. No build rerun. Added subtotal before final static check **7.1153912s**; supplied pre-fix423.9989349s -> **431.1143261s** before final static check.

Remaining limits: these focused controls do not claim an accepted end-to-end replay under the new history fact schema; original accepted snapshots/reports remain historical evidence at their original commit. Independent re-review and whole-branch final gate still pending. Existing UI retained-proof display minor Q7-2 is deferred final triage. No known additional blocking issue found in exact-diff self-review.

Fix commit `0dedbdd2be7e796b78d4a02be305f3b2ae6ade7c`, `fix(labs): bind capstone grading to consumed scoped data`; tracked worktree clean. Staged whitespace check passed0.0382672s. Final fix-wave validation **7.1536584s**; cumulative **431.1525933s**. No checks/build/replay run after the named tests beyond the staged whitespace check.

## Fix round 2 — Q7-R1

Fix base `0dedbdd2be7e796b78d4a02be305f3b2ae6ade7c`. Complete `task-7-fixreview-1.md` read along with review reception, systematic debugging, TDD/writing-good-tests and verification guidance. Scoped reviewer marks S1/S2/S3/Q7-1 ADDRESSED; new Important Q7-R1 confirmed. `pg-sql.js` represents scalar comparisons with `value`, supported `IN` with `values`. Scope evidence capture mistakenly mapped every documents predicate, so `evaluatePgExpression(undefined)` introduced non-JSON metadata and trainingSnapshot threw DATA_UNSUPPORTED after otherwise successful actual SQL.

Minimal fix: two-line filter in runtime captures only actual bound documents `product`/`version`/`language` equality conditions that the bridge certifies. No query/AST/engine execution changes, no invented metadata for unsupported operator shapes; actual inequality predicates still execute but cannot certify requested equality. Existing consumed empty helper/result linkage unchanged. Exact production diff self-reviewed, plus required status document.

ONE equivalent-IN control added to the same ignored `task-7-fix-controls.mjs`: actual scoped retrieval gets an additional `d.id IN (...)` list containing all actual corpus document IDs. Parsed captured source has zero diagnostics; observed output independently requires HTTP200, correct answer/provenance and sources[1,2]. Command `node .superpowers/sdd/2026-10-02-data-lab-13-capstone/task-7-fix-controls.mjs` RED1.1397407s: prior12 controls pass, new one fails500 with `DATA_UNSUPPORTED: PostgreSQL training evidence must be bounded finite JSON`. Same command GREEN0.9659225s: all13 controls pass. This includes original equality empty-source qualification, inequality rejection and literal-after-incidental-call rejection, authentic history and previous preservation/index controls. Five authored RAG calls per complete round2 controls attempt; no accepted replay, build, timer/loop or permanent case. No named SDK/core rerun: change is only composite diagnostic selection, and the focused script directly covers its regression plus original valid/negative certifications. Latest named21-case pass remains round1 evidence, not represented as newly rerun.

Added before static check **2.1056632s**; supplied pre-round431.8621002s -> **433.9677634s**. Original accepted snapshots untouched. Minor Q7-2 deferred, independent re-review and whole-branch gate still pending. No additional known blocking issue.

Round2 committed `7440a6a10571e50df6bb44de3ea6ac8cac8c78a4`, `fix(data): limit capstone scope capture to equality predicates`, tracked clean. Staged whitespace check passed0.0628503s. Final added round2 validation **2.1685135s**; cumulative **434.0306137s**. No further validation beyond that static check.

## Archived task-7-spec-review.md

# Task 7 spec review

Reviewer /root/capstone_task7_spec, range96e925a..39f7ab5. Issues found, needs fixes; validation0s. Exact seven stages/15 tasks, seed, hooks and historical/loads integration present. Accepted walkthrough evidence readable, not rerun; real cloud/browser excluded.

Important findings:

- S1 Earlier correct RAG work overwritten: capstone.lab.js158 passes appHistory (including three completed RAG functions at37) to editFunctions, whose helper39 replaces canonical zones. Keep them in verification/dependencies but exclude from later replacement edits.
- S2 Fabricated history reads accepted: capstone.lab.js155 only sessionId,156 any nonempty same-scope list; bridge147 grades answer provenance only answer/rag. Constant session dictionary/scoped singleton satisfies without actual Cosmos reads. Require actual requested history content and actual filtered similarity result, not saved/deployed equality alone.
- S3 Unrelated PG indexes accepted: capstone.lab.js118 any index each method,119 cosine opclass anywhere. Require actual B-tree metadata path, GIN metadata and HNSW chunks.embedding/opclass; permit alternative names.

Focused unchanged checks: provisioning command constants and validateProof historical linkage. No reruns.

## Final documentation record

The controller archived all34 report/ledger artifacts and31 chronological rulings, updated final handoff/status, and ran documentation whitespace checks: initial0.0594831s; staged audit0.0468737s found only an extra EOF blank line; after mechanical correction final staged check passed0.0414717s. No product code changed after the clean scoped review. Total known measured validation481.4056855s; separate unknown-probe allocation300s; accounted781.4056855s. Main remains clean at36d8cbc, integration not performed. Disposable plan scratch may be removed after this record is committed; full audit and Git history preserve reports/rulings, while temporary probes are intentionally not permanent tests.
