# CPU troubleshooting Lab implementation plan

> REQUIRED: superpowers:subagent-driven-development. Execute this one-Lab increment, review, verify and deliver before planning Lab6.

**Goal:** Deliver `aca-cpu-troubleshooting`, journey order5, by diagnosing a replica ceiling from observed CPU/throughput and proving repair under unchanged workload, followed by quiet scale-in.

**Architecture:** Content and integration over the delivered CPU engine/controls. Reuse actual simulated private API publication/deployment. Extract common CPU seed/dependency helpers only where this second Lab justifies reuse; preserve Guided behavior. No new simulator feature or dependency.

**Authority:** Approved Container Apps learning-journey and technical designs, ADR-0002. Guided CPU delivery is complete:376/376 tests and215-module build in worktree and main, browser lifecycle and independent reviews passed.

## Global constraints

- Work only in retained `.superpowers/worktrees/aca-f0`, preserve dirty baseline, no staging/commits/git mutations. Sol high implementation, Terra high task review, Astra final broad review, root browser/testing and guarded delivery. Existing authorization covers sequential planning and implementation without renewed permission.
- Lab engineVersion2/contentVersion1, journeyId `containerapps-end-to-end`, order5, mode `troubleshooting`, containers Skill Area. Do not plan or implement Lab6 yet.
- All nine prior Labs plus CPU Guided remain intact. Six legacy Labs retain their semantics. Topic resources stay for inspection after completion; no cleanup requirement.
- Seed a healthy private API in `rg-aca-cpu-incident`, registry `acrcpuincident`, environment `env-cpu-incident`, identity `id-cpu-incident`, app `api-cpu-incident`, image `api:v1`, service `contoso-api`, external8080, APP_ENV=training. Supply SOLUTION_FILES.
- Initial policy0.5CPU/1Gi,min1,max1,target60. A named sustained workload offers0.8CPU-seconds/second, request cost0.02, duration90s. Seed the real scenario at30s, actively running with1ready,100%CPU,40offered/25served req/s. Initialization returns only sandbox/artifacts/runtime/nextSequence, never transcript, learner evidence, assistance or completion.
- Initial brief presents symptoms, observed load and operational constraints without announcing the root cause. Allowed repair retains0.5CPU/1Gi,min1,target60 and maximum at most5. Accept any maximum2..5 that meets the measured objective, not an exact command. These constraints are visible, not hidden acceptance criteria.
- CPU demand/duration/cost remain immutable manifest parameters. Stopping/cancelling load is not a repair. A fresh completed90s incident scenario with full service throughout the final15s and >1ready is required. Quiet scenario0demand/90s must begin above minimum and end at1 after stabilization. All current policy/deployment evidence rules apply.
- Reuse explicit simulated time,15s decisions,5s readiness,60s scale-in stability and10% tolerance. Keep fidelity disclosure and supported allocations visible. No new Azure claims require research; CLI contract was verified at Lab4 planning gate.

## Task1: Incident content, shared seed support and integration tests

Files: new `src/data/labs/containerapps-journey/cpu-troubleshooting.lab.js`, new `tests/aca-cpu-troubleshooting.test.js`; catalog/routing/counts/docs. If extracting shared code, create a bounded `cpu-lab-support.js` for private seed/deployment dependencies and final-window helpers, update Guided imports and preserve all existing exported Lab semantics. Avoid a general Lab factory or broad UI redesign.

- [x] Write RED tests for metadata, deterministic healthy seed, active30s incident metrics, zero learner evidence/assistance/transcript, two outcome Tasks and hidden optional help.
- [x] Implement seed with existing command actions for publication/identity/grant/app, then actual `scenario-start incident` and `simulation-advance30`. Validate action diagnostics and return only allowed four initialization fields. Do not fabricate measured sample values. The initial runtime is instructional context, not passing verification.
- [x] Task `recovery`: requirement-first wording asks full service for the unchanged0.8 workload with stated resource/replica constraints. Current health/policy predicate permits max2..5. Verification scenario `incident` version1 checks completed90s, >1ready and full served>=offered in every final15s sample. Dependencies include effective scaling inputs/generation and desired/status/active captured deployment. Optional hints guide CPU/config/replica comparison; second may identify ceiling. Worked Solution raises max to3 and reruns incident90s. Exam Note distinguishes requested target from possible capacity.
- [x] Task `quiet`: same current healthy constraints; versioned `quiet` scenario0/90s checks start>1 and end1. Worked Solution uses existing scenario action instructions; hints explain delay. No baseline/overload extra Tasks and no graded source/build work.
- [x] Integration tests: complete initial scenario without repair → failed; max3 repair → fresh incident pass then quiet pass; alternative max2 passes; max6/CPU1/changed target fail constraints even if demand is served; cancelled load or quiet-only cannot satisfy recovery; caller demand injection rejected; partial run/reload cannot pass; policy changed away/back invalidates earlier proof; failed desired image cannot borrow healthy old active metrics; no-op preserves current proof. Exercise Solutions through real reducer and native-store adapter, help accounting, partial reload, one completed Result, read-only completion, restart restoring30s fault and retaining history.
- [x] If shared helper extraction is used, keep it limited to duplicated CPU support. Existing Guided seed/scenarios/help/criteria must retain values and behavior. Run both CPU suites and relevant deployment/engine tests for that change.
- [x] Register Lab5 only; containers total5→6; routing CPU Guided→Troubleshooting→none, all deployment and legacy routes retained. Update README/SPEC/CONTEXT/ADR and both approved specs: CPU Guided+Troubleshooting delivered, Independent remains planned.
- [x] Run focused tests and self-review. Record RED/GREEN, modified files and any limits at `.superpowers/sdd/2026-09-23-aca-cpu-troubleshooting/task1-report.md`. Root owns full suite/build/browser.

## Delivery gate

Final-review correction: quiet evidence must follow the latest successful load proofs. Bind incident quiet to recovery evidence identity and require prior successful recovery. Root reproduced the same issue in Guided (sustained→quiet→baseline→overload completed at5ready), so apply the equivalent narrow correction there: quiet follows current baseline/sustained/overload proofs. Add both regressions and verify normal worked paths. This repairs the approved final scale-in contract; no engine or general task-ordering framework is needed.

- [x] Scoped task review and broad final review resolved, including final quiet proof ordering in both CPU Labs.
- [x] Full tests/build; browser initial symptoms/metrics, finish faulty run, diagnose via read-only Blade, valid repair and same-load90s rerun, quiet scale-in, pause/reload, help/Result/restart,768px layout and console clean. Final388/388 tests,216-module build; both ordering regressions verified in actual UI.
- [x] Guarded delivery check/apply lab-5, main tests/build and file hashes verified. Close this plan before planning Lab6.

Self-review: two learner outcomes reuse the delivered engine; seed advancement is real and returns no earned proof. Lowering offered demand cannot complete recovery because the only graded repair workload is fixed. Multiple correct replica ceilings are accepted within explicit constraints.

