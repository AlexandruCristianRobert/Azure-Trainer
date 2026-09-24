import { normalizeImageReference } from '../../../lib/simulation/runtime.js'

export function probeDependencies(appId, deploymentEntry) {
  return {
    [`deployment:${appId}`]: (context) => {
      const entry = deploymentEntry(context)
      const norm = (value) => value ? normalizeImageReference(value) : null
      const sorted = (items) => [...(items ?? [])].sort((a, b) => a.type.localeCompare(b.type))
      return { generation: entry?.active?.generation ?? null, artifactId: entry?.active?.artifactId ?? null,
        activeImage: norm(entry?.active?.image), desiredImage: norm(entry?.desired?.image),
        activeProbes: sorted(entry?.active?.probeConfig?.probes), desiredProbes: sorted(entry?.desired?.probeConfig?.probes),
        endpoints: entry?.active?.appSpec?.healthEndpoints ?? null, status: entry?.status ?? null }
    },
    [`probes:${appId}`]: (context) => context.runtime.probesByApp?.[appId]?.fingerprint ?? null,
  }
}

export function completeProbeMeasurements(m, seconds) {
  return Array.isArray(m.samples) && m.samples.length === seconds && m.samples.every((item, i) => item.second === i + 1)
    && Array.isArray(m.requests) && m.requests.length === seconds * 2
    && m.requests.every((item, i) => item.second === Math.floor(i / 2) + 1 && item.requestIndex === i % 2)
    && Array.isArray(m.events) && m.events.length > 0 && Array.isArray(m.replicas) && m.replicas.length === 2
}
