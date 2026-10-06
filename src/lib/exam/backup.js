import { ExamError, EXAM_LIMITS, finiteJson, record, integer, requireExam, validateSession, validateAttempt, validateNote } from './contracts.js'
import { gradeAttempt } from './grading.js'

const stores = ['sessions', 'attempts', 'notes']
const copy = value => structuredClone(value)
// Object field order is not part of a backup's meaning; array order is.
const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v)
export const equalExamData = (a, b) => canonical(a) === canonical(b)
export function validatePreferences(value) {
  finiteJson(value, 128); record(value, ['practiceGoal']); integer(value.practiceGoal, 1, 100)
  return value
}
const fail = (message, code) => { throw new ExamError(message, code) }
function records(values, validate, deduplicate) {
  requireExam(Array.isArray(values), 'Expected a record collection')
  const found = new Map()
  for (const value of values) {
    validate(value)
    if (found.has(value.id)) requireExam(deduplicate && equalExamData(found.get(value.id), value), 'Conflicting or repeated record identifier')
    else found.set(value.id, copy(value))
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
}
export function validateRepositorySnapshot(value, { imported = false, dataByteLimit = EXAM_LIMITS.dataBytes } = {}) {
  finiteJson(value, EXAM_LIMITS.backupBytes)
  record(value, ['version', 'revision', 'sessions', 'attempts', 'notes', 'preferences'])
  requireExam(value.version === 1, 'Unsupported exam snapshot version'); integer(value.revision)
  validatePreferences(value.preferences)
  const result = { version: 1, revision: value.revision,
    sessions: records(value.sessions, validateSession, imported),
    attempts: records(value.attempts, validateAttempt, imported),
    notes: records(value.notes, validateNote, imported), preferences: copy(value.preferences) }
  for (const attempt of result.attempts) {
    const grades = gradeAttempt(attempt).grades
    if (!imported) requireExam(equalExamData(attempt.grades, grades), 'Stored grades disagree with frozen keys and responses')
    attempt.grades = grades
    if (imported) attempt.source = 'imported'
  }
  if (result.attempts.length > EXAM_LIMITS.attempts) fail('Completed attempt limit reached; export and explicitly delete history first', 'ATTEMPT_LIMIT')
  requireExam(new Set(result.attempts.map(a => a.sessionId)).size === result.attempts.length, 'Multiple attempts cannot represent the same session')
  for (const session of result.sessions) {
    if (session.status !== 'finished') {
      requireExam(!result.attempts.some(a => a.sessionId === session.id || a.id === session.id), 'An unfinished session already has a completed attempt')
      continue
    }
    const attempt = result.attempts.find(a => a.id === session.attemptId)
    requireExam(attempt && attempt.sessionId === session.id && attempt.mode === session.mode, 'Finished pointer must reference its own stored attempt')
  }
  for (const attempt of result.attempts) requireExam(result.sessions.some(s => s.status === 'finished' && s.id === attempt.sessionId && s.attemptId === attempt.id && s.mode === attempt.mode), 'Every attempt requires its matching finished pointer')
  for (const mode of ['study', 'mock']) {
    if (result.sessions.filter(s => s.mode === mode && s.status !== 'finished').length > 1) fail(`More than one active ${mode} session`, 'MODE_CONFLICT')
  }
  for (const note of result.notes) if (note.target.kind === 'attempt') requireExam(result.attempts.some(a => a.id === note.target.id), 'Attempt note target is missing')
  if (new TextEncoder().encode(JSON.stringify(result)).length > dataByteLimit) fail('Exam data exceeds its storage byte limit', 'DATA_LIMIT')
  return result
}
export function validateBackup(value) {
  finiteJson(value, EXAM_LIMITS.backupBytes)
  record(value, ['format', 'version', 'exportedAt', 'data'])
  requireExam(value.format === 'azure-trainer-exam' && value.version === 1, 'Unsupported exam backup format or version')
  integer(value.exportedAt)
  return { format: value.format, version: 1, exportedAt: value.exportedAt, data: validateRepositorySnapshot(value.data, { imported: true }) }
}
function equivalent(store, current, incoming) {
  return equalExamData(store === 'attempts' ? { ...current, source: 'imported' } : current, incoming)
}
export function backupConflicts(current, incoming) {
  const conflicts = []
  for (const store of stores) for (const value of incoming[store]) {
    const existing = current[store].find(v => v.id === value.id)
    if (existing && !equivalent(store, existing, value)) conflicts.push({ key: `${store}:${value.id}`, store, id: value.id })
  }
  if (!equalExamData(current.preferences, incoming.preferences)) conflicts.push({ key: 'meta:preferences', store: 'meta', id: 'preferences' })
  const modeConflicts = []
  const projectedSessions = new Map(current.sessions.map(s => [s.id, s]))
  for (const session of incoming.sessions) projectedSessions.set(session.id, session)
  for (const mode of ['study', 'mock']) {
    const active = [...projectedSessions.values()].filter(s => s.mode === mode && s.status !== 'finished').map(s => s.id)
    const currentIds = current.sessions.filter(s => s.mode === mode && s.status !== 'finished' && active.includes(s.id)).map(s => s.id)
    const incomingIds = incoming.sessions.filter(s => s.mode === mode && s.status !== 'finished').map(s => s.id)
    // Assume explicit approval of every differing same-ID record. A completed
    // incoming pointer can then release that mode; unrelated active IDs cannot.
    if (active.length > 1) modeConflicts.push({ mode, currentIds, incomingIds })
  }
  return { conflicts, modeConflicts }
}
export function mergeBackup(current, incoming, { replaceIds = [] } = {}) {
  const base = validateRepositorySnapshot(current), added = validateRepositorySnapshot(incoming, { imported: true })
  finiteJson(replaceIds, EXAM_LIMITS.backupBytes)
  requireExam(Array.isArray(replaceIds) && replaceIds.every(key => typeof key === 'string') && new Set(replaceIds).size === replaceIds.length, 'Replacement keys must be unique store-qualified strings')
  const { conflicts } = backupConflicts(base, added)
  requireExam(replaceIds.every(key => conflicts.some(c => c.key === key)), 'Replacement key is not a conflicting record')
  if (conflicts.some(c => !replaceIds.includes(c.key))) fail('Every differing record requires an explicit replacement decision', 'IMPORT_CONFLICT')
  const result = copy(base)
  for (const store of stores) {
    const values = new Map(result[store].map(v => [v.id, v]))
    for (const value of added[store]) if (!values.has(value.id) || replaceIds.includes(`${store}:${value.id}`)) values.set(value.id, value)
    result[store] = [...values.values()]
  }
  if (replaceIds.includes('meta:preferences')) result.preferences = added.preferences
  // Validate after all replacements, including pointer/note dependencies and active modes.
  return validateRepositorySnapshot(result)
}
