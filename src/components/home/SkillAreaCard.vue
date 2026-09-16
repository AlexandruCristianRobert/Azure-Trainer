<script setup>
import { computed } from 'vue'
import { useProgressStore } from '../../stores/progress.js'

const props = defineProps({ area: { type: Object, required: true } })
const progress = useProgressStore()
const stats = computed(() => progress.skillAreaProgress(props.area.id))
const C = 2 * Math.PI * 18
const doneDash = computed(() => `${(stats.value.completed / Math.max(1, stats.value.total)) * C} ${C}`)
const activeDash = computed(() => `${((stats.value.completed + stats.value.inProgress * 0.15) / Math.max(1, stats.value.total)) * C} ${C}`)
const plural = (n) => (n === 1 ? 'lab' : 'labs')
</script>

<template>
  <div class="area-card" :class="{ 'area-card--active': stats.inProgress > 0 }">
    <svg class="area-card__ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="18" fill="none" stroke="var(--border)" stroke-width="4" />
      <circle v-if="stats.inProgress" cx="22" cy="22" r="18" fill="none" stroke="var(--accent-ring)" stroke-width="4" :stroke-dasharray="activeDash" stroke-linecap="round" transform="rotate(-90 22 22)" />
      <circle v-if="stats.completed" cx="22" cy="22" r="18" fill="none" stroke="var(--accent)" stroke-width="4" :stroke-dasharray="doneDash" stroke-linecap="round" transform="rotate(-90 22 22)" />
      <text x="22" y="26" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text)">{{ stats.completed }}/{{ stats.total }}</text>
    </svg>
    <div>
      <div class="area-card__title">{{ area.name }}</div>
      <div class="area-card__meta">
        {{ area.weight }} · {{ stats.completed }} of {{ stats.total }} {{ plural(stats.total) }}<template v-if="stats.inProgress"> · <span class="area-card__active">{{ stats.inProgress }} in progress</span></template>
      </div>
    </div>
  </div>
</template>
