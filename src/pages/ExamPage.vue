<script setup>
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useExamStore } from '../stores/exam.js'
import ExamSetup from '../components/exam/ExamSetup.vue'
import BackupControls from '../components/exam/BackupControls.vue'
import '../styles/exam.css'
const props = defineProps({ store: { type: Object, default: () => useExamStore() } })
const route = useRoute(), router = useRouter(), message = ref('')
onMounted(() => { void props.store.hydrate().catch(error => { message.value = error.message }) })
</script>
<template><main class="exam-page"><nav class="exam-breadcrumb"><RouterLink to="/">Home</RouterLink><RouterLink to="/review">Review</RouterLink><RouterLink to="/review/history">History</RouterLink></nav><h1>AI-200 exam practice</h1><p>Practice decisions across containers, data, integration and security. Keep your work locally, then use independent evidence to choose what to practice next.</p><BackupControls :store="store" /><p v-if="message" role="alert">{{ message }}</p><section v-if="store.snapshot?.sessions.some(s => s.status !== 'finished')"><h2>Resume saved work</h2><p v-for="session in store.snapshot.sessions.filter(s => s.status !== 'finished')" :key="session.id"><RouterLink :to="`/exam/session/${session.id}`">Resume {{ session.mode === 'mock' ? 'Mock' : 'Study' }}</RouterLink> — {{ session.status }}</p></section><ExamSetup v-if="store.ready" :store="store" :initial-mode="route.query.mode" @started="session => router.push(`/exam/session/${session.id}`)" /></main></template>
