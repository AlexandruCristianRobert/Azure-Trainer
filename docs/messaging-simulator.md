# Messaging simulator

The twelve-Lab Messaging journey builds an Order Processing Application with Python-shaped Service Bus, Event Grid and Azure Functions APIs. It runs a bounded interpreter in the browser against simulated resources. It requires no Azure subscription, installed Python, network execution service or credentials. The supported subset below is the trainer's contract, not a promise of full Python or Azure SDK compatibility.

## Independently startable Labs

| Order | Lab | Behavior exercise |
| --- | --- | --- |
| 1 | Send order commands | `python producer.py`: inspect the actual queued order. |
| 2 | Receive and complete | `python worker.py`: receipt-bound work, record, then completion. |
| 3 | Dead-letter recovery | `python producer.py`: reject invalid input, repair/resend, settle the original and process the corrected copy. |
| 4 | Duplicate-safe work | `python worker.py`: repeated physical deliveries produce one business effect. |
| 5 | Topics and filters | `python producer.py`: publish regional orders and consume independent subscription copies. |
| 6 | Sessions | `python producer.py`: process two steps in one explicitly owned session. |
| 7 | Publish a business fact | `python events.py`: observe an actual publication even with no subscribers. |
| 8 | Event handlers and filters | `python handler.py`: publish matching/nonmatching facts and handle the selected notification. |
| 9 | Retry and dead-letter | `python handler.py`: recover a transient failure and observe a terminal delivery. |
| 10 | Service Bus Function | `func start`: process an actual queue receipt through the simulated host. |
| 11 | Event Grid Function | `func start`: publish after completed work and notify through the actual Function callback. |
| 12 | Combined Capstone | `func start`: duplicate-safe valid work, invalid-input DLQ and derived completion notifications. |

Each Lab has one compact behavior exercise. Labs 2–11 prepare resources or prior-stage source so no earlier completion or workspace import is needed. Their new Tasks, source work and execution proof start unfinished. Lab 9 supplies the storage account/container used as the dead-letter destination; it teaches delivery configuration and handler code rather than general blob management. Lab 7 takes completion as the stated upstream fact and does not run an upstream worker. The Capstone supplies minimal scaffolding and active valid, duplicate and invalid inputs, not the complete application.

## Source and commands

Save files before running: execution uses saved source, not editor drafts. The `messaging-python-v1` project includes `clients.py`, `producer.py`, `worker.py`, `events.py`, `handler.py`, `function_app.py`, `host.json`, `local.settings.json`, `requirements.txt`, `training_runtime.py` and `README.md`. `requirements.txt` and `training_runtime.py` are protected scaffolding; their exact content is validated. Requirements are documentation of API shapes, not packages installed by a real Python host.

The shell accepts only the entry declared by the current Lab from the table above, with no extra command arguments. `func start` invokes `function_app.py` synchronously. Saving and running it again restarts the simulated host from current source/configuration; there is no hot reload or background host. Resource Tasks use the existing simulated `az` commands for groups, Service Bus namespaces/queues/topics/subscriptions/rules, Event Grid topics/subscriptions, storage accounts and Function Apps. These commands configure the Sandbox and do not deploy cloud resources.

Supported Python forms include comments, ordinary/byte strings, safe integer literals, `True`/`False`/`None`, lists and dictionaries, variable/index assignment, field/index reads, supported positional/keyword calls and parentheses. Operators are `+` (safe integer addition or bounded string concatenation), unary `+`/`-`/`not`, `==`/`!=`/`<`/`<=`/`>`/`>=`, `and`/`or`, `in`/`not in` and `is`/`is not`; chained comparisons are unsupported. Synchronous local `def` functions, imports of supported modules/local files (including aliases), `return`, `pass`, `if`/`elif`/`else`, `for` over supported values, a single supported `with ... as ...`, and `raise ValueError(...)` are supported. Script entries require zero-argument `main()`. Names, formatting and comments may vary; grading does not compare editable source to Solution text.

Reachable source and all branches of reached functions are preflighted before effects. Unused function bodies are not lowered or analyzed. Evidence freshness is tracked per saved dependency file: editing even an unused body in a declared dependency file invalidates its proof; unrelated files do not. Arbitrary libraries, async handlers, classes, general exception handling, unrestricted reflection, network/filesystem/process access and arbitrary Python execution are outside the subset. Unsupported source/arguments/configuration produce positioned diagnostics; runtime failures can retain earlier actual effects. An Event Grid callback whose execution or delivery finalization aborts without an outcome has its effects and traces rolled back, while completed siblings remain. A completion message alone never proves a Task.

## SDK-shaped APIs

Supported calls accept only their declared arguments; unknown/repeated/missing arguments fail explicitly.

| Family | Supported surface |
| --- | --- |
| Identity | `DefaultAzureCredential()` returns a trainer identity token. |
| Service Bus clients | `ServiceBusClient(fully_qualified_namespace, credential)`; `get_queue_sender(queue_name)`, `get_topic_sender(topic_name)`, `get_queue_receiver(queue_name, sub_queue, session_id, max_wait_time)`, `get_subscription_receiver(topic_name, subscription_name, sub_queue, max_wait_time)`. Optional arguments retain their API-shaped defaults. |
| Sending | `ServiceBusMessage(body, message_id, session_id, application_properties)`; `sender.send_messages(messages)` accepts one outgoing message or a list. |
| Receiving/settling | `receiver.receive_messages(max_message_count, max_wait_time)`, `complete_message(message)`, `abandon_message(message)`, `dead_letter_message(message, reason, error_description)`; `ServiceBusSubQueue.DEAD_LETTER` selects the DLQ. |
| Event publication | `EventGridPublisherClient(endpoint, credential)`; `EventGridEvent(subject, event_type, data, data_version, id)`; `publisher.send(events)` accepts one event or a list. |
| Data helpers | `json.dumps`, `json.loads`, `str`, `len`, positional `print`, UTF-8 `bytes.decode`. |
| Trainer helpers | `perform_order_work(order)`, `record_processed(order)`, `was_processed(order_id)`, `record_notification(event_id, order_id)`, `handler_status(order_id)`, `deliver_events(handler)`. |

Clients resolve actual configured namespace/topic identities and actual target names. `DefaultAzureCredential` does not authenticate against Azure. Receivers use PeekLock; settlement belongs to the exact receiving handle/lock. Closing an ordinary SDK receiver leaves unsettled locks until logical expiry. `max_wait_time` does not sleep or advance logical time. Session leases provide ordering within the selected session; no global FIFO guarantee is taught. Topic subscriptions hold independent physical copies. Removing `$Default` matters when an exclusive EU SQL rule is required.

Event Grid uses EventGridSchema envelopes with actual `id`, `subject`, `eventType`, `data` and `dataVersion`; SDK event objects expose `id`, `subject`, `event_type`, `data`, `data_version`. Type and subject filters select actual fan-out copies. Publication records the actual topic and event snapshot even when no subscription matches. `deliver_events(handler)` is a protected trainer callback bridge, not a public SDK delivery API or deployed WebHook. Lab-owned endpoint registration and status fixtures drive actual callback invocation and bounded attempts; a main-function marker cannot substitute for callback-bound notification proof.

## Python Functions v2 subset

Use `import azure.functions as func`, `app = func.FunctionApp()`, optional `@app.function_name(name=...)`, and one supported trigger per handler: `@app.service_bus_queue_trigger(arg_name=..., queue_name=..., connection=...)` or `@app.event_grid_trigger(arg_name=...)`. The single matching argument must be annotated with the resolved `func.ServiceBusMessage` or `func.EventGridEvent` type. All handlers must register on the same FunctionApp object; aliases of that object work, but distinct app objects and blueprints are unsupported. Supported aliases/constants may supply decorator values; unsupported decorators, executable annotations and duplicate registrations fail.

Function messages provide `get_body()`, `message_id`, `delivery_count`, `application_properties`; decode the actual UTF-8 body with `json.loads`. Function events provide `get_json()`, `id`, `subject`, `event_type`, `data_version`. Ordinary Function messages have no manual settlement API. The host completes the actual broker receipt on successful return; supported handler errors abandon/retry and can reach the queue's DLQ while successful siblings continue. Successful non-HTTP Event Grid Functions acknowledge delivery as 200; exceptions cause a simulated 500. Return values are not HTTP responses for these triggers. Session-enabled queue triggers are outside this subset.

The Sandbox app must be Python 3.12, Functions 4, Linux, FlexConsumption with the configured storage account. `host.json` requires `"version": "2.0"`. `local.settings.json` requires `IsEncrypted: false` and `Values` containing `FUNCTIONS_WORKER_RUNTIME: "python"`, `AzureWebJobsStorage: "UseDevelopmentStorage=true"`, and `<connection>__fullyQualifiedNamespace` resolving the configured namespace (the Labs use `ServiceBusConnection`). The storage value is a simulation setting, not a live connection string. An Event Grid AzureFunction endpoint must identify the actual app and registered function through its ARM resource ID. Host start captures saved sources and versions and increments its bounded generation; persisted host metadata is not executable code.

## Evidence, retries and bounds

Business work and processed markers are separate: `perform_order_work` increments a counter; `record_processed` records an idempotent marker. A guard must precede work to prevent duplicate effects. This is an in-memory teaching store with no production durability or exactly-once claim.

Decoded received bodies carry a private binding to their original physical message/receiver/lock through `str(message)` or Function `get_body().decode(...)` followed by `json.loads`, including supported aliases/local calls. Matching reconstructed dictionaries are not received-work proof. Work and record traces capture actual payload and binding; checks require the causal receive → valid work → marker → completion sequence. A corrected resend gets a new physical receipt. Completion facts in the Functions flow must be published after their own receipt-bound work/marker and before completion. Notifications require the actual event/delivery/attempt callback followed by acknowledgement and the corresponding effect.

Per-command evidence includes actual trace, reached sources, physical receipts, changed business effects and diagnostics. It is anchored to a bounded internal execution-receipt journal, including failed and ungraded executions. Source/configuration saves and reverts invalidate affected proof; unrelated README edits preserve it. Resume retains internally consistent proof. This is not cryptographic authentication of browser storage: a coherent malicious rewrite of all local state is outside that guarantee.

Event Grid attempts and TTL run on logical ticks. Retriable statuses advance by simulated 1,000 ms ticks, not Azure's real backoff schedule. WebHook 400/401/403/413 and AzureFunction 400/403/413 terminate; other non-2xx statuses retry within configured limits. Success is 2xx. Exhaustion, TTL or terminal errors dead-letter only to a still-existing prepared storage/container destination; unavailable destinations visibly drop. Subscription commands accept `--max-delivery-attempts` 1–30, `--event-ttl` 1–1440 minutes and `--deadletter-endpoint` as the complete existing container ARM ID. No actual blob upload, HTTP request or validation handshake occurs.

Bounds include 16 project files, 128 KiB per file, 512 KiB total project source; 16 reached modules; 10,000 analysis/VM steps, 100 call frames/nesting, 500 trace rows per execution, and bounded 128 KiB application values/event envelopes. Retained messages, events, delivery copies and keys per effect family are capped at 50; retained lock histories are capped at 500 in aggregate across all messages, including restored state. Effect admission validates safe nonnegative work counters, matching processed IDs and notification event/order IDs even without an execution journal. Print output is capped at 500 lines/128 KiB. Functions retain at most 16 app records, 20 source paths per capture and 50 registered handlers. The journal admits at most 50 VM executions per attempt, without eviction; the next command fails before new effects. Parse failures do not consume a journal entry. Exhaustion returns `MESSAGING_LIMIT`. Reset starts a fresh Lab fixture and clears execution proof, host captures and journal; it does not carry prior Lab workspace state forward. Historical completed Lab Results remain historical.

The Capstone intentionally raises `ValueError` for its exact invalid physical input, observes three abandon attempts and terminal DLQ, and continues valid siblings. Those visible receipt-bound expected errors are admitted narrowly; unrelated runtime, unsupported, configuration or limit errors never become successful proof.

## Assistance and privacy

Solutions start hidden. `ℹ Why this?` independently expands a Task's concise concept, what, why, consequence and optional C# comparison, including after completion. Opening either control does not execute source or open the other. `Copy explanation prompt` uses authored Lab/Task/rationale learning fields only, excludes hidden Solution code and workspace/credentials, and requests conceptual help without the complete answer. It copies locally and sends nothing to GPT or another service. Success is reported only after clipboard success; unavailable/failed copying reveals selectable prompt text. Keyboard controls expose their expanded state. Rationale/copy use does not count as Hint/Solution usage.

## Focused release checks

`npm run test:messaging` runs the eleven named Messaging test files, including catalog coverage and the compact Lab exercises. Pages retains `npm test -- tests/data-python-sdk.test.js tests/data-capstone-core.test.js`, adds the Messaging check, then builds with `npm run build -- --base=/Azure-Trainer/`. This does not run the full repository suite. The committed verification log records actual local commands/reruns/times; CI and deployment time must be recorded when they actually run. Branch verification does not imply publication.
