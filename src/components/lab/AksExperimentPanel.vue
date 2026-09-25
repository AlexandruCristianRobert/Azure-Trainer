<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'

const run = useLabRunStore()
const choice = ref('')
const error = ref('')
const scenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, scenario]) => scenario.kind === 'aks-request'))
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.storageError || run.busy)
const selectedScenario = computed(() => run.lab?.scenarios?.[choice.value] ?? null)
const latestEvidence = computed(() => Object.values(run.behavioralRun?.evidence?.experimentsById ?? {})
  .filter(record => record.scenarioId === choice.value && record.measurements?.clusterId === selectedScenario.value?.target?.clusterId
    && record.measurements?.namespace === selectedScenario.value?.target?.namespace)
  .sort((a, b) => b.sequence - a.sequence)[0] ?? null)
watch(() => `${run.labId}:${run.behavioralRun?.attemptId ?? ''}`, () => { choice.value = scenarios.value[0]?.[0] ?? ''; error.value = '' }, { immediate: true })
async function send() {
  error.value = ''
  try {
    const result = await run.dispatchBehavioral({ type: 'aks-request', scenarioId: choice.value })
    if (result?.effects?.diagnostics?.length) error.value = result.effects.diagnostics.map(item => item.message).join(' ')
  } catch (reason) { error.value = reason.message }
}
</script>

<template>
  <section class="experiment-tool" aria-label="AKS experiment controls">
    <header><h2>Verify a Kubernetes service</h2><p>Requests use the current Service and the Pods' captured image. Results transition immediately because this is a simulation.</p></header>
    <div class="experiment-tool__controls">
      <label>Declared verification<select v-model="choice" :disabled="locked || !scenarios.length"><option v-for="[id, scenario] in scenarios" :key="id" :value="id">{{ scenario.request?.method ?? 'GET' }} {{ scenario.request?.path ?? id }}</option></select></label>
      <button class="btn btn--primary" type="button" :disabled="locked || !choice" @click="send">Send simulated request</button>
    </div>
    <p v-if="!scenarios.length" class="experiment-tool__empty">This Lab has no declared Kubernetes verification scenarios.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <section class="experiment-tool__response"><h3>Latest result</h3><p v-if="!latestEvidence">No request has been recorded for this declared verification.</p><template v-else><strong>HTTP {{ latestEvidence.measurements?.status }}</strong><p v-if="latestEvidence.measurements?.diagnosticCode" role="status">Diagnostic: {{ latestEvidence.measurements.diagnosticCode }}</p><pre>{{ JSON.stringify(latestEvidence.measurements?.body, null, 2) }}</pre><p>Evidence: {{ latestEvidence.id }} · {{ latestEvidence.outcome }}</p></template></section>
  </section>
</template>
