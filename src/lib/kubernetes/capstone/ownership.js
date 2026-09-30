import { SUBSCRIPTION_ID } from '../../sandbox/model.js'
import { canonicalize } from '../../labEngine/evidence.js'
import { sourceTextHash } from '../../labEngine/sourceJournal.js'
import { fail } from '../../labEngine/errors.js'
import { AKS_PREREQUISITE_GROUP_ID, aksPrerequisiteCatalog, createAksCapstoneSeed } from '../../../data/labs/aks-journey/capstone-seed.js'

const lower = value => String(value).toLowerCase()
const same = (a, b) => canonicalize(a) === canonicalize(b)
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
const diagnostic = (code, message) => ({ code, message })
const groupId = name => `/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/${name}`
const hash = value => sourceTextHash(canonicalize(value))
const suppliedNamespaces = new Set(['default', 'kube-system', 'kube-public', 'diagnostics'])

// Exact identities come from validated internal resource objects, never action flags.
export function aksResourceInventory(run) {
  const inventory = []
  for (const [type, resources] of Object.entries(run.sandbox)) {
    if (!Array.isArray(resources)) continue
    for (const resource of resources) {
      const resourceId = type === 'resourceGroups' ? groupId(resource.name)
        : type === 'roleAssignments' ? `${resource.scope}/providers/Microsoft.Authorization/roleAssignments/${resource.id}`
          : resource.id ?? `${groupId(resource.resourceGroup)}/${type}/${resource.name}`
      const identity = type === 'roleAssignments' ? run.sandbox.managedIdentities.find(item => lower(item.principalId) === lower(resource.principalId)) : null
      const parentId = resource.clusterOwner ?? identity?.clusterOwner ?? resource.scope
        ?? (resource.resourceGroup ? groupId(resource.resourceGroup) : null)
      inventory.push({ resourceId, type, parentId, value: resource, implicit: false })
    }
  }
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes?.clusters ?? {})) {
    for (const resource of Object.values(state.resources ?? {})) {
      if (resource.kind !== 'Namespace') continue
      inventory.push({ resourceId: resource.metadata.uid, type: 'Namespace', parentId: clusterId, value: resource,
        implicit: suppliedNamespaces.has(resource.metadata.name) })
    }
  }
  return inventory
}

export function aksProtectedRefs() {
  const group = createAksCapstoneSeed().sandbox.resourceGroups[0]
  const catalog = aksPrerequisiteCatalog()
  return [{ resourceId: AKS_PREREQUISITE_GROUP_ID, type: 'resourceGroups', digest: hash(group) },
    { resourceId: catalog.catalogId, type: 'fixtureCatalog', digest: catalog.digest },
    ...catalog.profiles.map(profile => ({ resourceId: `${catalog.catalogId}/${profile.id}`, type: 'fixtureProfile', digest: profile.digest }))]
}

export function inspectAksOwnership(run) {
  const state = run.stages.aks
  const current = new Set(aksResourceInventory(run).map(item => lower(item.resourceId)))
  return { owned: structuredClone(state.ownership), protected: structuredClone(state.protectedRefs),
    remaining: structuredClone(state.ownership.filter(item => current.has(lower(item.resourceId)))) }
}

function deletionClosure(run, ids) {
  const inventory = aksResourceInventory(run)
  const closure = new Set(ids.map(lower))
  let changed = true
  while (changed) {
    changed = false
    for (const item of inventory) {
      if (closure.has(lower(item.resourceId))) continue
      const belongs = item.parentId && closure.has(lower(item.parentId))
        || inventory.some(parent => parent.type === 'resourceGroups' && closure.has(lower(parent.resourceId))
          && lower(item.resourceId).startsWith(`${lower(parent.resourceId)}/`))
      if (belongs) { closure.add(lower(item.resourceId)); changed = true }
    }
  }
  return inventory.filter(item => closure.has(lower(item.resourceId)))
}

export function validateAksDeletion(run, resourceIds) {
  if (!Array.isArray(resourceIds) || resourceIds.some(id => typeof id !== 'string')) return [diagnostic('AKS_RESOURCE_NOT_OWNED', 'Exact resource IDs are required.')]
  const state = run.stages.aks
  const protectedIds = new Set(state.protectedRefs.map(item => lower(item.resourceId)))
  const owned = new Set(state.ownership.map(item => lower(item.resourceId)))
  const closure = deletionClosure(run, resourceIds)
  if (resourceIds.some(id => protectedIds.has(lower(id))) || closure.some(item => protectedIds.has(lower(item.resourceId))))
    return [diagnostic('AKS_PROTECTED_RESOURCE', 'Supplied AKS prerequisites cannot be changed or deleted.')]
  if (resourceIds.some(id => !closure.some(item => lower(item.resourceId) === lower(id))) || closure.some(item =>
    !owned.has(lower(item.resourceId)) && !(item.implicit && owned.has(lower(item.parentId)))))
    return [diagnostic('AKS_RESOURCE_NOT_OWNED', 'Deletion would include a resource not created by this attempt.')]
  return []
}

export function recordAksOwnership(run, creation) {
  const state = run.stages.aks
  if (state.ownership.length >= 128 || state.creationReceipts.length + state.deletionReceipts.length >= 256)
    fail('AKS_OWNERSHIP_LIMIT', 'AKS ownership history limit reached.')
  const live = aksResourceInventory(run).find(item => lower(item.resourceId) === lower(creation.resourceId))
  if (!live || live.type !== creation.type || live.parentId !== creation.parentId || live.implicit
    || state.protectedRefs.some(item => lower(item.resourceId) === lower(live.resourceId))
    || state.ownership.some(item => lower(item.resourceId) === lower(live.resourceId))) fail('INVALID_RUN', 'AKS creation receipt requires a new validated resource.')
  const record = { resourceId: live.resourceId, type: live.type, parentId: live.parentId,
    sequence: run.nextSequence, attemptId: run.attemptId }
  return { ...run, nextSequence: run.nextSequence + 1, stages: { ...run.stages, aks: { ...state,
    ownership: [...state.ownership, record], creationReceipts: [...state.creationReceipts, { ...record, digest: hash(live.value) }] } } }
}

// Both candidates are internal engine values. Rejected candidates never escape
// this boundary, including publications, namespace cascades and node projections.
export function commitAksOwnership(before, candidate, events = []) {
  const old = aksResourceInventory(before)
  const current = aksResourceInventory(candidate)
  const previous = new Map(old.map(item => [lower(item.resourceId), item]))
  const present = new Map(current.map(item => [lower(item.resourceId), item]))
  const protectedIds = new Set(before.stages.aks.protectedRefs.map(item => lower(item.resourceId)))
  if (old.some(item => protectedIds.has(lower(item.resourceId)) && (!present.has(lower(item.resourceId))
    || !same(item.value, present.get(lower(item.resourceId)).value)))
    || events.some(event => event.resourceType === 'resourceGroup' && event.type === 'updated'
      && protectedIds.has(lower(groupId(event.name))))
    || !same(candidate.runtime.aksCapstonePrerequisites, before.runtime.aksCapstonePrerequisites))
    return { run: before, diagnostics: [diagnostic('AKS_PROTECTED_RESOURCE', 'Supplied AKS prerequisites cannot be changed or deleted.')] }
  const removed = old.filter(item => !present.has(lower(item.resourceId)))
  const diagnostics = removed.length ? validateAksDeletion(before, removed.map(item => item.resourceId)) : []
  if (diagnostics.length) return { run: before, diagnostics }
  if (!before.stages.cleanupCheckpoint && before.labId === 'aks-knowledge-assistant-capstone'
    && removed.some(item => ['resourceGroups', 'aksClusters', 'containerRegistries'].includes(item.type)
      && before.stages.aks.ownership.some(owned => lower(owned.resourceId) === lower(item.resourceId))))
    return { run: before, diagnostics: [diagnostic('AKS_CLEANUP_CHECKPOINT_REQUIRED', 'Seal current final verification with Freeze final proof before deleting owned cloud resources.')] }
  const added = current.filter(item => !previous.has(lower(item.resourceId)) && !item.implicit)
  if (before.stages.cleanupCheckpoint && (added.length || current.some(item => previous.has(lower(item.resourceId))
    && !same(item.value, previous.get(lower(item.resourceId)).value))))
    return { run: before, diagnostics: [diagnostic('AKS_CLEANUP_FROZEN', 'Frozen cleanup permits deletion of existing owned resources only.')] }
  const removedOwned = before.stages.aks.ownership.filter(item => removed.some(resource => lower(resource.resourceId) === lower(item.resourceId)))
  if (before.stages.aks.ownership.length - removedOwned.length + added.length > 128
    || before.stages.aks.creationReceipts.length + before.stages.aks.deletionReceipts.length + added.length + removedOwned.length > 256)
    return { run: before, diagnostics: [diagnostic('AKS_OWNERSHIP_LIMIT', 'AKS ownership history limit reached.')] }
  let next = candidate
  for (const owned of removedOwned) {
    const record = { resourceId: owned.resourceId, creationSequence: owned.sequence, attemptId: before.attemptId, sequence: next.nextSequence }
    next = { ...next, nextSequence: next.nextSequence + 1, stages: { ...next.stages, aks: { ...next.stages.aks,
      ownership: next.stages.aks.ownership.filter(item => item.sequence !== owned.sequence),
      deletionReceipts: [...next.stages.aks.deletionReceipts, record] } } }
  }
  for (const item of added) next = recordAksOwnership(next, item)
  return { run: next, diagnostics: [] }
}

export function validateAksOwnership(run) {
  const state = run.stages.aks
  const invalid = () => fail('INVALID_RUN', 'AKS ownership or protected prerequisite history is malformed.')
  if (!same(state.protectedRefs, aksProtectedRefs()) || !same(run.runtime.aksCapstonePrerequisites, aksPrerequisiteCatalog())
    || !Array.isArray(state.ownership) || state.ownership.length > 128 || !Array.isArray(state.creationReceipts)
    || !Array.isArray(state.deletionReceipts) || state.creationReceipts.length + state.deletionReceipts.length > 256) invalid()
  const inventory = aksResourceInventory(run)
  const protectedGroup = inventory.find(item => lower(item.resourceId) === lower(AKS_PREREQUISITE_GROUP_ID))
  if (!protectedGroup || hash(protectedGroup.value) !== state.protectedRefs[0].digest) invalid()
  const alive = new Map()
  for (const record of [...state.creationReceipts.map(value => ({ kind: 'create', value })),
    ...state.deletionReceipts.map(value => ({ kind: 'delete', value }))].sort((a, b) => a.value.sequence - b.value.sequence)) {
    const value = record.value
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence >= run.nextSequence
      || value.attemptId !== run.attemptId || typeof value.resourceId !== 'string') invalid()
    const key = lower(value.resourceId)
    if (record.kind === 'create') {
      if (!exact(value, ['resourceId', 'type', 'parentId', 'sequence', 'attemptId', 'digest']) || alive.has(key)
        || typeof value.type !== 'string' || !(value.parentId === null || typeof value.parentId === 'string')
        || !/^[a-f0-9]{64}$/.test(value.digest) || state.protectedRefs.some(item => lower(item.resourceId) === key)) invalid()
      const { digest, ...entry } = value
      alive.set(key, entry)
    } else {
      if (!exact(value, ['resourceId', 'creationSequence', 'attemptId', 'sequence']) || alive.get(key)?.sequence !== value.creationSequence) invalid()
      alive.delete(key)
    }
  }
  if (!same([...alive.values()].sort((a, b) => a.sequence - b.sequence), state.ownership)
    || state.ownership.some(item => !inventory.some(resource => lower(resource.resourceId) === lower(item.resourceId) && resource.type === item.type))) invalid()
}
