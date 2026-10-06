# Exam & Review simulator

This browser-only area contains original AI-200 practice, with no real Azure,
Python execution, AI backend, account, cloud sync or telemetry upload. It does
not reproduce a live/confidential exam or Microsoft's proprietary scaled score.
Open Exam & Review from Home/header. Production hash routes are `/exam`,
`/exam/session/:sessionId`, `/exam/results/:attemptId`, `/review` and
`/review/history`; pages, widgets and bank load lazily. Existing Labs remain
separate; recommendations read their catalog/progress without granting completion.

## Modes, locks and time

Study defaults to 10 questions, with 5/10/20 requested sizes and topic/format
filters. It has no countdown. If a filtered deck is shorter, accept the explicitly
shown shorter deck before starting. Drafts save continuously; Submit seals the
answer and permits feedback. Reveal before answering records assistance, including
in an unfinished Study, and cannot become fresh evidence on a later retry.
Returning to unsubmitted items and flagging are allowed; retries create new
exposures. Feedback includes component credit, reasons, reviewed references and
an optional authored C# comparison rendered as text.

Use Prepare Study or Prepare Mock to inspect requested, available and selected
item counts and allocated practice points before starting. Preparation does not
start a timer or save a session; Start uses that prepared seed and settings.
Changing filters or settings clears the preview. Targeted concept practice uses
the same preview and requires explicit consent when fewer than five items match.
Study has a personal question-note editor beside each item. Save question note
acknowledges the separate note; reopening that question restores it.

Mock defaults to 50 questions and 100 minutes; choose 40/50/60 questions and
60/100/120 minutes. Domain quotas, in containers/data/connect/secure order, are
40:[9,11,10,10],50:[12,14,12,12],60:[14,16,15,15]. Each seeded draw includes all
eight formats, two complete distinct three-question cases and one complete
three-question series, without duplicates or silently relaxed quotas. The 50-item
deck has 41 standalone items plus 9 grouped members. These are trainer settings,
not a prediction of booked exam length or format.

Sections run standalone, case 1, case 2, then no-return series. Previous/Next and
the review grid work within an unsealed reviewable section. Continue section
warns about omissions and seals that section permanently. Each series Next seals
its item; there is no back or review within the series. Case background remains
available throughout its section. A confirmed break seals seen items in the
current reviewable section; unseen items remain reachable. No break is allowed
inside the series. The absolute deadline continues through breaks, Home, other
tabs and browser closure. Greatest observed time is retained if the clock moves
backward, but local time is not tamper-proof. Microsoft Learn opens its official
home in another tab with the timer running; no item-specific sources appear mid-Mock.

Mock withholds correctness, reasons and review advice until durable finish and
blocks Study/Review/results while active, on break or expired but not durably
finished. A saved Study survives that restriction. Submit early confirms omissions;
expiry freezes input and finalizes acknowledged answers once, after queued edits
observed before the deadline. Pending transitions disable edits. Save errors
freeze the operation and expose recovery choices instead of claiming a saved
cursor or score. Finishing is idempotent; sealed answers never reopen for editing.
Seal section, Take break and manual Finish session each show an explicit
confirmation with current action-specific unanswered/incomplete item counts.
Cancel leaves the session unchanged. Deadline finalization needs no confirmation.

## All eight formats and practice points

| Format | Input and credit |
| --- | --- |
| Single choice | One labelled radio choice; exact answer earns one point. |
| Multiple response | Stated chooseN/select-all set; one exact-set component, no credit for selecting everything. |
| Build list | Select and order required actions with unused distractors; one component per fixed position. Select/assign/remove/move buttons work by keyboard as well as drag/drop. |
| Matching | Assign candidates to fixed labelled targets; one component per target; reuse policy is explicit. Select/assign/remove alternatives accompany drag/drop. |
| Dropdown | Fill named text/code/config blanks; one component per blank; unset remains unanswered. |
| Statement grid | Labelled yes/no rows; one component per statement. |
| Hot area | Select authored semantic regions using labelled buttons or the equivalent textual checkbox list; exact region set earns credit, independent of viewport pixels. |
| Active screen | Set labelled configuration fields; one component per field; no correct default selection. |

Candidates use stable IDs. Their persisted display order survives reload; slots,
rows and fields retain authored order. Hot-area geometry and diagram/list reading
order stay authored. Each component is worth one point; missing components earn
zero, with no negative credit. Partial or excess set drafts can be saved but are
reported as incomplete. Confidence does not affect points. Results show earned/
available practice points, percentage and domain/format breakdowns. The default
80% goal is a configurable self-set study target, not Microsoft's pass threshold,
a 700 scaled score, certification, mastery or readiness prediction.
Each item displays its maximum and exact-set or separate-component scoring rule.
Saved result review includes the frozen case/series background and keeps unknown
historical domains visible in the point breakdown.

## Bank and reviewed sources

Version 1/revision 1 includes exactly 120 questions across 27 objectives and 27
concepts: containers 27, data 33, connect 30, secure 30. Format totals are 24 single,
20 multiple, 16 build, 16 matching, 16 dropdown, 12 grid, 8 hot and 8 screen. Six cases
contain 18 members; two series contain 6 members, all counted inside 120. There are
69 declared families (26/20/13/10 by domain), not 120 independent observations.
Twelve concepts have fewer than three available families; that is bank sparsity,
not a measured learner weakness. [Coverage and actual independent gates](./exam/bank-coverage.md)
record all 120 editorial/source approvals and original reviewer/commit/date evidence.

Primary references were inspected on 2026-10-06. Bank source policy allows HTTPS
`learn.microsoft.com`, `opentelemetry.io`, `postgresql.org`, `www.postgresql.org`
and `redis.io`, plus GitHub only in `Azure/azure-sdk-for-python`,
`Azure/azure-rest-api-specs`, `open-telemetry/opentelemetry-python`,
`pgvector/pgvector` and `dotnet/docs`. Credential URLs, alternate hosts and
executable URL schemes are rejected. Exact paths and review dates are in the
reference catalog/domain ledgers. No runtime source fetch or remote generation
occurs. References can change after review; frozen historical content can be stale.

## Review, notes and Lab coverage

Advice uses first unassisted graded encounters with actually attempted components,
deduplicated by family and normalized across components. At least three eligible
distinct families are required; at most the latest six contribute per concept.
Below 60% is needs review, 60–<80% developing, >=80% a stronger sampled result.
These labels do not diagnose mastery. Omissions, incomplete answers, assistance,
repeats and confidence remain separate counters. An early assisted encounter
cannot be washed away by a later familiar retry. Imported duplicates do not add
evidence. Exhausted fresh families are disclosed; targeted Study prefers suggested
unseen questions and labels additional potentially familiar fill/shortages.

Recommendations explain their evidence and link only current real Labs/Tasks,
with safe Return to review. Lab history is read-only context. Enumeration failure
or incompatible native Lab data is unavailable/error context, never fabricated
empty progress; absence does not create a Lab DB. Completed-with-Solutions Labs
can still be recommended for independent practice. App Service and deeper ACR
Tasks have no matching playable Lab; documentation guidance states that gap.
Unknown historical objectives/concepts or retired mappings remain unmapped.
Review wakes a snoozed recommendation at its next deadline and refreshes its clock
when activated or visible again. This is not passive cross-tab synchronization.
The existing-only Lab reader aborts any creation/upgrade event, including deletion
between enumeration and opening, and reports that race as unavailable context.

Notes are plain text with pending/reviewed/snoozed status. Changing status cannot
change knowledge evidence. Each entire serialized note, including metadata, must
fit 8 KiB of UTF-8 JSON; the UI shows whole-note byte usage. Copy concept prompt
uses canonical authored context only, excluding private notes, answers/history,
credentials and Lab/Sandbox source. Nothing is automatically pasted or sent to
GPT or any other external assistant.

## Local saving, backup and recovery

Exam data lives in separate native IndexedDB `azure-trainer-exam`. Saved means
transaction acknowledgment, not an optimistic draft. Cross-tab revisions reject
stale writes; there is no silent memory fallback or eviction. Notes/answers are
personal local data, and exports are unencrypted. Clearing site data, private
browsing, browser/device loss or changing origin can lose/isolate records.
Development origins and GitHub Pages do not automatically share history; use
explicit export/import. Keep backups somewhere you control.

Normal versioned JSON backup includes exam sessions, attempts, notes and
preferences, excluding Lab databases and unrelated storage. Input limit 32 MiB;
total stored/exported exam data 24 MiB, 200 completed attempts, at most one active
session per mode. Other bounds: 60 items/session, 12 components/item, 32 candidates/
item, 64 KiB/question, 32 KiB/case and finite depth 24. UTF-8 bounds apply before
commit; the 200 ceiling does not guarantee all maximum-size attempts fit 24 MiB.
Overflow is refused without removing records. Export and deliberate pruning are
explicit choices. Attempt deletion previews impact; reset confirms exam-only scope.

Import validates all records before atomic application and previews duplicates,
conflicts and modes. Exact duplicates are idempotent. Same-ID different data
requires an explicit replace choice. Allowed historical snapshots keep their
original definitions/keys; grades are recomputed, never trusted caller totals.
Unknown bounded historic IDs are preserved with unmapped labels. Incompatible,
malformed or oversized content is refused with existing data intact. Imports
are self-reported history, not authenticated exam proof.

A storage failure keeps the queue frozen. Retry is allowed only for a storage
failure at the unchanged revision; a changed revision becomes a conflict. Reload
requires a separate explicit pending-discard choice. Export recovery memory before
discarding if needed: reopening can restore only acknowledged durable data.
Recovery export is a DIFFERENT non-importable diagnostic format containing the
acknowledged snapshot and pending intents, with unencrypted personal data. Its
finite admission bound is 96 MiB for snapshot+queue, with 64 KiB reserved for bounded
metadata/error. Refusal preserves accepted earlier intents. This recovery-only
budget does not change 32 MiB normal backup, 24 MiB storage or 200-attempt limits.

## Verification limits and development

`npm run test:exam-review` runs exactly the seven exam files named in package.json.
Pages CI runs it as a normal step before the existing project-base build, without
a bypass. Test-only `jsdom` 26.1.0 and `fake-indexeddb` 6.2.5 were added; runtime
dependencies were unchanged, Node >=18 remains supported and CI uses Node 22.
Earlier npm install reported 7 vulnerabilities (3 moderate, 2 high, 2 critical) and
a `whatwg-encoding` deprecation. These findings were not attributed to these new
test tools; no force audit upgrade was run. Existing bundle warnings are retained
in the release report, not hidden. [Handoff](./superpowers/plans/2026-10-06-exam-review-handoff.md)
records exact commands, counts, timings and review disposition.

Native IndexedDB and actual small-viewport/keyboard-focus checks are NOT RUN.
IAB was unavailable, and Chrome helper creation failed with missing app-server
executable (OS error 3) before any tab or test DB was created. Fake IndexedDB and
Vue DOM tests are separate evidence, not native substitutes. The owned dev server
was closed. A ready harness uses a unique synthetic `azure-trainer-exam-smoke-<UUID>`
database and never opens/deletes user Exam/Lab data. From the feature worktree:

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 5187 --strictPort
```

Open `http://127.0.0.1:5187/tests/browser/exam-persistence.html` in a working
browser later. The authoritative attempt record is
`.superpowers/sdd/2026-10-06-ai200-exam-review/controller-native-smoke.md`.
Task 10's historical continued run 1 is abridged and run 12 has truncated raw output;
all timing/final/R1 outputs are retained. Those lost portions were not regenerated.
