import { integer, member, stableId, requireExam } from './contracts.js'

// Adapter only: no store import, hydration, evaluation or persistence writes.
export function readLabProgress(progress, labIds) {
  requireExam(Array.isArray(labIds), 'Expected Lab identifiers')
  return [...new Set(labIds)].map(labId => {
    stableId(labId)
    const status = progress.labStatus(labId)
    member(status, ['not-started', 'in-progress', 'completed', 'loading', 'error'])
    const summary = progress.runSummary(labId)
    const tasksDone = summary?.tasksDone ?? 0, total = summary?.total ?? 0
    integer(tasksDone); integer(total); requireExam(tasksDone <= total, 'Invalid Lab progress counts')
    return { labId, status, tasksDone, total, completedAt: summary?.completedAt ?? null }
  })
}
