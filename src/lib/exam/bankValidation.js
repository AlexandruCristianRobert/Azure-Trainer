import { EXAM_DOMAINS, EXAM_KINDS, EXAM_LIMITS, finiteJson, record, member, integer, arrayOf, uniqueRecords, requireExam, stableId, text, uniqueIds, validateReference } from './contracts.js'
import { validateQuestion } from './question.js'
import { EXAM_OBJECTIVES } from '../../data/exam/taxonomy.js'
import { EXAM_CONCEPTS } from '../../data/exam/concepts.js'
import { validateLabMappings } from '../../data/exam/index.js'
import { LABS } from '../../data/labs/index.js'
import { drawMock } from './selection.js'

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

/** Validate the current complete authored bank; historical DTO validation stays separate. */
export function validateExamBank(bank) {
  finiteJson(bank)
  record(bank,['version','revision','questions','groups','references'])
  member(bank.version,[1]); integer(bank.revision,1)
  arrayOf(bank.questions,120,validateQuestion,120); uniqueRecords(bank.questions)
  arrayOf(bank.references,3840,validateReference,1); uniqueRecords(bank.references)
  arrayOf(bank.groups,8,g=>{
    record(g,['id','kind','domain','title','background','questionIds'])
    member(g.domain,EXAM_DOMAINS)
  },8); uniqueRecords(bank.groups)
  for (const domain of EXAM_DOMAINS) validateDomainContent({
    questions:bank.questions.filter(q=>q.domain===domain),
    groups:bank.groups.filter(g=>g.domain===domain),
    references:bank.references,
  },domain)
  // Published family IDs identify an existing same-objective representative.
  // This authoring restriction does not apply to persisted historical attempts.
  const questions = new Map(bank.questions.map(q=>[q.id,q]))
  for (const q of bank.questions) {
    const representative=questions.get(q.familyId)
    requireExam(representative && representative.familyId===representative.id && representative.domain===q.domain && representative.objectiveId===q.objectiveId,'Unresolved or incompatible question family')
  }
  validateLabMappings(EXAM_CONCEPTS,LABS)
  for (const size of [40,50,60]) drawMock(bank,{size},23)
  return true
}

/** Counts authored availability, not learner results. Partial pools reveal gaps. */
export function bankCoverage(bank) {
  finiteJson(bank)
  record(bank,['version','revision','questions','groups','references'])
  member(bank.version,[1]); integer(bank.revision,1)
  arrayOf(bank.questions,120,validateQuestion); uniqueRecords(bank.questions)
  const countBy = (ids,read) => Object.fromEntries(ids.map(id=>[id,bank.questions.filter(q=>read(q,id)).length]))
  const byDomain=countBy(EXAM_DOMAINS,(q,id)=>q.domain===id)
  const byKind=countBy(EXAM_KINDS,(q,id)=>q.kind===id)
  const byObjective=countBy(EXAM_OBJECTIVES.map(o=>o.id),(q,id)=>q.objectiveId===id)
  // One question counts once for each concept, even when it has several components.
  const byConcept=countBy(EXAM_CONCEPTS.map(c=>c.id),(q,id)=>q.components.some(c=>c.conceptId===id))
  const familyCount=new Set(bank.questions.map(q=>q.familyId)).size
  const ids=new Set(bank.questions.map(q=>q.id))
  const missingFamilyIds=[...new Set(bank.questions.filter(q=>!ids.has(q.familyId)).map(q=>q.familyId))].sort()
  const assessmentNeeded=EXAM_CONCEPTS.map(c=>({conceptId:c.id,objectiveId:c.objectiveId,
    familyCount:new Set(bank.questions.filter(q=>q.objectiveId===c.objectiveId && q.components.some(part=>part.conceptId===c.id)).map(q=>q.familyId)).size,
    reason:'assessment-needed',
  })).filter(c=>c.familyCount<3)
  return {byDomain,byKind,byObjective,byConcept,familyCount,
    missingObjectiveIds:EXAM_OBJECTIVES.filter(o=>byObjective[o.id]===0).map(o=>o.id),
    missingConceptIds:EXAM_CONCEPTS.filter(c=>byConcept[c.id]===0).map(c=>c.id),
    missingFamilyIds,assessmentNeeded}
}
