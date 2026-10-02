import { DATA_CAPSTONE_MANIFEST, DATA_CAPSTONE_STARTER_FILES, DATA_CAPSTONE_SOLUTION_FUNCTIONS,
  DATA_CAPSTONE_CLIENT_VARIANTS, DATA_CAPSTONE_FAULTY_PROCESS_CHANGES, DATA_CAPSTONE_POLICIES } from '../../templates/data-python/capstone.js'
import { CAPSTONE_CORPUS, CAPSTONE_QUESTIONS, capstoneIncidentScenarios } from '../../fixtures/data/capstone.js'
import { validateDataIncident } from '../../../lib/labEngine/data-capstone/incidents.js'
import { dataOwnedCleanupReady, dataFrozenActionAllowed } from '../../../lib/labEngine/data-capstone/ownership.js'
import { redisMemory } from '../../../lib/data/redis-store.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'
import { seedDataCapstone } from './capstone-seed.js'
import { DATA_CAPSTONE_TARGET, DATA_CAPSTONE_API_TARGET, DATA_CAPSTONE_WORKER_TARGET, dataCapstoneDependencies,
  CAPSTONE_PG_COMMANDS, CAPSTONE_INDEX_SQL, CAPSTONE_REDIS_COMMANDS, capstoneServices,
  capstoneFunctionsCurrent, capstoneConfigCurrent, capstoneArtifact, replaceCapstoneFunctions, pgSqlCommand } from './capstone-helpers.js'

const file = (path, content, resolver) => ({ kind: 'file', path, content, ...(resolver ? { resolver } : {}) })
const command = line => ({ kind: 'command', line })
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const action = type => ({ kind: 'action', action: { type }, instruction: type === 'data-freeze-cleanup'
  ? 'Freeze the fresh final recovery proof using Freeze cleanup in Experiments.' : 'Seal this checkpoint using Seal and advance in Experiments.' })
const inspect = { action: 'inspect' }
const worker = { action: 'worker-batch' }
const canonical = CAPSTONE_QUESTIONS[0].text
const paraphrase = 'How long does Contoso Backup keep my snapshots?'
const support = CAPSTONE_QUESTIONS[4].text
const supportPara = 'Where can I request a senior engineer for my Contoso Support v1 ticket?'
let message = 0
const request = (question = canonical, product = 'contoso-backup', version = 'v1', language = 'en', route = 'GET /answer') => ({
  action: 'request', route, args: [question, product, version, language, ...(route === 'GET /answer' ? ['capstone-session', `message-${++message}`] : [])] })
const feedback = (id, positive) => ({ action: 'request', route: 'POST /feedback', args: [id, 'contoso-backup', positive] })
const measured = (context, id) => context.evidence?.experimentsById?.[context.evidence.currentEvidenceByTask[id]]?.measurements
const correct = m => m?.status === 200 && m.answersCorrect && m.scopeCorrect && m.provenanceValid && m.traceComplete && m.staleAnswers === 0
const bounded = m => m.requests.every(item => item.cacheEffects?.complete && item.cacheEffects.persistentKeys === 0
  && item.cacheEffects.maxRemainingTtlSeconds <= 60)
const memoryBounded = context => {
  const database = capstoneServices(context).redis?.database
  return !!database && redisMemory(database, context.runtime.simTimeMs).usedBytes <= 65536 && database.stats.rejectedWrites === 0
}
const appRag = ['retrieve_passages', 'build_context', 'rag_answer']
const appHistory = [...appRag, 'cached_answer', 'semantic_lookup', 'remember_semantic', 'answer', 'save_message', 'get_session', 'remember_answer', 'find_similar_questions', 'submit_feedback']
const workerNames = ['read_lease', 'save_lease', 'apply_change', 'process_changes', 'invalidate_product']
const pgFields = ['pg:resource', 'pg:schema', 'pg:rows', 'pg:indexes']
const serviceFields = [...pgFields, 'cosmos:policies', 'redis:resource', 'redis:index']
const appFields = [...serviceFields, 'api:artifact', 'api:config', ...appHistory.map(name => `api:function:${name}`)]
const allFields = [...appFields, 'worker:artifact', ...workerNames.map(name => `worker:function:${name}`), 'cosmos:lease', 'cosmos:events', 'incident:identity']
const editFunctions = (path, names) => file(path, replaceCapstoneFunctions(DATA_CAPSTONE_STARTER_FILES[path], names),
  context => replaceCapstoneFunctions(context.project.savedFiles[path], names))
const imageManifest = (path, tag, replicas) => file(path,
  DATA_CAPSTONE_STARTER_FILES[path].replace('assistant:v1', `assistant:${tag}`).replace('replicas: 2', `replicas: ${replicas ?? 2}`),
  context => context.project.savedFiles[path].replace(/assistant:[A-Za-z0-9_.-]+/g, `assistant:${tag}`)
    .replace(/replicas: \d+/, `replicas: ${replicas ?? (path.includes('worker') ? 1 : 2)}`))
const release = (role, tag, edits, replicas) => [...edits,
  command(`az acr build --registry acrassistant --image assistant:${tag} .`),
  imageManifest(role === 'api' ? 'k8s/deployment.yaml' : 'k8s/worker.yaml', tag, replicas),
  command(`kubectl apply -f k8s/${role === 'api' ? 'deployment' : 'worker'}.yaml`),
  command(`kubectl rollout status deployment/${role === 'api' ? 'assistant-api' : 'feedback-worker'} -n assistant`)]
const task = (id, stageId, text, check, fields, steps, examNote) => ({ id, stageId, text, check,
  ...(['worker-fault-observed', 'pool-fault-observed'].includes(id) ? { evidenceMode: 'historical' } : {}),
  explanation: text + ' Verify runs the authored scenario against captured running Pods. Save → build → update only this workload manifest → apply. Measurements are simulated estimates, not Azure guarantees.',
  hints: ['Inspect actual returned sources, SDK calls and the captured artifact; saved edits alone do not change running Pods.'],
  examNote, verification: { scenarioId: id, scenarioVersion: 1 }, dependencies: dataCapstoneDependencies(fields), solution: { steps } })
const declared = (stageId, steps, mode = 'request') => ({ kind: 'data-capstone', version: 1, stageId, mode, steps })
const incidentScenarios = capstoneIncidentScenarios('worker-incident', 'pool-incident')
const fullFlow = [request(canonical, 'contoso-backup', 'v2'), request(canonical, 'contoso-backup', 'v1', 'de'),
  request(canonical, 'contoso-support'), request('How do I permanently delete a Contoso Backup snapshot before its retention period ends?'),
  request('Can Contoso Backup predict the weather?'), request()]
const feedbackFlow = [request(support, 'contoso-support'), feedback('positive-feedback', true), worker,
  feedback('negative-feedback', false), worker, request(),
  { action: 'corpus-update', product: 'contoso-support', revision: 2, eventId: 'support-revision-2' },
  request(support, 'contoso-support'), request(supportPara, 'contoso-support'), worker, { action: 'worker-redeliver' },
  request(support, 'contoso-support'), request(supportPara, 'contoso-support'),
  { action: 'worker-restart' }, worker]
const resolved = context => context.runtime.dataCapstone.incident?.records?.length === 2
  && context.runtime.dataCapstone.incident.records.every(item => item.status === 'resolved')
export const dataCapstoneLab = {
  id: 'data-knowledge-assistant-capstone', title: 'Capstone: Data Knowledge Assistant',
  brief: 'Build a Knowledge Assistant from scratch using PostgreSQL filtered RAG, Cosmos conversation history and a durable change feed worker, and Redis exact and semantic caches. AKS, ACR, assistant namespace and Service are supplied; create only data resources in rg-data-capstone and the two workloads. Complete seven ordered checkpoints, observe and repair two visible incidents, then verify fresh recovery, freeze proof, clean up exact owned resources and seal the final checkpoint. Every answer filter is part of cache and history scope. Credentials are fictional, training-only. Simulated estimates are not Azure guarantees.',
  minutes: 120, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 13,
  labMode: 'capstone', skillAreaId: 'data', service: 'postgresql', status: 'available',
  manifestId: DATA_CAPSTONE_MANIFEST.id, capabilities: { dataCapstone: true, kubernetes: true, acrBuild: true },
  dataTarget: DATA_CAPSTONE_TARGET, dataRequestTarget: DATA_CAPSTONE_API_TARGET, dataWorkerTarget: DATA_CAPSTONE_WORKER_TARGET,
  dataLoadRequest: { route: 'GET /answer', args: [canonical, 'contoso-backup', 'v1', 'en', 'load-session', 'load-answer'] },
  dataIncident: { validate: validateDataIncident, registryName: 'acrassistant',
    stageIds: { 'worker-checkpoint': 'worker-incident', 'cache-masked-pool': 'pool-incident' },
    scenarioIds: { 'worker-checkpoint': 'inject-worker', 'cache-masked-pool': 'inject-pool' } },
  dataCleanup: { ready: dataOwnedCleanupReady, allowAction: dataFrozenActionAllowed },
  initialProjectFiles: DATA_CAPSTONE_STARTER_FILES, initializeSimulation: seedDataCapstone,
  stages: [
    { id: 'provision', title: 'Provision data services', taskIds: ['postgres-ready', 'cosmos-ready', 'redis-ready'] },
    { id: 'application', title: 'Deploy the assistant', taskIds: ['rag-deployed', 'history-and-cache'] },
    { id: 'worker', title: 'Deliver durable invalidation', taskIds: ['worker-deployed', 'feedback-and-update'] },
    { id: 'full-flow', title: 'Prove the full scoped flow', taskIds: ['cross-service-flow'] },
    { id: 'worker-incident', title: 'Recover the change feed worker', taskIds: ['worker-fault-observed', 'worker-recovered'] },
    { id: 'pool-incident', title: 'Recover cache-masked PG pressure', taskIds: ['pool-fault-observed', 'pool-recovered'] },
    { id: 'final-cleanup', title: 'Freeze proof and clean up', taskIds: ['final-recovery', 'cleanup-app', 'cleanup-data'] },
  ],
  scenarios: {
    'postgres-ready': declared('provision', [inspect], 'inspect'), 'cosmos-ready': declared('provision', [inspect], 'inspect'), 'redis-ready': declared('provision', [inspect], 'inspect'),
    'rag-deployed': declared('application', [request(canonical, 'contoso-backup', 'v1', 'en', 'GET /rag')]),
    'history-and-cache': declared('application', [request(), request(), request(paraphrase),
      { action: 'request', route: 'GET /sessions', args: ['capstone-session', `message-${message - 2}`] },
      { action: 'request', route: 'GET /similar', args: [paraphrase, 'contoso-backup', 'v1', 'en'] }]),
    'worker-deployed': declared('worker', [worker], 'worker'), 'feedback-and-update': declared('worker', feedbackFlow, 'worker'),
    'cross-service-flow': declared('full-flow', fullFlow),
    'inject-worker': incidentScenarios['inject-worker'], 'inject-pool': incidentScenarios['inject-pool'],
    'worker-fault-observed': incidentScenarios['worker-diagnostic'], 'worker-recovered': incidentScenarios['worker-recovery'],
    'pool-fault-observed': declared('pool-incident', [...incidentScenarios['pool-warm'].steps, ...incidentScenarios['pool-cold'].steps], 'incident'),
    'pool-recovered': incidentScenarios['pool-recovery'],
    'final-recovery': declared('final-cleanup', [{ action: 'advance', seconds: 61 }, request(), request(paraphrase), worker, inspect]),
    'cleanup-app': declared('final-cleanup', [inspect], 'cleanup'), 'cleanup-data': declared('final-cleanup', [inspect], 'cleanup'),
  },
  tasks: [
    task('postgres-ready', 'provision', 'Create GeneralPurpose PostgreSQL, enable vector, load documents/chunks and build metadata plus cosine HNSW indexes.', context => {
      const { pg, database } = capstoneServices(context)
      return measured(context, 'postgres-ready')?.inventory?.protectedIntact === true && pg?.tier === 'GeneralPurpose'
        && pg.storageSizeGb >= 32 && pg.parameters['azure.extensions'].split(',').includes('vector') && database?.extensions.includes('vector')
        && ['documents', 'chunks'].every(name => CAPSTONE_CORPUS[name].every(expected => database.tables.find(table => table.name === name)?.rows
          .some(row => row.id === expected.id && Object.entries(expected).every(([key, value]) => key === 'updated_at'
            ? Date.parse(row[key]) === Date.parse(value) : canonicalize(row[key]) === canonicalize(value)))))
        && database.tables.find(table => table.name === 'chunks')?.columns.some(column => column.name === 'embedding' && column.type === 'vector' && column.dimensions === 8)
        && ['btree', 'gin', 'hnsw'].every(method => database.indexes.some(index => index.method === method))
        && database.indexes.some(index => index.method === 'hnsw' && index.columns.some(column => column.opclass === 'vector_cosine_ops'))
    }, pgFields, [command('az group create -n rg-data-capstone -l eastus'), ...CAPSTONE_PG_COMMANDS.map(command),
      command(pgSqlCommand('-c "CREATE EXTENSION IF NOT EXISTS vector"')), command(pgSqlCommand('-f schema.sql')),
      file('indexes.sql', CAPSTONE_INDEX_SQL), command(pgSqlCommand('-f indexes.sql')), scenario('postgres-ready')],
    'Allow-list the extension before CREATE EXTENSION; metadata indexes and cosine HNSW serve different access paths.'),
    task('cosmos-ready', 'provision', 'Create Session Cosmos and four partitioned 400 RU/s containers with the DIM-8 history vector policy.', context => {
      const { cosmos, containers } = capstoneServices(context)
      const qa = containers.find(item => item.name === 'qa_history')
      return measured(context, 'cosmos-ready')?.status === 200 && cosmos?.defaultConsistencyLevel === 'Session'
        && cosmos.capabilities.includes('EnableNoSQLVectorSearch')
        && [['sessions', '/sessionId'], ['qa_history', '/product'], ['events', '/product'], ['leases', '/id']].every(([name, path]) => containers.some(item => item.name === name && item.partitionKeyPath === path && item.throughput === 400))
        && qa.vectorEmbeddingPolicy?.vectorEmbeddings?.some(item => item.path === '/embedding' && item.dimensions === 8 && item.distanceFunction === 'cosine')
        && qa.indexingPolicy.excludedPaths.some(item => item.path === '/embedding/*') && qa.indexingPolicy.vectorIndexes.some(item => item.path === '/embedding')
    }, ['cosmos:policies'], [command('az cosmosdb create -g rg-data-capstone -n cosmos-assistant --default-consistency-level Session --capabilities EnableNoSQLVectorSearch'),
      command('az cosmosdb sql database create -g rg-data-capstone -a cosmos-assistant -n knowledge'),
      ...[['sessions', '/sessionId'], ['qa_history', '/product'], ['events', '/product'], ['leases', '/id']].map(([name, path]) => command(`az cosmosdb sql container create -g rg-data-capstone -a cosmos-assistant -d knowledge -n ${name} --partition-key-path ${path} --throughput 400${name === 'qa_history' ? ` --vector-embeddings '${DATA_CAPSTONE_POLICIES['policies/qa-vector.json']}' --idx '${DATA_CAPSTONE_POLICIES['policies/qa-indexing.json']}'` : ''}`)), scenario('cosmos-ready')],
    'Partition choice is part of every read/write and filtered vector query; embedding needs both vector and indexing policies.'),
    task('redis-ready', 'provision', 'Create Balanced_B0 Redis with RediSearch, NoEviction and a scoped DIM-8 cosine HNSW index.', context => {
      const { redis } = capstoneServices(context)
      const index = redis?.database.indexes['idx:semantic']
      return measured(context, 'redis-ready')?.status === 200 && redis?.database.modules.includes('RediSearch')
        && redis.database.evictionPolicy === 'NoEviction' && redis.database.clusteringPolicy === 'EnterpriseCluster'
        && redis.database.memoryLimitBytes === 65536 && !!index
        && JSON.stringify(index).includes('HNSW') && JSON.stringify(index).includes('COSINE')
        && ['product', 'version', 'language'].every(name => index.fields.some(field => field.name === name && field.type === 'TAG'))
        && index.fields.some(field => field.type === 'VECTOR' && field.dimensions === 8)
    }, ['redis:resource', 'redis:index'], [...CAPSTONE_REDIS_COMMANDS.map(command), scenario('postgres-ready'), scenario('cosmos-ready'), scenario('redis-ready'), action('data-advance-stage')],
    'RediSearch is selected at creation. NoEviction rejects memory pressure; keys need explicit bounded TTLs.'),
    task('rag-deployed', 'application', 'Deploy scoped PostgreSQL RAG and return actual passage sources through the fixed GET /rag wrapper.', context => correct(measured(context, 'rag-deployed'))
      && measured(context, 'rag-deployed').requests[0].returnedFrom === 'postgres' && capstoneFunctionsCurrent(context, 'api', appRag),
    [...pgFields, 'api:artifact', ...appRag.map(name => `api:function:${name}`)],
    [command('az aks get-credentials -g rg-assistant -n aks-assistant'), ...release('api', 'capstone-rag', [editFunctions('app.py', appRag)]), scenario('rag-deployed')],
    'Apply an image manifest after building. SQL must filter product, version and language before distance ordering.'),
    task('history-and-cache', 'application', 'Write Cosmos history on misses and both cache hits, and return only similar questions from the requested scope.', context => {
      const m = measured(context, 'history-and-cache')
      return correct(m) && bounded(m) && memoryBounded(context) && m.responseHits >= 1 && m.semanticHits >= 1 && m.historyWrites === 6
        && m.requests.at(-2).body?.sessionId === 'capstone-session' && m.requests.at(-1).body?.length > 0
        && m.requests.at(-1).body.every(item => item.product === 'contoso-backup' && item.version === 'v1' && item.language === 'en')
        && capstoneFunctionsCurrent(context, 'api', appHistory)
    }, appFields, [...release('api', 'capstone-history', [editFunctions('app.py', appHistory)]), scenario('rag-deployed'), scenario('history-and-cache'), action('data-advance-stage')],
    'A cache hit still writes the current conversation message; exact keys and vector filters use every answer scope field.'),
    task('worker-deployed', 'worker', 'Deploy a separate pull worker that persists its actual continuation after successful invalidation.', context => {
      const m = measured(context, 'worker-deployed')
      return m?.status === 200 && m.traceComplete && m.worker.after !== null && capstoneFunctionsCurrent(context, 'worker', workerNames)
    }, [...serviceFields, 'worker:artifact', ...workerNames.map(name => `worker:function:${name}`), 'cosmos:lease'],
    [...release('worker', 'capstone-worker', [editFunctions('app.py', ['invalidate_product']), editFunctions('worker.py', workerNames.filter(name => name !== 'invalidate_product'))]), scenario('worker-deployed')],
    'Save continuation only after all side effects succeed. Manual checkpointing here is a bounded pull model, not a managed lease coordinator.'),
    task('feedback-and-update', 'worker', 'Prove positive feedback preserves cache, negative feedback deletes both namespaces, and Support updates become fresh immediately after durable processing.', context => {
      const m = measured(context, 'feedback-and-update')
      if (!m || m.status !== 200 || !m.traceComplete || m.staleAnswers !== 2 || !bounded(m) || !memoryBounded(context) || !capstoneFunctionsCurrent(context, 'worker', workerNames)) return false
      const operations = m.worker.operations
      return operations[0]?.invalidatedKeys.length === 0 && operations[1]?.invalidatedKeys.some(item => item.key.startsWith('ka:answer:contoso-backup:'))
        && operations[1]?.invalidatedKeys.some(item => item.key.startsWith('ka:sem:contoso-backup:'))
        && m.requests.filter(item => item.route === 'GET /answer').slice(-2).every(item => item.expectedAnswer && ['postgres', 'semantic-cache'].includes(item.returnedFrom))
        && m.worker.restarts.length === 1 && m.worker.handledEventIds.includes('support-revision-2')
        && operations.some(item => item.action === 'worker-redeliver' && item.deliveredEventIds?.length > 0)
    }, allFields.filter(field => field !== 'incident:identity'), [scenario('feedback-and-update'), scenario('worker-deployed'), action('data-advance-stage')],
    'Document updates do not clear Redis automatically. At-least-once duplicate DELs converge; restart must resume the saved continuation.'),
    task('cross-service-flow', 'full-flow', 'Prove foreign-scope isolation, a different near-miss PG answer, no-match, bounded TTL/memory and correct history.', context => {
      const m = measured(context, 'cross-service-flow')
      return correct(m) && bounded(m) && memoryBounded(context) && m.historyWrites === 12 && m.requests[3].returnedFrom === 'postgres'
        && m.requests[3].body.answer.includes('early snapshot deletion') && m.requests[4].body.sources.length === 0
        && m.requests[0].body.version === 'v2' && m.requests[1].body.language === 'de' && m.requests[2].body.product === 'contoso-support'
    }, allFields.filter(field => field !== 'incident:identity'), [...release('api', 'capstone-full-flow', [editFunctions('app.py', ['semantic_lookup', 'remember_semantic'])]), scenario('cross-service-flow'), action('data-advance-stage')],
    'Similar wording is insufficient for semantic reuse. Inspect returned PG sources and vector distance together with product/version/language.'),
    task('worker-fault-observed', 'worker-incident', 'Start the visible lost-checkpoint incident and observe stale exact and semantic Backup responses from the actual missed event.', context => {
      const m = measured(context, 'worker-fault-observed')
      return m?.status === 200 && m.traceComplete && m.staleAnswers === 2 && m.responseHits === 1 && m.semanticHits === 1
        && ['observed', 'resolved'].includes(context.runtime.dataCapstone.incident?.records[0]?.status)
    }, ['incident:identity'], [scenario('inject-worker'), scenario('worker-fault-observed')],
    'Starting from Now without a durable continuation skips pending changes; warm stale caches can hide the missed update.'),
    task('worker-recovered', 'worker-incident', 'Restore durable processing, invalidate both Backup namespaces and prove immediate freshness, restart, duplicate and positive no-op.', context => {
      const m = measured(context, 'worker-recovered')
      return correct(m) && context.runtime.dataCapstone.incident?.records[0]?.status === 'resolved'
        && capstoneFunctionsCurrent(context, 'worker', workerNames)
    }, allFields, [...release('worker', 'capstone-worker-fixed', [file('worker.py', DATA_CAPSTONE_STARTER_FILES['worker.py'],
      context => context.project.savedFiles['worker.py'].replace(DATA_CAPSTONE_FAULTY_PROCESS_CHANGES, DATA_CAPSTONE_SOLUTION_FUNCTIONS.process_changes))]),
      scenario('worker-recovered'), action('data-advance-stage')],
    'Repair the worker image independently from the API. Immediate freshness must happen before TTL expiry and preserve other products.'),
    task('pool-fault-observed', 'pool-incident', 'Start visible pool pressure, compare a successful warm workload with failing origin demand after cache expiry.', context => {
      const m = measured(context, 'pool-fault-observed')
      return m?.traceComplete && m.load?.failed > 0 && m.load.originRequests > 0
        && ['observed', 'resolved'].includes(context.runtime.dataCapstone.incident?.records[1]?.status)
    }, ['incident:identity'], [scenario('inject-pool'), scenario('pool-fault-observed')],
    'Warm health does not prove PG capacity. Replicas multiply module pool limits; test expired-cache origin demand.'),
    task('pool-recovered', 'pool-incident', 'Enable transaction PgBouncer, deploy a small module pool at port 6432 with three API replicas and restore cold load.', context => {
      const m = measured(context, 'pool-recovered')
      return correct(m) && resolved(context) && m.load.failed === 0 && m.load.originRequests > 0
        && m.load.throughputRps >= 190 && m.load.peakServerConnections <= 17 && m.load.p95Ms <= 20
        && capstoneFunctionsCurrent(context, 'api', [...appHistory, 'connect']) && capstoneConfigCurrent(context)
    }, allFields, [command('az postgres flexible-server parameter set -g rg-data-capstone --server-name pg-assistant --name pgbouncer.enabled --value true'),
      command('az postgres flexible-server parameter set -g rg-data-capstone --server-name pg-assistant --name pgbouncer.default_pool_size --value 12'),
      ...release('api', 'capstone-pool-fixed', [file('clients.py', DATA_CAPSTONE_CLIENT_VARIANTS.fixed)], 3), scenario('pool-recovered'), action('data-advance-stage')],
    'Use SET LOCAL for transaction-local tuning. GeneralPurpose supports the supplied PgBouncer model; session state is not a transaction guarantee.'),
    task('final-recovery', 'final-cleanup', 'After both recoveries, run fresh PG and cache answers with correct history, then explicitly freeze the cleanup checkpoint.', context => {
      const m = measured(context, 'final-recovery')
      return correct(m) && bounded(m) && memoryBounded(context) && resolved(context) && m.historyWrites === 4 && m.ragMisses >= 1 && m.semanticHits >= 1
        && capstoneFunctionsCurrent(context, 'api', [...appHistory, 'connect']) && capstoneConfigCurrent(context) && capstoneFunctionsCurrent(context, 'worker', workerNames)
    }, [...allFields, 'ownership:inventory'], [scenario('final-recovery'), action('data-freeze-cleanup')],
    'Historical seals preserve milestones; final proof must be fresh against all current builds and settings before deletion.'),
    task('cleanup-app', 'final-cleanup', 'Remove only the owned API and worker Deployments while keeping namespace, Service, AKS and ACR.', context => {
      const m = measured(context, 'cleanup-app')
      return !!context.stages.cleanupCheckpoint && m?.inventory?.protectedIntact === true
        && !m.inventory.owned.some(item => item.type === 'Deployment') && !capstoneArtifact(context, 'api') && !capstoneArtifact(context, 'worker')
    }, ['ownership:inventory'], [command('kubectl delete deployment assistant-api -n assistant'), command('kubectl delete deployment feedback-worker -n assistant'), scenario('cleanup-app')],
    'Delete exact owned workloads, retaining every historical creation and worker-maintenance receipt.'),
    task('cleanup-data', 'final-cleanup', 'Delete the exact owned data group after application cleanup and seal the final checkpoint; partial cleanup can resume from JSON.', context => {
      const m = measured(context, 'cleanup-data')
      return !!context.stages.cleanupCheckpoint && m?.inventory?.protectedIntact === true && m.inventory.owned.length === 0
    }, ['ownership:inventory'], [command('az group delete -n rg-data-capstone --yes'), scenario('cleanup-app'), scenario('cleanup-data'), action('data-advance-stage')],
    'Group deletion is allowed only when every remaining resource belongs to this attempt; completion requires the final ordered seal.'),
  ],
}
