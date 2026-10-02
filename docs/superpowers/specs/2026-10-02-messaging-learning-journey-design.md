# Messaging Learning Journey — design

Date: 2026-10-02

Status: implemented and locally verified on branch `codex/messaging-orders` on 2026-10-02; not published. All twelve Labs are registered, the focused Messaging checks pass (208 tests), the retained focused Data checks pass (21 tests), and the production Pages-path build succeeds. The build reports its large-chunk warning. Controller-owned whole-branch review and the user's integration/publication decision remain pending; CI and deployment have not run. See [simulator contract](../../messaging-simulator.md) and [verification log](../plans/2026-10-02-messaging-verification-log.md). The original written specification was approved by the user on 2026-10-02, who subsequently authorized implementation through the selected subagent workflow. This status does not authorize merge, push or publication.

## Purpose and success criteria

Teach the learner to create messaging resources and write application code for Azure Service Bus and Azure Event Grid, using one evolving Order Processing Application. The learner knows C# and is learning Python for AI-200. Prefer useful code-writing practice over repeated experiments or lengthy verification exercises.

Success means 12 independently startable Labs culminating in one combined Capstone, with executable supported behavior in the browser simulator, hidden worked Solutions, concise on-demand explanations, and copyable prompts for deeper conceptual help. The journey must stay below the user's maximum of 15 Labs. It must not require a real Azure subscription, local Python installation, external execution service, or live credentials.

Python is selected for exam alignment: Microsoft's current AI-200 audience profile explicitly expects Python proficiency. This is not a claim that all exam code questions are Python-only. C# comparisons support understanding; a second C# implementation track is out of scope.

## Curriculum

Use progressive build-focused Labs rather than repeating Guided/Troubleshooting/Independent triples. Embed compact repair work only where it teaches failure handling. Each Lab has a business brief, resource/code Tasks, on-demand assistance, and one short behavior-check exercise. A check may contain a small fixture set when a topic requires a comparison; it must not become an experiment matrix.

| Lab | Focus | Main work and short behavior check |
| --- | --- | --- |
| 1 | Service Bus setup and send | Create the required namespace/queue and write a Python producer; send an order and inspect its queued payload. |
| 2 | Receive and settle | Write the consumer and explicit successful completion path; process an order and confirm it is no longer awaiting processing. |
| 3 | Dead-letter handling | Implement invalid-order handling and dead-letter inspection/recovery code; demonstrate the relevant reject/recovery path. |
| 4 | Duplicate-safe processing | Implement application idempotency and distinguish it from broker duplicate detection; repeated delivery must not repeat the business effect. |
| 5 | Topics and subscription filters | Create topic/subscriptions/rules and write publishing/consuming code; a compact matching/nonmatching fixture demonstrates routing. |
| 6 | Ordered processing with sessions | Configure sessions and write session-aware processing; demonstrate ordering within one session, without claiming global ordering. |
| 7 | Publish custom Event Grid events | Create the custom topic and write publication of an application fact such as `OrderProcessed`; inspect the resulting event. |
| 8 | Event handlers and filters | Write the handler and configure subscriptions/filters; a small fixture shows which notification is handled and which is excluded. |
| 9 | Event Grid retries and dead-lettering | Configure delivery handling and write failure-aware handler code; use bounded simulated attempts to demonstrate recovery or dead-letter output. |
| 10 | Service Bus Azure Function | Write a Python Functions handler and required host/trigger configuration; process one queued order through the simulated host. |
| 11 | Event Grid Azure Function | Write a Python Functions event handler and required subscription/host configuration; handle one routed notification. |
| 12 | Combined Capstone | Assemble the order-work and event-notification paths from a minimal starter, including duplicate-safe processing and a compact failure-handling check. |

Lab 1 starts with a minimal application starter. Labs 2–11 use isolated prepared baselines representing prior stages, with their new learning Tasks unfinished. They do not require completion of earlier Labs or import a learner's previous workspace. Each brief explains what is supplied and what must be written. The Capstone supplies scaffolding, not the complete worked application.

## Application roles and flow

Service Bus coordinates processing work; Event Grid routes notifications about things that happened. An order producer submits work, a worker processes it, and application code publishes `OrderProcessed` to Event Grid for interested handlers. These are application events, not automatically generated Service Bus infrastructure events. Topics/subscriptions teach independent work consumers without making Event Grid an interchangeable queue.

Keep the business effect small and visible, such as recording that an order was processed and that a notification was handled. Do not add payment services, real email, AI inference, or a new database journey merely to make the example larger. A simulated application record store may hold idempotency/effect evidence; label its teaching scope rather than implying production durability.

Functions integration follows SDK fundamentals. Teach Python handler code, bindings/triggers, required configuration and a small simulated host lifecycle. Do not repeat AKS, image-build, or Container Apps deployment exercises.

## Execution architecture

Use bounded browser simulation driven by saved source and resource configuration, not a general Python interpreter. The existing legacy messaging and Functions Labs are configuration-only; SDK operations and Functions handler execution are new capabilities, not existing behavior to assume.

Separate responsibilities:

- **Lab definitions and fixtures:** curriculum metadata, starters, prepared baselines, Solutions, rationales and behavior predicates.
- **Source adapter:** reads saved files, resolves supported Python SDK/Functions constructs and provides actionable diagnostics. It must not compare the source against exact Solution text or run arbitrary JavaScript derived from learner input.
- **Messaging runtime:** owns queue/topic/event delivery transitions and the small business-effect records. It depends on explicit resource configuration and validated operations, not on UI state.
- **Functions adapter:** resolves supported host/trigger configuration and invokes the relevant validated handler through the messaging runtime.
- **Evidence and grading:** records operation results tied to the relevant saved source/configuration revision; Task predicates consume resources and fresh observed behavior.
- **Assistance UI:** presents independently controlled Solution, Task Rationale and Explanation Prompt controls.

Reuse existing command, project-file, Sandbox and Lab-run interfaces where appropriate. New capabilities must be scoped so existing configuration-only Labs do not silently change meaning. Keep legacy Labs available and preserve existing journey progress/results.

The implementation plan must enumerate the supported SDK calls, Python syntax forms, Functions decorators/configuration, event schema and simulator entry points before implementation. These must be grounded in current official SDK documentation and existing interfaces. No arbitrary Python compatibility is promised. All authored starter/Solution code must fit the declared subset, and harmless formatting/identifier variations must not require exact-text equality.

## Errors, delivery semantics and grading

Validate a supported operation before applying its effects. Unsupported constructs and malformed source/configuration produce explicit diagnostics, never fabricated success or partial credit for an operation that did not run. Identify the file/construct or resource setting that needs attention and explain simulator limitations separately from application mistakes.

Teach redelivery and idempotent effects rather than claiming exactly-once processing. Preserve the distinction between message completion, retry/abandonment and dead-lettering. Sessions provide per-session ordering, not universal ordering. Event filters select notifications; retries/dead-lettering do not replace correct handler logic.

Use deterministic bounded attempts and logical time for teaching retries and failure recovery. Do not make learners or developer tests wait through real Azure retry intervals. Label this simplification and avoid presenting simulated timings as Azure's actual delivery schedule.

Task completion comes from the required resource state and demonstrated behavior. Source/configuration edits invalidate affected execution evidence; unrelated edits should not invalidate every Task. Saving a Solution alone does not prove runtime behavior. Execution evidence persists through an ordinary resume but cannot leak between Labs or survive a reset as fresh evidence. Completed Lab Results remain historical records rather than being retroactively rewritten by later edits.

## On-demand explanations and copyable prompts

Solutions start hidden and open only when requested. Hints need not be exhausted first. Revealing a Solution does not execute it or expand its rationale automatically.

Each relevant Task has a collapsed `ℹ Why this?` control available while attempting the Task or reading its Solution, including after completion. It briefly explains what the resource/code does, why this application uses it, and what happens without it. Include a short C# comparison when useful. Avoid explaining every line by default. Task Rationale remains distinct from Hint and Exam Note.

Inside the expanded rationale, provide `Copy explanation prompt`. The copied message is self-contained: Lab/Task title and learning context, the specific concept, the learner's C# background and Python learning needs, and a request to explain rather than supply the complete worked answer. Use authored context, not a full workspace dump. Never include hidden Solutions or credentials. Copying sends nothing externally and does not automatically open GPT.

Example prompt shape:

> I know C# and am learning Python for AI-200. In this Order Processing Application lab, I am working on [Task]. Explain [concept]: what it does, why we use it here, and what happens without it. Use a short C# comparison where useful. Explain the concept without giving the complete lab Solution.

The copy control reports success only after a successful clipboard operation. If copying is unavailable, show selectable prompt text and a clear fallback message. Controls must work by keyboard, expose expanded state/accessibility labels, and preserve the learner's editing context. They do not count as Hint/Solution reveals; existing Hint/Solution accounting remains unchanged.

## Verification and publication constraints

Learner checks and developer tests are separate. Keep developer verification targeted to changed messaging/runtime/UI behavior and integration boundaries. Do not run AKS, Container Apps, full legacy replay, cloud integration or broad browser suites while developing this journey.

Prefer fast unit/component checks, small representative runtime checks, one compact Solution replay per new Lab, and a production build before publication. Shared mechanics should be tested once rather than repeatedly replayed through every Lab. Include negative cases for unsupported code, stale evidence and assistance-copy behavior without creating a large matrix.

Track cumulative test time per Lab publication, including reruns and CI. Aim comfortably below 30 minutes. If testing exceeds 30 minutes, stop expensive reruns and reduce/refactor the test structure before continuing; preserve focused checks for correctness-critical behavior rather than ignoring failures. New journey CI must run its focused checks, not rely solely on the currently published Data checks. Publication requires a later explicit integration decision and fresh evidence; this documentation-only stage does not publish anything.

## Non-goals

- More than 12 planned Labs, repeated topic triples, or experiment-heavy exercises.
- Event Hubs, real Azure execution, local Python setup, production email/payment services or live credentials.
- Full Python/Azure emulation, real retry waits, arbitrary webhooks or unrestricted learner-code execution.
- A second C# code track, automatic GPT requests or automatic Solution reveal/execution.
- Unrelated refactoring or changes to previously published AKS/Container Apps/Data curriculum.

## Acceptance and next gate

The original design/planning gates were completed and the user selected subagent implementation. The twelve-Lab branch now has the focused local verification recorded above. The remaining gate is controller-owned whole-branch review followed by an explicit integration/publication decision. Local verification is not a live release; CI and deployment results and elapsed time must be recorded only when those checks actually run.

## Grounding

- [AI-200 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200): Python proficiency and messaging/eventing objectives.
- [Azure messaging comparison](https://learn.microsoft.com/en-us/azure/service-bus-messaging/compare-messaging-services): distinct Service Bus and Event Grid roles.
- [Service Bus Functions trigger](https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-service-bus-trigger) and [Event Grid Functions trigger](https://learn.microsoft.com/azure/azure-functions/functions-bindings-event-grid-trigger): official integration references to recheck during detailed planning.
- Repository: `CONTEXT.md`, `src/components/lab/TaskRow.vue`, legacy `servicebus-order-backend.lab.js`, `eventgrid-filtered-subscription.lab.js`, `functions-serverless-api.lab.js`, and existing project/runtime interfaces.
