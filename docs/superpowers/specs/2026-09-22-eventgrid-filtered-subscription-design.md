# Event Grid filtered subscription Lab

Continue the authorized catalog expansion: the first five Labs are complete; this is the
sixth and final Coming soon entry. Reuse the existing local configuration simulation.
No real endpoint validation, publishing, event delivery, retries or filter execution.

## Frozen model and interfaces

Sandbox adds `eventGridTopics: []`, normalized for legacy saves. Each topic is
`{ name, resourceGroup, location, inputSchema: 'EventGridSchema', tags, createdAt, eventSubscriptions: [] }`.
Each nested subscription is `{ name, endpointType: 'WebHook', endpoint,
filter: { includedEventTypes: [], subjectBeginsWith: '', subjectEndsWith: '', isSubjectCaseSensitive: false }, createdAt }`.
An empty event-type array means all types. Names/ancestry compare case-insensitively;
event types and subject strings retain case. Topic names are 3–50 ASCII letters, digits or
hyphens, subscription names 3–64, both start/end alphanumeric. Topic names are unique
within this Sandbox; subscription names within their topic. Topic location is normalized,
independent of resource-group metadata location. Tags are null or string dictionaries.
Require an existing group/parent, valid names, supported schema and endpoint configuration
before mutation. HTTPS webhook URLs only, no userinfo, fragments or credentials;
query strings are outside this educational subset. No network calls.
Reject literal wildcard characters in subject prefix/suffix; strings may be empty to clear.
Event-type lists preserve exact strings, reject empty entries and mixed `All` plus explicit
types; normalize lone `All` or a flag without values to an empty list. Deduplicate entries.

Operations clone before changing state; reads never mutate. Creating an existing resource
updates explicitly supplied mutable fields, preserving unspecified fields and children.
Topic region/schema are immutable: explain delete/recreate on incompatible create.
Subscription update preserves omitted settings. Delete topic/group cascades to subscriptions.
New saved-state shape guards validate nested fields, uniqueness, group ancestry and valid
locations/URLs before any UI reads. Missing collection is backward compatible; malformed
present collection is rejected.

Events are identity-only: resourceType `eventGridTopic`, fields `{name,resourceGroup}`;
`eventGridSubscription`, fields `{name,resourceGroup,topic}`. Types created/updated/deleted.
Blades use `eventgrid-topic` with `{resourceGroup,name}` and `eventgrid-subscription`
with `{resourceGroup,topic,name}`. Events focus the relevant Blade; deletion and stale
navigation fall back to topic, group, resource groups as appropriate.

## Command subset

- `az eventgrid topic create|show|list|delete`: name, resource-group; create supports
  location, tags, input-schema (only `eventgridschema`). List has optional group.
- `az eventgrid topic event-subscription create|update|show|list|delete`: resource-group,
  topic-name and name (except list). Create requires endpoint; endpoint-type defaults to
  webhook and accepts only webhook. Optional included-event-types (existing string-list
  parser), subject-begins-with, subject-ends-with, subject-case-sensitive (create only).
  Update supports endpoint, update-endpoint-type webhook and the three filter strings/lists;
  case-sensitivity is preserved because this CLI update does not offer that flag.
- Every supported group/command has help. Deletes accept and require --yes, documented as
  this Sandbox's confirmation convention. No generic source-resource-id alias or extra commands.
- ARM-shaped presenters supply resource IDs, type and simulated Succeeded provisioning
  state. Subscription filter and WebHook destination use Azure-style field names.

## Five Tasks and canonical Solutions

1. Group `rg-events` in `westeurope`:
   `az group create --name rg-events --location westeurope`
2. Topic `evgt-contoso-orders` in that group, West Europe, EventGridSchema:
   `az eventgrid topic create --name evgt-contoso-orders --resource-group rg-events --location westeurope --input-schema eventgridschema`
3. Subscription `eu-order-handler` on that topic, WebHook endpoint
   `https://events.contoso.com/api/orders`:
   `az eventgrid topic event-subscription create --name eu-order-handler --resource-group rg-events --topic-name evgt-contoso-orders --endpoint-type webhook --endpoint https://events.contoso.com/api/orders`
4. Include only `Contoso.Order.Created` on that same subscription:
   `az eventgrid topic event-subscription update --name eu-order-handler --resource-group rg-events --topic-name evgt-contoso-orders --included-event-types Contoso.Order.Created`
5. Subject begins `/orders/eu/`, ends `.json`, case-insensitive:
   `az eventgrid topic event-subscription update --name eu-order-handler --resource-group rg-events --topic-name evgt-contoso-orders --subject-begins-with /orders/eu/ --subject-ends-with .json`

All checks require exact resource ancestry. Task 4 requires an exact one-item type list;
Task 5 requires both subject strings and false case sensitivity. Provide two Hints, a
Solution and an Exam Note per Task. Explain OR within event types and AND across filter
categories, all-types default and literal prefix/suffix matching. Last Lab completion
returns Home when no next available Lab exists; reuse existing completion logic.

## Read-only Blades

Topic: Essentials (name/group/location/schema), event subscriptions table with navigation.
Subscription: parent breadcrumbs, endpoint/type and filters, explicit All event types /
Any prefix / Any suffix defaults, case sensitivity, configuration-only note. Reuse existing
Blade components and CSS, wrap long endpoints/types, no endpoint external links or write UI.
Resource group table includes Event Grid topics, not nested subscriptions as top-level rows.

## Verification and constraints

Preserve existing uncommitted work, current checkout, no commits/worktrees/git metadata writes.
Carry forward no tests added/run; only update existing catalog expectation to six Labs.
Use static source tracing, independent review and production build/whitespace verification.
Sol/Terra workers use disjoint ownership and no nested agents.

## Microsoft references checked 2026-09-22

- https://learn.microsoft.com/en-us/cli/azure/eventgrid/topic?view=azure-cli-latest
- https://learn.microsoft.com/en-us/cli/azure/eventgrid/topic/event-subscription?view=azure-cli-latest
- https://learn.microsoft.com/en-us/azure/event-grid/event-filtering

The command documentation confirms topic-scoped subscriptions, custom event-type lists,
literal subject prefix/suffix filters and differing create/update endpoint-type flags.
