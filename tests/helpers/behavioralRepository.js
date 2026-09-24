export function behavioralRepository() {
  let saved = null
  const results = []
  return {
    async loadRun() { return saved && structuredClone(saved) },
    async listRuns() { return saved ? [structuredClone(saved)] : [] },
    async listResults() { return structuredClone(results) },
    async saveRun(candidate, { expectedRevision }) {
      if ((saved?.revision ?? 0) !== expectedRevision) throw Object.assign(new Error('conflict'), { code: 'REVISION_CONFLICT' })
      saved = { ...structuredClone(candidate), revision: expectedRevision + 1 }
      return structuredClone(saved)
    },
    async completeRun(candidate, result, options) {
      const next = await this.saveRun(candidate, options)
      results.push(structuredClone(result))
      return next
    },
    get results() { return structuredClone(results) },
  }
}
