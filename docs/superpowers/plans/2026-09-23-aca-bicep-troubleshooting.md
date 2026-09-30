# Bicep troubleshooting implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by task. Sol medium implements and Terra medium reviews each completed task. Root owns integration and guarded delivery.

**Goal:** Deliver journey Lab 14, `aca-bicep-troubleshooting`, teaching a located module-output validation error, a wrong but valid environment parameter visible in what-if, and an identity miswire visible only after deployment and a denied Foundry request. Lab 15 and the Capstone follow separate plans.

**Authority:** [Lab 14 implementation design](../specs/2026-09-23-aca-bicep-troubleshooting-implementation-design.md), [agreed journey](../specs/2026-09-22-containerapps-learning-journeys-design.md), [technical design](../specs/2026-09-22-containerapps-learning-journeys-technical-design.md), and the delivered Lab 13 implementation.

## Working rules

- Work only in `.superpowers/worktrees/aca-f0`, branch `codex/aca-f0`. The guarded `.superpowers/sdd/lab-14-delivery-baseline.json` was captured after Lab 13 delivery and must not be overwritten. Preserve the dirty baseline. No staging, commits, deletion, package installation, or live Azure calls.
- Capture per-task snapshot/diff with the Lab 14 review helper. Use RED tests first for behavior changes. After each task, Sol stops writing while Terra reviews; fix actionable findings with the same implementer and re-review. Root records rulings. Run full tests/build before guarded delivery.
- Keep Lab 13 provider/activation behavior strict by default. The Lab 14 fault exception is explicit, narrow, and used consistently by validate, what-if, create and trusted effect recomputation. Never trust caller-supplied graph/preview/outcome. A failed validate is Cloud Shell feedback, not earned evidence.

## Task 1: Two-identity fault policy and runtime diagnosis

Files: `src/lib/bicep/{providers,preview,deploy}.js`, `src/lib/az/commands/deployment.js`, `src/lib/labEngine/actions.js` only as needed, focused Bicep/provider/deploy/CLI tests.

- [x] RED tests prove Lab 13 still rejects an extra UAMI or inference role to a decoy, while a Lab 14 `bicepIdentityFault` policy accepts exactly two declared UAMIs and exactly two roles: registry AcrPull for the attached primary and account Cognitive Services User bound through either declared identity. Reject literal/unlinked principal, wrong role/scope, third UAMI, extra account/app grant, wrong app identity or registry AcrPull. Keep pinned schemas and bounds.
- [x] Derive the policy only from the trusted Lab capability and thread it through provider validation, preview, apply, CLI validate/what-if/create, and trusted effect recomputation. Preview and apply must agree; read-only commands make no Sandbox changes. Under the fault policy, require published image, intended app UAMI and registry AcrPull before activation, but defer the account inference grant check to the existing request simulator. The decoy app can deploy and named request reports `FOUNDRY_ACCESS_DENIED` with zero upstream attempts. Corrected Bicep grant plus redeploy enables a 200 request. Do not weaken default Lab 13 activation.
- [x] Test partial app failure rollback, no-op semantics, source/target binding, malformed/forged effect rejection, CLI long/short name/group aliases and strict saved paths, generic Bicep Lab CLI wording, older Foundry/CPU and Lab 13 regressions. Terra reviews the exception boundary and trust chain.

## Task 2: Faulted project, Lab, and evidence gates

Files: new Lab 14 template/manifest and `src/data/labs/containerapps-journey/bicep-troubleshooting.lab.js`, `src/lib/bicep/provenance.js`, `src/lib/labEngine/{actions,run}.js` for the bounded incident-preview milestone, catalog registration, focused tests.

- [x] RED fixture tests for seed-only Basic ACR and published healthy image; no stack/provenance/evidence seeded. Starter contains all three faults: missing environment module output, valid `env-bicep-test` parameter instead of expected `env-bicep-incident`, and declared decoy principal connected to the account role while app/AcrPull use the intended identity. Preserve separate saved and draft files. Learner ACR build is disabled.
- [x] Build staged Tasks and Hints/Solutions: command validation diagnosis and source repair; wrong read-only what-if and parameter repair with fresh preview; create/show/app inspection and named `access-denied` request; identity-link repair with fresh validate/preview/create and named `recovered` request. Require trusted successful validate/show/app-show observations, a bounded immutable wrong-preview milestone recorded by the reducer and validated on reload despite preview pruning, matching the seeded wrong parameter hash/version, current corrected preview/deployment/source tuple, distinct ordered denied evidence (HTTP 502, `FOUNDRY_ACCESS_DENIED`, zero upstream attempts) and recovered evidence (HTTP 200), and a current compiled graph whose sole account Cognitive Services User assignment is bound to the attached primary UAMI. Role-list is an inspection hint, not an observed gate. CLI-only Cognitive Services OpenAI User grant and syntax-only success must fail. A failed validate is transient diagnostic feedback, not a durable machine gate.
- [x] Execute displayed Solutions and alternative supported repairs through reducer. Test stale file versions (including away/back), wrong parameters/target, draft vs saved, no-op reapply, partial failure, manual CLI OpenAI User grant bypass, wrong-preview milestone pruning/reload/forgery, two scenario IDs/order, reload/assistance/Result/Restart, and catalog order Lab 13â†’14â†’none. Terra reviews curriculum and evidence integrity.

## Task 3: Inspection presentation, docs, and acceptance

Files: minimal `BicepDeploymentPanel.vue` or Lab page changes only if needed, rendered tests, README/SPEC/CONTEXT/design/ADR status for Lab 14, route smoke.

- [x] Extend the common Bicep panel to show the Lab 14 target, transient located validation diagnostic, durable historical wrong preview beside the current corrected preview, deployment operations/outputs and stale state. Test immediate diagnostic rendering and Cloud Shell history persistence after reload without claiming failed-validation Bicep provenance. Add no editable status controls. Keyboard, long IDs and 768/1280 layouts remain usable.
- [x] Full worktree tests/build, route HTTP smoke, and attached-browser success/error/recovery/reload/Result/Restart/console/narrow layout if available. If no browser surface is attached, record that limitation without claiming visual verification. Terra scoped review and independent whole-Lab review.

## Delivery gate

- [x] All scoped and whole-Lab Terra reviews resolved.
- [x] Full worktree/main tests and builds; guarded `delivery.py check lab-14`/`apply lab-14`; matching manifest hashes and browser availability recorded.
- [x] Close Lab14 delivery with `close_delivery.py`. Only then plan and implement Lab 15.

Plan self-review: the identity miswire is a valid declared-resource wiring error, so validation and preview can succeed and the runtime request supplies the third symptom. The explicit Lab capability protects Lab 13's stricter teaching contract. Incremental deployment leaves the decoy identity/old grant available for inspection; the final assessor checks effective current source and access, not resource deletion by omission.
