import { computed, reactive } from 'vue'
import { defineStore } from 'pinia'
import { createExamRepository } from '../lib/exam/persistence.js'
import { accessDecision, createExamSession, presentSession } from '../lib/exam/session.js'
import { EXAM_LIMITS, ExamError, byteLength, finiteJson, integer, validateNote } from '../lib/exam/contracts.js'
import { publicQuestion, validateAnswer } from '../lib/exam/question.js'
import { loadExamBank } from '../data/exam/index.js'

const clone = value => JSON.parse(JSON.stringify(value))
const RECOVERY_BYTES = EXAM_LIMITS.backupBytes * 3
const RECOVERY_METADATA_BYTES = 65536
function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
function ordered(question, order) {
  const q = clone(question), p = q.presentation
  // Geometry and component/slot/target order are authored, never permuted.
  for (const key of ['choices', 'candidates']) if (p[key]) p[key] = order.map(id => p[key].find(c => c.id === id)).filter(Boolean)
  return q
}

export function createExamStore({ repository = createExamRepository(), bankLoader = loadExamBank, now = Date.now, newId = () => crypto.randomUUID(), recoveryByteLimit = RECOVERY_BYTES } = {}) {
  integer(recoveryByteLimit, RECOVERY_METADATA_BYTES + 1, RECOVERY_BYTES)
  const state = reactive({ ready: false, loading: false, saving: false, error: null, snapshot: null, selectedId: null, observedAt: integer(now()), bank: null, pendingAnswers: {}, pendingCount: 0 })
  let hydration = null, bankPromise = null, running = null
  let disclosureEpoch = 0
  const reviewGrants = new Set()
  const revokeReviewGrants = () => { disclosureEpoch += 1; reviewGrants.clear() }
  const queue = [], drafts = new Map()
  const clock = () => (state.observedAt = Math.max(state.observedAt, integer(now())))
  const commit = snapshot => { state.snapshot = freeze(snapshot) }
  const current = () => (state.selectedId === null ? state.snapshot?.sessions.find(s => s.status !== 'finished') : state.snapshot?.sessions.find(s => s.id === state.selectedId)) ?? null
  const errorObject = error => ({ code: String(error.code ?? 'STORAGE_FAILED').slice(0, 128), message: String(error.message ?? error).slice(0, 4096) })
  const fail = error => { revokeReviewGrants(); state.error = errorObject(error); return error }
  const isFrozenFailure = error => ['STORAGE_FAILED', 'REVISION_CONFLICT', 'DATA_LIMIT', 'ATTEMPT_LIMIT'].includes(error.code)
  function draftKey(sessionId, questionId) { return `${sessionId}/${questionId}` }
  function widgetValue(questionId, sessionId = current()?.id) {
    const key = draftKey(sessionId, questionId)
    if (!drafts.has(key)) {
      const saved = state.snapshot?.sessions.find(s => s.id === sessionId)?.answers?.[questionId] ?? {}
      drafts.set(key, reactive(clone(saved)))
    }
    return drafts.get(key)
  }
  function updateDraft(entry) {
    if (entry.kind !== 'dispatch' || entry.action.type !== 'answer') return
    const value = widgetValue(entry.action.questionId, entry.sessionId)
    for (const key of Object.keys(value)) delete value[key]
    Object.assign(value, clone(entry.action.answer))
    state.pendingAnswers[draftKey(entry.sessionId, entry.action.questionId)] = value
  }
  async function execute(entry) {
    const options = { expectedRevision: state.snapshot.revision }
    if (entry.kind === 'dispatch') return repository.dispatch(entry.sessionId, entry.action, { ...options, now: entry.observedAt })
    if (entry.kind === 'start') return repository.start(entry.session, options)
    if (entry.kind === 'note') {
      const previous = state.snapshot.notes.find(n => n.id === entry.note.id)
      return repository.saveNote({ ...entry.note, revision: (previous?.revision ?? 0) + 1, updatedAt: Math.max(previous?.updatedAt ?? 0, entry.note.updatedAt) }, options)
    }
    if (entry.kind === 'preferences') return repository.savePreferences(entry.preferences, options)
    if (entry.kind === 'import') return repository.applyImport(entry.preview, { ...options, replaceIds: entry.replaceIds })
    if (entry.kind === 'delete') return repository.deleteAttempt(entry.attemptId, options)
    if (entry.kind === 'reset') return repository.reset(options)
    throw new ExamError('Unknown write intent')
  }
  function pump() {
    if (running) return running
    running = (async () => {
      state.saving = true
      while (queue.length && !state.error) {
        const entry = queue[0]
        try {
          const result = await execute(entry)
          commit(result.snapshot ?? result); queue.shift(); state.pendingCount = queue.length
          if (['import', 'delete', 'reset'].includes(entry.kind)) {
            revokeReviewGrants()
            drafts.clear(); state.pendingAnswers = {}
            queue.forEach(updateDraft)
          }
          if (entry.kind === 'start') state.selectedId = entry.session.id
          if (entry.kind === 'dispatch' && entry.action.type === 'answer') {
            const key = draftKey(entry.sessionId, entry.action.questionId)
            if (!queue.some(e => e.kind === 'dispatch' && e.sessionId === entry.sessionId && e.action.type === 'answer' && e.action.questionId === entry.action.questionId)) delete state.pendingAnswers[key]
          }
          entry.resolve?.(result)
        } catch (error) {
          if (isFrozenFailure(error)) {
            fail(error)
            queue.forEach(e => { e.reject?.(error); e.resolve = null; e.reject = null })
          } else {
            queue.shift(); state.pendingCount = queue.length
            if (entry.kind === 'dispatch' && entry.action.type === 'answer') {
              const key = draftKey(entry.sessionId, entry.action.questionId)
              if (!queue.some(e => e.kind === 'dispatch' && e.sessionId === entry.sessionId && e.action.questionId === entry.action.questionId)) {
                const value = widgetValue(entry.action.questionId, entry.sessionId)
                for (const field of Object.keys(value)) delete value[field]
                Object.assign(value, clone(state.snapshot.sessions.find(s => s.id === entry.sessionId)?.answers?.[entry.action.questionId] ?? {}))
                delete state.pendingAnswers[key]
              }
            }
            entry.reject?.(error)
          }
        }
      }
    })().finally(() => { running = null; state.saving = false; if (queue.length && !state.error) void pump() })
    return running
  }
  function enqueue(intent) {
    if (state.error) return Promise.reject(new ExamError(state.error.message, state.error.code))
    if (!state.ready) return Promise.reject(new ExamError('Load exam storage before writing'))
    finiteJson(intent, recoveryByteLimit - RECOVERY_METADATA_BYTES)
    const entry = clone(intent)
    const pending = queue.map(({ resolve, reject, ...write }) => write)
    const projectedRecovery = { format: 'azure-trainer-exam-recovery', version: 1, snapshot: state.snapshot, pending: [...pending, entry], error: null }
    if (byteLength(JSON.stringify(projectedRecovery)) > recoveryByteLimit - RECOVERY_METADATA_BYTES) throw new ExamError('Pending changes exceed recovery capacity. Wait for saves or export recovery before adding more changes.', 'RECOVERY_LIMIT')
    const result = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject })
    queue.push(entry); state.pendingCount = queue.length; updateDraft(entry); void pump()
    return result
  }
  async function flush() {
    while (running) await running
    if (state.error) throw new ExamError(state.error.message, state.error.code)
  }
  async function hydrate({ refresh = false } = {}) {
    if (state.ready) {
      if (refresh) {
        revokeReviewGrants(); state.loading = true
        try {
          await flush()
          const snapshot = await repository.load()
          if (snapshot.revision !== state.snapshot.revision) { drafts.clear(); state.pendingAnswers = {} }
          clock(); commit(snapshot)
        } catch (error) { throw fail(error) }
        finally { state.loading = false }
      }
      return state.snapshot
    }
    if (hydration) return hydration
    revokeReviewGrants(); state.loading = true
    hydration = (async () => {
      try { commit(await repository.load()); state.ready = true; await tick(); return state.snapshot }
      catch (error) { fail(error); throw error }
      finally { state.loading = false; hydration = null }
    })()
    return hydration
  }
  async function loadBank() {
    if (!bankPromise) bankPromise = bankLoader().then(bank => { state.bank = freeze(clone(bank)); return state.bank }).catch(error => { bankPromise = null; throw error })
    return bankPromise
  }
  function dispatch(action, { sessionId = current()?.id } = {}) {
    const observedAt = clock()
    if (action.type === 'answer') {
      const q = state.snapshot?.sessions.find(s => s.id === sessionId)?.questions?.find(q => q.id === action.questionId)
      if (!q) return Promise.reject(new ExamError('Question is unavailable'))
      try { validateAnswer(q, action.answer) } catch (error) { return Promise.reject(error) }
    }
    return enqueue({ kind: 'dispatch', sessionId, action, observedAt })
  }
  function tick() {
    const observedAt = clock()
    if (!state.ready || state.error) return Promise.resolve()
    const expired = state.snapshot.sessions.filter(s => s.mode === 'mock' && s.status !== 'finished' && (s.status === 'expired' || observedAt >= s.deadlineAt))
    if (expired.length) return Promise.all(expired.filter(s => !queue.some(e => e.kind === 'dispatch' && e.sessionId === s.id && e.action.type === 'finish')).map(s => enqueue({ kind: 'dispatch', sessionId: s.id, action: { type: 'finish' }, observedAt })))
    const mock = state.snapshot.sessions.find(s => s.mode === 'mock' && s.status !== 'finished')
    if (mock && !queue.length && observedAt > mock.lastObservedAt) return enqueue({ kind: 'dispatch', sessionId: mock.id, action: { type: 'tick' }, observedAt })
    return Promise.resolve()
  }
  async function retry() {
    if (state.error?.code !== 'STORAGE_FAILED') throw new ExamError('Reload is required; pending writes cannot be replayed.', state.error?.code ?? 'INVALID_EXAM_DATA')
    if (!state.snapshot && !queue.length) { state.error = null; return hydrate() }
    const stored = await repository.load()
    if (stored.revision !== state.snapshot?.revision) throw fail(new ExamError('Another tab changed exam storage. Export recovery and reload.', 'REVISION_CONFLICT'))
    state.error = null; await pump(); await flush(); await tick()
  }
  async function reload({ discardPending = false } = {}) {
    if (queue.length && !discardPending) throw new ExamError('Confirm discarding pending changes before reloading.')
    if (running) await running
    queue.splice(0); state.pendingCount = 0; drafts.clear(); state.pendingAnswers = {}; state.error = null; state.ready = false
    return hydrate()
  }
  async function start({ mode, seed = 0, ...settings }) {
    finiteJson(settings)
    settings = clone(settings)
    await hydrate(); await flush()
    if (mode === 'study' && !accessDecision(state.snapshot, { mode: 'study' }).allowed) throw new ExamError('Finish the active Mock before Study.', 'MOCK_ACTIVE')
    const bank = await loadBank()
    const session = createExamSession({ id: newId(), bank, mode, settings: { practiceGoal: state.snapshot.preferences.practiceGoal, ...settings }, seed, now: clock() })
    await enqueue({ kind: 'start', session }); return session
  }
  function makeNote({ id, target, text = '', status = 'pending', snoozedUntil = null }) {
    const existing = state.snapshot?.notes.find(n => n.id === id || (!id && n.target.kind === target.kind && n.target.id === target.id))
    return { version: 1, id: existing?.id ?? id ?? newId(), revision: (existing?.revision ?? 0) + 1, target: clone(target), text, status, snoozedUntil, updatedAt: Math.max(clock(), existing?.updatedAt ?? 0) }
  }
  const api = {
    get ready() { return state.ready }, get loading() { return state.loading }, get saving() { return state.saving }, get error() { return state.error },
    get snapshot() { return state.snapshot }, get session() { return current() }, get bank() { return state.bank }, get observedAt() { return state.observedAt },
    get pendingAnswers() { return state.pendingAnswers }, get pendingCount() { return state.pendingCount },
    get saveStatus() { return state.error ? 'error' : state.saving ? 'saving' : state.ready ? 'saved' : 'loading' },
    get presentation() {
      const s = current(); if (!s) return null
      const view = presentSession(s, { now: state.observedAt })
      if (view.status === 'finished') return view
      view.questions = view.questions.map(q => ordered(q, view.optionOrders[q.id]))
      if (view.feedback) view.feedback.question = ordered(view.feedback.question, view.optionOrders[view.feedback.question.id])
      const transitionPending = state.pendingCount > 0 && queue.some(e => ['import', 'delete', 'reset'].includes(e.kind) || (e.kind === 'dispatch' && e.sessionId === s.id && !['answer', 'flag', 'confidence', 'tick'].includes(e.action.type)))
      if (state.error || transitionPending) view.editable = false
      if (s.mode === 'study' && !api.access({ mode: 'study' }).allowed) { view.questions = []; view.groups = []; view.feedback = null; view.references = []; view.editable = false }
      return view
    },
    hydrate, loadBank, start, dispatch, flush, tick, retry, reload, widgetValue, makeNote,
    selectSession(id) { state.selectedId = id },
    access(to) {
      if (!state.ready || state.loading || state.error) return { allowed: false, redirect: '/exam', reason: 'Saved access restrictions are unavailable. Finish loading or recover storage before continuing.' }
      return accessDecision(state.snapshot, { ...to, mode: to.mode ?? to.query?.mode })
    },
    saveNote(input) { const note = input.version === 1 ? clone(input) : makeNote(input); validateNote(note); return enqueue({ kind: 'note', note }) },
    setPracticeGoal(practiceGoal) { integer(practiceGoal, 1, 100); return enqueue({ kind: 'preferences', preferences: { practiceGoal } }) },
    async previewImport(text) { await flush(); return repository.previewImport(text) },
    applyImport(preview, { replaceIds = [] } = {}) { return enqueue({ kind: 'import', preview, replaceIds }) },
    async exportBackup() { await flush(); return repository.exportBackup() },
    exportMemory() {
      const recovery = { format: 'azure-trainer-exam-recovery', version: 1, snapshot: state.snapshot, pending: queue.map(({ resolve, reject, ...intent }) => intent), error: state.error }
      finiteJson(recovery, recoveryByteLimit); return JSON.stringify(recovery)
    },
    async previewDeleteAttempt(id) { await flush(); return repository.previewDeleteAttempt(id) },
    deleteAttempt(attemptId) { return enqueue({ kind: 'delete', attemptId }) },
    reset() { return enqueue({ kind: 'reset' }) },
    async reviewReveal(attemptId, questionId) {
      const attempt = state.snapshot.attempts.find(a => a.id === attemptId)
      if (!attempt) return Promise.reject(new ExamError('Attempt was not found', 'NOT_FOUND'))
      const epoch = disclosureEpoch
      const result = await dispatch({ type: 'reviewReveal', questionId }, { sessionId: attempt.sessionId })
      if (epoch === disclosureEpoch && api.access({ path: '/review' }).allowed) reviewGrants.add(`${attemptId}/${questionId}`)
      return result
    },
    resultQuestion(attemptId, questionId, { feedback = false } = {}) {
      if (!api.access({ path: '/review' }).allowed) return null
      const attempt = state.snapshot?.attempts.find(a => a.id === attemptId), question = attempt?.questions.find(q => q.id === questionId)
      if (!question || (feedback && (!reviewGrants.has(`${attemptId}/${questionId}`) || !attempt.exposures.some(e => e.questionId === questionId && e.event === 'reveal')))) return null
      return ordered(publicQuestion(question, { feedback }), attempt.optionOrders[questionId])
    },
  }
  return api
}

export const useExamStore = defineStore('exam', () => {
  const api = createExamStore()
  return Object.fromEntries(Object.keys(api).map(key => [key, typeof api[key] === 'function' ? api[key] : computed(() => api[key])]))
})
