import { CAPSTONE_IMAGE, CAPSTONE_HPA_DISABLED } from '../../../data/labs/aks-journey/capstone-constants.js'
import { CAPSTONE_TARGET, capstonePublication } from '../../../data/labs/aks-journey/capstone-helpers.js'
import { CAPSTONE_MANIFEST, CAPSTONE_SOLUTION_FILES } from '../../../data/templates/aks-python/capstone.js'
import { INTEGRATION_FIXTURES } from '../../../data/fixtures/aks/integration.js'
import { projectSourceHash, selectBuildFiles } from '../../project/build.js'
import { inspectDeploymentConsistency, releaseFingerprint } from '../release-evidence.js'
import { releaseDigest, releasePolicy, releasePolicyMeetsBrief } from '../release-experiments.js'
import { getDeploymentPods } from '../reconcile.js'
import { getRolloutSummary } from '../rollouts.js'
import { startDiagnosisIncident, validDurableDiagnosisEvidence } from '../diagnosis-incidents.js'
import { verifyDiagnosis } from '../diagnosis-evidence.js'
import { simulateKubernetesRequest } from '../requests.js'
import { resolveServiceDns } from '../connectivity.js'
import { activeAksExperiment } from './stages.js'
import { verifyCapstoneSource } from './scenarios.js'

export const CAPSTONE_V2_IMAGE = CAPSTONE_IMAGE.replace('capstone-v1', 'capstone-v2')
export const CAPSTONE_INCIDENT_FILES = Object.freeze({ ...CAPSTONE_SOLUTION_FILES.v2, 'k8s/hpa.yaml': CAPSTONE_HPA_DISABLED })
export const CAPSTONE_INCIDENT_ID = 'capstone-dual-fault'
export const CAPSTONE_RELEASE_REQUIREMENTS = Object.freeze({ replicas: 2, maxSurge: 1, maxUnavailable: 0,
  minReadySeconds: 5, deadlineMinimum: 60, deadlineMaximum: 60, historyMinimum: 3, cpuRequestM: 250, memoryRequestBytes: 128 * 1024 * 1024 })
const stateFor = run => run.runtime.kubernetes.clusters[CAPSTONE_TARGET.clusterId]
const error = message => ({ code: 'AKS_CAPSTONE_INCIDENT', message })

export function publishedAksCapstoneV2(run) {
  const artifact = capstonePublication(run, '2.0')?.build
  const evidenceId = run.stages.sealedStages.find(stage => stage.stageId === 'provision')?.evidenceIds
    .find(id => run.evidence.experimentsById[id]?.taskId === 'image-v1')
  const tuple = run.evidence.aksCapstoneReceipts[`aks-proof-${evidenceId}`]?.artifacts[0]
  const v1 = run.artifacts.buildsById[tuple?.buildId]
  return !!artifact && !!v1 && artifact.id !== v1.id && artifact.digest !== v1.digest && artifact.appSpec?.version === '2.0'
    && v1.appSpec?.version === '1.0' && artifact.image.tag !== v1.image.tag && artifact.sourceHash !== v1.sourceHash
    && v1.sourceHash === tuple.sourceHash && v1.digest === tuple.digest
    && artifact.sourceHash === projectSourceHash(selectBuildFiles(run.project.savedFiles, CAPSTONE_MANIFEST))
    && verifyCapstoneSource(run.project.savedFiles, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES).passed
}

/** Current source, manifests, fixed desired Pods and captured configuration.
 * Final cleanup may additionally require the native reapply/restart witness. */
export function stableAksCapstoneV2(run, lab, { requireRestart = false } = {}) {
  const state = stateFor(run), deployment = state?.resources['Deployment/assistant/assistant-api']
  if (!deployment || !publishedAksCapstoneV2(run) || !capstonePublication(run, '2.0', { deployed: true })
    || Object.values(state.resources).some(object => object.kind === 'HorizontalPodAutoscaler')
    || run.project.savedFiles['k8s/hpa.yaml']?.trim() !== CAPSTONE_HPA_DISABLED.trim()
    || !releasePolicyMeetsBrief(releasePolicy(run, CAPSTONE_TARGET), CAPSTONE_RELEASE_REQUIREMENTS)
    || !inspectDeploymentConsistency(run, CAPSTONE_TARGET, CAPSTONE_MANIFEST, lab, { requireRestart }).consistent) return false
  const container = deployment.spec.template.spec.containers[0]
  if (!['startup', 'readiness', 'liveness'].every(type => container[`${type}Probe`]?.httpGet?.path ===
    `/health/${type === 'readiness' ? 'ready' : type === 'liveness' ? 'live' : 'startup'}` && container[`${type}Probe`].httpGet.port === 'http')
    || container.resources?.limits?.cpu !== '500m' || container.resources?.limits?.memory !== '256Mi') return false
  const pods = getDeploymentPods(run, CAPSTONE_TARGET.clusterId, 'assistant', 'assistant-api')
  const profile = { ...INTEGRATION_FIXTURES.profiles.training, APP_ENV: 'training' }
  return pods.length === 2 && pods.every(pod => state.health.containers[pod.metadata.uid]?.ready === true
    && Object.entries(profile).every(([key, value]) => state.podSnapshots[pod.metadata.uid]?.environment[key] === value))
    && ['internal', 'external'].every(name => {
      const service = state.resources[`Service/assistant/assistant-${name}`]
      return service?.spec.ports[0].port === 80 && ['http', 8080].includes(service.spec.ports[0].targetPort)
        && service.spec.selector?.app === 'assistant' && (name !== 'external' || !!service.status?.loadBalancer?.ingress?.[0]?.ip)
    })
}
export function stableAksCapstoneV2Dependencies(run) {
  const state = stateFor(run)
  return { ...releaseFingerprint(run, CAPSTONE_TARGET, { capabilities: { aksCapstone: true, kubernetesRollouts: true, kubernetesConfiguration: true,
    kubernetesProbes: true, kubernetesResources: true, kubernetesConnectivity: true } }),
    rollout: getRolloutSummary(run, CAPSTONE_TARGET), hpa: Object.values(state?.resources ?? {}).filter(item => item.kind === 'HorizontalPodAutoscaler').map(item => item.metadata.uid),
    pods: getDeploymentPods(run, CAPSTONE_TARGET.clusterId, 'assistant', 'assistant-api').map(pod => ({ uid: pod.metadata.uid,
      artifactId: state.podSnapshots[pod.metadata.uid]?.artifactId ?? null, configHash: releaseDigest(state.podSnapshots[pod.metadata.uid] ?? null) })) }
}
export function capstoneReleaseProof(run, id) {
  const record = Object.values(run.evidence.experimentsById).find(item => item.taskId === id && item.outcome === 'passed' && item.completed
    && item.measurements.nativeRelease === true)
  const proof = record && run.evidence.aksCapstoneReceipts[`aks-proof-${record.id}`]
  return proof ? { record, proof } : null
}
export function capstoneReleaseDependencies(id) {
  return { [`capstone-release:${id}`]: run => {
    const found = capstoneReleaseProof(run, id)
    return found ? { id: found.proof.id, hash: found.record.aksCapstoneReceiptHash, attemptId: found.record.attemptId } : null
  } }
}
export function validateCapstoneReleaseStart(run, lab, scenarioId) {
  const state = stateFor(run), deployment = state?.resources['Deployment/assistant/assistant-api']
  const pods = getDeploymentPods(run, CAPSTONE_TARGET.clusterId, 'assistant', 'assistant-api')
  if (run.stages.activeStageId !== 'release' || !['capstone-release-v2', 'capstone-rollback-recovered'].includes(scenarioId)
    || activeAksExperiment(run) || !publishedAksCapstoneV2(run) || !getRolloutSummary(run, CAPSTONE_TARGET)?.complete
    || !deployment || !releasePolicyMeetsBrief(releasePolicy(run, CAPSTONE_TARGET), CAPSTONE_RELEASE_REQUIREMENTS)
    || Object.values(state.resources).some(item => item.kind === 'HorizontalPodAutoscaler')
    || run.project.savedFiles['k8s/hpa.yaml']?.trim() !== CAPSTONE_HPA_DISABLED.trim()
    || pods.length !== 2 || pods.some(pod => !state.health.containers[pod.metadata.uid]?.ready)
    || new Set(pods.map(pod => state.podSnapshots[pod.metadata.uid]?.artifactId)).size !== 1)
    return [error('Release measurements require the current published v2 source, two settled fixed Pods, no HPA and no active experiment.')]
  if (scenarioId === 'capstone-release-v2' && pods.some(pod => run.artifacts.buildsById[state.podSnapshots[pod.metadata.uid]?.artifactId]?.appSpec?.version !== '1.0'))
    return [error('Start the v2 observation on the healthy v1 baseline before applying the new image.')]
  if (scenarioId === 'capstone-rollback-recovered' && (!capstoneReleaseProof(run, 'release-v2') || !stableAksCapstoneV2(run, lab)))
    return [error('First observe the healthy v2 release and align its saved/live baseline.')]
  return []
}
export function validateCapstoneReleaseFinish(run, lab, experiment) {
  if (!stableAksCapstoneV2(run, lab)) return false
  if (!experiment.expected.requireIncident) return true
  const history = stateFor(run).rollouts.deployments[experiment.deploymentUid]
  const revision = history.revisions.find(item => item.revision === experiment.incident?.revision)
  return experiment.incident?.deadline === true && experiment.incident.reasons.includes('readiness')
    && revision?.template?.spec?.containers?.[0]?.readinessProbe?.httpGet?.path === '/health/missing'
}
export function capstoneIncidentIdentity(run) {
  const incident = stateFor(run)?.diagnosis?.incident
  if (incident) return { id: incident.id, epoch: incident.epoch, target: incident.target }
  const anchor = Object.values(run.evidence.experimentsById).find(item => item.measurements.diagnosisCapture)?.measurements.diagnosisCapture
  return anchor ? { id: anchor.incidentId, epoch: anchor.epoch, target: anchor.target } : null
}
export function startAksCapstoneIncident(run, lab) {
  const existing = stateFor(run)?.diagnosis?.incident
  if (lab?.capabilities?.aksCapstone !== true || run.stages?.activeStageId !== 'incident')
    return { run, lines: [], diagnostics: [error('Start the declared incident only in its active checkpoint.')] }
  if (existing) return { run, lines: [{ kind: 'out', text: `Incident ${existing.id} already started; its original baseline and epoch are retained.` }], diagnostics: [] }
  if (activeAksExperiment(run) || !stableAksCapstoneV2(run, lab)
    || Object.keys(run.project.savedFiles).some(path => run.project.savedFiles[path] !== run.project.draftFiles[path]))
    return { run, lines: [], diagnostics: [error('Restore stable current v2, two fixed Pods, saved/draft agreement and no active experiment before injection.')] }
  return startDiagnosisIncident(run, CAPSTONE_INCIDENT_ID, lab)
}
export function verifyAksCapstoneIncident(run, lab, scenarioId) {
  const incident = stateFor(run)?.diagnosis?.incident, id = scenarioId.slice('capstone-'.length)
  const failed = reason => ({ run, result: { scenarioId, scenarioVersion: 1, outcome: 'failed', completed: false,
    startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs, measurements: { reason } } })
  if (!incident || incident.labId !== lab.id || incident.attemptId !== run.attemptId) return failed('Start the declared incident first.')
  if (id === 'fault-route') {
    // A retained native first observation remains a valid historical milestone.
    const earned = Object.values(run.evidence.experimentsById).find(item => item.taskId === id && item.measurements.diagnosisCapture && item.outcome === 'passed')
    if (earned && !incident.active) return { run, result: { scenarioId, scenarioVersion: 1, outcome: 'passed', completed: true, startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs,
      measurements: { kind: 'capstone-historical-diagnosis', observationOrigin: 'observed-live-history', receiptId: `aks-proof-${earned.id}`, reason: 'Retained observed route failure.' } } }
    const pods = getDeploymentPods(run, CAPSTONE_TARGET.clusterId, 'assistant', 'assistant-api')
    if (!getRolloutSummary(run, CAPSTONE_TARGET)?.complete || pods.length !== 2
      || stateFor(run).resources['Service/assistant/assistant-external']?.spec.ports[0].targetPort !== 8081
      || pods.some(pod => stateFor(run).podSnapshots[pod.metadata.uid]?.environment.AI_ENDPOINT !== 'https://ai-missing.example')) {
      if (earned) return { run, result: { scenarioId, scenarioVersion: 1, outcome: 'passed', completed: true,
        startedAtMs: run.runtime.simTimeMs, endedAtMs: run.runtime.simTimeMs,
        measurements: { kind: 'capstone-historical-diagnosis', observationOrigin: 'observed-live-history', receiptId: `aks-proof-${earned.id}`, reason: 'Retained observed route failure.' } } }
      return failed('Wait for every faulty-config Pod to be Available before observing both faults.')
    }
  }
  if (id === 'fault-dependency' && !incident.observations.some(item => item.scenarioId === 'capstone-fault-route'))
    return failed('First preserve the route failure with the captured unavailable endpoint.')
  if (id === 'incident-recovered' && (!stableAksCapstoneV2(run, lab) || !['fault-route', 'fault-dependency'].every(taskId =>
    Object.values(run.evidence.experimentsById).some(record => record.taskId === taskId && record.outcome === 'passed'))))
    return failed('Preserve both observations, repair both Services and refresh every v2 Pod environment.')
  let current = run, internalProof = null
  if (id === 'incident-recovered') {
    const scenario = lab.scenarios[scenarioId]
    const dns = resolveServiceDns(run, { clusterId: CAPSTONE_TARGET.clusterId, clientNamespace: 'assistant', hostname: 'assistant-internal.assistant.svc.cluster.local' })
    const internal = simulateKubernetesRequest(run, { id: `${scenarioId}-internal`, target: CAPSTONE_TARGET, request: scenario.request, expected: scenario.expected })
    const measured = internal.measurements
    if (!dns.ok || dns.serviceKey !== 'Service/assistant/assistant-internal' || !internal.outcome
      || measured.artifactId !== capstonePublication(run, '2.0', { deployed: true })?.buildId
      || measured.dependencyTrace.map(item => `${item.operation}:${item.status}`).join() !== 'embedding:succeeded,postgres-query:succeeded,answer:succeeded'
      || measured.integrationTrace?.vectorProvenance !== 'embedding' || measured.integrationTrace?.sourceProvenance !== 'rows')
      return failed('Verify the repaired internal Service and full source-backed answer flow.')
    current = internal.run
    internalProof = { kind: 'internal-service-request', dns, requestSequence: measured.requestSequence, status: internal.status,
      serviceUid: stateFor(run).resources['Service/assistant/assistant-internal'].metadata.uid,
      podUid: measured.podUid, artifactId: measured.artifactId, sources: internal.body.sources,
      operations: measured.dependencyTrace.map(item => [item.operation, item.status]) }
  }
  const verified = verifyDiagnosis(current, lab, scenarioId)
  if (internalProof) verified.result.measurements.internalRecovery = internalProof
  return verified
}
export function validateAksCapstoneDiagnosis(record, proof, run, lab) {
  return validDurableDiagnosisEvidence(record, proof, run, lab)
}
