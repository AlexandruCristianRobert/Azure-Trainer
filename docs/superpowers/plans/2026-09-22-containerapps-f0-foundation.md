# Container Apps F0 Foundation Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development task by task. User override: implementers are Sol or Terra; the primary Astra agent performs spec and code-quality reviews. Do not delegate reviews or start F1.

**Goal:** Deliver the smallest tested run/evidence/persistence foundation for future behavioral Labs, without adding a playable Lab or changing current Lab outcomes.

**Architecture:** Pure run/schema and evidence/evaluation modules, a native IndexedDB repository, and a headless session coordinator. Adapt the two existing legacy Task-count consumers to the common evaluator; new behavioral UI belongs to F1/Lab 1.

**Tech Stack:** Existing JavaScript/Vue/Pinia/Vitest; native IndexedDB verified in a real browser. No new npm dependencies.

**Spec:** [Technical design](../specs/2026-09-22-containerapps-learning-journeys-technical-design.md), sections 3-4, 10-11, 13-14; [ADR-0002](../../adr/0002-behavioral-labs-with-bounded-local-simulation.md).

## Global constraints

- Implement F0 only; no editor, C# parser, registry resources, CPU/probe/Foundry/Bicep simulation, public Lab, or broad legacy migration.
- One Lab at a time, prerequisite increment first. Task order below is sequential with Astra review after each.
- Work in `E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/aca-f0`, which contains a copy of the current dirty working tree. Preserve all copied baseline changes. Do not stage or commit those unrelated changes.
- Tests first, observe expected failure, implement, run focused tests. Root performs full suite/build once after integration and meaningful follow-up after any changes.
- Native IndexedDB, no fake persistence that merely tests a mock. Browser harness is internal test content, not a new public Lab.
- Retain existing `check(sandbox)` and string Solutions. Missing `engineVersion` means legacy; unsupported explicit engine versions are errors.
- JSON data is finite and plain; prevent cross-attempt/cross-Lab evidence, silent resets, and fabricated completion.
- Source must be dependency-free except existing project imports. Typed errors use a small `LabEngineError` with stable `code`.

## Task 1: Pure run, evidence, and evaluator contracts

**Files:** Create `src/lib/labEngine/{errors,run,migrations,evidence,evaluate}.js`, `tests/lab-engine-core.test.js`, and `tests/helpers/behavioralLab.js`.

**Interfaces:**

```js
new LabEngineError(code, message, details = {})
createBehavioralRun(lab, { attemptId }) // complete schemaVersion 2, revision 0 envelope
validateBehavioralRun(run, lab = null) // throws; returns run when valid, no mutation
migrateBehavioralRun(raw, lab) // cloned compatible run; no silent reset
canonicalize(value) // deterministic JSON string; object keys sorted, arrays ordered
bumpDependency(run, key) // immutable generation increment, never alters Sandbox
recordVerification(run, lab, taskId, result) // immutable evidence append
evaluateLab(lab, run) // { tasks, doneCount, total, isComplete }
```

Each returned Task has its original fields plus `index`, `done`, `status`, `reason`, `evidenceIds`. Legacy evaluation calls `task.check(run.sandbox)` and needs no version-2 envelope. New Tasks use `task.check(context)`, optional `dependencies: { key: context => JSON value }`, and optional `verification: { scenarioId, scenarioVersion }`. `context` is the run's sandbox/project/artifacts/runtime/evidence/stages. Scope F0 to live verification; stage sealing is capstone work.

New runs contain schema/content/attempt IDs, revision, nextSequence, normalized seeded Sandbox, empty project/artifact/runtime/evidence/stage containers matching the technical design, and legacy-compatible history/help/time/result fields. Add `dependencyGenerations` as a dictionary and stable `revision`. A Lab declares positive integer `contentVersion`, `engineVersion: 2`, ID, tasks, optional resource seed and initial project files. Require explicit nonempty attempt IDs (session will generate them). Use no wall-clock values in correctness calculations.

Evidence stores Lab/attempt/content/Task/scenario identities, the declared dependency values AND generations, start/end simulated time, completed outcome, and measurements. `recordVerification` validates the Task's declared scenario identity/version, result `outcome` (`passed`, `failed`, `cancelled`), boolean `completed`, finite ordered nonnegative times, and plain finite measurements. Only `completed: true, outcome: 'passed'` can count. History persists failed/cancelled attempts; a latest failed attempt cannot be hidden by an older success. Never allow arbitrary record fields to overwrite identity or dependency fields. Validate new records before mutation.

`evaluateLab` requires the latest matching Task evidence to belong to this run/content/scenario and match both dependency values and generations, as well as a currently true Task predicate. Prior success followed by changed dependencies or failed/incomplete verification shows `needs-verification`; a never-passed Task stays `pending`. Unrelated changes do not invalidate evidence. Changing a dependency away and back with two `bumpDependency` calls remains stale. Malformed persisted evidence must not award credit. Predicate-only Tasks pass on their current predicate.

Validation covers the envelope, required nested plain objects/arrays and finite counters, unique sequence/evidence IDs, identity relations, complete/incomplete result consistency, and serialization safety (no functions, cycles, dates, nonfinite numbers, prototypes). Preserve extra supported JSON fields for future capabilities; do not accept unsupported schema/content versions. Errors: `INVALID_RUN`, `UNSUPPORTED_SCHEMA`, `INCOMPATIBLE_CONTENT`, `INVALID_LAB`, `INVALID_EVIDENCE`, `UNSUPPORTED_ENGINE`. `migrateBehavioralRun` currently supports version 2 only and throws with the raw record attached in `details.raw` on incompatible records for export; it must never replace them with a new run.

- [x] Write core tests and run `npm.cmd test -- tests/lab-engine-core.test.js` before implementation; missing module is the expected initial red.
- [x] Implement minimal pure modules and the shared fixture.
- [x] Exercise this concrete flow and its negative variants:

```js
const lab = behavioralLab()
let run = createBehavioralRun(lab, { attemptId: 'attempt-1' })
expect(evaluateLab(lab, run).isComplete).toBe(false)
run = recordVerification(run, lab, 'request', {
  scenarioId: 'healthy-request', scenarioVersion: 1,
  completed: true, outcome: 'passed', startedAtMs: 0, endedAtMs: 1000,
  measurements: { status: 200 },
})
expect(evaluateLab(lab, run).tasks[0].status).toBe('done')
const changed = bumpDependency(run, 'application')
expect(evaluateLab(lab, changed).tasks[0].status).toBe('needs-verification')
expect(evaluateLab(lab, run).tasks[0].status).toBe('done')
```

- [x] Cover independent run seeding, legacy evaluation, wrong identities, incomplete/cancelled/failed evidence, property order equivalence, invalid persisted shapes, incompatible versions, unchanged/unrelated inputs, and source-object immutability.
- [x] Report red/green commands and changed files. Astra reviews before Task 2 consumes interfaces.

## Task 2: Native IndexedDB repository

**Files:** Create `src/lib/labEngine/persistence.js`, `tests/browser/f0-persistence.html`, `tests/browser/f0-persistence.browser.js`; extend only Task-1 modules if a reviewed defect requires it.

**Consumes:** `LabEngineError`, `validateBehavioralRun`, `canonicalize` from Task 1.

**Produces:**

```js
createBehavioralRepository({ indexedDB = globalThis.indexedDB, dbName = 'azure-trainer-behavioral' } = {})
// object methods, promises except close:
loadRun(labId) // raw clone or null; never resets an incompatible record
listRuns()
listResults()
saveRun(run, { expectedRevision }) // clone with revision incremented
completeRun(run, result, { expectedRevision }) // atomic run + immutable result
close()
```

Database version 1 has `runs` keyPath `labId` and `results` keyPath `id`. New run save requires expectedRevision 0 and no existing record. Later saves compare stored revision inside the same readwrite transaction and increment it. `run.revision` must equal expectedRevision. No last-write-wins. Reject `REVISION_CONFLICT` with actual revision; abort the transaction. Do not mutate caller data.

`completeRun` requires matching Lab/attempt/result IDs, a completed run, and a result record with finite task counts and assistance counts. Store run/result atomically; guard results against replacement. Retrying the same completion for the same current attempt/result and identical result payload returns existing saved run without duplicating/incrementing. Reusing a result ID for changed content throws `RESULT_CONFLICT`; completing a stale attempt after restart throws `REVISION_CONFLICT` and cannot resurrect it. Ordinary `saveRun` cannot uncomplete or replace a completed attempt with the same attempt ID; an explicit new attempt can replace the run using the current stored revision, while prior results remain.

Expose `STORAGE_UNAVAILABLE`, `STORAGE_BLOCKED`, `STORAGE_FAILED` and causal details. Reject on transaction abort/error (including injected request failure), not just request error; resolve writes only on transaction completion. Close on versionchange. Do not call localStorage. No unhandled promise rejections if open is denied or a transaction aborts. All normal saves must also preserve immutable completion rules.

- [x] Write browser assertions before the repository exists. Harness exports `runPersistenceChecks()` and prints a structured `{ passed, failed, cases }` result into the page; each run uses a unique test database and closes/deletes only that database in `finally`.
- [x] Run the harness in a real browser and capture the expected missing-module red result.
- [x] Implement repository, then rerun harness using real IndexedDB. Cases: create/load, update, two concurrent CAS writes (exactly one succeeds), clone isolation, run/result atomicity, repeated completion, modified-result collision, stale completed attempt after restart, unsupported raw record preservation, unavailable storage, and injected transaction abort with no partial data.
- [x] Native unavailable/abort edge cases may use narrow injected factories; successful reads/writes and concurrency must use actual IndexedDB.
- [x] Report browser result and paths for Astra review.

## Task 3: Session lifecycle and legacy consumers

**Files:** Create `src/lib/labEngine/session.js`, `tests/lab-engine-session.test.js`; modify `src/stores/labRun.js`, `src/stores/progress.js` narrowly; add assertions in their current suites as needed. Do not activate engine-2 Labs or add UI controls in F0.

**Consumes:** Tasks 1-2 interfaces. **Produces:**

```js
createBehavioralSession({ lab, repository, reduce, createAttemptId })
// snapshot(): cloned { run, generation, busy, readOnly, error }
// load(), restart(), dispatch(action), complete(result): promises
```

`reduce(run, action)` is an injected pure/async next-run function for future capabilities, not arbitrary user code. F0 tests use a tiny internal action fixture. Session owns generation invalidation, serialization, current revision, and error reporting. `load` validates/migrates persisted data or creates a new run only if absent. A new read-only completed run can be inspected; dispatch cannot mutate it. Restart creates a new attempt and preserves previous results. CAS conflict makes the current session read-only until reload. Storage failure retains the unsaved candidate in memory and exposes it for export via snapshot; never reports the failed operation saved.

Reject concurrent dispatch with `BUSY`; allow navigation/restart/load to invalidate a delayed reducer. Late reducer results must not mutate or save a newer attempt. If a write is already in flight, lifecycle replacement must wait for its transaction outcome before determining the next expected revision; invalidate its UI completion, then load current persisted revision before saving a new attempt. A failed lifecycle load must never leave an incompatible record overwritten. An errored command cannot accidentally create completion evidence.

Completion evaluates `evaluateLab` first and refuses incomplete runs (`LAB_INCOMPLETE`), then forms/matches a completed run and calls atomic `completeRun`. Validate caller result metadata; persist assistance and Task totals derived from evaluation rather than trusting fake totals. Generation guard applies to completion too. Completed Results are immutable; subsequent practice requires restart.

Update the legacy `taskStates` getter and `progress.runSummary` to use the shared evaluator's legacy adapter without changing their public return shapes or storage format. Keep all existing tests and results. Behavioral session is headless until the first new Lab consumes it; document that boundary rather than wiring unfinished UI.

- [x] Write failing focused tests for load/create/resume, failed/incompatible loads, completed read-only state, restart, concurrent dispatch, stale delayed reducer, storage conflict/failure, and completion guard/metadata.
- [x] Implement the coordinator and the two narrow adapters.
- [x] Run `npm.cmd test -- tests/lab-engine-session.test.js tests/lab-run-store.test.js tests/progress-store.test.js`.
- [x] Add a browser session smoke case using the real repository to the internal harness, including reload/resume and new-attempt completion preservation.
- [x] Astra reviews the whole F0 diff; fix issues through the original implementer.

## Final verification and delivery

- [x] Run the full suite and production build in the isolated worktree; real-browser repository/session harness passes and has no console errors.
- [x] Review only new F0 files and narrow adapters against the copied baseline, not unrelated existing work.
- [x] Copy reviewed F0 files and exact adapter/document changes into the original workspace only after checking those targets have not changed since the baseline. Preserve every unrelated user change.
- [x] Re-run focused integration tests and build at the delivery location if path/integration changes justify it.
- [x] Record completion and test evidence; leave F1 and every public Lab unimplemented.

## Preflight decisions

- User specifically reserves review for the primary Astra agent, overriding the skill's separate-reviewer-agent default.
- Current main checkout contains substantial unrelated changes. Worktree is an isolated copy of that state, not a clean-HEAD replacement. No broad commits or merges; deliver only reviewed F0 edits.
- Native browser persistence tests avoid adding a fake IndexedDB dependency and verify real transaction semantics.
## Completion evidence (2026-09-22)

F0 is complete and delivered to the main workspace. Sol/Terra implementation and primary review covered the three tasks and the final four-finding fix wave. The foundation remains internal; F1 and every new public Lab are deferred, preserving the agreed one-Lab-at-a-time sequence.

- Isolated worktree: 250/250 unit tests across 29 files; production build passed.
- Native browser harness: 16/16 persistence/session cases passed; no console warnings or errors.
- Main workspace: 250/250 unit tests across 29 files; production build passed after delivery.
- Main-workspace command: `npm.cmd test -- --exclude '**/.superpowers/**'`. The exclusion avoids counting tests again inside the retained review worktree; the unfiltered run also passed (500 assertions across both copies).
- Seventeen implementation, test, and README files were copied only after original-file guards passed, then hash-verified. This plan records the final delivery separately. Existing unrelated changes were preserved.
- Review worktree and detailed reports remain under `.superpowers/worktrees/aca-f0/.superpowers/sdd/2026-09-22-containerapps-f0-foundation/`. No files were staged or committed. The task-owned Vite server and browser were stopped.
