// Data journey <-> AKS pipeline bridge (Task 7): the `data-request` /
// `data-worker` analog of `../kubernetes/actions.js`'s `aks-request` handler.
// It finds the running assistant-api (Service-routed) or feedback-worker
// (Deployment-routed) Pod's captured appSpec exactly the way requests.js
// finds the integration appSpec, then runs each scenario step through
// runDataFunction (runtime.js), aggregating measurements for recordVerification.
//
// Scenario shapes (declared by Labs, Task 8+):
//   { kind: 'data-request', version: 1, target: { clusterId, namespace, serviceName, deploymentName },
//     steps: [{ route, args }] }
//   { kind: 'data-worker', version: 1, target: { clusterId, namespace, deploymentName },
//     steps: [{ action: 'post', route, args } | { action: 'batch' } | { action: 'restart' } | { action: 'redeliver' }] }
// `route` for a 'data-request' step (and a 'post' step's inner write target)
// is looked up against the shared manifest: `manifest.routes[route]` for
// function dispatch, or directly as a container name for a raw 'post' write.
import { runDataFunction } from '../data/runtime.js'
import { CHANGE_FEED_HOOK, readChangeFeed, recordChange } from '../data/change-feed.js'
import { findContainer, upsertItem, readItem } from '../data/cosmos-store.js'
import { getDeploymentPods } from './reconcile.js'
import { getProjectManifest } from '../project/manifests.js'
import { recordVerification } from '../labEngine/evidence.js'
import { isJsonValue, isPlainObject } from '../labEngine/run.js'
import { simulatePoolLoad } from '../data/pg-pool.js'
import { pgDsnPort, pgDeployedArtifact } from '../../data/labs/data-journey/postgres-helpers.js'

const round2 = (n) => Math.round(n * 100) / 100
const NO_READY_ENDPOINTS = Object.freeze({ error: 'ServiceUnavailable' })

function readyPods(run, clusterId, namespace, deploymentName) {
  return getDeploymentPods(run, clusterId, namespace, deploymentName)
    .filter((pod) => pod.status?.phase === 'Running' && pod.status?.conditions?.some((condition) => condition.type === 'Ready' && condition.status === 'True'))
}

function podAppSpec(run, clusterId, pod) {
  const snapshot = run.runtime.kubernetes?.clusters?.[clusterId]?.podSnapshots?.[pod.metadata.uid]
  const artifact = snapshot && run.artifacts.buildsById[snapshot.artifactId]
  return artifact?.appSpec?.data ? artifact.appSpec : null
}

// Mirrors requests.js's Service-selector Pod lookup for the `assistant-api`
// Deployment (kind: 'data-request' scenarios are routed through a Service).
function findServiceAppSpec(run, target) {
  const artifact = pgDeployedArtifact(run, target)
  return artifact?.appSpec?.data ? artifact.appSpec : null
}

// `feedback-worker` has no Service (see COSMOS_MANIFEST's k8s files); its
// Pods are found directly from the Deployment (kind: 'data-worker' scenarios).
function findDeploymentAppSpec(run, target) {
  const pod = readyPods(run, target.clusterId, target.namespace, target.deploymentName)
    .sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid))[0]
  return pod ? podAppSpec(run, target.clusterId, pod) : null
}

function validTarget(target, requireService) {
  if (!isPlainObject(target)) return false
  const keys = requireService ? ['clusterId', 'deploymentName', 'namespace', 'serviceName'] : ['clusterId', 'deploymentName', 'namespace']
  return Object.keys(target).sort().join(',') === keys.slice().sort().join(',') && keys.every((key) => typeof target[key] === 'string' && target[key])
}

function validRequestStep(step) {
  return isPlainObject(step) && Object.keys(step).sort().join(',') === 'args,route' && typeof step.route === 'string' && step.route
    && Array.isArray(step.args) && isJsonValue(step.args)
}

function validWorkerStep(step) {
  if (!isPlainObject(step) || typeof step.action !== 'string') return false
  if (step.action === 'post') {
    return Object.keys(step).sort().join(',') === 'action,args,route' && typeof step.route === 'string' && step.route
      && isPlainObject(step.args) && isJsonValue(step.args)
  }
  return ['batch', 'restart', 'redeliver'].includes(step.action) && Object.keys(step).join(',') === 'action'
}

export function validDataScenario(scenario, expectedKind) {
  if (!isPlainObject(scenario) || scenario.kind !== expectedKind || scenario.version !== 1) return false
  if (!validTarget(scenario.target, expectedKind !== 'data-worker')) return false
  if (expectedKind === 'data-load') {
    const expected = Object.hasOwn(scenario, 'expectedError')
    return Object.keys(scenario).sort().join(',') === (expected ? 'args,expectedError,kind,replicas,requestsPerSecond,route,seconds,target,version' : 'args,kind,replicas,requestsPerSecond,route,seconds,target,version')
      && (!expected || scenario.expectedError === 'too many clients already')
      && scenario.replicas === 'deployment' && typeof scenario.route === 'string' && !!scenario.route
      && Array.isArray(scenario.args) && isJsonValue(scenario.args)
      && Number.isFinite(scenario.requestsPerSecond) && scenario.requestsPerSecond >= 0
      && Number.isFinite(scenario.seconds) && scenario.seconds > 0
  }
  if (!Array.isArray(scenario.steps) || !scenario.steps.length) return false
  return scenario.steps.every(expectedKind === 'data-request' ? validRequestStep : validWorkerStep)
}

function runRequestSteps(run, lab, manifest, target, steps) {
  const appSpec = findServiceAppSpec(run, target)
  if (!appSpec) return { sandbox: run.sandbox, status: 503, value: NO_READY_ENDPOINTS, values: [], calls: [], totalCharge: 0, stale: false }
  const { account, database } = lab.dataTarget
  const nowMs = run.runtime.simTimeMs
  const scenarioState = { writesThisRequest: new Set() }
  let sandbox = run.sandbox
  let status = 200
  let value = null
  let error = null
  // Every step's own return value, in order (Task 9 review: a multi-step
  // scenario's `value` only ever keeps the LAST step's result, so a Task
  // whose check needs more than one step's result - e.g. 'similar', which
  // runs a paraphrase query and a near-miss query in the same scenario -
  // reads this array instead). Additive: existing Tasks keep reading `value`.
  const values = []
  let calls = []
  const trainingCalls = []
  let trainingTraceTruncated = false
  let stale = false
  for (const step of steps) {
    if (status !== 200) break
    const route = manifest.routes[step.route]
    const functionName = typeof route === 'string' ? route : route?.functionName ?? route?.function
    const result = runDataFunction({ appSpec, sandbox, account, database, ...(lab.capabilities?.dataPostgres ? { dataTarget: lab.dataTarget } : {}), functionName, args: step.args, nowMs, scenarioState, changeFeed: CHANGE_FEED_HOOK })
    sandbox = result.sandbox
    calls = calls.concat(lab.capabilities?.dataPostgres
      ? result.calls.map(call => typeof call.sql === 'string' ? { ...call, stepIndex: values.length } : call)
      : result.calls)
    if (lab.capabilities?.dataPostgres) {
      // Step index binds detached request-local training inputs/results to the
      // corresponding actual response in measurements.values.
      trainingCalls.push(...(result.trainingCalls ?? []).map(call => ({ ...call, stepIndex: values.length })))
      trainingTraceTruncated ||= result.trainingTraceTruncated === true
    }
    value = result.value
    values.push(result.value)
    status = result.status
    if (lab.capabilities?.dataPostgres && result.error) error = result.error
    if (result.calls.some((call) => call.stale)) stale = true
  }
  return { sandbox, status, value, values, calls, totalCharge: round2(calls.reduce((sum, call) => sum + (call.charge ?? 0), 0)), stale,
    ...(lab.capabilities?.dataPostgres ? { trainingCalls, trainingTraceTruncated } : {}), ...(error ? { error } : {}) }
}

function runWorkerSteps(run, lab, manifest, target, steps) {
  const appSpec = findDeploymentAppSpec(run, target)
  if (!appSpec) return { sandbox: run.sandbox, status: 503, value: NO_READY_ENDPOINTS, values: [], calls: [], totalCharge: 0, stale: false }
  const { account, database } = lab.dataTarget
  const nowMs = run.runtime.simTimeMs
  const scenarioState = { writesThisRequest: new Set() }
  let sandbox = run.sandbox
  let status = 200
  let value = null
  // See runRequestSteps' `values`: every value-producing step's own result,
  // in order ('restart' produces none).
  const values = []
  let calls = []
  let stale = false
  // The continuation the worker holds in memory between batches in this same
  // Pod lifetime (Task 7 brief): here, the last batch's own items, so a
  // following 'redeliver' step can replay them. `restart` clears it; it is
  // never persisted to the Sandbox, so it never survives past this call.
  let lastBatchItems = []
  for (const step of steps) {
    if (status !== 200) break
    if (step.action === 'restart') { lastBatchItems = []; continue }
    if (step.action === 'post') {
      const ref = { account, database, container: step.route }
      if (!findContainer(sandbox, ref)) { status = 404; value = { error: `Resource Not Found (container '${step.route}')` }; break }
      const written = upsertItem(sandbox, ref, step.args, { nowMs })
      sandbox = recordChange(written.sandbox, ref, written.item)
      value = Object.fromEntries(Object.entries(written.item).filter(([key]) => !key.startsWith('_')))
      values.push(value)
      continue
    }
    if (step.action === 'batch') {
      const leasesRef = { account, database, container: 'leases' }
      const feedbackRef = { account, database, container: 'feedback' }
      const beforeLease = readItem(sandbox, leasesRef, 'feedback-worker', 'feedback-worker')
      const beforeContinuation = typeof beforeLease?.continuation === 'string' ? beforeLease.continuation : null
      const result = runDataFunction({ appSpec, sandbox, account, database, functionName: manifest.routes['worker:batch'], args: [], nowMs, scenarioState, changeFeed: CHANGE_FEED_HOOK })
      sandbox = result.sandbox
      calls = calls.concat(result.calls)
      value = result.value
      values.push(value)
      status = result.status
      if (result.calls.some((call) => call.stale)) stale = true
      const feedbackContainer = findContainer(sandbox, feedbackRef)
      lastBatchItems = feedbackContainer
        ? readChangeFeed(feedbackContainer, beforeContinuation ? { continuation: beforeContinuation } : { startTime: 'Beginning' }).items
        : []
      continue
    }
    if (step.action === 'redeliver') {
      for (const item of lastBatchItems) {
        const result = runDataFunction({ appSpec, sandbox, account, database, functionName: 'apply_feedback', args: [item], nowMs, scenarioState, changeFeed: CHANGE_FEED_HOOK })
        sandbox = result.sandbox
        calls = calls.concat(result.calls)
        value = result.value
        values.push(value)
        status = result.status
        if (status !== 200) break
      }
    }
  }
  return { sandbox, status, value, values, calls, totalCharge: round2(calls.reduce((sum, call) => sum + (call.charge ?? 0), 0)), stale }
}

function runLoad(run, lab, manifest, scenario) {
  const request = runRequestSteps(run, lab, manifest, scenario.target, [{ route: scenario.route, args: scenario.args }])
  const appSpec = findServiceAppSpec(run, scenario.target)
  const sqlCalls = request.calls.filter(call => typeof call.sql === 'string')
  const connections = [...new Set(sqlCalls.map(call => call.connection))]
  const port = pgDsnPort(appSpec)
  const mode = connections.length === 1
    ? connections[0] === 'bouncer' && port === 6432 ? 'pgbouncer'
      : connections[0] === 'pooled' && port === 5432 ? 'pool'
        : connections[0] === 'new' && port === 5432 ? 'per-request' : null
    : null
  // Only the pool used by actual SQL can vouch for reusable app clients.
  // Direct PgBouncer SQL has no app pool, even if an unused global exists.
  const usedMaximum = sqlCalls[0]?.poolMaxSize
  const usedPool = sqlCalls[0]?.poolIdentity
  const usesModulePool = Number.isInteger(usedMaximum) && usedMaximum > 0
    && Number.isInteger(usedPool) && usedPool > 0
    && sqlCalls.every(call => call.poolLifetime === 'module' && call.poolMaxSize === usedMaximum && call.poolIdentity === usedPool)
  const usesDirectClients = sqlCalls.every(call => call.poolLifetime === null && call.poolMaxSize === null && call.poolIdentity === null)
  const poolMaxSize = usesModulePool ? usedMaximum : usesDirectClients ? 0 : null
  const deployment = run.runtime.kubernetes?.clusters?.[scenario.target.clusterId]?.resources?.[`Deployment/${scenario.target.namespace}/${scenario.target.deploymentName}`]
  const replicas = deployment?.spec?.replicas
  const server = request.sandbox.postgresServers?.find(server => server.name === lab.dataTarget.server && server.resourceGroup === lab.dataTarget.resourceGroup)
  if (request.status !== 200 || !sqlCalls.length || !mode || !server
    || mode === 'pool' && !usesModulePool || mode === 'pgbouncer' && !usesModulePool && !usesDirectClients) {
    return { ...request, status: request.status === 200 ? 400 : request.status, load: { served: 0, failed: Math.round(scenario.requestsPerSecond * scenario.seconds), p95Ms: 0, throughputRps: 0, peakServerConnections: 0, errors: [request.error?.message ?? request.value?.error ?? 'Not supported by the simulator: load requires a successful SQL request and a recognized deployed connection configuration.'], mode } }
  }
  const load = simulatePoolLoad({ replicas, requestsPerSecond: scenario.requestsPerSecond, seconds: scenario.seconds, mode, poolMaxSize: poolMaxSize ?? 0, server })
  const status = load.errors.length || load.failed ? 503 : 200
  const expectedObservation = scenario.expectedError === 'too many clients already' && request.status === 200
    && status === 503 && load.failed > 0 && load.errors.some(error => error.includes(scenario.expectedError))
  return { ...request, status, expectedObservation, load: { ...load, mode, replicas, poolMaxSize } }
}

export function applyDataAction(run, action, lab) {
  const postgres = lab?.capabilities?.dataPostgres === true
  if (lab?.capabilities?.dataCosmos !== true && !postgres) {
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message: 'This Lab does not declare a data capability.' }] }
  }
  const kinds = postgres ? ['data-request', 'data-load'] : ['data-request', 'data-worker']
  if (!kinds.includes(action.type) || Object.keys(action).sort().join(',') !== 'scenarioId,type' || typeof action.scenarioId !== 'string') {
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message: 'Data requests accept only a declared scenarioId; outcomes cannot be supplied by the caller.' }] }
  }
  const scenario = lab.scenarios?.[action.scenarioId]
  if (!validDataScenario(scenario, action.type)) {
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message: 'The declared data scenario is invalid.' }] }
  }
  const task = lab.tasks.find((item) => item.verification?.scenarioId === action.scenarioId && item.verification?.scenarioVersion === scenario.version)
  if (!task) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message: 'No Task verifies this data scenario.' }] }
  const manifest = getProjectManifest(run.project.manifestId)
  const outcome = action.type === 'data-load' ? runLoad(run, lab, manifest, scenario)
    : action.type === 'data-request'
    ? runRequestSteps(run, lab, manifest, scenario.target, scenario.steps)
    : runWorkerSteps(run, lab, manifest, scenario.target, scenario.steps)
  const expectedLoadObservation = action.type === 'data-load' && scenario.expectedError !== undefined
  const completed = expectedLoadObservation ? outcome.expectedObservation === true : outcome.status === 200
  const measurements = { status: outcome.status, totalCharge: outcome.totalCharge, calls: outcome.calls, stale: outcome.stale, value: outcome.value, values: outcome.values,
    ...(postgres ? { trainingCalls: outcome.trainingCalls ?? [], trainingTraceTruncated: outcome.trainingTraceTruncated === true } : {}),
    ...(outcome.error ? { error: outcome.error } : {}), ...(outcome.load ?? {}) }
  const next = recordVerification({ ...run, sandbox: outcome.sandbox }, lab, task.id, {
    scenarioId: action.scenarioId, scenarioVersion: scenario.version,
    outcome: completed ? 'passed' : 'failed', completed,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs, measurements,
  })
  const text = `${action.type === 'data-load' ? 'Data load' : action.type === 'data-request' ? 'Data request' : 'Data worker'} ${action.scenarioId}: HTTP ${outcome.status}${outcome.expectedObservation ? ' (expected overload observed)' : ''}`
  return { run: next, lines: [{ kind: completed ? 'out' : 'err', text, status: outcome.status, measurements }], portalEvents: [], diagnostics: [] }
}
