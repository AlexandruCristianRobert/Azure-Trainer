const same = (left, right) => typeof left === 'string' && typeof right === 'string' && left.toLowerCase() === right.toLowerCase()

export function latestRequestForApp(scrollback, appId) {
  return [...(scrollback ?? [])].reverse().find((line) => same(line?.appId, appId) && Number.isInteger(line.status)) ?? null
}

export function latestEvidenceForApp(experimentsById, appId, predicate = () => true) {
  return Object.values(experimentsById ?? {}).filter((record) => same(record?.measurements?.appId, appId) && predicate(record))
    .sort((left, right) => right.sequence - left.sequence)[0] ?? null
}
