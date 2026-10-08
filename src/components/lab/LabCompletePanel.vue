<script setup>
import { computed } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { useProgressStore } from '../../stores/progress.js'
import { formatDuration, formatClock } from '../../lib/format.js'
import { renderInline } from '../../lib/inlineCode.js'
import { taskExamNote } from '../../lib/taskExamNote.js'
import { nextLabFor } from '../../data/labs/index.js'
import FluentIcon from '../icons/FluentIcon.vue'
defineProps({ error: { type: String, default: '' } })

const run = useLabRunStore()
const progress = useProgressStore()
const emit = defineEmits(['restart'])
const result = computed(() => progress.allResults.find((r) => r.id === run.resultId) ?? progress.latestResult(run.labId))
const nextLab = computed(() => nextLabFor(run.lab))
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
</script>

<template>
  <div class="lab-complete">
    <div class="lab-complete__header">
      <div class="lab-complete__title-row"><span class="lab-complete__check"><FluentIcon name="checkmark" :size="11" /></span><span class="lab-complete__title">Lab complete</span></div>
      <div class="lab-complete__lab">{{ run.lab.title }}</div>
      <div class="lab-panel__progress-row"><span class="lab-panel__count">{{ run.total }} of {{ run.total }} tasks</span><span class="lab-panel__timer lab-panel__timer--dark">{{ formatDuration(result?.durationMs ?? run.elapsedMs) }}</span></div>
      <div class="bar bar--success"><div class="bar__fill" style="width: 100%" /></div>
      <div v-if="result" class="lab-complete__result">Lab Result &nbsp;·&nbsp; Duration {{ formatDuration(result.durationMs) }} &nbsp;·&nbsp; Finished {{ formatClock(result.finishedAt) }} &nbsp;·&nbsp; <strong>{{ plural(result.hintsUsed, 'hint') }} · {{ plural(result.solutionsUsed, 'solution') }}</strong></div>
    </div>
    <div class="lab-complete__notes">
      <div class="lab-complete__notes-label">EXAM NOTES</div>
      <ol class="lab-complete__list">
        <li v-for="(t, i) in run.lab.tasks" :key="t.id" class="lab-complete__note"><span class="lab-complete__num">{{ i + 1 }}</span><span v-html="renderInline(taskExamNote(t))" /></li>
      </ol>
    </div>
    <div class="lab-complete__actions">
      <p v-if="error" role="alert">{{ error }}</p>
      <RouterLink class="btn btn--primary btn--block" to="/">Back to Home</RouterLink>
      <button type="button" class="btn btn--secondary btn--block" @click="emit('restart')">Restart Lab</button>
      <RouterLink v-if="nextLab?.status === 'available'" class="btn btn--secondary btn--block lab-complete__next" :to="`/lab/${nextLab.id}`">
        <span>Next Lab: {{ nextLab.title }}</span>
      </RouterLink>
      <button v-else-if="nextLab" type="button" class="btn btn--disabled btn--block lab-complete__next" disabled>
        <span>Next Lab: {{ nextLab?.title }}</span><span class="lab-complete__soon">Coming soon</span>
      </button>
    </div>
  </div>
</template>
