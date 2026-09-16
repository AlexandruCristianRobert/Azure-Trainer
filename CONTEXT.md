# Azure-Trainer

A static browser app for hands-on preparation for exam AI-200 (Developing AI Cloud Solutions on Azure, the successor of the retired AZ-204): a simulated Azure portal with a Cloud Shell in which you complete realistic developer tasks against a Sandbox, with no real Azure subscription involved.

## Language

**Portal**:
The simulated Azure-portal-like frame the whole app lives in: top bar, portal menu, resource lists and Blades. In the demo it only displays state; it never changes it.
_Avoid_: Dashboard, Console, Simulator, Fake portal

**Cloud Shell**:
The simulated terminal docked at the bottom of the Portal that accepts `az` commands. The only way to change state in the demo.
_Avoid_: Terminal, Console, CLI panel, Shell drawer

**Blade**:
One Portal page showing a resource, a resource list or a settings section, opened from the portal menu or from a resource. Read-only in the demo: a mirror of the current state.
_Avoid_: Page, View, Panel, Screen

**Lab**:
One hands-on exercise: a short business brief followed by Tasks you complete in the Cloud Shell. The unit all practice and progress is organized around.
_Avoid_: Exercise, Test, Challenge, Scenario, Quiz

**Task**:
One checkable step of a Lab, stated as a condition over the Sandbox (e.g. "a storage account named contoso01 exists with LRS redundancy"). Re-evaluated after every command and ticked as soon as the Sandbox satisfies it, regardless of which commands or order got it there.
_Avoid_: Step, Objective, Requirement, Check

**Sandbox**:
The simulated Azure subscription a Lab runs in: the resources that exist and their properties. Commands in the Cloud Shell change it; Blades display it; Tasks are judged against it. Disposable and isolated per Lab.
_Avoid_: Subscription, Environment, State, Workspace

**Skill Area**:
One of the four top-level groups of the official AI-200 "skills measured" outline, named verbatim and carrying its exam weight. Every Lab belongs to exactly one Skill Area; the Azure service a Lab is about is a tag, not a second hierarchy.
_Avoid_: Category, Domain, Module, Topic, Section

**Hint**:
One of up to two on-demand nudges attached to a Task, ordered from concept to command group and key flag. Revealing one is recorded on the Lab Result.
_Avoid_: Tip, Clue, Help

**Solution**:
The full command (or commands) that satisfies a Task, revealed on demand after the Hints as the last resort. Recorded on the Lab Result like a Hint.
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
