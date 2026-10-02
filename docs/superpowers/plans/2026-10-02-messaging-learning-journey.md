# Messaging Learning Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver 12 coding-first Service Bus/Event Grid Labs with Python SDK and Functions simulation, on-demand explanations and copyable GPT prompts.

**Architecture:** Add capability-scoped messaging modules alongside, not inside, the existing Data/Kubernetes engines. Lower saved Python into a bounded JSON intermediate representation, execute it against explicit simulated resources, and record dependency-aware behavior evidence through the existing Lab engine. Use independent prepared baselines and one compact verification fixture per Lab.

**Tech Stack:** Vue 3, Pinia, JavaScript ES modules, existing `@lezer/python` 1.1.19, Vitest (Node environment), Vite, existing simulated Azure CLI. No new product dependency, real Python interpreter, cloud service or unrestricted code evaluation.

**Spec:** `docs/superpowers/specs/2026-10-02-messaging-learning-journey-design.md` (user approved).

## Global Constraints

- 12 independently startable Labs culminating in one combined Capstone; do not pad to 15.
- Python for AI-200; short C# comparisons, not a second implementation track.
- Solutions start hidden and open only when requested. Revealing a Solution does not execute it or expand its rationale automatically.
- One short behavior-check exercise per Lab; no experiment matrices or real retry waits.
- No real Azure subscription, local Python installation, external execution service, or live credentials.
- Do not run AKS, Container Apps, full legacy replay, cloud integration or broad browser suites while developing this journey.
- Track cumulative test time per Lab publication, including reruns and CI. Aim comfortably below 30 minutes. If testing exceeds 30 minutes, stop expensive reruns and reduce/refactor the test structure before continuing.
- Keep legacy Labs available and preserve existing journey progress/results.
- Unsupported code must fail explicitly; learner code is not compared to exact Solution text.
- Planning is documentation-only. Execute only after plan review and execution-method confirmation; publish only after a later integration decision.

## Review Focus

1. Aliased imports/renamed local variables and CRLF/comments must behave like equivalent supported source, not fail exact-text checks (Task 3).
2. A settle call on an expired/wrong-receiver/already-settled lock must not remove another message (Task 2).
3. Relevant source/configuration edits followed by revert must not resurrect old verification; unrelated edits must not invalidate all Tasks (Task 6).
4. Clipboard denied/unavailable and switching Task during an asynchronous copy must never falsely report success for another Task or expose hidden Solution text (Task 1).
5. Resume/reset or malformed persisted messaging state must not duplicate business effects, accept forged fresh evidence, or contaminate another Lab (Tasks 2 and 6).

## Repository map and task boundaries

Existing entry points inspected: `src/lib/az/shell.js` dispatches supported commands; `src/lib/labEngine/actions.js` owns commands/saves; `src/lib/labEngine/run.js` validates and creates JSON runs; `src/lib/labEngine/evidence.js` records verification; `src/lib/labEngine/evaluate.js` checks identity/dependencies. Service Bus resource helpers live in `src/lib/sandbox/ops.js`, not a separate servicebus module. Event Grid configuration lives in `src/lib/sandbox/eventgrid.js` and `eventgrid-validation.js`. Current Functions Lab explicitly does not deploy/execute code. `TaskRow.vue` renders Solutions only for the current Task; rationale must live outside that conditional. `vite.config.js` supplies Node Vitest; no DOM test dependency exists.

Create focused modules under `src/lib/messaging/`: `state.js` (JSON state/limits), `servicebus.js` (broker transitions), `python.js` (AST lowering), `vm.js` (bounded evaluation), `eventgrid.js` (routing/delivery), `functions.js` (host), `execute.js` (orchestration), `shell.js` (command parsing), `actions.js` (Lab bridge), `evidence.js` (dependency selectors). Keep `src/lib/data/python-sdk.js` unchanged; it has Data-specific protected helpers and Kubernetes assumptions.

Create templates under `src/data/templates/messaging-python/`: `manifest.js`, `servicebus.js`, `eventgrid.js`, `functions.js`, `runtime.js`. Create curriculum under `src/data/labs/messaging-journey/` with a shared `helpers.js`, `seeds.js` and `index.js`; concrete filenames appear in Tasks 7–10. Do not split independent subsystems into unrelated plans: the runtime, source adapter and Labs share one execution contract and produce one journey. Assistance is independently reviewable as Task 1.

## Fixed execution contract

All new Labs: `engineVersion: 2`, `contentVersion: 1`, `journeyId: 'messaging-orders'`, `skillAreaId: 'connect'`, `capabilities: { messaging: true }`; Functions Labs additionally `messagingFunctions: true`. Lab modes remain supported `guided`/`capstone`, not a new UI enum. `journeyOrder` is 1–12.

Resource names: `rg-messaging`, Standard namespace `sb-orders`, queue `orders`, session queue `order-steps`, topic `order-work`, subscriptions `eu-orders`/`all-orders`, custom Event Grid topic `evgt-orders` using `EventGridSchema`, subscription `order-notifications`, Functions app `func-orders`, storage `stmessagingorders`, blob container `event-deadletters`. Use full resolved resource IDs as runtime keys; names alone cannot resolve cross-group resources. Training endpoints and identity values are simulated, never usable live credentials.

Project manifest `messaging-python-v1`: files `clients.py`, `producer.py`, `worker.py`, `events.py`, `handler.py`, `function_app.py`, `host.json`, `local.settings.json`, `requirements.txt`, `training_runtime.py`, `README.md`. `training_runtime.py` and requirements are protected authored scaffolding; compare protected files only, never editable answers. Register in `src/lib/project/manifests.js`. Each Lab includes all files; unrelated starters may remain unfinished but do not affect an entry point's parsing. Parse reachable files/functions, not every unfinished exercise in the project.

Cloud Shell entry points (actual Python/Functions command shapes, simulated): `python producer.py`, `python worker.py`, `python events.py`, `python handler.py`, and `func start`. Each Python script's `main()` is invoked once. No shell evaluation, command chaining, arbitrary filenames or unbounded server. `func start` validates configuration, captures saved-source revision and drains at most the Lab fixture's bounded delivery set; output explicitly identifies a simulated host run. Saved edits require another `func start`; no silent hot reload. Lab Tasks use these commands; no new Experiments UI is needed.

Shared signatures (JS, JSON-only return values):

```js
emptyMessagingState() // { version:1, nextId:1, timeMs:0, entities:{}, deliveries:[], effects:{}, hosts:{} }
validateMessagingState(state) // boolean; dense finite JSON, bounded counters/arrays/records
parseMessagingProject(files, { entry, mode, fixedFiles }) // { program:null|Program, diagnostics:Diagnostic[] }
executeMessagingProgram({ program, state, sandbox, input, limits }) // { state, value, trace, diagnostics }
executeMessagingEntry(run, lab, entry, mode='script') // { run, lines, portalEvents:[], diagnostics }
runMessagingShell(sandbox, tokens, { run, lab }) // normal runLine result plus command effects
applyMessagingAction(run, action, lab) // { run, lines, portalEvents, diagnostics }
messagingDependencies({ paths, resourceIds }) // map of context => JSON selectors
```

`Diagnostic = { code, message, path, line, column }`; codes `MESSAGING_UNSUPPORTED`, `MESSAGING_CONFIG`, `MESSAGING_RUNTIME`, `MESSAGING_LIMIT`. `Program = { entry, functions, globals, imports, sourcePaths }`; expressions use tagged literal/name/attribute/index/list/dict/call/compare/binary nodes; statements use assign/if/for/with/return/raise/expression. Keep variable names as data; never use `eval`, `Function`, regex-based success recognition or source-to-JavaScript compilation. Limit to 128 KiB per source file, 10,000 VM steps per command, 50 fixture messages/events, 30 Event Grid attempts, 500 retained trace entries. Bound local function calls and loops with the same shared step counter. Failure diagnostics do not append successful verification.

Supported Python subset: synchronous imports (including aliases), top-level constants/allowed constructors, `def` with simple annotations, assignment, literals, dict/list construction/indexing, attributes, positional/keyword calls, `with`, bounded `for`, `if`/`elif`/`else`, comparisons, `and`/`or`/`not`, integer addition, `return`, `raise ValueError`, and `try`/`except ValueError` only if used by an authored failure handler (add corresponding IR tags/tests before using). Unsupported async, comprehensions, lambdas, dynamic imports, filesystem/network/process APIs fail with positions. Builtins: `str`, `len`, `print`; adapters: `json.dumps`, `json.loads`, byte `.decode('utf-8')` and message body iteration needed by `str(message)`.

Supported SDK surface, scoped by imported/constructed receiver type:

- `DefaultAzureCredential()` resolves the trainer identity only; client endpoint/namespace must resolve to the Lab's resource target. Do not imply production credential acquisition or permissions are validated. Label auth simplification in README/rationale.
- `ServiceBusClient(fully_qualified_namespace, credential)`; `get_queue_sender(queue_name=...)`, `get_topic_sender(topic_name=...)`, `get_queue_receiver(queue_name=..., sub_queue=..., session_id=..., max_wait_time=...)`, `get_subscription_receiver(topic_name=..., subscription_name=..., sub_queue=..., max_wait_time=...)`.
- `ServiceBusMessage(body, message_id=..., session_id=..., application_properties=...)`; sender `send_messages`; receiver `receive_messages(max_message_count=..., max_wait_time=...)`, `complete_message`, `abandon_message`, `dead_letter_message(reason=..., error_description=...)`; enum `ServiceBusSubQueue.DEAD_LETTER`. Received metadata includes `message_id`, `session_id`, `application_properties`, `delivery_count`, dead-letter reason/description. Default receive mode is PeekLock; do not author ReceiveAndDelete, batching/transactions/defer/renew APIs.
- `EventGridPublisherClient(endpoint, credential)` and `.send(EventGridEvent|list)`; `EventGridEvent(subject=..., event_type=..., data=..., data_version='1.0', id=...)`. Use custom topic EventGridSchema; no namespace pull model or CloudEvents variants in this journey.
- Python Functions v2 `import azure.functions as func`, `func.FunctionApp()`, `@app.function_name(name=...)`, `@app.service_bus_queue_trigger(arg_name=..., queue_name=..., connection=...)`, `@app.event_grid_trigger(arg_name=...)`; message `.get_body().decode('utf-8')`, event `.get_json()`/metadata. Service Bus host auto-completes on success and redelivers on failure; do not teach manual settlement on ordinary `func.ServiceBusMessage`.
- Authored `training_runtime` helpers: `record_processed(order)` (idempotent by order ID), `record_notification(event_id, order_id)` (idempotent by event ID), `handler_status(order_id)` (fixture-controlled transient result). Protected helper README explains their simulated record store, not a real Azure SDK service. Idempotency Lab requires an editable `if` guard using `was_processed(order_id)` before its business work; tests observe work count, not just the helper's idempotent result.

Plain webhook Lab 8/9 handler `handle_event(event)` returns integer HTTP status; simulator invokes it through an allowlisted training endpoint and validates event-subscription registration internally. No real webhook call. Functions endpoint type `AzureFunction` is a separately validated resource/function reference. Webhook subscription validation is simulated and labeled, not silently skipped or falsely advertised as a public deployed endpoint.

## Budget and commands

Run only the owning Task's exact test file for RED/GREEN; one final focused aggregate after all Tasks. Aim <2 minutes per Task's tests, <5 minutes for the final aggregate/build. Record actual elapsed times in `docs/superpowers/plans/2026-10-02-messaging-verification-log.md` during execution, including review fix reruns and CI (create with first actual measurement, not invented timings). Above 30 cumulative minutes for a Lab, refactor fixtures/shared setup before another replay. No blanket `npm test`.

Each Task uses RED/GREEN and one commit after passing checks. Before execution use `superpowers:using-git-worktrees`; do not create a worktree while merely writing this plan. Dependency order: Task 1 independent; 2 → 3 → 4 → 5 → 6 → 7–10 → 11. Do not run implementers concurrently on shared engine/catalog files. Interface changes require updating downstream plan/implementer context before proceeding.

### Task 1: Collapsed rationale and safe explanation-prompt copying

**Files:** Create `src/components/lab/TaskRationale.vue`, `src/lib/labEngine/explanationPrompt.js`, `tests/messaging-rationale.test.js`; modify `src/components/lab/TaskRow.vue`, `src/styles/components.css`.

**Interfaces:** Task field `rationale: { concept, what, why, without, csharp }`; `buildExplanationPrompt({ labTitle, taskText, rationale }) -> string`; `copyExplanationPrompt(text, clipboard) -> Promise<{ copied:boolean, fallback:string|null }>`; component props `labTitle`, `taskText`, `rationale`. No reveal-store mutation.

- [ ] Write this failing contract test, plus rejected clipboard and absent clipboard variants:

```js
import { it, expect, vi } from 'vitest'
import { buildExplanationPrompt, copyExplanationPrompt } from '../src/lib/labEngine/explanationPrompt.js'
it('copies authored concept context, never solution properties', async () => {
  const text = buildExplanationPrompt({ labTitle:'Receive orders', taskText:'Complete an order',
    rationale:{ concept:'PeekLock', what:'Receive with a lock', why:'Finish work first', without:'Work can be lost' },
    solution:'SECRET-WORKED-ANSWER' })
  expect(text).toContain('C#'); expect(text).toContain('PeekLock')
  expect(text).not.toContain('SECRET-WORKED-ANSWER')
  const writeText = vi.fn().mockResolvedValue(undefined)
  expect(await copyExplanationPrompt(text, { writeText })).toEqual({ copied:true, fallback:null })
})
```

- [ ] Run `npm test -- tests/messaging-rationale.test.js`; expect missing-module RED.
- [ ] Implement pure helper with explicit field allowlist and plain text; copy catches rejection and returns original selectable text. Component uses independent collapsed state, native button/`aria-expanded`, read-only fallback textarea, live copy status and request-generation guard on prop change/unmount. Render under each relevant Task outside `state === 'current'`. Keep legacy `task.explanation` behavior when `rationale` absent; do not render both duplicates. Use existing Vue SFC compile/mount-with-custom-renderer approach from `tests/project-editor-keyboard.test.js`, not a new DOM dependency.

```vue
<button type="button" :aria-expanded="open" @click="open = !open">ℹ Why this?</button>
<section v-if="open" aria-label="Task rationale">
  <p>{{ rationale.what }}</p><p>{{ rationale.why }}</p><p>{{ rationale.without }}</p>
  <p v-if="rationale.csharp">{{ rationale.csharp }}</p>
  <button type="button" @click="copyPrompt">Copy explanation prompt</button>
  <p role="status">{{ status }}</p>
  <textarea v-if="fallback" readonly :value="fallback" aria-label="Explanation prompt" />
</section>
```

- [ ] Add small component tests: collapsed default, expanded done Task, Solution reveal leaves rationale closed, delayed copy followed by Task switch cannot mark the new Task copied. Rerun same file; expect GREEN.
- [ ] Commit exact Task files: `feat: add on-demand task rationale and explanation prompts`.

### Task 2: Service Bus broker state and persistence validation

**Files:** Create `src/lib/messaging/state.js`, `servicebus.js`, `tests/messaging-servicebus.test.js`; modify `src/lib/labEngine/run.js` only for optional capability-gated messaging creation/validation. Resource helpers consumed from `src/lib/sandbox/ops.js`.

**Interfaces:** `applyServiceBusOperation(state, sandbox, operation) -> { state,value,trace,diagnostics }`; operations use `{ kind, target:{ resourceGroup, namespace, queue?, topic?, subscription? }, receiverId?, message?, lockToken?, sessionId?, count? }`. Kinds `send`, `receive`, `complete`, `abandon`, `deadletter`, `advance`. IDs allocated from state counters, not callers. State key is full resource ID.

- [ ] Write RED tests with a resource fixture using existing `createResourceGroup/createNamespace/createQueue`:

```js
it('a wrong lock cannot settle the real received message', () => {
  const { sandbox, target } = brokerFixture()
  const sent = applyServiceBusOperation(emptyMessagingState(), sandbox,
    { kind:'send', target, message:{ body:'{"id":"o1"}', messageId:'m1', properties:{} } })
  const received = applyServiceBusOperation(sent.state, sandbox, { kind:'receive', target, receiverId:'r1', count:1 })
  const failed = applyServiceBusOperation(received.state, sandbox,
    { kind:'complete', target, receiverId:'r2', lockToken:received.value[0].lockToken })
  expect(failed.diagnostics[0].code).toBe('MESSAGING_RUNTIME')
  expect(failed.state).toEqual(received.state)
})
```

- [ ] Run `npm test -- tests/messaging-servicebus.test.js`; expect RED.
- [ ] Implement clone-on-operation state with message status/sequence/lock owner/deadline/delivery count/session/subqueue. Validate existence/status/tier and session requirements before mutating. Receivers retain locked messages until complete/abandon/expiry; abandon/expiry increments redelivery and respects maximum deliveries. Dead-letter replay is send-new then complete-old, not an invented broker replay API. Topic send copies to matching subscriptions, honoring existing default rule and OR of rules; support authored SQL equality/conjunction subset only, fail unsupported predicates. Dedup uses configured message-ID window; application effects remain separate. Session receiver leases enforce one owner and per-session sequence.

```js
export function emptyMessagingState() {
  return { version:1, nextId:1, timeMs:0, entities:{}, deliveries:[], effects:{}, hosts:{} }
}
// Failed operation contract: { state: originalState, value:null, trace:[], diagnostics:[diagnostic] }.
// Successful operations always return independent finite JSON and deterministic trace records.
```

- [ ] Add focused cases: expired and double-settled lock, same queue name in different group, independent subscription copies, session owner conflict, dedup vs business effect, malformed persisted counters rejected. Rerun same file GREEN; no whole-Lab replay.
- [ ] Commit `feat: simulate bounded Service Bus message lifecycle`.

### Task 3: Bounded Python lowering and execution

**Files:** Create `src/lib/messaging/python.js`, `vm.js`, `execute.js`, template `runtime.js`, `servicebus.js`, `manifest.js`, `tests/messaging-python.test.js`; modify `src/lib/project/manifests.js` registration.

**Interfaces:** Implement Program/Diagnostic signatures and SDK subset above; VM calls `applyServiceBusOperation` from Task 2; `executeMessagingEntry` orchestrates parse → VM → trace without grading yet. Template exports `MESSAGING_MANIFEST`, `SERVICEBUS_STARTER_FILES`, `SERVICEBUS_SOLUTION_FILES`, `MESSAGING_RUNTIME_FILES`.

- [ ] Write an alias equivalence RED test and unsupported no-side-effect test:

```js
it('allows renamed imported clients and CRLF comments', () => {
  const source = 'from azure.servicebus import ServiceBusMessage as Message\r\n'
    + 'def main():\r\n    item = Message("order", message_id="m1") # work\r\n    sender.send_messages(item)\r\n'
  const parsed = parseMessagingProject({ ...SERVICEBUS_STARTER_FILES, 'producer.py':source },
    { entry:'producer.py', mode:'script', fixedFiles:MESSAGING_RUNTIME_FILES })
  expect(parsed.diagnostics).toEqual([])
  expect(parsed.program.sourcePaths).toContain('producer.py')
})
```

- [ ] Run `npm test -- tests/messaging-python.test.js`; expect RED.
- [ ] Implement Lezer AST traversal into tagged nodes, import/receiver symbol resolution and bounded environment stack. Source locations accompany IR calls. Resolve supported client endpoints against explicit Sandbox resources. Interpret `with` resources and loop/message values rather than merely detecting SDK call text. Reject unknown reachable calls before execution; validate fixed helper content. Guard records via own-property access/Map, blocking prototype names. Expose real script shape below in templates (consumer bodies become learner edits, not recognized special strings):

```python
from azure.servicebus import ServiceBusMessage
from clients import bus
import json

def main():
    order = {"id": "o1", "region": "EU"}
    with bus.get_queue_sender(queue_name="orders") as sender:
        sender.send_messages(ServiceBusMessage(json.dumps(order), message_id="m1"))
```

- [ ] Add VM tests for branch-controlled completion, differing payload, bounded local calls, unsupported `open`/async/comprehension with locations, zero effects on parse failure, unfinished unrelated file ignored and step-budget exhaustion. Rerun owning file GREEN.
- [ ] Commit `feat: execute supported messaging Python source safely`.

### Task 4: Event Grid publication, delivery and retry configuration

**Files:** Create `src/lib/messaging/eventgrid.js`, template `eventgrid.js`, `tests/messaging-eventgrid.test.js`; modify `src/lib/messaging/python.js`, `vm.js`, `src/lib/sandbox/eventgrid.js`, `eventgrid-validation.js`, `src/lib/az/commands/eventgrid.js`, `src/lib/az/eventgrid-arm.js`.

**Interfaces:** `applyEventGridOperation(state,sandbox,operation) -> broker result`; kinds `publish`, `deliver`, `advance`; published envelopes use EventGridSchema; delivery adapters return status integers. Extend subscription fields `maxDeliveryAttempts` (1–30), `eventTimeToLiveInMinutes` (1–1440), `deadLetterDestination` (resolved existing storage/container), `endpointType` (`WebHook` existing, `AzureFunction` new).

- [ ] Write RED routing and nonretryable-status tests:

```js
it('a webhook 400 is not retried', () => {
  const f = eventGridFixture({ maxDeliveryAttempts:3, deadLetter:true })
  const published = applyEventGridOperation(emptyMessagingState(), f.sandbox,
    { kind:'publish', target:f.target, events:[f.event] })
  const delivered = applyEventGridOperation(published.state, f.sandbox,
    { kind:'deliver', deliveryId:published.value[0], status:400 })
  expect(delivered.state.deliveries[0].attempts).toBe(1)
  expect(delivered.state.deliveries[0].status).toBe('deadlettered')
})
```

- [ ] Run `npm test -- tests/messaging-eventgrid.test.js`; expect RED.
- [ ] Implement immutable fan-out by event types and subject prefix/suffix/case rules. Validate subscription activation/allowlisted training webhook registration separately from delivery. Add real CLI flags `--max-delivery-attempts`, `--event-ttl`, `--deadletter-endpoint` using existing argument-tree patterns; reject invalid values/missing storage. Keep default legacy subscription shape backward-compatible. Retry transient 503 through logical ticks; webhook 400/401/403/413 terminal, Azure resource 400/403/413 terminal. Exhaustion/TTL routes to destination or drops with visible outcome when none; missing destination produces explicit dropped/error outcome. No FIFO/exactly-once claim. Preserve simulator-vs-real schedule labels.

```python
from azure.eventgrid import EventGridEvent
from clients import publisher
def main():
    event = EventGridEvent(subject="/orders/eu/o1", event_type="Contoso.OrderProcessed",
                          data={"order_id": "o1"}, data_version="1.0", id="e1")
    publisher.send([event])
```

- [ ] Add tests for filtered-out events (no handler effect), explicit transient success/exhaustion, TTL first, two subscribers isolated, missing destination, CLI field readback and unchanged legacy config-only seed. Rerun owning file GREEN.
- [ ] Commit `feat: simulate Event Grid routing and bounded delivery recovery`.

### Task 5: Python Functions handler host

**Files:** Create `src/lib/messaging/functions.js`, template `functions.js`, `tests/messaging-functions.test.js`; modify messaging `python.js`, `vm.js`, `execute.js`. Consume `src/lib/sandbox/functions.js` host resource configuration; change it only if Python/required settings cannot be represented.

**Interfaces:** `runMessagingFunctions(run,lab) -> execution envelope`; decorator descriptors `{ kind:'servicebus'|'eventgrid', functionName, argName, queueName?, connection? }`; host captures reachable saved-source dependencies and actual Function App ID.

- [ ] Write RED test using a fixture created in this file with real supported host settings and saved source:

```js
it('auto-completes only a successful Service Bus handler', () => {
  const f = functionsFixture({ handler:'raise ValueError("invalid order")' })
  const result = runMessagingFunctions(f.run, f.lab)
  expect(result.run.runtime.messaging.effects.processed ?? {}).toEqual({})
  expect(result.run.runtime.messaging.deliveries.some(d => d.status === 'completed')).toBe(false)
})
```

- [ ] Run `npm test -- tests/messaging-functions.test.js`; expect RED.
- [ ] Lower only v2 decorators/annotations and supported bodies. Validate `host.json` version 2, Python worker, connection setting prefix/namespace, function app state and Event Grid target function. Use simulated identity setting collection `ServiceBusConnection__fullyQualifiedNamespace`; never require a real secret. Functions auto-settlement differs from SDK manual completion. On failure log it and model redelivery, without marking verification passed. The captured function source cannot change during a host run.

```python
import json
import azure.functions as func
from training_runtime import record_processed
app = func.FunctionApp()
@app.function_name(name="ProcessOrder")
@app.service_bus_queue_trigger(arg_name="msg", queue_name="orders", connection="ServiceBusConnection")
def process_order(msg: func.ServiceBusMessage):
    order = json.loads(msg.get_body().decode("utf-8"))
    record_processed(order)
```

- [ ] Add Event Grid `.get_json()` notification, missing connection, mismatched decorator argument, wrong runtime/app endpoint, duplicate registration and source-edit/restart tests. Rerun owning file GREEN.
- [ ] Commit `feat: run bounded Python messaging Functions handlers`.

### Task 6: Shell, grading freshness and Lab persistence integration

**Files:** Create `src/lib/messaging/shell.js`, `actions.js`, `evidence.js`, `tests/messaging-engine.test.js`; modify `src/lib/az/shell.js`, `src/lib/labEngine/actions.js`, `run.js`; consume `evidence.js`/`evaluate.js` existing APIs without replacing them.

**Interfaces:** Shell yields effect `{ type:'messaging-execution', entry, mode }` (intent only, not caller-supplied state/evidence). `applyCommandEffects` validates capability/action keys then re-executes against saved run. `applyMessagingAction` accepts internal `{ type:'messaging-run', entry, mode }` only. `messagingDependencies` supplies file content AND file-generation selectors plus canonical resource configuration; normalize resource changes into monotonically increasing relevant generation keys so change/revert cannot revive proof.

- [ ] Write RED with an engine-local fixture (no production Lab import):

```js
it('does not revive evidence after source revert', () => {
  const f = engineFixture()
  const proved = applyRunAction(f.run, { type:'command', line:'python worker.py' }, f.lab).run
  expect(evaluateLab(f.lab, proved).tasks.at(-1).done).toBe(true)
  const changed = applyRunAction(proved, { type:'save-file', path:'worker.py', text:f.changed }, f.lab).run
  const reverted = applyRunAction(changed, { type:'save-file', path:'worker.py', text:f.original }, f.lab).run
  expect(evaluateLab(f.lab, reverted).tasks.at(-1).done).toBe(false)
})
```

- [ ] Confirm actual save-action name in the existing switch before writing fixture; use its existing shape (`save-file` if matching), not a new save API. Run `npm test -- tests/messaging-engine.test.js`; expect RED.
- [ ] Add scoped shell dispatch and effect handling; no forged runtime snapshots accepted. Record one verification exercise's internal measurements using `recordVerification` for its declared Tasks only. Each record matches scenario ID/version/task/attempt/content identity; derive measurements from trace/results, never a caller `passed:true`. Include source and resource dependencies, not mutable queue contents that the command itself drains. Configuration Tasks use direct predicates; coding Tasks use behavior trace/evidence. Refresh relevant dependency generations after commands/saves; preserve historical completed results. Existing generic run serialization carries optional JSON `runtime.messaging`; capability-gated validation rejects missing/malformed state.

```js
// Existing result API to use after successful actual execution:
recordVerification(nextRun, lab, task.id, {
  scenarioId:task.verification.scenarioId, scenarioVersion:1,
  outcome:'passed', completed:true, startedAtMs:before.runtime.simTimeMs,
  endedAtMs:nextRun.runtime.simTimeMs, measurements:{ trace:result.trace, value:result.value }
})
```

- [ ] Test unsaved draft ignored, unrelated README save preserves proof, config change/revert invalidates relevant proof, JSON resume preserves effects/proof, reset/new attempt removes proof, malicious command effects rejected, legacy `python` remains command-not-found. Rerun owning file GREEN.
- [ ] Commit `feat: integrate messaging commands and fresh behavior evidence`.

### Task 7: Labs 1–3 and reusable curriculum fixtures

**Files:** Create `src/data/labs/messaging-journey/helpers.js`, `seeds.js`, `index.js`, `send.lab.js`, `receive.lab.js`, `deadletter.lab.js`, `tests/messaging-labs-servicebus.test.js`; modify `src/data/labs/index.js` append journey imports; finish Service Bus template exports from Task 3.

**Interfaces:** `messagingTask({id,text,rationale,hints,solution,paths,resourceIds,check})` returns existing Task schema plus versioned verification/dependencies for behavior Tasks. `seedMessagingStage(run,stage)` returns exactly `{ sandbox,artifacts,runtime,nextSequence }`, the verified existing initializeSimulation contract; put starter files in `initialProjectFiles`, not an unsupported seed override. `replayMessagingSolution(lab)` is a test-only helper defined in this test file: create run, save file steps, execute command steps, evaluate.

- [ ] Write RED tests for exactly three new Lab IDs, pending starts and completed compact Solution replay:

```js
for (const lab of SERVICEBUS_FOUNDATION_LABS) {
  it(`${lab.id} starts pending and its worked commands demonstrate behavior`, () => {
    const start = createBehavioralRun(lab, { attemptId:`test-${lab.id}` })
    expect(evaluateLab(lab,start).tasks.some(task => !task.done)).toBe(true)
    expect(evaluateLab(lab,replayMessagingSolution(lab)).tasks.every(task => task.done)).toBe(true)
  })
}
```

- [ ] Run `npm test -- tests/messaging-labs-servicebus.test.js`; expect RED. Define `SERVICEBUS_FOUNDATION_LABS` in journey index using concrete imports.
- [ ] Author IDs `messaging-send`, `messaging-receive`, `messaging-deadletter`, orders 1–3. Resource creation belongs to Lab 1; prepared configuration in 2/3 is disclosed. SDK consumers use `json.loads(str(message))`, successful `record_processed(order)` then `complete_message`; invalid-order branch dead-letters with reason. Recovery reads DLQ, constructs corrected new message, sends it, completes DLQ original. Every new Task includes rationale and self-contained prompt context. Solutions use existing `{steps:[{kind:'file',path,content},{kind:'command',line}]}`; no novel UI action kind. Give each Lab one check exercise covering its relevant bounded behavior, not separate per-Task experiment buttons.
- [ ] Rerun same file GREEN; add one changed payload negative assertion, not three full negative walkthroughs. Confirm titles/briefs clearly say simulated execution and supplied baseline.
- [ ] Commit `feat: add messaging send receive and dead-letter labs`.

### Task 8: Labs 4–6, idempotency, fan-out and sessions

**Files:** Create `idempotency.lab.js`, `topics.lab.js`, `sessions.lab.js` in journey folder; modify journey `index.js`, `seeds.js`, Service Bus template; add cases to `tests/messaging-labs-servicebus.test.js` (use `-t 'advanced'` while developing).

**Interfaces:** Export `SERVICEBUS_ADVANCED_LABS`; consume same Task/replay/seed interfaces, no new parser signatures.

- [ ] Write RED test:

```js
it('advanced idempotency Lab counts one business effect for repeated delivery', () => {
  const run = replayMessagingSolution(SERVICEBUS_ADVANCED_LABS[0])
  expect(run.runtime.messaging.effects.workByOrder.o1).toBe(1)
  expect(evaluateLab(SERVICEBUS_ADVANCED_LABS[0],run).tasks.every(t => t.done)).toBe(true)
})
```

- [ ] Run `npm test -- tests/messaging-labs-servicebus.test.js -t advanced`; expect RED.
- [ ] Author IDs `messaging-idempotency`, `messaging-topics`, `messaging-sessions`, orders 4–6. Implement editable `was_processed(order['id'])` guard before work, complete even duplicate deliveries. Distinguish broker dedup from redelivery in rationale. Topic Labs create/consume independent subscriptions, remove `$Default` before EU-only rule; subscription selection is checked in execution. Sessions use explicit `session_id='o1'` receiver on `order-steps`; two ordered steps and a different session demonstrate per-session scope. Seed only prior-stage code/configuration; don't seed fresh evidence or the new answers.
- [ ] Add advanced replay assertions for filtered copy distribution and session order; rerun focused advanced cases GREEN. No performance/load tests.
- [ ] Commit `feat: add duplicate-safe topic and session messaging labs`.

### Task 9: Labs 7–9, custom events and delivery recovery

**Files:** Create `publish-events.lab.js`, `event-filters.lab.js`, `event-recovery.lab.js`; modify journey `index.js`/`seeds.js`, Event Grid templates; create `tests/messaging-labs-eventgrid.test.js`.

**Interfaces:** Export `EVENTGRID_LABS`; use existing Python runner/handler and Task dependencies; no direct sandbox flag can satisfy a handler code Task.

- [ ] Write RED test:

```js
it('custom events reach only the intended handler', () => {
  const lab = EVENTGRID_LABS[1]
  const run = replayMessagingSolution(lab)
  expect(Object.keys(run.runtime.messaging.effects.notifications)).toEqual(['e-eu'])
  expect(evaluateLab(lab,run).tasks.every(t => t.done)).toBe(true)
})
```

- [ ] Run `npm test -- tests/messaging-labs-eventgrid.test.js`; expect RED. Define a local replay helper here rather than importing a test file that registers another suite.
- [ ] Author IDs `messaging-publish-events`, `messaging-event-filters`, `messaging-event-recovery`, orders 7–9. Task 7 publishes explicit `Contoso.OrderProcessed` application facts. Task 8 writes `handle_event` returning status and uses event type/subject filtering. Task 9 creates owned storage/container for dead-letter output and sets bounded attempts/TTL; fixture-driven transient status helper does not control grading directly. The final `python handler.py` exercise drains only bounded due deliveries with logical ticks and reports attempts/output; learner doesn't wait real backoff. Include a compact retry/recovery path plus terminal dead-letter observation in the one check, not an experiment matrix.
- [ ] Run same file GREEN with three positive replays and one wrongly filtered event assertion. Check each Lab starts pending and changes invalidate source-dependent evidence.
- [ ] Commit `feat: add custom event filtering and recovery labs`.

### Task 10: Labs 10–12, Functions and combined Capstone

**Files:** Create `functions-servicebus.lab.js`, `functions-eventgrid.lab.js`, `capstone.lab.js`; modify journey `index.js`/`seeds.js`, Functions templates; create `tests/messaging-labs-functions.test.js`, `tests/messaging-capstone.test.js`.

**Interfaces:** Export `FUNCTIONS_LABS`, `messagingCapstoneLab`, `MESSAGING_LABS` (all 12). Capstone uses ordinary ordered Tasks and existing versioned evidence, not AKS/Data stage ownership cleanup machinery; don't mark manifest `capstone:true` if it would activate build-provenance requirements unrelated to messaging. Set Lab `labMode:'capstone'` only.

- [ ] Write RED tests for the two Functions replays and one Capstone proof:

```js
it('capstone starts unfinished and connects actual processing to notification', () => {
  const initial = createBehavioralRun(messagingCapstoneLab, { attemptId:'capstone-test' })
  expect(evaluateLab(messagingCapstoneLab,initial).tasks.every(t => t.done)).toBe(false)
  const run = replayMessagingSolution(messagingCapstoneLab)
  expect(run.runtime.messaging.effects.workByOrder.o1).toBe(1)
  expect(run.runtime.messaging.effects.notifications['e-o1'].orderId).toBe('o1')
  expect(evaluateLab(messagingCapstoneLab,run).tasks.every(t => t.done)).toBe(true)
})
```

- [ ] Run `npm test -- tests/messaging-labs-functions.test.js tests/messaging-capstone.test.js`; expect RED.
- [ ] Author IDs `messaging-functions-servicebus`, `messaging-functions-eventgrid`, `messaging-orders-capstone`, orders 10–12. Learner writes decorators and handlers, configures Python host/settings, and uses `func start`. Lab 11 baseline supplies the earlier Service Bus Function; Task 11 is the new Event Grid Function. Capstone starts minimal; work handler derives the event payload from the processed order, not a canned independent publication. End with one bounded end-to-end fixture including duplicate work and an invalid-order/failure path. Clear rationale on SDK manual settlement versus host auto-completion. Do not turn this into a resource cleanup/deployment incident framework.
- [ ] Rerun two files GREEN; add one source mutation suppressing event publish so notification/e2e Task remains pending. This is the only complete Capstone replay set; no legacy replays.
- [ ] Commit `feat: add messaging Functions labs and order-processing capstone`.

### Task 11: Catalog, focused CI, documentation and final handoff

**Files:** Modify `src/data/labs/index.js`, `.github/workflows/pages.yml`, `package.json`; create `docs/messaging-simulator.md`, `tests/messaging-catalog.test.js`; update approved spec delivery status only after actual verification. Inspect Home journey grouping before changing UI; add no hierarchy unless needed for existing journeyId grouping.

**Interfaces:** `npm run test:messaging` invokes only these exact new files; retain current focused Data checks in Pages. Existing public catalog exports stay unchanged.

- [ ] Write RED metadata test with imported `LABS`:

```js
it('publishes twelve ordered coding-first Labs without removing legacy Labs', () => {
  const labs = LABS.filter(lab => lab.journeyId === 'messaging-orders')
  expect(labs.map(lab => lab.journeyOrder)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12])
  expect(labs.filter(lab => lab.labMode === 'capstone')).toHaveLength(1)
  expect(labs.every(lab => lab.skillAreaId === 'connect')).toBe(true)
  expect(LABS.some(lab => lab.id === 'eventgrid-filtered-subscription')).toBe(true)
  expect(LABS.some(lab => lab.id === 'servicebus-order-backend')).toBe(true)
})
```

- [ ] Run `npm test -- tests/messaging-catalog.test.js`; expect RED until aggregate export/catalog integration completed.
- [ ] Register journey in order, write supported syntax/API/commands and teaching limitations in `docs/messaging-simulator.md`, describe rationale/prompt/privacy controls. Add exact script below. Pages adds `npm run test:messaging` after existing focused Data checks; do not expand to full `npm test`.

```json
"test:messaging": "vitest run tests/messaging-rationale.test.js tests/messaging-servicebus.test.js tests/messaging-python.test.js tests/messaging-eventgrid.test.js tests/messaging-functions.test.js tests/messaging-engine.test.js tests/messaging-labs-servicebus.test.js tests/messaging-labs-eventgrid.test.js tests/messaging-labs-functions.test.js tests/messaging-capstone.test.js tests/messaging-catalog.test.js"
```

- [ ] Run `npm run test:messaging` once, `npm test -- tests/data-python-sdk.test.js tests/data-capstone-core.test.js` once for the touched generic integration, then `npm run build -- --base=/Azure-Trainer/`. Expect all named tests PASS and build success; log elapsed time. For failures use systematic-debugging and rerun only the failed owning file before one final aggregate. Check `git diff --check` and independent whole-branch review under chosen execution workflow. No live publish yet.
- [ ] Commit `feat: register messaging journey and focused release checks`. Report 12 Lab statuses, exact checks/times, retained simulator limitations, branch and commit. Ask for integration/publication direction; do not infer current authority from earlier Data publication requests.

## Planning self-review and source grounding

Coverage: curriculum/baselines/one app → Tasks 7–10; browser execution/new SDK/Functions support → 2–6; errors and freshness → 2–6; assistance/privacy/accessibility → 1; preservation/CI/budget/docs → 6/11. Review Focus cases are assigned to named owning tests. All new signatures and exports are specified above; test-local fixtures/replay helpers are explicitly authored in their owning files and are not production APIs. Tests/code snippets are contracts to implement, not executable product changes made during planning.

Current official sources checked during planning:

- [Service Bus Python SDK](https://learn.microsoft.com/en-us/python/api/overview/azure/servicebus-readme?view=azure-python) and [receiver API](https://learn.microsoft.com/en-us/python/api/azure-servicebus/azure.servicebus.servicebusreceiver?view=azure-python).
- [Event Grid publisher API](https://learn.microsoft.com/en-us/python/api/azure-eventgrid/azure.eventgrid.eventgridpublisherclient?view=azure-python).
- [Python Service Bus Functions trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger) and [Event Grid Functions trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-event-grid-trigger).
- [Event Grid delivery/retry](https://learn.microsoft.com/en-us/azure/event-grid/delivery-and-retry): distinguish terminal endpoint errors, attempts/TTL and best-effort retry schedule from logical simulator ticks.

If an existing initializer/action/command contract differs when implementing, inspect its actual definition, adjust the bridge/test fixture explicitly and communicate the interface change; do not loosen validation or introduce fabricated success to make the plan fit. Stop for user review if scope must change materially (extra service, external runtime, lab count or broader testing).

## Execution handoff

The user explicitly requested on 2026-10-02 that implementation start with Superpowers subagents immediately after finishing the plan, preserving the test-duration constraint. This selects subagent-driven execution and replaces the separate waiting-for-plan-review handoff. Use isolated implementer context and focused reviews; no parallel implementers writing the shared engine or catalog. Proceed after plan self-review; no push/merge/publication is authorized by this instruction.
