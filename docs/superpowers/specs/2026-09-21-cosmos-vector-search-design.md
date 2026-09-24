# Third Lab: Cosmos DB container with vector search

Make the existing `cosmos-vector-search` catalog entry playable. Follow CONTEXT.md, SPEC.md,
ADR-0001 and the existing Lab design. The user authorized continuing to the next Lab and
using Sol/Terra agents. Preserve both earlier Labs and their uncommitted implementation.

## Five Tasks

Contoso is preparing its product catalog for semantic search using existing embeddings.
This Lab configures Azure Cosmos DB for NoSQL; the Sandbox does not generate embeddings,
store product documents, build indexes or execute vector queries.

1. Create `rg-cosmos` in West Europe.
2. Create NoSQL account `cosmos-contoso-catalog` in that group, in West Europe.
3. Enable `EnableNoSQLVectorSearch` on that account.
4. Create SQL database `catalog` in that account.
5. Create container `products` in `catalog` with partition key `/category`, throughput 400 RU/s,
   a `/embedding` vector of type `float32`, 1536 dimensions, `cosine` distance, a `diskANN`
   vector index on the same path, and an ordinary-index exclusion for `/embedding/*`.

Each Task has two Hints, a complete copyable Solution and an Exam Note. Checks inspect
state and full ancestry; grouping/account lookup is case insensitive, while database and
container IDs and JSON paths are case sensitive. Every Task is false initially and each
Solution completes exactly the next Task. Creating the account with its capability already
enabled can satisfy Tasks 2 and 3 together.

## Sandbox and command contract

```js
sandbox.cosmosAccounts = [{
  name, resourceGroup, location, kind: 'GlobalDocumentDB',
  defaultConsistencyLevel: 'Session', capabilities: [], // string capability names
  tags, createdAt,
  databases: [{ name, createdAt, containers: [{
    name, partitionKeyPath, throughput: 400, createdAt,
    vectorEmbeddingPolicy: null, // or { vectorEmbeddings: [{path,dataType,dimensions,distanceFunction}] }
    indexingPolicy: { indexingMode: 'consistent', automatic: true,
      includedPaths: [{path:'/*'}], excludedPaths: [{path:'/_etag/?'}], vectorIndexes: [] },
  }] }],
}]
```

Old saves missing `cosmosAccounts` remain valid and normalize to `[]`; malformed present
collections are rejected. Account deletion removes its databases/containers; database
deletion removes containers; resource group deletion removes its Cosmos accounts.

Supported commands:

- `az cosmosdb create/update/show/list/delete`: name/group; one-region `--locations
  regionName=westeurope failoverPriority=0 isZoneRedundant=False` on create (default to group
  location when omitted); `--kind GlobalDocumentDB`; `--default-consistency-level` accepts
  Strong, BoundedStaleness, Session, ConsistentPrefix, Eventual; tags; capabilities. Only the
  `EnableNoSQLVectorSearch` capability is in scope. Update supports capabilities, consistency
  and tags. Do not accept account API changes or an unsupported multi-region configuration.
- `az cosmosdb sql database create/show/list/delete`: `--account-name/-a`, group,
  `--name/-n` except list. This Lab uses container-level throughput, not shared database RU/s.
- `az cosmosdb sql container create/show/list/delete`: account, `--database-name/-d`, group,
  name except list; create uses `--partition-key-path/-p`, `--throughput` (default 400),
  `--vector-embeddings` and `--idx` as single quoted inline JSON strings. No filesystem or
  `@file` access in the Sandbox; explain inline JSON requirement on such input.
- All groups and commands support `--help`. Deletes require `--yes/-y` in this noninteractive
  Sandbox. Reads never mutate. Failed operations are atomic and emit no resource events.

Use the existing tokenizer, args parser, JSON formatter, AzError and latency conventions.
Adapt `kind:'list'` in command descriptors for structured locations/capability lists if useful;
do not globally change existing argument semantics. Parse JSON in a small dedicated policy
module; reject null/arrays/malformed shapes with CLI-style errors rather than uncaught errors.

Validate parent existence, account names (3–44 lowercase letters/numbers/hyphens), uniqueness
across groups, nonempty case-sensitive database/container IDs without `/`, `\\`, `?`, `#`,
partition paths, manual throughput >=400 in increments of 100, recognized capability, vector
types/distances, positive integer dimensions up to 4096, duplicate vector paths and index
paths, and vector index paths matching declared embeddings. `flat` indexes support at most
505 dimensions; support valid `flat`, `quantizedFlat`, `diskANN` values, with the Lab requiring
diskANN. Reject vector configurations before account capability is enabled. Ordinary
containers without vector policies remain possible but do not satisfy Task 5.

Default indexing includes all ordinary paths and excludes `/_etag/?`. Explicit custom
policies must be internally valid; root indexing path `/*` must be included or excluded.
The vector policy/index is set at creation; support no container update command. Repeating
create with identical settings is idempotent. Reject conflicting existing container settings
without mutation, and tell the learner to delete/recreate. Repeating account/database create
preserves children. Account location cannot move on repeated create. Capability enabling is
immediate in this Sandbox; note that real Azure propagation can take time.

ARM-shaped output: account `Microsoft.DocumentDB/databaseAccounts`, `kind`, `capabilities`
as `{name}` objects, `consistencyPolicy`, display-only documentEndpoint and locations.
SQL database/container types use `/sqlDatabases/<database>/containers/<container>` IDs and
`resource: {id,...}`, container partitionKey `{paths:[...],kind:'Hash',version:2}` plus
vectorEmbeddingPolicy/indexingPolicy. No secrets or synthetic account keys.

Events:

```js
{type, resourceType:'cosmosAccount', name, resourceGroup}
{type, resourceType:'cosmosDatabase', name, resourceGroup, account}
{type, resourceType:'cosmosContainer', name, resourceGroup, account, database}
```

## Read-only Blades

- `{kind:'cosmos-account',resourceGroup,name}`: account Essentials, NoSQL/vector capability,
  region/consistency and database rows.
- `{kind:'cosmos-database',resourceGroup,account,name}`: parent breadcrumbs, database
  Essentials and container rows showing partition key, throughput and vector configuration.
- `{kind:'cosmos-container',resourceGroup,account,database,name}`: parent breadcrumbs,
  partition/throughput, embedding definition table, vector indexes and ordinary excluded
  paths. Use existing components/styles and Azure cosmos-db icon; no mutation controls.
- New events focus the corresponding Blade; ancestor deletion falls back to the nearest
  remaining parent. Missing-resource resolution handles legacy saves. Resource group tables
  include Cosmos accounts. Highlight only the content that is actually rendered.

Catalog entry becomes available, retaining id/title/order/minutes/Skill Area. The existing
catalog-order Next Lab link enables navigation from Container Apps to this Lab, while Key
Vault remains Coming soon. All Lab lifecycle behavior uses the existing stores.

## Verification and primary references

Use TDD at command and navigation boundaries. Cover supported CRUD, malformed policies,
state atomicity, parent checks, identity/paths, capability prerequisite, policy recovery,
legacy saves, Task checks, full completion/resume/restart/isolation and catalog integrity.
Run full Vitest and build; inspect real Cloud Shell/browser flow at 1440 and 1280 widths.

- https://learn.microsoft.com/en-us/cli/azure/cosmosdb?view=azure-cli-latest
- https://learn.microsoft.com/en-us/cli/azure/cosmosdb/sql/database?view=azure-cli-latest
- https://learn.microsoft.com/en-us/cli/azure/cosmosdb/sql/container?view=azure-cli-latest
- https://learn.microsoft.com/en-us/azure/cosmos-db/vector-search

Verified 2026-09-21: CLI flag is `--vector-embeddings`, indexing policy is `--idx`; single
quotes around inline JSON preserve JSON double quotes in Bash. Account capability is
`EnableNoSQLVectorSearch`. DiskANN may fall back to a scan for small vector collections;
the Sandbox checks configuration and does not pretend a vector index is populated.
