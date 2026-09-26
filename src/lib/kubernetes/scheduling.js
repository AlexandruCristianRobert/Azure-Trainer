import { normalizeContainerResources } from './resource-schema.js'
import { kubeObjectKey } from './objects.js'
import { clearPodState } from './pod-cleanup.js'

const clone = value => structuredClone(value)

function requestFor(pod) {
  const effective = normalizeContainerResources(pod.spec?.containers?.[0]?.resources ?? {}).effective
  return { cpuRequestM: effective.cpuRequestM ?? 0, memoryRequestBytes: effective.memoryRequestBytes ?? 0 }
}

function usedOn(runtime, nodeName) {
  return Object.values(runtime.assignments).filter(item => item.nodeName === nodeName).reduce((total, item) => ({
    cpu: total.cpu + item.cpuRequestM, memory: total.memory + item.memoryRequestBytes,
  }), { cpu: 0, memory: 0 })
}

function unschedulableReason(nodes, request, runtime) {
  const cpuFits = Object.entries(nodes).some(([name, node]) => node.allocatableCpuM - node.fixedCpuM - usedOn(runtime, name).cpu >= request.cpuRequestM)
  const memoryFits = Object.entries(nodes).some(([name, node]) => node.allocatableMemoryBytes - node.fixedMemoryBytes - usedOn(runtime, name).memory >= request.memoryRequestBytes)
  if (!cpuFits) return 'Insufficient cpu'
  if (!memoryFits) return 'Insufficient memory'
  return 'Insufficient cpu, memory'
}

export function schedulePendingPods(input, clusterId, lab) {
  if (lab?.capabilities?.kubernetesResources !== true) return input
  const run = clone(input); const state = run.runtime?.kubernetes?.clusters?.[clusterId]
  const runtime = state?.resourcesRuntime
  if (!state || !runtime?.nodes || !runtime?.assignments) return run
  const pending = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.status?.phase === 'Pending' && !item.metadata.deletionTimestamp)
    .sort((a, b) => a.metadata.uid.localeCompare(b.metadata.uid))
  for (const pod of pending) {
    if (runtime.assignments[pod.metadata.uid]) continue
    const request = requestFor(pod)
    const fitting = Object.entries(runtime.nodes).filter(([name, node]) => {
      const used = usedOn(runtime, name)
      return node.allocatableCpuM - node.fixedCpuM - used.cpu >= request.cpuRequestM
        && node.allocatableMemoryBytes - node.fixedMemoryBytes - used.memory >= request.memoryRequestBytes
    }).sort(([leftName], [rightName]) => {
      const left = usedOn(runtime, leftName); const right = usedOn(runtime, rightName)
      return left.cpu - right.cpu || left.memory - right.memory || leftName.localeCompare(rightName)
    })
    if (!fitting.length) {
      const reason = unschedulableReason(runtime.nodes, request, runtime)
      pod.status.schedulingReason = reason
      pod.status.conditions = [{ type: 'PodScheduled', status: 'False', reason: 'Unschedulable', message: reason }]
      state.events.push({ apiVersion: 'v1', kind: 'Event', metadata: { name: `event-${state.events.length + 1}`, namespace: pod.metadata.namespace }, reason: 'FailedScheduling', message: reason, simulated: true })
      if (state.events.length > 300) state.events.splice(0, state.events.length - 300)
      continue
    }
    const [nodeName] = fitting[0]
    runtime.assignments[pod.metadata.uid] = { nodeName, ...request }
    pod.spec.nodeName = nodeName
    pod.status.schedulingReason = null
    pod.status.conditions = [{ type: 'PodScheduled', status: 'True', reason: 'Scheduled' }]
  }
  return run
}

export function setDeploymentReplicas(input, target, replicas, { cause, controllerUid = null, lab = null } = {}) {
  const run = clone(input); const state = run.runtime?.kubernetes?.clusters?.[target.clusterId]
  const deployment = state?.resources?.[kubeObjectKey('Deployment', target.namespace, target.deploymentName)]
  const maximum = state?.resourcesRuntime?.version === 1 ? 6 : 3
  if (!deployment || !Number.isInteger(replicas) || replicas < 1 || replicas > maximum || !['manual', 'apply', 'hpa'].includes(cause)) {
    return { run: input, diagnostics: [{ code: 'INVALID_REPLICA_SCALE', message: 'Replica scaling requires an existing Deployment and a value from 1 through 6.' }] }
  }
  if (deployment.spec.replicas === replicas) return { run, diagnostics: [] }
  deployment.spec.replicas = replicas
  deployment.metadata.resourceVersion = String(Number(deployment.metadata.resourceVersion) + 1)
  deployment.metadata.generation = (deployment.metadata.generation ?? 1) + 1
  if (cause === 'hpa') deployment.metadata.annotations = { ...(deployment.metadata.annotations ?? {}), 'trainer.azure/hpa-controller': controllerUid ?? '' }
  return { run, diagnostics: [] }
}

export function finishScheduledTerminations(input, clusterId, atMs, lab) {
  if (lab?.capabilities?.kubernetesResources !== true) return input
  const run = clone(input); const state = run.runtime?.kubernetes?.clusters?.[clusterId]
  const due = state?.resourcesRuntime?.terminationDue ?? {}
  for (const [uid, deadline] of Object.entries(due)) if (deadline <= atMs) {
    const pod = Object.values(state.resources).find(item => item.kind === 'Pod' && item.metadata.uid === uid)
    if (pod) {
      delete state.resources[kubeObjectKey('Pod', pod.metadata.namespace, pod.metadata.name)]
      clearPodState(state, uid)
    }
    delete due[uid]
  }
  return run
}
