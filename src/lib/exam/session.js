import { ExamError, EXAM_DOMAINS, EXAM_KINDS, finiteJson, record, member, integer, requireExam, validateSession, validateAttempt } from './contracts.js'
import { validateAnswer, publicQuestion } from './question.js'
import { gradeQuestion, gradeAttempt } from './grading.js'
import { drawMock, drawStudy } from './selection.js'

const copy = value => structuredClone(value)
const currentSection = s => s.sections[s.cursor.sectionIndex]
const currentId = s => currentSection(s).questionIds[s.cursor.questionIndex]
const findQuestion = (s, id) => s.questions.find(q => q.id === id)
const response = (s, id) => Object.hasOwn(s.answers, id) ? s.answers[id] : {}
const observed = (s, now) => Math.max(s.lastObservedAt, integer(now))
const expiredAt = (s, now) => s.mode === 'mock' && (s.status === 'expired' || now >= s.deadlineAt)
function expose(s, id, event, at) {
  if (s.exposures.some(e => e.questionId === id && e.event === event)) return
  s.exposures.push({ questionId: id, familyId: findQuestion(s, id).familyId, event, at })
  const list = event === 'reveal' ? s.assistedIds : event === 'submit' ? s.submittedIds : s.seenIds
  if (list && !list.includes(id)) list.push(id)
}
function visit(s, id) {
  const sectionIndex = s.sections.findIndex(section => section.questionIds.includes(id))
  requireExam(sectionIndex >= 0, 'Unknown question')
  if (s.mode === 'mock') {
    requireExam(sectionIndex === s.cursor.sectionIndex && !s.sealedIds.includes(id), 'Question is outside the accessible section')
    requireExam(currentSection(s).kind !== 'series' || id === currentId(s), 'Series questions cannot be revisited or skipped')
  }
  s.cursor = { sectionIndex, questionIndex: s.sections[sectionIndex].questionIds.indexOf(id) }
  expose(s, id, 'seen', s.lastObservedAt)
}
function seal(s, ids) { for (const id of ids) if (!s.sealedIds.includes(id)) s.sealedIds.push(id) }
function enterNextSection(s) {
  if (s.cursor.sectionIndex + 1 < s.sections.length) {
    s.cursor = { sectionIndex: s.cursor.sectionIndex + 1, questionIndex: 0 }
    expose(s, currentId(s), 'seen', s.lastObservedAt)
  }
}
function validateAction(action) {
  finiteJson(action, 65536)
  const fields = {
    answer: ['type', 'questionId', 'answer'], visit: ['type', 'questionId'], flag: ['type', 'questionId', 'flagged'],
    confidence: ['type', 'questionId', 'value'], next: ['type'], back: ['type'], sealSection: ['type'],
    break: ['type'], resumeBreak: ['type'], reveal: ['type'], submitQuestion: ['type'], tick: ['type'], finish: ['type'],
  }
  requireExam(action && Object.hasOwn(fields, action.type), 'Unknown session action')
  record(action, fields[action.type])
}
export function createExamSession({ id, bank, mode, settings = {}, seed = 0, now }) {
  member(mode, ['study', 'mock']); integer(now); finiteJson(settings)
  requireExam(settings && typeof settings === 'object' && !Array.isArray(settings), 'Invalid creation settings')
  requireExam(Object.keys(settings).every(k => ['size', 'durationMinutes', 'practiceGoal', 'domains', 'kinds', 'conceptIds', 'allowShorter'].includes(k)), 'Unknown creation setting')
  if (Object.hasOwn(settings, 'allowShorter')) requireExam(typeof settings.allowShorter === 'boolean', 'Invalid shorter-deck consent')
  if (mode === 'mock') {
    requireExam(!Object.hasOwn(settings, 'allowShorter'), 'Mock cannot consent to a shorter draw')
    for (const [key, expected] of [['domains', EXAM_DOMAINS], ['kinds', EXAM_KINDS], ['conceptIds', []]]) {
      if (Object.hasOwn(settings, key)) requireExam(Array.isArray(settings[key]) && settings[key].length === expected.length && new Set(settings[key]).size === expected.length && expected.every(v => settings[key].includes(v)), 'Mock cannot use adaptive filters')
    }
  } else requireExam(settings.durationMinutes === undefined || settings.durationMinutes === null, 'Study has no duration')
  const size = settings.size ?? (mode === 'mock' ? 50 : 10)
  const filters = { domains: settings.domains ?? [...EXAM_DOMAINS], kinds: settings.kinds ?? [...EXAM_KINDS], conceptIds: settings.conceptIds ?? [] }
  const deck = mode === 'mock' ? drawMock(bank, { size }, seed) : drawStudy(bank, filters, size, seed)
  if (mode === 'study' && !deck.actualSize) throw new ExamError('No questions match the Study filters', 'NO_STUDY_ITEMS')
  if (mode === 'study' && deck.requiresConsent && settings.allowShorter !== true) throw new ExamError('Confirm the available shorter Study deck', 'SHORTER_DECK_CONSENT_REQUIRED')
  const durationMinutes = mode === 'mock' ? settings.durationMinutes ?? 100 : null
  const s = { version: 1, id, revision: 1, mode, status: 'active', bankRevision: bank.revision,
    settings: { requestedSize: size, actualSize: deck.order.length, durationMinutes, practiceGoal: settings.practiceGoal ?? 80, ...filters, seed },
    createdAt: now, lastObservedAt: now, deadlineAt: mode === 'mock' ? now + durationMinutes * 60000 : null,
    questions: deck.questions, references: deck.references, groups: deck.groups, order: deck.order, optionOrders: deck.optionOrders, sections: deck.sections,
    cursor: { sectionIndex: 0, questionIndex: 0 }, seenIds: [], sealedIds: [], answers: {}, submittedIds: [], flags: [], assistedIds: [], confidence: {}, exposures: [], resultId: null }
  expose(s, currentId(s), 'seen', now)
  validateSession(s)
  return copy(s)
}
function finish(s) {
  // A submit event records finalization, including omissions; attempted lives in outcomes.
  if (s.mode === 'mock') for (const id of s.order) expose(s, id, 'submit', s.lastObservedAt)
  const attempt = { version: 1, id: s.id, sessionId: s.id, mode: s.mode, createdAt: s.createdAt, finishedAt: s.lastObservedAt, lastObservedAt: s.lastObservedAt,
    bankRevision: s.bankRevision, settings: s.settings, questions: s.questions, references: s.references, groups: s.groups, order: s.order, optionOrders: s.optionOrders,
    responses: s.answers, submittedIds: s.submittedIds, assistedIds: s.assistedIds, confidence: s.confidence, exposures: s.exposures,
    submissionReason: expiredAt(s, s.lastObservedAt) ? 'deadline' : s.mode === 'study' && s.submittedIds.length === s.order.length ? 'completed' : 'manual',
    grades: s.order.map(id => gradeQuestion(findQuestion(s, id), response(s, id))), source: 'local' }
  validateAttempt(attempt)
  return { session: { version: 1, id: s.id, revision: s.revision, mode: s.mode, status: 'finished', attemptId: s.id }, attempt }
}
export function reduceExamSession(session, action, { now }) {
  validateSession(session); validateAction(action); integer(now)
  if (session.status === 'finished') {
    requireExam(action.type === 'finish', 'The session is finished')
    return { session: copy(session), attempt: null }
  }
  const s = copy(session); s.lastObservedAt = observed(s, now)
  const expired = expiredAt(s, s.lastObservedAt)
  requireExam(!expired || ['tick', 'finish'].includes(action.type), 'The Mock deadline has expired')
  requireExam(s.status !== 'break' || ['tick', 'finish', 'resumeBreak'].includes(action.type), 'Resume the break before continuing')
  integer(s.revision + 1, 1); s.revision += 1
  if (expired) s.status = 'expired'
  if (action.type === 'finish') return finish(s)
  if (action.type === 'tick') return { session: validateSession(s), attempt: null }
  const id = action.questionId ?? currentId(s), section = currentSection(s)
  switch (action.type) {
    case 'answer':
    case 'flag':
    case 'confidence': {
      requireExam(findQuestion(s, id), 'Unknown question')
      requireExam(!s.sealedIds.includes(id) && !s.submittedIds.includes(id), 'Question is sealed or submitted')
      if (s.mode === 'mock') requireExam(section.questionIds.includes(id) && (section.kind !== 'series' || id === currentId(s)), 'Question is inaccessible')
      if (action.type === 'answer') { validateAnswer(findQuestion(s, id), action.answer); s.answers[id] = copy(action.answer) }
      if (action.type === 'flag') { requireExam(typeof action.flagged === 'boolean', 'Invalid flag'); s.flags = s.flags.filter(qid => qid !== id); if (action.flagged) s.flags.push(id) }
      if (action.type === 'confidence') { member(action.value, ['unset', 'low', 'medium', 'high']); s.confidence[id] = action.value }
      break
    }
    case 'visit': visit(s, id); break
    case 'next':
    case 'back': {
      const forward = action.type === 'next'
      if (s.mode === 'study') {
        const index = s.order.indexOf(currentId(s)) + (forward ? 1 : -1)
        requireExam(index >= 0 && index < s.order.length, 'No question in that direction'); visit(s, s.order[index])
      } else {
        requireExam(!section.sealed, 'Section is sealed')
        if (section.kind === 'series') {
          requireExam(forward, 'No return within the series'); seal(s, [currentId(s)])
          if (s.cursor.questionIndex + 1 < section.questionIds.length) { s.cursor.questionIndex += 1; expose(s, currentId(s), 'seen', s.lastObservedAt) }
          else section.sealed = true
        } else {
          const candidates = section.questionIds.map((qid, i) => ({ qid, i })).filter(({ qid, i }) => !s.sealedIds.includes(qid) && (forward ? i > s.cursor.questionIndex : i < s.cursor.questionIndex))
          const target = forward ? candidates[0] : candidates.at(-1)
          requireExam(target, 'Seal the section to continue'); visit(s, target.qid)
        }
      }
      break
    }
    case 'sealSection':
      requireExam(s.mode === 'mock' && !section.sealed, 'No unsealed Mock section')
      requireExam(section.kind !== 'series' || s.cursor.questionIndex === section.questionIds.length - 1, 'Advance series items in order')
      seal(s, section.questionIds); section.sealed = true; enterNextSection(s); break
    case 'break':
      requireExam(s.mode === 'mock' && section.kind !== 'series' && !section.sealed, 'Break unavailable here')
      seal(s, section.questionIds.filter(qid => s.seenIds.includes(qid))); s.status = 'break'; break
    case 'resumeBreak': {
      requireExam(s.status === 'break', 'No break to resume'); s.status = 'active'
      const next = section.questionIds.find(qid => !s.sealedIds.includes(qid))
      if (next) visit(s, next)
      break
    }
    case 'reveal':
      requireExam(s.mode === 'study', 'Mock feedback is withheld'); expose(s, id, 'reveal', s.lastObservedAt); break
    case 'submitQuestion':
      requireExam(s.mode === 'study' && !s.submittedIds.includes(id), 'Only an unsubmitted Study question can be submitted')
      expose(s, id, 'submit', s.lastObservedAt); seal(s, [id]); break
  }
  return { session: validateSession(s), attempt: null }
}
export function sessionSummary(session) {
  validateSession(session)
  if (session.status === 'finished') return { status: 'finished', attemptId: session.attemptId }
  const answered = session.questions.filter(q => gradeQuestion(q, response(session, q.id)).outcomes.every(o => o.attempted)).length
  return { total: session.order.length, points: session.questions.reduce((sum, q) => sum + q.components.length, 0), answered, unanswered: session.order.length - answered,
    remaining: session.order.filter(id => !session.sealedIds.includes(id)).length, flagged: session.flags.length, submitted: session.submittedIds.length }
}
export function presentSession(session, { now }) {
  validateSession(session); integer(now)
  if (session.status === 'finished') return copy(session)
  const at = observed(session, now), expired = expiredAt(session, at), hidden = session.status === 'break' || expired
  const id = currentId(session), q = findQuestion(session, id)
  const feedbackAllowed = !hidden && session.mode === 'study' && (session.submittedIds.includes(id) || session.assistedIds.includes(id))
  // Construct the view explicitly: never spread private session/question records.
  return copy({ id: session.id, revision: session.revision, mode: session.mode, status: expired ? 'expired' : session.status,
    settings: session.settings, deadlineAt: session.deadlineAt, lastObservedAt: at, remainingMs: session.deadlineAt === null ? null : Math.max(0, session.deadlineAt - at),
    order: session.order, optionOrders: session.optionOrders, sections: session.sections, cursor: session.cursor,
    seenIds: session.seenIds, sealedIds: session.sealedIds, submittedIds: session.submittedIds, flags: session.flags, assistedIds: session.assistedIds, confidence: session.confidence,
    answers: session.answers, questions: hidden ? [] : session.questions.map(q => publicQuestion(q)),
    groups: hidden ? [] : session.groups.filter(g => g.questionIds.includes(id)), references: feedbackAllowed ? session.references.filter(r => q.referenceIds.includes(r.id)) : [],
    currentQuestionId: id, editable: !hidden && !session.sealedIds.includes(id) && !session.submittedIds.includes(id), summary: sessionSummary(session),
    feedback: feedbackAllowed ? { question: publicQuestion(q, { feedback: true }), grade: gradeQuestion(q, response(session, id)) } : null })
}
export function recordReviewReveal(attempt, questionId, { now }) {
  validateAttempt(attempt); integer(now)
  requireExam(findQuestion(attempt, questionId), 'Unknown review question')
  // Refuse a forged grade instead of mutating frozen historical credit.
  requireExam(gradeAttempt(attempt).grades.every((g, i) => g.outcomes.every((o, j) =>
    ['earned', 'status', 'attempted'].every(key => o[key] === attempt.grades[i].outcomes[j][key]))), 'Stored grades do not match frozen responses')
  const result = copy(attempt); result.lastObservedAt = observed(result, now)
  expose(result, questionId, 'reveal', result.lastObservedAt)
  return validateAttempt(result)
}
export function accessDecision(snapshot, to) {
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : Object.values(snapshot.sessions ?? {})
  const active = sessions.find(s => s.mode === 'mock' && ['active', 'break', 'expired'].includes(s.status))
  const allowed = { allowed: true, redirect: null, reason: null }
  if (!active) return allowed
  const path = typeof to === 'string' ? to : to.path ?? '', name = typeof to === 'string' ? '' : to.name ?? ''
  const sessionId = typeof to === 'string' ? null : to.params?.sessionId
  const sessionTarget = sessionId ?? path.match(/^\/exam\/session\/([^/?#]+)/)?.[1]
  const review = /^\/(?:exam\/results|review)(?:\/|$)/.test(path) || ['exam-results', 'exam-review', 'review', 'review-history', 'review-attempt', 'review-concept'].includes(name)
  const study = (typeof to === 'object' && to.mode === 'study') || (sessionTarget && sessionTarget !== active.id) || name === 'exam-study'
  return review || study ? { allowed: false, redirect: `/exam/session/${active.id}`, reason: 'Finish the active Mock before opening Study or answer review.' } : allowed
}
