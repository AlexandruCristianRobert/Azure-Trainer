<script setup>
import { computed } from 'vue'
import { validateAnswer, validateQuestionView } from '../../lib/exam/question.js'
import SingleChoice from './SingleChoice.vue'
import MultipleResponse from './MultipleResponse.vue'
import BuildList from './BuildList.vue'
import Matching from './Matching.vue'
import DropdownQuestion from './DropdownQuestion.vue'
import StatementGrid from './StatementGrid.vue'
import HotArea from './HotArea.vue'
import ActiveScreen from './ActiveScreen.vue'
import '../../styles/exam.css'

const props = defineProps({ question: { default: null }, value: { default: () => ({}) }, disabled: Boolean })
const emit = defineEmits(['update:value'])
const widgets = {
  'single-choice': SingleChoice, 'multiple-response': MultipleResponse,
  'build-list': BuildList, matching: Matching, dropdown: DropdownQuestion,
  'statement-grid': StatementGrid, 'hot-area': HotArea, 'active-screen': ActiveScreen,
}
const widget = computed(() => {
  try {
    validateQuestionView(props.question)
    validateAnswer(props.question, props.value)
    return Object.hasOwn(widgets, props.question.kind) ? widgets[props.question.kind] : null
  } catch { return null }
})
function update(value) { if (!props.disabled && widget.value) emit('update:value', value) }
</script>

<template>
  <article v-if="widget" class="exam-question">
    <p class="exam-stem">{{ question.stem }}</p>
    <details v-for="artifact in question.artifacts" :key="artifact.id" class="exam-artifact">
      <summary>{{ artifact.kind === 'code' ? 'Code' : 'Supporting information' }}<span v-if="artifact.language"> ({{ artifact.language }})</span></summary>
      <pre v-if="artifact.kind === 'code'"><code>{{ artifact.text }}</code></pre>
      <p v-else class="exam-plain-text">{{ artifact.text }}</p>
    </details>
    <component :is="widget" :key="question.id" :question="question" :value="value" :disabled="disabled" @update:value="update" />
  </article>
  <p v-else class="exam-error" role="alert">Question cannot be displayed. Return to the question list and try again.</p>
</template>
