# Probe troubleshooting implementation plan

> **For agentic workers:** REQUIRED: superpowers:subagent-driven-development. Finish this single Lab and its review/delivery gate before planning Lab 9.

**Goal:** Make a learner diagnose a real startup restart loop and a liveness probe tied to an optional downstream dependency, repair both, and prove a genuine process hang still restarts and recovers.

**Architecture:** Reuse the Guided probe manifest, captured image/deployment lifecycle, per-replica simulator and Experiment Controls. Seed one faulty but inspectable API through real Cloud Shell actions, with a partly advanced experiment as evidence. Add a Lab definition with three separately measured scenarios. Extract only the common probe evidence comparison/window logic from Guided if needed to avoid copying its full criteria block; keep each Lab's teaching predicates local.

**Tech stack:** Existing Vue3/Pinia/Vitest/Vite JavaScript and native IndexedDB. No new dependency, real Azure call, C# execution, or general YAML parser.

**Spec:** ADR-0002 and `docs/superpowers/specs/2026-09-22-containerapps-learning-journeys-{design,technical-design}.md`, especially the agreed Health probes Troubleshooting flow and technical probe semantics.

## Global constraints

- Retained worktree `.superpowers/worktrees/aca-f0`, branch `codex/aca-f0`; preserve dirty baseline. No staging, commits, git metadata mutation, file deletion, or dependency installation. Main/worktree Lab8 baseline captured after completed Lab7; never overwrite it. User authorized the three Labs sequentially without another approval gate.
- This plan adds only `aca-probes-troubleshooting`, engine2/content1, journey `containerapps-end-to-end` order8, mode troubleshooting, skill area containers. Lab7 remains unchanged in behavior, earlier13 Labs and native run/Result remain compatible. Lab9/Foundry/Bicep/capstone await this gate.
- Use `containerapps-dotnet-probes-v1`, `healthProbes:true`, the pinned Microsoft.App/containerApps@2025-07-01 explicit HTTP subset and saved JSON-form `containerapp.yaml` through `az containerapp update --yaml`. Invalid or unsupported file/source shapes fail without partial resource mutation. Source requires Save/build/deploy; probe settings require Save/deploy. Active captured artifact and probe policy drive runtime/evidence. Failed desired state blocks new proof; semantic no-ops and draft/build-only changes retain active proof. Away/back requires fresh proof.
- Deterministic one-second teaching clock: startup gates readiness/liveness, readiness controls traffic without restart, startup/liveness thresholds restart immediately, process hang clears only on restart, dependency fault persists until fixture clear. Absent Readiness permits traffic after Startup but cannot earn this Lab's all-three-probe proof. Two replicas, two scheduled requests per second. No default probe injection or production timing claims.
- Work rhythm: Sol medium implements the single scoped task, Terra medium reviews its spec/code quality, Terra medium independently reviews the whole Lab; root plans, verifies browser/native lifecycle, resolves findings with the original worker, and guarded-copies to main. No parallel writers. Snapshot reviews are authoritative while HEAD stays unchanged. Retain artifacts.

## Review focus

1. A restart loop must exist in the supplied active experiment, while learner history/evidence/help remain empty; inspect its events, logs, probe policy and actual requests rather than synthetic transcript or hidden completion flags.
2. Raising Startup allowance must stop early restarts, yet a still-coupled liveness endpoint must fail the downstream outage. Startup may earn provisional proof after the policy repair; redeploying corrected source must make that older proof stale.
3. A dependency outage must persist across a wrong liveness restart, but the primary `/api/info` route is self-contained and should stay ready/serve HTTP200 after a correct fix. Do not present dependency failure as a universal ACA readiness rule.
4. Disabled/always-successful/misrouted/slow probes, bad source, or a partial/cancelled scenario must never produce passing three-scenario evidence; a real hang must still restart promptly and rejoin traffic.
5. No-op probe order/image-case changes, unrelated tags, draft/source build-only publication, failed desired deployment, and policy/source away-back must preserve or invalidate proof according to the active capture and generation. Native reload and completed Result must remain stable.

## Task 1: Faulty incident Lab, measured repair and learner evidence

**Files:** create `src/data/labs/containerapps-journey/probes-troubleshooting.lab.js` and `tests/aca-probes-troubleshooting.test.js`; optionally create `src/data/labs/containerapps-journey/probe-evidence.js` for common normalized dependency selectors and complete measurement-window checks, then update Guided to consume it with identical behavior. Modify the probe panel only for a concise simulated application startup log from actual `startup-begin`/`startup-complete`/`restart` events if its existing full transition table does not clearly meet this requirement. Modify `src/data/labs/index.js`, named count/routing tests, README/SPEC/CONTEXT/ADR/both approved specs' delivery status. No new parser, generic scenario configurator or content for Lab9.

**Interfaces consumed:** `PROBE_MANIFEST`, `PROBE_SOLUTION_FILES`, `probeConfiguration({appName:'api',image,probes})`, `createDeploymentCriteria({... capturedArtifact:true})`, `applyRunAction`, `parseProject`, `normalizeImageReference`, `evaluateLab`, `runtime.probesByApp[appId]`, `measurements.{samples,requests,events,replicas,restarts,readyReplicas,probes}`. Event/request/sample seconds are scenario-relative; `simTimeMs` and evidence timestamps are global. Keep the historical event/path view based on captured measurement probes.

**Seed:** group `rg-aca-probes-incident`, registry `acrprobesincident`, environment `env-probes-incident`, identity `id-probes-incident`, app `api-probes-incident`, image `acrprobesincident.azurecr.io/api:v1`, container name `api`, `APP_ENV=training`, external port8080, resources0.5CPU/1Gi, fixed2/2 replicas. Use the existing working private API/Docker scaffold. Saved Program.cs differs from the proper solution only at `/health/live`: it returns `HealthState.DependencyAvailable ? Results.Ok() : Results.StatusCode(503)`; Startup uses `StartupComplete`, Readiness uses `Ready`. Fixed helper remains readonly. Saved and deployed probe YAML has Startup/Readiness/Liveness HTTP paths `/health/startup`, `/health/ready`, `/health/live`, port8080, initial delay5, period5, timeout1, success threshold1; Startup failure threshold **2** (too short for 20s startup), Readiness/Liveness failure threshold2. Seed through real group/ACR build/identity/AcrPull/environment/create/`--yaml` actions, then start the named Startup incident and advance exactly30 seconds. Return only `sandbox,artifacts,runtime,nextSequence` with fixed seed resource timestamps, no learner history, scrollback, hints, solutions or evidence. The running scenario shows Startup-caused restarts at10/20/30; its timeline and request targets are observable. The brief names symptoms and desired service behavior without stating the two causes. Inspection of Program.cs/YAML and optional Hints/Solution reveal them.

Use the existing manifest's compilable solution as the seed base; the source fault is one recognized expression:

```js
const incidentFiles = {
  ...PROBE_SOLUTION_FILES,
  'src/Trainer.Api/Program.cs': PROBE_SOLUTION_FILES['src/Trainer.Api/Program.cs']
    .replace('HealthState.Responsive ? Results.Ok()', 'HealthState.DependencyAvailable ? Results.Ok()'),
  'containerapp.yaml': probeConfiguration({ appName: 'api', image, probes: initialProbes }),
}
```

The seed should assert that the replacement matched exactly once before use; a silent unchanged seed is an invalid exercise.

**Scenarios (fixed, version1, appId from this Lab, requestsPerSecond2):**

| ID | Duration | Startup | Faults | Required observation |
| --- | ---: | ---: | --- | --- |
| `startup` | 60s | 20s | none | First Startup success20Ã¢â‚¬â€œ30s, no restart, no traffic before a replica starts/ready, two ready and successful requests through final window. |
| `dependency` | 100s | 20s | replica0 dependency=true at35s, false at70s | Outage persists until clear, no restart or traffic loss with correct process liveness, both replicas remain ready and primary API serves throughout 35Ã¢â‚¬â€œ70s. |
| `hang` | 90s | 20s | replica0 hang=true at35s | Liveness timeout/restart by50s, fresh Startup completion and two ready by80s; replica1 carries traffic while replica0 is excluded/restarting. |

The fixed `/api/info` response uses only local `service` and `APP_ENV`; the simulated downstream dependency is optional to this route. `HealthState.DependencyAvailable` is deliberately wrong for liveness, `HealthState.Responsive` is correct. A faulty dependency-liveness deployment should show at least one Liveness-caused restart before fault clear and dependency remains set after restart. Changing the source to `Results.Ok()` or `true` must fail even if a hung HTTP endpoint times out in this bounded runtime.

**Stages/Tasks:** One stage `Diagnose and verify`, three Tasks `startup`, `dependency`, `hang`, with two Hints, structured solution steps using `content` for files, and Exam Note each. Startup Task allows either DependencyAvailable or Responsive liveness source while requiring correct Startup/Readiness source and all three real probes, bounded successful Startup behavior, healthy captured desired/active deployment. This lets the first repair earn provisional credit. Dependency Task requires a newly published/deployed `Responsive` liveness endpoint and the 100s fault evidence: no restart, both ready, valid 2req/s trace, no failed primary API requests in outage/final windows. Hang Task requires current successful Startup and Dependency evidence under the same captured deployment (including generations), followed by its own fresh 90s evidence with a Liveness-caused restart and recovery; a later rerun of either prerequisite makes Hang need verification again. All proofs require complete contiguous samples/requests, expected fixed fault events, captured source/probes/current successful desired status, and actual transitions. Task predicates are local to this Lab; do not copy a broad infrastructure predicate already in `createDeploymentCriteria`.

- [x] Write RED tests for seed real actions and 30s incident, resource names, no learner transcript/help/evidence, fixed timestamp, catalog order8 and distinct prerequisite Lab. Confirm failed Startup proof in unrepaired seed using actual events; prove source and YAML are inspectable.
- [x] Assert concrete measured windows through the real action path. For example:

```js
expect(fresh().runtime.activeScenario).toMatchObject({ kind: 'probes', scenarioId: 'startup', elapsedSeconds: 30 })
expect(run.evidence.experimentsById).toEqual({})
expect(measurements.requests.filter((r) => r.second >= 45 && r.second <= 69)
  .every((r) => r.status === 200)).toBe(true) // corrected dependency fixture
expect(measurements.events.some((e) => e.type === 'restart' && e.probeType === 'Liveness'
  && e.second >= 35 && e.second <= 50)).toBe(true) // genuine hang fixture
```
- [x] Write RED tests for a saved YAML Startup threshold6 repair and a **fresh** 60s Startup run; expect first success20s, no restart, correct requests, Task1 done. A save-only YAML edit leaves old active/proof unchanged; old active scenario aborts only on deployed semantic change. Test the supplied bad `DependencyAvailable` source then run dependency to observe wrong Liveness restarts and persistent fault.
- [x] Write RED tests for saving correct Program.cs, building the immutable image and deploying YAML. Save/build-only retains old active/source proof; deployment changes generation and invalidates old Startup proof. Rerun Startup and Dependency successfully, then Hang and prove genuine restart/new Startup/final service. Verify full measurement windows and proof ordering. Compare event/request times to relative seconds, not global clock after seed30.
- [x] Test negative cases: missing Startup/Readiness/Liveness, unconditional Startup/Liveness, wrong path/port, excessive Startup/Liveness timing, wrong readiness logic, skipped rebuild/deploy, cancelled/paused/partial scenario, failed desired update, semantic policy/source round trip. Tag, image-casing/probe-order no-op and build-only publication preserve proof. Test real `/api/info` requests during correct outage and no forced readiness loss. Reject caller-supplied fault/outcome injection through common action validator.
- [x] Test assistance counts, one native Result, readonly completed attempt and fresh Restart; pause/reload preserves seeded/new scenario state. Run worked Solution steps through real `save-file`/command/scenario actions and show all three Tasks complete.
- [x] Register only Lab8: total13Ã¢â€ â€™14, containers8Ã¢â€ â€™9, Guided probesÃ¢â€ â€™TroubleshootingÃ¢â€ â€™none; preserve six legacy Labs. Update named catalog/routing/count tests: `tests/{containerapps-lab,progress-store,next-lab,aca-cpu-guided,aca-cpu-troubleshooting,aca-cpu-independent,aca-probes-guided}.test.js`. Update docs status to Guided and Troubleshooting implemented, Independent planned, retaining scope/ACA ambiguity disclosures.
- [x] Run focused Lab8, probe engine/Guided, parser/CLI, panel, catalog and native store tests. Write `task1-report.md` with RED/GREEN command output, exact files, interface changes, self-review and limitations. Root owns the complete suite/build/browser gate.

## Delivery gate

- [x] Task review and independent final Terra review resolve all material findings; scoped corrections are reviewed. Root checks actual source/criteria/runtime against the plan.
- [x] `npm.cmd test` and `npm.cmd run build`; actual browser seed incident, source/config save/build/deploy boundary, startup repair, dependency failure/repair, genuine hang, stale/no-op proof, pause/reload, assistance/Result/restart, narrow view and console. Production preview if build assets or shared UI change.
- [x] Guarded `lab-8` check/apply (baseline already captured), main tests/build, matching hashes and closed plan. Only then write Lab9 plan. Keep artifacts and worktree uncommitted.

Self-review: the approved incident requires two distinct repairs and three measured outcomes. Startup can be fixed separately, while final proof must share one current corrected deployment. The optional dependency outage does not change the primary API's serving contract. No Lab9 code, Foundry provisioning or invented Azure defaults are needed.
