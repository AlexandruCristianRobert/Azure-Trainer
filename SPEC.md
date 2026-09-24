# Azure-Trainer — Implementation Spec (demo)

A public, single-user static Vue app for hands-on preparation for exam **AI-200**. Glossary terms
(Portal, Blade, Cloud Shell, Sandbox, Skill Area, Lab, Task, Hint, Solution, Exam Note, Lab Panel,
Lab Result) are defined in [CONTEXT.md](./CONTEXT.md) and used exactly. Architecture decision:
[ADR-0001](./docs/adr/0001-simulated-az-cli-over-in-browser-sandbox.md). Visual source of truth:
[docs/design/Azure-Trainer Screens.dc.html](./docs/design/Azure-Trainer%20Screens.dc.html) (three
1440×900 artboards: Home, Lab running, Lab complete). Design brief: [docs/design-prompt.md](./docs/design-prompt.md).

## Container Apps deployment journey

The six original Labs retain their command-only checks and localStorage progress. Home offers sixteen implemented `containerapps-end-to-end` Labs in this worktree. Deployment Guided has nine Tasks in Prepare, Publish, and Deploy and verify. Troubleshooting starts with a supplied valid .NET 10 project, a published image, and a deterministic failed deployment. Its two outcome Tasks require restoring the current app and verifying its `GET /api/info` response. Independent starts from the reusable .NET 10 starter and an empty Sandbox. Its six requirement outcomes specify a different service, port, image and runtime environment without prescribing operation order. CPU Guided starts with a healthy private API and requires a CPU rule followed by measured baseline, sustained, overload and quiet workloads. CPU Troubleshooting starts 30 seconds into a sustained throughput incident and requires a policy repair, a fresh full-service run under the same demand, and quiet scale-in. CPU Independent starts with a healthy API and lets learners choose supported resources and a CPU target to serve all 30 steady and 60 burst illustrative requests per second over each final 15-second window, then prove quiet scale-in. Its one-second simulated clock advances only through explicit controls; capacity and throughput are teaching approximations. Probes Guided starts with incomplete health endpoints and no probes; learners save source, build an image, deploy explicit HTTP probes for two replicas, then verify startup gating, readiness routing and liveness restart through complete named traces. These journey Labs use versioned native run persistence, simulated ACR builds and captured Container App deployments. Revealing Hints and worked Solutions records assistance but does not perform actions. A completed run is read-only; Restart creates a fresh run while preserving historical Results. The extension follows [ADR-0002](./docs/adr/0002-behavioral-labs-with-bounded-local-simulation.md). Probe Troubleshooting starts in a measured startup restart loop; its three Tasks require a repaired startup allowance, a process-only liveness endpoint verified during an optional dependency outage, and real hang recovery. Probe Independent starts with a 30-second two-replica API, failing health routes and no probes. Learners choose supported endpoint logic and explicit HTTP timing policies; three complete measured experiments prove cold startup, readiness removal and recovery, and restart of a real hang in any order. The three Foundry Labs include an independent brief API with a separate inference identity, account-scoped grant and four bounded request proofs. Guided Bicep now covers local modules, saved parameters, target-bound deployment provenance, Foundry request evidence, measured replica-ceiling update, and unchanged reapply. The deployment panel shows saved files, located diagnostics, and current and historical previews. Bicep Troubleshooting supplies a missing module output, a wrong environment parameter, and a valid but miswired Foundry grant; learners repair the authored graph and prove a recovered request. Bicep Independent uses one shared project and two saved parameter files drive isolated primary and staging deployments. Learners prove staging request and CPU behavior, reapply the current primary graph with no changes, then collect fresh primary proof. The read-only deployment review switches between target-specific parameters, previews and outputs. The Capstone is implemented. It starts with an empty Sandbox and one editable combined API project. Seven ordered stages cover saved source, bootstrap Bicep and image publication, main Bicep activation, healthy Foundry/probe/CPU evidence, a one-shot simulated live Foundry deployment drift, source-based repair, fresh recovery and no-change reapply, and ownership-checked cleanup. Stage seals preserve historical proofs; a recovery checkpoint gates deletion and is invalidated by changed operating dependencies. The Lab Panel shows sealed/active/locked stages, source versus published artifact versus active deployment, incident diagnostics, owned groups and checkpoint state. The deployment review separates bootstrap and main provenance and outputs. The completed Result is read-only. All resource operations are through the local simulated Cloud Shell; no live Azure deployment or model call occurs.

## Goals of the demo

- Six playable Labs ("Order-processing backend on Service Bus", "Deploy a Container App with KEDA scaling", "Cosmos DB container with vector search", "Store and rotate secrets in Key Vault", "Serverless API with Azure Functions", and "Event Grid custom topic with filtered subscription", 5 Tasks each).
- The Cloud Shell is the only way to change the Sandbox. Blades are read-only mirrors.
- Tasks tick live after every command; Hints, Solution and Exam Notes per Task.
- A Lab resumes after reload; completing it writes a Lab Result; Home shows progress per Skill Area.
- Look: the design file, pixel-close, with **official icons**: Microsoft's Azure service icons
  (`src/assets/icons/azure/*.svg`, from the Azure Architecture Icons v24 set) and Fluent UI System
  Icons (`src/assets/icons/fluent/*.svg`) for header, command-bar and shell controls.

## Non-goals (demo)

No real Azure, no AI, no accounts, no portal-click
mutation, no tab completion, no `-o table`, no `--query`, no PowerShell, no mobile layout, no dark theme.

## Stack & conventions (mirrors Net-Trainer)

- Vue 3 + Vite 6 + Pinia 2 + vue-router 4. JS only, `<script setup>`, 2-space indent.
- Router: `createWebHashHistory` in production, `createWebHistory` in dev. Vite `base: '/'`, dev port 5175.
- Styling: plain CSS tokens, global stylesheets imported in order `tokens.css → components.css → pages.css`
  from `src/styles/index.css`. No scoped styles, no Tailwind.
- Fonts (Google Fonts): Public Sans 400/500/600/700, JetBrains Mono 400/500/700.
- Tests: vitest, node environment, fake `localStorage` where needed. No component-DOM tests.
- Persistence: localStorage, key prefix `at_`.
- Desktop-only: designed at 1440×900, must work at 1280 wide. The app shell fills the viewport
  (`height: 100vh`, no page scroll); Blade content and Lab Panel scroll internally.
- Icons are inlined SVG. Fluent SVGs get `fill="#212121"` replaced by `currentColor` at load;
  Azure SVGs keep their colours.

## Routes

| Route | Page | Purpose |
|---|---|---|
| `/` | HomePage | Design screen 1: services row, Skill Area cards, Lab cards |
| `/lab/:labId` | LabPage | Design screens 2 and 3: Blade + Cloud Shell + Lab Panel |
| anything else | redirect `/` | |

## Sandbox model (`src/lib/sandbox/`)

```js
sandbox = {
  resourceGroups: [{ name, location /* 'westeurope' */, tags: null|{}, createdAt }],
  eventGridTopics: [{ name, resourceGroup, location, inputSchema: 'EventGridSchema', tags, createdAt,
                     eventSubscriptions: [{ name, endpointType: 'WebHook', endpoint, createdAt,
                       filter: { includedEventTypes: [], subjectBeginsWith: '', subjectEndsWith: '',
                                 isSubjectCaseSensitive: false } }] }],
  storageAccounts: [{ name, resourceGroup, location, kind: 'StorageV2', sku: 'Standard_LRS', tags, createdAt }],
  functionApps: [{ name, resourceGroup, location, storageAccount, storageResourceGroup,
                  hostingPlan: 'FlexConsumption', os: 'Linux', runtime: 'node', runtimeVersion: '22',
                  functionsVersion: '4', httpsOnly: true, appSettings: {},
                  cors: { allowedOrigins: [], supportCredentials: false }, tags, createdAt }],
  keyVaults: [{ name, resourceGroup, location, sku: 'standard', enableRbacAuthorization: true,
               enablePurgeProtection: false, softDeleteRetentionInDays: 90, tags, createdAt,
               roleAssignments: [{ id, principalId, principalType: 'User', roleName, roleDefinitionId, scope }],
               secrets: [{ name, versions: [{ version, value, enabled, contentType, tags, createdAt, updatedAt }] }] }],
  cosmosAccounts: [{ name, resourceGroup, location, kind: 'GlobalDocumentDB',
                    defaultConsistencyLevel: 'Session', capabilities: [], tags, createdAt,
                    databases: [{ name, createdAt, containers: [{ name, partitionKeyPath,
                      throughput: 400, vectorEmbeddingPolicy, indexingPolicy, createdAt }] }] }],
  containerAppEnvironments: [{ name, resourceGroup, location, tags, createdAt }],
  containerApps: [{ name, resourceGroup, location, environment, environmentResourceGroup,
                    image, ingress: null|'external'|'internal', targetPort: null|number,
                    minReplicas: 0, maxReplicas: 10, scaleRules: [], tags, createdAt }],
  namespaces: [{ name, resourceGroup, location, sku: 'Basic'|'Standard'|'Premium', tags, createdAt,
                 queues: [queue], topics: [topic] }],
  defaults: { group: null, location: null },       // az configure --defaults
}
queue        = { name, maxDeliveryCount: 10, deadLetteringOnMessageExpiration: false,
                 defaultMessageTimeToLive: 'P10675199DT2H48M5.4775807S', lockDuration: 'PT1M',
                 maxSizeInMegabytes: 1024, requiresSession: false, requiresDuplicateDetection: false,
                 duplicateDetectionHistoryTimeWindow: 'PT10M', enablePartitioning: false,
                 enableBatchedOperations: true, status: 'Active', createdAt }
topic        = { name, maxSizeInMegabytes: 1024, defaultMessageTimeToLive, requiresDuplicateDetection: false,
                 duplicateDetectionHistoryTimeWindow: 'PT10M', enablePartitioning: false,
                 enableBatchedOperations: true, supportOrdering: true, status: 'Active', createdAt,
                 subscriptions: [subscription] }
subscription = { name, maxDeliveryCount: 10, lockDuration: 'PT1M', deadLetteringOnMessageExpiration: false,
                 deadLetteringOnFilterEvaluationExceptions: true, defaultMessageTimeToLive,
                 requiresSession: false, enableBatchedOperations: true, status: 'Active', createdAt,
                 rules: [rule] }                    // a new subscription always gets rule '$Default' (SqlFilter '1=1')
rule         = { name, filterType: 'SqlFilter'|'CorrelationFilter', sqlExpression: string|null,
                 correlationFilter: null|{ correlationId, label } , createdAt }
```

Constants: subscription id `7f3c9a2e-4b81-4d6a-9c05-2e8f5b1d4a37`, subscription name `Sandbox`.
The synthetic learner's `USER_OBJECT_ID` is `a37a00c7-d689-4b5d-a8c8-1d75f307d5ef`, used for
vault-scoped role assignments; it represents no real Entra user.
Operations are pure: `op(sandbox, params) → { sandbox: next, resource }` on a deep clone, or throw
`AzError(code, message, { kind: 'arm' | 'cli' })`. Locations accept `westeurope`, `WestEurope` and
`"West Europe"` and are stored as the lowercase code.

## Cloud Shell command surface (`src/lib/az/`)

Input line → `tokenize` (bash quoting: `'…'`, `"…"`, `\`, `$IDENT` expands to empty outside single
quotes) → command resolution → `--help` → argument parsing (argparse semantics: `--flag value`,
`--flag=value`, aliases, `true|false` for booleans, ints validated) → execute against the Sandbox →
JSON output with **alphabetically sorted keys, 2-space indent** (az default) or nothing for deletes.

Supported (`--help` on every group and command):

| Command | Notes |
|---|---|
| `az` | banner + base command list |
| `az --version`, `az version` | fake azure-cli 2.78.0 |
| `az login` | prints the Sandbox account list |
| `az account show` / `list` | Sandbox subscription JSON |
| `az configure --defaults group=<rg> location=<loc>` / `--list-defaults` | sets/prints Sandbox defaults |
| `az group create/show/list/delete/exists` | `create` needs `--name/-n` (alias `--resource-group/-g`) and `--location/-l`; `delete` needs `--yes/-y` |
| `az servicebus namespace create/show/list/update/delete/exists` | `--sku {Basic,Standard,Premium}` default Standard; `--location` defaults to the group's |
| `az servicebus queue create/show/list/update/delete` | `--max-delivery-count`, `--enable-dead-lettering-on-message-expiration {false,true}`, `--default-message-time-to-live`, `--lock-duration`, `--max-size`, `--enable-session`, `--enable-partitioning`, `--enable-duplicate-detection`, `--status` |
| `az servicebus topic create/show/list/delete` | Basic tier → `(BadRequest) SubCode=40000. Cannot operate on type Topic because the namespace '<ns>' is using 'Basic' tier.` |
| `az servicebus topic subscription create/show/list/delete` | creates `$Default` rule |
| `az servicebus topic subscription rule create/show/list/delete` | `--filter-sql-expression`, `--filter-type {SqlFilter,CorrelationFilter}`, `--correlation-id`, `--label` |
| `az containerapp env create/show/list/delete` | Environment name, resource group and location; deletion requires `--yes` and an empty environment |
| `az containerapp create/update/show/list/delete` | Environment name or ID, image, external/internal ingress and target port on create; replica limits and named HTTP scale rules on create/update; deletion requires `--yes` |
| `az cosmosdb create/update/show/list/delete` | Single-region NoSQL account, vector-search capability, consistency and tags; deletion requires `--yes` |
| `az cosmosdb sql database create/show/list/delete` | Account and group; databases use dedicated container throughput in this Lab |
| `az cosmosdb sql container create/show/list/delete` | Account, database, partition key, dedicated RU/s, inline JSON `--vector-embeddings` and `--idx`; no file references or container update |
| `az keyvault create/show/list/update` | RBAC vaults; Standard/Premium on create, purge protection, 7–90 day retention; update supports RBAC/purge flags |
| `az role assignment create/list/delete` | Known Sandbox learner, exact vault scope, Secrets Officer/User roles; no general Entra directory or inherited roles |
| `az keyvault secret set/show/list/list-versions/set-attributes` | Inline demo values, unique versions, permissions and enabled status; lists/metadata updates omit values |
| `az storage account create/show/list/delete` | StorageV2, Standard_LRS/Standard_ZRS, tags; deletion requires `--yes` and no linked Function Apps |
| `az functionapp create/show/list/delete` | Linux Flex Consumption, Node 22, Functions 4, same-group/region host storage; delete has no confirmation flag |
| `az eventgrid topic create/show/list/delete` | Custom topics using EventGridSchema; location and tags; Sandbox delete requires `--yes` |
| `az eventgrid topic event-subscription create/update/show/list/delete` | HTTPS WebHook destination, event-type list, literal subject prefix/suffix; case sensitivity on create; Sandbox delete requires `--yes` |
| `az functionapp config appsettings set/list/delete` | Inline custom KEY=VALUE settings; mutation output redacts values, list returns demo values; no files/slots/Azure-managed keys |
| `az functionapp cors add/remove/show` | HTTP(S) origins or sole wildcard; empty remove argument list clears all; no request execution |
| `clear` | clears the scrollback (shell level) |
| anything else | `bash: <word>: command not found` |

Global arguments shown in `--help` are recognised centrally: `--verbose`, `--debug`, `--only-show-errors`
and `-o json` are accepted no-ops; `-o <other>`, `--query` and an unknown `--subscription` return
Sandbox-specific errors.

`--resource-group` falls back to `sandbox.defaults.group` when omitted. Error wording follows az:

```
ERROR: the following arguments are required: --namespace-name
ERROR: unrecognized arguments: --foo bar
ERROR: argument --max-delivery-count: invalid int value: 'five'
ERROR: 'quene' is misspelled or not recognized by the system.
The most similar choice to 'quene' is:
        queue
ERROR: (ResourceGroupNotFound) Resource group 'rg-x' could not be found.
Code: ResourceGroupNotFound
Message: Resource group 'rg-x' could not be found.
```

Each command declares `latencyMs` (namespace create 2500, group create 800, other mutations 900,
reads 250); the shell shows az's spinner line (`- Running ..`, cycling `- \ | /`) for that long.
Mutations return `events` (`{ type: 'created'|'updated'|'deleted', resourceType, name, resourceGroup,
namespace, topic, subscription, account, database, vault, version }`) that drive notifications
and Blade focus. Parent/version fields are supplied only for their relevant resource types.
Key Vault events use these shapes (no secret values):

```js
{ type, resourceType: 'keyVault', name, resourceGroup }
{ type, resourceType: 'keyVaultRoleAssignment', name: roleName, resourceGroup, vault }
{ type, resourceType: 'keyVaultSecret', name, resourceGroup, vault, version }
```

Storage and Functions mutations emit `{ type, resourceType: 'storageAccount'|'functionApp',
name, resourceGroup }`. Application settings and CORS updates emit Function App identity only,
without setting values or configuration payloads. Both new resource types use existing
created/updated/deleted notification and focus conventions.

Event Grid emits `eventGridTopic` identity (`name, resourceGroup`) or
`eventGridSubscription` identity (`name, resourceGroup, topic`) for created/updated/deleted
events. Endpoint URLs and filter payloads are omitted from notifications.

## Labs (`src/data/`)

`skillAreas.js`: the four official AI-200 areas with weights (`containers` 20–25%, `data` 25–30%,
`connect` 20–25%, `secure` 20–25%). `services.js`: service key → label + Azure icon name.
`labs/index.js`: catalog; six `available` Labs (Service Bus → connect; Container Apps with
KEDA → containers; Cosmos DB vector search → data; Key Vault secrets → secure; Functions
serverless API → connect; Event Grid filtered subscription → connect).

Lab shape: `{ id, title, skillAreaId, service, minutes, status, brief, seed(sandbox) → sandbox,
tasks: [{ id, text (backticks → code), check(sandbox) → boolean, hints: [h1, h2], solution (one
command per line), examNote }] }`. The demo Lab's Tasks, Hints, Solutions and Exam Notes are in the
design brief and are copied verbatim into `labs/servicebus-order-backend.lab.js`. Task 5 passes only
when the subscription has exactly one rule, a SqlFilter whose expression equals `region = 'EU'`
ignoring whitespace.

The second Lab is in `labs/containerapps-keda.lab.js`: create `rg-containerapps`, create
`env-contoso`, deploy `ca-contoso-api` with external ingress on port 80, set replica bounds 0–5,
then set HTTP rule `http-requests` with concurrent requests threshold 50. Each Task has two
Hints, a Solution and an Exam Note. See the [second Lab design](./docs/superpowers/specs/2026-09-21-containerapps-keda-design.md)
for the supported command scope, flat resource fields, validation and official references.
Old Sandbox saves without Container Apps arrays are normalized during load.

The third Lab is in `labs/cosmos-vector-search.lab.js`: create `rg-cosmos`, create NoSQL account
`cosmos-contoso-catalog`, enable `EnableNoSQLVectorSearch`, create database `catalog`, then
create `products` with partition key `/category`, dedicated 400 RU/s and a `/embedding` vector
policy (float32, 1536 dimensions, cosine) plus a matching diskANN index. Ordinary indexing
excludes `/embedding/*`. Database/container IDs and JSON paths are case sensitive.
The [third Lab design](./docs/superpowers/specs/2026-09-21-cosmos-vector-search-design.md)
defines validation and command scope. No documents or queries are simulated. Old saves without
`cosmosAccounts` normalize to an empty collection, preserving their existing resources.

The fourth Lab is in `labs/keyvault-secrets.lab.js`: create `rg-secrets`, create Standard vault
`kv-contoso-secrets` with RBAC and purge protection, assign Key Vault Secrets Officer to the
Sandbox learner at the vault scope, then store `contoso-api-key` and rotate it from
`demo-contoso-key-v1` to `demo-contoso-key-v2`. Both versions use `text/plain`; the latest must
remain enabled. Task 4 checks the retained original version, so it remains complete after rotation.
The [fourth Lab design](./docs/superpowers/specs/2026-09-21-keyvault-secrets-design.md) defines
the synthetic principal, role checks, supported commands and version shape. Old saves missing
`keyVaults` normalize to an empty array; invalid nested vault/role/secret/version shapes reject
the saved run. This Lab models manual rotation only; soft-delete lifecycle and automatic
rotation are outside scope. Group deletion/Restart Lab clears simulated vault data.

The fifth Lab is in `labs/functions-serverless-api.lab.js`: create `rg-functions`, then
StorageV2/Standard_LRS account `stcontosofunctions`, then Linux Flex Consumption Function App
`func-contoso-api` with Node 22 and Functions 4. Resources use West Europe; the app references
that storage account in the same group. Set `API_MESSAGE=Hello from Contoso` and allow only
`https://app.contoso.com` through CORS. State checks require full group/storage ancestry;
the final Task excludes wildcard and extra origins. No function code is deployed or executed.
The [fifth Lab design](./docs/superpowers/specs/2026-09-21-functions-serverless-api-design.md)
defines the command subset, fixed runtime, output redaction, naming and lifecycle rules.
Old saves missing `storageAccounts` or `functionApps` receive empty collections. New records
require valid nested shape and group/storage references. Storage deletion while referenced
is blocked by the Sandbox; group deletion cascades both types. App recreation preserves
custom settings and CORS when immutable hosting parameters match. No connection strings,
implicit hosting-plan/monitoring resources or deployment containers are modeled.

The sixth Lab is in `labs/eventgrid-filtered-subscription.lab.js`: create `rg-events` and
custom topic `evgt-contoso-orders` in West Europe with EventGridSchema. Create subscription
`eu-order-handler` using WebHook destination `https://events.contoso.com/api/orders`, include
only `Contoso.Order.Created`, and require subjects beginning `/orders/eu/` and ending `.json`
with case-insensitive comparison. All checks require the specified group/topic ancestry.
The [sixth Lab design](./docs/superpowers/specs/2026-09-22-eventgrid-filtered-subscription-design.md)
defines the configuration-only subset and Microsoft references. No webhook validation,
publishing, delivery, retry or filter execution is simulated. Webhook URLs require HTTPS
and exclude credentials, query strings and fragments. Advanced filters and other destination
types are outside scope. Updates preserve omitted fields; empty event-type lists or `All`
remove the type restriction, and empty prefix/suffix strings clear those filters.
Old saves missing `eventGridTopics` normalize to an empty collection; nested records require
valid shape and ancestry. Topic and group deletion cascade to subscriptions. The sixth Lab
has no Next Lab action; Back to Home and Restart Lab remain available.

## State & persistence

- `useLabRunStore` (one active Lab run at a time): `{ labId, sandbox, scrollback: [{ text, kind:
  'cmd'|'out'|'err' }], history: [], hintsRevealed: { [taskId]: n }, solutionsRevealed: { [taskId]: true },
  elapsedMs, lastTickAt, completedAt, resultId }`, persisted at `at_run_<labId>` after every change.
  `lastTickAt` is runtime-only (the wall-clock anchor `tick()` diffs against) and is deliberately not
  written to `at_run_<labId>`; a reload resumes with `elapsedMs` intact and `lastTickAt` reset to null.
  `execute(line)` is async (spinner latency), re-evaluates Tasks, emits Portal notifications, and on
  the transition to all-done writes a Lab Result and fires the completion notification + toast.
  `restart()` reseeds the Sandbox and clears everything but keeps past Lab Results.
  Runtime-only `generation` invalidates commands awaiting latency when a Lab loads or restarts,
  preventing an old command from overwriting another Lab's Sandbox.
- `useProgressStore`: `at_results: [{ id, labId, tasksDone, total, hintsUsed, solutionsUsed,
  durationMs, finishedAt }]`; Lab status = `in-progress` if a run exists without `completedAt`,
  else `completed` if any result, else `not-started`; Skill Area counts derive from that.
- `usePortalStore` (not persisted): notifications + unread count + pane open; toast; shell
  `{ visible, minimized, maximized }`; Lab Panel collapsed; current Blade
  `{ kind: 'resource-groups' } | { kind: 'resource-group', name } | { kind: 'servicebus-namespace',
  resourceGroup, name, tab: 'queues'|'topics' }`. Blade focus follows events: created group → its Blade;
  created namespace/queue → namespace Overview (Queues tab); topic/subscription/rule → Topics tab;
  deleting the focused resource → parent Blade. Breadcrumb and resource-menu clicks navigate Blades
  (read-only navigation).
  Container Apps resources use `{ kind: 'containerapp-environment'|'containerapp', resourceGroup,
  name }` Blades; environment Overview lists apps, and app Overview shows deployment and HTTP
  scaling configuration. Resource group lists and notifications support both new types.
  Cosmos DB uses `cosmos-account`, `cosmos-database` and `cosmos-container` Blades with
  resource-group and parent account/database identities. Account Overview lists databases;
  database Overview lists containers; container Overview shows partition key, dedicated
  throughput, vector embeddings and indexing policy. Deleting an ancestor returns focus to
  the nearest surviving parent. Database/container IDs and policy paths are case sensitive.
  Key Vault uses `key-vault {resourceGroup,name}` and `key-vault-secret {resourceGroup,vault,name}`
  Blades. Vault Overview lists role assignments and secret metadata; Secret Overview lists
  versions newest first. Both hide secret data when the learner lacks access. No Blade or
  notification displays secret values. All vault/secret names are case insensitive.
  Storage/Functions use `storage-account {resourceGroup,name}` and `function-app {resourceGroup,name}`
  Blades. Storage Overview lists linked apps; Function App Overview shows hosting/runtime,
  linked storage, custom setting names (values hidden) and allowed CORS origins. Hostnames
  are illustrative text, not active endpoints. Both Blades resolve deletion to the surviving
  group, then the resource-group list. Created/updated settings and CORS focus the app.
  Event Grid uses `eventgrid-topic {resourceGroup,name}` and
  `eventgrid-subscription {resourceGroup,topic,name}`. The topic lists subscriptions;
  the subscription shows the destination and filter configuration with explicit unrestricted
  defaults. Endpoint URLs are text only. Deletion/stale navigation falls back to the nearest
  surviving topic, group or resource-group list.

## Screens (from the design)

- **Home**: 48px header (hamburger, Azure logo + "Azure-Trainer", 560px search, Cloud Shell / bell /
  settings / help / feedback icons, account chip "Sam Learner / Sandbox directory / SL"); content
  padding 22px 40px; "Azure services" row of 96px tiles; "Labs by Skill Area" 4-up cards with
  progress ring; "Labs" 3-up cards (available: status pill + "n of m tasks" + progress bar + button;
  coming soon: 55% opacity + "Coming soon" pill).
- **Lab running**: header; main column = Blade (240px resource menu + content) over a 280px Cloud
  Shell dock (34px header strip with drag handle, Bash ▾, control glyphs; terminal `#0D1117`, 12px
  JetBrains Mono, prompt `user@sandbox:~$` in green/blue); 360px Lab Panel on the right (title, chips,
  "n of m tasks" + elapsed, progress bar, collapsible BRIEF, Task rows: done/current/pending, Hint
  box, "Show hint 2" / "Show solution", "Restart Lab" footer).
- **Lab complete**: same layout; Lab Panel header turns green with "Lab complete", "5 of 5 tasks",
  duration, Lab Result line, EXAM NOTES recap 1–5, buttons "Back to Home", "Restart Lab",
  "Next Lab" follows catalog order and is linked when available, otherwise disabled with
  "Coming soon"; toast "Lab completed" top-right of the main area; bell badge 2 in the design example.

Colours, sizes and copy are taken from the design file verbatim; tokens are listed in the plan.

## Verification

- `npm test` green (tokenizer, args, format, help, sandbox ops, every az command's happy path and
  main errors, Lab checks via solutions, stores with fake localStorage and fake timers).
- `npm run dev`, then in the browser at 1440×900: Home → Start Lab → type the five solutions (with
  one deliberate mistake to see an az error and a Hint) → Tasks tick, Blades update, notifications
  appear → completion toast + Lab Result → reload resumes → Restart Lab resets → Back to Home shows
  Completed. Screenshots compared with the three artboards.
