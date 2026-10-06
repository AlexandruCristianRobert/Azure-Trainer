# AI-200 Exam & Review local handoff — 2026-10-06

Local implementation and Task 11 release gates are complete in branch
`codex/ai200-exam-review`, worktree
`E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/ai200-exam-review`.
Task 11 base is `fbb112bb822b678006310cc006f857a5c2b9b7fa`. This is a local
review handoff. Whole-branch review and its single aggregate fix wave are complete:
the original reviewer approved all eight fixes at `42fb810`, with no new findings.
The finishing workflow awaits the user's integration choice. Nothing was merged,
pushed or published at that review handoff. See the local integration receipt below.
The approved design remains intact; only its implementation-status paragraph changed.

## Release contract and learner documentation

[Simulator guide](../../exam-review-simulator.md) documents all eight formats:
single choice, multiple response, build list, matching, dropdown, statement grid,
hot area and active screen, with keyboard alternatives and component/exact-set
credit. Cases and series are grouping rules, not extra formats or extra questions.
The bank contains 120 items, 27 objectives, 27 concepts, six three-item cases and
two three-item series; domain totals 27/33/30/30 and format totals
24/20/16/16/16/12/8/8. There are 69 families (26/20/13/10), and 12 concepts have
sparse authored availability; this is not learner weakness evidence.

Study defaults to 10 untimed items; Submit seals, Reveal records assistance even
before a completed attempt. Mock defaults to 50 items/100 minutes; options are
40/50/60 and 60/100/120 minutes, with all formats, two complete cases and one
complete series. Section continuation locks prior sections; series Next locks
each item. Breaks seal seen items and keep the deadline running through Home or
browser closure. Feedback/Study/Review remain blocked until durable Mock finish.
The configurable 80% practice goal is self-set, not a 700 scaled score, official
pass threshold, mastery or readiness prediction.

History retains frozen keys; unknown historical IDs stay unmapped. Repeats,
assistance, omissions and confidence are separate from eligible knowledge evidence:
at least three distinct families, latest at most six. App Service and deeper ACR
Tasks receive honest documentation-only recommendations without fabricated Labs.
Lab catalog/history is read-only. Copy concept prompt uses canonical authored
context only; notes/history/Sandbox data are excluded and nothing goes to GPT
or another assistant automatically.

Separate local IndexedDB `azure-trainer-exam` saves only on acknowledgment. Browser
loss/private sessions/data clearing/different origins isolate or lose data;
normal explicit export/import is the bridge. Unencrypted backups and recovery
files contain personal notes/answers. Normal backup input stays 32 MiB, stored
exam data 24 MiB, completed attempts 200, and the whole UTF-8 serialized note
8 KiB. Recovery is a DIFFERENT non-importable format: finite bounded snapshot+
pending queue admission at 96 MiB with a 64 KiB metadata/error reserve; it does
not enlarge ordinary backup/storage limits. Retry requires unchanged revisions;
reload with pending data requires explicit discard. No silent eviction/fallback.

Content is original practice, not confidential/live exam material. References
were reviewed 2026-10-06 and can become stale. Approved HTTPS hosts are
learn.microsoft.com, opentelemetry.io, postgresql.org, www.postgresql.org and
redis.io; GitHub paths are limited to Azure/azure-sdk-for-python,
Azure/azure-rest-api-specs, open-telemetry/opentelemetry-python, pgvector/pgvector
and dotnet/docs. Exact reviewed paths are in the bank catalog/domain ledgers.
There is no runtime source fetch, real cloud execution, Python process or AI backend.

## Actual independent gates

All gates below were closed on 2026-10-06 by their original reviewer seats. The
four bank gates include factual/editorial reviews as well as spec/quality checks;
structural validation alone was never their source-approval evidence.

| Scope | Final content HEAD | Original independent reviewer / verdict |
| --- | --- | --- |
| Containers, all 27 | d4dfe6b | /root/exam_bank_containers_review — Approved, family fix closed |
| Data, all 33 | c5d24d6 | /root/exam_bank_data_review — Approved, family merge closed |
| Connect, all 30 | 947c2e2 | /root/exam_bank_connect_review — Approved, x019/x027 clarified |
| Secure, all 30 + full 120 assembly | 3d8afef | /root/exam_bank_secure_review — Approved, no findings |
| Widgets + shared validateGrade | 290587e | /root/exam_widgets_review — Approved, shared validation/disclosure fixes closed |
| App integration | fbb112b | /root/exam_app_integration_review — Approved, all three Important/two Minor findings closed |

[Coverage](../../exam/bank-coverage.md) records exact full bank commit SHAs.
Historical pending rows remain preserved, with explicit final notes closing them.
The controller progress ledger records review rulings and original source timings:
containers ~18.001 s, data ~15 s, Connect 14.181 s, Secure ~16.8 s for independent
source batches (plus documented reads). No second source fleet was dispatched.
Family overlap corrections prevent equivalent widgets multiplying evidence;
creation-only Study preferred IDs preserve frozen settings/group validation;
hot-area geometry/order remains authored; disclosure refresh revokes ephemeral
grants; recovery admission is distinct from normal persistence limits.

## Bounded final verification

| Command, run once | Result | Stopwatch wall |
| --- | --- | ---: |
| npm run test:exam-review | 7 files, 235/235 tests, exit 0 | 24.1897078 s |
| npx vitest run tests/progress-store.test.js tests/behavioral-store.test.js tests/http-functions-catalog.test.js | 3 files, 29/29 tests, exit 0 | 3.6702207 s |
| npm run build -- --base=/Azure-Trainer/ | 707 modules; exit 0 | 6.2109949 s |

Windows execution used npm.cmd/npx.cmd with the same exact arguments. Task 11
test total is 27.8599285 s; tests+build total is 34.0709234 s, with no failed or
repeated gate. The controller's approximately 10-minute preceding owner-test
budget plus this gate remains below the 30-minute per-publication threshold;
individual all-attempt totals stay in the owner reports (Task 10: 293.595 s).
The exact seven-file package script runs normally in Pages CI before the existing
build; other workflow checks and user checkpoints were preserved. No broad,
AKS/Container Apps, cloud, Python or browser suite was run.

Build warning remains visible: chunks exceed 500 kB, with largest
`index-JPxyke46.js` 3,010.86 kB (gzip 828.94 kB). No warning threshold or dependencies
were changed. Test-only jsdom 26.1.0 and fake-indexeddb 6.2.5 maintain Node >=18;
CI is Node 22. Earlier npm install reported seven vulnerabilities (3 moderate,
2 high, 2 critical) and whatwg-encoding deprecation, without attribution to those
test tools or a force audit upgrade.

Read-only static relative import/export traversal visited 445 files from main.js,
excluding dynamic imports, and found zero exam modules in the initial graph.
Runtime route assertions verify all five canonical lazy entry points; existing
bank assertions and new release assertions cover allocations/groups/mappings.

## Aggregate final-review fixes

The local fix wave after `4396576` addresses all five Important and three Minor
findings from the single whole-branch review. Mock seal/break/manual-finish controls
now require action-specific confirmation after pending answers save; cancel does
not mutate the session, and deadline finalization remains immediate and idempotent.
Setup and targeted practice preview exact counts and allocated points before
start. Study question notes use the existing bounded separate note queue, with
identity-bound acknowledgment and explicit unsaved status for newer edits.
Result shows frozen case/series context and recomputed domain/format totals,
including unmapped historical domains. Failed repository opens can retry, Review
snoozes wake on time/visibility, and the exam-owned read-only Lab bridge aborts
creation/upgrade races without touching the old Lab repository or schema.

The controller approved transient `previewStart(options)` / `startPreview(preview,
{allowShorter})` methods. The public frozen preview is only `{mode, requestedSize,
available, actualSize, points, requiresConsent}`; private prepared settings retain
the same seed, bank and revision. No session, exposure, deadline or UUID is created
by preparation. Start rejects a stale/consumed preview, checks access, validates
before its own preference write, and uses the existing queued start. Persisted
DTOs and frozen Settings are unchanged.

Fresh amended-file gate: app 41, widgets 31, persistence 26, **98/98 passed**,
28.446 s. Self-review then caught and regression-tested the newer-note-draft ACK
message; final app owning-file run is **42/42 passed**, 28.646 s. Widgets and
persistence had no changes after their passing gate. Final changed-tree command
`npm.cmd run build -- --base=/Azure-Trainer/` passed, 709 modules, 6.002 s.
All fix-wave test attempts, including RED and failed first GREEN, total 116.980 s;
two builds total 12.022 s (the second followed the actual note amendment).
The prior seven-file/compatibility/build receipts above remain historical evidence;
they were not rerun. No factual-bank content changed and no source fleet ran.

The retained warning is still chunks over 500 kB; final largest
`index-BHT47163.js` is 3,010.59 kB (gzip 828.84 kB). No dependency/audit scope
changed. Full command outputs, every failed attempt, timing, sessions and per-finding
disposition are in `.superpowers/sdd/2026-10-06-ai200-exam-review/final-fix-report.md`
and its adjacent `final-fix-*.log` files. The controller's original final-review
seat owns the scoped follow-up; this report does not assert merge/publication readiness.

## Remaining verification limits after the fixes

Native IndexedDB and actual small-viewport/keyboard-focus behavior are NOT RUN:
IAB was unavailable and Chrome helper failed with missing app-server executable
(OS error 3) before opening any tab. No test DB was created; the owned dev server
was closed. Unit fake-indexeddb/Vue DOM tests are not native substitutes.
The ready harness uses a unique synthetic azure-trainer-exam-smoke-<UUID> DB and
never opens/deletes the user's default Exam/Lab data. Later, with a working helper:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5187 --strictPort
```

Open http://127.0.0.1:5187/tests/browser/exam-persistence.html. Authoritative attempt
record: `.superpowers/sdd/2026-10-06-ai200-exam-review/controller-native-smoke.md`.
Task 10 continued run 1 is abridged and run 12 has truncated historical raw output;
all timing/final/R1 outputs are retained. No reruns regenerated missing history.
Task 11 report retains its exact gates, raw outputs/session exits, reads/self-review
and scoped commit; no native/tool repair or remote action was attempted.

## Local integration receipt — 2026-10-06

User selected local merge (option 1). `git pull --ff-only` was already up to date;
`git merge --ff-only codex/ai200-exam-review` advanced `main` from `10b44f2` to
`9c3df5b` without conflicts. No push, PR or publication was performed.

Fresh merged-tree verification:

- `npm.cmd run test:exam-review`: 7 files, **252/252**, exit 0, 43.940 seconds.
- Three named compatibility files: **29/29**, exit 0, 4.456 seconds.
- Pages-base production build: **709 modules**, exit 0, 7.603 seconds.

Only these bounded tests ran; no AKS/Container Apps or full suite. Build retains
the >500 kB chunk warning (largest 3,010.39 kB). Native browser verification is
still NOT RUN. Overall test cost remains below 30 minutes.

Initial `npm ci` failed because the project's running Vite/esbuild service locked
`node_modules/@esbuild/win32-x64/esbuild.exe`. Exact project process identities
were checked; only that service was stopped. A second `npm ci` succeeded; existing
seven dependency advisories remain. The project dev server was restarted on its
original port 5175. No permission/security settings or unrelated processes changed.

The feature worktree/branch and ignored review evidence are deliberately preserved
to avoid deleting the only copies of detailed reports, rulings and raw receipts.
The unrelated untracked `RESUME-HTTP-FUNCTIONS.md` checkpoint remains untouched.
