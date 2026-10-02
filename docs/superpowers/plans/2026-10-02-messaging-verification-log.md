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

Task 1 test total, including RED and rerun: **4.698050 seconds**.

Task 2 test total, including initial RED and all reruns: **14.318056 seconds**.

Cumulative known testing, including the controller baseline: **22.673727 seconds** (0.377895 minutes).

Task 1 also passed `git diff --check`. Git emitted Windows LF-to-CRLF conversion notices; there were no whitespace errors. This is not a test invocation and is excluded from the test-time total.
