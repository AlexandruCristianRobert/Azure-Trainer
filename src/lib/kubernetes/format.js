import { stringify } from 'yaml'

const sort = value => Array.isArray(value) ? value.map(sort)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value

export const kubeJson = value => JSON.stringify(sort(value), null, 2)
export const kubeYaml = value => stringify(sort(value), { lineWidth: 0 })

export function kubeTable(items, kind, wide = false) {
  if (!items.length) return 'No resources found.'
  if (kind === 'Event' && items.some(item => item.reason || item.message)) {
    const header = wide ? 'NAME\tNAMESPACE\tREASON\tMESSAGE' : 'NAME\tREASON\tMESSAGE'
    const rows = items.map(item => wide
      ? `${item.metadata?.name ?? ''}\t${item.metadata?.namespace ?? ''}\t${item.reason ?? ''}\t${item.message ?? ''}`
      : `${item.metadata?.name ?? ''}\t${item.reason ?? ''}\t${item.message ?? ''}`)
    return [header, ...rows].join('\n')
  }
  const header = wide ? 'NAME\tSTATUS\tNAMESPACE\tDETAILS' : 'NAME\tSTATUS'
  const rows = items.map(item => {
    const status = item.status?.phase ?? item.status?.conditions?.find(x => x.type === 'Ready')?.status ?? 'Active'
    const details = item.kind === 'Service' ? `${item.spec.type} ${item.spec.ports?.[0]?.port ?? ''}` : item.kind === 'Deployment' ? `${item.spec.replicas} desired` : item.reason ?? ''
    return wide ? `${item.metadata?.name ?? ''}\t${status}\t${item.metadata?.namespace ?? '<cluster>'}\t${details}` : `${item.metadata?.name ?? ''}\t${status}`
  })
  return [header, ...rows].join('\n')
}

export function describeObject(resource, state) {
  const lines = [`Name: ${resource.metadata.name}`, `Namespace: ${resource.metadata.namespace ?? '<cluster>'}`, `Kind: ${resource.kind}`]
  if (resource.kind === 'Deployment') lines.push(`Replicas: ${resource.spec.replicas}`, 'Scheduling, image pulls, and readiness are simulated.')
  if (resource.kind === 'Service') {
    const targetPort = resource.spec.ports[0]?.targetPort
    const backends = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === resource.metadata.namespace && item.status?.phase === 'Running'
      && Object.entries(resource.spec.selector).every(([key, value]) => item.metadata.labels?.[key] === value)
      && item.spec.containers.some(container => container.ports?.some(port => targetPort === port.containerPort || targetPort === port.name)))
    lines.push(`Type: ${resource.spec.type}`, `Endpoints: ${backends.map(item => item.metadata.name).join(', ') || '<none>'}`)
  }
  if (resource.kind === 'ConfigMap') lines.push(`Keys: ${Object.keys(resource.data ?? {}).sort().join(', ') || '<none>'}`)
  if (resource.kind === 'Secret') lines.push(`Type: ${resource.type ?? 'Opaque'}`, `Keys: ${Object.keys(resource.data ?? {}).sort().join(', ') || '<none>'}`)
  if (resource.kind === 'Pod') {
    lines.push(`Status: ${resource.status.phase}`, `Image: ${resource.spec.containers[0].image}`)
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
