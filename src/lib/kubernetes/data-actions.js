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
  const cluster = run.runtime.kubernetes?.clusters?.[target.clusterId]
  const service = cluster?.resources?.[`Service/${target.namespace}/${target.serviceName}`]
  if (!service) return null
  const pod = readyPods(run, target.clusterId, target.namespace, target.deploymentName)
    .filter((candidate) => Object.entries(service.spec.selector ?? {}).every(([key, value]) => candidate.metadata.labels?.[key] === value))
    .sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid))[0]
  return pod ? podAppSpec(run, target.clusterId, pod) : null
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
  if (!validTarget(scenario.target, expectedKind === 'data-request')) return false
  if (!Array.isArray(scenario.steps) || !scenario.steps.length) return false
  return scenario.steps.every(expectedKind === 'data-request' ? validRequestStep : validWorkerStep)
}

function runRequestSteps(run, lab, manifest, target, steps) {
  const appSpec = findServiceAppSpec(run, target)
  if (!appSpec) return { sandbox: run.sandbox, status: 503, value: NO_READY_ENDPOINTS, calls: [], totalCharge: 0, stale: false }
  const { account, database } = lab.dataTarget
  const nowMs = run.runtime.simTimeMs
  const scenarioState = { writesThisRequest: new Set() }
  let sandbox = run.sandbox
  let status = 200
  let value = null
  let calls = []
  let stale = false
  for (const step of steps) {
    if (status !== 200) break
    const functionName = manifest.routes[step.route]
    const result = runDataFunction({ appSpec, sandbox, account, database, functionName, args: step.args, nowMs, scenarioState, changeFeed: CHANGE_FEED_HOOK })
    sandbox = result.sandbox
    calls = calls.concat(result.calls)
    value = result.value
    status = result.status
    if (result.calls.some((call) => call.stale)) stale = true
  }
  return { sandbox, status, value, calls, totalCharge: round2(calls.reduce((sum, call) => sum + call.charge, 0)), stale }
}

function runWorkerSteps(run, lab, manifest, target, steps) {
  const appSpec = findDeploymentAppSpec(run, target)
  if (!appSpec) return { sandbox: run.sandbox, status: 503, value: NO_READY_ENDPOINTS, calls: [], totalCharge: 0, stale: false }
  const { account, database } = lab.dataTarget
  const nowMs = run.runtime.simTimeMs
  const scenarioState = { writesThisRequest: new Set() }
  let sandbox = run.sandbox
  let status = 200
  let value = null
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
        status = result.status
        if (status !== 200) break
      }
    }
  }
  return { sandbox, status, value, calls, totalCharge: round2(calls.reduce((sum, call) => sum + call.charge, 0)), stale }
}

export function applyDataAction(run, action, lab) {
  if (lab?.capabilities?.dataCosmos !== true) {
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message: 'This Lab does not declare the dataCosmos capability.' }] }
  }
  if (!['data-request', 'data-worker'].includes(action.type) || Object.keys(action).sort().join(',') !== 'scenarioId,type' || typeof action.scenarioId !== 'string') {
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message: 'Data requests accept only a declared scenarioId; outcomes cannot be supplied by the caller.' }] }
  }
  const scenario = lab.scenarios?.[action.scenarioId]
  if (!validDataScenario(scenario, action.type)) {
    return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message: 'The declared data scenario is invalid.' }] }
  }
  const task = lab.tasks.find((item) => item.verification?.scenarioId === action.scenarioId && item.verification?.scenarioVersion === scenario.version)
  if (!task) return { run, lines: [], portalEvents: [], diagnostics: [{ code: 'INVALID_DATA_ACTION', message: 'No Task verifies this data scenario.' }] }
  const manifest = getProjectManifest(run.project.manifestId)
  const outcome = action.type === 'data-request'
    ? runRequestSteps(run, lab, manifest, scenario.target, scenario.steps)
    : runWorkerSteps(run, lab, manifest, scenario.target, scenario.steps)
  const completed = outcome.status === 200
  const measurements = { status: outcome.status, totalCharge: outcome.totalCharge, calls: outcome.calls, stale: outcome.stale, value: outcome.value }
  const next = recordVerification({ ...run, sandbox: outcome.sandbox }, lab, task.id, {
    scenarioId: action.scenarioId, scenarioVersion: scenario.version,
    outcome: completed ? 'passed' : 'failed', completed,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs, measurements,
  })
  const text = `${action.type === 'data-request' ? 'Data request' : 'Data worker'} ${action.scenarioId}: HTTP ${outcome.status}`
  return { run: next, lines: [{ kind: completed ? 'out' : 'err', text, status: outcome.status, measurements }], portalEvents: [], diagnostics: [] }
}
