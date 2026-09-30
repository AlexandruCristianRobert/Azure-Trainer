import { canonicalize, recordVerification } from '../labEngine/evidence.js'
import { getRolloutSummary } from './rollouts.js'
import { getDeploymentPods } from './reconcile.js'

const observations = ['incident-observed', 'config-diagnosis']
const supportedKey = 'ANSWER_DEPLOYMENT_V2'
const records = run => Object.values(run.evidence.experimentsById)
const validFlow = sample => sample?.transport.ok && sample.status === 200 && sample.sources.some(id => ['training-backups', 'training-support'].includes(id))
  && sample.integrationTrace?.sourceProvenance === 'rows'
  && ['embedding', 'postgres-query', 'answer'].every(operation => sample.operations.some(item => item.operation === operation && item.status === 'succeeded'))

function matchingObservation(record, e, scenarioId, target) {
  const d = record?.measurements?.diagnosis
  return record?.scenarioId === scenarioId && record.completed && record.outcome === 'passed'
    && record.attemptId === e.attemptId && record.measurements.attemptId === e.attemptId
    && record.measurements.clusterId === target.clusterId && record.measurements.namespace === target.namespace
    && d?.experimentId === e.id && d.experimentScenarioId === e.scenarioId
    && d.deploymentUid === e.deploymentUid && d.incidentEpoch === e.incidentEpoch
    && d.atMs === record.endedAtMs && d.atMs >= e.startedAtMs && d.atMs <= (e.endedAtMs ?? Infinity)
    && d.revision === e.incident?.revision && canonicalize(d.incident) === canonicalize(e.incident)
    && d.configuration?.key === supportedKey && d.configuration.eventReason === 'CreateContainerConfigError'
}

/** Only key names and reason/identity fields are retained, never configuration values. */
function currentConfigurationFailure(run, target, e) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  const summary = getRolloutSummary(run, target)
  if (e?.status !== 'active' || e.incident?.revision !== summary?.currentRevision || summary.complete
    || !summary.conditions.some(c => c.reason === 'ProgressDeadlineExceeded')) return null
  const currentRsUid = state.rollouts.deployments[e.deploymentUid]?.currentRsUid
  const pod = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName).find(pod => !pod.metadata.deletionTimestamp
    && pod.metadata.ownerReferences?.some(owner => owner.uid === currentRsUid)
    && e.incident.podUids.includes(pod.metadata.uid)
    && pod.status.containerStatuses?.[0]?.state.waiting?.reason === 'CreateContainerConfigError')
  const ref = pod?.spec.containers[0].env?.find(env => env.name === 'ANSWER_DEPLOYMENT')?.valueFrom?.configMapKeyRef
  const config = ref && state.resources[`ConfigMap/${target.namespace}/${ref.name}`]
  const event = ref && state.events.find(event => event.metadata.namespace === target.namespace && event.reason === 'CreateContainerConfigError'
    && event.message === `ConfigMap '${ref.name}' key '${ref.key}' was not found in this namespace.`)
  if (ref?.key !== supportedKey || !config || Object.hasOwn(config.data ?? {}, ref.key) || !event) return null
  return { podUid: pod.metadata.uid, configMapName: ref.name, key: ref.key, keyNames: Object.keys(config.data ?? {}).sort(),
    eventReason: event.reason, eventName: event.metadata.name }
}

export function configReleaseMilestonePassed(context, record, target) {
  const proof = record.measurements.proof
  if (proof?.incidentKind !== 'missing-config-key' || proof.experimentId !== record.measurements.identity.receiptId
    || !proof.incident?.deadline || !proof.incident.reasons.includes('CreateContainerConfigError')
    || !proof.incident.missingKeys.includes(supportedKey) || !validFlow(proof.oldSample) || proof.oldVersion !== '1.0') return false
  if (observations.includes(record.scenarioId)) {
    const d = record.measurements.diagnosis
    if (!d || d.configuration?.key !== supportedKey || d.configuration.eventReason !== 'CreateContainerConfigError') return false
    if (record.scenarioId === 'config-diagnosis' && !proof.observationEvidenceId) return false
  } else {
    const expected = { id: proof.experimentId, scenarioId: proof.experimentScenarioId, attemptId: record.attemptId,
      deploymentUid: record.measurements.identity.deploymentUid, incidentEpoch: record.measurements.identity.incidentEpoch,
      startedAtMs: proof.startedAtMs, endedAtMs: proof.endedAtMs, incident: proof.incident }
    if (proof.outcome !== 'passed' || !proof.terminalSample?.rollout.complete || proof.terminalSample.release !== '2.0'
      || !validFlow(proof.terminalSample) || !matchingObservation(context.evidence.experimentsById[proof.diagnosisEvidenceId], expected, 'config-diagnosis', target)) return false
  }
  return true
}

export function recordConfigReleaseMilestone(input, lab, scenarioId, dependencies) {
  const scenario = lab.scenarios[scenarioId]; const target = scenario.target
  const task = lab.tasks.find(task => task.verification?.scenarioId === scenarioId)
  const state = input.runtime.kubernetes.clusters[target.clusterId]
  const e = observations.includes(scenarioId) ? state.rollouts.experiment
    : [...state.rollouts.receipts].reverse().find(item => item.scenarioId === scenario.experimentScenarioId && item.outcome === 'passed')
  const earned = records(input).find(record => record.taskId === task.id && record.outcome === 'passed' && record.completed)
  const preserve = () => ({ run: input, diagnostics: [], lines: [{ kind: 'out', text: 'Historical configuration milestone already recorded.' }] })
  if (earned && (!observations.includes(scenarioId) || earned.measurements.diagnosis?.experimentId === e?.id)) return preserve()
  const deployment = state.resources[`Deployment/${target.namespace}/${target.deploymentName}`]
  const oldSample = e?.samples.find(sample => input.artifacts.buildsById[sample.artifactId]?.appSpec.version === '1.0' && sample.rollout.currentRevision === e.incident?.revision
    && !sample.rollout.complete && validFlow(sample))
  let passed = e?.attemptId === input.attemptId && e.deploymentUid === deployment?.metadata.uid
    && e.scenarioId === scenario.experimentScenarioId && e.incidentSeen && e.deadlineSeen
    && e.incident?.deadline && e.incident.reasons.includes('CreateContainerConfigError') && e.incident.missingKeys.includes(supportedKey) && !!oldSample
  let diagnosis = null; let observation = null; let priorDiagnosis = null
  if (observations.includes(scenarioId)) {
    const configuration = currentConfigurationFailure(input, target, e)
    passed &&= !!configuration
    if (scenarioId === 'config-diagnosis') {
      observation = e && records(input).find(record => matchingObservation(record, e, 'incident-observed', target))
      passed &&= !!observation
    }
    if (passed) diagnosis = { experimentId: e.id, experimentScenarioId: e.scenarioId, deploymentUid: e.deploymentUid,
      incidentEpoch: e.incidentEpoch, atMs: input.runtime.simTimeMs, revision: e.incident.revision, incident: structuredClone(e.incident), configuration }
    else if (earned) return preserve()
  } else {
    priorDiagnosis = e && records(input).find(record => matchingObservation(record, e, 'config-diagnosis', target))
    passed &&= e.status === 'finished' && e.outcome === 'passed' && !!priorDiagnosis
      && e.samples.at(-1).rollout.complete && e.samples.at(-1).release === '2.0' && validFlow(e.samples.at(-1))
  }
  const proof = e ? { incidentKind: 'missing-config-key', experimentId: e.id, experimentScenarioId: e.scenarioId,
    incident: structuredClone(e.incident), oldSample: oldSample ?? null, oldVersion: input.artifacts.buildsById[oldSample?.artifactId]?.appSpec.version ?? null,
    observationEvidenceId: observation?.id ?? null,
    diagnosisEvidenceId: priorDiagnosis?.id ?? null, startedAtMs: e.startedAtMs, endedAtMs: e.endedAtMs,
    outcome: e.outcome ?? null, terminalSample: e.samples.at(-1) ?? null } : {}
  const reason = observations.includes(scenarioId) ? 'Observe the current stalled v2 Pod, missing ConfigMap key and matching event before repair; verify scope before configuration diagnosis.'
    : 'Diagnose this configuration incident before repair, then finish its stable intended v2 recovery.'
  const key = Object.keys(dependencies)[0]
  const identity = earned?.measurements.identity ?? dependencies[key](input)
  const run = recordVerification(input, lab, task.id, { scenarioId, scenarioVersion: 1, outcome: passed ? 'passed' : 'failed', completed: !!passed,
    startedAtMs: input.runtime.simTimeMs, endedAtMs: input.runtime.simTimeMs,
    measurements: { attemptId: input.attemptId, clusterId: target.clusterId, namespace: target.namespace,
      identity, proof: earned?.measurements.proof ?? proof, diagnosis, reason } })
  return { run, diagnostics: [], lines: [{ kind: 'out', text: passed ? 'Configuration release milestone observed and recorded.' : reason }] }
}
