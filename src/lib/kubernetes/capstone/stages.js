import { fail } from '../../labEngine/errors.js'
import { canonicalize } from '../../labEngine/evidence.js'
import { cloneJson, validateBehavioralRun } from '../../labEngine/run.js'
import { evaluateLab } from '../../labEngine/evaluate.js'
import { sourceTextHash, sourceVersionsAt, validateSourceJournal } from '../../labEngine/sourceJournal.js'
import { getProjectManifest } from '../../project/manifests.js'
import { projectSourceHash } from '../../project/build.js'

const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|')
const same = (a, b) => canonicalize(a) === canonicalize(b)
const bytes = value => new TextEncoder().encode(canonicalize(value)).length
const hash = value => sourceTextHash(canonicalize(value))
const sorted = values => [...new Set(values)].sort()
const invalid = message => fail('INVALID_RUN', message)
export const isAksCapstone = lab => lab?.capabilities?.aksCapstone === true

export function validateAksStageLab(lab) {
  if (!isAksCapstone(lab)) return
  if (!Array.isArray(lab.stages) || lab.stages.length !== 8 || lab.stages.some(stage =>
    typeof stage?.id !== 'string' || !stage.id || stage.id.length > 80 || !Array.isArray(stage.taskIds) || !stage.taskIds.length)
    || new Set(lab.stages.map(stage => stage.id)).size !== 8
    || !same(sorted(lab.stages.flatMap(stage => stage.taskIds)), sorted(lab.tasks.map(task => task.id)))
    || lab.stages.flatMap(stage => stage.taskIds).length !== lab.tasks.length
    || lab.tasks.some(task => !task.verification)) fail('INVALID_LAB', 'AKS capstone requires eight stages partitioning verified Tasks.')
}

export function initializeAksStages(lab) {
  validateAksStageLab(lab)
  return { activeStageId: lab.stages[0].id, sealedStages: [], cleanupCheckpoint: null,
    aks: { version: 1, ownership: [], creationReceipts: [], deletionReceipts: [], protectedRefs: [] } }
}

export function activeAksExperiment(run) {
  return !!run.runtime.activeScenario || Object.values(run.runtime.kubernetes?.clusters ?? {}).some(state =>
    state.health?.experiment?.status === 'active' || ['warming', 'running'].includes(state.resourcesRuntime?.experiment?.phase)
    || state.rollouts?.experiment?.status === 'active' || state.diagnosis?.activeExperiment)
}

function selectedIdentity(run, record) {
  const strings = new Set()
  const visit = value => {
    if (typeof value === 'string') strings.add(value)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(record.dependencyValues); visit(record.measurements)
  const artifacts = Object.values(run.artifacts.buildsById).filter(build => Number(build.id.slice(6)) < record.sequence
    && (strings.has(build.id) || strings.has(build.digest)))
    .map(build => ({ buildId: build.id, sourceHash: build.sourceHash, digest: build.digest })).sort((a, b) => a.buildId.localeCompare(b.buildId))
  const targets = []
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes?.clusters ?? {})) {
    if (!strings.has(clusterId)) continue
    for (const [key, resource] of Object.entries(state.resources ?? {})) {
      if (!['Deployment', 'ConfigMap', 'Secret', 'Service', 'HorizontalPodAutoscaler'].includes(resource.kind)) continue
      targets.push({ clusterId, key, uid: resource.metadata.uid, hash: hash(resource) })
    }
  }
  return { artifacts, targets: targets.sort((a, b) => `${a.clusterId}/${a.key}`.localeCompare(`${b.clusterId}/${b.key}`)) }
}

function compactObservation(value, depth = 0) {
  if (depth > 8) return '[bounded]'
  if (Array.isArray(value)) return value.slice(-10).map(item => compactObservation(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/password|secret|token|connectionstring|authorization/i.test(key))
    .map(([key, item]) => [key, compactObservation(item, depth + 1)]))
  return typeof value === 'string' && value.length > 512 ? value.slice(0, 512) : value
}

function measuredObservation(run, record) {
  const owner = record.measurements.receiptId && Object.values(run.runtime.kubernetes?.clusters ?? {})
    .flatMap(state => state.rollouts?.receipts ?? []).find(receipt => receipt.id === record.measurements.receiptId)
  return { outcome: record.outcome, startedAtMs: record.startedAtMs, endedAtMs: record.endedAtMs,
    measurements: compactObservation(record.measurements), owner: owner ? compactObservation(owner) : null }
}

// Capture while the original verification and its runtime owner still exist.
// Only redacted identities and hashes survive cluster deletion.
export function captureAksVerification(run, record) {
  const id = `aks-proof-${record.id}`
  const receipt = { id, kind: 'verification', evidenceId: record.id, evidenceHash: hash(record),
    attemptId: run.attemptId, contentVersion: run.contentVersion, sequence: record.sequence,
    sourceVersions: cloneJson(sourceVersionsAt(run.project.sourceJournal, record.sequence)), ...selectedIdentity(run, record),
    observation: measuredObservation(run, record) }
  const receipts = { ...run.evidence.aksCapstoneReceipts }
  if (!receipts[id] && Object.keys(receipts).length >= 128) {
    const pinned = new Set(run.stages.sealedStages.flatMap(seal => seal.receiptIds))
    const victim = Object.values(receipts).find(item => !pinned.has(item.id)
      && ['failed', 'cancelled'].includes(run.evidence.experimentsById[item.evidenceId]?.outcome))
    if (victim) delete receipts[victim.id]
  }
  if (bytes(receipt) > 16_384 || !receipts[id] && Object.keys(receipts).length >= 128)
    fail('INVALID_EVIDENCE', 'AKS durable proof storage limit reached.')
  return { ...run, evidence: { ...run.evidence, aksCapstoneReceipts: { ...receipts, [id]: receipt } } }
}

// Native diagnosis enriches new evidence after recordVerification. Finalize only
// this action's new records; historical proofs must never be silently rewritten.
export function finalizeAksVerification(before, candidate, lab) {
  if (!isAksCapstone(lab)) return candidate
  let next = candidate
  for (const record of Object.values(candidate.evidence.experimentsById))
    if (record.sequence >= before.nextSequence) next = captureAksVerification(next, record)
  return next
}

function evidenceAt(run, taskId, sequence) {
  return Object.values(run.evidence.experimentsById).filter(record => record.taskId === taskId && record.sequence < sequence)
    .sort((a, b) => b.sequence - a.sequence)[0]
}

function sourceCurrentAtSeal(task, proof, versions) {
  return task.aksHistorical === true || task.aksSourceIndependent === true || same(proof?.sourceVersions ?? null, versions)
}

export function isAksTaskSourceCurrent(run, task) {
  const record = evidenceAt(run, task.id, run.nextSequence)
  return !!record && sourceCurrentAtSeal(task, run.evidence.aksCapstoneReceipts?.[`aks-proof-${record.id}`], run.project.fileVersions)
}

export function isAksPinnedDiagnosisEvidence(record, run, lab) {
  if (!isAksCapstone(lab) || typeof lab.aksCapstone?.validatePinnedDiagnosisEvidence !== 'function') return false
  const proof = run.evidence.aksCapstoneReceipts?.[`aks-proof-${record.id}`]
  return !!proof && proof.evidenceHash === hash(record) && proof.attemptId === run.attemptId
    && (run.stages.sealedStages.some(seal => seal.evidenceIds.includes(record.id))
      || run.stages.cleanupCheckpoint?.evidenceIds?.includes(record.id))
    && lab.aksCapstone.validatePinnedDiagnosisEvidence(record, proof, run) === true
}

function validateArtifacts(run, lab, journal) {
  const manifest = getProjectManifest(run.project.manifestId)
  const paths = [...(manifest.buildFiles ?? manifest.files)].sort()
  for (const [key, snapshot] of Object.entries(run.artifacts.sourceSnapshotsByHash)) {
    if (!snapshot || snapshot.hash !== key || !snapshot.files || !same(Object.keys(snapshot.files).sort(), paths)
      || projectSourceHash(snapshot.files) !== key) invalid('AKS build snapshot paths or content hash are invalid.')
  }
  for (const [id, build] of Object.entries(run.artifacts.buildsById)) {
    const sequence = Number(/^build-([1-9]\d*)$/.exec(id)?.[1])
    const snapshot = run.artifacts.sourceSnapshotsByHash[build?.sourceHash]
    if (!sequence || sequence >= run.nextSequence || build.id !== id || !snapshot) invalid('AKS build source provenance is missing.')
    for (const path of paths) {
      const save = journal.filter(event => event.path === path && event.sequence < sequence).at(-1)
      if (sourceTextHash(snapshot.files[path]) !== (save?.hash ?? sourceTextHash(lab.initialProjectFiles[path])))
        invalid('AKS build does not match source saved at build time.')
    }
  }
}

export function validateAksCapstoneState(run, lab) {
  if (!isAksCapstone(lab)) return
  validateAksStageLab(lab)
  const journal = validateSourceJournal(run, lab)
  validateArtifacts(run, lab, journal)
  const state = run.stages
  if (!exact(state, ['activeStageId', 'sealedStages', 'cleanupCheckpoint', 'aks'])
    || !exact(state.aks, ['version', 'ownership', 'creationReceipts', 'deletionReceipts', 'protectedRefs'])
    || state.aks.version !== 1 || !Array.isArray(state.sealedStages) || state.sealedStages.length > 8
    || state.activeStageId !== (lab.stages[state.sealedStages.length]?.id ?? null)
    || run.evidence.milestoneRecords.length !== state.sealedStages.length) invalid('AKS checkpoint order or schema is invalid.')
  if (state.cleanupCheckpoint !== null && (state.sealedStages.length < 7
    || typeof lab.aksCapstone?.validateCleanupCheckpoint !== 'function'
    || lab.aksCapstone.validateCleanupCheckpoint(run) !== true)) invalid('AKS cleanup checkpoint is missing validated final-request provenance.')
  const receipts = run.evidence.aksCapstoneReceipts
  if (!receipts || typeof receipts !== 'object' || Array.isArray(receipts) || Object.keys(receipts).length > 128)
    invalid('AKS durable verification proofs are missing or oversized.')
  for (const [id, receipt] of Object.entries(receipts)) {
    const record = run.evidence.experimentsById[receipt?.evidenceId]
    if (!exact(receipt, ['id', 'kind', 'evidenceId', 'evidenceHash', 'attemptId', 'contentVersion', 'sequence', 'sourceVersions', 'artifacts', 'targets', 'observation'])
      || receipt.id !== id || receipt.kind !== 'verification' || id !== `aks-proof-${receipt.evidenceId}`
      || !record || receipt.sequence !== record.sequence || receipt.evidenceHash !== hash(record)
      || receipt.attemptId !== run.attemptId || receipt.contentVersion !== run.contentVersion || bytes(receipt) > 16_384
      || !same(receipt.sourceVersions, sourceVersionsAt(journal, receipt.sequence))
      || !exact(receipt.observation, ['outcome', 'startedAtMs', 'endedAtMs', 'measurements', 'owner'])
      || receipt.observation.outcome !== record.outcome || receipt.observation.startedAtMs !== record.startedAtMs
      || receipt.observation.endedAtMs !== record.endedAtMs || !same(receipt.observation.measurements, compactObservation(record.measurements))
      || !Array.isArray(receipt.artifacts) || !Array.isArray(receipt.targets)
      || !same(receipt.artifacts, selectedIdentity(run, record).artifacts)) invalid('AKS durable proof is unlinked or malformed.')
    for (const tuple of receipt.artifacts) {
      const build = run.artifacts.buildsById[tuple.buildId]
      if (!exact(tuple, ['buildId', 'sourceHash', 'digest']) || !build || build.digest !== tuple.digest || build.sourceHash !== tuple.sourceHash
        || Number(tuple.buildId.slice(6)) >= receipt.sequence) invalid('AKS proof artifact has no causal build.')
    }
    if (receipt.targets.some(target => !exact(target, ['clusterId', 'key', 'uid', 'hash'])
      || Object.values(target).some(value => typeof value !== 'string') || !/^[a-f0-9]{64}$/.test(target.hash))) invalid('AKS target proof is malformed.')
  }
  let previous = 0
  for (const [index, seal] of state.sealedStages.entries()) {
    const stage = lab.stages[index]
    const records = stage.taskIds.map(id => evidenceAt(run, id, seal.sequence))
    if (!exact(seal, ['stageId', 'attemptId', 'contentVersion', 'sequence', 'taskIds', 'evidenceIds', 'dependencyValues', 'dependencyGenerations', 'sourceVersions', 'receiptIds'])
      || seal.stageId !== stage.id || seal.attemptId !== run.attemptId || seal.contentVersion !== run.contentVersion
      || !Number.isSafeInteger(seal.sequence) || seal.sequence <= previous || seal.sequence >= run.nextSequence || bytes(seal) > 32_768
      || !same(seal.taskIds, [...stage.taskIds].sort()) || !same(seal.sourceVersions, sourceVersionsAt(journal, seal.sequence))
      || records.some(record => !record || record.sequence <= previous || record.completed !== true || record.outcome !== 'passed')
      || !same(seal.evidenceIds, records.map(record => record.id).sort())
      || !same(seal.receiptIds, records.map(record => `aks-proof-${record.id}`).sort())
      || seal.receiptIds.some(id => !receipts[id])
      || records.some(record => !sourceCurrentAtSeal(lab.tasks.find(task => task.id === record.taskId), receipts[`aks-proof-${record.id}`], seal.sourceVersions))
      || !same(seal.dependencyValues, Object.fromEntries(records.map(record => [record.taskId, record.dependencyValues])))
      || !same(seal.dependencyGenerations, Object.fromEntries(records.map(record => [record.taskId, record.dependencyGenerations])))
      || !same(run.evidence.milestoneRecords[index], { kind: 'aks-stage-seal', sequence: seal.sequence, attemptId: run.attemptId, snapshot: canonicalize(seal) }))
      invalid('AKS stage seal has missing, stale, or forged provenance.')
    previous = seal.sequence
  }
  const sequences = [...journal.map(event => event.sequence), ...Object.values(run.evidence.experimentsById).map(record => record.sequence),
    ...state.sealedStages.map(seal => seal.sequence), ...Object.keys(run.artifacts.buildsById).map(id => Number(id.slice(6))),
    ...state.aks.creationReceipts.map(record => record.sequence), ...state.aks.deletionReceipts.map(record => record.sequence)]
  if (new Set(sequences).size !== sequences.length || sequences.some(value => !Number.isSafeInteger(value) || value < 1 || value >= run.nextSequence))
    invalid('AKS source, evidence, ownership, build and stage sequences must be unique.')
  for (const record of Object.values(run.evidence.experimentsById)) {
    const index = lab.stages.findIndex(stage => stage.taskIds.includes(record.taskId))
    if (index > state.sealedStages.length || index > 0 && record.sequence <= state.sealedStages[index - 1]?.sequence
      || state.sealedStages[index] && record.sequence >= state.sealedStages[index].sequence) invalid('AKS verification belongs to an inactive stage.')
  }
  if ((state.sealedStages.length === 8 || run.completedAt !== null) && !aksCleanupReady(run, lab)) invalid('AKS completion requires verified cleanup.')
}

export function aksCleanupReady(run, lab) {
  return !!run.stages.cleanupCheckpoint && run.stages.aks.ownership.length === 0 && !activeAksExperiment(run)
    && (typeof lab.aksCapstone?.cleanupReady === 'function' ? lab.aksCapstone.cleanupReady(run) === true : false)
}

export function getAksSealedTaskIds(run, lab) {
  validateAksCapstoneState(run, lab)
  return new Set([...run.stages.sealedStages.flatMap(seal => seal.taskIds),
    ...(run.stages.cleanupCheckpoint?.taskIds ?? [])])
}

export function advanceAksStage(run, lab) {
  validateBehavioralRun(run, lab)
  const reject = (code, message) => ({ run, diagnostics: [{ code, message }] })
  if (!isAksCapstone(lab) || run.completedAt !== null) return reject('AKS_STAGE_UNAVAILABLE', 'The AKS stage cannot advance.')
  const stage = lab.stages[run.stages.sealedStages.length]
  if (!stage || activeAksExperiment(run)) return reject('AKS_STAGE_BUSY', 'Finish the active experiment before advancing.')
  const evaluation = evaluateLab(lab, run)
  if (stage.taskIds.some(id => !evaluation.tasks.find(task => task.id === id)?.done)) return reject('AKS_STAGE_INCOMPLETE', 'Verify every current Task before advancing.')
  if (stage.taskIds.some(id => {
    const record = evidenceAt(run, id, run.nextSequence)
    return !sourceCurrentAtSeal(lab.tasks.find(task => task.id === id), run.evidence.aksCapstoneReceipts[`aks-proof-${record.id}`], run.project.fileVersions)
  })) return reject('AKS_STAGE_INCOMPLETE', 'Reverify current source gates after the final saved edit.')
  const exit = lab.aksCapstone?.stageExit?.(run, stage) ?? []
  if (exit.length) return { run, diagnostics: exit }
  if (run.stages.sealedStages.length === 7 && !aksCleanupReady(run, lab)) return reject('AKS_CLEANUP_REQUIRED', 'Verify the final cleanup checkpoint before advancing.')
  const records = stage.taskIds.map(id => evidenceAt(run, id, run.nextSequence))
  const seal = { stageId: stage.id, attemptId: run.attemptId, contentVersion: run.contentVersion, sequence: run.nextSequence,
    taskIds: [...stage.taskIds].sort(), evidenceIds: records.map(record => record.id).sort(),
    dependencyValues: Object.fromEntries(records.map(record => [record.taskId, record.dependencyValues])),
    dependencyGenerations: Object.fromEntries(records.map(record => [record.taskId, record.dependencyGenerations])),
    sourceVersions: cloneJson(run.project.fileVersions), receiptIds: records.map(record => `aks-proof-${record.id}`).sort() }
  if (bytes(seal) > 32_768) return reject('AKS_STAGE_OVERSIZED', 'The AKS stage seal exceeds its storage limit.')
  const next = { ...run, nextSequence: run.nextSequence + 1,
    stages: { ...run.stages, activeStageId: lab.stages[run.stages.sealedStages.length + 1]?.id ?? null, sealedStages: [...run.stages.sealedStages, seal] },
    evidence: { ...run.evidence, milestoneRecords: [...run.evidence.milestoneRecords,
      { kind: 'aks-stage-seal', sequence: seal.sequence, attemptId: run.attemptId, snapshot: canonicalize(seal) }] } }
  return { run: validateBehavioralRun(next, lab), diagnostics: [] }
}
