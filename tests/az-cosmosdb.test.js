import { describe, expect, it } from 'vitest'
import { createSandbox, isSandboxShape } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'

const out = (result) => result.lines.filter((line) => line.kind === 'out').map((line) => line.text).join('\n')
const err = (result) => result.lines.filter((line) => line.kind === 'err').map((line) => line.text).join('\n')
const EMBEDDINGS = '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float32","dimensions":1536,"distanceFunction":"cosine"}]}'
const INDEXING = '{"indexingMode":"consistent","automatic":true,"includedPaths":[{"path":"/*"}],"excludedPaths":[{"path":"/embedding/*"}],"vectorIndexes":[{"path":"/embedding","type":"diskANN"}]}'

function withDatabase() {
  let sandbox = runLine(createSandbox(), 'az group create -n rg-cosmos -l westeurope').sandbox
  sandbox = runLine(sandbox, 'az cosmosdb create -g rg-cosmos -n cosmos-contoso-catalog --locations regionName=westeurope failoverPriority=0 isZoneRedundant=False').sandbox
  sandbox = runLine(sandbox, 'az cosmosdb update -g rg-cosmos -n cosmos-contoso-catalog --capabilities EnableNoSQLVectorSearch').sandbox
  return runLine(sandbox, 'az cosmosdb sql database create -g rg-cosmos -a cosmos-contoso-catalog -n catalog').sandbox
}

describe('az cosmosdb', () => {
  it.each([[[null]], [[{}]]])('rejects malformed persisted Cosmos account entries: %j', (cosmosAccounts) => {
    const sandbox = createSandbox()
    sandbox.cosmosAccounts = cosmosAccounts
    expect(isSandboxShape(sandbox)).toBe(false)
  })

  it('creates the NoSQL account, enables vector search, and emits canonical events', () => {
    let sandbox = runLine(createSandbox(), 'az group create -n rg-cosmos -l westeurope').sandbox
    const account = runLine(sandbox, 'az cosmosdb create -g rg-cosmos -n cosmos-contoso-catalog --locations regionName=westeurope failoverPriority=0 isZoneRedundant=False')
    expect(err(account)).toBe('')
    expect(JSON.parse(out(account))).toMatchObject({ name: 'cosmos-contoso-catalog', kind: 'GlobalDocumentDB', location: 'westeurope', consistencyPolicy: { defaultConsistencyLevel: 'Session' }, capabilities: [] })
    expect(account.events).toEqual([{ type: 'created', resourceType: 'cosmosAccount', name: 'cosmos-contoso-catalog', resourceGroup: 'rg-cosmos' }])
    const enabled = runLine(account.sandbox, 'az cosmosdb update -g rg-cosmos -n cosmos-contoso-catalog --capabilities EnableNoSQLVectorSearch')
    expect(enabled.sandbox.cosmosAccounts[0].capabilities).toEqual(['EnableNoSQLVectorSearch'])
    expect(enabled.events).toEqual([{ type: 'updated', resourceType: 'cosmosAccount', name: 'cosmos-contoso-catalog', resourceGroup: 'rg-cosmos' }])
  })

  it('requires the vector capability before atomically creating a vector container', () => {
    let sandbox = runLine(createSandbox(), 'az group create -n rg-cosmos -l westeurope').sandbox
    sandbox = runLine(sandbox, 'az cosmosdb create -g rg-cosmos -n cosmos-contoso-catalog').sandbox
    sandbox = runLine(sandbox, 'az cosmosdb sql database create -g rg-cosmos -a cosmos-contoso-catalog -n catalog').sandbox
    const result = runLine(sandbox, `az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --vector-embeddings '${EMBEDDINGS}' --idx '${INDEXING}'`)
    expect(err(result)).toContain('EnableNoSQLVectorSearch')
    expect(result.sandbox).toBe(sandbox)
    expect(result.events).toEqual([])
  })

  it('allows a capability-enabled container embedding policy without a vector index', () => {
    const result = runLine(withDatabase(), `az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --vector-embeddings '${EMBEDDINGS}'`)
    expect(err(result)).toBe('')
    expect(JSON.parse(out(result)).resource).toMatchObject({ vectorEmbeddingPolicy: JSON.parse(EMBEDDINGS), indexingPolicy: { vectorIndexes: [] } })
  })

  it('rejects array wildcard syntax in vector embedding and index paths', () => {
    const embeddings = '{"vectorEmbeddings":[{"path":"/items/[]/embedding","dataType":"float32","dimensions":8,"distanceFunction":"cosine"}]}'
    const indexing = '{"includedPaths":[{"path":"/*"}],"excludedPaths":[],"vectorIndexes":[{"path":"/items/[]/embedding","type":"diskANN"}]}'
    const sandbox = withDatabase()
    const result = runLine(sandbox, `az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --vector-embeddings '${embeddings}' --idx '${indexing}'`)
    expect(err(result)).toContain('cannot contain wildcard')
    expect(result.sandbox).toBe(sandbox)
  })

  it('creates a vector container with ARM policies and exact ancestor event fields', () => {
    const result = runLine(withDatabase(), `az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --throughput 400 --vector-embeddings '${EMBEDDINGS}' --idx '${INDEXING}'`)
    expect(err(result)).toBe('')
    expect(JSON.parse(out(result))).toMatchObject({
      name: 'products',
      type: 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers',
      location: 'westeurope',
      options: { throughput: 400 },
      resource: { partitionKey: { paths: ['/category'], kind: 'Hash', version: 2 }, vectorEmbeddingPolicy: JSON.parse(EMBEDDINGS), indexingPolicy: JSON.parse(INDEXING) },
    })
    expect(result.events).toEqual([{ type: 'created', resourceType: 'cosmosContainer', name: 'products', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog', database: 'catalog' }])
  })

  it('rejects malformed or inconsistent policies without mutating the database', () => {
    const sandbox = withDatabase()
    const malformed = runLine(sandbox, "az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --vector-embeddings '{bad}' --idx '{}'" )
    expect(err(malformed)).toContain('--vector-embeddings must be valid inline JSON')
    expect(malformed.sandbox).toBe(sandbox)
    const mismatched = runLine(sandbox, "az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --vector-embeddings '{\"vectorEmbeddings\":[{\"path\":\"/embedding\",\"dataType\":\"float32\",\"dimensions\":1536,\"distanceFunction\":\"cosine\"}]}' --idx '{\"includedPaths\":[{\"path\":\"/*\"}],\"excludedPaths\":[],\"vectorIndexes\":[{\"path\":\"/other\",\"type\":\"diskANN\"}]}'")
    expect(err(mismatched)).toContain('must match a declared vector embedding path')
    expect(mismatched.sandbox).toBe(sandbox)
  })

  it('rejects unsupported structured values and file policy input without emitting events', () => {
    const group = runLine(createSandbox(), 'az group create -n rg-cosmos -l westeurope').sandbox
    const badAccount = runLine(group, 'az cosmosdb create -g rg-cosmos -n Cosmos-Contoso --locations regionName=westeurope failoverPriority=1')
    expect(err(badAccount)).toContain('lowercase letters')
    expect(badAccount.sandbox).toBe(group)
    const account = runLine(group, 'az cosmosdb create -g rg-cosmos -n cosmos-contoso').sandbox
    const badCapability = runLine(account, 'az cosmosdb update -g rg-cosmos -n cosmos-contoso --capabilities EnableNoSQLVectorSearch=true')
    expect(err(badCapability)).toContain('without values')
    expect(badCapability.sandbox).toBe(account)
    const database = runLine(account, 'az cosmosdb sql database create -g rg-cosmos -a cosmos-contoso -n catalog').sandbox
    const filePolicy = runLine(database, 'az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso -d catalog -n products -p /category --vector-embeddings @policy.json --idx @index.json')
    expect(err(filePolicy)).toContain('inline JSON')
    expect(filePolicy.sandbox).toBe(database)
    expect(filePolicy.events).toEqual([])
  })

  it.each([
    ['a null embedding policy', 'null', INDEXING, 'must be a JSON object'],
    ['an array embedding policy', '[]', INDEXING, 'must be a JSON object'],
    ['an unsupported vector type', '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float64","dimensions":8,"distanceFunction":"cosine"}]}', INDEXING, 'Unsupported vector data type'],
    ['zero vector dimensions', '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float32","dimensions":0,"distanceFunction":"cosine"}]}', INDEXING, 'positive integer'],
    ['duplicate vector embedding paths', '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float32","dimensions":8,"distanceFunction":"cosine"},{"path":"/embedding","dataType":"float32","dimensions":8,"distanceFunction":"cosine"}]}', INDEXING, 'Duplicate vector embedding path'],
    ['a flat index over 505 dimensions', '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float32","dimensions":506,"distanceFunction":"cosine"}]}', '{"includedPaths":[{"path":"/*"}],"excludedPaths":[],"vectorIndexes":[{"path":"/embedding","type":"flat"}]}', 'at most 505 dimensions'],
    ['duplicate vector index paths', '{"vectorEmbeddings":[{"path":"/embedding","dataType":"float32","dimensions":8,"distanceFunction":"cosine"}]}', '{"includedPaths":[{"path":"/*"}],"excludedPaths":[],"vectorIndexes":[{"path":"/embedding","type":"diskANN"},{"path":"/embedding","type":"diskANN"}]}', 'Duplicate vector index path'],
  ])('rejects %s atomically', (_description, embeddings, indexing, expected) => {
    const sandbox = withDatabase()
    const result = runLine(sandbox, `az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --vector-embeddings '${embeddings}' --idx '${indexing}'`)
    expect(err(result)).toContain(expected)
    expect(result.sandbox).toBe(sandbox)
    expect(result.events).toEqual([])
  })

  it('rejects unsupported regions and child names, while re-creating parents preserves children', () => {
    const group = runLine(createSandbox(), 'az group create -n rg-cosmos -l westeurope').sandbox
    const badRegion = runLine(group, 'az cosmosdb create -g rg-cosmos -n cosmos-region --locations regionName=moon')
    expect(err(badRegion)).toContain("location 'moon'")
    expect(badRegion.sandbox).toBe(group)
    const account = runLine(group, 'az cosmosdb create -g rg-cosmos -n cosmos-contoso').sandbox
    const badDatabase = runLine(account, 'az cosmosdb sql database create -g rg-cosmos -a cosmos-contoso -n catalog/products')
    expect(err(badDatabase)).toContain('SQL database name')
    expect(badDatabase.sandbox).toBe(account)
    let sandbox = runLine(account, 'az cosmosdb sql database create -g rg-cosmos -a cosmos-contoso -n catalog').sandbox
    sandbox = runLine(sandbox, 'az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso -d catalog -n products -p /category').sandbox
    const recreated = runLine(sandbox, 'az cosmosdb create -g rg-cosmos -n cosmos-contoso')
    expect(recreated.sandbox.cosmosAccounts[0].databases[0].containers[0]).toMatchObject({ name: 'products', partitionKeyPath: '/category' })
  })

  it('rejects duplicate location keys as a multi-region account configuration', () => {
    const sandbox = runLine(createSandbox(), 'az group create -n rg-cosmos -l westeurope').sandbox
    const result = runLine(sandbox, 'az cosmosdb create -g rg-cosmos -n cosmos-contoso --locations regionName=westeurope failoverPriority=0 isZoneRedundant=False regionName=northeurope')
    expect(err(result)).toContain('duplicate regionName')
    expect(result.sandbox).toBe(sandbox)
    expect(result.events).toEqual([])
  })

  it('rejects repeated --locations flags as a multi-region account configuration', () => {
    const sandbox = runLine(createSandbox(), 'az group create -n rg-cosmos -l westeurope').sandbox
    const result = runLine(sandbox, 'az cosmosdb create -g rg-cosmos -n cosmos-contoso --locations regionName=westeurope --locations regionName=northeurope')
    expect(err(result)).toContain('duplicate regionName')
    expect(result.sandbox).toBe(sandbox)
    expect(result.events).toEqual([])
  })

  it('keeps container configuration immutable while allowing an identical create', () => {
    const created = runLine(withDatabase(), `az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --vector-embeddings '${EMBEDDINGS}' --idx '${INDEXING}'`)
    const identical = runLine(created.sandbox, `az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category --vector-embeddings '${EMBEDDINGS}' --idx '${INDEXING}'`)
    expect(err(identical)).toBe('')
    expect(identical.events).toEqual([{ type: 'updated', resourceType: 'cosmosContainer', name: 'products', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog', database: 'catalog' }])
    const conflict = runLine(created.sandbox, `az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /different --vector-embeddings '${EMBEDDINGS}' --idx '${INDEXING}'`)
    expect(err(conflict)).toContain('delete and recreate')
    expect(conflict.sandbox).toBe(created.sandbox)
  })

  it('lists, reads, deletes and cascades every Cosmos level', () => {
    const created = runLine(withDatabase(), 'az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category')
    expect(JSON.parse(out(runLine(created.sandbox, 'az cosmosdb list -g rg-cosmos')))).toHaveLength(1)
    expect(JSON.parse(out(runLine(created.sandbox, 'az cosmosdb sql database list -g rg-cosmos -a cosmos-contoso-catalog')))).toHaveLength(1)
    expect(JSON.parse(out(runLine(created.sandbox, 'az cosmosdb sql container show -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products'))).name).toBe('products')
    const blocked = runLine(created.sandbox, 'az cosmosdb delete -g rg-cosmos -n cosmos-contoso-catalog')
    expect(err(blocked)).toContain('Pass --yes')
    const deleted = runLine(created.sandbox, 'az cosmosdb sql database delete -g rg-cosmos -a cosmos-contoso-catalog -n catalog --yes')
    expect(deleted.sandbox.cosmosAccounts[0].databases).toEqual([])
    const cascaded = runLine(created.sandbox, 'az group delete -n rg-cosmos --yes')
    expect(cascaded.sandbox.cosmosAccounts).toEqual([])
  })

  it('presents SQL database throughput as empty options', () => {
    const result = runLine(withDatabase(), 'az cosmosdb sql database show -g rg-cosmos -a cosmos-contoso-catalog -n catalog')
    expect(JSON.parse(out(result))).toMatchObject({ name: 'catalog', location: 'westeurope', options: {}, resource: { id: 'catalog' } })
  })

  it('emits updated and preserves containers when a SQL database is created again', () => {
    let sandbox = withDatabase()
    sandbox = runLine(sandbox, 'az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category').sandbox
    const repeated = runLine(sandbox, 'az cosmosdb sql database create -g rg-cosmos -a cosmos-contoso-catalog -n catalog')
    expect(repeated.events).toEqual([{ type: 'updated', resourceType: 'cosmosDatabase', name: 'catalog', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog' }])
    expect(repeated.sandbox.cosmosAccounts[0].databases[0].containers).toHaveLength(1)
  })
})
