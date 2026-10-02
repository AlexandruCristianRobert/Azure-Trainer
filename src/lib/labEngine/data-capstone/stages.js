import { canonicalize } from '../evidence.js'
import { cloneJson, contextFor, validEvidenceRecord } from '../run.js'
import { fail } from '../errors.js'
import { sourceTextHash, sourceVersionsAt, validateSourceJournal } from '../sourceJournal.js'
import { projectSourceHash, selectBuildFiles } from '../../project/build.js'
import { getProjectManifest } from '../../project/manifests.js'
import { tokenize } from '../../az/tokenize.js'

const same = (a, b) => canonicalize(a) === canonicalize(b)
const hash = value => sourceTextHash(canonicalize(value))
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const exact = (value, keys) => plain(value) && same(Object.keys(value).sort(), [...keys].sort())
const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 128
const sequenceValid = (value, run) => Number.isSafeInteger(value) && value > 0 && value < run.nextSequence
const issue = message => ({ code: 'DATA_STAGE_NOT_READY', message })
const envelope = (run, diagnostics = []) => ({ run, lines: [], portalEvents: [], diagnostics })
const latest = (run, taskId, before = run.nextSequence) => Object.values(run.evidence.experimentsById)
  .filter(record => record.taskId === taskId && record.sequence < before).sort((a, b) => b.sequence - a.sequence)[0]
const stageFor = (lab, id) => lab.stages.find(stage => stage.id === id)
const cleanupTask = (lab, task) => lab.scenarios?.[task.verification?.scenarioId]?.mode === 'cleanup'
const finalTasks = lab => lab.tasks.filter(task => lab.stages.at(-1).taskIds.includes(task.id) && !cleanupTask(lab, task))
const pick = (value, keys) => value ? Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, cloneJson(value[key])])) : null

export const isDataCapstone = lab => lab?.capabilities?.dataCapstone === true
export function initializeDataStages(lab) {
  return { activeStageId: lab.stages[0].id, sealedStages: [], cleanupCheckpoint: null,
    data: { version: 1, protectedRefs: [], creationReceipts: [], deletionReceipts: [] } }
}
export function validateDataStageLab(lab) {
  if (!isDataCapstone(lab)) return
  const stages = lab.stages
  if (!Array.isArray(stages) || stages.length < 2 || stages.length > 7 || lab.tasks.length > 64
    || stages.some(stage => !plain(stage) || !bounded(stage.id) || !Array.isArray(stage.taskIds)
      || !stage.taskIds.length || stage.taskIds.some(id => !bounded(id)))
    || new Set(stages.map(stage => stage.id)).size !== stages.length) fail('INVALID_LAB', 'Data stages must be bounded ordered Task groups.')
  const ids = stages.flatMap(stage => stage.taskIds)
  if (new Set(ids).size !== ids.length || ids.length !== lab.tasks.length || ids.some(id => !lab.tasks.some(task => task.id === id))
    || lab.tasks.some(task => !task.verification)) fail('INVALID_LAB', 'Data stage Tasks must partition versioned measured Tasks.')
  if (!finalTasks(lab).length || lab.tasks.some(task => cleanupTask(lab, task) && !stages.at(-1).taskIds.includes(task.id)))
    fail('INVALID_LAB', 'Cleanup Tasks belong only to the final Data stage, alongside fresh recovery Tasks.')
}

/** Only configuration and captured builds: keys, rows, counters and clock are scenario facts. */
export function dataLiveFingerprint(run, lab) {
  const deployments = [lab.dataRequestTarget, lab.dataWorkerTarget].map(target => {
    if (!target) return null
    const state = run.runtime.kubernetes?.clusters?.[target.clusterId]
    const deployment = state?.resources?.[`Deployment/${target.namespace}/${target.deploymentName}`]
    const pods = Object.values(state?.resources ?? {}).filter(item => item.kind === 'Pod' && item.metadata.namespace === target.namespace
      && item.metadata.ownerReferences?.some(owner => owner.uid === deployment?.metadata.uid || owner.kind === 'ReplicaSet'
        && state.resources[`ReplicaSet/${target.namespace}/${owner.name}`]?.metadata.ownerReferences?.some(parent => parent.uid === deployment?.metadata.uid)))
    // ReplicaSets may be absent in bounded core adapters; match the deployment selector there.
    const selected = pods.length ? pods : Object.values(state?.resources ?? {}).filter(item => item.kind === 'Pod'
      && item.metadata.namespace === target.namespace && Object.entries(deployment?.spec?.selector?.matchLabels ?? {})
        .every(([key, value]) => item.metadata.labels?.[key] === value))
    const configuration = Object.values(state?.resources ?? {}).filter(item => ['ConfigMap', 'Secret'].includes(item.kind)
      && item.metadata.namespace === target.namespace).map(item => ({ kind: item.kind, name: item.metadata.name,
      // Configuration values can contain supplied credentials: keep a consistency digest.
      hash: hash(pick(item, ['data', 'stringData'])) })).sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`))
    return { target: cloneJson(target), deployment: pick(deployment, ['spec']), configuration,
      service: target.serviceName ? pick(state?.resources?.[`Service/${target.namespace}/${target.serviceName}`], ['spec']) : null,
      pods: selected.map(pod => ({ uid: pod.metadata.uid, spec: cloneJson(pod.spec), artifactId: state.podSnapshots?.[pod.metadata.uid]?.artifactId ?? null })).sort((a, b) => a.uid.localeCompare(b.uid)) }
  })
  const pg = run.sandbox.postgresServers?.find(item => item.name === lab.dataTarget?.postgres?.server && item.resourceGroup === lab.dataTarget.postgres.resourceGroup)
  const database = pg?.databases.find(item => item.name === lab.dataTarget.postgres.database)
  const cosmos = run.sandbox.cosmosAccounts?.find(item => item.name === lab.dataTarget?.cosmos?.account)
  const cosmosDb = cosmos?.databases.find(item => item.name === lab.dataTarget.cosmos.database)
  const redis = run.sandbox.redisClusters?.find(item => item.name === lab.dataTarget?.redis?.cluster && item.resourceGroup === lab.dataTarget.redis.resourceGroup)
  return { deployments, postgres: { server: pick(pg, ['name', 'resourceGroup', 'version', 'tier', 'skuName', 'vCores', 'memoryGiB', 'storageSizeGb', 'publicAccess', 'parameters']),
    database: pick(database, ['name', 'extensions', 'indexes', 'settings']), tables: (database?.tables ?? []).map(table => pick(table, ['name', 'columns', 'constraints'])) },
  cosmos: { account: pick(cosmos, ['name', 'resourceGroup', 'locations', 'consistencyPolicy', 'capabilities']),
    containers: (cosmosDb?.containers ?? []).map(container => pick(container, ['name', 'partitionKeyPath', 'throughput', 'maxThroughput', 'physicalPartitions', 'vectorEmbeddingPolicy', 'indexingPolicy'])) },
  redis: { cluster: pick(redis, ['name', 'resourceGroup', 'sku', 'hostName']), database: pick(redis?.database, ['name', 'port', 'modules', 'clusteringPolicy', 'evictionPolicy', 'clientProtocol', 'accessKeysAuthentication', 'memoryLimitBytes']),
    indexes: Object.values(redis?.database?.indexes ?? {}).map(index => pick(index, ['name', 'prefix', 'fields'])) } }
}

/** Incident adapter appends immutable starts. Each start has id and causal sequence. */
function incidentStarts(run) {
  const incident = run.runtime.dataCapstone?.incident
  if (!incident) return []
  const starts = incident.starts ?? (incident.sequence ? [{ id: incident.id, sequence: incident.sequence }] : [])
  if (!Array.isArray(starts) || starts.length > 2 || !starts.length || starts.some((start, index) => !bounded(start.id)
    || !sequenceValid(start.sequence, run) || index > 0 && start.sequence <= starts[index - 1].sequence)
    || new Set(starts.map(start => start.id)).size !== starts.length)
    fail('INVALID_RUN', 'Data incident starts must have bounded causal identities.')
  return starts.map(({ id, sequence }) => ({ id, sequence }))
}
function artifactsFor(run, ids) {
  return ids.map(id => {
    const artifact = run.artifacts.buildsById[id]
    if (!artifact) fail('INVALID_RUN', 'Data evidence artifact is missing.')
    return { id, sourceHash: artifact.sourceHash, digest: artifact.digest ?? null, contentHash: hash(artifact) }
  })
}
function recordHash(record) { const { dataCapstoneProof, ...base } = record; return hash(base) }
export function captureDataVerification(run, lab, record) {
  const fingerprint = dataLiveFingerprint(run, lab)
  const artifactIds = [...new Set([...(record.measurements.artifactIds ?? []),
    ...fingerprint.deployments.flatMap(deployment => deployment?.pods.map(pod => pod.artifactId).filter(Boolean) ?? [])])].sort()
  const proof = { version: 1, stageId: run.stages.activeStageId, sourceVersions: cloneJson(run.project.fileVersions),
    sourceHashes: Object.fromEntries(Object.entries(run.project.savedFiles).map(([path, text]) => [path, sourceTextHash(text)])),
    artifactIds, artifacts: artifactsFor(run, artifactIds), fingerprint, incidentStarts: incidentStarts(run), evidenceHash: recordHash(record) }
  if (canonicalize(proof).length > 65536) fail('INVALID_EVIDENCE', 'Data proof exceeds its compact storage bound.')
  return { ...run, evidence: { ...run.evidence, experimentsById: { ...run.evidence.experimentsById,
    [record.id]: { ...record, dataCapstoneProof: proof } } } }
}
function validateProof(run, lab, record) {
  const proof = record.dataCapstoneProof
  const stage = lab.stages.find(stage => stage.taskIds.includes(record.taskId))
  const stageIndex = lab.stages.indexOf(stage)
  const task = lab.tasks.find(task => task.id === record.taskId)
  if (!validEvidenceRecord(record, record.id) || record.attemptId !== run.attemptId || record.labId !== lab.id || record.contentVersion !== lab.contentVersion
    || !exact(proof, ['version', 'stageId', 'sourceVersions', 'sourceHashes', 'artifactIds', 'artifacts', 'fingerprint', 'incidentStarts', 'evidenceHash'])
    || proof.version !== 1 || proof.stageId !== stage?.id || proof.evidenceHash !== recordHash(record)
    || record.scenarioId !== task?.verification.scenarioId || record.scenarioVersion !== task?.verification.scenarioVersion
    || stageIndex > run.stages.sealedStages.length || record.sequence <= (run.stages.sealedStages[stageIndex - 1]?.sequence ?? 0)
    || run.stages.sealedStages[stageIndex] && record.sequence >= run.stages.sealedStages[stageIndex].sequence
    || run.stages.cleanupCheckpoint && record.sequence >= run.stages.cleanupCheckpoint.sequence && !cleanupTask(lab, task)
    || !same(proof.sourceVersions, sourceVersionsAt(run.project.sourceJournal, record.sequence))
    || !Array.isArray(proof.artifactIds) || !same(proof.artifactIds, [...new Set(proof.artifactIds)].sort())
    || !same(proof.artifacts, artifactsFor(run, proof.artifactIds)) || canonicalize(proof).length > 65536)
    fail('INVALID_RUN', 'Data evidence source, artifact or measured record linkage is invalid.')
  const sourceHashes = Object.fromEntries(Object.entries(lab.initialProjectFiles ?? {}).map(([path, text]) => {
    const save = run.project.sourceJournal.filter(event => event.path === path && event.sequence < record.sequence).at(-1)
    return [path, save?.hash ?? sourceTextHash(text)]
  }))
  if (!same(proof.sourceHashes, sourceHashes) || proof.incidentStarts.some(start => !incidentStarts(run).some(current => same(current, start))
    || start.sequence >= record.sequence)) fail('INVALID_RUN', 'Data evidence source saves or incident starts are unlinked.')
}
export function dataEvidenceCurrent(run, lab, task, record = latest(run, task.id)) {
  if (!record || record.outcome !== 'passed' || record.completed !== true || run.evidence.currentEvidenceByTask[task.id] !== record.id) return false
  try {
    validateProof(run, lab, record)
    const context = contextFor(run)
    return same(record.dataCapstoneProof.sourceVersions, run.project.fileVersions)
      && same(record.dataCapstoneProof.fingerprint, dataLiveFingerprint(run, lab))
      && same(record.dataCapstoneProof.incidentStarts, incidentStarts(run))
      && same(Object.keys(record.dependencyValues).sort(), Object.keys(task.dependencies ?? {}).sort())
      && Object.entries(task.dependencies ?? {}).every(([key, selector]) => same(record.dependencyValues[key], selector(context, task))
        && record.dependencyGenerations[key] === (run.dependencyGenerations[key] ?? 0)) && task.check(context) === true
  } catch { return false }
}
function proofSnapshot(run, lab, tasks) {
  const records = tasks.map(task => latest(run, task.id))
  return { attemptId: run.attemptId, contentVersion: run.contentVersion, stageId: run.stages.activeStageId, sequence: run.nextSequence,
    taskIds: tasks.map(task => task.id), evidenceIds: records.map(record => record.id),
    dependencyValues: Object.fromEntries(records.map(record => [record.taskId, cloneJson(record.dependencyValues)])),
    dependencyGenerations: Object.fromEntries(records.map(record => [record.taskId, cloneJson(record.dependencyGenerations)])),
    sourceVersions: cloneJson(run.project.fileVersions), artifactIds: [...new Set(records.flatMap(record => record.dataCapstoneProof.artifactIds))].sort(),
    evidenceHashes: Object.fromEntries(records.map(record => [record.id, hash(record)])) }
}
const withHash = value => ({ ...value, proofHash: hash(value) })
function validateSnapshot(run, lab, snapshot, tasks, previousSequence) {
  const { proofHash, ...body } = snapshot ?? {}
  if (!exact(snapshot, ['attemptId', 'contentVersion', 'stageId', 'sequence', 'taskIds', 'evidenceIds', 'dependencyValues', 'dependencyGenerations', 'sourceVersions', 'artifactIds', 'evidenceHashes', 'proofHash'])
    || snapshot.attemptId !== run.attemptId || snapshot.contentVersion !== run.contentVersion || proofHash !== hash(body)
    || !sequenceValid(snapshot.sequence, run) || snapshot.sequence <= previousSequence || !same(snapshot.taskIds, tasks.map(task => task.id))
    || !same(snapshot.sourceVersions, sourceVersionsAt(run.project.sourceJournal, snapshot.sequence)) || canonicalize(snapshot).length > 65536)
    fail('INVALID_RUN', 'Data checkpoint identity, sequence, source or proof hash is invalid.')
  const records = tasks.map(task => latest(run, task.id, snapshot.sequence))
  if (records.some((record, index) => !record || record.sequence <= previousSequence || record.outcome !== 'passed' || record.completed !== true
    || record.dataCapstoneProof.stageId !== snapshot.stageId || record.id !== snapshot.evidenceIds[index]
    || snapshot.evidenceHashes[record.id] !== hash(record) || !same(snapshot.dependencyValues[record.taskId], record.dependencyValues)
    || !same(snapshot.dependencyGenerations[record.taskId], record.dependencyGenerations))) fail('INVALID_RUN', 'Data checkpoint must link the latest ordered successful measured evidence.')
  if (!same(snapshot.artifactIds, [...new Set(records.flatMap(record => record.dataCapstoneProof.artifactIds))].sort()))
    fail('INVALID_RUN', 'Data checkpoint artifacts disagree with measured evidence.')
}
export function validateDataStageState(run, lab) {
  if (!isDataCapstone(lab)) return
  validateDataStageLab(lab)
  const journal = validateSourceJournal(run, lab), state = run.stages
  const runtime = run.runtime.dataCapstone
  if (!exact(runtime, ['version', 'incident', 'worker']) || runtime.version !== 1
    || !(runtime.incident === null || plain(runtime.incident)) || !exact(runtime.worker, ['lastBatch', 'artifactId'])
    || !Array.isArray(runtime.worker.lastBatch) || runtime.worker.lastBatch.length > 256
    || !(runtime.worker.artifactId === null || !!run.artifacts.buildsById[runtime.worker.artifactId]))
    fail('INVALID_RUN', 'Data capstone runtime is missing or malformed.')
  if (runtime.incident && (typeof lab.dataIncident?.validate !== 'function' || lab.dataIncident.validate(run, lab) !== true))
    fail('INVALID_RUN', 'Data incident starts require actual lifecycle receipt validation.')
  if (!exact(state, ['activeStageId', 'sealedStages', 'cleanupCheckpoint', 'data'])
    || !exact(state.data, ['version', 'protectedRefs', 'creationReceipts', 'deletionReceipts']) || state.data.version !== 1
    || ['protectedRefs', 'creationReceipts', 'deletionReceipts'].some(key => !Array.isArray(state.data[key]) || state.data[key].length > 64)
    || state.sealedStages.length > lab.stages.length || state.activeStageId !== (lab.stages[state.sealedStages.length]?.id ?? null)
    || run.evidence.milestoneRecords.length !== state.sealedStages.length) fail('INVALID_RUN', 'Data stages are missing, reordered or unsupported.')
  const records = Object.values(run.evidence.experimentsById)
  records.forEach(record => validateProof(run, lab, record))
  const manifest = getProjectManifest(run.project.manifestId)
  for (const [key, snapshot] of Object.entries(run.artifacts.sourceSnapshotsByHash)) {
    if (!plain(snapshot) || snapshot.hash !== key || !plain(snapshot.files) || Object.values(snapshot.files).some(text => typeof text !== 'string')
      || projectSourceHash(snapshot.files) !== key) fail('INVALID_RUN', 'Data source snapshot content hash is invalid.')
  }
  for (const [id, artifact] of Object.entries(run.artifacts.buildsById)) {
    const sequence = Number(/^build-([1-9]\d*)$/.exec(id)?.[1])
    const snapshot = run.artifacts.sourceSnapshotsByHash[artifact.sourceHash]
    if (!sequenceValid(sequence, run) || artifact.id !== id || !snapshot || snapshot.hash !== artifact.sourceHash
      || projectSourceHash(snapshot.files) !== artifact.sourceHash) fail('INVALID_RUN', 'Data build lacks a causal content snapshot.')
    const expectedPaths = Object.keys(selectBuildFiles(lab.initialProjectFiles ?? {}, manifest)).filter(path => Object.hasOwn(lab.initialProjectFiles ?? {}, path)).sort()
    if (!same(Object.keys(snapshot.files).sort(), expectedPaths) || expectedPaths.some(path => {
      const save = journal.filter(event => event.path === path && event.sequence < sequence).at(-1)
      return sourceTextHash(snapshot.files[path]) !== (save?.hash ?? sourceTextHash(lab.initialProjectFiles[path]))
    })) fail('INVALID_RUN', 'Data build source disagrees with its prior saves.')
  }
  const sequences = [...journal, ...records, ...state.sealedStages, ...state.data.creationReceipts, ...state.data.deletionReceipts,
    ...incidentStarts(run), ...(state.cleanupCheckpoint ? [state.cleanupCheckpoint] : [])].map(item => item.sequence)
  sequences.push(...Object.keys(run.artifacts.buildsById).map(id => Number(id.slice(6))))
  if (sequences.some(sequence => !sequenceValid(sequence, run)) || new Set(sequences).size !== sequences.length)
    fail('INVALID_RUN', 'Data saves, builds, evidence, incidents, receipts and checkpoints require unique causal sequences.')
  let previous = 0
  state.sealedStages.forEach((seal, index) => {
    const stage = lab.stages[index]
    validateSnapshot(run, lab, seal, stage.taskIds.map(id => lab.tasks.find(task => task.id === id)), previous)
    if (seal.stageId !== stage.id || !same(run.evidence.milestoneRecords[index], { kind: 'data-stage-seal', stageId: seal.stageId,
      sequence: seal.sequence, attemptId: run.attemptId, snapshot: canonicalize(seal) })) fail('INVALID_RUN', 'Data seal order disagrees with its persisted milestone.')
    previous = seal.sequence
  })
  const checkpoint = state.cleanupCheckpoint
  if (checkpoint) {
    validateSnapshot(run, lab, checkpoint, finalTasks(lab), state.sealedStages[lab.stages.length - 2]?.sequence ?? 0)
    if (checkpoint.stageId !== lab.stages.at(-1).id || state.sealedStages.length < lab.stages.length - 1
      || !same(run.evidence.dataCleanupReceipt, { sequence: checkpoint.sequence, attemptId: run.attemptId, snapshot: canonicalize(checkpoint) })
      || !same(checkpoint.sourceVersions, run.project.fileVersions)
      || checkpoint.taskIds.some(id => latest(run, id)?.id !== checkpoint.evidenceIds[checkpoint.taskIds.indexOf(id)])
      || checkpoint.evidenceIds.some(id => !same(run.evidence.experimentsById[id].dataCapstoneProof.incidentStarts, incidentStarts(run)))
      || Object.keys(run.artifacts.buildsById).some(id => Number(id.slice(6)) >= checkpoint.sequence)
      || state.data.creationReceipts.some(receipt => receipt.sequence >= checkpoint.sequence)
      || state.data.deletionReceipts.some(receipt => receipt.sequence <= checkpoint.sequence)) fail('INVALID_RUN', 'Data cleanup checkpoint is unlinked or source changed after freeze.')
  } else if (run.evidence.dataCleanupReceipt !== undefined || state.sealedStages.length === lab.stages.length)
    fail('INVALID_RUN', 'Final Data seal requires a frozen recovery checkpoint.')
  if (run.completedAt !== null && state.sealedStages.length !== lab.stages.length) fail('INVALID_RUN', 'Data completion requires every ordered seal.')
  if (state.sealedStages.length === lab.stages.length && !dataCleanupReady(run, lab)) fail('INVALID_RUN', 'The final Data seal requires verified owned cleanup.')
}
export function dataSealedTaskIds(run, lab) { return new Set(lab.stages.slice(0, run.stages.sealedStages.length).flatMap(stage => stage.taskIds)) }
export function dataCleanupReady(run, lab) {
  try { return !!run.stages.cleanupCheckpoint && typeof lab.dataCleanup?.ready === 'function' && lab.dataCleanup.ready(run, lab) === true } catch { return false }
}
export function freezeDataCleanup(run, lab) {
  if (!isDataCapstone(lab)) return envelope(run, [issue('Data capstone capability is required.')])
  validateDataStageState(run, lab)
  if (run.stages.cleanupCheckpoint) return envelope(run)
  const tasks = finalTasks(lab)
  if (run.stages.activeStageId !== lab.stages.at(-1).id || run.runtime.activeScenario
    || Object.entries(run.project.savedFiles).some(([path, text]) => run.project.draftFiles[path] !== text)
    || tasks.some(task => !dataEvidenceCurrent(run, lab, task) || latest(run, task.id).sequence <= run.stages.sealedStages.at(-1).sequence
      || incidentStarts(run).some(start => latest(run, task.id).sequence <= start.sequence)))
    return envelope(run, [issue('Verify all final recovery Tasks against current builds and service settings after every incident start.')])
  const checkpoint = withHash(proofSnapshot(run, lab, tasks))
  return envelope({ ...run, nextSequence: run.nextSequence + 1, stages: { ...run.stages, cleanupCheckpoint: checkpoint },
    evidence: { ...run.evidence, dataCleanupReceipt: { sequence: checkpoint.sequence, attemptId: run.attemptId, snapshot: canonicalize(checkpoint) } } })
}
export function advanceDataStage(run, lab) {
  if (!isDataCapstone(lab)) return envelope(run, [issue('Data capstone capability is required.')])
  validateDataStageState(run, lab)
  const stage = stageFor(lab, run.stages.activeStageId)
  if (!stage) return envelope(run, [issue('All Data stages are already sealed.')])
  const tasks = stage.taskIds.map(id => lab.tasks.find(task => task.id === id))
  if (stage.id === lab.stages.at(-1).id && !dataCleanupReady(run, lab)) return envelope(run, [issue('Freeze final proof, then verify exact owned-resource cleanup before the final seal.')])
  if (tasks.some(task => run.stages.cleanupCheckpoint && !cleanupTask(lab, task)
    ? !run.stages.cleanupCheckpoint.taskIds.includes(task.id) : !dataEvidenceCurrent(run, lab, task)))
    return envelope(run, [issue('Every active Task needs an actual successful check and current measured evidence.')])
  const seal = withHash(proofSnapshot(run, lab, tasks))
  return envelope({ ...run, nextSequence: run.nextSequence + 1,
    stages: { ...run.stages, activeStageId: lab.stages[run.stages.sealedStages.length + 1]?.id ?? null, sealedStages: [...run.stages.sealedStages, seal] },
    evidence: { ...run.evidence, milestoneRecords: [...run.evidence.milestoneRecords, { kind: 'data-stage-seal', stageId: seal.stageId,
      sequence: seal.sequence, attemptId: run.attemptId, snapshot: canonicalize(seal) }] } })
}
/** Authored ownership adapter alone may authorize exact deletion; absent adapter fails closed. */
export function dataStageFrozenActionAllowed(run, action, lab) {
  if (!run.stages.cleanupCheckpoint) return true
  if (action.type === 'data-advance-stage' && Object.keys(action).length === 1) return true
  if (action.type === 'data-capstone') {
    const scenario = lab.scenarios?.[action.scenarioId]
    return Object.keys(action).length === 2 && scenario?.stageId === run.stages.activeStageId
      && ['cleanup', 'inspect'].includes(scenario.mode) && scenario.steps.every(step => step.action === 'inspect')
  }
  if (action.type === 'command' && typeof action.line === 'string') {
    const parsed = tokenize(action.line)
    if (parsed.error) return false
    const [tool, verb, subverb] = parsed.tokens ?? []
    if (tool === 'az' && ['show', 'list'].includes(subverb) || tool === 'kubectl' && ['get', 'describe', 'logs'].includes(verb)) return true
    return typeof lab.dataCleanup?.allowAction === 'function' && lab.dataCleanup.allowAction(run, action, lab) === true
  }
  return false
}
export function dataStageView(run, lab) {
  return cloneJson({ activeStageId: run.stages.activeStageId, stages: lab.stages.map((stage, index) => ({ id: stage.id, taskIds: stage.taskIds,
    sealed: index < run.stages.sealedStages.length, active: stage.id === run.stages.activeStageId })),
    sealedStages: run.stages.sealedStages, cleanupCheckpoint: run.stages.cleanupCheckpoint, cleanupReady: dataCleanupReady(run, lab) })
}
