<script setup>
import { useId } from 'vue'
import { applyAnswerEdit } from '../../lib/exam/question.js'
const props = defineProps({ question: { type: Object, required: true }, value: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:value'])
const name = useId()
function choose(componentId, candidateId) {
  if (props.disabled) return
  emit('update:value', applyAnswerEdit(props.question, props.value, { type: 'assign', componentId, candidateId }))
}
</script>
<template>
  <div class="exam-grid">
    <fieldset v-for="row in question.presentation.rows" :key="row.componentId" class="exam-grid-row" :disabled="disabled">
      <legend>{{ row.label }}</legend>
      <label v-for="choice in question.presentation.choices" :key="choice.id" class="exam-choice">
        <input type="radio" :name="`${name}-${row.componentId}`" :value="choice.id" :checked="Object.hasOwn(value, row.componentId) && value[row.componentId] === choice.id" :disabled="disabled" @change="choose(row.componentId, choice.id)">
        <span>{{ choice.label }}</span>
      </label>
    </fieldset>
  </div>
</template>
