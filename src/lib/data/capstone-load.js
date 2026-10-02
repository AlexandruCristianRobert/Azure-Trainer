import { simulatePoolLoad } from './pg-pool.js'

// Cache/Cosmos work is observed separately. This p95 describes only modeled
// PostgreSQL origin latency, not end-to-end application latency.
export function simulateCapstoneLoad({ requestsPerSecond, seconds, originRequests, replicas, poolMaxSize, mode, server }) {
  const total = Math.round(requestsPerSecond * seconds)
  const label = 'Simulated estimate — not an Azure guarantee.'
  if (!Number.isInteger(originRequests) || originRequests < 0 || originRequests > total
    || !Number.isFinite(requestsPerSecond) || requestsPerSecond < 0 || !Number.isFinite(seconds) || seconds <= 0) {
    return { served: 0, failed: Math.max(0, total || 0), p95Ms: 0, throughputRps: 0, peakServerConnections: 0, originRequests, errors: ['Invalid bounded origin demand.'], label }
  }
  if (originRequests === 0) return { served: total, failed: 0, p95Ms: 0, throughputRps: total / seconds, peakServerConnections: 0, originRequests, errors: [], label, latencyScope: 'PostgreSQL-origin teaching approximation' }
  const origin = simulatePoolLoad({ requestsPerSecond: originRequests / seconds, seconds, replicas, poolMaxSize, mode, server })
  const served = total - originRequests + origin.served
  return { ...origin, served, throughputRps: served / seconds, originRequests, latencyScope: 'PostgreSQL-origin teaching approximation' }
}
