import { beforeAll, describe, expect, it, vi } from 'vitest'
import { questionFixture, bankFixture, sessionFixture, attemptFixture, correctAnswer } from './helpers/examFixtures.js'

// An absent implementation is an assertion failure, never a collection failure.
const modules = import.meta.glob(['../src/lib/exam/contracts.js', '../src/lib/exam/question.js', '../src/lib/exam/grading.js'])
const api = Object.assign({}, ...await Promise.all(Object.values(modules).map((load) => load())))
beforeAll(() => {
  for (const name of ['ExamError', 'validateQuestion', 'validateQuestionView', 'validateAnswer', 'validateSession', 'validateAttempt', 'validateNote', 'validateReference', 'gradeQuestion', 'gradeAttempt', 'publicQuestion', 'applyAnswerEdit']) expect(api[name], `Missing contract export: ${name}`).toBeTypeOf('function')
})
function call(name, ...args) { expect(api[name], `Missing contract export: ${name}`).toBeTypeOf('function'); return api[name](...args) }
const kinds = ['single-choice', 'multiple-response', 'build-list', 'matching', 'dropdown', 'statement-grid', 'hot-area', 'active-screen']
const copy = (v) => structuredClone(v)

describe('eight authored scoring contracts', () => {
  it.each(kinds)('%s grades stable IDs, missing answers and safe public edits', (kind) => {
    const q = questionFixture(kind), expectedPoints = ['single-choice', 'multiple-response', 'hot-area'].includes(kind) ? 1 : 2
    expect(call('validateQuestion', q)).toBe(q)
    expect(call('gradeQuestion', q, correctAnswer(q))).toMatchObject({ questionId: q.id, earned: expectedPoints, possible: expectedPoints })
    expect(call('gradeQuestion', q, {}).outcomes).toEqual(q.components.map((c) => ({ componentId: c.id, conceptId: 'concept-one', earned: 0, possible: 1, status: 'unanswered', attempted: false })))
    const view = call('publicQuestion', q)
    expect(view.components[0]).not.toHaveProperty('expected')
    for (const key of ['explanation', 'referenceIds', 'csharp']) expect(view).not.toHaveProperty(key)
    expect(call('validateQuestionView', view)).toBe(view)
    const c = q.components[0], value = c.input === 'set' ? ['a'] : c.candidateIds[0]
    expect(call('applyAnswerEdit', view, {}, { type: 'set', componentId: c.id, value })).toEqual({ [c.id]: value })
    expect(() => call('gradeQuestion', view, {})).toThrow()
  })
  it('distinguishes incomplete fixed sets, exact wrong sets and empty omissions', () => {
    const q = questionFixture('multiple-response')
    expect(call('gradeQuestion', q, { pick: ['a'] }).outcomes[0]).toMatchObject({ status: 'incomplete', attempted: false, earned: 0 })
    expect(call('gradeQuestion', q, { pick: ['c', 'd'] }).outcomes[0]).toMatchObject({ status: 'wrong', attempted: true, earned: 0 })
    expect(call('gradeQuestion', q, { pick: [] }).outcomes[0].status).toBe('unanswered')
    expect(call('gradeQuestion', q, { pick: ['a', 'b', 'c', 'd'] }).earned).toBe(0)
    const all = copy(q); all.components[0].requiredCount = null
    expect(call('gradeQuestion', all, { pick: ['a', 'b', 'c', 'd'] }).outcomes[0]).toMatchObject({ status: 'wrong', attempted: true })
  })
  it('keeps declaration order and grades partial positions with shuffled display and answer keys', () => {
    const q = copy(questionFixture('build-list')); q.presentation.candidates.reverse()
    const grade = call('gradeQuestion', q, { second: 'c', first: 'a' })
    expect(grade).toMatchObject({ earned: 1, possible: 2 })
    expect(grade.outcomes.map((o) => [o.componentId, o.status])).toEqual([['first', 'correct'], ['second', 'wrong']])
    expect(call('gradeQuestion', q, { second: 'b' }).earned).toBe(1)
  })
  it('rejects illegal answers, wrong types and disallowed candidate reuse', () => {
    for (const answer of [{ other: 'a' }, { pick: 'missing' }, { pick: ['a'] }, { pick: null }, { pick: undefined }]) expect(() => call('validateAnswer', questionFixture(), answer)).toThrow()
    expect(() => call('validateAnswer', questionFixture('multiple-response'), { pick: ['a', 'a'] })).toThrow()
    for (const kind of ['matching', 'build-list']) expect(() => call('validateAnswer', questionFixture(kind), { first: 'a', second: 'a' })).toThrow()
    const q = copy(questionFixture('matching')); q.presentation.allowReuse = true
    expect(call('validateAnswer', q, { first: 'a', second: 'a' })).toEqual({ first: 'a', second: 'a' })
  })
  it('edits a copy with toggle, assignment, removal and ordered moves', () => {
    const q = questionFixture('build-list'), draft = { first: 'a', second: 'b' }
    expect(call('applyAnswerEdit', q, draft, { type: 'move', componentId: 'second', toComponentId: 'first' })).toEqual({ first: 'b', second: 'a' })
    expect(draft).toEqual({ first: 'a', second: 'b' })
    expect(call('applyAnswerEdit', q, draft, { type: 'remove', componentId: 'first' })).toEqual({ second: 'b' })
    expect(call('applyAnswerEdit', q, {}, { type: 'assign', componentId: 'first', candidateId: 'c' })).toEqual({ first: 'c' })
    const set = questionFixture('multiple-response')
    expect(call('applyAnswerEdit', set, { pick: ['a'] }, { type: 'toggle', componentId: 'pick', candidateId: 'a' })).toEqual({ pick: [] })
    expect(() => call('applyAnswerEdit', q, {}, { type: 'toggle', componentId: 'first', candidateId: 'a' })).toThrow()
    expect(() => call('applyAnswerEdit', q, {}, { type: 'set', componentId: 'first', value: 'a', unexpected: true })).toThrow()
  })
  it('public and feedback projections deeply detach all nested values', () => {
    const q = questionFixture('matching'), view = call('publicQuestion', q), feedback = call('publicQuestion', q, { feedback: true })
    view.presentation.candidates[0].label = 'Changed'; view.components[0].candidateIds.pop()
    feedback.components[0].expected = 'd'; feedback.explanation.components[0].text = 'Changed'
    expect(q.presentation.candidates[0].label).toBe('Choice a'); expect(q.components[0].candidateIds).toHaveLength(4)
    expect(q.components[0].expected).toBe('a'); expect(q.explanation.components[0].text).toBe('Use the required setting.')
    expect(() => call('publicQuestion', q, { feedback: 'false' })).toThrow(api.ExamError)
  })
  it('treats inherited built-in names as missing answer values and keeps historical breakdowns finite', () => {
    const q = copy(questionFixture()); q.components[0].id = 'toString'
    expect(call('gradeQuestion', q, {}).outcomes[0]).toMatchObject({ status: 'unanswered', attempted: false })
    const set = copy(questionFixture('multiple-response')); set.components[0].id = 'toString'
    expect(call('applyAnswerEdit', set, {}, { type: 'toggle', componentId: 'toString', candidateId: 'a' })).toEqual({ toString: ['a'] })
    const attempt = copy(attemptFixture()); attempt.questions[0].domain = 'toString'
    expect(call('gradeAttempt', attempt).byDomain.toString).toEqual({ earned: 1, possible: 1, percentage: 100 })
    expect(() => call('validateAnswer', null, {})).toThrow(api.ExamError)
  })
})

describe('closed finite data and layout validation', () => {
  it('rejects accessors without invoking them, custom prototypes, dangerous keys and non-JSON values', () => {
    const getter = vi.fn(() => 'hello'), q = copy(questionFixture()); Object.defineProperty(q, 'stem', { enumerable: true, get: getter })
    expect(() => call('validateQuestion', q)).toThrow(); expect(getter).not.toHaveBeenCalled()
    const cycle = copy(questionFixture()); cycle.artifacts.push(cycle)
    const proto = Object.assign(Object.create({ inherited: true }), questionFixture())
    const hidden = copy(questionFixture()); Object.defineProperty(hidden, 'hidden', { value: 1 })
    const symbol = copy(questionFixture()); symbol[Symbol('bad')] = true
    for (const bad of [cycle, proto, hidden, symbol, { ...questionFixture(), stem: () => '' }, { ...questionFixture(), revision: Infinity }, { ...questionFixture(), revision: 1n }, { ...questionFixture(), extra: true }, JSON.parse('{"__proto__":{}}')]) expect(() => call('validateQuestion', bad)).toThrow()
  })
  it('enforces UTF-8 item bytes and bounded components, candidates and nesting', () => {
    expect(() => call('validateQuestion', questionFixture('single-choice', { stem: '😀'.repeat(17000) }))).toThrow()
    const q = copy(questionFixture()); q.components[0].candidateIds = Array.from({ length: 33 }, (_, i) => `candidate-${i}`)
    expect(() => call('validateQuestion', q)).toThrow()
    const nested = copy(questionFixture()); let at = nested; for (let i = 0; i < 30; i++) at = at.next = {}
    expect(() => call('validateQuestion', nested)).toThrow()
    const components = copy(questionFixture('matching')); components.components = Array.from({ length: 13 }, (_, i) => ({ ...components.components[0], id: `component-${i}` }))
    expect(() => call('validateQuestion', components)).toThrow()
  })
  it('checks expected/candidate relations, component-specific reasons and layout bindings', () => {
    const mutations = [
      (q) => { q.components[0].expected = 'z' }, (q) => { q.components[0].candidateIds.push('z') },
      (q) => { q.components[0].points = 2 }, (q) => { q.components[1].id = 'first' },
      (q) => { q.presentation.targets[0].componentId = 'missing' }, (q) => { q.presentation.targets.reverse() },
      (q) => { q.explanation = 'No component-specific explanations' }, (q) => { q.explanation.components[0].candidates.pop() },
      (q) => { q.presentation.candidates[1].id = 'a' },
    ]
    for (const mutate of mutations) { const q = copy(questionFixture('matching')); mutate(q); expect(() => call('validateQuestion', q)).toThrow() }
    const hot = copy(questionFixture('hot-area')); hot.presentation.regions[0].width = 1.2
    expect(() => call('validateQuestion', hot)).toThrow()
    const dropdown = copy(questionFixture('dropdown')); dropdown.presentation.segments.push({ type: 'html', html: '<script />' })
    expect(() => call('validateQuestion', dropdown)).toThrow()
    const set = copy(questionFixture('multiple-response')); set.components[0].requiredCount = 1
    expect(() => call('validateQuestion', set)).toThrow()
  })
  it('preserves hostile-looking plain text while closing executable and URL fields', () => {
    const q = questionFixture('single-choice', { stem: '<img src=x onerror=alert(1)>', csharp: 'Console.WriteLine("example");' })
    expect(call('publicQuestion', q).stem).toBe('<img src=x onerror=alert(1)>')
    const ref = bankFixture().references[0]
    for (const url of ['https://redis.io/docs/', 'https://github.com/Azure/azure-sdk-for-python/blob/main/README.md']) expect(call('validateReference', { ...ref, url }).url).toBe(url)
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a', 'http://learn.microsoft.com/a', 'https://learn.microsoft.com.evil.test/a', 'https://evil.test/', 'https://github.com/evil/repo', 'https://github.com/Azure/azure-sdk-for-python-evil/a', 'https://user:pass@learn.microsoft.com/a', 'https://learn.microsoft.com:444/a']) expect(() => call('validateReference', { ...ref, url })).toThrow()
  })
  it('rejects non-string reference review dates with ExamError before coercion', () => {
    const ref = bankFixture().references[0]
    for (const reviewedAt of [{ toString: null }, ['2026-10-06'], {}, null, 20261006, true]) {
      expect(() => call('validateReference', { ...ref, reviewedAt })).toThrow(api.ExamError)
    }
    expect(call('validateReference', ref)).toBe(ref)
  })
})

describe('frozen records and recomputed attempt grades', () => {
  it('accepts the fixture session/attempt/note and UUID finished pointer', () => {
    const session = sessionFixture(), attempt = attemptFixture()
    expect(call('validateSession', session)).toBe(session); expect(call('validateAttempt', attempt)).toBe(attempt)
    const pointer = { version: 1, id: session.id, revision: 2, mode: 'study', status: 'finished', attemptId: attempt.id }
    expect(call('validateSession', pointer)).toBe(pointer)
    const note = { version: 1, id: '00000000-0000-4000-8000-000000000003', revision: 1, target: { kind: 'concept', id: 'concept-one' }, text: '<b>My note</b>', status: 'pending', snoozedUntil: null, updatedAt: 2000 }
    expect(call('validateNote', note)).toBe(note)
    expect(() => call('validateNote', { ...note, id: 'note-one' })).toThrow()
    expect(() => call('validateNote', { ...note, text: '😀'.repeat(2049) })).toThrow()
    expect(() => call('validateNote', { ...note, target: { kind: 'attempt', id: 'not-a-uuid' } })).toThrow()
    expect(() => call('validateNote', { ...note, text: 'a'.repeat(8100) })).toThrow(api.ExamError)
  })
  it('validates snapshot permutations, answer IDs, settings, times and closed record fields', () => {
    const mutations = [
      (s) => { s.id = 'session-one' }, (s) => { s.settings.extra = true }, (s) => { s.optionOrders[s.order[0]] = ['a', 'b'] },
      (s) => { s.optionOrders.unknown = [] }, (s) => { s.answers.unknown = {} }, (s) => { s.order.push(s.order[0]) },
      (s) => { s.cursor.questionIndex = 4 }, (s) => { s.sealedIds = ['missing'] }, (s) => { s.deadlineAt = 5000 },
      (s) => { s.lastObservedAt = 999 }, (s) => { s.settings.actualSize = 2 }, (s) => { s.exposures = [{ questionId: s.order[0], familyId: 'wrong-family', event: 'submit', at: 1000 }] },
    ]
    for (const mutate of mutations) { const s = copy(sessionFixture()); mutate(s); expect(() => call('validateSession', s)).toThrow() }
    expect(() => call('validateAttempt', { ...attemptFixture(), earned: 99 })).toThrow()
  })
  it('accepts a timed forty-question snapshot and rejects adaptive Mock settings', () => {
    const s = copy(sessionFixture()); s.mode = 'mock'; s.settings.requestedSize = s.settings.actualSize = 40; s.settings.durationMinutes = 60; s.deadlineAt = 3601000
    s.questions = Array.from({ length: 40 }, (_, i) => questionFixture('single-choice', { id: `q-${i}`, familyId: `family-${i}` }))
    s.order = s.questions.map((q) => q.id); s.optionOrders = Object.fromEntries(s.order.map((id) => [id, ['d', 'c', 'b', 'a']])); s.sections[0].questionIds = s.order
    expect(call('validateSession', s)).toBe(s)
    for (const settings of [{ ...s.settings, domains: ['connect'] }, { ...s.settings, kinds: ['single-choice'] }, { ...s.settings, conceptIds: ['concept-one'] }, { ...s.settings, seed: -1 }, { ...s.settings, seed: 4294967296 }]) expect(() => call('validateSession', { ...s, settings })).toThrow(api.ExamError)
    expect(() => call('validateSession', { ...s, deadlineAt: 3601001 })).toThrow(api.ExamError)
    const a = { ...attemptFixture(), mode: 'mock', settings: s.settings, questions: s.questions, order: s.order, optionOrders: s.optionOrders, submittedIds: [], exposures: [], responses: {}, finishedAt: s.deadlineAt, lastObservedAt: s.deadlineAt, submissionReason: 'deadline', grades: s.questions.map((q) => call('gradeQuestion', q, {})) }
    expect(call('validateAttempt', a)).toBe(a)
    expect(() => call('validateAttempt', { ...a, submissionReason: 'completed' })).toThrow(api.ExamError)
  })
  it('rejects invalid closed grades without trusting or mutating caller values', () => {
    for (const mutate of [(a) => { a.grades[0].possible = 2 }, (a) => { a.grades[0].outcomes[0].componentId = 'missing' }, (a) => { a.grades[0].outcomes[0].attempted = false }, (a) => { a.grades[0].outcomes[0].extra = true }]) {
      const a = copy(attemptFixture()); mutate(a); expect(() => call('validateAttempt', a)).toThrow(api.ExamError)
    }
    const a = attemptFixture(); call('gradeAttempt', a); expect(a.grades[0].earned).toBe(1)
  })
  it('mirrors reveal and submit exposure sets and reserves completed reason for Study', () => {
    const a = copy(attemptFixture()), q = a.questions[0]
    expect(() => call('validateAttempt', { ...a, submittedIds: [] })).toThrow(api.ExamError)
    expect(() => call('validateAttempt', { ...a, assistedIds: [q.id] })).toThrow(api.ExamError)
    const reveal = { questionId: q.id, familyId: q.familyId, event: 'reveal', at: 1500 }
    expect(() => call('validateAttempt', { ...a, exposures: [...a.exposures, reveal] })).toThrow(api.ExamError)
    expect(call('validateAttempt', { ...a, assistedIds: [q.id], exposures: [...a.exposures, reveal] }).assistedIds).toEqual([q.id])
    const s = copy(sessionFixture()); s.submittedIds = [...s.order]
    expect(() => call('validateSession', s)).toThrow(api.ExamError)
  })
  it('constructs actual multipart half-credit fixtures and refuses unsupported helper fractions', () => {
    const a = attemptFixture({ credit: 0.5, familyId: 'half-credit-family' })
    expect(a).not.toHaveProperty('credit'); expect(a).not.toHaveProperty('familyId'); expect(a.questions[0].familyId).toBe('half-credit-family')
    expect(call('validateAttempt', a)).toBe(a)
    expect(call('gradeAttempt', a)).toMatchObject({ earned: 1, possible: 2, percentage: 50 })
    expect(a.grades[0].outcomes.map((o) => o.status)).toEqual(['correct', 'wrong'])
    expect(() => attemptFixture({ credit: 0.3 })).toThrow()
  })
  it('records post-finish reveals without changing frozen answers or the original finish time', () => {
    const a = copy(attemptFixture()), q = a.questions[0]
    const revealed = { ...a, lastObservedAt: 3000, assistedIds: [q.id], exposures: [...a.exposures, { questionId: q.id, familyId: q.familyId, event: 'reveal', at: 2500 }] }
    expect(call('validateAttempt', revealed)).toBe(revealed)
    expect(revealed.finishedAt).toBe(2000); expect(revealed.responses).toEqual(a.responses); expect(revealed.grades).toEqual(a.grades)
    expect(() => call('validateAttempt', { ...revealed, lastObservedAt: 1999 })).toThrow(api.ExamError)
    expect(() => call('validateAttempt', { ...revealed, lastObservedAt: 2400 })).toThrow(api.ExamError)
    expect(() => call('validateAttempt', { ...revealed, assistedIds: [] })).toThrow(api.ExamError)
  })
  it('recomputes rather than trusting caller grade credit and accepts unmapped historical taxonomy', () => {
    const attempt = copy(attemptFixture({ credit: 0, familyId: 'another-family' }))
    attempt.grades[0].earned = 1; Object.assign(attempt.grades[0].outcomes[0], { earned: 1, status: 'correct' })
    const summary = call('gradeAttempt', attempt)
    expect(summary).toMatchObject({ earned: 0, possible: 1, percentage: 0, byDomain: { connect: { earned: 0, possible: 1, percentage: 0 } }, byKind: { 'single-choice': { earned: 0, possible: 1, percentage: 0 } } })
    expect(summary.grades[0].outcomes[0].status).toBe('wrong')
    const q = copy(questionFixture()); q.domain = 'retired-domain'; q.objectiveId = 'retired.objective'
    expect(() => call('validateQuestion', q)).toThrow(); expect(call('validateQuestion', q, { historical: true })).toBe(q)
    expect(() => call('validateAttempt', { ...attempt, grades: [] })).toThrow()
  })
})
