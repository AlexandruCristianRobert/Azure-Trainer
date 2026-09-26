# Task 4C: AKS resource diagnostics and interface

## Implemented

- Added a reactive-safe resource inspection projection: node capacity, allocatable budget, fixed reservations, learner requests, remaining room, live delivered/throttled CPU, metric peaks, pod resources, scheduling/OOM state, deployment readiness, HPA conditions and recommendation history.
- Added `kubectl top pods|nodes`, resource-aware node and HPA `get`/`describe`, manual `kubectl scale deployment/NAME --replicas N`, Pod wide scheduling detail, and useful prior-container OOM output for `logs --previous`.
- Added resource-profile controls with declared-profile-only start/cancel actions and explicit time controls. Stable labels are `Resource profile`, `Start resource profile`, `Cancel resource profile`, and `Advance resource simulation by {1|15|60} seconds`.
- Added resource/HPA inspection in the cluster blade, including actual ready counts, workload totals, and observations. Resource Labs no longer render empty probe controls. Completed attempts use the existing shared `locked` state, so all new controls are read-only.
- Fixed the 4B boundary clone follow-up by reacquiring runtime and experiment references after a boundary route, and guarded resource-experiment cancellation for legacy non-Kubernetes runs.

## Tests and verification

- RED: `npm.cmd test -- tests/aks-resource-ui.test.js` failed as expected before implementation: missing resource budgets and `kubectl top` was unsupported.
- GREEN: `npm.cmd test -- tests/aks-resource-ui.test.js tests/aca-deploy-guided.test.js` — 12 tests passed. The resource test covers unknown then completed-window top output, actual node inspection, manual scale cancellation without manifest mutation, and an actual OOM followed by `kubectl logs --previous`.
- Focused controller/evidence run before final presentation-only refinements: `npm.cmd test -- tests/aks-resource-ui.test.js tests/aks-resource-evidence.test.js tests/aks-hpa.test.js` — UI and HPA suites passed; the evidence suite continued beyond the command window and later completed green in the full run.
- `npm.cmd run build` passed. Vite reports the pre-existing >500 kB chunk-size warning.
- `git diff --check` passed.
- Full gate: `npm.cmd test -- --exclude '**/.superpowers/**'` completed with 1372/1374 tests passing. The two failures are unrelated baseline expectations: `aks-integration-fixtures.test.js` expects an older integration-profile list, and `aks-scheduling.test.js` expects an older assignment object shape. The earlier 341 legacy failures were caused by an unguarded 4B `runtime.kubernetes` access and were fixed; targeted legacy ACA coverage passes.
- Root's browser fixture verified starting a resource profile and advancing 60 seconds to completion with no page or console errors after the reactive-copy fix.

## Files changed

- `src/lib/kubernetes/resource-inspection.js`
- `src/lib/kubernetes/kubectl.js`
- `src/lib/kubernetes/format.js`
- `src/lib/kubernetes/actions.js`
- `src/lib/kubernetes/resource-experiments.js`
- `src/components/lab/AksExperimentPanel.vue`
- `src/components/blade/AksClusterBlade.vue`
- `tests/aks-resource-ui.test.js`

## Self-review

The CLI reports supplied simulator metrics with their distinct instantaneous/window semantics and does not substitute requests or zeros for unknown samples. Inspection copies reactive Pinia data through JSON-safe projection values, avoiding `structuredClone` failures while keeping the runtime read-only. The remaining full-suite failures predate this slice's final implementation and are recorded above.
