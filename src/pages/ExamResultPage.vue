<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useExamStore } from '../stores/exam.js'
import { byteLength } from '../lib/exam/contracts.js'
import QuestionRenderer from '../components/exam/QuestionRenderer.vue'
import QuestionFeedback from '../components/exam/QuestionFeedback.vue'
import BackupControls from '../components/exam/BackupControls.vue'
import CaseReference from '../components/exam/CaseReference.vue'
import { gradeAttempt } from '../lib/exam/grading.js'
import { EXAM_DOMAINS } from '../lib/exam/contracts.js'
const props = defineProps({ attemptId: String, store: { type: Object, default: () => useExamStore() } })
const selected = ref(''), revealed = ref(''), message = ref(''), note = ref(null)
let revealEpoch = 0
function clearReveal() { revealEpoch += 1; revealed.value = '' }
const allowed = computed(() => props.store.access({ path: '/review' }).allowed)
const attempt = computed(() => allowed.value ? props.store.snapshot?.attempts.find(a => a.id === props.attemptId) : null)
const points = computed(() => attempt.value ? gradeAttempt(attempt.value) : null)
const question = computed(() => props.store.resultQuestion(props.attemptId, selected.value))
const feedback = computed(() => revealed.value === selected.value ? props.store.resultQuestion(props.attemptId, selected.value, { feedback: true }) : null)
const noteBytes = computed(() => note.value ? byteLength(JSON.stringify(note.value)) : 0)
watch(() => [props.store, props.attemptId], () => {
  clearReveal()
  selected.value = ''
  note.value = null
  message.value = ''
}, { immediate: true, flush: 'sync' })
watch(allowed, value => { if (!value) clearReveal() }, { flush: 'sync' })
watch(attempt, value => {
  if (!value) return
  if (!value.order.includes(selected.value)) selected.value = value.order[0]
  if (!note.value) note.value = { ...(props.store.snapshot.notes.find(n => n.target.kind === 'attempt' && n.target.id === value.id) ?? props.store.makeNote({ target: { kind: 'attempt', id: value.id } })) }
}, { immediate: true })
watch(selected, clearReveal, { flush: 'sync' })
onMounted(() => { void props.store.hydrate().catch(error => { message.value = error.message }) })
async function reveal() {
  if (!allowed.value || !attempt.value) return
  const attemptId = props.attemptId, questionId = selected.value, epoch = revealEpoch
  message.value = ''
  try {
    await props.store.reviewReveal(attemptId, questionId)
    if (epoch === revealEpoch && allowed.value && props.attemptId === attemptId && selected.value === questionId
      && props.store.resultQuestion(attemptId, questionId, { feedback: true })) revealed.value = questionId
  } catch (error) { if (props.attemptId === attemptId) message.value = error.message }
}
async function saveNote() {
  if (!allowed.value || note.value?.target.kind !== 'attempt' || note.value.target.id !== props.attemptId) return
  const attemptId = props.attemptId
  message.value = ''
  note.value.snoozedUntil = note.value.status === 'snoozed' ? note.value.snoozedUntil : null
  try {
    await props.store.saveNote({ ...note.value, updatedAt: props.store.observedAt })
    if (props.attemptId === attemptId) message.value = 'Note saved. Scores are unchanged.'
  } catch (error) { if (props.attemptId === attemptId) message.value = error.message }
}
</script>

<template>
  <main class="exam-page">
    <nav class="exam-breadcrumb">
      <RouterLink to="/review/history">History</RouterLink>
      <RouterLink to="/review">Review</RouterLink>
      <RouterLink to="/exam">Exam setup</RouterLink>
    </nav>
    <h1>Saved result</h1>
    <BackupControls :store="store" />
    <p v-if="message" role="alert">{{ message }}</p>

    <template v-if="attempt">
      <p class="exam-result-score">{{ points.earned }} / {{ points.possible }} points ({{ Math.round(points.earned / points.possible * 100) }}%)</p>
      <p>Practice goal: {{ attempt.settings.practiceGoal }}%. This is practice feedback, not a prediction of certification results.</p>
      <p>{{ attempt.mode === 'mock' ? 'Mock' : 'Study' }} · {{ new Date(attempt.finishedAt).toLocaleString() }} · {{ attempt.source }} · {{ attempt.submissionReason }}</p>
      <p>Saved answers and scores are fixed. Reviewing an answer records assistance exposure separately.</p>
      <section data-score-domains><h2>Points by domain</h2><ul><li v-for="(score, domain) in points.byDomain" :key="domain">{{ EXAM_DOMAINS.includes(domain) ? domain : `Unmapped historical domain: ${domain}` }}: {{ score.earned }} / {{ score.possible }} points ({{ Math.round(score.percentage) }}%)</li></ul></section>
      <section data-score-formats><h2>Points by format</h2><ul><li v-for="(score, kind) in points.byKind" :key="kind">{{ kind }}: {{ score.earned }} / {{ score.possible }} points ({{ Math.round(score.percentage) }}%)</li></ul></section>

      <label class="exam-field">
        Question
        <select v-model="selected">
          <option v-for="(id, i) in attempt.order" :key="id" :value="id">Question {{ i + 1 }}</option>
        </select>
      </label>
      <CaseReference :groups="attempt.groups.filter(group => group.questionIds.includes(selected))" :historical="true" />
      <QuestionRenderer
        v-if="question"
        :question="question"
        :value="attempt.responses[selected] ?? {}"
        :disabled="true"
      />
      <button :disabled="store.saving || !!store.error" @click="reveal">Review answer</button>
      <QuestionFeedback
        v-if="feedback"
        :question="feedback"
        :grade="attempt.grades.find(g => g.questionId === selected)"
        :references="attempt.references"
        :permitted="true"
      />

      <section v-if="note" class="exam-note">
        <h2>Attempt note</h2>
        <label class="exam-field">
          Your note
          <textarea v-model="note.text" @change="note.text = $event.target.value" rows="4" />
        </label>
        <label class="exam-field">
          Review status
          <select v-model="note.status">
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="snoozed">Snoozed</option>
          </select>
        </label>
        <label v-if="note.status === 'snoozed'" class="exam-field">
          Snooze until
          <input type="datetime-local" @change="note.snoozedUntil = Date.parse($event.target.value)">
        </label>
        <p>{{ noteBytes }} / 8192 UTF-8 bytes for the whole saved note. Notes and status never change scores.</p>
        <button :disabled="store.saving || !!store.error || noteBytes > 8192" @click="saveNote">Save note</button>
      </section>
    </template>
    <p v-else-if="store.ready">This result is unavailable, or an unfinished Mock blocks answer review.</p>
  </main>
</template>
