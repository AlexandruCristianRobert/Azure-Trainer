import { applyRunAction } from '../labEngine/actions.js'
import { canonicalize } from '../labEngine/evidence.js'
import { isJsonValue, isPlainObject } from '../labEngine/run.js'
import { parseKubernetesYaml } from './yaml.js'
import { validateKubernetesObject } from './schema.js'
import { getDeploymentPods } from './reconcile.js'
import { inspectRequestRecords, redactRequestValue, requestDiagnosticsEnabled, validRequestDiagnostics, validContainerRequestLogs } from './request-records.js'
import { simulateIntegration } from './integration.js'
import { INTEGRATION_FIXTURES } from '../../data/fixtures/aks/integration.js'
import { validIntegrationTrace } from './state.js'

const clone = value => structuredClone(value)
const exact = (value, keys) => isPlainObject(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const same = (a, b) => canonicalize(a) === canonicalize(b)
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 512
const clock = value => Number.isSafeInteger(value) && value >= 0
const stateFor = (run, target) => run.runtime.kubernetes?.clusters?.[target?.clusterId]
const error = message => ({ code: 'AKS_DIAGNOSIS_NOT_READY', message })
const reject = (run, message) => ({ run, lines: [], diagnostics: [error(message)] })
const targetKeys = ['clusterId', 'namespace', 'deploymentName', 'serviceName']
const stableKeys = [...targetKeys, 'deploymentUid', 'serviceUid']
const secretKey = /password|secret|token|credential|api.?key|connection/i
function validRequestScenario(request, target, lab) {
  const allowed = ['kind', 'version', 'target', 'request', 'expected', 'connectivity', 'requireReplacement', 'requireTwoReplicas', 'expectedCurrentConfig', 'expectedCapturedConfig', 'integrationProfile']
  if (!isPlainObject(request) || Object.keys(request).some(key => !allowed.includes(key)) || request.kind !== 'aks-request' || request.version !== 1 || !same(request.target, target)) return false
  const http = request.request, expected = request.expected, connectivity = request.connectivity
  if (!(exact(http, ['method', 'path']) && http.method === 'GET' && http.path === '/api/info'
    || exact(http, ['method', 'path', 'body']) && http.method === 'POST' && http.path === '/api/ask' && exact(http.body, ['question'])
      && typeof http.body.question === 'string' && (http.body.question.trim() === '' || Object.hasOwn(INTEGRATION_FIXTURES.questions, http.body.question)))) return false
  if (!isPlainObject(expected) || !Object.hasOwn(expected, 'body') || Object.keys(expected).some(key => !['status', 'body', 'transport', 'route'].includes(key))
    || expected.status !== null && (!Number.isInteger(expected.status) || expected.status < 100 || expected.status > 599)
    || expected.transport !== undefined && (!exact(expected.transport, ['ok', 'reason']) || typeof expected.transport.ok !== 'boolean' || expected.transport.reason !== null && !text(expected.transport.reason))
    || expected.status === null && expected.transport?.ok !== false
    || expected.route !== undefined && (!exact(expected.route, ['selectedCount']) || !Number.isSafeInteger(expected.route.selectedCount) || expected.route.selectedCount < 0)) return false
  if (!isPlainObject(connectivity) || !Number.isInteger(connectivity.port) || connectivity.port < 1 || connectivity.port > 65535) return false
  const internal = exact(connectivity, ['origin', 'hostname', 'port']) && text(connectivity.hostname) && exact(connectivity.origin, ['kind', 'name', 'namespace'])
    && connectivity.origin.kind === 'diagnostic' && connectivity.origin.name === 'diagnostics' && connectivity.origin.namespace === 'diagnostics'
  const external = exact(connectivity, ['origin', 'service', 'port']) && exact(connectivity.origin, ['kind']) && connectivity.origin.kind === 'external'
    && exact(connectivity.service, ['name', 'namespace']) && connectivity.service.name === target.serviceName && connectivity.service.namespace === target.namespace
  return (internal || external) && (request.integrationProfile === undefined || lab.capabilities.kubernetesAiIntegration === true
    && ['healthy', 'embedding-throttle-once', 'postgres-unavailable-once', 'answer-unavailable-always', 'embedding-timeout-always', 'retry-after-too-long'].includes(request.integrationProfile))
}
export function diagnosisDigest(value) {
  let hash = 2166136261
  for (const c of canonicalize(value)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function validScenario(scenario, lab) {
  if (!isPlainObject(scenario) || !isJsonValue(scenario) || Object.keys(scenario).some(key => !['kind', 'version', 'target', 'investigationArea', 'phases', 'controlledProbe'].includes(key))
    || scenario.kind !== 'aks-diagnosis' || scenario.version !== 1 || !exact(scenario.target, targetKeys) || !Object.values(scenario.target).every(text)
    || !text(scenario.investigationArea) || !Array.isArray(scenario.phases) || scenario.phases.length < 1 || scenario.phases.length > 10
    || new Set(scenario.phases.map(phase => phase?.id)).size !== scenario.phases.length) return false
  for (const phase of scenario.phases) {
    if (!exact(phase, ['id', 'edits', 'commands', 'observationScenarioId', 'recoveryScenarioId']) || !text(phase.id)
      || !Array.isArray(phase.edits) || phase.edits.length < 1 || phase.edits.length > 10 || new Set(phase.edits.map(edit => edit?.path)).size !== phase.edits.length
      || !phase.edits.every(edit => exact(edit, ['path', 'before', 'after']) && text(edit.path) && typeof edit.before === 'string' && typeof edit.after === 'string'
        && edit.before !== edit.after && edit.before.length <= 65536 && edit.after.length <= 65536)
      || !Array.isArray(phase.commands) || phase.commands.length < 1 || phase.commands.length > 12
      || !phase.commands.every(command => phase.edits.some(edit => command === `kubectl apply -f ${edit.path}`)
        || command === `kubectl rollout restart deployment/${scenario.target.deploymentName} -n ${scenario.target.namespace}`)
      || !phase.edits.every(edit => phase.commands.includes(`kubectl apply -f ${edit.path}`))) return false
    for (const id of [phase.observationScenarioId, phase.recoveryScenarioId]) {
      const request = lab?.scenarios?.[id]
      if (!text(id) || !validRequestScenario(request, scenario.target, lab)
        || !lab.tasks?.some(task => task.verification?.scenarioId === id && task.verification.scenarioVersion === 1)) return false
    }
  }
  const probe = scenario.controlledProbe
  return probe === undefined || exact(probe, ['kind', 'labId', 'phaseId', 'servicePort']) && probe.kind === 'isolated-port-repair'
    && probe.labId === 'aks-diagnosis-troubleshooting' && lab?.id === probe.labId
    && scenario.phases.some(phase => phase.id === probe.phaseId) && (probe.servicePort === 'http' || Number.isInteger(probe.servicePort) && probe.servicePort >= 1 && probe.servicePort <= 65535)
}
function scenarioFor(run, id, lab) {
  const scenario = lab?.scenarios?.[id]
  return lab?.capabilities?.kubernetesDiagnostics === true && lab.capabilities.kubernetesConnectivity === true
    && requestDiagnosticsEnabled(run) && lab.id === run.labId && text(id) && validScenario(scenario, lab) ? clone(scenario) : null
}
function stableTarget(run, target) {
  const resources = stateFor(run, target)?.resources
  const deployment = resources?.[`Deployment/${target.namespace}/${target.deploymentName}`]
  const service = resources?.[`Service/${target.namespace}/${target.serviceName}`]
  return deployment && service ? { ...target, deploymentUid: deployment.metadata.uid, serviceUid: service.metadata.uid } : null
}
const liveTarget = (run, target) => { const live = stableTarget(run, Object.fromEntries(targetKeys.map(key => [key, target[key]]))); return live && same(live, target) }
export function diagnosisIncidentActive(run) { return Object.values(run.runtime.kubernetes?.clusters ?? {}).some(state => state.diagnosis?.incident?.active === true) }
function busy(run) {
  return !!run.runtime.activeScenario || Object.values(run.runtime.kubernetes?.clusters ?? {}).some(state => state.health?.experiment?.status === 'active'
    || ['warming', 'running'].includes(state.resourcesRuntime?.experiment?.phase) || state.rollouts?.experiment?.status === 'active')
}
function fingerprints(run, target) {
  const state = stateFor(run, target)
  return { saved: diagnosisDigest(run.project.savedFiles), applied: diagnosisDigest(Object.values(state.resources).filter(object => ['Deployment', 'Service', 'ConfigMap', 'Secret'].includes(object.kind))) }
}
function draftsAgree(run) { return Object.keys(run.project.savedFiles).every(path => run.project.draftFiles[path] === run.project.savedFiles[path]) }
function partial(desired, live) {
  if (Array.isArray(desired)) return Array.isArray(live) && desired.length === live.length && desired.every((value, index) => partial(value, live[index]))
  if (isPlainObject(desired)) return isPlainObject(live) && Object.entries(desired).every(([key, value]) => partial(value, live[key]))
  return desired === live
}
function filesApplied(run, target, lab) {
  const state = stateFor(run, target), deployments = Object.values(state.resources).filter(object => ['Deployment', 'HorizontalPodAutoscaler'].includes(object.kind))
  for (const [path, content] of Object.entries(run.project.savedFiles)) {
    if (!/^k8s\/.*\.ya?ml$/.test(path)) continue
    const parsed = parseKubernetesYaml(content, path)
    if (parsed.diagnostics.length) return false
    for (const document of parsed.documents) {
      const validated = validateKubernetesObject(document, { namespace: target.namespace, capabilities: { deployments, ...lab.capabilities } })
      if (validated.diagnostics.length) return false
      const object = validated.object, live = state.resources[`${object.kind}/${object.metadata.namespace ?? ''}/${object.metadata.name}`]
      if (!live || !partial(object, live)) return false
    }
  }
  return true
}
function healthy(run, target) {
  const state = stateFor(run, target), pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
  const deployment = state?.resources[`Deployment/${target.namespace}/${target.deploymentName}`]
  return deployment && pods.length === deployment.spec.replicas && pods.length > 0 && Object.keys(state.projectionDue).length === 0
    && pods.every(pod => !pod.metadata.deletionTimestamp && pod.status.phase === 'Running' && state.health?.containers?.[pod.metadata.uid]?.ready === true)
}
function stage(run, scenario, phase, lab) {
  if (!draftsAgree(run) || !phase.edits.every(edit => run.project.savedFiles[edit.path] === edit.before)) return reject(run, 'Save all drafts and restore the declared fixture preconditions before introducing this phase.')
  let candidate = clone(run); const lines = [{ kind: 'out', text: `Diagnosis investigation: ${scenario.investigationArea}` }]
  try {
    for (const edit of phase.edits) {
      const saved = applyRunAction(candidate, { type: 'save-file', path: edit.path, text: edit.after }, lab)
      if (saved.diagnostics.length) return reject(run, 'The declared fixture file could not be saved.')
      candidate = saved.run
      lines.push({ kind: 'out', text: `Saved declared diagnosis edit: ${edit.path}`, change: { path: edit.path, before: redactRequestValue(edit.before, stateFor(run, scenario.target)), after: redactRequestValue(edit.after, stateFor(candidate, scenario.target)) } })
    }
    for (const command of phase.commands) {
      const applied = applyRunAction(candidate, { type: 'command', line: command }, lab)
      if (applied.diagnostics.length || applied.lines.some(line => line.kind === 'err')) return reject(run, 'The declared fixture command could not be applied.')
      candidate = applied.run; lines.push({ kind: 'out', text: command }, ...applied.lines)
    }
  } catch { return reject(run, 'The declared fixture failed save or command validation.') }
  return { run: candidate, lines: redactRequestValue(redactRequestValue(lines, stateFor(candidate, scenario.target)), stateFor(run, scenario.target)), diagnostics: [] }
}
function receipt(run, incident, kind, observationId = null) {
  const state = stateFor(run, incident.target)
  state.diagnosis.receipts = [...state.diagnosis.receipts, { id: `diagnosis-receipt-${run.nextSequence++}`, incidentId: incident.id,
    epoch: incident.epoch, labId: incident.labId, attemptId: incident.attemptId, target: clone(incident.target), phaseId: incident.phaseId,
    kind, simTimeMs: run.runtime.simTimeMs, observationId }].slice(-40)
}
export function startDiagnosisIncident(run, scenarioId, lab) {
  const scenario = scenarioFor(run, scenarioId, lab), target = scenario && stableTarget(run, scenario.target)
  if (!scenario || !target || busy(run) || diagnosisIncidentActive(run) || stateFor(run, target).diagnosis?.incident || !healthy(run, target) || !draftsAgree(run) || !filesApplied(run, target, lab))
    return reject(run, 'Diagnosis requires a declared fixture, saved/applied stable healthy baseline, and no active experiment.')
  const baselineHashes = fingerprints(run, target), applied = stage(run, scenario, scenario.phases[0], lab)
  if (applied.diagnostics.length) return applied
  const candidate = applied.run, state = stateFor(candidate, target), epoch = candidate.nextSequence++
  state.diagnosis ??= { version: 1, incident: null, receipts: [] }
  state.diagnosis.incident = { id: `diagnosis-${scenarioId}-${epoch}`, epoch, labId: run.labId, attemptId: run.attemptId, target,
    phaseId: scenario.phases[0].id, startedAtMs: run.runtime.simTimeMs, baselineHashes, observations: [], recoveries: [], active: true }
  receipt(candidate, state.diagnosis.incident, 'started')
  return applied
}
function incidentFor(run, scenarioId, lab) {
  const scenario = scenarioFor(run, scenarioId, lab), incident = scenario && stateFor(run, scenario.target)?.diagnosis?.incident
  if (!incident || incident.labId !== lab.id || incident.attemptId !== run.attemptId || incident.id !== `diagnosis-${scenarioId}-${incident.epoch}`
    || !same(Object.fromEntries(targetKeys.map(key => [key, incident.target[key]])), scenario.target)) return null
  return { scenario, incident, phase: scenario.phases.find(phase => phase.id === incident.phaseId) }
}
function currentEvidence(run, scenarioId, lab) {
  const task = lab.tasks.find(task => task.verification?.scenarioId === scenarioId), id = run.evidence.currentEvidenceByTask[task?.id]
  const evidence = run.evidence.experimentsById[id]
  if (!evidence || evidence.attemptId !== run.attemptId || evidence.labId !== run.labId || evidence.scenarioId !== scenarioId || evidence.outcome !== 'passed' || !evidence.completed) return null
  for (const [key, selector] of Object.entries(task.dependencies ?? {})) {
    if (evidence.dependencyGenerations[key] !== (run.dependencyGenerations[key] ?? 0) || !same(evidence.dependencyValues[key], selector(run))) return null
  }
  return evidence
}
export function advanceDiagnosisIncident(run, scenarioId, lab) {
  const found = incidentFor(run, scenarioId, lab)
  if (!found?.incident.active || !found.phase || !liveTarget(run, found.incident.target) || busy(run)) return reject(run, 'The current diagnosis target or phase is unavailable.')
  const { incident, scenario, phase } = found, current = fingerprints(run, incident.target), proof = currentEvidence(run, phase.recoveryScenarioId, lab)
  if (!incident.observations.some(item => item.phaseId === phase.id) || !proof || !incident.recoveries.some(item => item.phaseId === phase.id && item.evidenceId === proof.id && same(item.fingerprint, current))
    || !draftsAgree(run) || !healthy(run, incident.target) || !filesApplied(run, incident.target, lab)) return reject(run, 'Observe the real failure and Verify a healthy saved/applied repair of this phase before advancing.')
  const following = scenario.phases[scenario.phases.findIndex(item => item.id === phase.id) + 1]
  const applied = following ? stage(run, scenario, following, lab) : { run: clone(run), lines: [{ kind: 'out', text: 'All diagnosis phases recovered.' }], diagnostics: [] }
  if (applied.diagnostics.length) return applied
  const next = stateFor(applied.run, incident.target).diagnosis.incident
  if (following) next.phaseId = following.id
  else next.active = false
  receipt(applied.run, next, following ? 'advanced' : 'completed')
  return applied
}
function capsuleFor(run, target, request) {
  const state = stateFor(run, target), pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
  const podUid = request.podUid ?? request.route.readyEndpointUids?.slice().sort()[0] ?? pods.filter(pod => state.health?.containers[pod.metadata.uid]?.ready).map(pod => pod.metadata.uid).sort()[0]
  const snapshot = state.podSnapshots[podUid], containerId = state.health?.containers[podUid]?.containerId
  if (!snapshot || !containerId) return null
  const environment = Object.fromEntries(Object.entries(snapshot.environment).filter(([key]) => !secretKey.test(key) && !snapshot.configRefs?.some(ref => ref.kind === 'Secret' && ref.mode === 'env' && ref.target === key)))
  const authProfile = Object.entries(INTEGRATION_FIXTURES.profiles).find(([, profile]) => snapshot.environment.PGPASSWORD === profile.PGPASSWORD)?.[0] ?? null
  const files = Object.fromEntries(Object.entries(snapshot.files).filter(([path]) => path.startsWith('/')))
  const ports = Object.values(state.resources ?? {}).find(pod => pod.kind === 'Pod' && pod.metadata.uid === podUid)?.spec.containers[0].ports ?? []
  return redactRequestValue({ podUid, containerId, artifactId: snapshot.artifactId, environment, files, authProfile,
    ports: ports.map(port => ({ name: port.name ?? null, containerPort: port.containerPort })) }, state)
}
export function captureDiagnosisObservation(run, scenarioId, outcome, lab) {
  const outcomeKeys = ['requestId', 'podUid', 'containerId', 'artifactId', 'transport', 'status', 'body', 'route', 'dependencyTrace', 'integrationTrace', 'diagnostic', 'appLogRecords', 'workload']
  if (!isPlainObject(outcome) || !isJsonValue(outcome) || Object.keys(outcome).some(key => !outcomeKeys.includes(key)) || typeof outcome.requestId !== 'string') return run
  const entry = Object.entries(lab?.scenarios ?? {}).find(([id]) => {
    const found = incidentFor(run, id, lab)
    return found?.incident.active && [found.phase?.observationScenarioId, found.phase?.recoveryScenarioId].includes(scenarioId)
  })
  if (!entry) return run
  const found = incidentFor(run, entry[0], lab), { incident, phase } = found
  if (!liveTarget(run, incident.target)) return run
  const records = inspectRequestRecords(run, { clusterId: incident.target.clusterId, requestId: outcome.requestId }), request = records.request
  const evidence = currentEvidence(run, scenarioId, lab)
  if (!request || request.scenarioId !== scenarioId || request.route.serviceUid !== incident.target.serviceUid || !evidence || evidence.measurements.requestSequence !== request.sequence
    || request.simTimeMs < incident.startedAtMs) return run
  for (const key of ['podUid', 'containerId', 'artifactId', 'transport', 'status', 'body', 'dependencyTrace', 'integrationTrace']) {
    if (Object.hasOwn(outcome, key) && !same(outcome[key], request[key] ?? null)) return run
  }
  if (outcome.route && !partial(outcome.route, request.route)) return run
  const failed = !request.transport.ok || request.status >= 400
  const kind = scenarioId === phase.observationScenarioId && failed ? 'failure' : scenarioId === phase.recoveryScenarioId && request.transport.ok && request.status === 200 ? 'recovery' : null
  if (!kind) return run
  const list = kind === 'failure' ? 'observations' : 'recoveries'
  if (incident[list].some(item => item.records.request.id === request.id)) return run
  const candidate = clone(run), next = stateFor(candidate, incident.target).diagnosis.incident
  const snapshot = { id: `diagnosis-observation-${candidate.nextSequence++}`, incidentId: incident.id, epoch: incident.epoch, labId: run.labId, attemptId: run.attemptId,
    target: clone(incident.target), phaseId: phase.id, scenarioId, simTimeMs: request.simTimeMs, historical: true, kind,
    records, capsule: capsuleFor(run, incident.target, request), fingerprint: fingerprints(run, incident.target), evidenceId: evidence.id }
  snapshot.hash = diagnosisDigest(snapshot)
  // Keep the first observation of each phase; repeated investigation cannot
  // evict a required earlier phase when ordinary histories rotate.
  const all = [...next[list], snapshot]
  const primary = all.filter((item, index, items) => (kind === 'failure'
    ? items.findIndex(other => other.phaseId === item.phaseId)
    : items.findLastIndex(other => other.phaseId === item.phaseId)) === index)
  const rest = all.filter(item => !primary.includes(item))
  const slots = 10 - primary.length
  next[list] = [...primary, ...(slots > 0 ? rest.slice(-slots) : [])].sort((a, b) => Number(a.id.slice(22)) - Number(b.id.slice(22)))
  const retainedIds = new Set([...next.observations, ...next.recoveries].map(item => item.id))
  for (const item of stateFor(candidate, incident.target).diagnosis.receipts) if (item.observationId !== null && !retainedIds.has(item.observationId)) item.observationId = null
  receipt(candidate, next, kind, next[list].some(item => item.id === snapshot.id) ? snapshot.id : null)
  return candidate
}

/** Only the existing explicit AKS clock invokes this lifecycle transition. */
export function refreshDiagnosisIncidents(run, lab) {
  if (lab?.capabilities?.kubernetesDiagnostics !== true) return run
  let candidate = run
  for (const state of Object.values(run.runtime.kubernetes.clusters)) {
    const incident = state.diagnosis?.incident
    if (incident?.active && !liveTarget(run, incident.target)) {
      if (candidate === run) candidate = clone(run)
      const next = stateFor(candidate, incident.target).diagnosis.incident
      next.active = false
      receipt(candidate, next, 'target-deleted')
    }
  }
  return candidate
}

function retained(run, observationId, lab) {
  if (typeof observationId !== 'string' || lab?.id !== run.labId || lab.capabilities?.kubernetesDiagnostics !== true) return null
  for (const [id] of Object.entries(lab.scenarios ?? {})) {
    const found = incidentFor(run, id, lab)
    if (!found) continue
    const snapshot = [...found.incident.observations, ...found.incident.recoveries].find(item => item.id === observationId)
    if (snapshot && snapshot.epoch === found.incident.epoch && snapshot.labId === run.labId && snapshot.attemptId === run.attemptId
      && same(snapshot.target, found.incident.target) && validSnapshot(snapshot, found.incident, found.scenario, run, lab)) return { ...found, snapshot: clone(snapshot) }
  }
  return null
}
export function replayDiagnosisObservation(run, observationId, lab) {
  const found = retained(run, observationId, lab)
  return found ? { snapshot: found.snapshot, diagnostics: [] } : { snapshot: null, diagnostics: [error('Select a retained observation from this Lab attempt, incident epoch and target.')] }
}
export function probeIncidentSnapshot(run, observationId, lab) {
  const found = retained(run, observationId, lab), probe = found?.scenario.controlledProbe, snapshot = found?.snapshot
  if (!probe || snapshot.phaseId !== probe.phaseId || snapshot.kind !== 'failure' || snapshot.records.request.transport.reason !== 'CONNECTION_REFUSED'
    || !snapshot.capsule || lab.id !== probe.labId) return { snapshot: null, diagnostics: [error('Only the declared Lab23 isolated Service port repair is available.')] }
  const capsule = snapshot.capsule, app = run.artifacts.buildsById[capsule.artifactId]?.appSpec
  const deployment = lab.scenarios[snapshot.scenarioId].target
  const edit = found.scenario.phases.find(phase => phase.id === probe.phaseId).edits.find(edit => parseKubernetesYaml(edit.before, edit.path).documents.some(object => object?.kind === 'Service' && object.metadata?.name === deployment.serviceName && object.metadata?.namespace === deployment.namespace))
  const service = edit && parseKubernetesYaml(edit.before, edit.path).documents.find(object => object?.kind === 'Service' && object.metadata?.name === deployment.serviceName)
  if (!app || !service || service.spec.ports[0].targetPort !== probe.servicePort) return { snapshot: null, diagnostics: [error('The isolated repair must be the immutable declared Service port.')] }
  const requestId = `snapshot-${snapshot.id}-port-repair`
  const backendPort = Number.isInteger(probe.servicePort) ? probe.servicePort : capsule.ports.find(port => port.name === probe.servicePort)?.containerPort ?? null
  if (backendPort !== app.listeningPort) return { snapshot: { historical: true, observationId, requestId, backendPort, status: null, body: null,
    transport: { ok: false, reason: backendPort === null ? 'NAMED_PORT_UNRESOLVED' : 'CONNECTION_REFUSED' }, correctedServicePort: probe.servicePort,
    dependencyTrace: [], integrationTrace: null, application: [] }, diagnostics: [] }
  const environment = { ...capsule.environment, PGPASSWORD: capsule.authProfile ? INTEGRATION_FIXTURES.profiles[capsule.authProfile].PGPASSWORD : '[UNAVAILABLE]' }
  const result = simulateIntegration(app, { environment, files: clone(capsule.files) }, { ...clone(snapshot.records.request.request), requestId }, INTEGRATION_FIXTURES,
    lab.scenarios[snapshot.scenarioId].integrationProfile ?? 'healthy')
  return { snapshot: redactRequestValue({ historical: true, observationId, requestId, backendPort, status: result.status, body: result.body,
    transport: { ok: true, reason: null }, correctedServicePort: probe.servicePort, dependencyTrace: result.dependencyTrace, integrationTrace: result.integrationTrace ?? null,
    application: result.appLogRecords ?? [] }, stateFor(run, snapshot.target)), diagnostics: [] }
}

const validHashes = value => exact(value, ['saved', 'applied']) && Object.values(value).every(hash => /^[a-f0-9]{8}$/.test(hash))
const snapshotKeys = ['id', 'incidentId', 'epoch', 'labId', 'attemptId', 'target', 'phaseId', 'scenarioId', 'simTimeMs', 'historical', 'kind', 'records', 'capsule', 'fingerprint', 'evidenceId', 'hash']
const requestKeys = ['id', 'sequence', 'connectivity', 'scenarioId', 'transport', 'status', 'route', 'namespace', 'dependencyTrace', 'origin', 'hostname', 'port', 'integrationTrace', 'request', 'requestId', 'clusterId', 'podUid', 'containerId', 'artifactId', 'simTimeMs', 'diagnosticsVersion', 'requestElapsedMs', 'body', 'dependencyRecords', 'dependencyTruncated']
const routeKeys = ['serviceName', 'namespace', 'serviceUid', 'clusterIP', 'externalIP', 'selectedCount', 'endpointUids', 'readyEndpointUids', 'address', 'backendPort', 'podUid', 'podName', 'artifactId', 'containerId', 'originKind', 'originPodUid', 'hostname', 'canonicalName', 'servicePort', 'targetPort', 'listenerPort']
function boundTo(value, incident) { return value.incidentId === incident.id && value.epoch === incident.epoch && value.labId === incident.labId && value.attemptId === incident.attemptId && same(value.target, incident.target) }
function validSnapshot(value, incident, scenario, run, lab) {
  if (!exact(value, snapshotKeys) || !/^diagnosis-observation-[1-9]\d*$/.test(value.id) || Number(value.id.slice(22)) >= run.nextSequence
    || !boundTo(value, incident) || !clock(value.simTimeMs) || value.simTimeMs < incident.startedAtMs || value.simTimeMs > run.runtime.simTimeMs
    || value.historical !== true || !['failure', 'recovery'].includes(value.kind) || !validHashes(value.fingerprint) || !text(value.evidenceId)) return false
  const phase = scenario.phases.find(phase => phase.id === value.phaseId)
  if (!phase || value.scenarioId !== (value.kind === 'failure' ? phase.observationScenarioId : phase.recoveryScenarioId)) return false
  const { hash, ...payload } = value
  if (hash !== diagnosisDigest(payload) || !exact(value.records, ['request', 'application', 'dependency', 'truncated'])) return false
  const records = value.records, request = records.request, state = stateFor(run, incident.target)
  if (!isPlainObject(request) || Object.keys(request).some(key => ![...requestKeys, 'workload'].includes(key)) || !requestKeys.every(key => Object.hasOwn(request, key))
    || request.connectivity !== true || !exact(request.transport, ['ok', 'reason']) || typeof request.transport.ok !== 'boolean' || request.transport.reason !== null && !text(request.transport.reason)
    || !isPlainObject(request.origin) || !isPlainObject(request.route) || Object.keys(request.route).some(key => !routeKeys.includes(key))
    || request.scenarioId !== value.scenarioId || request.clusterId !== incident.target.clusterId || request.route?.serviceUid !== incident.target.serviceUid
    || request.namespace !== incident.target.namespace || request.route.serviceName !== incident.target.serviceName || request.route.namespace !== incident.target.namespace
    || !same(request.request, redactRequestValue(lab.scenarios[value.scenarioId].request, state))
    || request.integrationTrace !== null && !validIntegrationTrace(request.integrationTrace)
    || request.status !== null && (!Number.isInteger(request.status) || request.status < 100 || request.status > 599)
    || request.simTimeMs !== value.simTimeMs || !Number.isSafeInteger(request.sequence) || request.sequence >= run.nextSequence || request.sequence <= incident.epoch
    || !same(records, redactRequestValue(records, state)) || !Array.isArray(records.application) || records.application.length > 100
    || !same(records.dependency, request.dependencyRecords) || !exact(records.truncated, ['requests', 'application', 'dependency']) || !Object.values(records.truncated).every(clock)
    || value.kind === 'failure' && request.transport?.ok && !(request.status >= 400)
    || value.kind === 'recovery' && (!request.transport?.ok || request.status !== 200)) return false
  const historicalState = { ...state, health: { containers: {} }, connectivity: { ...state.connectivity, diagnosticPodUids: request.origin.kind === 'pod' ? [request.origin.podUid] : [] } }
  const historicalRun = { ...run, runtime: { ...run.runtime, kubernetes: { ...run.runtime.kubernetes, requests: [request], clusters: { ...run.runtime.kubernetes.clusters, [incident.target.clusterId]: historicalState } } } }
  if (!validRequestDiagnostics(request, historicalRun)) return false
  const capsule = value.capsule
  if (capsule !== null && (!exact(capsule, ['podUid', 'containerId', 'artifactId', 'environment', 'files', 'authProfile', 'ports'])
    || !/^kube-[1-9]\d*$/.test(capsule.podUid) || !/^container-[1-9]\d*$/.test(capsule.containerId) || !run.artifacts.buildsById[capsule.artifactId]
    || !isPlainObject(capsule.environment) || Object.keys(capsule.environment).some(key => secretKey.test(key)) || !Object.values(capsule.environment).every(value => typeof value === 'string')
    || !isPlainObject(capsule.files) || !Object.values(capsule.files).every(value => typeof value === 'string') || ![null, 'training', 'review'].includes(capsule.authProfile)
    || !Array.isArray(capsule.ports) || capsule.ports.length > 10 || !capsule.ports.every(port => exact(port, ['name', 'containerPort']) && (port.name === null || text(port.name))
      && Number.isInteger(port.containerPort) && port.containerPort >= 1 && port.containerPort <= 65535)
    || !same(capsule, redactRequestValue(capsule, state)))) return false
  if (request.transport.ok && (!capsule || ['podUid', 'containerId', 'artifactId'].some(key => capsule[key] !== request[key]))) return false
  if (!request.transport.ok) return records.application.length === 0
  historicalState.resources = { ...state.resources, [`Pod/${request.namespace}/retained`]: { kind: 'Pod', metadata: { uid: request.podUid, namespace: request.namespace } } }
  historicalState.podSnapshots = { ...state.podSnapshots, [request.podUid]: { artifactId: request.artifactId,
    environment: { PGPASSWORD: capsule.authProfile ? INTEGRATION_FIXTURES.profiles[capsule.authProfile].PGPASSWORD : '' },
    configRefs: [{ kind: 'Secret', mode: 'env', target: 'PGPASSWORD' }] } }
  return validContainerRequestLogs({ containerId: request.containerId, currentLogs: records.application }, request.podUid, historicalState, historicalRun, incident.target.clusterId)
}
export function validDiagnosisState(value, run, lab, clusterId) {
  if (value === undefined) return true
  if (!requestDiagnosticsEnabled(run) || lab?.capabilities?.kubernetesDiagnostics !== true || !exact(value, ['version', 'incident', 'receipts']) || value.version !== 1
    || !Array.isArray(value.receipts) || value.receipts.length > 40) return false
  if (value.incident === null) return value.receipts.length === 0
  const incident = value.incident
  if (!exact(incident, ['id', 'epoch', 'labId', 'attemptId', 'target', 'phaseId', 'startedAtMs', 'baselineHashes', 'observations', 'recoveries', 'active'])
    || !Number.isSafeInteger(incident.epoch) || incident.epoch < 1 || incident.epoch >= run.nextSequence || incident.labId !== run.labId || incident.labId !== lab.id || incident.attemptId !== run.attemptId
    || !exact(incident.target, stableKeys) || !Object.values(incident.target).every(text) || incident.target.clusterId !== clusterId
    || !clock(incident.startedAtMs) || incident.startedAtMs > run.runtime.simTimeMs || !validHashes(incident.baselineHashes) || typeof incident.active !== 'boolean') return false
  const entry = Object.entries(lab.scenarios ?? {}).find(([id]) => incident.id === `diagnosis-${id}-${incident.epoch}`), scenario = entry && scenarioFor(run, entry[0], lab)
  if (!scenario || !same(scenario.target, Object.fromEntries(targetKeys.map(key => [key, incident.target[key]]))) || !scenario.phases.some(phase => phase.id === incident.phaseId)) return false
  const snapshots = []
  for (const [key, kind] of [['observations', 'failure'], ['recoveries', 'recovery']]) {
    if (!Array.isArray(incident[key]) || incident[key].length > 10 || !incident[key].every(item => item.kind === kind && validSnapshot(item, incident, scenario, run, lab))) return false
    snapshots.push(...incident[key])
  }
  if (new Set(snapshots.map(item => item.id)).size !== snapshots.length || new Set(snapshots.map(item => item.records.request.id)).size !== snapshots.length) return false
  let previous = 0
  return value.receipts.every(item => {
    if (!exact(item, ['id', 'incidentId', 'epoch', 'labId', 'attemptId', 'target', 'phaseId', 'kind', 'simTimeMs', 'observationId']) || !/^diagnosis-receipt-[1-9]\d*$/.test(item.id)
      || !boundTo(item, incident) || !scenario.phases.some(phase => phase.id === item.phaseId) || !['started', 'advanced', 'completed', 'target-deleted', 'failure', 'recovery'].includes(item.kind)
      || !clock(item.simTimeMs) || item.simTimeMs < incident.startedAtMs || item.simTimeMs > run.runtime.simTimeMs
      || item.observationId !== null && !snapshots.some(snapshot => snapshot.id === item.observationId && snapshot.phaseId === item.phaseId && snapshot.kind === item.kind)) return false
    const sequence = Number(item.id.slice(18))
    if (sequence <= previous || sequence >= run.nextSequence) return false
    previous = sequence; return true
  })
}
