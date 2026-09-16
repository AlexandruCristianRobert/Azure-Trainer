import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import HomePage from '../pages/HomePage.vue'

const routes = [
  { path: '/', name: 'home', component: HomePage },
  { path: '/lab/:labId', name: 'lab', component: () => import('../pages/LabPage.vue'), props: true },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const history = import.meta.env.PROD
  ? createWebHashHistory(import.meta.env.BASE_URL)
  : createWebHistory(import.meta.env.BASE_URL)

const router = createRouter({ history, routes })

export default router
