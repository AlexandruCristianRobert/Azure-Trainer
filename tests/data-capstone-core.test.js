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
import { DATA_CAPSTONE_TARGET, DATA_CAPSTONE_MANIFEST, DATA_CAPSTONE_SOLUTION_FUNCTIONS, DATA_CAPSTONE_SCHEMA } from '../src/data/templates/data-python/capstone.js'
import { CAPSTONE_HELPER_FILES } from '../src/data/templates/data-python/capstone-runtime.js'
import { CAPSTONE_CORPUS } from '../src/data/fixtures/data/capstone.js'

const target = DATA_CAPSTONE_TARGET
const requestTarget = { clusterId: 'core-cluster', namespace: 'assistant', serviceName: 'api', deploymentName: 'api' }
const workerTarget = { clusterId: 'core-cluster', namespace: 'assistant', deploymentName: 'worker' }
const args = ['How many days are Contoso Backup v1 snapshots retained by default?', 'contoso-backup', 'v1', 'en', 'core-session', 'core-message']
export const coreScenario = steps => ({ kind: 'data-capstone', version: 1, stageId: 'core', mode: 'worker', steps })
// Local SDK project: no Lab import or full application walkthrough. A wrong
// worker checkpoint, namespace delete, or cache-demand branch breaks these cases.
export function capstoneCoreFixture(poolSize = 12, { literalReturn = false, literalPassage = false } = {}) {
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
  if (literalReturn) files['app.py'] = files['app.py'].slice(0, files['app.py'].lastIndexOf('    return result')) + `    return {"answer": "Contoso Backup v1 retains snapshots for 35 days by default. Set a custom retention rule on the vault policy to extend this period.", "sources": [1, 2], "product": product, "version": version, "language": language}\n`
  if (literalPassage) files['app.py'] = files['app.py'].replace('"\\n\\n".join(passages)', '"Contoso Backup v1 retains snapshots for 35 days by default. Set a custom retention rule on the vault policy to extend this period."')
  const parsed = parseDataApp(files, { ...DATA_CAPSTONE_MANIFEST, fixedFunctions: {}, receivers: { events: 'cosmos-container', leases: 'cosmos-container', sessions: 'cosmos-container' }, editZones: [...names, 'answer'] })
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
  for (const [name, partitionKeyPath] of [['events', '/product'], ['leases', '/id'], ['sessions', '/sessionId']]) sandbox = createCosmosContainer(sandbox, { ...cosmos, name, partitionKeyPath, throughput: 400 }).sandbox
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
