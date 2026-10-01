import { REDIS_MANIFEST, REDIS_SOLUTION_FILES, REDIS_SOLUTION_FUNCTIONS } from '../../templates/data-python/redis.js'
import { REDIS_FIXTURES } from '../../fixtures/data/redis.js'
import { seedRedisTroubleshooting } from './redis-seeds.js'
import { REDIS_TARGET, REDIS_DEPENDENCY_TARGET, REDIS_INDEX_COMMAND, REDIS_ESTIMATE_LABEL,
  redisCliCommand, redisDependencies, redisScenario, redisDeployedFunctionsCurrent } from './redis-helpers.js'

const canonical = 'How many days are Contoso Backup snapshots retained?'
const paraphrase = 'How long does Contoso Backup keep my snapshots?'
const nearMiss = 'How do I permanently delete a Contoso Backup snapshot before its retention period ends?'
const supportQuestion = "What are Contoso Support's on-call hours for critical incidents?"
const backup = { product: 'contoso-backup', version: 'v1', language: 'en' }
const support = { product: 'contoso-support', version: 'v1', language: 'en' }
const canonicalSuffix = 'contoso-backup:v1:en:3c5870a9231bf212a6520378d60f6a6814ac99be9c2a5276d4f9962e7f71d200'
const request = (question = canonical, scope = backup, route = 'GET /answer') => ({ action: 'request', route,
  args: { question, ...scope, ...(route === 'GET /cached' ? { ttl: 60 } : {}) } })
const reset = { action: 'reset-cache' }
const command = line => ({ kind: 'command', line })
const cli = line => command(redisCliCommand(line))
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const inspect = instruction => ({ kind: 'inspect', instruction })
const file = (path, content) => ({ kind: 'file', path, content })
const finalSource = REDIS_SOLUTION_FILES['app.py']
const faultyInvalidation = finalSource.replace(REDIS_SOLUTION_FUNCTIONS.invalidate_product,
  REDIS_SOLUTION_FUNCTIONS.invalidate_product.replace('ka:answer:', 'ka:answers:').replace('ka:sem:', 'ka:semantic:'))
const missingTtl = finalSource.replace('cache.set(key, encode_answer(result), ex=ttl)', 'cache.set(key, encode_answer(result))')
  .replace('    cache.expire(key, ttl)\n', '')
// Every key call site is faulty, including the exact check in answer and hash writes.
const missingScope = finalSource.replaceAll('response_key(question, product, version, language)', '"ka:answer:" + question')
  .replaceAll('semantic_key(question, product, version, language)', '"ka:sem:" + question')
const looseThreshold = finalSource.replace('semantic_lookup(question, product, version, language, 0.05)', 'semantic_lookup(question, product, version, language, 0.20)')
const deployment = tag => REDIS_SOLUTION_FILES['k8s/deployment.yaml'].replace('assistant:v1', `assistant:${tag}`)
const deploy = (source, tag) => [file('app.py', source), command(`az acr build --registry acrassistant --image assistant:${tag} .`),
  file('k8s/deployment.yaml', deployment(tag)), command('kubectl apply -f k8s/deployment.yaml')]
const database = context => context.sandbox.redisClusters?.find(cluster => cluster.name === REDIS_TARGET.cluster && cluster.resourceGroup === REDIS_TARGET.resourceGroup)?.database
const measurement = (context, id) => context.evidence.experimentsById[context.evidence.currentEvidenceByTask[id]]?.measurements
const correct = m => m?.status === 200 && m.provenanceValid === true && m.answersCorrect === true
  && m.traceTruncated === false && m.crossFilterAnswers === 0 && m.staleAnswers === 0
  && m.requests.every(request => request.cacheEffects?.complete === true)
const allFunctions = Object.keys(REDIS_SOLUTION_FUNCTIONS)
const cacheFunctions = ['cached_answer', 'remember_semantic', 'semantic_lookup', 'answer']
const fields = (names, search = true) => ['redis:resource', ...names.map(name => `code:assistant-api:${name}`),
  'redis:source:contoso-backup', 'redis:source:contoso-support', ...(search ? ['redis:index:idx:semantic'] : [])]
const searched = m => m.requests.some(request => request.cacheEffects.searchedSemanticDialect2)
const task = ({ id, stageId, text, explanation, hints, examNote, names = cacheFunctions, search = true, check, steps }) => ({
  id, stageId, text, explanation, hints, examNote, solution: { steps }, verification: { scenarioId: id, scenarioVersion: 1 },
  dependencies: redisDependencies(REDIS_DEPENDENCY_TARGET, names.length ? fields(names, search) : ['redis:resource']),
  check: context => (!names.length || redisDeployedFunctionsCurrent(context, names)) && check(context, measurement(context, id)),
})
const fill = Object.entries(REDIS_FIXTURES.aliases).flatMap(([question, alias]) => [
  request(question, { product: REDIS_FIXTURES.questions[alias.of].product, version: 'v1', language: 'en' }, 'GET /cached'),
  { action: 'advance', seconds: 1 },
])
const refresh = [...['fresh-after-invalidation', 'memory-restored', 'purge-owned-cache', 'scope-isolation'].map(scenario),
  cli(`DEL ka:answer:${canonicalSuffix}`), scenario('dimensions-restored')]

export const redisTroubleshootingLab = {
  id: 'data-redis-troubleshooting', title: 'Troubleshooting: Recover Redis answers',
  brief: 'Recover four ordered incidents: stale answers, persistent cache memory, scope collisions, then vector dimensions and relevance. Only the wrong invalidation prefixes are initially active. Later fault-entry instructions explicitly save code, build new images, apply Deployments or replace the index. Infrastructure, access and RediSearch/DIM 8 are supplied; credentials are fictional training-only. ' + REDIS_ESTIMATE_LABEL,
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 11,
  labMode: 'troubleshooting', skillAreaId: 'data', service: 'managed-redis', status: 'available',
  manifestId: REDIS_MANIFEST.id, capabilities: { dataRedis: true, acrBuild: true, kubernetes: true }, dataTarget: REDIS_TARGET,
  initialProjectFiles: { ...REDIS_SOLUTION_FILES, 'app.py': faultyInvalidation, 'k8s/deployment.yaml': deployment('redis-troubleshooting-seed') },
  solutionFiles: { ...REDIS_SOLUTION_FILES, 'k8s/deployment.yaml': deployment('redis-search-fixed') },
  initializeSimulation: seedRedisTroubleshooting,
  stages: [
    { id: 'freshness', title: 'Repair both invalidation namespaces', taskIds: ['fresh-after-invalidation'] },
    { id: 'memory', title: 'Enact missing TTL, clear old entries, bound memory', taskIds: ['purge-owned-cache', 'memory-restored'] },
    { id: 'scope', title: 'Enact and repair three missing key scopes', taskIds: ['scope-isolation'] },
    { id: 'search', title: 'Repair dimensions, then relevance', taskIds: ['dimensions-restored', 'relevance-restored'] },
  ],
  scenarios: {
    'fresh-after-invalidation': redisScenario([reset, request(), request(supportQuestion, support),
      { action: 'source-update', product: backup.product, revision: 2 },
      { action: 'request', route: 'POST /invalidate', args: { product: backup.product } },
      request(canonical, backup, 'GET /cached'), request(paraphrase), request(supportQuestion, support)]),
    // Explicit destructive cleanup button; neither TTL verification nor deployment does this.
    'purge-owned-cache': redisScenario([reset]),
    'memory-restored': redisScenario([{ action: 'advance', seconds: 61 }, request(), ...fill, { action: 'advance', seconds: 61 }, request()]),
    'scope-isolation': redisScenario([
      ...REDIS_FIXTURES.scopeVariants.map(entry => request(entry.question, entry.scope, 'GET /cached')),
      ...REDIS_FIXTURES.scopeVariants.map(entry => request(entry.question, entry.scope)),
      ...REDIS_FIXTURES.scopeVariants.map(entry => request(paraphrase, entry.scope)),
    ]),
    'dimensions-restored': redisScenario([request()]),
    'relevance-restored': redisScenario([reset, request(), request(paraphrase), request(nearMiss)]),
  },
  tasks: [
    task({ id: 'fresh-after-invalidation', stageId: 'freshness', names: allFunctions,
      text: 'Observe stale exact and semantic answers after the Backup update; repair both prefixes and preserve Support.',
      explanation: 'Run fresh-after-invalidation before editing: the seed scans ka:answers: and ka:semantic:, so Backup still returns revision 1 / 35 days after its source changes to revision 2 / 14 days. Its paraphrase is a stale semantic hit. Correct both SCAN prefixes and DELETE the matching keys. The same workload then proves both fresh paths and an unaffected Support exact hit. Its controlled reset only prepares this freshness experiment.',
      hints: ['Inspect SCAN/DEL, returned revisions, responseHits and semanticHits.', 'Use ka:answer:<product>:* and ka:sem:<product>:*. Save, build a new tag, edit the Deployment image and apply.'],
      examNote: 'Source updates do not invalidate caches automatically. Exact and semantic namespaces both own stale payloads; avoid deleting another product.',
      check: (_context, m) => correct(m) && m.total === 5 && m.originCalls === 4 && m.responseHits === 1
        && m.requests[3]?.body.sourceRevision === 2 && m.requests[4]?.body.sourceRevision === 2
        && m.requests.at(-1)?.responseHit === true
        && ['ka:answer:contoso-backup:*', 'ka:sem:contoso-backup:*'].every(prefix => m.requests.some(request => request.cacheEffects.scanPatterns.includes(prefix)))
        && ['ka:answer:', 'ka:sem:'].every(prefix => m.requests.some(request => request.cacheEffects.removedKeys.some(entry => entry.command === 'DEL' && entry.key.startsWith(prefix + 'contoso-backup:')))),
      steps: [scenario('fresh-after-invalidation'), inspect('Before repair: staleAnswers=2; revision 1 exact and semantic answers despite the revision 2 source. Support remains correct.'),
        ...deploy(finalSource, 'redis-invalidation-fixed'), scenario('fresh-after-invalidation')],
    }),
    task({ id: 'purge-owned-cache', stageId: 'memory', names: [], search: false,
      text: 'Install the declared missing-TTL incident, inspect OOM and TTL -1, then explicitly delete old owned cache entries.',
      explanation: 'Stage entry: in cached_answer remove ex=ttl from SET; in remember_semantic remove cache.expire(key, ttl). Keep the repaired invalidation and other functions. Save/build assistant:redis-ttl-incident, set that Deployment image and apply. Run memory-restored: 256 known training aliases use GET /cached, each followed by one simulated second. The persistent string/hash and unique keys grow to the 64 KiB fixture bound; NoEviction rejects writes with OOM. Inspect INFO memory and TTL on both listed keys. Then explicitly run purge-owned-cache: it deletes ka:answer:* and ka:sem:* only, preserving the index and sources. This cleanup is intentionally separate from recovery verification; changing TTL code cannot alter old keys.',
      hints: ['Solution supplies the complete incident source and Deployment. Observe the failed memory workload before cleanup.', 'TTL -1 means persistent, -2 means absent. Inspect usedBytes, persistentKeys and rejectedWrites; no real waiting is needed.'],
      examNote: 'NoEviction rejects writes, rather than evicting existing keys. 64 KiB is a teaching bound, not Balanced_B0 capacity. ' + REDIS_ESTIMATE_LABEL,
      check: (_context, m) => correct(m) && m.keyCount === 0 && m.persistentKeys === 0 && m.usedBytes === 256,
      steps: [...deploy(missingTtl, 'redis-ttl-incident'), scenario('purge-owned-cache'), scenario('memory-restored'),
        cli(`TTL ka:answer:${canonicalSuffix}`), cli(`TTL ka:sem:${canonicalSuffix}`), cli('INFO memory'),
        inspect('Expected diagnostic: both TTL values are -1; usedBytes approaches 65536 and rejectedWrites is positive. Existing keys survive OOM. Now explicitly purge the old persistent entries.'),
        scenario('purge-owned-cache'), cli('INFO memory')],
    }),
    task({ id: 'memory-restored', stageId: 'memory',
      text: 'Repair string SET EX and hash EXPIRE; repeat the fill with zero rejected writes or persistent keys.',
      explanation: 'After the explicit purge, restore ex=ttl and cache.expire(key, ttl). Save, build assistant:redis-ttl-fixed and apply its Deployment. memory-restored performs no cleanup: it advances 61 simulated seconds, primes a semantic hash, fills 256 known aliases using GET /cached and 1-second advances, then advances 61 seconds and primes again. Old persistent keys would remain visible and fail recovery. Observe real expiry, correct answers and bounded memory. Earlier code-dependent freshness proof is refreshed at the end of the final search solution.',
      hints: ['Both strings and hashes require lifetime controls; SET EX does not expire a separate hash.', 'Run purge-owned-cache explicitly if old persistent entries remain, then run memory-restored.'],
      examNote: 'TTL changes affect new writes only. Simulated clock advances are synchronous. ' + REDIS_ESTIMATE_LABEL,
      check: (_context, m) => correct(m) && m.total === 258 && m.originCalls >= 256 && m.persistentKeys === 0
        && m.rejectedWrites === 0 && m.expiredKeys >= 256 && m.usedBytes > 0 && m.usedBytes < 65536
        && m.requests.some(request => request.cacheEffects.setWithExpiry)
        && m.requests.some(request => request.cacheEffects.expiryApplied),
      steps: [...deploy(finalSource, 'redis-ttl-fixed'), scenario('memory-restored'),
        cli(`TTL ka:answer:${canonicalSuffix}`), cli(`TTL ka:sem:${canonicalSuffix}`), cli('INFO memory')],
    }),
    task({ id: 'scope-isolation', stageId: 'scope',
      text: 'Install question-only keys, observe wrong product/version/language, then restore scope in every key call site.',
      explanation: 'Stage entry: replace both response_key calls (cached_answer and answer) with "ka:answer:" + question, and semantic_key in remember_semantic with "ka:sem:" + question. Save/build assistant:redis-scope-incident and apply. Explicitly purge before this controlled collision experiment. scope-isolation sends identical wording for Backup v1/en, Backup v2/en, Backup v1/de and Support v1/en: faulty exact hits return the first scope. Restore all three key call sites, build/apply, and explicitly purge unsafe question-only entries in both namespaces before verifying. Inspect all twelve returned scopes, including semantic hash writes. A successful HTTP status alone is insufficient.',
      hints: ['The source has distinct correct answers for all four scopes. Check crossFilterAnswers and each returned body.scope.', 'Use response_key(question, product, version, language) in both read paths and semantic_key with all four arguments for hash writes.'],
      examNote: 'Cache identity includes every dimension that can change the answer: product, version and language. Retire unsafe keys after changing the key scheme.',
      check: (_context, m) => correct(m) && m.total === 12 && m.originCalls === 8 && m.responseHits === 4
        && REDIS_FIXTURES.scopeVariants.every(entry => m.requests.some(request => request.cacheEffects.hashWrittenKeys.some(key =>
          key.startsWith(`ka:sem:${entry.scope.product}:${entry.scope.version}:${entry.scope.language}:`)))),
      steps: [...deploy(missingScope, 'redis-scope-incident'), scenario('purge-owned-cache'), scenario('scope-isolation'),
        inspect('Expected diagnostic: successful HTTP with crossFilterAnswers > 0; inspect wrong returned product, version and language.'),
        ...deploy(finalSource, 'redis-scope-fixed'), scenario('purge-owned-cache'), scenario('scope-isolation')],
    }),
    task({ id: 'dimensions-restored', stageId: 'search',
      text: 'Install DIM 12, observe the 8-dimensional vector error, then recreate DIM 8 without deleting hashes.',
      explanation: 'Stage entry uses the displayed FT.DROPINDEX and FT.CREATE DIM 12 commands, plus DEL of the canonical exact key to force a vector lookup. Existing semantic hashes remain; embeddings-v1 returns 8 values. dimensions-restored asks the canonical question so FT.SEARCH reports the vector size error. Inspect FT.INFO. Drop the index without DD and recreate HASH/FLOAT32/HNSW/COSINE DIM 8 with all three TAG filters. Run dimensions-restored again: a real DIALECT 2 search reuses the correct stored paraphrase payload. The threshold stays at 0.05 here; the next task visibly introduces the separate 0.20 fault.',
      hints: ['FT.DROPINDEX idx:semantic without DD preserves hashes. Do not delete data to repair a schema.', 'Authored vectors are DIM 8; embeddings-v2 returns 12 dimensions and is not the repair for these stored vectors.'],
      examNote: 'Stored and query vector dimensions must match the index. Module selection occurs at resource creation; the supplied resource already has RediSearch.',
      check: (context, m) => correct(m) && searched(m) && m.semanticHits === 1
        && database(context)?.indexes['idx:semantic']?.fields.some(field => field.name === 'embedding' && field.dimensions === 8),
      steps: [cli(`DEL ka:answer:${canonicalSuffix}`), cli('FT.DROPINDEX idx:semantic'), cli(REDIS_INDEX_COMMAND.replace('DIM 8', 'DIM 12')), cli('FT.INFO idx:semantic'),
        scenario('dimensions-restored'), inspect('Expected diagnostic: vector-size ResponseError, not DATA_UNSUPPORTED. The stored hashes still exist.'),
        cli('FT.DROPINDEX idx:semantic'), cli(REDIS_INDEX_COMMAND), cli('FT.INFO idx:semantic'), scenario('dimensions-restored')],
    }),
    task({ id: 'relevance-restored', stageId: 'search',
      text: 'Install threshold 0.20 and observe a wrong semantic near miss; repair to 0.05 and refresh affected proofs.',
      explanation: 'Only after DIM 8 recovery, stage entry sets answer\'s semantic_lookup threshold to 0.20; save/build assistant:redis-threshold-incident and apply. relevance-restored clears its controlled sample and requests canonical, paraphrase and near miss. HTTP succeeds but the near miss wrongly reuses the retention answer: inspect FT.SEARCH distance (between 0.05 and 0.20), semanticHits and answersCorrect. Restore 0.05, build/apply, then prove one paraphrase semantic hit and a distinct source answer for the near miss. The final Solution refreshes the four earlier proofs whose selected code/index changed; historical explicit-cleanup proof remains unaffected. All four incidents can then complete together.',
      hints: ['Lower cosine distance means closer. A schema repair cannot fix an overly permissive relevance threshold.', 'Expected recovery: total=3, semanticHits=1, originCalls=2, answersCorrect=true.'],
      examNote: 'A successful vector query is not proof of answer relevance. Check near misses independently of paraphrase hits. ' + REDIS_ESTIMATE_LABEL,
      check: (_context, m) => correct(m) && searched(m) && m.total === 3 && m.semanticHits === 1 && m.originCalls === 2
        && m.requests[1]?.semanticHit === true && m.requests[2]?.semanticHit === false && m.requests[2]?.originCalls === 1,
      steps: [...deploy(looseThreshold, 'redis-threshold-incident'), scenario('relevance-restored'),
        inspect('Expected diagnostic: HTTP 200, semanticHits=2, answersCorrect=false. Compare the near-miss distance with 0.20 and 0.05.'),
        ...deploy(finalSource, 'redis-search-fixed'), ...refresh, scenario('relevance-restored')],
    }),
  ],
}
