<script setup>
import { computed } from 'vue'
const props = defineProps({ inspection: Object, selectedId: String })
defineEmits(['select'])
const historical = computed(() => props.inspection.incident?.selected ?? null)
const selected = computed(() => historical.value?.records.request ?? props.inspection.requests.selected)
const snapshots = computed(() => [...(props.inspection.incident?.observations ?? []), ...(props.inspection.incident?.recoveries ?? [])])
const time = value => `${(value ?? 0) / 1000} simulated seconds`
</script>

<template>
  <section class="aks-diagnosis-inspection" aria-label="Read-only diagnosis request inspection">
    <h3>Request inspection</h3>
    <p>Live current request records describe actual routed requests. Previous-container records retain logs from the last terminated container. Historical incident snapshots preserve observation-time evidence. Inspection does not verify a Task.</p>
    <label>Request or snapshot
      <select :value="selectedId || inspection.requests.selected?.id || ''" aria-label="Select diagnosis request to inspect" @change="$emit('select', $event.target.value)">
        <option value="">Select a recorded request</option>
        <optgroup label="Live current request records"><option v-for="request in inspection.requests.records" :key="request.id" :value="request.id">{{ request.id }} · {{ time(request.simTimeMs) }}</option></optgroup>
        <optgroup label="Historical incident snapshots"><option v-for="snapshot in snapshots" :key="snapshot.id" :value="snapshot.id">{{ snapshot.id }} · {{ snapshot.kind }} · {{ time(snapshot.simTimeMs) }}</option></optgroup>
      </select>
    </label>
    <p v-if="!inspection.requests.records.length">No live current request records.</p>
    <p v-if="inspection.requests.truncated" role="status">{{ inspection.requests.truncated }} older request records truncated. Historical incident snapshots have a separate lifetime.</p>
    <template v-if="selected">
      <h4>{{ historical ? 'Historical incident snapshot' : 'Live current request record' }}: {{ selected.id }}</h4>
      <dl><dt>Simulation time</dt><dd>{{ time(selected.simTimeMs) }}</dd><dt>Entry point</dt><dd>{{ selected.origin.kind }} · {{ selected.hostname }}:{{ selected.port }} · {{ selected.request.method }} {{ selected.request.path }}</dd>
        <dt>Transport / HTTP</dt><dd>{{ selected.transport.ok ? 'Transport succeeded' : `Transport failed (${selected.transport.reason})` }} · {{ selected.status === null ? 'No HTTP response' : `HTTP ${selected.status}` }}</dd>
        <dt>Pod / container / artifact</dt><dd>{{ selected.podUid ?? 'No Pod reached' }} · {{ selected.containerId ?? 'No container reached' }} · {{ selected.artifactId ?? 'No artifact reached' }}</dd></dl>
      <h4>Actual response and retrieved sources</h4><pre>{{ JSON.stringify(selected.body, null, 2) }}</pre>
      <h4>Reached dependency stages</h4><p v-if="!selected.dependencyTrace.length">No dependency stages reached.</p>
      <ul v-else><li v-for="(stage, index) in selected.dependencyTrace" :key="index">{{ stage.operation }}: {{ stage.status }}</li></ul>
      <pre v-if="selected.integrationTrace">{{ JSON.stringify(selected.integrationTrace, null, 2) }}</pre>
    </template>
    <h4>Live current container records</h4><p v-if="!inspection.logs.current.length">No related current-container logs.</p><pre v-for="log in inspection.logs.current" :key="log.id">{{ JSON.stringify(log, null, 2) }}</pre>
    <h4>Previous-container records</h4><p v-if="!inspection.logs.previous.length">No related previous-container logs.</p><pre v-for="log in inspection.logs.previous" :key="log.id">{{ JSON.stringify(log, null, 2) }}</pre>
    <p v-if="inspection.logs.truncated" role="status">{{ inspection.logs.truncated }} older container log records truncated.</p>
    <h4>Historical incident snapshots</h4><p v-if="!snapshots.length">No historical incident snapshots.</p>
    <ul v-else><li v-for="snapshot in snapshots" :key="snapshot.id">{{ snapshot.id }} · epoch {{ snapshot.epoch }} · {{ snapshot.phaseId }} · {{ snapshot.kind }} · {{ time(snapshot.simTimeMs) }}</li></ul>
    <template v-if="historical"><h4>Historical application and dependency records</h4><pre>{{ JSON.stringify(historical.records, null, 2) }}</pre></template>
    <h4>Related safe events (Pod and namespace)</h4><p v-if="!inspection.events.length">No related events.</p><ul v-else><li v-for="(event, index) in inspection.events" :key="index">{{ event.reason }} · {{ event.association }}<template v-if="event.simTimeMs !== null && event.simTimeMs !== undefined"> · {{ time(event.simTimeMs) }}</template> · {{ event.message }}</li></ul>
    <template v-if="inspection.consistency"><h4>Current saved/build/live consistency</h4><p>{{ inspection.consistency.consistent ? 'Consistent' : 'Needs repair or fresh proof' }}</p><ul><li v-for="reason in inspection.consistency.reasons" :key="reason">{{ reason }}</li></ul></template>
  </section>
</template>

<style scoped>
.aks-diagnosis-inspection { margin: 20px 0; padding: 12px; border-left: 3px solid var(--accent); }
.aks-diagnosis-inspection p { line-height: 1.5; }
.aks-diagnosis-inspection select { max-width: 100%; min-height: 32px; font: inherit; }
.aks-diagnosis-inspection pre, .aks-diagnosis-inspection dd { overflow-wrap: anywhere; white-space: pre-wrap; }
.aks-diagnosis-inspection dl { display: grid; grid-template-columns: minmax(100px, 1fr) 3fr; gap: 8px; }
.aks-diagnosis-inspection dd { margin: 0; }
</style>
