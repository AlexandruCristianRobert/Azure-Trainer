<script setup>
import { computed, onMounted, ref } from 'vue'
import { useExamStore } from '../stores/exam.js'
import BackupControls from '../components/exam/BackupControls.vue'
const props = defineProps({ store: { type: Object, default: () => useExamStore() } })
const impact = ref(null), message = ref('')
const attempts = computed(() => props.store.access({ path: '/review/history' }).allowed ? [...(props.store.snapshot?.attempts ?? [])].sort((a, b) => b.finishedAt - a.finishedAt) : [])
onMounted(() => { void props.store.hydrate().catch(error => { message.value = error.message }) })
async function preview(id) { try { impact.value = await props.store.previewDeleteAttempt(id) } catch (error) { message.value = error.message } }
async function remove() { try { await props.store.deleteAttempt(impact.value.attemptId); impact.value = null; message.value = 'Attempt, its session pointer and attempt notes deleted. Restore from an exported backup if needed.' } catch (error) { message.value = error.message } }
function score(a) { const earned = a.grades.reduce((n, g) => n + g.earned, 0), possible = a.grades.reduce((n, g) => n + g.possible, 0); return `${earned} / ${possible}` }
</script>
<template><main class="exam-page"><nav class="exam-breadcrumb"><RouterLink to="/review">Review</RouterLink><RouterLink to="/exam">Exam setup</RouterLink></nav><h1>Exam history</h1><BackupControls :store="store" /><p v-if="message" role="status">{{ message }}</p>
  <p v-if="!attempts.length">No available completed attempts. Finish a Study session or Mock to save an attempt.</p><ol class="exam-history"><li v-for="attempt in attempts" :key="attempt.id"><RouterLink :to="`/exam/results/${attempt.id}`">{{ attempt.mode === 'mock' ? 'Mock' : 'Study' }} — {{ new Date(attempt.finishedAt).toLocaleString() }}</RouterLink><span>{{ score(attempt) }} points · {{ attempt.source }} · {{ attempt.assistedIds.length }} assisted questions</span><button :disabled="store.saving || !!store.error" @click="preview(attempt.id)">Delete attempt</button></li></ol>
  <section v-if="impact" class="exam-confirm" aria-label="Deletion preview"><h2>Confirm deletion</h2><p>This removes one attempt, {{ impact.sessionIds.length }} session pointer and {{ impact.noteIds.length }} attempt notes. It removes evidence for {{ impact.familyIds.length }} families and {{ impact.conceptIds.length }} concepts. Question and concept notes remain. Export a backup above before deleting if you may want to restore it.</p><button :disabled="store.saving" @click="remove">Confirm deletion</button><button @click="impact = null">Cancel deletion</button></section>
</main></template>
