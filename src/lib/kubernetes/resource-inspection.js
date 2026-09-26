import { getDeploymentPods } from './reconcile.js'

export function inspectResources(run, target) {
  const state = run.runtime.kubernetes.clusters[target.clusterId]
  const runtime = state.resourcesRuntime
  const pods = getDeploymentPods(run, target.clusterId, target.namespace, target.deploymentName).map(pod => ({
    uid: pod.metadata.uid, phase: pod.status?.phase ?? null, nodeName: pod.spec?.nodeName ?? null,
    schedulingReason: pod.status?.schedulingReason ?? null,
  })).sort((a, b) => a.uid.localeCompare(b.uid))
  return { nodes: structuredClone(runtime?.nodes ?? {}), assignments: structuredClone(runtime?.assignments ?? {}), pods }
}
