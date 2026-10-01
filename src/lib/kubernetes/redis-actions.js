import { runDataFunction } from '../data/runtime.js'
import { executeRedis, redisMemory } from '../data/redis-store.js'
import { redisSourceAnswer } from '../../data/fixtures/data/redis.js'
import { REDIS_PRODUCTS } from '../../data/templates/data-python/redis.js'
import { redisDeployedArtifact, REDIS_ESTIMATE_LABEL } from '../../data/labs/data-journey/redis-helpers.js'
import { getProjectManifest } from '../project/manifests.js'
import { canonicalize, recordVerification } from '../labEngine/evidence.js'
import { refreshKubernetesDependencies } from './evidence.js'
import { isPlainObject, isJsonValue } from '../labEngine/run.js'

const keysAre = (value, keys) => isPlainObject(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
const same = (a, b) => canonicalize(a) === canonicalize(b)
const owned = key => key.startsWith('ka:answer:') || key.startsWith('ka:sem:')
const databaseOf = (sandbox, target) => sandbox.redisClusters?.find(cluster => cluster.resourceGroup === target.resourceGroup && cluster.name === target.cluster)?.database
function validArgs(route, args) {
  if (!Array.isArray(args) || !isJsonValue(args)) return false
  if (route === 'POST /invalidate') return args.length === 1 && REDIS_PRODUCTS.includes(args[0])
  if (!['GET /cached', 'GET /answer'].includes(route) || args.length !== (route === 'GET /cached' ? 5 : 4)) return false
  return typeof args[0] === 'string' && args[0].length > 0 && args[0].length <= 8192 && REDIS_PRODUCTS.includes(args[1])
    && ['v1', 'v2'].includes(args[2]) && ['en', 'de'].includes(args[3])
    && (route !== 'GET /cached' || Number.isInteger(args[4]) && args[4] >= 1 && args[4] <= 300)
}
export function validRedisScenario(scenario) {
  if (!keysAre(scenario, 'kind,version,target,steps') || scenario.kind !== 'data-cache' || scenario.version !== 1
    || !keysAre(scenario.target, 'clusterId,namespace,serviceName,deploymentName') || !Object.values(scenario.target).every(value => typeof value === 'string' && value.length > 0)
    || !Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length > 2048) return false
  return scenario.steps.every(step => {
    if (!isPlainObject(step)) return false
    if (step.action === 'request') return keysAre(step, 'action,route,args') && validArgs(step.route, step.args)
    if (step.action === 'advance') return keysAre(step, 'action,seconds') && Number.isInteger(step.seconds) && step.seconds >= 1 && step.seconds <= 300
    if (step.action === 'source-update') return keysAre(step, 'action,product,revision') && REDIS_PRODUCTS.includes(step.product) && step.revision === 2
    return step.action === 'reset-cache' && keysAre(step, 'action')
  })
}
function decodePayload(value) {
  try {
    const text = value?.redisKind === 'bytes' ? new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value.base64), character => character.charCodeAt(0))) : value
    return typeof text === 'string' ? JSON.parse(text) : undefined
  } catch { return undefined }
}
function acceptedSearch(call, body) {
  if (call.command !== 'FT.SEARCH' || call.error || !Array.isArray(call.value)) return []
  const candidates = []
  for (let position = 1; position < call.value.length; position += 2) {
    const fields = call.value[position + 1]
    if (!Array.isArray(fields)) continue
    const payloadPosition = fields.indexOf('payload')
    const payload = payloadPosition >= 0 ? decodePayload(fields[payloadPosition + 1]) : undefined
    if (payload !== undefined && same(payload, body)) candidates.push(call.value[position])
  }
  return candidates
}
function acceptedReads(calls, body, beforeKeys, nowMs) {
  const writtenAt = new Map(Object.entries(beforeKeys).map(([key, entry]) => [key, entry.writtenAtMs]))
  const gets = []
  const searches = []
  for (const call of calls) {
    if (call.error) continue
    // Capture age at the read, not from the request's initial or final state.
    // A later write cannot retroactively refresh an already returned payload.
    if (call.command === 'SET' && call.value === 'OK' || call.command === 'HSET' && Number.isInteger(call.value) && call.value >= 0) writtenAt.set(call.args[0], nowMs)
    else if (call.command === 'DEL') for (const key of call.args) writtenAt.delete(key)
    else if (call.command === 'EXPIRE' && call.value === 1 && call.args[1] <= 0) writtenAt.delete(call.args[0])
    else if (call.command === 'GET' && call.value !== null && decodePayload(call.value) !== undefined && same(decodePayload(call.value), body)) {
      gets.push({ key: call.args[0], writtenAtMs: writtenAt.get(call.args[0]) })
    } else if (call.command === 'FT.SEARCH') {
      searches.push(...acceptedSearch(call, body).map(key => ({ key, writtenAtMs: writtenAt.get(key) })))
    }
  }
  return { gets, searches }
}
// Separate bounded grading facts from the capped presentation trace. Replaying
// successful mutations identifies the keys actually removed, including DEL
// with absent/duplicate arguments, while HSET preserves an existing expiry.
function cacheEffects(calls, beforeKeys, afterKeys, nowMs, complete) {
  const entries = new Map(Object.entries(beforeKeys).filter(([, entry]) => entry.expiresAtMs === null || entry.expiresAtMs > nowMs)
    .map(([key, entry]) => [key, { type: entry.type, expiresAtMs: entry.expiresAtMs }]))
  const writes = new Set()
  const removed = new Map()
  let bounded = true
  const noteRemoval = (key, entry, command) => {
    if (!owned(key)) return
    const identity = JSON.stringify([key, command])
    if (!removed.has(identity) && removed.size >= 256) { bounded = false; return }
    removed.set(identity, { key, type: entry.type, command })
  }
  for (const call of calls) {
    if (call.error) continue
    const key = String(call.args[0])
    if (call.command === 'SET' && call.value === 'OK') {
      entries.set(key, { type: 'string', expiresAtMs: call.args[2] === 'EX' ? nowMs + Number(call.args[3]) * 1000 : null })
      if (owned(key)) writes.add(key)
    } else if (call.command === 'HSET' && Number.isInteger(call.value) && call.value >= 0) {
      entries.set(key, { type: 'hash', expiresAtMs: entries.get(key)?.expiresAtMs ?? null })
      if (owned(key)) writes.add(key)
    } else if (call.command === 'EXPIRE' && call.value === 1 && entries.has(key)) {
      if (Number(call.args[1]) <= 0) {
        noteRemoval(key, entries.get(key), 'EXPIRE')
        entries.delete(key)
      } else entries.get(key).expiresAtMs = nowMs + Number(call.args[1]) * 1000
    } else if (call.command === 'DEL' && Number.isInteger(call.value) && call.value > 0) {
      for (const argument of call.args) {
        const name = String(argument)
        if (!entries.has(name)) continue
        noteRemoval(name, entries.get(name), 'DEL')
        entries.delete(name)
      }
    }
  }
  if (writes.size > 256) bounded = false
  const writtenKeys = [...writes].slice(0, 256).filter(key => afterKeys[key]
    && (afterKeys[key].expiresAtMs === null || afterKeys[key].expiresAtMs > nowMs))
    .map(key => ({ key, type: afterKeys[key].type }))
  let persistentKeys = 0
  let maxRemainingTtlSeconds = 0
  for (const entry of Object.values(afterKeys)) {
    if (entry.expiresAtMs === null) persistentKeys++
    else if (entry.expiresAtMs > nowMs) maxRemainingTtlSeconds = Math.max(maxRemainingTtlSeconds, (entry.expiresAtMs - nowMs) / 1000)
  }
  return { complete: complete && bounded, writtenKeys, removedKeys: [...removed.values()], persistentKeys, maxRemainingTtlSeconds }
}
const invalid = (run, message) => ({ run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message }] })
export function applyRedisAction(run, action, lab) {
  const manifest = getProjectManifest(run.project.manifestId)
  if (lab?.capabilities?.dataRedis !== true || manifest.dataBackend !== 'redis' || lab.dataTarget?.kind !== 'redis') return invalid(run, 'Redis workloads require the declared capability and trusted Redis application.')
  if (!keysAre(action, 'type,scenarioId') || action.type !== 'data-cache' || typeof action.scenarioId !== 'string') return invalid(run, 'Redis workloads accept only a declared scenarioId.')
  const scenario = lab.scenarios?.[action.scenarioId]
  if (!validRedisScenario(scenario)) return invalid(run, 'The declared Redis scenario is invalid.')
  const task = lab.tasks.find(task => task.verification?.scenarioId === action.scenarioId && task.verification?.scenarioVersion === scenario.version)
  if (!task) return invalid(run, 'No Task verifies this Redis scenario.')
  const artifact = redisDeployedArtifact(run, scenario.target)
  const appSpec = artifact?.appSpec
  let sandbox = run.sandbox
  let nowMs = run.runtime.simTimeMs
  const initialStats = { ...databaseOf(sandbox, lab.dataTarget)?.stats }
  const measurements = { status: 200, total: 0, responseHits: 0, semanticHits: 0, originCalls: 0, hitRatio: 0,
    staleAnswers: 0, crossFilterAnswers: 0, expiredKeys: 0, persistentKeys: 0, rejectedWrites: 0, usedBytes: 0, maxAgeSeconds: 0,
    ageKnown: true, traceTruncated: false, displayTraceTruncated: false, provenanceValid: true, answersCorrect: true,
    calls: [], requests: [], values: [], estimate: REDIS_ESTIMATE_LABEL, artifactId: artifact?.id ?? null }
  if (!appSpec?.data?.redis) { measurements.status = 503; measurements.provenanceValid = false }
  for (const [stepIndex, step] of scenario.steps.entries()) {
    if (!appSpec?.data?.redis) break
    if (step.action === 'advance') { nowMs += step.seconds * 1000; continue }
    if (step.action === 'source-update') {
      sandbox = JSON.parse(JSON.stringify(sandbox))
      const database = databaseOf(sandbox, lab.dataTarget)
      if (database) database.sourceRevisions[step.product] = step.revision
      else measurements.status = 503
      continue
    }
    if (step.action === 'reset-cache') {
      const keys = Object.keys(databaseOf(sandbox, lab.dataTarget)?.keys ?? {}).filter(owned)
      if (keys.length) sandbox = executeRedis(sandbox, lab.dataTarget, 'DEL', keys, { nowMs }).sandbox
      continue
    }
    const beforeDatabase = databaseOf(sandbox, lab.dataTarget)
    const beforeKeys = beforeDatabase?.keys ?? {}
    const result = runDataFunction({ appSpec, sandbox, dataTarget: lab.dataTarget,
      functionName: manifest.routes[step.route], args: step.args, nowMs,
      scenarioState: { sourceRevisions: { ...beforeDatabase?.sourceRevisions } } })
    sandbox = result.sandbox
    const frame = result.redis
    const complete = !!frame && frame.traceTruncated !== true
    const calls = frame?.calls ?? []
    measurements.traceTruncated ||= !complete
    measurements.originCalls += frame?.originCalls ?? 0
    if (result.status !== 200) measurements.status = result.status
    const request = { stepIndex, route: step.route, args: step.args, atMs: nowMs, status: result.status, body: result.value,
      originCalls: frame?.originCalls ?? 0, responseHit: false, semanticHit: false, expectedAnswer: false, provenance: false,
      cacheEffects: cacheEffects(calls, beforeKeys, databaseOf(sandbox, lab.dataTarget)?.keys ?? {}, nowMs, complete) }
    if (step.route === 'POST /invalidate') request.provenance = complete && result.status === 200
    else {
      measurements.total++
      const [question, product, version, language] = step.args
      const expected = redisSourceAnswer({ product, version, language }, question, beforeDatabase?.sourceRevisions?.[product] ?? 1)
      request.expectedAnswer = expected !== null && result.status === 200 && same(result.value, expected)
      const reads = complete && !frame.originCalls ? acceptedReads(calls, result.value, beforeKeys, nowMs) : { gets: [], searches: [] }
      const hits = reads.gets.length ? reads.gets : reads.searches
      request.responseHit = result.status === 200 && reads.gets.length > 0
      request.semanticHit = result.status === 200 && !reads.gets.length && reads.searches.length > 0
      const sourceMatch = complete && frame.sourceCalls.some(call => call.result !== null && same(call.result, result.value) && same(call.args, step.args.slice(0, 4)))
      request.provenance = complete && result.status === 200 && (request.responseHit || request.semanticHit || sourceMatch)
      request.expectedAnswer &&= request.provenance
      measurements.responseHits += Number(request.responseHit)
      measurements.semanticHits += Number(request.semanticHit)
      measurements.answersCorrect &&= request.expectedAnswer
      if (result.value?.scope && !same(result.value.scope, { product, version, language })) measurements.crossFilterAnswers++
      if (expected && result.value?.sourceRevision !== undefined && result.value.sourceRevision < expected.sourceRevision) measurements.staleAnswers++
      for (const { writtenAtMs } of hits) {
        if (!Number.isFinite(writtenAtMs) || writtenAtMs > nowMs) measurements.ageKnown = false
        else measurements.maxAgeSeconds = Math.max(measurements.maxAgeSeconds, (nowMs - writtenAtMs) / 1000)
      }
    }
    measurements.provenanceValid &&= request.provenance
    measurements.requests.push(request)
    measurements.values.push(result.value)
    // Counts above use every complete frame. Only presentation trace is capped.
    const available = Math.max(0, 256 - measurements.calls.length)
    measurements.calls.push(...calls.slice(0, available).map(call => ({ ...call, stepIndex, atMs: nowMs })))
    measurements.displayTraceTruncated ||= calls.length > available
  }
  // Purge at the final simulated time so expiry-only steps have real measurements.
  const info = executeRedis(sandbox, lab.dataTarget, 'INFO', ['memory'], { nowMs })
  sandbox = info.sandbox
  const database = databaseOf(sandbox, lab.dataTarget)
  if (database) {
    Object.assign(measurements, redisMemory(database, nowMs))
    measurements.expiredKeys = database.stats.expiredKeys - (initialStats.expiredKeys ?? 0)
    measurements.rejectedWrites = database.stats.rejectedWrites - (initialStats.rejectedWrites ?? 0)
  } else { measurements.status = 503; measurements.provenanceValid = false }
  if (!measurements.ageKnown) measurements.maxAgeSeconds = null
  measurements.hitRatio = measurements.total ? (measurements.responseHits + measurements.semanticHits) / measurements.total : 0
  const completed = measurements.status === 200 && !measurements.traceTruncated
  // This scenario may change its own source dependencies. Capture their final
  // generations before recording new evidence; historical records stay intact.
  const advanced = refreshKubernetesDependencies(run, { ...run, sandbox, runtime: { ...run.runtime, simTimeMs: nowMs } }, lab)
  const next = recordVerification(advanced, lab, task.id, {
    scenarioId: action.scenarioId, scenarioVersion: scenario.version, outcome: completed ? 'passed' : 'failed', completed,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: nowMs, measurements,
  })
  return { run: next, lines: [{ kind: completed ? 'out' : 'err', text: `Redis workload ${action.scenarioId}: HTTP ${measurements.status}. ${REDIS_ESTIMATE_LABEL}`, status: measurements.status, measurements }], portalEvents: [], diagnostics: [] }
}
