// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import LabCompletePanel from '../src/components/lab/LabCompletePanel.vue'
import TaskRow from '../src/components/lab/TaskRow.vue'
import { useLabRunStore } from '../src/stores/labRun.js'
import { createBehavioralRun } from '../src/lib/labEngine/run.js'
import { SERVICEBUS_FOUNDATION_LABS } from '../src/data/labs/messaging-journey/index.js'

let app, host
afterEach(() => { app?.unmount(); host?.remove() })
it('shows the same explanation when a completed messaging task opens its exam note', () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const task = SERVICEBUS_FOUNDATION_LABS[0].tasks[0]
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(TaskRow, { task: { ...task, index: 0 }, state: 'done', examNoteOpen: true }).use(pinia)
  app.mount(host)
  expect(host.querySelector('.exam-note').textContent).toContain(task.rationale.why)
})
it.each(SERVICEBUS_FOUNDATION_LABS.slice(0, 2))('shows useful completion notes for $id', lab => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const run = useLabRunStore()
  run.labId = lab.id
  run.behavioralRun = createBehavioralRun(lab, { attemptId: 'notes' })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }] })
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(LabCompletePanel).use(pinia).use(router)
  app.mount(host)
  const notes = [...host.querySelectorAll('.lab-complete__note')]
  expect(notes).toHaveLength(lab.tasks.length)
  notes.forEach((note, index) => expect(note.textContent).toContain(lab.tasks[index].rationale.why))
})
