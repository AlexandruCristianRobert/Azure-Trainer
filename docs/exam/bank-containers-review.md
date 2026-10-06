# Containers bank author review — 2026-10-06

27 original items, revision 1, IDs ai200-c001 through ai200-c027. No imported
exam questions, stem-variant generator, runtime AI, executable artifact or cloud
execution. Every candidate has an authored reason in the closed explanation
DTO, including each candidate/component pair for multipart items. Source review
is a document inspection, not a claim that deployments were executed.

Author outcome for every row: **checked against primary sources**. Independent
reviewer `/root/exam_bank_containers_review` (6.1-sol/high) inspected the actual
`d9c8b01..06c4c6d` change on 2026-10-06: all 27 keys, distractor relationships
and 23 primary reference paths were **factually approved**. The reviewer found
one Important family-equivalence issue in c010/c025. Their family correction is
implemented below and awaits that same reviewer's fix rereview; the overall
Task5 independent gate remains open. Structural tests are not factual approval.

## Exact interfaces

`src/data/exam/bank/containers.js` exports `CONTAINERS_QUESTIONS` (Question[27]),
`CONTAINERS_GROUPS` (Group[1]), and `CONTAINERS_REFERENCES` (Reference[23]).
The item constructor only expands authored metadata into Task1's exact closed
DTO. It does not generate stems, answer keys or candidate reasons. All items
have revision 1, domain containers, csharp null, authored text/code artifacts or
[], and the canonical objective reference plus applicable supplemental references.
familyId equals the item ID except c025, which shares `ai200-c010` with c010
(26 distinct families). All explanations use the structured closed
`{components:[{componentId,text,candidates:[{candidateId,text}]}]}` form.

`src/lib/exam/bankValidation.js` exports exactly:

```js
validateDomainContent({ questions, groups, references }, domain) // -> true
```

It throws `ExamError` for invalid input and never normalizes or mutates input.
It uses Task1 `finiteJson`, `validateQuestion`, `validateReference`, and bounded
closed-record helpers, then checks exact domain count, ID/order/kind allocation,
revision 1, unique question/reference/group IDs, current objective membership,
component concept/objective relation, all seven objective coverage, all current
domain concept references, question reference resolution, exact three-member
group allocation/order and reciprocal membership. It has literal allocations
for all four domains and all eight fixed groups, without importing future bank
modules. Series additionally require single-choice yes/no candidate IDs.
It validates structure and declared source shape; it does not certify source
claims or treat absent future domains as published.

## Source catalog inspected

All entries below were actually opened on **2026-10-06**. R numbers in the item
ledger refer to these exact primary paths, not to search snippets or fixtures.
Sections identify the specific evidence inspected. The published reference IDs
are shown to make concept and question reference resolution reviewable.

| Evidence | Reference ID | Exact primary page / inspected section |
| --- | --- | --- |
| R1 | ref-containers.registry-images | [ACR tags/versioning](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-image-tag-version) — Stable tags; Unique tags |
| R2 | ref-containers.registry-tasks | [ACR Tasks overview](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tasks-overview) — Quick tasks; source commit/base-image triggers; output |
| R3 | ref-containers.appservice-container | [Custom container configuration](https://learn.microsoft.com/en-us/azure/app-service/configure-custom-container) — managed identity pulls; Configure port number; environment variables; diagnostic logs |
| R4 | ref-containers.containerapps-revisions | [Revisions](https://learn.microsoft.com/en-us/azure/container-apps/revisions) — revision modes; properties.template vs properties.configuration |
| R5 | ref-containers.containerapps-keda | [Scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app) — Scale definition; HTTP; limits and maintenance transients |
| R6 | ref-containers.aks-manifests | [AKS CLI quickstart](https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-deploy-cli) — Deployment/Service YAML and kubectl apply |
| R7 | ref-containers.container-diagnostics | [Image pull errors](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/connectivity/cannot-pull-image-from-acr-to-aks-cluster) — Symptoms and initial troubleshooting; Events |
| R8 | acr-image-reference | [Registry concepts](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-concepts) — Manifest digest; Address an artifact |
| R9 | acr-build-cli | [az acr build](https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest#az-acr-build) — local-context build/push example |
| R10 | acr-quick-build | [Quick build](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-quickstart-task-cli) — Build and push image from a Dockerfile; Run the image as a distinct operation |
| R11 | acr-task-cli | [az acr task](https://learn.microsoft.com/en-us/cli/azure/acr/task?view=azure-cli-latest) — create/run/logs; --schedule; --commit-trigger-enabled; --base-image-trigger-enabled |
| R12 | acr-timers | [Scheduled Tasks](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tasks-scheduled) — Cron expressions and UTC examples |
| R13 | aca-image-pull | [Managed identity pulls](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity-image-pull) — create user identity, grant AcrPull, configure private-image app |
| R14 | aca-traffic | [Traffic splitting](https://learn.microsoft.com/en-us/azure/container-apps/traffic-splitting) — weights total 100; revisionName; test before partial shift |
| R15 | aca-secrets | [Manage secrets](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets) — app scope; no new revision on secret change; restart or deploy |
| R16 | aca-env | [Environment variables](https://learn.microsoft.com/en-us/azure/container-apps/environment-variables) — existing secret required; --set-env-vars NAME=secretref:SECRET; revision changes |
| R17 | aca-cli | [az containerapp](https://learn.microsoft.com/en-us/cli/azure/containerapp?view=azure-cli-latest) — create/update minimum/maximum replicas; image; --set-env-vars |
| R18 | aca-logging | [Application logging](https://learn.microsoft.com/en-us/azure/container-apps/logging) — console stdout/stderr; system provisioning events; HTTP ingress logs when enabled |
| R19 | aks-probes | [AKS reliability guidance](https://learn.microsoft.com/en-us/azure/aks/best-practices-app-cluster-reliability) — readiness, liveness and startup probes |
| R20 | aks-services | [Kubernetes Services](https://learn.microsoft.com/en-us/azure/aks/concepts-network-services) — network endpoint for grouped pods |
| R21 | web-settings | [App settings reference](https://learn.microsoft.com/en-us/azure/app-service/reference-app-settings) — WEBSITES_PORT routing; not injected as a container environment variable |
| R22 | web-config | [Configure app](https://learn.microsoft.com/en-us/azure/app-service/configure-common) — app settings as runtime environment variables |
| R23 | web-identity-pull | [Custom-image tutorial](https://learn.microsoft.com/en-us/azure/app-service/tutorial-custom-container) — identity, role assignment, acrUseManagedIdentityCreds |

Additional primary pages inspected for boundary checks (not needed as published
question references): [AKS–ACR integration](https://learn.microsoft.com/en-us/azure/aks/cluster-container-registry-integration)
explains the ABAC Repository Reader distinction; [App Service sidecar tutorial](https://learn.microsoft.com/en-us/azure/app-service/tutorial-sidecar)
was inspected to keep classic port questions explicitly scoped; [ACR multistep tasks](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tasks-multi-step)
confirms build/run/test step distinctions. [App Service identity overview](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity)
was opened, but no extra claim from it is needed. No Q&A, exam-dump, or third-party
answer page was used as evidence.

## All 27 answer/source relationships

Every row was reviewed 2026-10-06. `A/F` means author checked and independent
answer/source/distractor review approved by `/root/exam_bank_containers_review`;
the two explicitly marked family fixes still await rereview. Ordered keys follow
canonical component declaration order; bracketed
keys denote a single set response. Source R tokens resolve to the exact paths
above. Numbers in these original scenarios are authored requirements, not
claims about undocumented service defaults.

| Item | Objective / concept | Reviewed | Source paths | Key and justification | Candidate/distractor check | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| ai200-c001 | containers.registry-images / containers.image-identity | 2026-10-06 | R1, R8 | digest; records immutable manifest identity | release tag can move; timestamp is not an image address | A/F |
| ai200-c002 | containers.registry-tasks / containers.registry-automation | 2026-10-06 | R2, R9, R10, R4, R8 | build; build/push local source context | hosting an existing image and pulling the previous build do not build source | A/F |
| ai200-c003 | containers.appservice-container / containers.appservice-hosting | 2026-10-06 | R3, R21 | port; route classic HTTP hosting to 8000 | DB_HOST and repository naming do not set forwarding; classic scope explicit | A/F |
| ai200-c004 | containers.aks-manifests / containers.workload-manifests | 2026-10-06 | R6, R19 | ready; withhold traffic without restart | liveness restarts; startup alone is not ongoing traffic admission | A/F |
| ai200-c005 | containers.containerapps-revisions / containers.revision-release | 2026-10-06 | R4, R14 | multiple; concurrently active canary revisions | single does not support requested concurrent canary; tag movement is no mode change | A/F |
| ai200-c006 | containers.container-diagnostics / containers.failure-layers | 2026-10-06 | R7 | events; detailed pre-start pull failure | process not started cannot provide request logs; scaling does not diagnose | A/F |
| ai200-c007 | containers.registry-images / containers.image-identity | 2026-10-06 | R1, R13 | [role, select]; authorize and choose runtime identity | CI-only rights and latest tag do not authorize runtime pulls; RBAC-only scope explicit | A/F |
| ai200-c008 | containers.registry-tasks / containers.registry-automation | 2026-10-06 | R2, R5, R19 | [commit, base]; required build trigger categories | HTTP scaling and readiness are runtime controls | A/F |
| ai200-c009 | containers.appservice-container / containers.appservice-hosting | 2026-10-06 | R3, R22, R14 | [settings, logs]; environment and startup evidence | repository name supplies neither; Container Apps weights are another service's control | A/F |
| ai200-c010 | containers.containerapps-keda / containers.scale-signals | 2026-10-06 | R5 | [min, max]; configured 1–6 limits | min 0 permits idle zero; concurrency is not a ceiling; maintenance transients explicitly excluded | A/F; family fix pending |
| ai200-c011 | containers.registry-images / containers.image-identity | 2026-10-06 | R1, R8, R9 | build → record → handoff; runbook dependency gates | every out-of-position step violates its explicit gate; latest is unused mutable distractor | A/F |
| ai200-c012 | containers.registry-tasks / containers.registry-automation | 2026-10-06 | R2, R11 | create → run → logs; absent task then identified test run | every out-of-position operation lacks its prerequisite or repeats work; delete supplies no gate | A/F |
| ai200-c013 | containers.appservice-container / containers.appservice-hosting | 2026-10-06 | R3, R23 | enable → grant → use; identity then authorization then selection | order is explicit checklist, not a universal CLI dependency; embedded password violates chosen procedure | A/F |
| ai200-c014 | containers.aks-manifests / containers.workload-manifests | 2026-10-06 | R6 | save → apply → inspect; stated launch gates | other positions violate checklist; unrelated tag does not submit or verify manifests | A/F |
| ai200-c015 | containers.aks-manifests / containers.workload-manifests | 2026-10-06 | R6, R20 | deployment, service; workload vs networking | Service is not pod-template control; Deployment is not a stable Service endpoint | A/F |
| ai200-c016 | containers.aks-manifests / containers.workload-manifests | 2026-10-06 | R6, R19 | readiness, liveness, startup; traffic/restart/initialization | each row explains both alternate probe purposes rather than labelling them generically wrong | A/F |
| ai200-c017 | containers.registry-tasks / containers.registry-automation | 2026-10-06 | R2, R9, R11 | build, run, logs; context build/named trigger/evidence | each alternate command performs a distinct operation; no hosting claim for Tasks | A/F |
| ai200-c018 | containers.container-diagnostics / containers.failure-layers | 2026-10-06 | R7, R18 | console, system; stdout vs platform event | alternate category does not capture supplied event; HTTP logs require enabled ingress logging | A/F |
| ai200-c019 | containers.containerapps-revisions / containers.revision-release | 2026-10-06 | R4, R14 | multiple, r2; case concurrency and approved image | single cannot give canary arrangement; r1 is not case's new artifact | A/F |
| ai200-c020 | containers.containerapps-keda / containers.scale-signals | 2026-10-06 | R5, R17 | zero, four; requested CLI limits | one violates requested idle minimum; ten exceeds ceiling | A/F |
| ai200-c021 | containers.aks-manifests / containers.workload-manifests | 2026-10-06 | R6, R20 | api, p8080; pod label and backend listener | worker mismatches label; client port 80 is not backend 8080 | A/F |
| ai200-c022 | containers.containerapps-revisions / containers.revision-release | 2026-10-06 | R4, R15, R14 | no, yes, yes; secret scope, restart, 90/10 | yes/no reasons supplied independently per row; secret-only update does not imply process refresh | A/F |
| ai200-c023 | containers.appservice-container / containers.appservice-hosting | 2026-10-06 | R3, R22, R21 | yes, no; environment setting vs hosting-port selector | FEATURE_MODE is not WEBSITES_PORT; classic hosting scope explicit | A/F |
| ai200-c024 | containers.container-diagnostics / containers.failure-layers | 2026-10-06 | R7, R20, R6 | [selector]; worker mismatches healthy api pods | supplied readiness/listener and port mapping already agree; only selector is contradictory | A/F |
| ai200-c025 | containers.containerapps-keda / containers.scale-signals | 2026-10-06 | R5 | [min, max]; locate limit fields | HTTP concurrency field is a trigger threshold | A/F; family fix pending |
| ai200-c026 | containers.containerapps-revisions / containers.revision-release | 2026-10-06 | R4, R16, R17 | production, secret; case values and existing secret reference | development violates case; literal token violates storage constraint; CLI example stays text | A/F |
| ai200-c027 | containers.registry-tasks / containers.registry-automation | 2026-10-06 | R2, R11, R12 | hour, off, off; hourly UTC timer alone | every-minute expression is wrong cadence; either true adds a disallowed trigger | A/F |

## Coverage and originality check

Kind allocation: single c001–006 (6), multiple c007–010 (4), build c011–014 (4),
matching c015–018 (4), dropdown c019–021 (3), grid c022–023 (2), hot c024–025 (2),
screen c026–027 (2). All seven objectives occur. The sole case is case-c1 with
c019/c022/c026 in that order and complete shared private-image application,
environment, secret, identity, network, port and rollout constraints.

The bank has 27 question IDs and 26 distinct families. Independent review found
c010 and c025 equivalent: both identify minReplicas/maxReplicas as replica bounds
and distinguish concurrentRequests as a trigger threshold. Different widgets,
numbers and selection wording do not make independent evidence. Both now use
`familyId:'ai200-c010'`; c025 retains its original ID, kind, key and explanation.
The helper accepts an explicit familyId override and otherwise defaults to the
item ID. The focused regression pins this relationship, all remaining defaults,
27 questions and 26 families. Final fix rereview by the original reviewer is
pending; the earlier claim of 27 independent families is superseded.

App Service and deeper ACR Tasks retain the canonical documentation-only
concepts `containers.appservice-hosting` and `containers.registry-automation`:
both have empty labIds and taskIds in the actual concept catalog. This bank
does not fabricate matching Labs. Canonical IDs resolve in this catalog;
`acr-image-reference` is the actual inspected ACR concepts page, not a fake
schema-passing placeholder.

Source discrepancies handled: the App Service settings reference discusses
automatic port detection while the configuration guide mentions port 80 as
the default; the items ask only about explicit port 8000 and classic hosting.
The registry role-mode distinction was checked, so identity questions do not
imply AcrPull works for ABAC repository permissions. Current CLI docs include
preview revision-label modes; questions require the documented multiple mode
and do not infer a feature absence from omitted candidate choices.
