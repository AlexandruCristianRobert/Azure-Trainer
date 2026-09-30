const MAX_PATHS = 128
const MAX_PATH_LENGTH = 512

export function currentRolloutSecrets(state) {
  const values = new Set()
  for (const snapshot of Object.values(state.podSnapshots ?? {})) for (const ref of snapshot.configRefs ?? []) {
    if (ref.kind !== 'Secret') continue
    const value = ref.mode === 'file' ? snapshot.files?.[ref.target] : snapshot.environment?.[ref.target]
    if (typeof value === 'string' && value) values.add(value)
  }
  for (const resource of Object.values(state.resources ?? {})) if (resource.kind === 'Secret') for (const encoded of Object.values(resource.data ?? {})) {
    if (typeof encoded !== 'string' || !encoded) continue
    values.add(encoded)
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)))
      if (decoded) values.add(decoded)
    } catch { /* malformed data has no decoded value */ }
  }
  return [...values].sort((a, b) => b.length - a.length)
}

// Coordinates use sorted object-member positions, never names. The canonical
// retained template is immutable, and a sensitive metadata key must not be
// copied into the persisted provenance itself.
function templateStrings(template) {
  const entries = new Map()
  const visit = (node, prefix = '') => {
    if (!node || typeof node !== 'object') return
    const keys = Array.isArray(node) ? Object.keys(node) : Object.keys(node).sort()
    keys.forEach((key, index) => {
      const path = `${prefix}/${index}`
      const value = node[key]
      if (!Array.isArray(node)) entries.set(`${path}#key`, key)
      if (typeof value === 'string' && value) entries.set(`${path}#value`, value)
      visit(value, path)
    })
  }
  visit(template)
  return entries
}

export function captureRolloutRedaction(revision, secrets) {
  if (revision.redactedPaths?.includes('*')) return
  const paths = new Set(revision.redactedPaths ?? [])
  for (const [path, text] of templateStrings(revision.template)) {
    if (!secrets.some(secret => text.includes(secret))) continue
    paths.add(path)
    if (path.length > MAX_PATH_LENGTH || paths.size > MAX_PATHS) {
      // Fail closed without accumulating an unbounded list or changing the
      // actual template. The wildcard conceals all of its inspection strings.
      revision.redactedPaths = ['*']
      return
    }
  }
  if (paths.size) revision.redactedPaths = [...paths].sort()
}

export function validRolloutRedactionPaths(paths, template) {
  if (paths === undefined) return true // Existing saved runs have no markers.
  if (!Array.isArray(paths) || paths.length > MAX_PATHS || new Set(paths).size !== paths.length) return false
  if (paths.includes('*')) return paths.length === 1
  const entries = templateStrings(template)
  return paths.every(path => typeof path === 'string' && path.length <= MAX_PATH_LENGTH && /^(?:\/(?:0|[1-9]\d*))+#(?:key|value)$/u.test(path) && entries.has(path))
}

export function retainedRolloutRedactions(state) {
  const strings = new Set()
  for (const rollout of Object.values(state.rollouts?.deployments ?? {})) for (const revision of rollout.revisions) {
    if (!revision.redactedPaths?.length) continue
    const entries = templateStrings(revision.template)
    const marked = revision.redactedPaths.includes('*') ? entries.values() : revision.redactedPaths.map(path => entries.get(path))
    for (const value of marked) if (value) strings.add(value)
  }
  return [...strings].sort((a, b) => b.length - a.length)
}
