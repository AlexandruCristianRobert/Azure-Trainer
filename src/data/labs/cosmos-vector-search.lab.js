const RG = 'rg-cosmos'
const ACCOUNT = 'cosmos-contoso-catalog'
const DATABASE = 'catalog'
const CONTAINER = 'products'
const CAPABILITY = 'EnableNoSQLVectorSearch'
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()

function account(sb) {
  if (!sb.resourceGroups.some((g) => same(g.name, RG))) return undefined
  return (sb.cosmosAccounts ?? []).find((a) => same(a.name, ACCOUNT) && same(a.resourceGroup, RG))
}
function database(sb) {
  return account(sb)?.databases.find((db) => db.name === DATABASE)
}
function container(sb) {
  return database(sb)?.containers.find((c) => c.name === CONTAINER)
}

const VECTOR_POLICY = '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float32","dimensions":1536,"distanceFunction":"cosine"}]}'
const INDEX_POLICY = '{"indexingMode":"consistent","automatic":true,"includedPaths":[{"path":"/*"}],"excludedPaths":[{"path":"/embedding/*"}],"vectorIndexes":[{"path":"/embedding","type":"diskANN"}]}'

export const cosmosVectorSearchLab = {
  id: 'cosmos-vector-search',
  title: 'Cosmos DB container with vector search',
  skillAreaId: 'data',
  service: 'cosmos-db',
  minutes: 45,
  status: 'available',
  brief: "Contoso is preparing its product catalog for semantic search using existing embeddings. Configure Azure Cosmos DB for NoSQL with a partitioned container and a vector index. This Sandbox checks the configuration; it does not generate embeddings or run vector queries.",
  seed: (sandbox) => sandbox,
  tasks: [
    {
      id: 'resource-group',
      text: 'Create a resource group named `rg-cosmos` in West Europe.',
      check: (sb) => sb.resourceGroups.some((g) => same(g.name, RG) && g.location === 'westeurope'),
      hints: [
        'Use `az group create` to create the resource group that will hold the Cosmos DB account.',
        'Set `--name rg-cosmos` and `--location westeurope`. You can configure a default group to avoid repeating it in later commands.',
      ],
      solution: 'az group create --name rg-cosmos --location westeurope',
      examNote: 'The resource group manages the account lifecycle. Cosmos DB databases and containers sit inside the account, while the account itself belongs to a resource group.',
    },
    {
      id: 'cosmos-account',
      text: 'Create an Azure Cosmos DB for NoSQL account named `cosmos-contoso-catalog` in `rg-cosmos`, in West Europe.',
      check: (sb) => {
        const a = account(sb)
        return !!a && a.kind === 'GlobalDocumentDB' && a.location === 'westeurope'
      },
      hints: [
        '`az cosmosdb create` creates a NoSQL account by default. Account names use lowercase letters, numbers and hyphens.',
        'Use `--locations regionName=westeurope failoverPriority=0 isZoneRedundant=False`, along with `--name cosmos-contoso-catalog --resource-group rg-cosmos`.',
      ],
      solution: 'az cosmosdb create --name cosmos-contoso-catalog --resource-group rg-cosmos --locations regionName=westeurope failoverPriority=0 isZoneRedundant=False',
      examNote: 'The Azure Cosmos DB for NoSQL account uses the `GlobalDocumentDB` kind. The CLI manages its databases and containers through the `az cosmosdb sql` command group.',
    },
    {
      id: 'vector-capability',
      text: 'Enable the `EnableNoSQLVectorSearch` capability on `cosmos-contoso-catalog`.',
      check: (sb) => account(sb)?.capabilities.includes(CAPABILITY) ?? false,
      hints: [
        'Vector search must be enabled at account level before creating a container with a vector embedding policy.',
        'Use `az cosmosdb update --name cosmos-contoso-catalog --resource-group rg-cosmos --capabilities EnableNoSQLVectorSearch`.',
      ],
      solution: 'az cosmosdb update --name cosmos-contoso-catalog --resource-group rg-cosmos --capabilities EnableNoSQLVectorSearch',
      examNote: 'Enabling the account capability is separate from defining a container vector policy and index. Capability activation can take time in Azure; it takes effect immediately in this Sandbox.',
    },
    {
      id: 'sql-database',
      text: 'Create a database named `catalog` in `cosmos-contoso-catalog`, without shared database throughput.',
      check: (sb) => !!database(sb),
      hints: [
        'Create a NoSQL database through `az cosmosdb sql database create`. This Lab provisions throughput on the container, so omit database throughput.',
        'Use `--account-name cosmos-contoso-catalog --resource-group rg-cosmos --name catalog`. Database and container IDs are case sensitive.',
      ],
      solution: 'az cosmosdb sql database create --account-name cosmos-contoso-catalog --resource-group rg-cosmos --name catalog',
      examNote: 'A database groups containers. This vector-search Lab uses dedicated container throughput; vector search currently does not support shared database throughput.',
    },
    {
      id: 'vector-container',
      text: 'Create `products` in `catalog` with partition key `/category` and `400` RU/s. Define `/embedding` as `float32`, `1536` dimensions, `cosine` distance; add a `diskANN` index on `/embedding` and exclude `/embedding/*` from ordinary indexing, with consistent indexing enabled.',
      check: (sb) => {
        if (!account(sb)?.capabilities.includes(CAPABILITY)) return false
        const c = container(sb)
        if (!c || c.partitionKeyPath !== '/category' || c.throughput !== 400) return false
        const embedding = c.vectorEmbeddingPolicy?.vectorEmbeddings?.find((v) => v.path === '/embedding')
        const policy = c.indexingPolicy
        return !!embedding && embedding.dataType === 'float32' && embedding.dimensions === 1536
          && embedding.distanceFunction === 'cosine' && policy?.indexingMode === 'consistent'
          && policy.automatic === true
          && (policy.vectorIndexes ?? []).some((index) => index.path === '/embedding' && index.type === 'diskANN')
          && (policy.excludedPaths ?? []).some((excluded) => excluded.path === '/embedding/*')
      },
      hints: [
        'The vector embedding policy describes the stored vectors; the indexing policy chooses how to search them. Their paths must match. Exclude the vector array from ordinary indexing to avoid indexing each number separately.',
        'Use `az cosmosdb sql container create` with `--partition-key-path /category --throughput 400`, `--vector-embeddings` and `--idx`. Wrap each JSON object in single quotes. If an existing container has the wrong immutable policy, delete it with `az cosmosdb sql container delete --resource-group rg-cosmos --account-name cosmos-contoso-catalog --database-name catalog --name products --yes`, then recreate it.',
      ],
      solution: `az cosmosdb sql container create --resource-group rg-cosmos --account-name cosmos-contoso-catalog --database-name catalog --name products --partition-key-path /category --throughput 400 --vector-embeddings '${VECTOR_POLICY}' --idx '${INDEX_POLICY}'`,
      examNote: 'Vector dimensions and distance function must match the embeddings and retrieval model. DiskANN supports approximate nearest-neighbor search; the vector policy and index are configured when the container is created.',
    },
  ],
}
