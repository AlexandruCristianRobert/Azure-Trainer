# Azure-Trainer

Public, single-user demo: hands-on preparation for exam **AI-200** in a simulated Azure portal.
You complete the six original Labs with `az` commands in the Cloud Shell. The Container Apps journey
also uses a file editor and Experiments to verify the running response. Portal Blades mirror the
simulated Sandbox and Tasks update live. No real Azure or Azure account is involved.

**Run the app:** [Azure-Trainer on GitHub Pages](https://alexandrucristianrobert.github.io/Azure-Trainer/).
Lab progress is saved in this browser on this device; it is not synced to GitHub.

- Glossary: [CONTEXT.md](./CONTEXT.md) · Spec: [SPEC.md](./SPEC.md) · Decision: [ADR-0001](./docs/adr/0001-simulated-az-cli-over-in-browser-sandbox.md)
- Design: `docs/design/Azure-Trainer Screens.dc.html` (Claude Design export) · Brief: `docs/design-prompt.md`

## Available Labs

The Kubernetes journey begins with **Deploy a Python service to AKS**. Save a Python API, build its simulated private image, create and connect an AKS cluster, grant its kubelet registry pull access, apply Kubernetes manifests, verify `GET /api/info`, and observe a Deployment replace a deleted Pod. **Recover an AKS deployment incident** starts with an accidental staging workload, a missing image tag, and denied registry pulls; repair the saved manifests and cluster access, remove the staging workload, then prove recovery through the intended Service. **Deploy an isolated AKS review instance** keeps the primary workload running while you create a second namespace, complete and apply review manifests, verify its response and Pod replacement, and check the primary response again. Resources, Pods, events, and requests are simulated locally; no Azure subscription or real Kubernetes cluster is used.

The next three AKS Labs cover application configuration. **Configure an AKS Knowledge Assistant** builds corrected Python settings code, applies ConfigMaps and Secrets, then compares a running Pod's captured environment with a ConfigMap update and a delayed mounted-file projection. **Diagnose AKS configuration incidents** repairs a wrong-namespace reference, a missing key, and a stale environment in three controlled phases. **Reuse a shared AKS assistant image safely** configures a review namespace with its own supplied dependency profile while preserving the primary instance and its immutable image artifact. The AI, PostgreSQL, documents, embeddings, credentials, and responses are fictional local fixtures; no downstream service runs or receives a request.

**Trace AKS Service connectivity** changes the Python listener to 9090, builds a captured image, and authors internal ClusterIP and external LoadBalancer Services. Learners inspect EndpointSlices and trace requests from the supplied diagnostic Pod and the simulated external address through the selected Pod to the fictional assistant dependencies. **Diagnose AKS connectivity incidents** recovers selector, port, and downstream dependency faults in three observed phases. **Expose an independent AKS review assistant** creates review namespace Services for a shared image and proves both review and unchanged primary routes. Addresses, DNS, logs, and HTTP responses are local deterministic simulations. Labs 12–25 remain planned.

**Build an AKS knowledge assistant** adds a guided Python question-to-answer flow. Learners validate input, embed a question, retrieve a published training document with metadata and vector-distance filters, pass retrieved context to the answer adapter, build and deploy the image, then verify backups, support, empty-input, and no-match behavior through the external Service. The model, PostgreSQL data, and dependency traces are deterministic local fixtures.

**Diagnose AKS assistant integration faults** presents three staged incidents: a wrong captured embedding deployment, a metadata filter that returns zero rows, and a throttled request without application retries. Learners inspect dependency traces, repair and restart configuration, rebuild a bounded retry policy, and verify recovery alongside controlled persistent failures. All requests and timing are local deterministic simulations.

The Container Apps journey has sixteen implemented Labs in this app. **Build and deploy a Container App** guides you through saving a .NET 10 API and Dockerfile, publishing a simulated private image, deploying with managed identity, and verifying `GET /api/info`. **Recover a Container App deployment** starts with a deterministic failed deployment; inspect and repair its startup configuration, then verify the response. **Deploy an API from requirements** starts with a reusable project and empty Sandbox. Meet the named resource, port, image and runtime requirements in any supported order, then observe the actual response. **Observe CPU scaling** starts with a healthy private API and measures baseline service, scale-out, an overload ceiling and stabilized scale-in through named workloads and an explicit simulated clock. **Recover CPU scaling** starts during a measured throughput incident; inspect the scaling policy, restore full service under the unchanged workload, and verify quiet scale-in. **Size CPU capacity** accepts different CPU sizes and utilization targets when measured steady and burst throughput meet the goals, followed by quiet scale-in. **Observe health probes** uses separate startup, readiness, and liveness endpoints and three named two-replica experiments to show traffic gating, routing recovery, and restart after a process hang. **Diagnose probe restarts** starts in a measured startup loop and requires a startup allowance repair, a process-only liveness endpoint during an optional dependency outage, and a genuine hang recovery. **Design reliable health probes** starts with a different 30-second private API, failing health routes and no probes. Choose supported endpoint logic and probe timing to prove safe startup, readiness recovery and bounded hang recovery in any order. The guided Foundry integration Lab provisions a simulated AIServices account, project and deployment, grants the Container App identity account-scoped inference access, redeploys the summarizer and verifies a 200 response plus a 400 validation short circuit with no upstream call. **Diagnose Foundry model failures** starts with an active wrong endpoint and deployment, then repairs caller access and a bounded retry policy before proving 429 recovery, controlled 503/504 responses and a healthy call. **Build an independent Foundry brief API** starts with a healthy private image, a pull identity and an unattached inference identity. Provision a separate account, project and briefing-secondary deployment, attach and grant the dedicated caller, then save and redeploy POST /api/brief with a supported two- or three-attempt policy. Four named requests prove valid 200, invalid 400 without invocation, transient 429 recovery and bounded persistent 503. The model profile and responses are simulated. Each Lab has an independent saved run and Result. Guided Bicep now covers local modules, saved parameters, validate, what-if, create, Foundry request proof, measured replica-ceiling update, and unchanged reapply. The deployment panel shows saved files, located diagnostics, and current and historical previews. **Troubleshoot a Bicep Deployment** repairs a missing output and wrong environment parameter, then diagnoses and corrects a miswired Foundry grant through deployment and request evidence. **Adapt Bicep to two environments** starts with a healthy primary stack and two published images. Complete staging parameters, deploy and prove staging request/CPU behavior, then reapply the current shared source without changes to primary and collect fresh primary proof. The deployment review switches between target-specific saved parameters, previews and outputs. Lab 16, **Operate and recover a Container Apps service**, adds seven ordered stages: save combined source, bootstrap and publish, deploy main, prove healthy behavior, diagnose simulated deployment drift, prove recovery and reproducibility, then delete all attempt-owned resource groups. Advance seals each stage only after its Tasks pass. The one-shot incident changes the live effective Foundry deployment while saved Bicep stays correct; a main-root what-if and reapply reveal and repair it. The recovery seal records a cleanup checkpoint. The six original Labs remain available below. All Container Apps builds, deployments, requests, incidents, probes and CPU traces are local deterministic simulations; they do not call Azure or a live model.

The probe Lab accepts explicit HTTP probe configuration in the JSON form of `containerapp.yaml`, using the pinned `Microsoft.App/containerApps@2025-07-01` schema. General block YAML and other valid Azure probe modes are outside this trainer's bounded subset. The one-second simulation clock, immediate restart, and fixed fault schedule teach the lifecycle but are not production timing guarantees. Saved C# needs an image build and deployment; saved probe YAML needs a deployment update. The model follows [ACA health probe guidance](https://learn.microsoft.com/en-us/azure/container-apps/health-probes), the [pinned REST schema](https://github.com/Azure/azure-rest-api-specs/blob/main/specification/app/resource-manager/Microsoft.App/ContainerApps/stable/2025-07-01/CommonDefinitions.json), and [Kubernetes startup gating](https://kubernetes.io/docs/concepts/workloads/pods/probes/). The general Learn readiness narrative and [ACA support evidence](https://azureossd.github.io/2023/08/23/Container-Apps-Troubleshooting-and-configuration-with-Health-Probes/) differ on restart language; the trainer uses the stated readiness routing distinction without claiming that ambiguity is resolved for the live platform.

- **Order-processing backend on Service Bus** — 5 Tasks covering a namespace, queue, topic and subscription filter.
- **Deploy a Container App with KEDA scaling** — 5 Tasks covering an environment, public HTTP app, replica limits and HTTP scaling rule.
- **Cosmos DB container with vector search** — 5 Tasks covering a NoSQL account, vector-search capability, database and container vector policies.
- **Store and rotate secrets in Key Vault** — 5 Tasks covering a protected vault, scoped RBAC access and manual secret version rotation.
- **Serverless API with Azure Functions** — 5 Tasks covering host storage, Flex Consumption, an application setting and CORS.
- **Event Grid custom topic with filtered subscription** — 5 Tasks covering a custom topic, webhook destination, event types and subject filters.

Start any available Lab from Home. **Next Lab** follows catalog order from Service Bus to
Container Apps to Cosmos DB to Key Vault to Azure Functions to Event Grid. All six Labs are available.
Each Lab has its own saved Sandbox, command history, Hints and Lab Results.
The Container Apps journey uses native saved progress and Results. Its resource Blades are read-only; completed runs can be inspected or restarted while preserving historical Results.

## Run

```bash
npm install
npm run dev      # http://localhost:5175
npm test
npm run build
```

GitHub Actions runs the tests, builds with the `/Azure-Trainer/` base path, and publishes `dist` to GitHub Pages after each push to `main`. Production uses hash routes so Lab links remain reloadable on static hosting.

## What the Cloud Shell understands

`az` (banner), `az --version`, `az version`, `az login`, `az account show|list`,
`az configure --defaults group=<rg> location=<loc>` / `--list-defaults`,
`az group create|show|list|delete|exists`,
`az servicebus namespace create|show|list|update|delete|exists`,
`az servicebus queue create|show|list|update|delete`,
`az servicebus topic create|show|list|delete`,
`az servicebus topic subscription create|show|list|delete`,
`az servicebus topic subscription rule create|show|list|delete`, `clear`.
Also supported: `az containerapp env create|show|list|delete`,
`az containerapp create|update|show|list|delete`,
`az containerapp ingress enable|update`, `az acr create|show|list|delete|build`,
`az acr repository list`, `az identity create|show|list|delete`,
`az cosmosdb create|update|show|list|delete`,
`az cosmosdb sql database create|show|list|delete`, and
`az cosmosdb sql container create|show|list|delete`, `az keyvault create|show|list|update`,
`az role assignment create|list|delete`, and
`az keyvault secret set|show|list|list-versions|set-attributes`,
`az storage account create|show|list|delete`, `az functionapp create|show|list|delete`,
`az functionapp config appsettings set|list|delete`, `az functionapp cors add|remove|show`,
`az eventgrid topic create|show|list|delete`, and
`az eventgrid topic event-subscription create|update|show|list|delete`.
The Kubernetes journey also supports the bounded `az aks create|show|list|update|delete|get-credentials`, `az acr build`, and `kubectl config|get|describe|apply|delete|rollout` commands used in its Labs.
Every group and command answers `--help`. Output is az-shaped JSON; errors use az wording.

The original Container Apps KEDA Lab supports environment selection, image, ingress/target port, replica
limits, tags and HTTP scale rules (`--scale-rule-name`, `--scale-rule-type http`,
`--scale-rule-http-concurrency`). Deletes require `--yes`. Other trigger types, custom CPU/memory
allocations, revisions and real traffic are outside this Lab's command surface. The Sandbox
stores scaling configuration; it does not run containers or simulate replica activity.

Implementation design and verified Microsoft references:
[Container Apps KEDA Lab](./docs/superpowers/specs/2026-09-21-containerapps-keda-design.md).

The Cosmos DB Lab supports a single-region NoSQL account, the `EnableNoSQLVectorSearch`
capability, databases without shared throughput, and containers with dedicated throughput.
Pass embedding/indexing policies as single-quoted inline JSON using `--vector-embeddings`
and `--idx`; file references such as `@policy.json` are not available in the Cloud Shell.
Policies are set on container creation. Delete and recreate a misconfigured container to
correct its immutable configuration. This Lab does not store documents, generate embeddings,
populate an index or run vector queries. See the [Cosmos DB Lab design](./docs/superpowers/specs/2026-09-21-cosmos-vector-search-design.md)
for command scope and Microsoft references.

The Key Vault Lab uses Azure RBAC with vault-scoped Secrets Officer and Secrets User roles for
the synthetic Sandbox learner. Setting an existing secret creates a new version; changing
attributes does not rotate its value. Secret Blades and list commands display metadata only;
`secret set` and `secret show` return the supplied demo value in CLI JSON. Disabled latest
versions cannot be read and do not fall back to an older version.

This Lab covers manual rotation. Keys, certificates, files, access policies, automatic rotation,
and vault/secret delete, recover and purge commands are outside its command surface. Purge
protection is recorded as configuration; group deletion or Restart Lab removes simulated data
without a soft-delete lifecycle. All demo data is local, including the provided secret strings.
See the [Key Vault Lab design](./docs/superpowers/specs/2026-09-21-keyvault-secrets-design.md).

The Functions Lab prepares an API host using Linux Flex Consumption, Node.js 22 and Functions 4.
It links a same-group, same-region StorageV2 account, stores a custom demo application setting,
and configures one allowed frontend origin. It does not deploy function code, create HTTP
triggers, execute requests or expose a working endpoint. Hostnames shown are illustrative.

The command subset supports custom application settings only. Runtime and storage configuration
are recorded separately; Azure-managed settings and connection strings are not exposed.
Setting values are redacted in mutation output and Blades; `config appsettings list` returns
the supplied demo values. CORS records allowed origins without simulating browser enforcement.
Storage deletion is blocked while a Function App references it; group deletion removes both.
Implicit hosting plans, Application Insights and deployment containers are not separately
modeled. See the [Functions Lab design](./docs/superpowers/specs/2026-09-21-functions-serverless-api-design.md)
for supported flags, storage dependency rules and Microsoft references.

The Event Grid Lab configures a custom topic using EventGridSchema and a webhook subscription.
It supports event-type lists and literal subject prefix/suffix filters; subject matching defaults
to case-insensitive. Updating a filter preserves omitted fields. An empty event-type list (or
`All`) includes all types, and empty subject strings clear their respective filters.

Only HTTPS webhook destinations without credentials, query strings or fragments are supported.
Topic and subscription deletes require `--yes` as a Sandbox confirmation convention. Group and
topic deletion remove their nested event subscriptions. Advanced filters, other destination types,
system topics, endpoint validation, publishing, delivery and retries are outside this Lab.
The recorded provisioning state does not prove a webhook exists or can receive events.
See the [Event Grid Lab design](./docs/superpowers/specs/2026-09-22-eventgrid-filtered-subscription-design.md)
for supported commands and Microsoft references.

## Icons

Service icons are Microsoft's official Azure architecture icons (permitted for training
materials); control glyphs are Fluent UI System Icons (MIT). Both live under `src/assets/icons/`.

## Progress

The six original Labs store progress in `localStorage` (`at_results`, `at_run_<labId>`).
The Container Apps journey Labs use native IndexedDB. Clear site data to reset everything.

### Behavioral Lab foundation (F0)

The Container Apps learning journey starts with an internal foundation in
`src/lib/labEngine/`: versioned attempts, dependency-aware verification evidence,
shared Task evaluation, native IndexedDB persistence, and a headless session coordinator.
The six original Labs continue to use localStorage. F0 itself added no playable Lab or new UI;
the first Application Factory Lab connected the foundation to learner controls.

Behavioral persistence uses database `azure-trainer-behavioral`, version 1, with atomic
run/result completion and revision checks to prevent stale tabs overwriting progress.
Incompatible records are preserved for inspection rather than silently reset.

Run the unit suite with `npm test`. To check native browser persistence and session
integration, run `npm run dev`, then open `/tests/browser/f0-persistence.html` on that
server. The page prints case results and uses temporary test databases that it removes
afterward. See the [F0 implementation plan](./docs/superpowers/plans/2026-09-22-containerapps-f0-foundation.md)
and [technical design](./docs/superpowers/specs/2026-09-22-containerapps-learning-journeys-technical-design.md)
for the boundary between F0 and the next Lab.
