/* Deterministic teaching approximation — not real Azure measurements.
 * Direct requests spend 25ms connecting and 4ms querying. In addition to steady
 * demand (RPS * 29ms), each replica reserves six overlapping cold connection
 * attempts during a synchronized scheduling burst. This explicit workload
 * assumption makes scaling replicas increase peak connections; steady Little's
 * Law alone would be replica-independent. Pools remove these cold bursts.
 * Pool/PgBouncer demand is RPS * 4ms; checkout costs 1ms. Available server slots
 * are max_connections - 3. Persistent pools request replicas * poolMaxSize;
 * PgBouncer caps those server slots at default_pool_size (5000 client slots).
 * Accepted concurrency = min(capacity, demand), queueFactor = max(0,
 * demand/capacity - 1), p95 = setup + 4 * (1 + queueFactor). Only direct peak
 * connection attempts or persistent pool reservations beyond server capacity
 * fail with too-many-clients; requests above query capacity queue, and effective
 * served throughput is capped at capacity/4ms over the given load window.
 */
export function simulatePoolLoad({ replicas, requestsPerSecond, seconds, mode, poolMaxSize = 0, server }) {
  const fail = message => ({ served: 0, failed: Math.round(Math.max(0, Number(requestsPerSecond) || 0) * Math.max(0, Number(seconds) || 0)), p95Ms: 0, throughputRps: 0, peakServerConnections: 0, errors: [message] })
  if (!Number.isInteger(replicas) || replicas < 1 || !Number.isFinite(requestsPerSecond) || requestsPerSecond < 0 || !Number.isFinite(seconds) || seconds <= 0) return fail('Not supported by the simulator: load requires positive replicas/duration and non-negative requests per second.')
  if (!['per-request', 'pool', 'pgbouncer'].includes(mode)) return fail('Not supported by the simulator: unknown connection mode.')
  if (mode !== 'per-request' && (!Number.isInteger(poolMaxSize) || poolMaxSize < 1)) return fail('Not supported by the simulator: poolMaxSize must be a positive integer.')
  if (mode === 'pgbouncer' && String(server?.parameters?.['pgbouncer.enabled']) !== 'true') return fail('ERROR: PgBouncer is not enabled on port 6432')
  const available = Math.max(0, Number(server?.parameters?.max_connections ?? 859) - 3)
  const total = Math.round(requestsPerSecond * seconds)
  const direct = mode === 'per-request'
  const demand = total ? Math.ceil(requestsPerSecond * (direct ? 0.029 : 0.004) + (direct ? replicas * 6 : 0)) : 0
  const requested = direct ? demand : mode === 'pool' ? replicas * poolMaxSize : Number(server.parameters['pgbouncer.default_pool_size'] ?? 50)
  const capacity = Math.max(0, Math.min(available, requested))
  const connectionAcceptance = requested ? Math.min(1, capacity / requested) : 1
  const clientAcceptance = mode === 'pgbouncer' && demand > 5000 ? 5000 / demand : 1
  const served = Math.min(Math.floor(total * connectionAcceptance * clientAcceptance), Math.floor(capacity * seconds / (direct ? 0.029 : 0.004)))
  const failed = total - served
  const errors = []
  if (requested > available && total) errors.push('FATAL: sorry, too many clients already')
  if (clientAcceptance < 1) errors.push('FATAL: PgBouncer client connection limit exceeded')
  const queueFactor = capacity ? Math.max(0, demand / capacity - 1) : (total ? total : 0)
  return { served, failed, p95Ms: total ? (direct ? 25 : 1) + 4 * (1 + queueFactor) : 0,
    throughputRps: served / seconds, peakServerConnections: total ? capacity : (direct ? 0 : capacity), errors,
    label: 'Simulated estimate — not an Azure guarantee.' }
}
