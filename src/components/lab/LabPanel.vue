<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { usePortalStore } from '../../stores/portal.js'
import { skillAreaById } from '../../data/skillAreas.js'
import { SERVICES } from '../../data/services.js'
import { formatDuration } from '../../lib/format.js'
import FluentIcon from '../icons/FluentIcon.vue'
import TaskRow from './TaskRow.vue'
import LabCompletePanel from './LabCompletePanel.vue'

const run = useLabRunStore()
const portal = usePortalStore()
const briefOpen = ref(true)
const menuOpen = ref(false)
const openNotes = ref(new Set())
const area = computed(() => skillAreaById(run.lab.skillAreaId))
const service = computed(() => SERVICES[run.lab.service])
const pct = computed(() => (run.total ? (run.doneCount / run.total) * 100 : 0))

// When a Task ticks, open its Exam Note and collapse the others (design shows one open).
watch(() => run.taskStates.map((t) => t.done).join(','), (now, before) => {
  const nowArr = now.split(','), beforeArr = (before ?? '').split(',')
  const justDone = run.taskStates.filter((t, i) => nowArr[i] === 'true' && beforeArr[i] !== 'true')
  if (justDone.length) openNotes.value = new Set([justDone[justDone.length - 1].id])
})

function toggleNote(id) {
  const s = new Set(openNotes.value)
  s.has(id) ? s.delete(id) : s.add(id)
  openNotes.value = s
}
function stateOf(t) { return t.done ? 'done' : t.id === run.currentTaskId ? 'current' : 'pending' }
function restart() {
  menuOpen.value = false
  if (window.confirm('Restart this Lab? The Sandbox and the Cloud Shell history will be reset. Past Lab Results are kept.')) {
    run.restart()
    openNotes.value = new Set()
  }
}
</script>

<template>
  <aside class="lab-panel" :class="{ 'lab-panel--collapsed': portal.labPanelCollapsed }" aria-label="Lab Panel">
    <template v-if="portal.labPanelCollapsed">
      <button type="button" class="lab-panel__expand" aria-label="Expand Lab Panel" @click="portal.toggleLabPanel()"><FluentIcon name="chevron-right" :size="14" /></button>
      <div class="lab-panel__rail-label">Lab · {{ run.doneCount }}/{{ run.total }}</div>
    </template>
    <LabCompletePanel v-else-if="run.isComplete" @restart="restart" />
    <template v-else>
      <div class="lab-panel__header">
        <div class="lab-panel__title-row">
          <div class="lab-panel__title">{{ run.lab.title }}</div>
          <div class="lab-panel__menu-wrap">
            <button type="button" class="lab-panel__more" aria-label="Lab options" :aria-expanded="menuOpen" @click="menuOpen = !menuOpen"><FluentIcon name="more-horizontal" :size="16" /></button>
            <div v-if="menuOpen" class="lab-panel__menu" role="menu">
              <button type="button" role="menuitem" @click="restart">Restart Lab</button>
              <button type="button" role="menuitem" @click="menuOpen = false; portal.toggleLabPanel()">Collapse panel</button>
            </div>
          </div>
        </div>
        <div class="lab-panel__chips">
          <span class="pill pill--accent pill--small">{{ area.name }} ({{ area.weight }})</span>
          <span class="pill pill--muted pill--small">{{ service.label }}</span>
        </div>
        <div class="lab-panel__progress-row"><span class="lab-panel__count">{{ run.doneCount }} of {{ run.total }} tasks</span><span class="lab-panel__timer">{{ formatDuration(run.elapsedMs) }} elapsed</span></div>
        <div class="bar"><div class="bar__fill" :style="{ width: pct + '%' }" /></div>
      </div>
      <div class="lab-panel__brief">
        <button type="button" class="lab-panel__brief-toggle" :aria-expanded="briefOpen" @click="briefOpen = !briefOpen">BRIEF <FluentIcon :name="briefOpen ? 'chevron-up' : 'chevron-down'" :size="10" /></button>
        <p v-if="briefOpen" class="lab-panel__brief-text">{{ run.lab.brief }}</p>
      </div>
      <ol class="lab-panel__tasks">
        <TaskRow v-for="t in run.taskStates" :key="t.id" :task="t" :state="stateOf(t)" :hints-revealed="run.hintsRevealed[t.id] ?? 0" :solution-revealed="!!run.solutionsRevealed[t.id]" :exam-note-open="openNotes.has(t.id)" @toggle-exam-note="toggleNote(t.id)" @reveal-hint="run.revealHint(t.id)" @reveal-solution="run.revealSolution(t.id)" />
      </ol>
      <div class="lab-panel__footer"><button type="button" class="btn btn--secondary" @click="restart">Restart Lab</button></div>
    </template>
  </aside>
</template>
