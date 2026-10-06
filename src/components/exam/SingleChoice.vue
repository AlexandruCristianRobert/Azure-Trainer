<script setup>
import { useId } from 'vue'
import { applyAnswerEdit } from '../../lib/exam/question.js'
const props = defineProps({ question: { type: Object, required: true }, value: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:value'])
const name = useId()
function choose(candidateId) {
  if (props.disabled) return
  emit('update:value', applyAnswerEdit(props.question, props.value, { type: 'assign', componentId: props.question.components[0].id, candidateId }))
}
</script>
<template>
  <fieldset class="exam-options" :disabled="disabled">
    <legend>Choose one answer</legend>
    <label v-for="choice in question.presentation.choices" :key="choice.id" class="exam-choice">
      <input type="radio" :name="name" :value="choice.id" :checked="value[question.components[0].id] === choice.id" :disabled="disabled" @change="choose(choice.id)">
      <span>{{ choice.label }}</span>
    </label>
  </fieldset>
</template>
