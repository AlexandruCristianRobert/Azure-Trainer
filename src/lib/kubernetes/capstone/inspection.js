import { evaluateLab } from '../../labEngine/evaluate.js'
import { inspectAksOwnership } from './ownership.js'
import { activeAksExperiment, aksCleanupReady, isAksCapstone } from './stages.js'

const copy = value => value == null ? value : structuredClone(value)

function liveDeployment(run) {
  const deployments = []
  for (const [clusterId, state] of Object.entries(run.runtime.kubernetes?.clusters ?? {})) {
    for (const resource of Object.values(state.resources ?? {})) {
      if (resource.kind !== 'Deployment') continue
      const pods = Object.values(state.resources).filter(item => item.kind === 'Pod'
        && item.metadata.namespace === resource.metadata.namespace
        && Object.entries(resource.spec?.selector?.matchLabels ?? {}).every(([key, value]) => item.metadata.labels?.[key] === value))
      deployments.push({ clusterId, namespace: resource.metadata.namespace, name: resource.metadata.name,
        image: resource.spec?.template?.spec?.containers?.[0]?.image ?? null,
        desiredReplicas: resource.spec?.replicas ?? 1,
        pods: pods.map(pod => ({ uid: pod.metadata.uid, name: pod.metadata.name,
          artifactId: state.podSnapshots?.[pod.metadata.uid]?.artifactId ?? null,
          ready: pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True') ?? false })) })
    }
  }
  return deployments
}

export function inspectAksCapstone(run, lab) {
  if (!isAksCapstone(lab)) throw new TypeError('AKS capstone inspection requires an AKS capstone Lab.')
  const evaluated = evaluateLab(lab, run)
  const invalid = evaluated.tasks.some(task => task.reason === 'invalid-run')
  if (invalid) return { stages: lab.stages.map((stage, index) => ({ id: stage.id, title: stage.title ?? stage.id, taskIds: [...stage.taskIds], index,
    status: 'Unavailable', evidenceMode: 'current', tasks: evaluated.tasks.filter(task => stage.taskIds.includes(task.id)), seal: null, proofs: [] })),
  activeStage: null, canAdvance: false, incident: { current: null, history: [] },
  cleanup: { checkpoint: null, frozen: false, eligible: false, diagnostics: [{ code: 'INVALID_RUN', message: 'Saved AKS progress is unavailable.' }],
    owned: [], protected: [], remaining: [], protectedIntact: null, ready: false }, artifact: { selected: [], deployed: [] }, deployment: [] }
  const sealed = run.stages?.sealedStages ?? []
  const receipts = run.evidence?.aksCapstoneReceipts ?? {}
  const stages = lab.stages.map((stage, index) => {
    const seal = sealed[index] ?? null
    const status = seal ? 'Sealed' : run.stages?.activeStageId === stage.id ? 'Active' : 'Locked'
    const tasks = evaluated.tasks.filter(task => stage.taskIds.includes(task.id))
    const evidenceIds = seal?.evidenceIds ?? tasks.map(task => run.evidence.currentEvidenceByTask?.[task.id]).filter(Boolean)
    return { id: stage.id, title: stage.title ?? stage.id, taskIds: [...stage.taskIds], index, status, evidenceMode: seal ? 'historical' : 'current',
      tasks, seal: copy(seal), proofs: evidenceIds.map(id => receipts[`aks-proof-${id}`]).filter(Boolean).map(copy) }
  })
  const activeStage = stages.find(stage => stage.status === 'Active') ?? null
  const busy = activeAksExperiment(run)
  const ownership = inspectAksOwnership(run)
  const suppliedCleanup = lab.aksCapstone?.inspectCleanup?.(run)
  const checkpoint = run.stages?.cleanupCheckpoint ?? null
  const cleanupDiagnostics = typeof lab.aksCapstone?.cleanupEligibility === 'function'
    ? lab.aksCapstone.cleanupEligibility(run) : [{ code: 'AKS_CLEANUP_UNAVAILABLE', message: 'Cleanup eligibility is unavailable.' }]
  const cleanup = { checkpoint: copy(checkpoint), frozen: !!checkpoint,
    eligible: !invalid && !checkpoint && sealed.length === 7 && !busy && Array.isArray(cleanupDiagnostics) && cleanupDiagnostics.length === 0,
    diagnostics: copy(cleanupDiagnostics), owned: ownership.owned, protected: ownership.protected,
    remaining: copy(suppliedCleanup?.remaining ?? ownership.remaining),
    protectedIntact: suppliedCleanup?.protectedIntact ?? null,
    ready: !invalid && aksCleanupReady(run, lab) }
  const exit = activeStage && typeof lab.aksCapstone?.stageExit === 'function'
    ? lab.aksCapstone.stageExit(run, lab.stages[activeStage.index]) : []
  const canAdvance = !invalid && !!activeStage && activeStage.tasks.every(task => task.done) && !busy
    && Array.isArray(exit) && exit.length === 0 && (activeStage.index !== 7 || cleanup.ready)
  const durable = stages.flatMap(stage => stage.proofs.map(proof => ({ stageId: stage.id, proof })))
  const selected = durable.flatMap(({ stageId, proof }) => proof.artifacts.map(item => ({ ...copy(item), stageId,
    evidenceId: proof.evidenceId, proofSequence: proof.sequence })))
    .sort((a, b) => a.proofSequence - b.proofSequence)
  const deployment = liveDeployment(run)
  const deployed = deployment.flatMap(item => item.pods.map(pod => ({ ...pod, clusterId: item.clusterId,
    artifact: copy(run.artifacts.buildsById[pod.artifactId] ?? null) })))
  const incidentStage = stages.find(stage => stage.id === 'incident')
  const incidents = incidentStage?.proofs.map(proof => ({ id: proof.id, evidenceId: proof.evidenceId,
    outcome: proof.observation.outcome, observation: copy(proof.observation), targets: copy(proof.targets) })) ?? []
  const liveIncident = Object.values(run.runtime.kubernetes?.clusters ?? {})
    .map(state => state.diagnosis?.incident).find(Boolean) ?? null
  return { stages, activeStage, canAdvance,
    incident: { current: copy(liveIncident), history: incidents }, cleanup,
    artifact: { selected, deployed }, deployment }
}
