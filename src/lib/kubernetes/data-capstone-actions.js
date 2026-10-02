import { runDataFunction } from '../data/runtime.js'
import { acceptedReads, cacheEffects } from '../data/cache-evidence.js'
import { simulateCapstoneLoad } from '../data/capstone-load.js'
import { CHANGE_FEED_HOOK, readChangeFeed, recordChange } from '../data/change-feed.js'
import { findContainer, readItem, upsertItem } from '../data/cosmos-store.js'
import { loadCorpus } from '../data/pg-engine.js'
import { getDeploymentPods, restartDeploymentResult } from './reconcile.js'
import { pgDeployedArtifact } from '../../data/labs/data-journey/postgres-helpers.js'
import { getProjectManifest } from '../project/manifests.js'
import { recordVerification, canonicalize } from '../labEngine/evidence.js'
import { refreshKubernetesDependencies } from './evidence.js'
import { isPlainObject, isJsonValue } from '../labEngine/run.js'
import { DATA_CAPSTONE_ROUTES, DATA_CAPSTONE_ROUTE_ARGS } from '../../data/templates/data-python/capstone.js'
import { CAPSTONE_REVISION_2, capstoneCorpusRevision, capstoneExpectedAnswer } from '../../data/fixtures/data/capstone.js'

const clone = value => structuredClone(value)
const same = (a, b) => a !== undefined && b !== undefined && canonicalize(a) === canonicalize(b)
const keysAre = (value, keys) => isPlainObject(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',')
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 8192
const products = Object.keys(CAPSTONE_REVISION_2)
const scopeValid = args => products.includes(args[1]) && ['v1', 'v2'].includes(args[2]) && ['en', 'de'].includes(args[3])
const targetValid = (target, service) => keysAre(target, service ? 'clusterId,namespace,serviceName,deploymentName' : 'clusterId,namespace,deploymentName') && Object.values(target).every(text)
function validRequest(step) {
  if (!keysAre(step, 'action,route,args') || !Object.hasOwn(DATA_CAPSTONE_ROUTE_ARGS, step.route) || step.route.startsWith('worker:')
    || !Array.isArray(step.args) || !isJsonValue(step.args) || JSON.stringify(step.args).length > 32768 || step.args.length !== DATA_CAPSTONE_ROUTE_ARGS[step.route].length) return false
  const args = step.args
  if (step.route === 'GET /sessions') return args.every(text)
  if (step.route === 'POST /feedback') return text(args[0]) && products.includes(args[1]) && typeof args[2] === 'boolean'
  return text(args[0]) && scopeValid(args) && (step.route !== 'GET /answer' || text(args[4]) && text(args[5]))
}
export function validDataCapstoneScenario(scenario, lab) {
  if (!keysAre(scenario, 'kind,version,stageId,mode,steps') || scenario.kind !== 'data-capstone' || scenario.version !== 1
    || !text(scenario.stageId) || !lab.stages?.some(stage => stage.id === scenario.stageId)
    || !['request', 'worker', 'load', 'inspect', 'incident', 'cleanup'].includes(scenario.mode)
    || !Array.isArray(scenario.steps) || scenario.steps.length < 1 || scenario.steps.length > 64) return false
  return scenario.steps.every(step => {
    if (!isPlainObject(step)) return false
    if (step.action === 'request') return validRequest(step)
    if (['worker-batch', 'worker-restart', 'worker-redeliver', 'inspect'].includes(step.action)) return keysAre(step, 'action')
    if (step.action === 'advance') return keysAre(step, 'action,seconds') && Number.isInteger(step.seconds) && step.seconds >= 1 && step.seconds <= 300
    if (step.action === 'load') return keysAre(step, 'action,requestsPerSecond,seconds') && step.requestsPerSecond === 200 && step.seconds === 5
    if (step.action === 'corpus-update') return keysAre(step, 'action,product,revision,eventId') && products.includes(step.product) && step.revision === 2 && text(step.eventId)
    return step.action === 'incident-start' && keysAre(step, 'action,incidentId') && text(step.incidentId)
  })
}
const redisDb = (run, lab) => run.sandbox.redisClusters?.find(item => item.resourceGroup === lab.dataTarget.redis.resourceGroup && item.name === lab.dataTarget.redis.cluster)?.database
const pgDb = (run, lab) => run.sandbox.postgresServers?.find(item => item.resourceGroup === lab.dataTarget.postgres.resourceGroup && item.name === lab.dataTarget.postgres.server)?.databases?.find(item => item.name === lab.dataTarget.postgres.database)
const continuation = (run, lab) => readItem(run.sandbox, { ...lab.dataTarget.cosmos, container: 'leases' }, 'feedback-worker', 'feedback-worker')?.continuation ?? null
function workerArtifact(run, target) {
  const pod = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
    .filter(item => item.metadata.deletionTimestamp === undefined && item.status?.phase === 'Running' && item.status.conditions?.some(c => c.type === 'Ready' && c.status === 'True'))
    .sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid))[0]
  const id = pod && run.runtime.kubernetes.clusters[target.clusterId].podSnapshots[pod.metadata.uid]?.artifactId
  return { podUid: pod?.metadata.uid ?? null, artifact: id ? run.artifacts.buildsById[id] : null }
}
// Inspect only captured SDK IR. No saved-source search and no PG open for a
// cache-only wave. Unrecognized connect shapes fail closed when origin exists.
function connectionConfig(appSpec) {
  const globals = appSpec?.data?.composite?.globals ?? {}
  const body = appSpec?.data?.functions?.connect?.body
  if (!body || body.length !== 1 || body[0].op !== 'return') return null
  const call = body[0].value
  const literal = expr => expr?.kind === 'literal' ? expr.value : expr?.kind === 'name' && globals[expr.name]?.kind === 'literal' ? globals[expr.name].value : undefined
  let poolMaxSize = 0
  let dsn
  if (call?.call === 'postgres.module.connect') dsn = literal(call.args.conninfo)
  else if (call?.call === 'postgres.pool.connection') {
    const pool = globals[call.target?.name ?? call.receiver]
    if (pool?.call !== 'postgres.pool.ConnectionPool' || pool.lifetime !== 'module') return null
    poolMaxSize = literal(pool.args.max_size)
    dsn = literal(pool.args.conninfo)
    if (!Number.isInteger(poolMaxSize) || poolMaxSize < 1) return null
  } else return null
  if (typeof dsn !== 'string') return null
  const ports = [...dsn.matchAll(/(?:^|\s)port\s*=\s*(?:'(\d+)'|(\d+))(?=\s|$)/g)]
  if (ports.length !== 1 || ![5432, 6432].includes(Number(ports[0][1] ?? ports[0][2]))) return null
  return { mode: Number(ports[0][1] ?? ports[0][2]) === 6432 ? 'pgbouncer' : poolMaxSize ? 'pool' : 'per-request', poolMaxSize }
}
function frame(run, lab, artifact, route, args) {
  if (!artifact?.appSpec?.data?.composite) return { result: { status: 503, sandbox: run.sandbox, value: null, calls: [], error: { code: 'ServiceUnavailable', message: 'No ready captured composite application.' } }, facts: null }
  const beforeKeys = clone(redisDb(run, lab)?.keys ?? {})
  const result = runDataFunction({ appSpec: artifact.appSpec, sandbox: run.sandbox, dataTarget: lab.dataTarget, functionName: DATA_CAPSTONE_ROUTES[route], args, nowMs: run.runtime.simTimeMs, changeFeed: CHANGE_FEED_HOOK, scenarioState: { writesThisRequest: new Set() } })
  const next = { ...run, sandbox: result.sandbox }
  const redisCalls = result.redis?.calls ?? []
  const complete = !!result.redis && !result.redis.traceTruncated && !result.trainingTraceTruncated
  const pgCalls = result.calls.filter(call => typeof call.sql === 'string')
  const cosmosCalls = result.calls.filter(call => call.call?.startsWith('cosmos.'))
  const reads = complete ? acceptedReads(redisCalls, result.redis.returnProvenance, result.value, beforeKeys, run.runtime.simTimeMs) : { gets: [], searches: [] }
  const origin = result.returnDataProvenance?.children?.answer?.origin ?? result.redis?.returnProvenance
  const sourceCall = origin?.kind === 'postgres' ? result.calls[origin.callIndex] : null
  const sourceIds = Array.isArray(result.value?.sources) ? result.value.sources : []
  const scope = { product: args[1] ?? null, version: args[2] ?? null, language: args[3] ?? null }
  const rows = sourceCall?.rows ?? []
  const sourceValid = complete && rows.length > 0 && rows.every(row => same({ product: row.product, version: row.version, language: row.language }, scope))
    && sourceIds.length > 0 && sourceIds.every(id => rows.some(row => row.id === id))
    && sourceIds.every((_, index) => {
      const field = result.returnDataProvenance?.children?.sources?.children?.[index]?.origin
      return field?.kind === 'postgres' && field.callIndex === origin.callIndex
    })
    && result.trainingCalls?.some(call => call.functionName === 'training_answer' && call.result === result.value?.answer && same(call.args[1]?.sources, sourceIds)
      && call.args[1]?.passages === sourceIds.map(id => rows.find(row => row.id === id).content).join('\n\n'))
  const returnedFrom = reads.gets.length ? 'response-cache' : reads.searches.length ? 'semantic-cache' : sourceValid ? 'postgres' : null
  const patch = CAPSTONE_REVISION_2[scope.product]
  const database = pgDb(next, lab)
  const revised = patch?.chunks.every(row => database?.tables.find(table => table.name === 'chunks')?.rows.some(live => live.id === row.id && live.content === row.content))
  const expectedAnswer = route === 'GET /answer' && same(result.value, capstoneExpectedAnswer(args[0], scope, revised ? 2 : 1))
  const historyWrites = route === 'GET /answer' ? ['sessions', 'qa_history'].filter(container => {
    if (!cosmosCalls.some(call => !call.error && call.call === 'cosmos.container.upsert_item' && call.container === container)) return false
    const item = readItem(result.sandbox, { ...lab.dataTarget.cosmos, container }, container === 'sessions' ? args[5] : `${args[4]}:${args[5]}`, container === 'sessions' ? args[4] : args[1])
    return item && same({ product: item.product, version: item.version, language: item.language }, scope)
      && item.sessionId === args[4] && item.answer === result.value?.answer && same(item.sources, result.value?.sources)
  }).length : 0
  const facts = { status: result.status, body: result.value, artifactId: artifact.id, returnedFrom, sourceIds, scope, pgCalls, cosmosCalls, redisCalls,
    trainingCalls: result.trainingCalls ?? [], expectedAnswer, historyWrites,
    originRequests: Number(pgCalls.some(call => !call.error && /^\s*SELECT\b/i.test(call.sql))), traceComplete: complete,
    cacheEffects: cacheEffects(redisCalls, beforeKeys, redisDb(next, lab)?.keys ?? {}, run.runtime.simTimeMs, complete) }
  return { result, facts }
}
function recordFrame(measurements, observation, route, args, stepIndex) {
  const { result, facts } = observation
  if (result.status !== 200) { measurements.status = result.status; measurements.error = result.error ?? null }
  if (!facts) { measurements.traceComplete = false; measurements.provenanceValid = false; return }
  measurements.traceComplete &&= facts.traceComplete && facts.cacheEffects.complete
  measurements.totalCharge += result.totalCharge ?? 0
  measurements.requests.push({ ...facts, route, args: clone(args), stepIndex })
  if (!measurements.artifactIds.includes(facts.artifactId)) measurements.artifactIds.push(facts.artifactId)
  measurements.historyWrites += facts.historyWrites
  if (route === 'GET /answer') {
    measurements.responseHits += Number(facts.returnedFrom === 'response-cache')
    measurements.semanticHits += Number(facts.returnedFrom === 'semantic-cache')
    measurements.ragMisses += facts.originRequests
    measurements.provenanceValid &&= facts.status === 200 && facts.returnedFrom !== null
    measurements.answersCorrect &&= facts.expectedAnswer && facts.returnedFrom !== null
    measurements.staleAnswers += Number(!facts.expectedAnswer && facts.returnedFrom?.endsWith('cache') === true)
    measurements.scopeCorrect &&= same(facts.scope, { product: facts.body?.product ?? null, version: facts.body?.version ?? null, language: facts.body?.language ?? null })
  }
  const available = Math.max(0, 256 - measurements.calls.length)
  const calls = [...result.calls, ...facts.redisCalls]
  measurements.calls.push(...calls.slice(0, available).map(call => ({ ...call, stepIndex })))
  measurements.displayTraceTruncated ||= calls.length > available
}
function corpusUpdate(run, lab, step) {
  const database = pgDb(run, lab)
  const ref = { ...lab.dataTarget.cosmos, container: 'events' }
  if (!database || !findContainer(run.sandbox, ref)) throw new Error('Corpus administration requires the existing PG schema and events container.')
  const tables = Object.fromEntries(['documents', 'chunks'].map(name => [name, database.tables?.find(table => table.name === name)]))
  if (!tables.documents || !tables.chunks) throw new Error('Corpus administration requires documents and chunks.')
  const corpus = { documents: clone(tables.documents.rows), chunks: clone(tables.chunks.rows), logicalRows: Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, table.logicalRows])) }
  const alreadyApplied = ['documents', 'chunks'].every(name => CAPSTONE_REVISION_2[step.product][name].every(patch => same(corpus[name].find(row => row.id === patch.id), patch)))
  let sandbox = alreadyApplied ? run.sandbox : loadCorpus(run.sandbox, { ...lab.dataTarget.postgres, corpus: capstoneCorpusRevision(corpus, step.product), nowMs: run.runtime.simTimeMs }).sandbox
  // Stable business identity survives retries with a different authored label.
  const existing = findContainer(sandbox, ref).items.find(item => item.product === step.product && item.type === 'document-update' && item.revision === 2)
  if (!existing) {
    const collision = readItem(sandbox, ref, step.eventId, step.product)
    if (collision) throw new Error('The document-update event ID is already used.')
    const written = upsertItem(sandbox, ref, { id: step.eventId, type: 'document-update', product: step.product, revision: 2 }, { nowMs: run.runtime.simTimeMs })
    sandbox = recordChange(written.sandbox, ref, written.item)
  }
  return { ...run, sandbox }
}
export function runCapstoneSteps(input, lab, scenario) {
  let run = clone(input)
  const before = continuation(run, lab)
  run.runtime.dataCapstone ??= { version: 1, incident: null, worker: { lastBatch: [], artifactId: null } }
  const measurements = { status: 200, answersCorrect: true, scopeCorrect: true, provenanceValid: true, responseHits: 0, semanticHits: 0, ragMisses: 0, staleAnswers: 0, traceComplete: true,
    requests: [], calls: [], totalCharge: 0, historyWrites: 0, displayTraceTruncated: false, artifactIds: [], worker: { before, after: before, handledEventIds: [], invalidatedKeys: [], restarts: [] }, load: null, inventory: null,
    estimate: 'Simulated estimate — not an Azure guarantee.' }
  let representative = []
  for (const [stepIndex, step] of scenario.steps.entries()) {
    if (measurements.status !== 200) break
    if (step.action === 'advance') { run.runtime.simTimeMs += step.seconds * 1000; continue }
    if (step.action === 'corpus-update') {
      try { run = corpusUpdate(run, lab, step) }
      catch (error) { measurements.status = 400; measurements.error = { code: 'INVALID_DATA_ACTION', message: error.message } }
      continue
    }
    if (step.action === 'inspect') { measurements.inventory = clone({ postgres: run.sandbox.postgresServers ?? [], cosmos: run.sandbox.cosmosAccounts ?? [], redis: run.sandbox.redisClusters ?? [] }); continue }
    if (step.action === 'incident-start') { measurements.status = 400; measurements.error = { code: 'INVALID_DATA_ACTION', message: 'Incident transitions require the incident adapter.' }; continue }
    if (step.action === 'worker-restart') {
      const previous = workerArtifact(run, lab.dataWorkerTarget)
      const restarted = restartDeploymentResult(run, lab.dataWorkerTarget.clusterId, lab.dataWorkerTarget.namespace, lab.dataWorkerTarget.deploymentName, lab)
      const replacement = workerArtifact(restarted.run, lab.dataWorkerTarget)
      if (restarted.diagnostics.length || !replacement.artifact || replacement.podUid === previous.podUid) { measurements.status = 503; continue }
      run = restarted.run
      run.runtime.dataCapstone.worker = { lastBatch: [], artifactId: replacement.artifact.id }
      measurements.worker.restarts.push({ beforePodUid: previous.podUid, afterPodUid: replacement.podUid, artifactId: replacement.artifact.id })
      continue
    }
    if (step.action === 'load') {
      const requests = representative.length ? representative : lab.dataLoadRequest?.route === 'GET /answer' && validRequest({ action: 'request', ...lab.dataLoadRequest }) ? [{ action: 'request', ...lab.dataLoadRequest }] : []
      if (!requests.length) { measurements.status = 400; measurements.error = { code: 'INVALID_DATA_ACTION', message: 'Load requires a trusted representative answer request.' }; continue }
      const artifact = pgDeployedArtifact(run, lab.dataRequestTarget)
      const snapshot = clone(run)
      let misses = 0
      const observations = requests.map(request => frame(snapshot, lab, artifact, request.route, request.args))
      // Each concurrent representative sees the same pre-wave cache. Commit
      // one deterministic wave's effects afterward without warming its peers.
      for (const [index, observation] of observations.entries()) {
        misses += observation.facts?.originRequests ?? 0
        recordFrame(measurements, observation, requests[index].route, requests[index].args, stepIndex)
      }
      if (measurements.status !== 200 || !measurements.traceComplete) continue
      for (const request of requests) run.sandbox = frame(run, lab, artifact, request.route, request.args).result.sandbox
      const config = connectionConfig(artifact?.appSpec)
      const connectionsMatch = observations.every(observation => (observation.facts?.pgCalls ?? []).every(call => {
        const mode = call.connection === 'bouncer' ? 'pgbouncer' : call.connection === 'pooled' ? 'pool' : 'per-request'
        return mode === config?.mode && (call.poolMaxSize ?? 0) === config?.poolMaxSize
      }))
      const replicas = run.runtime.kubernetes.clusters[lab.dataRequestTarget.clusterId]?.resources[`Deployment/${lab.dataRequestTarget.namespace}/${lab.dataRequestTarget.deploymentName}`]?.spec.replicas
      const server = run.sandbox.postgresServers?.find(item => item.name === lab.dataTarget.postgres.server && item.resourceGroup === lab.dataTarget.postgres.resourceGroup)
      const originRequests = Math.round(step.requestsPerSecond * step.seconds * misses / requests.length)
      measurements.load = { ...simulateCapstoneLoad({ ...step, originRequests, replicas, ...(connectionsMatch ? config : {}), server }), mode: config?.mode ?? null, poolMaxSize: config?.poolMaxSize ?? null, replicas }
      run.runtime.simTimeMs += step.seconds * 1000
      if (measurements.load.failed || measurements.load.errors.length) measurements.status = 503
      continue
    }
    const worker = step.action !== 'request'
    const artifact = worker ? workerArtifact(run, lab.dataWorkerTarget).artifact : pgDeployedArtifact(run, lab.dataRequestTarget)
    const requests = step.action === 'worker-redeliver' ? run.runtime.dataCapstone.worker.lastBatch.map(item => ({ route: 'worker:item', args: [item] }))
      : [{ route: worker ? 'worker:batch' : step.route, args: worker ? [] : step.args }]
    const batch = step.action === 'worker-batch' ? readChangeFeed(findContainer(run.sandbox, { ...lab.dataTarget.cosmos, container: 'events' }), { continuation: continuation(run, lab), startTime: 'Beginning' }) : null
    for (const request of requests) {
      const observation = frame(run, lab, artifact, request.route, request.args)
      recordFrame(measurements, observation, request.route, request.args, stepIndex)
      run.sandbox = observation.result.sandbox
      if (request.route === 'GET /answer') {
        representative.push({ action: 'request', ...request })
      }
      if (worker) {
        const removed = observation.facts?.cacheEffects.removedKeys.filter(item => item.command === 'DEL') ?? []
        for (const item of removed) if (!measurements.worker.invalidatedKeys.some(old => old.key === item.key)) measurements.worker.invalidatedKeys.push(item)
      }
      if (measurements.status !== 200) break
    }
    if (batch && measurements.status === 200 && measurements.traceComplete && continuation(run, lab) === batch.continuation) {
      run.runtime.dataCapstone.worker = { lastBatch: clone(batch.items), artifactId: artifact?.id ?? null }
      const patterns = measurements.requests.at(-1)?.cacheEffects.scanPatterns ?? []
      for (const item of batch.items) {
        const observed = item.type === 'positive-feedback' || ['negative-feedback', 'document-update'].includes(item.type) && ['ka:answer:', 'ka:sem:'].every(prefix => patterns.includes(`${prefix}${item.product}:*`))
        if (observed && !measurements.worker.handledEventIds.includes(item.id)) measurements.worker.handledEventIds.push(item.id)
      }
    }
  }
  measurements.worker.after = continuation(run, lab)
  measurements.totalCharge = Math.round(measurements.totalCharge * 100) / 100
  return { run, measurements }
}
const invalid = (run, message) => ({ run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message }] })
export function applyDataCapstoneAction(run, action, lab) {
  const manifest = getProjectManifest(run.project.manifestId)
  if (lab.capabilities?.dataCapstone !== true || manifest.dataBackend !== 'composite' || !same(manifest.dataTarget, lab.dataTarget)
    || !targetValid(lab.dataRequestTarget, true) || !targetValid(lab.dataWorkerTarget, false)) return invalid(run, 'Capstone workloads require the declared capability, composite target and trusted Pod targets.')
  if (!keysAre(action, 'type,scenarioId') || action.type !== 'data-capstone' || !text(action.scenarioId)) return invalid(run, 'Capstone workloads accept only a declared scenarioId.')
  const scenario = lab.scenarios?.[action.scenarioId]
  if (!validDataCapstoneScenario(scenario, lab) || scenario.stageId !== run.stages?.activeStageId) return invalid(run, 'The declared scenario must match the active stage.')
  const task = lab.tasks.find(item => item.verification?.scenarioId === action.scenarioId && item.verification.scenarioVersion === scenario.version && lab.stages.find(stage => stage.id === scenario.stageId)?.taskIds?.includes(item.id))
  if (!task) return invalid(run, 'No active Task verifies this scenario version.')
  const outcome = runCapstoneSteps(run, lab, scenario)
  const knownFault = ['ConnectionError', 'TooManyRequests'].includes(outcome.measurements.error?.code) || outcome.measurements.load?.errors.some(error => error.includes('too many clients already'))
  const completed = outcome.measurements.traceComplete && (outcome.measurements.status === 200 || scenario.mode === 'incident' && knownFault === true)
  const refreshed = refreshKubernetesDependencies(run, outcome.run, lab)
  const next = recordVerification(refreshed, lab, task.id, { scenarioId: action.scenarioId, scenarioVersion: scenario.version, outcome: completed ? 'passed' : 'failed', completed, startedAtMs: run.runtime.simTimeMs, endedAtMs: outcome.run.runtime.simTimeMs, measurements: outcome.measurements })
  return { run: next, lines: [{ kind: completed ? 'out' : 'err', text: `Data capstone ${action.scenarioId}: HTTP ${outcome.measurements.status}. ${outcome.measurements.estimate}`, status: outcome.measurements.status, measurements: outcome.measurements }], portalEvents: [], diagnostics: [] }
}
