# AKS Lab 25: Knowledge Assistant Capstone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one resumable capstone in which the learner completes a Python Knowledge Assistant, creates simulated ACR/AKS infrastructure, deploys YAML, verifies AI behavior, exercises health/scaling, releases and recovers the application, and cleans up only resources owned by this attempt.

**Architecture:** Compose the preceding eight topic contracts under eight ordered checkpoints with durable evidence seals. Add an AKS-specific checkpoint and ownership adapter to the existing behavioral engine, keeping its Container Apps capstone rules separate. All requests, builds, Kubernetes transitions and incidents continue through existing simulators; the capstone coordinates and assesses them rather than inventing another execution path.

**Tech Stack:** Existing Vue 3, Pinia, JavaScript ESM, Vite, Vitest, IndexedDB, yaml and Lezer Python; Python 3.12 source, actual editable YAML, fixed AI/PostgreSQL and workload adapters. No new package, real cloud resource, Python process or model execution.

**Spec:** [Accepted curriculum: Lab 25](../specs/2026-09-25-aks-learning-journeys-discussion.md). Read the [foundation contract](../specs/2026-09-25-aks-labs-01-06-implementation-contract.md) and prerequisite plans [1-3](2026-09-25-aks-labs-01-03.md), [4-6](2026-09-25-aks-labs-04-06.md), [7-9](2026-09-25-aks-labs-07-09.md), [10-12](2026-09-25-aks-labs-10-12.md), [13-15](2026-09-25-aks-labs-13-15.md), [16-18](2026-09-25-aks-labs-16-18.md), [19-21](2026-09-25-aks-labs-19-21.md) and [22-24](2026-09-25-aks-labs-22-24.md).

**Status:** Planning only, requested 2026-09-25. Prerequisite AKS capabilities are planned at authoring time; reconcile interfaces with delivered code before execution. This is the final plan for the accepted 25-Lab AKS curriculum.

## Global Constraints

- Entirely browser-local: Python, Azure, Docker, Kubernetes, PostgreSQL and AI operations are bounded simulations. Predefined messages produce fixed embeddings and prepared answers from supplied document fixtures.
- Begin with no learner-owned resource group, ACR, AKS cluster, image publication or Kubernetes application. Supply only the starter project, fixture catalog and preconfigured access to external AI/PostgreSQL prerequisites.
- Keep PostgreSQL/pgvector outside AKS. Database provisioning/index administration, dedicated Key Vault/Workload Identity, OpenTelemetry and KQL remain separate later Skill Area work.
- Lab id aks-knowledge-assistant-capstone; journey aks-knowledge-assistant; order 25; Skill Area containers; service aks; contentVersion 1; engineVersion/schemaVersion 2; runtime.kubernetes.version 1.
- Enable kubernetes, kubernetesConfiguration, kubernetesConnectivity, kubernetesAiIntegration, kubernetesProbes, kubernetesResources, kubernetesRollouts, kubernetesDiagnosis, aksCapstone and acrBuild. Do not set acaCapstone or bicep capability flags.
- Exactly eight stages and 31 Tasks, as mapped below; one named Verify scenario per Task. Every Task has two optional Hints, a complete structured Solution and an Exam Note. Assistance never prevents completion.
- Preserve all prior AKS, Container Apps and legacy Labs and their saves/results. Missing or corrupt capstone state must not silently reseed resources or manufacture passing evidence.
- Use 16 project files, the existing maximum; 64 KiB/file, 256 KiB total, 20,000 Python syntax nodes, 8 YAML documents/file and depth 32. No archive or additional learner file is needed.
- Time advances through aks-advance, integer seconds 1-300. Request-local retry time does not advance the shared clock. At most one measured probe/resource/release/diagnosis experiment is active at a time.
- CPU HPA is practiced only in stage 5 and removed before releases. Final deployment has two fixed replicas, healthy probes, explicit resources and no HPA. Concurrent HPA/template rollouts are outside this trainer subset.
- A checkpoint seals observed work, not a promise that later code still behaves identically. Before cleanup, reverify the final source, manifests, all desired Pods and declared positive/negative requests.
- Implementation and the suggested commits below are future work. Saving this plan does not implement the Lab.

## Review Focus

1. Sealed stages must survive intended later changes and cleanup, while active-stage and final proof must reject stale source/images/configuration. Tasks 1, 4, 6 and 8 test this.
2. Eight AKS stages, Kubernetes ownership and supplied prerequisites must not inherit the existing ACA capstone's seven-stage, Bicep or empty-sandbox assumptions. Tasks 1, 2, 7 and 8 test this.
3. HPA adoption/removal, rollout restarts and probe experiments must not fight over replicas, clocks or evidence. Tasks 3-6 test their handoffs and reload boundaries.
4. Correct HTTP text or healthy old Pods cannot substitute for actual source, retrieval, current artifact and failed-stage provenance. Tasks 3, 4, 6 and 8 test this.
5. Cleanup must be impossible before final proof and must remove owned runtime/context/publication state while preserving protected fixtures, sealed evidence and Lab Results. Tasks 2, 7 and 8 test this.

---

## Sources and repository findings

The [AI-200 study guide](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200) covers ACR images, manifest-based AKS applications and diagnosis using logs/events/connectivity. This capstone integrates the accepted supporting exercises; it does not claim to reproduce an actual exam lab. Checked 2026-09-25.

The [AKS/ACR integration guidance](https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration) distinguishes traditional registry RBAC/AcrPull integration from repository ABAC. Keep the earlier trainer's supplied RBAC registry mode and kubelet AcrPull path; do not silently imply attach-acr covers ABAC. [Kubernetes HPA guidance](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/) explains CPU utilization relative to requests and controller behavior. The timing/capacity values below are inherited teaching fixtures, not production sizing recommendations. Checked 2026-09-25.

Current src/lib/labEngine/stages.js is ACA-specific: capstoneStages checks acaCapstone, validation requires seven stages, snapshotTuple inspects Bicep attempts, and cleanupReady requires an empty sandbox. Current LabPanel.vue also selects its capstone view with acaCapstone. Do not enable these rules for AKS by merely broadening that Boolean. Add explicit AKS validators/actions/evaluation hooks and a small view adapter; leave the ACA branch's behavior and saved shape intact.

Reuse the platform's evidence identities, dependency generations, canonicalize, sourceTextHash, sourceVersionsAt and source-journal validation. The new AKS source journal uses the same bounded save records (max 512). Keep ordinary createBehavioralRun initialization and its resource initializer envelope `{sandbox, artifacts, runtime, nextSequence}`; initialize the eight-stage metadata in the engine's AKS branch rather than returning undocumented fields from the resource initializer.

## File map

| Responsibility | Create | Modify |
| --- | --- | --- |
| Checkpoint state and validation | src/lib/kubernetes/capstone/stages.js; tests/aks-capstone-stages.test.js | src/lib/labEngine/run.js, actions.js, evaluate.js |
| Ownership and cleanup | src/lib/kubernetes/capstone/ownership.js, cleanup.js; tests/aks-capstone-ownership.test.js, aks-capstone-cleanup.test.js | src/lib/az/commands/group.js, aks.js, acr.js; src/lib/labEngine/actions.js; src/lib/kubernetes/state.js |
| Composed teaching project | src/data/templates/aks-python/capstone.js; tests/aks-capstone-project.test.js | src/lib/project/manifests.js, python.js; src/data/templates/aks-python/server.js |
| Stage policy and scenario adapters | src/lib/kubernetes/capstone/policy.js, scenarios.js; tests/aks-capstone-experiments.test.js | src/lib/kubernetes/actions.js, resource-experiments.js, probe-experiments.js, release-experiments.js, schema.js |
| Incident and final assessment | src/lib/kubernetes/capstone/incident.js, evidence.js; tests/aks-capstone-incident.test.js, aks-capstone-evidence.test.js | src/lib/kubernetes/diagnosis-incidents.js, diagnosis-evidence.js, release-evidence.js |
| Lab content | src/data/labs/aks-journey/capstone.lab.js, capstone-seed.js, capstone-helpers.js; tests/aks-capstone-lab.test.js | src/data/labs/index.js; tests/helpers/aks.js; README.md |
| UI and result projection | src/lib/kubernetes/capstone/inspection.js; tests/aks-capstone-ui.test.js | src/components/lab/LabPanel.vue, LabCompletePanel.vue, AksExperimentPanel.vue; src/components/blade/AksClusterBlade.vue |

Bare filenames in a cell share the preceding full path's directory. Source-journal utilities remain in their existing module; use a new AKS branch at call sites instead of changing ACA seal semantics.

## Project, prerequisites and learner brief

Export CAPSTONE_MANIFEST, CAPSTONE_FILES and CAPSTONE_SOLUTION_FILES. Manifest id aks-python-capstone-v1 combines integrationVersion 1, healthVersion 1, releaseVersion 1, diagnosticsVersion 1 and workloadVersion 1. The exact 16 files are:

| Editable | Read-only supplied files |
| --- | --- |
| app.py, retrieval.sql, Dockerfile | server.py, training_clients.py, training_health.py, training_diagnostics.py, training_workload.py, schema.sql |
| k8s/namespace.yaml, k8s/configmap.yaml, k8s/secret.yaml, k8s/deployment.yaml, k8s/service-internal.yaml, k8s/service-external.yaml, k8s/hpa.yaml | No additional file |

buildFiles are app.py, retrieval.sql, Dockerfile and the five .py adapters/server files in the right column; schema.sql and all YAML are excluded. The fixed server exposes /api/info, /api/ask, /api/work and the three health routes, including the request-context reset from Labs 22-24. Compose source projections explicitly so logging, health and workload fields cannot overwrite the integration graph.

The starter supplies complete readable adapters and an executable, bounded Python skeleton. Use supported mistakes rather than ellipses/pass stubs: answer_core lacks the empty-input guard, its query bindings omit the required published filter, readiness returns constant 200, wrapper log_event calls are absent, and work uses one unit instead of twenty. retrieval.sql is a valid parameterized SELECT missing the published predicate. SERVICE_VERSION starts at 1.0; the successful answer formatter initially omits release. Supply settings, clients, bounded retry policy, exception handling and health function scaffolds from earlier Labs. Stage 1 states the required behavior and asks the learner to complete it.

Namespace YAML is complete; other manifests provide apiVersion/kind/metadata and a supported minimal starting shape. Missing required values produce ordinary parser/schema diagnostics until edited. HPA YAML starts as a comment-only file and is authored in stage 5. Solutions always provide complete files; snippets in this plan identify required changes and do not replace the full app.py.

Use target names rg-aks-capstone, acrakscapstone, aks-capstone, namespace assistant, Deployment assistant-api, Services assistant-internal/assistant-external, HPA assistant-cpu and repository assistant. No resource with those names exists initially. Supply rg-aks-prerequisites as a protected fixture group plus immutable catalog references for training AI/PostgreSQL; these are not learner-created resources and no live database is provisioned. The profile remains ai-training.example/pg-training.example, database knowledge, collection training, audience employee and the existing fictional credentials.

Creating the cluster installs the already-taught supplied diagnostic Pod and two node-budget fixtures, not learner application resources. Node allocatable/fixed reservations leave 1000m CPU and 1024Mi per node for the application. The server initializes in 6 simulated seconds. Default working requests are 250m/128Mi, limits 500m/256Mi, workload units 20/scratch 96Mi; modeled peak memory is 192Mi.

The intended image sequence is assistant:capstone-v1 followed by assistant:capstone-v2. Alternative supported distinct version tags are accepted when artifacts match the required saved source. Application version is 1.0 in stages 1-5 and 2.0 in stages 6-8. No grading by tag name alone.

```python
import training_workload

WORK_UNITS = 20
SCRATCH_MIB = 96

def work():
    return training_workload.process_batch(WORK_UNITS, SCRATCH_MIB)
```

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY app.py server.py training_clients.py training_health.py training_diagnostics.py training_workload.py retrieval.sql ./
EXPOSE 8080
CMD ["python", "server.py"]
```

## Eight checkpoints and 31 learner Tasks

Each row lists exact Task IDs; scenario IDs match Task IDs with a capstone- prefix. Task IDs are unique across this Lab. Tasks within an active stage may be solved in any valid order, subject to the explicitly described experiment dependencies. Next stages unlock only on sealing the current stage.

| Stage ID | Task IDs | Required outcome |
| --- | --- | --- |
| source | source-contract | Complete supported integration/SQL, validation, cached startup/readiness, responsive liveness, structured logs and workload operation. Source-preview fixtures pass before infrastructure exists. |
| provision | registry-created, image-v1, cluster-connected | Create owned group/ACR, build saved v1, create AKS, establish kubelet pull access and obtain the correct context. |
| deploy | config-applied, deployment-ready, routing-ready | Author/apply namespace, ConfigMap, Secret, Deployment and Services. Two healthy Pods run v1; internal DNS/HTTP and external entry points work. |
| behavior | answer-backups, answer-support, invalid-input, no-match | Verify 30 days/training-backups, training-support, 400 with no dependency calls, and empty retrieval with no answer call. |
| resilience | startup-proof, readiness-proof, liveness-proof, manual-capacity, hpa-cycle, ai-wait, release-baseline | Measure probe behavior, manually run three replicas, demonstrate CPU HPA scale-out/in and AI-wait behavior, then restore a stable two-replica deployment without an HPA. |
| release | published-v2, release-v2, rollback-recovered | Build changed source at 2.0, observe a healthy rollout, inject the declared failed readiness revision, undo/fix it and align saved files. |
| incident | fault-route, fault-dependency, incident-recovered | Diagnose a Service target-port regression masking a captured AI endpoint error; repair both and prove v2 behavior. |
| final-cleanup | final-internal, final-external, final-invalid, final-no-match, final-timeout, cleanup-app, cleanup-cloud | Reapply/restart final files, verify five current cases, freeze a cleanup checkpoint, remove owned application/cloud resources and seal the Lab Result. |

### Source preview and initial provisioning

source-contract compiles saved files and runs the bounded application graph against an explicitly labeled source-preview fixture with a supplied environment/request context. It checks known questions, invalid input, no-match, retry failure, health expressions under initialized/admitting/not-initialized signals, structured log bindings and actual workload operation provenance. It creates no cluster, image, registry publication or deployment evidence. Later stages must repeat real simulated deployment requests; a preview result cannot satisfy them.

Optional Solutions use the established CLI subset:

```text
az group create -n rg-aks-capstone -l westeurope
az acr create -g rg-aks-capstone -n acrakscapstone --sku Basic
az acr build --registry acrakscapstone --image assistant:capstone-v1 .
az aks create -g rg-aks-capstone -n aks-capstone --node-count 2 --node-vm-size Standard_D2s_v5 --enable-managed-identity --generate-ssh-keys
az aks update -g rg-aks-capstone -n aks-capstone --attach-acr acrakscapstone
az aks get-credentials -g rg-aks-capstone -n aks-capstone
```

Creating with attach-acr in the same supported command is equally valid. Earlier AKS plans own cluster/identity/resource-group behavior. Inspect the actual publication, access grant and selected context; do not infer them from command text or create a secretly attached registry.

### Deployment and behavior

The supplied requirements describe env/config/Secret references, image, namespace, labels, named port http/8080, internal port 80, external LoadBalancer, explicit resource sizing and all three probes. Solutions compose the complete earlier manifests using assistant-api as the Deployment target and preserve all query/configuration fields. Use RollingUpdate maxSurge=1/maxUnavailable=0, minReadySeconds=5, deadline=60 and history limit=3 from the release plan.

Successful questions must traverse embedding -> PostgreSQL query -> answer and return the fixture source ID. Empty input and no-match have their earlier distinct control-flow contracts. Every /api/ask response includes correlated application logs after the wrapper runs. Neither a literal prepared body nor an artifact from unsaved draft source passes.

### Probe, manual scaling and CPU HPA handoff

Reuse the declared cold-start, readiness-withdrawal and hang/restart probe scripts from Labs 13-15, parameterized with this target and 6-second initialization. Require no startup success/eligibility before age 6s, no readiness/liveness check before startup success and no cold-start restart. Readiness-loss closes one Pod's admission at baseline +5s and clears it at +20s, samples +9s/+25s and finishes +30s: withdraw within 4s, recover within 5s and never restart. Process-hang starts +5s and ends on container termination; require withdrawal within 4s, termination initiated within 30s, same-Pod/new-container recovery within 90s, and a final healthy answer at +100s. Show these timings in Experiment Controls. Restart-created Pod churn is expected and source/artifact consistency still applies.

After probes, run manual capacity with three ready replicas, saved replicas:3, no HPA and the preceding 30s/10 requests-per-second local-work fixture. Then remove explicit replica ownership before adopting this HPA in k8s/hpa.yaml:

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: assistant-cpu
  namespace: assistant
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: assistant-api
  minReplicas: 2
  maxReplicas: 4
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 60
```

Reuse the exact guided-resource-cycle scenario's guided-cycle profile from Labs 16-18: 2 requests/s for 30s, 28 requests/s from phase 30 through 120s, zero thereafter, finish at 270s. The ai-wait profile is 28 requests/s for 60s, 1ms local CPU/request and 150ms answer latency. Use capstone scenario IDs without changing their arithmetic. Their warmup (bounded to 360s), complete metrics, work conservation, scale-out to four and return to two must be observed. Three manually added Pods cannot substitute for HPA decisions. Run ai-wait after the HPA returns to minReplicas; dependency waiting is not treated as local CPU work.

For release-baseline, wait for experiments to finish and HPA to settle at two; explicitly delete assistant-cpu, save replicas:2 and apply Deployment. Replace saved hpa.yaml with the comment `# HPA exercise complete; final deployment uses two fixed replicas.` Keep the original policy in the stage's evidence/source history. Final apply enumerates the six nonempty manifests, not the dormant HPA file. A comment-only file is not presented as an HPA deletion operation.

The capstone's HPA policy gate allows HPA creation only during resilience, with no active release experiment or template rollout. While the HPA exists, reject Pod-template changes with a clear trainer-scope explanation; scale-only reconciliation remains supported. Deleting the HPA remains available for recovery. Ordinary resource Labs retain their existing behavior; release/diagnosis Labs still reject HPA creation.

### Release and incident

For v2 change SERVICE_VERSION to 2.0 and include release from that binding in the successful answer formatter, preserving the complete AI, health, logging and workload behavior. Publish a distinct artifact, start the release observation, apply YAML and advance until every desired Pod is Available on v2. Require zero failed observed requests and at least two available Pods throughout the measured release; no claim of production continuous availability.

rollback-recovered uses the preceding release exercise: the learner visibly saves/applies /health/missing as the readiness path, observes a stalled new revision and its deadline condition, selects a retained healthy revision and undoes or forward-fixes it. This Task requires the actual failed-revision receipt and a completed recovery observation. Align saved YAML with the recovered v2 template; undo does not restore separate ConfigMaps/Secrets or saved files. The application source remains v2, so rollback to healthy v2 does not demand discarding a source update.

At incident stage, a declared Start incident control first checks a clean stable v2 baseline and saved/draft agreement. It visibly changes both saved Services' targetPort to 8081 and saved ConfigMap AI_ENDPOINT to https://ai-missing.example, applies them and triggers the declared rollout restart to capture env. Wait for the faulty-config Pods to become available before observing the incident; these readiness probes do not test remote AI health. No source/image tampering is hidden in the fixture.

First observation is CONNECTION_REFUSED/status=null, with no invented handler/dependency logs. Correcting the ports exposes 502 AI_ENDPOINT at embedding. Correct the endpoint, refresh all Pod environments and verify full v2 recovery. Preserve both observations; learners repairing both at once may use the explicitly labeled isolated-snapshot diagnostic route already defined in Lab 23. That route never counts as live recovery. One incident epoch is sufficient; restart an interrupted injection transaction atomically rather than injecting twice on resume.

### Final current verification before cleanup

Require no active experiment/HPA, stable two-replica v2, saved/live agreement and current source/artifact provenance. Final health, logging, retry/query and workload contracts must still pass, including normalized health/workload projections matching the demonstrated requirements. Earlier sealed v1 proofs cannot excuse a broken v2 health function or removed workload helper.

Apply the six final manifests and perform a witnessed rollout restart before the five final request Tasks. Wait for complete rollout; then verify internal backup, external support, empty input, travel/no-match and the request-local embedding-timeout-always profile. Expected timeout is 504 DEPENDENCY_TIMEOUT with three embedding attempts and no query/answer. Each gets its own current evidence record; requests/log appends do not invalidate their siblings. Relevant edits or a later restart invalidate affected proofs and require refreshing them before cleanup.

## Checkpoints, state and ownership contract

### Separate AKS checkpoint adapter

`isAksCapstone(lab)` checks only capabilities.aksCapstone. Keep ACA capstoneStages unchanged. AKS initialization uses run.stages for UI compatibility with `{activeStageId, sealedStages:[], cleanupCheckpoint:null, aks:{version:1, ownership:[], creationReceipts:[], deletionReceipts:[], protectedRefs:[]}}`, plus the shared project.sourceJournal. The default engine field shapes remain valid; AKS adds its own strict validator.

An AKS stage seal includes stageId, contentVersion, attemptId, sequence, sorted taskIds/evidenceIds, dependency values/generations, sourceVersions, selected artifact tuples, selected target IDs and compact experiment/incident receipt IDs. It snapshots actual Kubernetes deployment/configuration hashes, not ACA deploymentsByApp or Bicep attempts. Cap seals at 32 KiB each; store IDs and redacted hashes instead of raw manifests/Secret values or full log arrays. At most eight stage seals and one cleanup checkpoint exist.

Initialize run.evidence.aksCapstoneReceipts as a JSON map of durable redacted summaries, capped at 128 receipts and 16 KiB per receipt. On successful observation, copy its essential measured outcomes, source/artifact/target identity, timing and selected log/trace records from the transient experiment owner. Validate the copy against the original receipt before assigning an immutable ID; stage seals reference this durable map. Retain no more than ten selected diagnostic records per receipt. Prune only unreferenced failed/cancelled attempts at the bound; never delete a referenced receipt. This store survives removal of runtime.kubernetes.clusters, avoiding dangling references to per-cluster evidence after cleanup.

Within resilience, the first six Tasks are historical experiment milestones; their dependencies select immutable validated receipt IDs, attempt/target identity and captured requirement versions. Expected HPA adoption/removal, replica-file changes and Pod turnover do not invalidate them. release-baseline is the current exit gate and rechecks v1 source requirements, sizing, stable replicas and HPA absence. Apply the same historical/current split to release/rollback and incident observations as in their predecessor plans. Do not copy ordinary resource-Lab dependency selectors unchanged: deleting the HPA would otherwise make the capstone's own stage impossible to seal. An edit during an active experiment still cancels it, and no milestone passes without its measured receipt.

`advanceAksStage(run, lab) -> {run, diagnostics}` is invoked by a new `{type:'aks-advance-stage'}` action with no caller state. Re-evaluate every active-stage Task against current predicates/evidence, require no active experiment, validate the stage-specific exit handoff, then allocate the seal sequence from nextSequence. Do not select merely the newest build: record the artifact proved by the stage's evidence and deployed Pods. Reject extra keys, skipped stages, missing evidence, future-stage verification and oversized seals before mutation.

`validateAksCapstoneState(run, lab)` checks the eight-stage partition, current stage index, unique causal sequence allocation, attempt/content ownership, task/scenario identities, complete passed evidence before each seal and source versions at the seal. Reuse source journal validation. Validate saved source/image/configuration histories against their owning immutable receipts; JSON edits setting done=true or appending a seal cannot bypass the engine. This is local consistency validation, not a cryptographic anti-cheat claim.

`getAksSealedTaskIds(run, lab) -> Set` exposes only validated seals, plus final request IDs frozen in a valid cleanup checkpoint. evaluateLab treats those Tasks as historical complete; active Tasks use existing evidence freshness. isComplete additionally requires all eight seals and verified cleanup. Keep ACA/legacy evaluation paths unchanged. Completion still uses the existing store/Result persistence path.

### Ownership from actual creation

Track created groups, registries, clusters, application namespaces and auto-owned node groups/identities/grants by stable resource ID plus creation sequence/attempt ID, never by a name prefix or caller-supplied owned flag. Kubernetes descendants derive ownership through namespace and owner references; do not log every short-lived Pod as a top-level resource. Keep at most 128 root/namespace ownership entries and 256 create/delete receipts; reject excess before applying a create. Existing-at-start resources never become owned through an update or matching name.

Reference resources list rg-aks-prerequisites and immutable AI/PostgreSQL catalog/profile identities/digests. Their values and presence remain unchanged throughout the attempt; reject attempts to update or delete them at the same ownership boundary, including a create command that would update an existing protected group. Runtime containers may read supplied configuration but never assume ownership of the external fixture dependencies. Supplied per-cluster diagnostic/node projections disappear with the owned cluster; the external catalog survives it.

Record ownership at the command/object mutation boundary, after validation and before effects are committed. Creation of an AKS cluster records its auto-owned children using the same reference-safe rules as Lab 1. Validate deletion closure before mutation, including group cascades: reject any closure containing a protected or non-owned resource, and leave publications/runtime untouched on rejection. Prefer explicit exact resource IDs; ARM name reuse after deletion does not inherit a previous incarnation's ownership receipt.

### Cleanup checkpoint and completion

`freezeAksCleanup(run, lab) -> {run, diagnostics}`, exposed as `{type:'aks-freeze-cleanup'}`, is available only in final-cleanup after all five final request Tasks currently pass, no unsaved files/experiment remains, and final consistency is true. Capture their evidence IDs, current artifact/source/object hashes, dependency generations, owned resource inventory and protected prerequisite digest. This checkpoint freezes those five Tasks so intentional deletion cannot erase their proof.

Before the checkpoint, reject deletion of the learner cluster, registry or their resource groups with a Lab gate explaining that final verification must be sealed first. Normal Pod/Deployment repair operations remain available. After freezing, permit only reads, supported cleanup deletions, cleanup Verify and final stage advance; reject source/build/apply/create/fault actions. Explain this transition in the button label and checkpoint summary. A Lab restart remains available to start another attempt; this is not a real-cloud approval workflow.

cleanup-app requires no application namespace/resources, running Pod/ReplicaSet, HPA, per-Pod metrics/projection timers or active experiment belonging to the target. Namespace deletion or deletion of all application resources plus the namespace is accepted. Deleting the cluster/group first is also valid when its ordinary cascade removes the same owned application state; the checkpoint still proves prior functionality.

cleanup-cloud requires no attempt-owned AKS/ACR/root or node groups/identities/grants, no owned cluster runtime/kube contexts, and no publishedTags entries belonging to deleted registries. Do not clear every sandbox collection: sandbox.namespaces is Service Bus, not Kubernetes. Preserve immutable source snapshots/build artifacts, sealed evidence, incident receipts, assistance/elapsed-time records and the protected fixture group/catalog. Historical artifacts are not live registry publications.

When sealing stage 8 after deletion, obtain its five frozen request Tasks' dependency/artifact snapshots from the validated cleanup checkpoint, and the two cleanup Tasks' evidence from their current deletion inventory checks. Do not reevaluate deleted Deployment selectors to replace the frozen snapshots. The durable receipt map and ownership deletion receipts must make this final seal independently valid after reload.

Cleanup Solutions demonstrate the ordinary supported commands:

```text
kubectl delete namespace assistant
az aks delete -g rg-aks-capstone -n aks-capstone --yes
az acr delete -n acrakscapstone --yes
az group delete -n rg-aks-capstone --yes
```

Group deletion after application cleanup is an equivalent route if the ownership closure is safe. Operations are simulated but still checked for exact ownership. A partial failure leaves accurate remaining inventory and can resume after reload; it must not erase evidence or mark cleanup complete prematurely. After both cleanup Tasks pass, seal the eighth stage and produce a read-only Lab Result with eight checkpoint outcomes, 31 Task outcomes, Hint/Solution usage and elapsed time.

## Task 1: Add eight-stage AKS validation and durable seals

**Files:** Create src/lib/kubernetes/capstone/stages.js and tests/aks-capstone-stages.test.js. Modify src/lib/labEngine/run.js, actions.js, evaluate.js and tests/helpers/aks.js.

**Interfaces:** Produce isAksCapstone, validateAksCapstoneState, advanceAksStage, getAksSealedTaskIds and `initializeAksStages(lab) -> stages`. Consume evaluateLab, canonicalize, existing evidence schema, sourceTextHash/sourceVersionsAt/validateSourceJournal. Enable source-save journal recording for aksCapstone through its own branch; retain the 512-save bound.

- [ ] Write tests for eight-stage Task partition, active-stage freshness, source history, wrong attempt/content, skipped/forged seals, latest unrelated build, future-stage Verify, reload after each seal and completed-run immutability.

```js
it('does not advance with a stale active-stage proof', () => {
  const s = seedAksCapstoneAt('source');
  const passed = executeAksSolution(s.run, s.lab, s.lab.tasks[0]);
  const edited = act(passed, s.lab, {
    type: 'save-file', path: 'app.py', text: passed.project.savedFiles['app.py'] + '\n# changed\n',
  }).run;
  const result = advanceAksStage(edited, s.lab);
  expect(result.diagnostics[0].code).toBe('AKS_STAGE_INCOMPLETE');
  expect(result.run.stages.sealedStages).toHaveLength(0);
});
```

- [ ] Define seedAksCapstoneAt(stageId) -> {lab,run} in tests/helpers/aks.js; it creates a real new capstone attempt and executes preceding Solutions/advance actions. No direct seals/evidence writes. Early tests can use a small test-only eight-stage Lab with actual recordVerification calls; production end-to-end tests use the real Lab.
- [ ] Run `npm.cmd test -- tests/aks-capstone-stages.test.js`; confirm failures before adding the adapter.
- [ ] Implement strict AKS initialization/validation/evaluation hooks and action dispatch without widening acaCapstone. Snapshot evidence-selected artifact IDs and semantic Kubernetes hashes; copy/pin referenced summaries in run.evidence.aksCapstoneReceipts so later ring pruning or cluster deletion cannot invalidate a valid seal.
- [ ] Rerun the new suite and `tests/aca-capstone-stages.test.js`; require PASS for both stage counts and unchanged ACA serialization. Commit: `feat: add resumable AKS capstone checkpoints`.

## Task 2: Establish empty-start fixtures and exact ownership

**Files:** Create src/lib/kubernetes/capstone/ownership.js, src/data/labs/aks-journey/capstone-seed.js and tests/aks-capstone-ownership.test.js. Modify src/lib/az/commands/group.js, aks.js, acr.js, src/lib/labEngine/actions.js, src/lib/kubernetes/state.js and tests/helpers/aks.js.

**Interfaces:** Produce `createAksCapstoneSeed(lab) -> {sandbox, artifacts, runtime, nextSequence}`, `recordAksOwnership(run, creation) -> run`, `inspectAksOwnership(run) -> {owned, protected, remaining}` and `validateAksDeletion(run, resourceIds) -> diagnostics`. creation contains validated resource type/ID/creation sequence/parent ID from internal command results, never from public action payloads.

- [ ] Test the protected-only starting sandbox, no ACR/publications/clusters/workloads, ordinary provisioning ownership, automatic node-group ownership, existing resource updates, same-name recreation and cascade rejection containing a non-owned resource.

```js
it('starts without learner cloud or application resources', () => {
  const { run } = seedAksCapstoneAt('source');
  expect(run.sandbox.aksClusters).toEqual([]);
  expect(run.sandbox.containerRegistries).toEqual([]);
  expect(run.artifacts.publishedTags).toEqual({});
  expect(inspectAksOwnership(run).owned).toEqual([]);
  expect(inspectAksOwnership(run).protected.length).toBeGreaterThan(0);
});
```

- [ ] Run `npm.cmd test -- tests/aks-capstone-ownership.test.js`; confirm failure, then construct the seed from immutable fixture identities and the standard empty Kubernetes extension.
- [ ] Integrate ownership receipts and closure validation atomically with commands/object application. Reuse Lab 1 cleanup effects for contexts, registry publications and node identities; do not rely on group-name prefixes.
- [ ] Rerun ownership tests, including protected group deletion, foreign child in an owned group, attempt mismatch and bounded histories. Require PASS. Commit: `feat: track AKS capstone resource ownership`.

## Task 3: Compose the 16-file Python/YAML project and source preview

**Files:** Create src/data/templates/aks-python/capstone.js, src/lib/kubernetes/capstone/scenarios.js and tests/aks-capstone-project.test.js. Modify src/lib/project/manifests.js, python.js, src/data/templates/aks-python/server.js and tests/helpers/aks.js.

**Interfaces:** Produce CAPSTONE_MANIFEST/FILES/SOLUTION_FILES and `verifyCapstoneSource(files, manifest, fixtureCatalog) -> {passed, diagnostics, measurements}` in capstone/scenarios.js. Compose existing integration/health/workload/diagnostics parsers; preserve their return fields and helper digests.

- [ ] Add tests for exactly 16 declared files, fixed-file changes, source-preview isolation, malformed/unsupported Python, SQL parameter provenance, v1/v2 formatting and logs on healthy/error/empty-retrieval outcomes.

```js
it('checks source without creating deployment evidence', () => {
  const result = verifyCapstoneSource(CAPSTONE_SOLUTION_FILES.v1,
    CAPSTONE_MANIFEST, INTEGRATION_FIXTURES);
  expect(result.passed).toBe(true);
  expect(CAPSTONE_MANIFEST.files).toHaveLength(16);
  expect(CAPSTONE_MANIFEST.buildFiles).not.toContain('k8s/deployment.yaml');
});
```

- [ ] Run `npm.cmd test -- tests/aks-capstone-project.test.js`; confirm failure before composing templates.
- [ ] Export complete v1/v2/scale/final file maps through CAPSTONE_SOLUTION_FILES. v1/v2 retain all fixed files; scale authors HPA/removes replica ownership; final empties the dormant HPA file and uses two replicas. Record full file text in structured Solutions, not runtime string-search edits.
- [ ] Implement labeled graph-only source checks using supplied fixtures and separate preview IDs; assert no artifact, sandbox or Kubernetes mutation. Test all composed server routes and matched Dockerfile copy/buildFiles sets.
- [ ] Rerun the project suite and the preceding Python integration/health/workload/diagnostics suites; require PASS. Commit: `feat: compose Python AKS capstone teaching project`.

## Task 4: Author stages 1-4 and their deployment evidence

**Files:** Create src/data/labs/aks-journey/capstone.lab.js, capstone-helpers.js, src/lib/kubernetes/capstone/evidence.js and tests/aks-capstone-evidence.test.js. Modify src/lib/kubernetes/capstone/scenarios.js, src/lib/kubernetes/actions.js, src/data/labs/index.js and tests/helpers/aks.js.

**Interfaces:** Export aksCapstoneLab and `capstoneTask(id, content) -> Task`. Produce `verifyAksCapstone(run, lab, scenarioId) -> {run,result}` with the standard scenarioVersion/outcome/completed/timing/measurements shape. Route source preview, infrastructure checks and immutable request scenarios through their existing implementations; only the owning Task can record that scenario.

- [ ] Write tests for the eleven Tasks in stages 1-4: source preview is not deployment proof; registry build is not a running image; attach/context/namespace mistakes; config consumption; current image on every Pod; successful and negative AI paths.

```js
it('requires an actual deployed source artifact for assistant behavior', () => {
  const s = seedAksCapstoneAt('deploy');
  const result = verifyAksCapstone(s.run, s.lab, 'capstone-answer-backups');
  expect(result.result.outcome).toBe('failed');
  expect(result.result.measurements.reason).toBe('stage-locked');
});
```

- [ ] Run `npm.cmd test -- tests/aks-capstone-evidence.test.js`; confirm failure before content/dispatch implementation.
- [ ] Author eleven Tasks with requirements-first briefs, complete optional Solutions, two Hints and Exam Notes. Consume the learner's built artifact and declared resource references; do not inject healthy runtime state to satisfy a check.
- [ ] Separate current proof from sealed-stage history. Every later stage's prerequisite check uses live required state even if a previous Task is historically complete; a broken live deployment cannot start a probe/release experiment merely because deploy was sealed.
- [ ] Rerun evidence/stage tests through all four seals and reload at each boundary; require PASS. Commit: `feat: add AKS capstone source provisioning and behavior stages`.

## Task 5: Integrate health, manual capacity and HPA experiments

**Files:** Create src/lib/kubernetes/capstone/policy.js and tests/aks-capstone-experiments.test.js. Modify src/lib/kubernetes/capstone/scenarios.js, src/lib/kubernetes/actions.js, schema.js, probe-experiments.js, resource-experiments.js, src/data/labs/aks-journey/capstone.lab.js and tests/helpers/aks.js.

**Interfaces:** Produce `getAksCapstonePolicy(run, lab) -> {allowHpa, allowTemplateChange, allowDestructiveCleanup}` and `validateAksExperimentStart(run, lab, scenarioId) -> diagnostics`. Scenario adapters map immutable predecessor profiles to current target IDs, stage and source/fixture versions without altering their algorithms.

- [ ] Add tests for three probe receipts, genuine manual workload completion, HPA decisions/work conservation, ai-wait, shared-clock time chunking, experiment exclusion and each handoff to fixed replicas.

```js
it('cannot seal resilience while an HPA can still control the deployment', () => {
  let s = seedAksCapstoneAt('resilience');
  s.run = executeCapstoneResilience(s.run, s.lab, { finishHandoff: false });
  const next = advanceAksStage(s.run, s.lab);
  expect(next.diagnostics[0].code).toBe('AKS_STAGE_INCOMPLETE');
  expect(getAksCapstonePolicy(next.run, s.lab).allowHpa).toBe(true);
});
```

- [ ] Define executeCapstoneResilience(run,lab,{finishHandoff=true}) -> run in tests/helpers/aks.js; run real scenario actions and explicit advances, then optionally delete HPA/save replicas/disable saved HPA YAML. Run `npm.cmd test -- tests/aks-capstone-experiments.test.js`; confirm failure.
- [ ] Implement seven stage-5 Tasks, profile adapters and policy gates. Keep template-change restrictions specific to the capstone's active HPA; preserve all predecessor Lab capabilities and histories.
- [ ] Test saved hpa.yaml still containing a live definition, HPA deletion without explicit replicas, manual scaling masquerading as HPA and template mutation during a resource experiment. Verify release-baseline has both Pods Available and current manifests aligned, and all six measured milestones remain valid after the intentional handoff so stage 5 can actually seal.
- [ ] Rerun experiment/stage suites plus existing resource/HPA and probe scheduler suites. Require PASS, including resume during scale-in and no second clock. Commit: `feat: compose AKS capstone resilience and scaling stage`.

## Task 6: Integrate v2 release, rollback and the two-cause incident

**Files:** Create src/lib/kubernetes/capstone/incident.js and tests/aks-capstone-incident.test.js. Modify src/lib/kubernetes/capstone/scenarios.js, evidence.js, src/lib/kubernetes/release-experiments.js, diagnosis-incidents.js, diagnosis-evidence.js, release-evidence.js, src/data/labs/aks-journey/capstone.lab.js and tests/helpers/aks.js.

**Interfaces:** Produce `startAksCapstoneIncident(run, lab) -> {run,diagnostics}` behind `{type:'aks-capstone-incident'}` with no caller overrides. Reuse actual rollout and diagnosis receipt APIs. Extend the same branch in src/lib/kubernetes/actions.js for dispatch; preserve public action envelopes and immutable scenario definitions.

- [ ] Add tests for built-but-undeployed v2, old-Pod masking, failure/undo/source alignment, missing HPA handoff, atomic incident injection, both-faults-present baseline, repair order and captured stale env.

```js
it('keeps an observed release after the later incident changes configuration', () => {
  const s = seedAksCapstoneAt('incident');
  const before = structuredClone(s.run.stages.sealedStages[5]);
  const injected = startAksCapstoneIncident(s.run, s.lab);
  expect(injected.run.stages.sealedStages[5]).toEqual(before);
  expect(evaluateLab(s.lab, injected.run).isComplete).toBe(false);
});
```

- [ ] Run `npm.cmd test -- tests/aks-capstone-incident.test.js`; confirm failure, then author the six Tasks in stages 6-7 using predecessor source/rollout/diagnosis checks.
- [ ] Implement atomic declared YAML/config/restart injection only from stable v2. Store epoch and original baseline snapshot before commands; replaying the same Start action reports the current incident instead of applying another restart.
- [ ] Preserve live-only versus historical snapshot diagnosis labels. Accept undo/forward repair and either incident repair order, but always require current v2 artifacts, refreshed environment and full AI flow before sealing incident.
- [ ] Rerun incident, release-evidence and diagnosis-evidence suites; require PASS including reload after injection, after one repair and before incident sealing. Commit: `feat: compose AKS capstone release and incident recovery`.

## Task 7: Freeze final proof and clean up owned resources

**Files:** Create src/lib/kubernetes/capstone/cleanup.js and tests/aks-capstone-cleanup.test.js. Modify src/lib/kubernetes/capstone/stages.js, ownership.js, evidence.js, src/lib/labEngine/actions.js, src/lib/kubernetes/actions.js, src/data/labs/aks-journey/capstone.lab.js and tests/helpers/aks.js.

**Interfaces:** Produce freezeAksCleanup, `aksCleanupReady(run, lab) -> boolean` and `inspectAksCleanup(run, lab) -> {checkpoint, remaining, protectedIntact}`. Consume the shared source/manifest/restart consistency inspector from release-evidence and the ownership deletion closure. Add the two final cleanup Tasks and five pre-cleanup request Tasks.

- [ ] Test missing/stale final cases, failed reapply/restart, wrong final source health/workload/logging, unsaved edits, pre-checkpoint cluster deletion, protected/cross-attempt deletion and post-checkpoint write rejection.

```js
it('retains protected fixtures and historical proof after owned cleanup', () => {
  const s = seedAksCapstoneAt('final-cleanup');
  const completed = executeCapstoneCleanup(s.run, s.lab, { mode: 'group-cascade' });
  expect(aksCleanupReady(completed, s.lab)).toBe(true);
  expect(inspectAksCleanup(completed, s.lab).protectedIntact).toBe(true);
  expect(completed.stages.sealedStages).toHaveLength(8);
  expect(evaluateLab(s.lab, completed).isComplete).toBe(true);
});
```

- [ ] Define executeCapstoneCleanup(run,lab,{mode}) -> run for explicit-deletes or group-cascade. It revalidates/reapplies/restarts, runs all final scenarios, freezes, deletes, verifies both cleanup Tasks and seals stage 8. Use ordinary actions only. Run `npm.cmd test -- tests/aks-capstone-cleanup.test.js`; confirm failure.
- [ ] Implement checkpoint eligibility/frozen Task projection and deletion inventory checks. Capture only redacted final proof; preserve immutable build/source/evidence stores while removing registry publications and cluster projections.
- [ ] Test partial cleanup/reload/retry, already-removed application via cluster cascade, owned node-group/context cleanup, dangling scheduled events, non-owned resources sharing a group, forged checkpoints and unchanged ACA empty-sandbox cleanup behavior.
- [ ] Rerun cleanup/ownership/stage suites plus `tests/aca-capstone-stages.test.js`; require PASS. Commit: `feat: seal AKS final proof and owned cleanup`.

## Task 8: Finish checkpoint UI, full traversal and Lab Result

**Files:** Create src/lib/kubernetes/capstone/inspection.js, tests/aks-capstone-ui.test.js and tests/aks-capstone-lab.test.js. Modify src/components/lab/LabPanel.vue, LabCompletePanel.vue, AksExperimentPanel.vue, src/components/blade/AksClusterBlade.vue, src/data/labs/index.js, tests/helpers/aks.js and README.md.

**Interfaces:** Produce `inspectAksCapstone(run, lab) -> {stages, activeStage, canAdvance, incident, cleanup, artifact, deployment}`. LabPanel uses an explicit AKS branch for this view, action types and ownership labels; retain the ACA branch's group/Bicep projection. Use existing store persistence, elapsed-time tracking, assistance records and Lab Result creation.

- [ ] Add full-solution traversal, alternate supported ACR attachment/Service ports/repair/cleanup paths, reload during each experiment and every sealed boundary, and rejection of external or forged checkpoint/evidence payloads.

```js
it('completes all eight checkpoints from an empty learner environment', () => {
  const lab = aksCapstoneLab;
  let run = createBehavioralRun(lab, { attemptId: 'aks-capstone-complete' });
  run = executeAksCapstoneSolution(run, lab);
  const result = evaluateLab(lab, run);
  expect(result.total).toBe(31);
  expect(result.isComplete).toBe(true);
  expect(run.stages.sealedStages).toHaveLength(8);
  expect(aksCleanupReady(run, lab)).toBe(true);
});
```

- [ ] Implement executeAksCapstoneSolution(run,lab) -> run in tests/helpers/aks.js to execute the actual structured Task Solutions, required fixture controls, explicit clock advances and stage/freeze actions. Do not write runtime outcomes, done flags or seal arrays directly.
- [ ] Run `npm.cmd test -- tests/aks-capstone-ui.test.js tests/aks-capstone-lab.test.js`; confirm failure before UI integration.
- [ ] Show all eight checkpoints, active/locked/sealed status, historical versus current evidence, owned versus supplied resources, incident progress and exact cleanup eligibility. Disable advance while any AKS experiment is active; checking only ACA runtime.activeScenario is insufficient.
- [ ] Make final cleanup transition text explicit, show remaining owned resources after partial deletion and retain readable incident/release receipts after cluster removal. Test keyboard controls, reload/export/import, invalid saved state and completed read-only Results.
- [ ] Run `npm.cmd test -- --exclude '**/.superpowers/**'` and `npm.cmd run build` once as the delivery gate; fix concrete failures. Walk through one fresh capstone, a mid-experiment resume and completed cleanup Result. Verify ACA capstone still has seven stages and its existing behavior.
- [ ] Update README with Lab 25, eight checkpoints, 31 Tasks, prerequisite contracts and simulation boundaries. Register it after the predecessor gates are delivered. Commit: `feat: deliver AKS Knowledge Assistant capstone`.

## Completion criteria and planning review

Implementation is complete only when all 31 Tasks pass through real simulated actions, all eight checkpoints persist across reload, both supported cleanup routes preserve the supplied prerequisites, and a complete read-only Lab Result retains meaningful evidence after deletion. A source preview, historical v1 success or clean sandbox alone cannot complete the capstone.

Coverage review: source/health/logging maps to Task 3; ACR/AKS/access/YAML and live AI cases to Tasks 2/4; probe/resource/scaling composition to Task 5; release/rollback/incident to Task 6; final reapply/restart/negative cases and cleanup to Task 7; resumability, strict stage ownership and Lab Results to Tasks 1/8. All five Review Focus risks have explicit test owners. The HPA-to-fixed-replica handoff avoids adding unplanned simultaneous-controller semantics. Cleanup preserves the external fixture catalog and completed evidence without applying ACA's empty-sandbox rule. No application implementation or application test execution is claimed while preparing this document.
