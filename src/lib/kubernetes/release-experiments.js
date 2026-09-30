import { canonicalize, recordVerification } from '../labEngine/evidence.js'
import { routeServiceRequest } from './connectivity.js'
import { getServiceBackends } from './services.js'
import { getRolloutSummary } from './rollouts.js'
import { getDeploymentPods } from './reconcile.js'
import { refreshKubernetesDependencies } from './evidence.js'
import { retainReleaseReceipt } from './release-receipts.js'

const clone = value => structuredClone(value)
const error = message => ({ code: 'INVALID_RELEASE_EXPERIMENT', message })
export const releaseDigest = value => {
  let hash = 2166136261
  for (const char of canonicalize(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return `fnv1a32:${(hash >>> 0).toString(16)}`
}
const stateFor = (run, target) => run.runtime.kubernetes.clusters[target.clusterId]
const deploymentFor = (run, target) => stateFor(run, target)?.resources[`Deployment/${target.namespace}/${target.deploymentName}`]
export function activeRelease(run) { return Object.values(run.runtime.kubernetes?.clusters ?? {}).find(state => state.rollouts?.experiment?.status === 'active')?.rollouts.experiment ?? null }

export function validReleaseScenario(scenario, final = false) {
  const keys = final ? ['kind', 'version', 'target', 'expectedRelease'] : ['kind', 'version', 'target', 'expectedRelease', 'requiredAvailable', 'zeroFailedRequests', 'requireIncident', 'requireDeadline', 'incidentEpoch']
  return !!scenario && Object.keys(scenario).every(key => keys.includes(key)) && scenario.kind === (final ? 'aks-release-final' : 'aks-release') && scenario.version === 1
    && scenario.expectedRelease === '2.0' && scenario.target && Object.keys(scenario.target).sort().join(',') === 'clusterId,deploymentName,namespace,serviceName'
    && Object.values(scenario.target).every(value => typeof value === 'string' && value.length > 0)
    && (final || Number.isInteger(scenario.requiredAvailable) && scenario.requiredAvailable >= 1 && scenario.requiredAvailable <= 6
      && ['zeroFailedRequests', 'requireIncident', 'requireDeadline'].every(key => typeof scenario[key] === 'boolean')
      && (!scenario.requireDeadline || scenario.requireIncident) && Number.isInteger(scenario.incidentEpoch) && scenario.incidentEpoch >= 0)
}

export function startReleaseExperiment(input, scenarioId, lab) {
  const scenario = lab.scenarios?.[scenarioId]
  if (!validReleaseScenario(scenario) || lab.capabilities?.kubernetesRollouts !== true || lab.capabilities?.kubernetesConnectivity !== true || lab.capabilities?.kubernetesAiIntegration !== true)
    return { run: input, diagnostics: [error('Select a declared release scenario with rollout, connectivity and integration support.')] }
  if (Object.values(input.runtime.kubernetes.clusters).some(state => state.health?.experiment?.status === 'active' || ['warming', 'running'].includes(state.resourcesRuntime?.experiment?.phase) || state.rollouts?.experiment?.status === 'active'))
    return { run: input, diagnostics: [error('A probe, resource or release experiment is already active. Finish or cancel it first.')] }
  const deployment = deploymentFor(input, scenario.target); const summary = getRolloutSummary(input, scenario.target)
  if (!deployment || !summary) return { run: input, diagnostics: [error('Apply the target Deployment before starting this release experiment.')] }
  const run = clone(input); const runtime = run.runtime.kubernetes; const now = run.runtime.simTimeMs
  const history = stateFor(run, scenario.target).rollouts.deployments[deployment.metadata.uid]
  const ongoingRevision = scenario.requireIncident && !summary.complete && history.revisions.some(item => item.revision < summary.currentRevision)
    && getDeploymentPods(run, scenario.target.clusterId, scenario.target.namespace, scenario.target.deploymentName).some(pod => !pod.metadata.ownerReferences.some(ref => ref.uid === history.currentRsUid))
  stateFor(run, scenario.target).rollouts.experiment = {
    version: 1, id: `release-${run.nextSequence++}`, attemptId: run.attemptId, scenarioId, scenarioVersion: 1,
    target: clone(scenario.target), deploymentUid: deployment.metadata.uid, context: runtime.currentContext,
    contextNamespace: runtime.contexts[runtime.currentContext]?.namespace ?? null,
    baselineReplicas: deployment.spec.replicas, baselineRevision: summary.currentRevision, incidentEpoch: scenario.incidentEpoch,
    baseline: { savedHash: releaseDigest(run.project.savedFiles), objectsHash: releaseDigest(Object.values(stateFor(run, scenario.target).resources).filter(item => ['Deployment', 'ConfigMap', 'Secret', 'Service'].includes(item.kind))), artifactIds: [...new Set(getDeploymentPods(run, scenario.target.clusterId, scenario.target.namespace, scenario.target.deploymentName).map(pod => stateFor(run, scenario.target).podSnapshots[pod.metadata.uid]?.artifactId ?? null))] },
    expected: clone(scenario), status: 'active', phase: ongoingRevision ? 'changed-template' : 'baseline', startedAtMs: now, endedAtMs: null,
    changedTemplate: ongoingRevision, incidentSeen: false, deadlineSeen: false, terminalSinceMs: null,
    incident: null,
    samples: [], lastSemanticHash: null, cancellationReason: null,
  }
  return { run: observeReleaseTimestamp(run, now, lab), diagnostics: [] }
}

/** Restrict persisted traffic to provenance, fixed operation summaries and response fields. */
export function captureReleaseSample(input, target, atMs, index) {
  const state = stateFor(input, target); const backends = getServiceBackends(input, target)
  const question = index % 2 === 0 ? 'How long are backups kept?' : 'Who provides support?'
  const response = routeServiceRequest(input, { origin: { kind: 'external', clusterId: target.clusterId },
    hostname: backends.service?.status?.loadBalancer?.ingress?.[0]?.ip ?? 'unassigned', port: backends.service?.spec.ports[0].port ?? 80,
    method: 'POST', path: '/api/ask', body: { question } }, null)
  const outcome = response.outcome
  const sensitive = Object.values(state.podSnapshots).flatMap(snapshot => Object.entries(snapshot.environment ?? {}).filter(([key]) => /password|secret|token|credential|api.?key|connection/i.test(key)
    || snapshot.configRefs?.some(ref => ref.kind === 'Secret' && ref.mode === 'env' && ref.target === key)).map(([, value]) => value)).filter(value => typeof value === 'string' && value)
  const safeText = value => typeof value === 'string' ? sensitive.reduce((text, secret) => text.split(secret).join('[REDACTED]'), value).slice(0, 2048) : null
  const rollout = state.rollouts.deployments[deploymentFor(input, target)?.metadata.uid]
  const inventory = backends.readyEndpoints.map(endpoint => {
    const pod = backends.selectedPods.find(item => item.metadata.uid === endpoint.podUid); const snapshot = state.podSnapshots[endpoint.podUid]
    const artifact = input.artifacts.buildsById[snapshot?.artifactId]
    return { podUid: endpoint.podUid, revision: rollout?.revisions.find(item => pod.metadata.ownerReferences?.some(ref => ref.uid === item.rsUid))?.revision ?? null,
      artifactId: snapshot?.artifactId ?? null, digest: artifact?.digest ?? null, sourceHash: artifact?.sourceHash ?? null }
  })
  const operations = outcome.dependencyTrace.map(item => ({ operation: item.operation, status: item.status,
    attempts: (item.attempts ?? []).map(attempt => ({ status: attempt.status ?? null, durationMs: attempt.durationMs ?? 0, waitMs: attempt.waitMs ?? 0 })) }))
  const trace = outcome.integrationTrace
  const sample = { atMs, requestId: outcome.requestId, question, transport: outcome.transport, status: outcome.status,
    answer: safeText(outcome.body?.answer), sources: Array.isArray(outcome.body?.sources) ? outcome.body.sources.map(safeText) : [], release: safeText(outcome.body?.release),
    podUid: outcome.route.podUid ?? null, artifactId: outcome.route.artifactId ?? null, operations,
    integrationTrace: trace ? { version: trace.version, graphHash: trace.graphHash, queryHash: trace.queryHash, fixtureVersion: trace.fixtureVersion,
      profileId: trace.profileId, vectorProvenance: trace.vectorProvenance, sourceProvenance: trace.sourceProvenance, elapsedMs: trace.elapsedMs } : null,
    rollout: getRolloutSummary(input, target), backends: inventory }
  return { run: response.run, sample }
}

export function cancelReleaseExperiment(input, reason = 'learner-cancelled') {
  const experiment = activeRelease(input)
  if (!experiment) return { run: input, diagnostics: [error('There is no active release experiment to cancel.')] }
  const run = clone(input); const e = stateFor(run, experiment.target).rollouts.experiment
  e.status = 'cancelled'; e.cancellationReason = reason; e.endedAtMs = run.runtime.simTimeMs
  retainReleaseReceipt(stateFor(run, experiment.target), e)
  return { run, diagnostics: [] }
}

export function cancelChangedReleaseExperiments(input) {
  const e = activeRelease(input); if (!e) return input
  const deployment = deploymentFor(input, e.target); const runtime = input.runtime.kubernetes
  const reason = deployment?.metadata.uid !== e.deploymentUid ? 'target-deleted'
    : runtime.currentContext !== e.context || runtime.contexts[runtime.currentContext]?.namespace !== e.contextNamespace ? 'context-or-namespace-changed'
      : deployment.spec.replicas !== e.baselineReplicas ? 'desired-replicas-changed' : null
  return reason ? cancelReleaseExperiment(input, reason).run : input
}

export function finishReleaseExperiment(input, scenarioId, lab, forcedReason = null) {
  const active = activeRelease(input)
  if (!active || active.scenarioId !== scenarioId) return { run: input, diagnostics: [error('Finish the matching active release scenario.')] }
  let run = clone(input); const e = stateFor(run, active.target).rollouts.experiment
  const terminal = e.terminalSinceMs !== null && run.runtime.simTimeMs - e.terminalSinceMs >= 10000
  const availability = !e.expected.zeroFailedRequests || e.samples.every(sample => sample.transport.ok && sample.status === 200 && sample.rollout.available >= e.expected.requiredAvailable)
  const incidentObserved = e.incidentSeen && e.incident !== null && e.incident.podUids.length > 0 && e.incident.reasons.length > 0
  const passed = !forcedReason && e.changedTemplate && (!e.expected.requireIncident || incidentObserved)
    && (!e.expected.requireDeadline || incidentObserved && e.deadlineSeen && e.incident.deadline) && terminal && availability
  Object.assign(e, { status: 'finished', phase: 'finished', outcome: passed ? 'passed' : 'failed', endedAtMs: run.runtime.simTimeMs,
    reason: forcedReason ?? (passed ? 'terminal-release-observed' : 'Observe the required revision/incident and ten stable terminal seconds while meeting the availability brief.') })
  retainReleaseReceipt(stateFor(run, e.target), e)
  run = refreshKubernetesDependencies(input, run, lab)
  for (const task of lab.tasks.filter(task => task.verification?.scenarioId === scenarioId)) {
    const current = run.evidence.experimentsById[run.evidence.currentEvidenceByTask[task.id]]
    const historicalPrefix = `aks-release:${e.target.clusterId}:${e.target.namespace}:${e.target.deploymentName}:history:${scenarioId}:`
    const historical = [e.incidentEpoch, null].some(epoch => Object.hasOwn(task.dependencies ?? {}, `${historicalPrefix}${epoch}`))
    // Later success/failure receipts cannot replace half of an already earned
    // historical identity. Preserve its evidence and dependency atomically.
    if (historical && current?.outcome === 'passed' && current.completed
      && current.attemptId === e.attemptId && current.scenarioId === scenarioId && current.measurements?.deploymentUid === e.deploymentUid
      && current.measurements?.incidentEpoch === e.incidentEpoch) continue
    run = recordVerification(run, lab, task.id,
      { scenarioId, scenarioVersion: 1, outcome: e.outcome, completed: passed, startedAtMs: e.startedAtMs, endedAtMs: e.endedAtMs,
        measurements: { receiptId: e.id, clusterId: e.target.clusterId, namespace: e.target.namespace, deploymentUid: e.deploymentUid, incidentEpoch: e.incidentEpoch, reason: e.reason } })
  }
  return { run, diagnostics: [] }
}

export function observeReleaseTimestamp(input, atMs, lab) {
  const active = activeRelease(input); if (!active) return input
  const state = stateFor(input, active.target); const deployment = deploymentFor(input, active.target); const runtime = input.runtime.kubernetes
  const reason = deployment?.metadata.uid !== active.deploymentUid ? 'target-deleted' : runtime.currentContext !== active.context || runtime.contexts[runtime.currentContext]?.namespace !== active.contextNamespace ? 'context-or-namespace-changed'
    : deployment.spec.replicas !== active.baselineReplicas ? 'desired-replicas-changed' : null
  if (reason) return cancelReleaseExperiment(input, reason).run
  const summary = getRolloutSummary(input, active.target)
  const pods = getDeploymentPods(input, active.target.clusterId, active.target.namespace, active.target.deploymentName)
  const backends = getServiceBackends(input, active.target)
  // Hash routing and captured configuration as well as rollout counts: a
  // same-time Service edit or projected-file change can alter actual traffic
  // without replacing a Pod. Only the digest is retained, never these values.
  const semanticHash = releaseDigest({ summary, service: backends.service ?? null, endpoints: backends.readyEndpoints,
    pods: pods.map(pod => ({ uid: pod.metadata.uid, phase: pod.status.phase, deletion: pod.metadata.deletionTimestamp ?? null,
      reason: pod.status.containerStatuses?.[0]?.state ?? null, snapshot: state.podSnapshots[pod.metadata.uid] ?? null })) })
  if (active.samples.at(-1)?.atMs === atMs && active.lastSemanticHash === semanticHash) return input
  if (active.samples.length >= 1200) return finishReleaseExperiment(input, active.scenarioId, lab, 'observation-limit').run
  const captured = captureReleaseSample(input, active.target, atMs, active.samples.length); let run = captured.run
  const e = stateFor(run, active.target).rollouts.experiment
  e.samples.push(captured.sample); e.lastSemanticHash = semanticHash
  if (summary.currentRevision !== e.baselineRevision) { e.changedTemplate = true; if (e.phase === 'baseline') e.phase = 'changed-template' }
  const currentRsUid = state.rollouts.deployments[e.deploymentUid].currentRsUid
  const unready = pods.filter(pod => pod.metadata.ownerReferences?.some(ref => ref.uid === currentRsUid) && !pod.metadata.deletionTimestamp && !pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'))
  const failureReasons = new Set()
  for (const pod of unready) {
    const waitingReason = pod.status.containerStatuses?.[0]?.state?.waiting?.reason
    if (waitingReason && state.events.some(event => event.metadata.namespace === e.target.namespace && event.reason === waitingReason)) failureReasons.add(waitingReason)
    for (const event of state.health?.events ?? []) if (event.podUid === pod.metadata.uid
      && (event.type === 'probe-result' && event.probeType === 'readiness' && event.success === false || event.type === 'restart-scheduled')) failureReasons.add(event.probeType ?? 'ProbeFailed')
  }
  const failure = failureReasons.size > 0
  const deadline = summary.conditions.some(item => item.reason === 'ProgressDeadlineExceeded')
  if (e.changedTemplate && unready.length && failure && (!e.expected.requireDeadline || deadline)) {
    e.incidentSeen = true; e.deadlineSeen ||= deadline; e.phase = 'incident-seen'
    e.incident ??= { atMs, revision: summary.currentRevision, podUids: unready.map(pod => pod.metadata.uid), reasons: [...failureReasons].sort(),
      missingKeys: [...new Set(unready.flatMap(pod => (pod.spec.containers[0].env ?? []).flatMap(env => {
        const ref = env.valueFrom?.configMapKeyRef
        return ref && !Object.hasOwn(state.resources[`ConfigMap/${e.target.namespace}/${ref.name}`]?.data ?? {}, ref.key) ? [ref.key] : []
      })))], deadline }
    e.incident.deadline ||= deadline
  }
  const s = captured.sample
  const terminal = summary.complete && s.rollout.available >= e.expected.requiredAvailable && s.transport.ok && s.status === 200 && s.release === e.expected.expectedRelease
    && ['embedding', 'postgres-query', 'answer'].every(operation => s.operations.some(item => item.operation === operation && item.status === 'succeeded'))
    && s.backends.length === e.baselineReplicas && s.backends.every(item => item.artifactId === s.artifactId)
  if (terminal && e.changedTemplate && (!e.expected.requireIncident || e.incidentSeen)) { e.terminalSinceMs ??= atMs; e.phase = 'recovered' }
  else { e.terminalSinceMs = null; e.phase = e.incidentSeen ? 'incident-seen' : e.changedTemplate ? 'changed-template' : 'baseline' }
  if (atMs - e.startedAtMs >= 300000) run = finishReleaseExperiment(run, e.scenarioId, lab, 'experiment-expired').run
  return run
}

export function nextReleaseTimestamp(run, limit) {
  const e = activeRelease(run); if (!e) return null
  const next = Math.min(e.startedAtMs + 300000, e.startedAtMs + (Math.floor((run.runtime.simTimeMs - e.startedAtMs) / 1000) + 1) * 1000)
  return next > run.runtime.simTimeMs && next <= limit ? next : null
}
