import { describe, expect, it } from 'vitest'
import { EXAM_DOMAINS, EXAM_KINDS, validateSession, validateAttempt } from '../src/lib/exam/contracts.js'
import { drawMock, drawStudy } from '../src/lib/exam/selection.js'
import { createExamSession, reduceExamSession, presentSession, sessionSummary, accessDecision, recordReviewReveal } from '../src/lib/exam/session.js'
import { mockBankFixture, bankFixture, questionFixture, correctAnswer, SESSION_FIXTURE_ID } from './helpers/examFixtures.js'

const clone = x => structuredClone(x)
const mock = (settings = {}) => createExamSession({ id: SESSION_FIXTURE_ID, bank: mockBankFixture(), mode: 'mock', settings, seed: 17, now: 1000 })
const study = (settings = {}) => createExamSession({ id: SESSION_FIXTURE_ID, bank: bankFixture(), mode: 'study', settings: { size: 5, ...settings }, seed: 17, now: 1000 })
const act = (s, action, now = 2000) => reduceExamSession(s, action, { now }).session
const current = s => s.sections[s.cursor.sectionIndex].questionIds[s.cursor.questionIndex]
const question = (s, id = current(s)) => s.questions.find(q => q.id === id)
const answer = s => act(s, { type: 'answer', questionId: current(s), answer: correctAnswer(question(s)) })

describe('seeded selection', () => {
  it.each([[40, [9, 11, 10, 10]], [50, [12, 14, 12, 12]], [60, [14, 16, 15, 15]]])('draws %i with exact quotas, full groups and all formats', (size, quotas) => {
    const bank = mockBankFixture(), deck = drawMock(bank, { size }, 17)
    expect(deck.order).toHaveLength(size)
    expect(new Set(deck.order).size).toBe(size)
    expect(EXAM_DOMAINS.map(d => deck.questions.filter(q => q.domain === d).length)).toEqual(quotas)
    expect(new Set(deck.questions.map(q => q.kind))).toEqual(new Set(EXAM_KINDS))
    expect(deck.sections.map(s => [s.kind, s.questionIds.length])).toEqual([['standalone', size - 9], ['case', 3], ['case', 3], ['series', 3]])
    for (const group of deck.groups) expect(group).toEqual(bank.groups.find(g => g.id === group.id))
    expect(drawMock({ ...bank, questions: [...bank.questions].reverse(), groups: [...bank.groups].reverse() }, { size }, 17)).toEqual(deck)
    expect(drawMock(bank, { size }, 18).order).not.toEqual(deck.order)
  })
  it('reports impossible pools without weakening the draw', () => {
    const bank = clone(mockBankFixture())
    bank.questions = bank.questions.filter(q => q.kind !== 'active-screen')
    expect(() => drawMock(bank, { size: 50 }, 17)).toThrow(expect.objectContaining({ code: 'BANK_UNSATISFIABLE' }))
  })
  it('searches group combinations when a required format exists only in one case', () => {
    const bank = clone(mockBankFixture())
    bank.questions = bank.questions.filter(q => q.kind !== 'active-screen')
    const id = 'case-secure-0', index = bank.questions.findIndex(q => q.id === id)
    bank.questions[index] = questionFixture('active-screen', { id, familyId: `family-${id}`, domain: 'secure', groupId: 'case-secure' })
    for (const seed of [0, 1, 2, 17, 99]) {
      const result = drawMock(bank, { size: 50 }, seed)
      expect(result.groups.map(g => g.id)).toContain('case-secure')
      expect(result.questions).toHaveLength(50)
    }
  })
  it('rejects direct Mock adaptive filters and shorter-deck consent', () => {
    for (const settings of [{ size: 50, kinds: ['single-choice'] }, { size: 50, conceptIds: ['concept-one'] }, { size: 50, allowShorter: true }]) {
      expect(() => drawMock(mockBankFixture(), settings, 17)).toThrow()
      expect(() => mock(settings)).toThrow()
    }
  })
  it('reports Study availability and requires explicit shorter-deck consent', () => {
    const draw = drawStudy(bankFixture(), { kinds: ['single-choice'] }, 5, 17)
    expect(draw).toMatchObject({ available: 1, actualSize: 1, requestedSize: 5, requiresConsent: true })
    expect(() => study({ kinds: ['single-choice'] })).toThrow(expect.objectContaining({ code: 'SHORTER_DECK_CONSENT_REQUIRED' }))
    expect(study({ kinds: ['single-choice'], allowShorter: true }).order).toHaveLength(1)
    expect(drawStudy(bankFixture(), { conceptIds: ['absent'] }, 5, 17)).toMatchObject({ available: 0, actualSize: 0 })
    expect(() => study({ conceptIds: ['absent'], allowShorter: true })).toThrow()
  })
  it('projects selected Study group members with intact background and coherent sections', () => {
    const bank = mockBankFixture(), deck = drawStudy(bank, { domains: ['connect'], kinds: ['single-choice'] }, 5, 17)
    expect(deck.sections.flatMap(s => s.questionIds)).toEqual(deck.order)
    expect(deck.groups.length).toBeGreaterThan(0)
    for (const g of deck.groups) {
      expect(g.background).toBe(bank.groups.find(b => b.id === g.id).background)
      expect(g.questionIds.every(id => deck.order.includes(id))).toBe(true)
    }
    const session = createExamSession({ id: SESSION_FIXTURE_ID, bank, mode: 'study', settings: { size: 5, domains: ['connect'], kinds: ['single-choice'] }, seed: 17, now: 1000 })
    expect(validateSession(session)).toBe(session)
  })
  it('supports maximum-length stable group IDs without deriving oversized section IDs', () => {
    const bank = clone(mockBankFixture())
    for (const [i, group] of bank.groups.entries()) {
      const id = `${i}${'x'.repeat(127)}`
      for (const q of bank.questions.filter(q => q.groupId === group.id)) q.groupId = id
      group.id = id
    }
    expect(() => createExamSession({ id: SESSION_FIXTURE_ID, bank, mode: 'mock', seed: 17, now: 1000 })).not.toThrow()
  })
  it('rejects malformed setting and group containers as domain errors', () => {
    const bank = clone(mockBankFixture()); bank.groups = [null]
    for (const run of [() => drawStudy(bankFixture(), null, 5, 0), () => createExamSession({ id: SESSION_FIXTURE_ID, bank: bankFixture(), mode: 'study', settings: null, now: 1000 }), () => drawMock(bank, {}, 0)]) {
      expect(run).toThrow(expect.objectContaining({ name: 'ExamError' }))
    }
  })
})

describe('session transitions', () => {
  it('freezes a reload-equivalent draw and detached options', () => {
    const s = mock(), reloaded = JSON.parse(JSON.stringify(s))
    expect(validateSession(s)).toBe(s)
    expect(s.order).toEqual(drawMock(mockBankFixture(), { size: 50 }, 17).order)
    expect(act(s, { type: 'next' })).toEqual(act(reloaded, { type: 'next' }))
    const next = answer(s)
    expect(s.answers).toEqual({})
    expect(next.revision).toBe(s.revision + 1)
  })
  it('caps backward clocks and marks expiry without manufacturing completion', () => {
    const s = act(mock(), { type: 'tick' }, 5000)
    const back = act(s, { type: 'tick' }, 1001)
    expect(back.lastObservedAt).toBe(5000)
    const result = reduceExamSession(back, { type: 'tick' }, { now: 6001000 })
    expect(result.session.status).toBe('expired')
    expect(result.attempt).toBeNull()
    expect(() => answer(result.session)).toThrow()
    expect(() => act(mock(), { type: 'answer', questionId: current(mock()), answer: {} }, 6001000)).toThrow()
  })
  it('uses acknowledged pre-deadline answers and refuses post-expiry queued edits', () => {
    const s = act(mock(), { type: 'answer', questionId: current(mock()), answer: correctAnswer(question(mock())) }, 6000999)
    const expired = act(s, { type: 'tick' }, 6001000)
    expect(() => act(expired, { type: 'answer', questionId: current(s), answer: {} }, 6000999)).toThrow()
    const done = reduceExamSession(expired, { type: 'finish' }, { now: 6001001 })
    expect(done.attempt.grades[0].earned).toBe(question(s).components.length)
    expect(done.attempt.submissionReason).toBe('deadline')
  })
  it('withholds every Mock key and reference despite drafts and submit attempts', () => {
    const s = answer(mock()), p = presentSession(s, { now: 2000 })
    expect(p.feedback).toBeNull()
    expect(p.questions.every(q => !('explanation' in q) && !('referenceIds' in q) && q.components.every(c => !('expected' in c)))).toBe(true)
    expect(p.references).toEqual([])
    expect(() => act(s, { type: 'reveal' })).toThrow()
    expect(() => act(s, { type: 'submitQuestion' })).toThrow()
  })
  it('lets Study skip and return, then seals explicit submission and shows feedback', () => {
    const s = study(), skipped = act(s, { type: 'next' }), returned = act(skipped, { type: 'back' })
    expect(current(returned)).toBe(current(s))
    const submitted = act(answer(returned), { type: 'submitQuestion' })
    expect(submitted.submittedIds).toEqual([current(s)])
    expect(presentSession(submitted, { now: 2000 }).feedback.grade.earned).toBe(question(s).components.length)
    expect(() => answer(submitted)).toThrow()
    expect(submitted.exposures.filter(e => e.event === 'submit')).toHaveLength(1)
  })
  it('records first Study reveal once with assistance and stable equal-time order', () => {
    const s = study(), revealed = act(s, { type: 'reveal' }, 1000), repeated = act(revealed, { type: 'reveal' }, 3000)
    expect(repeated.assistedIds).toEqual([current(s)])
    expect(repeated.exposures.filter(e => e.event === 'reveal')).toEqual([{ questionId: current(s), familyId: question(s).familyId, event: 'reveal', at: 1000 }])
    expect(repeated.exposures.map(e => e.event)).toEqual(['seen', 'reveal'])
    expect(presentSession(revealed, { now: 1000 }).feedback).not.toBeNull()
    expect(answer(revealed).answers[current(s)]).toEqual(correctAnswer(question(s)))
  })
  it('seals reviewable sections and prevents jumping around boundaries', () => {
    const s = mock(), nextId = s.sections[1].questionIds[0]
    expect(() => act(s, { type: 'visit', questionId: nextId })).toThrow()
    const sealed = act(answer(s), { type: 'sealSection' })
    expect(sealed.cursor).toEqual({ sectionIndex: 1, questionIndex: 0 })
    expect(sealed.sections[0].sealed).toBe(true)
    expect(() => act(sealed, { type: 'visit', questionId: current(s) })).toThrow()
    expect(() => act(sealed, { type: 'back' })).toThrow()
  })
  it('breaks seal seen items only and leave unseen items reachable without pausing time', () => {
    const s = mock(), seen = act(s, { type: 'next' }), paused = act(seen, { type: 'break' }, 5000)
    expect(paused.sealedIds).toEqual([current(s), current(seen)])
    expect(paused.deadlineAt).toBe(s.deadlineAt)
    expect(() => act(paused, { type: 'next' })).toThrow()
    expect(presentSession(paused, { now: 5000 }).questions).toEqual([])
    const resumed = act(paused, { type: 'resumeBreak' }, 7000)
    expect(resumed.cursor.questionIndex).toBe(2)
    expect(() => act(resumed, { type: 'visit', questionId: current(s) })).toThrow()
  })
  it('no-return Next seals each series item, disallows back, jumps and breaks', () => {
    let s = mock()
    for (let i = 0; i < 3; i++) s = act(s, { type: 'sealSection' })
    expect(s.sections[s.cursor.sectionIndex].kind).toBe('series')
    expect(() => act(s, { type: 'break' })).toThrow()
    expect(() => act(s, { type: 'visit', questionId: s.sections[3].questionIds[2] })).toThrow()
    const moved = act(answer(s), { type: 'next' })
    expect(moved.sealedIds).toContain(current(s))
    expect(() => act(moved, { type: 'back' })).toThrow()
  })
  it('summarizes drafts, omissions and flags without exposing credit', () => {
    let s = answer(study())
    s = act(s, { type: 'flag', questionId: current(s), flagged: true })
    s = act(s, { type: 'confidence', questionId: current(s), value: 'high' })
    expect(sessionSummary(s)).toMatchObject({ total: 5, answered: 1, unanswered: 4, flagged: 1, submitted: 0 })
    expect(s.confidence[current(s)]).toBe('high')
    expect(sessionSummary(s)).not.toHaveProperty('earned')
  })
  it('finishes with frozen grading, all Mock submit exposures and an idempotent pointer', () => {
    const s = answer(mock()), done = reduceExamSession(s, { type: 'finish' }, { now: 3000 })
    expect(validateAttempt(done.attempt)).toBe(done.attempt)
    expect(done.session).toEqual({ version: 1, id: s.id, revision: s.revision + 1, mode: 'mock', status: 'finished', attemptId: s.id })
    expect(done.attempt.id).toBe(s.id)
    expect(done.attempt.submittedIds).toEqual(s.order)
    expect(done.attempt.exposures.filter(e => e.event === 'submit')).toHaveLength(50)
    expect(done.attempt.grades[1].outcomes.every(o => !o.attempted)).toBe(true)
    expect(done.attempt.lastObservedAt).toBe(done.attempt.finishedAt)
    expect(reduceExamSession(done.session, { type: 'finish' }, { now: 4000 })).toEqual({ session: done.session, attempt: null })
    expect(reduceExamSession(s, { type: 'finish' }, { now: 3000 })).toEqual(done)
  })
  it('records post-finish review disclosure without rewriting responses, keys or credit', () => {
    const done = reduceExamSession(study(), { type: 'finish' }, { now: 3000 }).attempt
    const id = done.order[0], review = recordReviewReveal(done, id, { now: 5000 })
    expect(review.lastObservedAt).toBe(5000)
    expect(review.assistedIds).toEqual([id])
    for (const key of ['grades', 'responses', 'questions', 'finishedAt']) expect(review[key]).toEqual(done[key])
    expect(recordReviewReveal(review, id, { now: 4000 })).toEqual(review)
    expect(done.assistedIds).toEqual([])
  })
  it('accepts reordered historical grade properties and rejects false stored credit', () => {
    const done = reduceExamSession(study(), { type: 'finish' }, { now: 3000 }).attempt
    const reordered = clone(done)
    reordered.grades = reordered.grades.map(g => Object.fromEntries(Object.entries(g).reverse().map(([key, value]) => [key, key === 'outcomes' ? value.map(o => Object.fromEntries(Object.entries(o).reverse())) : value])))
    expect(recordReviewReveal(reordered, done.order[0], { now: 5000 }).grades).toEqual(done.grades)
    const forged = clone(done), g = forged.grades[0], o = g.outcomes[0]
    Object.assign(o, { status: 'correct', attempted: true, earned: 1 }); g.earned = 1
    expect(() => recordReviewReveal(forged, done.order[0], { now: 5000 })).toThrow()
  })
  it('blocks named review routes and expired Mock review, and releases only after finish', () => {
    const expired = act(mock(), { type: 'tick' }, 6001000)
    expect(accessDecision({ sessions: { mock: expired } }, { name: 'review-history' }).allowed).toBe(false)
    const pointer = reduceExamSession(expired, { type: 'finish' }, { now: 6001000 }).session
    expect(accessDecision({ sessions: [pointer] }, { name: 'review-history' }).allowed).toBe(true)
    expect(accessDecision({ sessions: [expired] }, { name: 'lab', params: { labId: 'existing' } }).allowed).toBe(true)
  })
  it('keeps ticks on break monotonic and refuses resume at the deadline', () => {
    const paused = act(mock(), { type: 'break' }, 2000)
    expect(presentSession(paused, { now: 1000 })).toMatchObject({ status: 'break', remainingMs: 5999000 })
    expect(() => act(paused, { type: 'resumeBreak' }, 6001000)).toThrow()
    expect(presentSession(paused, { now: 6001000 })).toMatchObject({ status: 'expired', remainingMs: 0, editable: false, feedback: null, questions: [] })
    expect(paused.status).toBe('break')
  })
  it('permits an all-seen break to resume into section continuation', () => {
    let s = mock()
    for (const id of s.sections[0].questionIds.slice(1)) s = act(s, { type: 'visit', questionId: id })
    s = act(act(s, { type: 'break' }), { type: 'resumeBreak' })
    expect(() => answer(s)).toThrow()
    expect(act(s, { type: 'sealSection' }).cursor.sectionIndex).toBe(1)
  })
  it('blocks Study and answer-review routes while any unfinished Mock exists', () => {
    const s = mock(), savedStudy = { ...study(), id: '00000000-0000-4000-8000-000000000003' }, snapshot = { sessions: [savedStudy, s], attempts: [] }
    for (const to of [{ path: '/exam/results/old' }, { path: '/review' }, { path: `/exam/session/${savedStudy.id}`, params: { sessionId: savedStudy.id } }]) {
      expect(accessDecision(snapshot, to)).toMatchObject({ allowed: false, redirect: `/exam/session/${s.id}` })
    }
    expect(accessDecision(snapshot, { path: '/' }).allowed).toBe(true)
    expect(accessDecision(snapshot, { path: `/exam/session/${s.id}` }).allowed).toBe(true)
  })
  it('rejects unknown actions, invalid time and edits outside accessible items', () => {
    const s = mock()
    expect(() => act(s, { type: 'unknown' })).toThrow()
    expect(() => act(s, { type: 'tick' }, NaN)).toThrow()
    expect(() => act(s, { type: 'tick', unexpected: true })).toThrow()
    expect(() => act(s, { type: 'answer', questionId: s.sections[1].questionIds[0], answer: {} })).toThrow()
  })
})
