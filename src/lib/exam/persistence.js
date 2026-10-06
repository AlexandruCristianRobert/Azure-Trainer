import { ExamError, EXAM_LIMITS, byteLength, finiteJson, record, integer, uuid, requireExam, validateSession, validateNote } from './contracts.js'
import { reduceExamSession, recordReviewReveal } from './session.js'
import { validateBackup, mergeBackup, validateRepositorySnapshot, validatePreferences, equalExamData, backupConflicts } from './backup.js'

const stores = ['sessions', 'attempts', 'notes', 'meta']
const collections = stores.slice(0, 3)
const copy = value => structuredClone(value)
const empty = () => ({ version: 1, revision: 0, sessions: [], attempts: [], notes: [], preferences: { practiceGoal: 80 } })
const fail = (message, code) => { throw new ExamError(message, code) }
const storageError = cause => cause instanceof ExamError ? cause : new ExamError(cause?.message || 'Exam storage is unavailable', 'STORAGE_FAILED')
const counts = snapshot => Object.fromEntries(collections.map(store => [store, snapshot[store].length]))
function impact(snapshot, id) {
  uuid(id)
  const attempt = snapshot.attempts.find(a => a.id === id)
  if (!attempt) fail('Attempt was not found', 'NOT_FOUND')
  return { revision: snapshot.revision, attemptId: id,
    sessionIds: snapshot.sessions.filter(s => s.status === 'finished' && s.attemptId === id).map(s => s.id),
    noteIds: snapshot.notes.filter(n => n.target.kind === 'attempt' && n.target.id === id).map(n => n.id),
    questionIds: [...attempt.order], familyIds: [...new Set(attempt.questions.map(q => q.familyId))],
    conceptIds: [...new Set(attempt.questions.flatMap(q => q.components.map(c => c.conceptId)))] }
}
export function createExamRepository({ indexedDB = globalThis.indexedDB, dbName = 'azure-trainer-exam', dataByteLimit = EXAM_LIMITS.dataBytes } = {}) {
  integer(dataByteLimit, 1, EXAM_LIMITS.dataBytes)
  requireExam(typeof dbName === 'string' && dbName.length > 0, 'A database name is required')
  let opening = null, database = null, closed = false
  function open() {
    if (closed) return Promise.reject(new ExamError('Exam repository is closed', 'STORAGE_FAILED'))
    if (opening) return opening
    opening = new Promise((resolve, reject) => {
      let request, failed = false
      const rejectOpen = cause => { failed = true; reject(storageError(cause)) }
      try {
        if (!indexedDB || typeof indexedDB.open !== 'function') fail('IndexedDB is unavailable', 'STORAGE_FAILED')
        request = indexedDB.open(dbName, 1)
      } catch (error) { rejectOpen(error); return }
      request.onupgradeneeded = () => {
        try {
          const db = request.result
          for (const store of collections) db.createObjectStore(store, { keyPath: 'id' })
          db.createObjectStore('meta', { keyPath: 'key' }).put({ key: 'state', version: 1, revision: 0, preferences: { practiceGoal: 80 } })
        } catch (error) { request.transaction.abort(); rejectOpen(error) }
      }
      request.onerror = () => rejectOpen(request.error)
      request.onblocked = () => rejectOpen(new ExamError('Exam storage upgrade is blocked by another tab', 'STORAGE_FAILED'))
      request.onsuccess = () => {
        if (closed || failed) { request.result.close(); rejectOpen(new ExamError('Exam repository is closed or blocked', 'STORAGE_FAILED')); return }
        database = request.result
        database.onversionchange = () => { database.close(); closed = true }
        resolve(database)
      }
    })
    return opening
  }
  async function transaction(change, expectedRevision) {
    if (change) integer(expectedRevision)
    const db = await open()
    return new Promise((resolve, reject) => {
      let tx, cause, saved, remaining = stores.length
      const rows = {}
      try { tx = db.transaction(stores, change ? 'readwrite' : 'readonly') } catch (error) { reject(storageError(error)); return }
      tx.oncomplete = () => resolve(saved)
      tx.onabort = () => reject(cause instanceof ExamError ? cause : new ExamError(cause?.message || tx.error?.message || 'Exam transaction aborted', 'STORAGE_FAILED'))
      tx.onerror = event => { cause ??= event.target.error }
      const abort = error => { cause = error; tx.abort() }
      for (const store of stores) {
        const request = tx.objectStore(store).getAll()
        request.onsuccess = () => {
          rows[store] = request.result
          if (--remaining) return
          try {
            requireExam(rows.meta.length === 1, 'Exam metadata is missing or corrupt')
            const meta = rows.meta[0]
            finiteJson(meta); record(meta, ['key', 'version', 'revision', 'preferences']); requireExam(meta.key === 'state', 'Unknown exam metadata')
            const current = validateRepositorySnapshot({ version: meta.version, revision: meta.revision, sessions: rows.sessions, attempts: rows.attempts, notes: rows.notes, preferences: meta.preferences }, { dataByteLimit })
            if (!change) { saved = current; return }
            if (current.revision !== expectedRevision) fail('Exam data changed in another tab; reload before retrying', 'REVISION_CONFLICT')
            const outcome = change(copy(current))
            const projected = validateRepositorySnapshot(outcome.snapshot, { dataByteLimit })
            // A replayed finish/import is a true no-op, preserving revision and evidence.
            if (!equalExamData(projected, current)) {
              projected.revision = integer(current.revision + 1)
              validateRepositorySnapshot(projected, { dataByteLimit })
              for (const store of collections) {
                const objectStore = tx.objectStore(store)
                for (const prior of current[store]) if (!projected[store].some(v => v.id === prior.id)) objectStore.delete(prior.id)
                for (const value of projected[store]) {
                  const prior = current[store].find(v => v.id === value.id)
                  if (!prior || !equalExamData(prior, value)) objectStore.put(value)
                }
              }
              tx.objectStore('meta').put({ key: 'state', version: 1, revision: projected.revision, preferences: projected.preferences })
            }
            saved = outcome.result ? outcome.result(projected) : projected
          } catch (error) { abort(error) }
        }
      }
    })
  }
  const load = () => transaction()
  return {
    load,
    async start(session, { expectedRevision } = {}) {
      validateSession(session)
      requireExam(session.status === 'active' && session.revision === 1, 'Only a new active session can be started')
      const incoming = copy(session)
      return transaction(snapshot => {
        if (snapshot.sessions.some(s => s.id === incoming.id) || snapshot.attempts.some(a => a.id === incoming.id || a.sessionId === incoming.id)) fail('Session identifier already exists', 'RECORD_CONFLICT')
        if (snapshot.sessions.some(s => s.mode === incoming.mode && s.status !== 'finished')) fail('Finish the active session in this mode first', 'MODE_CONFLICT')
        snapshot.sessions.push(incoming)
        return { snapshot }
      }, expectedRevision)
    },
    async dispatch(id, action, { expectedRevision, now } = {}) {
      uuid(id); integer(now); finiteJson(action, 65536)
      const intent = copy(action)
      return transaction(snapshot => {
        const index = snapshot.sessions.findIndex(s => s.id === id)
        if (index < 0) fail('Session was not found', 'NOT_FOUND')
        const session = snapshot.sessions[index]
        if (intent?.type === 'reviewReveal') {
          record(intent, ['type', 'questionId'])
          requireExam(session.status === 'finished', 'Only a completed attempt can be reviewed')
          if (snapshot.sessions.some(s => s.mode === 'mock' && s.status !== 'finished')) fail('Finish the active Mock before reviewing answers', 'MOCK_ACTIVE')
          const attemptIndex = snapshot.attempts.findIndex(a => a.id === session.attemptId)
          snapshot.attempts[attemptIndex] = recordReviewReveal(snapshot.attempts[attemptIndex], intent.questionId, { now })
        } else {
          // Study feedback also requires the same transaction-time Mock guard.
          if (session.mode === 'study' && ['reveal', 'submitQuestion'].includes(intent?.type) && snapshot.sessions.some(s => s.mode === 'mock' && s.status !== 'finished')) fail('Finish the active Mock before viewing Study feedback', 'MOCK_ACTIVE')
          const reduced = reduceExamSession(session, intent, { now })
          snapshot.sessions[index] = reduced.session
          if (reduced.attempt) {
            requireExam(!snapshot.attempts.some(a => a.id === reduced.attempt.id), 'Attempt identifier already exists')
            snapshot.attempts.push(reduced.attempt)
          }
        }
        return { snapshot, result: saved => {
          const session = saved.sessions.find(s => s.id === id)
          return { snapshot: saved, session, attempt: session.status === 'finished' ? saved.attempts.find(a => a.id === session.attemptId) : null }
        } }
      }, expectedRevision)
    },
    async saveNote(note, { expectedRevision } = {}) {
      validateNote(note)
      const incoming = copy(note)
      return transaction(snapshot => {
        const index = snapshot.notes.findIndex(n => n.id === incoming.id)
        const revision = index < 0 ? 1 : integer(snapshot.notes[index].revision + 1, 1)
        requireExam(incoming.revision === revision, 'Note revision must advance by one')
        if (index < 0) snapshot.notes.push(incoming)
        else { requireExam(incoming.updatedAt >= snapshot.notes[index].updatedAt, 'Note timestamp cannot move backward'); snapshot.notes[index] = incoming }
        return { snapshot }
      }, expectedRevision)
    },
    async savePreferences(value, { expectedRevision } = {}) {
      validatePreferences(value)
      const preferences = copy(value)
      return transaction(snapshot => ({ snapshot: { ...snapshot, preferences } }), expectedRevision)
    },
    async exportBackup() {
      const data = await load()
      return JSON.stringify({ format: 'azure-trainer-exam', version: 1, exportedAt: Date.now(), data })
    },
    async previewImport(text) {
      requireExam(typeof text === 'string', 'Backup input must be text')
      if (byteLength(text) > EXAM_LIMITS.backupBytes) fail('Backup input exceeds its byte limit', 'BACKUP_LIMIT')
      let value
      try { value = JSON.parse(text) } catch { fail('Backup is not valid JSON', 'INVALID_EXAM_DATA') }
      const incoming = validateBackup(value), current = await load()
      return { version: 1, revision: current.revision, current, incoming, ...backupConflicts(current, incoming.data), counts: { current: counts(current), incoming: counts(incoming.data) } }
    },
    async applyImport(preview, { expectedRevision, replaceIds = [] } = {}) {
      finiteJson(preview, EXAM_LIMITS.backupBytes * 2)
      record(preview, ['version', 'revision', 'current', 'incoming', 'conflicts', 'modeConflicts', 'counts'])
      requireExam(preview.version === 1, 'Unsupported preview version'); integer(preview.revision)
      const captured = copy(preview), replacements = copy(finiteJson(replaceIds))
      const incoming = validateBackup(captured.incoming)
      return transaction(snapshot => {
        if (captured.revision !== snapshot.revision || !equalExamData(captured.current, snapshot)) fail('Import preview is stale; preview again', 'REVISION_CONFLICT')
        const expected = backupConflicts(snapshot, incoming.data)
        requireExam(equalExamData(captured.conflicts, expected.conflicts) && equalExamData(captured.modeConflicts, expected.modeConflicts) && equalExamData(captured.counts, { current: counts(snapshot), incoming: counts(incoming.data) }), 'Import preview was modified')
        return { snapshot: mergeBackup(snapshot, incoming.data, { replaceIds: replacements }) }
      }, expectedRevision)
    },
    async previewDeleteAttempt(id) { return impact(await load(), id) },
    async deleteAttempt(id, { expectedRevision } = {}) {
      uuid(id)
      return transaction(snapshot => {
        const removed = impact(snapshot, id)
        snapshot.attempts = snapshot.attempts.filter(a => a.id !== id)
        snapshot.sessions = snapshot.sessions.filter(s => !removed.sessionIds.includes(s.id))
        snapshot.notes = snapshot.notes.filter(n => !removed.noteIds.includes(n.id))
        return { snapshot }
      }, expectedRevision)
    },
    async reset({ expectedRevision } = {}) {
      return transaction(snapshot => ({ snapshot: { ...empty(), revision: snapshot.revision } }), expectedRevision)
    },
    close() { closed = true; database?.close() },
  }
}
