import { appArmId } from './runtime.js'

const copy = (value) => structuredClone(value)
const activePolicy = (run, app) => run.runtime.deploymentsByApp[appArmId(app)]?.active?.scalePolicy ?? app
const cpuRule = (app) => app.scaleRules?.find((rule) => rule.custom?.type === 'cpu')
const policyFor = (app) => JSON.stringify({ cpu: app.cpu ?? 0.5, memory: app.memory ?? '1Gi',
  minReplicas: app.minReplicas, maxReplicas: app.maxReplicas, scaleRules: app.scaleRules ?? [] })
const deploymentFor = (run, id) => {
  const deployment = run.runtime.deploymentsByApp[id]
  return JSON.stringify({ status: deployment?.status ?? null, generation: deployment?.active?.generation ?? null })
}

function initialState(app, run, id) {
  return { policyFingerprint: policyFor(app), deploymentFingerprint: deploymentFor(run, id),
    readyReplicas: app.minReplicas, desiredReplicas: app.minReplicas, pendingReplicas: [],
    demandCpuSecondsPerSecond: 0, requestCpuSeconds: 0.02, lowDemandSeconds: 0, samples: [] }
}

export function reconcileCpuRuntime(run, lab) {
  if (lab?.capabilities?.cpuScaling !== true) return run
  const runtime = copy(run.runtime)
  runtime.cpuByApp ??= {}
  const dependencyGenerations = { ...run.dependencyGenerations }
  const present = new Set()
  for (const app of run.sandbox.containerApps) {
    const id = appArmId(app)
    present.add(id)
    const previous = runtime.cpuByApp[id]
    const policy = activePolicy(run, app)
    const policyChanged = !previous || previous.policyFingerprint !== policyFor(policy)
    const deploymentChanged = !!previous && previous.deploymentFingerprint !== deploymentFor(run, id)
    if (policyChanged || deploymentChanged) {
      runtime.cpuByApp[id] = initialState(policy, run, id)
      if (policyChanged) dependencyGenerations[`scaling:${id}`] = (dependencyGenerations[`scaling:${id}`] ?? 0) + 1
      if (deploymentChanged && JSON.parse(previous.deploymentFingerprint).generation === JSON.parse(deploymentFor(run, id)).generation) {
        dependencyGenerations[`deployment:${id}`] = (dependencyGenerations[`deployment:${id}`] ?? 0) + 1
      }
      if (runtime.activeScenario?.appId === id) runtime.activeScenario = null
    }
  }
  for (const id of Object.keys(runtime.cpuByApp)) {
    if (present.has(id)) continue
    delete runtime.cpuByApp[id]
    dependencyGenerations[`scaling:${id}`] = (dependencyGenerations[`scaling:${id}`] ?? 0) + 1
    if (runtime.activeScenario?.appId === id) runtime.activeScenario = null
  }
  return { ...run, runtime, dependencyGenerations }
}

function tickApp(state, app, second) {
  const matured = state.pendingReplicas.filter((pending) => pending.readyAtSecond <= second)
  state.readyReplicas += matured.reduce((total, pending) => total + pending.count, 0)
  state.pendingReplicas = state.pendingReplicas.filter((pending) => pending.readyAtSecond > second)
  const capacity = state.readyReplicas * (app.cpu ?? 0.5)
  const demand = state.demandCpuSecondsPerSecond
  const servedCpu = Math.min(capacity, demand)
  const utilization = capacity > 0 ? Math.min(100, demand / capacity * 100) : 0
  const sample = { second, readyReplicas: state.readyReplicas, pendingReplicas: state.pendingReplicas.reduce((total, pending) => total + pending.count, 0),
    desiredReplicas: state.desiredReplicas, utilization, offeredThroughput: demand / state.requestCpuSeconds,
    servedThroughput: servedCpu / state.requestCpuSeconds }
  state.samples.push(sample)
  if (state.samples.length > 600) state.samples.shift()

  const rule = cpuRule(app)
  if (!rule) return sample
  const target = Number(rule.custom.metadata.value)
  const lowerThreshold = target * 0.9
  state.lowDemandSeconds = utilization < lowerThreshold && state.readyReplicas > app.minReplicas
    ? state.lowDemandSeconds + 1 : 0
  if (Math.floor(second) % 15 !== 0) return sample
  if (utilization > target * 1.1) {
    const desired = Math.min(app.maxReplicas, Math.max(app.minReplicas, Math.ceil(state.readyReplicas * utilization / target)))
    const current = state.readyReplicas + state.pendingReplicas.reduce((total, pending) => total + pending.count, 0)
    if (desired > current) state.pendingReplicas.push({ count: desired - current, readyAtSecond: second + 5 })
    state.desiredReplicas = Math.max(current, desired)
    state.lowDemandSeconds = 0
  } else if (state.lowDemandSeconds >= 60 && utilization < lowerThreshold) {
    const desired = Math.max(app.minReplicas, Math.min(app.maxReplicas, Math.ceil(state.readyReplicas * utilization / target)))
    state.readyReplicas = Math.min(state.readyReplicas, desired)
    state.desiredReplicas = state.readyReplicas + state.pendingReplicas.reduce((total, pending) => total + pending.count, 0)
    state.lowDemandSeconds = 0
  }
  return sample
}

// A completed scenario is returned separately so only trusted Lab code can assess its measurements.
export function advanceSimulation(run, seconds, lab) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) throw new RangeError('Simulation advance must be an integer from 1 to 300 seconds.')
  let next = reconcileCpuRuntime(run, lab)
  const runtime = copy(next.runtime)
  const scenario = runtime.activeScenario
  if (!scenario || scenario.paused) return { run: next, completed: null }
  const fixture = lab.scenarios[scenario.scenarioId]
  const app = next.sandbox.containerApps.find((entry) => appArmId(entry) === scenario.appId)
  const state = runtime.cpuByApp[scenario.appId]
  if (!app || !state) return { run: { ...next, runtime: { ...runtime, activeScenario: null } }, completed: null }
  const count = Math.min(seconds, fixture.durationSeconds - scenario.elapsedSeconds)
  for (let i = 0; i < count; i++) {
    runtime.simTimeMs += 1000
    const sample = tickApp(state, activePolicy(next, app), runtime.simTimeMs / 1000)
    scenario.elapsedSeconds++
    scenario.maxReadyReplicas = Math.max(scenario.maxReadyReplicas, state.readyReplicas)
    scenario.trace.push({ ...sample })
    if (scenario.trace.length > 600) scenario.trace.shift()
  }
  if (scenario.elapsedSeconds < fixture.durationSeconds) return { run: { ...next, runtime }, completed: null }
  const last = scenario.trace.at(-1)
  const measurements = { appId: scenario.appId, startReadyReplicas: scenario.startReadyReplicas,
    endReadyReplicas: state.readyReplicas, maxReadyReplicas: scenario.maxReadyReplicas,
    finalUtilization: last.utilization, finalOfferedThroughput: last.offeredThroughput,
    finalServedThroughput: last.servedThroughput, trace: scenario.trace }
  state.demandCpuSecondsPerSecond = 0
  runtime.activeScenario = null
  return { run: { ...next, runtime }, completed: { scenarioId: scenario.scenarioId, version: scenario.version,
    startedAtMs: scenario.startedAtMs, endedAtMs: runtime.simTimeMs, measurements } }
}
