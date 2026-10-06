import { validateQuestion, validateAnswer, candidateIds } from './question.js'

export const EXAM_VERSION = 1
export const EXAM_DOMAINS = Object.freeze(['containers', 'data', 'connect', 'secure'])
export const EXAM_KINDS = Object.freeze(['single-choice', 'multiple-response', 'build-list', 'matching', 'dropdown', 'statement-grid', 'hot-area', 'active-screen'])
export const EXAM_LIMITS = Object.freeze({ items: 60, components: 12, candidates: 32, questionBytes: 65536, caseBytes: 32768, noteBytes: 8192, attempts: 200, dataBytes: 25165824, backupBytes: 33554432, depth: 24 })
export class ExamError extends Error {
  constructor(message, code = 'INVALID_EXAM_DATA') { super(message); this.name = 'ExamError'; this.code = code }
}
export function requireExam(condition, message) { if (!condition) throw new ExamError(message) }
const forbidden = new Set(['__proto__', 'prototype', 'constructor'])
const encoder = new TextEncoder()
export function byteLength(text) { return encoder.encode(text).length }

// Inspect descriptors before reading values or serializing: getters must never run.
// A running byte/node budget bounds traversal before the final exact JSON check.
export function finiteJson(value, limit = EXAM_LIMITS.dataBytes) {
  const ancestors = new Set()
  let budget = 0
  function visit(node, depth) {
    requireExam(depth <= EXAM_LIMITS.depth, 'JSON nesting exceeds the limit')
    budget += 1
    requireExam(budget <= limit, 'JSON data exceeds the byte limit')
    if (node === null || typeof node === 'boolean') return
    if (typeof node === 'number') { requireExam(Number.isFinite(node), 'Expected a finite number'); return }
    if (typeof node === 'string') { budget += byteLength(node); requireExam(budget <= limit, 'JSON data exceeds the byte limit'); return }
    requireExam(typeof node === 'object', 'Expected finite plain JSON data')
    requireExam(!ancestors.has(node), 'Cyclic JSON data')
    const array = Array.isArray(node), prototype = Object.getPrototypeOf(node)
    requireExam(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, 'Unexpected object prototype')
    const keys = Reflect.ownKeys(node)
    requireExam(keys.length <= limit, 'Too many JSON entries')
    if (array) requireExam(keys.length === node.length + 1, 'Sparse arrays and array properties are not allowed')
    ancestors.add(node)
    for (const key of keys) {
      requireExam(typeof key === 'string' && !forbidden.has(key), 'Unsafe JSON key')
      const descriptor = Object.getOwnPropertyDescriptor(node, key)
      requireExam(Object.hasOwn(descriptor, 'value'), 'Accessors are not allowed')
      if (array && key === 'length') continue
      requireExam(descriptor.enumerable, 'Hidden JSON properties are not allowed')
      if (array) requireExam(/^(0|[1-9]\d*)$/.test(key) && Number(key) < node.length, 'Invalid array property')
      budget += byteLength(key)
      visit(descriptor.value, depth + 1)
    }
    ancestors.delete(node)
  }
  visit(value, 0)
  requireExam(byteLength(JSON.stringify(value)) <= limit, 'JSON data exceeds the byte limit')
  return value
}
export function record(value, keys) {
  requireExam(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected a record')
  const actual = Object.keys(value)
  requireExam(actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key)), `Expected closed fields: ${keys.join(', ')}`)
  return value
}
export function text(value, max = EXAM_LIMITS.questionBytes, empty = false) {
  requireExam(typeof value === 'string' && (empty || value.trim().length > 0) && byteLength(value) <= max, 'Invalid bounded text')
  return value
}
export function stableId(value) {
  requireExam(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !forbidden.has(value), 'Invalid stable identifier')
  return value
}
export function uuid(value) {
  requireExam(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value), 'Expected a UUID')
  return value
}
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) { requireExam(Number.isSafeInteger(value) && value >= min && value <= max, 'Invalid bounded integer'); return value }
export function member(value, choices) { requireExam(choices.includes(value), 'Unexpected enum value'); return value }
export function arrayOf(value, max, check, min = 0) { requireExam(Array.isArray(value) && value.length >= min && value.length <= max, 'Invalid bounded array'); value.forEach(check); return value }
export function uniqueIds(value, max = EXAM_LIMITS.candidates, allowed = null, min = 0) {
  arrayOf(value, max, stableId, min)
  requireExam(new Set(value).size === value.length, 'Duplicate identifiers')
  if (allowed) requireExam(value.every((id) => allowed.includes(id)), 'Unknown identifier')
  return value
}
export function sameIds(actual, expected) { requireExam(actual.length === expected.length && actual.every((id) => expected.includes(id)), 'Identifiers must be an exact permutation') }
export function uniqueRecords(values) { requireExam(new Set(values.map((v) => v.id)).size === values.length, 'Duplicate record identifiers') }

export function validateReference(ref) {
  finiteJson(ref, EXAM_LIMITS.questionBytes)
  record(ref, ['id', 'title', 'url', 'reviewedAt']); stableId(ref.id); text(ref.title, 1024); text(ref.url, 4096)
  requireExam(typeof ref.reviewedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ref.reviewedAt) && !Number.isNaN(Date.parse(ref.reviewedAt)) && new Date(ref.reviewedAt).toISOString().slice(0, 10) === ref.reviewedAt, 'Invalid reference review date')
  let url
  try { url = new URL(ref.url) } catch { throw new ExamError('Invalid reference URL') }
  requireExam(ref.url === ref.url.trim() && !/[\u0000-\u0020\\]/.test(ref.url), 'Invalid reference URL characters')
  requireExam(url.protocol === 'https:' && !url.username && !url.password && !url.port, 'References require HTTPS without credentials or custom ports')
  const hosts = ['learn.microsoft.com', 'opentelemetry.io', 'postgresql.org', 'www.postgresql.org', 'redis.io']
  const repositories = ['Azure/azure-sdk-for-python', 'Azure/azure-rest-api-specs', 'open-telemetry/opentelemetry-python', 'pgvector/pgvector', 'dotnet/docs']
  const github = url.hostname === 'github.com' && repositories.some((repo) => url.pathname === `/${repo}` || url.pathname.startsWith(`/${repo}/`))
  requireExam(hosts.includes(url.hostname) || github, 'Reference source is not approved')
  return ref
}

function settings(value, mode) {
  record(value, ['requestedSize', 'actualSize', 'durationMinutes', 'practiceGoal', 'domains', 'kinds', 'conceptIds', 'seed'])
  member(value.requestedSize, mode === 'mock' ? [40, 50, 60] : [5, 10, 20]); integer(value.actualSize, 1, value.requestedSize)
  if (mode === 'mock') { requireExam(value.actualSize === value.requestedSize, 'Mock size cannot be reduced'); member(value.durationMinutes, [60, 100, 120]) }
  else requireExam(value.durationMinutes === null, 'Study has no countdown')
  integer(value.practiceGoal, 1, 100); uniqueIds(value.domains, 4, EXAM_DOMAINS, 1); uniqueIds(value.kinds, 8, EXAM_KINDS, 1); uniqueIds(value.conceptIds, 720); integer(value.seed, 0, 4294967295)
  if (mode === 'mock') { sameIds(value.domains, EXAM_DOMAINS); sameIds(value.kinds, EXAM_KINDS); requireExam(value.conceptIds.length === 0, 'Mock cannot adapt to concept filters') }
}
function group(value, questions) {
  record(value, ['id', 'kind', 'domain', 'title', 'background', 'questionIds'])
  stableId(value.id); member(value.kind, ['case', 'series']); stableId(value.domain); text(value.title, 1024); text(value.background, EXAM_LIMITS.caseBytes)
  uniqueIds(value.questionIds, EXAM_LIMITS.items, questions.map((q) => q.id), 1)
  requireExam(value.questionIds.every((id) => questions.some((q) => q.id === id && q.groupId === value.id && q.domain === value.domain)), 'Group membership or domain does not match')
}
function snapshot(value) {
  member(value.version, [EXAM_VERSION]); uuid(value.id); member(value.mode, ['study', 'mock']); integer(value.bankRevision, 1)
  settings(value.settings, value.mode)
  arrayOf(value.questions, EXAM_LIMITS.items, (q) => validateQuestion(q, { historical: true }), 1); uniqueRecords(value.questions)
  requireExam(value.questions.length === value.settings.actualSize, 'Actual size must match questions')
  const ids = value.questions.map((q) => q.id)
  uniqueIds(value.order, EXAM_LIMITS.items, ids); sameIds(value.order, ids)
  arrayOf(value.references, EXAM_LIMITS.items * EXAM_LIMITS.candidates, validateReference); uniqueRecords(value.references)
  requireExam(value.questions.every((q) => q.referenceIds.every((id) => value.references.some((r) => r.id === id))), 'Missing question references')
  arrayOf(value.groups, EXAM_LIMITS.items, (g) => group(g, value.questions)); uniqueRecords(value.groups)
  requireExam(value.questions.every((q) => q.groupId === null || value.groups.some((g) => g.id === q.groupId && g.questionIds.includes(q.id))), 'Missing question group')
  record(value.optionOrders, ids)
  for (const q of value.questions) { const options = candidateIds(q); uniqueIds(value.optionOrders[q.id], EXAM_LIMITS.candidates, options); sameIds(value.optionOrders[q.id], options) }
  integer(value.createdAt)
  for (const key of ['submittedIds', 'assistedIds']) uniqueIds(value[key], EXAM_LIMITS.items, ids)
  requireExam(value.confidence && typeof value.confidence === 'object' && !Array.isArray(value.confidence), 'Invalid confidence map')
  for (const [id, confidence] of Object.entries(value.confidence)) { member(id, ids); member(confidence, ['unset', 'low', 'medium', 'high']) }
  arrayOf(value.exposures, EXAM_LIMITS.items * 3, (e) => {
    record(e, ['questionId', 'familyId', 'event', 'at']); member(e.questionId, ids); stableId(e.familyId); member(e.event, ['seen', 'reveal', 'submit']); integer(e.at, value.createdAt)
    requireExam(value.questions.find((q) => q.id === e.questionId).familyId === e.familyId, 'Exposure family mismatch')
  })
  requireExam(new Set(value.exposures.map((e) => `${e.questionId}/${e.event}`)).size === value.exposures.length, 'Duplicate exposure event')
  sameIds(value.assistedIds, value.exposures.filter((e) => e.event === 'reveal').map((e) => e.questionId))
  sameIds(value.submittedIds, value.exposures.filter((e) => e.event === 'submit').map((e) => e.questionId))
}
function responses(value, questions) {
  requireExam(value && typeof value === 'object' && !Array.isArray(value), 'Invalid answer map')
  for (const [id, answer] of Object.entries(value)) { const q = questions.find((item) => item.id === id); requireExam(q, 'Unknown response question'); validateAnswer(q, answer) }
}

export function validateSession(value) {
  finiteJson(value)
  if (value?.status === 'finished') {
    record(value, ['version', 'id', 'revision', 'mode', 'status', 'attemptId']); member(value.version, [EXAM_VERSION]); uuid(value.id); integer(value.revision, 1); member(value.mode, ['study', 'mock']); uuid(value.attemptId)
    return value
  }
  record(value, ['version', 'id', 'revision', 'mode', 'status', 'bankRevision', 'settings', 'createdAt', 'lastObservedAt', 'deadlineAt', 'questions', 'references', 'groups', 'order', 'optionOrders', 'sections', 'cursor', 'seenIds', 'sealedIds', 'answers', 'submittedIds', 'flags', 'assistedIds', 'confidence', 'exposures', 'resultId'])
  snapshot(value); integer(value.revision, 1); member(value.status, ['active', 'break', 'expired']); integer(value.lastObservedAt, value.createdAt)
  if (value.mode === 'study') requireExam(value.deadlineAt === null && value.status === 'active', 'Study must be active without a deadline')
  else { integer(value.deadlineAt, value.createdAt + 1); requireExam(value.deadlineAt === value.createdAt + value.settings.durationMinutes * 60000, 'Deadline must match frozen duration') }
  requireExam(value.resultId === null, 'An active session has no result')
  for (const key of ['seenIds', 'sealedIds', 'flags']) uniqueIds(value[key], EXAM_LIMITS.items, value.order)
  responses(value.answers, value.questions)
  arrayOf(value.sections, EXAM_LIMITS.items, (s) => {
    record(s, ['id', 'kind', 'questionIds', 'sealed']); stableId(s.id); member(s.kind, ['standalone', 'case', 'series']); uniqueIds(s.questionIds, EXAM_LIMITS.items, value.order, 1); requireExam(typeof s.sealed === 'boolean', 'Invalid section seal')
    requireExam(!s.sealed || s.questionIds.every((id) => value.sealedIds.includes(id)), 'Sealed section has unsealed questions')
    requireExam(s.questionIds.every((id) => {
      const q = value.questions.find((item) => item.id === id)
      return s.kind === 'standalone' ? q.groupId === null : value.groups.some((g) => g.id === q.groupId && g.kind === s.kind && g.questionIds.every((qid) => s.questionIds.includes(qid)))
    }), 'Section does not match question groups')
  }, 1); uniqueRecords(value.sections)
  requireExam(JSON.stringify(value.sections.flatMap((s) => s.questionIds)) === JSON.stringify(value.order), 'Sections must partition question order')
  record(value.cursor, ['sectionIndex', 'questionIndex']); integer(value.cursor.sectionIndex, 0, value.sections.length - 1); integer(value.cursor.questionIndex, 0, value.sections[value.cursor.sectionIndex].questionIds.length - 1)
  requireExam(value.exposures.every((e) => e.at <= value.lastObservedAt), 'Exposure exceeds observed time')
  return value
}

function gradeShape(grade, question) {
  record(grade, ['questionId', 'outcomes', 'earned', 'possible']); requireExam(grade.questionId === question.id, 'Grade question mismatch')
  arrayOf(grade.outcomes, EXAM_LIMITS.components, (o, index) => {
    record(o, ['componentId', 'conceptId', 'earned', 'possible', 'status', 'attempted'])
    const c = question.components[index]
    requireExam(c && o.componentId === c.id && o.conceptId === c.conceptId, 'Outcome component mismatch')
    member(o.earned, [0, 1]); member(o.possible, [1]); member(o.status, ['correct', 'wrong', 'unanswered', 'incomplete']); requireExam(typeof o.attempted === 'boolean', 'Invalid attempted status')
    requireExam(o.earned === (o.status === 'correct' ? 1 : 0) && o.attempted === ['correct', 'wrong'].includes(o.status), 'Inconsistent outcome')
  })
  requireExam(grade.outcomes.length === question.components.length && grade.possible === question.components.length && grade.earned === grade.outcomes.reduce((sum, o) => sum + o.earned, 0), 'Inconsistent grade totals')
}
export function validateAttempt(value) {
  finiteJson(value)
  record(value, ['version', 'id', 'sessionId', 'mode', 'createdAt', 'finishedAt', 'lastObservedAt', 'bankRevision', 'settings', 'questions', 'references', 'groups', 'order', 'optionOrders', 'responses', 'submittedIds', 'assistedIds', 'confidence', 'exposures', 'submissionReason', 'grades', 'source'])
  snapshot(value); uuid(value.sessionId); integer(value.finishedAt, value.createdAt); integer(value.lastObservedAt, value.finishedAt); member(value.submissionReason, ['manual', 'deadline', 'completed']); member(value.source, ['local', 'imported'])
  requireExam(value.mode === 'mock' || value.submissionReason !== 'deadline', 'Study cannot expire')
  requireExam(value.mode === 'study' || value.submissionReason !== 'completed', 'Completed reason is reserved for Study')
  requireExam(value.exposures.every((e) => e.at <= value.lastObservedAt), 'Exposure exceeds observed time')
  responses(value.responses, value.questions)
  arrayOf(value.grades, EXAM_LIMITS.items, (g, i) => { const q = value.questions.find((item) => item.id === value.order[i]); requireExam(q, 'Unexpected grade'); gradeShape(g, q) })
  requireExam(value.grades.length === value.order.length, 'Each question needs a grade')
  // Structural only. Repository admission must recompute using gradeAttempt.
  return value
}
export function validateNote(value) {
  finiteJson(value, EXAM_LIMITS.noteBytes)
  record(value, ['version', 'id', 'revision', 'target', 'text', 'status', 'snoozedUntil', 'updatedAt'])
  member(value.version, [EXAM_VERSION]); uuid(value.id); integer(value.revision, 1); record(value.target, ['kind', 'id']); member(value.target.kind, ['concept', 'attempt', 'question'])
  if (value.target.kind === 'attempt') uuid(value.target.id); else stableId(value.target.id)
  text(value.text, EXAM_LIMITS.noteBytes, true); member(value.status, ['pending', 'reviewed', 'snoozed']); integer(value.updatedAt)
  if (value.status === 'snoozed') integer(value.snoozedUntil, value.updatedAt + 1); else requireExam(value.snoozedUntil === null, 'Only snoozed notes have a wake time')
  return value
}
