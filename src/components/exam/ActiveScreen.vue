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
  <fieldset class="exam-screen" :disabled="disabled">
    <legend>{{ question.presentation.title }}</legend>
    <label v-for="field in question.presentation.fields" :key="field.componentId" class="exam-field"><span>{{ field.label }}</span>
      <select :aria-label="field.label" :name="field.componentId" :value="chosen(field.componentId)" :disabled="disabled" @change="choose(field.componentId, $event.target.value)">
        <option value="">Choose a setting</option>
        <option v-for="candidate in candidates(field.componentId)" :key="candidate.id" :value="candidate.id">{{ candidate.label }}</option>
      </select>
    </label>
  </fieldset>
</template>
