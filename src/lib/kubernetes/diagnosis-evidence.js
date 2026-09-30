import { canonicalize } from '../labEngine/evidence.js'
import { validAksRequestScenario } from './actions.js'
import { simulateKubernetesRequest } from './requests.js'
import { inspectDeploymentConsistency, releaseDependencies } from './release-evidence.js'
import { getProjectManifest } from '../project/manifests.js'
import { getDeploymentPods } from './reconcile.js'
import { redactRequestValue, requestDiagnosticsEnabled } from './request-records.js'
import { validDiagnosisEvidenceRecord, diagnosisDigest } from './diagnosis-incidents.js'
import { INTEGRATION_FIXTURES } from '../../data/fixtures/aks/integration.js'

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
    return failed >= 0 && operations.slice(0, failed).every(item => item.status === 'succeeded')
      && operations.slice(failed + 1).length === 0 && operations[failed].operation === ({ POSTGRES_CONNECTION: 'postgres-query', DEPENDENCY_UNAVAILABLE: 'answer' }[scenario.expected.body?.code] ?? operations[failed].operation)
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
  const state = stateFor(response.run, scenario.target)
  const deployment = state?.resources[`Deployment/${scenario.target.namespace}/${scenario.target.deploymentName}`]
  const request = response.run.runtime.kubernetes.requests.find(item => item.sequence === response.measurements.requestSequence && item.scenarioId === scenarioId)
  const measurements = { ...response.measurements, status: response.status ?? null, body: response.body ?? null,
    requestId: request?.id ?? null, deploymentUid: deployment?.metadata.uid ?? null,
    provenanceValid: !!request && requestProvenance(response.measurements, scenario) }
  let passed = response.outcome && measurements.provenanceValid
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
  const task = lab.tasks.find(item => item.verification?.scenarioId === scenarioId)
  const record = run.evidence.experimentsById[run.evidence.currentEvidenceByTask[task?.id]]
  return record?.measurements.diagnosisCapture && validDiagnosisEvidenceRecord(record, run, lab) ? structuredClone(record.measurements.diagnosisCapture) : null
}

export function diagnosisDependencies(target, { historical = false, scenarioId = null, incidentEpoch = null, lab = null } = {}) {
  const key = `aks-diagnosis:${target.clusterId}:${target.namespace}:${target.deploymentName}:${target.serviceName}:${historical ? `history:${scenarioId}` : 'live'}`
  const live = Object.values(releaseDependencies(target))[0]
  return { [key]: context => {
    const state = stateFor(context, target)
    if (historical) {
      const incident = state?.diagnosis?.incident
      if (!incident || context.attemptId !== undefined && incident.attemptId !== context.attemptId
        || context.labId !== undefined && incident.labId !== context.labId
        || incidentEpoch !== null && incident.epoch !== incidentEpoch
        || !['clusterId', 'namespace', 'deploymentName', 'serviceName'].every(name => incident.target[name] === target[name])) return null
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
