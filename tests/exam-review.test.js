import { beforeAll, describe, expect, it } from 'vitest'
import { LABS } from '../src/data/labs/index.js'
import { attemptFixture, questionFixture, sessionFixture } from './helpers/examFixtures.js'
import { gradeQuestion } from '../src/lib/exam/grading.js'
import { validateReference } from '../src/lib/exam/contracts.js'

const load = async (path) => { try { return await import(path) } catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND' || /Failed to load url/.test(error.message)) return {}; throw error } }
const { computeReview, recommendPractice, conceptPrompt } = await load('../src/lib/exam/review.js')
const { EXAM_CONCEPTS, EXAM_OBJECTIVES, validateLabMappings } = await load('../src/data/exam/index.js')
const { readLabProgress } = await load('../src/lib/exam/labProgress.js')
const conceptId = 'connect.queue-acceptance'
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
// Explicit primary-source fixtures exercise resolution, not editorial certification.
// Content authors review the final source pages and dates before bank publication.
const primaryReferences = [
  ['containers.registry-images', 'azure/container-registry/container-registry-intro'],
  ['containers.registry-tasks', 'azure/container-registry/container-registry-tasks-overview'],
  ['containers.appservice-container', 'azure/app-service/configure-custom-container'],
  ['containers.containerapps-revisions', 'azure/container-apps/revisions'],
  ['containers.containerapps-keda', 'azure/container-apps/scale-app'],
  ['containers.aks-manifests', 'azure/aks/concepts-workloads'],
  ['containers.container-diagnostics', 'azure/aks/monitor-aks'],
  ['data.cosmos-query', 'azure/cosmos-db/nosql/query/getting-started'],
  ['data.cosmos-cost', 'azure/cosmos-db/optimize-cost-reads-writes'],
  ['data.cosmos-vector', 'azure/cosmos-db/nosql/vector-search'],
  ['data.cosmos-change-feed', 'azure/cosmos-db/change-feed-processor'],
  ['data.postgres-query', 'azure/postgresql/flexible-server/connect-python'],
  ['data.postgres-schema', 'azure/postgresql/extensions/concepts-extensions'],
  ['data.postgres-index', 'azure/postgresql/flexible-server/how-to-troubleshoot-and-optimize-query-performance'],
  ['data.postgres-capacity', 'azure/postgresql/flexible-server/concepts-compute'],
  ['data.postgres-rag', 'azure/postgresql/extensions/how-to-use-pgvector'],
  ['data.postgres-connections', 'azure/postgresql/flexible-server/concepts-pgbouncer'],
  ['data.redis-cache', 'azure/azure-cache-for-redis/cache-best-practices-development'],
  ['data.redis-vector', 'azure/redis/tutorials/redis-vector-similarity'],
  ['connect.servicebus', 'azure/service-bus-messaging/message-transfers-locks-settlement'],
  ['connect.eventgrid', 'azure/event-grid/event-filtering'],
  ['connect.functions-api', 'azure/azure-functions/functions-bindings-http-webhook-trigger'],
  ['connect.functions-host', 'azure/azure-functions/functions-host-json'],
  ['secure.vault', 'azure/key-vault/secrets/about-secrets'],
  ['secure.appconfig', 'azure/azure-app-configuration/enable-dynamic-configuration-python'],
  ['secure.otel', 'azure/azure-monitor/app/opentelemetry-overview'],
  ['secure.kql', 'azure/azure-monitor/logs/get-started-queries'],
].map(([objective, path]) => ({ id: `ref-${objective}`, title: objective, url: `https://learn.microsoft.com/en-us/${path}`, reviewedAt: '2026-10-06' }))
function attempt(n, { credit = 1, familyId = `f${n}`, concept = conceptId, objectiveId = 'connect.servicebus', kind, response, at = 2000 + n, revealAt, revision = 1, submitted = true } = {}) {
  const a = structuredClone(attemptFixture({ credit }))
  const q = structuredClone(kind ? questionFixture(kind) : a.questions[0])
  q.familyId = familyId; q.revision = revision; q.objectiveId = objectiveId
  q.components.forEach(c => { c.conceptId = concept })
  a.id = uuid(n); a.sessionId = uuid(n + 1000); a.questions = [q]; a.order = [q.id]
  a.responses = { [q.id]: response ?? a.responses[a.order[0]] ?? {} }
  a.optionOrders = { [q.id]: q.presentation.choices?.map(c => c.id) ?? ['a', 'b', 'c', 'd'] }
  a.finishedAt = at; a.lastObservedAt = Math.max(at, revealAt ?? at)
  a.submittedIds = submitted ? [q.id] : []
  a.exposures = submitted ? [{ questionId: q.id, familyId, event: 'submit', at }] : []
  a.assistedIds = revealAt === undefined ? [] : [q.id]
  if (revealAt !== undefined) a.exposures.push({ questionId: q.id, familyId, event: 'reveal', at: revealAt })
  a.grades = [gradeQuestion(q, a.responses[q.id])]
  return a
}
function active(a, { revealAt, seenAt = 1000, submit = false, answer = {} } = {}) {
  const s = structuredClone(sessionFixture()), q = a.questions[0]
  s.id = a.sessionId; s.questions = [q]; s.order = [q.id]; s.optionOrders = a.optionOrders
  s.sections[0].questionIds = [q.id]; s.lastObservedAt = revealAt ?? 1500; s.seenIds = [q.id]
  s.answers = { [q.id]: answer }; s.assistedIds = revealAt === undefined ? [] : [q.id]
  s.exposures = [{ questionId: q.id, familyId: q.familyId, event: 'seen', at: seenAt }]
  if (revealAt !== undefined) s.exposures.push({ questionId: q.id, familyId: q.familyId, event: 'reveal', at: revealAt })
  s.submittedIds = submit ? [q.id] : []
  if (submit) s.exposures.push({ questionId: q.id, familyId: q.familyId, event: 'submit', at: s.lastObservedAt })
  return s
}
const review = (attempts = [], activeSessions = [], concepts = EXAM_CONCEPTS) => computeReview({ attempts, activeSessions, concepts })
const row = r => [...r.topics, ...r.assessmentNeeded].find(t => t.conceptId === conceptId)
beforeAll(() => {
  for (const fn of [computeReview, recommendPractice, conceptPrompt, validateLabMappings, readLabProgress]) expect(fn).toBeTypeOf('function')
})

describe('independent review evidence', () => {
  it('keeps fewer than three eligible families out of weakness topics', () => {
    const sparse = review([attempt(1, { credit: 0 }), attempt(2, { credit: 0 })])
    expect(sparse.topics).toEqual([])
    expect(row(sparse)).toMatchObject({ sampleCount: 2, status: 'insufficient-evidence', accuracy: 0 })
    expect(row(review([attempt(1, { credit: 0 }), attempt(2, { credit: 0 }), attempt(3)]))).toMatchObject({ sampleCount: 3, status: 'needs-review', accuracy: 1 / 3 })
  })
  it('normalizes multiple components to one concept-family contribution', () => {
    const result = row(review([attempt(1, { credit: 0.5 }), attempt(2), attempt(3, { credit: 0 })]))
    expect(result).toMatchObject({ sampleCount: 3, accuracy: 0.5, status: 'needs-review' })
  })
  it('uses at most the latest six independent families with exact threshold boundaries', () => {
    const history = Array.from({ length: 8 }, (_, i) => attempt(i + 1, { credit: i < 2 ? 0 : 1 }))
    expect(row(review(history))).toMatchObject({ sampleCount: 6, accuracy: 1, status: 'stronger-sample' })
    expect(row(review([0, 0, 1, 1, 1].map((credit, i) => attempt(i + 1, { credit }))))).toMatchObject({ accuracy: 0.6, status: 'developing' })
    expect(row(review([0, 1, 1, 1, 1].map((credit, i) => attempt(i + 1, { credit }))))).toMatchObject({ accuracy: 0.8, status: 'stronger-sample' })
  })
  it('excludes an unfinished Study reveal and cannot wash assistance away with a retry', () => {
    const first = attempt(1, { credit: 0, revealAt: 1500 })
    const retry = attempt(2, { familyId: 'f1' })
    expect(row(review([retry], [active(first, { revealAt: 1500 })]))).toMatchObject({ sampleCount: 0 })
    const r = row(review([first, retry]))
    expect(r).toMatchObject({ sampleCount: 0, counts: { assisted: 1, repeat: 1 } })
  })
  it('reports a reveal-only unfinished encounter as assistance without measured credit', () => {
    expect(row(review([], [active(attempt(1), { revealAt: 1500 })]))).toMatchObject({ sampleCount: 0, accuracy: null, counts: { assisted: 1 } })
  })
  it('does not count imported duplicates, revisions or equivalent families as fresh proof', () => {
    const first = attempt(1, { credit: 0 }), imported = { ...structuredClone(first), source: 'imported' }
    const retry = attempt(2, { familyId: 'f1', revision: 2 })
    expect(row(review([first, imported, retry]))).toMatchObject({ sampleCount: 1, accuracy: 0, counts: { repeat: 1 } })
    expect(review([first, imported]).counts.duplicateAttempts).toBe(1)
  })
  it('recomputes frozen answers instead of trusting plausible stored credit', () => {
    const a = attempt(1, { credit: 0 })
    a.grades[0].earned = 1; a.grades[0].outcomes[0].earned = 1; a.grades[0].outcomes[0].status = 'correct'
    expect(row(review([a]))).toMatchObject({ accuracy: 0 })
  })
  it('keeps omissions and incomplete sets separate without claiming a fresh answered exposure', () => {
    const empty = attempt(1, { response: {} }), partial = attempt(2, { familyId: 'f1', kind: 'multiple-response', response: { pick: ['a'] } })
    const valid = attempt(3, { familyId: 'f1' })
    const r = row(review([empty, partial, valid]))
    expect(r).toMatchObject({ sampleCount: 1, accuracy: 1, counts: { omitted: 1, incomplete: 1, repeat: 0 } })
  })
  it('does not treat seen-only encounters as prior knowledge', () => {
    const a = attempt(2)
    expect(row(review([a], [active(attempt(1, { familyId: 'f2' }))]))).toMatchObject({ sampleCount: 1, accuracy: 1 })
  })
  it('preserves an answer before later review reveal and treats simultaneous cross-record reveal conservatively', () => {
    expect(row(review([attempt(1, { revealAt: 3000 })]))).toMatchObject({ sampleCount: 1, accuracy: 1 })
    const a = attempt(2, { at: 2000 })
    expect(row(review([a], [active(attempt(1, { familyId: 'f2' }), { revealAt: 2000 })]))).toMatchObject({ sampleCount: 0 })
  })
  it('respects same-record exposure ordering at the same timestamp', () => {
    const a = attempt(1, { at: 2000, revealAt: 2000 })
    expect(row(review([a])).sampleCount).toBe(1)
    a.exposures.reverse()
    expect(row(review([a])).sampleCount).toBe(0)
  })
  it('confidence remains a separate count and never changes earned credit', () => {
    const a = attempt(1, { credit: 0 }); a.confidence[a.order[0]] = 'high'
    expect(row(review([a]))).toMatchObject({ accuracy: 0, counts: { confidence: { high: 1, low: 0, medium: 0, unset: 0 } } })
  })
  it('reserves active answered drafts from their possible start without inventing an answer timestamp', () => {
    const draft = active(attempt(1, { familyId: 'f2' }), { answer: { pick: 'a' } })
    draft.lastObservedAt = 9000
    expect(row(review([attempt(2)], [draft])).sampleCount).toBe(0)
    expect(row(review([attempt(1, { submitted: false })])).sampleCount).toBe(1)
    expect(row(review([attempt(1, { submitted: false, at: 3000 }), attempt(2, { familyId: 'f1', at: 2000 })])).sampleCount).toBe(0)
  })
  it('excludes overlapping unknown draft timing for separate questions in one family within an Attempt', () => {
    const a = attempt(1, { submitted: false }), first = a.questions[0], second = { ...structuredClone(first), id: 'second-question' }
    a.questions.push(second); a.order.push(second.id); a.settings.actualSize = 2
    a.optionOrders[second.id] = ['a', 'b', 'c', 'd']; a.responses[second.id] = { pick: 'a' }
    a.grades.push(gradeQuestion(second, a.responses[second.id]))
    expect(row(review([a]))).toMatchObject({ sampleCount: 0, counts: { uncertain: 2, repeat: 0 } })
  })
  it('sorts by accuracy, wrong families, latest error, then stable concept identity', () => {
    const concepts = [conceptId, 'data.redis-cache']
    const history = concepts.flatMap((concept, c) => [0, 0, 1].map((credit, i) => attempt(10 * c + i + 1, { credit, concept, objectiveId: c ? 'data.redis-cache' : 'connect.servicebus', at: 2000 + c * 100 + i })))
    history.slice(3).forEach(a => { a.questions[0].domain = 'data' })
    expect(review(history).topics.map(t => t.conceptId)).toEqual(['data.redis-cache', conceptId])
  })
  it('leaves unknown historical concepts and objectives visible but unmapped', () => {
    const r = review([attempt(1, { concept: 'old.concept', objectiveId: 'old.objective' }), attempt(2, { objectiveId: 'old.objective' })])
    const rows = r.assessmentNeeded.filter(t => !t.mapped)
    expect(rows).toHaveLength(2)
    expect(rows.every(t => t.labIds.length === 0 && t.referenceIds.length === 0 && t.title.startsWith('Unmapped'))).toBe(true)
  })
  it('is deterministic under history reordering and does not mutate its inputs', () => {
    const history = [attempt(1, { credit: 0 }), attempt(2), attempt(3)]
    const before = structuredClone(history)
    expect(review(history)).toEqual(review([...history].reverse()))
    expect(history).toEqual(before)
  })
})

describe('authored guidance and read-only Lab links', () => {
  it('covers all objective keys and rejects stale Lab or Task mappings', () => {
    expect(EXAM_OBJECTIVES.map(o => o.id)).toEqual([
      'containers.registry-images', 'containers.registry-tasks', 'containers.appservice-container', 'containers.containerapps-revisions', 'containers.containerapps-keda', 'containers.aks-manifests', 'containers.container-diagnostics',
      'data.cosmos-query', 'data.cosmos-cost', 'data.cosmos-vector', 'data.cosmos-change-feed', 'data.postgres-query', 'data.postgres-schema', 'data.postgres-index', 'data.postgres-capacity', 'data.postgres-rag', 'data.postgres-connections', 'data.redis-cache', 'data.redis-vector',
      'connect.servicebus', 'connect.eventgrid', 'connect.functions-api', 'connect.functions-host', 'secure.vault', 'secure.appconfig', 'secure.otel', 'secure.kql',
    ])
    expect(validateLabMappings(EXAM_CONCEPTS, LABS)).toBe(EXAM_CONCEPTS)
    const c = structuredClone(EXAM_CONCEPTS[0]); c.labIds = ['nonexistent']
    expect(() => validateLabMappings([c], LABS)).toThrow()
    c.labIds = ['aca-deploy-guided']; c.taskIds = [{ labId: c.labIds[0], taskId: 'nonexistent' }]
    expect(() => validateLabMappings([c], LABS)).toThrow()
    for (const objective of ['containers.registry-tasks', 'containers.appservice-container']) {
      const c = EXAM_CONCEPTS.find(c => c.objectiveId === objective)
      expect(c.labIds).toEqual([]); expect(c.advice).toMatch(/documentation-only/i)
    }
  })
  it('reads status and summary getters into detached Lab context when no result getter is available', () => {
    const summary = { tasksDone: 2, total: 4, completedAt: null }
    const progress = Object.freeze({ labStatus: () => 'in-progress', runSummary: () => summary })
    const result = readLabProgress(progress, ['messaging-send', 'messaging-send'])
    expect(result).toEqual([{ labId: 'messaging-send', status: 'in-progress', tasksDone: 2, total: 4, completedAt: null, latestResult: null }])
    result[0].tasksDone = 4; expect(summary.tasksDone).toBe(2)
  })
  it('retains completed Lab assistance context in recommendations without changing exam evidence', () => {
    const finishedAt = '2026-10-06T12:00:00.000Z'
    const result = Object.freeze({ id: 'lab-result-one', labId: 'messaging-send', attemptId: 'lab-attempt-one', tasksDone: 4, total: 4, hintsUsed: 2, solutionsUsed: 1, durationMs: 60000, finishedAt, sandbox: { privateDraft: 'do not project' } })
    const progress = Object.freeze({ labStatus: () => 'completed', runSummary: () => ({ tasksDone: 4, total: 4, completedAt: finishedAt }), latestResult: () => result })
    const labProgress = readLabProgress(progress, ['messaging-send'])
    expect(labProgress).toEqual([{ labId: 'messaging-send', status: 'completed', tasksDone: 4, total: 4, completedAt: finishedAt,
      latestResult: { id: 'lab-result-one', finishedAt, hintsUsed: 2, solutionsUsed: 1 } }])
    const measured = review([attempt(1, { credit: 0 }), attempt(2, { credit: 0 }), attempt(3)]), before = structuredClone(measured)
    const recommendation = recommendPractice(measured, { bank: { questions: [], references: primaryReferences, groups: [] }, labProgress, notes: [], now: 5000 }).find(r => r.conceptId === conceptId)
    expect(recommendation.labs[0].progress.latestResult).toEqual({ id: 'lab-result-one', finishedAt, hintsUsed: 2, solutionsUsed: 1 })
    recommendation.labs[0].progress.latestResult.hintsUsed = 10
    expect(labProgress[0].latestResult.hintsUsed).toBe(2)
    labProgress[0].latestResult.solutionsUsed = 10
    expect(result.solutionsUsed).toBe(1)
    expect(measured).toEqual(before)
    expect(row(measured)).toMatchObject({ sampleCount: 3, accuracy: 1 / 3, status: 'needs-review' })
  })
  it('distinguishes missing results and unknown legacy Lab assistance from explicit zero usage', () => {
    const progress = { labStatus: () => 'completed', runSummary: () => null, latestResult: () => null }
    expect(readLabProgress(progress, ['messaging-send'])[0].latestResult).toBeNull()
    progress.latestResult = () => ({ id: 'legacy-result', finishedAt: '2026-10-06T12:00:00Z' })
    expect(readLabProgress(progress, ['messaging-send'])[0].latestResult).toEqual({ id: 'legacy-result', finishedAt: '2026-10-06T12:00:00Z', hintsUsed: null, solutionsUsed: null })
    progress.latestResult = () => ({ hintsUsed: 0, solutionsUsed: 0 })
    expect(readLabProgress(progress, ['messaging-send'])[0].latestResult).toEqual({ id: null, finishedAt: null, hintsUsed: 0, solutionsUsed: 0 })
  })
  it('rejects malformed supplied Lab assistance counts and nonprimitive or oversized result identifiers', () => {
    const progress = { labStatus: () => 'completed', runSummary: () => null }
    for (const result of [{ hintsUsed: -1 }, { solutionsUsed: 0.5 }, { hintsUsed: NaN }, { hintsUsed: Number.MAX_SAFE_INTEGER + 1 }, { id: {} }, { finishedAt: {} }, { id: 'x'.repeat(1025) }, { finishedAt: 'x'.repeat(129) }]) {
      expect(() => readLabProgress({ ...progress, latestResult: () => result }, ['messaging-send'])).toThrow()
    }
  })
  it('prefers unseen targeted families and reports exhaustion without manufacturing progress', () => {
    const history = [attempt(1, { credit: 0 }), attempt(2, { credit: 0 }), attempt(3)]
    const r = review(history)
    const q = structuredClone(history[0].questions[0]); q.id = 'fresh-item'; q.familyId = 'fresh-family'
    const bank = { version: 1, revision: 1, questions: [...history[0].questions, q], groups: [], references: history[0].references }
    const rec = recommendPractice(r, { bank, labProgress: [], notes: [], now: 5000 }).find(x => x.conceptId === conceptId)
    expect(rec).toMatchObject({ questionIds: ['fresh-item'], freshFamilyCount: 1, exhausted: false })
    bank.questions.pop()
    expect(recommendPractice(r, { bank, labProgress: [], notes: [], now: 5000 }).find(x => x.conceptId === conceptId)).toMatchObject({ questionIds: [], freshFamilyCount: 0, exhausted: true })
  })
  it('snoozes only until the explicit time while reviewed flags and Lab completion leave evidence unchanged', () => {
    const r = review([attempt(1, { credit: 0 })]), before = structuredClone(r)
    const note = { version: 1, id: uuid(99), revision: 1, target: { kind: 'concept', id: conceptId }, text: 'private note', status: 'snoozed', updatedAt: 3000, snoozedUntil: 6000 }
    const options = { bank: { questions: [], references: [], groups: [] }, labProgress: [{ labId: 'messaging-send', status: 'completed', tasksDone: 4, total: 4, completedAt: 'date' }], notes: [note], now: 5999 }
    expect(recommendPractice(r, options).some(x => x.conceptId === conceptId)).toBe(false)
    expect(recommendPractice(r, { ...options, now: 6000 }).some(x => x.conceptId === conceptId)).toBe(true)
    note.status = 'reviewed'; note.snoozedUntil = null
    expect(recommendPractice(r, options).some(x => x.conceptId === conceptId)).toBe(true)
    expect(r).toEqual(before)
    expect(() => recommendPractice(r, { ...options, now: NaN })).toThrow()
  })
  it('builds copyable prompts only from the canonical authored concept', () => {
    const c = EXAM_CONCEPTS.find(c => c.id === conceptId)
    const prompt = conceptPrompt({ ...c, title: 'PRIVATE ANSWER', advice: 'PRIVATE NOTE', responses: 'SECRET' })
    expect(prompt).toContain(c.title)
    expect(prompt).not.toMatch(/PRIVATE|SECRET/)
    expect(() => conceptPrompt({ id: 'old.concept' })).toThrow()
  })
  it('resolves every authored concept reference against an explicit primary catalog', () => {
    primaryReferences.forEach(validateReference)
    const recs = recommendPractice(review(), { bank: { questions: [], groups: [], references: primaryReferences }, labProgress: [], notes: [], now: 5000 })
    expect(recs).toHaveLength(27)
    expect(recs.every(r => r.references.length > 0 && r.missingReferenceIds.length === 0)).toBe(true)
    expect(recs.every(r => r.reason === 'assessment-needed' && r.exhausted)).toBe(true)
  })
  it('does not recommend any variant of a merely seen family', () => {
    const a = attempt(1), q = structuredClone(a.questions[0]); q.id = 'unseen-variant'
    const r = review([], [active(a)])
    const rec = recommendPractice(r, { bank: { questions: [q], groups: [], references: primaryReferences }, labProgress: [], notes: [], now: 5000 }).find(r => r.conceptId === conceptId)
    expect(rec.questionIds).toEqual([])
    expect(row(r).sampleCount).toBe(0)
  })
  it('never awards either of two simultaneous cross-record answers and rejects conflicting duplicate IDs', () => {
    const a = attempt(1, { at: 2000 }), b = attempt(2, { familyId: 'f1', at: 2000 })
    expect(row(review([a, b])).sampleCount).toBe(0)
    expect(review([a, b])).toEqual(review([b, a]))
    b.id = a.id
    expect(() => review([a, b])).toThrow(/Conflicting/)
  })
})
