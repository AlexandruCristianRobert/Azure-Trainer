<script setup>
import { ref, watch } from 'vue'
import { applyAnswerEdit } from '../../lib/exam/question.js'
const props = defineProps({ question: { type: Object, required: true }, value: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:value'])
const selectedCandidate = ref('')
watch(() => props.question.id, () => { selectedCandidate.value = '' })
function chosen(componentId) { return Object.hasOwn(props.value, componentId) ? props.value[componentId] : '' }
function select(candidateId) { if (!props.disabled) selectedCandidate.value = candidateId }
function move(componentId, toComponentId) {
  if (props.disabled || componentId === toComponentId || !chosen(componentId)) return
  emit('update:value', applyAnswerEdit(props.question, props.value, { type: 'move', componentId, toComponentId }))
}
function moveAdjacent(index, direction) {
  if (props.disabled) return
  const destination = props.question.components[index + direction]
  if (destination) move(props.question.components[index].id, destination.id)
}
function assign(componentId, candidateId) {
  if (props.disabled) return
  if (!candidateId) { remove(componentId); return }
  if (!props.question.presentation.candidates.some((candidate) => candidate.id === candidateId)) return
  const source = props.question.components.find((component) => chosen(component.id) === candidateId)
  if (source) move(source.id, componentId)
  else emit('update:value', applyAnswerEdit(props.question, props.value, { type: 'assign', componentId, candidateId }))
}
function remove(componentId) {
  if (props.disabled || !chosen(componentId)) return
  emit('update:value', applyAnswerEdit(props.question, props.value, { type: 'remove', componentId }))
}
function drag(event, candidateId) {
  if (props.disabled) return
  event.dataTransfer?.setData('text/plain', candidateId)
}
function dragover(event) { if (!props.disabled) event.preventDefault() }
function drop(event, componentId) {
  if (props.disabled) return
  const candidateId = event.dataTransfer?.getData('text/plain') ?? ''
  if (!props.question.presentation.candidates.some((candidate) => candidate.id === candidateId)) return
  event.preventDefault()
  assign(componentId, candidateId)
}
function reorderKey(event, index) {
  if (props.disabled || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
  const destination = index + (event.key === 'ArrowUp' ? -1 : 1)
  if (destination < 0 || destination >= props.question.components.length || !chosen(props.question.components[index].id)) return
  event.preventDefault()
  move(props.question.components[index].id, props.question.components[destination].id)
}
</script>
<template>
  <div class="exam-panes">
    <section class="exam-candidates" aria-label="Available actions">
      <h3>Available actions</h3>
      <p class="exam-hint">Choose an action, then place it in a slot. You can also drag actions into slots.</p>
      <ul class="exam-candidate-list">
        <li v-for="candidate in question.presentation.candidates" :key="candidate.id">
          <button type="button" :draggable="!disabled" :disabled="disabled" :aria-pressed="selectedCandidate === candidate.id" @click="select(candidate.id)" @dragstart="drag($event, candidate.id)">{{ candidate.label }}</button>
        </li>
      </ul>
    </section>
    <section aria-label="Ordered actions">
      <h3>Ordered actions</h3>
      <p class="exam-hint">Use Move up or Move down to reorder. Alt + Arrow up or down works in each slot.</p>
      <ol class="exam-slots">
        <li v-for="(slot, index) in question.presentation.slots" :key="slot.componentId" :data-slot="slot.componentId" @dragover="dragover" @drop="drop($event, slot.componentId)" @keydown="reorderKey($event, index)">
          <label class="exam-field"><span>{{ slot.label }}</span>
            <select :aria-label="slot.label" :name="slot.componentId" :value="chosen(slot.componentId)" :disabled="disabled" @change="assign(slot.componentId, $event.target.value)">
              <option value="">Choose an action</option>
              <option v-for="candidate in question.presentation.candidates" :key="candidate.id" :value="candidate.id">{{ candidate.label }}</option>
            </select>
          </label>
          <div class="exam-actions">
            <button type="button" :aria-label="`Place selected action in ${slot.label}`" :disabled="disabled || !selectedCandidate" @click="assign(slot.componentId, selectedCandidate)">Place selected action</button>
            <button type="button" :aria-label="`Move ${slot.label} up`" :disabled="disabled || index === 0 || !chosen(slot.componentId)" @click="moveAdjacent(index, -1)">Move up</button>
            <button type="button" :aria-label="`Move ${slot.label} down`" :disabled="disabled || index === question.components.length - 1 || !chosen(slot.componentId)" @click="moveAdjacent(index, 1)">Move down</button>
            <button type="button" :aria-label="`Remove ${slot.label}`" :disabled="disabled || !chosen(slot.componentId)" @click="remove(slot.componentId)">Remove</button>
          </div>
        </li>
      </ol>
    </section>
  </div>
</template>
