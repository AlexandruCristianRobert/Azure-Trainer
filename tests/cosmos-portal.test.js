import { describe, expect, it } from 'vitest'
import { resolveBlade } from '../src/lib/bladeResolve.js'
import { bladeForEvent, notificationForEvent } from '../src/stores/portal.js'

const LIST = { kind: 'resource-groups' }
const GROUP = { kind: 'resource-group', name: 'rg-cosmos' }
const ACCOUNT = { kind: 'cosmos-account', resourceGroup: 'rg-cosmos', name: 'cosmos-contoso-catalog' }
const DATABASE = { kind: 'cosmos-database', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog', name: 'catalog' }
const CONTAINER = { kind: 'cosmos-container', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog', database: 'catalog', name: 'products' }

const sandbox = {
  resourceGroups: [{ name: 'RG-Cosmos', location: 'westeurope', tags: null, createdAt: '2026-09-21T10:00:00.000Z' }],
  namespaces: [],
  containerAppEnvironments: [],
  containerApps: [],
  cosmosAccounts: [{
    name: 'Cosmos-Contoso-Catalog',
    resourceGroup: 'RG-Cosmos',
    location: 'westeurope',
    kind: 'GlobalDocumentDB',
    defaultConsistencyLevel: 'Session',
    capabilities: ['EnableNoSQLVectorSearch'],
    tags: null,
    createdAt: '2026-09-21T10:01:00.000Z',
    databases: [{
      name: 'catalog',
      createdAt: '2026-09-21T10:02:00.000Z',
      containers: [{
        name: 'products',
        partitionKeyPath: '/category',
        throughput: 400,
        vectorEmbeddingPolicy: { vectorEmbeddings: [{ path: '/embedding', dataType: 'float32', dimensions: 1536, distanceFunction: 'cosine' }] },
        indexingPolicy: {
          indexingMode: 'consistent',
          automatic: true,
          includedPaths: [{ path: '/*' }],
          excludedPaths: [{ path: '/embedding/*' }],
          vectorIndexes: [{ path: '/embedding', type: 'diskANN' }],
        },
        createdAt: '2026-09-21T10:03:00.000Z',
      }],
    }],
  }],
  defaults: { group: null, location: null },
}

describe('Cosmos event navigation', () => {
  it('focuses the resource represented by create and update events', () => {
    expect(bladeForEvent({ type: 'created', resourceType: 'cosmosAccount', resourceGroup: 'rg-cosmos', name: 'cosmos-contoso-catalog' }, LIST)).toEqual(ACCOUNT)
    expect(bladeForEvent({ type: 'created', resourceType: 'cosmosDatabase', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog', name: 'catalog' }, LIST)).toEqual(DATABASE)
    expect(bladeForEvent({ type: 'updated', resourceType: 'cosmosContainer', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog', database: 'catalog', name: 'products' }, LIST)).toEqual(CONTAINER)
  })

  it('falls back to the nearest parent when the focused resource is deleted', () => {
    expect(bladeForEvent({ type: 'deleted', resourceType: 'cosmosContainer', resourceGroup: 'RG-COSMOS', account: 'COSMOS-CONTOSO-CATALOG', database: 'catalog', name: 'products' }, CONTAINER)).toEqual(DATABASE)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'cosmosDatabase', resourceGroup: 'RG-COSMOS', account: 'COSMOS-CONTOSO-CATALOG', name: 'catalog' }, DATABASE)).toEqual(ACCOUNT)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'cosmosAccount', resourceGroup: 'RG-COSMOS', name: 'COSMOS-CONTOSO-CATALOG' }, ACCOUNT)).toEqual(GROUP)
  })

  it('falls back when a deleted parent contains the current descendant', () => {
    expect(bladeForEvent({ type: 'deleted', resourceType: 'cosmosDatabase', resourceGroup: 'RG-COSMOS', account: 'COSMOS-CONTOSO-CATALOG', name: 'catalog' }, CONTAINER)).toEqual(ACCOUNT)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'cosmosAccount', resourceGroup: 'RG-COSMOS', name: 'COSMOS-CONTOSO-CATALOG' }, CONTAINER)).toEqual(GROUP)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'resourceGroup', resourceGroup: 'RG-COSMOS', name: 'RG-COSMOS' }, CONTAINER)).toEqual(LIST)
  })

  it('keeps database and container identity case sensitive on deletion', () => {
    expect(bladeForEvent({ type: 'deleted', resourceType: 'cosmosDatabase', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog', name: 'Catalog' }, CONTAINER)).toEqual(CONTAINER)
    expect(bladeForEvent({ type: 'deleted', resourceType: 'cosmosContainer', resourceGroup: 'rg-cosmos', account: 'cosmos-contoso-catalog', database: 'catalog', name: 'Products' }, CONTAINER)).toEqual(CONTAINER)
  })

  it('phrases Cosmos notifications with their parent context', () => {
    expect(notificationForEvent({ type: 'created', resourceType: 'cosmosAccount', name: 'cosmos-contoso-catalog' })).toEqual({ title: 'Deployment succeeded', text: "Created Cosmos DB account 'cosmos-contoso-catalog'." })
    expect(notificationForEvent({ type: 'created', resourceType: 'cosmosDatabase', account: 'cosmos-contoso-catalog', name: 'catalog' })).toEqual({ title: 'Deployment succeeded', text: "Created Cosmos DB database 'catalog' in cosmos-contoso-catalog." })
    expect(notificationForEvent({ type: 'deleted', resourceType: 'cosmosContainer', database: 'catalog', name: 'products' })).toEqual({ title: 'Deleted', text: "Deleted Cosmos DB container 'products' in catalog." })
  })
})

describe('Cosmos Blade resolution', () => {
  it('resolves group and account names case insensitively and descendant names exactly', () => {
    expect(resolveBlade(ACCOUNT, sandbox)).toEqual(ACCOUNT)
    expect(resolveBlade(DATABASE, sandbox)).toEqual(DATABASE)
    expect(resolveBlade(CONTAINER, sandbox)).toEqual(CONTAINER)
    expect(resolveBlade({ ...DATABASE, name: 'Catalog' }, sandbox)).toEqual(ACCOUNT)
    expect(resolveBlade({ ...CONTAINER, name: 'Products' }, sandbox)).toEqual(DATABASE)
  })

  it('falls back to the nearest ancestor that remains', () => {
    const noContainers = { ...sandbox, cosmosAccounts: [{ ...sandbox.cosmosAccounts[0], databases: [{ ...sandbox.cosmosAccounts[0].databases[0], containers: [] }] }] }
    const noDatabases = { ...sandbox, cosmosAccounts: [{ ...sandbox.cosmosAccounts[0], databases: [] }] }
    const noAccounts = { ...sandbox, cosmosAccounts: [] }
    expect(resolveBlade(CONTAINER, noContainers)).toEqual(DATABASE)
    expect(resolveBlade(CONTAINER, noDatabases)).toEqual(ACCOUNT)
    expect(resolveBlade(CONTAINER, noAccounts)).toEqual(GROUP)
    expect(resolveBlade(CONTAINER, { ...noAccounts, resourceGroups: [] })).toEqual(LIST)
  })

  it('handles legacy saves without a Cosmos account collection', () => {
    const legacy = { resourceGroups: sandbox.resourceGroups, namespaces: [], defaults: sandbox.defaults }
    expect(resolveBlade(ACCOUNT, legacy)).toEqual(GROUP)
    expect(resolveBlade(DATABASE, legacy)).toEqual(GROUP)
    expect(resolveBlade(CONTAINER, legacy)).toEqual(GROUP)
  })
})
