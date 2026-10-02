# Messaging learning journey verification log

All times below are elapsed wall-clock seconds around the complete test invocation, not Vitest's internal test-body duration. Baseline timing was supplied by the controller; subsequent invocations were measured with PowerShell `System.Diagnostics.Stopwatch`.

Only owning focused checks are authorized. Full, AKS, Container Apps, legacy replay, cloud integration, and broad browser suites were not run.

| Date | Stage | Command | Result | Elapsed seconds |
| --- | --- | --- | --- | ---: |
| 2026-10-02 | Controller baseline | `npm test -- tests/project-editor-keyboard.test.js` | 8/8 passed (controller-provided evidence) | 3.657621 |
| 2026-10-02 | Task 1 RED | `npm test -- tests/messaging-rationale.test.js` | Expected missing `explanationPrompt.js`; suite failed before collecting tests, exit 1 | 1.462187 |
| 2026-10-02 | Task 1 GREEN | `npm test -- tests/messaging-rationale.test.js` | 11/11 passed, exit 0 | 1.640123 |
| 2026-10-02 | Task 1 final focused check | `npm test -- tests/messaging-rationale.test.js` | 12/12 passed after adding direct prop-change race coverage, exit 0 | 1.595740 |
| 2026-10-02 | Task 2 initial RED | `npm test -- tests/messaging-servicebus.test.js` | Expected missing `messaging/state.js`; suite failed before collecting tests, exit 1 | 1.375247 |
| 2026-10-02 | Task 2 GREEN | `npm test -- tests/messaging-servicebus.test.js` | 15/15 passed, exit 0 | 3.537854 |
| 2026-10-02 | Task 2 self-review regression RED | `npm test -- tests/messaging-servicebus.test.js` | 16 passed, 2 expected failures: ReceiveDisabled send-copy gate and persisted identity validation, exit 1 | 3.169849 |
| 2026-10-02 | Task 2 status-gate correction | `npm test -- tests/messaging-servicebus.test.js` | 17 passed, persisted identity validation remains expected RED, exit 1 | 3.140021 |
| 2026-10-02 | Task 2 final GREEN | `npm test -- tests/messaging-servicebus.test.js` | 18/18 passed, exit 0 | 3.095085 |
| 2026-10-02 | Task 2 review diagnostic | Inline `node --input-type=module` (exact command/output in task-2-review.md) | Reproduced malformed status and sparse dedup acceptance, exit 0; supplied tool wall time, not rerun | 0.0744888 |
| 2026-10-02 | Task 2 fix round 1 RED | `npm test -- tests/messaging-servicebus.test.js` | 18 passed, 2 expected malformed-persistence failures (`expected true to be false`), exit 1 | 3.139284 |
| 2026-10-02 | Task 2 fix round 1 GREEN | `npm test -- tests/messaging-servicebus.test.js` | 20/20 passed, exit 0 | 3.112894 |

Task 1 test total, including RED and rerun: **4.698050 seconds**.

Task 2 test total, including initial RED and all reruns: **14.318056 seconds**.

Task 2 fix round 1 test total: **6.252178 seconds**. Total Task 2 npm/Vitest invocation time including fixes: **20.570234 seconds**, plus the supplied review diagnostic **0.0744888 seconds**.

Cumulative known verification, including the controller baseline and supplied review diagnostic: **29.0003938 seconds** (0.483340 minutes).

Task 1 also passed `git diff --check`. Git emitted Windows LF-to-CRLF conversion notices; there were no whitespace errors. This is not a test invocation and is excluded from the test-time total.

## Task 3 source lowering and VM

Every test invocation below used only the owning file. Diagnostics and all RED/error reruns are included; each invocation was measured with PowerShell Stopwatch.

| Date | Stage | Command | Result | Elapsed seconds |
| --- | --- | --- | --- | ---: |
| 2026-10-02 | AST inspection quoting correction | Inline `node --input-type=module -e` Lezer inspection | PowerShell removed quotes; Node SyntaxError, exit 1 | 0.0446033 |
| 2026-10-02 | AST inspection | PowerShell here-string piped to `node --input-type=module` | Lezer node tree for imports/annotations/dict/list/with/for/if/calls printed, exit 0 | 0.0877604 |
| 2026-10-02 | Task 3 initial RED | `npm test -- tests/messaging-python.test.js` | Expected missing `messaging/python.js`; no tests collected, exit 1 | 1.2498773 |
| 2026-10-02 | Task 3 first GREEN | `npm test -- tests/messaging-python.test.js` | 15/15 passed, exit 0 | 1.4205397 |
| 2026-10-02 | Task 3 semantic regression RED | `npm test -- tests/messaging-python.test.js` | 20 passed, 7 failed: branch/list receiver preflight, top-level effects, dotted imports, output, fixture limits; exit 1 | 2.9063045 |
| 2026-10-02 | Task 3 semantic GREEN | `npm test -- tests/messaging-python.test.js` | 27/27 passed, exit 0 | 1.4713172 |
| 2026-10-02 | Task 3 annotation/input RED | `npm test -- tests/messaging-python.test.js` | 29 passed, 2 failed: executable annotations and mutable handler fixture; exit 1 | 1.5212338 |
| 2026-10-02 | Task 3 correction rerun | `npm test -- tests/messaging-python.test.js` | JavaScript ASI syntax error in added annotation loop; no tests collected, exit 1 | 1.2129749 |
| 2026-10-02 | Task 3 annotation/input GREEN | `npm test -- tests/messaging-python.test.js` | 31/31 passed, exit 0 | 1.5803462 |
| 2026-10-02 | Task 3 final preflight RED | `npm test -- tests/messaging-python.test.js` | 31 passed, 3 failed: empty-loop receiver merge, mutated list aliases, literal unsafe dictionary keys; exit 1 | 1.5019686 |
| 2026-10-02 | Task 3 final GREEN | `npm test -- tests/messaging-python.test.js` | 34/34 passed, exit 0; test bodies 114ms | 1.4883258 |

Task 3 npm/Vitest total: **14.3528880 seconds**. Task 3 diagnostic total: **0.1323637 seconds**. Task 3 combined: **14.4852517 seconds**.

New cumulative known verification: **43.4856455 seconds (0.724761 minutes)**, starting from the previously recorded **29.0003938 seconds**. No full suite, AKS, Container Apps, legacy replay, cloud, browser or build checks ran. Static `git diff --check` passed; Windows line-ending notices are not test failures.
