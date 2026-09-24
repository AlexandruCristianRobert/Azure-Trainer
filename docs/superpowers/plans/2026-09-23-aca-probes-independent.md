# Independent health probes implementation plan

> **For agentic workers:** REQUIRED: superpowers:subagent-driven-development. Complete this Lab, its scoped reviews and final delivery before other curriculum content.

**Goal:** Give learners a reliability brief for a different slow-starting API and let them choose supported health endpoint logic and probe policy. Three measured experiments must prove safe startup, traffic exclusion/recovery, and bounded detection/recovery of a real process hang, in any order.

**Architecture:** Reuse the existing probe simulator, captured image/deployment lifecycle, `ProbeExperimentPanel`, and shared evidence helpers. Add a narrowly scoped project-manifest variant whose fixed `HealthState.StartupComplete` helper matches this Lab's **30-second** startup fixture; preserve Guided/Troubleshooting's 20-second helper. Seed a real deployed app with failing health routes and no explicit probes. Grade supported alternative policies by complete measured traces and stated time bounds, not equality to a worked YAML file. No new parser, generic scenario engine, Azure calls, or Foundry fixture.

**Tech stack:** Existing Vue 3, Pinia, Vitest, Vite, JavaScript/C# teaching files and native IndexedDB.

**Spec:** ADR-0002 and `docs/superpowers/specs/2026-09-22-containerapps-learning-journeys-{design,technical-design}.md`, especially Independent health probes and the bounded probe semantics.

## Global constraints

- Retained worktree `.superpowers/worktrees/aca-f0`, branch `codex/aca-f0`; preserve dirty baseline. No staging, commits, git metadata mutation, deletion or dependency installation. The guarded `lab-9` baseline was captured after closed Lab8 delivery; never overwrite it. User authorized sequential implementation and delivery without renewed approval.
- Add only `aca-probes-independent`, engine2/content1, journey order9, mode independent, skill area containers. Earlier14 Labs, Guided/Troubleshooting behavior and native run/Result remain compatible. No Foundry/Bicep/capstone work.
- Root plans, verifies browser/native lifecycle and guarded-copies. Sol medium implements one task at a time; Terra medium reviews each task and independently reviews the whole Lab. Fixes return to original implementer. Snapshot diffs are authoritative while HEAD is unchanged; no parallel writers.
- The teaching clock advances only on learner action, in whole seconds. Startup gates other probes; readiness excludes an unready replica without restart; sustained Startup/Liveness failure restarts immediately; a real hang clears only on restart. Two replicas and two scheduled `/api/info` requests per second. These bounds are exercise requirements, not production timing claims. No omitted ACA default probes are inferred.
- `containerapps-dotnet-probes-independent-v1` uses the existing supported JSON-form `containerapp.yaml` and pinned explicit HTTP subset. Source edit requires Save/build/deploy; YAML edit requires Save/deploy. Active captured artifact, probe policy and successful desired state drive evidence. Failed desired state or semantic active change invalidates current proof; no-op tags/reordering/image-case and draft/build-only edits retain it. Each Task can be proved in any order, but all three proofs must be current under one deployed capture to finish.

## Reliability brief and fixed scenarios

The supplied private API has a **30-second** cold startup and two replicas. Its `/api/info` route is self-contained. The learner must choose Startup, Readiness and Liveness endpoint conditions (`StartupComplete`, `Ready`, `Responsive`) and three explicit HTTP probes on port8080. An alternative supported timing policy passes if it meets all measured bounds. Paths `/health/startup`, `/health/ready`, `/health/live` are the teaching interface; probe order may vary. Keep 2/2 replicas. The supported file format and simplified restart behavior are stated in the learner brief.

| Scenario/Task | Fixture | Required measured outcome |
| --- | --- | --- |
| `startup`, 80s | Cold startup30s, no injected fault | No Startup/Liveness restart; no routed traffic before Startup and Readiness; both replicas ready and HTTP200 in final 40s. First Startup success must follow the 30s cold start, with no unconditional endpoint shortcut. |
| `readiness`, 100s | Replica0 readiness fault45..65s | Replica0 excluded from traffic by **second55** (at most 10s detection) while replica1 serves HTTP200; no restart; replica0 ready and back in routed traffic by **second75** (at most 10s recovery). Both ready and healthy final window. |
| `liveness`, 110s | Replica0 process hang45s, persists until restart | A Liveness timeout causes restart by **second60** (at most 15s detection); replica1 carries traffic while replica0 restarts; a fresh 30s Startup completes and both are ready by **second95** (at most 50s from fault), with healthy final requests. |

The worked example uses Startup initial delay5/period5/failure threshold8; Readiness and Liveness initial delay5/period5/timeout1/failure threshold2/success threshold1. This is an example, **not** an exact-match grading condition. A second valid schedule (e.g. period4 with sufficient startup allowance) should pass after measured validation. A slow Startup threshold/period that restarts before30s, slow Readiness removal/re-entry, or slow/no Liveness restart must fail. Startup and Liveness success threshold1 follows the supported parser. The assessment must reject missing/misrouted/disabled probes and always-successful endpoints even if a narrow healthy trace happens to look green.

## Task 1: A distinct 30-second project fixture

**Files:** create a small Independent probe template module under `src/data/templates/containerapps-dotnet/` and update `src/lib/project/manifests.js`; add focused tests in `tests/project-probes.test.js` or a new focused template test. Do not modify the existing 20-second `PROBE_MANIFEST`, `PROBE_STARTER_FILES`, `PROBE_SOLUTION_FILES` behavior.

- [x] RED: the Independent manifest is resolvable by ID, contains the same supported file paths and 30-second fixed helper, while the original manifest/helper remains20s. Starter has failing route expressions, a lab-specific image and no probes; solution has three distinct correct expressions. The source is parseable and buildable through normal project APIs.
- [x] GREEN: create the variant by deriving the existing probe manifest/files with an exact asserted replacement of the readonly helper's `TimeSpan.FromSeconds(20)` to30 and a lab-specific JSON-form YAML image. Register its ID without changing parser/runtime interfaces. Keep seed and solution source in one module; avoid duplicating the full project template.
- [x] Focused template/parser/build tests, self-review and `task1-report.md`. Root snapshots the task diff and requests Terra medium spec/quality review before Task2.

## Task 2: Requirement-based Lab and measured proof

**Files:** create `src/data/labs/containerapps-journey/probes-independent.lab.js` and `tests/aca-probes-independent.test.js`; update `src/data/labs/index.js`, named catalog/count/next-lab tests, README/SPEC/CONTEXT/ADR/both approved specs' delivery status. Use existing `probe-evidence.js`; do not change broad runtime, parser, store or probe UI unless Task tests establish a specific missing capability.

- [x] RED seed tests: named resources `rg-aca-probes-independent`, `acrprobesindependent`, `env-probes-independent`, `id-probes-independent`, `api-probes-independent` and image `acrprobesindependent.azurecr.io/api:v1`; real group/ACR build/identity/AcrPull/environment/create/YAML actions; saved starter C# and zero probes; fixed createdAt timestamp; return only `sandbox,artifacts,runtime,nextSequence`. No learner commands, hints, solutions, evidence or active experiment. Initial proof0/3. Inspectable source and YAML. Catalog total14ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢15, containers9ÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢10, next after TroubleshootingÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢IndependentÃƒÂ¢Ã¢â‚¬Â Ã¢â‚¬â„¢none; legacy6 preserved.
- [x] RED measurement tests through real `save-file`, ACR build, YAML deployment and scenario actions. Show source/YAML Save alone, image build alone and failed desired update do not silently change active capture. Run the worked policy in **each scenario order** and prove all3 Task outcomes; final evidence IDs/generations current. Verify complete 80/100/110s contiguous samples, exactly2 requests/sec, expected per-replica events, requests and status. Do not grade only config display or task completion markers.
- [x] GREEN policy criterion: require healthy successful deployment and captured build artifact; all three distinct supported HTTP probe types bound to correct path/port, two replicas, and active built endpoints `startup`/`ready`/`responsive`. Parse selected timing structurally, but let measured bounds decide validity. Startup and Readiness logic must remain distinct; disabled/always-success endpoints fail. Use `probeDependencies` and complete-window helper; no ordering dependency between Tasks.
- [x] Negative and alternate-policy tests: second valid timing schedule; too-small Startup allowance, wrong path/port, missing/slow Startup; Readiness that returns unconditional success or misses 55/75 bounds; Liveness disabled/always success/slow threshold, excessive timeout; incomplete/cancelled/paused runs; unsupported transport/invalid YAML, failed desired update, source edit without rebuild/redeploy, source/policy away-back, stale completed proof. Tag, probe order/image casing and build-only publication preserve proof. Reject supplied fault/outcome injection. Existing Guide/Troubleshooting tests remain green.
- [x] Hints, structured Solution and Exam Notes provide a worked path but no compulsory task order. Run Solution steps through real actions. One native completed Result, correct assistance counts, readonly completion, reload and fresh Restart. Update docs status to all three probe Labs implemented, Foundry onward planned, retaining limited simulator/ACA disclosures. Run focused tests and write `task2-report.md` with RED/GREEN output and self-review; root snapshots the diff and requests scoped Terra review.

## Delivery gate

- [x] Both task reviews and independent whole-Lab Terra review resolve all material findings; root checks source/policy/trace semantics and compatibility.
- [x] Worktree `npm.cmd test` and `npm.cmd run build`. Actual browser: seeded incomplete brief, source/config Save/build/deploy boundary, one failing policy, each repaired scenario in nonprescribed order, another valid policy if practical, stale/no-op proof, pause/reload, assistance/Result/Restart, narrow viewport/keyboard and console. Production preview checks chunk/assets and initial controls.
- [x] Guarded `lab-9` check/apply, main suite/build, matching hashes and closed plan. Keep worktree/artifacts uncommitted. Send user completion notice in this ChatGPT conversation and email if the requested Gmail connector is connected.

Self-review: the distinct 30-second helper keeps the C# teaching surface consistent with the simulator. Assessment uses observable bounds, so a feasible alternative timing policy can pass. Tasks have no prescribed order, while final completion still requires current evidence for all three under one active deployment.
