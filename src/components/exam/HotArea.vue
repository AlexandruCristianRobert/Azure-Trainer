<script setup>
import { applyAnswerEdit } from '../../lib/exam/question.js'
const props = defineProps({ question: { type: Object, required: true }, value: { type: Object, default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:value'])
function selected(id) { return Object.hasOwn(props.value, props.question.components[0].id) && props.value[props.question.components[0].id].includes(id) }
function toggle(candidateId) {
  if (props.disabled) return
  emit('update:value', applyAnswerEdit(props.question, props.value, { type: 'toggle', componentId: props.question.components[0].id, candidateId }))
}
function geometry(region) { return { left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` } }
</script>
<template>
  <div class="exam-hot-area">
    <p class="exam-hint">{{ question.components[0].requiredCount === null ? 'Select all regions that apply.' : `Select ${question.components[0].requiredCount} regions.` }} Use the diagram or the equivalent list below.</p>
    <div class="exam-diagram" role="group" :aria-label="question.presentation.label">
      <button v-for="region in question.presentation.regions" :key="region.id" type="button" class="exam-region" :style="geometry(region)" :aria-label="region.label" :aria-pressed="selected(region.id)" :disabled="disabled" @click="toggle(region.id)">{{ region.label }}</button>
    </div>
    <fieldset class="exam-options" :disabled="disabled">
      <legend>{{ question.presentation.label }}: region list</legend>
      <label v-for="region in question.presentation.regions" :key="region.id" class="exam-choice">
        <input type="checkbox" :value="region.id" :checked="selected(region.id)" :disabled="disabled" @change="toggle(region.id)">
        <span>{{ region.label }}</span>
      </label>
    </fieldset>
  </div>
</template>
