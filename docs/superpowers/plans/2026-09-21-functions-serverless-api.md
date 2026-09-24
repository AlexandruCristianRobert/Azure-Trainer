# Functions Serverless API Lab Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Track steps with checkboxes.

**Goal:** Make the fifth catalog Lab playable with storage, Flex Consumption, settings and CORS.
**Architecture:** Two flat resource collections, pure operations, CLI adapters and read-only Blades.
**Tech Stack:** Vue 3, Pinia, JavaScript, Vite, plain CSS. No new dependencies.
**Spec:** `docs/superpowers/specs/2026-09-21-functions-serverless-api-design.md`

## Global constraints

- Preserve earlier uncommitted Labs in this checkout; no commits/worktrees/git metadata writes.
- Follow CONTEXT.md and frozen spec schema, events and canonical Solutions.
- No tests added or run. Existing catalog expectation may be updated. Report that limit.
- No real Azure, function execution, deployment, credentials or live endpoint claims.
- Sol/Terra work on disjoint files, no nested agents. Independent review before delivery.

## Task 1: Engine and adapters (Terra)

Create sandbox/functions.js, az/functions-arm.js, commands/storage.js and commands/functionapp.js.
Modify sandbox/model.js, sandbox/ops.js, az/args.js and commands/index.js.

- [x] Implement stable resource schema and legacy normalization, semantic saved-shape guards.
- [x] Implement storage and Function App lifecycle, settings/CORS atomic operations and group cascade.
- [x] Add raw string-list argument support without altering existing list/pairs semantics.
- [x] Implement/register commands, real flag spellings, output redaction, help and identity-only events.
- [x] Trace canonical Solutions and failure paths by inspection; write task-1-report.md.

## Task 2: Lab content and current docs (controller)

Create data/labs/functions-serverless-api.lab.js. Modify labs/index.js, README, SPEC,
existing tests/labs.test.js catalog expectation and targeted global CSS if needed.

- [x] Add five Tasks with two Hints each, Solutions and Exam Notes.
- [x] Grade exact hosting/runtime/storage ancestry, custom setting and exact CORS policy.
- [x] Enable catalog entry; update README/SPEC for supported subset and simulation limits.

## Task 3: Read-only Blades (Sol)

Create StorageAccountBlade.vue and FunctionAppBlade.vue. Modify BladeHost.vue,
ResourceGroupBlade.vue, lib/bladeResolve.js and stores/portal.js.

- [x] Render storage configuration and linked apps using the frozen schema.
- [x] Render app hosting/runtime, storage breadcrumb/link, settings names and CORS.
- [x] Wire event focus, deletion fallback and resource-group rows; preserve existing behavior.
- [x] Reuse existing components/styles; write task-3-report.md.

## Review and delivery

- [x] Independently review each implementation scope against baseline snapshots and spec.
- [x] Resolve required findings and review the correction diff.
- [x] Run production build and whitespace checks; record exact scope and limits.
- [x] Update ledger/plan and leave changes uncommitted for review.
