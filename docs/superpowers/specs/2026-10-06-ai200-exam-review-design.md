# AI-200 Exam & Review — design specification

Status: written specification approved by the user2026-10-06. Implementation
plan approved with subagent-driven execution selected; Tasks1–10 independently
approved, including all120 source/editorial checks. Task11 completes local docs,
CI and bounded verification in the isolated feature worktree. Native IndexedDB
and actual viewport/focus checks remain NOT RUN because the browser helper
could not open a tab. Final whole-branch review and integration workflow remain
controller-owned; no merge, push or publication has been authorized.

## Purpose and agreed direction

Integrate an original AI-200 practice simulator into Azure-Trainer. The user wants
more than a single-choice quiz: varied interactions, realistic navigation,
case studies, saved attempts and useful advice about what to practise in the
existing Lab journeys. The unavailable AZ-900 project is not a dependency.

The user approved integration here, local saving with export/import backups,
Study/Mock Exam/Review, careful weakness tracking and an initial bank of120
original source-backed questions including case studies. The defaults below
resolve the remaining technical details for written-spec review, not implicit
authorization to implement, merge, push or publish.

Success means a learner can complete all supported interaction styles, close
and reopen the app without losing acknowledged saves, see why they struggled,
open an appropriate existing Lab and return to a saved review plan. Completion
of a Lab or repeated memorized answers is not proof of exam mastery.

## Scope and boundaries

- One new Exam & Review area in the current Vue app, not another project.
- English original questions and Python-centric code examples; useful authored
  C# comparisons where relevant to the learner. No copied exam dumps or claims
  of access to live/confidential questions.
- Every question mapped to one existing Skill Area, an official objective key,
  concept tags and explicit grading components.
- All eight interaction renderers below available in the first release.
  Case studies and no-return scenario series are grouping/navigation features,
  not a ninth answer widget or extra uncounted questions.
- Existing Portal, Lab routes, engines, saved runs, Results, hidden Solutions
  and journey layout remain intact. Exam recommendations are read-only consumers
  of the Lab catalog/progress; they cannot grant Lab completion or reset runs.
- Local browser persistence and explicit backup files; no accounts, backend,
  cloud synchronization, telemetry upload or remote AI generation.
- Browser-only practice, not a proctored/secure exam browser. No live Azure labs,
  Python execution or reproduction of Microsoft's proprietary scaled scoring.
  Practical Lab work is reached through review recommendations, not silently
  treated as a timed exam section in this release.
- Publicly documented formats inform the practice experience. Do not advertise
  an exact AI-200 form, question count, format mixture or guaranteed lab presence.

## Sources and verified existing integration

Microsoft does not disclose an exam's exact item mixture. Its public experience
demonstrates active screens, build lists, case studies, drag/drop, hot areas and
multiple choice. This trainer extends those mechanics with multiple selection,
dropdown/code completion and statement grids using original learning content.
[Exam experience](https://learn.microsoft.com/en-us/credentials/support/exam-duration-exam-experience).

Microsoft describes component credit for many multipart items and a scaled pass
score that is not simply a percentage. Here all scoring rules are explicit,
authored practice rules, not a reproduction of its psychometric algorithm.
[Scoring guidance](https://learn.microsoft.com/en-us/credentials/certifications/exam-scoring-reports).

The four Skill Areas remain the existing containers/data/connect/secure IDs.
Source blueprint checked2026-10-06; study-guide page revision2026-05-05.
[AI-200 objectives](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200).

Current app has `/` and `/lab/:labId`, lazy Lab loading and production hash
history. Lab progress combines legacy localStorage with a dedicated IndexedDB
repository. The legacy helper silently ignores storage failures; the new exam
repository must not copy that behavior or modify the Lab database schema.
There is currently no exam bank, exam engine or learner-review repository here.

## Three learner areas

### Study

Choose topics, formats or recommended weak areas. Default10 questions; selectable
5/10/20, without a countdown. Save a question's draft continuously; submit it
explicitly rather than auto-advancing on an option click. After submission show
component credit, the rationale, why distractors are wrong, primary references
and optional C# comparison. A pre-answer Reveal is allowed in Study but marks
that exposure as assisted and excludes it from fresh knowledge evidence.

Submitted answers are sealed for that attempt. A retry is a new recorded exposure,
not editing an old score. Flagging, personal notes, skip and freely returning to
unsubmitted items are allowed. An interrupted Study session can resume later.

### Mock Exam

Default50 questions,100-minute practice deadline, with selectable40/50/60 and
60/100/120-minute presets. These are practice settings, not promises about the
learner's actual booked exam. Show item count, allocated practice points, timer,
remaining/unanswered/flagged counts and explicit navigation instructions before
start. Never expose per-item correctness, explanations or review advice mid-exam.

Default50-item composition:41 reviewable standalone items, two three-question
case studies, and one three-question no-return scenario series. Case members
and series members count in the50, with no item duplicated. The other presets
adjust only the reviewable count to31 or51. Two different case groups and one
series are selected as complete atomic groups, then standalone items fill the
domain quotas. Each Mock includes at least one of every supported widget kind
as an explicit practice-coverage rule, not a prediction of the actual exam mix.

Practice domain item quotas are40:[9,11,10,10],50:[12,14,12,12],
60:[14,16,15,15] in containers/data/connect/secure order. These fall within the
published blueprint ranges, but are trainer item-selection rules, not official
point weighting. A constrained seeded draw reserves groups, fills remaining
quotas without replacement and persists the selected order. If impossible,
report a bank/configuration error; do not silently drop groups, duplicate items
or relax the blueprint. Mock draws do not adapt to weak topics; Study can.

Sections are ordered: standalone reviewable, case1, case2, no-return series.
Within reviewable sections, previous/next and a review grid permit changing
answers. Continue section warns about omissions and permanently seals it.
Case background/requirements remain available throughout their own section.
Within the scenario series, each Next seals that item; no back/review within
the series. Explain this before entry, not after an answer is lost.

An explicit break seals the seen items in the current reviewable section after
confirmation; unseen items remain reachable. No break within the no-return
series. The deadline continues while away/on break/with another tab open or
after browser closure. Exam has no pause button that extends its deadline.
On reopen, resume an unexpired exam or finalize the saved answers once if it
has expired. Detect backward clock movement and retain the greatest observed
time; disclose local timing is not tamper-proof.

Submit early shows a confirmation with unanswered counts. Deadline expiry
grades the latest acknowledged answers, including unanswered components as0.
Finishing is idempotent: double clicks, reload or two tabs cannot create duplicate
Results or accept late edits. Start must first commit the initial session.
Next/section/break/submit transitions flush pending answer saves before sealing;
save failure shows retry and must not pretend navigation/submission succeeded.
At expiry freeze new input immediately, then flush already-observed pre-deadline
edits and commit finalization once. If storage fails, retain a frozen recovery
screen with a clear error and backup opportunity, not a silently lost answer or
unpersisted success screen. Reopening can restore only acknowledged durable data.
A completed Mock permits unrestricted explanation
review and notes, without reopening its sealed answers.

An optional Microsoft Learn button opens its official home in a new browser tab;
the timer continues. No question-specific answer/reference links during Mock.
This is reference-use practice, not an embedded secure browser or enforcement of
Microsoft's real domain restrictions. Questions/code/configuration remain
read-only artifacts; no arbitrary script execution is introduced.

### Review

List completed attempts, component outcomes, answer versus expected answer,
references, notes, missed concepts and follow-up suggestions. Show the reason
for a recommendation and the amount of evidence behind it. Offer direct existing
Lab links and a targeted question set, then allow returning to the review plan.
Never attribute an individual's weaknesses from the chat or from no attempts.

## Interaction and grading contract

All choices use stable IDs rather than array positions. Display shuffling must
not change correctness; preserve the drawn order/permutation on reload.
Cards, text/code, diagrams and controls are authored locally, not copied portal
screenshots containing account data. Render content as text/safe structured
nodes, never imported raw HTML, remote scripts or executable source.

| Kind | Interaction | Authored practice scoring |
| --- | --- | --- |
| single-choice | Pick one radio answer | One exact-answer component |
| multiple-response | Explicit chooseN or select-all instruction | One exact-set component; no reward for select-everything |
| build-list | Select required actions from candidates and order them; unused distractors possible | Each required position is a declared component |
| matching | Assign source cards to labelled targets | One component per target; reuse policy explicit |
| dropdown | Fill named blanks in code/config/table/text | One component per named blank |
| statement-grid | Yes/no for each scenario statement | One component per statement |
| hot-area | Select semantic regions in an authored diagram | Declared exact region-set component, not viewport pixels |
| active-screen | Set options in an authored configuration panel | One component per named field |

Every item declares maximum points and scoring policy visibly. Missing components
score0; no negative points. Exact-set selection cannot turn all wrong selections
into component credit. Components are fixed before the attempt, with a primary
concept tag; do not infer concept outcomes from arbitrary UI clicks afterward.
Plain-text error messages and partial selections are valid saved drafts but are
not magically complete answers. Incomplete selection cardinality is identified
as an omission/format issue, not automatically a knowledge misconception.

Keyboard alternatives are mandatory for drag/drop and reordering: select target,
assign/remove, move up/down; they operate on the same answer state as pointer
gestures. Hot areas have labelled focusable controls and an equivalent textual
region list. Screens use semantic labels, no default-selected correct answers,
and no color-only correctness indicators. No mobile-only or drag-only questions.

Mock summary shows earned/available practice points, percentage and per-domain
and per-format breakdown. A configurable practice goal defaults80%, labelled
as a self-set study target, not Microsoft's pass threshold. Do not multiply
percentage by1000, report a fictitious700 score or promise passing/readiness.

## Initial original question bank

Exactly120 independently authored questions, including18 case-study members
in six three-question groups and six no-return-series members in two groups.
Group members also count under their ordinary interaction kind and Skill Area.
Case groups: one containers, two data, one connect, two secure. Each no-return
series is connect or secure. All group members use one group domain so reserved
quota accounting is unambiguous. The no-return yes/no items are single-choice
items, distinct from the statement-grid renderer.

| Allocation | Counts |
| --- | --- |
| Skill Areas | containers27, data33, connect30, secure30 |
| Widget kinds | single24, multiple20, build16, matching16, dropdown16, grid12, hot-area8, screen8 |

These allocations are product defaults for this spec, not counts from a live
exam. Each published objective gets coverage; App Service and deeper ACR Tasks
must appear even though corresponding journeys are not implemented yet. Topic
taxonomy covers container image/hosting/release/connectivity, Cosmos querying/
indexing/consistency/vector/change feed, PostgreSQL schema/vector/resource/
pooling, Redis cache/vector, messaging/eventing, Functions HTTP/bindings/hosting,
vault/configuration and telemetry/query analysis. Scenario questions should ask
for decisions/code/configuration under stated constraints, not only definitions.

Each question has immutable ID, content revision, family ID, type, domain,
objective key, difficulty, component concepts, stem/artifacts/options, answer
key/policy, component explanations and primary source references with review
dates. Family IDs group genuinely equivalent variants to prevent counting minor
wording changes as new knowledge evidence. Different case-study problems retain
different families; sharing a case background is not itself equivalence.

No ambiguous distractor, unsupported option or stale SDK claim is accepted just
to reach120. Every explanation must justify the correct answer and meaningful
alternatives. A coverage report and independent editorial/source review accompany
the bank; structural validation alone is not fact checking. Reference verification
must use the relevant official documentation/SDK source, not only the exam guide.
If there is no defensible answer, revise the item before releasing the bank.

## Weakness evidence and lab recommendations

Grade and analytics are separate. Analytics distinguish attempted wrong components,
unanswered/time-expired parts, assisted exposures and repeat-family practice.
Time spent or skipped questions alone cannot establish poor knowledge.

For each concept, use at most the six most recent eligible distinct families;
eligible means first unassisted graded encounter for that family, with actual
attempted components. Group the family's concept components into one normalized
observation so a many-row item does not dominate. Imported duplicates and a new
revision of the same family cannot add independent evidence. Keep repeat practice
and optional low/medium/high confidence visible separately; confidence never
changes points or establishes a weak topic alone.

- Fewer than three eligible distinct families: insufficient evidence, with
  an exact sample count rather than a weakness label.
- At least three and mean attempted-component credit below60%: needs review.
- From60% to below80%: developing; suggest targeted practice.
- At least80%: stronger evidence on this sampled concept, not mastered/certified.

Retesting familiar questions can show improved retrieval, but cannot erase a
needs-review finding without new eligible evidence. If fresh families are
exhausted, say so; offer Lab practice/reference review and label familiar retries
honestly. Recommendations remain usable even if the initial bank lacks enough
fresh observations for a confident improvement assessment.

Sort review priorities by lowest eligible accuracy, then wrong-family count,
then most recent error and stable concept ID. Sparse topics live in a separate
assessment-needed group. Offer an authored concise explanation, source links,
the next suitable Lab and a targeted set preferring unseen families. Never
present recommendations as diagnoses or statistical predictions of exam success.

Mappings reference actual labById IDs and optional Task IDs, validated against
LABS. Examples: subscription filters -> messaging-topics; PostgreSQL filtered
vector retrieval -> data-postgres-vector-guided; KQL failures ->
observability-failure-query; HTTP acceptance/binding -> the matching HTTP Lab.
Validate all final mappings rather than hardcoding plausible nonexistent names.
Read latest Lab Result to display not-started/in-progress/completed and assistance
counts; a completed-with-Solutions Lab can still be suggested for independent
practice. No tracking flag grants engine proof. Unsupported App Service/ACR Tasks
practice gets documentation recommendations with an explicit no-matching-Lab
message, not a link to an unrelated journey.

Learner notes and review statuses pending/reviewed/snoozed are saved separately
from measured evidence. A reviewed checkbox cannot change the weakness score.
Recommend a follow-up after review; never mark it achieved before an eligible
answer. Notes are plain text, never sent externally or automatically pasted into
GPT. Optional copyable concept prompts use authored context only, not notes,
answer history, Lab source, credentials or Sandbox state.

## Local durability, import and content revisions

Use a separate versioned IndexedDB database `azure-trainer-exam`, not the existing
Lab database. Stores contain sessions, completed attempts and review notes/flags.
One local learner profile, no account identity. Draft sessions and Results use
stable UUID IDs, versioned finite closed JSON schemas and optimistic revisions.
Persist selected items and valid answer drafts after every change, preserving
unanswered versus intentionally submitted components and all sealed boundaries.
Only display Saved after transaction completion; show saving/error/retry states.
Storage errors or quota exhaustion must not silently reset history or fall back
to an unannounced volatile mode. Existing Lab storage is not rewritten.

A session carries frozen settings, bank/question revisions, selected definitions
and permutations, sections/cursor/seals, draft answers, flags, assisted exposures,
deadline and greatest observed time. A finished attempt stores those definitions,
final responses and recomputable component outcomes. Retain original historical
content rather than regrading old answers using an updated answer key. Counts/
percentages are derived, not trusted imported aggregates. Post-finish answer
disclosure is acknowledged explicitly: lastObservedAt tracks
review reveals without changing frozen responses, keys, grades or finishedAt.
Revealing an omitted answer is still exposure and cannot make a later familiar
retry fresh. A submit event alone is not evidence of attempted knowledge.
Cross-tab writes and
submission use revisions and a single transaction; conflicts show a reload
choice rather than overwriting another tab. No score or answer leakage from
Review into an active Mock screen by routing. While a Mock is active, Study and
answer-review routes redirect to its resume screen with an explanation; returning
to Home or leaving the app does not stop its deadline. If a Study is already
saved, starting a Mock preserves that Study but temporarily suspends access to
its feedback. This is UI flow control, not protection against browser developer
tools or manual editing of local data.

Export a versioned JSON backup of exam sessions, attempts and notes only;
exclude Lab Sandboxes, credentials, projects and unrelated browser storage.
Warn that exported answers/notes are personal unencrypted data. Import parses
and validates the entire file before committing, previews counts/conflicts and
merges exact duplicates idempotently. A same-ID different record is a conflict:
leave existing data unchanged and require an explicit replace decision. Replacement
is atomic; never increment accuracy by double importing an attempt. Historical
question snapshots must pass bounded schema/scoring validation; recompute results
and render plain content. Unknown objectives or retired Lab mappings display
unmapped historical evidence without inventing a current recommendation.
Imported evidence is self-reported local history, not authenticated exam proof.

Reset requires confirmation with an export suggestion and affects only exam
stores. Removing one attempt recomputes advice; show its impact before deletion.
Browser-data clearing/private browsing or a different origin can lose/isolate
local data. Dev-server and GitHub Pages records are not automatically shared;
export/import is the explicit bridge. No promise of permanent or device-synced
storage is made. Explain these limitations in onboarding and the backup screen.

Initial finite bounds:120 bundled items,60 per session,12 components per item,
32 candidates per item,64KiB per frozen item,32KiB per case background,8KiB per
note,200 saved completed attempts and at most one active session per mode.
Admission also caps the entire exported exam-data representation at24MiB of
UTF-8 JSON, including retained definitions and notes, before any transaction.
This budget ensures a user's own full export fits the32MiB import limit even
with the backup envelope; the200-attempt ceiling is not a promise that every
maximum-size record can fit. Finalization replaces the active heavy snapshot
with its completed-record reference rather than duplicating its definitions.
Backup limit32MiB; parsed data must also meet entry/string/depth bounds. Refuse
overflow without eviction; offer export and deliberate pruning. Application JSON
must be finite plain data with no prototype keys, getters, functions or scripts.
Answer IDs/settings/URLs are validated; reference URLs are HTTPS primary-source
links, not javascript/data/file URLs. Approved hosts are learn.microsoft.com,
opentelemetry.io, postgresql.org, www.postgresql.org and redis.io. GitHub links
are restricted to the Azure/azure-sdk-for-python, Azure/azure-rest-api-specs,
open-telemetry/opentelemetry-python, pgvector/pgvector and dotnet/docs repositories;
the exact reviewed reference paths are maintained in the bank reference catalog.
Imported definitions cannot introduce arbitrary hosts or repository links.

## Module and UI responsibilities

- Bank/content: immutable typed items, case/series definitions, objectives,
  concept-to-Lab map, references and editorial validation.
- Exam core: pure answer validation/grading, deterministic blueprint selection,
  section transitions, deadline/submit reducer and replayable settings.
- Repository: exam-only transactional persistence, version validation, conflicts,
  backups/import/reset; no dependence on mutable Sandbox internals.
- Review core: pure deduplicated evidence aggregation and authored recommendation
  selection, using read-only Lab progress snapshots.
- Vue views/widgets: accessible input renderers, session/review/history screens
  and storage status, without embedding grading rules in template handlers.

Proposed lazy routes: `/exam`, `/exam/session/:sessionId`, `/exam/results/:attemptId`,
`/review` and `/review/history`. Add a clear Home/header entry to Exam & Review;
retain existing Lab navigation and production hash routing. Use the current
visual language with a focused question workspace, case-reference pane, timer/
section banner and review grid. Small screens stack panes; do not squeeze exam
content into the Cloud Shell or Lab Panel. Keep bank/widgets out of the initial
Lab/home bundle by lazy-loading. No UI mockup is required for this approval;
accessible component behavior and route responsibilities are the contract.

## Verification policy and acceptance

During implementation run only owning focused tests and small, necessary rendered
interaction checks. No full/AKS/Container Apps suites, long Lab replays, cloud or
Python-process execution. Measure every attempt/failure/rerun/build and reduce
or refactor at the user's30-minute threshold. Bank validators traverse120 items
once; do not run120 simulated exams. Pure deterministic clocks replace waits.

Cover all eight grading policies and answer shuffles; partial/incomplete answers;
accessible equivalent interactions; no-return/section/break seals; deadline across
reload; idempotent submission; storage unavailable/quota/conflict; atomic backup
import; stale content; duplicate exposure/family counting; sparse/omission/assisted
analytics; retired/unmapped Lab IDs; notes escaping; and no effect on Lab stores.
Use representative shared fixtures rather than replaying every combination.
One compact end-to-end mixed session and one persistence/review/Lab-link exercise
are sufficient integration episodes. Final exact named-file test aggregate and
one production build are specified in the implementation plan, not a broad suite.

Acceptance:120 reviewed questions with declared allocations; every format usable
by keyboard/pointer; actual typed answers graded correctly; realistic disclosed
Mock navigation/timing with no early feedback; acknowledged local state survives
reload; safe backups; recommendations explain evidence and link only real Labs;
no fabricated weaknesses/readiness/scaled score; current journeys remain intact.

## Inline specification self-review

Counts:27+33+30+30=120;24+20+16+16+16+12+8+8=120. Eighteen case members and six
series members are included in those counts, not additional items. All presets
reserve two cases and one series; remaining counts produce40/50/60 correctly.
Quota filling is constrained and fails visibly if unavailable. Every renderer
has a stable answer/grade contract and accessible alternative. Exact-set and
multipart scoring are distinct, with unanswered/assisted/repeat analytics separate.
Local durability has visible errors, explicit version boundaries and no Lab DB
migration. Integration references actual routes/store/catalog, not the unrelated
Greenfield project inspected while searching for AZ-900. Bank source review,
practice-score limitations and non-proctored/live-lab exclusions are explicit.
No product code, implementation dependencies, tests or deployment changed during
specification writing. The user subsequently approved this file and requested
the implementation plan. Next gate is review of
`../plans/2026-10-06-ai200-exam-review.md` and execution-method selection.
