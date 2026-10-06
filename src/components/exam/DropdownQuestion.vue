<script setup>
import { applyAnswerEdit } from '../../lib/exam/question.js'
const props = defineProps({ question: { type: Object, required: true }, value: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:value'])
function chosen(id) { return Object.hasOwn(props.value, id) ? props.value[id] : '' }
function candidates(componentId) {
  const component = props.question.components.find((item) => item.id === componentId)
  return props.question.presentation.candidates.filter((candidate) => component.candidateIds.includes(candidate.id))
}
function choose(componentId, candidateId) {
  if (props.disabled) return
  emit('update:value', applyAnswerEdit(props.question, props.value, candidateId ? { type: 'assign', componentId, candidateId } : { type: 'remove', componentId }))
}
</script>
<template>
  <div class="exam-dropdown" role="group" aria-label="Complete the statement">
    <template v-for="(segment, index) in question.presentation.segments" :key="index">
      <span v-if="segment.type === 'text'" class="exam-plain-text">{{ segment.text }}</span>
      <label v-else class="exam-inline-field"><span>{{ segment.label }}</span>
        <select :aria-label="segment.label" :name="segment.componentId" :value="chosen(segment.componentId)" :disabled="disabled" @change="choose(segment.componentId, $event.target.value)">
          <option value="">Choose an answer</option>
          <option v-for="candidate in candidates(segment.componentId)" :key="candidate.id" :value="candidate.id">{{ candidate.label }}</option>
        </select>
      </label>
    </template>
  </div>
</template>
