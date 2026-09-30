# Event Grid filtered subscription implementation plan

Use superpowers:subagent-driven-development. Continue the approved catalog expansion.
Spec: `docs/superpowers/specs/2026-09-22-eventgrid-filtered-subscription-design.md`.
Architecture: nested topic resources, pure Sandbox operations, CLI adapters, read-only Blades.
Stack: existing Vue/Pinia/JavaScript; no new dependencies.

## Global constraints

Preserve prior uncommitted work in current checkout; no commits/worktrees/git metadata writes.
No tests added or run. Update only the existing catalog expectation. Static review and build.
Follow CONTEXT.md and frozen spec. No network effects, real endpoints, publishing or delivery.
Sol/Terra workers use disjoint files, no nested agents; independent review before delivery.

## Task 1: Engine and adapters (Terra)

Own new sandbox/eventgrid.js, sandbox/eventgrid-validation.js, az/eventgrid-arm.js, commands/eventgrid.js;
modify sandbox/model.js, sandbox/ops.js, az/args.js and commands/index.js.

- [x] Implement schema, legacy normalization, nested shape guards and lifecycle/filter operations.
- [x] Register documented commands, help, presenters and identity-only events.
- [x] Statically trace Solutions and failure atomicity; report in task-1-report.md.

## Task 2: Content and documentation (controller)

Own new data/labs/eventgrid-filtered-subscription.lab.js, labs/index.js, README.md,
SPEC.md and existing tests/labs.test.js catalog expectation.

- [x] Five Tasks, exact grading, two Hints each, Solutions and Exam Notes.
- [x] Enable sixth Lab, update supported subset and simulation limits.

## Task 3: Read-only Blades (Sol)

Own new EventGridTopicBlade.vue and EventGridSubscriptionBlade.vue;
modify BladeHost.vue, ResourceGroupBlade.vue, bladeResolve.js, stores/portal.js,
and targeted components.css additions if required.

- [x] Topic/subscription views, breadcrumbs, group rows and wrapping.
- [x] Event focus, notifications and nearest-parent deletion/stale fallback.
- [x] Self-review with task-3-report.md.

## Review and delivery

- [x] Independent spec and quality review; address material findings and re-review fixes.
- [x] Production build and whitespace checks; record limitations honestly.
- [x] Mark plan/ledger complete, preserve uncommitted changes.
