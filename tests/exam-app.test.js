// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, shallowReactive } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb'
import { createExamRepository } from '../src/lib/exam/persistence.js'
import { bankFixture, mockBankFixture, correctAnswer } from './helpers/examFixtures.js'
import { createExamStore } from '../src/stores/exam.js'
import { createExamNavigationGuard } from '../src/router/index.js'
import ExamSessionPage from '../src/pages/ExamSessionPage.vue'
import ExamResultPage from '../src/pages/ExamResultPage.vue'
import ReviewPage from '../src/pages/ReviewPage.vue'
import ReviewHistoryPage from '../src/pages/ReviewHistoryPage.vue'
import BackupControls from '../src/components/exam/BackupControls.vue'
import ExamSetup from '../src/components/exam/ExamSetup.vue'
import { createPinia } from 'pinia'
import { JSDOM } from 'jsdom'

const mounted = [], repositories = []
afterEach(() => { mounted.splice(0).forEach(app => app.unmount()); document.body.replaceChildren(); repositories.splice(0).forEach(r => r.close()) })
let sequence = 0
function fixture(bank = bankFixture(), shared = {}, storeOptions = {}) {
  const indexedDB = shared.indexedDB ?? new IDBFactory(), dbName = shared.dbName ?? `exam-app-${++sequence}`
  const repository = createExamRepository({ indexedDB, dbName }); repositories.push(repository)
  let clock = 1000
  const store = createExamStore({ repository, bankLoader: async () => bank, now: () => clock, newId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`, ...storeOptions })
  return { store, repository, indexedDB, dbName, time: at => { clock = at } }
}
async function mount(component, props) {
  const host = document.createElement('div'); document.body.append(host)
  const empty = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/lab/:labId', name: 'lab', component: empty }, { path: '/exam/session/:sessionId', name: 'exam-session', component: empty }, { path: '/:pathMatch(.*)*', component: empty }] })
  await router.push('/'); await router.isReady()
  const liveProps = shallowReactive({ ...props })
  const app = createApp({ render: () => h(component, liveProps) }); const warnings = []
  app.config.warnHandler = text => warnings.push(text)
  app.use(createPinia()).use(router).mount(host); mounted.push(app); await nextTick()
  return { host, router, warnings, async setProps(values) { Object.assign(liveProps, values); await nextTick() } }
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
async function click(host, text) { const control = button(host, text); expect(control, text).toBeTruthy(); control.click(); await nextTick() }
async function settle(store) { await store.flush(); await nextTick() }
function edit(el, value) { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }
function rendered(host, predicate) {
  if (predicate()) return Promise.resolve()
  return new Promise(resolve => { const observer = new MutationObserver(() => { if (predicate()) { observer.disconnect(); resolve() } }); observer.observe(host, { childList: true, subtree: true, characterData: true, attributes: true }) })
}
async function start(f, mode = 'study', settings = {}) { await f.store.hydrate(); await f.store.start({ mode, size: mode === 'mock' ? 40 : 5, seed: 31, ...settings }) }

describe('acknowledged exam application', () => {
  // Catches optimistic Saved/score/cursor and losing same-tick checkbox edits.
  it('composes rapid real widget edits and flushes before seal across a mixed Mock with cases and series', async () => {
    const f = fixture(mockBankFixture()); await start(f, 'mock')
    const { host, warnings } = await mount(ExamSessionPage, { store: f.store, sessionId: f.store.session.id })
    const savedOrder = JSON.stringify(f.store.session.optionOrders)
    const kinds = new Set()
    for (const q of f.store.session.questions.filter(q => !q.groupId)) {
      await f.store.dispatch({ type: 'visit', questionId: q.id }); await nextTick()
      if (!kinds.has(q.kind)) {
        kinds.add(q.kind)
        if (['single-choice', 'multiple-response', 'hot-area'].includes(q.kind)) {
          host.querySelector('input[value="a"]').click()
          if (q.kind !== 'single-choice') host.querySelector('input[value="b"]').click()
        } else if (q.kind === 'statement-grid') {
          host.querySelectorAll('fieldset fieldset input[value="yes"]')[0]?.click()
          const rows = host.querySelectorAll('.exam-grid-row'); rows[0].querySelector('input[value="yes"]').click(); rows[1].querySelector('input[value="no"]').click()
        } else {
          const selects = host.querySelectorAll('.exam-question select'); edit(selects[0], 'a'); edit(selects[1], 'b')
        }
        await settle(f.store)
        expect(f.store.session.answers[q.id]).toEqual(correctAnswer(q))
      } else await f.store.dispatch({ type: 'answer', questionId: q.id, answer: correctAnswer(q) })
    }
    expect(kinds.size).toBe(8)
    expect(host.textContent).not.toContain('Explanation and answer reasons')
    const last = f.store.presentation.currentQuestionId
    const pending = f.store.dispatch({ type: 'answer', questionId: last, answer: {} })
    const sealing = f.store.dispatch({ type: 'sealSection' })
    expect(f.store.session.cursor.sectionIndex).toBe(0)
    expect(f.store.saveStatus).toBe('saving')
    expect(f.store.presentation.editable).toBe(false)
    await Promise.all([pending, sealing]); await nextTick()
    expect(f.store.session.cursor.sectionIndex).toBe(1)
    expect(host.textContent).toContain('Shared scenario requirements.')
    for (let section = 1; section < 4; section++) {
      const ids = [...f.store.session.sections[section].questionIds]
      for (let i = 0; i < ids.length; i++) {
        if (section < 3) await f.store.dispatch({ type: 'visit', questionId: ids[i] })
        const q = f.store.session.questions.find(q => q.id === ids[i])
        await f.store.dispatch({ type: 'answer', questionId: q.id, answer: correctAnswer(q) })
        if (section === 3 && i < 2) await f.store.dispatch({ type: 'next' })
      }
      await f.store.dispatch({ type: 'sealSection' })
    }
    const first = await f.store.dispatch({ type: 'finish' }); const again = await f.store.dispatch({ type: 'finish' })
    expect(again.attempt.id).toBe(first.attempt.id)
    expect(f.store.snapshot.attempts).toHaveLength(1)
    expect(JSON.stringify(first.attempt.optionOrders)).toBe(savedOrder)
    expect(first.attempt.responses[last]).toEqual({})
    expect(warnings).toEqual([])
  }, 30000)

  // Catches using finish time for already captured answers and unpersisted result disclosure.
  it('captures pre-deadline input time, disables immediately and finalizes after pending writes', async () => {
    const f = fixture(mockBankFixture()); await start(f, 'mock')
    const id = f.store.session.questions.find(q => q.kind === 'single-choice' && !q.groupId).id, deadline = f.store.session.deadlineAt
    await f.store.dispatch({ type: 'visit', questionId: id })
    f.time(deadline - 1)
    const saving = f.store.dispatch({ type: 'answer', questionId: id, answer: { pick: 'a' } })
    f.time(deadline); const finishing = f.store.tick()
    expect(f.store.presentation.editable).toBe(false)
    expect(f.store.snapshot.attempts).toHaveLength(0)
    await Promise.all([saving, finishing])
    expect(f.store.snapshot.attempts[0].responses[id]).toEqual({ pick: 'a' })
    expect(f.store.snapshot.attempts[0].submissionReason).toBe('deadline')
    const reopened = fixture(mockBankFixture(), f); reopened.time(deadline + 1); await reopened.store.hydrate()
    expect(reopened.store.snapshot.attempts).toHaveLength(1)
  })

  // Catches rehydration displaying an expired active session without durable finish.
  it('finishes an actually expired rehydrated Mock', async () => {
    const f = fixture(mockBankFixture()); await start(f, 'mock')
    const other = fixture(mockBankFixture(), f); other.time(f.store.session.deadlineAt)
    await other.store.hydrate()
    expect(other.store.snapshot.sessions[0].status).toBe('finished')
    expect(other.store.snapshot.attempts[0].submissionReason).toBe('deadline')
  })

  // Real transaction abort: catches early acknowledgment, lost recovery intent and retry-time substitution.
  it('freezes on failed transaction, exports pending memory and retries original intent', async () => {
    const f = fixture(); await start(f, 'study', { kinds: ['single-choice'], allowShorter: true })
    const id = f.store.presentation.currentQuestionId, before = JSON.stringify(f.store.snapshot)
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) { const request = original.apply(this, args); if (this.name === 'sessions') request.addEventListener('success', () => this.transaction.abort()); return request }
    try { await expect(f.store.dispatch({ type: 'answer', questionId: id, answer: { pick: 'a' } })).rejects.toMatchObject({ code: 'STORAGE_FAILED' }) } finally { IDBObjectStore.prototype.put = original }
    expect(JSON.stringify(f.store.snapshot)).toBe(before)
    expect(f.store.saveStatus).toBe('error'); expect(f.store.presentation.editable).toBe(false)
    const memory = JSON.parse(f.store.exportMemory()); expect(memory.pending[0].observedAt).toBe(1000)
    expect(memory.pending[0].action.answer).toEqual({ pick: 'a' })
    f.time(5000); await f.store.retry()
    expect(f.store.session.answers[id]).toEqual({ pick: 'a' }); expect(f.store.session.lastObservedAt).toBe(1000)
    expect(f.store.saveStatus).toBe('saved')
  })

  // Catches silently replaying a stale edit after another tab seals/navigates.
  it('requires explicit reload after a two-tab conflict and preserves the other tab state', async () => {
    const f = fixture(); await start(f)
    const other = fixture(bankFixture(), f); await other.store.hydrate(); other.store.selectSession(f.store.session.id)
    await f.store.dispatch({ type: 'next' })
    const id = other.store.presentation.currentQuestionId
    await expect(other.store.dispatch({ type: 'answer', questionId: id, answer: {} })).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    await expect(other.store.retry()).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })
    expect(JSON.parse(other.store.exportMemory()).pending).toHaveLength(1)
    await other.store.reload({ discardPending: true })
    expect(other.store.presentation.currentQuestionId).toBe(f.store.presentation.currentQuestionId)
    expect(other.store.session.answers[id]).toBeUndefined()
  })

  // Catches private props before ACK, wrong imported attempt/session IDs, notes affecting score, and wrong candidate order.
  it('persists Study submit, trusted Result reveal, notes and history through actual controls', async () => {
    const f = fixture(); await start(f, 'study', { kinds: ['single-choice'], size: 5, allowShorter: true })
    const { host, warnings } = await mount(ExamSessionPage, { store: f.store, sessionId: f.store.session.id })
    const id = f.store.presentation.currentQuestionId
    expect([...host.querySelectorAll('.exam-question input')].map(el => el.value)).toEqual(f.store.session.optionOrders[id])
    host.querySelector('input[value="a"]').click(); await settle(f.store)
    await click(host, 'Submit question'); await settle(f.store)
    expect(host.textContent).toContain('Explanation and answer reasons')
    await click(host, 'Finish session'); await settle(f.store)
    const attempt = f.store.snapshot.attempts[0]
    const result = await mount(ExamResultPage, { store: f.store, attemptId: attempt.id })
    expect(result.host.querySelector('.exam-feedback')).toBeNull()
    await click(result.host, 'Review answer'); await settle(f.store)
    expect(result.host.textContent).toContain('Explanation and answer reasons')
    expect(f.store.snapshot.attempts[0].exposures.some(e => e.event === 'reveal')).toBe(true)
    edit(result.host.querySelector('textarea'), 'Check partition boundary'); await nextTick()
    await click(result.host, 'Save note'); await settle(f.store)
    expect(f.store.snapshot.notes[0].text).toBe('Check partition boundary')
    expect(f.store.snapshot.attempts[0].grades[0].earned).toBe(1)
    const history = await mount(ReviewHistoryPage, { store: f.store })
    expect(history.host.querySelector(`a[href="/exam/results/${attempt.id}"]`)).toBeTruthy()
    const reopen = fixture(bankFixture(), f); await reopen.store.hydrate()
    expect(reopen.store.snapshot.notes[0].text).toBe('Check partition boundary')
    expect(warnings.concat(result.warnings, history.warnings)).toEqual([])
  })

  it('blocks every Study and review route during active, break and expired Mock while retaining the Study', async () => {
    const f = fixture(mockBankFixture()); await start(f); const studyId = f.store.session.id
    await f.store.start({ mode: 'mock', size: 40, seed: 31 })
    const mockId = f.store.session.id, guard = createExamNavigationGuard(async () => f.store)
    for (const state of ['active', 'break', 'expired']) {
      if (state === 'break') await f.store.dispatch({ type: 'break' })
      if (state === 'expired') f.time(f.store.session.deadlineAt)
      for (const to of [{ path: '/review', name: 'review' }, { path: '/review/history', name: 'review-history' }, { path: '/exam/results/x', name: 'exam-results' }, { path: '/exam', query: { mode: 'study' } }, { path: `/exam/session/${studyId}`, params: { sessionId: studyId } }]) expect(await guard(to)).toBe(`/exam/session/${mockId}`)
      expect(await guard({ path: '/lab/messaging-send' })).toBe(true)
      expect(await guard({ path: '/' })).toBe(true)
    }
    expect(f.store.snapshot.sessions.find(s => s.id === studyId).status).toBe('active')
    await f.store.tick(); expect(await guard({ path: '/review' })).toBe(true)
  })

  it('shows sparse evidence separately from bank availability and read-only Lab assistance with a safe return link', async () => {
    const bank = structuredClone(bankFixture()); bank.questions.forEach(q => { q.objectiveId = 'connect.servicebus'; q.components.forEach(c => { c.conceptId = 'connect.queue-acceptance' }) })
    const f = fixture(bank); await f.store.hydrate()
    const progress = { labStatus: () => 'completed', runSummary: () => ({ tasksDone: 1, total: 1, completedAt: '2026-10-06' }), latestResult: () => ({ id: 'lab-1', finishedAt: '2026-10-06', hintsUsed: null, solutionsUsed: 2 }) }
    const { host, warnings } = await mount(ReviewPage, { store: f.store, labProgress: progress })
    await f.store.loadBank(); await nextTick()
    expect(host.textContent).toContain('Insufficient evidence')
    expect(host.textContent).toContain('Bank availability')
    expect(host.textContent).toContain('Hints: unknown')
    expect(host.textContent).toContain('Solutions: 2')
    expect(host.querySelector('a[href="/lab/messaging-send?returnTo=/review"]')).toBeTruthy()
    expect(host.textContent).toContain('No matching Lab')
    expect(f.store.snapshot.attempts).toEqual([]); expect(warnings).toEqual([])
  })

  // Catches destructive actions without preview/confirmation and importing an oversized File before size check.
  it('previews backup conflicts and attempt deletion before explicit confirmation', async () => {
    const f = fixture(); await start(f); await f.store.dispatch({ type: 'finish' })
    const backup = await f.store.exportBackup(); const preview = await f.store.previewImport(backup)
    expect(preview.conflicts).toEqual([])
    const { host } = await mount(BackupControls, { store: f.store })
    expect(host.textContent).toContain('unencrypted')
    const history = await mount(ReviewHistoryPage, { store: f.store })
    await click(history.host, 'Delete attempt'); await rendered(history.host, () => !!button(history.host, 'Confirm deletion'))
    expect(f.store.snapshot.attempts).toHaveLength(1)
    expect(history.host.textContent).toContain('Confirm deletion')
    await click(history.host, 'Confirm deletion'); await settle(f.store)
    expect(f.store.snapshot.attempts).toHaveLength(0)
    await f.store.applyImport(await f.store.previewImport(backup), { replaceIds: [] })
    expect(f.store.snapshot.attempts).toHaveLength(1)
  })

  // Catches omitted answers exposed before trusted transaction ACK and assuming attempt ID equals session ID.
  it('withholds omitted historical keys on failed disclosure and uses the imported session ID', async () => {
    const source = fixture(); await start(source, 'study', { kinds: ['single-choice'], allowShorter: true }); await source.store.dispatch({ type: 'finish' })
    const envelope = JSON.parse(await source.store.exportBackup()), historicalId = '12345678-1234-4000-8000-123456789012'
    envelope.data.attempts[0].id = historicalId; envelope.data.sessions[0].attemptId = historicalId
    const f = fixture(); await f.store.hydrate(); await f.store.applyImport(await f.store.previewImport(JSON.stringify(envelope)))
    const { host } = await mount(ExamResultPage, { store: f.store, attemptId: historicalId })
    expect(host.querySelector('.exam-feedback')).toBeNull()
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) { const request = original.apply(this, args); if (this.name === 'attempts') request.addEventListener('success', () => this.transaction.abort()); return request }
    try { await click(host, 'Review answer'); await expect(f.store.flush()).rejects.toMatchObject({ code: 'STORAGE_FAILED' }); await nextTick() } finally { IDBObjectStore.prototype.put = original }
    expect(host.querySelector('.exam-feedback')).toBeNull()
    expect(f.store.snapshot.attempts[0].assistedIds).toEqual([])
    await f.store.retry(); await click(host, 'Review answer'); await settle(f.store)
    expect(host.querySelector('.exam-feedback')).toBeTruthy()
    expect(f.store.snapshot.attempts[0].sessionId).not.toBe(historicalId)
    expect(f.store.snapshot.attempts[0].grades[0].earned).toBe(0)
  })

  // Catches dropping non-answer intents from recovery and accumulating finish events while frozen.
  it('retains note and preference writes in bounded recovery and freezes timer accumulation after failure', async () => {
    const f = fixture(mockBankFixture()); await start(f, 'mock')
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) { const request = original.apply(this, args); if (this.name === 'notes') request.addEventListener('success', () => this.transaction.abort()); return request }
    const note = f.store.saveNote({ target: { kind: 'concept', id: 'connect.queue-acceptance' }, text: 'Retained Ω', status: 'pending' })
    const preferences = f.store.setPracticeGoal(85)
    try { const results = await Promise.allSettled([note, preferences]); expect(results.every(r => r.status === 'rejected')).toBe(true) } finally { IDBObjectStore.prototype.put = original }
    f.time(f.store.session.deadlineAt); await f.store.tick(); await f.store.tick()
    const recovery = JSON.parse(f.store.exportMemory())
    expect(recovery.pending.map(i => i.kind)).toEqual(['note', 'preferences'])
    expect(recovery.pending[0].note.text).toBe('Retained Ω')
    expect(f.store.snapshot.notes).toHaveLength(0); expect(f.store.snapshot.preferences.practiceGoal).toBe(80)
    await f.store.retry()
    expect(f.store.snapshot.notes[0].text).toBe('Retained Ω'); expect(f.store.snapshot.preferences.practiceGoal).toBe(85)
    expect(f.store.snapshot.attempts[0].submissionReason).toBe('deadline')
  })

  // Catches stale navigation snapshots releasing Review after another tab starts Mock.
  it('refreshes persisted access restrictions on relevant navigation without losing queued edits', async () => {
    const f = fixture(mockBankFixture()); await f.store.hydrate()
    const other = fixture(mockBankFixture(), f); await start(other, 'mock')
    const guard = createExamNavigationGuard(async () => f.store)
    expect(await guard({ path: '/review' })).toBe(`/exam/session/${other.store.session.id}`)
  })

  // Catches clock rollback after reopen forgetting the greatest pre-deadline observed time.
  it('persists observed Mock clock progress and rejects invalid edits without pending phantom answers', async () => {
    const f = fixture(mockBankFixture()); await start(f, 'mock'); f.time(8000); await f.store.tick()
    const reopened = fixture(mockBankFixture(), f); reopened.time(3000); await reopened.store.hydrate()
    expect(reopened.store.session.lastObservedAt).toBe(8000)
    const id = f.store.presentation.currentQuestionId; await f.store.dispatch({ type: 'sealSection' })
    await expect(f.store.dispatch({ type: 'answer', questionId: id, answer: {} })).rejects.toBeTruthy()
    expect(Object.keys(f.store.pendingAnswers)).toEqual([])
  })

  it('requires explicit store-qualified import choices and blocks mode conflicts without changing storage', async () => {
    const f = fixture(); await start(f); await f.store.dispatch({ type: 'finish' })
    const envelope = JSON.parse(await f.store.exportBackup()); envelope.data.preferences.practiceGoal = 90
    const preview = await f.store.previewImport(JSON.stringify(envelope))
    expect(preview.conflicts.map(c => c.key)).toEqual(['meta:preferences'])
    await expect(f.store.applyImport(preview)).rejects.toMatchObject({ code: 'IMPORT_CONFLICT' })
    expect(f.store.snapshot.preferences.practiceGoal).toBe(80)
    await f.store.applyImport(preview, { replaceIds: ['meta:preferences'] }); expect(f.store.snapshot.preferences.practiceGoal).toBe(90)
    const another = fixture(); await start(another)
    await f.store.start({ mode: 'study', size: 5, seed: 4 })
    const conflict = await f.store.previewImport(await another.store.exportBackup())
    expect(conflict.modeConflicts).toHaveLength(1)
    await expect(f.store.applyImport(conflict, { replaceIds: ['meta:preferences'] })).rejects.toMatchObject({ code: 'MODE_CONFLICT' })
    expect(f.store.snapshot.sessions.filter(s => s.status !== 'finished')).toHaveLength(1)
  })

  it('checks File size before reading and whole UTF-8 note size before a write', async () => {
    const f = fixture(); await f.store.hydrate()
    const { host } = await mount(BackupControls, { store: f.store })
    let reads = 0
    Object.defineProperty(host.querySelector('input[type=file]'), 'files', { value: [{ size: 33554433, text() { reads++; throw new Error('Oversized file must not be read') } }] })
    edit(host.querySelector('input[type=file]'), '')
    await nextTick(); expect(reads).toBe(0); expect(host.textContent).toContain('32 MiB')
    expect(() => f.store.saveNote({ target: { kind: 'concept', id: 'connect.queue-acceptance' }, text: 'Ω'.repeat(4096) })).toThrow()
    expect(f.store.snapshot.notes).toEqual([]); expect(f.store.saveStatus).toBe('saved')
  })

  it('starts Study from real setup controls and preserves its personal goal', async () => {
    const f = fixture(); await f.store.hydrate()
    const { host, warnings } = await mount(ExamSetup, { store: f.store, initialMode: 'study' })
    const select = host.querySelector('select'); edit(select, '5'); edit(host.querySelector('input[type=number]'), '75')
    await nextTick(); await click(host, 'Start Study'); await rendered(host, () => f.store.session !== null || !!host.querySelector('[role=alert]'))
    expect(host.querySelector('[role=alert]')?.textContent ?? '').toBe(''); await settle(f.store)
    expect(f.store.session.mode).toBe('study'); expect(f.store.session.settings.practiceGoal).toBe(75)
    expect(warnings).toEqual([])
  })

  // Catches a recommendation silently falling back to random concept practice.
  it('starts recommendation practice from its exact fresh IDs while keeping the full admitted bank', async () => {
    const bank = structuredClone(bankFixture()); bank.questions.forEach(q => { q.objectiveId = 'connect.servicebus'; q.components.forEach(c => { c.conceptId = 'connect.queue-acceptance' }) })
    const f = fixture(bank); await start(f, 'study', { kinds: ['single-choice'], allowShorter: true })
    const old = f.store.session.id, seen = f.store.presentation.currentQuestionId
    await f.store.dispatch({ type: 'finish' })
    const { host, router, warnings } = await mount(ReviewPage, { store: f.store, labProgress: { labStatus: () => 'not-started', runSummary: () => null, latestResult: () => null } })
    await f.store.loadBank(); await nextTick()
    const topic = [...host.querySelectorAll('.exam-topic')].find(el => el.textContent.includes('Reliable queue acceptance'))
    const routed = new Promise(resolve => { const stop = router.afterEach(() => { stop(); resolve() }) })
    await click(topic, 'Practice this concept'); await rendered(host, () => f.store.session?.id !== old || !!host.querySelector('[role=alert]')); await settle(f.store)
    await routed
    expect(f.store.session.order).not.toContain(seen)
    expect(f.store.session.order).toHaveLength(5)
    expect(f.store.bank.questions).toHaveLength(8)
    expect(router.currentRoute.value.query.preferred).toBe('5')
    expect(warnings).toEqual([])
  })

  // Catches a same-ID import retaining a widget draft from the replaced session.
  it('replaces stale widget drafts only after an explicitly acknowledged same-ID import', async () => {
    const f = fixture(); await start(f, 'study', { kinds: ['single-choice'], allowShorter: true })
    const id = f.store.presentation.currentQuestionId
    await f.store.dispatch({ type: 'answer', questionId: id, answer: { pick: 'a' } })
    expect(f.store.widgetValue(id)).toEqual({ pick: 'a' })
    const incoming = JSON.parse(await f.store.exportBackup()); incoming.data.sessions[0].answers[id] = { pick: 'b' }; incoming.data.sessions[0].revision++
    const preview = await f.store.previewImport(JSON.stringify(incoming))
    const applying = f.store.applyImport(preview, { replaceIds: [`sessions:${f.store.session.id}`] })
    expect(f.store.presentation.editable).toBe(false)
    expect(f.store.session.answers[id]).toEqual({ pick: 'a' })
    await applying
    expect(f.store.widgetValue(id)).toEqual({ pick: 'b' })
  })

  // Catches a fresh Review creating/writing a Lab database or leaving native contexts loading forever.
  it('hydrates actual Lab context without creating Lab storage or changing legacy results', async () => {
    const originalIDB = globalThis.indexedDB, isolatedIDB = new IDBFactory()
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    const storageDOM = new JSDOM('', { url: 'https://exam-app.test' })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storageDOM.window.localStorage })
    globalThis.indexedDB = isolatedIDB
    const legacy = JSON.stringify([{ id: 'legacy-one', labId: 'messaging-send', finishedAt: '2026-10-06T12:00:00Z', hintsUsed: 2, solutionsUsed: 1 }])
    localStorage.setItem('at_results', legacy)
    try {
      const f = fixture(); await f.store.hydrate()
      const { host, warnings } = await mount(ReviewPage, { store: f.store })
      await rendered(host, () => host.textContent.includes('Hints: 2') && !host.textContent.includes('loading; tasks'))
      expect(host.textContent).toContain('Solutions: 1')
      expect(host.textContent).not.toContain('loading; tasks')
      expect(await isolatedIDB.databases()).toEqual([])
      expect(localStorage.getItem('at_results')).toBe(legacy)
      expect(warnings).toEqual([])
      const native = await new Promise((resolve, reject) => { const request = isolatedIDB.open('azure-trainer-behavioral', 1); request.onupgradeneeded = () => { request.result.createObjectStore('runs', { keyPath: 'id' }); request.result.createObjectStore('results', { keyPath: 'id' }) }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      const sentinel = { id: 'native-sentinel', labId: 'messaging-send', finishedAt: '2026-10-07T12:00:00Z', hintsUsed: 3, solutionsUsed: 0 }
      await new Promise((resolve, reject) => { const tx = native.transaction('results', 'readwrite'); tx.objectStore('results').put(sentinel); tx.oncomplete = resolve; tx.onabort = () => reject(tx.error) })
      const second = await mount(ReviewPage, { store: f.store })
      await rendered(second.host, () => second.host.textContent.includes('Hints: 3') && !second.host.textContent.includes('loading; tasks'))
      expect(second.host.textContent.includes('Solutions: 0')).toBe(true)
      const stored = await new Promise((resolve, reject) => { const request = native.transaction('results').objectStore('results').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      expect(stored).toEqual([sentinel]); expect(await isolatedIDB.databases()).toEqual([{ name: 'azure-trainer-behavioral', version: 1 }]); native.close()
      isolatedIDB.databases = async () => { throw new Error('Cannot enumerate existing databases') }
      const unavailable = await mount(ReviewPage, { store: f.store })
      await rendered(unavailable.host, () => !!unavailable.host.querySelector('[role=alert]'))
      expect(unavailable.host.textContent.includes('loading; tasks')).toBe(false)
      expect(unavailable.host.textContent.includes('error; tasks')).toBe(true)
      expect(localStorage.getItem('at_results')).toBe(legacy)
    } finally { globalThis.indexedDB = originalIDB; storageDOM.window.close(); if (storageDescriptor) Object.defineProperty(globalThis, 'localStorage', storageDescriptor); else delete globalThis.localStorage }
  })

  it('does not substitute another session for an unknown selected session route', async () => {
    const f = fixture(); await start(f)
    f.store.selectSession('00000000-0000-4000-8000-999999999999')
    expect(f.store.session).toBeNull(); expect(f.store.presentation).toBeNull()
  })

  it('surfaces a failed navigation refresh and freezes the acknowledged session', async () => {
    const f = fixture(); await start(f); f.repository.close()
    const guard = createExamNavigationGuard(async () => f.store)
    expect(await guard({ path: '/review' })).toBe('/exam')
    expect(f.store.saveStatus).toBe('error'); expect(f.store.presentation.editable).toBe(false)
  })

  it('bounds pending recovery before accepting an intent without losing an earlier queued note', async () => {
    const f = fixture(bankFixture(), {}, { recoveryByteLimit: 75536 }); await f.store.hydrate()
    const first = f.store.saveNote({ target: { kind: 'concept', id: 'first-concept' }, text: 'a'.repeat(6000) })
    let refusal
    try { const second = f.store.saveNote({ target: { kind: 'concept', id: 'second-concept' }, text: 'b'.repeat(6000) }); second.catch(() => {}) } catch (error) { refusal = error }
    const recovery = JSON.parse(f.store.exportMemory())
    const notesBeforeAcknowledgment = f.store.snapshot.notes.length
    await first; await settle(f.store)
    expect(refusal?.message ?? '').toContain('recovery capacity')
    expect(recovery.pending).toHaveLength(1); expect(recovery.pending[0].note.target.id).toBe('first-concept')
    expect(notesBeforeAcknowledgment).toBe(0)
    expect(f.store.snapshot.notes).toHaveLength(1); expect(f.store.saveStatus).toBe('saved')
  })

  // Review R1: a failed restriction refresh must revoke previous disclosure at store and DOM boundaries.
  it('revokes Result disclosure and Review data on failed refresh until a new trusted reveal', async () => {
    const f = fixture(); await start(f, 'study', { kinds: ['single-choice'], allowShorter: true })
    await f.store.dispatch({ type: 'finish' }); const attempt = f.store.snapshot.attempts[0], questionId = attempt.order[0]
    const result = await mount(ExamResultPage, { store: f.store, attemptId: attempt.id })
    const history = await mount(ReviewHistoryPage, { store: f.store })
    const review = await mount(ReviewPage, { store: f.store, labProgress: { labStatus: () => 'not-started', runSummary: () => null } })
    await click(result.host, 'Review answer'); await settle(f.store)
    expect(result.host.querySelector('.exam-feedback')).not.toBeNull()
    edit(result.host.querySelector('textarea'), 'Keep this unsaved note')
    expect(f.store.resultQuestion(attempt.id, questionId, { feedback: true })).not.toBeNull()
    f.repository.close()
    await expect(f.store.hydrate({ refresh: true })).rejects.toMatchObject({ code: 'STORAGE_FAILED' }); await nextTick()
    expect(f.store.access({ path: '/review' }).allowed).toBe(false)
    expect(f.store.resultQuestion(attempt.id, questionId, { feedback: true })).toBeNull()
    expect(result.host.querySelector('.exam-feedback')).toBeNull()
    expect(result.host.querySelector('.exam-result-score')).toBeNull()
    expect(result.host.textContent.includes('A is required')).toBe(false)
    expect(result.host.querySelector('a[href*="service-bus-messaging-overview"]')).toBeNull()
    expect(history.host.querySelector('.exam-history li')).toBeNull()
    expect(review.host.querySelector('.exam-topic')).toBeNull()
    const reopened = createExamRepository({ indexedDB: f.indexedDB, dbName: f.dbName }); repositories.push(reopened); Object.assign(f.repository, reopened)
    await f.store.retry(); await f.store.hydrate({ refresh: true }); await nextTick()
    expect(result.host.querySelector('textarea').value).toBe('Keep this unsaved note')
    expect(result.host.querySelector('.exam-feedback')).toBeNull()
    expect(f.store.resultQuestion(attempt.id, questionId, { feedback: true })).toBeNull()
    await click(result.host, 'Review answer'); await settle(f.store)
    expect(result.host.querySelector('.exam-feedback')).not.toBeNull()
    expect(result.warnings.concat(history.warnings, review.warnings)).toEqual([])
  })

  it('masks Study feedback and references while current restrictions cannot be loaded', async () => {
    const f = fixture(); await start(f, 'study', { kinds: ['single-choice'], allowShorter: true })
    const { host } = await mount(ExamSessionPage, { store: f.store, sessionId: f.store.session.id })
    await click(host, 'Reveal answer'); await settle(f.store)
    expect(host.querySelector('.exam-feedback')).not.toBeNull()
    f.repository.close()
    await expect(f.store.hydrate({ refresh: true })).rejects.toMatchObject({ code: 'STORAGE_FAILED' }); await nextTick()
    expect(f.store.presentation.feedback).toBeNull(); expect(f.store.presentation.references).toEqual([])
    expect(host.querySelector('.exam-feedback')).toBeNull()
    expect(host.textContent.includes('A is required')).toBe(false)
  })

  it('revokes a Result grant immediately during a successful refresh without restoring it afterward', async () => {
    const f = fixture(); await start(f, 'study', { kinds: ['single-choice'], allowShorter: true }); await f.store.dispatch({ type: 'finish' })
    const attempt = f.store.snapshot.attempts[0], questionId = attempt.order[0]
    const { host } = await mount(ExamResultPage, { store: f.store, attemptId: attempt.id })
    await click(host, 'Review answer'); await settle(f.store)
    const refreshing = f.store.hydrate({ refresh: true })
    const loading = f.store.loading, privateWhileLoading = f.store.resultQuestion(attempt.id, questionId, { feedback: true })
    await nextTick(); const visibleWhileLoading = !!host.querySelector('.exam-feedback')
    await refreshing; await nextTick()
    expect(loading).toBe(true); expect(privateWhileLoading).toBeNull(); expect(visibleWhileLoading).toBe(false)
    expect(host.querySelector('.exam-feedback')).toBeNull()
    await click(host, 'Review answer'); await settle(f.store)
    expect(host.querySelector('.exam-feedback')).not.toBeNull()
  })

  it('uses Mock 50 and Study 10 initially and after actual mode changes', async () => {
    const f = fixture(); await f.store.hydrate()
    const mock = await mount(ExamSetup, { store: f.store })
    expect(mock.host.querySelectorAll('select')[0].value).toBe('50')
    expect(mock.host.querySelectorAll('select')[1].value).toBe('100')
    mock.host.querySelector('input[value=study]').click(); await nextTick()
    expect(mock.host.querySelector('select').value).toBe('10')
    edit(mock.host.querySelector('select'), '20')
    mock.host.querySelector('input[value=mock]').click(); await nextTick()
    expect(mock.host.querySelector('select').value).toBe('50')
    const study = await mount(ExamSetup, { store: f.store, initialMode: 'study' })
    expect(study.host.querySelector('select').value).toBe('10')
  })

  it('resets Result identity state on reused props without saving the preceding attempt note', async () => {
    const f = fixture(); await start(f, 'study', { kinds: ['single-choice'], allowShorter: true }); await f.store.dispatch({ type: 'finish' })
    const a = f.store.snapshot.attempts[0]
    await f.store.saveNote({ target: { kind: 'attempt', id: a.id }, text: 'Saved A' })
    await start(f, 'study', { kinds: ['single-choice'], allowShorter: true }); await f.store.dispatch({ type: 'finish' })
    const b = f.store.snapshot.attempts.find(item => item.id !== a.id)
    await f.store.saveNote({ target: { kind: 'attempt', id: b.id }, text: 'Saved B' })
    const result = await mount(ExamResultPage, { store: f.store, attemptId: a.id })
    await click(result.host, 'Review answer'); await settle(f.store)
    edit(result.host.querySelector('textarea'), 'Unsaved A')
    await result.setProps({ attemptId: b.id })
    expect(result.host.querySelector('textarea').value).toBe('Saved B')
    expect(result.host.querySelector('.exam-feedback')).toBeNull()
    edit(result.host.querySelector('textarea'), 'Edited B')
    await click(result.host, 'Save note'); await settle(f.store)
    expect(f.store.snapshot.notes.find(n => n.target.id === a.id).text).toBe('Saved A')
    expect(f.store.snapshot.notes.find(n => n.target.id === b.id).text).toBe('Edited B')
    await result.setProps({ attemptId: a.id })
    button(result.host, 'Review answer').click()
    await result.setProps({ attemptId: b.id }); await settle(f.store)
    expect(result.host.querySelector('textarea').value).toBe('Edited B')
    expect(result.host.querySelector('.exam-feedback')).toBeNull()
    expect(result.warnings).toEqual([])
  })
})
