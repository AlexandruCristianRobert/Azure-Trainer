<script setup>
import { computed, ref, watch } from 'vue'
import { useLabRunStore } from '../../stores/labRun.js'

const run = useLabRunStore()
const scenarios = computed(() => Object.entries(run.lab?.scenarios ?? {}).filter(([, item]) => item.kind === 'probes'))
const latest = computed(() => Object.values(run.behavioralRun?.evidence?.experimentsById ?? {})
  .filter((record) => record.measurements?.events && scenarios.value.some(([id]) => id === record.scenarioId))
  .sort((a, b) => b.sequence - a.sequence)[0] ?? null)
const choice = ref('')
const error = ref('')
const anyActive = computed(() => run.behavioralRun?.runtime?.activeScenario ?? null)
const active = computed(() => anyActive.value?.kind === 'probes' ? anyActive.value : null)
watch(() => `${run.labId}:${run.behavioralRun?.attemptId ?? ''}`, () => {
  choice.value = active.value?.scenarioId ?? latest.value?.scenarioId ?? scenarios.value[0]?.[0] ?? ''
  error.value = ''
}, { immediate: true })
const selectedId = computed({ get: () => active.value?.scenarioId ?? choice.value,
  set: (value) => { if (!active.value) choice.value = value } })
const fixture = computed(() => run.lab?.scenarios?.[selectedId.value] ?? null)
const state = computed(() => run.behavioralRun?.runtime?.probesByApp?.[fixture.value?.appId] ?? null)
const startupConfigured = computed(() => state.value?.probes?.some((probe) => probe.type === 'Startup'))
const result = computed(() => Object.values(run.behavioralRun?.evidence?.experimentsById ?? {})
  .filter((record) => record.scenarioId === selectedId.value && record.measurements?.events)
  .sort((a, b) => b.sequence - a.sequence)[0] ?? null)
const deployment = computed(() => run.behavioralRun?.runtime?.deploymentsByApp?.[fixture.value?.appId] ?? null)
const deploymentKey = computed(() => `deployment:${fixture.value?.appId}`)
const probeKey = computed(() => `probes:${fixture.value?.appId}`)
const displayedProbes = computed(() => active.value ? state.value?.probes ?? []
  : result.value?.measurements?.probes ?? result.value?.dependencyValues?.[deploymentKey.value]?.activeProbes ?? state.value?.probes ?? [])
const stale = computed(() => !!result.value && !active.value && (
  result.value.dependencyValues?.[deploymentKey.value]?.generation !== deployment.value?.active?.generation
  || result.value.dependencyGenerations?.[probeKey.value] !== (run.behavioralRun?.dependencyGenerations?.[probeKey.value] ?? 0)
  || deployment.value?.status !== 'succeeded'))
const progressState = computed(() => active.value ? (active.value.paused ? 'Paused' : 'Running')
  : result.value?.completed ? 'Completed' : 'Ready')
const elapsed = computed(() => active.value?.elapsedSeconds
  ?? (result.value?.completed ? result.value.measurements?.samples?.at(-1)?.second ?? fixture.value?.durationSeconds : 0)
  ?? 0)
const remaining = computed(() => Math.max(0, (fixture.value?.durationSeconds ?? 0) - elapsed.value))
const timeline = computed(() => active.value ? state.value?.events ?? [] : result.value?.measurements?.events ?? [])
const traffic = computed(() => active.value ? state.value?.requests ?? [] : result.value?.measurements?.requests ?? [])
const transitions = computed(() => timeline.value.filter((event) => event.type !== 'probe-result' && event.type !== 'probe-timeout'))
const recentChecks = computed(() => timeline.value.filter((event) => event.type === 'probe-result' || event.type === 'probe-timeout').slice(-18).reverse())
const recentRequests = computed(() => traffic.value.slice(-20).reverse())
const locked = computed(() => run.loading || run.readOnly || !!run.completedAt || !!run.behavioralRun?.completedAt || !!run.storageError || run.busy)
async function dispatch(action) {
  error.value = ''
  try {
    const settled = await run.dispatchBehavioral(action)
    const diagnostics = settled?.effects?.diagnostics ?? []
    if (diagnostics.length) error.value = diagnostics.map((item) => item.message).join(' ')
  } catch (reason) { error.value = reason.message }
}
const advance = (seconds) => { if (seconds > 0) void dispatch({ type: 'simulation-advance', seconds }) }
const replicaName = (id) => id ? `Replica ${id.split('#').at(-1)}` : 'No target'
function eventName(event) {
  if (event.type === 'fault') return `${event.faultType === 'readiness' ? 'Readiness' : event.faultType === 'hang' ? 'Process hang' : 'Dependency'} fault ${event.active ? 'starts' : 'clears'}`
  if (event.type === 'ready-change') return event.ready ? 'Ready for traffic' : 'Removed from traffic'
  if (event.type === 'restart') return `${event.probeType} restart`
  if (event.type === 'startup-begin') return 'Startup begins'
  if (event.type === 'startup-complete') return 'Startup completes'
  return event.type
}
const faultText = (fault) => `${fault.atSecond}s: replica ${fault.replica} ${fault.type} ${fault.active ? 'starts' : 'clears'}`
</script>

<template>
  <section class="probe-experiment" aria-label="Probe Experiment Controls">
    <h3>Probe Experiment Controls</h3>
    <div class="probe-experiment__picker">
      <label for="probe-scenario">Named experiment</label>
      <select id="probe-scenario" v-model="selectedId" :disabled="locked || !!anyActive">
        <option v-for="[id, item] in scenarios" :key="id" :value="id">{{ item.title }}</option>
      </select>
      <span v-if="fixture">{{ fixture.durationSeconds }}s · startup {{ fixture.startupSeconds }}s · {{ fixture.requestsPerSecond }} requests/s</span>
    </div>
    <p v-if="fixture" class="probe-experiment__schedule">Fault schedule: {{ fixture.faults.length ? fixture.faults.map(faultText).join('; ') : 'No faults' }}</p>
    <p class="probe-experiment__schedule">Start creates a fresh pair of replicas with reset health, faults, and restart counts for this isolated experiment.</p>
    <div class="probe-experiment__actions">
      <button type="button" class="btn btn--primary" :disabled="locked || !!anyActive || !fixture" @click="dispatch({ type: 'scenario-start', scenarioId: selectedId })">Start</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active || active.paused || !remaining" @click="advance(Math.min(5, remaining))">Advance 5s</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active || active.paused || !remaining" @click="advance(remaining)">Advance remaining</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active || active.paused" @click="dispatch({ type: 'scenario-pause' })">Pause</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active || !active.paused" @click="dispatch({ type: 'scenario-resume' })">Resume</button>
      <button type="button" class="btn btn--secondary" :disabled="locked || !active" @click="dispatch({ type: 'scenario-cancel' })">Cancel</button>
    </div>
    <p class="probe-experiment__progress" role="status">{{ progressState }} · {{ elapsed }}/{{ fixture?.durationSeconds ?? 0 }} seconds · simulation clock {{ Math.floor((run.behavioralRun?.runtime?.simTimeMs ?? 0) / 1000) }}s</p>
    <p v-if="error" role="alert" class="probe-experiment__error">{{ error }}</p>
    <div class="probe-experiment__table-wrap"><table><caption>Current replica state</caption><thead><tr><th scope="col">Replica</th><th scope="col">Startup</th><th scope="col">Ready for traffic</th><th scope="col">Restarts</th><th scope="col">Last cause</th></tr></thead><tbody>
      <tr v-for="replica in state?.replicas ?? []" :key="replica.id"><th scope="row">{{ replicaName(replica.id) }}</th><td>{{ startupConfigured ? (replica.startupComplete ? 'Complete' : 'Waiting') : 'Not configured' }}</td><td>{{ replica.ready ? 'Yes' : 'No' }}</td><td>{{ replica.restartCount }}</td><td>{{ replica.restartCause ?? '—' }}</td></tr>
      <tr v-if="!state?.replicas?.length"><td colspan="5">Deploy the probe configuration to observe replicas.</td></tr>
    </tbody></table></div>
    <div class="probe-experiment__table-wrap"><table><caption>Lifecycle transitions · full experiment</caption><thead><tr><th scope="col">Second</th><th scope="col">Replica</th><th scope="col">Change</th></tr></thead><tbody>
      <tr v-for="(event, index) in transitions" :key="index"><td>{{ event.second }}</td><td>{{ replicaName(event.replicaId) }}</td><td>{{ eventName(event) }}</td></tr>
      <tr v-if="!transitions.length"><td colspan="3">Start an experiment to see startup and fault transitions.</td></tr>
    </tbody></table></div>
    <div class="probe-experiment__table-wrap"><table><caption>Recent probe checks</caption><thead><tr><th scope="col">Second</th><th scope="col">Replica</th><th scope="col">Probe</th><th scope="col">Endpoint / status</th><th scope="col">Outcome</th></tr></thead><tbody>
      <tr v-for="(event, index) in recentChecks" :key="index"><td>{{ event.second }}</td><td>{{ replicaName(event.replicaId) }}</td><td>{{ event.probeType }}</td><td>{{ displayedProbes.find((probe) => probe.type === event.probeType)?.httpGet?.path ?? '—' }} / {{ event.status === null ? (event.reason === 'timeout' ? 'Timed out' : event.reason === 'connection-failure' ? 'Connection failed' : 'No response') : `HTTP ${event.status}` }}</td><td>{{ event.reason }}</td></tr>
      <tr v-if="!recentChecks.length"><td colspan="5">No checks yet.</td></tr>
    </tbody></table></div>
    <div class="probe-experiment__table-wrap"><table><caption>Recent requests</caption><thead><tr><th scope="col">Second</th><th scope="col">Target</th><th scope="col">Status</th></tr></thead><tbody>
      <tr v-for="(request, index) in recentRequests" :key="index"><td>{{ request.second }}</td><td>{{ replicaName(request.replicaId) }}</td><td>HTTP {{ request.status }}</td></tr>
      <tr v-if="!recentRequests.length"><td colspan="3">No requests yet.</td></tr>
    </tbody></table></div>
    <details v-if="traffic.length > recentRequests.length"><summary>Show all {{ traffic.length }} request targets and statuses</summary><div class="probe-experiment__table-wrap"><table><caption>All requests · full experiment</caption><thead><tr><th scope="col">Second</th><th scope="col">Target</th><th scope="col">Status</th></tr></thead><tbody><tr v-for="(request, index) in traffic" :key="index"><td>{{ request.second }}</td><td>{{ replicaName(request.replicaId) }}</td><td>HTTP {{ request.status }}</td></tr></tbody></table></div></details>
    <p class="probe-experiment__result" aria-live="polite">Latest verification: <strong>{{ result ? `${result.outcome} · ${result.measurements.readyReplicas} ready · ${result.measurements.restarts} restarts` : 'No completed experiment yet' }}</strong></p>
    <p v-if="stale" class="probe-experiment__note">Historical verification: the deployment changed. The checks and request trace above describe the earlier captured configuration; run this experiment again for current proof.</p>
    <p class="probe-experiment__note">Times above are relative to this named experiment. Checks use a one-second teaching clock and immediate restart; actual Azure scheduling and recovery timing can differ.</p>
  </section>
</template>
