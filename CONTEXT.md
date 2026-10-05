# Azure-Trainer

Delivery status: all 16 Container Apps journey Labs are implemented and published through GitHub Pages. The Capstone combines image publication, bootstrap/main Bicep deployment, healthy Foundry/probe/CPU proof, simulated incident diagnosis and repair, recovery checkpoint, and owned-resource cleanup. The deployment review separates target provenance; neither the trainer nor the Capstone calls live Azure.

A static browser app for hands-on preparation for exam AI-200 (Developing AI Cloud Solutions on Azure, the successor of the retired AZ-204): a simulated Azure portal with a Cloud Shell in which you complete realistic developer tasks against a Sandbox, with no real Azure subscription involved.

## Language

Security and Observability journey: twelve implemented browser-only Labs continue the Order Processing Application. Labs 1–11 are progressive Guided Labs; Lab 12 combines secure notification, correlated Functions callbacks and a final computed telemetry query. Each Lab starts independently with disclosed prerequisite resources and fresh inputs, without prior completion proof. Publication remains subject to the journey's integration/review gates. See [simulator contract](docs/security-observability-simulator.md).

**Portal**:
The simulated Azure-portal-like frame the whole app lives in, including navigation, resource lists, Blades, and the tools used to complete Labs.
_Avoid_: Dashboard, Console, Simulator, Fake portal

**Cloud Shell**:
The simulated terminal docked at the bottom of the Portal where learners enter supported commands to configure, deploy, and inspect Sandbox resources.
_Avoid_: Terminal, Console, CLI panel, Shell drawer

**Experiment Controls**:
Visual controls for sending simulated requests, applying load, and introducing faults to observe how a deployed setup behaves.
_Avoid_: Azure commands, Deployment controls

**Blade**:
One Portal page showing a resource, a resource list or a settings section, opened from the portal menu or from a resource. Read-only in the demo: a mirror of the current state.
_Avoid_: Page, View, Panel, Screen

**Lab**:
One hands-on exercise: a short business brief followed by Tasks involving resource configuration, application or deployment files, and verification of behavior. The unit all practice and progress is organized around.
_Avoid_: Exercise, Test, Challenge, Scenario, Quiz

**Guided Lab**:
A Lab that teaches a topic through an ordered walkthrough of building a working setup and verifying its behavior.
_Avoid_: Tutorial mode

**Troubleshooting Lab**:
A Lab that starts with a faulty setup and requires the learner to diagnose the cause, repair it, and verify recovery.
_Avoid_: Debugging quiz

**Independent Lab**:
A Lab that presents requirements without a prescribed sequence of steps, requiring the learner to apply the topic and demonstrate correct behavior.
_Avoid_: Challenge, Assessment mode

**Capstone Lab**:
A final Lab that combines the topics practiced in the preceding Labs, requiring the learner to assemble and troubleshoot the complete application setup from scratch.
_Avoid_: Final quiz, Final exam

**Learning Journey**:
An ordered series of Labs covering a related platform or service family and ending in one Capstone Lab. A Journey may use Guided/Troubleshooting/Independent topic groups or progressive build-focused Labs, according to its learning goals.
_Avoid_: Track, Course, Path, Module

**Application Factory**:
A reusable application starter containing a REST API, configuration, container image, and deployment infrastructure that the learner adapts and deploys during Labs.
_Avoid_: Azure Data Factory, application factory function

**Knowledge Assistant**:
The example application in the AKS and Data learning journeys that answers practice questions using retrieved document passages and returns answers with source references. In the Data journey it keeps its document corpus in PostgreSQL, its Conversation History in Cosmos DB, and its Response Cache and Semantic Cache in Redis.
_Avoid_: General-purpose chatbot, live AI assistant

**Conversation History**:
The Knowledge Assistant's record of sessions, the questions asked, the answers returned and learner feedback on those answers. It is also searched for similar previously answered questions.
_Avoid_: Chat log, Transcript, Memory

**Order Processing Application**:
The shared business example in the Messaging and Security and Observability Learning Journeys, in which orders are accepted and their processing is coordinated across application components. Successive Labs develop, secure and observe this same example.
_Avoid_: Knowledge Assistant, unrelated per-Lab demo

**Order API**:
The HTTP-facing interface through which callers interact with the Order Processing Application. It is distinct from the background components that process queued orders and route their completion events.
_Avoid_: New application, notification worker, unrelated API demo

**Order Status**:
The current progress of a submitted order through the Order Processing Application. Acceptance for processing is distinct from successful completion of processing.
_Avoid_: HTTP status code, response code, notification delivery status

**Order Status Repository**:
The supplied application component that exposes actual Order Status independently of an HTTP handler's lifetime. It is the Order API's source of processing progress, rather than a canned response.
_Avoid_: Process-global dictionary, hardcoded status, new database journey

**Response Cache**:
Stored answers reused only when a new request has exactly the same normalized question and filters.
_Avoid_: Semantic Cache, Output cache

**Semantic Cache**:
Stored answers reused when a new question's embedding is similar enough to a cached question's embedding, even if the wording differs.
_Avoid_: Response Cache, Vector cache, Fuzzy cache

**Task**:
One checkable step of a Lab, stated as a condition over the Sandbox's resource configuration or evidence of observed behavior (e.g. replicas increasing under load). A Task is satisfied by meeting its condition, rather than by entering a prescribed command sequence.
_Avoid_: Step, Objective, Requirement, Check

**Sandbox**:
The simulated Azure subscription a Lab runs in: its resources, their properties, and evidence of their simulated behavior. It is disposable and isolated per Lab; Tasks are judged against it.
_Avoid_: Subscription, Environment, State, Workspace

**Skill Area**:
One of the four top-level groups of the official AI-200 "skills measured" outline, named verbatim and carrying its exam weight. Every Lab belongs to exactly one Skill Area; the Azure service a Lab is about is a tag, not a second hierarchy.
_Avoid_: Category, Domain, Module, Topic, Section

**Hint**:
One of up to two on-demand nudges attached to a Task, ordered from concept to command group and key flag. Revealing one is recorded on the Lab Result.
_Avoid_: Tip, Clue, Help

**Solution**:
The complete worked answer to a Task, including the commands or file changes needed to satisfy it, revealed only when the learner requests it. Consulting a Solution is recorded on the Lab Result; it is not automatic task completion.
_Avoid_: Answer, Cheat, Reveal

**Task Rationale**:
An on-demand explanation of why a particular resource, setting or code construct is chosen for a Task and what it accomplishes. It is distinct from a Hint or an Exam Note.
_Avoid_: Hint, Exam Note, Solution

**Explanation Prompt**:
A self-contained request for further explanation of a Task's concept, including its learning context and the learner's C# background. It supports understanding rather than revealing the Task's complete Solution.
_Avoid_: Solution, Hint, automatic AI explanation

**Exam Note**:
The one- or two-sentence exam-relevant insight shown when a Task ticks (e.g. "Topics require Standard tier or higher").
_Avoid_: Explanation, Takeaway, Fun fact

**Lab Panel**:
The collapsible pane docked on the right of the Portal while a Lab runs: brief, Task list with live ticks, Hints, Solution and Exam Notes. Sits beside the Blade, never over it.
_Avoid_: Sidebar, Instructions pane, Guide, Drawer

**Lab Result**:
The persisted record of one completed Lab: which Tasks were done, which Hints and Solutions were revealed, how long it took and when it finished. The unit all progress on Home is computed from. A Lab in progress has no Lab Result yet; its Sandbox and shell history are kept so it can be resumed.
_Avoid_: Attempt, Score, Grade, History entry
