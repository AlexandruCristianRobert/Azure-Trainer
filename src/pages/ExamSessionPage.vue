<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useExamStore } from '../stores/exam.js'
import QuestionRenderer from '../components/exam/QuestionRenderer.vue'
import QuestionFeedback from '../components/exam/QuestionFeedback.vue'
import SectionNavigation from '../components/exam/SectionNavigation.vue'
import CaseReference from '../components/exam/CaseReference.vue'
import ExamTimer from '../components/exam/ExamTimer.vue'
import BackupControls from '../components/exam/BackupControls.vue'
const props = defineProps({ sessionId: String, store: { type: Object, default: () => useExamStore() } })
const router = useRouter(), route = useRoute(), message = ref('')
const view = computed(() => props.store.presentation)
const question = computed(() => view.value?.questions?.find(q => q.id === view.value.currentQuestionId))
const section = computed(() => view.value?.sections?.[view.value.cursor.sectionIndex])
const blocked = computed(() => !!props.store.error || props.store.saving || view.value?.status !== 'active')
watch(() => props.sessionId, id => props.store.selectSession(id), { immediate: true })
onMounted(() => { void props.store.hydrate().catch(error => { message.value = error.message }) })
async function act(action) {
  message.value = ''
  try { const result = await props.store.dispatch(action, { sessionId: props.sessionId }); if (result.session.status === 'finished') await router.replace(`/exam/results/${result.attempt.id}`) }
  catch (error) { message.value = error.message }
}
watch(() => view.value?.status, status => { if (status === 'finished') void router.replace(`/exam/results/${view.value.attemptId}`) })
</script>
<template><main class="exam-page">
  <nav class="exam-breadcrumb" aria-label="Exam navigation"><RouterLink to="/exam">Exam setup</RouterLink><RouterLink to="/">Home</RouterLink><RouterLink to="/review">Review</RouterLink></nav>
  <h1>{{ view?.mode === 'mock' ? 'Mock exam' : 'Study session' }}</h1>
  <BackupControls :store="store" />
  <p v-if="message" role="alert">{{ message }}</p>
  <template v-if="view && view.status !== 'finished'">
    <div class="exam-session-toolbar"><ExamTimer :store="store" /><a href="https://learn.microsoft.com/" target="_blank" rel="noopener noreferrer">Microsoft Learn</a></div>
    <p v-if="view.mode === 'mock'">The deadline continues during breaks, in Labs, on Home and while Microsoft Learn is open. Finishing records unanswered items as omissions.</p>
    <p>Saved progress: {{ view.summary.answered }} answered, {{ view.summary.unanswered }} unanswered, {{ view.summary.flagged }} flagged. Practice goal: {{ view.settings.practiceGoal }}%.</p>
    <p v-if="route.query.preferred">Targeted selection: {{ route.query.preferred }} preferred fresh items and {{ route.query.familiar ?? 0 }} additional items, which may include familiar families. Repeated exposure is tracked separately from independent evidence.</p>
    <p v-if="view.status === 'expired'" role="alert">Time has expired. Inputs are disabled while pending answers and the final result are saved.</p>
    <section v-else-if="view.status === 'break'"><h2>On break</h2><p>Seen questions in this section are sealed. The clock keeps running.</p><button :disabled="store.saving || !!store.error" @click="act({ type: 'resumeBreak' })">Resume exam</button></section>
    <div v-else class="exam-session-layout">
      <SectionNavigation :presentation="view" :disabled="blocked" @visit="questionId => act({ type: 'visit', questionId })" />
      <section class="exam-work"><CaseReference :groups="view.groups" />
        <h2>Question {{ view.order.indexOf(view.currentQuestionId) + 1 }} of {{ view.order.length }}</h2>
        <QuestionRenderer v-if="question" :question="question" :value="store.widgetValue(question.id, sessionId)" :disabled="!view.editable" @update:value="answer => act({ type: 'answer', questionId: question.id, answer })" />
        <div v-if="question" class="exam-metadata"><label><input type="checkbox" :checked="view.flags.includes(question.id)" :disabled="!view.editable || store.saving" @change="act({ type: 'flag', questionId: question.id, flagged: $event.target.checked })">Flag for section review</label><label>Confidence<select :value="view.confidence[question.id] ?? 'unset'" :disabled="!view.editable || store.saving" @change="act({ type: 'confidence', questionId: question.id, value: $event.target.value })"><option value="unset">Unset</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label></div>
        <div class="exam-actions">
          <button :disabled="blocked || (view.mode === 'mock' && section.kind === 'series') || (view.mode === 'study' ? view.order.indexOf(view.currentQuestionId) === 0 : view.cursor.questionIndex === 0)" @click="act({ type: 'back' })">Previous question</button>
          <button :disabled="blocked || (view.mode === 'study' ? view.order.indexOf(view.currentQuestionId) === view.order.length - 1 : view.cursor.questionIndex === section.questionIds.length - 1)" @click="act({ type: 'next' })">Next question</button>
          <template v-if="view.mode === 'study'"><button :disabled="blocked || view.submittedIds.includes(view.currentQuestionId)" @click="act({ type: 'submitQuestion' })">Submit question</button><button :disabled="blocked" @click="act({ type: 'reveal' })">Reveal answer</button></template>
          <template v-else><button :disabled="blocked || section.sealed || (section.kind === 'series' && view.cursor.questionIndex !== section.questionIds.length - 1)" @click="act({ type: 'sealSection' })">Seal section</button><button :disabled="blocked || section.kind === 'series' || section.sealed" @click="act({ type: 'break' })">Take break</button></template>
        </div>
        <p v-if="view.mode === 'mock'">Sealing is final: you cannot return to this section. A break seals every question you have seen in this section.</p>
        <QuestionFeedback v-if="view.feedback" :question="view.feedback.question" :grade="view.feedback.grade" :references="view.references" :permitted="true" />
      </section>
    </div>
    <button :disabled="!!store.error || store.saving || view.status === 'expired'" @click="act({ type: 'finish' })">Finish session</button>
  </template>
  <p v-else-if="store.ready && !view">This session is not available. Open exam setup or import a backup.</p>
</main></template>
