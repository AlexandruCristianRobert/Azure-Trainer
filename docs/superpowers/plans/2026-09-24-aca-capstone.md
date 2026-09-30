## Delivery gate Container Apps Capstone implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by task. Sol medium implements; Terra medium reviews each task and the complete Lab. Root owns integration, rulings and guarded delivery.

**Goal:** Deliver journey Lab 16, `aca-capstone`, with a complete simulated image/bootstrap/application lifecycle, healthy CPU/probe/Foundry proof, deterministic incident, source-based recovery, sealed operational checkpoint and final cleanup. Then investigate and fix the Cloud Shell focus loss reported by the user.

**Authority:** [Capstone implementation design](../specs/2026-09-24-aca-capstone-implementation-design.md), [agreed journey](../specs/2026-09-22-containerapps-learning-journeys-design.md), [technical design](../specs/2026-09-22-containerapps-learning-journeys-technical-design.md), ADR-0002 and delivered Labs 1–15.

## Working rules

- Work only in `.superpowers/worktrees/aca-f0`, branch `codex/aca-f0`. `.superpowers/sdd/lab-16-delivery-baseline.json` was captured after Lab15 delivery and must never be overwritten. Preserve the dirty baseline; no staging, commits, file deletion, package installation, real Azure calls or arbitrary C#/Bicep execution.
- Snapshot each Task before implementation and generate a scoped diff afterward. RED tests first. Sol stops writing for Terra review, fixes findings, and obtains re-review before the next Task. Root records rulings and delivers guarded files only after a separate whole-Lab review. Run focused regressions after each Task and full tests/build before delivery.
- Keep Capstone-only syntax/providers/actions behind explicit Lab capability and trusted target map; Labs 1–15 retain their behavior and persisted-run compatibility. Inputs and command effects cannot inject graphs, evidence, stages, incidents or results. Failed/partial operations remain inspectable without earning proof.

## Task 1: Combined application source and image snapshot

Files: new Capstone template/manifest and bounded parser in `src/lib/project`, narrow `parseProject`/build integration, focused project/image tests.

- [ ] RED tests for one saved .NET project whose bounded executable source yields `GET /api/info`, local CPU work, `POST /api/summarize` through managed identity, and startup/readiness/liveness expressions in a single `appSpec`. Comments, string markers, unsupported executable statements and malformed settings cannot spoof the routes. Enforce file/token/numeric limits and located diagnostics. Keep Foundry retry ownership/budgets and no real execution.
- [ ] Add editable starter and full Solution files with Dockerfile and appsettings; `parseProject` and published artifact capture Foundry config **and** health endpoints. Saved edits do not change an existing artifact; a new build does. Test image source hash/digest and old Foundry/probe/CPU parser regressions. Terra reviews source grammar and behavioral capture.

## Task 2: Bootstrap/main Bicep roots and trusted CLI provenance

Add a four-path regression for root-specific closure in CLI preparation, preview effect replay, deployment effect replay and validation/observation. Both literal parameter contracts share the manifest-approved group/registry/identity names. Task 2 establishes the trusted root map and bootstrap provenance dependency tuple; Task 3 enforces that main's `existing` declarations bind the successful bootstrap resource IDs and output/source hashes when providers can resolve them. Test pre-Capstone Labs 1–15 persisted runs, malformed optional Capstone fields and a valid partially completed Capstone reload; reject bad fields before Task evaluation.

Files: `src/lib/bicep/{parser,compile,provenance}.js`, `src/lib/az/commands/deployment.js`, `src/lib/labEngine/{actions,run,migrations}.js`, Capstone manifest roots/params, focused tests.

- [ ] RED tests for `infra/bootstrap.bicep` + literal `bootstrap.bicepparam` using bootstrap, and `infra/main.bicep` + literal `main.bicepparam` using main. Resolve only manifest-listed local modules reachable from the selected root. Root-specific source hash/versions exclude the unrelated root/params; wrong using/root, traversal, remote source, unlisted path, cross-group target and unsupported syntax fail with location. Preserve Labs13–15 main-root behavior and bounds.
- [ ] Trusted Capstone target map binds template path, parameter path, resource group and deployment name. CLI validate/what-if/create/show and action-effect replay use the exact saved root; no caller-supplied graph/preview. Preview stays read-only; every attempt/preview retains root/path/source tuple, bounded provenance and causal sequence. App-show observations map to main only. Validate hydration and malformed/forged effects; no bootstrap attempt can satisfy app deployment proof. Terra reviews path/target trust closure.

## Task 3: Capstone providers, staged apply and probes

Files: `src/lib/bicep/{providers,projection,preview,deploy}.js`, narrow Sandbox ACA/registry/identity/probe adapters, tests.

- [ ] RED bootstrap provider tests: Capstone-only new Basic ACR and UAMI, exact local group/outputs, canonical create/no-change preview and incremental apply. Main resolves those resources as exact local `existing` declarations, with project/deployment children and exact-scope separate AcrPull/Cognitive Services User grants. Reject missing registry/image/grants, wrong principal/scope, extra containers, foreign target or unsupported fields; old Lab13–15 provider contracts remain strict.
- [ ] Permit exactly three pinned HTTP startup/readiness/liveness probes in Capstone app Bicep container, with documented bounded timing/threshold fields. Projection and apply include probes and CPU policy, use published artifact with combined health+Foundry appSpec, activate app last, preserve prior active state on failure, and make no-op redeploy preserve evidence. Test bootstrap→build→main, absent image rejection, probe behavior, partial failure and older regressions. Terra reviews preview/apply parity and activation.

## Task 4: Mixed experiments and deterministic incident

**Sequence correction:** Task 4 implements and reviews only the first mixed-routing checkbox. Defer the incident checkbox below until Task 5's seal validator is implemented and reviewed; implement it as the second Task 5 increment. No early-injection test can be meaningful before that boundary exists.

For dual-capability runs, `scenario-start` selects the declared fixture kind; advance/pause/resume/cancel select the active scenario kind. Add `kind: 'cpu'` to new CPU scenarios, with a narrow fallback for old persisted CPU scenarios lacking kind. The CPU and probe UI panels must show/control only their own active kind; verify this in Task 7.

Files: `src/lib/labEngine/actions.js`, `src/lib/simulation/{inference,probes,cpu,runtime}.js` as needed, focused tests.

- [ ] RED tests that a Lab with both `cpuScaling` and `healthProbes` routes named scenario-start/advance/pause/resume/cancel by fixture/active kind; no CPU action lands in the probe engine or caller-supplied outcomes. Sequential CPU and probe experiments retain separate measured projections and active source/config fingerprints. Old CPU/probe/Foundry Labs pass.
- [ ] Add Capstone-only one-shot `inject-incident` reducer action gated on a sealed healthy baseline. It records incident ID/sequence, changes only the Lab-owned app's effective Foundry deployment to `missing-deployment`, advances active generation, emits a diagnostic log and keeps saved Bicep correct. A named request reports HTTP 502 `FOUNDRY_DEPLOYMENT_NOT_FOUND` with zero upstream attempts; Bicep what-if reports app modify. Current saved main reapply repairs live config. A distinct bounded 429/Retry-After→200 fixture proves downstream recovery. Test repeated/early injection rejection, partial repair, CLI-only bypass and spoofed incident/evidence. Terra reviews fault isolation.

## Task 5: Stage seals, live checkpoint and cleanup integrity

After the first seal checkbox, execute Task 4's deferred incident checkbox. Its persisted drift must be preview-visible in the live Sandbox app projection; main what-if returns `modify`, and successful main reapply atomically restores the saved desired value. Test failed repair preserving the previous active deployment, early/repeated injection, forged evidence, and bounded transient 429 and persistent 429 traces. The cleanup implementation must remove deleted registry tags and deleted-app runtime projections, while retaining compact build artifacts. Check immutable group ownership captured at creation, including partial/extra groups and reload after deletion. Invalidate a checkpoint on changed dependency generation, not an identical read-only rerun.

The cleanup checkpoint also binds the successful main attempt ID. A post-checkpoint Bicep `create`, including no-change, adds a new attempt and reopens Recovery while preserving unaffected experiment evidence; a read-only `what-if`/`show` preserves it. Operational proof must bind saved non-infrastructure build inputs to the published artifact snapshot; valid app-source edits after publication cannot be verified against the old image.

Implement Task 5 as three separately snapshotted and reviewed increments: **5a** ordered stage state/seal/hydration (without incident), **5b** incident overlay and source-driven repair (only after 5a is valid), and **5c** checkpoint/ownership/cleanup. Each increment has its own focused tests and Terra review before the next begins. The final Lab fixture may add stage-specific Task predicates in Task 6, but these reducer boundaries must be tested with a minimal Capstone-shaped fixture first.

Files: `src/lib/labEngine/{run,actions,evaluate,evidence,session,migrations}.js`, narrow Sandbox group cleanup integration as needed, focused tests.

- [ ] RED tests for ordered `advance-stage`: only the active stage with all Tasks current can seal; stored stage summaries bind task/evidence IDs, source/deployment tuple, sequence and incident ID. Historical stage 2 image and stage 4 healthy proofs survive subsequent drift, but stage 6 requires fresh post-incident live proof. No forged/reordered/oversized seal survives validation/reload.
- [ ] Stage 6 advance writes bounded `cleanupCheckpoint` with operational evidence IDs/fingerprints, current graph/image/incident and owned resource group IDs. Only deletion/read-only inspection/help/timer preserve it; saved edits, builds, deploys, configuration mutations or new experiments invalidate it and reopen stage 6. Premature deletion cannot earn a checkpoint. Cleanup requires all run-owned groups/resources/roles/publications/active runtime gone, including extra/partial groups, while preserving compact artifacts/evidence/Result. Test mixed action ordering, group dependency guards, reload/export/Result/Restart and old Lab completion. Terra reviews irreversible gate and persistence.

## Task 6: Capstone Lab, seven stages and full walkthrough

The empty-Sandbox walkthrough explicitly runs `az group create`, inspects the result, and verifies it is the single immutable run-owned group before bootstrap. Test extra/partial owned groups separately during cleanup.

Files: new `src/data/labs/containerapps-journey/capstone.lab.js`, final project/Bicep fixture, catalog, focused integration tests.

- [ ] RED full reducer walkthrough from empty Sandbox and incomplete saved project through preparation, bootstrap preview/create, image build/source inspection, main preview/create, healthy named Foundry/probe/CPU proof, stage seals, incident 502 diagnosis, source-driven reapply, bounded 429 recovery, fresh recovery scenarios, no-op reproducibility, checkpoint, group deletion, read-only Result. Hints/Solutions show one supported route but revealing them does not execute or award completion.
- [ ] Define exact scenario versions, workloads, statuses and dependency selectors; reject missing artifact/role/probe, syntax-only pass, stale/away-back source, old baseline evidence used for recovery, premature or partial cleanup, wrong group, manual CLI-only repair, forged outcome and reordered stage actions. Pause/reload/resume, assistance accounting, elapsed time, export, Result/Restart and catalog Lab15→16→none. Terra reviews curriculum and final gate.

## Task 7: Capstone UI, docs and acceptance

Files: focused stage/checkpoint/incident controls in Lab Panel/Experiment Controls, Bicep review panel for bootstrap/main, rendered tests, README/SPEC/CONTEXT/design/ADR status.

- [ ] Show active and sealed stages, checkpoint state, source/artifact/active distinctions, both Bicep roots/outputs, incident symptoms/logs, experiment traces and cleanup ownership. Accessible stage-advance and incident controls call trusted reducer actions; learner uses Cloud Shell for resource operations. Read-only Result remains inspectable. Responsive 768/1280, keyboard/focus, long IDs and errors; do not claim live Azure behavior.
- [ ] Full worktree tests/build, route HTTP smoke, attached-browser happy/error/incident/recovery/cleanup/reload/Result/Restart/console/narrow QA if available. If no browser attached, record limitation without claiming visual verification. Terra scoped UI review and independent whole-Lab review.

## Delivery gate

- [x] All scoped and independent whole-Lab Terra reviews resolved.
- [x] Full worktree/main tests and builds, guarded `delivery.py check lab-16`/`apply lab-16`, matching manifest hashes and browser availability recorded.
- [x] Close Lab16 delivery with `close_delivery.py`.

Plan self-review: the Capstone is one Lab with saved ordered checkpoints, not seven separate Labs. Bootstrap creates only foundations; main cannot activate before a published image. Exact-scope pull and inference grants remain distinct under the single attached UAMI, while Lab12 already covers separate-principal operation. The incident is deterministic live configuration drift repaired by reapplying correct saved infrastructure; it is visibly labeled simulated. Cleanup is the only required deletion in the journey.

## Separate post-Lab task: Cloud Shell focus loss

- [x] After guarded Lab16 closure, reproduce the user's one-second focus loss on a stable build. The Lab page's one-second `tick` dispatched an elapsed action that set `run.running`, briefly removing the terminal's `v-if` input. Separate foreground command activity from elapsed persistence in the store. A RED store regression captured the running-state transition; `tests/browser/cloud-shell-focus.mjs` confirmed the same focused DOM input and draft across multiple ticks with typed and pasted text in local Chrome. Full tests/build and independent Terra review passed; deliver separately with guarded hashes.
