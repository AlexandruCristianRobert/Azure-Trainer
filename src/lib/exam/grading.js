import { EXAM_DOMAINS, EXAM_KINDS, validateAttempt } from './contracts.js'
import { validateQuestion, validateAnswer } from './question.js'

export function gradeQuestion(q, answer) {
  validateQuestion(q, { historical: true }); validateAnswer(q, answer)
  const outcomes = q.components.map((c) => {
    const value = Object.hasOwn(answer, c.id) ? answer[c.id] : undefined
    const absent = value === undefined || (Array.isArray(value) && value.length === 0)
    const incomplete = !absent && c.input === 'set' && c.requiredCount !== null && value.length !== c.requiredCount
    const equal = !absent && !incomplete && (c.input === 'set' ? value.length === c.expected.length && value.every((id) => c.expected.includes(id)) : value === c.expected)
    return { componentId: c.id, conceptId: c.conceptId, earned: equal ? 1 : 0, possible: 1, status: absent ? 'unanswered' : incomplete ? 'incomplete' : equal ? 'correct' : 'wrong', attempted: !absent && !incomplete }
  })
  return { questionId: q.id, outcomes, earned: outcomes.reduce((sum, o) => sum + o.earned, 0), possible: outcomes.length }
}
const emptyScore = () => ({ earned: 0, possible: 0, percentage: 0 })
const percent = (score) => score.possible ? score.earned / score.possible * 100 : 0
export function gradeAttempt(attempt) {
  validateAttempt(attempt)
  const byDomain = Object.fromEntries(EXAM_DOMAINS.map((id) => [id, emptyScore()])), byKind = Object.fromEntries(EXAM_KINDS.map((id) => [id, emptyScore()]))
  const grades = attempt.order.map((id) => {
    const q = attempt.questions.find((question) => question.id === id), grade = gradeQuestion(q, Object.hasOwn(attempt.responses, id) ? attempt.responses[id] : {})
    for (const [map, key] of [[byDomain, q.domain], [byKind, q.kind]]) {
      const score = Object.hasOwn(map, key) ? map[key] : (map[key] = emptyScore()); score.earned += grade.earned; score.possible += grade.possible; score.percentage = percent(score)
    }
    return grade
  })
  const earned = grades.reduce((sum, g) => sum + g.earned, 0), possible = grades.reduce((sum, g) => sum + g.possible, 0)
  return { grades, earned, possible, percentage: percent({ earned, possible }), byDomain, byKind }
}
