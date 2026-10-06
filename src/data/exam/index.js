import { finiteJson, record, stableId, text, uniqueIds, uniqueRecords, requireExam, arrayOf } from '../../lib/exam/contracts.js'
import { EXAM_OBJECTIVES } from './taxonomy.js'
export { EXAM_OBJECTIVES } from './taxonomy.js'
export { EXAM_CONCEPTS } from './concepts.js'

export function validateLabMappings(concepts, labs) {
  finiteJson(concepts)
  arrayOf(concepts, 720, c => {
    record(c, ['id', 'objectiveId', 'title', 'advice', 'referenceIds', 'labIds', 'taskIds'])
    stableId(c.id); text(c.title, 1024); text(c.advice, 8192)
    requireExam(EXAM_OBJECTIVES.some(o => o.id === c.objectiveId), 'Unknown concept objective')
    uniqueIds(c.referenceIds, 32, null, 1); uniqueIds(c.labIds, 120)
    for (const id of c.labIds) requireExam(labs.some(l => l.id === id), `Stale Lab mapping: ${id}`)
    arrayOf(c.taskIds, 120, t => {
      record(t, ['labId', 'taskId']); stableId(t.labId); stableId(t.taskId)
      requireExam(c.labIds.includes(t.labId) && labs.find(l => l.id === t.labId)?.tasks.some(task => task.id === t.taskId), `Stale Task mapping: ${t.labId}/${t.taskId}`)
    })
    requireExam(new Set(c.taskIds.map(t => `${t.labId}/${t.taskId}`)).size === c.taskIds.length, 'Duplicate Task mapping')
  })
  uniqueRecords(concepts)
  return concepts
}
