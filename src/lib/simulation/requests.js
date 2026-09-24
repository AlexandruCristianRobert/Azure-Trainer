import { activeDeployment } from './runtime.js'
import { isJsonValue } from '../labEngine/run.js'

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) freezeTree(nested)
    Object.freeze(value)
  }
  return value
}

export function getRequestScenario(lab, taskId) {
  const task = lab?.tasks?.find((candidate) => candidate.id === taskId)
  const verification = task?.verification
  if (!verification || !Object.hasOwn(lab?.scenarios ?? {}, verification.scenarioId)) return null
  const scenario = lab.scenarios[verification.scenarioId]
  if (!isJsonValue(scenario) || scenario.version !== verification.scenarioVersion
    || typeof scenario.appId !== 'string' || !scenario.appId) return null
  if (scenario.kind === 'foundry') {
    const attempts = scenario.faultProfile?.attempts
    const request = scenario.request
    const namedInput = request?.path === '/api/brief' ? 'content' : request?.path === '/api/summarize' ? 'text' : null
    if (lab.capabilities?.foundryInference !== true || scenario.request?.method !== 'POST'
      || !namedInput || !request.body || Object.keys(request.body).length !== 1
      || typeof request.body[namedInput] !== 'string'
      || !Array.isArray(attempts) || attempts.length > 3
      || attempts.some((attempt) => !attempt || ![200, 401, 403, 404, 408, 429, 500, 502, 503, 504].includes(attempt.status)
        || (attempt.durationMs !== undefined && (!Number.isInteger(attempt.durationMs) || attempt.durationMs < 0 || attempt.durationMs > 30000))
        || (attempt.retryAfterSeconds !== undefined && (!Number.isInteger(attempt.retryAfterSeconds) || attempt.retryAfterSeconds < 0 || attempt.retryAfterSeconds > 30)))
      || ![200, 400, 502, 503, 504].includes(scenario.expected?.status)
      || (scenario.expected.diagnosticCode !== undefined
        && (typeof scenario.expected.diagnosticCode !== 'string' || !/^[A-Z][A-Z0-9_]{1,63}$/.test(scenario.expected.diagnosticCode)))) return null
  } else if (scenario.request?.method !== 'GET' || scenario.request?.path !== '/api/info'
    || !Number.isInteger(scenario.expected?.status) || scenario.expected.status < 100 || scenario.expected.status > 599
    || !isJsonValue(scenario.expected.body)) return null
  return freezeTree(structuredClone(scenario))
}

function responseValue(expression, active) {
  if (expression.kind === 'literal' || expression.kind === 'member') return expression.value
  if (expression.kind === 'config') return Object.hasOwn(active.env, expression.key) ? active.env[expression.key] : null
  return null
}

export function simulateRequest(run, { appId, method, path }, { scenarioRequest = false } = {}) {
  const deployedId = Object.keys(run.runtime.deploymentsByApp).find((id) => id.toLowerCase() === appId.toLowerCase())
  const app = run.sandbox.containerApps.find((candidate) => candidate && candidate.name &&
    deployedId && appId.toLowerCase().endsWith(`/containerapps/${candidate.name.toLowerCase()}`) &&
    appId.toLowerCase().includes(`/resourcegroups/${candidate.resourceGroup.toLowerCase()}/`))
  if (!app) return { status: 404, body: { error: 'APP_NOT_FOUND' }, diagnostic: { code: 'APP_NOT_FOUND', message: 'The Container App does not exist.' } }
  const active = activeDeployment(run, deployedId)
  if (!active) return { status: 503, body: { error: 'NO_ACTIVE_DEPLOYMENT' }, diagnostic: { code: 'NO_ACTIVE_DEPLOYMENT', message: 'No image is running for this app.' } }
  if (active.ingress !== 'external') return { status: 503, body: { error: 'INGRESS_UNAVAILABLE' }, diagnostic: { code: 'INGRESS_UNAVAILABLE', message: 'External ingress is not enabled in the running deployment.' } }
  if (active.targetPort !== active.listeningPort) return { status: 502, body: { error: 'TARGET_PORT_MISMATCH' }, diagnostic: { code: 'TARGET_PORT_MISMATCH', message: 'Ingress does not reach the application listener.' } }
  const route = active.appSpec.routes.find((item) => item.method === method && item.path === path)
  if (!route) return { status: 404, body: { error: 'ROUTE_NOT_FOUND' }, diagnostic: { code: 'ROUTE_NOT_FOUND', message: `The running source has no ${method} ${path} route.` } }
  const probeState = run.runtime.probesByApp?.[deployedId]
  let replicaId = null
  let runtime = null
  if (probeState) {
    const ready = probeState.replicas.filter((replica) => replica.ready)
    if (ready.length === 0) return { status: 503, body: { error: 'NO_READY_REPLICAS' },
      diagnostic: { code: 'NO_READY_REPLICAS', message: 'No replica is ready to receive traffic.' } }
    const cursorKey = scenarioRequest ? 'roundRobinCursor' : 'manualRoundRobinCursor'
    const cursor = probeState[cursorKey] ?? 0
    const selected = ready[cursor % ready.length]
    replicaId = selected.id
    runtime = { ...run.runtime, probesByApp: { ...run.runtime.probesByApp,
      [deployedId]: { ...probeState, [cursorKey]: cursor + 1 } } }
    if (selected.faults.hang) return { status: 503, body: { error: 'REPLICA_UNRESPONSIVE' }, replicaId, runtime,
      diagnostic: { code: 'REPLICA_UNRESPONSIVE', message: 'The selected replica is not responding.' } }
    if (selected.faults.readiness) return { status: 503, body: { error: 'REPLICA_NOT_SERVING' }, replicaId, runtime,
      diagnostic: { code: 'REPLICA_NOT_SERVING', message: 'The selected replica cannot serve this request.' } }
  }
  const body = Object.fromEntries(Object.entries(route.response).map(([key, expression]) => [key, responseValue(expression, active)]))
  return { status: 200, body, ...(replicaId ? { replicaId, runtime } : {}) }
}
