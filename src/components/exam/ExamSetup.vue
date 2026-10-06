<script setup>
import { computed, ref } from 'vue'
import { EXAM_DOMAINS, EXAM_KINDS } from '../../lib/exam/contracts.js'
const props = defineProps({ store: { type: Object, required: true }, initialMode: String })
const emit = defineEmits(['started'])
const mode = ref(props.initialMode === 'study' ? 'study' : 'mock'), size = ref(mode.value === 'study' ? 10 : 50), duration = ref(100), goal = ref(props.store.snapshot?.preferences.practiceGoal ?? 80)
const domains = ref([...EXAM_DOMAINS]), kinds = ref([...EXAM_KINDS]), message = ref(''), shorter = ref(false)
const quotas = computed(() => ({ 40: [9, 11, 10, 10], 50: [12, 14, 12, 12], 60: [14, 16, 15, 15] })[size.value])
const studyBlocked = computed(() => !props.store.access({ mode: 'study' }).allowed)
async function start(allowShorter = false) {
  message.value = ''; shorter.value = false
  try {
    const options = { mode: mode.value, size: size.value, practiceGoal: Number(goal.value), seed: Math.floor(Math.random() * 4294967296) }
    if (mode.value === 'mock') options.durationMinutes = duration.value
    else Object.assign(options, { domains: domains.value, kinds: kinds.value, allowShorter })
    await props.store.setPracticeGoal(Number(goal.value)); const session = await props.store.start(options); emit('started', session)
  } catch (error) { message.value = error.message; shorter.value = error.code === 'SHORTER_DECK_CONSENT_REQUIRED' }
}
</script>
<template>
  <form class="exam-setup" @submit.prevent="start()">
    <fieldset>
      <legend>Practice mode</legend>
      <label><input v-model="mode" type="radio" value="mock" @change="size = 50">Mock exam</label>
      <label><input v-model="mode" type="radio" value="study" :disabled="studyBlocked" @change="size = 10">Study</label>
    </fieldset>
    <p v-if="mode === 'mock'">Timed practice with all eight input types, two case studies and one no-return series. Feedback stays hidden until the result is saved. Each section is sealed before moving on. This is an independent practice tool, not an official certification exam.</p>
    <p v-else>Untimed practice with question submission and optional answer reveal. Revealing records assistance and excludes that encounter from independent evidence. A submitted answer is sealed.</p>
    <label class="exam-field">Questions
      <select v-model.number="size">
        <template v-if="mode === 'mock'">
          <option :value="40">40</option><option :value="50">50</option><option :value="60">60</option>
        </template>
        <template v-else>
          <option :value="5">5</option><option :value="10">10</option><option :value="20">20</option>
        </template>
      </select>
    </label>
    <template v-if="mode === 'mock'">
      <label class="exam-field">Time limit
        <select v-model.number="duration">
          <option :value="60">60 minutes</option><option :value="100">100 minutes</option><option :value="120">120 minutes</option>
        </select>
      </label>
      <p>Domain quotas: Containers {{ quotas?.[0] }}, Data {{ quotas?.[1] }}, Connect {{ quotas?.[2] }}, Secure {{ quotas?.[3] }}. The clock continues through breaks, other pages and Microsoft Learn.</p>
    </template>
    <template v-else>
      <fieldset>
        <legend>Domains</legend>
        <label v-for="domain in EXAM_DOMAINS" :key="domain"><input v-model="domains" type="checkbox" :value="domain">{{ domain }}</label>
      </fieldset>
      <fieldset>
        <legend>Question formats</legend>
        <label v-for="kind in EXAM_KINDS" :key="kind"><input v-model="kinds" type="checkbox" :value="kind">{{ kind }}</label>
      </fieldset>
    </template>
    <label class="exam-field">Personal practice goal (%)
      <input v-model.number="goal" type="number" min="1" max="100" required>
    </label>
    <p>Goals are personal targets, not a pass prediction. Saved attempts retain the goal used when they started.</p>
    <p v-if="studyBlocked">Finish the active Mock before starting or resuming Study.</p>
    <p v-if="message" role="alert">{{ message }}</p>
    <button type="submit" :disabled="!store.ready || store.saving || !!store.error || (mode === 'study' && (studyBlocked || !domains.length || !kinds.length))">Start {{ mode === 'mock' ? 'Mock' : 'Study' }}</button>
    <div v-if="shorter">
      <p>Start the available shorter deck without duplicates?</p>
      <button type="button" @click="start(true)">Confirm shorter Study</button>
    </div>
  </form>
</template>
