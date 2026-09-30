import { diagnosisDependencies } from '../../../lib/kubernetes/diagnosis-evidence.js'
import { getDeploymentPods } from '../../../lib/kubernetes/reconcile.js'
import { canonicalize } from '../../../lib/labEngine/evidence.js'

export function diagnosisTask(id, scenarioId, content) {
  const { target, lab, historical = false, ...task } = content
  return { id, ...task, verification: { scenarioId, scenarioVersion: 1 },
    dependencies: task.dependencies ?? diagnosisDependencies(target, { historical, scenarioId, lab }), check: task.check ?? (() => true) }
}

/** Resolve a real generated Pod; previous logs must belong to a restarted container. */
export function diagnosisPodAction(run, target, previous = false, describe = false) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
  const pod = previous ? pods.find(item => state.health.containers[item.metadata.uid]?.previous) : pods[0]
  if (!pod) throw new Error('Inspect generated Pods: no matching live container is available.')
  return { type: 'command', line: describe ? `kubectl describe pod ${pod.metadata.name} -n ${target.namespace}`
    : `kubectl logs ${pod.metadata.name} -n ${target.namespace}${previous ? ' --previous' : ''}` }
}

export function diagnosisRolloutHealthy(context, taskId) {
  const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask[taskId]]
  return record?.measurements.rollout?.complete === true
}

/** Earlier baseline traffic remains historical proof; both actual routes must have worked. */
export function diagnosisBaselinePassed(context, lab, target) {
  const scenario = lab.scenarios.baseline
  const external = context.evidence.experimentsById[context.evidence.currentEvidenceByTask.baseline]
  if (external?.outcome !== 'passed' || external.measurements.provenanceValid !== true) return false
  return context.runtime.kubernetes.requests.some(request => request.diagnosticsVersion === 1 && request.clusterId === target.clusterId
    && request.namespace === target.namespace && request.route?.serviceName === target.serviceName && request.route.namespace === target.namespace
    && request.origin.kind === 'pod' && context.runtime.kubernetes.clusters[target.clusterId].connectivity.diagnosticPodUids.includes(request.origin.podUid)
    && request.transport.ok && request.status === 200
    && canonicalize(request.request) === canonicalize(scenario.request) && canonicalize(request.body) === canonicalize(scenario.expected.body)
    && request.integrationTrace?.vectorProvenance === 'embedding' && request.integrationTrace.sourceProvenance === 'rows'
    && canonicalize(request.integrationTrace.selectedIds) === canonicalize(scenario.expected.body.sources)
    && canonicalize(request.integrationTrace.contextIds) === canonicalize(scenario.expected.body.sources)
    && ['embedding', 'postgres-query', 'answer'].every(operation => request.dependencyTrace.some(stage => stage.operation === operation && stage.status === 'succeeded')))
}

/** Grade compiled bindings and the actually routed captured artifact, not source spelling. */
export function diagnosisLoggingPassed(context, taskId) {
  const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask[taskId]]
  const spec = context.artifacts.buildsById[record?.measurements.artifactId]?.appSpec.diagnostics
  const statements = spec?.statements ?? [], core = statements.findIndex(item => item.op === 'core')
  return statements.some((item, index) => index < core && item.op === 'log' && item.enabled && item.fields.event?.value === 'request.started' && item.fields.request_id?.kind === 'request-id')
    && statements.some((item, index) => index > core && item.op === 'log' && item.enabled && item.fields.event?.value === 'request.completed' && item.fields.request_id?.kind === 'request-id' && item.fields.status?.kind === 'result-status')
}
