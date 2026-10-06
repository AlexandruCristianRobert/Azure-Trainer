<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
const props = defineProps({ store: { type: Object, required: true } })
const text = computed(() => { const ms = props.store.presentation?.remainingMs; return ms === null || ms === undefined ? 'Study has no countdown' : `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')} remaining` })
let timer
onMounted(() => { timer = setInterval(() => { void props.store.tick().catch(() => {}) }, 1000) })
onUnmounted(() => clearInterval(timer))
</script>
<template><p class="exam-timer" role="timer">{{ text }}</p></template>
