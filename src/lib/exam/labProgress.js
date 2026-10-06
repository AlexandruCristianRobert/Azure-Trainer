import { integer, member, stableId, requireExam, text } from './contracts.js'

function resultContext(result) {
  if (result === undefined || result === null) return null
  requireExam(typeof result === 'object' && !Array.isArray(result), 'Invalid Lab result context')
  const id = result.id ?? null, finishedAt = result.finishedAt ?? null
  const hintsUsed = result.hintsUsed ?? null, solutionsUsed = result.solutionsUsed ?? null
  if (id !== null) text(id, 1024)
  if (finishedAt !== null) text(finishedAt, 128)
  if (hintsUsed !== null) integer(hintsUsed)
  if (solutionsUsed !== null) integer(solutionsUsed)
  return { id, finishedAt, hintsUsed, solutionsUsed }
}

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
    const latestResult = resultContext(typeof progress.latestResult === 'function' ? progress.latestResult(labId) : null)
    return { labId, status, tasksDone, total, completedAt: summary?.completedAt ?? null, latestResult }
  })
}
