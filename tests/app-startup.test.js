// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { IDBFactory } from 'fake-indexeddb'
import App from '../src/App.vue'
import router from '../src/router/index.js'

let app
afterEach(() => {
  app?.unmount()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

it('renders Home and exam setup through the real application and default Pinia store', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('localStorage', window.localStorage)
  const host = document.createElement('div')
  document.body.append(host)
  const errors = []
  app = createApp(App)
  app.config.errorHandler = error => errors.push(error)
  app.use(createPinia()).use(router)
  await router.push('/')
  app.mount(host)
  await nextTick()
  expect(errors).toEqual([])
  expect(host.querySelector('main.home')).not.toBeNull()
  expect(host.textContent).toContain('Labs by Skill Area')
  expect(host.textContent).toContain('Simulated: Export the notification operation to Azure Monitor')
  await router.push('/exam')
  await nextTick()
  expect(errors).toEqual([])
  expect(host.querySelector('main.exam-page')).not.toBeNull()
  expect(host.textContent).toContain('AI-200 exam practice')
  expect(host.querySelector('.exam-setup')).not.toBeNull()
})
