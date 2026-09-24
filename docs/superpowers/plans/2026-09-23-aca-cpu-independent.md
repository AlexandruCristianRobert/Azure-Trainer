# Independent CPU scaling Lab implementation plan

> REQUIRED: superpowers:subagent-driven-development. This is the third/final newly authorized Lab; stop after its verified delivery.

**Goal:** Deliver `aca-cpu-independent`, journey order6, as a requirement-based capacity exercise accepting multiple CPU/target/replica configurations under a new steady/burst workload and final scale-in.

**Architecture:** Content and integration tests over the delivered CPU model, CLI, Portal controls and evidence engine. No simulator expansion, latency model, dependency or broad refactor. Use the established healthy private API seed pattern.

**Authority:** Approved learning/technical designs and ADR-0002. Lab5 is complete/delivered before this plan:388/388 tests and216-module build in worktree/main, independent reviews and browser checks passed. Its final correction binds quiet proof to the latest preceding successful load proofs in both CPU Labs; preserve and reuse that contract.

## Global constraints

- Retained `.superpowers/worktrees/aca-f0` only; preserve dirty baseline. No staging, commits, git metadata changes, external writes or new dependencies. Sol high implementation, Terra high task review, Astra final broad review, root integration/browser/guarded delivery. The user already authorized sequential planning and implementation.
- ID `aca-cpu-independent`, engineVersion2/contentVersion1, journeyId `containerapps-end-to-end`, journeyOrder6, mode `independent`, containers Skill Area. Do not plan/implement probes, Foundry, Bicep or later Labs.
- Healthy supplied API: group `rg-aca-cpu-independent`, registry `acrcpuindependent`, environment `env-cpu-independent`, identity `id-cpu-independent`, app `api-cpu-independent`, image `api:v1`; SOLUTION_FILES, service contoso-api, external8080, APP_ENV=training. Initial0.5CPU/1Gi,min1,max1,no CPU rule; no active scenario and zero learner proof/help/transcript.
- Requirements visible in brief/Tasks: choose0.5CPU/1Gi or1CPU/2Gi; minimum1; maximum at most4; any supported CPU Utilization target1..100 that meets observed goals. Exactly one CPU rule. No exact rule name, target or configuration is prescribed outside optional worked help.
- Immutable named scenarios: `steady`,90s,0.9CPU-seconds/second; `burst`,90s,1.8CPU-seconds/second; `quiet`,90s,zero. Per-request cost0.03CPU-seconds, producing30 and60 offered requests/sec. These differ meaningfully from Guided/incident fixtures: the burst must be served within a tighter ceiling, not merely observed as an overload.
- Steady goal: serve all30requests/sec throughout final15s. Burst goal: serve all60requests/sec throughout final15s with >1ready. Final quiet must follow latest successful Steady AND Burst proof, begin above minimum, and end at1 after stabilization. Steady/burst may be demonstrated in either order; quiet must be last. A later load proof invalidates prior quiet proof. No incomplete/failed/cancelled prerequisite may qualify.
- Multiple known-valid configurations must pass:0.5CPU/1Gi,target60,max4;1CPU/2Gi,target75,max3;1CPU/2Gi,target90,max2. The last choice can remain at1ready under steady demand, then scale for burst; do not require scale-out during steady or an exact threshold.
- Keep fidelity labels: requested-CPU denominator,1s ticks/15s scaler,10% tolerance,5s readiness,60s scale-in stability, explicit simulated time and illustrative throughput. No claim of real Azure performance/latency. Existing UI supplies supported allocation display and controls.
- Preserve all previous11 Labs and native persistence/immutable Results/assistance/restart behavior; no mandatory cleanup. Configuration/source changes follow existing captured deployment and evidence rules.

## Task1: Requirement-based CPU capacity Lab

Files: new `src/data/labs/containerapps-journey/cpu-independent.lab.js` and `tests/aca-cpu-independent.test.js`; catalog/routing/count assertions and docs. Reuse current engine/UI without redesign. No helper extraction is required; keep seed logic explicit and bounded.

- [x] RED tests for metadata, healthy actual published seed and no active scenario/evidence/assistance/transcript, requirement-first three Tasks and optional structured help.
- [x] Seed via real supported command actions, private AcrPull grant and captured deployment; fixed resource timestamps. Initialization returns only sandbox/artifacts/runtime/nextSequence. Do not inject metrics/results or repeat infrastructure Tasks.
- [x] Implement current resource/health criteria: supported pair, minimum1, maximum1..4, exactly one CPU Utilization rule with target1..100; current successful desired/active correct API. Measured throughput determines adequacy. Evidence captures scaling values/generation and complete active deployment plus desired/status.
- [x] Three Tasks in one `Capacity requirements` stage: `steady`, `burst`, `quiet`. Text states workloads, windows, throughput goals and constraints without command steps. Each has two optional hints, one worked Solution and Exam Note. Steady Solution may configure0.5/1Gi,min1,max4,target60 then start/advance steady; Burst and Quiet Solutions use existing scenario action instructions. State that configuration changes invalidate both load proofs and require reruns. Alternate valid targets/resource choices are welcomed in visible instructions.
- [x] Frozen versioned fixtures; final15s every sample must meet numeric30/60 goals and full offered throughput. Require trace15 samples; burst max/end ready>1. Quiet dependencies bind current successful Steady/Burst evidence IDs, and its check requires those records precede quiet. Copy the corrected local CPU pattern, without engine ordering machinery.
- [x] Positive tests run all three configurations above through real reducer actions and demonstrate final completion at1ready. Test burst→steady→quiet alternative order. Worked Solutions must complete via same actions and remain optional/assistance-accounted.
- [x] Negative tests:0.5CPU with max3 fails burst capacity (50of60req/s) even if steady passes; max5 or minimum2 violates constraints despite ample service; mismatched CPU/memory rejected atomically; target100 fails to scale for burst from minimum; config change between steady/burst invalidates prior proof, including away/back; caller-supplied demand rejected; partial/cancelled/failed load cannot qualify quiet; early quiet cannot be reused after later load proof. Test no-op config/tags preserve proof and failed desired deployment cannot borrow current-looking old metrics. Do not add artificial unsupported latency goals.
- [x] Store integration: partially completed selected load at45s persists/reloads same attempt without pass; finish remaining45s, complete all requirements and one Result; help accounting, completed read-only and restart fresh healthy minimum1 with prior Result retained. Reuse behavioralRepository fixture.
- [x] Register only Lab6; containers total6→7; routing CPU Troubleshooting→Independent→none, legacy/deployment routing unchanged. Update exact prior last-Lab assertions. Update README/SPEC/CONTEXT/ADR and both approved specs to three deployment plus three CPU Labs implemented; health probes onward remain planned.
- [x] Focused tests/new Lab plus previous CPU/engine/store/catalog/routing. Self-review and report RED/GREEN, changed files and limits at `.superpowers/sdd/2026-09-23-aca-cpu-independent/task1-report.md`. Root owns full suite/build/browser and final delivery.

## Delivery gate

- [x] Task review and final broad review resolved. Terra spec/quality PASS and Astra final READY; stale prerequisite fix checks values and generations across all three CPU Labs via the existing task context.
- [x] Full suite/build; actual browser requirements/optional help, under-capacity failure then recovery, two distinct valid configurations, pause/reload, final quiet ordering, Result/restart,768px keyboard/layout and clean console. Final405/405 tests in45files,217-module build; actual UI verifies stale prerequisites rejected and fresh completion at1ready in all three CPU Labs.
- [x] Guarded delivery check/apply lab-6, main tests/build and hashes verified. Close plan and stop at authorized three-Lab boundary, retain uncommitted worktree/reports.

Self-review: measurable capacity goals use the existing model with materially different workloads/cost/ceiling and genuine alternative configurations. All requirements are visible, graded fixtures are immutable, and final quiet cannot precede the most recent successful load proofs. No new platform or future Lab is needed.
