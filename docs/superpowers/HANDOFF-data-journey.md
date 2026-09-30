# Data journey — handoff

Branch: `data-journey` (pushed to origin). Pull it on another machine with `git fetch && git checkout data-journey`.

## Where things stand

- Design/spec: `docs/superpowers/specs/2026-09-30-data-learning-journey-discussion.md` (all decisions settled).
- ADR: `docs/adr/0003-shared-sdk-call-catalog-for-data-labs.md`.
- Plan for Labs 1–4 (Cosmos): written, `docs/superpowers/plans/2026-10-01-data-labs-01-04.md`.
- Implementation: Labs 1–4 in progress (see Log).

## Testing rules (from the learner — must be followed)

- Do not run the existing test suite (`npm test` / `vitest run` without a path).
- Keep tests light: only a few focused tests on shared core logic; run them by explicit path.
- A Lab is verified by `npm run build` plus one manual walk-through.

## How to continue

Open Claude Code on this branch and say: "continue the data journey from docs/superpowers/HANDOFF-data-journey.md". Execution method: superpowers subagent-driven-development with Sonnet subagents.

## Log

- 2026-10-01 00:14 — design docs committed and pushed; started the Labs 1–4 plan.
- 2026-10-01 00:23 — Labs 1–4 plan written (docs/superpowers/plans/2026-10-01-data-labs-01-04.md); starting subagent-driven execution at Task 1.
- 2026-10-01 00:30 — Task 1 (fixtures) complete: c81074c.
- 2026-10-01 00:48 — Task 2 (Cosmos data plane) complete: 6913157. Task 3 (query evaluator) in progress.
