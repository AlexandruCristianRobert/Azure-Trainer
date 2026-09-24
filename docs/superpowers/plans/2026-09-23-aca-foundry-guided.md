# Guided Foundry integration Lab implementation plan

> REQUIRED: superpowers:subagent-driven-development; implement and review each task in order.

**Goal:** Deliver journey Lab10, `aca-foundry-guided`, in which a seeded Container App invokes a simulated Foundry model through its assigned managed identity, proves a healthy summarization response and proves validation short-circuits inference. Plan Lab11 only after Lab10 is reviewed, verified and delivered.

**Architecture:** Add bounded AIServices account/project/deployment resources and resource-scoped inference RBAC to the persistent sandbox. Add a versioned C# summarizer project to the existing source/save/build/redeploy flow. A deterministic inference simulator consumes the active deployment, effective identity, account/model configuration and immutable request fixtures; it records correlated upstream attempts and public responses as native evidence. The UI makes every simulation boundary explicit. No real Azure calls or live model availability claims.

## Global constraints

- Worktree `.superpowers/worktrees/aca-f0` only. Preserve the dirty baseline; no staging, commits, git metadata edits, package installation or deletion. Sol medium implementers and Terra medium independent reviewers. Use whole-Lab review after task reviews. Controller delivers with the existing guarded `lab-10` baseline.
- Bind to the [approved journey design](../specs/2026-09-22-containerapps-learning-journeys-design.md), [technical design](../specs/2026-09-22-containerapps-learning-journeys-technical-design.md) and ADR-0002. Preserve all nine delivered journey Labs and the older catalog, evidence semantics, restart/read-only Results, source/build separation and no-op preservation.
- Model a `Microsoft.CognitiveServices/accounts` resource of kind `AIServices`, one project child and account-level deployment children, using management API `2025-06-01`. Guided create starts without any Foundry account/model. The worked deployment profile `gpt-5-mini`/`2025-08-07`/`GlobalStandard` is a simulator fixture, not a claim of live regional availability. The account-assigned project-management identity is distinct from the caller Container App user-assigned identity.
- Use account resource endpoint `https://<account>.services.ai.azure.com/openai/v1/`, Responses API `/responses` with `model` equal to deployment name, token scope `https://ai.azure.com/.default`. Project endpoint is not an inference endpoint. Pin teaching source dependencies `OpenAI` 2.12.0 and `Azure.Identity` 1.21.0; disable SDK retries so the behavioral simulator owns total attempts.
- Use resource-scoped `Cognitive Services User` (`a97b65f3-24c7-4388-baec-2e87135dc908`) as the approved worked grant. Microsoft [Foundry keyless guidance](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-entra-id) supports that grant, while its [v1 API guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/api-version-lifecycle) names `Cognitive Services OpenAI User` (`5e0bd9bd-7b93-4f28-af87-19fc36ad61bd`); document the service/role guidance difference without claiming universal equivalence. Keep authorization exact to the simulated account scope and app principal; ACR pull permission is separate.
- Shared inference policy: maximum three total attempts, ten-second overall budget, three-second per-attempt cap, honor `Retry-After` only within budget or use deterministic one-/two-second backoff, never retry 401/403/404/config errors. Exhausted dependency is public 503; deadline is public 504. Diagnostic trace identifies attempted account/deployment/principal, correlation, outcome and delay; never expose hidden fixture controls as learner-editable outcome fields. Guided tests exercise healthy and invalid input; later Labs will exercise the rest of the policy.
- Follow RED/GREEN for each bounded task. Snapshot each task before changes with `review_snapshot.py`; use its diff plus tests for reviewers because most current source is untracked. Record task outcomes and reviews in the plan/workspace. Do not create Lab11 or Lab12 plans/content until their respective predecessors are delivered.

## Task1: Foundry sandbox and resource-scoped identity

Files: `src/lib/sandbox/model.js`, new `src/lib/sandbox/foundry.js`, `src/lib/sandbox/roleAssignments.js`, `src/lib/sandbox/ops.js` as needed, focused sandbox tests.

- [x] RED tests: create/show/list AIServices accounts and project/deployment children with validated resource group, location, SKU and deployment profile; preserve IDs/endpoints after normalization/reload, reject malformed or duplicate child resources atomically. No caller-provided arbitrary ARM objects.
- [x] Account create may carry its own management identity, recorded separately from app UAMI. Account/project/deployment IDs and `2025-06-01` ARM view are deterministic; deletion and resource-group cleanup remove children and scoped grants without dangling data.
- [x] Generalize top-level role validation without relaxing registry `AcrPull`. Accept exact Foundry account scope plus Cognitive Services User and, if safely modeled, OpenAI User. Grant/list/revoke by principalId and scope with deterministic distinct assignment IDs; reject mismatched scope/role/principal and duplicate effective grant. Preserve Key Vault and ACR behavior.
- [x] Verify old sandbox/identity suites plus new tests. Review for data-shape compatibility and persistence. Terra findings on project-management enablement and exact account-scope routing fixed and re-reviewed; full suite 505/505.

## Task2: Simulated Azure CLI and inspection

Files: new `src/lib/az/commands/cognitiveservices.js`, `src/lib/az/commands/index.js`, `src/lib/az/commands/role.js`, ARM presenter as needed, CLI tests.

- [x] RED tests for selected realistic `az cognitiveservices account create/show/list`, `account project create/show/list`, and `account deployment create/show/list` forms from the [Microsoft quickstart](https://learn.microsoft.com/en-us/azure/foundry/tutorials/quickstart-create-foundry-resources). Support only documented bounded flags/profile. Returned views expose resource endpoint and deployment name clearly; project endpoint is visibly a different value.
- [x] Route `az role assignment create/list/delete` to Foundry account when exact scope matches, retaining registry/Key Vault flows and atomic errors. Allow learner to inspect the app UAMI principal ID with existing commands.
- [x] Verify old CLI suites plus new tests. Review CLI grammar, exact identity/scope and wrong-resource diagnostics. Terra finding on deployment name/model name coupling fixed and re-reviewed; full suite 513/513 and build passed.

## Task3: Summarizer source, parser and deployment capture

Files: new `src/data/templates/containerapps-dotnet/foundry.js`, `src/lib/project/manifests.js`, bounded `src/lib/project/csharp.js`/`files.js`/`build.js` changes, `src/lib/simulation/runtime.js` capture changes, project tests.

- [x] RED tests: existing manifests remain stable; new versioned template includes `POST /api/summarize`, input validation, resource endpoint/deployment configuration and C# identity/token/Responses client with SDK retries disabled. Starter is source-editable in bounded regions and buildable but inference is unconfigured.
- [x] Parse the supported C# structure/config semantically. Invalid/missing endpoint, deployment, identity use, POST contract, disabled SDK retry and bounded timeout fail build/verification as appropriate; editing draft source alone never changes the active API. Build records immutable artifact; redeploy captures source-derived config and effective app identity, including a changed UAMI as a deployment change. No-op/tag updates retain active provenance.
- [x] Verify project/runtime suites and tests for wrong project endpoint, stale artifact, source save/build/redeploy separation and identity capture. Review parser boundaries and version migration. Scoped `OPENAI001` opt-in added after Terra review; re-review clean, 521/521 tests and build.

## Task4: Deterministic inference and evidence

Files: new `src/lib/simulation/inference.js`, `src/lib/simulation/requests.js`, `src/lib/labEngine/actions.js`, evidence/dependency integration, focused engine tests.

- [x] RED tests for immutable named POST fixtures with body and fault profile supplied only by the Lab. Run against active deployment and exact current account/deployment/UAMI grant. A healthy valid input invokes the intended deployment once and returns 200 `{summary,deployment}`; blank/oversized invalid input returns public 400 and **zero** upstream attempts.
- [x] Distinguish wrong endpoint, missing deployment, missing identity and missing resource-scoped grant. Implement shared bounded retry policy from global constraints, with deterministic logical time and trace; no 401/403/404/config retries, no SDK retry multiplication. Public 503/504 only where corresponding upstream policy is exhausted. Request outcome and upstream diagnostic are separate.
- [x] Record native verification with dependencies on active source/artifact/config, app identity, Foundry account/deployment and role grant. Effective changes invalidate proof; tag/no-op/draft/build-only changes retain it. Caller cannot forge statuses/attempts/evidence through action fields. Verify replay/reload and prior GET/probe behavior; review state transitions. Three Terra findings fixed and re-reviewed clean; 530/530 tests and build.

## Task5: Guided curriculum, UI and acceptance

Files: new `src/data/labs/containerapps-journey/foundry-guided.lab.js`, catalog/routing/count/docs, a Foundry request panel integrated with `ExperimentPanel.vue`, relevant Blade presentation, integration/UI/browser tests.

- [x] Seed healthy private C# API, image, ACR, environment, app with caller UAMI and AcrPull, but no Foundry account/project/deployment and no pre-earned evidence. Metadata engine2/content1, journey order10, mode guided. Tasks: provision/inspect account+project+deployment; grant the app identity inference access; configure/save/build/redeploy the summarizer; run a valid request showing 200 plus intended upstream invocation; run invalid input showing 400 with zero invocation. Each Task has useful hints, Solution and Exam Note; solution actions never execute themselves.
- [x] Show endpoint, deployment and caller identity/config in inspection. Foundry request controls show named valid/invalid fixtures, POST input, public response, correlated upstream attempt trace and simulation notice. Maintain keyboard support, clean 768/1280 layouts, native Result/restart and no cross-run evidence. Label model profile and responses as simulated.
- [ ] Integration proves ordered worked path, missing role/wrong endpoint, draft-only and invalid-input short circuit, evidence staleness/recovery, persistence and restart. Update catalog count/routing/docs for Guided only. Verify full tests/build and browser journey including narrow viewport/console. Automated checks pass; interactive browser unavailable in this session, so visual viewport/console acceptance remains unverified.

## Delivery gate

- [x] Scoped Terra review after each task and independent whole-Lab Terra review; resolve substantive findings.
- [ ] Full tests/build and browser acceptance on retained worktree, then guarded `delivery.py check lab-10`/`apply lab-10`, main tests/build and matching file hashes.
- [x] Close Lab10 delivery with `close_delivery.py`, then start Lab11 plan. No Lab11 implementation before this gate.

Plan self-review: the resource endpoint, Responses request and app identity are kept separate from Foundry project management. The simulator has one controlled source of request faults and one bounded retry loop. The approved role example is preserved while its documentation ambiguity is explicit.
