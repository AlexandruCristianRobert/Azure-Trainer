<script setup>
import { computed, ref } from 'vue'
import { renderInline } from '../../lib/inlineCode.js'
import FluentIcon from '../icons/FluentIcon.vue'
import HintBox from './HintBox.vue'
import ExamNote from './ExamNote.vue'

const props = defineProps({
  task: { type: Object, required: true },
  state: { type: String, required: true },
  hintsRevealed: { type: Number, default: 0 },
  solutionRevealed: { type: Boolean, default: false },
  examNoteOpen: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle-exam-note', 'reveal-hint', 'reveal-solution'])
const copied = ref(false)
const nextHint = computed(() => props.hintsRevealed + 1)
async function copySolution() {
  try { await navigator.clipboard.writeText(props.task.solution); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* clipboard unavailable */ }
}
</script>

<template>
  <li class="task" :class="`task--${state}`">
    <div class="task__row">
      <span v-if="state === 'done'" class="task__mark task__mark--done" aria-label="Done"><FluentIcon name="checkmark" :size="10" /></span>
      <span v-else-if="state === 'current'" class="task__mark task__mark--current">{{ task.index + 1 }}</span>
      <span v-else class="task__mark task__mark--pending" />
      <div class="task__text">
        <span v-html="renderInline(task.text)" />
        <button v-if="state === 'done'" type="button" class="task__note-toggle" :aria-expanded="examNoteOpen" @click="emit('toggle-exam-note')">Exam Note <FluentIcon :name="examNoteOpen ? 'chevron-down' : 'chevron-right'" :size="9" /></button>
      </div>
    </div>
    <ExamNote v-if="state === 'done' && examNoteOpen" class="task__indent" :text="task.examNote" />
    <template v-if="state === 'current'">
      <HintBox v-for="i in hintsRevealed" :key="i" class="task__indent" :index="i" :total="task.hints.length" :text="task.hints[i - 1]" />
      <div v-if="solutionRevealed" class="solution task__indent">
        <div class="solution__head"><span class="solution__label">SOLUTION</span><button type="button" class="solution__copy" @click="copySolution">{{ copied ? 'Copied' : 'Copy' }}</button></div>
        <pre class="solution__code">{{ task.solution }}</pre>
      </div>
      <div class="task__actions task__indent">
        <button v-if="hintsRevealed < task.hints.length" type="button" class="task__hint-link" @click="emit('reveal-hint')">Show hint {{ nextHint }}</button>
        <button v-if="!solutionRevealed" type="button" class="task__solution-btn" @click="emit('reveal-solution')">Show solution</button>
      </div>
    </template>
  </li>
</template>
