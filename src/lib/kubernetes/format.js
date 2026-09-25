import { stringify } from 'yaml'

const sort = value => Array.isArray(value) ? value.map(sort)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value

export const kubeJson = value => JSON.stringify(sort(value), null, 2)
export const kubeYaml = value => stringify(sort(value), { lineWidth: 0 })

export function kubeTable(items, kind, wide = false) {
  if (!items.length) return 'No resources found.'
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
    const backends = Object.values(state.resources).filter(item => item.kind === 'Pod' && item.metadata.namespace === resource.metadata.namespace && item.status?.phase === 'Running' && Object.entries(resource.spec.selector).every(([key, value]) => item.metadata.labels?.[key] === value))
    lines.push(`Type: ${resource.spec.type}`, `Endpoints: ${backends.map(item => item.metadata.name).join(', ') || '<none>'}`)
  }
  if (resource.kind === 'Pod') lines.push(`Status: ${resource.status.phase}`, `Image: ${resource.spec.containers[0].image}`)
  return lines.join('\n')
}
