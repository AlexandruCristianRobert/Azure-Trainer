# Messaging Learning Journey — discussion

Status: conversational discovery complete with grill-with-docs and Superpowers brainstorming. Consolidated into `2026-10-02-messaging-learning-journey-design.md`, awaiting written-spec review. This discussion is historical decision evidence, not an implementation plan.

## User-stated requirements

- Cover Azure Service Bus and Azure Event Grid in a new Learning Journey.
- Maximum15 Labs; fewer are acceptable. Do not inflate the curriculum to fill the limit.
- Emphasize creating resources and writing application code, rather than extensive Experiment Controls or testing exercises.
- Support frequent use of complete worked Solutions without removing the opportunity to think and attempt each Task first.
- Provide an info button explaining why a particular resource, setting or code construct is used and what it accomplishes.
- Preserve the previous small developer-verification policy; learner experiments and implementation tests are separate concerns.

## Existing domain and code

- The Learning Journey glossary originally prescribed Guided/Troubleshooting/Independent topic groups. It now also permits progressive build-focused Labs, reflecting the agreed Messaging journey structure without changing existing journeys.
- Solutions remain on-demand: the learner thinks and attempts the Task before choosing Show solution. Frequent Solution use does not mean automatic reveal or execution, and hints need not be exhausted first.
- The existing Service Bus order-backend Lab provisions namespaces, queues, topics, subscriptions and rules; it does not provide SDK producer/consumer code practice.
- The existing Event Grid filtered-subscription Lab explicitly grades configuration only, not webhook validation, publication or delivery. The new journey must not claim runtime support that is not implemented.
- TaskRow currently supports task.explanation as inline text for the active task. It has no dedicated rationale/info button. Exam Notes are shown after task completion; they are not a substitute for explanations available while following a Solution.

## Decisions agreed

- Solutions start hidden and are revealed only when requested. The learner retains the opportunity to attempt the Task independently.
- Task Rationale is presented through a collapsed info/Why this? control beside the relevant step. Opening a Solution does not automatically expand every explanation.
- Task Rationale explains why a resource, setting or code construct is chosen and what it accomplishes; it is distinct from a Hint and an Exam Note.
- One coherent Order Processing Application is used throughout the journey. Labs progressively develop the same business example rather than switch to unrelated applications.
- The learner knows C#, not Python, but prefers Python when needed for exam alignment. Keep Python as the journey's application language because the current AI-200 audience profile explicitly expects Python proficiency; this is not a claim that every exam code question is Python-only.
- Service Bus coordinates order-processing work; Event Grid routes notifications about facts such as `OrderProcessed` to interested handlers. The two services have distinct roles within the same application.
- Use progressive build-focused Labs followed by one final Capstone, not repeated Guided/Troubleshooting/Independent triples. Small repair exercises may be embedded where they teach important failure handling; do not inflate the Lab count with repeated exercises.
- Each Task Rationale briefly explains what the resource or code does, why it is used here, and what happens without it. Include a short C# comparison when useful; do not explain every line by default.
- Inside the expanded Task Rationale, provide a one-click Copy explanation prompt control. Copy a self-contained message containing the Lab/Task context, the specific concept, and the learner's C# background/Python learning needs for manual pasting into GPT. Ask for a conceptual explanation, not the complete worked answer; do not include hidden Solutions, credentials, or a full workspace dump. Copying does not send anything externally or open GPT automatically. Show copy success or a selectable-text fallback if clipboard access fails.
- Each build Lab ends with one short behavior check, not a lengthy experiment sequence. This must demonstrate the intended operation using supported simulated behavior, not merely accept source text; failure-handling Labs may use a compact check of their specific failure/recovery path. Developer verification remains focused, excludes AKS/Container Apps suites, and must be reduced/refactored if testing exceeds 30 minutes per Lab publication.
- Start with Python SDK scripts, then include a small Azure Functions integration for Service Bus and Event Grid handlers. Keep the focus on writing handlers and their required configuration; do not repeat AKS or Container Apps deployment exercises. Functions simulation support must be inspected and designed before promising executable behavior.
- The curriculum contains 12 Labs: six Service Bus build Labs (setup/send; receive/settle; dead-letter handling; duplicate-safe processing; topics/subscription filters; sessions/ordered processing), three Event Grid build Labs (custom event publication; handlers/subscription filters; retries/dead-letter handling), two Functions integration Labs (Service Bus handler; Event Grid handler), and one combined Capstone. Do not pad the curriculum to the maximum of 15.
- Later build Labs start from a prepared, isolated baseline representing the preceding application stage. Their new learning Tasks remain unfinished, and starting a Lab does not require completing earlier Labs or importing the learner's earlier mistakes. The Capstone starts from a minimal starter instead.
- Use bounded browser simulation driven by saved Python source and resource configuration, with explicitly documented supported SDK/Functions constructs. No real Python installation, live Azure calls, credentials, or external execution service is required. This is a behavioral teaching simulator, not a full Python interpreter or Azure emulator.

## Design handoff

Error handling and grading are approved: actionable diagnostics for invalid code/configuration, explicit unsupported-feature errors rather than pretend success, behavior-based Task checks rather than exact Solution-text matching, and fresh relevant execution evidence after source/configuration changes. Keep educational repair scenarios compact. The next gate is user review of the written design specification; implementation planning and product changes remain later stages. C# comparisons are a learning aid, not a second implementation track.

## Technical grounding

Microsoft's messaging comparison distinguishes Service Bus business/workflow messaging from Event Grid reactive event routing. This distinction will guide the curriculum rather than treating them as interchangeable data-transfer services: https://learn.microsoft.com/en-us/azure/service-bus-messaging/compare-messaging-services

Microsoft's current AI-200 study guide explicitly lists Python programming among expected proficiencies. It does not establish that every code question uses Python or that candidates can choose a C# code variant: https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200
