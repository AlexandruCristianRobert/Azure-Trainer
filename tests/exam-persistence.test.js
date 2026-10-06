import { describe, it, expect } from 'vitest'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createExamRepository } from '../src/lib/exam/persistence.js'
import { validateBackup, mergeBackup } from '../src/lib/exam/backup.js'
import { createExamSession } from '../src/lib/exam/session.js'
import { sessionFixture, attemptFixture, mockBankFixture, SESSION_FIXTURE_ID } from './helpers/examFixtures.js'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const clone = value => structuredClone(value)
const empty = () => ({ version: 1, revision: 0, sessions: [], attempts: [], notes: [], preferences: { practiceGoal: 80 } })
const backup = data => ({ format: 'azure-trainer-exam', version: 1, exportedAt: 3000, data })
const withAttempts = attempts => ({ ...empty(), attempts, sessions: [...new Map(attempts.map(a => [a.sessionId,
  { version: 1, id: a.sessionId, revision: 1, mode: a.mode, status: 'finished', attemptId: a.id }])).values()] })
const note = (n = 3, target = { kind: 'concept', id: 'concept-one' }) => ({ version: 1, id: id(n), revision: 1, target, text: 'Remember the tradeoff.', status: 'pending', snoozedUntil: null, updatedAt: 2000 })
const setup = options => {
  const indexedDB = new IDBFactory()
  return { indexedDB, repo: createExamRepository({ indexedDB, ...options }) }
}
const open = (indexedDB, name, upgrade) => new Promise((resolve, reject) => {
  const r = indexedDB.open(name, 1)
  r.onupgradeneeded = () => upgrade?.(r.result)
  r.onsuccess = () => resolve(r.result)
  r.onerror = () => reject(r.error)
})
const writeRaw = (db, store, value) => new Promise((resolve, reject) => {
  const tx = db.transaction(store, 'readwrite')
  tx.objectStore(store).put(value)
  tx.oncomplete = resolve
  tx.onabort = () => reject(tx.error)
})
async function finished(repo) {
  await repo.start(sessionFixture(), { expectedRevision: 0 })
  await repo.dispatch(SESSION_FIXTURE_ID, { type: 'answer', questionId: 'q-single-choice', answer: { pick: 'a' } }, { expectedRevision: 1, now: 1500 })
  return repo.dispatch(SESSION_FIXTURE_ID, { type: 'finish' }, { expectedRevision: 2, now: 2000 })
}

describe('durable exam repository', () => {
  it('acknowledges committed snapshots that reopen with independent global and session revisions', async () => {
    const { indexedDB, repo } = setup()
    expect(await repo.load()).toEqual(empty())
    await repo.start(sessionFixture(), { expectedRevision: 0 })
    const saved = await repo.savePreferences({ practiceGoal: 85 }, { expectedRevision: 1 })
    expect(saved.revision).toBe(2)
    expect(saved.sessions[0].revision).toBe(1)
    repo.close()
    const reopened = createExamRepository({ indexedDB })
    expect(await reopened.load()).toEqual(saved)
    reopened.close()
  })
  it('serializes competing tab writes and rejects stale revisions without overwriting', async () => {
    const { indexedDB, repo } = setup()
    const second = createExamRepository({ indexedDB })
    const outcomes = await Promise.allSettled([repo.start(sessionFixture(), { expectedRevision: 0 }), second.savePreferences({ practiceGoal: 90 }, { expectedRevision: 0 })])
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.find(r => r.status === 'rejected').reason.code).toBe('REVISION_CONFLICT')
    expect((await repo.load()).revision).toBe(1)
    repo.close(); second.close()
  })
  it('finishes atomically from stored answers and resolves a second finish to one stored result', async () => {
    const { repo } = setup()
    const first = await finished(repo)
    expect(first.attempt.grades[0].earned).toBe(1)
    expect(first.snapshot.attempts).toHaveLength(1)
    expect(first.session).toEqual({ version: 1, id: SESSION_FIXTURE_ID, revision: 3, mode: 'study', status: 'finished', attemptId: SESSION_FIXTURE_ID })
    const again = await repo.dispatch(SESSION_FIXTURE_ID, { type: 'finish' }, { expectedRevision: 3, now: 9000 })
    expect(again.attempt).toEqual(first.attempt)
    expect(again.snapshot.revision).toBe(3)
    repo.close()
  })
  it('rejects actual aborted writes after successful put requests and leaves the prior snapshot', async () => {
    const { repo } = setup()
    await repo.start(sessionFixture(), { expectedRevision: 0 })
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      const request = original.apply(this, args)
      if (this.name === 'attempts') request.addEventListener('success', () => this.transaction.abort())
      return request
    }
    try {
      await expect(repo.dispatch(SESSION_FIXTURE_ID, { type: 'finish' }, { expectedRevision: 1, now: 2000 })).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    } finally { IDBObjectStore.prototype.put = original }
    const after = await repo.load()
    expect(after.revision).toBe(1)
    expect(after.sessions[0].status).toBe('active')
    expect(after.attempts).toEqual([])
    repo.close()
  })
  it('enforces projected byte limits without eviction or partial writes', async () => {
    const { indexedDB, repo } = setup({ dataByteLimit: 500 })
    await expect(repo.start(sessionFixture(), { expectedRevision: 0 })).rejects.toMatchObject({ code: 'DATA_LIMIT' })
    expect(await repo.load()).toEqual(empty())
    repo.close()
    const normal = createExamRepository({ indexedDB })
    expect(await normal.load()).toEqual(empty())
    normal.close()
  })
  it('checks active mode rows and rejects duplicate starts or result-ID reuse', async () => {
    const { repo } = setup()
    await repo.start(sessionFixture(), { expectedRevision: 0 })
    await expect(repo.start({ ...sessionFixture(), id: id(9) }, { expectedRevision: 1 })).rejects.toMatchObject({ code: 'MODE_CONFLICT' })
    await repo.dispatch(SESSION_FIXTURE_ID, { type: 'finish' }, { expectedRevision: 1, now: 2000 })
    await expect(repo.start(sessionFixture(), { expectedRevision: 2 })).rejects.toMatchObject({ code: 'RECORD_CONFLICT' })
    await repo.start({ ...sessionFixture(), id: id(9) }, { expectedRevision: 2 })
    expect((await repo.load()).sessions).toHaveLength(2)
    repo.close()
  })
  it('records review disclosure on stored results only and blocks all unfinished Mock statuses', async () => {
    const { repo } = setup()
    const result = await finished(repo)
    const mock = createExamSession({ id: id(9), bank: mockBankFixture(), mode: 'mock', settings: { size: 40 }, now: 3000 })
    await repo.start(mock, { expectedRevision: 3 })
    const reveal = { type: 'reviewReveal', questionId: 'q-single-choice' }
    for (const [revision, next] of [[4, { type: 'break' }], [5, { type: 'tick' }], [6, { type: 'finish' }]]) {
      await expect(repo.dispatch(SESSION_FIXTURE_ID, reveal, { expectedRevision: revision, now: 7000000 })).rejects.toMatchObject({ code: 'MOCK_ACTIVE' })
      await repo.dispatch(id(9), next, { expectedRevision: revision, now: next.type === 'break' ? 4000 : 7000000 })
    }
    const revealed = await repo.dispatch(SESSION_FIXTURE_ID, reveal, { expectedRevision: 7, now: 8000000 })
    expect(revealed.attempt.grades).toEqual(result.attempt.grades)
    expect(revealed.attempt.responses).toEqual(result.attempt.responses)
    expect(revealed.attempt.finishedAt).toBe(2000)
    expect(revealed.attempt.assistedIds).toEqual(['q-single-choice'])
    expect(revealed.attempt.lastObservedAt).toBe(8000000)
    await expect(repo.dispatch(SESSION_FIXTURE_ID, { ...reveal, attempt: result.attempt }, { expectedRevision: 8, now: 9000000 })).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    repo.close()
  })
  it('validates loaded corruption visibly and never resets it', async () => {
    const { indexedDB, repo } = setup()
    await repo.load()
    const db = await open(indexedDB, 'azure-trainer-exam')
    await writeRaw(db, 'attempts', { id: id(5), grades: [{ earned: 999 }] })
    await expect(repo.load()).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    await expect(repo.load()).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    db.close(); repo.close()
  })
  it('rejects plausible forged stored credit instead of returning or silently repairing it', async () => {
    const { indexedDB, repo } = setup()
    await repo.load()
    const db = await open(indexedDB, 'azure-trainer-exam')
    const forged = clone(attemptFixture())
    forged.responses['q-single-choice'] = { pick: 'd' }
    await writeRaw(db, 'attempts', forged)
    await expect(repo.load()).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    db.close(); repo.close()
  })
  it('rejects unavailable storage without an in-memory success path', async () => {
    const repo = createExamRepository({ indexedDB: null })
    await expect(repo.load()).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    await expect(repo.start(sessionFixture(), { expectedRevision: 0 })).rejects.toMatchObject({ code: 'STORAGE_FAILED' })
    repo.close()
  })
  it('keeps Lab database version, stores and values unchanged through exam reset', async () => {
    const { indexedDB, repo } = setup()
    const lab = await open(indexedDB, 'azure-trainer-behavioral', db => {
      db.createObjectStore('runs', { keyPath: 'labId' })
      db.createObjectStore('results', { keyPath: 'id' })
    })
    await writeRaw(lab, 'runs', { labId: 'sentinel', saved: true })
    await writeRaw(lab, 'results', { id: 'sentinel-result', credit: 1 })
    await finished(repo)
    await repo.reset({ expectedRevision: 3 })
    const request = lab.transaction('runs').objectStore('runs').getAll()
    const values = await new Promise(resolve => { request.onsuccess = () => resolve(request.result) })
    expect(values).toEqual([{ labId: 'sentinel', saved: true }])
    expect(lab.version).toBe(1)
    expect([...lab.objectStoreNames]).toEqual(['results', 'runs'])
    const resultRequest = lab.transaction('results').objectStore('results').getAll()
    const results = await new Promise(resolve => { resultRequest.onsuccess = () => resolve(resultRequest.result) })
    expect(results).toEqual([{ id: 'sentinel-result', credit: 1 }])
    expect((await repo.load()).revision).toBe(4)
    lab.close(); repo.close()
  })
  it('saves bounded notes and previews exact deletion impact before removing result-linked records', async () => {
    const { repo } = setup()
    await finished(repo)
    await repo.saveNote(note(3, { kind: 'attempt', id: SESSION_FIXTURE_ID }), { expectedRevision: 3 })
    await repo.saveNote(note(4), { expectedRevision: 4 })
    const impact = await repo.previewDeleteAttempt(SESSION_FIXTURE_ID)
    expect(impact).toEqual({ revision: 5, attemptId: SESSION_FIXTURE_ID, sessionIds: [SESSION_FIXTURE_ID], noteIds: [id(3)], questionIds: ['q-single-choice'], familyIds: ['family-single-choice'], conceptIds: ['concept-one'] })
    const deleted = await repo.deleteAttempt(SESSION_FIXTURE_ID, { expectedRevision: 5 })
    expect(deleted.attempts).toEqual([])
    expect(deleted.sessions).toEqual([])
    expect(deleted.notes.map(n => n.id)).toEqual([id(4)])
    await expect(repo.saveNote({ ...note(4), text: 'x'.repeat(8192) }, { expectedRevision: 6 })).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    for (const prefs of [{ practiceGoal: NaN }, { practiceGoal: 80, extra: true }, { practiceGoal: 0 }]) await expect(repo.savePreferences(prefs, { expectedRevision: 6 })).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    repo.close()
  })
  it('updates note revisions monotonically and rejects a replay or backward timestamp', async () => {
    const { repo } = setup()
    await repo.saveNote(note(), { expectedRevision: 0 })
    const edited = { ...note(), revision: 2, text: 'Reviewed.', status: 'reviewed', updatedAt: 2500 }
    const saved = await repo.saveNote(edited, { expectedRevision: 1 })
    expect(saved.notes[0]).toEqual(edited)
    await expect(repo.saveNote(edited, { expectedRevision: 2 })).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    await expect(repo.saveNote({ ...edited, revision: 3, updatedAt: 2000 }, { expectedRevision: 2 })).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    repo.close()
  })
})

describe('validated atomic exam backups', () => {
  it('exports the exact envelope and merges identical imported copies once across retries', async () => {
    const { repo } = setup()
    await finished(repo)
    const text = await repo.exportBackup()
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['data', 'exportedAt', 'format', 'version'])
    const { repo: target } = setup()
    const first = await target.applyImport(await target.previewImport(text), { expectedRevision: 0, replaceIds: [] })
    expect(first.attempts[0].source).toBe('imported')
    const preview = await target.previewImport(text)
    expect(preview.conflicts).toEqual([])
    const again = await target.applyImport(preview, { expectedRevision: 1, replaceIds: [] })
    expect(again.attempts).toHaveLength(1)
    expect(again.revision).toBe(1)
    repo.close(); target.close()
  })
  it('validates duplicate contents, recomputes historical keys and preserves unmapped taxonomy', () => {
    const a = clone(attemptFixture())
    a.questions[0].domain = 'retired-domain'
    a.questions[0].objectiveId = 'retired-objective'
    a.responses['q-single-choice'] = { pick: 'd' }
    const result = validateBackup(backup(withAttempts([a, clone(a)])))
    expect(result.data.attempts).toHaveLength(1)
    expect(result.data.attempts[0].grades[0].earned).toBe(0)
    expect(result.data.attempts[0].questions[0].objectiveId).toBe('retired-objective')
    expect(result.data.attempts[0].source).toBe('imported')
    expect(() => validateBackup(backup(withAttempts([a, { ...a, finishedAt: 1999 }])))).toThrow()
    const bad = clone(a); bad.questions[0].components[0].expected = 'outside'
    expect(() => validateBackup(backup(withAttempts([bad])))).toThrow()
  })
  it('reports store-qualified conflicts, requires explicit replacement, and rejects stale previews', async () => {
    const { repo } = setup()
    const original = attemptFixture()
    await repo.applyImport(await repo.previewImport(JSON.stringify(backup(withAttempts([original])))), { expectedRevision: 0, replaceIds: [] })
    const changed = clone(original); changed.responses['q-single-choice'] = { pick: 'd' }
    const preview = await repo.previewImport(JSON.stringify(backup(withAttempts([changed]))))
    expect(preview.conflicts).toEqual([{ key: `attempts:${original.id}`, store: 'attempts', id: original.id }])
    await expect(repo.applyImport(preview, { expectedRevision: 1, replaceIds: [] })).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' })
    await expect(repo.applyImport(preview, { expectedRevision: 1, replaceIds: [original.id] })).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    const saved = await repo.applyImport(preview, { expectedRevision: 1, replaceIds: [`attempts:${original.id}`] })
    expect(saved.attempts[0].grades[0].earned).toBe(0)
    await expect(repo.applyImport(preview, { expectedRevision: 2, replaceIds: [`attempts:${original.id}`] })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    repo.close()
  })
  it('previews competing active sessions and rejects the entire merge without discarding either', async () => {
    const { repo } = setup()
    await repo.start(sessionFixture(), { expectedRevision: 0 })
    const incoming = { ...empty(), sessions: [{ ...sessionFixture(), id: id(8) }], notes: [note()] }
    const preview = await repo.previewImport(JSON.stringify(backup(incoming)))
    expect(preview.modeConflicts).toEqual([{ mode: 'study', currentIds: [SESSION_FIXTURE_ID], incomingIds: [id(8)] }])
    expect(preview.current.sessions).toHaveLength(1)
    expect(preview.incoming.data.sessions).toHaveLength(1)
    await expect(repo.applyImport(preview, { expectedRevision: 1, replaceIds: [] })).rejects.toMatchObject({ code: 'MODE_CONFLICT' })
    expect((await repo.load()).notes).toEqual([])
    repo.close()
  })
  it('does not report a competing mode when an explicitly replaced pointer completes the old session', async () => {
    const { repo } = setup()
    await repo.start(sessionFixture(), { expectedRevision: 0 })
    const { repo: source } = setup()
    await finished(source)
    await source.start({ ...sessionFixture(), id: id(8) }, { expectedRevision: 3 })
    const preview = await repo.previewImport(await source.exportBackup())
    expect(preview.modeConflicts).toEqual([])
    expect(preview.conflicts.map(c => c.key)).toEqual([`sessions:${SESSION_FIXTURE_ID}`])
    const saved = await repo.applyImport(preview, { expectedRevision: 1, replaceIds: [`sessions:${SESSION_FIXTURE_ID}`] })
    expect(saved.sessions.find(s => s.id === SESSION_FIXTURE_ID).status).toBe('finished')
    expect(saved.sessions.find(s => s.id === id(8)).status).toBe('active')
    source.close(); repo.close()
  })
  it('replaces same UUID records independently in their own stores and handles preferences explicitly', async () => {
    const { repo } = setup()
    await finished(repo)
    const incoming = JSON.parse(await repo.exportBackup())
    incoming.data.sessions[0].revision += 1
    incoming.data.attempts[0].responses['q-single-choice'] = { pick: 'd' }
    incoming.data.preferences.practiceGoal = 90
    const preview = await repo.previewImport(JSON.stringify(incoming))
    const replacements = [`sessions:${SESSION_FIXTURE_ID}`, `attempts:${SESSION_FIXTURE_ID}`, 'meta:preferences']
    expect(preview.conflicts.map(c => c.key)).toEqual(replacements)
    await expect(repo.applyImport(preview, { expectedRevision: 3, replaceIds: replacements.slice(0, 1) })).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' })
    const saved = await repo.applyImport(preview, { expectedRevision: 3, replaceIds: replacements })
    expect(saved.sessions[0].revision).toBe(4)
    expect(saved.attempts[0].grades[0].earned).toBe(0)
    expect(saved.preferences.practiceGoal).toBe(90)
    repo.close()
  })
  it('rejects the entire imported projection at an injected byte limit and keeps prior notes', async () => {
    const { repo } = setup({ dataByteLimit: 600 })
    await repo.saveNote(note(), { expectedRevision: 0 })
    const preview = await repo.previewImport(JSON.stringify(backup(withAttempts([attemptFixture()]))))
    await expect(repo.applyImport(preview, { expectedRevision: 1, replaceIds: [] })).rejects.toMatchObject({ code: 'DATA_LIMIT' })
    const saved = await repo.load()
    expect(saved.revision).toBe(1)
    expect(saved.notes).toHaveLength(1)
    expect(saved.attempts).toEqual([])
    repo.close()
  })
  it('rejects malformed input, dangerous keys, broken pointers and oversized backup text before writes', async () => {
    const { repo } = setup()
    for (const text of ['{bad', '{"__proto__":{}}', JSON.stringify({ version: 1, attempts: [{ grades: [{ earned: 999 }] }] }), ' '.repeat(33554433)]) {
      await expect(repo.previewImport(text)).rejects.toMatchObject({ name: 'ExamError' })
    }
    const pointer = { version: 1, id: id(4), revision: 1, mode: 'study', status: 'finished', attemptId: id(4) }
    await expect(repo.previewImport(JSON.stringify(backup({ ...empty(), sessions: [pointer] })))).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    expect(await repo.load()).toEqual(empty())
    repo.close()
  })
  it('pure merges validate the whole projected snapshot and reject excess history', () => {
    const current = withAttempts(Array.from({ length: 200 }, (_, i) => attemptFixture({ id: id(i + 10), sessionId: id(i + 10) })))
    const incoming = withAttempts([attemptFixture({ id: id(999), sessionId: id(999) })])
    expect(() => mergeBackup(current, incoming, { replaceIds: [] })).toThrow()
    const result = mergeBackup(empty(), withAttempts([attemptFixture()]), { replaceIds: [] })
    expect(result.attempts).toHaveLength(1)
    expect(result.attempts[0].source).toBe('imported')
  })
  it('requires reciprocal historical pointers and reviews the historical session UUID', async () => {
    const { repo } = setup()
    const attempt = attemptFixture()
    await expect(repo.previewImport(JSON.stringify(backup({ ...empty(), attempts: [attempt] })))).rejects.toMatchObject({ code: 'INVALID_EXAM_DATA' })
    const preview = await repo.previewImport(JSON.stringify(backup(withAttempts([attempt]))))
    await repo.applyImport(preview, { expectedRevision: 0, replaceIds: [] })
    const reviewed = await repo.dispatch(attempt.sessionId, { type: 'reviewReveal', questionId: 'q-single-choice' }, { expectedRevision: 1, now: 5000 })
    expect(reviewed.attempt.id).toBe(attempt.id)
    expect(reviewed.session.id).toBe(attempt.sessionId)
    expect(reviewed.attempt.assistedIds).toEqual(['q-single-choice'])
    repo.close()
  })
})
