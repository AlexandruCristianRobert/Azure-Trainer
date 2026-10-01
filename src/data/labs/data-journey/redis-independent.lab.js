import { REDIS_MANIFEST, REDIS_STARTER_FILES, REDIS_SOLUTION_FILES } from '../../templates/data-python/redis.js'
import { REDIS_FIXTURES } from '../../fixtures/data/redis.js'
import { seedRedisIndependent } from './redis-seeds.js'
import { REDIS_TARGET, REDIS_DEPENDENCY_TARGET, REDIS_ESTIMATE_LABEL, redisDependencies,
  redisScenario, redisDeployedArtifact, redisDeployedFunctionsCurrent } from './redis-helpers.js'

const canonical = 'How many days are Contoso Backup snapshots retained?'
const paraphrase = 'How long does Contoso Backup keep my snapshots?'
const nearMiss = 'How do I permanently delete a Contoso Backup snapshot before its retention period ends?'
const variants = REDIS_FIXTURES.scopeVariants
const backup = variants[0].scope
const support = variants[3].scope
const request = (question, scope, route = 'GET /answer') => ({ action: 'request', route,
  args: { question, ...scope, ...(route === 'GET /cached' ? { ttl: 60 } : {}) } })
const reset = { action: 'reset-cache' }
const update = { action: 'source-update', product: backup.product, revision: 2 }
const invalidate = { action: 'request', route: 'POST /invalidate', args: { product: backup.product } }
const file = (path, content) => ({ kind: 'file', path, content })
const command = line => ({ kind: 'command', line })
const scenario = scenarioId => ({ kind: 'scenario', scenarioId })
const deployment = REDIS_STARTER_FILES['k8s/deployment.yaml'].replace('assistant:v1', 'assistant:redis-independent-solution')
const release = [file('app.py', REDIS_SOLUTION_FILES['app.py']), file('clients.py', REDIS_SOLUTION_FILES['clients.py']),
  file('Dockerfile', REDIS_SOLUTION_FILES.Dockerfile),
  command('az acr build --registry acrassistant --image assistant:redis-independent-solution .'),
  file('k8s/deployment.yaml', deployment), command('kubectl apply -f k8s/deployment.yaml')]
const functions = REDIS_MANIFEST.editZones
const fields = ['redis:resource', 'redis:index:idx:semantic', 'redis:source:contoso-backup', 'redis:source:contoso-support',
  ...functions.map(name => `code:assistant-api:${name}`)]
const measurement = (context, id) => {
  const record = context.evidence?.experimentsById?.[context.evidence.currentEvidenceByTask[id]]
  return record?.taskId === id && record.scenarioId === id && record.completed && record.outcome === 'passed' ? record.measurements : null
}
const learnerDeployed = context => {
  const artifact = redisDeployedArtifact(context)
  const first = Object.values(context.artifacts.buildsById).sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6)))[0]
  return !!artifact && artifact.id !== first?.id && redisDeployedFunctionsCurrent(context, functions)
}
const correct = m => m?.status === 200 && m.answersCorrect === true && m.provenanceValid === true
  && m.traceTruncated === false && m.staleAnswers === 0 && m.crossFilterAnswers === 0
  && m.ageKnown === true && Number.isFinite(m.maxAgeSeconds) && m.maxAgeSeconds <= 60
  && m.rejectedWrites === 0 && m.persistentKeys === 0 && m.usedBytes <= 64 * 1024

// Complete request-boundary facts accept SET+EXPIRE and preserved HASH TTLs
// without grading the presentation-only operation list or Python spelling.
const boundedWrites = m => m.requests.every(({ cacheEffects: effects }) => effects?.complete === true
  && effects.persistentKeys === 0 && Number.isFinite(effects.maxRemainingTtlSeconds)
  && effects.maxRemainingTtlSeconds >= 0 && effects.maxRemainingTtlSeconds <= 60)
function freshness(context) {
  const m = measurement(context, 'immediate-freshness')
  if (!learnerDeployed(context) || !correct(m) || !boundedWrites(m) || m.total !== 6) return false
  const [backupPrime, supportPrime, invalidation, exact, similar, supportExact, supportSimilar] = m.requests
  const deleted = invalidation.cacheEffects.removedKeys
  const primedKeys = backupPrime.cacheEffects.writtenKeys
  return backupPrime?.originCalls === 1 && supportPrime?.originCalls === 1
    && [['ka:answer:contoso-backup:', 'string'], ['ka:sem:contoso-backup:', 'hash']].every(([prefix, type]) => primedKeys.some(entry => entry.key.startsWith(prefix)
      && entry.type === type && deleted.some(removed => removed.command === 'DEL' && removed.key === entry.key && removed.type === type)))
    && !m.requests.filter(entry => entry.stepIndex < invalidation.stepIndex).some(entry => entry.cacheEffects.removedKeys
      .some(removed => primedKeys.some(primed => primed.key === removed.key)))
    && !deleted.some(entry => entry.key.startsWith('ka:answer:contoso-support:') || entry.key.startsWith('ka:sem:contoso-support:'))
    && exact?.atMs === invalidation.atMs && similar?.atMs === invalidation.atMs
    && exact.originCalls === 1 && similar.originCalls === 1
    && exact.body?.sourceRevision === 2 && similar.body?.sourceRevision === 2
    && supportExact?.responseHit === true && supportSimilar?.semanticHit === true
}
function workload(context) {
  const m = measurement(context, 'cache-contract')
  return learnerDeployed(context) && correct(m) && boundedWrites(m) && m.total === 20
    && m.hitRatio >= 0.40 && m.responseHits >= 4 && m.semanticHits >= 4
    && m.requests.filter(entry => entry.route !== 'POST /invalidate').slice(-2).every(entry => entry.originCalls === 1)
}
const task = (id, text, check, steps) => ({ id, stageId: 'contract', text, check, hints: [],
  explanation: 'Measured answers, source IDs and scopes must match the current supplied fixtures. Cache hit counts come from real GET/FT.SEARCH responses; application counters cannot satisfy this contract. ' + REDIS_ESTIMATE_LABEL,
  examNote: 'This single-threaded training model does not simulate production cache concurrency. Source updates do not invalidate keys automatically.',
  verification: { scenarioId: id, scenarioVersion: 1 }, dependencies: redisDependencies(REDIS_DEPENDENCY_TARGET, fields), solution: { steps } })

export const redisIndependentLab = {
  id: 'data-redis-independent', title: 'Independent: Deliver a fresh scoped Redis cache',
  brief: 'Deliver exact and semantic caching for the supplied Knowledge Assistant. The same normalized retention question has distinct answers and source IDs across Backup v1/en, Backup v2/en, Backup v1/de and Support v1/en. All answers and source IDs must stay in scope. After a Backup source update and your explicit invalidation, immediate exact and paraphrase requests must return current answers while both Support cache types survive. Choose TTLs from 1–60 seconds and a cosine distance threshold from 0–1. No answer may be older than 60 seconds; memory must remain within the 64 KiB teaching limit, with zero OOM writes or persistent cache entries. The 20-request workload must achieve hitRatio ≥0.40, responseHits ≥4 and semanticHits ≥4, with staleAnswers=0 and crossFilterAnswers=0. Resource, DIM-8 index, ACR, AKS, connection, helpers and manifests are supplied independently; all five app edit zones remain unfinished. Credentials are fictional and training-only. ' + REDIS_ESTIMATE_LABEL,
  minutes: 60, engineVersion: 2, contentVersion: 1, journeyId: 'data-knowledge-assistant', journeyOrder: 12,
  labMode: 'independent', skillAreaId: 'data', service: 'managed-redis', status: 'available',
  manifestId: REDIS_MANIFEST.id, capabilities: { dataRedis: true, acrBuild: true, kubernetes: true }, dataTarget: REDIS_TARGET,
  initialProjectFiles: REDIS_STARTER_FILES, solutionFiles: { ...REDIS_SOLUTION_FILES, 'k8s/deployment.yaml': deployment },
  initializeSimulation: seedRedisIndependent,
  stages: [{ id: 'contract', title: 'Meet the cache contract', taskIds: ['immediate-freshness', 'cache-contract'] }],
  scenarios: {
    'immediate-freshness': redisScenario([reset, request(canonical, backup), request(canonical, support), update, invalidate,
      request(canonical, backup, 'GET /cached'), request(paraphrase, backup),
      request(canonical, support, 'GET /cached'), request(paraphrase, support)]),
    'cache-contract': redisScenario([reset,
      ...variants.map(entry => request(canonical, entry.scope)),
      ...variants.map(entry => request(canonical, entry.scope)),
      ...variants.map(entry => request(paraphrase, entry.scope)),
      ...variants.map(entry => request(nearMiss, entry.scope)),
      update, invalidate, request(canonical, backup), request(paraphrase, backup),
      { action: 'advance', seconds: 61 }, request(canonical, backup), request(canonical, support)]),
  },
  tasks: [
    task('immediate-freshness', 'Prove immediate invalidation of both primed Backup cache types and preserve Support exact and semantic hits.', freshness,
      [...release, scenario('immediate-freshness')]),
    task('cache-contract', 'Meet the 20-request correctness, reuse, freshness and bounded memory contract.', workload,
      [...release, scenario('immediate-freshness'), scenario('cache-contract')]),
  ],
}
