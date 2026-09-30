# AKS Labs 1-6 implementation contract

Status: technical contract proposed by the saved implementation plans; no application implementation authorized or performed by this document. The user accepted the 25-Lab curriculum and requested plans for Labs 1-3 followed by Labs 4-6 on 2026-09-25.

Curriculum: [AKS learning journeys](2026-09-25-aks-learning-journeys-discussion.md). Plans: [Labs 1-3](../plans/2026-09-25-aks-labs-01-03.md), then [Labs 4-6](../plans/2026-09-25-aks-labs-04-06.md).

## Scope and delivery

- Browser-local, deterministic simulation; no Azure, Docker, Python process, model or embedding service executes.
- Python source and ordinary block YAML are editable. Unsupported valid syntax is reported as unsupported by the trainer, not invalid Python/Kubernetes.
- Build and publish capture saved application files. Apply captures saved manifests. Running containers retain their captured image and environment.
- PostgreSQL, pgvector, documents, embeddings and AI responses are supplied fixtures. Database administration and dedicated Workload Identity/Key Vault work remain deferred.
- Deliver and review one Lab at a time. Labs 2 and 3 cannot become available before Lab 1 passes its gate; the same rule applies to Labs 4-6. Planning all six now does not authorize implementing or publishing them as one batch.
- Preserve all legacy and Container Apps Labs, saved runs and Lab Results. Keep the existing engineVersion/schemaVersion 2 envelope and add an explicitly validated AKS extension.
- Eight later topics and the capstone remain curriculum scope, not capabilities to build now. Do not implement probes, HPA, general ingress, SQL engines, arbitrary Python execution or the future AKS capstone in these plans.

## Repository findings

`src/lib/az/shell.js` recognizes az and clear; legacy tests expect kubectl to be unavailable without a supporting Lab. `src/lib/project/files.js`, `dockerfile.js` and `build.js` currently parse .NET projects and hash all project files. `ProjectEditor.vue` has .NET-specific explanatory text. `runtime.deploymentsByApp` and existing request panels are Container Apps projections, not suitable places for Kubernetes objects.

Reuse `createBehavioralRun`, `applyRunAction`, `recordVerification`, the session/repository, file editor, structured Solutions, ACR publication artifacts and journey ordering. Add focused modules and capability dispatch rather than refactoring all existing services. `sandbox.namespaces` means Service Bus namespaces; never put Kubernetes namespaces there.

## Dependencies and taught language

Add exact npm dependencies `yaml@2.9.1` and `@lezer/python@1.1.19` during Task 1 of plan A, with the lockfile. Versions were checked through npm metadata on 2026-09-25. Both are browser libraries. Retain Node >=18, Vue 3, Pinia, Vite and Vitest from package.json.

Teach a Python 3.12 standard-library HTTP API. The Dockerfile uses `python:3.12-slim`; that floating patch tag is a teaching image reference, not a promise of byte-identical real Docker builds. The simulator has its own immutable artifact IDs/digests. No Python framework or Azure SDK installation is needed in Labs 1-6; client authoring depth is reserved for the AI integration topic. A read-only `training_runtime.py` helper is explicitly labeled a simulated dependency adapter, not an Azure SDK.

Use Lezer to parse and reject error nodes, then project only these supported expressions into a finite JSON AppSpec: string/integer literals; top-level constants; dictionary literals with string keys; references to those constants; `os.environ.get("KEY", "default")`; and supported calls in `info()`/`settings()`/`answer(question)`. Plan B adds `json.loads(Path("/etc/assistant/settings.json").read_text())` and the fixed `training_runtime.answer(question, settings())` call. Validate function bodies and helper imports, not just matching keywords anywhere in source. Accept comments, quote styles and equivalent whitespace. Reject unsupported control flow or expressions with a located diagnostic. No eval, dynamic Function, subprocess, network request, or interpreter.

Files in the taught project are `app.py`, `server.py`, `Dockerfile`, `k8s/namespace.yaml`, `k8s/deployment.yaml`, `k8s/service.yaml`; plan B adds `training_runtime.py`, `k8s/configmap.yaml`, `k8s/secret.yaml`, `k8s/secondary-namespace.yaml`, `k8s/secondary-configmap.yaml`, `k8s/secondary-secret.yaml`, `k8s/secondary-deployment.yaml`, and `k8s/secondary-service.yaml`. Each manifest enumerates only files that Lab uses. `server.py` is a fixed standard-library HTTP adapter importing app functions; the independent Lab still allows editing the app and manifests. No new-file UI is needed.

Manifests declare `language: 'python'`, `runtimeFamily: 'aks'`, `buildFiles`, and `kubernetesFiles`. Limits: 16 files, 64 KiB per file, 256 KiB total, 20,000 Python syntax nodes, 8 YAML documents per file, nesting depth 32. Existing C# manifests retain their current limits and parsing paths. Save stores bounded text even if Python/YAML has syntax errors; build/apply emits located diagnostics. A broken unrelated YAML file must not block an otherwise valid image build.

## State ownership

New ARM resource collection: `sandbox.aksClusters`. A record contains `id`, `name`, `resourceGroup`, `location`, `nodeResourceGroup`, `nodeCount`, `nodeVmSize`, `provisioningState: 'Succeeded'`, `identity: {type:'SystemAssigned',principalId}`, and `identityProfile: {kubeletidentity:{resourceId,clientId,objectId}}`. Use ARM naming/case semantics; retain original display casing. A node resource group and a kubelet user-assigned identity are automatically modeled using existing group/identity operations, and are visibly marked cluster-owned. This lets existing AcrPull role validation work. The control-plane principal is separately deterministic and cannot act as the kubelet principal.

New run extension:

```js
runtime.kubernetes = {
  version: 1,
  currentContext: null,
  contexts: {}, // name -> { clusterId, namespace: 'default' }
  clusters: {}, // clusterId -> ClusterState below
  requests: [] // bounded, redacted outcomes; max 100
}
// ClusterState
{
  resources: {}, // key -> Kubernetes-shaped object; see key below
  podSnapshots: {}, // Pod uid -> { artifactId, templateHash, environment, files, configRefs }
  events: [], // max 300; deterministic event metadata/reason/message
  receipts: [], // max 100: replacement and restart transitions
  projectionDue: {} // plan B only; Pod uid -> due simulated time
}
```

Resource key: `${kind}/${namespace ?? ''}/${name}`; Kubernetes names/namespaces are case-sensitive and validated. Nodes and Namespaces are cluster-scoped. No strings containing path separators can be names. Every stored resource has `apiVersion`, `kind`, `metadata` with name/namespace/uid/resourceVersion, applicable spec/data and status. Deployment `metadata.generation` changes only with spec changes; resourceVersion changes on an effective object change. UID generation consumes `run.nextSequence`; no Date.now/randomness.

Supported resources in plan A: Namespace v1, Deployment apps/v1, Service v1; derived Node v1, ReplicaSet apps/v1, Pod v1 and Event v1 inspection. Plan B adds ConfigMap and Opaque Secret v1. Cluster deletion removes only that cluster's runtime/contexts and automatically owned node group/identity/grants; it cannot delete a pre-existing shared ACR or another cluster. Resource-group deletion invokes the same cleanup.

Optional AKS fields remain absent in legacy runs. AKS Labs require runtime.kubernetes version 1 and a matching validated Sandbox collection. Missing/malformed AKS state in an AKS run is recoverable through the existing export/restart UI, not silently reseeded. Check references, UID uniqueness, counter bounds, image snapshot ownership, cluster/namespace separation and finite JSON. Preserve valid legacy completed runs and their historical evidence.

## Command surface for Labs 1-3

Existing az group/acr commands remain. Add capability-gated az aks create/show/list/update/get-credentials/delete. Supported create flags: -g/--resource-group, -n/--name, --location, --node-count (1-3), --node-vm-size (Standard_D2s_v5 only), --enable-managed-identity, --attach-acr and --generate-ssh-keys. SSH keys are simulated and no files are written outside run state. Node resource-group naming is `MC_<group>_<cluster>_<location>`. Show returns identityProfile and nodeResourceGroup. Update supports --attach-acr/--detach-acr; attachment uses existing exact-registry AcrPull for the kubelet identity. Non-ABAC registry mode is explicit in help. No registry admin passwords or implicit application permissions.

Get-credentials accepts --overwrite-existing, records a context by cluster name, makes it current and leaves its selected namespace intact when refreshing the same context. Without overwrite, a name collision pointing at a different cluster is a diagnostic with no mutation. No real kubeconfig is written. Delete requires --yes by the trainer's existing convention.

kubectl supports:

- `config current-context`, `config get-contexts`, `config use-context NAME`, `config set-context --current --namespace NAME`.
- `get nodes|namespaces|deployments|replicasets|pods|services|events [NAME]` with aliases, optional -n/--namespace, -A/--all-namespaces for namespaced lists, -o json|yaml|wide and --context. Default is a truthful tabular projection.
- `describe deployment|pod|service NAME [-n NS]`, `logs POD [-n NS]`.
- `apply -f SAVED_PATH [-n NS]`, repeatable -f, and `apply -f k8s/` over saved YAML paths in sorted order. No URL/stdin/manifests outside the project. Support `--dry-run=client -o yaml|json` as validation only.
- `delete pod NAME [-n NS]`, `delete deployment NAME [-n NS]`, `delete service NAME [-n NS]`, and `delete -f SAVED_PATH`; namespace deletion can be explicitly unsupported in these Labs. Return help for unsupported verbs/flags without mutation.
- `rollout status deployment/NAME [-n NS]` is read-only, immediately reporting the current modeled state. No blocking watch.

Plan B adds get/describe ConfigMaps and Secrets (keys/types in describe; explicit get -o yaml/json may show the fictional encoded values), and `rollout restart deployment/NAME [-n NS]`. Do not expose secret values in application responses, event messages, or request evidence.

Namespace resolution is explicit metadata.namespace, else command namespace, else context namespace; an explicit command namespace conflicting with manifest metadata is an error. Namespace/Node objects reject a namespace field. Missing contexts/clusters/namespaces give distinct messages. Reads and dry-run never advance runtime, rotate IDs, or create verification evidence.

## YAML and reconciliation semantics

Use yaml parseAllDocuments with line locations, duplicate-key checking and YAML 1.2; support block maps/lists, comments, quoted scalars and block strings. Reject aliases/anchors, custom tags, merge keys and unsafe keys with an explicit unsupported diagnostic. JSON-form YAML is accepted as a subset, not required. Reject nonfinite values and non-string map keys. Only accept declared supported Kubernetes fields; never silently ignore valid-but-unmodeled fields.

Namespace supports metadata. Deployment supports metadata, replicas (1-3 initially), immutable matchLabels selector, matching Pod-template labels, one named container, tagged image, imagePullPolicy Always, one named/numeric containerPort, and literal environment variables. Service supports selector, ClusterIP/LoadBalancer type, one TCP port/targetPort (number or named container port). Returned status and server metadata are read-only. Do not interpret containerPort as changing the Python listener. Plan B adds environment key references and mounted config described in its plan.

Parse errors abort before any resource mutations. For multiple successfully parsed documents/files, process in deterministic input order; an object validation/apply error stops processing, preserves already applied earlier objects and reports which failed. Do not teach multi-object apply as transactional. A no-op apply retains generation, Pod UIDs, snapshots and evidence. Missing resource omission does not delete it.

Creation/update yields a derived ReplicaSet and requested Pods. Match the exact image tag to an immutable build and evaluate kubelet image access. A failed pull produces Pending/Waiting image-pull evidence, not an exception that discards the Deployment. New Pods become Running/Ready immediately on success in this foundation simulation; explain that scheduling, pulls and readiness timing are compressed until later Labs. Updating a Pod template replaces modeled Pods synchronously; a rolling-update strategy is explicitly unsupported until the release topic. Keep old/new generation receipts for inspection, but do not claim detailed availability behavior.

Deleting a managed Pod causes a replacement with a new UID under the same ReplicaSet/template. Record the deleted and replacement IDs before emitting replacement evidence. Deleting a Deployment removes owned ReplicaSets/Pods; its Service may remain with zero backends. Revoking ACR access or republishing a tag must not modify running containers. A newly created Pod with Always resolves the then-current tag and permissions.

## Stable module interfaces

All new functions below are defined by tasks in the two plans. Never call one without importing it; return finite JSON and preserve input objects.

```js
parsePythonProject(files, manifest) // -> { appSpec, diagnostics }
parsePythonDockerfile(text, {buildFiles = ['app.py','server.py','Dockerfile']} = {}) // -> { dockerSpec, diagnostics }; COPY sources must be allowed buildFiles
selectBuildFiles(files, manifest) // -> string map; Python buildFiles only, legacy all files
parseKubernetesYaml(text, path) // -> { documents, diagnostics }
validateKubernetesObject(object, { namespace, capabilities }) // -> { object, diagnostics }
emptyKubernetesRuntime() // -> version-1 runtime extension
validateKubernetesRuntime(runtime, run) // -> boolean, no mutation
createAksCluster(sandbox, options) // -> { sandbox, resource, existed }
getAksCluster(sandbox, resourceGroup, name) // -> record or AzError
updateAksRegistry(sandbox, { resourceGroup, name, registry, attach }) // -> { sandbox, resource }
deleteAksCluster(sandbox, { resourceGroup, name }) // -> { sandbox, resource }
runKubectl(sandbox, tokens, { run, lab }) // -> same result envelope as runAz
applyKubernetesObjects(run, documents, options, lab) // -> { run, lines, diagnostics }
reconcileKubernetes(run, lab) // -> run
simulateKubernetesRequest(run, scenario, lab) // -> { run, outcome, measurements }
kubernetesDependencies(clusterId, namespace, deploymentName, serviceName) // -> selector map
refreshKubernetesDependencies(previous, next, lab) // -> next with bumped generation counters
applyAksAction(run, action, lab) // -> {run,lines,portalEvents,diagnostics}
```

`runKubectl` calculates an immutable candidate and returns an internal `kubernetes-state` effect containing the validated replacement extension and nextSequence. `applyCommandEffects` accepts this effect only for kubernetes-enabled Labs, validates it and merges those fields. It is not an action available to learners. Add `aks-context` effects for get-credentials. Azure commands return resource changes through the normal Sandbox field. Reconcile missing/new clusters after command effects and perform reference-safe cleanup. Preserve standard command scrollback/event/session handling.

New learner request action: `{type:'aks-request',scenarioId}`. Its declared Lab scenario fixes cluster, namespace, Service, request and expected outcome. Reject additional fields such as body/status/artifactId. Allow failed real outcomes to be recorded; only the Lab's internal assessor sets passed. Use existing recordVerification for a versioned task scenario. Refresh dependency generations after every applicable saved-file/command/action mutation; selectors include only relevant applied objects, effective desired configuration, source/build provenance required by that Task and actual Pod snapshots. Context selection and unrelated namespace changes do not invalidate an already verified application. Changing and restoring a relevant dependency still invalidates old evidence through its generation counter.

## Fixtures and scenario IDs

Plan A uses GET /api/info returning `{service,version,environment}` from the captured Python AppSpec and environment. Plan B seeds a functioning assistant and adds POST /api/ask through a fixed helper. A response alone cannot stand in for expected routing/dependency evidence.

Learning content uses resource names from each plan. Immutable Lab scenarios supply the request, exact target and expected response. Bounded fixtures live in `src/data/fixtures/aks/` and are never callable URLs. Host strings ending in `.example` are visibly labeled fixture addresses. There is no browser fetch to these addresses.

## Source checks

Checked 2026-09-25: [AI-200 outline](https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/ai-200), [az aks reference](https://learn.microsoft.com/en-us/cli/azure/aks?view=azure-cli-latest), [AKS/ACR integration](https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration), [kubectl apply](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/), [Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/), [ConfigMaps](https://kubernetes.io/docs/concepts/configuration/configmap/), [Secrets](https://kubernetes.io/docs/concepts/configuration/secret/), [yaml](https://eemeli.org/yaml/), [Lezer Python](https://github.com/lezer-parser/python). Schema resource versions are core v1 and apps/v1. This is a documented teaching subset, not a general Kubernetes emulator or a claim about all current Azure defaults.
