import { effectiveDeployment, appArmId } from './runtime.js'

const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()
const retryable = new Set([408, 429, 500, 502, 503, 504])
const roleIds = new Set(['a97b65f3-24c7-4388-baec-2e87135dc908', '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'])
const cognitiveUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'
const approvedRole = (assignment, brief) => brief
  ? assignment.roleDefinitionId === cognitiveUserRoleId && assignment.roleName === 'Cognitive Services User'
  : roleIds.has(assignment.roleDefinitionId)
const briefPolicyReady = (config) => Number.isInteger(config?.maxAttempts) && config.maxAttempts >= 2 && config.maxAttempts <= 3
  && Number.isInteger(config.timeoutSeconds) && config.timeoutSeconds >= 5 && config.timeoutSeconds <= 8
  && Number.isInteger(config.attemptTimeoutSeconds) && config.attemptTimeoutSeconds >= 1 && config.attemptTimeoutSeconds <= 2
  && config.honorRetryAfter === true && config.inputField === 'content' && config.outputField === 'brief'

function result(run, scenario, status, body, code, message, upstream, elapsedMs = 0) {
  return { status, body, upstream, runtime: { ...run.runtime, simTimeMs: run.runtime.simTimeMs + elapsedMs },
    ...(code ? { diagnostic: { code, message, accountId: upstream.accountId, deployment: upstream.deployment,
      principalId: upstream.principalId, correlationId: upstream.correlationId,
      ...(upstream.incidentId ? { incidentId: upstream.incidentId } : {}) } } : {}) }
}

export function simulateFoundryRequest(run, scenario) {
  const { appId, request, faultProfile } = scenario
  const active = effectiveDeployment(run, appId)
  const config = active?.foundry
  const inputField = active?.appSpec?.foundry?.inputField ?? 'text'
  const outputField = active?.appSpec?.foundry?.outputField ?? 'summary'
  const route = active?.appSpec?.foundry?.path ?? '/api/summarize'
  const correlationId = `foundry-request-${run.nextSequence}`
  const app = run.sandbox.containerApps.find((item) => same(appArmId(item), appId))
  const upstream = { correlationId, accountId: null, deployment: config?.deployment ?? null,
    principalId: config?.principalId ?? null, attempts: [],
    ...(app?.incidentDrift?.incidentId ? { incidentId: app.incidentDrift.incidentId } : {}) }
  const fail = (status, code, message) => result(run, scenario, status, { error: code }, code, message, upstream)
  if (!app) {
    return fail(404, 'APP_NOT_FOUND', 'The Container App does not exist.')
  }
  if (!active) return fail(502, 'NO_ACTIVE_DEPLOYMENT', 'No image is running for this app.')
  if (active.ingress !== 'external') return fail(502, 'INGRESS_UNAVAILABLE', 'External ingress is not enabled.')
  if (active.targetPort !== active.listeningPort) return fail(502, 'TARGET_PORT_MISMATCH', 'Ingress does not reach the application listener.')
  if (!active.appSpec.routes.some((item) => item.method === request.method && item.path === request.path)) {
    return fail(404, 'ROUTE_NOT_FOUND', `The running source has no ${request.method} ${request.path} route.`)
  }
  if (request.method !== config?.method || request.path !== route || request.path !== config?.path
    || !Object.hasOwn(request.body, inputField)) return fail(404, 'ROUTE_NOT_FOUND', 'The request does not match the running Foundry contract.')
  const text = request.body[inputField].trim()
  if (!text || text.length > (config?.maxInputLength ?? 4000)) {
    return { ...fail(400, 'INVALID_INPUT', `${inputField} is required and must be at most ${config?.maxInputLength ?? 4000} characters.`),
      verificationEligible: foundryInferenceReady(run, appId) }
  }
  if (!config?.configured || config.method !== 'POST'
    || config.tokenScope !== 'https://ai.azure.com/.default' || config.sdkRetries !== 0
    || config.identity !== 'user-assigned' || !config.endpoint || !config.deployment) {
    return fail(502, 'FOUNDRY_CONFIG_INVALID', 'The running Foundry configuration is incomplete or unsupported.')
  }
  const account = (run.sandbox.foundryAccounts ?? []).find((item) => same(item.endpoint, config.endpoint))
  if (!account) return fail(502, 'FOUNDRY_ACCOUNT_NOT_FOUND', 'The configured resource endpoint does not match a Foundry account.')
  upstream.accountId = account.id
  if (!account.deployments.some((deployment) => same(deployment.name, config.deployment))) {
    return fail(502, 'FOUNDRY_DEPLOYMENT_NOT_FOUND', 'The configured deployment does not exist on this account.')
  }
  const identity = run.sandbox.managedIdentities.find((item) => same(item.id, config.identityId)
    && same(item.clientId, config.clientId) && same(item.principalId, config.principalId))
  if (!identity) return fail(502, 'FOUNDRY_IDENTITY_MISSING', 'The active deployment has no matching assigned caller identity.')
  const attached = (Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]).some((id) => same(id, identity.id))
  if (!attached) return fail(502, 'FOUNDRY_IDENTITY_MISSING', 'The captured caller identity is no longer assigned to this app.')
  const brief = config.contract === 'brief-v1'
  if (brief && same(identity.id, app.registryIdentity)) return fail(502, 'FOUNDRY_IDENTITY_MISSING', 'The brief caller must use a dedicated inference identity.')
  const granted = run.sandbox.roleAssignments.some((assignment) => same(assignment.scope, account.id)
    && same(assignment.principalId, identity.principalId) && approvedRole(assignment, brief))
  if (!granted) return fail(502, 'FOUNDRY_ACCESS_DENIED', 'The caller has no inference grant at this account scope.')

  if (brief && !briefPolicyReady(config)) {
    return fail(502, 'FOUNDRY_CONFIG_INVALID', 'The active brief policy is unsupported.')
  }
  const budgetMs = Math.min(config.timeoutSeconds * 1000, brief ? 8000 : 10000)
  const capMs = Math.min(config.attemptTimeoutSeconds * 1000, brief ? 2000 : 3000)
  const maxAttempts = Math.min(config.maxAttempts ?? 3, 3)
  const honorRetryAfter = config.honorRetryAfter ?? true
  let elapsedMs = 0
  for (let index = 0; index < maxAttempts; index++) {
    const fault = faultProfile.attempts[index] ?? { status: 200 }
    const remaining = budgetMs - elapsedMs
    const durationMs = Math.min(fault.durationMs ?? 0, capMs, remaining)
    elapsedMs += durationMs
    const timedOut = (fault.durationMs ?? 0) > durationMs || remaining <= 0
    const status = timedOut ? 504 : fault.status
    const attempt = { number: index + 1, accountId: account.id, deployment: config.deployment,
      principalId: identity.principalId, correlationId, status, startedAtMs: run.runtime.simTimeMs + elapsedMs - durationMs,
      durationMs, delayAfterMs: 0 }
    upstream.attempts.push(attempt)
    if (status === 200) {
      const summary = text.length > 160 ? `${text.slice(0, 157).trimEnd()}...` : text
      return result(run, scenario, 200, { [outputField]: summary, deployment: config.deployment }, null, null, upstream, elapsedMs)
    }
    if (elapsedMs >= budgetMs) return result(run, scenario, 504, { error: 'UPSTREAM_DEADLINE' },
      'UPSTREAM_DEADLINE', 'The overall inference deadline expired.', upstream, elapsedMs)
    if (!retryable.has(status)) return result(run, scenario, 502, { error: 'UPSTREAM_REQUEST_REJECTED' },
      'UPSTREAM_REQUEST_REJECTED', `The upstream deployment returned ${status}; this outcome is not retried.`, upstream, elapsedMs)
    if (index === maxAttempts - 1) break
    const fallbackDelayMs = (index + 1) * 1000
    const retryAfterMs = fault.retryAfterSeconds === undefined ? null : fault.retryAfterSeconds * 1000
    const retryAfterFits = retryAfterMs !== null && elapsedMs + retryAfterMs + 1 <= budgetMs
    const delayMs = honorRetryAfter && retryAfterMs !== null
      ? (retryAfterFits ? retryAfterMs : fallbackDelayMs)
      : fallbackDelayMs
    if (elapsedMs + delayMs + 1 > budgetMs) return result(run, scenario, 504, { error: 'UPSTREAM_DEADLINE' },
      'UPSTREAM_DEADLINE', 'The next attempt cannot fit in the overall inference deadline.', upstream, elapsedMs)
    attempt.delayAfterMs = delayMs
    elapsedMs += delayMs
  }
  return result(run, scenario, 503, { error: 'UPSTREAM_UNAVAILABLE' }, 'UPSTREAM_UNAVAILABLE',
    `The upstream deployment remained unavailable after ${maxAttempts} total attempts.`, upstream, elapsedMs)
}

export function foundryEvidenceDependencies(appId) {
  const active = ({ runtime, sandbox }) => effectiveDeployment({ runtime, sandbox }, appId)
  const account = ({ runtime, sandbox }) => {
    const endpoint = active({ runtime, sandbox })?.foundry?.endpoint
    return sandbox.foundryAccounts.find((item) => same(item.endpoint, endpoint)) ?? null
  }
  return {
    [`foundry:${appId}`]: () => true,
    deployment: ({ runtime, sandbox }) => {
      const value = active({ runtime, sandbox })
      return value ? { generation: value.generation, artifactId: value.artifactId, digest: value.digest,
        appSpec: value.appSpec, foundry: value.foundry ?? null } : null
    },
    appIdentity: ({ sandbox, runtime }) => {
      const app = sandbox.containerApps.find((item) => same(appArmId(item), appId))
      const selected = active({ runtime, sandbox })?.foundry?.identityId
      const attached = app && (Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]).some((id) => same(id, selected))
      const brief = active({ runtime, sandbox })?.foundry?.contract === 'brief-v1'
      const identity = sandbox.managedIdentities.find((item) => same(item.id, selected))
      return app ? { selectedIdentityId: attached ? selected : null, clientId: app.envVars?.AZURE_CLIENT_ID ?? null,
        ...(brief ? { attachedIdentityIds: (Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]).filter(Boolean),
          selectedClientId: identity?.clientId ?? null, selectedPrincipalId: identity?.principalId ?? null } : {}) } : null
    },
    registryPull: ({ sandbox, runtime }) => {
      const app = sandbox.containerApps.find((item) => same(appArmId(item), appId))
      if (!app) return null
      const registry = sandbox.containerRegistries.find((item) => same(item.loginServer, app.registryServer ?? app.image?.split('/')[0]))
      const identity = sandbox.managedIdentities.find((item) => same(item.id, app.registryIdentity))
      const attached = (Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]).some((id) => same(id, identity?.id))
      const grant = sandbox.roleAssignments.find((item) => same(item.scope, registry?.id)
        && same(item.principalId, identity?.principalId) && item.roleName === 'AcrPull')
      return { registryId: registry?.id ?? null, identityId: identity?.id ?? null,
        attached, grantId: grant?.id ?? null,
        ...(active({ runtime, sandbox })?.foundry?.contract === 'brief-v1'
          ? { principalId: identity?.principalId ?? null, registryIdentity: app.registryIdentity ?? null,
              grant: grant ? { id: grant.id, scope: grant.scope, principalId: grant.principalId,
                roleDefinitionId: grant.roleDefinitionId, roleName: grant.roleName } : null } : {}) }
    },
    foundryAccount: ({ runtime, sandbox }) => {
      const value = account({ runtime, sandbox })
      return value ? { id: value.id, endpoint: value.endpoint, kind: value.kind, sku: value.sku } : null
    },
    foundryDeployment: ({ runtime, sandbox }) => {
      const config = active({ runtime, sandbox })?.foundry
      const foundry = account({ runtime, sandbox })
      return foundry?.deployments.find((item) => same(item.name, config?.deployment)) ?? null
    },
    foundryGrant: ({ runtime, sandbox }) => {
      const principalId = active({ runtime, sandbox })?.foundry?.principalId
      const foundry = account({ runtime, sandbox })
      return sandbox.roleAssignments.filter((item) => same(item.scope, foundry?.id)
        && same(item.principalId, principalId) && approvedRole(item, active({ runtime, sandbox })?.foundry?.contract === 'brief-v1'))
        .sort((left, right) => left.id.localeCompare(right.id))
    },
  }
}

export function foundryInferenceReady(run, appId) {
  const app = run.sandbox.containerApps.find((item) => same(appArmId(item), appId))
  const active = effectiveDeployment(run, appId)
  const config = active?.foundry
  if (!app || !active || active.ingress !== 'external' || active.targetPort !== active.listeningPort
    || !active.appSpec.routes.some((route) => route.method === config?.method && route.path === config?.path)
    || !config?.configured || config.method !== 'POST'
    || config.tokenScope !== 'https://ai.azure.com/.default' || config.sdkRetries !== 0
    || config.identity !== 'user-assigned' || !config.endpoint || !config.deployment) return false
  if (config.contract === 'brief-v1' && (!briefPolicyReady(config)
    || active.appSpec.foundry?.contract !== 'brief-v1'
    || active.appSpec.foundry?.path !== config.path
    || active.appSpec.foundry?.inputField !== config.inputField
    || active.appSpec.foundry?.outputField !== config.outputField)) return false
  const account = run.sandbox.foundryAccounts.find((item) => same(item.endpoint, config.endpoint))
  if (!account?.deployments.some((item) => same(item.name, config.deployment))) return false
  const identity = run.sandbox.managedIdentities.find((item) => same(item.id, config.identityId)
    && same(item.clientId, config.clientId) && same(item.principalId, config.principalId))
  if (!identity || !(Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]).some((id) => same(id, identity.id))) return false
  const granted = run.sandbox.roleAssignments.some((item) => same(item.scope, account.id)
    && same(item.principalId, identity.principalId) && approvedRole(item, config.contract === 'brief-v1'))
  if (!granted || config.contract !== 'brief-v1') return granted
  const registry = run.sandbox.containerRegistries.find((item) => same(item.loginServer, app.registryServer ?? app.image?.split('/')[0]))
  const pull = run.sandbox.managedIdentities.find((item) => same(item.id, app.registryIdentity))
  return !!pull && !same(pull.id, identity.id)
    && (Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]).some((id) => same(id, pull.id))
    && run.sandbox.roleAssignments.some((item) => same(item.scope, registry?.id)
      && same(item.principalId, pull.principalId) && item.roleName === 'AcrPull')
}
