import { EXAM_CONCEPTS, EXAM_OBJECTIVES } from '../../data/exam/index.js'
import { arrayOf, EXAM_LIMITS, finiteJson, integer, requireExam, validateNote, validateSession } from './contracts.js'
import { gradeAttempt, gradeQuestion } from './grading.js'

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0
const clone = value => structuredClone(value)
const counts = () => ({ omitted: 0, incomplete: 0, assisted: 0, repeat: 0, uncertain: 0, wrongFamilies: 0, confidence: { unset: 0, low: 0, medium: 0, high: 0 } })
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
const keyFor = (domain, objectiveId, conceptId) => `${domain}/${objectiveId}/${conceptId}`
function latestByDistinctFamily(observations) {
  const families = new Map()
  for (const row of [...observations].sort((a, b) => a.at - b.at || compareId(a.attemptId, b.attemptId) || compareId(a.questionId, b.questionId))) families.set(row.familyId, row)
  return [...families.values()].sort((a, b) => a.at - b.at || compareId(a.attemptId, b.attemptId) || compareId(a.familyId, b.familyId))
}
function boundaryOrder(a, b) {
  if (a.at !== b.at) return a.at - b.at
  if (a.recordId === b.recordId) return a.index - b.index || compareId(a.questionId, b.questionId)
  // Stable display ordering never resolves ambiguous equal-time freshness.
  return compareId(a.recordId, b.recordId) || a.index - b.index
}

export function computeReview({ attempts, activeSessions, concepts = EXAM_CONCEPTS }) {
  finiteJson({ attempts, activeSessions, concepts })
  arrayOf(attempts, EXAM_LIMITS.attempts * 2, () => {})
  arrayOf(activeSessions, 2, validateSession)
  requireExam(activeSessions.every(s => s.status !== 'finished'), 'Expected active sessions, not finished pointers')
  requireExam(Array.isArray(concepts), 'Expected authored concepts')
  const deduped = new Map(), totals = { ...counts(), attempts: 0, duplicateAttempts: 0, activeSessions: activeSessions.length }
  for (const attempt of attempts) {
    const grades = gradeAttempt(attempt).grades
    const normalized = { ...attempt, source: 'local', grades }
    if (deduped.has(attempt.id)) {
      requireExam(canonical(deduped.get(attempt.id)) === canonical(normalized), 'Conflicting duplicate Attempt')
      totals.duplicateAttempts++
    } else deduped.set(attempt.id, normalized)
  }
  requireExam(deduped.size <= EXAM_LIMITS.attempts, 'Too many Attempts')
  totals.attempts = deduped.size
  const rows = new Map(), boundaries = new Map(), observations = [], seen = new Set()
  function topic(domain, objectiveId, conceptId) {
    const key = keyFor(domain, objectiveId, conceptId)
    if (!rows.has(key)) {
      const definition = concepts.find(c => c.id === conceptId && c.objectiveId === objectiveId)
      const objective = EXAM_OBJECTIVES.find(o => o.id === objectiveId && o.domain === domain)
      const mapped = Boolean(definition && objective)
      rows.set(key, {
        conceptId, objectiveId, domain, mapped,
        title: mapped ? definition.title : `Unmapped historical concept: ${conceptId} (${objectiveId})`,
        advice: mapped ? definition.advice : 'Historical taxonomy is not mapped to current guidance.',
        referenceIds: mapped ? clone(definition.referenceIds) : [], labIds: mapped ? clone(definition.labIds) : [], taskIds: mapped ? clone(definition.taskIds) : [],
        sampleCount: 0, accuracy: null, status: 'insufficient-evidence', lastErrorAt: null,
        evidence: [], counts: counts(), seenFamilyIds: [],
      })
    }
    return rows.get(key)
  }
  for (const c of concepts) {
    const objective = EXAM_OBJECTIVES.find(o => o.id === c.objectiveId)
    requireExam(objective, 'Unknown authored objective')
    topic(objective.domain, c.objectiveId, c.id)
  }
  function addBoundary(familyId, boundary) {
    if (!boundaries.has(familyId)) boundaries.set(familyId, [])
    boundaries.get(familyId).push(boundary)
  }
  const records = [
    ...[...deduped.values()].map(value => ({ value, completed: true })),
    ...activeSessions.filter(s => s.mode === 'study').map(value => ({ value, completed: false })),
  ]
  for (const { value: record, completed } of records) {
    const recordId = completed ? `attempt:${record.id}` : `session:${record.id}`
    for (const exposure of record.exposures) {
      seen.add(exposure.familyId)
      if (exposure.event === 'reveal') addBoundary(exposure.familyId, { recordId, questionId: exposure.questionId, event: 'reveal', at: exposure.at, end: exposure.at, uncertain: false, index: record.exposures.indexOf(exposure) })
    }
    for (const q of record.questions) {
      const answers = completed ? record.responses : record.answers
      const grade = completed ? record.grades.find(g => g.questionId === q.id) : gradeQuestion(q, Object.hasOwn(answers, q.id) ? answers[q.id] : {})
      const submitIndex = record.exposures.findIndex(e => e.questionId === q.id && e.event === 'submit')
      const submit = record.exposures[submitIndex]
      const attempted = grade.outcomes.some(o => o.attempted)
      if (attempted) {
        seen.add(q.familyId)
        // A draft has an interval, not an invented exact answer timestamp.
        addBoundary(q.familyId, { recordId, questionId: q.id, event: 'answer', at: submit?.at ?? record.createdAt, end: submit?.at ?? (completed ? record.finishedAt : record.lastObservedAt), uncertain: !submit, index: submitIndex < 0 ? -1 : submitIndex })
      }
      const conceptIds = [...new Set(q.components.map(c => c.conceptId))]
      for (const conceptId of conceptIds) {
        const outcomes = grade.outcomes.filter(o => o.conceptId === conceptId)
        const row = topic(q.domain, q.objectiveId, conceptId)
        // Undisplayed, empty active drafts are not omission/confidence evidence.
        if (completed || attempted || record.exposures.some(e => e.questionId === q.id && e.event !== 'seen')) {
          row.counts.omitted += outcomes.filter(o => o.status === 'unanswered').length
          row.counts.incomplete += outcomes.filter(o => o.status === 'incomplete').length
          row.counts.confidence[Object.hasOwn(record.confidence, q.id) ? record.confidence[q.id] : 'unset']++
        }
        const eligible = outcomes.filter(o => o.attempted)
        if (!eligible.length && record.exposures.some(e => e.questionId === q.id && e.event === 'reveal')) row.counts.assisted++
        if (eligible.length) observations.push({ row, recordId, questionId: q.id, familyId: q.familyId, attemptId: completed ? record.id : null, completed, credit: eligible.reduce((n, o) => n + o.earned, 0) / eligible.length })
      }
    }
  }
  for (const list of boundaries.values()) list.sort(boundaryOrder)
  for (const observation of observations) {
    const list = boundaries.get(observation.familyId), first = list[0]
    const own = list.find(b => b.recordId === observation.recordId && b.questionId === observation.questionId && b.event === 'answer')
    const firstAnswer = list.find(b => b.event === 'answer')
    const same = first.recordId === own.recordId && first.questionId === own.questionId && first.event === 'answer'
    const overlaps = b => b !== first && (b.recordId !== first.recordId || ((b.uncertain || first.uncertain) && b.questionId !== first.questionId)) && b.at <= first.end && b.end >= first.at
    const ambiguous = list.some(overlaps)
      || (first.uncertain && list.some(b => b.event === 'reveal' && b.at <= first.end))
    const priorReveal = list.some(b => b.event === 'reveal' && (b.at < own.at || (b.at === own.at && (b.recordId !== own.recordId || b.index < own.index)) || (own.uncertain && b.at <= own.end)))
    if (same && !ambiguous && !priorReveal) {
      if (observation.completed) observation.row.evidence.push({ attemptId: observation.attemptId, questionId: observation.questionId, familyId: observation.familyId, at: own.end, timing: own.uncertain ? 'interval' : 'exact', credit: observation.credit })
    } else if (own === firstAnswer && (first.event === 'reveal' || priorReveal)) observation.row.counts.assisted++
    else if (ambiguous && (same || overlaps(own))) observation.row.counts.uncertain++
    else observation.row.counts.repeat++
  }
  const topics = [], assessmentNeeded = []
  for (const row of rows.values()) {
    row.evidence = latestByDistinctFamily(row.evidence).slice(-6)
    row.sampleCount = row.evidence.length
    row.accuracy = row.sampleCount ? row.evidence.reduce((n, e) => n + e.credit, 0) / row.sampleCount : null
    row.counts.wrongFamilies = row.evidence.filter(e => e.credit < 1).length
    row.lastErrorAt = row.counts.wrongFamilies ? Math.max(...row.evidence.filter(e => e.credit < 1).map(e => e.at)) : null
    row.seenFamilyIds = [...seen].sort(compareId)
    if (row.sampleCount >= 3) {
      row.status = row.accuracy < 0.6 ? 'needs-review' : row.accuracy < 0.8 ? 'developing' : 'stronger-sample'
      topics.push(row)
    } else assessmentNeeded.push(row)
    for (const field of ['omitted', 'incomplete', 'assisted', 'repeat', 'uncertain', 'wrongFamilies']) totals[field] += row.counts[field]
    for (const level of ['unset', 'low', 'medium', 'high']) totals.confidence[level] += row.counts.confidence[level]
  }
  const stableTopic = (a, b) => compareId(a.conceptId, b.conceptId) || compareId(a.objectiveId, b.objectiveId) || compareId(a.domain, b.domain)
  topics.sort((a, b) => a.accuracy - b.accuracy || b.counts.wrongFamilies - a.counts.wrongFamilies || (b.lastErrorAt ?? -1) - (a.lastErrorAt ?? -1) || stableTopic(a, b))
  assessmentNeeded.sort((a, b) => a.sampleCount - b.sampleCount || stableTopic(a, b))
  return { topics, assessmentNeeded, counts: totals }
}

export function recommendPractice(review, { bank, labProgress, notes, now }) {
  integer(now)
  finiteJson({ review, bank, labProgress, notes })
  arrayOf(notes, EXAM_LIMITS.attempts * EXAM_LIMITS.items, validateNote)
  const recommendations = []
  for (const row of [...review.topics, ...review.assessmentNeeded]) {
    if (!row.mapped || notes.some(n => n.target.kind === 'concept' && n.target.id === row.conceptId && n.status === 'snoozed' && now < n.snoozedUntil)) continue
    const seen = new Set(row.seenFamilyIds), families = new Set(), questionIds = []
    for (const q of [...bank.questions].sort((a, b) => compareId(a.id, b.id))) {
      if (q.domain !== row.domain || q.objectiveId !== row.objectiveId || !q.components.some(c => c.conceptId === row.conceptId) || seen.has(q.familyId) || families.has(q.familyId)) continue
      families.add(q.familyId); questionIds.push(q.id)
    }
    const references = row.referenceIds.map(id => bank.references.find(r => r.id === id)).filter(Boolean).map(clone)
    recommendations.push({ conceptId: row.conceptId, objectiveId: row.objectiveId, reason: row.status === 'insufficient-evidence' ? 'assessment-needed' : row.status,
      advice: row.advice, questionIds, freshFamilyCount: families.size, exhausted: families.size === 0,
      references, missingReferenceIds: row.referenceIds.filter(id => !references.some(r => r.id === id)),
      labs: row.labIds.map(labId => ({ labId, taskIds: row.taskIds.filter(t => t.labId === labId).map(t => t.taskId), progress: clone(labProgress.find(p => p.labId === labId) ?? null) })),
    })
  }
  return recommendations
}

export function conceptPrompt(concept) {
  const authored = EXAM_CONCEPTS.find(c => c.id === concept?.id)
  requireExam(authored, 'No authored prompt for unmapped historical concept')
  return `Help me practice ${authored.title}. ${authored.advice}\nUse a new example, explain the tradeoffs, and ask me to justify my choices.\nDocumentation reference IDs: ${authored.referenceIds.join(', ')}.\nDo not request confidential exam questions or personal study records.`
}
