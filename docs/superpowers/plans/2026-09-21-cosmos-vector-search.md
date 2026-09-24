# Cosmos DB Vector Search Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track steps with checkboxes.

**Goal:** Implement the third catalog Lab, from account setup through vector-enabled container.
**Architecture:** Extend the command tree and nested Sandbox model; reuse Lab lifecycle and
read-only Blade components. Keep Cosmos policy validation, resource operations and adapters separate.
**Tech Stack:** Existing Vue 3, Pinia 2, JavaScript, plain CSS, Vitest and Vite; no new dependencies.
**Spec:** `docs/superpowers/specs/2026-09-21-cosmos-vector-search-design.md`

## Global constraints

- Follow CONTEXT.md and SPEC.md terminology; preserve the first two Labs and pending changes.
- Work in supplied checkout with read-only git metadata; no commits or new worktrees.
- Windows commands use `npm.cmd`. Use focused tests during implementation, full suite at integration.
- JS only, 2-space indent, script setup; no real Azure, credentials, filesystem shell or data queries.
- Resources and events use the exact fields in the design.

## Task 1: Cosmos engine and policy validation (Terra)

Create `src/lib/sandbox/cosmosdb.js`, `src/lib/sandbox/cosmosdb-policies.js`,
`src/lib/az/cosmosdb-arm.js`, `src/lib/az/commands/cosmosdb.js`,
`src/lib/az/commands/cosmosdb-sql.js`, `tests/az-cosmosdb.test.js`.
Modify model.js, ops.js (group deletion), commands/index.js and args.js (a new ordered-pairs
argument kind for detecting repeated Cosmos locations; existing list behavior is preserved).

Consumes existing getResourceGroup/normalizeLocation/AzError/command builders.
Produces `cosmosAccounts` nested shape, model normalization, exported `cosmosdbGroup`,
and Cosmos events as specified. Operations are pure; adapters format ARM output.

- [x] Write failing runLine tests for the sequence below and primary error/cascade cases.
- [x] Implement validation and resource operations, then command adapters and registration.
- [x] Verify policy shape/dimensions/index-path consistency, prerequisite, malformed JSON,
  defaults, name identity, idempotency, read/list/delete, cascading and immutable configuration.
- [x] Run focused tests and report RED/GREEN evidence for review.

```js
const setup = [
  'az group create -n rg-cosmos -l westeurope',
  'az cosmosdb create -g rg-cosmos -n cosmos-contoso-catalog --locations regionName=westeurope failoverPriority=0 isZoneRedundant=False',
  'az cosmosdb update -g rg-cosmos -n cosmos-contoso-catalog --capabilities EnableNoSQLVectorSearch',
  'az cosmosdb sql database create -g rg-cosmos -a cosmos-contoso-catalog -n catalog',
]
// Through runLine, each succeeds and produces a new Sandbox. Creating vector configuration
// before the capability is enabled must instead return an error and the unchanged input.
const embeddings = {vectorEmbeddings:[{path:'/embedding',dataType:'float32',dimensions:1536,distanceFunction:'cosine'}]}
const idx = {indexingMode:'consistent',automatic:true,includedPaths:[{path:'/*'}],excludedPaths:[{path:'/embedding/*'}],vectorIndexes:[{path:'/embedding',type:'diskANN'}]}
// create container with --vector-embeddings 'JSON' --idx 'JSON': output resource carries both.
```

## Task 2: Lab content, catalog and saved runs (controller)

Create `src/data/labs/cosmos-vector-search.lab.js`, `tests/cosmos-lab.test.js`.
Modify labs/index.js, tests/labs.test.js, README.md and SPEC.md. Existing normalized load
and catalog-order Next Lab logic should require no changes.

Consumes Task1 schema/commands; produces `cosmosVectorSearchLab`, five Tasks with two Hints,
Solutions and Exam Notes. Tests use actual command pipeline and Pinia lifecycle.

- [x] Write failing availability, sequential checks, near-miss and lifecycle tests.
- [x] Implement content with full ancestry and exact path checks; enable catalog entry.
- [x] Verify invalid configurations can be corrected by delete/recreate and old saves migrate.
- [x] Update current docs, including inline-JSON and configuration-only scope.

## Task 3: Cosmos read-only Blades and navigation (Sol)

Create `CosmosAccountBlade.vue`, `CosmosDatabaseBlade.vue`, `CosmosContainerBlade.vue` under
src/components/blade and `tests/cosmos-portal.test.js`. Modify BladeHost.vue,
ResourceGroupBlade.vue, bladeResolve.js and portal.js. Reuse CSS; minimal additions only if needed.

Consumes Task1 shape/events. Produces three Blade kinds and case-aware descendant resolution.
Account/group names are case insensitive; database/container names and paths are exact.

- [x] Write failing navigation/fallback/notification tests using hand-authored resource fixtures.
- [x] Implement account database list, database container list and container policy view.
- [x] Register Blades/resource rows and event focus; verify ancestor deletion and legacy fallback.
- [x] Run focused tests and report RED/GREEN plus visual implementation constraints.

## Final verification

- [x] Independent review of new Lab scope against the design, using saved prior-Lab baseline.
- [x] Resolve confirmed findings with focused regressions.
- [x] `npm.cmd test`, `npm.cmd run build`, `git diff --check`.
- [x] Browser Cloud Shell completion, error/Hint/Solution, navigation, reload, restart,
  Next Lab from Container Apps, and layouts at 1440/1280 widths.
- [x] Record final evidence in the plan-specific ignored ledger and leave changes reviewable.

Completed 2026-09-21: 220 tests passed across 27 files; production build passed (158 modules).
Final browser flow advanced 0/5 through 5/5 with no command errors; completed save reloaded,
policy Blades navigated correctly, and console had no errors or warnings. Reviewed layouts at
1440 and 1280 widths. Independent review has no unresolved required findings. Changes uncommitted.
