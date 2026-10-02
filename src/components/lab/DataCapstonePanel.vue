<script setup>
import { computed, ref, toRaw } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'
import { dataStageView } from '../../lib/labEngine/data-capstone/stages.js'
import { dataIncidentView } from '../../lib/labEngine/data-capstone/incidents.js'
import { dataCleanupInventory } from '../../lib/labEngine/data-capstone/ownership.js'
import { capstoneServices } from '../../data/labs/data-journey/capstone-helpers.js'
const run = useLabRunStore()
const error = ref('')
const state = computed(() => toRaw(run.behavioralRun))
const stages = computed(() => dataStageView(state.value, run.lab))
const incident = computed(() => dataIncidentView(state.value, run.lab))
const inventory = computed(() => dataCleanupInventory(state.value, run.lab))
const services = computed(() => capstoneServices(state.value))
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.storageError || run.busy)
const frozen = computed(() => !!stages.value.cleanupCheckpoint)
const controls = computed(() => Object.entries(run.lab.scenarios).map(([id, scenario]) => ({ id, scenario,
  disabled: locked.value || scenario.stageId !== stages.value.activeStageId || frozen.value && scenario.mode !== 'cleanup'
    || scenario.steps.some(step => step.action === 'incident-start' && incident.value.incidents.some(item => item.id === step.incidentId)) })))
const result = computed(() => [...run.scrollback].reverse().find(line => line.measurements?.worker)?.measurements)
const recovery = computed(() => state.value.evidence.experimentsById[state.value.evidence.currentEvidenceByTask['final-recovery']]?.measurements)
const activeTasks = computed(() => run.taskStates.filter(task => run.lab.stages.find(stage => stage.id === stages.value.activeStageId)?.taskIds.includes(task.id)))
const canFreeze = computed(() => !locked.value && !frozen.value && stages.value.activeStageId === 'final-cleanup'
  && activeTasks.value.filter(task => !task.id.startsWith('cleanup-')).every(task => task.done))
const canAdvance = computed(() => !locked.value && activeTasks.value.length > 0 && activeTasks.value.every(task => task.done)
  && (stages.value.activeStageId !== 'final-cleanup' || stages.value.cleanupReady))
async function send(action) {
  try {
    error.value = ''
    const response = await run.dispatchBehavioral(action)
    error.value = response?.effects?.diagnostics?.map(item => item.message).join(' ') ?? ''
  } catch (reason) { error.value = reason.message }
}
</script>
<template>
  <section class="experiment-tool" aria-label="Data capstone checkpoints and experiments">
    <h2>Data Knowledge Assistant</h2>
    <p>Active checkpoint: {{ stages.activeStageId ?? 'All seven sealed' }}. Runs use actual captured Pods. Simulated estimate — not an Azure guarantee.</p>
    <ol><li v-for="stage in stages.stages" :key="stage.id">{{ stage.id }} · {{ stage.sealed ? 'Sealed' : stage.active ? 'Active' : 'Locked' }}</li></ol>
    <div class="experiment-tool__controls">
      <button v-for="control in controls" :key="control.id" class="btn" type="button" :disabled="control.disabled"
        @click="send({ type: 'data-capstone', scenarioId: control.id })">{{ control.id.startsWith('inject-') ? `Start ${control.id.slice(7)} incident` : control.id }}</button>
      <button class="btn" type="button" :disabled="!canFreeze" @click="send({ type: 'data-freeze-cleanup' })">Freeze cleanup proof</button>
      <button class="btn btn--primary" type="button" :disabled="!canAdvance" @click="send({ type: 'data-advance-stage' })">Seal and advance</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="frozen">Final recovery proof is frozen. Files are read-only. Delete exact owned resources in Cloud Shell, verify cleanup and seal the final checkpoint.</p>
    <div class="experiment-tool__response">
      <h3>Current service facts</h3>
      <p>PostgreSQL: {{ services.pg ? `${services.pg.tier}, ${services.database?.tables.length ?? 0} tables, ${services.database?.indexes.length ?? 0} indexes` : 'Not provisioned' }}</p>
      <p>Cosmos: {{ services.cosmos ? `${services.cosmos.defaultConsistencyLevel}, ${services.containers.length} containers` : 'Not provisioned' }}</p>
      <p>Redis: {{ services.redis ? `${services.redis.database.evictionPolicy}, ${services.redis.database.memoryLimitBytes} byte teaching limit` : 'Not provisioned' }}</p>
      <p v-for="item in incident.incidents" :key="item.id">{{ item.id }}: {{ item.status }} · baseline API {{ item.baseline.apiArtifactId }} · fault {{ item.faultArtifactId }}</p>
      <h3>Cleanup inventory</h3>
      <p>{{ inventory.owned.length }} owned remaining · {{ inventory.protected.length }} protected · supplied resources {{ inventory.protectedIntact ? 'intact' : 'missing' }}</p>
      <ul><li v-for="item in inventory.owned" :key="item.resourceId">{{ item.type }}: {{ item.resourceId }}</li></ul>
      <details><summary>Protected and unowned resources</summary><pre>{{ JSON.stringify({ protected: inventory.protected, unowned: inventory.unowned }, null, 2) }}</pre></details>
    </div>
    <div v-if="result" class="experiment-tool__response">
      <h3>Actual scenario results</h3>
      <p>HTTP {{ result.status }} · exact hits {{ result.responseHits }} · semantic hits {{ result.semanticHits }} · PG misses {{ result.ragMisses }} · stale answers {{ result.staleAnswers }} · history writes {{ result.historyWrites }}</p>
      <p>Durable continuation: {{ result.worker.before ?? 'None' }} → {{ result.worker.after ?? 'None' }}</p>
      <p v-if="result.load">Origin requests {{ result.load.originRequests }} · served {{ result.load.served }} · failed {{ result.load.failed }} · p95 {{ result.load.p95Ms }}ms · peak PG connections {{ result.load.peakServerConnections }}</p>
      <p v-for="load in result.loads ?? []" :key="load.stepIndex">{{ load.originRequests ? 'Cold origin workload' : 'Warm cache workload' }} at {{ load.startedAtMs / 1000 }}s · {{ load.originRequests }} origin requests · {{ load.failed }} failed · {{ load.peakServerConnections }} PG connections</p>
      <details open><summary>Returned answers, sources and history</summary><pre>{{ JSON.stringify(result.requests.map(item => ({ route: item.route, artifact: item.artifactId, returnedFrom: item.returnedFrom, body: item.body, sources: item.sourceIds, historyWrites: item.historyWrites })), null, 2) }}</pre></details>
      <details><summary>Worker before/after and actual cache effects</summary><pre>{{ JSON.stringify({ worker: result.worker, cache: result.cache }, null, 2) }}</pre></details>
      <details><summary>SDK trace</summary><p v-if="result.displayTraceTruncated">Display bounded; complete per-request facts grade the task.</p><pre>{{ JSON.stringify(result.calls, null, 2) }}</pre></details>
      <details v-if="recovery"><summary>Retained fresh final recovery sources and history</summary><pre>{{ JSON.stringify(recovery.requests.map(item => ({ route: item.route, artifactId: item.artifactId, returnedFrom: item.returnedFrom, body: item.body, historyWrites: item.historyWrites })), null, 2) }}</pre></details>
    </div>
  </section>
</template>
