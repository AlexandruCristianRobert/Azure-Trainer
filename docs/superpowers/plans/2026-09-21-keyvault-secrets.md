# Key Vault Secrets Lab Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Track steps with checkboxes.

**Goal:** Make the fourth Lab playable, including secret version rotation and vault-scoped RBAC.
**Architecture:** Add nested Key Vault resources, command adapters and two read-only Blades;
reuse the existing catalog, Lab state/persistence and completion navigation.
**Tech Stack:** Vue 3, Pinia, JavaScript, Vite and plain CSS; no new dependencies.
**Spec:** `docs/superpowers/specs/2026-09-21-keyvault-secrets-design.md`

## Global constraints

- Preserve all previous uncommitted changes. Current checkout, no commits/worktrees/git edits.
- Follow CONTEXT.md terminology, existing pure Sandbox operations and event conventions.
- Exact schema, principal, Tasks and command boundaries are in the spec.
- Current session instructions prohibit adding or running tests; update only the existing
  catalog expectation. Review code and run a production build. Do not claim test results.
- No real Azure/account access or secret material; values in this Lab are public demo strings.
- Use Sol/Terra agents for scoped work, no nested agents, disjoint file ownership.

## Task 1: Key Vault engine (Terra)

Create `src/lib/sandbox/keyvault.js`, `keyvault-rbac.js` if useful,
`src/lib/az/keyvault-arm.js`, `src/lib/az/commands/keyvault.js`, `keyvault-secret.js`,
`role.js`. Modify sandbox/model.js, sandbox/ops.js (group cascade), commands/index.js.

- [x] Implement vault, role and version models, legacy normalization and nested shape guards.
- [x] Implement pure operations with names/scopes/permissions/immutability validated first.
- [x] Add command descriptors, help, ARM/data-plane output and registered command groups.
- [x] Trace the five Solutions and errors by source inspection; write task-1-report.md.

## Task 2: Content and current docs (controller)

Create `src/data/labs/keyvault-secrets.lab.js`; modify labs/index.js, README, SPEC and only
the existing catalog expectation in tests/labs.test.js.

- [x] Implement five Tasks, two Hints each, Solutions and Exam Notes.
- [x] Grade full ancestry, exact role/principal, retained initial version and enabled latest rotation.
- [x] Enable catalog entry and document supported commands, manual rotation and simulation limits.

## Task 3: Read-only Blades (Sol)

Create `KeyVaultBlade.vue`, `KeyVaultSecretBlade.vue` in src/components/blade.
Modify BladeHost.vue, ResourceGroupBlade.vue, lib/bladeResolve.js and stores/portal.js.

- [x] Render vault Essentials, assignments and metadata-only secret list with access guard.
- [x] Render secret versions and latest status with no values; protect direct navigation too.
- [x] Add resource rows, breadcrumbs, event focus and nearest-parent fallback.
- [x] Reuse CSS/components and write task-3-report.md.

## Final review and delivery

- [x] Independently review spec compliance and quality against the saved pre-Key-Vault baseline.
- [x] Resolve required findings and review the correction scope.
- [x] Production build and git diff whitespace checks; inspect Home/Lab layout visually.
- [x] Record outcomes and limits, mark plan complete, leave uncommitted work reviewable.
