import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../../src/App.vue'
import ExamPage from '../../src/pages/ExamPage.vue'
import ExamSessionPage from '../../src/pages/ExamSessionPage.vue'
import ExamResultPage from '../../src/pages/ExamResultPage.vue'
import ReviewHistoryPage from '../../src/pages/ReviewHistoryPage.vue'
import { createExamStore } from '../../src/stores/exam.js'
import { createExamRepository } from '../../src/lib/exam/persistence.js'
import { bankFixture } from '../helpers/examFixtures.js'
import '../../src/styles/index.css'
import '../../src/styles/exam.css'

// Every run owns a new synthetic DB. Never open, reset or delete the user's DBs.
const dbName = `azure-trainer-exam-smoke-${crypto.randomUUID()}`
const output = document.getElementById('exam-smoke-result'), checks = []
function check(condition, label) { if (!condition) throw new Error(label); checks.push(`PASS ${label}`) }
async function run() {
  let repository = createExamRepository({ dbName })
  let store = createExamStore({ repository, bankLoader: async () => bankFixture() })
  await store.hydrate(); await store.start({ mode: 'study', kinds: ['single-choice'], size: 5, allowShorter: true, seed: 31 })
  const sessionId = store.session.id, questionId = store.presentation.currentQuestionId
  await store.dispatch({ type: 'answer', questionId, answer: { pick: 'a' } }); await store.flush()
  check(store.saveStatus === 'saved', 'answer acknowledged after native transaction')
  repository.close()
  repository = createExamRepository({ dbName }); store = createExamStore({ repository, bankLoader: async () => bankFixture() })
  await store.hydrate(); store.selectSession(sessionId)
  check(store.session.answers[questionId].pick === 'a', 'acknowledged answer survives close/reopen')
  const finished = await store.dispatch({ type: 'finish' })
  const loaded = await repository.load()
  check(loaded.sessions.find(s => s.id === sessionId)?.attemptId === finished.attempt.id && loaded.attempts.length === 1 && loaded.attempts[0].responses[questionId].pick === 'a', 'native completion stores pointer and frozen attempt together')
  const backup = await store.exportBackup(), preview = await store.previewImport(backup)
  await store.applyImport(preview)
  check(store.snapshot.attempts.length === 1, 'validated backup round trip does not duplicate attempt')
  await store.reviewReveal(finished.attempt.id, questionId)
  check(store.resultQuestion(finished.attempt.id, questionId, { feedback: true }) !== null, 'review disclosure is acknowledged')
  await store.start({ mode: 'study', size: 5, seed: 17 })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', component: { template: '<main class="exam-page">Synthetic smoke home</main>' } },
    { path: '/exam', component: ExamPage, props: { store }, meta: { exam: true } },
    { path: '/exam/session/:sessionId', component: ExamSessionPage, props: route => ({ store, sessionId: route.params.sessionId }), meta: { exam: true } },
    { path: '/exam/results/:attemptId', component: ExamResultPage, props: route => ({ store, attemptId: route.params.attemptId }), meta: { exam: true } },
    { path: '/review/history', component: ReviewHistoryPage, props: { store }, meta: { exam: true } },
    { path: '/review', redirect: '/review/history' },
  ] })
  await router.push(`/exam/session/${store.session.id}`); await router.isReady()
  const app = createApp(App); app.use(createPinia()); app.use(router); app.mount('#app')
  output.textContent = `${checks.join('\n')}\nREADY: use the rendered session for the single small-viewport and keyboard-focus check.\nOwned database: ${dbName}\nNo default Exam or Lab database was opened or deleted.`
  output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;margin:0;font:12px monospace'
  window.examSmoke = Object.freeze({ dbName, checks: [...checks], status: 'passed' })
}
run().catch(error => { output.textContent = `FAIL ${error.stack ?? error.message}\nOwned database: ${dbName}`; window.examSmoke = Object.freeze({ dbName, checks, status: 'failed' }) })
