<script setup>
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { useExamStore } from '../stores/exam.js'
import { EXAM_CONCEPTS } from '../data/exam/index.js'
import { computeReview, recommendPractice } from '../lib/exam/review.js'
import { readLabProgress } from '../lib/exam/labProgress.js'
import { bankCoverage } from '../lib/exam/bankValidation.js'
import ReviewRecommendation from '../components/exam/ReviewRecommendation.vue'
import BackupControls from '../components/exam/BackupControls.vue'
import '../styles/exam.css'
const props = defineProps({ store: { type: Object, default: () => useExamStore() }, labProgress: Object })
const router = useRouter(), progress = shallowRef(props.labProgress ?? null), message = ref(''), shorter = ref(null)
const allowed = computed(() => props.store.access({ path: '/review' }).allowed)
const review = computed(() => props.store.ready && allowed.value ? computeReview({ attempts: props.store.snapshot.attempts, activeSessions: props.store.snapshot.sessions.filter(s => s.status !== 'finished') }) : null)
const labIds = EXAM_CONCEPTS.flatMap(c => c.labIds)
const recommendations = computed(() => review.value && props.store.bank ? recommendPractice(review.value, { bank: props.store.bank, labProgress: progress.value ? readLabProgress(progress.value, labIds) : [], notes: props.store.snapshot.notes, now: props.store.observedAt }) : [])
const coverage = computed(() => props.store.bank ? bankCoverage(props.store.bank) : null)
onMounted(async () => {
  try {
    await props.store.hydrate(); await props.store.loadBank()
    if (!props.labProgress) {
      const { useProgressStore } = await import('../stores/progress.js'); progress.value = useProgressStore()
      // Opening a missing native Lab DB would create its schema. Review is read-only.
      async function unavailable(reason) {
        const fail = async () => { throw new Error(reason) }
        await progress.value.hydrateNative({ repository: { listRuns: fail, listResults: fail } })
      }
      let databases
      try {
        if (typeof globalThis.indexedDB?.databases !== 'function') throw new Error('This browser cannot inspect existing Lab storage without opening it. Lab context is unavailable.')
        databases = await globalThis.indexedDB.databases()
      } catch (error) { await unavailable(error.message); return }
      const nativeDatabase = databases.find(db => db.name === 'azure-trainer-behavioral')
      if (nativeDatabase && nativeDatabase.version !== 1) await unavailable('The existing Lab database version is unavailable for read-only review.')
      else if (nativeDatabase) {
        const { createBehavioralRepository } = await import('../lib/labEngine/persistence.js')
        const repository = createBehavioralRepository()
        try { await progress.value.hydrateNative({ repository }) } finally { repository.close() }
      } else {
        await progress.value.hydrateNative({ repository: { listRuns: async () => [], listResults: async () => [] } })
      }
    }
  } catch (error) { message.value = error.message }
})
async function practice(recommendation, allowShorter = false) {
  message.value = ''
  try {
    const session = await props.store.start({ mode: 'study', size: 5, seed: Math.floor(Math.random() * 4294967296), conceptIds: [recommendation.conceptId], preferredQuestionIds: recommendation.questionIds, allowShorter })
    const fresh = session.questions.filter(q => recommendation.questionIds.includes(q.id)).length
    await router.push({ name: 'exam-session', params: { sessionId: session.id }, query: { preferred: String(fresh), familiar: String(session.order.length - fresh) } })
  } catch (error) { if (error.code === 'SHORTER_DECK_CONSENT_REQUIRED') shorter.value = recommendation; else message.value = error.message }
}
</script>
<template><main class="exam-page"><nav class="exam-breadcrumb"><RouterLink to="/exam">Exam setup</RouterLink><RouterLink to="/review/history">History</RouterLink><RouterLink to="/">Home and Labs</RouterLink></nav><h1>Review and next practice</h1><BackupControls :store="store" /><p v-if="message" role="alert">{{ message }}</p>
  <template v-if="review"><p>Evidence uses up to six independent families per concept. Fewer than three is an assessment request, not a measured weakness. Assisted answers, repeat exposure, omissions and uncertainty are shown separately.</p><p>{{ review.counts.attempts }} completed attempts; {{ review.counts.activeSessions }} unfinished sessions. Omitted components: {{ review.counts.omitted }}; incomplete: {{ review.counts.incomplete }}; assisted encounters: {{ review.counts.assisted }}; repeated: {{ review.counts.repeat }}; uncertain: {{ review.counts.uncertain }}.</p>
    <section v-if="coverage" class="exam-bank-coverage"><h2>Bank availability</h2><p>{{ store.bank.questions.length }} authored items across {{ coverage.familyCount }} families. {{ coverage.assessmentNeeded.length }} concepts have fewer than three available bank families. These content limits are separate from your learner evidence.</p></section>
    <section v-if="shorter" class="exam-confirm"><p>Fewer than five items match this concept. Start the available shorter session without duplicates?</p><button @click="practice(shorter, true)">Start available shorter Study</button><button @click="shorter = null">Cancel</button></section>
    <section><h2>Concept evidence</h2><ReviewRecommendation v-for="topic in [...review.topics, ...review.assessmentNeeded]" :key="`${topic.domain}/${topic.objectiveId}/${topic.conceptId}`" :topic="topic" :recommendation="recommendations.find(r => r.conceptId === topic.conceptId && r.objectiveId === topic.objectiveId)" :store="store" @practice="practice" /></section>
  </template><p v-else-if="store.ready">Finish the active Mock before opening review.</p>
</main></template>
