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
  helpDisabled: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle-exam-note', 'reveal-hint', 'reveal-solution'])
const copied = ref(false)
const nextHint = computed(() => props.hintsRevealed + 1)
const steps = computed(() => typeof props.task.solution === 'string' ? null : props.task.solution?.steps ?? [])
const stepText = (step) => step.kind === 'command' ? step.line : step.kind === 'file' ? `${step.path}\n${step.content}`
  : step.kind === 'scenario' ? step.instruction : `Send ${step.request.method} ${step.request.path} to ${step.request.appId.split('/').at(-1)}. Expect HTTP ${step.expected?.status}.`
async function copySolution() {
  const value = typeof props.task.solution === 'string' ? props.task.solution : steps.value.map(stepText).join('\n')
  try { await navigator.clipboard.writeText(value); copied.value = true; setTimeout(() => { copied.value = false }, 1500) } catch { /* clipboard unavailable */ }
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
        <span v-if="task.status === 'needs-verification'" class="task__verification">Needs verification — rerun the verification.</span>
        <button v-if="state === 'done'" type="button" class="task__note-toggle" :aria-expanded="examNoteOpen" @click="emit('toggle-exam-note')">Exam Note <FluentIcon :name="examNoteOpen ? 'chevron-down' : 'chevron-right'" :size="9" /></button>
      </div>
    </div>
    <ExamNote v-if="state === 'done' && examNoteOpen" class="task__indent" :text="task.examNote" />
    <template v-if="state === 'current'">
      <HintBox v-for="i in hintsRevealed" :key="i" class="task__indent" :index="i" :total="task.hints.length" :text="task.hints[i - 1]" />
      <div v-if="solutionRevealed" class="solution task__indent">
        <div class="solution__head"><span class="solution__label">SOLUTION</span><button type="button" class="solution__copy" @click="copySolution">{{ copied ? 'Copied' : 'Copy' }}</button></div>
        <pre v-if="!steps" class="solution__code">{{ task.solution }}</pre>
        <ol v-else class="solution__steps"><li v-for="(step, i) in steps" :key="i"><strong>{{ step.kind === 'command' ? 'Cloud Shell' : step.kind === 'file' ? `Files · ${step.path}` : 'Experiments' }}</strong><pre v-if="step.kind === 'command' || step.kind === 'file'">{{ step.line ?? step.content }}</pre><p v-else>{{ stepText(step) }}</p></li></ol>
      </div>
      <div class="task__actions task__indent">
        <button v-if="hintsRevealed < task.hints.length" type="button" class="task__hint-link" :disabled="helpDisabled" @click="emit('reveal-hint')">Show hint {{ nextHint }}</button>
        <button v-if="!solutionRevealed" type="button" class="task__solution-btn" :disabled="helpDisabled" @click="emit('reveal-solution')">Show solution</button>
      </div>
    </template>
  </li>
</template>
