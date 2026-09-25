<script setup>
import { computed, ref } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { appArmId } from '../../lib/simulation/runtime.js'
import { latestEvidenceForApp, latestRequestForApp } from '../../lib/simulation/inspection.js'
import EvidenceDetails from './EvidenceDetails.vue'
import CpuExperimentPanel from './CpuExperimentPanel.vue'
import ProbeExperimentPanel from './ProbeExperimentPanel.vue'
import FoundryRequestPanel from './FoundryRequestPanel.vue'
import AksExperimentPanel from './AksExperimentPanel.vue'

const run = useLabRunStore()
const appId = ref('')
const method = ref('GET')
const path = ref('/api/info')
const error = ref('')
const apps = computed(() => run.sandbox.containerApps ?? [])
const selected = computed(() => apps.value.find((app) => appArmId(app) === appId.value) ?? apps.value[0])
const deployment = computed(() => selected.value && run.behavioralRun?.runtime?.deploymentsByApp?.[appArmId(selected.value)])
const evidence = computed(() => selected.value ? latestEvidenceForApp(run.behavioralRun?.evidence?.experimentsById, appArmId(selected.value),
  (record) => record.measurements?.method === 'GET' && record.measurements?.path === '/api/info') : null)
const response = computed(() => selected.value ? latestRequestForApp(run.scrollback, appArmId(selected.value)) : null)
const logs = computed(() => (run.behavioralRun?.runtime?.logs ?? []).filter((line) => !selected.value || line.appId === appArmId(selected.value)).slice(-30).reverse())
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.storageError || run.busy)
async function send() {
  error.value = ''
  try {
    const result = await run.dispatchBehavioral({ type: 'request', appId: appArmId(selected.value), method: method.value, path: path.value })
    if (result?.effects?.diagnostics?.length) error.value = `Request diagnostic: ${result.effects.diagnostics.map((item) => item.message).join(' ')}`
  }
  catch (reason) { error.value = reason.message }
}
</script>

<template>
  <section class="experiment-tool" aria-label="Experiment Controls">
    <AksExperimentPanel v-if="run.lab?.capabilities?.kubernetes" />
    <template v-else>
    <header><h2>Experiment Controls</h2><p>Simulated requests use the active deployment's captured source and configuration.</p></header>
    <CpuExperimentPanel v-if="run.lab?.capabilities?.cpuScaling" />
    <ProbeExperimentPanel v-if="run.lab?.capabilities?.healthProbes" />
    <FoundryRequestPanel v-if="run.lab?.capabilities?.foundryInference" />
    <div class="experiment-tool__controls">
      <label>Container App<select :value="selected ? appArmId(selected) : ''" :disabled="!apps.length" @change="appId = $event.target.value"><option v-for="app in apps" :key="appArmId(app)" :value="appArmId(app)" :selected="selected && appArmId(app) === appArmId(selected)">{{ app.name }}</option></select></label>
      <label>Method<select v-model="method"><option>GET</option></select></label>
      <label>Path<input v-model="path" type="text" /></label>
      <button type="button" class="btn btn--primary" :disabled="locked || !selected" @click="send">Send request</button>
    </div>
    <p v-if="!apps.length" class="experiment-tool__empty">Create a Container App to enable requests.</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="selected" class="experiment-tool__deployment"><strong>{{ selected.name }}</strong><span>Desired: {{ deployment?.desired?.image ?? 'No deployment' }}</span><span>Active: {{ deployment?.active?.generation ?? 'None' }} · {{ deployment?.active?.artifactId ?? 'No image' }}</span><span>Status: {{ deployment?.status ?? 'Pending' }}</span></div>
    <div class="experiment-tool__response"><h3>Response</h3><p v-if="!response">No request sent yet.</p><template v-else><strong>HTTP {{ response.status }}</strong><pre>{{ JSON.stringify(response.body, null, 2) }}</pre></template></div>
    <EvidenceDetails :record="evidence" />
    <div class="experiment-tool__logs"><h3>Deployment log</h3><p v-if="!logs.length">No deployment events yet.</p><ol v-else><li v-for="(line, index) in logs" :key="index">{{ line.level }}: {{ line.message }}</li></ol></div>
    </template>
  </section>
</template>
