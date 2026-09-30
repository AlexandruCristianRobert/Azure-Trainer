import { presentContainerApp } from '../az/containerapps-arm.js'

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
const copy = (value) => structuredClone(value)
const issue = (code, message) => ({ code, message })

export function appArmId(app) { return presentContainerApp(app).id }
export function deploymentFor(run, appId) { return run.runtime.deploymentsByApp[appId] ?? null }
export function activeDeployment(run, appId) { return deploymentFor(run, appId)?.active ?? null }
export function effectiveDeployment(run, appId) {
  const active = activeDeployment(run, appId)
  const app = run.sandbox.containerApps.find(item => appArmId(item).toLowerCase() === appId.toLowerCase())
  const drift = app?.incidentDrift
  return active && drift ? { ...active, generation: drift.effectiveGeneration,
    foundry: { ...active.foundry, deployment: drift.effectiveDeployment } } : active
}
export function hasPublishedImage(run, image) {
  const reference = normalizeImageReference(image)
  return reference !== null && Object.hasOwn(run.artifacts.publishedTags, reference)
}

export function normalizeImageReference(image) {
  const parsed = /^([a-z0-9]+\.azurecr\.io)\/([a-z0-9][a-z0-9._/-]*):([A-Za-z0-9_][A-Za-z0-9_.-]*)$/i.exec(image ?? '')
  return parsed ? `${parsed[1].toLowerCase()}/${parsed[2].toLowerCase()}:${parsed[3]}` : null
}

function desiredFor(app) {
  return { image: app.image, ingress: app.ingress, targetPort: app.targetPort, env: copy(app.envVars ?? {}),
    userAssigned: app.userAssigned ?? null, registryIdentity: app.registryIdentity ?? null, registryServer: app.registryServer ?? null,
    scalePolicy: { cpu: app.cpu ?? 0.5, memory: app.memory ?? '1Gi', minReplicas: app.minReplicas,
      maxReplicas: app.maxReplicas, scaleRules: copy(app.scaleRules ?? []) },
    ...(app.probes !== undefined ? { probeConfig: { probes: copy(app.probes), minReplicas: app.minReplicas,
      maxReplicas: app.maxReplicas, cpu: app.cpu, memory: app.memory } } : {}) }
}

function normalizedProbeConfig(config) {
  if (!config) return null
  return { ...config, probes: [...config.probes].sort((a, b) => a.type.localeCompare(b.type)) }
}

function foundryCapture(run, app, artifact) {
  if (!artifact.appSpec.foundry) return null
  const ids = Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]
  const identity = run.sandbox.managedIdentities.find((entry) => ids.some((id) => same(id, entry.id))
    && same(entry.clientId, app.envVars?.AZURE_CLIENT_ID))
  return { ...copy(artifact.appSpec.foundry), identityId: identity?.id ?? null,
    clientId: identity?.clientId ?? app.envVars?.AZURE_CLIENT_ID ?? null, principalId: identity?.principalId ?? null }
}

function equivalentDeployment(left, right) {
  return left?.artifactId === right?.artifactId && normalizeImageReference(left?.image) === normalizeImageReference(right?.image)
    && left?.ingress === right?.ingress && left?.targetPort === right?.targetPort
    && JSON.stringify(Object.entries(left?.env ?? {}).sort(([a], [b]) => a.localeCompare(b)))
      === JSON.stringify(Object.entries(right?.env ?? {}).sort(([a], [b]) => a.localeCompare(b)))
    && JSON.stringify(normalizedProbeConfig(left?.probeConfig)) === JSON.stringify(normalizedProbeConfig(right?.probeConfig))
    && JSON.stringify(left?.scalePolicy ?? null) === JSON.stringify(right?.scalePolicy ?? null)
}

function resolveBuild(run, app) {
  const reference = normalizeImageReference(app.image)
  if (!reference) return { diagnostics: [issue('UNSUPPORTED_IMAGE', 'The deployment requires a published simulated ACR image reference.')] }
  const registry = run.sandbox.containerRegistries.find((entry) => same(entry.loginServer, reference.split('/')[0]))
  if (!registry || (app.registryServer && !same(app.registryServer, registry.loginServer))) {
    return { diagnostics: [issue('REGISTRY_NOT_FOUND', 'The registry server is unavailable or does not match the image.')] }
  }
  const buildId = run.artifacts.publishedTags[reference]
  const artifact = buildId && run.artifacts.buildsById[buildId]
  if (!artifact || !same(artifact.image.registryId, registry.id)) return { diagnostics: [issue('IMAGE_TAG_NOT_FOUND', `Image tag '${reference}' has not been published in this registry.`)] }
  const identity = run.sandbox.managedIdentities.find((entry) => same(entry.id, app.registryIdentity))
  const attached = (Array.isArray(app.userAssigned) ? app.userAssigned : [app.userAssigned]).some((id) => same(id, identity?.id))
  const grant = run.sandbox.roleAssignments.some((entry) => same(entry.scope, registry.id) && same(entry.principalId, identity?.principalId) && entry.roleName === 'AcrPull')
  if (!identity || !attached || !grant) return { diagnostics: [issue('ACR_PULL_DENIED', 'Attach a managed identity with an explicit AcrPull grant at this registry before deploying.')] }
  return { artifact, diagnostics: [] }
}

export function reconcileDeployment(run, app, { forceActivation = false } = {}) {
  const id = appArmId(app)
  const previous = run.runtime.deploymentsByApp[id] ?? { desired: null, active: null, status: 'pending', diagnostics: [] }
  const desired = desiredFor(app)
  const { artifact, diagnostics } = resolveBuild(run, app)
  if (artifact && app.targetPort !== null && app.targetPort !== artifact.appSpec.listeningPort) {
    diagnostics.push(issue('TARGET_PORT_MISMATCH', `Ingress target port ${app.targetPort} differs from the application's listener ${artifact.appSpec.listeningPort}.`))
  }
  const runtime = copy(run.runtime)
  if (diagnostics.length) {
    runtime.deploymentsByApp[id] = { desired, active: previous.active, status: 'failed', diagnostics }
    runtime.logs = [...(runtime.logs ?? []), { appId: id, level: 'error', message: diagnostics.map((item) => item.message).join(' ') }].slice(-500)
    return { run: { ...run, runtime }, diagnostics }
  }
  const comparable = { artifactId: artifact.id, image: desired.image, ingress: desired.ingress,
    targetPort: desired.targetPort, env: desired.env, scalePolicy: desired.scalePolicy,
    ...(desired.probeConfig ? { probeConfig: desired.probeConfig } : {}),
    ...(artifact.appSpec.foundry ? { foundry: foundryCapture(run, app, artifact) } : {}) }
  if (!forceActivation && previous.active && equivalentDeployment(comparable, previous.active)) {
    runtime.deploymentsByApp[id] = { desired, active: previous.active, status: 'succeeded', diagnostics: [] }
    return { run: { ...run, runtime }, diagnostics: [] }
  }
  const sequence = run.nextSequence
  const active = { generation: `deployment-${sequence}`, artifactId: artifact.id, digest: artifact.digest,
    image: desired.image, appSpec: copy(artifact.appSpec), env: copy(desired.env), ingress: desired.ingress,
    targetPort: desired.targetPort, listeningPort: artifact.appSpec.listeningPort,
    scalePolicy: copy(desired.scalePolicy),
    ...(artifact.appSpec.foundry ? { foundry: copy(comparable.foundry) } : {}),
    ...(desired.probeConfig ? { probeConfig: copy(desired.probeConfig) } : {}) }
  runtime.deploymentsByApp[id] = { desired, active, status: 'succeeded', diagnostics: [] }
  runtime.logs = [...(runtime.logs ?? []), { appId: id, level: 'info', message: `Activated ${active.generation} from ${artifact.id}.` }].slice(-500)
  return { run: { ...run, nextSequence: sequence + 1, runtime }, diagnostics: [] }
}

export function removeDeletedDeployments(run) {
  const ids = new Set(run.sandbox.containerApps.map(appArmId))
  const runtime = copy(run.runtime)
  for (const id of Object.keys(runtime.deploymentsByApp)) if (!ids.has(id)) delete runtime.deploymentsByApp[id]
  return { ...run, runtime }
}

export function deleteRegistryPublications(run, registryIds) {
  const removed = new Set(registryIds.map((id) => id.toLowerCase()))
  const artifacts = copy(run.artifacts)
  for (const [reference, buildId] of Object.entries(artifacts.publishedTags)) {
    if (removed.has(artifacts.buildsById[buildId]?.image?.registryId?.toLowerCase())) delete artifacts.publishedTags[reference]
  }
  return { ...run, artifacts }
}
