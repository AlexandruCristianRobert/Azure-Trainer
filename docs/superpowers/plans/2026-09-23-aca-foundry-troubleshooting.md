# Foundry Troubleshooting Lab implementation plan

> REQUIRED: superpowers:subagent-driven-development; implement and review each task in order.

**Goal:** Deliver journey Lab11, `aca-foundry-troubleshooting`: diagnose wrong Foundry endpoint and deployment, repair caller access, then demonstrate bounded recovery from throttling and controlled public 503/504 responses when the model dependency does not recover. Plan Lab12 only after this Lab is reviewed, verified and delivered.

**Architecture:** Reuse Lab10's account/deployment/role sandbox, C# source lifecycle, named POST fixtures, inference trace and native evidence. Add a versioned troubleshooting project with editable, bounded retry settings captured only by Save/build/redeploy. Extend the deterministic inference simulator to read that active policy and compare exact expected diagnostic evidence. Seed a reproducible but inspectable broken API; failure observations remain historical while repaired-state Tasks require current configuration and fresh successful proofs. The UI presents public response and upstream attempts without teaching replica scaling as a permission/quota repair.

## Global constraints

- Retained worktree `.superpowers/worktrees/aca-f0`; guarded `lab-11` baseline already captured after Lab10 delivery, never overwrite it. Preserve dirty baseline; no staging, commits, deletion, package install or git metadata edits. Sol medium implements scoped tasks; Terra medium reviews each and independently reviews the whole Lab. Root verifies and guarded-delivers. Snapshot task diffs because most current source is untracked.
- Bind to ADR-0002 and the [journey design](../specs/2026-09-22-containerapps-learning-journeys-design.md) and [technical design](../specs/2026-09-22-containerapps-learning-journeys-technical-design.md). Lab10 and all earlier Labs retain their manifest/content versions and behavior. This increment adds only journey order11, mode troubleshooting; Lab12 remains planned until Lab11 delivery closes.
- Continue `Microsoft.CognitiveServices/accounts` kind AIServices with account resource endpoint `/openai/v1/`, Responses API model set to **deployment name**, token scope `https://ai.azure.com/.default`, exact app UAMI resource-scoped inference grant, pinned `OpenAI` 2.12.0/`Azure.Identity` 1.21.0, and SDK retries disabled. The model/deployment profile remains a simulated fixture, not live availability. Account management identity is not the caller identity.
- Error stages have distinct diagnostics: wrong/unrecognized account endpoint, nonexistent deployment on correct account, missing exact caller grant, upstream 429, and upstream timeout. Public error and upstream status/attempt trace remain separate. 401/403/404/config/identity failures do not retry. Scale-replica changes cannot satisfy model access, quota or timeout Tasks.
- Required retry policy: at most **three total** attempts, ten-second overall deadline, three-second per-attempt cap; honor Retry-After only if a next attempt fits the remaining budget, otherwise deterministic one- then two-second delays. One SDK retry loop only. Transient 429 then success returns 200; persistent retryable failure after three attempts returns 503; deadline/attempt timeout exhausted returns 504. Never report an upstream exhaustion for a local no-deployment/ingress failure.
- A seeded incident may be source/config-broken but must be built and active, with learner history/help/evidence empty. Seed through bounded actions, not fabricated completion. Draft/save/build alone never repairs the active API; only redeployment captures settings. Equivalent redeploy/no-op/tag changes preserve current proof, and effective away/back changes remain stale. Named scenario IDs are the only learner input; no caller-supplied status, fault, delay or trace.

## Review focus

1. Wrong endpoint and wrong deployment produce distinguishable diagnostics before any upstream attempt. Granting role to the account management identity, ACR scope, project scope or another caller cannot repair the app. Exact account scope and app principal do.
2. The learner sees and repairs each incident stage in order; observed failure evidence cannot be retroactively fabricated by a healthy state, and historical diagnostics remain available after repair. Current successful/exhausted evidence binds to active image/config/identity/grant and policy.
3. Retry-After and deterministic delays consume the same ten-second budget as attempts. Per-attempt timeout can retry only within that budget. Every trace contains actual attempt number, principal, deployment, correlation, elapsed duration and delay; no hidden SDK retry multiplication.
4. Persistent 429 => 503 and deadline => 504 only after the declared bounded policy. No retries on auth/config errors. An unchanged healthy request succeeds after the repairs; increasing replicas alone never satisfies any Foundry Task.
5. Native resume, one immutable Result, fresh Restart, no cross-Lab/attempt evidence, assistance recording, old-Lab regressions and the simulation disclosure remain intact.

## Task1: Versioned troubleshooting source and active retry-policy capture

Files: new `src/data/templates/containerapps-dotnet/foundry-troubleshooting.js`, `src/lib/project/manifests.js`, bounded parser in `src/lib/project/foundry.js`/`files.js`, `src/lib/simulation/runtime.js` if needed, project tests.

- [x] RED tests for a new manifest/starter while Guided Foundry remains byte/behavior compatible. Source includes the POST summarizer, validation before inference, UAMI/Responses v1 client, scoped `OPENAI001` opt-in, zero SDK retries, explicit retry loop that distinguishes 429/timeout from auth/config, and bounded total/attempt budget. Pin the existing package versions.
- [x] Supported editable config has endpoint, deployment, total attempts, total budget, per-attempt cap and Retry-After switch. Seed values are buildable but wrong endpoint/deployment and inadequate retry policy. Parser validates exact supported code structure, numeric/boolean ranges and endpoint family, captures policy in immutable `artifact.appSpec.foundry`; an invalid policy fails build without changing publication. No arbitrary C# execution or code substring bypass.
- [x] Active deployment captures policy and app UAMI only after redeploy. Draft/save/build-only, failed build, equivalent redeploy and tags have established provenance semantics. Verify old project/runtime suites and new tests, including a changed identity and wrong project endpoint. Record RED/GREEN and Terra review. Retryable C# status set corrected after review; 542/542 tests and build.

## Task2: Inference policy and diagnostic evidence

Files: `src/lib/simulation/inference.js`, `src/lib/simulation/requests.js`, `src/lib/labEngine/actions.js` if needed, focused tests.

- [x] RED tests prove active policy, not Lab fixture or unsaved source, determines max attempts/budgets/Retry-After. Keep Guided defaults unchanged. Support exact expected diagnostic code in named fixture verification so wrong endpoint, wrong deployment and missing grant cannot all pass by sharing public 502. Record failure observation distinctly from repaired-state success.
- [x] With policy1, transient 429 fails without second attempt; with policy3 and Retry-After enabled it succeeds on attempt2 with the declared delay. Persistent 429 has exactly3 attempts and public503; 3s attempt timeouts plus delays consume at most10s and end504. Too-long Retry-After does not schedule an attempt past deadline. 401/403/404/config/identity yield at most one/no upstream attempt as appropriate. Deterministic logical clock and correlation survive reload.
- [x] Evidence dependencies bind to active policy/config/artifact/UAMI/account/deployment/grant and changed-away/back generations. Historical diagnosis can remain recorded after repair, while current recovery/503/504/healthy proofs stale on effective changes. Reject caller-injected outcome fields and preserve GET/probe/Guided Foundry suites. Terra review. Unaffordable Retry-After fallback fixed across Guided and Troubleshooting; 545/545 tests and build.

## Task3: Reproducible incident, curriculum and catalog

Files: new `src/data/labs/containerapps-journey/foundry-troubleshooting.lab.js`, `src/data/labs/index.js`, relevant integration/catalog tests.

- [x] Seed healthy ACA/ACR/UAMI prerequisites and an AIServices account/project/deployment, but active app config points at a wrong resource endpoint and wrong deployment name, the app caller lacks an inference grant, and retry policy permits only one attempt/does not honor Retry-After. Seed no learner evidence or help usage. An initial named request exposes the wrong-endpoint diagnostic and zero upstream attempts.
- [x] Sequential Tasks use real actions/observations: diagnose and repair endpoint; diagnose and repair deployment; diagnose and repair exact caller role; save/build/redeploy supported retry policy; prove transient429 recovery respecting Retry-After; prove persistent429 public503; prove timeout public504; prove a final healthy200 to the intended deployment. Failure observations must match their exact diagnostic; repair predicates cannot be passed by replica scaling or by modifying only drafts. Include two hints, Solution and Exam Note per Task. Solutions are declarative.
- [x] Integration tests follow every solution through the real reducer, inspect traces and evidence, check wrong role/scope/identity, no-retry auth/config, stale/no-op transitions, partial reload, assistance, Result and Restart. Register order11 and routing Lab10→Lab11→none; update counts and docs for Lab11 only. Terra review. Ordered resilient proof chain added after review; 550/550 tests and build.

## Task4: Observable troubleshooting controls and delivery QA

Files: `src/components/lab/FoundryRequestPanel.vue` and minimal existing UI/style changes, focused UI tests and docs.

- [x] Show each named diagnostic/retry scenario and its immutable input/fault description without exposing outcome injection. Public status/body and upstream diagnostic/attempt table stay distinct; display Retry-After, per-attempt duration, delay and budget consumption, caller/deployment/correlation. Label all responses as local simulation. Controls work by keyboard, remain readable at 768/1280 widths, and keep completed Result read-only.
- [x] Full suite/build and HTTP served smoke pass. The computer-use inventory exposes no browser, so viewport/console visual behavior remains unverified; rendered-component/integration tests provide the available coverage. Terra scoped review resolved two stage-label/validation-order findings; whole-Lab review follows.

## Delivery gate

- [x] Scoped Terra reviews and independent whole-Lab review resolved.
- [x] Full worktree/main tests and builds, guarded `delivery.py check lab-11`/`apply lab-11`, matching manifest hashes. Record browser availability and any unverified visual behavior.
- [x] Close Lab11 delivery with `close_delivery.py`, then start Lab12 plan. No Lab12 implementation before this gate.

Plan self-review: incident diagnostics are gradeable by exact code rather than a shared 502, while repaired-state proofs come from active code/identity and true upstream attempts. The deterministic policy is shared with Guided only through compatible defaults; Guided's existing version and evidence are untouched.
