<script setup>
import { computed, ref } from 'vue'
import { renderInline } from '../../lib/inlineCode.js'
import FluentIcon from '../icons/FluentIcon.vue'
import HintBox from './HintBox.vue'
import ExamNote from './ExamNote.vue'
import { useLabRunStore } from '../../stores/labRun.js'

const props = defineProps({
  task: { type: Object, required: true },
  state: { type: String, required: true },
  hintsRevealed: { type: Number, default: 0 },
  solutionRevealed: { type: Boolean, default: false },
  examNoteOpen: { type: Boolean, default: false },
  helpDisabled: { type: Boolean, default: false },
})
const emit = defineEmits(['toggle-exam-note', 'reveal-hint', 'reveal-solution'])
const run = useLabRunStore()
const fileContent = step => run.lab?.capabilities?.dataCapstone && step.kind === 'file' && typeof step.resolver === 'function'
  ? step.resolver(run.behavioralRun) : step.content
const copied = ref(false)
const nextHint = computed(() => props.hintsRevealed + 1)
const steps = computed(() => typeof props.task.solution === 'string' ? null : props.task.solution?.steps ?? [])
const alternatives = computed(() => props.task.solution?.alternatives ?? [])
const stepText = (step) => {
  if (step.kind === 'command') return step.resolver && step.instruction ? `${step.instruction}\n${step.line ?? ''}`.trim() : step.line ?? step.instruction ?? ''
  if (step.kind === 'file') return `${step.path}\n${fileContent(step)}`
  if (step.kind === 'action' && run.lab?.capabilities?.dataCapstone) return step.instruction
  if (step.kind === 'scenario') return step.instruction ?? step.command ?? `Run ${step.scenarioId} in Experiments.`
  if (step.kind === 'advance') return step.instruction ?? `Advance the AKS simulation by ${step.seconds} seconds using the experiment controls.`
  if (step.kind === 'aks-resource-next-incident') return step.instruction ?? 'Continue to the next resource incident in Experiments.'
  if (step.kind === 'inspect') return step.instruction ?? step.command ?? 'Inspect the current experiment results and workload state.'
  return `Send ${step.request.method} ${step.request.path} to ${step.request.appId.split('/').at(-1)}. Expect HTTP ${step.expected?.status}.`
}
const stepLabel = (step) => step.kind === 'command' ? 'Cloud Shell' : step.kind === 'file' ? `Files · ${step.path}`
  : step.kind === 'inspect' ? 'Inspect' : step.kind === 'scenario' ? 'Experiments' : 'Experiments'
const stepCode = (step) => step.kind === 'file' ? fileContent(step) : step.kind === 'command' ? step.line ?? null : null
async function copySolution() {
  const value = typeof props.task.solution === 'string' ? props.task.solution
    : [steps.value.map(stepText).join('\n'), ...alternatives.value.map(alternative => `${alternative.title}\n${alternative.steps.map(stepText).join('\n')}`)].join('\n\n')
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
      <p v-if="task.explanation" class="task__explanation task__indent">{{ task.explanation }}</p>
      <HintBox v-for="i in hintsRevealed" :key="i" class="task__indent" :index="i" :total="task.hints.length" :text="task.hints[i - 1]" />
      <div v-if="solutionRevealed" class="solution task__indent">
        <div class="solution__head"><span class="solution__label">SOLUTION</span><button type="button" class="solution__copy" @click="copySolution">{{ copied ? 'Copied' : 'Copy' }}</button></div>
        <pre v-if="!steps" class="solution__code">{{ task.solution }}</pre>
        <ol v-else class="solution__steps"><li v-for="(step, i) in steps" :key="i"><strong>{{ stepLabel(step) }}</strong><p v-if="step.kind === 'command' && step.resolver && step.instruction" class="solution__instruction">{{ step.instruction }}</p><pre v-if="stepCode(step)">{{ stepCode(step) }}</pre><p v-else>{{ stepText(step) }}</p></li></ol>
        <section v-for="(alternative, index) in alternatives" :key="index" :aria-label="alternative.title">
          <h4>{{ alternative.title }}</h4>
          <ol class="solution__steps"><li v-for="(step, i) in alternative.steps" :key="i"><strong>{{ stepLabel(step) }}</strong><p v-if="step.kind === 'command' && step.resolver && step.instruction" class="solution__instruction">{{ step.instruction }}</p><pre v-if="stepCode(step)">{{ stepCode(step) }}</pre><p v-else>{{ stepText(step) }}</p></li></ol>
        </section>
      </div>
      <div class="task__actions task__indent">
        <button v-if="hintsRevealed < task.hints.length" type="button" class="task__hint-link" :disabled="helpDisabled" @click="emit('reveal-hint')">Show hint {{ nextHint }}</button>
        <button v-if="!solutionRevealed" type="button" class="task__solution-btn" :disabled="helpDisabled" @click="emit('reveal-solution')">Show solution</button>
      </div>
    </template>
  </li>
</template>
