# Second Lab: Deploy a Container App with KEDA scaling

Extend the existing Lab catalog entry `containerapps-keda` into a playable Lab, using the
existing Cloud Shell, Task checks, persistence, Lab Results and read-only Portal Blades.
The user's request to implement the second Lab authorizes this extension of the original
one-Lab demo. Existing vocabulary, CSS, icons and Service Bus behavior remain applicable.

## Learner flow

Contoso needs a containerized HTTP API that can scale down during quiet periods and scale
out with incoming requests. Five Tasks, each with two Hints, a Solution and an Exam Note:

1. Create `rg-containerapps` in `westeurope`.
2. Create Container Apps environment `env-contoso` in that group and location.
3. Deploy `ca-contoso-api` in that environment with image
   `mcr.microsoft.com/k8se/quickstart:latest`, external ingress and target port 80.
4. Set that app's minimum replicas to 0 and maximum replicas to 5.
5. Add HTTP scale rule `http-requests` with concurrent requests threshold 50.

Task checks inspect the full resource ancestry and required properties, independently of
command history. Later Tasks cannot pass against an unrelated app. Deployment uses default
replica limits 0/10, so the fourth Task requires an explicit change. No live load generation,
replica metrics, image pull, network endpoint or Azure provisioning is implied.

## Engine contract

Add `containerAppEnvironments: []` and `containerApps: []` to Sandbox. Old saved Service Bus
runs without these fields remain loadable; normalize missing fields to empty arrays on load.
Reject malformed present arrays. Resource group deletion cascades into both collections.

```js
environment = { name, resourceGroup, location, tags, createdAt }
app = {
  name, resourceGroup, location, environment, environmentResourceGroup,
  image, ingress: null /* or 'external'|'internal' */, targetPort: null,
  minReplicas: 0, maxReplicas: 10,
  scaleRules: [], // { name, http: { metadata: { concurrentRequests: '50' } } }
  tags, createdAt,
}
```

Implement `az containerapp env create/show/list/delete` and
`az containerapp create/update/show/list/delete`. Every group/command supports `--help`.
Reuse existing argument parsing, group/location defaults, JSON formatting, AzError and
latencies. Environment names or full environment resource IDs resolve to existing resources.
Support the fields needed by the Lab, image updates, HTTP rule upsert by name, min/max replicas,
tags, and `--yes` for deletes. The update command need not support ingress changes; learners
can correct ingress by deleting and recreating the app. Do not advertise unimplemented flags.

Validate resource names, parents, locations, target port 1–65535, min replicas 0–1000,
max replicas 1–1000, min <= max and positive integer HTTP concurrency. Only HTTP rules are
supported; clearly report unsupported types. Partial updates preserve existing values and
rules; failed operations leave input state untouched. Reject deletion of an environment
while it hosts apps, including apps in other resource groups. Group deletion must not orphan
apps in another group: reject deleting a group hosting such an environment until those apps
are removed.

Return ARM-shaped environment/app JSON, with app `properties.configuration.ingress` and
`properties.template.scale`. Synthetic domains use `.azurecontainerapps.io` for display only.
Emit `{ type, resourceType: 'containerAppEnvironment'|'containerApp', name, resourceGroup }`.

## Portal and navigation

Add read-only environment and app Blades using existing components and CSS. Environment
Overview shows its apps; app Overview shows image, ingress, target port, environment,
replica bounds and HTTP rule table. Resource group rows include all resource types and
navigate to their correct Blade. Event focus and notifications understand both new types;
deletions fall back to the resource group, and missing resources resolve safely after reload.
Blade kinds: `containerapp-environment` and `containerapp`, each with resourceGroup/name.

Enable the catalog card and Next Lab link from the Service Bus completion screen. Next Lab
follows catalog order; the third Lab remains Coming soon after Container Apps. Resume,
restart and completion continue using isolated per-Lab saves.

## Acceptance

Solutions complete all five Tasks through the real simulated command pipeline. Tests cover
command errors/atomicity, defaults, updates, deletion, Task checks, old-save migration,
completion/resume/restart/isolation, Blade navigation, and both available Labs. Run the full
Vitest suite and production build; inspect the new flow in the browser if available.

## Official references checked on 2026-09-21

- https://learn.microsoft.com/en-us/cli/azure/containerapp?view=azure-cli-latest
- https://learn.microsoft.com/en-us/cli/azure/containerapp/env?view=azure-cli-latest
- https://learn.microsoft.com/en-us/azure/container-apps/scale-app
- https://learn.microsoft.com/en-us/rest/api/resource-manager/containerapps/managed-environments/get?view=rest-resource-manager-containerapps-2026-01-01

Supported HTTP rule syntax is `--scale-rule-name http-requests --scale-rule-type http
--scale-rule-http-concurrency 50`. Default replica limits are 0/10. This Lab practices
configuration; the Sandbox does not simulate running containers or autoscaler activity.
Environment names follow the documented ARM character pattern; Container App names use
the separate lowercase app naming rules.
