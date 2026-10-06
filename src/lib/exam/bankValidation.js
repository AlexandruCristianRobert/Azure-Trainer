import { EXAM_DOMAINS, EXAM_KINDS, EXAM_LIMITS, finiteJson, record, member, arrayOf, uniqueRecords, requireExam, stableId, text, uniqueIds, validateReference } from './contracts.js'
import { validateQuestion } from './question.js'
import { EXAM_OBJECTIVES } from '../../data/exam/taxonomy.js'
import { EXAM_CONCEPTS } from '../../data/exam/concepts.js'

// Literal authoring allocations; no dependency on unpublished domain modules.
const allocations = {
  containers: { prefix: 'c', counts: [6,4,4,4,3,2,2,2], groups: [['case-c1','case',[19,22,26]]] },
  data: { prefix: 'd', counts: [6,6,5,4,5,3,2,2], groups: [['case-d1','case',[4,22,30]],['case-d2','case',[9,19,32]]] },
  connect: { prefix: 'x', counts: [6,5,4,4,4,3,2,2], groups: [['series-x1','series',[1,2,3]],['case-x1','case',[9,20,29]]] },
  secure: { prefix: 's', counts: [6,5,3,4,4,4,2,2], groups: [['series-s1','series',[1,2,3]],['case-s1','case',[4,19,27]],['case-s2','case',[9,24,29]]] },
}

/** Throws ExamError on invalid content; returns true without modifying input. */
export function validateDomainContent(content, domain) {
  finiteJson(content)
  record(content, ['questions','groups','references']); member(domain, EXAM_DOMAINS)
  const allocation = allocations[domain]
  const idAt = n => `ai200-${allocation.prefix}${String(n).padStart(3,'0')}`
  const kinds = EXAM_KINDS.flatMap((kind, i) => Array(allocation.counts[i]).fill(kind))
  arrayOf(content.questions, kinds.length, validateQuestion, kinds.length); uniqueRecords(content.questions)
  arrayOf(content.references, 1920, validateReference, 1); uniqueRecords(content.references)
  const references = new Set(content.references.map(r => r.id))
  const objectives = EXAM_OBJECTIVES.filter(o => o.domain === domain)
  const concepts = EXAM_CONCEPTS.filter(c => objectives.some(o => o.id === c.objectiveId))
  requireExam(concepts.every(c => c.referenceIds.every(id => references.has(id))), 'Missing canonical concept reference')
  content.questions.forEach((q, i) => {
    requireExam(q.id === idAt(i + 1) && q.kind === kinds[i] && q.revision === 1, 'Question ID, kind or revision allocation mismatch')
    requireExam(q.domain === domain && objectives.some(o => o.id === q.objectiveId), 'Unknown domain objective')
    requireExam(q.components.every(component => concepts.some(c => c.id === component.conceptId && c.objectiveId === q.objectiveId)), 'Question concept/objective mismatch')
    requireExam(q.referenceIds.every(id => references.has(id)), 'Missing question reference')
  })
  requireExam(objectives.every(o => content.questions.some(q => q.objectiveId === o.id)), 'Missing objective coverage')
  arrayOf(content.groups, allocation.groups.length, g => {
    record(g, ['id','kind','domain','title','background','questionIds'])
    stableId(g.id); member(g.kind, ['case','series']); requireExam(g.domain === domain, 'Group domain mismatch')
    text(g.title,1024); text(g.background,EXAM_LIMITS.caseBytes)
    uniqueIds(g.questionIds,3,content.questions.map(q => q.id),3)
  }, allocation.groups.length); uniqueRecords(content.groups)
  allocation.groups.forEach(([id,kind,members], i) => {
    const g = content.groups[i], expectedIds = members.map(idAt)
    requireExam(g.id === id && g.kind === kind && g.questionIds.every((qid,j) => qid === expectedIds[j]), 'Fixed group allocation mismatch')
    requireExam(g.questionIds.every(qid => content.questions.some(q => q.id === qid && q.groupId === g.id)), 'Group reciprocity mismatch')
    if (kind === 'series') requireExam(g.questionIds.every(qid => {
      const q = content.questions.find(q => q.id === qid)
      return q.kind === 'single-choice' && q.presentation.choices.length === 2 && q.presentation.choices.map(c => c.id).sort().join(',') === 'no,yes'
    }), 'Series requires yes/no choices')
  })
  requireExam(content.questions.every(q => q.groupId === null || content.groups.some(g => g.id === q.groupId && g.questionIds.includes(q.id))), 'Missing reciprocal question group')
  return true
}
