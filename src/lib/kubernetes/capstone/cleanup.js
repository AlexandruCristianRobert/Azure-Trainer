import { canonicalize } from '../../labEngine/evidence.js'
import { sourceTextHash, sourceVersionsAt } from '../../labEngine/sourceJournal.js'
import { evaluateLab } from '../../labEngine/evaluate.js'
import { activeAksExperiment } from './stages.js'
import { aksResourceInventory, aksProtectedRefs, validateAksOwnership } from './ownership.js'
import { stableAksCapstoneV2, stableAksCapstoneV2Dependencies, CAPSTONE_V2_IMAGE } from './incident.js'
import { inspectDeploymentConsistency } from '../release-evidence.js'
import { simulateKubernetesRequest } from '../requests.js'
import { inspectRequestRecords } from '../request-records.js'
import { resolveServiceDns } from '../connectivity.js'
import { tokenize } from '../../az/tokenize.js'
import { CAPSTONE_MANIFEST } from '../../../data/templates/aks-python/capstone.js'
import { CAPSTONE_TARGET } from '../../../data/labs/aks-journey/capstone-helpers.js'
import { INTEGRATION_FIXTURES } from '../../../data/fixtures/aks/integration.js'

export const AKS_FINAL_TASKS = Object.freeze(['final-internal', 'final-external', 'final-invalid', 'final-no-match', 'final-timeout'])
const cleanupTasks = ['cleanup-app', 'cleanup-cloud']
const clone = value => structuredClone(value)
const same = (a, b) => canonicalize(a) === canonicalize(b)
const hash = value => sourceTextHash(canonicalize(value))
const lower = value => String(value).toLowerCase()
const issue = (code, message) => ({ code, message })
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
const stateFor = run => run.runtime.kubernetes.clusters[CAPSTONE_TARGET.clusterId]
const witnessFor = run => {
  const state = stateFor(run), uid = state?.resources['Deployment/assistant/assistant-api']?.metadata.uid
  return state?.rollouts?.proofs?.[uid] ?? null
}
const latestFinalRecord = (run, id) => Object.values(run.evidence.experimentsById).filter(record => record.taskId === id)
  .sort((a, b) => b.sequence - a.sequence)[0]

/** Excludes request/log append counters; includes all saved files and restart identity. */
export function aksFinalDependencies(run) {
  return { ...stableAksCapstoneV2Dependencies(run), fileVersions: clone(run.project.fileVersions), witness: clone(witnessFor(run)) }
}
export const aksFinalDependencyHash = run => hash(aksFinalDependencies(run))
/** Compare compiled projections with the immutable published v1 contract. */
export function aksFinalContractMatches(run) {
  const imageProofId = run.stages.sealedStages[1]?.evidenceIds.find(id => run.evidence.experimentsById[id]?.taskId === 'image-v1')
  const tuple = run.evidence.aksCapstoneReceipts[`aks-proof-${imageProofId}`]?.artifacts[0]
  const demonstrated = run.artifacts.buildsById[tuple?.buildId]?.appSpec
  const current = run.artifacts.buildsById[run.artifacts.publishedTags[CAPSTONE_V2_IMAGE]]?.appSpec
  return !!current && !!demonstrated && same(current.health, demonstrated.health) && same(current.workload, demonstrated.workload)
}
export function aksFinalReady(run, lab) {
  if (run.stages.activeStageId !== 'final-cleanup' || run.stages.sealedStages.length !== 7 || run.stages.cleanupCheckpoint
    || activeAksExperiment(run) || Object.keys(run.project.savedFiles).some(path => run.project.savedFiles[path] !== run.project.draftFiles[path])
    || !stableAksCapstoneV2(run, lab, { requireRestart: true }) || !aksFinalContractMatches(run)) return false
  const consistency = inspectDeploymentConsistency(run, CAPSTONE_TARGET, CAPSTONE_MANIFEST, lab)
  return !!(consistency.consistent && aksFinalDependencies(run).savedObjects.length === 6
    && consistency.witness?.appliedKeys.includes('Namespace//assistant')
    && consistency.witness.reapply && consistency.witness.restart)
}

/** UI and action deliberately share exactly this eligibility path. */
export function aksCleanupEligibility(run, lab) {
  if (run.stages.cleanupCheckpoint) return [issue('AKS_CLEANUP_FROZEN', 'Final proof is frozen. Only cleanup, reads and final stage sealing remain.')]
  if (!aksFinalReady(run, lab)) return [issue('AKS_FINAL_NOT_CURRENT', 'Save current v2 with two healthy fixed Pods and no HPA or experiment; reapply all six final manifests, restart and wait.')]
  const evaluation = evaluateLab(lab, run)
  if (AKS_FINAL_TASKS.some(id => !evaluation.tasks.find(task => task.id === id)?.done
    || !run.evidence.currentEvidenceByTask[id] || run.evidence.currentEvidenceByTask[id] !== latestFinalRecord(run, id)?.id))
    return [issue('AKS_FINAL_REQUESTS_REQUIRED', 'Verify all five current final requests after the final reapply and restart.')]
  return []
}

export function freezeAksCleanup(run, lab) {
  const diagnostics = aksCleanupEligibility(run, lab)
  if (diagnostics.length) return { run, diagnostics }
  const records = AKS_FINAL_TASKS.map(id => run.evidence.experimentsById[run.evidence.currentEvidenceByTask[id]])
  const checkpoint = { version: 1, attemptId: run.attemptId, contentVersion: run.contentVersion, sequence: run.nextSequence,
    taskIds: [...AKS_FINAL_TASKS], evidenceIds: records.map(record => record.id),
    receiptHashes: Object.fromEntries(records.map(record => [record.id, record.aksCapstoneReceiptHash])),
    dependencyValues: Object.fromEntries(records.map(record => [record.taskId, clone(record.dependencyValues)])),
    dependencyGenerations: Object.fromEntries(records.map(record => [record.taskId, clone(record.dependencyGenerations)])),
    sourceVersions: clone(run.project.fileVersions), fingerprint: aksFinalDependencies(run),
    // A creation sequence identifies one exact owned incarnation. Resolve its
    // full identity from the durable receipt instead of repeating long ARM IDs.
    inventory: run.stages.aks.ownership.map(item => item.sequence), protectedDigest: hash(aksProtectedRefs()) }
  return { run: { ...run, nextSequence: run.nextSequence + 1,
    stages: { ...run.stages, cleanupCheckpoint: checkpoint },
    evidence: { ...run.evidence, aksCleanupReceipt: { sequence: checkpoint.sequence, attemptId: run.attemptId, snapshot: canonicalize(checkpoint) } } }, diagnostics: [] }
}

/** Durable-only validation: never inspect deleted live selectors or call run validation/evaluation. */
export function validateAksCleanupCheckpoint(run) {
  try {
    const cp = run.stages.cleanupCheckpoint
    if (!exact(cp, ['version', 'attemptId', 'contentVersion', 'sequence', 'taskIds', 'evidenceIds', 'receiptHashes', 'dependencyValues',
      'dependencyGenerations', 'sourceVersions', 'fingerprint', 'inventory', 'protectedDigest'])
      || cp.version !== 1 || cp.attemptId !== run.attemptId || cp.contentVersion !== run.contentVersion
      || !Number.isSafeInteger(cp.sequence) || cp.sequence <= run.stages.sealedStages[6]?.sequence || cp.sequence >= run.nextSequence
      || !same(cp.taskIds, AKS_FINAL_TASKS) || cp.evidenceIds.length !== 5 || new Set(cp.evidenceIds).size !== 5
      || !same(cp.sourceVersions, sourceVersionsAt(run.project.sourceJournal, cp.sequence))
      || !same(cp.sourceVersions, run.project.fileVersions) || cp.protectedDigest !== hash(aksProtectedRefs())
      || !same(run.evidence.aksCleanupReceipt, { sequence: cp.sequence, attemptId: run.attemptId, snapshot: canonicalize(cp) })
      || new TextEncoder().encode(canonicalize(cp)).length > 32768) return false
    const inventory = run.stages.aks.creationReceipts.filter(item => item.sequence < cp.sequence
      && !run.stages.aks.deletionReceipts.some(deleted => deleted.creationSequence === item.sequence && deleted.sequence < cp.sequence))
      .map(item => item.sequence)
    if (!same(cp.inventory, inventory)) return false
    const records = cp.evidenceIds.map(id => run.evidence.experimentsById[id])
    if (records.some((record, index) => !record || record.taskId !== AKS_FINAL_TASKS[index]
      || record.scenarioId !== `capstone-${record.taskId}` || record.attemptId !== run.attemptId || record.contentVersion !== run.contentVersion
      || record.sequence <= run.stages.sealedStages[6].sequence || record.sequence >= cp.sequence
      || record.outcome !== 'passed' || record.completed !== true || run.evidence.currentEvidenceByTask[record.taskId] !== record.id
      || latestFinalRecord(run, record.taskId)?.id !== record.id
      || cp.receiptHashes[record.id] !== record.aksCapstoneReceiptHash
      || record.dependencyValues['capstone-final-current'] !== hash(cp.fingerprint)
      || record.measurements.finalProof !== hash(cp.fingerprint)
      || run.evidence.aksCapstoneReceipts[`aks-proof-${record.id}`]?.evidenceHash !== hash(record))) return false
    if (!same(cp.receiptHashes, Object.fromEntries(records.map(record => [record.id, record.aksCapstoneReceiptHash])))
      || !same(cp.dependencyValues, Object.fromEntries(records.map(record => [record.taskId, record.dependencyValues])))
      || !same(cp.dependencyGenerations, Object.fromEntries(records.map(record => [record.taskId, record.dependencyGenerations])))) return false
    const artifact = run.artifacts.buildsById[cp.fingerprint.artifact?.id]
    return !!artifact && artifact.sourceHash === cp.fingerprint.sourceHash && artifact.digest === cp.fingerprint.artifact.digest
      && cp.fingerprint.savedObjects.length === 6 && cp.fingerprint.witness.appliedKeys.includes('Namespace//assistant')
      && cp.fingerprint.witness.restart !== null
  } catch { return false }
}

function appRemaining(run) {
  const state = stateFor(run), entries = []
  const add = (resourceId, type) => entries.push({ resourceId, type, parentId: CAPSTONE_TARGET.clusterId })
  for (const object of Object.values(state?.resources ?? {}))
    if (object.metadata.namespace === 'assistant' || object.kind === 'Namespace' && object.metadata.name === 'assistant') add(object.metadata.uid, object.kind)
  // This target owns the application Pods in this cluster; supplied diagnostic
  // Pods are excluded by namespace while orphaned application timer UIDs remain visible.
  const supplied = new Set(Object.values(state?.resources ?? {}).filter(item => item.kind === 'Pod' && item.metadata.namespace !== 'assistant').map(item => item.metadata.uid))
  for (const [name, map] of Object.entries({ snapshots: state?.podSnapshots, projection: state?.projectionDue,
    health: state?.health?.containers, assignments: state?.resourcesRuntime?.assignments, usage: state?.resourcesRuntime?.usage,
    metrics: state?.resourcesRuntime?.metrics, termination: state?.resourcesRuntime?.terminationDue, hpa: state?.resourcesRuntime?.hpa }))
    for (const uid of Object.keys(map ?? {})) if (!supplied.has(uid)) add(`${name}:${uid}`, 'runtime-projection')
  if (activeAksExperiment(run)) add('active-experiment', 'experiment')
  for (const event of run.runtime.scheduledEvents ?? [])
    if (event.clusterId === CAPSTONE_TARGET.clusterId || event.target?.clusterId === CAPSTONE_TARGET.clusterId
      || event.namespace === 'assistant' || event.target?.namespace === 'assistant') add(`scheduled:${hash(event)}`, 'scheduled-event')
  return entries
}
export function inspectAksCleanup(run, lab) {
  let protectedIntact = false
  try { validateAksOwnership(run); protectedIntact = true } catch { /* Invalid prerequisite/ownership history stays closed. */ }
  const checkpoint = run.stages.cleanupCheckpoint
  const inventory = checkpoint
    ? run.stages.aks.creationReceipts.filter(item => checkpoint.inventory.includes(item.sequence))
    : run.stages.aks.ownership
  const clusterIds = new Set(inventory.filter(item => item.type === 'aksClusters').map(item => lower(item.resourceId)))
  const registryIds = new Set(inventory.filter(item => item.type === 'containerRegistries').map(item => lower(item.resourceId)))
  const current = aksResourceInventory(run)
  const remaining = current.filter(item => inventory.some(owned => lower(owned.resourceId) === lower(item.resourceId)))
    .map(({ resourceId, type, parentId }) => ({ resourceId, type, parentId }))
  remaining.push(...appRemaining(run))
  for (const id of Object.keys(run.runtime.kubernetes.clusters)) if (clusterIds.has(lower(id))) remaining.push({ resourceId: id, type: 'cluster-runtime', parentId: id })
  for (const [name, context] of Object.entries(run.runtime.kubernetes.contexts)) if (clusterIds.has(lower(context.clusterId)))
    remaining.push({ resourceId: name, type: 'kube-context', parentId: context.clusterId })
  for (const [reference, id] of Object.entries(run.artifacts.publishedTags)) if (registryIds.has(lower(run.artifacts.buildsById[id]?.image?.registryId)))
    remaining.push({ resourceId: reference, type: 'registry-publication', parentId: run.artifacts.buildsById[id].image.registryId })
  return { checkpoint: clone(run.stages.cleanupCheckpoint), remaining, protectedIntact }
}
export function aksCleanupAppReady(run) {
  return validateAksCleanupCheckpoint(run) && appRemaining(run).length === 0
}
export function aksCleanupReady(run, lab) {
  const view = inspectAksCleanup(run, lab)
  return validateAksCleanupCheckpoint(run) && view.protectedIntact && view.remaining.length === 0 && run.stages.aks.ownership.length === 0
}
export function aksCleanupDependencies(run) {
  return { checkpoint: run.stages.cleanupCheckpoint?.sequence ?? null,
    owned: clone(run.stages.aks.ownership), app: appRemaining(run),
    remaining: inspectAksCleanup(run).remaining }
}
export function aksCleanupAppDependencies(run) {
  return { checkpoint: run.stages.cleanupCheckpoint?.sequence ?? null, app: appRemaining(run) }
}
// Task predicates receive the evaluator's context projection, after the full
// run/checkpoint has already been validated. Do not infer attempt identity there.
export const aksCleanupAppInventoryClear = run => !!run.stages.cleanupCheckpoint && appRemaining(run).length === 0
export const aksCleanupInventoryClear = run => !!run.stages.cleanupCheckpoint && run.stages.aks.ownership.length === 0
  && inspectAksCleanup(run).remaining.length === 0

export function aksFrozenActionAllowed(action) {
  if (['hint', 'solution', 'elapsed', 'aks-advance-stage', 'aks-diagnosis-replay'].includes(action.type)) return true
  if (action.type === 'aks-request') return cleanupTasks.some(id => action.scenarioId === `capstone-${id}`)
  if (action.type !== 'command' || typeof action.line !== 'string') return false
  const parsed = tokenize(action.line)
  if (parsed.error) return false
  const tokens = parsed.tokens ?? [], [tool, verb, subverb] = tokens
  if (tool === 'kubectl') return ['get', 'describe', 'logs', 'top', 'help'].includes(verb)
    || verb === 'rollout' && ['status', 'history'].includes(subverb)
    || verb === 'config' && ['current-context', 'get-contexts'].includes(subverb)
    || verb === 'delete' && ['namespace', 'namespaces', 'ns', 'deployment', 'deployments', 'service', 'services', 'svc', 'hpa', 'horizontalpodautoscaler'].includes(subverb)
  if (tool === 'az') return ['help', 'version'].includes(verb)
    || ['show', 'list'].includes(subverb) || verb === 'acr' && subverb === 'repository' && ['list', 'show-tags'].includes(tokens[3])
    || ['group', 'aks', 'acr'].includes(verb) && subverb === 'delete'
  return tool === 'help' || tool === 'clear'
}

export function verifyAksFinal(run, lab, scenarioId) {
  const id = scenarioId.slice('capstone-'.length), now = run.runtime.simTimeMs
  const result = (passed, measurements) => ({ scenarioId, scenarioVersion: 1, outcome: passed ? 'passed' : 'failed', completed: passed,
    startedAtMs: now, endedAtMs: now, measurements })
  if (cleanupTasks.includes(id)) {
    const passed = id === 'cleanup-app' ? aksCleanupAppReady(run) : aksCleanupReady(run, lab)
    return { run, result: result(passed, { kind: 'cleanup-inventory', reason: passed ? 'owned-cleanup-verified' : 'owned-resources-remain',
      checkpointSequence: run.stages.cleanupCheckpoint?.sequence ?? null, inventory: aksCleanupDependencies(run) }) }
  }
  if (!aksFinalReady(run, lab)) return { run, result: result(false, { reason: 'final-state-not-current' }) }
  const scenario = lab.scenarios[scenarioId]
  const dns = id === 'final-internal' ? resolveServiceDns(run, { clusterId: CAPSTONE_TARGET.clusterId, clientNamespace: 'assistant', hostname: 'assistant-internal.assistant.svc.cluster.local' }) : null
  const declared = id === 'final-internal' ? { ...scenario, connectivity: { ...scenario.connectivity,
    origin: { ...scenario.connectivity.origin, serviceUid: stateFor(run).resources['Service/assistant/assistant-internal'].metadata.uid } } } : scenario
  const response = simulateKubernetesRequest(run, { ...declared, id: scenarioId }, lab)
  const measured = response.measurements, operations = measured.dependencyTrace ?? [], trace = measured.integrationTrace
  const requestId = `request-${measured.requestSequence}`
  const logs = inspectRequestRecords(response.run, { clusterId: CAPSTONE_TARGET.clusterId, requestId }).application
  const started = logs.some(log => log.requestId === requestId && log.podUid === measured.podUid && log.artifactId === measured.artifactId
    && log.sourceFields?.event === 'request.started' && log.sourceFields.request_id === requestId && log.sourceBindings?.request_id === 'request-id')
  const completed = logs.some(log => log.requestId === requestId && log.podUid === measured.podUid && log.artifactId === measured.artifactId
    && log.sourceFields?.event === 'request.completed' && log.sourceFields.request_id === requestId && log.sourceFields.status === response.status
    && log.sourceBindings?.request_id === 'request-id' && log.sourceBindings.status === 'result-status')
  const passed = response.outcome && measured.transport?.ok === true && measured.podUid && measured.artifactId === run.artifacts.publishedTags[CAPSTONE_V2_IMAGE]
    && started && completed && trace?.fixtureVersion === INTEGRATION_FIXTURES.version
    && (!dns || dns.ok && dns.serviceKey === 'Service/assistant/assistant-internal' && dns.address === stateFor(run).resources[dns.serviceKey].spec.clusterIP)
    && (id === 'final-invalid' ? operations.length === 0 && trace.inputDisposition === 'rejected'
      : id === 'final-no-match' ? operations.map(item => item.operation).join() === 'embedding,postgres-query' && trace.selectedIds.length === 0
        : id === 'final-timeout' ? response.status === 504 && response.body?.code === 'DEPENDENCY_TIMEOUT'
          && operations.length === 1 && operations[0].operation === 'embedding' && operations[0].attempts.length === 3
          : operations.map(item => item.operation).join() === 'embedding,postgres-query,answer' && trace.vectorProvenance === 'embedding'
            && trace.sourceProvenance === 'rows' && trace.queryBindings?.published === true && trace.selectedIds.join() === scenario.expected.body.sources.join())
  return { run: response.run, result: result(!!passed, { ...measured, finalProof: aksFinalDependencyHash(run), internalDns: dns,
    observationOrigin: id === 'final-internal' ? 'internal-service-simulation' : 'external-load-balancer',
    applicationLogProof: { started, completed }, reason: passed ? 'observed-current-final-request' : 'final-request-provenance-mismatch' }) }
}
