# Guided CPU scaling Lab implementation plan

> REQUIRED: superpowers:subagent-driven-development; implement and review each task in order.

**Goal:** Deliver journey Lab4, `aca-cpu-guided`, with observed CPU scale-out, an overload ceiling and stabilized scale-in. The approved journey/technical designs and ADR-0002 are binding. Lab5 is planned only after this Lab is delivered.

**Architecture:** Extend the bounded behavioral engine with capability-gated CPU policy and a pure one-second simulator. Reuse captured deployments, native persistence, versioned scenario evidence and existing Portal components. No new packages, services or actual Azure/.NET execution.

## Global constraints

- Worktree `.superpowers/worktrees/aca-f0` only, preserve all baseline changes, no staging/commits/git metadata edits. Sol high implementation, Terra high task review, root integration and browser checks; final broad review uses Astra. Controller delivers with recorded target hashes.
- Baseline: three deployment Labs delivered, 350 passing tests. Preserve six legacy Labs, legacy HTTP upsert semantics, request/source/build separation, read-only completed runs, assistance and immutable Results.
- Only this Lab is implemented now. Do not create Lab5/6 content or plans.
- CPU Labs start with a healthy seeded private API; setup is supplied, never learner evidence. Seed hook may return only sandbox/artifacts/runtime/nextSequence.
- Public CLI syntax verified 2026-09-23: [Microsoft scaling tutorial](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-scaling) documents `--scale-rule-type cpu --scale-rule-metadata type=Utilization value=60`, minimum1, and replacement of previous rules. Apply replacement semantics in CPU-capable behavioral Labs only; legacy HTTP Labs retain their established compatibility behavior.
- Supported CPU/memory pairs are Lab manifest data, initially 0.5/1Gi and 1/2Gi. Reject unsupported pairs and CPU-only minimum0 explicitly as simulation/Lab constraints. No claims of complete Azure validation or capacity prediction.
- Simulated time advances only through explicit bounded actions, never elapsed study time, reload or wall-clock timers. Teaching values: 1-second ticks, 15-second scaler decisions, 10% tolerance, 5-second new-replica readiness, 60 seconds of sustained lower demand before scale-in. Display these limitations.
- Evidence uses immutable named scenario fixtures; reject caller-supplied workload, duration, measurements or result fields. Partial/cancelled/paused scenarios cannot pass. Effective scaling/deployment changes abort active verification and invalidate relevant evidence; tags, no-op updates and draft edits do not.

## Task1: CPU policy, deterministic runtime and action integration

Files: CLI Container Apps command module, sandbox/containerapps.js, ARM presenter, simulation/cpu.js (new), simulation/runtime.js only where required, labEngine/actions.js, focused CPU tests. No UI/catalog content yet.

- [x] RED tests for capability gating, CLI parsing and atomic errors; implement CPU/memory flags and CPU metadata in create/update. CPU rules present as `{name,custom:{type:'cpu',metadata:{type:'Utilization',value:'60'}}}`. Reject unknown metadata, duplicate keys, unsupported type and out-of-range utilization. Target integer1..100. Keep HTTP support and existing legacy behavior.
- [x] For CPU-capable Labs, validate final candidate resource against `lab.cpuScaling.allowedResources` and positive minimum. A supplied rule replaces all previous rules. Preserve existing CPU/memory when omitted; presenters show actual allocations, defaults remain0.5/1Gi.
- [x] Add CPU runtime per app with ready/pending replicas, workload demand, stable sample history (bounded600), scale-in stability and policy fingerprint. CPU policy is independent of captured API generation; changes bump `scaling:<appId>` and reset appropriate runtime, without falsely changing unchanged source/request provenance. Deletion removes CPU runtime; recreation cannot resurrect stale evidence. Runtime is finite JSON, persisted without clocks.
- [x] Export `reconcileCpuRuntime(run, lab)` and `advanceSimulation(run, seconds, lab)` or equivalent narrow interfaces. At each tick mature pending replicas, measure actual ready capacity and CPU utilization capped100%, record offered/served throughput from demand and per-request CPU cost, then decide scaling at15s boundaries with `ceil(currentReplicas * utilization / target)`, clamped bounds and tolerance. New replicas do not serve before readiness. Require60s sustained lower demand for scale-in. Ensure chunked advances equal one combined advance. Demand above maximum capacity stays unsatisfied; reaching max does not imply throughput success.
- [x] Action API: `{type:'scenario-start',scenarioId}`, `{type:'simulation-advance',seconds}` (integer1..300), `{type:'scenario-pause'}`, `{type:'scenario-resume'}`, `{type:'scenario-cancel'}`. Exactly one active scenario, fixture supplies appId/duration/demand/cost/assessment. Unknown actions/scenarios/extraneous outcome or load fields fail explicitly. Pause prevents advancement until resume. Cancelling records no passing evidence. Advancing past duration stops at the declared window. A CPU action in a non-CPU Lab fails.
- [x] Scenario manifest interface: `{kind:'cpu',version:1,appId,title,durationSeconds,demandCpuSecondsPerSecond,requestCpuSeconds:0.02,assess(measurements, context)}`. Assessment is trusted Lab code, measurements engine-generated. Persist only JSON active state. Measurements include start/end ready replicas, max ready, final utilization/offered/served throughput, and bounded trace; assessment may require stable final window. On completion call existing recordVerification for matching task scenario/version, with actual time, outcome and dependency snapshot. Never trust action fields as evidence.
- [x] Tests cover scale-out/readiness, max overload, quiet stabilization, deterministic chunking/reload, min/max constraints, paused/cancelled/partial evidence, immutable fixtures, config abort/staleness, no-op/tag/source preservation, deletion/recreation and independent app state. Reuse test fixture construction with healthy published API. Run focused tests only; report RED/GREEN and interfaces in plan workspace.

## Task2: Guided content and observable CPU controls

Files: new CPU Guided Lab and minimal shared CPU content helper if needed; catalog, ExperimentPanel/new CpuExperimentPanel, ContainerAppBlade, TaskRow structured help, relevant tests and docs.

- [x] RED integration tests. Metadata: engineVersion2/contentVersion1, journey order4, mode guided, containers Skill Area. Seed healthy `api-cpu` in `rg-aca-cpu`, with private built .NET API, APP_ENV=training, external8080. Defaults CPU0.5/memory1Gi,min1,max1,no CPU rule. No pre-earned evidence or assistance.
- [x] Guided Tasks: configure0.5CPU/1Gi,min1,max5,target60; baseline demand0.1 for30s; sustained demand0.8 for90s; overload demand4.0 for90s; quiet demand0 for90s. Baseline verifies ready1 and full served demand; sustained verifies >1ready and served demand by final window; overload verifies max5 AND unserved demand; quiet verifies start>min and final min after stabilization. All measured Tasks require current intended policy and matching active healthy deployment. Current evidence dependencies include effective policy and active generation; workload transitions alone preserve earlier completed Tasks.
- [x] Explain demand units, requestedCPU denominator, target utilization, initial readiness, maximum capacity, scale-in delay and illustrative throughput. Each task has two optional hints, structured Solution and Exam Note. Experiment solution steps carry engine action objects and human instructions, rendered safely alongside existing request solutions. Do not auto execute help.
- [x] CPU Experiment Controls show named fixture/duration/demand, active progress/state, explicit Start/Advance15s/Advance remaining/Pause/Resume/Cancel, clock, ready/pending/desired counts, utilization, offered/served requests per second, latest result and bounded recent sample table. Disable actions when busy/completed/invalid; announce diagnostics; preserve selection/reload. No arbitrary graded load input.
- [x] Container App Blade reads current allocation/rule/bounds and observed runtime separately. Existing request controls remain usable; layout/keyboard work at768 and1280 widths, no chart library.
- [x] Integration tests execute worked actions, verify all Tasks and completion/result/restart persistence, reject wrong policy/partial/quiet-without-scale-out, and preserve Guided deployment behavior. Update containers count4→5 and routing deployment-independent→CPU-guided→none. Docs mark only CPU Guided delivered; remaining CPU/probes/Foundry/Bicep still planned.

## Delivery gate

- [x] Both task reviews and final broad review resolved; no unsupported assumptions remain.
- [x] Full tests/build; actual browser configure→baseline→sustained→overload→quiet, pause/reload, failure/recovery, completed Result/restart, narrow viewport, console clean. Final worktree:376/376 tests,215-module build; pending-replica display regression fixed and reviewed.
- [x] Guarded delivery check/apply lab-4, main tests/build and changed-file hashes confirmed. Mark complete before writing Lab5 plan.

Plan self-review: approved curriculum specifies these workloads and controller semantics. Replacement behavior is explicitly compatibility-gated. Scenario measurements cannot be forged by callers. No future platform work is required.


