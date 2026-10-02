import { expect, it } from 'vitest'
import * as bridge from '../src/lib/kubernetes/data-actions.js'
import { parseDataApp } from '../src/lib/data/python-sdk.js'
import { createSandbox } from '../src/lib/sandbox/model.js'
import { createResourceGroup } from '../src/lib/sandbox/ops.js'
import { createPostgresServer, createPostgresDatabase, setPostgresParameter } from '../src/lib/sandbox/postgres.js'
import { createRedisCluster } from '../src/lib/sandbox/redis.js'
import { createCosmosAccount, createCosmosDatabase, createCosmosContainer } from '../src/lib/sandbox/cosmosdb.js'
import { executePg, loadCorpus } from '../src/lib/data/pg-engine.js'
import { executeRedis } from '../src/lib/data/redis-store.js'
import { upsertItem, readItem } from '../src/lib/data/cosmos-store.js'
import { recordChange } from '../src/lib/data/change-feed.js'
import { reconcileKubernetes, getDeploymentPods } from '../src/lib/kubernetes/reconcile.js'
import { ACR_PULL_ROLE_ID } from '../src/lib/sandbox/roleAssignments.js'
import { DATA_CAPSTONE_TARGET, DATA_CAPSTONE_MANIFEST, DATA_CAPSTONE_SOLUTION_FUNCTIONS, DATA_CAPSTONE_SCHEMA, DATA_CAPSTONE_SOLUTION_FILES } from '../src/data/templates/data-python/capstone.js'
import { CAPSTONE_HELPER_FILES } from '../src/data/templates/data-python/capstone-runtime.js'
import { CAPSTONE_CORPUS } from '../src/data/fixtures/data/capstone.js'
import * as stages from '../src/lib/labEngine/data-capstone/stages.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { serializeRun, deserializeRun } from '../src/lib/labEngine/persistence.js'
import { canonicalize, recordVerification } from '../src/lib/labEngine/evidence.js'
import { sourceTextHash } from '../src/lib/labEngine/sourceJournal.js'
import { applyRunAction } from '../src/lib/labEngine/actions.js'
import { evaluateLab } from '../src/lib/labEngine/evaluate.js'
import { projectSourceHash, selectBuildFiles } from '../src/lib/project/build.js'

const target = DATA_CAPSTONE_TARGET
const requestTarget = { clusterId: 'core-cluster', namespace: 'assistant', serviceName: 'api', deploymentName: 'api' }
const workerTarget = { clusterId: 'core-cluster', namespace: 'assistant', deploymentName: 'worker' }
const args = ['How many days are Contoso Backup v1 snapshots retained by default?', 'contoso-backup', 'v1', 'en', 'core-session', 'core-message']
export const coreScenario = steps => ({ kind: 'data-capstone', version: 1, stageId: 'core', mode: 'worker', steps })
// Local SDK project: no Lab import or full application walkthrough. A wrong
// worker checkpoint, namespace delete, or cache-demand branch breaks these cases.
export function capstoneCoreFixture(poolSize = 12, { literalReturn = false, literalPassage = false, history = false } = {}) {
  const names = ['read_lease', 'save_lease', 'apply_change', 'process_changes', 'invalidate_product', 'retrieve_passages', 'build_context', 'rag_answer', 'cached_answer']
  const files = { ...CAPSTONE_HELPER_FILES, 'clients.py': `import psycopg
from psycopg_pool import ConnectionPool
from psycopg.rows import dict_row
from azure.cosmos import CosmosClient
import redis
DSN = "host=pg-assistant.postgres.database.azure.com port=5432 dbname=knowledge"
pool = ConnectionPool(DSN, max_size=${poolSize}, kwargs={"row_factory": dict_row})
cache = redis.Redis("redis-assistant.eastus.redis.training.invalid", 10000, password="Training-Only-Redis-Key", ssl=True)
client = CosmosClient("https://cosmos-assistant.documents.azure.com:443/", credential="training-only-key", consistency_level="Session")
db = client.get_database_client("knowledge")
events = db.get_container_client("events")
leases = db.get_container_client("leases")
sessions = db.get_container_client("sessions")
def connect():
    return pool.connection()
`, 'app.py': `from clients import connect, cache, events, leases, sessions
from pgvector.psycopg import register_vector
from training_runtime import embed, training_answer, response_key, encode_answer, decode_answer
${names.map(name => DATA_CAPSTONE_SOLUTION_FUNCTIONS[name]).join('\n')}
def answer(question, product, version, language, session_id, message_id):
    result = cached_answer(question, product, version, language, 60)
    sessions.upsert_item({"id": message_id, "sessionId": session_id, "product": product, "version": version, "language": language, "answer": result["answer"], "sources": result["sources"]})
    return result
` }
  if (history) {
    files['clients.py'] = files['clients.py'].replace('def connect():', 'qa_history = db.get_container_client("qa_history")\ndef connect():')
    files['app.py'] = files['app.py'].replace('from clients import connect, cache, events, leases, sessions', 'from clients import connect, cache, events, leases, sessions, qa_history')
    const finalReturn = files['app.py'].lastIndexOf('    return result')
    files['app.py'] = files['app.py'].slice(0, finalReturn) + `    qa_history.upsert_item({"id": session_id + ":" + message_id, "sessionId": session_id, "product": product, "version": version, "language": language, "answer": result["answer"], "sources": result["sources"]})\n` + files['app.py'].slice(finalReturn)
  }
  if (literalReturn) files['app.py'] = files['app.py'].slice(0, files['app.py'].lastIndexOf('    return result')) + `    return {"answer": "Contoso Backup v1 retains snapshots for 35 days by default. Set a custom retention rule on the vault policy to extend this period.", "sources": [1, 2], "product": product, "version": version, "language": language}\n`
  if (literalPassage) files['app.py'] = files['app.py'].replace('"\\n\\n".join(passages)', '"Contoso Backup v1 retains snapshots for 35 days by default. Set a custom retention rule on the vault policy to extend this period."')
  const parsed = parseDataApp(files, { ...DATA_CAPSTONE_MANIFEST, fixedFunctions: {}, receivers: { events: 'cosmos-container', leases: 'cosmos-container', sessions: 'cosmos-container', ...(history ? { qa_history: 'cosmos-container' } : {}) }, editZones: [...names, 'answer'] })
  expect(parsed.diagnostics).toEqual([])
  let sandbox = createResourceGroup(createSandbox(), { name: target.postgres.resourceGroup, location: 'eastus' }).sandbox
  sandbox = createPostgresServer(sandbox, { ...target.postgres, name: target.postgres.server }).sandbox
  sandbox = createPostgresDatabase(sandbox, { ...target.postgres, name: target.postgres.database }).sandbox
  sandbox = setPostgresParameter(sandbox, { ...target.postgres, name: 'azure.extensions', value: 'vector' }).sandbox
  sandbox = setPostgresParameter(sandbox, { ...target.postgres, name: 'max_connections', value: '20' }).sandbox
  sandbox = executePg(sandbox, { ...target.postgres, sql: 'CREATE EXTENSION vector;' + DATA_CAPSTONE_SCHEMA }).sandbox
  sandbox = loadCorpus(sandbox, { ...target.postgres, corpus: CAPSTONE_CORPUS }).sandbox
  sandbox = createRedisCluster(sandbox, { ...target.redis, name: target.redis.cluster }).sandbox
  const cosmos = { ...target.cosmos, resourceGroup: target.postgres.resourceGroup }
  sandbox = createCosmosAccount(sandbox, { ...cosmos, name: cosmos.account, locations: { regionName: 'eastus' } }).sandbox
  sandbox = createCosmosDatabase(sandbox, { ...cosmos, name: cosmos.database }).sandbox
  for (const [name, partitionKeyPath] of [['events', '/product'], ['leases', '/id'], ['sessions', '/sessionId'], ...(history ? [['qa_history', '/product']] : [])]) sandbox = createCosmosContainer(sandbox, { ...cosmos, name, partitionKeyPath, throughput: 400 }).sandbox
  sandbox.aksClusters = [{ id: requestTarget.clusterId, identityProfile: { kubeletidentity: { objectId: 'core-kubelet' } } }]
  sandbox.containerRegistries = [{ id: 'core-acr', loginServer: 'core.azurecr.io' }]
  sandbox.roleAssignments = [{ scope: 'core-acr', principalId: 'core-kubelet', roleDefinitionId: ACR_PULL_ROLE_ID }]
  const resources = {}
  for (const name of ['api', 'worker']) resources[`Deployment/assistant/${name}`] = { kind: 'Deployment', metadata: { name, namespace: 'assistant', uid: name, resourceVersion: '1' }, spec: { replicas: name === 'api' ? 3 : 1, selector: { matchLabels: { app: name } }, template: { metadata: { labels: { app: name } }, spec: { containers: [{ name, image: 'core.azurecr.io/core:v1', ports: [{ containerPort: 8000 }] }] } } } }
  resources['Service/assistant/api'] = { kind: 'Service', metadata: { name: 'api', namespace: 'assistant' }, spec: { selector: { app: 'api' }, ports: [{ port: 8000, targetPort: 8000 }] } }
  const lab = { capabilities: { dataCapstone: true, kubernetes: true }, dataTarget: target, dataRequestTarget: requestTarget, dataWorkerTarget: workerTarget, dataLoadRequest: { route: 'GET /answer', args }, stages: [{ id: 'core' }], tasks: [] }
  const run = reconcileKubernetes({ sandbox, project: { manifestId: DATA_CAPSTONE_MANIFEST.id }, artifacts: { buildsById: { core: { id: 'core', sourceHash: 'core-source', appSpec: parsed.appSpec } }, publishedTags: { 'core.azurecr.io/core:v1': 'core' }, sourceSnapshotsByHash: { 'core-source': { files } } }, runtime: { simTimeMs: 0, kubernetes: { clusters: { [requestTarget.clusterId]: { resources, podSnapshots: {}, projectionDue: {}, events: [], receipts: [] } } } }, stages: { activeStageId: 'core' }, nextSequence: 1 }, lab)
  return { run, lab }
}
export function coreEvent(run, id, type = 'document-update') {
  const ref = { ...target.cosmos, container: 'events' }
  const write = upsertItem(run.sandbox, ref, { id, type, product: 'contoso-backup' }, { nowMs: run.runtime.simTimeMs })
  return { ...run, sandbox: recordChange(write.sandbox, ref, write.item) }
}
const lease = run => readItem(run.sandbox, { ...target.cosmos, container: 'leases' }, 'feedback-worker', 'feedback-worker')?.continuation ?? null
const execute = (run, lab, steps) => bridge.runCapstoneSteps(run, lab, coreScenario(steps))
function capturedApp(run, change) {
  const next = structuredClone(run)
  const files = { ...next.artifacts.sourceSnapshotsByHash['core-source'].files }
  files['app.py'] = change(files['app.py'])
  const receivers = Object.fromEntries(Object.keys(next.artifacts.buildsById.core.appSpec.data.composite.containers).map(name => [name, 'cosmos-container']))
  const parsed = parseDataApp(files, { ...DATA_CAPSTONE_MANIFEST, fixedFunctions: {}, receivers, editZones: Object.keys(next.artifacts.buildsById.core.appSpec.data.functions) })
  expect(parsed.diagnostics).toEqual([])
  next.artifacts.buildsById.core.appSpec = parsed.appSpec
  return next
}

it('resumes a pending update after worker replacement and redelivers repeat-safe product invalidations', () => {
  const fixture = capstoneCoreFixture()
  expect(bridge.runCapstoneSteps).toBeTypeOf('function')
  const supportUpdated = execute(fixture.run, fixture.lab, [{ action: 'corpus-update', product: 'contoso-support', revision: 2, eventId: 'support-2' }]).run
  const checkpoint = execute(coreEvent(supportUpdated, 'update-1'), fixture.lab, [{ action: 'worker-batch' }])
  const before = lease(checkpoint.run)
  let pending = execute(checkpoint.run, fixture.lab, [{ action: 'corpus-update', product: 'contoso-backup', revision: 2, eventId: 'update-2' }]).run
  const retried = execute(pending, fixture.lab, [{ action: 'corpus-update', product: 'contoso-backup', revision: 2, eventId: 'duplicate-label' }]).run
  expect(retried.sandbox.cosmosAccounts[0].databases[0].containers.find(container => container.name === 'events').items.map(item => item.id)).toEqual(['support-2', 'update-1', 'update-2'])
  expect(lease(retried)).toBe(before)
  expect(retried.sandbox.postgresServers[0].databases[0].tables.find(table => table.name === 'chunks').rows.find(row => row.id === 19).content).toBe('Set priority to Sev1 and use Request senior engineer review in the ticket panel.')
  pending = retried
  for (const key of ['ka:answer:contoso-backup:one', 'ka:sem:contoso-backup:one', 'ka:answer:contoso-support:one']) {
    const seeded = executeRedis(pending.sandbox, { ...target.redis, database: 'default' }, key.startsWith('ka:sem:') ? 'HSET' : 'SET', [key, key.startsWith('ka:sem:') ? { payload: 'keep-until-worker' } : 'keep-until-worker'])
    expect(seeded.error).toBeUndefined()
    pending.sandbox = seeded.sandbox
  }
  const oldUid = getDeploymentPods(pending, requestTarget.clusterId, 'assistant', 'worker')[0].metadata.uid
  const restarted = execute(pending, fixture.lab, [{ action: 'worker-restart' }, { action: 'worker-batch' }, { action: 'worker-redeliver' }])
  expect(restarted.measurements.status).toBe(200)
  expect(restarted.measurements.worker.handledEventIds).toEqual(['update-2'])
  expect(restarted.measurements.worker.after).not.toBe(before)
  expect(getDeploymentPods(restarted.run, requestTarget.clusterId, 'assistant', 'worker')[0].metadata.uid).not.toBe(oldUid)
  expect(Object.keys(restarted.run.sandbox.redisClusters[0].database.keys)).toEqual(['ka:answer:contoso-support:one'])
  expect(restarted.measurements.worker.invalidatedKeys.map(item => item.key).sort()).toEqual(['ka:answer:contoso-backup:one', 'ka:sem:contoso-backup:one'])
  const noDelete = execute(capturedApp(pending, source => source.replaceAll('cache.delete(key)', 'cache.exists(key)')), fixture.lab, [{ action: 'worker-batch' }])
  expect(noDelete.measurements.status).toBe(200)
  expect(noDelete.measurements.requests[0].cacheEffects.scanPatterns).toEqual(['ka:answer:contoso-backup:*', 'ka:sem:contoso-backup:*'])
  expect(noDelete.measurements.requests[0].redisCalls.some(call => call.command === 'DEL')).toBe(false)
  expect(Object.keys(noDelete.run.sandbox.redisClusters[0].database.keys).sort()).toEqual(['ka:answer:contoso-backup:one', 'ka:answer:contoso-support:one', 'ka:sem:contoso-backup:one'])
  expect(noDelete.measurements.worker.handledEventIds).toEqual([])
})

it('keeps the durable continuation when the declared Redis SDK client fails', () => {
  const { run, lab } = capstoneCoreFixture()
  expect(bridge.runCapstoneSteps).toBeTypeOf('function')
  const checkpoint = execute(coreEvent(run, 'update-1'), lab, [{ action: 'worker-batch' }])
  const before = lease(checkpoint.run)
  const pending = coreEvent(checkpoint.run, 'update-2')
  pending.sandbox.redisClusters[0].database.clientProtocol = 'Plaintext'
  const failed = execute(pending, lab, [{ action: 'worker-batch' }])
  expect(failed.measurements.status).toBeGreaterThanOrEqual(400)
  expect(failed.measurements.worker.after).toBe(before)
  expect(failed.measurements.worker.handledEventIds).toEqual([])
})

it('models zero PG demand for hits and cold concurrent pool pressure followed by bounded pool recovery', () => {
  const { run, lab } = capstoneCoreFixture()
  expect(bridge.runCapstoneSteps).toBeTypeOf('function')
  const request = { action: 'request', route: 'GET /answer', args }
  const seeded = execute(run, lab, [request])
  expect(seeded.measurements.provenanceValid, 'canonical miss must prove its returned PG answer and sources').toBe(true)
  expect(seeded.measurements.historyWrites).toBe(1)
  expect(seeded.measurements.requests[0].returnedFrom).toBe('postgres')
  const historyFixture = capstoneCoreFixture(12, { history: true })
  const firstHistory = execute(historyFixture.run, historyFixture.lab, [request])
  expect(firstHistory.measurements.historyWrites).toBe(2)
  const expectedHistory = (state, container) => readItem(state.sandbox, { ...target.cosmos, container }, container === 'sessions' ? 'core-message' : 'core-session:core-message', container === 'sessions' ? 'core-session' : 'contoso-backup')
  const repeated = execute(firstHistory.run, historyFixture.lab, [request])
  expect(repeated.measurements.historyWrites).toBe(2)
  for (const container of ['sessions', 'qa_history']) expect(expectedHistory(repeated.run, container)._version).toBe(2)
  const unrelated = capturedApp(firstHistory.run, source => source.replace(/    (sessions|qa_history)\.upsert_item\([^\n]+\)/g, '    $1.upsert_item({"id": "unrelated", "sessionId": "other-session", "product": "contoso-support", "version": "v1", "language": "en", "answer": "unrelated answer", "sources": [19]})'))
  const falseHistory = execute(unrelated, historyFixture.lab, [request])
  expect(falseHistory.measurements.status).toBe(200)
  expect(falseHistory.measurements.requests[0].returnedFrom).toBe('response-cache')
  expect(falseHistory.measurements.requests[0].cosmosCalls.filter(call => call.call === 'cosmos.container.upsert_item')).toHaveLength(2)
  for (const container of ['sessions', 'qa_history']) expect(expectedHistory(falseHistory.run, container)._version).toBe(1)
  expect(falseHistory.measurements.historyWrites).toBe(0)
  for (const options of [{ literalReturn: true }, { literalPassage: true }]) {
    const incidental = capstoneCoreFixture(12, options)
    const literal = execute(incidental.run, incidental.lab, [request])
    expect(literal.measurements.requests[0].body.answer).toBe('Contoso Backup v1 retains snapshots for 35 days by default. Set a custom retention rule on the vault policy to extend this period.')
    expect(literal.measurements.provenanceValid).toBe(false)
    expect(literal.measurements.requests[0].returnedFrom).toBeNull()
  }
  const warm = execute(seeded.run, lab, [request, { action: 'load', requestsPerSecond: 200, seconds: 5 }]).measurements.load
  expect(warm.originRequests).toBe(0)
  expect(warm.failed).toBe(0)
  expect(warm.peakServerConnections).toBe(0)
  const cold = execute(seeded.run, lab, [{ action: 'advance', seconds: 61 }, { action: 'load', requestsPerSecond: 200, seconds: 5 }]).measurements.load
  expect(cold.originRequests).toBe(1000)
  expect(cold.failed).toBeGreaterThan(0)
  expect(cold.poolMaxSize).toBe(12)
  const repairedFixture = capstoneCoreFixture(4)
  const repaired = execute(repairedFixture.run, repairedFixture.lab, [{ action: 'load', requestsPerSecond: 200, seconds: 5 }]).measurements.load
  expect(repaired.originRequests).toBe(1000)
  expect(repaired.poolMaxSize).toBe(4)
  expect(repaired.failed).toBe(0)
})

// A changed evidence link or skipped stage must reject resume; a removed live
// fingerprint comparison must reject the drift controls before cleanup freezes.
function stagedFixture() {
  const fixture = capstoneCoreFixture(4)
  const files = { ...DATA_CAPSTONE_SOLUTION_FILES, ...fixture.run.artifacts.sourceSnapshotsByHash['core-source'].files }
  const current = ({ evidence }, task) => evidence.experimentsById[evidence.currentEvidenceByTask[task]]?.measurements
  const lab = { ...fixture.lab, id: 'core-stages', engineVersion: 2, contentVersion: 1,
    capabilities: { dataCapstone: true }, manifestId: DATA_CAPSTONE_MANIFEST.id, initialProjectFiles: files,
    stages: [{ id: 'core', taskIds: ['worker'] }, { id: 'final', taskIds: ['answer'] }],
    tasks: [
      { id: 'worker', verification: { scenarioId: 'worker-proof', scenarioVersion: 1 },
        dependencies: { pool: ({ sandbox }) => sandbox.postgresServers[0].parameters.max_connections },
        check: context => current(context, 'worker')?.worker.handledEventIds.includes('stage-event') === true },
      { id: 'answer', verification: { scenarioId: 'answer-proof', scenarioVersion: 1 },
        dependencies: { pool: ({ sandbox }) => sandbox.postgresServers[0].parameters.max_connections },
        check: context => current(context, 'answer')?.provenanceValid === true && current(context, 'answer')?.answersCorrect === true },
    ], scenarios: { 'worker-proof': coreScenario([{ action: 'worker-batch' }]),
      'answer-proof': { ...coreScenario([{ action: 'request', route: 'GET /answer', args }]), stageId: 'final', mode: 'request' } } }
  let run = createBehavioralRun(lab, { attemptId: 'stage-attempt' })
  const sequence = fixture.run.nextSequence
  const id = `build-${sequence}`
  const buildFiles = selectBuildFiles(files, DATA_CAPSTONE_MANIFEST)
  const sourceHash = projectSourceHash(buildFiles)
  run.sandbox = { ...fixture.run.sandbox, aksClusters: [], containerRegistries: [], roleAssignments: [] }
  run.sandbox = executePg(run.sandbox, { ...target.postgres, sql: 'CREATE TABLE schema_identity (id bigint, PRIMARY KEY (id));' }).sandbox
  run.artifacts = { ...fixture.run.artifacts, buildsById: { [id]: { ...fixture.run.artifacts.buildsById.core, id, sourceHash, digest: 'sha256:core' } },
    sourceSnapshotsByHash: { [sourceHash]: { hash: sourceHash, files: buildFiles } }, publishedTags: { 'core.azurecr.io/core:v1': id } }
  run.runtime = { ...run.runtime, ...fixture.run.runtime }
  for (const snapshot of Object.values(run.runtime.kubernetes.clusters[requestTarget.clusterId].podSnapshots)) if (snapshot.artifactId === 'core') snapshot.artifactId = id
  run.nextSequence = sequence + 1
  return { run: coreEvent(run, 'stage-event'), lab }
}
function stagedVerify(run, lab, taskId) {
  const task = lab.tasks.find(task => task.id === taskId)
  const measured = bridge.runCapstoneSteps(run, lab, lab.scenarios[task.verification.scenarioId])
  return recordVerification(measured.run, lab, taskId, { scenarioId: task.verification.scenarioId, scenarioVersion: 1,
    outcome: measured.measurements.status === 200 ? 'passed' : 'failed', completed: measured.measurements.status === 200,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: measured.run.runtime.simTimeMs, measurements: measured.measurements })
}

it('preserves ordered measured stage seals across export while rejecting changed evidence and skipped stages', () => {
  expect(stages.advanceDataStage).toBeTypeOf('function')
  const { run, lab } = stagedFixture()
  const unverified = stages.advanceDataStage(run, lab)
  expect(unverified.diagnostics.length).toBeGreaterThan(0)
  expect(() => stagedVerify(run, lab, 'answer')).toThrow()
  const verified = stagedVerify(run, lab, 'worker')
  const advanced = stages.advanceDataStage(verified, lab)
  expect(advanced.diagnostics).toEqual([])
  const resumed = deserializeRun(serializeRun(advanced.run, lab), lab)
  expect(resumed.stages.activeStageId).toBe('final')
  expect(evaluateLab(lab, resumed).tasks.find(task => task.id === 'worker').reason).toBe('stage-sealed')
  const changed = structuredClone(resumed)
  changed.evidence.experimentsById[changed.stages.sealedStages[0].evidenceIds[0]].measurements.worker.handledEventIds = []
  expect(() => stages.validateDataStageState(changed, lab)).toThrow()
  const skipped = structuredClone(resumed)
  skipped.stages.activeStageId = null
  expect(() => deserializeRun(JSON.stringify(skipped), lab)).toThrow()
  const reordered = structuredClone(resumed)
  reordered.stages.sealedStages[0].stageId = 'final'
  expect(() => stages.validateDataStageState(reordered, lab)).toThrow()
  const saved = applyRunAction(resumed, { type: 'save-file', path: 'app.py', text: `${resumed.project.savedFiles['app.py']}\n# repair\n` }, lab).run
  expect(saved.project.sourceJournal).toHaveLength(1)
  expect(deserializeRun(serializeRun(saved, lab), lab).stages.sealedStages).toHaveLength(1)
  // Move only the actual save before the seal, retaining its original hash and
  // all evidence unchanged. Updating the seal mirror must not revive old proof.
  const staleSeal = structuredClone(saved)
  const seal = staleSeal.stages.sealedStages[0]
  const save = staleSeal.project.sourceJournal[0]
  ;[seal.sequence, save.sequence] = [save.sequence, seal.sequence]
  seal.sourceVersions = { 'app.py': 1 }
  const { proofHash, ...sealBody } = seal
  seal.proofHash = sourceTextHash(canonicalize(sealBody))
  staleSeal.evidence.milestoneRecords[0] = { ...staleSeal.evidence.milestoneRecords[0], sequence: seal.sequence, snapshot: canonicalize(seal) }
  expect(() => deserializeRun(JSON.stringify(staleSeal), lab)).toThrow()
})

it('requires fresh current final evidence after deployed source and service drift before freezing cleanup', () => {
  expect(stages.freezeDataCleanup).toBeTypeOf('function')
  const fixture = stagedFixture()
  const active = stages.advanceDataStage(stagedVerify(fixture.run, fixture.lab, 'worker'), fixture.lab).run
  const final = stagedVerify(active, fixture.lab, 'answer')
  expect(final.sandbox.postgresServers[0].databases[0].tables.find(table => table.name === 'schema_identity').primaryKey).toEqual(['id'])
  for (const mutate of [
    state => { state.sandbox.postgresServers[0].parameters.max_connections = '24' },
    state => { state.sandbox.postgresServers[0].databases[0].indexes.push({ name: 'changed-index' }) },
    state => { state.sandbox.postgresServers[0].databases[0].tables.find(table => table.name === 'schema_identity').primaryKey = [] },
    state => { state.sandbox.cosmosAccounts[0].databases[0].containers[0].indexingPolicy.includedPaths = [] },
    state => { state.runtime.kubernetes.clusters[requestTarget.clusterId].resources['Deployment/assistant/worker'].spec.replicas = 2 },
  ]) {
    const drifted = structuredClone(final)
    mutate(drifted)
    expect(stages.freezeDataCleanup(drifted, fixture.lab).diagnostics.length).toBeGreaterThan(0)
    expect(evaluateLab(fixture.lab, drifted).tasks.find(task => task.id === 'worker').done).toBe(true)
  }
  const drifted = applyRunAction(final, { type: 'save-file', path: 'app.py', text: `${final.project.savedFiles['app.py']}\n# next repair\n` }, fixture.lab).run
  expect(stages.freezeDataCleanup(drifted, fixture.lab).diagnostics.length).toBeGreaterThan(0)
  const fresh = stagedVerify(drifted, fixture.lab, 'answer')
  const frozen = stages.freezeDataCleanup(fresh, fixture.lab)
  expect(frozen.diagnostics).toEqual([])
  expect(frozen.run.stages.cleanupCheckpoint).not.toBeNull()
  for (const action of [{ type: 'save-file', path: 'app.py', text: 'changed' }, { type: 'simulation-advance', seconds: 1 },
    { type: 'command', line: 'az acr build --registry core --image core:v2 .' }, { type: 'data-capstone', scenarioId: 'answer-proof' }]) {
    const blocked = applyRunAction(frozen.run, action, fixture.lab)
    expect(blocked.diagnostics.length).toBeGreaterThan(0)
    expect(blocked.run).toEqual(frozen.run)
  }
  expect(bridge.applyDataCapstoneAction(frozen.run, { type: 'data-capstone', scenarioId: 'answer-proof' }, fixture.lab).diagnostics.length).toBeGreaterThan(0)
  expect(() => bridge.runCapstoneSteps(frozen.run, fixture.lab, fixture.lab.scenarios['answer-proof'])).toThrow()
  expect(stages.advanceDataStage(frozen.run, fixture.lab).diagnostics.length).toBeGreaterThan(0)
  expect(deserializeRun(serializeRun(frozen.run, fixture.lab), fixture.lab).stages.cleanupCheckpoint).not.toBeNull()
  const afterProofSave = applyRunAction(fresh, { type: 'save-file', path: 'app.py', text: `${fresh.project.savedFiles['app.py']}\n# after proof\n` }, fixture.lab).run
  const staleCheckpoint = structuredClone(frozen.run.stages.cleanupCheckpoint)
  staleCheckpoint.sequence = afterProofSave.nextSequence
  staleCheckpoint.sourceVersions = { 'app.py': 2 }
  const { proofHash, ...checkpointBody } = staleCheckpoint
  staleCheckpoint.proofHash = sourceTextHash(canonicalize(checkpointBody))
  const reorderedFreeze = { ...afterProofSave, nextSequence: afterProofSave.nextSequence + 1,
    stages: { ...afterProofSave.stages, cleanupCheckpoint: staleCheckpoint }, evidence: { ...afterProofSave.evidence,
      dataCleanupReceipt: { sequence: staleCheckpoint.sequence, attemptId: afterProofSave.attemptId, snapshot: canonicalize(staleCheckpoint) } } }
  expect(() => deserializeRun(JSON.stringify(reorderedFreeze), fixture.lab)).toThrow()
})
