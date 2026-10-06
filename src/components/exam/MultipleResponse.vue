<script setup>
import { applyAnswerEdit } from '../../lib/exam/question.js'
const props = defineProps({ question: { type: Object, required: true }, value: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:value'])
function selected(id) { return Object.hasOwn(props.value, props.question.components[0].id) && props.value[props.question.components[0].id].includes(id) }
function toggle(candidateId) {
  if (props.disabled) return
  emit('update:value', applyAnswerEdit(props.question, props.value, { type: 'toggle', componentId: props.question.components[0].id, candidateId }))
}
</script>
<template>
  <fieldset class="exam-options" :disabled="disabled">
    <legend>{{ question.components[0].requiredCount === null ? 'Select all that apply' : `Select ${question.components[0].requiredCount} answers` }}</legend>
    <label v-for="choice in question.presentation.choices" :key="choice.id" class="exam-choice">
      <input type="checkbox" :value="choice.id" :checked="selected(choice.id)" :disabled="disabled" @change="toggle(choice.id)">
      <span>{{ choice.label }}</span>
    </label>
  </fieldset>
</template>
