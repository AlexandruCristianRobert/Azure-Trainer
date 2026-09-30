# Azure-Trainer

Delivery status: all 16 Container Apps journey Labs are implemented in this worktree, with Lab 16 pending scoped review and guarded delivery. The Capstone combines image publication, bootstrap/main Bicep deployment, healthy Foundry/probe/CPU proof, simulated incident diagnosis and repair, recovery checkpoint, and owned-resource cleanup. The deployment review separates target provenance; neither the trainer nor the Capstone calls live Azure.

A static browser app for hands-on preparation for exam AI-200 (Developing AI Cloud Solutions on Azure, the successor of the retired AZ-204): a simulated Azure portal with a Cloud Shell in which you complete realistic developer tasks against a Sandbox, with no real Azure subscription involved.

## Language

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

**Application Factory**:
A reusable application starter containing a REST API, configuration, container image, and deployment infrastructure that the learner adapts and deploys during Labs.
_Avoid_: Azure Data Factory, application factory function

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
The complete worked answer to a Task, including the commands or file changes needed to satisfy it, revealed on demand after the Hints as the last resort. Recorded on the Lab Result like a Hint.
_Avoid_: Answer, Cheat, Reveal

**Exam Note**:
The one- or two-sentence exam-relevant insight shown when a Task ticks (e.g. "Topics require Standard tier or higher").
_Avoid_: Explanation, Takeaway, Fun fact

**Lab Panel**:
The collapsible pane docked on the right of the Portal while a Lab runs: brief, Task list with live ticks, Hints, Solution and Exam Notes. Sits beside the Blade, never over it.
_Avoid_: Sidebar, Instructions pane, Guide, Drawer

**Lab Result**:
The persisted record of one completed Lab: which Tasks were done, which Hints and Solutions were revealed, how long it took and when it finished. The unit all progress on Home is computed from. A Lab in progress has no Lab Result yet; its Sandbox and shell history are kept so it can be resumed.
_Avoid_: Attempt, Score, Grade, History entry
