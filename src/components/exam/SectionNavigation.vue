<script setup>
import { computed } from 'vue'
const props = defineProps({ presentation: { type: Object, required: true }, disabled: Boolean })
defineEmits(['visit'])
const sections = computed(() => props.presentation.mode === 'study' ? props.presentation.sections : [props.presentation.sections[props.presentation.cursor.sectionIndex]])
</script>
<template><nav class="exam-section-nav" aria-label="Section review"><section v-for="section in sections" :key="section.id"><h2>{{ section.kind === 'standalone' ? 'Questions' : section.kind === 'case' ? 'Case questions' : 'No-return series' }}</h2><div class="exam-question-grid"><button v-for="id in section.questionIds" :key="id" type="button" :aria-current="presentation.currentQuestionId === id ? 'step' : undefined" :disabled="disabled || (presentation.mode === 'mock' && (presentation.sealedIds.includes(id) || section.kind === 'series'))" @click="$emit('visit', id)">{{ presentation.order.indexOf(id) + 1 }}<span>{{ presentation.submittedIds.includes(id) ? 'Submitted' : presentation.answers[id] && Object.keys(presentation.answers[id]).length ? 'Draft' : 'Unanswered' }}{{ presentation.flags.includes(id) ? ', flagged' : '' }}{{ presentation.sealedIds.includes(id) ? ', sealed' : '' }}</span></button></div></section></nav></template>
