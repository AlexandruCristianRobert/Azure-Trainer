# Labs run against an in-browser Sandbox driven by a simulated `az` CLI, not a real Azure subscription

Azure-Trainer needs hands-on practice for exam AI-200, and the obvious way is to point the learner
at a real Azure subscription and verify resources through the ARM API. We chose to simulate instead:
the Cloud Shell parses a whitelisted subset of `az` commands and mutates an in-memory Sandbox,
Blades render that Sandbox, and Tasks are conditions evaluated over it. A real subscription would
cost money per Lab, require Entra sign-in and resource cleanup, and could not run as a static
single-user file like its sibling trainers. The price is fidelity: only the commands, flags, outputs
and error messages we implement exist, every Lab is also a parser-and-renderer authoring job, and any
behaviour that differs from real Azure is our bug rather than Azure's.

**Considered alternatives:** real subscription via ARM (rejected for cost, auth and hosting);
AI-graded free-text commands (rejected: nothing deterministic to mirror in Blades, and grading needs
a configured model).

**Consequences:** In the demo the Cloud Shell is the only path that changes the Sandbox and Blades
are read-only mirrors; portal-click mutation can be added later over the same Sandbox without
changing this decision. Command coverage must be stated per Lab so learners know the boundary of
the simulation.
