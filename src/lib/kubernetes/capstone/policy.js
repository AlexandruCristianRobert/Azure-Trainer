import { getRolloutSummary } from '../rollouts.js'
export { validateAksExperimentStart } from './resilience.js'

export function getAksCapstonePolicy(run, lab) {
  if (lab?.capabilities?.aksCapstone !== true) return { allowHpa: lab?.capabilities?.kubernetesRollouts !== true, allowTemplateChange: true, allowDestructiveCleanup: true }
  const states = Object.entries(run.runtime.kubernetes?.clusters ?? {})
  const hpa = states.some(([, state]) => Object.values(state.resources).some(item => item.kind === 'HorizontalPodAutoscaler'))
  const release = states.some(([, state]) => state.rollouts?.experiment?.status === 'active')
  const rollout = states.some(([clusterId, state]) => Object.values(state.resources).filter(item => item.kind === 'Deployment')
    .some(item => !getRolloutSummary(run, { clusterId, namespace: item.metadata.namespace, deploymentName: item.metadata.name })?.complete))
  return { allowHpa: run.stages?.activeStageId === 'resilience' && !release && !rollout,
    allowTemplateChange: !hpa, allowDestructiveCleanup: run.stages?.activeStageId === 'final-cleanup' && !!run.stages.cleanupCheckpoint }
}

export function capstoneTemplateDiagnostic(run, lab) {
  return getAksCapstonePolicy(run, lab).allowTemplateChange ? null : {
    code: 'AKS_CAPSTONE_HPA_TEMPLATE', message: 'This trainer does not combine a CPU HPA with Pod-template rollouts. Delete the HPA before changing, restarting or undoing the template.' }
}
