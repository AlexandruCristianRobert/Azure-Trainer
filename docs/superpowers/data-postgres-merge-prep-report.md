# Main integration preparation

User requested local merge to main, automatic terminal refocus after Enter, then push origin/main. Changes made in the existing PostgreSQL worktree before integration.

## Terminal

Root cause: the running state unmounts the prompt; the engineVersion2 running watcher deliberately does not refocus it. Submission now awaits scrollToBottom's nextTick and then focuses the replacement input. Background running-state changes remain unchanged; optional ref is harmless when the prompt is absent/read-only.

One Node-only component regression compiles the actual client SFC and uses Vue's renderer/scheduler with a tiny host; only asynchronous store I/O is substituted. It proves input removal during execution, replacement focus after success/error, and ability to type the next command. No browser test or DOM dependency install.

RED: npm.cmd test -- tests/shell-terminal-focus.test.js failed at replacement focus (active=null). Initial test harness needed client rather than SSR compilation and minimal host DOM methods; these harness errors were corrected without production changes. GREEN: focus test passes, including both completion paths.

## Pool residual

The user authorized integration; the previously disclosed residual was closed first. PG SQL traces now carry request-local poolIdentity based on the actual connection's pool object. Repeated checkouts share identity; distinct pools differ even with equal settings. Load simulation accepts exactly one actually used module-pool identity or direct clients; multiple active pools fail closed with400 instead of understated reservations. Unused globals and direct PgBouncer remain accepted. No pool formulas or Cosmos call shape changed.

One SDK core regression RED observed undefined identities; GREEN asserts [1,1,2] across repeated/distinct checkouts. Disposable inline Node probe rebuilds/redeploys the v3 app and verifies: two used pools rejected400/30000 failed, one used plus unused global passes, direct6432 plus unused global passes with poolMaxSize0 and null identities. Probe passed in2.481s; no disk script or Azure/network calls.

## Verification

- Focused focus+SDK:12/12 pass,1.382s.
- Explicit five files: npm.cmd test -- tests/shell-terminal-focus.test.js tests/data-pg-sql.test.js tests/data-pg-plan.test.js tests/data-python-sdk.test.js tests/data-postgres-labs.test.js —34/34 pass,8.639s.
- npm.cmd run build —exit0,535 modules,4.940s. Existing bundle-size advisory only.
- No full, AKS, ContainerApps or browser suites. Testing remains seconds, below30minutes.

Focused review and merged-tree verification follow before origin/main push.
