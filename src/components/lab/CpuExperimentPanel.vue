<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'

const run = useLabRunStore()
const scenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, fixture]) => fixture.kind === 'cpu'))
const allocations = computed(() => (run.lab?.cpuScaling?.allowedResources ?? [])
  .map(({ cpu, memory }) => `${cpu} CPU / ${memory}`).join('; '))
const storageKey = computed(() => `aca-cpu-scenario:${run.labId}:${run.behavioralRun?.attemptId ?? ''}`)
const choice = ref('baseline')
const error = ref('')
watch(storageKey, () => {
  try { choice.value = sessionStorage.getItem(storageKey.value) ?? scenarios.value[0]?.[0] ?? '' }
  catch { choice.value = scenarios.value[0]?.[0] ?? '' }
}, { immediate: true })
function select(event) {
  choice.value = event.target.value
  try { sessionStorage.setItem(storageKey.value, choice.value) } catch { /* Storage can be unavailable. */ }
}
const anyActive = computed(() => run.behavioralRun?.runtime?.activeScenario ?? null)
const active = computed(() => anyActive.value?.kind === 'cpu' || (!anyActive.value?.kind
  && scenarios.value.some(([id]) => id === anyActive.value?.scenarioId)) ? anyActive.value : null)
const selectedId = computed(() => active.value?.scenarioId ?? choice.value)
const fixture = computed(() => run.lab?.scenarios?.[selectedId.value])
const elapsed = computed(() => active.value?.elapsedSeconds ?? 0)
const remaining = computed(() => Math.max(0, (fixture.value?.durationSeconds ?? 0) - elapsed.value))
const cpu = computed(() => run.behavioralRun?.runtime?.cpuByApp?.[fixture.value?.appId] ?? null)
const sample = computed(() => cpu.value?.samples?.at(-1) ?? null)
const result = computed(() => Object.values(run.behavioralRun?.evidence?.experimentsById ?? {})
  .filter((record) => record.scenarioId === selectedId.value && record.measurements?.trace)
  .sort((left, right) => right.sequence - left.sequence)[0] ?? null)
const recent = computed(() => (active.value?.trace ?? result.value?.measurements?.trace ?? []).slice(-15).reverse())
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.storageError || run.busy)
async function dispatch(action) {
  error.value = ''
  try {
    const settled = await run.dispatchBehavioral(action)
    const diagnostics = settled?.effects?.diagnostics ?? []
    if (diagnostics.length) error.value = diagnostics.map((item) => item.message).join(' ')
  } catch (reason) { error.value = reason.message }
}
function advance(seconds) { void dispatch({ type: 'simulation-advance', seconds }) }
const count = (value) => value ?? '—'
const metric = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—'
</script>

<template>
  <section class="cpu-experiment" aria-label="CPU Experiment Controls">
    <div class="cpu-experiment__head"><h3>CPU workload</h3><p>Simulated time advances only when you choose Advance.</p></div>
    <p v-if="allocations" class="cpu-experiment__note">Supported allocations: {{ allocations }}</p>
    <div class="cpu-experiment__picker">
      <label for="cpu-scenario">Named workload</label>
      <select id="cpu-scenario" :value="selectedId" :disabled="locked || !!anyActive" @change="select"><option v-for="[id, item] in scenarios" :key="id" :value="id">{{ item.title }}</option></select>
      <span v-if="fixture">{{ fixture.durationSeconds }} seconds · {{ fixture.demandCpuSecondsPerSecond }} CPU-seconds/second · {{ metric(fixture.demandCpuSecondsPerSecond / fixture.requestCpuSeconds) }} offered requests/second</span>
    </div>
    <p class="cpu-experiment__progress" role="status">{{ active ? (active.paused ? 'Paused' : 'Running') : 'Ready' }} · {{ elapsed }}/{{ fixture?.durationSeconds ?? 0 }} seconds · simulation clock {{ Math.floor((run.behavioralRun?.runtime?.simTimeMs ?? 0) / 1000) }}s</p>
    <div class="cpu-experiment__actions">
      <button type="button" class="btn btn--primary" :disabled="locked || !!anyActive || !fixture" @click="dispatch({ type: 'scenario-start', scenarioId: selectedId })">Start</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active || active.paused" @click="advance(Math.min(15, remaining))">Advance 15s</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active || active.paused" @click="advance(remaining)">Advance remaining</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active || active.paused" @click="dispatch({ type: 'scenario-pause' })">Pause</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active || !active.paused" @click="dispatch({ type: 'scenario-resume' })">Resume</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active" @click="dispatch({ type: 'scenario-cancel' })">Cancel</button>
    </div>
    <p v-if="error" class="cpu-experiment__error" role="alert">{{ error }}</p>
    <dl class="cpu-experiment__metrics">
      <div><dt>Ready</dt><dd>{{ count(cpu?.readyReplicas) }}</dd></div>
      <div><dt>Pending</dt><dd>{{ count(cpu?.pendingReplicas?.reduce((sum, item) => sum + item.count, 0)) }}</dd></div>
      <div><dt>Desired</dt><dd>{{ count(cpu?.desiredReplicas) }}</dd></div>
      <div><dt>Utilization</dt><dd>{{ metric(sample?.utilization) }}%</dd></div>
      <div><dt>Offered</dt><dd>{{ metric(sample?.offeredThroughput) }} req/s</dd></div>
      <div><dt>Served</dt><dd>{{ metric(sample?.servedThroughput) }} req/s</dd></div>
    </dl>
    <p class="cpu-experiment__result" aria-live="polite">Latest {{ fixture?.title ?? 'workload' }} result: <strong>{{ result ? `${result.outcome} · ${result.measurements.startReadyReplicas} to ${result.measurements.endReadyReplicas} ready replicas` : 'No completed run yet' }}</strong><span v-if="result?.outcome === 'failed' && selectedId === 'quiet' && result.measurements.startReadyReplicas <= 1"> Quiet must start after a workload has scaled out.</span></p>
    <div class="cpu-experiment__table-wrap"><table><caption>Recent samples · latest 15 simulated seconds</caption><thead><tr><th scope="col">Second</th><th scope="col">Ready</th><th scope="col">Pending</th><th scope="col">Desired</th><th scope="col">CPU %</th><th scope="col">Offered req/s</th><th scope="col">Served req/s</th></tr></thead><tbody><tr v-for="item in recent" :key="item.second"><td>{{ item.second }}</td><td>{{ item.readyReplicas }}</td><td>{{ item.pendingReplicas }}</td><td>{{ item.desiredReplicas }}</td><td>{{ metric(item.utilization) }}</td><td>{{ metric(item.offeredThroughput) }}</td><td>{{ metric(item.servedThroughput) }}</td></tr><tr v-if="!recent.length"><td colspan="7">Start a named workload to collect samples.</td></tr></tbody></table></div>
    <p class="cpu-experiment__note">Throughput is illustrative. The model checks scaling every 15 seconds with 10% tolerance, adds 5 seconds of readiness time and waits 60 seconds of low demand before scale-in.</p>
  </section>
</template>
