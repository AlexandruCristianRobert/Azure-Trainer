<script setup>
import { ref, watch } from 'vue'
import { applyAnswerEdit } from '../../lib/exam/question.js'
const props = defineProps({ question: { type: Object, required: true }, value: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:value'])
const selectedCandidate = ref('')
watch(() => props.question.id, () => { selectedCandidate.value = '' })
function chosen(componentId) { return Object.hasOwn(props.value, componentId) ? props.value[componentId] : '' }
function select(candidateId) { if (!props.disabled) selectedCandidate.value = candidateId }
function assign(componentId, candidateId) {
  if (props.disabled) return
  if (!candidateId) { remove(componentId); return }
  if (!props.question.presentation.candidates.some((candidate) => candidate.id === candidateId)) return
  let answer = props.value
  if (!props.question.presentation.allowReuse) {
    const source = props.question.components.find((component) => component.id !== componentId && chosen(component.id) === candidateId)
    if (source) answer = applyAnswerEdit(props.question, answer, { type: 'remove', componentId: source.id })
  }
  emit('update:value', applyAnswerEdit(props.question, answer, { type: 'assign', componentId, candidateId }))
}
function remove(componentId) {
  if (props.disabled || !chosen(componentId)) return
  emit('update:value', applyAnswerEdit(props.question, props.value, { type: 'remove', componentId }))
}
function drag(event, candidateId) {
  if (!props.disabled) event.dataTransfer?.setData('text/plain', candidateId)
}
function dragover(event) { if (!props.disabled) event.preventDefault() }
function drop(event, componentId) {
  if (props.disabled) return
  const candidateId = event.dataTransfer?.getData('text/plain') ?? ''
  if (!props.question.presentation.candidates.some((candidate) => candidate.id === candidateId)) return
  event.preventDefault()
  assign(componentId, candidateId)
}
</script>
<template>
  <div>
    <p class="exam-hint">{{ question.presentation.allowReuse ? 'Candidates may be used more than once.' : 'Each candidate can be used once. Assigning it elsewhere moves its match.' }}</p>
    <div class="exam-panes">
      <section class="exam-candidates" aria-label="Candidates">
        <h3>Candidates</h3>
        <p class="exam-hint">Choose a candidate and assign it, use a target menu, or drag it to a target.</p>
        <ul class="exam-candidate-list">
          <li v-for="candidate in question.presentation.candidates" :key="candidate.id">
            <button type="button" :draggable="!disabled" :disabled="disabled" :aria-pressed="selectedCandidate === candidate.id" @click="select(candidate.id)" @dragstart="drag($event, candidate.id)">{{ candidate.label }}</button>
          </li>
        </ul>
      </section>
      <section aria-label="Match targets">
        <h3>Match targets</h3>
        <ul class="exam-targets">
          <li v-for="target in question.presentation.targets" :key="target.componentId" :data-target="target.componentId" @dragover="dragover" @drop="drop($event, target.componentId)">
            <label class="exam-field"><span>{{ target.label }}</span>
              <select :aria-label="target.label" :name="target.componentId" :value="chosen(target.componentId)" :disabled="disabled" @change="assign(target.componentId, $event.target.value)">
                <option value="">Choose a match</option>
                <option v-for="candidate in question.presentation.candidates" :key="candidate.id" :value="candidate.id">{{ candidate.label }}</option>
              </select>
            </label>
            <div class="exam-actions">
              <button type="button" :aria-label="`Assign selected candidate to ${target.label}`" :disabled="disabled || !selectedCandidate" @click="assign(target.componentId, selectedCandidate)">Assign selected candidate</button>
              <button type="button" :aria-label="`Remove ${target.label}`" :disabled="disabled || !chosen(target.componentId)" @click="remove(target.componentId)">Remove</button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
