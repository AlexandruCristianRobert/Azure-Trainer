# AKS learning journeys: curriculum discussion

Status: the user accepted the 25-Lab curriculum on 2026-09-25 and requested saved implementation plans in successive topic batches, followed by the final capstone. Implementation plans for all 25 Labs are now saved for review; application implementation has not started.

## Confirmed intent and scope

- The learner is moving focus from Container Apps to AKS.
- Provide a detailed plan for AKS Labs with the depth of the existing Labs and substantial hands-on practice.
- On 2026-09-25, the learner explicitly selected exam preparation as the scope for now. Preserve the repository's AI-200 focus.
- Interpret comprehensive coverage within that exam preparation scope. Do not expand this phase into a general AKS platform administration curriculum.
- The learner selected starting from the beginning. Assume no prior knowledge of Kubernetes objects, manifests, or kubectl. Teach fundamentals through the opening deployment Labs before requiring independent diagnosis.
- The learner selected Python for the AKS application to align with AI-200 preparation. Use a small working Python API as the proposed starter; introduce application changes gradually. The exam audience profile expects Python proficiency, but this does not establish the language or format of every exam question.
- The learner explicitly selected creating a basic simulated AKS cluster and connecting it to ACR in the opening Guided Lab, including connecting kubectl. Do not start that Lab with a prepared cluster.
- The learner selected actual editable YAML files for Kubernetes manifests. Support ordinary block YAML authoring, with explained starters for Guided Labs, faulty manifests for Troubleshooting Labs, and minimal scaffolding for Independent Labs as the proposed teaching progression. The simulated Kubernetes feature set remains explicitly bounded.
- The learner confirmed Python code editing in addition to YAML and commands.
- The learner explicitly requires AI interaction within the AKS journey to better reflect exam preparation. AI application behavior must be part of the learning flows and eventual capstone; a generic API alone does not satisfy the request.
- The learner explicitly requires fully simulated AI: predefined messages with predefined responses and predefined embedding vectors. No real model inference or embedding generation is involved. Treat these as authored fixtures, not an optional live-service mode.
- The learner selected the Knowledge Assistant: a predefined question produces a fixed embedding, retrieves relevant document passages, and receives a prepared answer with source references. Build this single application gradually across the journey.
- The learner selected simulated Azure Database for PostgreSQL with pgvector as the Knowledge Assistant's retrieval service. Model it as the Azure managed database dependency, outside the AKS cluster; do not turn this into PostgreSQL administration inside Kubernetes.
- The learner directed that security content outside the AKS exam objectives be postponed to the future security Skill Area Labs. Keep ACR integration, Kubernetes Secret consumption and the access prerequisites needed to deploy/diagnose the application here; defer dedicated Key Vault retrieval/rotation and Workload Identity configuration Labs. Existing service access must be supplied and explained explicitly, not silently granted by deployment.
- The learner confirmed supplied PostgreSQL prerequisites for AKS Labs: the simulated database, pgvector extension/schema, documents and fixed embeddings are seeded. The learner still edits the Python retrieval call and a supported parameterized query/filter, configures and deploys the application, and diagnoses failures. Database provisioning, schema/index design and performance tuning are deferred to the data Skill Area Labs.

## Exam grounding

Checked the [official AI-200 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200) on 2026-09-25. Its container orchestration objectives explicitly include deploying and managing AKS applications through manifests, and diagnosing AKS/Container Apps using logs, events, and connectivity checks. ACR image management is an adjacent container hosting objective.

The detailed Kubernetes concepts below are proposed teaching prerequisites and applications of those objectives, not separately named exam requirements. The published outline permits related topics; it is not an exhaustive inventory of possible questions.

## Accepted curriculum structure

Retain the existing Guided, Troubleshooting, and Independent Lab progression, followed by an integrated Capstone Lab. The eight-topic, 25-Lab catalogue is accepted; detailed implementation flows and acceptance checks are developed in the saved plans for each batch.

| Proposed topic | Practice |
| --- | --- |
| Kubernetes foundations and manifest deployment | Cluster and workload mental model, contexts, namespaces, Pods, Deployments, labels, selectors, applying and inspecting manifests, deploying an ACR image. |
| Application configuration | ConfigMaps, Secrets, environment variables, configuration mounts, missing references, and verifying which configuration the running application uses. |
| Services and connectivity | Service discovery, Service selectors, ports and target ports, ready endpoints, and tracing requests from a client to the application and its dependency. |
| Knowledge Assistant integration | Python calls for fixed embeddings, PostgreSQL retrieval with metadata filtering, prepared answers with source references, and bounded dependency failure handling. |
| Health probes | Python health endpoints, startup/readiness/liveness probes, slow startup, traffic eligibility, restart and recovery. |
| Resources and application scaling | CPU/memory requests and limits, manual replica changes, pending Pods, memory failures, and introductory CPU HPA with supplied metrics support. |
| Updates and recovery | Image versions, declarative updates, rollout inspection, failed updates, rollback, and reconciling saved manifests with the intended deployment. |
| Evidence-based troubleshooting | Selecting logs, prior-container logs, events and object descriptions; separating deployment, configuration, health, and connectivity causes; proving recovery. |
| Capstone | Create the basic cluster and registry integration, deploy the Knowledge Assistant through manifests, verify the complete question-to-answer flow, diagnose staged incidents, repair source configuration, and demonstrate recovered behavior. |

Accepted catalog: eight topics with Guided, Troubleshooting, and Independent Labs, followed by one Capstone Lab, for 25 Labs. This replaces the earlier provisional 19-Lab outline. Resource management, probes, rollouts and introductory HPA are supporting application-management concepts, not separately named AI-200 objectives. Introductory HPA supplies application-management practice; cluster autoscaling and node-pool administration are outside this curriculum.

## Proposed boundaries

Use the existing local simulated Sandbox and behavioral verification approach as the baseline. Cluster upgrades, fleet operations, cluster disaster recovery, advanced node-pool design, and a dedicated Helm/GitOps platform track are outside the proposed exam-focused curriculum. Teach infrastructure concepts when needed to explain an application symptom.

## Proposed opening topic: foundations and deployment

Begin with the relationship between a cluster, nodes, Pods, containers, Deployments, and Services. Introduce contexts and namespaces before mutations. Explain desired state and reconciliation through an observable replacement of a deleted Deployment-managed Pod. Introduce YAML structure and labels/selectors through supported file edits. Keep the first application's behavior simple so application logic does not obscure Kubernetes fundamentals.

- Guided Lab proposal: inspect a supplied working Python API and Dockerfile; create a resource group and ACR; build and publish a versioned image through simulated ACR Tasks; create a basic AKS cluster; establish image-pull access; retrieve credentials and inspect the selected context and nodes; create a namespace; complete and apply a Deployment manifest; inspect Deployment/ReplicaSet/Pod relationships; verify an API request through a supplied Service manifest; then delete one managed Pod and observe its replacement. Explain the supplied Service at a basic level; detailed Service authoring and diagnosis belongs to the connectivity topic. The cluster creation and ACR connection are confirmed; the surrounding flow remains proposed.
- Troubleshooting Lab proposal: diagnose staged wrong-namespace, nonexistent-image-tag, and denied image-pull problems using object inspection and events; repair the target, manifest, or registry permission and verify the application. Introduce diagnostic commands in the Guided Lab before relying on them here. Distinguish a missing image from missing access rather than treating every image-pull failure as an authentication error.
- Independent Lab proposal: deploy a second application from a brief with a required namespace, image version, labels, and replica count; demonstrate a successful request and replacement of a deleted managed Pod. Supply networking prerequisites explicitly.

These flows are proposals. Define exact Tasks and simulator behavior after the curriculum decisions are agreed. The first Labs must explain each command and manifest field before asking the learner to use it independently.

Reference: [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), checked 2026-09-25.

### ACR integration fidelity

Propose an explicitly configured non-ABAC registry permission mode for the opening flow. In that mode, AKS attachment grants AcrPull to the kubelet managed identity at the registry scope. Explain this identity's image-pull responsibility separately from application access to Azure services. Do not teach that attachment builds an image or grants application permissions. ABAC-enabled registries need a different role-assignment flow and do not support this attachment shortcut; document the boundary without adding an advanced permissions Lab to this opening topic.

Reference: [AKS and ACR integration](https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration), checked 2026-09-25.

## Manifest authoring requirements

Use actual files such as `namespace.yaml`, `deployment.yaml`, `service.yaml`, `configmap.yaml`, and `secret.yaml` as each topic introduces them. Explain indentation, mappings, lists, scalar types, metadata, and spec fields. Preserve the distinction between saved files, applied Kubernetes objects, and observed running application behavior. Merely saving a file must not deploy it. Identify YAML parse errors, Kubernetes validation errors, and unsupported simulator features separately. JSON-form YAML alone does not satisfy the learner's authoring choice.

## Proposed topic: application configuration

- Guided Lab: supply the working Python application and cluster; author a ConfigMap and a Secret using fictional credentials; reference their keys in the Deployment; mount a configuration file; inspect non-sensitive effective settings and prove a successful authenticated call to a supplied dependency. Change an environment-backed setting, observe that the running process retains its previous value, replace Pods through a rollout restart, and verify the new behavior. Explain mounted-file propagation and application reload as separate concerns rather than promising automatic application reload.
- Troubleshooting Lab: diagnose a missing required key, a wrong namespace/reference, and stale environment-backed configuration in staged incidents. Use events for container setup failures and application logs for runtime failures, repair the files, apply the change, and verify current application behavior. Exact incident selection and ordering remain to be finalized.
- Independent Lab: adapt the application configuration to a second namespace and a different dependency endpoint/fictional credential without changing the container image. Prove both the new behavior and isolation from the supplied first deployment. Do not expose secret values in response bodies or diagnostics; verify access through the dependency call.

Teach ConfigMaps as ordinary configuration and Secrets as sensitive configuration objects. Base64 representation is encoding, not encryption. The fixture's supplied dependency isolates configuration practice from later networking authoring. These learning flows remain proposals, not confirmed scope.

References checked 2026-09-25: [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/) and [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/).

## Confirmed Python authoring and AI application

Python authoring is confirmed. Provide a working application scaffold and progressively require changes to configuration reading, health endpoints, dependency calls, validation, error handling, and useful logging as their topics are taught. Any Python behavior remains locally simulated according to the existing bounded execution approach; using editable source does not imply an arbitrary Python runtime. Edited source must pass through image build/publication and deployment before it affects runtime evidence.

### Agreed application: Knowledge Assistant

Progress from the supplied Python starter to a complete simulated question-to-answer flow using fixed embeddings, retrieved document passages, and prepared answers with source references. Introduce vector retrieval and a basic metadata filter through simulated Azure Database for PostgreSQL with pgvector. Explain retrieval-augmented generation when introduced; assume no prior AI application knowledge.

The application scenario and data service are agreed. The model/SDK family to emulate, detailed Lab boundaries, and incident fixtures remain to be selected.

### Proposed progression and acceptance principles

- Opening deployment practice uses the supplied Python starter; introduce the initial AI call with explained application code and seeded downstream prerequisites once the learner can deploy and inspect the application.
- Configuration practice uses the chosen AI application endpoint and deployment configuration. Preserve the core distinction between applied settings and configuration read by the active process.
- AI integration practice requires the learner to complete Python client usage and request/response handling. Capture evidence for the chosen endpoint, deployed application version, successful downstream operation, and response.
- Include an explicit retrieval stage with evidence of selected document identifiers and filter behavior before the simulated model response. A successful HTTP status alone cannot prove retrieval or a model call occurred. An empty retrieval result must have a declared application behavior.
- Troubleshooting distinguishes Kubernetes startup/image/configuration problems from downstream authentication, connectivity, throttling, timeout, and retrieval problems. Propose bounded retries and observable recovery; finalize incident fixtures during detailed curriculum design.
- Explain the application's supplied Azure access prerequisites. AKS kubelet image-pull access does not confer application access to a model or database. Use supplied fictional credentials or preconfigured access for the downstream fixture; dedicated Workload Identity and service-authorization setup belongs to the later security curriculum.
- AKS diagnostics must include logs, events and end-to-end connectivity. The proposed boundary for observability is to use supplied correlated request/dependency evidence here, with dedicated OpenTelemetry instrumentation and KQL authoring in the later secure/monitor/troubleshoot Skill Area Labs. This observability boundary is a recommendation applying the exam organization, not a separately confirmed scope choice.
- Keep all model responses, data and failure scenarios inside the local Sandbox. Label them as simulation and verify integration behavior rather than subjective model-answer quality.

Exam alignment: the AI-200 guide explicitly includes vector retrieval through Cosmos DB, retrieval/RAG with metadata filtering through PostgreSQL, Python, OpenTelemetry, and KQL. A model call alone is not a separately named objective in the current outline; using it in the proposed application supplies realistic AI context. Dedicated database tuning, ingestion, caching, or messaging curricula are not automatically added by this proposal.

## Confirmed AI simulation and proposed fixture behavior

Use a finite catalog of authored request messages, canned responses, document passages, and fixed query/document embedding vectors. Model inference and embedding generation are simulated operations with no external AI calls. Clearly identify the practice inputs available for each Lab. Exact messages and vectors will be authored with each Lab's acceptance fixtures.

Proposed behavior for a retrieval scenario:

1. The learner sends a predefined question to the deployed Python API.
2. The simulated embedding operation returns the vector authored for that question, after checking its configured endpoint, deployment and access requirements.
3. Retrieval compares those fixed vectors using the selected supported distance/similarity operation and applies the requested metadata filter. Fixed embeddings must still permit observable retrieval errors when dimensions, filters, or target data are wrong.
4. The simulated model operation returns a canned answer for the scenario and supported retrieved context. Missing or incorrect context has its own declared fixture outcome; do not silently supply the expected answer regardless of retrieval.
5. Evidence records the deployed image/source version, effective configuration, dependency calls, retrieved document identifiers, and response outcome. A hardcoded API success response without the required downstream operations cannot satisfy integration Tasks.

Failure fixtures provide repeatable denied access, wrong endpoint/deployment, throttling, timeouts, empty retrieval, or invalid embedding-dimension outcomes. Repairing the applicable code or configuration and redeploying as needed must change the observed result. The final incident set remains proposed.

For inputs outside the authored catalog, return an explicit simulator message that the input is unsupported and list suitable practice inputs; do not present fixture limitations as real AI-service behavior. Keep arbitrary-input handling distinct from deliberately supported invalid-input test cases.

## Agreed PostgreSQL starting state and proposed retrieval practice

Supply the database, pgvector extension, schema, documents and fixed embeddings in AKS Labs. Show the schema and sample documents so the learner understands the dependency. Python calls and small parameterized query/filter edits belong to the Knowledge Assistant integration topic, Labs 10-12 below. Database provisioning, schema design, indexing, ingestion and performance tuning belong to later data Labs.

Use known query vectors and document vectors to make retrieval reproducible. Inspect document identifiers, filter effects and source references. Distinguish no matching rows from database failure. Fixture metadata filters are retrieval requirements, not a substitute for authorization controls. Choose the supported driver, dimensions and similarity operator during detailed technical design; do not imply arbitrary Python or SQL execution.

Reference: [Microsoft Python and pgvector sample](https://learn.microsoft.com/en-us/samples/azure-samples/azure-postgres-pgvector-python/azure-postgres-pgvector-python/), checked 2026-09-25.

## Agreed boundary: application access and later security Labs

Keep fictional credentials in Kubernetes Secrets during configuration fundamentals, and explicitly supply the corresponding downstream access. Teach Secret references, namespaces, keys, updates and their effect on the Python application. Retain the already agreed AKS-to-ACR integration and image-pull troubleshooting.

Defer dedicated Key Vault retrieval/rotation, federation setup, token acquisition and service-authorization Labs to the future security curriculum. Key Vault is explicitly named under the official secure-solutions objectives. Workload Identity is relevant AKS technology but is not separately named in the current AKS objectives; use only the explanation or supplied prerequisites needed here. Do not interpret the outline as a guarantee that related identity concepts cannot appear in the exam.

For future security planning, the same Knowledge Assistant can support Workload Identity, Key Vault and identity-based PostgreSQL access. PostgreSQL needs an Entra-mapped database principal and SQL permissions as well as token authentication. These are future integration notes, not additional AKS Lab requirements or an approved security implementation plan.

References checked 2026-09-25: [AKS workload identity](https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview) and [PostgreSQL managed identity connections](https://learn.microsoft.com/en-us/azure/postgresql/security/security-connect-with-managed-identity).

## Proposed ordered Lab catalog

Each topic has three separate Labs. Guided Labs teach new concepts and commands before requiring their use. Troubleshooting Labs start with visible symptoms and optional Hints. Independent Labs state outcomes and supply minimal files without a command sequence. Every Lab is independently restartable; starting resources and application code are explicitly listed. Later Labs can supply a working version of code taught elsewhere without depending on a prior saved run.

### Topic 1: foundations and deployment

**1. Guided - From Python files to an AKS application.** Start with a Python starter, Dockerfile, manifest scaffolds, seeded AI/database dependencies and no learner-owned cluster or registry. Inspect the application, make a small visible service-version change, create ACR, build/publish the image through simulated ACR Tasks, create AKS, establish ACR pull access, and retrieve credentials. Explain the current context, namespace, nodes, Deployments, ReplicaSets and Pods. Complete a Deployment manifest and apply the supplied Service manifest. Pass by verifying the deployed service version and replica count, then observing replacement of a deleted managed Pod and a fresh successful request. This foundational Lab needs resumable stages rather than one uninterrupted walkthrough.

**2. Troubleshooting - Why did the application not start?** Start with an existing cluster and staged wrong-namespace, missing-image-tag and denied-pull incidents. Inspect the active context, object descriptions and events; distinguish each cause before editing the manifest or ACR attachment. Pass by deploying the intended published version in the intended namespace and proving a successful request. Repeatedly deleting failing Pods does not satisfy a repair Task.

**3. Independent - Deploy a second instance.** Supply a cluster, accessible ACR image and a Service scaffold. Require a new namespace, labels, image version and replica count. Write the Deployment manifest, apply the files and verify the instance. Pass by showing the required configuration, a fresh application response and Pod replacement, with the supplied first instance still working.

### Topic 2: application configuration

**4. Guided - Configure the assistant through manifests.** Supply a working assistant and its downstream services. Read settings in the Python starter; author ConfigMap and Secret files and reference keys in the Deployment. Include an ordinary mounted configuration file, explained separately from environment variables. Exercise a known question to prove effective settings. Change an environment-backed setting and observe the old value until Pods are replaced. Pass after applying the files and proving the new non-sensitive behavior; do not print credentials in responses or logs.

**5. Troubleshooting - Repair missing and stale settings.** Stage a missing required key or wrong resource reference, followed by a stale environment value. Distinguish container setup events from errors emitted by a started Python process. Repair saved manifests, apply them, replace Pods when necessary and rerun the affected question. Pass only when the current application uses the repaired configuration.

**6. Independent - Configure another assistant instance.** Supply a second supported endpoint/data fixture and an existing first instance. Reuse the published image, configure a second namespace with its own ConfigMap/Secret and demonstrate its expected response. Pass by proving different effective settings and successful behavior in both instances. The Lab tests configuration reuse; it does not introduce new database provisioning or authorization tasks.

### Topic 3: Services and connectivity

**7. Guided - Trace a request to the assistant.** Author ClusterIP and LoadBalancer Service manifests in separate stages. Explain labels/selectors, Service ports, target ports and the application's listener. Use a supplied diagnostic Pod for an internal DNS/request check, then send a simulated external request. Inspect ready backends and the application request log. Verify the assistant can reach its configured external database/AI endpoints. Pass with evidence for the client-to-Service-to-Pod route and the downstream call. Supply network infrastructure; do not add VNet or ingress-controller administration.

**8. Troubleshooting - A running Pod that cannot be reached.** Stage a Service selector mismatch, target-port mismatch and incorrect downstream hostname. Compare Service/backend inspection, an internal request and application logs to isolate the failing hop. Repair the appropriate YAML or application setting and demonstrate recovery. A Pod in Running phase alone does not satisfy connectivity verification.

**9. Independent - Expose an isolated assistant.** Given a required internal Service name, external endpoint and application listener, author Services for an assistant in another namespace. Verify internal and external requests and a full downstream call. Prove requests do not accidentally select the supplied first instance. Seed both instances healthy so networking is the focus.

### Topic 4: the simulated AI application

**10. Guided - Complete the question-to-answer flow.** Supply AKS, PostgreSQL, schema, corpus, vectors and simulated AI deployments. Explain embeddings and retrieval through tiny visible fixtures. Complete Python input validation, an embedding-client call, a parameterized retrieval query/filter, context construction and an answer-client call. Build, publish and deploy the changes. Pass by recording the query vector fixture, retrieved source identifiers and prepared answer for known questions. Also reject empty input before downstream work and return the declared no-match outcome when retrieval is empty.

**11. Troubleshooting - The API responds, but the AI flow fails.** Present staged wrong model/embedding deployment configuration, an incorrect retrieval filter or vector dimension, and a transient dependency failure. Inspect the failed stage and distinguish it from Kubernetes startup or network routing failure. Repair Python/configuration and implement the supported bounded retry/deadline behavior. Pass with correct sources and answer, recovery from the retryable fixture and a controlled response for a persistent failure. The detailed plan must specify retryable errors and account for SDK retries.

**12. Independent - Adapt the assistant to another document set.** Supply a second corpus, metadata requirements and known question fixtures. Complete the Python retrieval and response handling using the existing service interfaces, then deploy. Pass by proving correct source selection, prepared answers and empty-result handling for the supplied cases. Keep the database schema and access preconfigured.

### Topic 5: health probes

**13. Guided - Separate startup, readiness and liveness.** Complete Python health endpoints and add all three HTTP probes in YAML. Use a slow-start fixture, a temporary inability to serve requests, and a process-hang fixture. Observe startup gating, traffic eligibility and container restart separately. Pass by proving that requests reach ready Pods, startup has the declared allowance and a genuine hang recovers. Model explicit simulation time and label timing simplifications.

**14. Troubleshooting - Stop unnecessary restart loops.** Supply a startup allowance that is too short and a liveness endpoint coupled to the optional AI dependency. Diagnose the restart causes through events, counters and logs. Repair the manifest and endpoint behavior, rebuild/redeploy where needed, then introduce a genuine hang to prove liveness still works. Pass with recovery from slow startup and a bounded downstream outage without repeated unnecessary container restarts.

**15. Independent - Design probes for a slower assistant.** Supply a different startup duration and a brief describing which degraded requests the API can still serve. Choose endpoints and probe settings and demonstrate startup, temporary readiness loss, traffic recovery and hang recovery. Accept different valid settings if they meet the declared outcomes. The brief must explicitly distinguish required from optional dependencies rather than prescribe one universal readiness policy.

### Topic 6: resources and application scaling

**16. Guided - Size and scale the application.** Teach CPU/memory requests and limits, scheduling onto a supplied fixed-capacity cluster, and manual replica changes. Then add a basic CPU HPA manifest with supplied metrics support and explicit minimum/maximum replicas. Apply a deterministic local CPU workload in the Python API, inspect metrics and observe scale-out and scale-in. Keep local CPU demand distinct from waiting on the AI service. Pass through measured workload evidence tied to the active configuration.

**17. Troubleshooting - Pending Pods, memory failures and stalled scaling.** Use staged oversized resource requests, an insufficient memory limit and a missing CPU request needed by utilization-based HPA. Inspect scheduling events, terminated-container evidence and autoscaler conditions. Repair workload manifests within the supplied cluster's capacity and verify completion of the same workload. Do not teach that adding replicas creates node capacity or repairs a downstream service limit.

**18. Independent - Meet a workload brief.** Provide fixed cluster capacity, a memory-demand fixture and steady/burst CPU demand. Choose requests, limits and HPA bounds that meet the brief. Pass with successful baseline processing, scale-out under burst demand and scale-in after demand ends, without memory failures or indefinitely pending required Pods. Exact numeric thresholds and supported HPA timing are detailed-design work, not Azure performance claims.

### Topic 7: releases and recovery

**19. Guided - Release a new assistant version.** Begin with v1 running. Edit a supported Python response/configuration behavior, build and publish v2, update the Deployment manifest and inspect the rollout. Teach readiness, ReplicaSets and bounded rolling-update controls using a supplied request stream. Demonstrate a failed release and rollback, then align the saved manifest with the intended recovered version. Pass by verifying the active version and the complete AI flow after update and recovery. Early use of apply/restart in prior topics is explained there; this topic adds release-management depth.

**20. Troubleshooting - Recover a stalled rollout.** Supply a v2 manifest referencing a missing configuration key or invalid image and a last-known-good v1. Identify the failing revision, recover service with an appropriate supported rollback or forward fix, and repair the source of the regression. Pass when the intended version is healthy and reapplying the corrected files does not reproduce the incident. Rolling back a Deployment must not be presented as automatically reverting separate ConfigMaps or Secrets.

**21. Independent - Deliver and verify a release.** Give a release brief with changed assistant behavior and availability requirements. Build/version the image, write deployment changes and prove the new behavior. Exercise a supplied release failure, recover, and leave saved files consistent with the chosen successful version. Pass with version-specific request evidence and a repeatable deployment from the final files.

### Topic 8: systematic AKS diagnosis

**22. Guided - Diagnose each request layer.** Teach a repeatable investigation using context/namespace, get/describe, events, current/previous container logs, Service/backends and supported internal request checks. Add simple structured Python logs with request identifiers; inspect supplied dependency records for embedding, retrieval and answer stages. Walk through one controlled failure at a time. Pass by making the correct repair and producing a fresh full-flow response for each stage. Dedicated OpenTelemetry and KQL authoring are proposed for later monitoring Labs.

**23. Troubleshooting - Resolve an incident with two causes.** Start with a Service target-port regression hiding a downstream endpoint error. The first repair should expose the second symptom instead of silently completing the Lab. Inspect the new evidence, fix the remaining cause and redeploy as needed. Pass with healthy Kubernetes state, correct routing and a complete supported question-to-answer result. Preserve evidence from both faults.

**24. Independent - Restore the assistant from symptoms.** Provide a short incident brief, saved application/manifests and a reproducible fault combination using previously taught concepts. Offer Hints/Solutions only on demand. Require the learner to inspect evidence, repair source/configuration and verify healthy and declared failure cases. Accept supported equivalent repairs; completion must depend on actual state and behavior rather than a required command history or a prose explanation.

### Lab 25: Capstone - deliver and recover the Knowledge Assistant

Supply the Python starter, minimal manifests, fixed question/answer catalog, ready PostgreSQL corpus/embeddings and preconfigured AI/database access. Begin with no learner-owned ACR, AKS cluster or application resources. Use a single resumable Lab with ordered checkpoints:

1. Complete the supported Python integration, validation, health endpoints and basic logs.
2. Create ACR, build/publish a versioned image, create AKS and establish image-pull access.
3. Configure the namespace, ConfigMap, Secret, Deployment and Service from actual YAML.
4. Prove a known answer with expected sources, input rejection and the empty-retrieval outcome.
5. Demonstrate startup/readiness/liveness behavior and the agreed resource/scaling workload.
6. Publish an application update and verify the active image version and AI behavior.
7. Diagnose a staged incident combining previously taught routing/configuration/dependency failures, repair it and re-verify affected behavior.
8. Reapply the final manifests, prove the repair persists, then clean up only Lab-owned application/cluster/registry resources. Preserve the supplied database/AI prerequisites and historical verification evidence.

Pass only after the required checkpoints and behavioral evidence are complete. Include a Lab Result showing outcomes, elapsed time and Hint/Solution usage; assistance does not prevent completion.

## Proposed common learning and verification contract

- Explain new Python constructs, SQL fragments, YAML fields and commands at first use. Show examples before Independent Labs; assume no prior Kubernetes knowledge.
- Publish each Lab's supplied prerequisites, editable files, supported commands, practice inputs and expected observable outcomes.
- Require current deployment evidence. Editing Python requires rebuilding/publishing/deploying the image; editing YAML requires applying it. Configuration propagation follows the supported consumption method.
- Teach both successful operation and a meaningful failure/recovery case per topic. Use deterministic fixtures so repeating a Lab is useful.
- Relevant changes invalidate affected verification; preserve unrelated progress and deliberate cleanup milestones.
- Provide two optional Hints and a worked Solution per Task consistent with existing Lab conventions. Keep each Lab restartable and resumable.
- Group these Labs under the existing container Skill Area because their principal outcomes concern deploying and diagnosing the AKS-hosted assistant. AI/database fixtures supply application context; this does not claim the journey completes the data/security Skill Areas.
- Deliver incrementally, one Lab at a time, adding only its prerequisite simulator capabilities. Preserve existing Container Apps Labs and saved results.

## Source checks for the added topics

Checked 2026-09-25: [Services](https://kubernetes.io/docs/concepts/services-networking/service/), [probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/), and [Horizontal Pod Autoscaling](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/). These establish Kubernetes teaching semantics; they do not independently expand the official AI-200 objectives.

## Saved implementation plans

The eight topic batches are documented in [Labs 1-3: foundation and deployment](../plans/2026-09-25-aks-labs-01-03.md), [Labs 4-6: application configuration](../plans/2026-09-25-aks-labs-04-06.md), [Labs 7-9: Services and connectivity](../plans/2026-09-25-aks-labs-07-09.md), [Labs 10-12: Knowledge Assistant integration](../plans/2026-09-25-aks-labs-10-12.md), [Labs 13-15: health probes](../plans/2026-09-25-aks-labs-13-15.md), [Labs 16-18: resources and application scaling](../plans/2026-09-25-aks-labs-16-18.md), [Labs 19-21: releases and recovery](../plans/2026-09-25-aks-labs-19-21.md), and [Labs 22-24: systematic diagnosis](../plans/2026-09-25-aks-labs-22-24.md). [Lab 25: Knowledge Assistant capstone](../plans/2026-09-25-aks-lab-25-capstone.md) completes the planning set with eight resumable checkpoints spanning source, provisioning, deployment, AI behavior, resilience/scaling, release, incident recovery and final verification/owned cleanup. The [shared implementation contract](2026-09-25-aks-labs-01-06-implementation-contract.md) defines the first six Labs' proposed interfaces and fixtures; subsequent plans contain their additional simulator contracts. These are planning artifacts for all 25 Labs, not delivered Labs.
