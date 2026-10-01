import { REDIS_MANIFEST, REDIS_STARTER_FILES, REDIS_SOLUTION_FILES, REDIS_SOLUTION_FUNCTIONS } from '../../templates/data-python/redis.js'
import { REDIS_FIXTURES } from '../../fixtures/data/redis.js'
import { seedRedisGuided } from './redis-seeds.js'
import { REDIS_TARGET, REDIS_DEPENDENCY_TARGET, REDIS_CREATE_COMMAND, REDIS_INDEX_COMMAND,
  redisCliCommand, redisDependencies, redisScenario, redisDeployedFunctionsCurrent } from './redis-helpers.js'

const canonical = 'How many days are Contoso Backup snapshots retained?'
const paraphrase = 'How long does Contoso Backup keep my snapshots?'
const nearMiss = 'How do I permanently delete a Contoso Backup snapshot before its retention period ends?'
const supportQuestion = "What are Contoso Support's on-call hours for critical incidents?"
const backup = { product: 'contoso-backup', version: 'v1', language: 'en' }
const support = { product: 'contoso-support', version: 'v1', language: 'en' }
const canonicalKey = 'ka:answer:contoso-backup:v1:en:3c5870a9231bf212a6520378d60f6a6814ac99be9c2a5276d4f9962e7f71d200'
const request = (question = canonical, scope = backup, route = 'GET /cached') => ({ action: 'request', route,
  args: { question, ...scope, ...(route === 'GET /cached' ? { ttl: 60 } : {}) } })
const reset = { action: 'reset-cache' }
const update = { action: 'source-update', product: backup.product, revision: 2 }
const invalidate = { action: 'request', route: 'POST /invalidate', args: { product: backup.product } }
const command = line => ({ kind: 'command', line })
const file = (path, content) => ({ kind: 'file', path, content })
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const db = context => context.sandbox.redisClusters?.find(cluster => cluster.resourceGroup === REDIS_TARGET.resourceGroup
  && cluster.name === REDIS_TARGET.cluster)?.database
const resourceReady = context => {
  const cluster = context.sandbox.redisClusters?.find(cluster => cluster.resourceGroup === REDIS_TARGET.resourceGroup && cluster.name === REDIS_TARGET.cluster)
  const database = cluster?.database
  return cluster?.sku === 'Balanced_B0' && database?.modules.includes('RediSearch') && database.clusteringPolicy === 'EnterpriseCluster'
    && database.evictionPolicy === 'NoEviction' && database.clientProtocol === 'Encrypted' && database.accessKeysAuthentication === 'Enabled'
}
const indexReady = context => {
  const index = db(context)?.indexes?.['idx:semantic']
  const vector = index?.fields.find(field => field.name === 'embedding')
  return resourceReady(context) && index?.prefix === 'ka:sem:' && ['product', 'version', 'language'].every(name => index.fields.some(field => field.name === name && field.type === 'TAG'))
    && vector?.type === 'VECTOR' && vector.algorithm === 'HNSW' && vector.dataType === 'FLOAT32' && vector.dimensions === 8 && vector.distanceMetric === 'COSINE'
}
const measurement = (context, id) => {
  const record = context.evidence?.experimentsById?.[context.evidence.currentEvidenceByTask[id]]
  return record?.taskId === id && record.scenarioId === id && record.completed && record.outcome === 'passed' ? record.measurements : null
}
const trustworthy = m => m?.status === 200 && m.provenanceValid === true && m.traceTruncated === false && m.crossFilterAnswers === 0
const correct = m => trustworthy(m) && m.answersCorrect === true && m.staleAnswers === 0
const cachedFunctions = ['cached_answer']
const freshFunctions = [...cachedFunctions, 'invalidate_product']
const semanticFunctions = [...cachedFunctions, 'remember_semantic', 'semantic_lookup', 'answer']
const codeFields = names => names.map(name => `code:assistant-api:${name}`)
const cacheFields = ['redis:resource', ...codeFields(cachedFunctions)]
const freshFields = ['redis:resource', 'redis:source:contoso-backup', 'redis:source:contoso-support', ...codeFields(freshFunctions)]
const semanticFields = [...cacheFields, 'redis:source:contoso-backup', 'redis:index:idx:semantic', ...codeFields(semanticFunctions.slice(1))]

// Each source cut is complete and explicit; future edit zones stay unfinished.
const source = names => names.reduce((text, name) => {
  const signature = REDIS_SOLUTION_FUNCTIONS[name].split('\n')[0]
  return text.replace(`${signature}\n    raise NotImplementedError("Lab task")\n`, REDIS_SOLUTION_FUNCTIONS[name])
}, REDIS_STARTER_FILES['app.py'])
const cacheSource = source(cachedFunctions)
const freshSource = source(freshFunctions)
const semanticSource = REDIS_SOLUTION_FILES['app.py']
const deployment = tag => REDIS_STARTER_FILES['k8s/deployment.yaml'].replace('assistant:v1', `assistant:${tag}`)
const release = (text, tag, scenarioIds, inspections = []) => [
  file('app.py', text), command(`az acr build --registry acrassistant --image assistant:${tag} .`),
  file('k8s/deployment.yaml', deployment(tag)), command('kubectl apply -f k8s/deployment.yaml'),
  ...scenarioIds.map(scenario), ...inspections.map(line => command(redisCliCommand(line))),
]
const task = ({ id, stageId, text, explanation, hints, examNote, check, steps, fields }) => ({
  id, stageId, text, explanation, hints, examNote, check, solution: { steps },
  ...(fields ? { verification: { scenarioId: id, scenarioVersion: 1 }, dependencies: redisDependencies(REDIS_DEPENDENCY_TARGET, fields) } : {}),
})
const semanticTrace = m => m.calls.some(call => call.command === 'FT.SEARCH' && !call.error
  && call.args[0] === 'idx:semantic' && call.args.at(-2) === 'DIALECT' && Number(call.args.at(-1)) === 2)
const twoNamespacesScanned = m => ['ka:answer:contoso-backup:*', 'ka:sem:contoso-backup:*']
  .every(prefix => m.calls.some(call => call.command === 'SCAN' && !call.error && call.args.includes(prefix)))

export const redisCacheGuidedLab = {
  id: 'data-redis-cache-guided', title: 'Guided: Cache answers and search Redis vectors',
  brief: 'Provision Azure Managed Redis, implement expiring cache-aside answers, repair product invalidation, then use a scoped vector cache for paraphrases. All infrastructure and credentials are fictional training fixtures.',
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 10,
  labMode: 'guided', skillAreaId: 'data', service: 'managed-redis', status: 'available',
  manifestId: REDIS_MANIFEST.id, capabilities: { dataRedis: true, acrBuild: true, kubernetes: true }, dataTarget: REDIS_TARGET,
  initialProjectFiles: REDIS_STARTER_FILES, solutionFiles: REDIS_SOLUTION_FILES, initializeSimulation: seedRedisGuided,
  stages: [
    { id: 'provision', title: 'Provision and inspect Redis', taskIds: ['provision'] },
    { id: 'cache', title: 'Deploy cache-aside answers', taskIds: ['cache-baseline'] },
    { id: 'ttl', title: 'Observe the exact TTL boundary', taskIds: ['cache-ttl59', 'cache-expiry'] },
    { id: 'freshness', title: 'Diagnose stale answers and invalidate one product', taskIds: ['stale-before-invalidate', 'fresh-after-invalidate'] },
    { id: 'semantic', title: 'Index and reuse semantic answers', taskIds: ['index', 'semantic-paraphrase', 'semantic-near-miss'] },
    { id: 'scopes', title: 'Prove scope separation and bounded lifetime', taskIds: ['filter-isolation'] },
  ],
  scenarios: {
    'cache-baseline': redisScenario([reset, request(), request()]),
    'cache-ttl59': redisScenario([reset, request(), { action: 'advance', seconds: 59 }, request()]),
    'cache-expiry': redisScenario([{ action: 'advance', seconds: 1 }, request()]),
    // Expected-negative diagnostic: revision 1 remains in cache after source revision 2.
    'stale-before-invalidate': redisScenario([reset, request(), request(supportQuestion, support), update, request()]),
    // Do not reset here: the two previously primed products must survive until learner invalidation.
    'fresh-after-invalidate': redisScenario([request(supportQuestion, support), update, invalidate, request(), request(supportQuestion, support)]),
    'semantic-paraphrase': redisScenario([reset, request(canonical, backup, 'GET /answer'), request(paraphrase, backup, 'GET /answer')]),
    'semantic-near-miss': redisScenario([reset, request(canonical, backup, 'GET /answer'), request(nearMiss, backup, 'GET /answer')]),
    'filter-isolation': redisScenario([reset,
      ...REDIS_FIXTURES.scopeVariants.map(entry => request(entry.question, entry.scope, 'GET /answer')),
      ...REDIS_FIXTURES.scopeVariants.map(entry => request(paraphrase, entry.scope, 'GET /answer')),
    ]),
  },
  tasks: [
    task({ id: 'provision', stageId: 'provision',
      text: 'Create redis-assistant with RediSearch, Balanced_B0, EnterpriseCluster, NoEviction, encrypted clients and enabled training key authentication; connect with TLS and inspect the default database.',
      explanation: 'The resource group, ACR, AKS context, namespace and Service are supplied. Redis is deliberately absent. Use the training-only host/key in clients.py.',
      hints: ['Select RediSearch during creation.', 'Use port 10000, --tls and the fictional Training-Only-Redis-Key to run INFO memory.'],
      examNote: 'RediSearch modules are chosen at creation and cannot be added by changing app code. NoEviction rejects writes with OOM at the memory bound rather than evicting existing keys. The 64 KiB bound is a teaching fixture, not Balanced_B0 capacity. Simulated estimate — not an Azure guarantee.',
      check: context => resourceReady(context) && context.history.includes(redisCliCommand('INFO memory'))
        && context.history.includes('az redisenterprise database show -g rg-assistant --cluster-name redis-assistant --database-name default'),
      steps: [command(REDIS_CREATE_COMMAND), command('az redisenterprise database show -g rg-assistant --cluster-name redis-assistant --database-name default'), command(redisCliCommand('INFO memory'))],
    }),
    task({ id: 'cache-baseline', stageId: 'cache',
      text: 'Implement cached_answer, save app.py, build assistant:redis-cache, deploy it and run cache-baseline: one miss, one exact hit, one origin call, ttl=60.',
      explanation: 'Helpers create safe keys and serialize payloads. GET and SET with EX belong in learner code. Saving a file does not update running Pods: build, change the Deployment image, then apply.',
      hints: ['Decode a non-null GET; otherwise compute source_answer and SET with ex=ttl.', 'Use the cache-baseline button after the new image is deployed.'],
      examNote: 'SET EX writes the value and expiry together; EXPIRE separately changes a key lifetime. Cache-aside can race concurrent updates or repopulate after invalidation; this single-threaded simulator does not model production concurrency.',
      check: context => { const m = measurement(context, 'cache-baseline'); return redisDeployedFunctionsCurrent(context, cachedFunctions) && correct(m) && m.total === 2 && m.responseHits === 1 && m.originCalls === 1 },
      fields: cacheFields, steps: release(cacheSource, 'redis-cache', ['cache-baseline']),
    }),
    task({ id: 'cache-ttl59', stageId: 'ttl',
      text: 'Run cache-ttl59: advance simulation by 59 seconds and verify the existing answer is still an exact hit, with measured age 59 seconds.',
      explanation: 'The scenario resets only the two cache namespaces, computes one answer, advances 59 simulated seconds and reads it again. No real sleep is needed.',
      hints: ['Look for responseHits=1, originCalls=1 and maxAgeSeconds=59.', 'SCAN shows the response key; TTL on that key should be 1 at this point.'],
      examNote: 'TTL reports remaining whole seconds: -1 means a live key without expiry; -2 means the key does not exist. Reads do not refresh the write timestamp or extend expiry.',
      check: context => { const m = measurement(context, 'cache-ttl59'); return redisDeployedFunctionsCurrent(context, cachedFunctions) && correct(m) && m.responseHits === 1 && m.originCalls === 1 && m.ageKnown && m.maxAgeSeconds === 59 },
      fields: cacheFields, steps: release(cacheSource, 'redis-cache-ttl59', ['cache-ttl59'], ['SCAN 0 MATCH ka:answer:contoso-backup:*', `TTL ${canonicalKey}`]),
    }),
    task({ id: 'cache-expiry', stageId: 'ttl',
      text: 'Advance the final simulated second with cache-expiry: at age 60 the key expires and the next request computes a fresh answer.',
      explanation: 'Replay the 59-second setup before cache-expiry if needed. Expiry is checked at the request time, including exactly the deadline, not after a wall-clock delay.',
      hints: ['The expiry scenario advances one second from the 59-second observation.', 'Expect no hit, one origin call and at least one expired key.'],
      examNote: 'An EX=60 key is gone at its 60-second deadline. Passive expiry on the next command is enough here; expiration measurements are snapshots and do not invalidate earlier hit/miss observations.',
      check: context => { const m = measurement(context, 'cache-expiry'); return redisDeployedFunctionsCurrent(context, cachedFunctions) && correct(m) && m.total === 1 && m.responseHits === 0 && m.originCalls === 1 && m.expiredKeys >= 1 },
      fields: cacheFields, steps: release(cacheSource, 'redis-cache-expiry', ['cache-ttl59', 'cache-expiry']),
    }),
    task({ id: 'stale-before-invalidate', stageId: 'freshness',
      text: 'Run stale-before-invalidate: prime Backup and Support, apply Backup source revision 2 and observe the cached 35-day answer. This is an expected stale diagnostic baseline.',
      explanation: 'Updating the source alone never deletes cache keys. The workload can finish successfully while answersCorrect=false. This task records the fault; it does not certify freshness.',
      hints: ['The last Backup request must hit its old cached revision 1.', 'Keep this historical diagnostic separate from the following repair proof.'],
      examNote: 'A successful HTTP response can still be stale. Compare returned sourceRevision and answer text with the current source; a cache hit or completed workload alone is insufficient.',
      check: context => { const m = measurement(context, 'stale-before-invalidate'); const last = m?.requests.at(-1); return redisDeployedFunctionsCurrent(context, cachedFunctions) && trustworthy(m) && m.answersCorrect === false && m.staleAnswers === 1 && last?.responseHit && last.body?.sourceRevision === 1 && last.body.answer.includes('35 days') },
      // Historical source observation intentionally excludes source revision and later repair functions.
      fields: cacheFields, steps: release(cacheSource, 'redis-stale-diagnostic', ['stale-before-invalidate']),
    }),
    task({ id: 'fresh-after-invalidate', stageId: 'freshness',
      text: 'Implement invalidate_product across ka:answer: and ka:sem:, rebuild/deploy a new tag, then run fresh-after-invalidate. Backup must return revision 2 / 14 days; Support keys must still hit.',
      explanation: 'Delete only the requested product in both namespaces. The workload retains the stale diagnostic cache, calls your deployed invalidation function and verifies the resulting payload and unaffected Support response.',
      hints: ['Use scan_iter with each product-prefixed namespace and delete every returned key.', 'Do not clear the whole database or remove the vector index.'],
      examNote: 'Filter-safe keys include product, version and language plus the normalized question digest. Invalidation must cover both response strings and semantic hashes; deleting only exact answers can leave stale semantic hits. A SCAN/DELETE loop is a teaching pattern, not a production concurrency guarantee.',
      check: context => { const m = measurement(context, 'fresh-after-invalidate'); const returned = m?.requests.slice(-2); return redisDeployedFunctionsCurrent(context, freshFunctions) && correct(m) && twoNamespacesScanned(m) && returned?.[0]?.expectedAnswer && returned[0].originCalls === 1 && returned[0].body.sourceRevision === 2 && returned[0].body.answer === 'Contoso Backup snapshots are retained for 14 days by default.' && returned[1].expectedAnswer && returned[1].responseHit && m.calls.some(call => call.command === 'DEL' && call.args.some(key => key.startsWith('ka:answer:contoso-backup:'))) },
      fields: freshFields, steps: release(freshSource, 'redis-invalidate', ['fresh-after-invalidate'], ['SCAN 0 MATCH ka:answer:contoso-support:*']),
    }),
    task({ id: 'index', stageId: 'semantic',
      text: 'Create idx:semantic over HASH keys ka:sem: with product/version/language TAGs and HNSW FLOAT32 DIM 8 COSINE; inspect FT.INFO.',
      explanation: 'The exact response cache uses strings; the semantic cache uses hashes containing scoped tags, a packed vector and the serialized answer. The prefix selects only semantic hashes.',
      hints: ['VECTOR HNSW takes six attribute tokens in the supplied schema.', 'Inspect FT.INFO for FLOAT32, dimension 8, COSINE and the three TAG fields.'],
      examNote: 'HASH vectors use binary FLOAT32 values: eight dimensions require 32 bytes. Stored and query vectors must match DIM. embeddings-v2 produces twelve dimensions and cannot query this eight-dimensional index. Helpers pack/serialize only; learner code performs all Redis operations.',
      check: context => indexReady(context) && context.history.includes(redisCliCommand('FT.INFO idx:semantic')),
      steps: [command(redisCliCommand(REDIS_INDEX_COMMAND)), command(redisCliCommand('FT.INFO idx:semantic'))],
    }),
    task({ id: 'semantic-paraphrase', stageId: 'semantic',
      text: 'Implement remember_semantic, semantic_lookup and answer; build/deploy a new tag. Run semantic-paraphrase: canonical warmup then paraphrase must reuse the indexed answer.',
      explanation: 'Try the exact response key, then a scoped KNN lookup with an application threshold of 0.05, then compute and remember an origin answer with expiring semantic data.',
      hints: ['HSET tags/embedding/payload, then EXPIRE the hash.', 'Execute FT.SEARCH with three TAG filters, PARAMS vec, RETURN payload/distance and DIALECT 2. Decode the actual returned payload.'],
      examNote: 'Cosine distance is lower for closer vectors; accept distance <= 0.05 here. KNN always finds a nearest candidate if one exists, so apply a relevance threshold. DIALECT 2 enables the supplied vector query syntax. The simulator exactly ranks this small sample and does not model HNSW recall.',
      check: context => { const m = measurement(context, 'semantic-paraphrase'); return indexReady(context) && redisDeployedFunctionsCurrent(context, semanticFunctions) && correct(m) && m.total === 2 && m.semanticHits === 1 && m.responseHits === 0 && m.originCalls === 1 && m.requests[1].semanticHit && semanticTrace(m) },
      fields: semanticFields, steps: release(semanticSource, 'redis-semantic', ['semantic-paraphrase'], ['FT.INFO idx:semantic']),
    }),
    task({ id: 'semantic-near-miss', stageId: 'semantic',
      text: 'Run semantic-near-miss: warm the canonical retention answer, then ask about early deletion. It must compute its different source answer rather than reuse retention.',
      explanation: 'A related question is not interchangeable. The actual search should run but the nearest retention answer must be rejected by the distance threshold.',
      hints: ['Expect two origin calls and zero semantic hits.', 'Compare both returned answer payloads; the early-deletion answer must match its own source.'],
      examNote: 'Do not equate a returned KNN row with a safe cache hit. Thresholding and scoped payload provenance are application responsibilities.',
      check: context => { const m = measurement(context, 'semantic-near-miss'); return indexReady(context) && redisDeployedFunctionsCurrent(context, semanticFunctions) && correct(m) && m.total === 2 && m.semanticHits === 0 && m.originCalls === 2 && m.requests[0].body.answer !== m.requests[1].body.answer && semanticTrace(m) },
      fields: semanticFields, steps: release(semanticSource, 'redis-near-miss', ['semantic-near-miss'], ['FT.INFO idx:semantic']),
    }),
    task({ id: 'filter-isolation', stageId: 'scopes',
      text: 'Run filter-isolation for the same wording in four product/version/language scopes, then paraphrase each. Inspect keys, FT.INFO and INFO memory: no cross-filter answers and persistentKeys=0.',
      explanation: 'The scenario primes four differently scoped answers and proves four real scoped semantic hits. Inspect both key namespaces and the memory card; values are simulated estimates.',
      hints: ['Every exact key must encode the full scope; every vector search must constrain all three TAGs.', 'Use SCAN for ka:answer: and ka:sem:. Both SET EX and HSET followed by EXPIRE are required.'],
      examNote: 'Separate scopes in both keys and search filters. Semantic hashes need EXPIRE independently of the response string SET EX. persistentKeys=0 proves all surviving keys have an expiry at this observation. Memory and latency: Simulated estimate — not an Azure guarantee.',
      check: context => { const m = measurement(context, 'filter-isolation'); return indexReady(context) && redisDeployedFunctionsCurrent(context, semanticFunctions) && correct(m) && m.total === 8 && m.originCalls === 4 && m.semanticHits === 4 && m.persistentKeys === 0 && m.usedBytes > 0 && m.requests.slice(4).every(entry => entry.semanticHit && entry.expectedAnswer) && ['SCAN 0 MATCH ka:answer:*', 'SCAN 0 MATCH ka:sem:*', 'INFO memory'].every(line => context.history.includes(redisCliCommand(line))) },
      fields: [...semanticFields, 'redis:source:contoso-support'], steps: release(semanticSource, 'redis-scopes', ['filter-isolation'], ['SCAN 0 MATCH ka:answer:*', 'SCAN 0 MATCH ka:sem:*', 'FT.INFO idx:semantic', 'INFO memory']),
    }),
  ],
}
