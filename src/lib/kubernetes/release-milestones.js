import { canonicalize, recordVerification } from '../labEngine/evidence.js'
import { projectSourceHash, selectBuildFiles } from '../project/build.js'
import { getProjectManifest } from '../project/manifests.js'
import { captureReleaseSample } from './release-experiments.js'
import { getDeploymentPods } from './reconcile.js'
import { getRolloutSummary } from './rollouts.js'
import { routeServiceRequest } from './connectivity.js'
import { configReleaseMilestonePassed, recordConfigReleaseMilestone } from './release-config-milestones.js'

const recordFor = (context, scenarioId) => Object.values(context.evidence.currentEvidenceByTask).map(id => context.evidence.experimentsById[id])
  .find(record => record?.scenarioId === scenarioId && record.completed && record.outcome === 'passed')
const cluster = (context, target) => context.runtime.kubernetes.clusters[target.clusterId]
const deployment = (context, target) => cluster(context, target)?.resources[`Deployment/${target.namespace}/${target.deploymentName}`]
const identity = (context, target, scenarioId) => {
  const state = cluster(context, target); const uid = deployment(context, target)?.metadata.uid ?? null
  const e = ['failed-revision', 'incident-observed', 'config-diagnosis'].includes(scenarioId) ? state?.rollouts.experiment
    : scenarioId === 'recovered-v2' ? [...(state?.rollouts.receipts ?? [])].reverse().find(item => item.scenarioId === 'recover-v2' && item.outcome === 'passed') : null
  const registry = deployment(context, target)?.spec.template.spec.containers[0].image.split('/')[0]
  const artifactId = context.artifacts.publishedTags[`${registry}/assistant:${scenarioId === 'baseline-v1' ? 'release-v1' : 'release-v2'}`] ?? null
  return { scenarioId, deploymentUid: uid, receiptId: e?.id ?? artifactId, incidentEpoch: e?.incidentEpoch ?? 0 }
}

/** Earned identity is immutable; live edits cannot erase historical observations. */
export function releaseMilestoneDependencies(target, scenarioId) {
  const key = `aks-release-milestone:${target.clusterId}:${target.namespace}:${target.deploymentName}:${scenarioId}`
  return { [key]: context => {
    const record = recordFor(context, scenarioId); const saved = record?.dependencyValues?.[key]
    if (saved && record.measurements?.identity && canonicalize(saved) === canonicalize(record.measurements.identity)) return saved
    return identity(context, target, scenarioId)
  } }
}

const validFlow = sample => sample?.transport.ok && sample.status === 200 && sample.sources.includes('training-backups')
  && sample.integrationTrace?.sourceProvenance === 'rows'
  && ['embedding', 'postgres-query', 'answer'].every(operation => sample.operations.some(item => item.operation === operation && item.status === 'succeeded'))

function diagnosisMatches(record, expected, target) {
  const diagnosis = record?.measurements?.diagnosis
  return record?.scenarioId === 'failed-revision' && record.completed && record.outcome === 'passed'
    && record.attemptId === expected.attemptId && record.measurements.attemptId === expected.attemptId
    && record.measurements.clusterId === target.clusterId && record.measurements.namespace === target.namespace
    && diagnosis?.experimentId === expected.id && diagnosis.experimentScenarioId === expected.scenarioId
    && diagnosis.deploymentUid === expected.deploymentUid && diagnosis.incidentEpoch === expected.incidentEpoch
    && diagnosis.atMs === record.endedAtMs && diagnosis.atMs >= expected.startedAtMs && diagnosis.atMs <= expected.endedAtMs
    && diagnosis.revision === expected.incident?.revision && canonicalize(diagnosis.incident) === canonicalize(expected.incident)
}

export function releaseMilestonePassed(context, taskId, scenarioId, target) {
  const record = context.evidence.experimentsById[context.evidence.currentEvidenceByTask[taskId]]
  if (!record || record.taskId !== taskId || record.scenarioId !== scenarioId || record.outcome !== 'passed' || !record.completed
    || record.measurements.attemptId !== record.attemptId || record.measurements.identity?.scenarioId !== scenarioId
    || !record.measurements.identity.receiptId || !record.measurements.identity.deploymentUid) return false
  const proof = record.measurements.proof
  if (['baseline-v1', 'published-v2'].includes(scenarioId)) {
    if (proof?.infoVersion !== '1.0' || !validFlow(proof.sample)) return false
    if (scenarioId === 'baseline-v1' && record.measurements.identity.receiptId !== proof.sample.artifactId) return false
    if (scenarioId === 'published-v2' && (proof.artifact?.version !== '2.0' || record.measurements.identity.receiptId !== proof.artifact?.artifactId)) return false
  } else if (proof?.incidentKind === 'missing-config-key') {
    if (!configReleaseMilestonePassed(context, record, target)) return false
  } else if (proof?.experimentId !== record.measurements.identity.receiptId || !proof.incident?.deadline || !proof.incident.reasons?.includes('readiness')
    || scenarioId === 'recovered-v2' && (proof.outcome !== 'passed' || proof.terminalRevision <= proof.incident.revision)) return false
  if (scenarioId === 'recovered-v2' && proof?.incidentKind !== 'missing-config-key' && !diagnosisMatches(context.evidence.experimentsById[proof.diagnosisEvidenceId], {
    id: proof.experimentId, scenarioId: proof.experimentScenarioId, attemptId: record.attemptId,
    deploymentUid: record.measurements.identity.deploymentUid, incidentEpoch: record.measurements.identity.incidentEpoch,
    startedAtMs: proof.startedAtMs, endedAtMs: proof.endedAtMs, incident: proof.incident,
  }, target)) return false
  return Object.entries(releaseMilestoneDependencies(target, scenarioId)).every(([key, select]) => canonicalize(record.dependencyValues[key]) === canonicalize(record.measurements.identity)
    && canonicalize(record.dependencyValues[key]) === canonicalize(select(context)))
}

export function recordReleaseMilestone(input, lab, scenarioId) {
  const scenario = lab.scenarios[scenarioId]; const task = lab.tasks.find(item => item.verification?.scenarioId === scenarioId)
  if (!task || scenario.kind !== 'aks-release-milestone' || !['baseline-v1', 'published-v2', 'failed-revision', 'recovered-v2', 'incident-observed', 'config-diagnosis'].includes(scenarioId))
    return { run: input, diagnostics: [{ code: 'INVALID_AKS_ACTION', message: 'Select a declared release milestone.' }] }
  const target = scenario.target; const state = cluster(input, target); const summary = getRolloutSummary(input, target)
  if (scenario.incidentKind === 'missing-config-key') return recordConfigReleaseMilestone(input, lab, scenarioId, releaseMilestoneDependencies(target, scenarioId))
  const earned = recordFor(input, scenarioId)
  const preserveEarned = () => ({ run: input, diagnostics: [], lines: [{ kind: 'out', text: 'Historical release milestone already recorded.' }] })
  if (earned && (scenarioId !== 'failed-revision' || earned.measurements.diagnosis?.experimentId === state.rollouts.experiment?.id)) return preserveEarned()
  let run = input; let passed = false; let reason = ''; let proof = {}; let diagnosis = null
  if (['baseline-v1', 'published-v2'].includes(scenarioId)) {
    const service = state.resources[`Service/${target.namespace}/${target.serviceName}`]
    const info = routeServiceRequest(run, { origin: { kind: 'external', clusterId: target.clusterId },
      hostname: service?.status.loadBalancer?.ingress?.[0]?.ip ?? 'unassigned', port: 80, method: 'GET', path: '/api/info' }, null)
    const captured = captureReleaseSample(info.run, target, run.runtime.simTimeMs, 0); run = captured.run
    const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName)
    const runningV1 = summary?.complete && summary.desired === 2 && pods.every(pod => run.artifacts.buildsById[state.podSnapshots[pod.metadata.uid]?.artifactId]?.appSpec.version === '1.0')
    const flow = validFlow(captured.sample) && info.outcome.transport.ok && info.outcome.status === 200 && info.outcome.body?.version === '1.0'
    proof = { infoVersion: info.outcome.body?.version ?? null, info: { requestId: info.outcome.requestId, status: info.outcome.status,
      podUid: info.outcome.route.podUid ?? null, artifactId: info.outcome.route.artifactId ?? null }, sample: captured.sample }
    passed = runningV1 && flow
    reason = 'Inspect two Available v1 Pods and verify info plus a real three-stage backups answer.'
    if (scenarioId === 'published-v2') {
      const artifactId = run.artifacts.publishedTags[scenario.imageRef]; const artifact = run.artifacts.buildsById[artifactId]
      const sourceHash = projectSourceHash(selectBuildFiles(run.project.savedFiles, getProjectManifest(run.project.manifestId)))
      passed &&= artifact?.sourceHash === sourceHash && artifact?.appSpec.version === '2.0' && artifact?.appSpec.release?.responseBindings?.release === '2.0'
      proof.artifact = artifact ? { artifactId, sourceHash: artifact.sourceHash, digest: artifact.digest, version: artifact.appSpec.version } : null
      reason = 'Build release-v2 from current saved version and formatter while the deployed assistant still serves v1.'
    }
  } else {
    const e = scenarioId === 'failed-revision' ? state.rollouts.experiment
      : [...state.rollouts.receipts].reverse().find(item => item.scenarioId === scenario.experimentScenarioId && item.outcome === 'passed')
    const incident = e?.incident
    passed = e?.attemptId === run.attemptId && e?.deploymentUid === deployment(run, target)?.metadata.uid
      && e?.scenarioId === scenario.experimentScenarioId && e?.incidentSeen && e?.deadlineSeen && incident?.deadline
      && incident.reasons.includes('readiness') && e.samples.some(sample => sample.status === 200 && sample.release === '2.0'
        && sample.rollout.currentRevision === incident.revision && !sample.rollout.complete)
    let diagnosisEvidence = null
    if (scenarioId === 'failed-revision') {
      const currentRsUid = state.rollouts.deployments[e?.deploymentUid]?.currentRsUid
      passed &&= e.status === 'active' && summary?.currentRevision === incident.revision && !summary.complete
        && summary.conditions.some(condition => condition.reason === 'ProgressDeadlineExceeded')
        && getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName).some(pod => !pod.metadata.deletionTimestamp
          && pod.metadata.ownerReferences?.some(owner => owner.uid === currentRsUid)
          && incident.podUids.includes(pod.metadata.uid) && !pod.status.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True'))
      if (passed) diagnosis = { experimentId: e.id, experimentScenarioId: e.scenarioId, deploymentUid: e.deploymentUid,
        incidentEpoch: e.incidentEpoch, atMs: run.runtime.simTimeMs, revision: summary.currentRevision, incident: structuredClone(incident) }
      else if (earned) return preserveEarned()
    } else {
      diagnosisEvidence = e && Object.values(run.evidence.experimentsById).find(record => diagnosisMatches(record, e, target))
      passed &&= e.status === 'finished' && e.outcome === 'passed' && !!diagnosisEvidence
        && e.samples.at(-1).rollout.complete && e.samples.at(-1).rollout.currentRevision > incident.revision
        && e.samples.at(-1).backends.every(item => e.baseline.artifactIds.includes(item.artifactId))
    }
    proof = e ? { experimentId: e.id, experimentScenarioId: e.scenarioId, incident, baselineRevision: e.baselineRevision,
      terminalRevision: e.samples.at(-1).rollout.currentRevision, outcome: e.outcome ?? null,
      startedAtMs: e.startedAtMs, endedAtMs: e.endedAtMs, diagnosisEvidenceId: diagnosisEvidence?.id ?? null } : {}
    reason = scenarioId === 'failed-revision' ? 'Verify the diagnosis while recover-v2 is active and its current failed revision is still stalled.'
      : 'Earn failed-revision diagnosis for this incident before undo, then finish and verify the matching recovery receipt.'
  }
  run = recordVerification(run, lab, task.id, { scenarioId, scenarioVersion: 1, outcome: passed ? 'passed' : 'failed', completed: !!passed,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs,
    measurements: { attemptId: run.attemptId, clusterId: target.clusterId, namespace: target.namespace,
      identity: earned?.measurements.identity ?? identity(run, target, scenarioId), proof: earned?.measurements.proof ?? proof, diagnosis, reason } })
  return { run, diagnostics: [], lines: [{ kind: 'out', text: passed ? 'Release milestone observed and recorded.' : reason }] }
}
