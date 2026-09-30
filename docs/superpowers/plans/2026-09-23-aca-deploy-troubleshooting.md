# Troubleshooting deployment Lab implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the independently restartable second deployment Lab, requiring diagnosis and repair of a deterministic startup incident and a successful real simulated request.

**Architecture:** Reuse the reviewed behavioral reducer, captured builds, deployment runtime and learner UI. Add a narrowly scoped authored initialization hook for seeded simulation state, then one troubleshooting Lab. The hook seeds resources/artifacts/runtime only; it must not seed learner evidence, assistance, history or completion.

**Tech Stack:** Existing Vue 3/Pinia, JavaScript pure simulation, Vitest, native IndexedDB; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-22-containerapps-learning-journeys-design.md` deployment Troubleshooting flow; companion technical design and ADR-0002.

## Global constraints

- Lab1 delivered and gated: 330 tests, build, native21 browser checks, actual UI workflow. Implement only Lab2 now; no Lab3 changes until this gate passes.
- Work in retained `.superpowers/worktrees/aca-f0`. Preserve dirty baseline, no staging/commits/git metadata mutations. Controller uses snapshot review and guarded delivery.
- User already authorized first three Labs sequentially and same subagent workflow. This executable plan realizes the approved design without another permission checkpoint.
- Keep six legacy Labs and Lab1 compatible, native results immutable, attempts read-only after committed completion, old results on restart.
- Engine2/content1, journey `containerapps-end-to-end`, order2, mode `troubleshooting`, ID `aca-deploy-troubleshooting` (confirm technical catalog spelling before authoring).
- Valid supplied .NET10 project and published `api:v1`; do not add a Dockerfile fault. Service `contoso-api`, APP_ENV `training`, listening8080.
- Faults: desired unpublished `api:missing`, absent exact AcrPull permission, ingress target9090. User-assigned identity exists and is attached/selected. Deterministic seed has no active deployment.
- Names: `rg-aca-incident`, `acrincident`, `env-incident`, `id-incident`, `api-incident`; East US.
- Visible brief/tasks present symptoms and expected response, without naming the three causes. Logs/Blades expose causes; optional two Hints and structured Solutions/Exam Notes each. No inspection command required for grading.
- Resource Blades remain read-only. No CPU/probes/Foundry/Bicep or real Azure/source execution.

## Review focus

1. Seed/restart must reproduce all faults with no fabricated learner evidence; test exact fault progression and empty evidence/history.
2. Repairing only image or permission must not complete startup; test sequential image-not-found, pull-denied, port-mismatch and success.
3. Successful request to another app or previous active version must not complete this Lab; test scoped current desired/active provenance.
4. Reload/restart cannot seed over saved changes or delete prior Results; test store persistence and explicit restart.
5. Help is optional and recorded; hidden fault details must remain hidden until inspection/help. Test schema/help and inspect actual initial UI.

## Task 1: Seeded incident and playable troubleshooting Lab

**Files:** create `src/data/labs/containerapps-journey/deploy-troubleshooting.lab.js`, optional focused `deployment-incident.js` fixture helper; modify `src/lib/labEngine/run.js`, `src/data/labs/index.js`, applicable catalog-count tests, README/SPEC/ADR status. Create `tests/aca-deploy-troubleshooting.test.js`; extend core tests for seed boundary if needed. Shared UI changes only for a demonstrated integration defect.

**Interfaces:** Existing `createBehavioralRun(lab,{attemptId})`, `applyRunAction(run,action,lab)->{run,lines,diagnostics,...}`, `evaluateLab(lab,run)` remain compatible. New optional trusted content `lab.initializeSimulation(run)` returns only `{sandbox,artifacts,runtime,nextSequence}`. Validate the hook type, clone/validate its result, reject unsupported keys; merge only those four fields into the freshly created run and validate the entire envelope. Do not accept evidence, elapsed/completion, identity, revision, project or assistance fields from the hook. Saved runs bypass initialization on load as they already bypass createBehavioralRun.

- [x] Write failing tests for metadata, initial resources/published artifact/failed runtime, empty learner state and deterministic restart. Representative assertions:

```js
const first = createBehavioralRun(lab, { attemptId: 'first' })
const second = createBehavioralRun(lab, { attemptId: 'second' })
expect(first.evidence.experimentsById).toEqual({})
expect(first.history).toEqual([])
expect(first.runtime.deploymentsByApp[appId].active).toBeNull()
expect(first.runtime.deploymentsByApp[appId].diagnostics[0].code).toBe('IMAGE_TAG_NOT_FOUND')
expect(second.artifacts).toEqual(first.artifacts)
expect(evaluateLab(lab, first).isComplete).toBe(false)
```

- [x] Run `npm.cmd test -- --exclude '**/.superpowers/**' tests/aca-deploy-troubleshooting.test.js` and record RED.
- [x] Implement the narrow hook and fixture through the same existing command/build/reconcile functions. One safe fixture implementation applies authored command actions to the supplied fresh run, then returns only the four allowed state fields. Normalize resource creation timestamps to one fixed seed timestamp so restarts reproduce fixtures. Initialization commands:

```text
az group create -n rg-aca-incident -l eastus
az acr create -g rg-aca-incident -n acrincident --sku Basic
az acr build --registry acrincident --image api:v1 --file Dockerfile .
az identity create -g rg-aca-incident -n id-incident
az containerapp env create -g rg-aca-incident -n env-incident -l eastus
```

Then create api-incident with image `acrincident.azurecr.io/api:missing`, user-assigned/registry identity ARM IDs from the subscription constant, registry server, APP_ENV=training, external ingress and target9090. No role grant. Initial files are SOLUTION_FILES. Do not recurse into createBehavioralRun from the hook.

- [x] Author two outcome Tasks: restore a startup configuration meeting the supplied API requirements; verify HTTP200 `/api/info` body `{service:'contoso-api',environment:'training'}`. First predicate requires the intended group/app/registry/environment/identity, published correct source image, exact AcrPull and succeeded desired+active state with correct port/config. Final predicate includes same live criteria and a versioned request scenario with active generation/artifact and desired/status dependency selectors. Repair solution can use these steps (derive principal ID with existing identity factory):

```text
az containerapp update -g rg-aca-incident -n api-incident --image acrincident.azurecr.io/api:v1
az role assignment create --assignee-object-id PRINCIPAL_FROM_IDENTITY_FACTORY --assignee-principal-type ServicePrincipal --role AcrPull --scope REGISTRY_ARM_ID
az containerapp ingress enable -g rg-aca-incident -n api-incident --type external --target-port 8080
```

The implementation expands both identifier symbols to exact synthetic IDs. Final Solution uses `{steps:[{kind:'experiment',request:{appId,method:'GET',path:'/api/info'},expected:{status:200,...}}]}`. Keep task wording requirement-oriented and root causes inside help/inspection only.

- [x] Test actual repair sequence: first image update produces ACR_PULL_DENIED, grant plus redeploy still produces TARGET_PORT_MISMATCH, port repair succeeds but request task remains incomplete, actual request completes. Test alternative repair ordering, no-op preserving evidence, failed desired update against prior active cannot pass, unrelated request cannot pass, fresh restart and help/results via store. Do not assert all intermediate diagnostics empty: failures are the learning exercise.
- [x] Register Lab2, update journey counts without weakening legacy result assertions, update docs. If predicates duplicate substantial Guided code, extract only the common bounded criteria into a focused helper and retain all Guided tests.
- [x] Run focused Lab/core/store/catalog tests; record GREEN and review report at `.superpowers/sdd/lab-2-report.md`. Controller dispatches independent Terra review, fixes through original implementer, then whole-Lab review.

## Delivery gate

- [x] Review findings resolved, full tests/build pass.
- [x] Actual browser shows seeded symptoms/logs; inspect published image/identity, perform partial repairs/failures, final request, resume/restart/results and journey navigation; no console errors.
- [x] `python .superpowers/sdd/delivery.py check lab-2` then `apply lab-2`; verify delivered main tests/build and hashes. Keep review/baseline artifacts.
- [x] Mark Lab2 complete before writing Lab3 plan.

Self-review: the task covers all three approved incident faults, reusable project/image provenance, independent restart, optional assistance and observed recovery. It introduces only the missing seed hook; the completed Lab1 UI is reused. Execution method and reversible uncommitted delivery are already authorized.
