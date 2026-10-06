export const SESSION_FIXTURE_ID = '00000000-0000-4000-8000-000000000001'
const ATTEMPT_ID = '00000000-0000-4000-8000-000000000002'
const kinds = ['single-choice', 'multiple-response', 'build-list', 'matching', 'dropdown', 'statement-grid', 'hot-area', 'active-screen']
const choices = () => ['a', 'b', 'c', 'd'].map((id) => ({ id, label: `Choice ${id}` }))
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export function questionFixture(kind = 'single-choice', overrides = {}) {
  const set = ['multiple-response', 'hot-area'].includes(kind)
  const multi = ['build-list', 'matching', 'dropdown', 'statement-grid', 'active-screen'].includes(kind)
  const candidates = kind === 'statement-grid' ? [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }] : choices()
  const components = (multi ? ['first', 'second'] : ['pick']).map((id, i) => ({
    id, conceptId: 'concept-one', points: 1, input: set ? 'set' : 'one',
    requiredCount: set ? 2 : null, candidateIds: candidates.map((c) => c.id), expected: set ? ['a', 'b'] : candidates[i].id,
  }))
  const slots = components.map((c) => ({ componentId: c.id, label: c.id }))
  const presentation = {
    'single-choice': { choices: choices() },
    'multiple-response': { choices: choices() },
    'build-list': { candidates: choices(), slots },
    matching: { candidates: choices(), targets: slots, allowReuse: false },
    dropdown: { candidates: choices(), segments: [{ type: 'text', text: 'Configure ' }, ...slots.map((s) => ({ type: 'slot', ...s }))] },
    'statement-grid': { choices: candidates, rows: slots },
    'hot-area': { label: 'Architecture', regions: choices().map((c, i) => ({ ...c, x: i / 4, y: 0, width: 0.2, height: 0.5 })) },
    'active-screen': { title: 'Settings', candidates: choices(), fields: slots },
  }[kind]
  const explanation = multi ? { components: components.map((c) => ({ componentId: c.id, text: 'Use the required setting.', candidates: candidates.map((v) => ({ candidateId: v.id, text: `Reason for ${v.id}.` })) })) } : 'A is required; B is appropriate where multiple selections are requested; C and D violate the constraints.'
  return freeze({ id: `q-${kind}`, revision: 1, familyId: `family-${kind}`, kind, domain: 'connect', objectiveId: 'connect.messaging', difficulty: 'medium', stem: 'Select the configuration that meets the requirements.', artifacts: [], presentation, components, groupId: null, explanation, referenceIds: ['ref-one'], csharp: null, ...overrides })
}
export function correctAnswer(q) { return Object.fromEntries(q.components.map((c) => [c.id, structuredClone(c.expected)])) }
export function bankFixture() {
  return freeze({ version: 1, revision: 1, questions: kinds.map((k) => questionFixture(k)), groups: [], references: [{ id: 'ref-one', title: 'Messaging', url: 'https://learn.microsoft.com/en-us/azure/service-bus-messaging/service-bus-messaging-overview', reviewedAt: '2026-10-06' }] })
}
export function sessionFixture() {
  const bank = bankFixture(), questions = [bank.questions[0]]
  return freeze({ version: 1, id: SESSION_FIXTURE_ID, revision: 1, mode: 'study', status: 'active', bankRevision: 1,
    settings: { requestedSize: 5, actualSize: 1, durationMinutes: null, practiceGoal: 80, domains: ['containers', 'data', 'connect', 'secure'], kinds, conceptIds: [], seed: 123 },
    createdAt: 1000, lastObservedAt: 1000, deadlineAt: null, questions, references: bank.references, groups: [], order: [questions[0].id], optionOrders: { [questions[0].id]: ['a', 'b', 'c', 'd'] },
    sections: [{ id: 'standalone', kind: 'standalone', questionIds: [questions[0].id], sealed: false }], cursor: { sectionIndex: 0, questionIndex: 0 },
    seenIds: [], sealedIds: [], answers: {}, submittedIds: [], flags: [], assistedIds: [], confidence: {}, exposures: [], resultId: null })
}
export function attemptFixture(overrides = {}) {
  const { familyId, credit = 1, ...recordOverrides } = overrides
  if (![0, 0.5, 1].includes(credit)) throw new RangeError('Fixture credit supports only 0, 0.5 and 1')
  const session = sessionFixture()
  const q = questionFixture(credit === 0.5 ? 'matching' : 'single-choice', familyId ? { familyId } : {})
  const response = credit === 0.5 ? { first: 'a', second: 'd' } : { pick: credit === 1 ? 'a' : 'd' }
  const outcomes = q.components.map((c) => ({ componentId: c.id, conceptId: c.conceptId, earned: response[c.id] === c.expected ? 1 : 0, possible: 1, status: response[c.id] === c.expected ? 'correct' : 'wrong', attempted: true }))
  return freeze({ version: 1, id: ATTEMPT_ID, sessionId: session.id, mode: 'study', createdAt: 1000, finishedAt: 2000, lastObservedAt: recordOverrides.finishedAt ?? 2000, bankRevision: 1,
    settings: session.settings, questions: [q], references: session.references, groups: [], order: [q.id], optionOrders: { [q.id]: ['a', 'b', 'c', 'd'] },
    responses: { [q.id]: response }, submittedIds: [q.id], assistedIds: [], confidence: {}, exposures: [{ questionId: q.id, familyId: q.familyId, event: 'submit', at: 2000 }], submissionReason: 'manual',
    grades: [{ questionId: q.id, outcomes, earned: outcomes.reduce((sum, o) => sum + o.earned, 0), possible: outcomes.length }], source: 'local', ...recordOverrides })
}
