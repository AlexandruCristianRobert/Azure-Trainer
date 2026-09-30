import { CAPSTONE_TARGET, capstoneLive, CAPSTONE_HPA_DISABLED } from '../../../data/labs/aks-journey/capstone-helpers.js'
import { CAPSTONE_MANIFEST } from '../../../data/templates/aks-python/capstone.js'
import { INTEGRATION_FIXTURES } from '../../../data/fixtures/aks/integration.js'
import { verifyCapstoneSource } from './scenarios.js'
import { activeAksExperiment } from './stages.js'
import { getRolloutSummary } from '../rollouts.js'
import { parseKubernetesYaml } from '../yaml.js'
import { validateKubernetesObject } from '../schema.js'

export const RESILIENCE_MILESTONES = ['startup-proof', 'readiness-proof', 'liveness-proof', 'manual-capacity', 'hpa-cycle', 'ai-wait']
export { CAPSTONE_HPA_DISABLED }

// Select the original native measurement, never a later named Verify wrapper.
// Its durable proof survives later Pod replacement, source edits and cleanup.
export function measuredMilestone(run, id) {
  const record = Object.values(run.evidence.experimentsById).find(item => item.taskId === id && item.outcome === 'passed'
    && (item.measurements.probeReceipt || item.measurements.profileId))
  const proof = record && run.evidence.aksCapstoneReceipts?.[`aks-proof-${record.id}`]
  return proof ? { record, proof } : null
}
export function milestoneDependencies(id) {
  return { [`capstone-measured:${id}`]: run => {
    const measured = measuredMilestone(run, id)
    return measured ? { receiptId: measured.proof.id, receiptHash: measured.record.aksCapstoneReceiptHash, attemptId: measured.proof.attemptId,
      targets: measured.proof.targets, sourceVersions: measured.proof.sourceVersions,
      startedAtMs: measured.record.startedAtMs, endedAtMs: measured.record.endedAtMs } : null
  } }
}

export function validateAksExperimentStart(run, lab, scenarioId) {
  if (lab?.capabilities?.aksCapstone !== true) return []
  const bad = message => [{ code: 'AKS_CAPSTONE_EXPERIMENT', message }]
  if (run.stages?.activeStageId !== 'resilience' || !RESILIENCE_MILESTONES.some(id => scenarioId === `capstone-${id}`))
    return bad('Resilience experiments are available only in their active checkpoint.')
  if (activeAksExperiment(run)) return bad('Finish or cancel the active measured experiment first.')
  const live = capstoneLive(run, { replicas: lab.scenarios[scenarioId].kind === 'aks-probe' ? 2 : null })
  if (!live.sourceBuilt || !live.configured || !live.routed || !live.clusterReady || !live.grant || live.context?.clusterId !== CAPSTONE_TARGET.clusterId
    || !verifyCapstoneSource(run.project.savedFiles, CAPSTONE_MANIFEST, INTEGRATION_FIXTURES).passed
    || live.pods.some(pod => live.state.podSnapshots[pod.metadata.uid]?.artifactId !== live.buildId))
    return bad('Build, publish and deploy the current complete capstone source before measuring it.')
  const hpa = Object.values(live.state.resources).find(item => item.kind === 'HorizontalPodAutoscaler')
  if (lab.scenarios[scenarioId].kind === 'aks-probe' && (hpa || !live.configured || !live.routed
    || !getRolloutSummary(run, CAPSTONE_TARGET)?.complete)) return bad('Probe measurements require two settled current Pods and no HPA.')
  if (['capstone-hpa-cycle', 'capstone-ai-wait'].includes(scenarioId) && (!hpa
    || hpa.metadata.name !== 'assistant-cpu' || hpa.spec.scaleTargetRef.name !== 'assistant-api'
    || hpa.spec.minReplicas !== 2 || hpa.spec.maxReplicas !== 4
    || hpa.spec.metrics[0].resource.target.averageUtilization !== 60
    || hpa.spec.behavior.scaleDown.stabilizationWindowSeconds !== 60)) return bad('Apply the declared assistant-cpu policy (2–4 replicas, 60% CPU and 60s stabilization).')
  if (scenarioId === 'capstone-ai-wait' && (!measuredMilestone(run, 'hpa-cycle') || live.deployment.spec.replicas !== 2))
    return bad('First measure the full CPU HPA cycle and let it return to two replicas.')
  return []
}

const contains = (live, desired) => desired === null || typeof desired !== 'object' ? live === desired
  : Array.isArray(desired) ? Array.isArray(live) && live.length === desired.length && desired.every((item, index) => contains(live[index], item))
    : !!live && Object.entries(desired).every(([key, value]) => contains(live[key], value))

export function releaseBaselineReady(run) {
  const live = capstoneLive(run)
  if (!live.sourceBuilt || !live.configured || !live.routed || activeAksExperiment(run)
    || !getRolloutSummary(run, CAPSTONE_TARGET)?.complete
    || Object.values(live.state.resources).some(item => item.kind === 'HorizontalPodAutoscaler')
    || run.project.savedFiles['k8s/hpa.yaml']?.trim() !== CAPSTONE_HPA_DISABLED.trim()) return false
  return CAPSTONE_MANIFEST.kubernetesFiles.filter(path => path !== 'k8s/hpa.yaml').every(path => {
    const parsed = parseKubernetesYaml(run.project.savedFiles[path], path)
    if (parsed.diagnostics.length || parsed.documents.length !== 1) return false
    const checked = validateKubernetesObject(parsed.documents[0], { capabilities: { kubernetesConfiguration: true,
      kubernetesProbes: true, kubernetesResources: true, kubernetesRollouts: true } })
    const object = checked.object
    return !checked.diagnostics.length && (object.kind !== 'Deployment' || parsed.documents[0].spec.replicas === 2)
      && contains(live.state.resources[`${object.kind}/${object.metadata.namespace ?? ''}/${object.metadata.name}`], object)
  })
}
