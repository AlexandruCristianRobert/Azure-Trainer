# Independent Bicep implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by task. Sol medium implements, Terra medium reviews scoped tasks and the whole Lab. Root owns integration and guarded delivery.

**Goal:** Deliver journey Lab 15, `aca-bicep-independent`: adapt one modular Bicep project to a second environment, prove its request and CPU behavior, then show the first environment remains reproducible and healthy from the current shared source. Lab 16 Capstone follows a separate plan.

**Authority:** [Lab 15 implementation design](../specs/2026-09-24-aca-bicep-independent-implementation-design.md), [agreed journey](../specs/2026-09-22-containerapps-learning-journeys-design.md), [technical design](../specs/2026-09-22-containerapps-learning-journeys-technical-design.md), and delivered Labs 13â€“14.

## Working rules

- Work only in `.superpowers/worktrees/aca-f0`, branch `codex/aca-f0`. `.superpowers/sdd/lab-15-delivery-baseline.json` was captured after Lab14 delivery; never overwrite it. Preserve the dirty baseline. No staging, commits, file deletion, package installation, or live Azure calls.
- Snapshot each task before implementation and produce a task diff afterward. RED tests first for behavior changes. Sol stops writing for scoped Terra review; fix findings with the same implementer, re-review, then proceed. Root records rulings. Full tests/build and independent whole-Lab review precede guarded delivery.
- Preserve Lab13/14 default `infra/first.bicepparam` behavior and old run compatibility. The Lab15 target map is trusted Lab metadata, not command input. Unselected invalid params must not poison the selected target. No unbounded parser/execution, cross-group existing ACR, caller-supplied graph/outcomes, or omission deletes.

## Task 1: Explicit selected parameter and target provenance

Files: `src/lib/bicep/{parser,compile,provenance,deploy}.js`, `src/lib/az/commands/deployment.js`, `src/lib/labEngine/{actions,run,migrations}.js`, narrow manifest support and focused parser/compiler/CLI/provenance tests.

- [x] RED tests for manifest-listed second parameter file and explicit `parameterPath` selection. Parse shared `.bicep` files plus only the selected `.bicepparam`; reject unlisted/traversal/remote/inline parameter values, wrong `using`, missing path and wrong target/file pairing. Existing Lab13/14 calls and persisted records without path keep their first-file meaning.
- [ ] `bicepCommandSource` hashes shared `.bicep` only, selected saved parameter content separately, and records versions for source plus selected parameter. A second-parameter edit does not stale first preview/attempt/evidence; any shared-source edit stales both, including away/back saves. Add bounded `parameterPath` to preview/attempt/observation/current summaries; Lab15 run validation requires it and checks trusted target pairing on hydration, while old Lab13/14 records without it retain first-file meaning. Update migration/load validation deliberately (raw validation precedes migration). Preserve old bounded provenance and preview-chain witness.
- [x] CLI validate/what-if/create and trusted effect recomputation use the same selected path and target map; show/app-show inherit the attempt's path/source tuple, including app-show mapping to each Lab target by group/app name. Trusted Lab15 preview/create effects atomically reserve and increment `nextSequence` once per recorded preview/attempt, including failed and no-change creates; validate/show do not reserve. Validate unique increasing preview/attempt/evidence sequences below `nextSequence` across reload. Reject mismatched or forged effect paths/graphs and unsupported flags; what-if remains read-only. Generic command help names both supported paths only in Lab15. Run Lab13/14 and older regression suites. Terra reviews path, target and trust closure.

## Task 2: Two-target seed and reusable source

Files: new Lab15 template/manifest and seed fixture, narrow project or image-seed helpers only if needed, focused fixture/provider/deploy tests.

- [x] RED tests for two explicit supplied groups and Basic registries, two immutable published healthy images with each target's captured Foundry endpoint/deployment, and first Bicep stack active/deployed from complete shared source and `first.bicepparam`. Seed with separate temporary first/second appsettings source snapshots, copying only sandbox/artifacts/active runtime while restoring learner initial project. After first create, scrub `runtime.bicep` to empty and clear seed scrollback/history/evidence/observations/previews; keep `nextSequence` controlled above retained artifact IDs. No second app stack or earned verification. Seed-only ACR builds; learner builds disabled.
- [x] Parameterize shared modules for `APP_ENV`, min/max replicas and names/deployment output; keep pinned model profile and local scope. Freeze first baseline image/artifact, identity/registry, endpoint/deployment, settings and scale policy in trusted Lab metadata. Second `second.bicepparam` starts incomplete and must configure different names, registry/image tag, `APP_ENV=staging`, replica bounds, and supported deployment **name**. Ensure parser/project bounds, supported variants and exact target-specific artifact linkage. Test both compiled graphs, first seed active request/CPU readiness, second deploy without changing first resources, and same-target ACR/UAMI/environment/account/child project/deployment/app/role ownership; reject cross-target aliases and the other target's artifact.
- [x] Terra reviews seed artifact provenance, target isolation and explicit prerequisites. Run focused and full tests/build before Task3.

## Task 3: Independent Lab and two-environment evidence

Files: new `src/data/labs/containerapps-journey/bicep-independent.lab.js`, catalog registration, focused Lab/CLI/evidence/persistence tests.

- [x] RED reducer tests for concise independent brief, target-specific what-if/create, exact second graph/active settings, correlated named HTTP 200 and bounded CPU proof at second app, first current what-if/no-change create from current shared source and first params, then fresh first request/CPU proof. Compare shared causal sequences: second preview < second create < both second request/load < first preview < first create < both first request/load; request/load order within a target is flexible. Reject each reordered bypass and pre-second first evidence. Verification snapshots its own target's successful deployment tuple (including parameter path), active app generation/artifact and scale policy with relevant generations. First effective image, account/deployment, settings and scale policy must match frozen baseline.
- [x] Define staged Tasks with optional Hints/Solutions that execute one supported route without granting completion. Reject wrong target/file pairing, draft vs saved, stale preview/source (including away/back), syntax-only success, CLI-only repair, cross-target evidence reuse, partial failure, first old-active-but-nonreproducible state, and unhealthy second settings. Require per-target graph ownership matrix (same-target existing ACR, UAMI, environment, account, child project/deployment parents, app output links, role scopes). Accept supported module restructuring that compiles to equivalent intended graphs. Preserve semantic no-op evidence and test seed records cannot earn tasks, reload/assistance/Result/Restart plus catalog Lab14â†’15â†’none.
- [x] Terra reviews curriculum, first preservation and evidence integrity. Run full tests/build.

## Task 4: Dual-target review UI, docs and acceptance

Files: minimal `BicepDeploymentPanel.vue`/Lab page styles, rendered tests, README/SPEC/CONTEXT/design/ADR status, route smoke.

- [x] Add accessible target selector for the trusted first and second target map using panel-local state (reset to first on reload). Show each selected parameter file, saved/draft versions, target-specific preview/staleness, last deployment/outputs and simulation notice. Keep selection read-only and commands in Cloud Shell. Keyboard, long IDs and 768/1280 responsive layout; prior Labs retain their single-target panel. Rendered tests cover selecting both targets, selector/display consistency, cross-param staleness, reload reset and read-only Result.
- [x] Full worktree tests/build and route HTTP smoke. Attached-browser success/error/dual-target/reload/Result/Restart/console/narrow QA if available; otherwise record lack of browser without claiming visual verification. Terra scoped UI review and independent whole-Lab review.

## Delivery gate

- [x] All scoped and whole-Lab Terra reviews resolved.
- [x] Full worktree/main tests and builds, guarded `delivery.py check lab-15`/`apply lab-15`, matching manifest hashes, browser availability recorded.
- [x] Close Lab15 delivery with `close_delivery.py`. Then plan and implement Lab16 Capstone; afterward diagnose/fix the reported Cloud Shell focus loss.

Plan self-review: both images are supplied because a Bicep deployment cannot build them, and each artifact must match its target's fixed Foundry endpoint/deployment. The second environment differs in app settings and scale behavior as well as names. Reapplying current shared source to the first target prevents an old active app from masking a regression in reusable modules.
