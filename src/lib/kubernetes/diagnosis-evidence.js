import { canonicalize } from '../labEngine/evidence.js'
import { validAksRequestScenario } from './actions.js'
import { simulateKubernetesRequest } from './requests.js'
import { inspectDeploymentConsistency, releaseDependencies } from './release-evidence.js'
import { getProjectManifest } from '../project/manifests.js'
import { getDeploymentPods } from './reconcile.js'
import { redactRequestValue, requestDiagnosticsEnabled } from './request-records.js'
import { validDiagnosisEvidenceRecord, diagnosisDigest, pendingDiagnosisCaptureEvidence, probeIncidentSnapshot } from './diagnosis-incidents.js'
import { INTEGRATION_FIXTURES } from '../../data/fixtures/aks/integration.js'
import { observeDiagnosisLifecycle } from './diagnosis-lifecycle.js'
import { getRolloutSummary } from './rollouts.js'

const same = (left, right) => canonicalize(left) === canonicalize(right)
const stateFor = (run, target) => run.runtime.kubernetes.clusters[target.clusterId]

function requestProvenance(measurements, scenario) {
  if (!measurements.transport?.ok) return measurements.status === null && !measurements.podUid && measurements.dependencyTrace.length === 0
  if (!measurements.podUid || !measurements.artifactId) return false
  if (scenario.request.method !== 'POST') return true
  const trace = measurements.integrationTrace, operations = measurements.dependencyTrace
  if (trace?.fixtureVersion !== INTEGRATION_FIXTURES.version || trace.profileId !== (scenario.integrationProfile ?? 'healthy')) return false
  if (scenario.expected.status === 400) return trace.inputDisposition === 'rejected' && operations.length === 0 && trace.attempts.length === 0
  if (scenario.expected.status !== 200) {
    const failed = operations.findIndex(item => item.status === 'failed')
    const stages = ['embedding', 'postgres-query', 'answer'], failureStage = operations[failed]?.operation
    const requiredStage = scenario.integrationProfile === 'answer-unavailable-always' ? 'answer'
      : ['embedding-timeout-always', 'retry-after-too-long'].includes(scenario.integrationProfile) ? 'embedding'
        : /^POSTGRES_|^(VECTOR_DIMENSION|QUERY_PARAMETERS)$/.test(scenario.expected.body?.code ?? '') ? 'postgres-query' : failureStage
    const index = stages.indexOf(requiredStage)
    if (failed !== index || index < 0 || !same(operations.map(item => [item.operation, item.status]),
      stages.slice(0, index + 1).map((operation, position) => [operation, position === index ? 'failed' : 'succeeded']))) return false
    if (index >= 1 && trace.vectorProvenance !== 'embedding') return false
    // Source IDs are emitted only by a successful return. At answer failure,
    // authenticate the real retrieved rows used to construct its context.
    return index < 2 || trace.queryBindings?.published === true && trace.selectedIds.length > 0 && same(trace.contextIds, trace.selectedIds)
  }
  const sources = measurements.body?.sources
  if (scenario.expected.body?.answer === 'No matching documents.' && Array.isArray(sources) && sources.length === 0)
    return trace.vectorProvenance === 'embedding' && trace.queryBindings?.published === true && trace.selectedIds.length === 0
      && same(operations.map(item => [item.operation, item.status]), [['embedding', 'succeeded'], ['postgres-query', 'succeeded']])
      && trace.attempts.every(item => item.operation !== 'answer')
  return trace.vectorProvenance === 'embedding' && trace.sourceProvenance === 'rows' && trace.queryBindings?.published === true
    && same(trace.selectedIds, sources) && same(trace.contextIds, sources)
    && ['embedding', 'postgres-query', 'answer'].every(operation => operations.some(item => item.operation === operation && item.status === 'succeeded'))
}

function retainedLiveFailure(run, lab, scenarioId, scenario, incident) {
  if (incident?.labId !== lab.id || incident.attemptId !== run.attemptId || !incident.observations.some(item => item.scenarioId === scenario.historicalProbeOf)) return null
  const records = Object.values(run.evidence.experimentsById).sort((left, right) => right.sequence - left.sequence)
  for (const record of records) {
    const measured = record?.measurements, request = run.runtime.kubernetes.requests.find(item => item.id === measured?.requestId)
    if (record.labId !== lab.id || record.attemptId !== run.attemptId || record.contentVersion !== run.contentVersion
      || record.taskId !== scenarioId || record.scenarioId !== scenarioId || record.outcome !== 'passed' || record.completed !== true
      || measured?.provenanceValid !== true || measured.origin?.kind !== 'pod' || measured.transport?.ok !== true
      || measured.status !== scenario.expected.status || !same(measured.body, scenario.expected.body)
      || !/^request-[1-9]\d*$/.test(measured.requestId) || !Number.isSafeInteger(measured.requestSequence)
      || record.sequence !== measured.requestSequence + 1 || record.startedAtMs < incident.startedAtMs
      || measured.deploymentUid !== incident.target.deploymentUid || measured.serviceUid !== incident.target.serviceUid
      || measured.route?.serviceUid !== incident.target.serviceUid
      || !request || !Array.isArray(measured.dependencyTrace)
      || !same(measured.dependencyTrace.map(item => [item.operation, item.status]), [['embedding', 'failed']])
      || request.scenarioId !== scenarioId || request.clusterId !== scenario.target.clusterId
      || request.route?.serviceUid !== incident.target.serviceUid || request.simTimeMs < incident.startedAtMs
      || request.sequence !== measured.requestSequence || request.status !== measured.status || !same(request.body, measured.body)
      || !same(request.origin, measured.origin) || request.podUid !== measured.podUid
      || !same(request.transport, measured.transport) || !same(request.dependencyTrace, measured.dependencyTrace)) continue
    return structuredClone(measured)
  }
  return null
}

/** Executes only the immutable named request. The caller owns normal recordVerification. */
export function verifyDiagnosis(run, lab, scenarioId) {
  const scenario = lab.scenarios?.[scenarioId], atMs = run.runtime.simTimeMs
  const result = (passed, measurements) => ({ scenarioId, scenarioVersion: scenario?.version ?? 1, outcome: passed ? 'passed' : 'failed', completed: passed,
    startedAtMs: atMs, endedAtMs: atMs, measurements })
  if (lab.id !== run.labId || lab.capabilities?.kubernetesDiagnostics !== true || !requestDiagnosticsEnabled(run)
    || !validAksRequestScenario(scenario, lab) || !scenario.connectivity
    || lab.tasks.filter(task => task.verification?.scenarioId === scenarioId && task.verification.scenarioVersion === scenario.version).length !== 1)
    return { run, result: result(false, { reason: 'Select one immutable declared diagnosis Task request.' }) }
  const response = simulateKubernetesRequest(run, { ...scenario, id: scenarioId })
  if (scenario.historicalProbeOf && response.status !== scenario.expected.status) {
    const incident = stateFor(run, scenario.target)?.diagnosis?.incident
    const live = retainedLiveFailure(run, lab, scenarioId, scenario, incident)
    if (live) return { run, result: result(true, { ...live, observationOrigin: 'observed-live-history' }) }
    const observation = incident?.observations.find(item => item.scenarioId === scenario.historicalProbeOf)
    const probed = observation && probeIncidentSnapshot(run, observation.id, lab).snapshot
    const passed = probed?.status === scenario.expected.status && same(probed.body, scenario.expected.body)
      && same(probed.dependencyTrace.map(item => [item.operation, item.status]), [['embedding', 'failed']])
    const measurements = { origin: 'incident-snapshot', historical: true, observationId: observation?.id ?? null,
      requestId: probed?.requestId ?? null, status: probed?.status ?? null, body: probed?.body ?? null,
      transport: probed?.transport ?? { ok: false, reason: 'NO_SNAPSHOT' }, dependencyTrace: probed?.dependencyTrace ?? [],
      provenanceValid: passed === true }
    return { run, result: result(passed, measurements) }
  }
  const state = stateFor(response.run, scenario.target)
  const deployment = state?.resources[`Deployment/${scenario.target.namespace}/${scenario.target.deploymentName}`]
  const request = response.run.runtime.kubernetes.requests.find(item => item.sequence === response.measurements.requestSequence && item.scenarioId === scenarioId)
  const measurements = { ...response.measurements, status: response.status ?? null, body: response.body ?? null,
    requestId: request?.id ?? null, deploymentUid: deployment?.metadata.uid ?? null,
    rollout: getRolloutSummary(response.run, scenario.target),
    provenanceValid: !!request && requestProvenance(response.measurements, scenario) }
  let passed = response.outcome && measurements.provenanceValid
  if (scenario.requireCompleteRollout) passed &&= measurements.rollout?.complete === true
  if (scenario.observeLifecycle) {
    const incident = state?.diagnosis?.incident
    const phase = Object.values(lab.scenarios).find(item => item.kind === 'aks-diagnosis')?.phases.find(item => item.id === incident?.phaseId)
    measurements.lifecycle = incident?.active && phase?.observationScenarioId === scenarioId
      ? observeDiagnosisLifecycle(response.run, scenario.target, incident.startedAtMs) : null
    passed &&= !!measurements.lifecycle
  }
  if (scenario.requireTwoReplicas) {
    measurements.consistency = inspectDeploymentConsistency(response.run, scenario.target, getProjectManifest(run.project.manifestId), lab)
    const pods = getDeploymentPods(response.run, scenario.target.clusterId, scenario.target.namespace, scenario.target.deploymentName)
    const witnessed = measurements.consistency.witness?.restart?.podUids ?? []
    measurements.finalIdentityFresh = same([...witnessed].sort(), pods.map(pod => pod.metadata.uid).sort())
      && pods.every(pod => state.health?.containers[pod.metadata.uid]?.restartCount === 0)
    measurements.intendedRoute = same([...(measurements.route?.readyEndpointUids ?? [])].sort(), pods.map(pod => pod.metadata.uid).sort())
      && (!measurements.transport?.ok || pods.some(pod => pod.metadata.uid === measurements.podUid))
    passed &&= deployment?.spec.replicas === 2 && measurements.consistency.consistent && measurements.finalIdentityFresh && measurements.intendedRoute
  }
  const snapshot = state?.podSnapshots[measurements.podUid]
  for (const [key, expected] of Object.entries(scenario.expectedCapturedConfig ?? {})) passed &&= snapshot?.environment[key] === expected
  for (const [key, expected] of Object.entries(scenario.expectedCurrentConfig ?? {})) {
    const ref = snapshot?.configRefs.find(item => item.mode === 'env' && item.target === key)
    passed &&= !!ref && state.resources[`${ref.kind}/${ref.namespace}/${ref.name}`]?.data?.[ref.key] === expected
  }
  measurements.reason = passed ? 'Actual routed request, captured graph and required deployment proof agree.' : 'Inspect actual transport, sources, reached stages and saved/build/live consistency.'
  return { run: response.run, result: result(passed, redactRequestValue(measurements, state)) }
}

/** Historical proof is authenticated by the native capture validator, not current live logs. */
export function diagnosisHistoricalEvidence(run, lab, scenarioId) {
  const tasks = lab.tasks.filter(item => item.verification?.scenarioId === scenarioId)
  if (tasks.length !== 1) return null
  const task = tasks[0]
  const record = run.evidence.experimentsById[run.evidence.currentEvidenceByTask[task?.id]]
  return record?.scenarioId === scenarioId && record.measurements.diagnosisCapture && validDiagnosisEvidenceRecord(record, run, lab) ? structuredClone(record.measurements.diagnosisCapture) : null
}

export function diagnosisDependencies(target, { historical = false, scenarioId = null, incidentEpoch = null, lab = null } = {}) {
  const key = `aks-diagnosis:${target.clusterId}:${target.namespace}:${target.deploymentName}:${target.serviceName}:${historical ? `history:${scenarioId}` : 'live'}`
  const live = Object.values(releaseDependencies(target))[0]
  return { [key]: (context, owner) => {
    const state = stateFor(context, target)
    if (historical) {
      const incident = state?.diagnosis?.incident
      const tasks = lab?.tasks.filter(item => item.verification?.scenarioId === scenarioId) ?? []
      const task = tasks.length === 1 ? tasks[0] : null
      const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask[task?.id]]
      const unavailable = () => ({ available: false, selector: key, ownerTaskId: owner?.id ?? null, scenarioId,
        evidence: structuredClone(context.evidence.currentEvidenceByTask) })
      const declaration = lab?.scenarios?.[scenarioId]
      if (!lab || !owner || !task || task.id !== owner.id || owner.verification?.scenarioId !== scenarioId
        || task.verification.scenarioVersion !== declaration?.version || owner.verification.scenarioVersion !== declaration?.version
        || !validAksRequestScenario(declaration, lab)
        || !['clusterId', 'namespace', 'deploymentName', 'serviceName'].every(name => declaration.target[name] === target[name])
        || !incident || context.attemptId !== undefined && incident.attemptId !== context.attemptId
        || context.labId !== undefined && incident.labId !== context.labId
        || incidentEpoch !== null && incident.epoch !== incidentEpoch
        || !['clusterId', 'namespace', 'deploymentName', 'serviceName'].every(name => incident.target[name] === target[name]))
        return unavailable()
      const pending = pendingDiagnosisCaptureEvidence(context)
      const recordMatches = record?.taskId === owner.id && record.scenarioId === scenarioId
        && record.scenarioVersion === declaration.version && record.completed === true && record.outcome === 'passed'
      const authorized = pending?.taskId === owner.id && pending.scenarioId === scenarioId
        && (pending.stage === 'record' || pending.stage === 'capture' && recordMatches && pending.evidenceId === record.id)
      if (!authorized && (!recordMatches
        || !diagnosisHistoricalEvidence({ ...context, labId: context.labId ?? incident.labId,
          attemptId: context.attemptId ?? incident.attemptId, contentVersion: context.contentVersion ?? lab.contentVersion }, lab, scenarioId))) return unavailable()
      return { attemptId: incident.attemptId, contentVersion: context.contentVersion ?? lab?.contentVersion ?? null, incidentId: incident.id, epoch: incident.epoch, target: structuredClone(incident.target),
        fixtureVersion: 1, declarationHash: lab ? diagnosisDigest({ scenario: lab.scenarios[scenarioId], fixtures: lab.initialProjectFiles, incident: Object.values(lab.scenarios).find(item => item.kind === 'aks-diagnosis') }) : null }
    }
    return { ...live(context), pods: getDeploymentPods(context, target.clusterId, target.namespace, target.deploymentName).map(pod => {
      const snapshot = state.podSnapshots[pod.metadata.uid], container = state.health?.containers[pod.metadata.uid]
      return { uid: pod.metadata.uid, containerId: container?.containerId ?? null, artifactId: snapshot?.artifactId ?? null,
        capturedHash: diagnosisDigest({ environment: snapshot?.environment ?? {}, refs: snapshot?.configRefs ?? [], files: snapshot?.files ?? {} }) }
    }).sort((a, b) => a.uid.localeCompare(b.uid)) }
  } }
}
