/** Shared bounded provenance boundary; no controller/experiment imports. */
export function retainReleaseReceipt(state, experiment) {
  // Partial pre-observer controller records have no persisted traffic receipt.
  if (experiment.version !== 1 || !Array.isArray(experiment.samples)) return
  const receipts = [...state.rollouts.receipts, structuredClone(experiment)]
  const retiredRequestIds = new Set(receipts.slice(0, Math.max(0, receipts.length - 40)).flatMap(receipt => receipt.samples.map(sample => sample.requestId)))
  state.rollouts.receipts = receipts.slice(-40)
  // Raw request history has its own bound. Once a receipt retires, also retire
  // dependent logs so old Pod cleanup cannot leave unverifiable provenance.
  if (state.connectivity) state.connectivity.applicationLogs = state.connectivity.applicationLogs.filter(log => !retiredRequestIds.has(log.requestId))
}
