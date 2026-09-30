# Container Apps learning journeys

Status: curriculum scope and learning flows agreed on 2026-09-22. The [technical design](2026-09-22-containerapps-learning-journeys-technical-design.md) and [ADR-0002](../../adr/0002-behavioral-labs-with-bounded-local-simulation.md) now describe the implementation architecture. Application code has not been changed as part of this documentation work.

Delivery status: the three Application Factory and deployment Labs, three CPU autoscaling Labs, all three health probes Labs, and all three Foundry integration Labs are implemented. Bicep and the Capstone remain planned.

Delivery constraint confirmed by the user: implement **one Lab at a time**, introducing and verifying only the necessary shared building blocks first. Finish and verify that Lab before moving to the next. The technical design identifies F0 (run/evidence/persistence foundation), then F1 (Lab 1 prerequisites), followed by Lab 1.

## Overview

The agreed journey contains 16 Labs: Guided, Troubleshooting, and Independent Labs for each of five topics, followed by one Capstone Lab. Learners use a C# / ASP.NET Core starter, guided file editing, Cloud Shell deployment commands, and visual Experiment Controls. Each Lab runs in an isolated local Sandbox and requires observable evidence of correct behavior.

The topic order is Application Factory and deployment, CPU autoscaling, health probes, Foundry-backed REST API, and modular Bicep. The Capstone Lab combines preparation, image publication, deployment, verification, incident recovery, reproducibility, and cleanup. Optional help is recorded; relevant changes require fresh verification; the longer capstone can be resumed across sessions.

## Confirmed direction

- Extend the training app with end-to-end Labs covering CPU-based autoscaling, health probes, REST APIs using Foundry, setup workflows, and Bicep files.
- Application Factory means a reusable starter REST API, configuration, container image, and infrastructure that the learner adapts and deploys. It does not refer to Azure Data Factory or an application factory function in code.
- New Labs must require observable behavior within the simulated Sandbox to pass. Configuration checks alone are insufficient.
- The learning experience includes generating simulated load, inspecting metrics or logs, encountering failures, repairing the setup, and verifying recovery. Agreed learning flows are detailed below; exact Task wording and acceptance fixtures remain implementation-design work.
- Retain the existing local simulation approach; this choice does not introduce real Azure deployments or live model calls.
- Organize the journey as ordered, independently restartable Labs followed by a Capstone Lab. Use the same example API across the journey, with each topic Lab starting with its required prerequisites instead of inheriting the learner's resource state from the previous Lab.
- The Capstone Lab requires assembling and troubleshooting the complete setup from scratch, following the agreed stages below.
- For this phase, use guided file editing inside the app: learners edit starter API code, Dockerfiles, configuration, and Bicep. Validate supported changes and simulate their effects. This is a provisional scope choice ("for now"), not a permanent restriction against a future coding workspace.
- Arbitrary application-code execution and a full build/test runtime are outside this phase. Exact supported constructs remain to be defined. Editing source does not change a built image or deployed application; rebuild and redeploy when a Task depends on changed source.
- Each topic has three distinct Labs: a Guided Lab for building and verifying a setup, a Troubleshooting Lab with a faulty starting setup, and an Independent Lab with requirements but no prescribed steps. Each remains independently restartable; these are separate Labs rather than randomized runs of one Lab.
- The initial catalog contains five topics with three Labs each, followed by one Capstone Lab: 16 Labs in this learning journey. Dedicated release-management Labs for revisions, traffic splitting, and rollback are deferred.
- Optional Hints and Solutions remain available in all Lab types, including Independent Labs and the Capstone Lab. Independent Labs and the Capstone Lab initially present requirements without a prescribed walkthrough; help is revealed only on request.
- Record Hint and Solution usage on the Lab Result and distinguish completion with assistance from completion without assistance. Using help does not prevent completion. Repeating a Lab without help provides a way to check understanding; the exact result presentation remains to be designed.
- Use C# with ASP.NET Core for the starter REST API throughout the initial journey. This is the language of the learning material; it does not change the trainer's Vue/JavaScript implementation. Exact .NET version and API structure remain to be selected.
- Use visual Experiment Controls alongside the file editor and Cloud Shell. Learners deploy through commands, then send simulated requests, apply load, and introduce faults through these controls; metrics and logs provide observable results.
- Experiment Controls extend the original Cloud-Shell-only mutation rule to simulation experiments. They do not replace deployment commands or turn read-only resource Blades into configuration editors. Exact controls, workloads, and faults remain to be specified.
- Relevant changes to a previously verified setup mark affected behavioral Tasks as needing verification. The learner must rerun the affected experiments successfully; unrelated Task progress is retained. An earlier successful experiment cannot prove that a changed setup still works.
- Deliberate final cleanup preserves the previously verified milestones. Cleanup must not erase proof of earlier deployment and behavior. Exact milestone boundaries, dependency tracking, and treatment of already completed Lab Results remain to be designed.
- Bicep Labs use a modular project with `main.bicep`, reusable local modules, and environment parameter files. Cover module outputs and connections, dependency/parameter errors, validation, change previews, deployment, updates, and adaptation to another environment.
- Bicep progression: complete and deploy a supplied starter project in the Guided Lab; repair broken module connections or incorrect parameters in the Troubleshooting Lab; adapt the project to a new environment and verify the resulting application in the Independent Lab.
- Support a documented subset of Bicep sufficient for these Labs. Validation, what-if previews, and deployment remain simulated; a general-purpose Bicep compiler and full Azure Resource Manager coverage are not implied.
- Include the complete simulated container-image lifecycle within the agreed 16 Labs: edit the C# starter and Dockerfile, build an image, publish to Azure Container Registry, configure managed identity for private image access, deploy to Container Apps, and verify requests. Prepared images alone are not sufficient for the deployment topic.
- The deployment topic covers build/Dockerfile errors, missing image tags, denied registry access, and port mismatches. The three deployment Labs divide these cases as described below. No real Docker build, registry push, or Azure deployment is introduced.

## Existing implementation boundary

The original Container Apps KEDA Lab checks resource creation, ingress, replica limits, and an HTTP scaling rule without simulating replica activity. The three CPU journey Labs add bounded CPU workload and replica observations. Guided health probes measures startup gating, readiness routing, and liveness restart. Probe Troubleshooting starts in a measured restart loop and verifies repaired startup, optional dependency isolation, and real hang recovery. Probe Independent asks learners to choose endpoint logic and timing for a different 30-second API, then proves three bounded outcomes in any order under one current deployment.

## Agreed initial catalog

The following describes learning outcomes, not finalized Task lists or command coverage.

| Topic | Guided Lab | Troubleshooting Lab | Independent Lab |
| --- | --- | --- | --- |
| Application Factory and deployment | Adapt the C# starter API, containerize it, deploy, and send a request | Diagnose a failed startup or unreachable endpoint | Deploy a new API configuration from requirements |
| CPU autoscaling | Configure resources and scaling; verify behavior under load | Diagnose insufficient scaling using metrics | Meet workload requirements within replica limits |
| Health probes | Configure startup, readiness, and liveness; observe each | Diagnose unhealthy replicas and restart loops | Handle slow startup and injected failures correctly |
| Foundry-backed REST API | Configure model access and identity; verify an API request | Diagnose access failures, throttling, and timeouts | Configure integration and demonstrate error handling |
| Bicep | Edit resources and parameters, validate, preview, deploy, and update | Repair deployment errors and incorrect resource connections | Reproduce a complete setup from infrastructure files |

The Capstone Lab starts from the application template and combines infrastructure provisioning, API deployment, Foundry integration, probes, scaling, fault diagnosis, recovery verification, and cleanup. All behavior remains simulated.

## Agreed detailed design: Application Factory and deployment

Status: learning flow and depth confirmed by the user. Exact commands, supported file edits, and acceptance fixtures remain implementation-design work.

### Guided Lab: From starter API to a working Container App

Start with the supplied C# API project and no deployed resources. Group the walkthrough into three stages, preserving checkpoints across the stages:

1. Prepare the application: inspect the starter, complete a supported API/configuration edit, and configure the Dockerfile's build and startup instructions.
2. Publish the image: create the resource group and private registry, run the simulated image build, and verify the resulting tagged image. A successful image records the supported source/configuration used to build it; editing a file afterward does not silently change that image.
3. Deploy and verify: create the Container Apps environment and managed identity, grant image-pull access, deploy the selected image with matching ingress/port configuration, send a request using Experiment Controls, and inspect the response and logs.

Observable completion requires a successful request to the deployed API with the expected status and response content. Resource creation or build success alone cannot complete the Lab. Rebuilding and redeploying are required when a Task depends on changed application source.

### Troubleshooting Lab: Diagnose a failed deployment

Start with a supplied project and a faulty deployment setup. Faults are a missing image tag, missing image-pull permission, and a mismatch between the application listening port and ingress target port. The learner must inspect evidence, make repairs, redeploy as needed, and demonstrate a successful API request. Dockerfile/build diagnostics are introduced in the Guided Lab and reinforced in the Independent Lab, keeping this Lab's incident bounded.

Present symptoms and expected behavior without initially revealing the causes. Logs and resource/image inspection expose concrete diagnostic evidence; Hints and Solutions remain available on request. Use a deterministic starting incident so restarting reliably reproduces the exercise.

### Independent Lab: Deploy a second configuration

Start with the reusable application template and a new deployment brief. Supply required names, a different application port, a required configuration value, and an expected API response, without a command sequence. Require source/configuration edits, a successful image build and publication, private image access, deployment, and a successful request proving the deployed app uses the requested configuration.

The variation changes meaningful application/deployment behavior, not just resource names. Prepared prerequisites must not bypass the image lifecycle being assessed. The technical design retains topic-Lab resources after verification for inspection; mandatory final cleanup belongs to the capstone.

## Agreed detailed design: CPU autoscaling

Status: learning flow and depth confirmed by the user. Exact workload fixtures, numerical targets, and simulation timing remain implementation-design work.

Each Lab starts with the example API already deployed in its own Sandbox. Provide a simulated CPU-intensive workload in the API so the learner can isolate CPU scaling from requests waiting on an external AI service. Repeating registry setup is unnecessary in these topic Labs.

### Guided Lab: Observe CPU scaling through a workload cycle

1. Inspect the deployed API's CPU allocation, current replicas, and baseline CPU utilization.
2. Configure a CPU utilization scaling rule and replica bounds. Proposed teaching values are a 60 percent utilization target, minimum 1 replica, and maximum 5; these are exercise values, not production recommendations.
3. Apply a sustained CPU-intensive workload through Experiment Controls and observe CPU utilization, replica count, and scaling events over simulated time.
4. Apply an overload that demonstrates the configured maximum; distinguish hitting the replica cap from satisfying all demand.
5. Remove the load and observe scale-in after a modeled stabilization interval, down to the configured minimum.

Completion requires evidence of baseline, scale-out, a bounded overload, and scale-in against the relevant deployed configuration. Configuration alone is insufficient. Explain that utilization is relative to requested CPU and that CPU-only scaling does not provide scale-to-zero.

### Troubleshooting Lab: Scaling stops while CPU remains high

Start with sustained CPU load and a restrictive maximum replica count. Present symptoms and metrics without naming the cause. The learner compares observed CPU, current replicas, configured target, and replica bounds; repairs the limiting configuration within the brief's allowed ceiling; then repeats the same workload and verifies recovery. Removing the test load is not an acceptable substitute for repairing the setup.

Require a final scale-in experiment too, so a fix must handle quiet periods as well as demand. Keep the starting workload and faults deterministic.

### Independent Lab: Meet a different workload brief

Provide a new workload pattern, allowed CPU allocations, a replica ceiling, a required minimum, and measurable simulated response/throughput goals. The learner chooses a supported resource/scaling configuration, demonstrates behavior under steady demand and a burst, and verifies return to the minimum after load ends. Accept multiple supported configurations that meet the requirements rather than requiring one exact command sequence or threshold.

### Fidelity boundaries

- Use deterministic simulated time and expose the workload and measurement window. Scale changes must not appear instantaneous; exact model intervals and workload values remain to be calibrated.
- Clearly label performance numbers as simulated teaching results, not Azure capacity predictions.
- Keep CPU work separate from remote-service waiting time. Do not imply that increasing replicas fixes Foundry throttling or slow downstream inference.
- Basic deployment-version tracking remains necessary even though dedicated revision/traffic-splitting Labs are deferred: scale-rule changes must invalidate the relevant prior behavior evidence.
- Before implementation, reconcile command semantics with current Azure CLI behavior. The existing simulator appends/replaces rules by name, while Microsoft's scaling tutorial describes replacement when using CLI scale-rule flags and YAML for multiple rules; do not extend the existing behavior without checking that boundary.

References checked during design: [Container Apps scaling tutorial](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-scaling), [scaling rules](https://learn.microsoft.com/en-us/azure/container-apps/scale-app), and [KEDA CPU scaler](https://keda.sh/docs/2.18/scalers/cpu/).

## Agreed detailed design: Health probes

Status: learning flow and depth confirmed by the user. Exact supported endpoint edits, probe fields, and timing fixtures remain implementation-design work.

Start each Lab with the API project, published image, and deployed Container App available in an isolated Sandbox. Provide supported C# edits for separate startup, readiness, and liveness HTTP endpoints, with explicit probe configuration. Source edits require rebuilding and redeploying; probe configuration changes require deploying the updated configuration.

### Guided Lab: Observe the three probe behaviors

1. Inspect and complete separate endpoint behavior for startup completion, readiness to serve requests, and process responsiveness. Configure the corresponding paths, ports, timing, and thresholds.
2. Deploy with a modeled slow startup. Observe that startup succeeds within the allowed window without a premature restart, and traffic begins only when the replica is ready.
3. With two replicas and a small fixed request workload, inject a readiness-only fault into one replica. Observe its removal from ready traffic targets while the other replica handles requests; verify no restart is caused solely by the readiness failure. Clear the fault and observe re-entry after readiness succeeds.
4. Inject a process-level hang that remains until the container restarts. Observe failed liveness checks, a restart after the configured threshold, a new startup sequence, and eventual readiness and successful requests.

Completion requires separate evidence for successful delayed startup, readiness traffic exclusion and recovery, and liveness-triggered restart and recovery. A green probe configuration display is insufficient.

### Troubleshooting Lab: Stop the restart loop without hiding failure

Use a deterministic incident with an insufficient startup allowance and a liveness endpoint incorrectly coupled to a simulated downstream dependency. Present restart events, probe outcomes, application startup logs, and request results without initially disclosing the causes.

The learner repairs startup handling and separates process health from dependency availability. Rerun the same startup and dependency-failure experiments to prove unnecessary restarts are gone, then inject a genuine process hang to prove liveness still detects it. Disabling probes, returning unconditional success, or allowing unbounded detection delays must not pass.

The dependency is supplied as a simulated fixture; this Lab does not require completing the later Foundry provisioning Labs. Readiness requirements must be stated for the example API's serving contract rather than treating every external dependency outage as a universal reason to remove all replicas from traffic.

### Independent Lab: Configure health checks from a reliability brief

Provide a different startup duration, required traffic-exclusion behavior for an unready replica, and a maximum allowed detection/recovery interval for a process hang. The learner selects supported endpoint logic and probe settings, rebuilds/redeploys when appropriate, and passes all three experiments without a prescribed sequence.

Accept multiple configurations that meet the stated bounds. Require both healthy-path and failure-path evidence so always-successful endpoints and overly permissive thresholds cannot satisfy the brief.

### Fidelity boundaries

- Use explicit HTTP probes for the taught flow and document the supported subset of timing/threshold fields. Do not imply arbitrary Kubernetes probe types are available in Container Apps.
- Record events per replica, including probe type, outcome, readiness, restart count, and request routing, on the simulated timeline.
- A startup probe gates readiness/liveness checks until it succeeds. Readiness controls eligibility for traffic; liveness/startup failure thresholds can trigger a restart. Distinguish these effects in acceptance fixtures.
- Model a bounded simulation, not actual process execution, and identify any simplified restart/timing behavior.
- Before implementation, reconcile an ambiguity in the current Microsoft Container Apps health-probe page: its readiness narrative mentions restarts, whereas Kubernetes explicitly distinguishes readiness traffic exclusion from liveness/startup-triggered restarts. Verify ACA-specific behavior using authoritative implementation/specification evidence rather than silently encoding that ambiguous sentence.

References checked during design: [Container Apps health probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes) and [Kubernetes probe behavior](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/).

## Agreed detailed design: Foundry-backed REST API

Status: learning flow and depth confirmed by the user. Exact Foundry integration version, commands, supported C# edits, and incident fixtures remain implementation-design work.

Use the same C# API with a supported text-inference endpoint, such as submitting text and receiving a summary. The API and its image/deployment prerequisites are supplied at the start of each isolated Lab; the Guided Lab begins without the Foundry resources or model deployment. All model outputs are deterministic simulated fixtures, and the UI must identify them as such.

### Guided Lab: Provision model access and make an API request

1. Create the simulated Foundry resource, project where required by the selected integration, and a supported model deployment. Inspect its endpoint and deployment name.
2. Configure the Container App's managed identity and the scoped inference permission required by the selected endpoint/API. Distinguish registry image-pull access from permission to call a model.
3. Complete supported C# client/configuration edits: endpoint, deployment selection, managed-identity authentication, input validation, and a bounded request timeout. Rebuild and redeploy source changes.
4. Send a valid request through Experiment Controls and trace the API's authorized model call and response. Send invalid input and verify it is rejected without a model call.

Completion requires a successful request through the Container App to the intended simulated deployment, using the intended app identity, and a response matching the required API contract. A configured endpoint or a canned application response with no recorded model invocation cannot pass.

### Troubleshooting Lab: Diagnose access and dependency failures

Use reproducible incident stages: an incorrect endpoint/deployment selection, missing inference permission for the app identity, and then transient throttling or a dependency timeout. Present distinct diagnostic evidence for each stage, so authorization failures do not masquerade as throughput problems.

The learner repairs configuration/access, configures a supported bounded retry policy for retryable failures (honoring Retry-After when present), and handles an exhausted retry/timeout budget with the specified application error response. Rerun the incident scenarios and a healthy request to prove both recovery and correct failure reporting.

Do not retry authorization/configuration errors indefinitely. Do not let increasing Container App replicas satisfy a model-permission, model-quota, or dependency-timeout Task. Runtime role assignments must target the caller identity and appropriate resource scope.

### Independent Lab: Integrate another deployment reliably

Provide a different supported deployment, API request/response contract, identity requirement, and maximum total request/retry budget. The learner provisions the needed Foundry setup, adapts the API configuration/code, deploys it, and verifies a successful request, rejection of invalid input, recovery from a transient throttle, and a controlled response to persistent dependency failure.

Accept supported implementations that meet the contract and timing limits. Require model-invocation evidence tied to the active application/configuration so returning an unconditional success or stale result cannot bypass the integration.

### Fidelity boundaries

- Teach one coherent C# inference integration in the first release. Pin the Foundry resource/project shape, endpoint family, SDK/API, deployment type, token audience, and RBAC role together before authoring commands or code; do not combine examples from different Foundry generations.
- Keep inference deployment names distinct from model catalog names. Endpoint/deployment errors, missing credentials, missing permissions, throttling, and timeouts require distinguishable evidence.
- Account for any built-in SDK retries when modeling the total attempt count and timeout budget; avoid accidentally teaching compounded retry loops.
- Request traces may show timing, attempt count, deployment, caller identity, status, and correlation identifiers. Do not require learners to paste real credentials or use live model endpoints.
- Include only the inference setup needed by this API. Agents, RAG/vector retrieval, model training, and broad model-quality evaluation are outside this initial topic.

References checked during design: [Foundry keyless authentication](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/configure-entra-id), [Foundry model endpoints](https://learn.microsoft.com/en-us/azure/ai-studio/ai-services/concepts/endpoints), and [handling throttling in model deployments](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/provisioned-get-started).

## Agreed detailed design: Bicep

Status: learning flow and depth confirmed by the user. Exact Bicep constructs, resource schemas, deployment mode, and acceptance fixtures remain implementation-design work.

Use `main.bicep`, local modules, and environment parameter files in the guided editor. The Bicep topic begins with a usable application image and private registry supplied in the Lab Sandbox, so infrastructure authoring is the focus. The Capstone Lab still requires the complete image lifecycle. Represent supplied prerequisites explicitly rather than silently creating them during template deployment.

### Guided Lab: Deploy and update a modular application setup

1. Inspect the starter project and identify resources, parameters, module inputs, and outputs. Complete supported module connections for the environment, identity, application, and Foundry integration; reference the supplied registry/image explicitly.
2. Set the first environment's parameters, validate the files, and run a simulated what-if preview. Inspect the proposed resource/property changes before deploying.
3. Deploy the files, inspect outputs and resources, and send an API request that proves the intended model integration works.
4. Change a behaviorally relevant setting such as the maximum replica count. Preview the update, deploy it, and rerun the affected load experiment to prove the new setting took effect.
5. Redeploy unchanged files and parameters. Verify no duplicate logical resources or unintended configuration changes appear in the supported model.

Completion requires evidence that the deployed state came from the current files and parameter selection, together with successful runtime experiments. Merely producing valid syntax or obtaining a successful deployment status is insufficient.

### Troubleshooting Lab: Repair the infrastructure source

Use staged, reproducible failures: a broken module output reference caught by validation, a wrong environment parameter revealed by the preview, and an incorrect identity/scope connection that produces an application access failure after deployment.

The learner distinguishes validation errors, incorrect proposed changes, deployment results, and runtime failures. Repair the appropriate files or parameters, repeat validation/preview/deployment as needed, and rerun the affected API experiment. Symptoms and evidence appear first; Hints and Solutions remain optional.

A manual resource repair alone cannot satisfy a Bicep authoring Task. The corrected files must reproduce the working configuration on redeployment; otherwise the next deployment would reintroduce the problem.

### Independent Lab: Reuse the project for another environment

Provide an existing working environment and a brief for a second environment with different names, replica bounds, application settings, and a supported model deployment selection. Require reuse of the local modules with a separate parameter file and deployment target.

The learner previews the intended target, deploys the second setup, verifies its API and scaling behavior, and confirms the first environment's configuration and behavior remain intact. Multiple supported module structures may pass if they satisfy the declared requirements and reproduce the result through deployment.

### Fidelity boundaries

- What-if is read-only: running it cannot mutate resources or satisfy a deployment Task. Associate its evidence with the file/parameter version and deployment target; a later edit requires a new preview where the Task calls for one.
- Distinguish validation success, deployment success, and application success. Model a documented subset of syntax, resource schemas, module dependencies, and parameter evaluation; report unsupported constructs explicitly rather than calling all unsupported valid Bicep invalid.
- The initial supported deployment scope and mode must be specified before implementation. Do not teach that omitting a resource from an incremental template deletes it, or that deleting a deployment history record cleans up resources.
- Registry/image prerequisites, inference permissions, and deployment ordering must remain explicit. Template deployment does not build or publish the C# application's image.
- Simulated previews need only cover the supported model; do not promise that real Azure what-if always produces a complete or noise-free prediction.

References checked during design: [Bicep modules](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/modules), [parameter files](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/parameter-files), and [what-if previews](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/deploy-what-if).

## Agreed detailed design: Capstone Lab

Status: learning flow and depth confirmed by the user. Exact incident fixtures, acceptance thresholds, and persistence details remain implementation-design work.

### Brief and starting point

Deliver a reliable C# API that performs local CPU-intensive processing and calls a simulated Foundry model. Begin with the reusable Application Factory files and an otherwise empty Lab Sandbox. Supply requirements and measurable acceptance criteria, not a command walkthrough; Hints and Solutions remain available and their usage is recorded.

Use a single ordered Lab with saved checkpoints. Checkpoints retain evidence and allow resuming the current run; they are not automatically a mechanism for rewinding resources. Changes still invalidate affected behavioral verification as agreed.

### Stages

1. **Prepare the application.** Complete the required API behavior, configuration, health endpoints, Dockerfile, and modular Bicep project using the supported file-editing surface.
2. **Bootstrap infrastructure and publish the image.** Deploy foundation resources including the private registry, build and publish the tagged application image, and inspect its recorded source version. Use staged template deployment so no application deployment relies on an image that does not exist yet.
3. **Deploy the complete setup.** Deploy the environment, identities, inference resource/model deployment, application, permissions, probes, and scaling through the modular infrastructure project. Keep registry access and inference access distinct and inspect relevant deployment outputs.
4. **Demonstrate healthy behavior.** Prove the required API response and model invocation, slow-start handling, CPU scale-out under load, bounded overload behavior, and scale-in when load ends. Each experiment records the deployed configuration and scenario used.
5. **Diagnose and repair an incident.** After the healthy baseline is verified, introduce a reproducible incident that combines a configuration regression with a downstream failure. A proposed pair is an incorrect model deployment setting and subsequent transient throttling; exact incident fixtures remain to be finalized. Present symptoms first and retain diagnostic logs. The learner repairs the source/configuration, redeploys when needed, and reruns affected verification without silently discarding the incident.
6. **Prove recovery and reproducibility.** Verify requests, probes, and scaling after the repair; rerun the relevant bounded failure experiments. Redeploy the corrected infrastructure files to demonstrate that the repair persists.
7. **Clean up and complete.** After all required verification passes, preserve the verified milestone evidence, remove the Lab-owned resources, and verify cleanup. Premature deletion cannot bypass the verification stages or count as incident recovery.

### Completion and feedback

- Produce a Lab Result with per-stage/Task outcomes, experiment evidence summaries, elapsed time, and Hint/Solution usage.
- Completion requires all acceptance criteria; assistance is reported separately and does not prevent completion.
- Preserve a completed result as a record of the verified run. The technical design freezes completed new-Lab attempts for inspection; subsequent practice starts a new attempt rather than rewriting historical results.
- The capstone has no forced timer. Save progress across sessions so the learner can finish it in several sittings.
- Keep fixed, reproducible incidents in this initial version. Randomized variations and additional release-management topics remain outside the agreed first catalog.

## Technical design and per-Lab planning

The linked technical design resolves the shared architecture, file/deployment separation, evidence, persistence, topic cleanup policy, and delivery sequence. This curriculum remains the learning requirements document, not an executable task plan. Per-Lab plans must supply the remaining concrete implementation details without reopening the agreed scope:

- Apply the technical design's .NET 10 starter and selected Foundry integration; pin SDK patch/resource API versions and precise supported syntax in the first consuming Lab's manifest.
- Define exact Task conditions, command coverage, seeded prerequisites, numeric workload/failure fixtures, and simulation timing for each agreed Lab flow.
- Implement the technical design's evidence dependencies, saved checkpoints, cleanup boundaries, completed-result preservation, and saved-run compatibility with concrete fixtures for the current Lab.
- Detail the current Lab's editor regions, Experiment Controls, metrics/log presentation, and results. Topic Labs retain resources after verification; only the capstone requires final cleanup.
- Resolve the documented Azure fidelity questions about CLI scale-rule replacement and probe behavior before implementing those semantics.
- Preserve the existing HTTP-scaling Lab and other catalog Labs, adding the new journey as defined in the technical design.
- Plan only the next required building-block increment or single Lab. The complete target remains all 16 Labs; do not implement an entire topic or all future shared capabilities at once.


