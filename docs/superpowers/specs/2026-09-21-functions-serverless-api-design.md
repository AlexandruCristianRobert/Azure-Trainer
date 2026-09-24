# Fifth Lab: Serverless API with Azure Functions

Continue catalog entry `functions-serverless-api`, connect Skill Area, functions service,
40 minutes. This Lab prepares hosting configuration for Contoso's API. It does not deploy
function code, create HTTP triggers, run a host, serve requests or check an endpoint.
Use CONTEXT.md language and existing Cloud Shell / read-only Blade conventions.

## Five Tasks

1. Resource group `rg-functions` in West Europe.
2. Storage account `stcontosofunctions`, same group and region, StorageV2, Standard_LRS.
3. Function App `func-contoso-api`, same group/region, linked to that storage account,
   Flex Consumption (Linux), Node.js 22, Functions 4.
4. Set custom application setting `API_MESSAGE=Hello from Contoso` on that app.
5. Set CORS allowed origins to exactly `https://app.contoso.com` (no wildcard/extra origins).

Each Task has two Hints, one Solution and an Exam Note. Checks inspect current Sandbox
state, with resource-group and linked-storage ancestry. No command-history grading.
Canonical Solutions:

```bash
az group create --name rg-functions --location westeurope
az storage account create --name stcontosofunctions --resource-group rg-functions --location westeurope --sku Standard_LRS --kind StorageV2
az functionapp create --name func-contoso-api --resource-group rg-functions --storage-account stcontosofunctions --flexconsumption-location westeurope --runtime node --runtime-version 22 --functions-version 4
az functionapp config appsettings set --name func-contoso-api --resource-group rg-functions --settings 'API_MESSAGE=Hello from Contoso'
az functionapp cors add --name func-contoso-api --resource-group rg-functions --allowed-origins https://app.contoso.com
```

## Stable schema

```js
storageAccounts: [{ name, resourceGroup, location, kind: 'StorageV2',
  sku: 'Standard_LRS', tags: null, createdAt }]
functionApps: [{ name, resourceGroup, location, storageAccount, storageResourceGroup,
  hostingPlan: 'FlexConsumption', os: 'Linux', runtime: 'node', runtimeVersion: '22',
  functionsVersion: '4', httpsOnly: true, appSettings: {},
  cors: { allowedOrigins: [], supportCredentials: false }, tags: null, createdAt }]
```

Resource names and groups match case insensitively; preserve canonical stored spelling.
Storage names are 3-24 lowercase letters/digits; Function App names are 2-60 ASCII
letters/digits/hyphens, not starting or ending with a hyphen. Both globally unique within
their resource type in the Sandbox. App setting names/values are case sensitive.
Missing collections in legacy saves normalize to []; present malformed nested records
are rejected before rendering. Validate supported constants, dates, maps, origin arrays,
unique resource identities and actual group/storage references for these new resources.

## Supported command surface

- `az storage account create/show/list/delete`: name/group/location, StorageV2 only,
  Standard_LRS or Standard_ZRS, tags. Location defaults to group. Create defaults to
  StorageV2/Standard_LRS. Delete accepts/requires `--yes` in the Sandbox.
- `az functionapp create/show/list/delete`: name/group/storage-account (name only),
  required `--flexconsumption-location`, `--runtime node`, `--runtime-version 22`,
  optional `--functions-version 4`, optional `--os-type Linux`, tags. Storage must be
  in the same group and region in this subset. No classic Consumption/Premium/plan IDs.
  Function App delete has no `--yes` flag (the real CLI does not require it).
- `az functionapp update` is outside this Lab's command surface. HTTPS-only is true.
- `az functionapp config appsettings set/list/delete`: name/group; set accepts one or
  more inline `--settings KEY=VALUE`; delete accepts one or more `--setting-names`.
  No files or slots. Nonempty key, ASCII letters/digits/dot/underscore; empty values
  and values containing '=' allowed. Merge updates, last duplicate key wins. Avoid
  object prototype setters. Reject missing '=' and file references. Custom settings
  only: `AzureWebJobs*`, `FUNCTIONS_*`, `WEBSITE_*`, `SCM_*` reserved in this subset;
  error explains runtime/storage configuration is managed by the Sandbox.
- `az functionapp cors add/remove/show`: name/group, `--allowed-origins/-a` as raw
  space-separated strings. Add requires >=1 origin; remove with empty argument list
  clears all. Merge and deduplicate adds; remove selected values. Accept `*` alone or
  HTTP(S) origins (scheme, host, optional port; no path/query/fragment/credentials).
  Normalize equivalent origins using URL.origin. Reject wildcard mixed with specific
  origins before mutation. No credentials command in this subset.

List commands accept optional group. All groups/commands support help. Unknown flags
and malformed inputs reject atomically with no events. Settings mutations emit only app
identity events, never setting values. CORS/appsettings preserve each other's state.
Creation repeated with matching immutable configuration preserves settings/CORS/timestamp;
conflicting region, storage, runtime or hosting configuration rejects. Tags may update.
Storage SKU may update through repeated create; changing its location rejects.
Storage deletion is blocked while referenced by a Function App (explicit Sandbox safeguard).
Group deletion cascades apps and storage. Other resources and previous Labs remain intact.

## Output and UI

ARM-style storage JSON: id, name, resourceGroup, location, type Microsoft.Storage/storageAccounts,
kind, sku {name,tier:'Standard'}, tags, provisioningState. App output: id/name/resourceGroup,
location, type Microsoft.Web/sites, kind functionapp,linux, reserved true, httpsOnly,
defaultHostName, functionAppConfig.runtime {name:'node',version:'22'}, tags, state Running.
Running describes the simulated resource state, not deployed function execution. Do not
invent connection strings, credentials, functions or deployment results. Implicit hosting-plan
Application Insights and deployment-container resources are not separately modeled. Hostname uses simplified
`<name>.azurewebsites.net`; display as text, not a working external link.
Appsettings list returns [{name,value,slotSetting:false}]; set/delete return the same
metadata with value:null. CORS output is {allowedOrigins,supportCredentials:false}.

Events: `{type,resourceType:'storageAccount'|'functionApp',name,resourceGroup}`.
Blades: `{kind:'storage-account'|'function-app',resourceGroup,name}`. Created/updated
events focus that Blade; deleting focused resource returns to group, missing group to list.
Storage Overview shows configuration and linked Function Apps. Function App Overview shows
hosting/runtime/storage, custom application settings and CORS. Settings values hidden in
the Blade; show names and 'Configured' only, use CLI list to inspect demo values.
No live endpoint links. Reuse Azure functions and existing all-resources icons (storage
has no dedicated local icon); no new dependencies or icon downloads. Long IDs/names wrap.

## Verification and delivery

Current session instruction: do not add or run tests. Update the existing catalog expectation
only. Static independent spec/quality review, production build and whitespace checks;
optional visual initial-page inspection. Do not claim functional command flow verification.
Continue in the current checkout; preserve previous uncommitted work and avoid git metadata
mutations. User already requested autonomous continuation and Sol/Terra delegation.

## Microsoft references (checked 2026-09-21)

- [Flex Consumption creation](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-how-to)
- [Function App CLI](https://learn.microsoft.com/en-us/cli/azure/functionapp?view=azure-cli-latest)
- [Storage account CLI](https://learn.microsoft.com/en-us/cli/azure/storage/account?view=azure-cli-latest)
- [Application settings CLI](https://learn.microsoft.com/en-us/cli/azure/functionapp/config/appsettings?view=azure-cli-latest)
- [CORS CLI](https://learn.microsoft.com/en-us/cli/azure/functionapp/cors?view=azure-cli-latest)

Flex Consumption and Node 22 follow the current official creation example. Regional/runtime
availability in a real subscription must be checked there; this Lab provides fixed local support.
