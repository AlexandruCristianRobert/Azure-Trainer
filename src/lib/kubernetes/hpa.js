import { kubeObjectKey } from './objects.js'
import { getDeploymentPods } from './reconcile.js'
import { normalizeContainerResources } from './resource-schema.js'
import { setDeploymentReplicas } from './scheduling.js'

const clone = value => structuredClone(value)
const condition = (type, status, reason, message) => ({ type, status: status ? 'True' : 'False', reason, message })
const targetKey = (namespace, name) => `${namespace}/${name}`

export function validateHpa(input, { namespace, deployments = [] } = {}) {
  const fail = (code, message) => ({ object: null, diagnostics: [{ code, message, path: '', line: 1, column: 1 }] })
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('INVALID_OBJECT', 'A HorizontalPodAutoscaler object is required.')
  if (Object.keys(input).some(key => !['apiVersion', 'kind', 'metadata', 'spec'].includes(key))) return fail('UNSUPPORTED_FIELD', 'The HPA contains an unsupported field.')
  if (input.apiVersion !== 'autoscaling/v2' || input.kind !== 'HorizontalPodAutoscaler') return fail('INVALID_HPA', 'Only autoscaling/v2 HorizontalPodAutoscaler objects are supported.')
  const meta = input.metadata; const spec = input.spec
  if (!meta || typeof meta !== 'object' || Object.keys(meta).some(key => !['name', 'namespace', 'labels'].includes(key)) || typeof meta.name !== 'string' || !meta.name) return fail('INVALID_HPA_METADATA', 'An HPA name is required.')
  if (meta.namespace !== undefined && meta.namespace !== namespace) return fail('KUBE_NAMESPACE_MISMATCH', 'Manifest namespace does not match the selected namespace.')
  if (!spec || typeof spec !== 'object' || Object.keys(spec).some(key => !['scaleTargetRef', 'minReplicas', 'maxReplicas', 'metrics', 'behavior'].includes(key))) return fail('UNSUPPORTED_FIELD', 'The HPA spec contains an unsupported field.')
  const ref = spec.scaleTargetRef
  if (!ref || typeof ref !== 'object' || Object.keys(ref).some(key => !['apiVersion', 'kind', 'name'].includes(key)) || ref.apiVersion !== 'apps/v1' || ref.kind !== 'Deployment' || typeof ref.name !== 'string' || ref.name.length > 63 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(ref.name)) return fail('INVALID_HPA_TARGET', 'HPA must target an apps/v1 Deployment in its namespace.')
  if (!Number.isInteger(spec.minReplicas) || !Number.isInteger(spec.maxReplicas) || spec.minReplicas < 1 || spec.maxReplicas > 6 || spec.minReplicas > spec.maxReplicas) return fail('INVALID_HPA_REPLICAS', 'HPA minReplicas and maxReplicas must be from 1 through 6.')
  if (!Array.isArray(spec.metrics) || spec.metrics.length !== 1) return fail('INVALID_HPA_METRICS', 'Exactly one CPU utilization Resource metric is required.')
  const metric = spec.metrics[0]; const resource = metric?.resource; const target = resource?.target
  if (!metric || Object.keys(metric).some(key => !['type', 'resource'].includes(key)) || metric.type !== 'Resource' || !resource || Object.keys(resource).some(key => !['name', 'target'].includes(key)) || resource.name !== 'cpu' || !target || Object.keys(target).some(key => !['type', 'averageUtilization'].includes(key)) || target.type !== 'Utilization' || !Number.isInteger(target.averageUtilization) || target.averageUtilization < 10 || target.averageUtilization > 100) return fail('INVALID_HPA_METRICS', 'Only CPU average utilization from 10 through 100 is supported.')
  if (spec.behavior !== undefined) {
    const down = spec.behavior?.scaleDown
    if (!spec.behavior || typeof spec.behavior !== 'object' || Array.isArray(spec.behavior) || Object.keys(spec.behavior).some(key => key !== 'scaleDown') || !down || typeof down !== 'object' || Array.isArray(down) || Object.keys(down).some(key => key !== 'stabilizationWindowSeconds') || !Number.isInteger(down.stabilizationWindowSeconds) || down.stabilizationWindowSeconds < 0 || down.stabilizationWindowSeconds > 300) return fail('INVALID_HPA_BEHAVIOR', 'scaleDown.stabilizationWindowSeconds must be an integer from 0 through 300.')
  }
  const resolved = clone(input); resolved.metadata.namespace ??= namespace
  const duplicate = deployments.find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.namespace === resolved.metadata.namespace && item.spec.scaleTargetRef.name === ref.name && item.metadata.name !== resolved.metadata.name)
  if (duplicate) return fail('HPA_TARGET_CONFLICT', `HorizontalPodAutoscaler '${duplicate.metadata.name}' already controls Deployment '${ref.name}'.`)
  return { object: resolved, diagnostics: [] }
}

function latestMetric(runtime, pod, container, atMs) {
  if (pod.status?.phase !== 'Running' || pod.metadata.deletionTimestamp !== undefined || container?.ready !== true || container?.restartAtMs !== null || container?.terminatedAtMs !== null) return null
  return [...(runtime.metrics[pod.metadata.uid] ?? [])].reverse().find(sample => sample.containerId === container.containerId && sample.windowEndMs === atMs && sample.readySinceMs <= sample.windowStartMs)
}

export function reconcileHpa(input, clusterId, atMs, lab) {
  if (lab?.capabilities?.kubernetesResources !== true || atMs % 15_000 !== 0) return input
  let run = clone(input); const initial = run.runtime.kubernetes.clusters?.[clusterId]
  if (!initial?.resourcesRuntime) return input
  for (const hpaUid of Object.values(initial.resources).filter(item => item.kind === 'HorizontalPodAutoscaler').map(item => item.metadata.uid)) {
    const state = run.runtime.kubernetes.clusters[clusterId]; const runtime = state.resourcesRuntime
    const hpa = Object.values(state.resources).find(item => item.kind === 'HorizontalPodAutoscaler' && item.metadata.uid === hpaUid)
    if (!hpa) continue
    const controller = runtime.hpa[hpa.metadata.uid] ??= { policyGeneration: hpa.metadata.generation ?? 1, nextSyncMs: atMs, lastSyncMs: null, recommendations: [], lastDecision: null }
    if (controller.lastSyncMs === atMs) continue
    controller.lastSyncMs = atMs; controller.nextSyncMs = atMs + 15_000
    const ref = hpa.spec.scaleTargetRef; const deployment = state.resources[kubeObjectKey('Deployment', hpa.metadata.namespace, ref.name)]
    if (!deployment) {
      hpa.status = { currentReplicas: 0, desiredReplicas: 0, currentMetrics: [], conditions: [condition('AbleToScale', false, 'FailedGetScale', 'The scale target is unavailable.'), condition('ScalingActive', false, 'FailedGetScale', 'The scale target is unavailable.'), condition('ScalingLimited', false, 'DesiredWithinRange', 'The desired count is within range.')] }
      controller.lastDecision = { reason: 'target-unavailable', rawDesired: null, adjustedDesired: null, stabilizedDesired: null, observedUtilization: null, missingSamples: true, unreadySamples: false, atMs, beforeStabilization: null }; continue
    }
    const current = deployment.spec.replicas; const pods = getDeploymentPods(run, clusterId, hpa.metadata.namespace, ref.name).filter(pod => pod.metadata.deletionTimestamp === undefined)
    const measured = []; let missingRequest = false; let missing = false; let unready = false
    for (const pod of pods) {
      const effective = normalizeContainerResources(pod.spec.containers[0].resources ?? {}).effective
      if (!(effective.cpuRequestM > 0)) { missingRequest = true; continue }
      const sample = latestMetric(runtime, pod, state.health?.containers?.[pod.metadata.uid], atMs)
      if (!sample) { missing = true; if (state.health?.containers?.[pod.metadata.uid]?.ready !== true) unready = true; continue }
      measured.push({ utilization: sample.cpuAverageM / effective.cpuRequestM * 100 })
    }
    const target = hpa.spec.metrics[0].resource.target.averageUtilization; let desired = current; let observed = null; let reason = 'NoMetrics'; let active = false; let rawDesired = null; let adjustedDesired = null
    if (missingRequest) { active = false; reason = 'FailedGetResourceMetric' }
    else if (measured.length) {
      active = true
      observed = measured.reduce((sum, item) => sum + item.utilization, 0) / measured.length
      let ratio = observed / target; let proposal = Math.ceil(current * ratio); rawDesired = proposal
      if (ratio >= .9 && ratio <= 1.1) proposal = current
      if (proposal < current && unready) proposal = current
      else if (proposal < current && missing) proposal = Math.ceil((measured.reduce((sum, item) => sum + item.utilization, 0) + (pods.length - measured.length) * target) / Math.max(1, pods.length) / target * current)
      else if (proposal > current && missing) {
        const adjusted = measured.reduce((sum, item) => sum + item.utilization, 0) / Math.max(1, pods.length)
        const candidate = Math.ceil(current * adjusted / target)
        proposal = candidate < current || (adjusted / target >= .9 && adjusted / target <= 1.1) ? current : candidate
      }
      adjustedDesired = proposal
      desired = proposal; reason = missing ? 'MissingMetricsAdjusted' : 'MetricDesired'
    }
    const preClampDesired = desired; const bounded = Math.min(hpa.spec.maxReplicas, Math.max(hpa.spec.minReplicas, desired)); const outsideBounds = current < hpa.spec.minReplicas || current > hpa.spec.maxReplicas; const boundDriven = outsideBounds
    desired = bounded
    if (desired > current) desired = Math.min(desired, current + Math.max(4, current))
    const window = hpa.spec.behavior?.scaleDown?.stabilizationWindowSeconds ?? 300
    if (active && measured.length) controller.recommendations = [...controller.recommendations, { atMs, replicas: desired }].filter(item => item.atMs >= atMs - 300_000).slice(-22)
    const beforeStabilization = desired
    if (desired < current && window && !outsideBounds) desired = Math.max(...controller.recommendations.filter(item => item.atMs >= atMs - window * 1000).map(item => item.replicas), desired)
    if (desired !== current) run = setDeploymentReplicas(run, { clusterId, namespace: hpa.metadata.namespace, deploymentName: ref.name }, desired, { cause: 'hpa', controllerUid: hpa.metadata.uid, atMs, lab }).run
    const currentHpa = run.runtime.kubernetes.clusters[clusterId].resources[kubeObjectKey('HorizontalPodAutoscaler', hpa.metadata.namespace, hpa.metadata.name)]
    const currentController = run.runtime.kubernetes.clusters[clusterId].resourcesRuntime.hpa[hpa.metadata.uid]
    const limited = bounded !== preClampDesired || outsideBounds
    const limitReason = !limited ? 'DesiredWithinRange' : outsideBounds ? 'CurrentReplicasOutsideRange' : bounded === hpa.spec.maxReplicas ? 'TooManyReplicas' : bounded === hpa.spec.minReplicas ? 'TooFewReplicas' : 'DesiredWithinRange'
    currentHpa.status = { currentReplicas: current, desiredReplicas: desired, currentMetrics: observed === null ? [] : [{ type: 'Resource', resource: { name: 'cpu', current: { averageUtilization: Math.round(observed) } } }], lastScaleTime: desired !== current ? atMs : (currentHpa.status?.lastScaleTime ?? null), conditions: [condition('AbleToScale', true, 'ReadyForNewScale', 'The controller can scale the target.'), condition('ScalingActive', active, active ? 'ValidMetricFound' : reason, active ? 'A CPU metric is available.' : 'No usable CPU metric is available.'), condition('ScalingLimited', limited, limitReason, limited ? 'Replica bounds constrained the recommendation.' : 'The desired count is within range.')] }
    currentController.lastDecision = { reason: boundDriven ? 'bound-driven' : (desired !== current ? 'metric-driven' : reason), rawDesired, adjustedDesired, stabilizedDesired: desired, observedUtilization: observed, missingSamples: missing, unreadySamples: unready, atMs, beforeStabilization }
  }
  return run
}
