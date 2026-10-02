import { canonicalize } from '../evidence.js'
import { sourceTextHash } from '../sourceJournal.js'
import { getDeploymentPods } from '../../kubernetes/reconcile.js'
import { pgDeployedArtifact } from '../../../data/labs/data-journey/postgres-helpers.js'
import { readItem, findContainer } from '../../data/cosmos-store.js'
import { CAPSTONE_CORPUS, CAPSTONE_REVISION_2 } from '../../../data/fixtures/data/capstone.js'
import { DATA_CAPSTONE_CLIENT_VARIANTS, DATA_CAPSTONE_FAULTY_PROCESS_CHANGES, DATA_CAPSTONE_SOLUTION_FUNCTIONS } from '../../../data/templates/data-python/capstone.js'

const ids = ['worker-checkpoint', 'cache-masked-pool']
const clone = value => structuredClone(value)
const same = (a, b) => a !== undefined && b !== undefined && canonicalize(a) === canonicalize(b)
const hash = value => sourceTextHash(canonicalize(value))
const invalid = (run, message) => ({ run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_INCIDENT', message }] })
const envelope = run => ({ run, lines: [], portalEvents: [], diagnostics: [] })
const snapshotFiles = (run, id) => run.artifacts.sourceSnapshotsByHash[run.artifacts.buildsById[id]?.sourceHash]?.files
const server = (run, lab) => run.sandbox.postgresServers.find(item => item.name === lab.dataTarget.postgres.server && item.resourceGroup === lab.dataTarget.postgres.resourceGroup)
const lease = (run, lab) => readItem(run.sandbox, { ...lab.dataTarget.cosmos, container: 'leases' }, 'feedback-worker', 'feedback-worker')?.continuation ?? null
export function dataIncidentCacheFacts(run, lab) {
  const keys = run.sandbox.redisClusters.find(item => item.name === lab.dataTarget.redis.cluster && item.resourceGroup === lab.dataTarget.redis.resourceGroup)?.database.keys ?? {}
  return clone(Object.fromEntries(Object.entries(keys).filter(([key]) => /^ka:(answer|sem):/.test(key))))
}
function liveWorker(run, lab) {
  const target = lab.dataWorkerTarget
  const pod = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
    .find(item => item.status.phase === 'Running' && item.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True'))
  return pod && run.runtime.kubernetes.clusters[target.clusterId].podSnapshots[pod.metadata.uid]?.artifactId
}
function revision(run, lab, product, number) {
  const db = server(run, lab)?.databases.find(item => item.name === lab.dataTarget.postgres.database)
  const rows = db?.tables.find(item => item.name === 'chunks')?.rows ?? []
  const revised = CAPSTONE_REVISION_2[product].chunks.every(patch => rows.some(row => row.id === patch.id && row.content === patch.content))
  return number === 2 ? revised : CAPSTONE_REVISION_2[product].chunks.every(patch => {
    const original = CAPSTONE_CORPUS.chunks.find(row => row.id === patch.id)
    return rows.some(row => row.id === original.id && row.content === original.content)
  })
}
const liveKeys = (keys, product, now) => Object.entries(keys).filter(([key, entry]) => key.includes(`:${product}:`) && (entry.expiresAtMs === null || entry.expiresAtMs > now))
const bothNamespaces = entries => ['ka:answer:', 'ka:sem:'].every(prefix => entries.some(([key]) => key.startsWith(prefix)))
const supportIntact = (entry, keys) => entry.baseline.supportKeys.every(([key, value]) => same(keys[key], value))
const recordFor = (run, id) => run.evidence.experimentsById[id]
const exactKeys = (value, keys) => value && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
const goodAnswers = m => m.status === 200 && m.traceComplete && m.answersCorrect && m.scopeCorrect && m.provenanceValid
const workerOps = m => m.worker.operations ?? []

function workerObserved(entry, records) {
  return records.some(record => {
    const m = record.measurements
    return m.traceComplete && m.status === 200 && m.staleAnswers >= 2 && m.responseHits >= 1 && m.semanticHits >= 1
      && m.requests.filter(request => request.route === 'GET /answer' && request.scope.product === 'contoso-backup')
        .every(request => request.body?.answer?.includes('35 days') && request.returnedFrom?.endsWith('cache'))
      && workerOps(m).some(op => op.action === 'worker-batch' && op.artifactId === entry.faultArtifactId && op.ready === true
        && op.before === entry.baseline.continuation && op.after === op.before && op.pendingEventIds.includes(entry.eventId) && !op.handledEventIds.includes(entry.eventId))
      && bothNamespaces(liveKeys(m.cache.after, 'contoso-backup', record.endedAtMs))
      && supportIntact(entry, m.cache.after)
  })
}
function workerRecovered(run, entry, records) {
  const recovered = records.find(record => {
    const m = record.measurements
    const batch = workerOps(m).find(op => op.action === 'worker-batch' && op.handledEventIds.includes(entry.eventId))
    const artifact = run.artifacts.buildsById[batch?.artifactId]
    const files = snapshotFiles(run, artifact?.id)
    const removed = batch?.invalidatedKeys ?? []
    return goodAnswers(m) && artifact?.image.tag === 'capstone-worker-fixed' && artifact.id !== entry.faultArtifactId
      && Number(artifact.id.slice(6)) > entry.sequence && files?.['worker.py'].includes(DATA_CAPSTONE_SOLUTION_FUNCTIONS.process_changes)
      && batch.before === entry.baseline.continuation && batch.after !== batch.before
      && entry.baseline.backupKeys.every(([key]) => removed.some(effect => effect.key === key && effect.command === 'DEL'))
      && ['ka:answer:', 'ka:sem:'].every(prefix => removed.some(effect => effect.key.startsWith(`${prefix}contoso-backup:`)))
      && supportIntact(entry, m.cache.after) && m.semanticHits >= 1 && m.ragMisses >= 1
      && m.requests.filter(request => request.route === 'GET /answer' && request.scope.product === 'contoso-backup').length >= 2
      && m.requests.filter(request => request.route === 'GET /answer' && request.scope.product === 'contoso-backup').every(request => request.body.answer.includes('14 days'))
      && record.endedAtMs < Math.min(...entry.baseline.backupKeys.map(([, value]) => value.expiresAtMs ?? Infinity))
  })
  if (!recovered) return false
  const later = records.filter(record => record.sequence >= recovered.sequence)
  const operations = later.flatMap(record => workerOps(record.measurements))
  const restartProof = later.flatMap(record => record.measurements.worker.restarts.map(restart => ({ record, restart })))
    .find(({ restart }) => restart.beforePodUid !== restart.afterPodUid && run.artifacts.buildsById[restart.artifactId]?.image.tag === 'capstone-worker-fixed')
  const replay = operations.some(op => op.action === 'worker-redeliver' && op.status === 200 && op.before === op.after && op.deliveredEventIds.includes(entry.eventId)
    && run.artifacts.buildsById[op.artifactId]?.image.tag === 'capstone-worker-fixed')
  const positive = later.some(record => record.measurements.requests.some(request => request.route === 'POST /feedback' && request.args[2] === true
    && workerOps(record.measurements).some(op => op.action === 'worker-batch' && op.stepIndex > request.stepIndex && op.handledEventIds.includes(request.args[0])
      && op.status === 200 && op.invalidatedKeys.length === 0 && bothNamespaces(liveKeys(op.beforeKeys, 'contoso-backup', record.endedAtMs))
      && same(op.beforeKeys, op.afterKeys))))
  const afterRestart = restartProof && later.some(record => record.sequence >= restartProof.record.sequence
    && workerOps(record.measurements).some(op => (record.sequence > restartProof.record.sequence || op.stepIndex > restartProof.restart.stepIndex)
      && op.artifactId === restartProof.restart.artifactId && op.action === 'worker-batch' && op.status === 200 && op.before === op.after && op.handledEventIds.length === 0))
  return !!restartProof && replay && positive && afterRestart
}
function poolObserved(entry, records) {
  const warm = records.find(record => record.measurements.load?.originRequests === 0 && record.measurements.load.failed === 0
    && record.measurements.artifactIds.includes(entry.faultArtifactId))
  return !!warm && records.some(record => record.sequence > warm.sequence && record.measurements.load?.startedAtMs >= warm.endedAtMs + 61000
    && record.measurements.artifactIds.includes(entry.faultArtifactId) && record.measurements.load?.originRequests > 0
    && record.measurements.load.failed > 0 && record.measurements.load.mode === 'pool' && record.measurements.load.poolMaxSize === 12
    && record.measurements.load.replicas === 3 && record.measurements.load.serverParameters.max_connections === '20'
    && record.measurements.load.errors.some(error => error.includes('too many clients already')))
}
function poolRecovered(run, entry, records) {
  return records.some(record => {
    const m = record.measurements; const load = m.load
    const artifact = m.artifactIds.map(id => run.artifacts.buildsById[id]).find(item => item?.image.tag === 'capstone-pool-fixed')
    return goodAnswers(m) && load?.originRequests > 0 && load.throughputRps >= 190 && load.failed === 0 && load.peakServerConnections <= 17
      && load.p95Ms <= 20 && load.mode === 'pgbouncer' && load.poolMaxSize === 4 && load.replicas === 3
      && load.coldAfterSeconds >= 61 && load.serverParameters['pgbouncer.enabled'] === 'true' && load.serverParameters['pgbouncer.default_pool_size'] === '12'
      && m.historyWrites >= 2 && m.requests.some(request => request.returnedFrom === 'postgres' && request.historyWrites === 2)
      && Number(artifact?.id.slice(6)) > entry.sequence && snapshotFiles(run, artifact?.id)?.['clients.py'] === DATA_CAPSTONE_CLIENT_VARIANTS.fixed
      && record.startedAtMs >= entry.startedAtMs + 61000
  })
}
function statusFor(run, entry, observationIds, recoveryIds) {
  const observations = observationIds.map(id => recordFor(run, id)); const recoveries = recoveryIds.map(id => recordFor(run, id))
  if (observations.some(record => !record) || recoveries.some(record => !record)) return null
  const observed = entry.id === ids[0] ? workerObserved(entry, observations) : poolObserved(entry, observations)
  if (!observed) return 'active'
  const recovered = entry.id === ids[0] ? workerRecovered(run, entry, recoveries) : poolRecovered(run, entry, recoveries)
  return recovered ? 'resolved' : 'observed'
}

/** Trusted internal primitives come only from applyRunAction, never Lab JSON. */
export function startDataIncident(input, lab, incidentId, primitives) {
  if (lab.capabilities?.dataCapstone !== true || !ids.includes(incidentId) || input.stages.cleanupCheckpoint
    || lab.dataIncident?.stageIds?.[incidentId] !== input.stages.activeStageId || input.runtime.activeScenario
    || input.runtime.dataCapstone.incident?.starts.some(start => start.id === incidentId)) return invalid(input, 'Incident injection is one-shot and available only in its declared active stage.')
  if (!primitives?.command || !primitives?.saveFile || !primitives?.corpusUpdate) return invalid(input, 'Incident injection requires the internal source-save and command dispatcher.')
  const prior = input.runtime.dataCapstone.incident
  const keys = dataIncidentCacheFacts(input, lab)
  const backupKeys = liveKeys(keys, 'contoso-backup', input.runtime.simTimeMs)
  const supportKeys = liveKeys(keys, 'contoso-support', input.runtime.simTimeMs)
  const api = pgDeployedArtifact(input, lab.dataRequestTarget)
  const workerId = liveWorker(input, lab)
  const baselineIds = Object.values(input.evidence.experimentsById).filter(record => record.sequence < input.nextSequence
    && goodAnswers(record.measurements) && record.measurements.requests?.some(request => request.scope.product === 'contoso-backup')).map(record => record.id)
  const registry = input.sandbox.containerRegistries.find(item => item.name === lab.dataIncident.registryName)
  const supportEvent = findContainer(input.sandbox, { ...lab.dataTarget.cosmos, container: 'events' })?.items.find(item => item.type === 'document-update' && item.product === 'contoso-support' && item.revision === 2)
  const path = incidentId === ids[0] ? 'worker.py' : 'clients.py'
  const source = input.project.savedFiles[path]
  const originalProcess = DATA_CAPSTONE_SOLUTION_FUNCTIONS.process_changes
  if (!api || !workerId || !registry || !baselineIds.length || !bothNamespaces(backupKeys) || !bothNamespaces(supportKeys) || lease(input, lab) === null
    || !supportEvent || !Object.values(input.evidence.experimentsById).some(record => record.measurements.worker?.handledEventIds.includes(supportEvent.id))
    || !revision(input, lab, 'contoso-support', 2) || !revision(input, lab, 'contoso-backup', incidentId === ids[0] ? 1 : 2)
    || incidentId === ids[0] && (!source.includes(originalProcess) || source.split(originalProcess).length !== 2)
    || incidentId === ids[1] && (prior?.records.find(entry => entry.id === ids[0])?.status !== 'resolved'
      || ![DATA_CAPSTONE_CLIENT_VARIANTS.naive, DATA_CAPSTONE_CLIENT_VARIANTS.pooled, DATA_CAPSTONE_CLIENT_VARIANTS.fixed].includes(source)))
    return invalid(input, 'Retain measured healthy builds, Support revision 2, durable lease and fresh exact/semantic caches; declared fault source prerequisites differ.')
  const tag = incidentId === ids[0] ? 'capstone-worker-fault' : 'capstone-pool-fault'
  const target = incidentId === ids[0] ? lab.dataWorkerTarget : lab.dataRequestTarget
  const manifestPath = incidentId === ids[0] ? 'k8s/worker.yaml' : 'k8s/deployment.yaml'
  const manifest = input.project.savedFiles[manifestPath]
  const deployment = input.runtime.kubernetes.clusters[target.clusterId].resources[`Deployment/${target.namespace}/${target.deploymentName}`]
  const currentImage = deployment?.spec.template.spec.containers[0].image
  if (!currentImage || typeof manifest !== 'string' || manifest.split(`image: ${currentImage}`).length !== 2
    || !same(snapshotFiles(input, incidentId === ids[0] ? workerId : api.id)?.[path], source)
    || input.project.draftFiles[path] !== source || input.project.draftFiles[manifestPath] !== manifest)
    return invalid(input, 'Save drafts and retain the declared deployed image/manifest and source before injection.')
  let run = clone(input); const sequence = run.nextSequence++
  const entry = { id: incidentId, sequence, stageId: input.stages.activeStageId, startedAtMs: input.runtime.simTimeMs,
    baseline: { evidenceIds: baselineIds, apiArtifactId: api.id, workerArtifactId: workerId, continuation: lease(input, lab), backupKeys, supportKeys },
    eventId: incidentId === ids[0] ? 'capstone-backup-revision-2' : null, updateReceipt: null, faultArtifactId: null, receipts: [], observationEvidenceIds: [], recoveryEvidenceIds: [], status: 'active' }
  const execute = action => {
    const before = run
    const result = (action.type === 'command' ? primitives.command : primitives.saveFile)(run, action, lab)
    if (result.diagnostics.length || result.lines.some(line => line.kind === 'err')) throw new Error(result.diagnostics[0]?.message ?? result.lines.find(line => line.kind === 'err').text)
    run = result.run
    const afterSequence = run.nextSequence
    const receiptSequence = afterSequence
    run = { ...run, nextSequence: afterSequence + 1 }
    const currentTarget = run.runtime.kubernetes.clusters[target.clusterId].resources[`Deployment/${target.namespace}/${target.deploymentName}`]
    const receipt = { sequence: receiptSequence, action: clone(action), beforeSequence: before.nextSequence, afterSequence,
      beforeHash: action.type === 'save-file' ? sourceTextHash(before.project.savedFiles[action.path]) : hash({ sandbox: before.sandbox, kubernetes: before.runtime.kubernetes, artifacts: before.artifacts }),
      afterHash: action.type === 'save-file' ? sourceTextHash(run.project.savedFiles[action.path]) : hash({ sandbox: run.sandbox, kubernetes: run.runtime.kubernetes, artifacts: run.artifacts }),
      observed: { deploymentUid: currentTarget?.metadata.uid ?? null, image: currentTarget?.spec.template.spec.containers[0].image ?? null,
        replicas: currentTarget?.spec.replicas ?? null, artifactId: incidentId === ids[0] ? liveWorker(run, lab) ?? null : pgDeployedArtifact(run, lab.dataRequestTarget)?.id ?? null,
        maxConnections: server(run, lab).parameters.max_connections } }
    entry.receipts.push({ ...receipt, receiptHash: hash(receipt) })
    run.scrollback = [...run.scrollback, ...(action.type === 'save-file' ? [{ kind: 'out', text: `Incident saved ${action.path}:\n${action.text}` }] : [])].slice(-600)
  }
  try {
    if (incidentId === ids[0]) {
      execute({ type: 'command', line: `kubectl delete deployment ${target.deploymentName} -n ${target.namespace}` })
      run = primitives.corpusUpdate(run, lab, { product: 'contoso-backup', revision: 2, eventId: entry.eventId })
      const event = readItem(run.sandbox, { ...lab.dataTarget.cosmos, container: 'events' }, entry.eventId, 'contoso-backup')
      const update = { afterStopSequence: entry.receipts[0].sequence, beforeSaveSequence: run.nextSequence,
        event: clone(event), change: clone(findContainer(run.sandbox, { ...lab.dataTarget.cosmos, container: 'events' }).changeLog.at(-1)),
        continuation: lease(run, lab), revision: 2 }
      entry.updateReceipt = { ...update, receiptHash: hash(update) }
    }
    execute({ type: 'save-file', path, text: incidentId === ids[0] ? source.replace(originalProcess, DATA_CAPSTONE_FAULTY_PROCESS_CHANGES) : DATA_CAPSTONE_CLIENT_VARIANTS.fault })
    execute({ type: 'command', line: `az acr build --registry ${registry.name} --image assistant:${tag} .` })
    entry.faultArtifactId = run.artifacts.publishedTags[`${registry.loginServer}/assistant:${tag}`]
    execute({ type: 'save-file', path: manifestPath, text: manifest.replace(`image: ${currentImage}`, `image: ${registry.loginServer}/assistant:${tag}`) })
    execute({ type: 'command', line: `kubectl apply -f ${manifestPath}` })
    if (incidentId === ids[1]) {
      execute({ type: 'command', line: `kubectl scale deployment/${target.deploymentName} --replicas 3 -n ${target.namespace}` })
      execute({ type: 'command', line: `az postgres flexible-server parameter set -g ${lab.dataTarget.postgres.resourceGroup} --server-name ${lab.dataTarget.postgres.server} --name max_connections --value 20` })
    }
    if ((incidentId === ids[0] ? liveWorker(run, lab) : pgDeployedArtifact(run, lab.dataRequestTarget)?.id) !== entry.faultArtifactId
      || incidentId === ids[0] && pgDeployedArtifact(run, lab.dataRequestTarget)?.id !== api.id) throw new Error('The declared fault image must be captured by ready target Pods.')
  } catch (error) { return invalid(input, `Incident commands failed: ${error.message}`) }
  run.runtime.dataCapstone.incident = { version: 1, starts: [...(prior?.starts ?? []), { id: incidentId, sequence }], records: [...(prior?.records ?? []), entry] }
  return { ...envelope(run), lines: [{ kind: 'out', text: `Incident ${incidentId}: captured ${entry.faultArtifactId}. Inspect visible saves and commands.`, incident: clone(entry) }] }
}

export function observeDataIncident(input, lab, evidenceId) {
  if (!input.runtime.dataCapstone.incident) return input
  const run = clone(input); const record = recordFor(run, evidenceId)
  for (const entry of run.runtime.dataCapstone.incident.records) {
    if (entry.status === 'resolved' || record.sequence <= entry.sequence || record.dataCapstoneProof.stageId !== entry.stageId) continue
    if (entry.observationEvidenceIds.length >= 32 || entry.recoveryEvidenceIds.length >= 32) continue
    const field = entry.status === 'active' ? 'observationEvidenceIds' : 'recoveryEvidenceIds'
    entry[field].push(evidenceId)
    entry.status = statusFor(run, entry, entry.observationEvidenceIds, entry.recoveryEvidenceIds)
  }
  return run
}

export function validateDataIncident(run, lab) {
  const state = run.runtime.dataCapstone.incident
  if (state === null) return true
  try {
    if (!exactKeys(state, 'version,starts,records') || state.version !== 1 || !Array.isArray(state.starts) || state.starts.length < 1 || state.starts.length > 2
      || !Array.isArray(state.records) || state.records.length !== state.starts.length || new Set(state.starts.map(start => start.id)).size !== state.starts.length) return false
    let previous = 0
    for (const [index, entry] of state.records.entries()) {
      if (!exactKeys(entry, 'id,sequence,stageId,startedAtMs,baseline,eventId,updateReceipt,faultArtifactId,receipts,observationEvidenceIds,recoveryEvidenceIds,status')
        || !ids.includes(entry.id) || !same(state.starts[index], { id: entry.id, sequence: entry.sequence }) || entry.sequence <= previous
        || entry.sequence >= run.nextSequence || !Number.isSafeInteger(entry.sequence) || lab.dataIncident.stageIds[entry.id] !== entry.stageId
        || !Array.isArray(entry.receipts) || entry.receipts.length < 4 || entry.receipts.length > 8
        || !exactKeys(entry.baseline, 'evidenceIds,apiArtifactId,workerArtifactId,continuation,backupKeys,supportKeys')
        || !entry.baseline.evidenceIds.length || entry.baseline.evidenceIds.some(id => !recordFor(run, id) || recordFor(run, id).sequence >= entry.sequence
          || !goodAnswers(recordFor(run, id).measurements))
        || !run.artifacts.buildsById[entry.baseline.apiArtifactId] || !run.artifacts.buildsById[entry.baseline.workerArtifactId]
        || !Number.isFinite(entry.startedAtMs) || entry.startedAtMs < 0
        || !bothNamespaces(entry.baseline.backupKeys) || !bothNamespaces(entry.baseline.supportKeys) || entry.baseline.continuation === null) return false
      previous = entry.sequence
      let receiptSequence = entry.sequence
      for (const receipt of entry.receipts) {
        const { receiptHash, ...body } = receipt
        if (!exactKeys(receipt, 'sequence,action,beforeSequence,afterSequence,beforeHash,afterHash,observed,receiptHash') || hash(body) !== receiptHash
          || !Number.isSafeInteger(receipt.sequence) || receipt.sequence <= receiptSequence || receipt.sequence >= run.nextSequence
          || receipt.beforeSequence !== receiptSequence + 1 || receipt.afterSequence !== receipt.sequence
          || typeof receipt.beforeHash !== 'string' || typeof receipt.afterHash !== 'string') return false
        receiptSequence = receipt.sequence
        if (receipt.action.type === 'save-file' && !run.project.sourceJournal.some(save => save.sequence === receipt.beforeSequence
          && save.path === receipt.action.path && save.hash === receipt.afterHash && save.hash === sourceTextHash(receipt.action.text))) return false
      }
      const artifact = run.artifacts.buildsById[entry.faultArtifactId]; const files = snapshotFiles(run, entry.faultArtifactId)
      const tag = entry.id === ids[0] ? 'capstone-worker-fault' : 'capstone-pool-fault'
      if (artifact?.image.tag !== tag || artifact.image.repository !== 'assistant' || Number(artifact.id.slice(6)) <= entry.sequence
        || !entry.receipts.some(receipt => receipt.action.type === 'command' && receipt.beforeSequence === Number(artifact.id.slice(6))
          && receipt.action.line === `az acr build --registry ${lab.dataIncident.registryName} --image assistant:${tag} .`)
        || entry.id === ids[0] && (!files['worker.py'].includes(DATA_CAPSTONE_FAULTY_PROCESS_CHANGES) || entry.eventId !== 'capstone-backup-revision-2')
        || entry.id === ids[1] && files['clients.py'] !== DATA_CAPSTONE_CLIENT_VARIANTS.fault) return false
      const worker = entry.id === ids[0]
      const target = worker ? lab.dataWorkerTarget : lab.dataRequestTarget
      const sourcePath = worker ? 'worker.py' : 'clients.py'
      const manifestPath = worker ? 'k8s/worker.yaml' : 'k8s/deployment.yaml'
      const image = `${artifact.image.loginServer}/assistant:${tag}`
      const actions = [
        ...(worker ? [{ type: 'command', line: `kubectl delete deployment ${target.deploymentName} -n ${target.namespace}` }] : []),
        { type: 'save-file', path: sourcePath, text: files[sourcePath] },
        { type: 'command', line: `az acr build --registry ${lab.dataIncident.registryName} --image assistant:${tag} .` },
        // This saved manifest is independently linked to its journal/hash below.
        { type: 'save-file', path: manifestPath, text: entry.receipts[worker ? 3 : 2]?.action.text },
        { type: 'command', line: `kubectl apply -f ${manifestPath}` },
        ...(!worker ? [{ type: 'command', line: `kubectl scale deployment/${target.deploymentName} --replicas 3 -n ${target.namespace}` },
          { type: 'command', line: `az postgres flexible-server parameter set -g ${lab.dataTarget.postgres.resourceGroup} --server-name ${lab.dataTarget.postgres.server} --name max_connections --value 20` }] : []),
      ]
      if (!same(entry.receipts.map(receipt => receipt.action), actions)
        || !actions[worker ? 3 : 2].text.includes(`image: ${image}`)
        || worker && (entry.receipts[0].observed.deploymentUid !== null || entry.receipts[0].observed.artifactId !== null)
        || entry.receipts[worker ? 4 : 3].observed.artifactId !== entry.faultArtifactId
        || entry.receipts[worker ? 4 : 3].observed.image !== image
        || !worker && (entry.receipts[4].observed.replicas !== 3 || entry.receipts[5].observed.maxConnections !== '20')) return false
      const sourceReceipt = entry.receipts[worker ? 1 : 0]
      const previousSource = worker ? files['worker.py'].replace(DATA_CAPSTONE_FAULTY_PROCESS_CHANGES, DATA_CAPSTONE_SOLUTION_FUNCTIONS.process_changes)
        : snapshotFiles(run, entry.baseline.apiArtifactId)['clients.py']
      if (sourceReceipt.beforeHash !== sourceTextHash(previousSource)) return false
      if (worker && (!exactKeys(entry.updateReceipt, 'afterStopSequence,beforeSaveSequence,event,change,continuation,revision,receiptHash')
        || entry.updateReceipt.afterStopSequence !== entry.receipts[0].sequence || entry.updateReceipt.beforeSaveSequence !== sourceReceipt.beforeSequence
        || entry.updateReceipt.continuation !== entry.baseline.continuation || entry.updateReceipt.revision !== 2
        || entry.updateReceipt.event.id !== entry.eventId || entry.updateReceipt.event.type !== 'document-update'
        || entry.updateReceipt.event.product !== 'contoso-backup' || entry.updateReceipt.event.revision !== 2
        || !Number.isSafeInteger(entry.updateReceipt.event._version)) || !worker && entry.updateReceipt !== null) return false
      if (worker) {
        const { receiptHash, ...update } = entry.updateReceipt
        const { change, event } = update
        const originalBody = Object.fromEntries(Object.entries(event).filter(([key]) => !key.startsWith('_')))
        const container = findContainer(run.sandbox, { ...lab.dataTarget.cosmos, container: 'events' })
        // Change feed strips item metadata and remains append-only across later
        // writes. Keep the captured version in the hash after service cleanup.
        if (hash(update) !== receiptHash || !exactKeys(change, 'lsn,id,partition,ts,body')
          || !Number.isSafeInteger(change.lsn) || change.lsn < 1 || change.id !== event.id || change.partition !== event.product
          || change.ts !== event._ts || !same(change.body, originalBody)
          || container && !(container.changeLog ?? []).some(retained => same(retained, change))) return false
      }
      if (entry.observationEvidenceIds.length && entry.recoveryEvidenceIds.length
        && Math.max(...entry.observationEvidenceIds.map(id => recordFor(run, id).sequence)) >= Math.min(...entry.recoveryEvidenceIds.map(id => recordFor(run, id).sequence))) return false
      for (const field of ['observationEvidenceIds', 'recoveryEvidenceIds']) {
        if (!Array.isArray(entry[field]) || entry[field].length > 32 || new Set(entry[field]).size !== entry[field].length
          || entry[field].some(id => !recordFor(run, id) || recordFor(run, id).sequence <= receiptSequence || recordFor(run, id).dataCapstoneProof.stageId !== entry.stageId)) return false
      }
      if (entry.status !== statusFor(run, entry, entry.observationEvidenceIds, entry.recoveryEvidenceIds)
        || entry.id === ids[1] && state.records[0]?.status !== 'resolved') return false
    }
    return true
  } catch { return false }
}
export function dataIncidentView(run, lab) {
  if (!validateDataIncident(run, lab)) return { incidents: [], valid: false }
  return { incidents: clone(run.runtime.dataCapstone.incident?.records ?? []), valid: true }
}
