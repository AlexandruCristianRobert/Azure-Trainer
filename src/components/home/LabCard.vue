<script setup>
import { computed } from 'vue'
import { useProgressStore } from '../../stores/progress.js'
import { SERVICES } from '../../data/services.js'
import { skillAreaById } from '../../data/skillAreas.js'
import AzureIcon from '../icons/AzureIcon.vue'

const props = defineProps({ lab: { type: Object, required: true } })
const progress = useProgressStore()
const service = computed(() => SERVICES[props.lab.service])
const area = computed(() => skillAreaById(props.lab.skillAreaId))
const comingSoon = computed(() => props.lab.status !== 'available')
const status = computed(() => (comingSoon.value ? 'coming-soon' : progress.labStatus(props.lab.id)))
const summary = computed(() => (comingSoon.value ? null : progress.runSummary(props.lab.id)))
const pct = computed(() => (summary.value ? Math.round((summary.value.tasksDone / summary.value.total) * 100) : 0))
const label = computed(() => ({ 'not-started': 'Not started', 'in-progress': 'In progress', completed: 'Completed', 'coming-soon': 'Coming soon' })[status.value])
const button = computed(() => ({ 'not-started': 'Start', 'in-progress': 'Resume', completed: 'Open' })[status.value])
</script>

<template>
  <article class="lab-card" :class="{ 'lab-card--active': status === 'in-progress', 'lab-card--soon': comingSoon }">
    <div class="lab-card__head">
      <div class="lab-card__icon" :style="{ background: service.tint }"><AzureIcon :name="service.icon" :size="20" /></div>
      <div>
        <div class="lab-card__title">{{ lab.title }}</div>
        <div class="lab-card__meta">{{ area.name }} · ~{{ lab.minutes }} min</div>
      </div>
    </div>
    <div class="lab-card__status">
      <span class="pill" :class="status === 'coming-soon' || status === 'not-started' ? 'pill--muted' : 'pill--accent'">{{ label }}</span>
      <span v-if="summary" class="lab-card__count">{{ summary.tasksDone }} of {{ summary.total }} tasks</span>
    </div>
    <div v-if="summary" class="bar lab-card__bar" :class="{ 'bar--success': status === 'completed' }"><div class="bar__fill" :style="{ width: pct + '%' }" /></div>
    <div v-if="!comingSoon" class="lab-card__actions">
      <RouterLink class="btn btn--primary" :to="{ name: 'lab', params: { labId: lab.id } }">{{ button }}</RouterLink>
    </div>
  </article>
</template>
