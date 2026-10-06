# HTTP Functions journey — implementation handoff

## Scope and current status

Approved nine code-first Labs for the Order Processing Application: eight guided
Labs and one Capstone. Local branch `codex/http-functions`, based on main
`d073ccd`; no new merge, push or publication authority was inferred. Tasks 1–5
have passed independent spec and quality review. Task 6 has now passed its
independent gate too. After the user resumed, the single correction wave fixed
all three whole-branch findings. The original final reviewer approved the scoped
fix with no new breakage or out-of-scope issues. Product HEAD:
`04265015e793e1ca4f3058e67c3f3419bffcd119`. Implementation is technically ready
for integration; no merge, push or publication has occurred. The branch/worktree
and local execution reports are preserved pending the user's integration choice.

The implementation uses the isolated worktree
`E:/Projects/Vue/Azure-Trainer/.superpowers/worktrees/http-functions`. Existing
Security and other worktrees remain untouched. No blocked cleanup was retried.

## Decisions, review resolutions and their costs

1. Honor the user's delegation of remaining recommendations, write the design
   and plan, then implement without another approval menu. Cost if wrong:
   inspectable design choices may require visible rework; no remote authority.
2. Choose nine Labs, not fifteen, and extend base Messaging with an explicit
   HTTP profile instead of aliasing Security. Cost: future security/telemetry
   integration needs explicit scope; existing profiles stay unchanged.
3. Separate local captured hosts from published captures; enforce function keys
   only on published function-level routes. Include one queue-output lesson.
   Cost: explicit capture/session integration rather than a real server.
4. Derive status from real target/order processing provenance, not a global
   processed flag. Cost: additional origin metadata and bounded trace checks.
5. Permit disclosed earlier raw queue input only if no HTTP acceptance exists
   for that target/order. Once accepted, require exact app/target ownership.
   Cost: shared-queue multi-app semantics would need a later explicit extension.
6. Use actual broker traces plus retained authoritative execution-receipt traces
   after global trace eviction; do not create a second journal. Cost: runtime
   admission must still prove the owning request and command.
7. Derive accepted-send ownership from request send IDs and the authoritative
   journal, rather than accepting caller-supplied request proof. Cost: Task 3
   must enforce app, scope, capture generation, invocation and command boundaries.
8. Independent Task 1 review found active app-keyed maps could not retain old
   captures and path parsing decoded parameters twice. Fix both before consumers.
   Cost: one compact contract fix/re-review; retained arrays/current maps and a
   separate raw-path/decoded-path boundary replace the initial DTO proposal.
9. Permit the minimal HTTP exercise-mode validator hook in messaging/shell.js.
   Cost: a narrow shared mode change needs compatibility coverage.
10. Record read.atNextId from the actual lookup boundary, distinguishing reads
    before versus after a same-command send. Cost: a small measurement schema
    refinement carried through restore validation.
11. Carry private fixture values into ordinary HTTP-profile worker execution
    without classifying the script as an HTTP request. Cost: a minimal private
    VM/execute bridge and a focused privacy regression.
12. Preserve completed SDK sends when later response validation fails; discard
    staged output on failure and validate before binding flush. Cost: distinct
    documented transactional teaching boundaries, not automatic blanket rollback.
13. Retain bounded capture history and require the latest current generation;
    GET sends cannot receive POST acceptance. Cost: compact restore/admission
    hardening tests, not broad replays.
14. Use one behavioral verification per Lab plus a current retained-request
    episode predicate. Cost: construction steps share one episode rather than
    independent same-mode checks superseding each other's evidence.
15. Export and protect the supplied actual queue worker through the existing
    runtime-file contract. Cost: a narrow template refinement and adaptation of
    the old privacy test to an editable ordinary script, without relaxing privacy.
16. Do not accept repeated malformed 400s as distinct validation cases or silently
    execute incorrect not/or precedence. Cost: narrow HTTP prerequisites rather
    than a broad interpreter or grammar rewrite.
17. Fail closed on ambiguous unparenthesized leading not with and/or in the HTTP
    profile; parentheses or separate if statements remain supported. Cost: this
    bounded syntax limitation must be explicit in learner and simulator docs;
    legacy profiles are unchanged, not claimed repaired.
18. Derive value-free inputClass only inside the trusted host, mirror it in Request
    and Invocation, and require matching closed schemas. Cost: unpublished HTTP
    snapshots lacking the field reject instead of migrating; legacy saves stay
    unchanged. No raw body, key or hash is persisted; classification never creates
    a learner response. Coherent wholesale storage rewriting is not cryptographic
    tamper protection.
19. Protected canonical input receives a value-free protected class, not exposed
    values. Cost: explicit category handling; protected/auth/routing failures do
    not count as learner validation proof.
20. Require JSON media type where the health task explicitly asks for JSON.
    Cost: one tiny predicate fix plus real text/plain negative/charset positive
    selected tests and original-reviewer re-review.
21. Configure cloud settings before collecting local/cloud comparisons. Test
    disabled-queue flush separately instead of requiring stale observations across
    resource changes. Cost: concise feasible episodes, not artificial experiments.
22. Require the same canonical valid order for key denial/grant comparisons.
    Cost: one semantic grading fix; malformed denied requests cannot substitute.
23. Keep existing dependency advisories in scope as reported facts, not forced
    upgrades. Cost: the existing three moderate, one high and one critical npm
    advisories remain separately actionable.

## Verification accounting before Task 6

Development used only owning HTTP files and precisely affected selectors.
No AKS, Container Apps, full, cloud, Python-process or broad browser suite ran.
Every known failed test, setup retry and successful rerun is included.

| Work | Known elapsed |
| --- | ---: |
| Initial focused 40-test baseline | 13.2273929 s |
| Task 1 tests, all nine attempts | 52.253 s |
| Task 1 fix tests, three attempts | 21.922 s |
| Task 2 tests, thirteen attempts | 82.301 s |
| Task 3 completed test attempts | 107.870 s |
| Task 4 tests and affected selectors | 65.314 s |
| Task 4 MIME fix selected tests | 14.951 s |
| Task 5 tests, five attempts | 77.714 s |

Known completed verification/diagnostic/commit accounting through Task 5:
470.0761619 seconds. Setup/npm ci is recorded separately. One Task 3 wrapper
discarded a yielded session's result: minimum ten seconds, final duration and
result unavailable. It was not called passing; a later complete 15/15 run supplied
the evidence. No precise combined upper bound is claimed. Subsequent owners
retained yielded sessions through completion. An initially missing review-read
duration was recovered as 152 ms plus 70 ms for its fix review.

Detailed execution reports and actual range packages are retained in this
plan's own ignored `.superpowers/sdd/2026-10-05-http-functions-learning-journey/`
directory. The final durable summary will record Task 6, final review and local
handoff results before any cleanup; no cleanup or publication is authorized here.

## Task 6 and final gates

Product commit `ef4d258` completes the capstone/catalog/docs/normal CI integration.
The capstone explicitly protects POST and GET order routes and reuses the supplied
worker. Its independent review approved spec and quality with no findings.

| Final verification | Result | Elapsed |
| --- | --- | ---: |
| Capstone/catalog owning gate | 11/11 | 19.251 s |
| Seven-file HTTP aggregate, once | 94/94 | 19.102 s |
| Six named compatibility files, once | 167/167 | 11.854 s |
| Pages-base build, once | Exit 0 | 14.970 s |

Task 6 all test attempts, including artifact-load and fixture failures:
101.127 seconds; build 14.970 seconds; all recorded shell work 120.0266926 seconds.
The grouped official-reference read has a disclosed 2.6-second wall time overlapping
a 149-ms shell diagnostic; separate network timing is unavailable, not duplicated.

The build retains its >500-kB chunk warning: index bundle 3,007.68 kB, gzip
827.83 kB. Tests have no warnings. Existing dependency advisories were not changed.
No AKS/Container Apps/full/cloud/Python/browser suite, CI execution or deployment ran.

Task 6's focused review risk—extra enqueue through an edited worker—was resolved
by the protected source contract (`SCAFFOLD_MODIFIED`), with one real message and
enqueue. Same-request extra SDK sends already fail the exact one-operation/one-
enqueue helper. Cost: one 2.270-second in-process diagnostic and 291 ms of
dependency reads, no second probe or suite rerun.

Known completed verification/diagnostic/commit accounting before the whole-branch
review: 595.2798545 seconds, plus the explicitly separate unknown Task 3 attempt
and overlapping reference-read wall time. The final review package covers published
base `f7c3701` through `ef4d258`, including the approved initial discussion/glossary
and thirteen scoped commits. No integration or publication is claimed.

## Pause and remaining correction

Historical checkpoint: the pause below was revoked by the user's `ok continue`.
All remaining corrections are now resolved; see final approval below.

Paused explicitly by the user on 2026-10-05 around17:54 Europe/Bucharest.
`/root/http_python_runtime` was interrupted; no other subagent remains running.
Product HEAD is `ef4d2581fba87d69a9ecf667d1dc31222a4b3de3`, with no pending product
edits. This controller handoff remains untracked and must be preserved.

Fix the supported HTTP json.loads malformed-input ValueError mismatch; apply
JSON MIME checks to successful basic responses; align key-Lab required proof to
one canonical denial plus actual grant/local retry rather than pretending two
denied receipts distinguish missing from wrong keys. Cost: one scoped correction
wave and original final reviewer's scoped re-check, no broader runtime/auth rewrite.
Final reviewer recorded34ms read plus937ms failed shell diagnostic before product
execution; known accounting596.2508545s plus previously disclosed separate gaps.

All five final-review exclusions were accepted within the approved boundaries:
real Azure/full Python/C# execution (separate verification later); production
concurrency/transactions/secrets (separate architecture later); coherent wholesale
storage rewrites (no cryptographic tamper protection); broad UI/full/AKS/Container
Apps suites (broader confidence deferred per user policy); inherited advisories/
bundle warning (separate debt). The detailed reasons/costs are saved in
`final-review-report.md` and the main-root resume file points to it.

## Correction and final approval

`0426501 fix: align HTTP parsing and journey completion checks` changes eight
scoped files. HTTP json.loads tags only malformed SyntaxError as ValueError,
after rethrowing existing diagnostics; privacy/limits/unsupported/type errors
and legacy behavior are unchanged. Successful basic JSON response predicates
use the existing JSON MIME validator, while plain-text error responses remain
allowed. Key completion requires one canonical denied POST, real cloud acceptance
and keyless local retry; missing/wrong headers are examples, not falsely distinct
proof. No auth DTO or raw key/header metadata was introduced.

| Fresh amended-file coverage | Result |
| --- | ---: |
| HTTP SDK | 25/25 |
| Basic Labs | 18/18 |
| Hosting Labs | 16/16 |

The combined covering invocation initially had four new test-only basic receipt-
filter failures; SDK and hosting passed. Filtering to actual request receipts
fixed the tests, then the basic file passed. No product change followed the SDK/
hosting passes. This is 59 covered passing tests across the three files, not a
claim that the failed combined invocation itself passed. All eight correction
attempts, including REDs and that retry, total52.283 seconds; all recorded shell
work53.597 seconds. No aggregate/compatibility/build rerun or new timing gap.

Original final reviewer: all THREE findings ADDRESSED; no new breakage; no
out-of-scope observations; technically ready to merge YES. Scoped range
`ef4d258..0426501`; raw fix report and actual diff package retained locally.
Re-review reads84+65=149ms, no executable diagnostic or suite rerun.

Known completed verification/diagnostic/commit accounting through re-review:
650.5618545 seconds, plus the previously disclosed Task3 unknown-result attempt
and overlapping official-reference-read wall time. Resume inspection/skill reads
are separately lightweight recovery setup; no tests were regenerated for status.

Ruling: preserve this plan's ignored execution artifacts and worktree while
awaiting integration, rather than deleting the user's checkpoint targets.
Reason: the explicit pause/resume workflow and retained raw evidence need them.
Cost if wrong: temporary disk space, no irreversible loss or cleanup bypass.
All earlier rulings/costs and accepted final-review exclusions remain documented
above. Existing advisory/bundle debt remains. Final code was independently
reviewed; this final handoff-only documentation commit does not change product.

## Local integration — 2026-10-06

The user selected option1, merge locally into main. Verified main was d073ccd
and the feature worktree was clean, then fast-forwarded main to f7bff73.
No pull, push, remote publication or unrelated change was included.

Fresh merged-result verification: `npm run test:http-functions`, exactly seven
HTTP owning files, **105/105 passed**, exit0, Stopwatch13.335 seconds. Complete
yielded session39559 was retained through its final output. Merge147ms; no AKS,
Container Apps, full/cloud/Python/broad-browser tests or duplicate build ran.

The only pre-existing main untracked file was the user's requested
RESUME-HTTP-FUNCTIONS.md; it remains preserved and updated. Product code is
unchanged from the reviewed branch; this integration record is documentation only.

Ruling: retain the feature worktree/branch and ignored raw reports after merging
because checkpoint links still reference unique local execution evidence.
Cost if wrong: temporary disk space; no irreversible report loss or cleanup
against other worktrees. Cleanup can be a separate explicit archival action.
