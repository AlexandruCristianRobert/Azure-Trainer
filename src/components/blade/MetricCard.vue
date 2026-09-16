<script setup>
import { computed } from 'vue'

const props = defineProps({ title: { type: String, required: true }, points: { type: Array, required: true } })
const path = computed(() => {
  const n = props.points.length
  return props.points.map((y, i) => `${Math.round((i / Math.max(1, n - 1)) * 340)},${y}`).join(' ')
})
</script>

<template>
  <div class="metric-card">
    <div class="metric-card__head"><span class="metric-card__title">{{ title }}</span><span class="metric-card__range">Last hour</span></div>
    <svg width="100%" height="30" viewBox="0 0 340 30" preserveAspectRatio="none" aria-hidden="true"><polyline :points="path" fill="none" stroke="var(--accent)" stroke-width="1.5" /></svg>
  </div>
</template>
