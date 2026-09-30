import { isPlainObject, isJsonValue } from '../labEngine/run.js'
import { canonicalize } from '../labEngine/evidence.js'

const text = value => typeof value === 'string' && value.length > 0 && value.length <= 2048
const nullableText = value => value === null || text(value)
const counter = value => Number.isSafeInteger(value) && value >= 0
const hash = value => typeof value === 'string' && /^fnv1a32:[0-9a-f]{1,8}$/.test(value)
const keys = (value, allowed) => isPlainObject(value) && Object.keys(value).every(key => allowed.includes(key))
const timestamp = (value, limit) => counter(value) && value <= limit
const targetValid = value => keys(value, ['clusterId', 'namespace', 'deploymentName', 'serviceName']) && Object.keys(value).length === 4 && Object.values(value).every(text)

function sampleValid(sample, experiment, nowMs, capstone = false) {
  if (!keys(sample, ['atMs', 'requestId', 'question', 'transport', 'status', 'answer', 'sources', 'release', 'podUid', 'artifactId', 'operations', 'integrationTrace', 'rollout', 'rolloutPolicy', 'backends'])
    || !timestamp(sample.atMs, Math.min(nowMs, experiment.startedAtMs + 300000)) || sample.atMs < experiment.startedAtMs
    || !/^aks-request-\d+$/.test(sample.requestId) && !(capstone && /^request-[1-9]\d*$/.test(sample.requestId)) || !['How long are backups kept?', 'Who provides support?'].includes(sample.question)
    || !keys(sample.transport, ['ok', 'reason']) || typeof sample.transport.ok !== 'boolean' || !nullableText(sample.transport.reason)
    || !(sample.status === null || Number.isInteger(sample.status) && sample.status >= 100 && sample.status <= 599)
    || !nullableText(sample.answer) || !nullableText(sample.release) || !nullableText(sample.podUid) || !nullableText(sample.artifactId)
    || !Array.isArray(sample.sources) || sample.sources.length > 10 || !sample.sources.every(text)
    || !Array.isArray(sample.operations) || sample.operations.length > 10 || !sample.operations.every(item => keys(item, ['operation', 'status', 'attempts'])
      && ['embedding', 'postgres-query', 'answer'].includes(item.operation) && ['succeeded', 'failed'].includes(item.status)
      && Array.isArray(item.attempts) && item.attempts.length <= 3 && item.attempts.every(attempt => keys(attempt, ['status', 'durationMs', 'waitMs']) && nullableText(attempt.status) && counter(attempt.durationMs) && counter(attempt.waitMs)))
    || !Array.isArray(sample.backends) || sample.backends.length > 12 || !sample.backends.every(item => keys(item, ['podUid', 'revision', 'artifactId', 'digest', 'sourceHash']) && text(item.podUid)
      && (item.revision === null || counter(item.revision) && item.revision > 0) && [item.artifactId, item.digest, item.sourceHash].every(nullableText))) return false
  const rollout = sample.rollout
  if (sample.rolloutPolicy !== undefined && (!keys(sample.rolloutPolicy, ['replicas', 'surge', 'unavailable', 'minReadySeconds', 'progressDeadlineSeconds', 'revisionHistoryLimit', 'nonterminating', 'cpuRequestM', 'memoryRequestBytes'])
    || !['replicas', 'surge', 'unavailable', 'minReadySeconds', 'progressDeadlineSeconds', 'revisionHistoryLimit', 'nonterminating'].every(key => counter(sample.rolloutPolicy[key]))
    || (sample.rolloutPolicy.cpuRequestM === undefined) !== (sample.rolloutPolicy.memoryRequestBytes === undefined)
    || sample.rolloutPolicy.cpuRequestM !== undefined && !['cpuRequestM', 'memoryRequestBytes'].every(key => sample.rolloutPolicy[key] === null || counter(sample.rolloutPolicy[key])))) return false
  if (!keys(rollout, ['desired', 'updated', 'ready', 'available', 'unavailable', 'terminating', 'complete', 'currentRevision', 'conditions'])
    || !['desired', 'updated', 'ready', 'available', 'unavailable', 'terminating', 'currentRevision'].every(key => counter(rollout[key]))
    || rollout.desired < 1 || rollout.desired > 6 || typeof rollout.complete !== 'boolean' || !Array.isArray(rollout.conditions) || rollout.conditions.length > 4
    || !rollout.conditions.every(item => keys(item, ['type', 'status', 'reason']) && Object.values(item).every(text))) return false
  const trace = sample.integrationTrace
  return trace === null || keys(trace, ['version', 'graphHash', 'queryHash', 'fixtureVersion', 'profileId', 'vectorProvenance', 'sourceProvenance', 'elapsedMs'])
    && trace.version === 1 && trace.fixtureVersion === 1 && [trace.graphHash, trace.queryHash, trace.profileId, trace.vectorProvenance, trace.sourceProvenance].every(nullableText) && counter(trace.elapsedMs)
}

export function validReleaseExperiment(experiment, state, clusterId, run, lab, receipt = false) {
  if (!keys(experiment, ['version', 'id', 'attemptId', 'scenarioId', 'scenarioVersion', 'target', 'deploymentUid', 'context', 'contextNamespace', 'baselineReplicas', 'baselineRevision', 'incidentEpoch', 'baseline', 'expected', 'status', 'phase', 'startedAtMs', 'endedAtMs', 'changedTemplate', 'incidentSeen', 'deadlineSeen', 'terminalSinceMs', 'samples', 'lastSemanticHash', 'cancellationReason', 'outcome', 'reason', 'incident'])
    || experiment.version !== 1 || !/^release-\d+$/.test(experiment.id) || experiment.attemptId !== run.attemptId || !text(experiment.scenarioId) || experiment.scenarioVersion !== 1
    || !targetValid(experiment.target) || experiment.target.clusterId !== clusterId || !text(experiment.deploymentUid) || !nullableText(experiment.context) || !nullableText(experiment.contextNamespace)
    || !Number.isInteger(experiment.baselineReplicas) || experiment.baselineReplicas < 1 || experiment.baselineReplicas > 6
    || !counter(experiment.baselineRevision) || experiment.baselineRevision < 1 || !counter(experiment.incidentEpoch)
    || !timestamp(experiment.startedAtMs, run.runtime.simTimeMs) || !['active', 'cancelled', 'finished'].includes(experiment.status)
    || !['baseline', 'changed-template', 'incident-seen', 'recovered', 'finished'].includes(experiment.phase)
    || !['changedTemplate', 'incidentSeen', 'deadlineSeen'].every(key => typeof experiment[key] === 'boolean')
    || !(experiment.terminalSinceMs === null || timestamp(experiment.terminalSinceMs, run.runtime.simTimeMs) && experiment.terminalSinceMs >= experiment.startedAtMs)
    || !nullableText(experiment.cancellationReason) || !(experiment.lastSemanticHash === null || hash(experiment.lastSemanticHash))
    || !keys(experiment.baseline, ['savedHash', 'objectsHash', 'artifactIds']) || !hash(experiment.baseline.savedHash) || !hash(experiment.baseline.objectsHash)
    || !Array.isArray(experiment.baseline.artifactIds) || experiment.baseline.artifactIds.length > 12 || !experiment.baseline.artifactIds.every(nullableText)
    || !isJsonValue(experiment.expected) || !Array.isArray(experiment.samples) || experiment.samples.length < 1 || experiment.samples.length > 1200) return false
  const scenario = lab.scenarios?.[experiment.scenarioId]
  if (!scenario || canonicalize(experiment.expected) !== canonicalize(scenario)
    || (scenario.freshIncidentEpoch ? experiment.incidentEpoch !== scenario.incidentEpoch + Number(experiment.id.slice('release-'.length)) : experiment.incidentEpoch !== scenario.incidentEpoch)
    || canonicalize(experiment.target) !== canonicalize(scenario.target)) return false
  const limit = experiment.endedAtMs ?? run.runtime.simTimeMs
  if (experiment.samples[0]?.atMs !== experiment.startedAtMs || experiment.samples[0]?.rollout?.desired !== experiment.baselineReplicas
    || experiment.samples[0]?.rollout?.currentRevision !== experiment.baselineRevision
    || !experiment.samples.every((sample, index) => sampleValid(sample, experiment, limit, lab.capabilities?.aksCapstone === true) && (index === 0 || sample.atMs >= experiment.samples[index - 1].atMs))) return false
  const observedLimit = experiment.samples.at(-1)?.atMs
  const incident = experiment.incident
  if (experiment.incidentSeen !== (incident !== null) || experiment.deadlineSeen !== (incident?.deadline === true)
    || experiment.incidentSeen && !experiment.changedTemplate) return false
  if (incident !== null && (!keys(incident, ['atMs', 'revision', 'podUids', 'reasons', 'missingKeys', 'deadline'])
    || !timestamp(incident.atMs, Math.min(limit, observedLimit, experiment.startedAtMs + 300000)) || incident.atMs < experiment.startedAtMs || !counter(incident.revision) || incident.revision < 1
    || !['podUids', 'reasons', 'missingKeys'].every(key => Array.isArray(incident[key]) && incident[key].length <= 12 && incident[key].every(text))
    || !incident.podUids.length || !incident.reasons.length || typeof incident.deadline !== 'boolean'
    || !experiment.samples.some(sample => sample.atMs === incident.atMs && sample.rollout?.currentRevision === incident.revision && sample.rollout.complete === false))) return false
  if (experiment.deadlineSeen && !experiment.samples.some(sample => sample.rollout?.conditions?.some(condition => condition.reason === 'ProgressDeadlineExceeded'))) return false
  if (experiment.terminalSinceMs !== null && !timestamp(experiment.terminalSinceMs, Math.min(limit, observedLimit, experiment.startedAtMs + 300000))) return false
  const expectedPhase = experiment.terminalSinceMs !== null ? 'recovered' : experiment.incidentSeen ? 'incident-seen' : experiment.changedTemplate ? 'changed-template' : 'baseline'
  if (experiment.status !== 'finished' && (experiment.phase !== expectedPhase || experiment.outcome !== undefined || experiment.reason !== undefined)) return false
  if (experiment.status === 'cancelled' ? !text(experiment.cancellationReason) : experiment.cancellationReason !== null) return false
  if (experiment.status === 'active') {
    if (receipt || experiment.endedAtMs !== null || run.runtime.simTimeMs - experiment.startedAtMs > 300000
      || state.resources[`Deployment/${experiment.target.namespace}/${experiment.target.deploymentName}`]?.metadata.uid !== experiment.deploymentUid) return false
  } else if (!timestamp(experiment.endedAtMs, run.runtime.simTimeMs) || experiment.endedAtMs < experiment.startedAtMs || experiment.endedAtMs - experiment.startedAtMs > 300000) return false
  if (experiment.status === 'finished' && (experiment.phase !== 'finished' || !['passed', 'failed'].includes(experiment.outcome) || !text(experiment.reason))) return false
  if (experiment.status === 'finished' && experiment.outcome === 'passed' && (!experiment.changedTemplate
    || scenario.requireIncident && !experiment.incidentSeen || scenario.requireDeadline && !experiment.deadlineSeen
    || experiment.terminalSinceMs === null || limit - experiment.terminalSinceMs < 10000)) return false
  return true
}

export function validReleaseProofs(proofs, state, run) {
  return proofs === undefined || isPlainObject(proofs) && Object.keys(proofs).length <= 20 && Object.entries(proofs).every(([uid, proof]) => {
    if (!keys(proof, ['version', 'target', 'generation', 'hash', 'inputsHash', 'objectStates', 'appliedKeys', 'reapply', 'restart']) || proof.version !== 1 || !targetValid(proof.target) || !counter(proof.generation) || !hash(proof.hash)
      || !Array.isArray(proof.appliedKeys) || proof.appliedKeys.length > 128 || !proof.appliedKeys.every(text)) return false
    if ((proof.inputsHash === undefined) !== (proof.objectStates === undefined)
      || proof.inputsHash !== undefined && (!hash(proof.inputsHash) || !isPlainObject(proof.objectStates) || Object.keys(proof.objectStates).length > 128
        || !Object.entries(proof.objectStates).every(([key, item]) => text(key) && keys(item, ['hash', 'generation']) && hash(item.hash) && counter(item.generation)))) return false
    const reapply = proof.reapply
    if (reapply !== null && (!keys(reapply, ['atMs', 'hash', 'dependencyGenerations', 'objectGenerations', 'semanticHashes']) || !timestamp(reapply.atMs, run.runtime.simTimeMs) || !hash(reapply.hash)
      || !isPlainObject(reapply.dependencyGenerations) || Object.keys(reapply.dependencyGenerations).length > 17 || !Object.values(reapply.dependencyGenerations).every(counter)
      || reapply.objectGenerations !== undefined && (!isPlainObject(reapply.objectGenerations) || Object.keys(reapply.objectGenerations).length > 128 || !Object.entries(reapply.objectGenerations).every(([key, value]) => text(key) && counter(value)))
      || !keys(reapply.semanticHashes, ['saved', 'live']) || !Object.values(reapply.semanticHashes).every(hash))) return false
    const restart = proof.restart
    return (restart === null || keys(restart, ['atMs', 'rsUid', 'generation', 'beforePodUids', 'podUids']) && timestamp(restart.atMs, run.runtime.simTimeMs) && text(restart.rsUid) && counter(restart.generation)
      && ['beforePodUids', 'podUids'].every(key => Array.isArray(restart[key]) && restart[key].length <= 120 && restart[key].every(text)))
      && Object.values(state.resources).some(item => item.kind === 'Deployment' && item.metadata.uid === uid)
  })
}
