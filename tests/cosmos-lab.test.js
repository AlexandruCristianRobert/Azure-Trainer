import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { runLine } from '../src/lib/az/shell.js'
import { labById } from '../src/data/labs/index.js'
import { useLabRunStore } from '../src/stores/labRun.js'
import { useProgressStore } from '../src/stores/progress.js'
import { fakeLocalStorage } from './helpers/fakeLocalStorage.js'

const LAB = 'cosmos-vector-search'
const opts = { sleep: () => Promise.resolve() }
function apply(sandbox, command) {
  const result = runLine(sandbox, command)
  expect(result.lines.filter((line) => line.kind === 'err'), command).toEqual([])
  return result.sandbox
}
function throughTask(count) {
  const lab = labById(LAB)
  expect(lab.tasks).toHaveLength(5)
  return lab.tasks.slice(0, count).reduce((sandbox, task) => apply(sandbox, task.solution), createSandbox())
}
const container = (sandbox) => sandbox.cosmosAccounts[0].databases[0].containers[0]

describe('Cosmos DB vector search Lab', () => {
  beforeEach(() => {
    globalThis.localStorage = fakeLocalStorage()
    setActivePinia(createPinia())
  })

  it('is available and each Solution completes exactly the next Task', () => {
    const lab = labById(LAB)
    expect(lab.status).toBe('available')
    expect(lab.tasks).toHaveLength(5)
    let sandbox = lab.seed(createSandbox())
    expect(lab.tasks.map((t) => t.check(sandbox))).toEqual([false, false, false, false, false])
    lab.tasks.forEach((task, index) => {
      sandbox = apply(sandbox, task.solution)
      expect(lab.tasks.map((t) => t.check(sandbox))).toEqual([0, 1, 2, 3, 4].map((i) => i <= index))
    })
  })

  it('does not count an ordinary container without a vector policy', () => {
    const lab = labById(LAB)
    const sandbox = apply(throughTask(4), 'az cosmosdb sql container create -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products -p /category')
    expect(lab.tasks[4].check(sandbox)).toBe(false)
  })

  it.each([
    ['partition key', (c) => { c.partitionKeyPath = '/tenantId' }],
    ['throughput', (c) => { c.throughput = 800 }],
    ['vector path', (c) => { c.vectorEmbeddingPolicy.vectorEmbeddings[0].path = '/Embedding' }],
    ['dimensions', (c) => { c.vectorEmbeddingPolicy.vectorEmbeddings[0].dimensions = 768 }],
    ['data type', (c) => { c.vectorEmbeddingPolicy.vectorEmbeddings[0].dataType = 'int8' }],
    ['distance function', (c) => { c.vectorEmbeddingPolicy.vectorEmbeddings[0].distanceFunction = 'euclidean' }],
    ['index type', (c) => { c.indexingPolicy.vectorIndexes[0].type = 'quantizedFlat' }],
    ['index path', (c) => { c.indexingPolicy.vectorIndexes[0].path = '/other' }],
    ['vector exclusion', (c) => { c.indexingPolicy.excludedPaths = [{ path: '/_etag/?' }] }],
    ['indexing mode', (c) => { c.indexingPolicy.indexingMode = 'none' }],
  ])('rejects a near miss in %s', (_description, change) => {
    const sandbox = throughTask(5)
    change(container(sandbox))
    expect(labById(LAB).tasks[4].check(sandbox)).toBe(false)
  })

  it('checks full resource ancestry, capability and case-sensitive database/container IDs', () => {
    const lab = labById(LAB)
    const sandbox = throughTask(5)
    const account = sandbox.cosmosAccounts[0]
    account.resourceGroup = 'rg-other'
    expect(lab.tasks.slice(1).map((t) => t.check(sandbox))).toEqual([false, false, false, false])
    account.resourceGroup = 'RG-COSMOS'
    expect(lab.tasks.every((t) => t.check(sandbox))).toBe(true)
    account.capabilities = []
    expect(lab.tasks[2].check(sandbox)).toBe(false)
    expect(lab.tasks[4].check(sandbox)).toBe(false)
    account.capabilities = ['EnableNoSQLVectorSearch']
    account.databases[0].name = 'Catalog'
    expect(lab.tasks[3].check(sandbox)).toBe(false)
    expect(lab.tasks[4].check(sandbox)).toBe(false)
    account.databases[0].name = 'catalog'
    container(sandbox).name = 'Products'
    expect(lab.tasks[4].check(sandbox)).toBe(false)
    container(sandbox).name = 'products'
    sandbox.resourceGroups = []
    expect(lab.tasks.every((t) => !t.check(sandbox))).toBe(true)
  })

  it('allows enabling the vector capability during account creation', () => {
    const lab = labById(LAB)
    let sandbox = throughTask(1)
    sandbox = apply(sandbox, lab.tasks[1].solution + ' --capabilities EnableNoSQLVectorSearch')
    expect(lab.tasks.map((t) => t.check(sandbox))).toEqual([true, true, true, false, false])
  })

  it('can recover from a wrongly configured container by deleting and applying the Solution', () => {
    const lab = labById(LAB)
    let sandbox = throughTask(4)
    sandbox = apply(sandbox, lab.tasks[4].solution.replace('"dimensions":1536', '"dimensions":768'))
    expect(lab.tasks[4].check(sandbox)).toBe(false)
    sandbox = apply(sandbox, 'az cosmosdb sql container delete -g rg-cosmos -a cosmos-contoso-catalog -d catalog -n products --yes')
    sandbox = apply(sandbox, lab.tasks[4].solution)
    expect(lab.tasks.every((t) => t.check(sandbox))).toBe(true)
  })

  it('resumes, completes once and restarts independently of the previous Lab', async () => {
    let run = useLabRunStore()
    run.load(LAB)
    expect(run.total).toBe(5)
    for (const task of run.lab.tasks.slice(0, 4)) await run.execute(task.solution, opts)
    run.revealHint('vector-container')
    run.revealSolution('vector-container')
    run.tick(1000)
    run.tick(4000)
    run.pauseTimer()
    run.load('containerapps-keda')
    expect(run.sandbox.cosmosAccounts).toEqual([])
    await run.execute(run.lab.tasks[0].solution, opts)
    setActivePinia(createPinia())
    run = useLabRunStore()
    run.load(LAB)
    expect(run.doneCount).toBe(4)
    expect(run.elapsedMs).toBe(3000)
    expect(run.hintsUsed).toBe(1)
    expect(run.solutionsUsed).toBe(1)
    await run.execute(run.lab.tasks[4].solution, opts)
    expect(run.isComplete).toBe(true)
    const progress = useProgressStore()
    expect(progress.results).toHaveLength(1)
    expect(progress.results[0]).toMatchObject({ labId: LAB, tasksDone: 5, total: 5, hintsUsed: 1, solutionsUsed: 1, durationMs: 3000 })
    expect(progress.skillAreaProgress('data')).toEqual({ total: 1, completed: 1, inProgress: 0 })
    run.load(LAB)
    expect(run.isComplete).toBe(true)
    await run.execute('az cosmosdb show -g rg-cosmos -n cosmos-contoso-catalog', opts)
    expect(progress.results).toHaveLength(1)
    run.restart()
    expect(run.doneCount).toBe(0)
    expect(run.sandbox.cosmosAccounts).toEqual([])
    expect(progress.results).toHaveLength(1)
    run.load('containerapps-keda')
    expect(run.doneCount).toBe(1)
  })

  it('normalizes pre-Cosmos saves and retains existing Lab progress', async () => {
    const run = useLabRunStore()
    run.load('containerapps-keda')
    await run.execute(run.lab.tasks[0].solution, opts)
    const key = 'at_run_containerapps-keda'
    const saved = JSON.parse(localStorage.getItem(key))
    delete saved.sandbox.cosmosAccounts
    localStorage.setItem(key, JSON.stringify(saved))
    run.load('containerapps-keda')
    expect(run.doneCount).toBe(1)
    expect(run.sandbox.cosmosAccounts).toEqual([])
    expect(JSON.parse(localStorage.getItem(key)).sandbox.cosmosAccounts).toEqual([])
  })

  it.each([
    ['embedding collection', (c) => { c.vectorEmbeddingPolicy.vectorEmbeddings = {} }],
    ['embedding entry', (c) => { c.vectorEmbeddingPolicy.vectorEmbeddings = [null] }],
    ['index collection', (c) => { c.indexingPolicy.vectorIndexes = {} }],
    ['index entry', (c) => { c.indexingPolicy.vectorIndexes = [null] }],
    ['excluded paths collection', (c) => { c.indexingPolicy.excludedPaths = {} }],
    ['excluded path entry', (c) => { c.indexingPolicy.excludedPaths = [null] }],
    ['included paths collection', (c) => { c.indexingPolicy.includedPaths = {} }],
    ['included path entry', (c) => { c.indexingPolicy.includedPaths = [null] }],
  ])('rejects a saved container with malformed %s before Home or Lab rendering', (_label, corrupt) => {
    const sandbox = throughTask(5)
    corrupt(container(sandbox))
    localStorage.setItem(`at_run_${LAB}`, JSON.stringify({ labId: LAB, sandbox }))
    expect(useProgressStore().runSummary(LAB)).toBeNull()
    const run = useLabRunStore()
    run.load(LAB)
    expect(run.doneCount).toBe(0)
    expect(run.sandbox.cosmosAccounts).toEqual([])
  })

  it.each([
    ['non-array collection', {}],
    ['null account', [null]],
    ['incomplete account', [{}]],
  ])('discards a malformed Cosmos save (%s) and handles legacy Home progress safely', (_label, accounts) => {
    const sandbox = createSandbox()
    sandbox.resourceGroups.push({ name: 'rg-old-save', location: 'westeurope' })
    sandbox.cosmosAccounts = accounts
    localStorage.setItem(`at_run_${LAB}`, JSON.stringify({ labId: LAB, sandbox }))
    expect(useProgressStore().runSummary(LAB)).toBeNull()
    const run = useLabRunStore()
    run.load(LAB)
    expect(run.sandbox.cosmosAccounts).toEqual([])
    expect(run.sandbox.resourceGroups).toEqual([])
    expect(run.doneCount).toBe(0)
    delete sandbox.cosmosAccounts
    localStorage.setItem(`at_run_${LAB}`, JSON.stringify({ labId: LAB, sandbox }))
    expect(useProgressStore().runSummary(LAB)).toMatchObject({ tasksDone: 0, total: 5 })
  })
})
