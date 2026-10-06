# AI-200 Exam & Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an integrated mixed-format AI-200 practice experience with120 original reviewed questions, durable local attempts and evidence-based recommendations linking to existing Labs.

**Architecture:** Add a lazy-loaded exam subsystem, with pure typed grading/selection/session/review modules, a separate transactional IndexedDB repository and eight accessible Vue widgets. Existing Lab engines, stores and database remain unchanged; a read-only adapter supplies Lab status to recommendations.

**Tech Stack:** Existing Vue3, Pinia, Vue Router, JavaScript ES modules and Vitest2.1. Test-only jsdom26.1.0 and fake-indexeddb6.2.5; no added runtime dependency, backend or account service. These dev-tool versions' Node>=18 engines were checked through registry metadata while planning; Pages already uses Node22.

**Spec:** `docs/superpowers/specs/2026-10-06-ai200-exam-review-design.md`, approved by the user2026-10-06.

**Authority:** The user reviewed this plan and selected option1, subagent-driven implementation. Execute in the isolated feature worktree, not main. Merge, push, publication and deletion require separate authority; preserve RESUME-HTTP-FUNCTIONS.md and other worktrees.

## Global Constraints

- One new Exam & Review area in the current Vue app, not another project.
- All eight interaction renderers below available in the first release.
- Local browser persistence and explicit backup files; no accounts, backend, cloud synchronization, telemetry upload or remote AI generation.
- Existing Portal, Lab routes, engines, saved runs, Results, hidden Solutions and journey layout remain intact.
- Exactly120 original questions, including18 case-study members in six three-question groups and six no-return-series members in two groups.
- Skill Areas: containers27, data33, connect30, secure30. Widget totals: single24, multiple20, build16, matching16, dropdown16, grid12, hot-area8, screen8.
- Practice domain item quotas:40:[9,11,10,10],50:[12,14,12,12],60:[14,16,15,15] in containers/data/connect/secure order. Two complete distinct cases, one complete series and all eight kinds in each Mock; no duplicate items or silent quota relaxation.
- Default50 questions/100 minutes;40/50/60 items and60/100/120-minute presets. Study5/10/20 requested items, default10; show reduced availability and obtain explicit shorter-deck consent, never duplicate items to fill it.
- A configurable practice goal defaults80%, labelled as a self-set study target, not Microsoft's pass threshold.
- Database `azure-trainer-exam` is separate from Lab storage. Acknowledged saves must survive reload; no silent memory fallback or eviction.
- Bounds:60 items/session,12 components/item,32 candidates/item,64KiB/item,32KiB/case background,8KiB/note,200 completed attempts, one active session per mode,24MiB total exported data and32MiB backup input. Use UTF-8 byte lengths; enforce before committing.
- Imported duplicates cannot multiply evidence. Historical keys remain frozen; unknown historical taxonomy gets an unmapped label, not a fabricated current Lab.
- Fewer than three eligible distinct families means insufficient evidence. Latest at most six eligible families per concept; thresholds below60%,60–<80%,>=80% are needs-review/developing/stronger-sample, not diagnoses or mastery.
- No full/AKS/Container Apps suites, long Lab replays, cloud or Python-process execution. Measure every attempt/failure/rerun/build and reduce or refactor at the user's30-minute threshold.
- No confidential exam content, exact-live-exam/scaled-score claims, arbitrary HTML/scripts or remotely generated questions.

## Review Focus

1. Rapid edits followed by section sealing, expiry, reload or write failure must not lose acknowledged answers or accept late edits (Tasks2/3/10).
2. Malformed/oversized/conflicting backup data, hostile text/URLs and duplicate imports must not partially overwrite history or Lab storage (Tasks1/3/9/10).
3. Mandatory groups competing with domain/format quotas must yield a valid deterministic deck or explicit error, not mixed numbering or silent omission (Tasks2/8).
4. Assisted/omitted/repeated-family/many-component answers must not fabricate weak topics or improvement, including assistance revealed in an unfinished Study (Tasks2/4/10).
5. Keyboard-only interaction, small layouts and direct navigation during Mock must preserve the same answers, section locks and feedback withholding as pointer controls (Tasks9/10).

## Files and dependency map

`src/lib/exam/{contracts,question,grading,selection,session,persistence,backup,review}.js`
own separate pure/domain/storage responsibilities. `src/data/exam/{taxonomy,concepts,index}.js`
and `bank/{containers,data,connect,secure,index}.js` own original content; no bank
import in Home, PortalHeader or synchronous router initialization. Domain files
export their own questions/groups/references, avoiding shared authoring edits.

`src/components/exam/` owns question widgets/presentation/section controls;
`src/pages/{ExamPage,ExamSessionPage,ExamResultPage,ReviewPage,ReviewHistoryPage}.vue`
own route views; `src/stores/exam.js` owns serialized save/recovery orchestration.
`src/lib/exam/labProgress.js` is the only read-only bridge to existing progress.
`src/styles/exam.css` is imported by lazy exam views, not a journey-layout rewrite.

Tasks1–4 establish tested contracts with small fixtures; Tasks5–8 independently
author/review the four domains; Task9 builds actual widgets; Task10 integrates
working views; Task11 is the release gate. They are one coupled feature plan,
not independently deployable replacement projects. No multiple implementers
edit shared files concurrently. Task reviews include editorial verification
where applicable; do not spawn extra per-question reviewers.

## Shared exact interfaces

Define these exported contracts in Task1; consumers must not invent aliases.

```js
EXAM_VERSION = 1
EXAM_DOMAINS = ['containers','data','connect','secure']
EXAM_KINDS = ['single-choice','multiple-response','build-list','matching',
  'dropdown','statement-grid','hot-area','active-screen']
EXAM_LIMITS = { items:60, components:12, candidates:32, questionBytes:65536,
  caseBytes:32768, noteBytes:8192, attempts:200, dataBytes:25165824,
  backupBytes:33554432, depth:24 }
// Question, closed uniform envelope; presentation is a kind-specific union.
Question = { id, revision, familyId, kind, domain, objectiveId, difficulty,
  stem, artifacts, presentation, components, groupId, explanation,
  referenceIds, csharp }
Component = { id, conceptId, points:1, input:'one'|'set', requiredCount,
  candidateIds, expected } // expected string or unique string[]; count null or integer
Answer = { [componentId]: string | string[] } // missing fields are unanswered
Reference = { id, title, url, reviewedAt }
Group = { id, kind:'case'|'series', domain, title, background, questionIds }
Bank = { version:1, revision:1, questions, groups, references }
Outcome = { componentId, conceptId, earned, possible:1,
  status:'correct'|'wrong'|'unanswered'|'incomplete', attempted }
Grade = { questionId, outcomes, earned, possible }
// Input widgets receive QuestionView, not private grading fields.
QuestionView = publicQuestion(Question,{feedback:false})
```

`presentation` supplies ordered component IDs, labelled candidates and the
appropriate slots/regions/panel. Dropdown artifacts use structured text segments
and named slots, not raw HTML. A hot-area diagram supplies labelled region IDs
and finite normalized geometry, no executable SVG/remote screenshots. Matching
declares allowReuse; build-list uses one component per required position and
candidate IDs include unused distractors. one/set expectations must reference
legal candidates. IDs are bounded safe strings; reject dangerous object keys.

Current authored items have one primary objective; each component's concept
belongs to that objective and domain. Historical unknown identifiers remain
preserved and unmapped. Cross-objective component attribution would require an
explicit contract change rather than silently remapping historical evidence.

Task1 publishes full closed presentation/record schemas in its handoff before
UI/storage consumers start. A legitimate difference must be resolved against
the spec and recorded, not silently introduced in an implementer's report.

```js
ActiveSession = { version:1, id, revision, mode:'study'|'mock',
  status:'active'|'break'|'expired', bankRevision, settings, createdAt,
  lastObservedAt, deadlineAt, questions, references, groups, order, optionOrders,
  sections, cursor, seenIds, sealedIds, answers, submittedIds, flags,
  assistedIds, confidence, exposures, resultId:null }
FinishedPointer = { version:1, id, revision, mode, status:'finished', attemptId }
Section = { id, kind:'standalone'|'case'|'series', questionIds, sealed }
Attempt = { version:1, id, sessionId, mode, createdAt, finishedAt, lastObservedAt, bankRevision,
  settings, questions, references, groups, order, optionOrders, responses,
  submittedIds, assistedIds, confidence, exposures, submissionReason, grades,
  source:'local'|'imported' }
Note = { version:1, id, revision, target:{kind:'concept'|'attempt'|'question',id},
  text, status:'pending'|'reviewed'|'snoozed', snoozedUntil, updatedAt }
RepositorySnapshot = { version:1, revision, sessions, attempts, notes,
  preferences:{practiceGoal:80} }
```

Settings freeze requested/actual size, duration, goal, Study filters and draw
seed. Timestamps are safe integer epoch milliseconds; deadline null only for
Study. Confidence values unset/low/medium/high do not alter scoring. Exposures
record question/family, seen/reveal/submit event and time so an early Reveal in
an unfinished Study also prevents a later familiar answer being called fresh.
The first ever answered/revealed encounter of a family is the freshness boundary;
an assisted first encounter cannot be washed away by a later unassisted retry.
Unanswered/unrevealed encounters alone do not establish a knowledge outcome.
Attempt.lastObservedAt starts at finishedAt and permits acknowledged post-finish
feedback reveals. Only exposure/assistance metadata may change afterward;
questions, keys, responses, grades and finishedAt remain frozen. A grading-submit
event for an omitted component is not an answered knowledge encounter.

Question data intentionally exists in client storage; UI projections must omit
expected answers, explanations and per-question references while feedback is
withheld. This is disclosure control, not cryptographic anti-cheat.

### Task 1: Closed question/answer contracts and all eight graders

**Files:** Create contracts.js, question.js, grading.js under `src/lib/exam/`;
`tests/helpers/examFixtures.js`; `tests/exam-contracts.test.js`.
**Consumes:** Spec kinds/bounds; existing finite JSON conventions without importing
Lab engines. **Produces:** `ExamError`, `EXAM_VERSION`, `EXAM_DOMAINS`, `EXAM_KINDS`, `EXAM_LIMITS`,
`validateQuestion(q,{historical=false})`, `validateQuestionView(view)`, `validateAnswer(qOrView,answer)`,
`validateSession(value)`, `validateAttempt(value)`, `validateNote(value)`,
`validateReference(ref)`, `gradeQuestion(q,answer) -> Grade`,
`gradeAttempt(attempt) -> {grades,earned,possible,percentage,byDomain,byKind}`,
`publicQuestion(q,{feedback=false})`, `applyAnswerEdit(q,answer,edit)`.

- [ ] Write compact RED table cases for all eight kinds, omission/incomplete,
  exact-set select-everything, wrong IDs, duplicate reuse, shuffles and hostile
  text/URLs. Test loader converts missing exports into explicit assertions, not
  a collection-only error. Fixtures export `questionFixture(kind,overrides={})`,
  `bankFixture()`, `sessionFixture()`, `attemptFixture(overrides={})` and
  `correctAnswer(q)` and UUID `SESSION_FIXTURE_ID='00000000-0000-4000-8000-000000000001'`
  for later tests only; never put fixture answers in product.
  Fixture override familyId/credit are helper inputs: they produce legitimate
  frozen Question/Response/Grade records, not unknown fields injected into Attempt.
  Example actual assertion:
  ```js
  const q = questionFixture('multiple-response') // two-of-four, set component pick
  expect(gradeQuestion(q,{pick:q.presentation.choices.map(c=>c.id)}).earned).toBe(0)
  expect(gradeQuestion(q,correctAnswer(q)).earned).toBe(1)
  expect(publicQuestion(q).components[0]).not.toHaveProperty('expected')
  ```
- [ ] Timed `npx vitest run tests/exam-contracts.test.js`; inspect intended RED.
- [ ] Implement descriptor-aware finite/closed validation, byte/depth limits,
  exact expected/candidate/component relations and URL policy from spec. Uniform
  grading pattern, with legal partial drafts distinguished from attempted errors:
  ```js
  const value = answer[c.id]
  const absent = value === undefined || (Array.isArray(value) && !value.length)
  const incomplete = !absent && c.input === 'set' && c.requiredCount !== null
    && value.length !== c.requiredCount
  const equal = !absent && !incomplete && (c.input === 'set'
    ? [...value].sort().join('\0') === [...c.expected].sort().join('\0')
    : value === c.expected)
  return {componentId:c.id,conceptId:c.conceptId,earned:!absent && equal ? 1:0,
    possible:1,status:absent?'unanswered':incomplete?'incomplete':equal?'correct':'wrong',
    attempted:!absent && !incomplete}
  ```
  Guard undefined before set comparison; validators run before grading. Grading
  order follows component declarations, not user object order. Public projection
  strips expected/explanation/referenceIds/csharp until feedback is allowed.
  Edits are typed set/toggle/assign/remove/move operations that produce one legal
  whole answer; pointer and keyboard must use the same function.
  Draft/edit validation accepts a validated QuestionView and never requires its
  absent private expected values; grading separately requires the full Question.
  ActiveSession/Attempt/Note IDs are UUIDs. Question/concept/group IDs are stable
  bounded identifiers, not required to be UUIDs.
  Schema validators return the validated value or throw ExamError; domain-content
  and Lab-mapping validators return true or throw. Do not mix booleans and DTOs
  at producer/consumer boundaries. Full grading always recomputes component results.
- [ ] Timed GREEN owning file; self-review closed schemas/limits/immutable copies;
  publish exact schemas. Commit `feat: define exam question contracts and grading`.

### Task 2: Deterministic draw and session/navigation/deadline reducer

**Files:** Create `src/lib/exam/{selection,session}.js`; test
`tests/exam-session.test.js`; extend shared test fixtures only as necessary.
**Consumes:** Task1 contracts/graders. **Produces:** `drawMock(bank,settings,seed)`,
`drawStudy(bank,filters,requestedSize,seed)`,
`createExamSession({id,bank,mode,settings,seed,now})`,
`reduceExamSession(session,action,{now}) -> {session,attempt:null|Attempt}`,
`presentSession(session,{now})`, `sessionSummary(session)`, `accessDecision(snapshot,to)`.
Also produce `recordReviewReveal(attempt,questionId,{now}) -> Attempt`: validate
the frozen record, append its first actual reveal event if absent, mirror
assistedIds and advance lastObservedAt monotonically without modifying grades.

- [ ] RED seeded draw assertions for40/50/60, complete two cases/one series,
  eight formats/domain quotas/no duplicates, reload equivalence and impossible
  pool error. Pin rollback clock, pending-submit handling, no-return/break locks,
  Study assistance and past-deadline answer refusal with deterministic clocks:
  ```js
  const s = createExamSession({id:SESSION_FIXTURE_ID,bank:bankFixture(),mode:'mock',
    settings:{size:50,durationMinutes:100,practiceGoal:80},seed:17,now:1000})
  const expired = reduceExamSession(s,{type:'tick'},{now:6001000})
  expect(expired.session.status).toBe('expired')
  expect(()=>reduceExamSession(expired.session,{type:'answer',questionId:s.order[0],
    answer:{}},{now:6001001})).toThrow()
  expect(drawMock(bankFixture(),{size:50},17).order).toEqual(s.order)
  ```
- [ ] Timed RED owning file.
- [ ] Implement pure transitions answer/visit/flag/confidence/next/back/sealSection/
  break/resumeBreak/reveal/submitQuestion/tick/finish. Reducer increments revision
  deterministically once per accepted action; rejects edits to sealed/submitted
  items and late Mock actions; `lastObservedAt=Math.max(lastObservedAt,now)`.
  tick marks expired without pretending storage committed completion; finish
  reuses the session's UUID as attempt ID in the separate attempts store and lightweight
  FinishedPointer, so duplicate finish resolves the same result. Study permits
  skipped drafts; no answer key feedback before submitted/revealed. Draw uses
  a seeded shuffle of stable IDs, bounded constrained search with memoized
  remaining domain/kind requirements, reserving groups atomically. Report
  `BANK_UNSATISFIABLE` rather than a greedy partial deck. Study returns explicit
  availability before creation; shorter decks require the UI's consent.
  ```js
  const remaining = quotas.map((n,i)=>n-reserved.filter(q=>q.domain===EXAM_DOMAINS[i]).length)
  if (remaining.some(n=>n<0)) throw new ExamError('Group quota exceeded','BANK_UNSATISFIABLE')
  // Selected output is accepted only after exact quotas, all kinds and unique IDs validate.
  ```
- [ ] GREEN only owning file, no real waits; self-review deadline/feedback/atomic
  group constraints. Commit `feat: add deterministic exam sessions and section rules`.

### Task 3: Exam-only IndexedDB, revision conflicts and backups

**Files:** Create `src/lib/exam/{persistence,backup}.js`; test
`tests/exam-persistence.test.js`; modify package.json/package-lock.json for
dev-only fake-indexeddb6.2.5. No Lab DB/store edits.
**Consumes:** Task1 validation and Task2 reducer.
**Produces:** `createExamRepository({indexedDB,dbName='azure-trainer-exam',
dataByteLimit=EXAM_LIMITS.dataBytes})` with async `load()`,
`start(session,{expectedRevision})`,
`dispatch(id,action,{expectedRevision,now})`,
`saveNote(note,{expectedRevision})`, `savePreferences(value,{expectedRevision})`,
`exportBackup()`, `previewImport(text)`,
`applyImport(preview,{expectedRevision,replaceIds:[]})`,
`previewDeleteAttempt(id)`, `deleteAttempt(id,{expectedRevision})`,
`reset({expectedRevision})`, `close()`; backup pure exports
`validateBackup(value)`, `mergeBackup(current,incoming,{replaceIds})`.

- [ ] RED tests use actual fake-indexeddb transaction/event semantics, not a
  mocked successful repository. Cover acknowledged reopen, failed writes,
  cross-tab stale revisions, double finalization, unchanged Lab DB, corrupt/
  oversize/duplicate/conflicting imports and historical keys. Inject small byte
  limits instead of allocating dozens of24MiB payloads:
  ```js
  const repo = createExamRepository({indexedDB:new IDBFactory(),dbName:'exam-test'})
  const before = await repo.load()
  await repo.start(sessionFixture(),{expectedRevision:before.revision})
  expect(()=>validateBackup({version:1,attempts:[{grades:[{earned:999}]}]})).toThrow()
  const snapshot = await repo.load()
  await expect(repo.dispatch(SESSION_FIXTURE_ID,{type:'flag',questionId:'q1'},
    {expectedRevision:before.revision,now:2000})).rejects.toMatchObject({code:'REVISION_CONFLICT'})
  ```
- [ ] Install only `npm install --save-dev --save-exact fake-indexeddb@6.2.5`
  at execution time, preserve unrelated lock/dependencies, run timed owning RED.
- [ ] Implement stores sessions/attempts/notes/meta in a separate version1 DB.
  Global snapshot revision and24MiB projected-data admission are checked inside
  one readwrite transaction spanning these stores; no async network/timeout
  between transaction reads/writes. Mutation receives intent, runs reducer
  against actual stored session and recomputes grades, never accepts caller
  outcomes. Finalization atomically writes Result plus lightweight pointer.
  For a finished pointer, dispatch supports reviewReveal for its actual stored
  attempt through recordReviewReveal; reject that feedback action while any Mock
  remains active. Only observed disclosure metadata changes, not sealed scores.
  ```js
  tx.oncomplete = () => resolve(savedSnapshot) // never resolve on request success
  tx.onabort = () => reject(new ExamError('Exam transaction aborted','STORAGE_FAILED'))
  tx.onerror = () => { /* capture cause; abort/complete owns Promise settlement */ }
  ```
  `load` validates all records; fail visible, no reset/memory fallback. Backup
  envelope exactly `{format:'azure-trainer-exam',version:1,exportedAt,data}`.
  preview captures current revision and conflict list; replaceIds must match
  explicit conflicting records. Whole import validates before atomic admission;
  identical duplicate objects merge once; differing duplicate IDs within the
  input reject. Recompute historical grades from their validated frozen keys,
  mark imported source and preserve objective IDs even when now unmapped.
  Replacement keys are store-qualified strings such as `attempts:<UUID>`, since
  a finished pointer and its attempt legitimately share the same UUID in different
  stores. Reject a merge leaving more than one active session per mode; preview
  that conflict for an explicit choice rather than silently discarding either.
  Starting checks actual active rows inside the global readwrite transaction;
  do not add a unique mode index that would also block finished pointers.
- [ ] Timed GREEN, verify no accidental database upgrade of Lab repository;
  commit `feat: persist exam history and atomic backups locally`.

### Task 4: Taxonomy, honest weakness evidence and read-only Lab mapping

**Files:** Create `src/data/exam/{taxonomy,concepts,index}.js`,
`src/lib/exam/{review,labProgress}.js`; `tests/exam-review.test.js`.
**Consumes:** Attempt/Session exposure DTOs, existing LABS/labById and progress
getters through adapter. **Produces:** `EXAM_OBJECTIVES`, `EXAM_CONCEPTS`,
`validateLabMappings(concepts,labs)`,
`computeReview({attempts,activeSessions,concepts}) -> {topics,assessmentNeeded,counts}`,
`recommendPractice(review,{bank,labProgress,notes,now})`,
`readLabProgress(progress,labIds)`, `conceptPrompt(concept)`.

- [ ] RED sparse3-family boundary, multi-component normalization, assistance
  revealed before unfinished Study, duplicate import, repeated revision/family,
  omissions/confidence, stale mappings and snoozed/manual statuses:
  ```js
  const history = [attemptFixture({familyId:'f1',credit:0}),
    attemptFixture({familyId:'f2',credit:0}),attemptFixture({familyId:'f3',credit:1})]
  expect(computeReview({attempts:history,activeSessions:[],concepts:EXAM_CONCEPTS})
    .topics[0]).toMatchObject({sampleCount:3,status:'needs-review'})
  // Repeat f3, or check a reviewed note: neither adds a fresh family or raises accuracy.
  ```
- [ ] Timed owning RED.
- [ ] Define all27 objective keys: containers registry-images/registry-tasks/
  appservice-container/containerapps-revisions/containerapps-keda/aks-manifests/
  container-diagnostics; data cosmos-query/cosmos-cost/cosmos-vector/cosmos-change-feed/
  postgres-query/postgres-schema/postgres-index/postgres-capacity/postgres-rag/
  postgres-connections/redis-cache/redis-vector; connect servicebus/eventgrid/
  functions-api/functions-host; secure vault/appconfig/otel/kql. Prefix keys with
  their Skill Area. Concepts refine these objectives with authored short review
  advice and reference IDs. Map actual Lab/Task IDs using catalog inspection,
  not guessed filenames. Unimplemented App Service and deeper ACR Tasks have
  `labIds:[]` and explicit documentation-only advice.
  Include the named example concepts containers.image-identity, data.cosmos-history,
  data.redis-cache and connect.queue-acceptance. Fixtures default to
  connect.queue-acceptance. `topics` holds assessed concepts; sparse rows are in
  assessmentNeeded. Concept references resolve against the final bank's reference
  catalog; Task4 tests use explicit primary reference fixtures until content lands.
  ```js
  const independent = latestByDistinctFamily(eligibleObservations).slice(-6)
  const mean = independent.reduce((sum,row)=>sum+row.credit,0)/independent.length
  const status = independent.length<3 ? 'insufficient-evidence'
    : mean<0.6 ? 'needs-review' : mean<0.8 ? 'developing' : 'stronger-sample'
  ```
  `latestByDistinctFamily` is private in review.js; eligibility first checks
  chronological answered/reveal exposures across attempts and active Study,
  excluding assisted first exposures, empty/incomplete components and retries.
  Tie dates by stable attempt/exposure ID, group concept parts per family,
  expose separate omitted/assisted/repeat/confidence counts. Never derive scores
  from Lab completion or reviewed/snoozed flags. Sort per spec, prefer unseen
  targeted items and show fresh-family exhaustion rather than fabricate progress.
  Recommendation `now` is an explicit safe epoch-millisecond input: snoozed notes
  suppress advice only until `snoozedUntil`, without hidden wall-clock reads or
  changing assessment evidence.
- [ ] GREEN, source/target mapping check and authored-only prompt privacy review;
  commit `feat: derive evidence-based review advice and lab links`.

## Content authoring contract for Tasks5–8

Each domain module exports `{DOMAIN}_QUESTIONS`, `{DOMAIN}_GROUPS`,
`{DOMAIN}_REFERENCES`. Domain names: CONTAINERS/DATA/CONNECT/SECURE. Each question
is original fully populated Question DTO, not generated stem variants. Question
kind/ID allocation below is fixed; group members keep those kinds. Single-choice
series items use yes/no candidates. Group background stays with its own module.

| Domain | single | multiple | build | matching | dropdown | grid | hot | screen |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| containers27 |6|4|4|4|3|2|2|2|
| data33 |6|6|5|4|5|3|2|2|
| connect30 |6|5|4|4|4|3|2|2|
| secure30 |6|5|3|4|4|4|2|2|
| total120 |24|20|16|16|16|12|8|8|

Allocate each domain's IDs in that kind order using c/d/x/s prefixes, starting
at001: `ai200-c001`, etc. For example c001–006 are single and c007–010 multiple.
Question revision1; familyId equals item ID only if genuinely independent;
equivalent items share a declared family even if it reduces fresh sample count.
Use metadata, not boilerplate loops, for real original scenario text/answers.

`tests/exam-bank.test.js` exports test descriptions tagged containers/data/connect/
secure/full-bank. Tasks run only their owning domain selector. Domain validation
function `validateDomainContent({questions,groups,references},domain)` checks
Task1 schemas and these allocations without requiring future modules. Add it
in Task5; later domain authors consume that same export. Do not make incomplete
bank modules appear published. Task8 alone creates complete bank/index.js.

For each item, record ID, concept/objective, exact primary source paths/review
date, answer justification, distractor check and reviewer outcome in
`docs/exam/bank-{domain}-review.md`. The task's independent reviewer must inspect
every answer/source relationship, batching reused primary pages rather than
one reviewer/probe per item. Mark unverifiable items unresolved; revise before
completing the task. Structural tests do not certify facts. Use only approved
primary sources; no exam-dump imports, copyrighted-question paraphrases or
runtime AI generation. Source claim/version differences are content findings.

### Task 5: Containers27 original items and first domain validator

**Files:** Create `src/data/exam/bank/containers.js`,
`src/lib/exam/bankValidation.js`, `tests/exam-bank.test.js`,
`docs/exam/bank-containers-review.md`.
**Produces:** CONTAINERS_QUESTIONS/GROUPS/REFERENCES and validateDomainContent.

- [ ] RED exact27/format-matrix/reference/answer checks; absent exports assert
  explicitly. Pin unavailable Lab recommendations and malicious references:
  ```js
  expect(CONTAINERS_QUESTIONS).toHaveLength(27)
  expect(validateDomainContent({questions:CONTAINERS_QUESTIONS,
    groups:CONTAINERS_GROUPS,references:CONTAINERS_REFERENCES},'containers')).toBe(true)
  ```
- [ ] Timed `npx vitest run tests/exam-bank.test.js -t containers` RED.
- [ ] Author c001–027 covering all seven container objectives. Case `case-c1`
  members c019/c022/c026 use a shared private-image application scenario,
  with explicit environment/secret and deployment constraints. Registry builds
  are distinguished from running images; include App Service and ACR Tasks
  despite no matching journey. Use actual CLI/schema docs for version-sensitive
  settings, not memorized outdated ports/flags. Data examples are text only.
  DTO construction pattern (complete values replace this plan example in bank):
  ```js
  const registryDecision = {
    id:'ai200-c001',revision:1,familyId:'ai200-c001',kind:'single-choice',
    domain:'containers',objectiveId:'containers.registry-images',difficulty:'medium',
    stem:'Your deployment must use the same immutable image after a tag is moved. Which image reference meets that requirement?',
    artifacts:[],presentation:{choices:[{id:'digest',label:'Image digest'},
      {id:'latest',label:'latest tag'},{id:'time',label:'Build timestamp alone'}]},
    components:[{id:'pick',conceptId:'containers.image-identity',points:1,input:'one',
      requiredCount:null,candidateIds:['digest','latest','time'],expected:'digest'}],
    groupId:null,explanation:'A digest identifies image content; a mutable tag can refer to another build.',
    referenceIds:['acr-image-reference'],csharp:null
  }
  ```
  Define/review the actual `acr-image-reference` primary URL and concept before
  accepting this item. No fake source to pass schema checks.
- [ ] Owning GREEN; editorial coverage report with27 inspected IDs; self-review
  families/counts/factual clarity. Commit `feat: author containers exam question bank`.

### Task 6: Data33 original items

**Files:** Create `src/data/exam/bank/data.js`, `docs/exam/bank-data-review.md`;
extend only data cases in tests/exam-bank.test.js.
**Consumes:** validateDomainContent. **Produces:** DATA_QUESTIONS/GROUPS/REFERENCES.

- [ ] RED exact33, all12 data objectives and required format counts:
  ```js
  expect(DATA_QUESTIONS).toHaveLength(33)
  expect(validateDomainContent({questions:DATA_QUESTIONS,groups:DATA_GROUPS,
    references:DATA_REFERENCES},'data')).toBe(true)
  ```
- [ ] Timed `npx vitest run tests/exam-bank.test.js -t data` RED.
- [ ] Author d001–033. Case-d1 members d004/d022/d030 cover constrained vector
  retrieval; case-d2 members d009/d019/d032 cover history/index/change-feed
  consequences. Include RU/index/consistency choices, pgvector operators and
  metadata filters, compute/build-memory/pooling and Redis expiration/invalidation/
  vector boundaries. Distractors must be false under stated requirements:
  ```js
    // Each decision has a component under the item's primary objective.
    // Here both decisions belong to data.redis-cache; the backing store remains
    // authoritative for durable history, while Redis is a disposable response copy.
    components:[
      {id:'hit',conceptId:'data.redis-cache',points:1,input:'one',requiredCount:null,
      candidateIds:['store','cache'],expected:'cache'},
    {id:'miss',conceptId:'data.redis-cache',points:1,input:'one',requiredCount:null,
      candidateIds:['store','cache'],expected:'store'}]
  ```
  State the concrete application's durable-history/cache requirements and verify
  source context; do not claim those technologies are universally exclusive.
- [ ] GREEN data selector, editorial ledger33 IDs and family/objective coverage;
  commit `feat: author data exam question bank`.

### Task 7: Connect30 original items

**Files:** Create `src/data/exam/bank/connect.js`, `docs/exam/bank-connect-review.md`;
extend connect test cases only. **Produces:** CONNECT_QUESTIONS/GROUPS/REFERENCES.

- [ ] RED exact30, routing/deadletter/retry/HTTP binding concepts and groups:
  ```js
  expect(CONNECT_QUESTIONS).toHaveLength(30)
  expect(CONNECT_GROUPS.find(g=>g.id==='series-x1').questionIds)
    .toEqual(['ai200-x001','ai200-x002','ai200-x003'])
  ```
- [ ] Timed `npx vitest run tests/exam-bank.test.js -t connect` RED.
- [ ] Author x001–030. Series-x1 uses x001–003 with one shared problem and three
  independent proposed-solution yes/no answers. Case-x1 x009/x020/x029 continues
  an order API/message/event scenario. Cover topics/subscriptions/filters,
  settlement/redelivery/DLQ, Event Grid filter/retry semantics and Functions
  HTTP/deployment/bindings. Distinguish accepted work from processed work:
  ```js
  presentation:{choices:[{id:'yes',label:'Yes'},{id:'no',label:'No'}]},
  components:[{id:'meets-goal',conceptId:'connect.queue-acceptance',points:1,input:'one',
    requiredCount:null,candidateIds:['yes','no'],expected:'no'}]
  ```
  The concrete problem must explicitly require completed processing; a proposed
 202 alone then cannot meet it. Each proposed solution's rationale is original.
- [ ] GREEN, primary-source editorial checks30 IDs; commit
  `feat: author messaging and functions exam question bank`.

### Task 8: Secure30 original items and complete120 bank assembly

**Files:** Create bank/secure.js, bank/index.js under src/data/exam;
`docs/exam/bank-secure-review.md`, `docs/exam/bank-coverage.md`; extend full-bank
and secure cases in tests/exam-bank.test.js; modify `src/data/exam/index.js`
and `src/lib/exam/bankValidation.js` for the declared complete-bank exports.
**Produces:** SECURE_QUESTIONS/GROUPS/REFERENCES, `loadExamBank()` in
src/data/exam/index.js (lazy import), `EXAM_BANK` in bank/index.js,
`validateExamBank(bank)`, `bankCoverage(bank)` in bankValidation.js.

- [ ] RED secure30 and full120 allocations; all27 objective keys, all references/
  families/Lab mappings, complete groups and constrained draw feasibility:
  ```js
  expect(EXAM_BANK.questions).toHaveLength(120)
  expect(bankCoverage(EXAM_BANK).byKind).toEqual({
    'single-choice':24,'multiple-response':20,'build-list':16,matching:16,
    dropdown:16,'statement-grid':12,'hot-area':8,'active-screen':8})
  for (const size of [40,50,60]) expect(drawMock(EXAM_BANK,{size},23).order).toHaveLength(size)
  ```
- [ ] Timed `npx vitest run tests/exam-bank.test.js -t 'secure|full-bank'` RED.
- [ ] Author s001–030: series-s1 s001–003; case-s1 s004/s019/s027;
  case-s2 s009/s024/s029. Cover vault retrieval/rotation and actual permissions,
  AppConfig labels/refresh/vault references, distributed context/log hygiene and
  KQL filtering/aggregation. Original code/dropdown items use real SDK/KQL syntax,
  not the trainer-only query helper as a production API. Assemble named exports:
  ```js
  export const EXAM_BANK = Object.freeze({version:1,revision:1,
    questions:[...CONTAINERS_QUESTIONS,...DATA_QUESTIONS,...CONNECT_QUESTIONS,...SECURE_QUESTIONS],
    groups:[...CONTAINERS_GROUPS,...DATA_GROUPS,...CONNECT_GROUPS,...SECURE_GROUPS],
    references:[...CONTAINERS_REFERENCES,...DATA_REFERENCES,...CONNECT_REFERENCES,...SECURE_REFERENCES]})
  export const loadExamBank = async () => (await import('./bank/index.js')).EXAM_BANK
  ```
  If reused reference IDs have differing definitions, reject instead of silently
  overwriting; author globally prefixed IDs or canonical identical shared refs.
  Coverage lists missing objectives/families and recommends assessment-needed
  for sparse concepts, not fake independent observations. Check all three Mock
  presets and a few deterministic seeds in pure tests, not120 session replays.
- [ ] GREEN secure/full-bank, complete editorial coverage with no unresolved
  item correctness/source finding. Commit `feat: complete reviewed AI-200 question bank`.

### Task 9: Eight accessible widgets and question presentation

**Files:** Create components/exam/{QuestionRenderer,SingleChoice,MultipleResponse,
BuildList,Matching,DropdownQuestion,StatementGrid,HotArea,ActiveScreen,QuestionFeedback}.vue;
`src/styles/exam.css`; `tests/helpers/mountExam.js`; `tests/exam-widgets.test.js`.
Modify package/lock for dev-only jsdom26.1.0.
**Consumes:** Task1 publicQuestion/applyAnswerEdit; no private expected answers
passed to input widgets. **Produces:** widgets props `{question,value,disabled}`,
emits `update:value` with whole Answer; feedback receives explicit Grade only
when permitted. Renderer maps all eight kinds, unknown kind fails visibly.

- [ ] RED real Vue DOM interactions, not source-text assertions: every widget
  changes the same canonical Answer, placeholders unanswered, build/match pointer
  and keyboard equivalence, hot-area labels, disabled edits, safe note/code text.
  Use jsdom Vitest file pragma and direct Vue mount (no test-utils dependency):
  ```js
  // @vitest-environment jsdom
  import {createApp,nextTick} from 'vue'
  const host = document.createElement('div'); document.body.append(host)
  const answers = []
  const app = createApp(QuestionRenderer,{question:publicQuestion(questionFixture('single-choice')),
    value:{},'onUpdate:value':value=>answers.push(value)})
  app.mount(host); host.querySelector('input[type=radio]').click(); await nextTick()
  expect(answers[0]).toEqual({pick:host.querySelector('input:checked').value})
  app.unmount(); host.remove()
  ```
  `mountExam` centralizes app unmount/cleanup and reactive props; use DOM
  KeyboardEvent/change/drop adapters for this small unit scope.
- [ ] Execution-time `npm install --save-dev --save-exact jsdom@26.1.0` and timed
  owning RED. Do not upgrade existing Vite/Vitest or run other browser suites.
- [ ] Implement semantic controls with the shared edit function; `.prevent` only
  where required by actual drag gesture, not blanket keyboard interception.
  ```vue
  <button type="button" aria-label="Move selected action up" :disabled="disabled || index===0"
    @click="emit('update:value',applyAnswerEdit(question,value,{type:'move',componentId:question.components[index].id,toComponentId:question.components[index-1].id}))">
    Move up
  </button>
  ```
  Build-list has candidate selection plus reorder/remove; matching states reuse
  policy and supports assignment dropdowns; hot region buttons/text list share
  IDs; active-screen named selects/radios start unset. Responsive class-scoped
  styles stack panes, visible focus, readable code/no overflow; do not edit
  existing journey CSS. Feedback shows component reasons and approved source
  links, not hidden answer JSON in active Mock inputs. Use frontend-design skill
  at approved implementation time, preserving the current visual language.
- [ ] Owning GREEN and focused accessibility self-review; commit
  `feat: add accessible mixed-format exam question widgets`.

### Task 10: Save orchestration, integrated routes, history and review UI

**Files:** Create `src/stores/exam.js`; five named pages from file map;
components/exam/{ExamSetup,SectionNavigation,CaseReference,ExamTimer,BackupControls,
ReviewRecommendation}.vue; `tests/exam-app.test.js`; modify router/index.js,
HomePage.vue, PortalHeader.vue only for lazy exam routes/entry. Add
`tests/browser/exam-persistence.html` and `.browser.js` for bounded native smoke.
**Consumes:** Tasks1–9 contracts/repository/bank/widgets/review/Lab adapter.
**Produces:** `useExamStore()` with `hydrate`, `start`, `dispatch`, `flush`,
`saveNote`, `setPracticeGoal`, `previewImport`, `applyImport`, `exportBackup`,
`deleteAttempt`, `reset`; state ready/loading/saving/error, snapshot and session
presenters. Getter correctness never depends on optimistic unacknowledged state.
`dispatch(action,{sessionId}={})` defaults to the active session; completed review
explicitly supplies the attempt's sessionId and reviewReveal before showing a
previously omitted question's answer. Storage failure cannot falsely acknowledge
that exposure. No active-Mock review bypass or mutable Result answers.

- [ ] RED store/view integration with fake-indexeddb and actual Vue controls:
  rapid save->seal/expiry, storage failure freeze/retry, two-tab conflict,
  Study reveal/submit/notes/history, retained result keys, active Mock direct
  review/Study route redirect, existing Lab store unchanged. One compact mixed
  mock episode exercises one input of each kind plus cases/series; remaining
  fixture answers are dispatched through normal reducer/repository, not direct
  Result injection. One study/persistence/review/Lab-link episode completes it.
  ```js
  await store.start({mode:'study',size:5,seed:31})
  await store.dispatch({type:'answer',questionId:store.session.order[0],answer:{pick:'a'}})
  await store.flush()
  expect(store.saveStatus).toBe('saved')
  await store.dispatch({type:'submitQuestion'})
  expect(store.presentation.feedback).not.toBeNull()
  ```
- [ ] Timed `npx vitest run tests/exam-app.test.js` RED. Every referenced store
  property in tests is defined in this Task's handoff, not a guessed mock.
- [ ] Serialize writes with a Promise queue capturing event time at input.
  Store resolves Saved after tx completion. Seal/navigation/finish flush first;
  expiry disables inputs immediately and enqueues finish after observed pending
  edits. An already queued pre-deadline edit is applied using its original
  observed time; conflict recovery cannot silently replay it into another
  revision/section. Surface retry/reload and export-memory recovery instead of
  losing it. Rehydration uses acknowledged DB state and tick/finish actualexpired
  sessions. Do not reveal scores on unpersisted completion.
  ```js
  async function sealSection() {
    await store.flush()
    await store.dispatch({type:'sealSection'})
    // Route/cursor moves only after the committed snapshot returns.
  }
  ```
  Pages show explicit practice instructions/quotas/goal, timer/break warnings,
  section review grids and case context. Backup preview/conflicts and destructive
  confirmations are explicit. Review renders evidence counts/omissions/assistance/
  repeat exposure separately and honest no-fresh-item/no-matching-Lab messages.
  Recommendation Lab links include a safe review return link but never modify
  native Lab state. Router imports exam store dynamically only on exam/review
  navigation; active Mock blocks feedback routes, not existing Lab engines.
  Home/header entry adds no synchronous question-bank import. Microsoft Learn
  button opens its official home, noopener/noreferrer, without pausing timer.
- [ ] Owning GREEN. Run one native IndexedDB smoke using a uniquely named test
  DB from the existing browser-fixture pattern; test acknowledged close/reopen
  and atomic finalization/backup with no user's exam or Lab DB deletion. Small
  rendered viewport/focus check only, no broad browser workflow. Record whether
  actually run; inability to use browser is an explicit verification gap, not
  substituted fake claim. Commit `feat: integrate exam sessions and saved review dashboard`.

### Task 11: Bank/editorial release gate, docs and bounded final verification

**Files:** Create `docs/exam-review-simulator.md`,
`docs/superpowers/plans/2026-10-06-exam-review-handoff.md`;
modify README.md/package.json/.github/workflows/pages.yml and test assertions
only where necessary for exact aggregate/catalog/route checks.
**Consumes:** All earlier gates, four domain editorial reports and actual bank.

- [ ] Pin exact120/allocations/27 objectives/eight widgets/groups, primary URL
  policy, lazy routing/no bank in initial Home import graph and read-only Lab
  mappings. Sources/editorial answer review must already have been independently
  approved per domain. No new per-item review fleet or schema-only fact claim:
  ```js
  expect(bankCoverage(await loadExamBank()).missingObjectives).toEqual([])
  expect(validateLabMappings(EXAM_CONCEPTS,LABS)).toBe(true)
  expect(EXAM_BANK.questions.some(q=>q.objectiveId==='containers.appservice-container')).toBe(true)
  ```
- [ ] Add exact script (seven files), then one normal Pages CI step before build,
  with no bypass or obsolete full suite:
  ```json
  "test:exam-review": "vitest run tests/exam-contracts.test.js tests/exam-session.test.js tests/exam-persistence.test.js tests/exam-review.test.js tests/exam-bank.test.js tests/exam-widgets.test.js tests/exam-app.test.js"
  ```
  Docs explain every format/rule, practice goal vs scaled score, local saving/
  backup/origin loss, stale content, allowed historical imports, own notes/privacy,
  repeat-family/sparse evidence and missing Lab coverage. Record dependencies
  added only for tests, official reference dates, actual verification gaps,
  review verdicts/rulings/costs and no real exam/cloud/AI backend. Update the
  approved spec's status without replacing its agreed design with implementation
  notes. Do not move or delete user checkpoint reports.
- [ ] Timed final `npm run test:exam-review` once. Compatibility once, exactly
  `npx vitest run tests/progress-store.test.js tests/behavioral-store.test.js tests/http-functions-catalog.test.js`.
  No AKS/Container Apps tests. One `npm run build -- --base=/Azure-Trainer/`.
  If failure, inspect and rerun only amended covering paths; preserve every
  elapsed/session/exit record. Do not run `npm test` alone. Keep existing advisory/
  bundle warning visible; do not force dependency upgrades or hide chunk warning.
- [ ] Self-review spec coverage and source editorial completion; commit
  `feat: finish AI-200 exam and review integration`. Handoff local reviewed branch,
  not published success. Controller schedules the one final whole-branch review,
  then one aggregate fix wave/scoped check if needed and finishing workflow.

## Controller execution policy

Recommend subagent-driven execution: one fresh implementer per Task, spec AND
quality gate after each. For Tasks5–8 that reviewer also independently checks all
domain facts/source links; repeat-source documents may be read once and mapped
to multiple question IDs. No extra untracked editorial approval is invented.
Record actual BASE/HEAD ranges and exact handoff interfaces. Fix rounds resume
owners; do not re-dispatch completed tasks after compaction. Native inline
execution is an alternative if the user selects it; the same content/source and
verification requirements still apply, with one final independent reviewer.

In Native execution, domain ledgers distinguish author verification from actual
independent approval; the final reviewer checks all120 items/source relationships
and records domain verdicts before release. Do not invent per-task approvals or
silently substitute schema tests for that editorial check. Subagent execution
records the same factual checks at each domain gate without a second review fleet.

Every test/read/diagnostic/build attempt is timed, failures included. Preserve
exec session IDs through completion; never call truncated/lost output passing.
Keep a plan-owned progress ledger. If tests pass30minutes for a publication,
profile/simplify the slow checks, not correctness. No sleeps to test deadlines,
120 exam replays, global legacy replay, unrelated dependency upgrades, automatic
remote action or sibling-worktree cleanup. Raw evidence and durable handoff
retain decisions/costs before any separately authorized cleanup.

## Inline plan self-review

| Spec requirement | Owning Task |
| --- | --- |
| All formats/grade/answer IDs/privacy/bounds |1/9|
| Blueprints/groups/section/break/timer/feedback |2/10|
| Save ack/conflict/historical keys/backup/reset |3/10|
| Weak evidence/unfinished assistance/lab mapping |4/10|
|120 factual questions/cases/series/allocations |5–8|
| Lazy integrated routes/responsive accessibility |9/10|
| Source/editorial evidence/docs/CI/focused gates |5–8/11|

Shared interface checks: Task1 DTOs feed2/3/4/5–9; Task2 transition results feed
3/10 without caller grades; Task3 snapshots/revisions feed4/10; Task4 objective/
concept IDs feed5–8/10; four domain exports feed8 without shared author edits;
Task8 lazy bank feeds2/10 only after completeness; Task9 Answer emits feed10's
durable queue, not direct grading; Task11 preserves all exact scripts/routes.
No mismatched producer names, hidden bank dependencies, undefined future mock
methods, task requiring an unavailable module at its GREEN gate or independent
subsystem needing a separate deployment was found. Five Review Focus risks each
have named owning RED/negative assertions. Quota/format matrix sums120 and groups
retain existing kinds/counts. Test-only tool engines preserve Node18 floor and
Node22 CI; no tool installed while planning. No implementation started.
