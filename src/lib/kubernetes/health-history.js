/** Keep request logs within the lifetime of their probe observation receipts. */
export function appendHealthReceipt(state, receipt) {
  const receipts = [...state.health.receipts, receipt]
  const removed = receipts.slice(0, Math.max(0, receipts.length - 40))
  state.health.receipts = receipts.slice(-40)
  const expiredRequestIds = new Set(removed.flatMap(item => item.samples ?? [])
    .map(sample => sample.response?.requestId).filter(Boolean))
  if (expiredRequestIds.size && state.connectivity) {
    state.connectivity.applicationLogs = state.connectivity.applicationLogs.filter(log => !expiredRequestIds.has(log.requestId))
  }
}
