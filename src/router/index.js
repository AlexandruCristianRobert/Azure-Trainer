import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import HomePage from '../pages/HomePage.vue'

export function createExamNavigationGuard(loadStore = async () => (await import('../stores/exam.js')).useExamStore()) {
  return async to => {
    if (!/^\/(exam|review)(\/|$)/.test(to.path ?? '')) return true
    const store = await loadStore()
    try { await store.hydrate({ refresh: true }) } catch { return to.path === '/exam' ? true : '/exam' }
    const decision = store.access(to)
    return decision.allowed ? true : decision.redirect
  }
}

const routes = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/lab/:labId', name: 'lab', component: () => import('../pages/LabPage.vue'), props: true },
  { path: '/exam', name: 'exam', component: () => import('../pages/ExamPage.vue'), meta: { exam: true } },
  { path: '/exam/session/:sessionId', name: 'exam-session', component: () => import('../pages/ExamSessionPage.vue'), props: true, meta: { exam: true } },
  { path: '/exam/results/:attemptId', name: 'exam-results', component: () => import('../pages/ExamResultPage.vue'), props: true, meta: { exam: true } },
  { path: '/review', name: 'review', component: () => import('../pages/ReviewPage.vue'), meta: { exam: true } },
  { path: '/review/history', name: 'review-history', component: () => import('../pages/ReviewHistoryPage.vue'), meta: { exam: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const history = import.meta.env.PROD
  ? createWebHashHistory(import.meta.env.BASE_URL)
  : createWebHistory(import.meta.env.BASE_URL)

const router = createRouter({ history, routes })
router.beforeEach(createExamNavigationGuard())

export default router
