import { canonicalize } from '../evidence.js'
import { sourceTextHash } from '../sourceJournal.js'
import { fail } from '../errors.js'
import { SUBSCRIPTION_ID } from '../../sandbox/model.js'
import { tokenize } from '../../az/tokenize.js'
import { buildTree } from '../../az/commands/index.js'
import { parseArgs } from '../../az/args.js'
import { runLine } from '../../az/shell.js'

const same = (a, b) => canonicalize(a) === canonicalize(b)
const normalize = id => id.toLowerCase().replace(/\/+$/, '')
const hash = value => sourceTextHash(canonicalize(value))
const groupType = 'Microsoft.Resources/resourceGroups'
const providers = { postgresServers: 'Microsoft.DBforPostgreSQL/flexibleServers', cosmosAccounts: 'Microsoft.DocumentDB/databaseAccounts',
  redisClusters: 'Microsoft.Cache/redisEnterprise', aksClusters: 'Microsoft.ContainerService/managedClusters',
  containerRegistries: 'Microsoft.ContainerRegistry/registries' }
const ownedTypes = new Set([groupType, ...['postgresServers', 'cosmosAccounts', 'redisClusters'].map(key => providers[key]), 'Deployment'])
const groupId = name => normalize(`/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${name}`)
const armId = (type, group, name) => normalize(`${groupId(group)}/providers/${type}/${name}`)
const kubeId = (clusterId, kind, namespace, name) => normalize(`${clusterId}/kubernetes/${kind}/${namespace ?? ''}/${name}`)
const identity = row => ({ resourceId: row.resourceId, type: row.type, uid: row.uid ?? null })

function inventory(run) {
  const rows = []
  for (const [collection, values] of Object.entries(run.sandbox)) {
    if (!Array.isArray(values)) continue
    for (const item of values) {
      if (collection === 'resourceGroups') rows.push({ resourceId: groupId(item.name), type: groupType, resourceGroup: item.name })
      else if (item.resourceGroup) {
        const type = providers[collection] ?? `sandbox/${collection}`
        rows.push({ resourceId: normalize(item.id ?? armId(type, item.resourceGroup, item.name)), type, resourceGroup: item.resourceGroup })
      } else if (typeof item.id === 'string') rows.push({ resourceId: normalize(item.id), type: providers[collection] ?? `sandbox/${collection}` })
    }
  }
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes?.clusters ?? {})) {
    for (const item of Object.values(state.resources)) {
      if (['Pod', 'ReplicaSet', 'EndpointSlice'].includes(item.kind)) continue
      rows.push({ resourceId: kubeId(clusterId, item.kind, item.metadata.namespace, item.metadata.name), type: item.kind, uid: item.metadata.uid })
    }
  }
  return rows
}
export function dataProtectedRefs(run) { return inventory(run).map(identity) }

function lastCreation(run, resourceId) { return run.stages.data.creationReceipts.filter(row => row.resourceId === resourceId).at(-1) }
function deletionFor(run, creation) { return run.stages.data.deletionReceipts.find(row => row.createdSequence === creation.sequence) }
function ownedLive(run, row) {
  const creation = lastCreation(run, row.resourceId)
  return !!creation && !deletionFor(run, creation) && same(creation.after, identity(row))
    && !run.stages.data.protectedRefs.some(ref => ref.resourceId === row.resourceId)
}
export function dataCleanupInventory(run, lab) {
  const live = inventory(run)
  const row = (item, protectedRef = false) => ({ resourceId: item.resourceId, type: item.type,
    createdSequence: protectedRef ? null : lastCreation(run, item.resourceId)?.sequence ?? null, protected: protectedRef })
  return { owned: live.filter(item => ownedLive(run, item)).map(item => row(item)),
    protected: run.stages.data.protectedRefs.map(item => row(item, true)),
    unowned: live.filter(item => !ownedLive(run, item) && !run.stages.data.protectedRefs.some(ref => ref.resourceId === item.resourceId)).map(item => row(item)),
    protectedIntact: run.stages.data.protectedRefs.every(ref => live.some(item => same(identity(item), ref))) }
}

function azureCommand(run, tokens) {
  let node = buildTree(), index = 1
  while (node?.type === 'group' && index < tokens.length) node = node.children[tokens[index++]]
  if (node?.type !== 'command') return null
  const args = parseArgs(node.args, tokens.slice(index), run.sandbox.defaults)
  return args.error || args.wantsHelp ? null : { path: node.path.join(' '), values: args.values }
}
function deploymentDelete(run, tokens) {
  if (tokens[0] !== 'kubectl' || tokens[1] !== 'delete' || !['deployment', 'deployments', 'deploy'].includes(tokens[2]) || !tokens[3] || tokens[3].startsWith('-')) return null
  const flags = {}
  for (let i = 4; i < tokens.length; i += 2) {
    const key = { '-n': 'namespace', '--namespace': 'namespace', '--context': 'context' }[tokens[i]]
    if (!key || flags[key] || !tokens[i + 1] || tokens[i + 1].startsWith('-')) return null
    flags[key] = tokens[i + 1]
  }
  const context = run.runtime.kubernetes?.contexts[flags.context ?? run.runtime.kubernetes.currentContext]
  return context ? kubeId(context.clusterId, 'Deployment', flags.namespace ?? context.namespace, tokens[3]) : null
}
function commandTarget(run, line) {
  const parsed = tokenize(line)
  if (parsed.error) return { destructive: true, id: null }
  const tokens = parsed.tokens
  if (tokens[0] === 'kubectl') return { destructive: tokens[1] === 'delete', id: deploymentDelete(run, tokens), tokens }
  if (tokens[0] !== 'az') return { destructive: false, id: null, tokens }
  const command = azureCommand(run, tokens)
  if (!command) return { destructive: tokens.includes('delete'), id: null, tokens }
  const { path, values } = command
  const type = { 'postgres flexible-server delete': providers.postgresServers, 'cosmosdb delete': providers.cosmosAccounts,
    'redisenterprise delete': providers.redisClusters }[path]
  return { destructive: path.endsWith(' delete'), id: path === 'group delete' ? groupId(values.name)
    : type ? armId(type, values.resourceGroup, values.name) : null, path, tokens }
}
function workloadId(lab, target) { return target && kubeId(target.clusterId, 'Deployment', target.namespace, target.deploymentName) }
function deleteAllowed(run, target, lab) {
  if (!target.id) return false
  const live = inventory(run), row = live.find(item => item.resourceId === target.id)
  if (!row || !ownedLive(run, row)) return false
  if (row.type === 'Deployment') return [lab.dataRequestTarget, lab.dataWorkerTarget].some(item => workloadId(lab, item) === row.resourceId)
  if (!run.stages.cleanupCheckpoint) return false
  if (row.type === groupType) return live.filter(item => item.resourceGroup?.toLowerCase() === row.resourceGroup.toLowerCase()).every(item => ownedLive(run, item))
  return ownedTypes.has(row.type)
}
/** Called by the actual command primitive, including trusted incident commands. */
export function dataCommandAllowed(run, action, lab) {
  const target = commandTarget(run, action.line)
  return target.destructive ? deleteAllowed(run, target, lab) : !run.stages.cleanupCheckpoint || dataFrozenActionAllowed(run, action, lab)
}
export function dataFrozenActionAllowed(run, action, lab) {
  if (action.type !== 'command' || typeof action.line !== 'string' || Object.keys(action).length !== 2) return false
  const target = commandTarget(run, action.line)
  if (target.destructive) return deleteAllowed(run, target, lab)
  return target.tokens?.[0] === 'az' && /(?:^| )(?:show|list|exists)$/.test(target.path ?? '')
    || target.tokens?.[0] === 'kubectl' && ['get', 'describe', 'logs'].includes(target.tokens[1])
}

const receipt = value => ({ ...value, receiptHash: hash(value) })
/** Successful supported results plus real before/after inventories are the only capture input. */
export function captureDataOwnership(before, after, commandResult, lab) {
  if (commandResult.lines?.some(line => line.kind === 'err') || commandResult.diagnostics?.length) return after
  const previous = inventory(before), current = inventory(after)
  const created = [...after.stages.data.creationReceipts], deleted = [...after.stages.data.deletionReceipts]
  let nextSequence = after.nextSequence
  const command = commandResult.command ?? ''
  const parsed = tokenize(command)
  const az = !parsed.error && parsed.tokens[0] === 'az' ? azureCommand(before, parsed.tokens) : null
  const createTypes = { 'group create': groupType, 'postgres flexible-server create': providers.postgresServers,
    'cosmosdb create': providers.cosmosAccounts, 'redisenterprise create': providers.redisClusters }
  const mayCreate = item => az && createTypes[az.path] === item.type
    && item.resourceId === (item.type === groupType ? groupId(az.values.name) : armId(item.type, az.values.resourceGroup, az.values.name))
    && commandResult.events?.some(event => event.type === 'created'
    && event.name?.toLowerCase() === (az.values.name ?? '').toLowerCase())
    || item.type === 'Deployment' && parsed.tokens?.[0] === 'kubectl' && parsed.tokens[1] === 'apply'
      && [lab.dataRequestTarget, lab.dataWorkerTarget].some(target => workloadId(lab, target) === item.resourceId)
  for (const item of current) if (ownedTypes.has(item.type) && !previous.some(row => row.resourceId === item.resourceId)
    && !before.stages.data.protectedRefs.some(ref => ref.resourceId === item.resourceId) && mayCreate(item)) {
    created.push(receipt({ sequence: nextSequence++, attemptId: before.attemptId, resourceId: item.resourceId, type: item.type,
      before: null, after: identity(item), command }))
  }
  for (const item of previous) if (!current.some(row => row.resourceId === item.resourceId) && ownedLive(before, item)) {
    const creation = lastCreation(before, item.resourceId)
    if (deleted.some(row => row.createdSequence === creation.sequence)) continue
    deleted.push(receipt({ sequence: nextSequence++, attemptId: before.attemptId, resourceId: item.resourceId, type: item.type,
      createdSequence: creation.sequence, before: identity(item), after: null,
      purpose: before.stages.cleanupCheckpoint ? 'cleanup' : 'maintenance', command }))
  }
  const workerDeleted = previous.some(row => row.resourceId === workloadId(lab, lab.dataWorkerTarget))
    && !current.some(row => row.resourceId === workloadId(lab, lab.dataWorkerTarget))
  return { ...after, nextSequence,
    ...(workerDeleted ? { runtime: { ...after.runtime, dataCapstone: { ...after.runtime.dataCapstone, worker: { lastBatch: [], artifactId: null } } } } : {}),
    stages: { ...after.stages, data: { ...after.stages.data, creationReceipts: created, deletionReceipts: deleted } } }
}

/** No caller permission token: reproduce the exact supported owned Deployment delete. */
export function dataOwnedDeletionEffect(run, effects, lab) {
  if (effects.length !== 1 || effects[0]?.type !== 'kubernetes-state') return null
  for (const target of [lab.dataRequestTarget, lab.dataWorkerTarget]) {
    if (!target) continue
    const contextName = Object.keys(run.runtime.kubernetes?.contexts ?? {}).find(name => run.runtime.kubernetes.contexts[name].clusterId === target.clusterId)
    if (!contextName) continue
    const command = `kubectl delete deployment ${target.deploymentName} -n ${target.namespace} --context ${contextName}`
    if (!dataCommandAllowed(run, { type: 'command', line: command }, lab)) continue
    const result = runLine(run.sandbox, command, { run, lab })
    if (result.effects && same(result.effects, effects)) return { ...result, command }
  }
  return null
}
export function validateDataOwnership(run, lab) {
  const data = run.stages.data, live = inventory(run)
  if (new Set(data.protectedRefs.map(ref => ref.resourceId)).size !== data.protectedRefs.length
    || data.protectedRefs.some(ref => !live.some(row => same(identity(row), ref)))) fail('INVALID_RUN', 'Supplied Data prerequisites must remain intact.')
  for (const record of [...data.creationReceipts, ...data.deletionReceipts]) {
    const { receiptHash, ...body } = record
    if (receiptHash !== hash(body) || record.attemptId !== run.attemptId || !ownedTypes.has(record.type)
      || record.resourceId !== normalize(record.resourceId) || data.protectedRefs.some(ref => ref.resourceId === record.resourceId)
      || typeof record.command !== 'string' || !record.command) fail('INVALID_RUN', 'Data ownership receipt linkage is invalid.')
  }
  for (const created of data.creationReceipts) {
    if (created.before !== null || created.after?.resourceId !== created.resourceId || created.after.type !== created.type)
      fail('INVALID_RUN', 'Data creation requires an absent before identity and captured after identity.')
    const previous = data.creationReceipts.filter(row => row.resourceId === created.resourceId && row.sequence < created.sequence).at(-1)
    if (previous && !data.deletionReceipts.some(row => row.createdSequence === previous.sequence && row.sequence < created.sequence))
      fail('INVALID_RUN', 'An existing Data identity cannot be claimed again.')
    if (!deletionFor(run, created) && !live.some(row => same(identity(row), created.after)))
      fail('INVALID_RUN', 'Missing owned Data resources require actual deletion receipts.')
    if (lastCreation(run, created.resourceId) === created && deletionFor(run, created)
      && live.some(row => row.resourceId === created.resourceId)) fail('INVALID_RUN', 'Deleted Data identities cannot return without a new creation receipt.')
  }
  if (new Set(data.deletionReceipts.map(row => row.createdSequence)).size !== data.deletionReceipts.length) fail('INVALID_RUN', 'Data deletions cannot be replayed as new proof.')
  for (const deleted of data.deletionReceipts) {
    const created = data.creationReceipts.find(row => row.sequence === deleted.createdSequence)
    if (!created || created.sequence >= deleted.sequence || !same(deleted.before, created.after) || deleted.after !== null
      || deleted.resourceId !== created.resourceId || deleted.type !== created.type
      || !['cleanup', 'maintenance'].includes(deleted.purpose)
      || deleted.purpose === 'maintenance' && (deleted.type !== 'Deployment' || ![lab.dataRequestTarget, lab.dataWorkerTarget].some(target => workloadId(lab, target) === deleted.resourceId)))
      fail('INVALID_RUN', 'Data deletion must link its exact owned creation and permitted purpose.')
  }
  return true
}
export function dataOwnedCleanupReady(run, lab) {
  try {
    validateDataOwnership(run, lab)
    const checkpoint = run.stages.cleanupCheckpoint
    return !!checkpoint && dataCleanupInventory(run, lab).protectedIntact && dataCleanupInventory(run, lab).owned.length === 0
      && run.stages.data.creationReceipts.every(created => !inventory(run).some(row => row.resourceId === created.resourceId))
      && [lab.dataRequestTarget, lab.dataWorkerTarget].every(target => !inventory(run).some(row => row.resourceId === workloadId(lab, target)))
      && run.stages.data.creationReceipts.every(created => {
        const deleted = deletionFor(run, created)
        return !!deleted && (deleted.purpose === 'maintenance' ? deleted.sequence < checkpoint.sequence : deleted.sequence > checkpoint.sequence)
      })
  } catch { return false }
}
