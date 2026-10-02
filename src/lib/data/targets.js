// Composite authority is captured from the authored manifest, never inferred
// from imports or learner code. The caller owns capability enforcement.
export function dataTargetFor(target, backend) {
  if (!['postgres', 'cosmos', 'redis'].includes(backend)) return null
  const resolved = target?.kind === 'composite' ? target[backend] : target
  if (!resolved || typeof resolved !== 'object') return null
  if (target.kind !== 'composite') return (backend === 'cosmos' ? !target.kind || target.kind === 'cosmos' : target.kind === backend) ? target : null
  const required = backend === 'postgres' ? ['resourceGroup', 'server', 'database']
    : backend === 'redis' ? ['resourceGroup', 'cluster'] : ['account', 'database']
  if (required.some(key => typeof resolved[key] !== 'string' || !resolved[key])) return null
  if (backend !== 'cosmos' && resolved.kind !== backend) return null
  if (backend === 'cosmos' && resolved.kind && resolved.kind !== 'cosmos') return null
  return backend === 'redis' && target?.kind === 'composite' ? { ...resolved, database: resolved.database ?? 'default' } : resolved
}

export function compositeTargetMatches(expected, actual) {
  if (expected?.kind !== 'composite' || actual?.kind !== 'composite') return false
  return ['postgres', 'cosmos', 'redis'].every(backend => {
    const declared = dataTargetFor(expected, backend); const supplied = dataTargetFor(actual, backend)
    if (!declared || !supplied) return false
    const keys = backend === 'postgres' ? ['resourceGroup', 'server', 'database', 'port']
      : backend === 'redis' ? ['resourceGroup', 'cluster', 'database'] : ['account', 'database']
    return keys.every(key => (declared[key] ?? (key === 'port' ? 5432 : null)) === (supplied[key] ?? (key === 'port' ? 5432 : null)))
  })
}
