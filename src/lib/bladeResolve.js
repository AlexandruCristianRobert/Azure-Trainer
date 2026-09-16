const LIST = { kind: 'resource-groups' }

function hasGroup(sb, name) {
  return sb.resourceGroups.some((g) => g.name.toLowerCase() === String(name).toLowerCase())
}

function hasNamespace(sb, rg, name) {
  return sb.namespaces.some((n) => n.resourceGroup.toLowerCase() === String(rg).toLowerCase() && n.name.toLowerCase() === String(name).toLowerCase())
}

export function resolveBlade(blade, sandbox) {
  if (!blade) return { ...LIST }
  if (blade.kind === 'servicebus-namespace') {
    if (hasNamespace(sandbox, blade.resourceGroup, blade.name)) return { ...blade, tab: blade.tab ?? 'queues' }
    return resolveBlade({ kind: 'resource-group', name: blade.resourceGroup }, sandbox)
  }
  if (blade.kind === 'resource-group') return hasGroup(sandbox, blade.name) ? { ...blade } : { ...LIST }
  return { ...LIST }
}
