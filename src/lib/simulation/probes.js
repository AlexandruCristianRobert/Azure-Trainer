import { appArmId } from './runtime.js'
import { simulateRequest } from './requests.js'

const copy = (value) => structuredClone(value)
const limit = (items, count) => { if (items.length > count) items.splice(0, items.length - count) }
const probeOf = (state, type) => state.probes.find((probe) => probe.type === type)
const fingerprintFor = (deployment) => JSON.stringify({ status: deployment?.status ?? null,
  generation: deployment?.active?.generation ?? null, artifactId: deployment?.active?.artifactId ?? null,
  probes: [...(deployment?.active?.probeConfig?.probes ?? [])].sort((a, b) => a.type.localeCompare(b.type)),
  endpoints: deployment?.active?.appSpec?.healthEndpoints ?? null })

function newReplica(id, index, probes) {
  const startupComplete = !probes.some((probe) => probe.type === 'Startup')
  return { id: `${id}#${index}`, index, startedSecond: 0, startupComplete,
    ready: startupComplete && !probes.some((probe) => probe.type === 'Readiness'), restartCount: 0, restartCause: null,
    faults: { readiness: false, hang: false, dependency: false },
    checks: Object.fromEntries(probes.map((probe) => [probe.type, { failures: 0, successes: 0,
      nextCheckSecond: probe.initialDelaySeconds, pendingTimeoutSecond: null, pendingStartedSecond: null }])) }
}

function initialState(id, deployment) {
  const probes = copy(deployment.active.probeConfig.probes)
  const count = deployment.active.probeConfig.minReplicas
  return { fingerprint: fingerprintFor(deployment), probes, replicas: Array.from({ length: count }, (_, index) => newReplica(id, index, probes)),
    roundRobinCursor: 0, manualRoundRobinCursor: 0, samples: [], events: [], requests: [] }
}

export function reconcileProbeRuntime(run, lab) {
  if (lab?.capabilities?.healthProbes !== true) return run
  const runtime = copy(run.runtime)
  runtime.probesByApp ??= {}
  const dependencyGenerations = { ...run.dependencyGenerations }
  const present = new Set(run.sandbox.containerApps.map(appArmId))
  for (const [id, deployment] of Object.entries(runtime.deploymentsByApp)) {
    if (!present.has(id) || !deployment?.active?.probeConfig) continue
    const prior = runtime.probesByApp[id]
    const fingerprint = fingerprintFor(deployment)
    if (prior?.fingerprint === fingerprint) continue
    runtime.probesByApp[id] = initialState(id, deployment)
    dependencyGenerations[`probes:${id}`] = (dependencyGenerations[`probes:${id}`] ?? 0) + 1
    if (runtime.activeScenario?.kind === 'probes' && runtime.activeScenario.appId === id) runtime.activeScenario = null
  }
  for (const id of Object.keys(runtime.probesByApp)) {
    if (present.has(id) && runtime.deploymentsByApp[id]?.active?.probeConfig) continue
    delete runtime.probesByApp[id]
    dependencyGenerations[`probes:${id}`] = (dependencyGenerations[`probes:${id}`] ?? 0) + 1
    if (runtime.activeScenario?.kind === 'probes' && runtime.activeScenario.appId === id) runtime.activeScenario = null
  }
  return { ...run, runtime, dependencyGenerations }
}

export function resetProbeExperiment(runtime, appId) {
  const state = runtime.probesByApp[appId]
  const deployment = runtime.deploymentsByApp[appId]
  runtime.probesByApp[appId] = initialState(appId, deployment)
  if (probeOf(runtime.probesByApp[appId], 'Startup')) {
    runtime.probesByApp[appId].events.push(...state.replicas.map((replica) => ({ second: 0, type: 'startup-begin', replicaId: replica.id })))
  }
}

function endpointResult(replica, state, probe, second, startupSeconds, active) {
  if (probe.httpGet.port !== active.listeningPort) return { status: null, reason: 'connection-failure' }
  const endpoint = active.appSpec.healthEndpoints?.find((entry) => entry.path === probe.httpGet.path)
  if (!endpoint) return { status: 404, reason: 'path-not-found' }
  if (replica.faults.hang) return { status: null, reason: 'timeout' }
  const condition = endpoint.condition
  const healthy = condition === 'always' || (condition === 'startup' && second - replica.startedSecond >= startupSeconds)
    || (condition === 'ready' && !replica.faults.readiness)
    || (condition === 'responsive' && !replica.faults.hang)
    || (condition === 'dependency' && !replica.faults.dependency)
  return { status: healthy ? 200 : 503, reason: healthy ? 'success' : 'unhealthy' }
}

function restart(state, replica, second, type) {
  replica.restartCount++
  replica.restartCause = type
  replica.startedSecond = second
  replica.startupComplete = !probeOf(state, 'Startup')
  replica.ready = replica.startupComplete && !probeOf(state, 'Readiness')
  replica.faults.hang = false
  for (const probe of state.probes) replica.checks[probe.type] = { failures: 0, successes: 0,
    nextCheckSecond: second + probe.initialDelaySeconds, pendingTimeoutSecond: null, pendingStartedSecond: null }
  state.events.push({ second, type: 'restart', replicaId: replica.id, probeType: type })
  if (probeOf(state, 'Startup')) state.events.push({ second, type: 'startup-begin', replicaId: replica.id })
}

function outcome(state, replica, probe, second, status, reason) {
  const check = replica.checks[probe.type]
  const success = status >= 200 && status <= 399
  check.successes = success ? check.successes + 1 : 0
  check.failures = success ? 0 : check.failures + 1
  state.events.push({ second, type: reason === 'timeout' ? 'probe-timeout' : 'probe-result',
    replicaId: replica.id, probeType: probe.type, status, reason, failures: check.failures, successes: check.successes })
  if (probe.type === 'Startup' && success && !replica.startupComplete && check.successes >= probe.successThreshold) {
    replica.startupComplete = true
    state.events.push({ second, type: 'startup-complete', replicaId: replica.id })
    if (!probeOf(state, 'Readiness')) {
      replica.ready = true
      state.events.push({ second, type: 'ready-change', replicaId: replica.id, ready: true })
    }
  } else if (probe.type === 'Readiness') {
    const wasReady = replica.ready
    if (success && check.successes >= probe.successThreshold) replica.ready = true
    if (!success && check.failures >= probe.failureThreshold) replica.ready = false
    if (replica.ready !== wasReady) state.events.push({ second, type: 'ready-change', replicaId: replica.id, ready: replica.ready })
  }
  if (!success && ['Startup', 'Liveness'].includes(probe.type) && check.failures >= probe.failureThreshold) {
    restart(state, replica, second, probe.type)
    return true
  }
  return false
}

function checkProbe(state, replica, type, second, startupSeconds, active) {
  const probe = probeOf(state, type)
  if (!probe) return false
  const check = replica.checks[type]
  if (check.pendingTimeoutSecond !== null) {
    if (second < check.pendingTimeoutSecond) return false
    check.pendingTimeoutSecond = null
    check.pendingStartedSecond = null
    return outcome(state, replica, probe, second, null, 'timeout')
  }
  if (second < check.nextCheckSecond) return false
  const result = endpointResult(replica, state, probe, second, startupSeconds, active)
  check.nextCheckSecond = second + probe.periodSeconds
  if (result.reason === 'timeout') {
    check.pendingTimeoutSecond = second + probe.timeoutSeconds
    check.pendingStartedSecond = second
    return false
  }
  return outcome(state, replica, probe, second, result.status, result.reason)
}

function tick(state, scenario, fixture, active, runtime, run) {
  const second = ++scenario.elapsedSeconds
  for (const fault of fixture.faults) {
    if (fault.atSecond !== second) continue
    const replica = state.replicas[fault.replica]
    replica.faults[fault.type] = fault.active
    state.events.push({ second, type: 'fault', replicaId: replica.id, faultType: fault.type, active: fault.active })
  }
  for (const replica of state.replicas) {
    if (!replica.startupComplete) {
      checkProbe(state, replica, 'Startup', second, fixture.startupSeconds, active)
    }
    if (!replica.startupComplete) continue
    if (checkProbe(state, replica, 'Liveness', second, fixture.startupSeconds, active)) continue
    checkProbe(state, replica, 'Readiness', second, fixture.startupSeconds, active)
  }
  for (let requestIndex = 0; requestIndex < fixture.requestsPerSecond; requestIndex++) {
    const response = simulateRequest({ ...run, runtime }, { appId: scenario.appId, method: 'GET', path: '/api/info' }, { scenarioRequest: true })
    if (response.runtime) runtime.probesByApp[scenario.appId].roundRobinCursor = response.runtime.probesByApp[scenario.appId].roundRobinCursor
    state.requests.push({ second, requestIndex, replicaId: response.replicaId ?? null, status: response.status })
  }
  state.samples.push({ second, readyReplicas: state.replicas.filter((replica) => replica.ready).length,
    restarts: state.replicas.reduce((total, replica) => total + replica.restartCount, 0) })
  limit(state.events, 6000)
  limit(state.requests, 1200)
  limit(state.samples, 600)
}

export function advanceProbeSimulation(run, seconds, lab) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new RangeError('Simulation advance must be an integer from 1 to 300 seconds.')
  const reconciled = reconcileProbeRuntime(run, lab)
  const runtime = copy(reconciled.runtime)
  const scenario = runtime.activeScenario
  if (!scenario || scenario.kind !== 'probes' || scenario.paused) return { run: reconciled, completed: null }
  const fixture = lab.scenarios[scenario.scenarioId]
  const deployment = runtime.deploymentsByApp[scenario.appId]
  const state = runtime.probesByApp[scenario.appId]
  if (!deployment || deployment.status !== 'succeeded' || !state) return { run: { ...reconciled, runtime: { ...runtime, activeScenario: null } }, completed: null }
  const count = Math.min(seconds, fixture.durationSeconds - scenario.elapsedSeconds)
  for (let index = 0; index < count; index++) {
    runtime.simTimeMs += 1000
    tick(state, scenario, fixture, deployment.active, runtime, reconciled)
  }
  if (scenario.elapsedSeconds < fixture.durationSeconds) return { run: { ...reconciled, runtime }, completed: null }
  const measurements = { appId: scenario.appId, probes: copy(state.probes), readyReplicas: state.replicas.filter((replica) => replica.ready).length,
    restarts: state.replicas.reduce((total, replica) => total + replica.restartCount, 0),
    replicas: copy(state.replicas), samples: copy(state.samples), events: copy(state.events), requests: copy(state.requests) }
  runtime.activeScenario = null
  return { run: { ...reconciled, runtime }, completed: { scenarioId: scenario.scenarioId, version: scenario.version,
    startedAtMs: scenario.startedAtMs, endedAtMs: runtime.simTimeMs, measurements } }
}
