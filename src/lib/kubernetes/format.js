export const kubeJson = value => JSON.stringify(value, null, 2)
export function kubeTable(items) { return items.map(x => x.metadata?.name ?? x.name).join('\n') || 'No resources found.' }
