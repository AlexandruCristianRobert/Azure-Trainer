import { stringify } from 'yaml'
import { rolloutDeadlineGuidance } from './diagnostics.js'
import { getRolloutSummary } from './rollouts.js'

const sort = value => Array.isArray(value) ? value.map(sort)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value

export const kubeJson = value => JSON.stringify(sort(value), null, 2)
export const kubeYaml = value => stringify(sort(value), { lineWidth: 0 })

export function observedRolloutDigests(run, state, rsUid) {
  return [...new Set(Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.ownerReferences?.some(ref => ref.uid === rsUid))
    .map(pod => run.artifacts.buildsById[state.podSnapshots[pod.metadata.uid]?.artifactId]?.digest).filter(Boolean))].sort().join(', ') || '<none observed>'
}

export function rolloutCounts(summary) {
  return `updated=${summary.updated}/${summary.desired} ready=${summary.ready} available=${summary.available} unavailable=${summary.unavailable} terminating=${summary.terminating}`
}

export function formatRolloutHistory(run, state, deployment, revision = null) {
  const history = state.rollouts?.deployments?.[deployment.metadata.uid]
  if (!history) return revision === null ? 'No retained rollout history is available.' : null
  const revisions = [...history.revisions].sort((a, b) => a.revision - b.revision)
  const rsName = item => Object.values(state.resources).find(rs => rs.kind === 'ReplicaSet' && rs.metadata.uid === item.rsUid)?.metadata.name ?? '<not retained>'
  if (revision === null) return ['REVISION\tCURRENT\tREPLICASET\tIMAGE REFERENCE\tOBSERVED DIGESTS', ...revisions.map(item =>
    `${item.revision}\t${item.revision === history.currentRevision ? '*' : '-'}\t${rsName(item)}\t${item.imageRef}\t${observedRolloutDigests(run, state, item.rsUid)}`)].join('\n')
  const item = revisions.find(value => value.revision === revision)
  if (!item) return null
  const lines = [`Revision: ${item.revision}${item.revision === history.currentRevision ? ' (current)' : ''}`, `ReplicaSet: ${rsName(item)}`,
    `Image reference: ${item.imageRef}`, `Observed digests: ${observedRolloutDigests(run, state, item.rsUid)}`, 'Retained Pod template:',
    `Template hash: ${item.templateHash}`, `Label keys: ${Object.keys(item.template.metadata?.labels ?? {}).sort().join(', ') || '<none>'}`,
    `Annotation keys: ${Object.keys(item.template.metadata?.annotations ?? {}).sort().join(', ') || '<none>'}`]
  for (const container of item.template.spec.containers) {
    lines.push(`Container: ${container.name}`, `Image pull policy: ${container.imagePullPolicy ?? 'IfNotPresent'}`)
    for (const env of container.env ?? []) {
      const config = env.valueFrom?.configMapKeyRef, secret = env.valueFrom?.secretKeyRef
      lines.push(`Environment ${env.name}: ${config ? `ConfigMap ${config.name}/${config.key}` : secret ? `Secret ${secret.name}/${secret.key}` : '<value omitted>'}`)
    }
    for (const field of ['startupProbe', 'readinessProbe', 'livenessProbe']) if (container[field]) {
      const probe = container[field]
      lines.push(`${field}: ${probe.httpGet?.path ?? '<none>'} port=${probe.httpGet?.port ?? '<none>'} period=${probe.periodSeconds ?? 10}s`)
    }
    lines.push(`Resource requests: ${kubeJson(container.resources?.requests ?? {})}`, `Resource limits: ${kubeJson(container.resources?.limits ?? {})}`)
  }
  for (const volume of item.template.spec.volumes ?? []) lines.push(`Volume ${volume.name}: ${volume.configMap ? `ConfigMap ${volume.configMap.name}` : volume.secret ? `Secret ${volume.secret.secretName ?? volume.secret.name}` : '<unsupported>'}`)
  lines.push(`Termination grace: ${item.template.spec.terminationGracePeriodSeconds ?? 30}s`, 'Retained templates store image references; observed digests belong to actual Pods. Undo uses current configuration and registry contents.')
  return lines.join('\n')
}

export function formatRolloutStatus(summary, name, namespace) {
  const deadline = summary.conditions.some(item => item.type === 'Progressing' && item.status === 'False' && item.reason === 'ProgressDeadlineExceeded')
  return [`deployment "${name}" ${summary.complete ? 'successfully rolled out' : deadline ? 'rollout stalled' : 'rollout progressing'} (simulated).`,
    `Revision: ${summary.currentRevision}; ${rolloutCounts(summary)}`, ...(deadline ? [rolloutDeadlineGuidance(name, namespace)] : []),
    'Snapshot only; advance simulated time through Experiment Controls.'].join('\n')
}

export function kubeTable(items, kind, wide = false, view = null) {
  if (!items.length) return 'No resources found.'
  if (view?.state.rollouts && kind === 'ReplicaSet') {
    return [`NAME\tREVISION\tCURRENT\tDESIRED\tREADY\tIMAGE REFERENCE\tOBSERVED DIGESTS${wide ? '\tNAMESPACE' : ''}`, ...items.map(item => {
      const history = view.state.rollouts.deployments[item.metadata.ownerReferences?.find(ref => ref.kind === 'Deployment')?.uid]
      const revision = history?.revisions.find(value => value.rsUid === item.metadata.uid)
      const ready = Object.values(view.state.resources).filter(pod => pod.kind === 'Pod' && pod.metadata.ownerReferences?.some(ref => ref.uid === item.metadata.uid)
        && pod.metadata.deletionTimestamp === undefined && pod.status?.conditions?.some(condition => condition.type === 'Ready' && condition.status === 'True')).length
      return `${item.metadata.name}\t${revision?.revision ?? '<unknown>'}\t${history?.currentRsUid === item.metadata.uid ? '*' : '-'}\t${item.spec.replicas}\t${ready}\t${item.spec.template.spec.containers[0].image}\t${observedRolloutDigests(view.run, view.state, item.metadata.uid)}${wide ? `\t${item.metadata.namespace}` : ''}`
    })].join('\n')
  }
  if (view?.state.rollouts && kind === 'Deployment') {
    return [`NAME\tREVISION\tUPDATED\tREADY\tAVAILABLE\tUNAVAILABLE\tTERMINATING${wide ? '\tNAMESPACE' : ''}`, ...items.map(item => {
      const summary = getRolloutSummary(view.run, { clusterId: view.clusterId, deploymentUid: item.metadata.uid })
      return `${item.metadata.name}\t${summary?.currentRevision ?? '<unknown>'}\t${summary?.updated ?? 0}/${item.spec.replicas}\t${summary?.ready ?? 0}\t${summary?.available ?? 0}\t${summary?.unavailable ?? item.spec.replicas}\t${summary?.terminating ?? 0}${wide ? `\t${item.metadata.namespace}` : ''}`
    })].join('\n')
  }
  if (kind === 'Event' && items.some(item => item.reason || item.message)) {
    const header = wide ? 'NAME\tNAMESPACE\tREASON\tMESSAGE' : 'NAME\tREASON\tMESSAGE'
    const rows = items.map(item => wide
      ? `${item.metadata?.name ?? ''}\t${item.metadata?.namespace ?? ''}\t${item.reason ?? ''}\t${item.message ?? ''}`
      : `${item.metadata?.name ?? ''}\t${item.reason ?? ''}\t${item.message ?? ''}`)
    return [header, ...rows].join('\n')
  }
  if (kind === 'Node' && items.some(item => item.status?.capacity)) {
    return ['NAME\tSTATUS\tCPU\tMEMORY\tALLOCATABLE', ...items.map(item => `${item.metadata.name}\t${item.status.phase ?? 'Ready'}\t${item.status.capacity.cpu}\t${item.status.capacity.memory}\t${item.status.allocatable.cpu} / ${item.status.allocatable.memory}`)].join('\n')
  }
  if (kind === 'HorizontalPodAutoscaler') {
    return ['NAME\tREFERENCE\tTARGETS\tMINPODS\tMAXPODS\tREPLICAS', ...items.map(item => `${item.metadata.name}\t${item.spec.scaleTargetRef.kind}/${item.spec.scaleTargetRef.name}\t${item.status?.currentMetrics?.[0]?.resource?.current?.averageUtilization ?? '<unknown>'}%/${item.spec.metrics?.[0]?.resource?.target?.averageUtilization ?? '?'}%\t${item.spec.minReplicas}\t${item.spec.maxReplicas}\t${item.status?.currentReplicas ?? 0}/${item.status?.desiredReplicas ?? 0}`)].join('\n')
  }
  const header = wide ? 'NAME\tSTATUS\tNAMESPACE\tDETAILS' : 'NAME\tSTATUS'
  const rows = items.map(item => {
    const status = item.status?.phase ?? item.status?.conditions?.find(x => x.type === 'Ready')?.status ?? 'Active'
    const details = item.kind === 'Service' ? `${item.spec.type} ${item.spec.ports?.[0]?.port ?? ''}${wide ? ` ${item.spec.clusterIP ?? ''}${item.status?.loadBalancer?.ingress?.[0]?.ip ? ` ${item.status.loadBalancer.ingress[0].ip}` : ''}` : ''}`
      : item.kind === 'EndpointSlice' ? `${item.endpoints?.length ?? 0} endpoints${wide ? ` ${item.ports?.map(port => port.port).join(',') ?? ''}` : ''}`
        : item.kind === 'Deployment' ? `${item.spec.replicas} desired` : item.kind === 'Pod' ? `${item.spec?.nodeName ?? '<unassigned>'}${item.status?.schedulingReason ? ` (${item.status.schedulingReason})` : ''}` : item.reason ?? ''
    return wide ? `${item.metadata?.name ?? ''}\t${status}\t${item.metadata?.namespace ?? '<cluster>'}\t${details}` : `${item.metadata?.name ?? ''}\t${status}`
  })
  return [header, ...rows].join('\n')
}

export function describeObject(resource, state, view = null) {
  const lines = [`Name: ${resource.metadata.name}`, `Namespace: ${resource.metadata.namespace ?? '<cluster>'}`, `Kind: ${resource.kind}`]
  if (resource.kind === 'Deployment') {
    const container = resource.spec.template?.spec?.containers?.[0]
    const requested = container?.resources?.requests ?? {}
    const limits = container?.resources?.limits ?? {}
    lines.push(`Replicas: ${resource.spec.replicas}`, `Resource requests: cpu=${requested.cpu ?? '<none>'}, memory=${requested.memory ?? '<none>'}`,
      `Resource limits: cpu=${limits.cpu ?? '<none>'}, memory=${limits.memory ?? '<none>'}`, 'Scheduling, image pulls, and readiness are simulated.')
    if (view && state.rollouts?.deployments[resource.metadata.uid]) {
      const summary = getRolloutSummary(view.run, { clusterId: view.clusterId, deploymentUid: resource.metadata.uid })
      const history = state.rollouts.deployments[resource.metadata.uid]
      lines.push(`Revision: ${summary.currentRevision}`, rolloutCounts(summary), `Image reference: ${container.image}`,
        `Observed digests: ${observedRolloutDigests(view.run, state, history.currentRsUid)}`,
        `Conditions: ${summary.conditions.map(item => `${item.type}=${item.status} (${item.reason})`).join('; ')}`,
        `Strategy: RollingUpdate; maxSurge=${resource.spec.strategy?.rollingUpdate?.maxSurge ?? '25%'}, maxUnavailable=${resource.spec.strategy?.rollingUpdate?.maxUnavailable ?? '25%'}`,
        `Minimum ready: ${resource.spec.minReadySeconds ?? 0}s; progress deadline: ${resource.spec.progressDeadlineSeconds ?? 600}s`,
        'Snapshot only; advance simulated time through Experiment Controls.')
      if (summary.conditions.some(item => item.type === 'Progressing' && item.reason === 'ProgressDeadlineExceeded')) lines.push(rolloutDeadlineGuidance(resource.metadata.name, resource.metadata.namespace))
    }
  }
  if (resource.kind === 'HorizontalPodAutoscaler') lines.push(`Target: ${resource.spec.scaleTargetRef.kind}/${resource.spec.scaleTargetRef.name}`,
    `Replicas: current ${resource.status?.currentReplicas ?? 0}, desired ${resource.status?.desiredReplicas ?? 0}`,
    `CPU utilization: ${resource.status?.currentMetrics?.[0]?.resource?.current?.averageUtilization ?? '<unknown>'}% / ${resource.spec.metrics?.[0]?.resource?.target?.averageUtilization ?? '?'}%`)
  if (resource.kind === 'Service') {
    const targetPort = resource.spec.ports[0]?.targetPort
    const backends = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === resource.metadata.namespace && item.status?.podIP
      && Object.entries(resource.spec.selector).every(([key, value]) => item.metadata.labels?.[key] === value)
      && (typeof targetPort === 'number' || item.spec.containers.some(container => container.ports?.some(port => targetPort === port.name))))
    lines.push(`Type: ${resource.spec.type}`, `ClusterIP: ${resource.spec.clusterIP ?? '<pending>'}`,
      `External IP: ${resource.status?.loadBalancer?.ingress?.[0]?.ip ?? '<none>'}`, `Port: ${resource.spec.ports[0].port} -> ${targetPort}`,
      `Endpoints: ${backends.map(item => item.metadata.name).join(', ') || '<none>'}`)
  }
  if (resource.kind === 'EndpointSlice') lines.push(`Service: ${resource.metadata.labels?.['kubernetes.io/service-name'] ?? '<unknown>'}`,
    `Ports: ${resource.ports.map(item => `${item.name ?? 'tcp'}:${item.port}`).join(', ') || '<none>'}`,
    `Endpoints: ${resource.endpoints.map(item => `${item.addresses.join(',')} (${item.conditions.ready ? 'ready' : 'not ready'})`).join('; ') || '<none>'}`)
  if (resource.kind === 'ConfigMap') lines.push(`Keys: ${Object.keys(resource.data ?? {}).sort().join(', ') || '<none>'}`)
  if (resource.kind === 'Secret') lines.push(`Type: ${resource.type ?? 'Opaque'}`, `Keys: ${Object.keys(resource.data ?? {}).sort().join(', ') || '<none>'}`)
  if (resource.kind === 'Pod') {
    lines.push(`Status: ${resource.status.phase}`, `Image: ${resource.spec.containers[0].image}`)
    if (view && state.rollouts) lines.push(`Image reference: ${resource.spec.containers[0].image}`,
      `Observed digest: ${view.run.artifacts.buildsById[state.podSnapshots[resource.metadata.uid]?.artifactId]?.digest ?? '<none observed>'}`)
    const health = state.health?.containers?.[resource.metadata.uid]
    if (health) {
      lines.push(`Container ID: ${health.containerId}`, `Container Ready: ${health.ready ? 'True' : 'False'}`,
        `Restart Count: ${health.restartCount}`, `Startup Passed: ${health.startupPassed ? 'True' : 'False'}`,
        `Initialized At: ${health.initializedAtMs / 1000}s`)
      if (health.restartReason) lines.push(`Restart Cause: ${health.restartReason}`)
      if (health.terminatedAtMs !== null) lines.push(`Terminating At: ${health.terminatedAtMs / 1000}s`)
      if (health.restartAtMs !== null) lines.push(`Next Container Start: ${health.restartAtMs / 1000}s`)
      if (health.previous) lines.push(`Previous Container ID: ${health.previous.containerId}`,
        `Previous Exit Reason: ${health.previous.reason}`)
      for (const type of ['startup', 'readiness', 'liveness']) {
        const check = health.checks[type]
        if (check) lines.push(`${type[0].toUpperCase()}${type.slice(1)} Probe: ${check.successes} successes, ${check.failures} failures, next ${check.pending?.completeAtMs ?? check.nextAtMs ?? 'none'}ms`)
      }
    }
    const waiting = resource.status.containerStatuses?.find(item => item.state?.waiting)?.state.waiting
    if (waiting?.reason) {
      lines.push(`Reason: ${waiting.reason}`)
      const event = (state.events ?? []).find(item => item.metadata?.namespace === resource.metadata.namespace
        && item.reason === waiting.reason && typeof item.message === 'string' && item.message.includes(resource.spec.containers[0].image))
      if (event) lines.push(`Message: ${event.message}`)
    }
  }
  return lines.join('\n')
}
