# Container Apps KEDA Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the second catalog Lab playable from start through a persisted Lab Result.

**Architecture:** Extend the existing Sandbox command tree with Container Apps resources.
Keep content, engine operations, command adapters and read-only Blades separate. Reuse the
existing Lab lifecycle and portal design.

**Tech Stack:** Vue 3, Pinia 2, Vite 6, JavaScript, plain CSS, Vitest node tests.

**Spec:** `docs/superpowers/specs/2026-09-21-containerapps-keda-design.md`

## Global Constraints

- JS only, `<script setup>`, 2-space indent; no new dependencies.
- Vocabulary and styles follow CONTEXT.md and SPEC.md.
- Only Cloud Shell commands mutate Sandbox; Blades are read-only.
- Desktop layout works at 1440 and 1280 pixels.
- Existing Service Bus saves and Lab Results remain valid.
- Work in the provided workspace; git metadata is read-only in this session. Leave changes
  reviewable and uncommitted. Use `npm.cmd` on Windows because npm.ps1 is blocked by policy.

### Task 1: Container Apps engine

**Files:** Create `src/lib/sandbox/containerapps.js`, `src/lib/az/containerapps-arm.js`,
`src/lib/az/commands/containerapp.js`, `tests/az-containerapp.test.js`.
Modify `src/lib/sandbox/model.js`, `src/lib/sandbox/ops.js`, `src/lib/az/commands/index.js`.

**Interfaces:** Consume existing command builders, AzError, location normalization and
group lookup. Produce the arrays and event shapes specified in the design, and export
`normalizeSandbox(sb)` from model.js to initialize missing arrays without changing input.
`createSandbox()` includes both new arrays. `isSandboxShape` accepts absent legacy fields
and rejects non-array fields. Command entry export is `containerappGroup`.

- [x] Write and run failing pipeline tests for create/update/read/delete and error atomicity.
- [x] Implement pure operations and ARM presentation, then register the new command group.
- [x] Test defaults, name/ID environment lookup, rule upsert/preservation, bounds validation,
  unsupported flags/types, `--help`, parent failures, cross-group deletion and cleanup.
- [x] Run focused tests and report red/green evidence for review.

Example acceptance sequence:

```js
const commands = [
  'az group create -n rg-containerapps -l westeurope',
  'az containerapp env create -g rg-containerapps -n env-contoso -l westeurope',
  'az containerapp create -g rg-containerapps -n ca-contoso-api --environment env-contoso --image mcr.microsoft.com/k8se/quickstart:latest --ingress external --target-port 80',
  'az containerapp update -g rg-containerapps -n ca-contoso-api --min-replicas 0 --max-replicas 5',
  'az containerapp update -g rg-containerapps -n ca-contoso-api --scale-rule-name http-requests --scale-rule-type http --scale-rule-http-concurrency 50',
]
// Apply each through runLine; expect no err lines and final scale metadata '50'.
// max-replicas 0 must error and return the original Sandbox without changes.
```

### Task 2: Lab content and lifecycle integration

**Files:** Create `src/data/labs/containerapps-keda.lab.js`, `tests/containerapps-lab.test.js`.
Modify `src/data/labs/index.js`, `src/stores/labRun.js`, `tests/labs.test.js`,
`src/components/lab/LabCompletePanel.vue`, `README.md`, `SPEC.md`.

**Interfaces:** Consume Task 1 arrays and `normalizeSandbox`; export `containerappsKedaLab`
with the existing Lab interface. Catalog order unchanged; second Lab becomes available.

- [x] Test five sequential Solutions, near misses, completion, old saves, resume, restart,
  isolation and persisted results before implementing the content/integration.
- [x] Write five Tasks with two Hints/Solutions/Exam Notes as specified in the design.
- [x] Normalize loaded legacy Sandbox fields and enable Next Lab navigation by catalog order.
- [x] Update current product docs to distinguish two available Labs and supported CLI scope.
- [x] Run focused tests and review content against Microsoft references.

```js
// Observable acceptance: after each Solution, doneCount equals task index + 1.
// Complete this Lab -> switch to Service Bus -> load this Lab:
// completion and resources survive. Restart clears its Sandbox, retaining past results.
```

### Task 3: Read-only Container Apps Blades

**Files:** Create `src/components/blade/ContainerAppEnvironmentBlade.vue`,
`src/components/blade/ContainerAppBlade.vue`, `tests/containerapps-portal.test.js`.
Modify `src/components/blade/BladeHost.vue`, `src/components/blade/ResourceGroupBlade.vue`,
`src/lib/bladeResolve.js`, `src/stores/portal.js`; CSS only if existing classes are insufficient.

**Interfaces:** Consume the flat resource fields and events from the spec. Produce Blade
kinds `containerapp-environment` and `containerapp`. Reuse existing UI props and token styles.

- [x] Write failing tests for new event focus, notifications, deletion fallback and resolution.
- [x] Add resource rows, navigation and read-only environment/app Overview components.
- [x] Show app image, ingress/port, environment, min/max replicas and HTTP rules.
- [x] Run focused tests; review files for mutations, resource lookup and empty-state errors.

```js
expect(bladeForEvent({type: 'created', resourceType: 'containerApp',
  resourceGroup: 'rg-containerapps', name: 'ca-contoso-api'}, {kind: 'resource-groups'}))
  .toEqual({kind: 'containerapp', resourceGroup: 'rg-containerapps', name: 'ca-contoso-api'})
```

### Final verification

- [x] Review the integrated changes for spec compliance and code quality.
- [x] Run `npm.cmd test` and `npm.cmd run build`.
- [x] Inspect Home, new Lab, Blade updates and completion in a browser when available.
- [x] Record final evidence and any limitations in the implementation ledger.
