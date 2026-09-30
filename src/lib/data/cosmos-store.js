// Cosmos DB for NoSQL data-plane store: pure functions over Sandbox containers'
// `items` array. Mirrors the immutability style of `src/lib/sandbox/cosmosdb.js`
// (every mutation clones the Sandbox and returns a new one).
import { cloneSandbox } from '../sandbox/model.js'

function findAccountByName(sandbox, name) {
  return (sandbox.cosmosAccounts ?? []).find((account) => account.name === name)
}

export function findContainer(sandbox, { account, database, container }) {
  const foundAccount = findAccountByName(sandbox, account)
  const foundDatabase = foundAccount?.databases.find((item) => item.name === database)
  return foundDatabase?.containers.find((item) => item.name === container)
}

function requireContainer(sandbox, ref) {
  const container = findContainer(sandbox, ref)
  if (!container) throw new Error(`Container '${ref.container}' was not found in database '${ref.database}'.`)
  return container
}

export function partitionValue(container, item) {
  return container.partitionKeyPath.split('/').filter(Boolean).reduce((value, key) => (value == null ? undefined : value[key]), item)
}

export function itemsInScope(container, partitionKeyValue) {
  const items = container.items ?? []
  if (partitionKeyValue === undefined) return items.slice()
  return items.filter((item) => partitionValue(container, item) === partitionKeyValue)
}

export function readItem(sandbox, ref, id, partitionKeyValue) {
  const container = findContainer(sandbox, ref)
  if (!container) return undefined
  return itemsInScope(container, partitionKeyValue).find((item) => item.id === id)
}

const META_KEYS = ['_version', '_ts', '_previous', '_lsn']

function stripMeta(item) {
  const copy = { ...item }
  for (const key of META_KEYS) delete copy[key]
  return copy
}

function nextLsn(container) {
  return (container.items ?? []).reduce((max, item) => Math.max(max, item._lsn ?? 0), 0) + 1
}

export function upsertItem(sandbox, ref, body, { nowMs }) {
  requireContainer(sandbox, ref)
  const next = cloneSandbox(sandbox)
  const container = findContainer(next, ref)
  if (!Array.isArray(container.items)) container.items = []
  const bodyPartition = partitionValue(container, body)
  const existingIndex = container.items.findIndex((item) => item.id === body.id && partitionValue(container, item) === bodyPartition)
  const lsn = nextLsn(container)
  let item
  let created
  if (existingIndex === -1) {
    item = { ...stripMeta(body), _version: 1, _ts: nowMs, _previous: null, _lsn: lsn }
    container.items.push(item)
    created = true
  } else {
    const previous = container.items[existingIndex]
    item = { ...stripMeta(body), _version: (previous._version ?? 0) + 1, _ts: nowMs, _previous: stripMeta(previous), _lsn: lsn }
    container.items[existingIndex] = item
    created = false
  }
  return { sandbox: next, item, created }
}
