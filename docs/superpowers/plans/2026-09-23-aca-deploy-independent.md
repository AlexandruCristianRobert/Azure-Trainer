# Independent deployment Lab implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the third and final currently authorized Lab: deploy a meaningfully different API configuration from requirements, proving source/build/private access/runtime/request behavior.

**Architecture:** Reuse the existing project template, behavioral actions/session, shared deployment criteria and UI. This is content and integration coverage; no new engine platform, dependencies or infrastructure prerequisites. A blank Sandbox ensures learners perform the complete image lifecycle.

**Tech Stack:** Existing Vue/Pinia JavaScript simulator, Vitest and native IndexedDB.

**Spec:** `docs/superpowers/specs/2026-09-22-containerapps-learning-journeys-design.md` Independent deployment flow, companion technical design and ADR-0002.

## Global constraints

- Lab2 is complete/delivered before this plan:340/340 tests and build in worktree and main, independent review and actual browser repairs/reload/restart/results passed.
- Work only in `.superpowers/worktrees/aca-f0`; no commits/staging/git metadata mutations/dependencies. Keep dirty baseline. Controller handles guarded incremental delivery.
- Existing user authorization covers first THREE Labs sequentially and the same Sol implementation/Terra review/root verification workflow. Do not implement Lab4 CPU scaling.
- ID `aca-deploy-independent`, engineVersion2/contentVersion1, journeyId `containerapps-end-to-end`, journeyOrder3, labMode `independent`, skillAreaId `containers`.
- Start from STARTER_FILES and an empty Sandbox. Do not seed a registry, image, identity, deployment or verification evidence.
- Required names: group `rg-aca-independent`, registry `acrindependent` Basic, environment `env-independent`, identity `id-independent`, app `api-independent`, image `acrindependent.azurecr.io/orders:v2`, East US.
- Source response service `orders-api`; listen on9090; deployed APP_ENV `staging`; external ingress target9090. Expected actual GET `/api/info` HTTP200 body `{service:'orders-api',environment:'staging'}`.
- Visible brief and Tasks are requirements, not a sequence of commands. Accept any supported operation order and supported equivalent source expressions. Optional two Hints and structured worked Solution plus Exam Note for every Task; record assistance normally.
- Preserve six legacy Labs and both new Labs, immutable completed Results, reload/restart, draft/saved/published/deployed separation and explicit diagnostics.
- Read-only Blades and simulated bounded source/build/requests; no real Azure/.NET execution, CPU/probes/Foundry/Bicep, mandatory cleanup or release-management expansion.

## Review focus

1. Reusing Guided source/8080/training must fail the new requirements; test each changed value, hardcoded environment and a wrong final response.
2. Draft edits cannot alter a build; saved edits cannot alter a published/active image. Test change-before-save/build/redeploy boundaries and actual captured response.
3. Requirements permit supported alternative source and operation order; test infrastructure first and inline service expression with comments/whitespace.
4. A request to an old active image after a failed update cannot complete; test failed desired update followed by request and recovery.
5. Assistance/result/restart and journey routing must remain independent; test store result metadata and first→second→third navigation, plus all legacy counts.

## Task 1: Requirement-based independent Lab

**Files:** create `src/data/labs/containerapps-journey/deploy-independent.lab.js`, `tests/aca-deploy-independent.test.js`; modify catalog, `tests/next-lab.test.js`, `tests/containerapps-lab.test.js`, `tests/progress-store.test.js`, any explicit journey count assertions; README/SPEC/ADR status. Reuse `deployment-criteria.js`; change it only for a demonstrated common contract need. No UI redesign.

**Interfaces:** `createBehavioralRun(lab,{attemptId})`, `applyRunAction(run,action,lab)->{run,lines,diagnostics,...}`, `evaluateLab(lab,run).isComplete`; store `dispatchBehavioral(action)` returns `{run,...,effects:{diagnostics,lines,portalEvents}}`. Use `createDeploymentCriteria({group,registry,environment,identity,app,service,port,environmentValue,requiredImage})` for publication/grants/deployment provenance. Keep a declared versioned request scenario and current generation/artifact/desired/status dependencies for final verification.

Controller integration clarification: retain Vitest's default excludes and additionally exclude `**/.superpowers/**` in `vite.config.js`, using existing `configDefaults` from `vitest/config`. Installed Vitest defaults do not exclude retained worktrees or baseline test copies; the documented plain `npm test` must test the project once. This is a narrow configuration correction, verified by the final plain test command; no new dependency or bespoke test is needed.

- [x] Author failing tests for Lab metadata, empty resources/artifacts/evidence, .NET starter, requirement-first Tasks, structured help, and initially incomplete evaluation:

```js
const run = createBehavioralRun(lab, { attemptId: 'independent' })
expect(run.sandbox.containerApps).toEqual([])
expect(run.sandbox.containerRegistries).toEqual([])
expect(run.artifacts.publishedTags).toEqual({})
expect(run.evidence.experimentsById).toEqual({})
expect(evaluateLab(lab, run).isComplete).toBe(false)
expect(lab.labMode).toBe('independent')
```

- [x] Run `npm.cmd test -- --exclude '**/.superpowers/**' tests/aca-deploy-independent.test.js` and record RED.
- [x] Author six requirement outcomes in one neutral `Deployment requirements` stage: saved API behavior/listener; valid matching Docker contract; named resource topology and private access; correctly published artifact; active deployment from that artifact with requested config; actual successful request. Put all required names/values in task text or short brief so no hidden acceptance criteria. Do not prescribe the order resources/files must be created. The completion criteria use parsed semantics and captured artifacts, never exact source equality.
- [x] Build worked source answers from SOLUTION_FILES using these precise changed values:

```js
const workedFiles = {
  ...SOLUTION_FILES,
  'src/Trainer.Api/AppSettings.cs': SOLUTION_FILES['src/Trainer.Api/AppSettings.cs'].replace('contoso-api', 'orders-api'),
  'src/Trainer.Api/appsettings.json': JSON.stringify({ ListeningPort: 9090 }, null, 2) + '\n',
  Dockerfile: SOLUTION_FILES.Dockerfile.replace('ASPNETCORE_HTTP_PORTS=8080', 'ASPNETCORE_HTTP_PORTS=9090'),
}
```

Use complete Program.cs from SOLUTION_FILES for the supported member/config expression. Source Solution contains file steps for Program.cs, AppSettings.cs and appsettings.json; Docker Solution one file step. Support a valid inline `service = "orders-api"` alternative without forcing the member-expression form. Reject literal `environment = "staging"`; APP_ENV must come from deployed config.
- [x] Resource Solution uses the existing supported commands with exact expanded synthetic identity/principal/registry IDs:

```text
az group create -n rg-aca-independent -l eastus
az acr create -g rg-aca-independent -n acrindependent --sku Basic
az identity create -g rg-aca-independent -n id-independent
az role assignment create --assignee-object-id <derived principal ID> --assignee-principal-type ServicePrincipal --role AcrPull --scope <derived registry ARM ID>
az containerapp env create -g rg-aca-independent -n env-independent -l eastus
az acr build --registry acrindependent --image orders:v2 --file Dockerfile .
```

Derive actual identifiers with the current subscription constant and identity factory in final content. Deployment Solution uses `az containerapp create` with required app/environment/image, attached/registry identity ARM ID, registry server, APP_ENV=staging, external ingress and target9090. Final Solution is an experiment request. All of these instructions remain hidden until optional help is revealed.
- [x] Execute authored Solutions through reducer/store actions and prove final GET200 with expected body. Add negative tests for old Guided values, hardcoded env, invalid Docker build/publish atomicity and port mismatch. Test order variation (infrastructure before file editing), equivalent inline source, and draft→saved→published→active boundaries. Test a wrong-runtime APP_ENV response fails verification until update+fresh request; failed desired update cannot borrow old active evidence. For raw reducer tests, completion is an evaluation result until explicit session completion, allowing staleness checks.
- [x] Test native-store reload of partial progress, help metadata, committed completion read-only, and restart with historical Result retained. Reuse existing minimal repository fixture/test helpers without introducing a general test framework or duplicating large helper blocks.
- [x] Register only this Lab. Update exact containers Skill Area total from3to4 in `tests/containerapps-lab.test.js:119` and `tests/progress-store.test.js:37`, preserving completed/inProgress assertions. Update journey routing tests for Guided→Troubleshooting→Independent→none and legacy terminal EventGrid→none. Keep Home six legacy plus three journey Labs.
- [x] Update README/SPEC/ADR status to three deployment Labs complete; explicitly retain CPU/probes/Foundry/Bicep as planned. Run focused tests (new Lab, Guided/Troubleshooting, relevant store/catalog/routing); self-review and write `.superpowers/sdd/lab-3-report.md` with RED/GREEN and limits. No full suite/build while controller owns that gate.

## Delivery gate

- [x] Independent task review and root whole-Lab review resolved.
- [x] Full tests/build pass; actual browser requirements visible with hidden optional help, source edits/build/deploy/request, meaningful failure/recovery, draft reload, Result/restart and all three journey cards/links; no console errors.
- [x] Guarded `python .superpowers/sdd/delivery.py check lab-3` then `apply lab-3`, delivered main tests/build and hashes verified.
- [x] Mark this plan complete and stop at the authorized three-Lab boundary. Preserve worktree/reports and unrelated changes; do not commit or merge.

Self-review: no missing independent-flow requirement. Names, source service, runtime configuration and listening port vary meaningfully; every prerequisite must be built in this Lab, help is optional, and current observed behavior is mandatory. Existing complete engine/UI provide all needed interfaces. The prior explicit authorization covers execution of this just-in-time plan.
